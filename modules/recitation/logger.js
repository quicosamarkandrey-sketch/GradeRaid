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
 *   1. Finds student in DB.students by id
 *   2. Awards XP: student.xp += pts
 *   3. Prepends to DB.recitationLog: { studentId, pts, note, when: nowStr() }
 *   4. Prepends to DB.pointLog:      { studentId, what: 'Recitation[: note]', pts, when: 'Just now' }
 *   5. Calls saveDB(), toast, renderScanner()
 *   6. (patch) Calls achCheckAndAward(sid) with typeof guard — 400ms delay
 */
window.logRecitation = function () {
  DB = loadDB();
  const sid  = document.getElementById('rec-student').value;
  const pts  = parseInt(document.getElementById('rec-pts').value) || 10;
  const note = document.getElementById('rec-note').value.trim();
  const idx  = DB.students.findIndex(s => s.id === sid);
  if (idx < 0) return;

  DB.students[idx].xp += pts;
  syncStudentStatsToServer(sid, pts, 0);
  DB.recitationLog.unshift({ id: 'rec_' + uid(), studentId: sid, pts, note, when: nowStr() });
  DB.pointLog.unshift({
    id: 'pl_' + uid(),
    studentId: sid,
    what: `Recitation${note ? ': ' + note : ''}`,
    pts,
    when: 'Just now'
  });
  saveDB();

  toast(`🎤 +${pts} pts → ${DB.students[idx].name}`);
  renderScanner();

  // Achievement check — typeof guard until modules/achievements/ is extracted (Day 6–7)
  if (typeof achCheckAndAward === 'function') {
    setTimeout(() => achCheckAndAward(sid, true), 400);
  }
};

console.log('[EduQuest] recitation/logger.js loaded — logRecitation registered.');
