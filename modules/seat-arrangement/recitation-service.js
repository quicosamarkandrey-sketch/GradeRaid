// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/seat-arrangement/recitation-service.js
//  Service Layer for Phase 3 Recitation Command Center (Live Classroom
//  Monitor / Device 2 — Teacher Desk).
//
//  REPOSITORY PATTERN CONTRACT — same as attendance-service.js / classroom-service.js:
//    UI modules (live_monitor.js) NEVER call Supabase and NEVER mutate
//    `DB`/AppStore state directly for anything in this file's domain. They
//    call RecitationService.<method>(...). RecitationService is the ONLY
//    thing that:
//      a) calls DBService.rpc() for recitation_log writes, and
//      b) calls AppStore.updateState() to reflect those writes into the
//         single source of truth (draft.recitationLog).
//    RecitationService never touches `window.supabase` or `client.from(...)`
//    directly — that boundary belongs to db-service.js alone.
//
//  REUSES THE EXISTING recitation_log TABLE — DOES NOT FORK IT
//    public.recitation_log already exists (Wave 1) and is already written to
//    by modules/recitation/logger.js via the legacy bulk-upsert path, and
//    read by modules/recitation/progress.js, modules/achievements/ach_engine.js,
//    modules/leaderboard/eql-engine.js, and — critically —
//    ClassroomService.pickRandomStudent()'s 'least_participative' strategy,
//    which counts ALL entries in state.recitationLog regardless of class.
//    Phase 3 only ADDS a nullable class_id column (see
//    supabase/phase3_recitation_command_center.sql) and two RPCs. Every
//    entry this service writes lands in the exact same
//    AppStore.getState().recitationLog array everyone else already reads —
//    it just also carries a classId + a real createdAt timestamp, which is
//    what session-scoping below is built on.
//
//  "CURRENT ACTIVE SESSION" — HOW IT'S SCOPED
//    There's no session_id column and this migration deliberately doesn't
//    add one. A "session" is just: entries where classId matches the class
//    the Live Monitor currently has open, AND createdAt >= the moment the
//    teacher pressed "Start Recitation Session" (tracked client-side in
//    live_monitor.js, passed into the selectors below). Closing/reopening
//    the session is just moving that timestamp forward; history isn't lost,
//    it just falls outside the window a session-scoped query is looking at.
//
//  OPTIMISTIC UPDATE STRATEGY (identical rhythm to AttendanceService)
//    1. Call the authoritative RPC and AWAIT it.
//    2. Apply ITS authoritative result into AppStore.updateState() ourselves
//       the instant it resolves — the UI does not wait for the realtime echo.
//    3. db-service.js's `recitation_log` postgres_changes listener is a
//       backstop for other devices/tabs, not the primary update path.
//
//  SCANNER DEBOUNCE
//    A 5-second cooldown per RFID tag, held in-memory here (not persisted —
//    it only needs to survive a few seconds, and only within this tab).
//    Manual awards are NEVER debounced — they're a deliberate teacher click,
//    not a hardware artifact of a card sitting too long on the reader.
// ═══════════════════════════════════════════════════════════════════════════════

window.RecitationService = (function () {
  'use strict';

  const SCAN_COOLDOWN_MS = 5000;
  const _lastScanAtByTag = new Map(); // tagId -> epoch ms of last accepted scan

  // ── Internal: map an RPC's returned row into the camelCase AppStore shape,
  //    then upsert it into draft.recitationLog by id. Mirrors
  //    attendance-service.js's _upsertLogIntoDraft() exactly. ─────────────────
  function _upsertIntoDraft(draft, row) {
    if (!row) return null;
    if (!Array.isArray(draft.recitationLog)) draft.recitationLog = [];
    const mapped = {
      id:        row.id,
      studentId: row.student_id ?? row.studentId,
      classId:   row.class_id ?? row.classId ?? null,
      pts:       row.pts,
      note:      row.note ?? null,
      when:      row.when_label ?? row.when ?? 'Just now',
      createdAt: row.created_at ?? row.createdAt ?? new Date().toISOString(),
    };
    const idx = draft.recitationLog.findIndex(r => r.id === mapped.id);
    if (idx >= 0) draft.recitationLog[idx] = mapped;
    else draft.recitationLog.unshift(mapped);
    return mapped;
  }

  // ── BUGFIX (report §1) ──────────────────────────────────────────────────
  // Manual Award / Scanner B taps used to insert a recitation_log row and
  // stop there — nothing ever added those points back into student.xp, so
  // every screen reading the cached total (admin roster, analytics, home
  // dashboard) kept showing 0. supabase/phase5_bugfix_pack.sql adds a
  // database trigger that does this authoritatively server-side; this
  // helper mirrors that same +pts/-pts locally so the UI updates the
  // instant the RPC resolves instead of waiting for the next full reload —
  // same "apply the authoritative result immediately" rhythm every other
  // method in this file already follows for its own domain.
  function _bumpCachedXp(draft, studentId, delta) {
    if (!studentId || !delta) return;
    const student = (draft.students || []).find(s => s.id === studentId);
    if (student) student.xp = Math.max(0, (student.xp || 0) + delta);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * canScanTag(tagId) → boolean
   * Pure read of the debounce state — lets the UI decide whether to even
   * flash a "cooling down" message before calling processScannerTap().
   */
  function canScanTag(tagId) {
    const last = _lastScanAtByTag.get(tagId);
    return !last || (Date.now() - last) >= SCAN_COOLDOWN_MS;
  }

  /**
   * processScannerTap(tagId, classId) → Promise<{ok, error?, log?, studentId?}>
   *
   * The Scanner B hot path: resolves the tag to a student via the existing
   * rfidCards slice (populated by AttendanceService's domain, read-only
   * here — same read-only cross-reference getLiveSeatingMap() already does
   * against attendanceLogs), enforces the 5s cooldown, then awards exactly
   * 1 point. Scanner taps are always worth 1 point by design — this is what
   * the "+1" floating animation (Task 4) is always animating; if a scan
   * should ever be worth something else, that's what Manual Award is for.
   */
  async function processScannerTap(tagId, classId) {
    const tag = String(tagId || '').trim();
    if (!tag) return { ok: false, error: 'Empty scan.' };

    if (!canScanTag(tag)) {
      return { ok: false, error: 'cooldown', cooldown: true };
    }

    const state = AppStore.getState();
    const card = (state.rfidCards || []).find(c => c.tagId === tag && c.isActive);
    if (!card) {
      return { ok: false, error: 'This card is not registered to any student.' };
    }

    // Mark the cooldown BEFORE awaiting the RPC — two taps of the same
    // physical card 50ms apart (bounce, or a kid holding it on the reader)
    // must not both slip through while the first one is still in flight.
    _lastScanAtByTag.set(tag, Date.now());

    const { data, error } = await DBService.rpc('log_recitation_point', {
      p_student_id: card.studentId, p_class_id: classId, p_points: 1,
      p_note: null, p_source: 'scan',
    });
    if (error) {
      console.error('[RecitationService] processScannerTap failed:', error);
      return { ok: false, error: error.message || 'Could not log the scan.' };
    }

    let mapped = null;
    AppStore.updateState(draft => {
      mapped = _upsertIntoDraft(draft, data);
      if (mapped) _bumpCachedXp(draft, mapped.studentId, mapped.pts);
    }, { type: 'recitation:point-logged', payload: { studentId: card.studentId, classId, source: 'scan' } });

    return { ok: true, log: mapped, studentId: card.studentId };
  }

  /**
   * manualAward(studentId, classId, points, note?) → Promise<{ok, error?, log?}>
   * Sidebar "Manual Award Panel" — for a lost/forgotten RFID card, or
   * awarding a point value other than the scanner's fixed +1. Never
   * debounced: a teacher tapping this button twice on purpose means two
   * awards.
   */
  async function manualAward(studentId, classId, points, note) {
    if (!studentId) return { ok: false, error: 'A student is required.' };
    const pts = parseInt(points, 10);
    if (!Number.isFinite(pts) || pts === 0) {
      return { ok: false, error: 'Points must be a non-zero number.' };
    }

    const { data, error } = await DBService.rpc('log_recitation_point', {
      p_student_id: studentId, p_class_id: classId, p_points: pts,
      p_note: (note || '').trim() || null, p_source: 'manual',
    });
    if (error) {
      console.error('[RecitationService] manualAward failed:', error);
      return { ok: false, error: error.message || 'Could not award points.' };
    }

    let mapped = null;
    AppStore.updateState(draft => {
      mapped = _upsertIntoDraft(draft, data);
      if (mapped) _bumpCachedXp(draft, mapped.studentId, mapped.pts);
    }, { type: 'recitation:point-logged', payload: { studentId, classId, source: 'manual' } });

    return { ok: true, log: mapped };
  }

  /**
   * undoRecitation(logId) → Promise<{ok, error?}>
   * Deletes a specific log entry (server-authoritative — the row is gone
   * from Postgres, not just hidden) and reverts the optimistic UI state by
   * removing it from draft.recitationLog. Every downstream selector
   * (session badge, session feed, pickRandomStudent's least_participative
   * count) re-derives from that array, so nothing else needs to know an
   * undo happened.
   */
  async function undoRecitation(logId) {
    if (!logId) return { ok: false, error: 'logId is required.' };

    const { data, error } = await DBService.rpc('undo_recitation_log', { p_log_id: logId });
    if (error) {
      console.error('[RecitationService] undoRecitation failed:', error);
      return { ok: false, error: error.message || 'Could not undo that entry.' };
    }
    if (!data) {
      return { ok: false, error: 'That entry was already removed.' };
    }

    AppStore.updateState(draft => {
      if (!Array.isArray(draft.recitationLog)) return;
      const removed = draft.recitationLog.find(r => r.id === logId);
      draft.recitationLog = draft.recitationLog.filter(r => r.id !== logId);
      // Mirror the trigger's DELETE branch: undo reverses the xp it granted.
      if (removed) _bumpCachedXp(draft, removed.studentId, -(removed.pts || 0));
    }, { type: 'recitation:point-undone', payload: { logId } });

    return { ok: true };
  }

  // ── Selectors — pure, synchronous, same style as
  //    ClassroomService.getLiveSeatingMap()/getColdCallCandidates(). ─────────

  /**
   * getSessionEntries(classId, sessionStartAtISO) → Array<{id, studentId,
   *   classId, pts, note, when, createdAt}>
   * Every recitation_log entry for this class since the session started,
   * newest first. Backs the Sidebar's Recitation Feed.
   */
  function getSessionEntries(classId, sessionStartAtISO) {
    if (!classId || !sessionStartAtISO) return [];
    const state = AppStore.getState();
    return (state.recitationLog || [])
      .filter(r => r.classId === classId && r.createdAt && r.createdAt >= sessionStartAtISO)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * getSessionCounts(classId, sessionStartAtISO) → { [studentId]: totalPts }
   * Backs the seat-card Live Counter Badge (Task 1). Sums points, not a raw
   * entry count — a student who earned +3 from one detailed answer and a
   * student who was tapped three times for +1 each both show "3".
   */
  function getSessionCounts(classId, sessionStartAtISO) {
    const counts = {};
    getSessionEntries(classId, sessionStartAtISO).forEach(r => {
      counts[r.studentId] = (counts[r.studentId] || 0) + (r.pts || 0);
    });
    return counts;
  }

  // Shared by getTodayTotalForStudent() below — same "what day is it in the
  // classroom" convention used server-side (attendance-service.js's RPCs
  // resolve 'today' in Asia/Manila too), so a recitation logged at 11:58pm
  // and one at 12:02am aren't silently split across two different "days"
  // just because the browser/device clock is in another timezone.
  function _isTodayManila(createdAtISO) {
    if (!createdAtISO) return false;
    const fmt = { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' };
    const todayLabel = new Date().toLocaleDateString('en-CA', fmt);
    const entryLabel = new Date(createdAtISO).toLocaleDateString('en-CA', fmt);
    return todayLabel === entryLabel;
  }

  /**
   * getTodayTotalForStudent(studentId) → number
   * Every point the student has earned today across ALL classes/sessions —
   * not scoped to the currently-open class or the active session window.
   * Backs the Winner Spotlight popup's "Today" stat.
   */
  function getTodayTotalForStudent(studentId) {
    if (!studentId) return 0;
    const state = AppStore.getState();
    return (state.recitationLog || [])
      .filter(r => r.studentId === studentId && _isTodayManila(r.createdAt))
      .reduce((sum, r) => sum + (r.pts || 0), 0);
  }

  /**
   * getAllTimeTotalForStudent(studentId) → number
   * Every recitation point the student has ever earned, full stop. Backs
   * the Winner Spotlight popup's big highlighted "Overall Recitation
   * Points" stat.
   */
  function getAllTimeTotalForStudent(studentId) {
    if (!studentId) return 0;
    const state = AppStore.getState();
    return (state.recitationLog || [])
      .filter(r => r.studentId === studentId)
      .reduce((sum, r) => sum + (r.pts || 0), 0);
  }

  return {
    SCAN_COOLDOWN_MS,
    canScanTag,
    processScannerTap,
    manualAward,
    undoRecitation,
    getSessionEntries,
    getSessionCounts,
    getTodayTotalForStudent,
    getAllTimeTotalForStudent,
  };
}());

console.log('[EduQuest] seat-arrangement/recitation-service.js loaded — RecitationService registered.');
