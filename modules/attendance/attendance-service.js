// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/attendance/attendance-service.js
//  Service Layer for Phase 1 RFID/NFC Attendance.
//
//  REPOSITORY PATTERN CONTRACT — read this before touching this file:
//    UI modules (att_scanner_rfid.js, att_editor.js, etc.) NEVER call
//    Supabase and NEVER mutate `DB`/AppStore state directly for anything in
//    this file's domain. They call AttendanceService.<method>(...).
//    AttendanceService is the ONLY thing in the codebase that:
//      a) calls DBService.rpc() for attendance_logs / rfid_cards /
//         attendance_schedules writes, and
//      b) calls AppStore.updateState() to reflect those writes into the
//         single source of truth.
//    AttendanceService never touches `window.supabase` or `client.from(...)`
//    directly — that boundary belongs to db-service.js alone. If you find
//    yourself wanting to import a Supabase client here, the right move is
//    to add a narrower DBService method instead, not to reach around this
//    file.
//
//  STATE SHAPE (slices populated by db-service.js → AppStore):
//    draft.rfidCards            [{ id, tagId, studentId, isActive, assignedAt, revokedAt }]
//    draft.attendanceSchedules  [{ id, classId, openTime, startTime, lateCutoff, closeTime, active }]
//    draft.attendanceLogs       [{ id, studentId, classId, logDate, status, scannedAt,
//                                   entryMethod, rfidTag, recordedBy, notes }]
//    draft.students[i].classId  (added in Phase 1; defaults to 'default-class')
//
//  OPTIMISTIC UPDATE STRATEGY
//    Every write below follows the same three-beat rhythm:
//      1. Call the authoritative RPC (DBService.rpc) and AWAIT it — RPCs are
//         the only place the Early/On Time/Late/Absent decision and the
//         one-row-per-student-per-day invariant are actually enforced, so
//         we cannot "optimistically" invent a result before the network
//         responds without risking it being wrong.
//      2. The instant the RPC resolves, apply ITS authoritative result into
//         AppStore.updateState() ourselves — this is what makes the UI feel
//         instant: we do NOT wait for the realtime echo (db-service.js's
//         `attendance_logs`/`rfid_cards` postgres_changes listener) to
//         update local state; we apply it the moment we have it.
//      3. The realtime listener in db-service.js is a backstop for OTHER
//         tabs/devices (and a safety net for our own tab if step 2 ever
//         disagrees with what eventually lands server-side) — it's not the
//         primary update path, just eventual-consistency insurance.
//    This is "optimistic" in the sense that the *local UI* never blocks on
//    a second round-trip after the RPC — not in the sense of guessing the
//    result before asking the server. For a 200-person line of students
//    tapping a badge at the door, guessing wrong and rolling back would be
//    worse than the RPC's normal latency.
// ═══════════════════════════════════════════════════════════════════════════════

window.AttendanceService = (function () {
  'use strict';

  /**
   * Upsert one attendance_logs row into draft.attendanceLogs (by id if
   * present, else by the student+class+day natural key) — shared by every
   * method below that needs to reflect an RPC's returned `log` object.
   */
  function _upsertLogIntoDraft(draft, log) {
    if (!log) return;
    if (!Array.isArray(draft.attendanceLogs)) draft.attendanceLogs = [];
    const idx = draft.attendanceLogs.findIndex(l =>
      (log.id && l.id === log.id) ||
      (l.studentId === log.studentId && l.classId === log.classId && l.logDate === log.logDate)
    );
    const row = {
      id: log.id, studentId: log.student_id || log.studentId,
      classId: log.class_id || log.classId, logDate: log.log_date || log.logDate,
      status: log.status, scannedAt: log.scanned_at || log.scannedAt,
      entryMethod: log.entry_method || log.entryMethod,
      rfidTag: log.rfid_tag ?? log.rfidTag ?? null,
      recordedBy: log.recorded_by ?? log.recordedBy ?? null,
      notes: log.notes ?? null,
    };
    if (idx >= 0) draft.attendanceLogs[idx] = row;
    else draft.attendanceLogs.unshift(row);
  }

  /**
   * assignCard(studentId, rfidTag) → Promise<{ok, error?, card?}>
   * Registers a card to a student, replacing any prior card on either side
   * of the binding (old card → inactive; tag's previous owner, if any →
   * inactive). See assign_rfid_card() in phase1_rfid_attendance.sql for the
   * actual atomicity guarantee — this method just calls it and reflects the
   * result.
   */
  async function assignCard(studentId, rfidTag) {
    const tagId = String(rfidTag || '').trim();
    if (!studentId || !tagId) {
      return { ok: false, error: 'Student and card tag are both required.' };
    }

    const { data, error } = await DBService.rpc('assign_rfid_card', {
      p_student_id: studentId, p_tag_id: tagId,
    });
    if (error) {
      console.error('[AttendanceService] assignCard failed:', error);
      return { ok: false, error: error.message || 'Could not assign card.' };
    }

    AppStore.updateState(draft => {
      if (!Array.isArray(draft.rfidCards)) draft.rfidCards = [];
      // Mirror exactly what the RPC did server-side: deactivate this
      // student's old card and this tag's old owner, then add the new row.
      draft.rfidCards.forEach(c => {
        if ((c.studentId === studentId || c.tagId === tagId) && c.isActive && c.id !== data.id) {
          c.isActive = false;
          c.revokedAt = new Date().toISOString();
        }
      });
      const idx = draft.rfidCards.findIndex(c => c.id === data.id);
      const row = {
        id: data.id, tagId: data.tag_id, studentId: data.student_id,
        isActive: data.is_active, assignedAt: data.assigned_at, revokedAt: data.revoked_at,
      };
      if (idx >= 0) draft.rfidCards[idx] = row; else draft.rfidCards.unshift(row);
    }, { type: 'attendance:card-assigned', payload: { studentId, tagId } });

    return { ok: true, card: data };
  }

  /**
   * assignStudentToClass(studentId, classId) → Promise<{ok, error?}>
   * Roster assignment — needed before closeAttendanceSession() can sweep a
   * class, since the sweep matches on profiles.class_id.
   */
  async function assignStudentToClass(studentId, classId) {
    if (!studentId || !classId) return { ok: false, error: 'Student and class are both required.' };

    const { error } = await DBService.rpc('set_student_class', {
      p_student_id: studentId, p_class_id: classId,
    });
    if (error) {
      console.error('[AttendanceService] assignStudentToClass failed:', error);
      return { ok: false, error: error.message || 'Could not update class assignment.' };
    }

    AppStore.updateState(draft => {
      const s = (draft.students || []).find(st => st.id === studentId);
      if (s) s.classId = classId;
    }, { type: 'attendance:student-class-changed', payload: { studentId, classId } });

    return { ok: true };
  }

  /**
   * upsertSchedule(classId, { openTime, startTime, lateCutoff, closeTime }) → Promise<{ok, error?, schedule?}>
   * Times are 'HH:MM' or 'HH:MM:SS' strings (Postgres `time` accepts both).
   */
  async function upsertSchedule(classId, times) {
    const { openTime, startTime, lateCutoff, closeTime } = times || {};
    if (!classId || !openTime || !startTime || !lateCutoff || !closeTime) {
      return { ok: false, error: 'classId, openTime, startTime, lateCutoff, and closeTime are all required.' };
    }

    const { data, error } = await DBService.rpc('upsert_attendance_schedule', {
      p_class_id: classId, p_open_time: openTime, p_start_time: startTime,
      p_late_cutoff: lateCutoff, p_close_time: closeTime,
    });
    if (error) {
      console.error('[AttendanceService] upsertSchedule failed:', error);
      return { ok: false, error: error.message || 'Could not save schedule.' };
    }

    AppStore.updateState(draft => {
      if (!Array.isArray(draft.attendanceSchedules)) draft.attendanceSchedules = [];
      const idx = draft.attendanceSchedules.findIndex(s => s.classId === classId);
      const row = {
        id: data.id, classId: data.class_id, openTime: data.open_time,
        startTime: data.start_time, lateCutoff: data.late_cutoff,
        closeTime: data.close_time, active: data.active,
      };
      if (idx >= 0) draft.attendanceSchedules[idx] = row; else draft.attendanceSchedules.push(row);
    }, { type: 'attendance:schedule-updated', payload: { classId } });

    return { ok: true, schedule: data };
  }

  /**
   * processScan(rfidTag, classId) → Promise<ScanResult>
   * The hot path called from the scanner UI on every badge tap. See the
   * file header for the optimistic-update rhythm. Returns a discriminated
   * result the UI renders directly — it never has to re-derive status text.
   *
   * ScanResult:
   *   { ok: true,  alreadyRecorded: boolean, studentId, status, studentName }
   *   { ok: false, error: 'unknown_card'|'no_schedule'|'not_open'|'closed'|string, message }
   */
  async function processScan(rfidTag, classId) {
    const tagId = String(rfidTag || '').trim();
    if (!tagId) return { ok: false, error: 'empty_scan', message: 'No card data received.' };
    if (!classId) return { ok: false, error: 'no_class', message: 'No class selected for this scanner.' };

    const { data, error } = await DBService.rpc('process_attendance_scan', {
      p_tag_id: tagId, p_class_id: classId,
    });

    if (error) {
      console.error('[AttendanceService] processScan RPC failed:', error);
      return { ok: false, error: 'network', message: error.message || 'Scan failed — try again.' };
    }
    if (!data || data.ok === false) {
      return { ok: false, error: (data && data.error) || 'unknown', message: (data && data.message) || 'Scan rejected.' };
    }

    AppStore.updateState(draft => {
      _upsertLogIntoDraft(draft, data.log);
      // BUGFIX (report §1): same recompute as overrideAttendance()/
      // closeAttendanceSession() — keeps the RFID hot path consistent so a
      // scanned student's attendance % updates immediately too, not just
      // manual overrides.
      const student = (draft.students || []).find(s => s.id === data.student_id);
      if (student) {
        recalcStudentStats(student, { attendanceLogs: draft.attendanceLogs });
        // FIX (Pending Fixes Report §3): persist the freshly-recomputed
        // attendance_pct via its own column-scoped RPC instead of letting it
        // ride the next debounced whole-roster bulk push — see utils.js.
        syncStudentDerivedStatsToServer(student.id, student.attendance, student.quizAvg);
      }
    }, { type: 'attendance:scan-recorded', payload: { studentId: data.student_id, status: data.status, alreadyRecorded: !!data.already_recorded } });

    const student = AppStore.getStudent(data.student_id);
    return {
      ok: true,
      alreadyRecorded: !!data.already_recorded,
      studentId: data.student_id,
      status: data.status,
      studentName: student ? (student.name || student.displayName) : data.student_id,
    };
  }

  /**
   * overrideAttendance(studentId, classId, status, opts) → Promise<{ok, error?, removed?, log?}>
   * status: 'Present' | 'Early' | 'On Time' | 'Late' | 'Absent' | 'Excused' | 'Remove'
   * ('Edit' isn't a distinct status — call this again with the corrected
   * status; the RPC upserts in place.)
   * opts: { logDate?: 'YYYY-MM-DD', notes?: string }
   */
  async function overrideAttendance(studentId, classId, status, opts) {
    opts = opts || {};
    if (!studentId || !classId || !status) {
      return { ok: false, error: 'studentId, classId, and status are all required.' };
    }
    const recordedBy = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;

    // NOTE: p_log_date must be OMITTED (not sent as null) when the caller
    // doesn't specify a date. The SQL function declares
    // `p_log_date date DEFAULT CURRENT_DATE`, but Postgres only applies a
    // parameter default when the argument is absent — PostgREST passing an
    // explicit `null` overrides that default and inserts a literal NULL,
    // which violates attendance_logs' NOT NULL constraint on log_date.
    const rpcParams = {
      p_student_id: studentId, p_class_id: classId, p_status: status,
      p_recorded_by: recordedBy, p_notes: opts.notes || null,
    };
    if (opts.logDate) rpcParams.p_log_date = opts.logDate;

    const { data, error } = await DBService.rpc('override_attendance', rpcParams);
    if (error) {
      console.error('[AttendanceService] overrideAttendance failed:', error);
      return { ok: false, error: error.message || 'Could not save override.' };
    }
    if (data && data.ok === false) {
      return { ok: false, error: data.message || 'Override rejected.' };
    }

    AppStore.updateState(draft => {
      if (data.removed) {
        // BUGFIX: was new Date().toISOString().slice(0,10) (UTC date) — see
        // utils.js isoDate() for why that's 8 hours off from Manila time.
        const logDate = opts.logDate || isoDate();
        draft.attendanceLogs = (draft.attendanceLogs || []).filter(l =>
          !(l.studentId === studentId && l.classId === classId && l.logDate === logDate)
        );
      } else {
        _upsertLogIntoDraft(draft, data.log);
      }
      // BUGFIX (report §1): recalcStudentStats() already knows how to derive
      // attendance % live from draft.attendanceLogs — it just was never
      // called after an override, so the Manual Override panel saved a real
      // log row but the student's displayed attendance total never moved.
      // Recompute it here, against the draft's just-updated logs, so the
      // change is reflected immediately (and persisted on the next sync).
      const student = (draft.students || []).find(s => s.id === studentId);
      if (student) {
        recalcStudentStats(student, { attendanceLogs: draft.attendanceLogs });
        // FIX (Pending Fixes Report §3): see processScan() above.
        syncStudentDerivedStatsToServer(student.id, student.attendance, student.quizAvg);
      }
    }, { type: 'attendance:override', payload: { studentId, classId, status } });

    return data.removed ? { ok: true, removed: true } : { ok: true, log: data.log };
  }

  /**
   * closeAttendanceSession(classId, logDate?) → Promise<{ok, error?, absencesRecorded?}>
   * Sweeps every student in `classId` (profiles.class_id) with no log row
   * yet for the day and marks them Absent. Optimistically reflects the
   * sweep into local state immediately using the roster AppStore already
   * has — the realtime listener will true this up to the exact server
   * rows within ~400ms, same backstop as everywhere else in this file.
   */
  async function closeAttendanceSession(classId, logDate) {
    if (!classId) return { ok: false, error: 'classId is required.' };
    // BUGFIX: was new Date().toISOString().slice(0,10) (UTC date) — see
    // utils.js isoDate() for why that's 8 hours off from Manila time.
    const day = logDate || isoDate();

    const { data, error } = await DBService.rpc('close_attendance_session', {
      p_class_id: classId, p_log_date: day,
    });
    if (error) {
      console.error('[AttendanceService] closeAttendanceSession failed:', error);
      return { ok: false, error: error.message || 'Could not close session.' };
    }

    AppStore.updateState(draft => {
      if (!Array.isArray(draft.attendanceLogs)) draft.attendanceLogs = [];
      const already = new Set(
        draft.attendanceLogs
          .filter(l => l.classId === classId && l.logDate === day)
          .map(l => l.studentId)
      );
      const sweptStudentIds = [];
      (draft.students || [])
        .filter(s => (s.classId || 'default-class') === classId && !already.has(s.id))
        .forEach(s => {
          draft.attendanceLogs.unshift({
            id: null, studentId: s.id, classId, logDate: day, status: 'Absent',
            scannedAt: new Date().toISOString(), entryMethod: 'Manual',
            rfidTag: null, recordedBy: null, notes: null,
          });
          sweptStudentIds.push(s.id);
        });
      // BUGFIX (report §1): recompute the swept students' attendance % now
      // that they each have a fresh Absent row — see the matching note in
      // overrideAttendance() above.
      sweptStudentIds.forEach(id => {
        const student = (draft.students || []).find(s => s.id === id);
        if (student) {
          recalcStudentStats(student, { attendanceLogs: draft.attendanceLogs });
          // FIX (Pending Fixes Report §3): see processScan() above.
          syncStudentDerivedStatsToServer(student.id, student.attendance, student.quizAvg);
        }
      });
    }, { type: 'attendance:session-closed', payload: { classId, logDate: day, absencesRecorded: data.absences_recorded } });

    return { ok: true, absencesRecorded: data.absences_recorded };
  }

  return {
    assignCard,
    assignStudentToClass,
    upsertSchedule,
    processScan,
    overrideAttendance,
    closeAttendanceSession,
  };
}());

console.log('[EduQuest] attendance/attendance-service.js loaded — AttendanceService registered.');
