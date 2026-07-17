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
//    draft.attendanceSchedules  [{ id, classId, dayOfWeek, openTime, startTime, lateCutoff,
//                                   closeTime, active }]
//      dayOfWeek (Phase 54): 0 = default/whole-week row, 1..7 = ISO-weekday
//      (Mon..Sun) override — up to 8 rows per classId now, not exactly 1.
//      Use AttendanceService.getEffectiveSchedule(classId) to resolve
//      "which one applies today" instead of a raw .find(classId===...).
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
   * upsertSchedule(classId, { openTime, startTime, lateCutoff, closeTime }, dayOfWeek?, dayOff?) → Promise<{ok, error?, schedule?}>
   * Times are 'HH:MM' or 'HH:MM:SS' strings (Postgres `time` accepts both).
   * dayOfWeek (Phase 54): 0 (default, applies every day unless overridden —
   * this is also the implicit value when omitted, so every pre-Phase-54
   * call site keeps writing the whole-week row exactly as before) or 1..7
   * (ISO weekday override, 1=Monday..7=Sunday).
   * dayOff (Phase 55): true marks that weekday as having NO class at all —
   * only valid alongside a real dayOfWeek (1..7), never the default. Prefer
   * setDayOff() below for that case; this still accepts it directly for
   * symmetry with the RPC.
   */
  async function upsertSchedule(classId, times, dayOfWeek, dayOff) {
    const { openTime, startTime, lateCutoff, closeTime } = times || {};
    const dow = (dayOfWeek === undefined || dayOfWeek === null) ? 0 : dayOfWeek;
    const isDayOff = !!dayOff;
    if (!classId || !openTime || !startTime || !lateCutoff || !closeTime) {
      return { ok: false, error: 'classId, openTime, startTime, lateCutoff, and closeTime are all required.' };
    }

    const { data, error } = await DBService.rpc('upsert_attendance_schedule', {
      p_class_id: classId, p_open_time: openTime, p_start_time: startTime,
      p_late_cutoff: lateCutoff, p_close_time: closeTime, p_day_of_week: dow, p_day_off: isDayOff,
    });
    if (error) {
      console.error('[AttendanceService] upsertSchedule failed:', error);
      return { ok: false, error: error.message || 'Could not save schedule.' };
    }

    AppStore.updateState(draft => {
      if (!Array.isArray(draft.attendanceSchedules)) draft.attendanceSchedules = [];
      const idx = draft.attendanceSchedules.findIndex(s => s.classId === classId && (s.dayOfWeek || 0) === dow);
      const row = {
        id: data.id, classId: data.class_id, dayOfWeek: data.day_of_week ?? dow, dayOff: !!data.day_off,
        openTime: data.open_time, startTime: data.start_time, lateCutoff: data.late_cutoff,
        closeTime: data.close_time, active: data.active,
      };
      if (idx >= 0) draft.attendanceSchedules[idx] = row; else draft.attendanceSchedules.push(row);
    }, { type: 'attendance:schedule-updated', payload: { classId, dayOfWeek: dow, dayOff: isDayOff } });

    return { ok: true, schedule: data };
  }

  /**
   * setDayOff(classId, dayOfWeek) → Promise<{ok, error?, schedule?}>
   * Marks one weekday (1..7) as "no class at all" — distinct from simply
   * not overriding it (which inherits the default schedule instead). The
   * stored times are a placeholder (00:00 all the way through); nothing
   * reads them once dayOff is true.
   */
  async function setDayOff(classId, dayOfWeek) {
    if (!dayOfWeek || dayOfWeek < 1 || dayOfWeek > 7) {
      return { ok: false, error: 'dayOfWeek must be between 1 (Monday) and 7 (Sunday).' };
    }
    return upsertSchedule(classId, { openTime: '00:00', startTime: '00:00', lateCutoff: '00:00', closeTime: '00:00' }, dayOfWeek, true);
  }

  /**
   * clearScheduleOverride(classId, dayOfWeek) → Promise<{ok, error?, removed?}>
   * Deletes ONE day's override row (dayOfWeek 1..7 only — the default row
   * at 0 isn't a valid target) so that day falls back to the default
   * schedule again. Section Maker calls this when a teacher turns a day's
   * "different schedule" toggle back off.
   */
  async function clearScheduleOverride(classId, dayOfWeek) {
    if (!classId) return { ok: false, error: 'classId is required.' };
    if (!dayOfWeek || dayOfWeek < 1 || dayOfWeek > 7) {
      return { ok: false, error: 'dayOfWeek must be between 1 (Monday) and 7 (Sunday).' };
    }

    const { data, error } = await DBService.rpc('clear_attendance_schedule_override', {
      p_class_id: classId, p_day_of_week: dayOfWeek,
    });
    if (error) {
      console.error('[AttendanceService] clearScheduleOverride failed:', error);
      return { ok: false, error: error.message || 'Could not clear that day\'s override.' };
    }

    AppStore.updateState(draft => {
      draft.attendanceSchedules = (draft.attendanceSchedules || [])
        .filter(s => !(s.classId === classId && (s.dayOfWeek || 0) === dayOfWeek));
    }, { type: 'attendance:schedule-override-cleared', payload: { classId, dayOfWeek } });

    return { ok: true, removed: !!data };
  }

  /**
   * getEffectiveSchedule(classId, opts) → schedule row | null
   * "Which window applies on this date" — that weekday's override row if
   * one exists and is active, else the default (dayOfWeek 0) row. Client-
   * side mirror of get_effective_attendance_schedule() (Phase 54) so the
   * kiosk countdown / Command Center don't need a round trip just to answer
   * a question the draft already has everything needed for.
   * opts: { date? } — a JS Date, defaults to right now (Asia/Manila).
   */
  function getEffectiveSchedule(classId, opts) {
    opts = opts || {};
    if (!classId) return null;
    const all = AppStore.getSlice(s => s.attendanceSchedules) || [];
    const mine = all.filter(s => s.classId === classId && s.active !== false);
    if (!mine.length) return null;

    const d = opts.date || new Date();
    // ISO weekday in Asia/Manila (1=Monday..7=Sunday), matching Postgres'
    // extract(isodow from date) used server-side.
    const manilaDowLabel = d.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', weekday: 'short' });
    const isoDow = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[manilaDowLabel] || 1;

    const override = mine.find(s => (s.dayOfWeek || 0) === isoDow);
    if (override) return override;
    return mine.find(s => (s.dayOfWeek || 0) === 0) || null;
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
    clearScheduleOverride,
    getEffectiveSchedule,
    processScan,
    overrideAttendance,
    closeAttendanceSession,
  };
}());

console.log('[EduQuest] attendance/attendance-service.js loaded — AttendanceService registered.');
