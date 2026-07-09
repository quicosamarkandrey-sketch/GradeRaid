// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/enrollment/enrollment-service.js
//  Service layer for the Smart Card Enrollment Hub (Phase 4).
//
//  REPOSITORY PATTERN CONTRACT — same rule as AttendanceService/SectionService
//  (see modules/attendance/attendance-service.js header):
//    enrollment-hub.js NEVER calls Supabase directly and NEVER mutates
//    AppStore for anything in this file's domain. It calls
//    EnrollmentService.<method>(...). This is the ONLY thing that:
//      a) calls DBService.rpc('enroll_rfid_card', ...), and
//      b) calls AppStore.updateState() to reflect a successful assignment
//         into draft.rfidCards.
//
//  WHY THIS ISN'T JUST AttendanceService.assignCard()
//    AttendanceService.assignCard() calls assign_rfid_card() directly, which
//    silently reassigns a tag away from its current owner — correct for the
//    kiosk's admin-only "Assign Card" mode (Device 1), where a teacher
//    reissuing a lost card is the expected case. The Hub serves a second,
//    riskier surface — Student Self-Service Kiosk Mode — where a silent
//    steal is exactly the failure mode we're trying to prevent (two
//    students, one card, wrong binding). So this module calls the new
//    enroll_rfid_card() RPC instead, which raises a distinguishable
//    "CARD_TAKEN:<name>" condition unless the caller explicitly passes
//    { force: true } after the operator has confirmed the reassignment.
//
//  OPTIMISTIC STATE
//    Nothing is written to AppStore until the RPC resolves successfully —
//    "rollback on conflict" here means the mutation never happened in the
//    first place (see enroll_rfid_card()'s CARD_TAKEN check, which runs
//    before any write), not that we optimistically apply and then undo. The
//    UI-only "awaiting hardware input" / "tap phase" states belong to
//    enrollment-hub.js's own module-local state, not AppStore — they aren't
//    durable app data, they're transient screen state, same as
//    _rfidScanMode in att_scanner_rfid.js.
// ═══════════════════════════════════════════════════════════════════════════════

window.EnrollmentService = (function () {
  'use strict';

  const CONFLICT_PREFIX = 'CARD_TAKEN:';

  /**
   * assignCardToStudent(studentId, rfidTag, opts) → Promise<{
   *   ok, conflict?, conflictName?, error?, card?
   * }>
   *
   * opts.force (default false): pass true only after the caller has shown
   * the operator a "this card belongs to <conflictName>, reassign anyway?"
   * confirmation and received an explicit yes.
   *
   * Return shapes:
   *   { ok: true, card }                          — bound successfully
   *   { ok: false, conflict: true, conflictName }  — needs confirmation, ask again with force:true
   *   { ok: false, error }                         — hard failure (bad input, network, etc.)
   */
  async function assignCardToStudent(studentId, rfidTag, opts) {
    opts = opts || {};
    const tagId = String(rfidTag || '').trim();
    const sid = String(studentId || '').trim();

    if (!sid || !tagId) {
      return { ok: false, error: 'A student and a card scan are both required.' };
    }
    if (typeof DBService === 'undefined' || typeof DBService.rpc !== 'function') {
      return { ok: false, error: 'Still connecting, please try again in a moment.' };
    }

    const { data, error } = await DBService.rpc('enroll_rfid_card', {
      p_student_id: sid,
      p_tag_id: tagId,
      p_force: !!opts.force,
    });

    if (error) {
      const msg = error.message || '';
      if (msg.indexOf(CONFLICT_PREFIX) === 0 || msg.indexOf(CONFLICT_PREFIX) > -1) {
        // Postgres wraps raised messages, so search rather than assume the
        // prefix is at position 0.
        const idx = msg.indexOf(CONFLICT_PREFIX);
        const conflictName = msg.slice(idx + CONFLICT_PREFIX.length).trim() || 'another student';
        return { ok: false, conflict: true, conflictName };
      }
      console.error('[EnrollmentService] assignCardToStudent failed:', error);
      return { ok: false, error: msg || 'Could not link this card.' };
    }

    // Mirror the authoritative RPC result into AppStore — same shape
    // AttendanceService.assignCard() writes, since both ultimately produce
    // a public.rfid_cards row and every reader (kiosk, Hub, Live Monitor)
    // expects draft.rfidCards to look identical regardless of which
    // service put the row there.
    AppStore.updateState(function (draft) {
      if (!Array.isArray(draft.rfidCards)) draft.rfidCards = [];
      draft.rfidCards.forEach(function (c) {
        if ((c.studentId === sid || c.tagId === tagId) && c.isActive && c.id !== data.id) {
          c.isActive = false;
          c.revokedAt = new Date().toISOString();
        }
      });
      const idx = draft.rfidCards.findIndex(function (c) { return c.id === data.id; });
      const row = {
        id: data.id, tagId: data.tag_id, studentId: data.student_id,
        isActive: data.is_active, assignedAt: data.assigned_at, revokedAt: data.revoked_at,
      };
      if (idx >= 0) draft.rfidCards[idx] = row; else draft.rfidCards.unshift(row);
    }, { type: 'enrollment:card-assigned', payload: { studentId: sid, tagId: tagId } });

    return { ok: true, card: data };
  }

  /**
   * getActiveCardForStudent(studentId, state?) → { id, tagId, assignedAt } | null
   * Pure read helper — no network call. Pass a pre-fetched state (e.g. from
   * AppStore.getState()) when calling this in a render loop over many
   * students to avoid re-cloning the whole DB per card.
   */
  function getActiveCardForStudent(studentId, state) {
    const s = state || (typeof AppStore !== 'undefined' ? AppStore.getState() : null);
    if (!s || !Array.isArray(s.rfidCards)) return null;
    const row = s.rfidCards.find(function (c) { return c.studentId === studentId && c.isActive; });
    return row ? { id: row.id, tagId: row.tagId, assignedAt: row.assignedAt } : null;
  }

  /**
   * verifyStudentPassword(studentId, password) → Promise<{ok, verified?, error?}>
   *
   * Pending Fixes Report §4 — Kiosk Self-Service identity check. Calls the
   * `verify_student_password` RPC (supabase/phase12_kiosk_identity_lock.sql),
   * which checks the password server-side against Supabase Auth's own hash
   * WITHOUT signing in as the student — the kiosk's browser tab stays signed
   * in as the teacher/admin who opened it throughout. See that RPC's header
   * comment for why this can't just be a client-side signInWithPassword()
   * call the way the kiosk Lock Mode's admin-unlock re-check is.
   *
   * Return shapes:
   *   { ok: true, verified: true }   — password matched, proceed
   *   { ok: true, verified: false }  — password didn't match, let them retry
   *   { ok: false, error }           — network/RPC failure, distinct from a wrong password
   */
  async function verifyStudentPassword(studentId, password) {
    const sid = String(studentId || '').trim();
    if (!sid || !password) {
      return { ok: false, error: 'A password is required.' };
    }
    if (typeof DBService === 'undefined' || typeof DBService.rpc !== 'function') {
      return { ok: false, error: 'Still connecting, please try again in a moment.' };
    }

    const { data, error } = await DBService.rpc('verify_student_password', {
      p_student_id: sid,
      p_password: password,
    });

    if (error) {
      console.error('[EnrollmentService] verifyStudentPassword failed:', error);
      return { ok: false, error: error.message || 'Could not verify password right now.' };
    }
    return { ok: true, verified: data === true };
  }

  return { assignCardToStudent, getActiveCardForStudent, verifyStudentPassword };
}());

console.log('[EduQuest] enrollment/enrollment-service.js loaded — EnrollmentService registered.');
