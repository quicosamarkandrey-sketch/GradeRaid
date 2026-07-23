// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/recitation/logger.js
//  Handles the logRecitation() function (called from Scanner admin page).
//  Patch: on completion, calls achCheckAndAward(sid) via typeof guard
//         (safe until modules/achievements/ is extracted on Day 6–7).
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * logRecitation() → void  [window.logRecitation]
 *
 * Reads values from:
 *   #rec-student  — student ID select element
 *   #rec-pts      — XP points input (default 10)
 *   #rec-note     — optional note textarea
 *
 * On submit:
 *   1. Finds student via AppStore.getStudent(id)
 *   2. Awards XP: student.xp += pts (via AppStore.updateState())
 *   3. Prepends to recitationLog: { studentId, pts, note, when: nowStr() }
 *   4. Prepends to pointLog:      { studentId, what: 'Recitation[: note]', pts, when: 'Just now' }
 *   5. Calls syncStudentStatsToServer() (RPC reconciliation — see utils.js), toast, renderScanner()
 *   6. (patch) Calls achCheckAndAward(sid) with typeof guard — 400ms delay
 */
window.logRecitation = function () {
  const sid  = document.getElementById('rec-student').value;
  const pts  = parseInt(document.getElementById('rec-pts').value) || 10;
  const note = document.getElementById('rec-note').value.trim();

  const student = AppStore.getStudent(sid);
  if (!student) return;

  AppStore.updateState(draft => {
    const s = (draft.students || []).find(x => x.id === sid);
    if (s) s.xp = (s.xp || 0) + pts;
    if (!Array.isArray(draft.recitationLog)) draft.recitationLog = [];
    draft.recitationLog.unshift({ id: 'rec_' + uid(), studentId: sid, pts, note, when: nowStr() });
    if (!Array.isArray(draft.pointLog)) draft.pointLog = [];
    draft.pointLog.unshift({
      id: 'pl_' + uid(),
      studentId: sid,
      what: `Recitation${note ? ': ' + note : ''}`,
      pts,
      when: 'Just now',
      createdAt: new Date().toISOString()
    });
  }, { type: 'recitation:logged', payload: { studentId: sid, pts } });

  // Optimistic local xp bump is already committed above; this reconciles the
  // authoritative server-computed totals back in once the RPC resolves (see
  // utils.js's syncStudentStatsToServer header comment) — same order as the
  // pre-migration code (local mutation first, then fire the RPC).
  syncStudentStatsToServer(sid, pts, 0);

  toast(`🎤 +${pts} pts → ${_esc(student.name)}`);
  renderScanner();

  // Achievement check — typeof guard until modules/achievements/ is extracted (Day 6–7)
  if (typeof achCheckAndAward === 'function') {
    setTimeout(() => achCheckAndAward(sid, true), 400);
  }
};

console.log('[EduQuest] recitation/logger.js loaded — logRecitation registered.');
