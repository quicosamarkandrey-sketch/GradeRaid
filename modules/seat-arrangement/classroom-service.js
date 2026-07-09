// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/classroom/classroom-service.js
//  Service Layer for Phase 2 Dynamic Classroom & Seating Management.
//
//  REPOSITORY PATTERN CONTRACT — read this before touching this file:
//    UI modules (classroom_builder.js) NEVER call Supabase directly and NEVER
//    mutate AppStore state for anything in this domain. They call
//    ClassroomService.<method>(...).
//    ClassroomService is the ONLY thing that:
//      a) calls DBService.rpc() for classroom_layouts / seats / seat_assignments
//         writes, and
//      b) calls AppStore.updateState() to reflect those writes into the single
//         source of truth.
//    ClassroomService never touches window.supabase or client.from(...) directly.
//
//  STATE SHAPE (slices maintained in AppStore):
//    draft.classroomLayouts   [{ id, classId, name, roomData, shape, createdAt, updatedAt }]
//    draft.seats              [{ id, layoutId, xCoord, yCoord, rotation, label, isLocked }]
//    draft.seatAssignments    [{ id, seatId, layoutId, studentId, assignedAt, assignedBy }]
//
//  PHASE 2 UPDATE — HYBRID ENGINE (blueprints + manual overrides):
//    generateBlueprint()       → parametric wizard (Grid/U-Shape/Group Pods).
//                                Calls generate_room_blueprint() RPC, which
//                                preserves locked seats and only regenerates
//                                the unlocked portion of the layout.
//    manualMoveStudent()       → the ONE entry point for every sidebar/canvas
//                                drag: sidebar→seat, seat→sidebar (evict),
//                                and seat→occupied-seat (swap). Locked seats
//                                ARE reachable here — locking only blocks the
//                                two automated paths below, not a teacher's
//                                explicit drag.
//    autoAllocateRemaining()   → bulk-fills empty, UNLOCKED seats from the
//                                sidebar's unassigned pool (Alphabetical or
//                                Random strategy). Never touches locked seats
//                                or seats that already have an occupant.
//    setSeatLock()             → toggles seats[i].isLocked. Pure metadata
//                                write; does not move anyone.
//
//  CROSS-MODULE INTEGRATION (Phase 1 → Phase 2):
//    getLiveSeatingMap() joins these three slices with AppStore.attendanceLogs
//    (written by AttendanceService in Phase 1) to compute real-time seat colors
//    without any additional network call. The AppStore subscription in
//    classroom_builder.js re-calls this selector every time either slice updates,
//    so a badge tap → AttendanceService.processScan() → AppStore.updateState()
//    → classroom_builder subscription fires → seats repaint instantly.
//
//  OPTIMISTIC UPDATE STRATEGY (identical to Phase 1):
//    1. Call the authoritative RPC and AWAIT it.
//    2. Immediately apply ITS authoritative result (server-assigned UUIDs, etc.)
//       into AppStore.updateState().
//    3. The realtime listener in db-service.js is a backstop for other tabs —
//       not the primary update path.
// ═══════════════════════════════════════════════════════════════════════════════

window.ClassroomService = (function () {
  'use strict';

  // ── Attendance status → seat color mapping ──────────────────────────────────
  // Green=Present(Early/OnTime), Yellow=Late, Red=Absent, Blue=Excused,
  // Gray=No log today (empty/unscanned), Purple=Seat exists but unassigned.
  const STATUS_COLOR = {
    'Early':   { bg: 'rgba(78,222,163,0.25)',  border: '#4edea3', label: '🟢' },
    'On Time': { bg: 'rgba(78,222,163,0.25)',  border: '#4edea3', label: '🟢' },
    'Late':    { bg: 'rgba(255,185,95,0.25)',  border: '#ffb95f', label: '🟡' },
    'Absent':  { bg: 'rgba(255,180,171,0.25)', border: '#ffb4ab', label: '🔴' },
    'Excused': { bg: 'rgba(147,197,253,0.25)', border: '#93c5fd', label: '🔵' },
    '_no_log': { bg: 'rgba(78,75,102,0.5)',    border: 'rgba(255,255,255,0.12)', label: '⚪' },
    '_empty':  { bg: 'rgba(42,40,54,0.6)',     border: 'rgba(255,255,255,0.06)', label: '—' },
  };

  // ── Internal: map a raw DB row into the camelCase AppStore shape ──────────
  function _mapLayout(row) {
    return {
      id:                row.id,
      classId:           row.class_id,
      name:              row.name,
      roomData:          row.room_data || [],
      shape:             row.shape || 'custom',
      walkwayPreset:     row.walkway_preset || 'traditional',
      seatOverlapFixed:  !!row.seat_overlap_fixed,
      createdAt:         row.created_at,
      updatedAt:         row.updated_at,
    };
  }

  function _mapSeat(row) {
    return {
      id:        row.id,
      layoutId:  row.layout_id,
      xCoord:    row.x_coord,
      yCoord:    row.y_coord,
      rotation:  row.rotation || 0,
      label:     row.label || null,
      isLocked:  !!row.is_locked,
    };
  }

  function _mapAssignment(row) {
    return {
      id:          row.id,
      seatId:      row.seat_id,
      layoutId:    row.layout_id,
      studentId:   row.student_id,
      assignedAt:  row.assigned_at,
      assignedBy:  row.assigned_by,
    };
  }

  // ── Internal: upsert a single layout into draft.classroomLayouts ───────────
  function _upsertLayout(draft, layout) {
    if (!Array.isArray(draft.classroomLayouts)) draft.classroomLayouts = [];
    const idx = draft.classroomLayouts.findIndex(l => l.id === layout.id);
    if (idx >= 0) draft.classroomLayouts[idx] = layout;
    else draft.classroomLayouts.unshift(layout);
  }

  // ── Internal: replace ALL seats for a layout in draft.seats ────────────────
  function _replaceSeatsForLayout(draft, layoutId, seats) {
    if (!Array.isArray(draft.seats)) draft.seats = [];
    draft.seats = draft.seats.filter(s => s.layoutId !== layoutId);
    draft.seats.push(...seats);
  }

  // ── Internal: apply an 'affected' array from assign_student_to_seat() ──────
  function _applyAffected(draft, affected, layoutId) {
    if (!Array.isArray(draft.seatAssignments)) draft.seatAssignments = [];
    (affected || []).forEach(item => {
      // Remove whatever was previously recorded for this seatId.
      draft.seatAssignments = draft.seatAssignments.filter(a => a.seatId !== item.seat_id);
      if (item.student_id) {
        // Also remove any prior assignment for this student in this layout
        // (prevents duplicates when a swap creates a transient dual-assignment).
        draft.seatAssignments = draft.seatAssignments.filter(
          a => !(a.studentId === item.student_id && a.layoutId === layoutId)
        );
        draft.seatAssignments.push({
          id:         null,
          seatId:     item.seat_id,
          layoutId:   layoutId,
          studentId:  item.student_id,
          assignedAt: new Date().toISOString(),
          assignedBy: null,
        });
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * saveLayout(classId, layoutName, seatsArray, propsArray, layoutId?)
   *   → Promise<{ ok, error?, layoutId?, seats? }>
   *
   * Creates or updates a classroom layout. seatsArray is the current on-canvas
   * array from the builder UI:
   *   [{ id: string|null, xCoord, yCoord, rotation, label }]
   * Seats with id=null are new and will receive server-assigned UUIDs; the
   * returned seats array reflects those. propsArray is the room_data JSONB:
   *   [{ type: 'door'|'window'|'whiteboard'|'teacher_desk', x, y, rotation }]
   */
  async function saveLayout(classId, layoutName, seatsArray, propsArray, layoutId) {
    if (!classId || !layoutName) {
      return { ok: false, error: 'classId and layoutName are required.' };
    }

    // Translate camelCase UI shape → snake_case for the RPC parameter.
    const seatsForRpc = (seatsArray || []).map(s => ({
      id:        s.id || null,
      x_coord:   s.xCoord,
      y_coord:   s.yCoord,
      rotation:  s.rotation || 0,
      label:     s.label || null,
      is_locked: !!s.isLocked,
    }));

    const { data, error } = await DBService.rpc('save_classroom_layout', {
      p_layout_id: layoutId || null,
      p_class_id:  classId,
      p_name:      layoutName,
      p_room_data: propsArray || [],
      p_seats:     seatsForRpc,
    });

    if (error) {
      // Log the full error object AND its message separately so the console
      // shows something readable even when the error is a PostgrestError
      // (which logs as plain "Object" without this decomposition).
      console.error('[ClassroomService] saveLayout failed:', error.message || error.code || error, error);
      return { ok: false, error: error.message || 'Could not save layout.' };
    }

    const layout = _mapLayout(data.layout);
    const seats  = (data.seats || []).map(_mapSeat);

    AppStore.updateState(draft => {
      _upsertLayout(draft, layout);
      _replaceSeatsForLayout(draft, layout.id, seats);
      // Purge assignments for any seats the server deleted during reconciliation
      // (seats removed from the canvas). The server already cascade-deleted them;
      // we mirror that here so the UI doesn't show phantom assignments.
      if (Array.isArray(draft.seatAssignments)) {
        const validSeatIds = new Set(seats.map(s => s.id));
        draft.seatAssignments = draft.seatAssignments.filter(
          a => a.layoutId !== layout.id || validSeatIds.has(a.seatId)
        );
      }
    }, { type: 'classroom:layout-saved', payload: { classId, layoutId: layout.id } });

    return { ok: true, layoutId: layout.id, seats };
  }

  /**
   * assignStudentToSeat(studentId, seatId, layoutId)
   *   → Promise<{ ok, error?, affected? }>
   *
   * Drag-and-drop assignment. Pass studentId=null to unassign the seat.
   * The RPC handles swap/eviction logic atomically server-side; we reflect
   * all affected assignments in one AppStore.updateState() call.
   */
  async function assignStudentToSeat(studentId, seatId, layoutId) {
    if (!seatId || !layoutId) {
      return { ok: false, error: 'seatId and layoutId are required.' };
    }

    const assignedBy = (typeof currentUser !== 'undefined' && currentUser)
      ? currentUser.id : null;

    const { data, error } = await DBService.rpc('assign_student_to_seat', {
      p_seat_id:     seatId,
      p_layout_id:   layoutId,
      p_student_id:  studentId || null,
      p_assigned_by: assignedBy,
    });

    if (error) {
      console.error('[ClassroomService] assignStudentToSeat failed:', error.message || error.code || error, error);
      return { ok: false, error: error.message || 'Could not assign seat.' };
    }

    AppStore.updateState(draft => {
      _applyAffected(draft, data.affected, layoutId);
    }, {
      type: 'classroom:seat-assigned',
      payload: { seatId, layoutId, studentId },
    });

    return { ok: true, affected: data.affected };
  }

  /**
   * generateBlueprint(layoutId, classId, name, shape, rows, cols, spacing, preset)
   *   → Promise<{ ok, error?, layoutId?, generatedSeats?, preservedLockedCount? }>
   *
   * PARAMETRIC WIZARD. shape is 'grid' | 'u_shape' | 'group_pods'.
   * Pass layoutId=null to create a brand-new layout from the wizard instead
   * of regenerating an existing one.
   *
   * preset is 'traditional' | 'center_aisle' | 'double_aisle' and ONLY
   * applies when shape='grid' — it splits the columns into 1/2/3 blocks
   * with a walkway-width gap between them (e.g. center_aisle with cols=6
   * lays out 3 columns | aisle | 3 columns, not 6+6). u_shape/group_pods
   * ignore preset server-side. Defaults to 'traditional' (no walkway) if
   * omitted, which is identical to the original flat-grid behavior.
   *
   * Locked seats are preserved server-side (the RPC never deletes
   * is_locked=true rows) — this call only replaces the UNLOCKED portion of
   * the seat layer, then reloads it into AppStore. Existing assignments for
   * locked seats survive untouched; assignments for seats that get deleted
   * (because they were unlocked) are cascade-deleted by the DB and pruned
   * from draft.seatAssignments here, exactly like saveLayout() already does.
   */
  async function generateBlueprint(layoutId, classId, name, shape, rows, cols, spacing, preset) {
    if (!classId || !shape) {
      return { ok: false, error: 'classId and shape are required.' };
    }
    if (!['grid', 'u_shape', 'group_pods'].includes(shape)) {
      return { ok: false, error: 'shape must be grid, u_shape, or group_pods.' };
    }
    if (!rows || rows < 1 || !cols || cols < 1) {
      return { ok: false, error: 'rows and cols must each be at least 1.' };
    }
    const normalizedPreset = ['traditional', 'center_aisle', 'double_aisle'].includes(preset)
      ? preset : 'traditional';
    if (shape === 'grid' && normalizedPreset === 'center_aisle' && cols < 2) {
      return { ok: false, error: 'Center Aisle Split needs at least 2 columns.' };
    }
    if (shape === 'grid' && normalizedPreset === 'double_aisle' && cols < 3) {
      return { ok: false, error: 'Double Aisle Split needs at least 3 columns.' };
    }

    const { data, error } = await DBService.rpc('generate_room_blueprint', {
      p_layout_id: layoutId || null,
      p_class_id:  classId,
      p_name:      name || null,
      p_shape:     shape,
      p_rows:      rows,
      p_cols:      cols,
      p_spacing:   spacing || 80,
      p_preset:    normalizedPreset,
    });

    if (error) {
      console.error('[ClassroomService] generateBlueprint failed:', error.message || error.code || error, error);
      return { ok: false, error: error.message || 'Could not generate blueprint.' };
    }

    const layout = _mapLayout(data.layout);
    const generatedSeats = (data.generated_seats || []).map(_mapSeat);

    AppStore.updateState(draft => {
      _upsertLayout(draft, layout);
      // Merge: keep whatever locked seats already exist in this slice for
      // the layout (the RPC didn't touch them), replace everything else
      // with the freshly generated unlocked seats.
      if (!Array.isArray(draft.seats)) draft.seats = [];
      const lockedExisting = draft.seats.filter(s => s.layoutId === layout.id && s.isLocked);
      draft.seats = draft.seats.filter(s => s.layoutId !== layout.id);
      draft.seats.push(...lockedExisting, ...generatedSeats);

      // Prune assignments for any seat that no longer exists in this layout
      // (mirrors saveLayout()'s reconciliation — deleted unlocked seats
      // cascade-deleted their assignment row server-side too).
      if (Array.isArray(draft.seatAssignments)) {
        const validSeatIds = new Set(draft.seats.filter(s => s.layoutId === layout.id).map(s => s.id));
        draft.seatAssignments = draft.seatAssignments.filter(
          a => a.layoutId !== layout.id || validSeatIds.has(a.seatId)
        );
      }
    }, { type: 'classroom:blueprint-generated', payload: { layoutId: layout.id, shape, rows, cols } });

    return {
      ok: true,
      layoutId: layout.id,
      generatedSeats,
      preservedLockedCount: data.preserved_locked_count || 0,
    };
  }

  /**
   * manualMoveStudent(studentId, targetSeatId, layoutId)
   *   → Promise<{ ok, error?, affected?, swapped? }>
   *
   * THE single entry point for every manual sidebar/canvas interaction:
   *   • sidebar → empty seat:        manualMoveStudent(sid, seatId, layoutId)
   *   • assigned seat → sidebar:     manualMoveStudent(sid, null,   layoutId)   (evict)
   *   • seat A → occupied seat B:    manualMoveStudent(sid, seatId, layoutId)   (auto-swap)
   *
   * The server resolves which case applies (it already knows where, if
   * anywhere, studentId currently sits) and does it atomically — the client
   * never needs to pre-compute swap-vs-move-vs-evict itself.
   *
   * NOTE ON LOCKING: this call is intentionally allowed to target a locked
   * seat. Locking protects a seat from *automated* re-shuffles
   * (generateBlueprint's regen step, autoAllocateRemaining) — it is not a
   * "freeze forever" flag, so a teacher's deliberate manual drag still
   * works on a locked seat. If you want locked seats to also reject manual
   * moves, check seat.isLocked client-side before calling this and surface
   * that as a UI affordance (e.g. disable dragging onto locked seats),
   * rather than baking a hard refusal into the RPC.
   */
  async function manualMoveStudent(studentId, targetSeatId, layoutId) {
    if (!studentId || !layoutId) {
      return { ok: false, error: 'studentId and layoutId are required.' };
    }

    const assignedBy = (typeof currentUser !== 'undefined' && currentUser)
      ? currentUser.id : null;

    const { data, error } = await DBService.rpc('manual_move_student', {
      p_student_id:      studentId,
      p_target_seat_id:  targetSeatId || null,
      p_layout_id:       layoutId,
      p_assigned_by:     assignedBy,
    });

    if (error) {
      console.error('[ClassroomService] manualMoveStudent failed:', error.message || error.code || error, error);
      return { ok: false, error: error.message || 'Could not move student.' };
    }

    AppStore.updateState(draft => {
      _applyAffected(draft, data.affected, layoutId);
    }, {
      type: 'classroom:manual-move',
      payload: { studentId, targetSeatId, layoutId, swapped: !!data.swapped },
    });

    return { ok: true, affected: data.affected, swapped: !!data.swapped, note: data.note || null };
  }

  /**
   * autoAllocateRemaining(layoutId, unassignedStudentIds, strategy)
   *   → Promise<{ ok, error?, affected?, placedCount?, unplacedRemaining? }>
   *
   * HYBRID AUTOMATION. Fills every seat that is BOTH unlocked AND currently
   * empty, using students from the sidebar's unassigned pool. Already-seated
   * students (locked seat or not) are left exactly where they are — this is
   * "fill the gaps," not "reshuffle everyone."
   *
   * strategy: 'alphabetical' | 'random'. The ordering/shuffling happens
   * server-side so the result is authoritative and matches what gets
   * persisted (no client-side Math.random() that could disagree with the DB).
   *
   * unassignedStudentIds should be the sidebar's current "Unassigned" list
   * (e.g. from the same selector the UI uses to render the pool) — the RPC
   * re-validates against seat_assignments anyway, so a slightly stale list
   * is safe, just potentially a no-op for already-placed ids.
   */
  async function autoAllocateRemaining(layoutId, unassignedStudentIds, strategy) {
    if (!layoutId) return { ok: false, error: 'layoutId is required.' };
    if (!Array.isArray(unassignedStudentIds) || unassignedStudentIds.length === 0) {
      return { ok: false, error: 'unassignedStudentIds must be a non-empty array.' };
    }
    const normalizedStrategy = strategy === 'random' ? 'random' : 'alphabetical';

    const assignedBy = (typeof currentUser !== 'undefined' && currentUser)
      ? currentUser.id : null;

    const { data, error } = await DBService.rpc('auto_allocate_remaining', {
      p_layout_id:   layoutId,
      p_student_ids: unassignedStudentIds,
      p_strategy:    normalizedStrategy,
      p_assigned_by: assignedBy,
    });

    if (error) {
      console.error('[ClassroomService] autoAllocateRemaining failed:', error.message || error.code || error, error);
      return { ok: false, error: error.message || 'Could not auto-allocate seats.' };
    }

    AppStore.updateState(draft => {
      _applyAffected(draft, data.affected, layoutId);
    }, {
      type: 'classroom:auto-allocate',
      payload: { layoutId, strategy: normalizedStrategy, placedCount: data.placed_count || 0 },
    });

    return {
      ok: true,
      affected: data.affected,
      placedCount: data.placed_count || 0,
      unplacedRemaining: data.unplaced_remaining || 0,
    };
  }

  /**
   * setSeatLock(seatId, layoutId, isLocked) → Promise<{ ok, error? }>
   *
   * Toggles the is_locked flag. Does not move or affect any student —
   * purely metadata. UI should call this from a lock icon on the seat,
   * separate from drag-and-drop.
   */
  async function setSeatLock(seatId, layoutId, isLocked) {
    if (!seatId || !layoutId) {
      return { ok: false, error: 'seatId and layoutId are required.' };
    }

    const { data, error } = await DBService.rpc('set_seat_lock', {
      p_seat_id:   seatId,
      p_is_locked: !!isLocked,
    });

    if (error) {
      console.error('[ClassroomService] setSeatLock failed:', error.message || error.code || error, error);
      return { ok: false, error: error.message || 'Could not update seat lock.' };
    }

    const seat = _mapSeat(data);

    AppStore.updateState(draft => {
      if (!Array.isArray(draft.seats)) return;
      const idx = draft.seats.findIndex(s => s.id === seat.id);
      if (idx >= 0) draft.seats[idx] = seat;
    }, { type: 'classroom:seat-lock-toggled', payload: { seatId, layoutId, isLocked: !!isLocked } });

    return { ok: true, seat };
  }

  /**
   * markSeatOverlapFixed(layoutId) → Promise<{ ok, error? }>
   *
   * Permanently marks a layout as having passed through the one-time
   * seat-overlap auto-fix (report §1) — called by classroom_builder.js
   * exactly once per layout, whether or not the auto-fix actually moved
   * any seats. Never re-checked client-side afterward, so a teacher
   * intentionally re-packing seats tight later is left alone.
   */
  async function markSeatOverlapFixed(layoutId) {
    if (!layoutId) return { ok: false, error: 'layoutId is required.' };

    const { data, error } = await DBService.rpc('mark_seat_overlap_fixed', {
      p_layout_id: layoutId,
    });

    if (error) {
      console.error('[ClassroomService] markSeatOverlapFixed failed:', error.message || error.code || error, error);
      return { ok: false, error: error.message || 'Could not update layout.' };
    }

    const layout = _mapLayout(data);

    AppStore.updateState(draft => {
      _upsertLayout(draft, layout);
    }, { type: 'classroom:seat-overlap-fixed', payload: { layoutId } });

    return { ok: true, layout };
  }

  /**
   * deleteLayout(layoutId) → Promise<{ ok, error? }>
   */
  async function deleteLayout(layoutId) {
    if (!layoutId) return { ok: false, error: 'layoutId is required.' };

    const { error } = await DBService.rpc('delete_classroom_layout', {
      p_layout_id: layoutId,
    });

    if (error) {
      console.error('[ClassroomService] deleteLayout failed:', error.message || error.code || error, error);
      return { ok: false, error: error.message || 'Could not delete layout.' };
    }

    AppStore.updateState(draft => {
      if (Array.isArray(draft.classroomLayouts)) {
        draft.classroomLayouts = draft.classroomLayouts.filter(l => l.id !== layoutId);
      }
      if (Array.isArray(draft.seats)) {
        draft.seats = draft.seats.filter(s => s.layoutId !== layoutId);
      }
      if (Array.isArray(draft.seatAssignments)) {
        draft.seatAssignments = draft.seatAssignments.filter(a => a.layoutId !== layoutId);
      }
    }, { type: 'classroom:layout-deleted', payload: { layoutId } });

    return { ok: true };
  }

  /**
   * getLiveSeatingMap(classId, layoutId, logDate?)
   *   → Array<SeatViewModel>
   *
   * Pure selector — NO network call, NO side effects.
   * Joins classroomLayouts + seats + seatAssignments + attendanceLogs (Phase 1)
   * into a flat array the builder UI can render directly.
   *
   * SeatViewModel: {
   *   seatId, layoutId, xCoord, yCoord, rotation, label,
   *   studentId, studentName, studentInit, studentColor, studentPhoto,
   *   attendanceStatus,  // 'Early'|'On Time'|'Late'|'Absent'|'Excused'|null
   *   color: { bg, border, label }  // ready-to-apply CSS values
   * }
   *
   * The 'color' field is computed as:
   *   • If no student assigned → STATUS_COLOR['_empty']  (gray, dimmer)
   *   • If student assigned, has today's log → STATUS_COLOR[log.status]
   *   • If student assigned, no log yet → STATUS_COLOR['_no_log']  (gray)
   */
  function getLiveSeatingMap(classId, layoutId, logDate) {
    const state = AppStore.getState();
    // BUGFIX: was new Date().toISOString().slice(0,10) (UTC date) — see
    // utils.js isoDate() for why that's 8 hours off from Manila time.
    const today = logDate || isoDate();

    // Find the requested layout.
    const layout = (state.classroomLayouts || []).find(
      l => l.id === layoutId && l.classId === classId
    );
    if (!layout) return [];

    const seats       = (state.seats             || []).filter(s => s.layoutId === layoutId);
    const assignments = (state.seatAssignments   || []).filter(a => a.layoutId === layoutId);
    const students    = (state.students           || []);
    const logs        = (state.attendanceLogs     || []).filter(l => l.classId === classId && l.logDate === today);

    // Index by id for O(1) lookups.
    const assignmentBySeatId = Object.fromEntries(assignments.map(a => [a.seatId, a]));
    const studentById        = Object.fromEntries(students.map(s => [s.id, s]));
    const logByStudentId     = Object.fromEntries(logs.map(l => [l.studentId, l]));

    return seats.map(seat => {
      const assignment = assignmentBySeatId[seat.id];
      const student    = assignment ? studentById[assignment.studentId] : null;
      const log        = student ? logByStudentId[student.id] : null;

      let colorKey;
      if (!student)    colorKey = '_empty';
      else if (!log)   colorKey = '_no_log';
      else             colorKey = log.status;

      return {
        seatId:            seat.id,
        layoutId:          seat.layoutId,
        xCoord:            seat.xCoord,
        yCoord:            seat.yCoord,
        rotation:          seat.rotation,
        label:             seat.label,
        isLocked:          !!seat.isLocked,
        studentId:         student ? student.id     : null,
        studentName:       student ? (student.name || student.displayName) : null,
        studentInit:       student ? student.init   : null,
        studentColor:      student ? student.color  : null,
        studentPhoto:      student ? student.profilePic : null,
        attendanceStatus:  log    ? log.status      : null,
        color:             STATUS_COLOR[colorKey] || STATUS_COLOR['_empty'],
      };
    });
  }

  /**
   * getLayoutsForClass(classId) → Array<Layout>
   * Synchronous selector — returns layouts for the given class from AppStore.
   */
  function getLayoutsForClass(classId) {
    return AppStore.getSlice(s =>
      (s.classroomLayouts || []).filter(l => l.classId === classId)
    );
  }

  /**
   * duplicateSeats(seats, offset = 30) → Array<Seat>
   *
   * PURE, CLIENT-SIDE, NO RPC. Clones a list of local seat objects (the
   * builder's in-memory _cbLocalSeats entries for the currently-selected
   * seats), assigns each a fresh client-side temp id, and nudges its
   * coordinates by `offset` px on both axes so the copies don't render
   * exactly on top of the originals.
   *
   * Deliberately does NOT touch AppStore or Supabase — per the spec this is
   * a lightweight canvas-only mechanic. The clones only become durable when
   * the teacher calls saveLayout() (the existing Save button), exactly like
   * any other manually-added seat. isLocked is always reset to false on the
   * clone — duplicating a locked seat shouldn't silently lock the copy too.
   */
  function duplicateSeats(seats, offset) {
    const delta = (typeof offset === 'number' && !isNaN(offset)) ? offset : 30;
    return (seats || []).map(s => ({
      id:        'new_' + Math.random().toString(36).slice(2, 11),
      xCoord:    s.xCoord + delta,
      yCoord:    s.yCoord + delta,
      rotation:  s.rotation || 0,
      label:     s.label || null,
      isLocked:  false,
      studentId: null, // a duplicated seat is always unoccupied — copying a
                        // student's seat assignment would put them in two
                        // seats at once, which violates the one-seat rule.
    }));
  }

  /**
   * getColdCallCandidates(classId, layoutId, logDate?) → Array<SeatViewModel>
   *
   * Selector backing the Live Monitor's "Pick Random Student" button.
   * Returns ONLY seats where:
   *   1. a student is currently assigned, AND
   *   2. that student's today's attendance status is 'Early', 'On Time',
   *      or 'Late' — i.e. physically in the room. Absent and Excused
   *      students, and empty seats, are excluded entirely, matching the
   *      spec's "must completely skip empty seats, absent students, or
   *      excused students" rule.
   *
   * Reuses getLiveSeatingMap() rather than re-deriving the join, so the
   * monitor's notion of "who's present" can never drift from what the
   * canvas itself is showing.
   */
  function getColdCallCandidates(classId, layoutId, logDate) {
    const ELIGIBLE_STATUSES = ['Early', 'On Time', 'Late'];
    return getLiveSeatingMap(classId, layoutId, logDate).filter(
      vm => vm.studentId && ELIGIBLE_STATUSES.includes(vm.attendanceStatus)
    );
  }

  /**
   * pickRandomStudent(layoutId, strategy, targetedSeatIds) → {
   *   ok, error?, winner?, pool?, strategy?
   * }
   *
   * THE Advanced Cold Call Selector. Pure, synchronous, client-side — no
   * RPC, no AppStore write, exactly like getColdCallCandidates() and
   * duplicateSeats() above. classId is resolved internally from layoutId so
   * callers only ever need to pass (layoutId, strategy, targetedSeatIds),
   * matching the spec's signature exactly.
   *
   * strategy is one of:
   *   'pure_random'         — every present/late, assigned seat is eligible
   *                            (the whole getColdCallCandidates() pool).
   *   'least_participative' — narrows that pool to whichever student(s)
   *                            have the FEWEST combined recitationLog +
   *                            pointLog entries — a COUNT of how many times
   *                            they've been logged at all (not a sum of
   *                            points; a -5 "Late to Class" entry and a +20
   *                            "Quiz — Perfect Score" entry each count as
   *                            one logged event). This is a hard filter
   *                            down to the tied-lowest group, then a random
   *                            pick within it — not a softer weighted bias
   *                            toward quiet students. That keeps "Pick
   *                            Random Student" feeling like a lottery (you
   *                            don't get the literal same kid every time
   *                            there's a tie) while still guaranteeing the
   *                            call goes to someone who's been logged the
   *                            least. The spec's own wording — "targeting
   *                            candidates with the lowest metric counts" —
   *                            reads as a filter, not a weight; if a softer
   *                            weighted-toward-quiet-students curve is
   *                            wanted instead, this is the one block to
   *                            change.
   *   'spatial_block'        — restricted ENTIRELY to candidates whose
   *                            seatId is in targetedSeatIds (the seats the
   *                            teacher highlighted on the Live Monitor
   *                            canvas). An empty intersection is an error,
   *                            never a silent fallback to the full pool —
   *                            "only these seats" has to mean only these
   *                            seats. Any unrecognized strategy string
   *                            falls back to 'pure_random', mirroring how
   *                            autoAllocateRemaining() above normalizes its
   *                            own strategy parameter.
   *   'late_only'            — narrows the pool to students whose today's
   *                            attendanceStatus is exactly 'Late'. Early and
   *                            On Time students are otherwise-eligible but
   *                            excluded here on purpose — this mode exists
   *                            specifically to call on latecomers, not
   *                            "anyone who isn't absent." An empty result
   *                            (nobody logged Late yet) is an error, same
   *                            treatment as spatial_block's empty intersection.
   *
   * Returns BOTH `winner` (a single SeatViewModel, same shape as a
   * getColdCallCandidates() entry) AND `pool` (the array it was actually
   * drawn from, after strategy filtering) — the Live Monitor uses `pool` to
   * drive its cycling/flicker animation across the correct strategy-scoped
   * subset, then lands on `winner` directly, so there's exactly one random
   * decision per roll, not a second one hiding at reveal time.
   */
  function pickRandomStudent(layoutId, strategy, targetedSeatIds) {
    if (!layoutId) return { ok: false, error: 'layoutId is required.' };

    const state  = AppStore.getState();
    const layout = (state.classroomLayouts || []).find(l => l.id === layoutId);
    if (!layout) return { ok: false, error: 'Unknown layoutId.' };

    const normalizedStrategy = ['pure_random', 'least_participative', 'spatial_block', 'late_only'].includes(strategy)
      ? strategy : 'pure_random';
    const targetIds = Array.isArray(targetedSeatIds) ? targetedSeatIds : [];

    let pool = getColdCallCandidates(layout.classId, layoutId);

    if (normalizedStrategy === 'spatial_block') {
      const targetSet = new Set(targetIds);
      pool = pool.filter(vm => targetSet.has(vm.seatId));
      if (pool.length === 0) {
        return {
          ok: false,
          error: targetSet.size === 0
            ? 'Select at least one seat to roll among first.'
            : 'None of the targeted seats currently have a present or late student in them.',
        };
      }
    } else if (normalizedStrategy === 'late_only') {
      pool = pool.filter(vm => vm.attendanceStatus === 'Late');
      if (pool.length === 0) {
        return { ok: false, error: 'No students are currently marked Late.' };
      }
    } else if (pool.length === 0) {
      return { ok: false, error: 'No present or late students are currently seated.' };
    }

    if (normalizedStrategy === 'least_participative') {
      const recitationLog = state.recitationLog || [];
      const pointLog       = state.pointLog || [];
      const countByStudent = {};
      pool.forEach(vm => {
        const recCount = recitationLog.filter(r => r.studentId === vm.studentId).length;
        const ptCount  = pointLog.filter(p => p.studentId === vm.studentId).length;
        countByStudent[vm.studentId] = recCount + ptCount;
      });
      const minCount = Math.min.apply(null, pool.map(vm => countByStudent[vm.studentId]));
      pool = pool.filter(vm => countByStudent[vm.studentId] === minCount);
    }

    const winner = pool[Math.floor(Math.random() * pool.length)];
    return { ok: true, winner, pool, strategy: normalizedStrategy };
  }

  /**
   * getUnassignedStudents(classId, layoutId) → Array<Student>
   *
   * Pure selector backing the "Unassigned Students" sidebar pool. A student
   * is unassigned if they belong to classId and have no seat_assignments
   * row for this specific layoutId (a student can be unassigned in Layout B
   * while seated in Layout A — assignments are per-layout, not global).
   */
  function getUnassignedStudents(classId, layoutId) {
    const state = AppStore.getState();
    const students   = (state.students || []).filter(s => (s.classId || 'default-class') === classId);
    const assignments = (state.seatAssignments || []).filter(a => a.layoutId === layoutId);
    const assignedSet = new Set(assignments.map(a => a.studentId));
    return students.filter(s => !assignedSet.has(s.id));
  }

  /**
   * STATUS_COLORS — exposed so the UI can build a legend without re-deriving.
   */
  const STATUS_COLORS = STATUS_COLOR;

  return {
    saveLayout,
    assignStudentToSeat,
    generateBlueprint,
    manualMoveStudent,
    autoAllocateRemaining,
    setSeatLock,
    markSeatOverlapFixed,
    deleteLayout,
    getLiveSeatingMap,
    getLayoutsForClass,
    getUnassignedStudents,
    duplicateSeats,
    getColdCallCandidates,
    pickRandomStudent,
    STATUS_COLORS,
  };
}());

console.log('[EduQuest] classroom/classroom-service.js loaded — ClassroomService registered.');
