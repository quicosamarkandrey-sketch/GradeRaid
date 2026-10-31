// src/modules/recitation/logger.js — real-ESM twin of
// ../../../modules/recitation/logger.js.
// Phase 7 (Stream A), file 19/29. Original stays untouched.
//
// 1 top-level declared symbol exported (logRecitation), matching
// declaresCount 1 exactly (dist/dependency-map.json). Was a direct
// `window.logRecitation = function () {...}` (no intermediate const) ->
// `export const logRecitation = function () {...}` per this stream's
// whole-value-assignment convention; no new self-wiring added since
// none existed in the original.
//
// TWO real imports, both formal exports of files already converted by
// this stream, both checked against the "confirm no runtime
// reassignment anywhere in the repo" rule (MEMORY.md) before finalizing
// — only self-wiring/bridge/test-mock assignments found, no production
// runtime reassignment for either:
//   - AppStore (modules/core/state-manager.js) — .getStudent()/
//     .updateState() calls.
//   - syncStudentStatsToServer (student-stats.js).
// Checked both state-manager.js and student-stats.js for a reverse
// dependency back onto this file — none found, no cycle.
//
// Everything else (uid()/nowStr() from utils.js; toast() from dom.js;
// _esc() from utils.js — all converted but NOT by this stream;
// renderRfidScanner() from modules/attendance/att_scanner_rfid.js, this
// stream's own file but not yet converted) stays bare-identifier window
// fallback. Note the ALREADY-BROKEN production bug documented in the
// original's own comment: `renderRfidScanner` is the correct name, but
// per that comment this call site's real, pre-existing issue isn't a
// naming problem here — nothing to fix, just preserve exactly.

// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/recitation/logger.js
//  Handles the logRecitation() function (called from Scanner admin page).
//  Cross-module reactivity (achievement checks, etc.) happens via the
//  AppStore.updateState() event below ({ type: 'recitation:logged', ... }) —
//  modules/achievements/ach_engine.js subscribes to it. This file has no
//  direct dependency on the achievements module (Event-Driven Communication
//  phase, roadmap Phase 4).
// ═══════════════════════════════════════════════════════════════════════════════

import { AppStore } from '../core/state-manager.js';
import { syncStudentStatsToServer } from '../../student-stats.js';

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
 *   6. Emits 'recitation:logged' as part of the AppStore.updateState() call —
 *      ach_engine.js's pub/sub subscriber picks this up to run the
 *      achievement check; no direct call from this file.
 */
export const logRecitation = function () {
  const sid  = document.getElementById('rec-student').value;
  const pts  = parseInt(document.getElementById('rec-pts').value) || 10;
  const note = document.getElementById('rec-note').value.trim();

  const student = AppStore.getStudent(sid);
  if (!student) return;

  AppStore.updateState(draft => {
    const s = (draft.students || []).find(x => x.id === sid);
    if (s) s.xp = (s.xp || 0) + pts;
    if (!Array.isArray(draft.recitationLog)) draft.recitationLog = [];
    draft.recitationLog.unshift({ id: 'rec_' + uid(), studentId: sid, pts, note, when: nowStr(), createdAt:new Date().toISOString() });
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
  const statsSync=syncStudentStatsToServer(sid, pts, 0);
  if(window.LearningRewards)Promise.resolve(statsSync).then(()=>LearningRewards.flushLegacy(sid));

  toast(`🎤 +${pts} pts → ${_esc(student.name)}`);
  // Phase 7 (2026-08-10, session 4 dependency-map pass): was `renderScanner()`
  // — the pre-Phase-1 name, replaced by `renderRfidScanner()` when
  // att_scanner_rfid.js took over (see that file's own header comment,
  // and nav.js:221, which was updated correctly at the time). This call
  // site was missed during that migration; `renderScanner` doesn't exist
  // anywhere in production, only as a test-harness mock in
  // tests/unit/helpers/load-globals.js — so this threw an uncaught
  // ReferenceError on every real recitation-log submission, after the XP/
  // log mutation and toast had already succeeded (scanner UI just never
  // refreshed afterward). See EduQuest_Engineering_Refactor_Log.md Phase 7
  // session 4 entry.
  renderRfidScanner();
};

console.log('[EduQuest] recitation/logger.js loaded — logRecitation registered.');
