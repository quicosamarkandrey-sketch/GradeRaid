// ─────────────────────────────────────────────────────────────────────────────
// SHARED UTILS — Stateless helper functions used across all modules
//
// Exports: uid(), todayStr(), nowStr(), isoDate(), csvDownload()
//
// DEPENDENCIES:
//   csvDownload() calls toast() — toast must be available in scope.
//   Phase 1: toast() is a global. Phase 3+: import { toast } from shared/dom.js
// ─────────────────────────────────────────────────────────────────────────────

function uid(){return'id_'+Math.random().toString(36).substr(2,9);}

// ── STUDENT STAT RECALCULATION ────────────────────────────────────────────────
// Single source of truth: call after any XP/quiz/attendance change.
// Fixes Critical Issues #1 (quizAvg), #2 (level+tier), #3 (attendance).

const TIER_THRESHOLDS = [
  { minLevel: 20, name: 'Legend'    },
  { minLevel: 15, name: 'Master'    },
  { minLevel: 10, name: 'Scholar'   },
  { minLevel:  5, name: 'Achiever'  },
  { minLevel:  0, name: 'Novice'    },
];

/**
 * recalcStudentStats(student, opts?) → void
 *
 * Mutates the student object in-place to recompute:
 *   - level  : floor(xp / 1000), capped to sensible max of 99
 *   - tier   : derived from level via TIER_THRESHOLDS
 *   - quizAvg: mean score across DB.quizHistory entries for this student,
 *              or 0 if no history exists
 *   - attendance: % of present sessions out of total sessions in DB.attendanceSessions
 *
 * opts.attendanceLogs (optional): use this array instead of the global
 * DB.attendanceLogs. BUGFIX (report §1): AttendanceService calls this from
 * inside an AppStore.updateState(draft => ...) callback, where the
 * just-written log row lives in `draft.attendanceLogs` — the global `DB`
 * hasn't been refreshed with it yet (that only happens once the draft
 * commits). Without this override, recalculating against the stale global
 * DB would silently miss the log row that was just saved, which is exactly
 * why overrides/scans used to not move the displayed attendance % at all.
 *
 * Call saveDB() after this if you want changes persisted.
 */
function recalcStudentStats(student, opts) {
  if (!student) return;
  opts = opts || {};

  // Centralized XP Logic
  window.XP_PER_LEVEL = 1000; 
  window.getLevel = function(xp) { return Math.floor(xp / XP_PER_LEVEL); };

  // ── Tier (derived from level) ──
  for (const t of TIER_THRESHOLDS) {
    if (student.level >= t.minLevel) { student.tier = t.name; break; }
  }

  // ── Quiz Average (from DB.quizHistory per-student score log) ──
  const history = (DB.quizHistory || {})[student.id] || [];
  if (history.length > 0) {
    const sum = history.reduce((acc, entry) => acc + (entry.score || 0), 0);
    student.quizAvg = Math.round(sum / history.length);
  } // else: leave quizAvg unchanged (preserves seed values for students with no history)

  // ── Attendance % ──
  // Phase 1 (RFID/manual attendance) writes to DB.attendanceLogs, which
  // supersedes the old DB.attendanceSessions blob — see
  // supabase/phase1_rfid_attendance.sql and attendance-service.js. Excused
  // days count toward neither side of the ratio (they're neutral, not a
  // mark against the student); Early/On Time/Late all count as present.
  const logs = (opts.attendanceLogs || DB.attendanceLogs || []).filter(l => l.studentId === student.id && l.status !== 'Excused');
  if (logs.length > 0) {
    const present = logs.filter(l => l.status === 'Early' || l.status === 'On Time' || l.status === 'Late').length;
    student.attendance = Math.round(present / logs.length * 100);
  } else {
    // Fallback for any student with old data but no Phase 1 logs yet.
    const sessions = (DB.attendanceSessions || []).filter(s => s.studentId === student.id);
    if (sessions.length > 0) {
      const present = sessions.filter(s => s.status === 'present').length;
      student.attendance = Math.round(present / sessions.length * 100);
    } // else: leave at seed value
  }
}
window.recalcStudentStats = recalcStudentStats;

// ── Shared attendance helpers (Investigation Report §4) ─────────────────────
// Previously, modules/recitation/progress.js had its own private
// progGetAttendanceForStudent()/progAttStreak() pair, and the RFID kiosk had
// no streak calculation at all — the report's "add streak to the scan card"
// ask meant either duplicating that logic a second time or lifting it here
// once. Lifted here; progress.js now delegates to these (see below).

/**
 * getStudentAttendanceRecords(sid, opts?) → [{studentId, date, status:'present'|'absent'}]
 *
 * Normalizes DB.attendanceLogs for one student into the shape every
 * downstream attendance UI expects (streak calc, calendar, rate ring):
 * Excused days are dropped entirely (neutral, not a mark either way);
 * Early/On Time/Late all normalize to 'present', anything else to 'absent'.
 *
 * opts.attendanceLogs (optional): same override pattern as
 * recalcStudentStats() — pass this when calling from inside an
 * AppStore.updateState() draft callback, where the just-written log row
 * lives in draft.attendanceLogs before the global DB cache refreshes.
 */
function getStudentAttendanceRecords(sid, opts) {
  opts = opts || {};
  const logs = opts.attendanceLogs || DB.attendanceLogs || [];
  return logs
    .filter(r => r.studentId === sid && r.status !== 'Excused')
    .map(r => ({
      studentId: r.studentId,
      date: r.logDate,
      status: (r.status === 'Early' || r.status === 'On Time' || r.status === 'Late') ? 'present' : 'absent',
    }));
}
window.getStudentAttendanceRecords = getStudentAttendanceRecords;

/**
 * computeAttendanceStreak(records) → { current, longest }
 * records: [{status:'present'|'absent', date:'YYYY-MM-DD'}] — the same shape
 * getStudentAttendanceRecords() returns. Moved here (verbatim) from
 * progress.js's progAttStreak() so the RFID kiosk's scan card can show a
 * live streak too, without a second copy of this math to keep in sync.
 */
function computeAttendanceStreak(records) {
  const presentDays = [...new Set(
    records.filter(s => s.status === 'present').map(s => s.date)
  )].sort();
  if (!presentDays.length) return { current: 0, longest: 0 };

  function parseDate(d) { if (!d) return null; const t = new Date(d); return isNaN(t.getTime()) ? null : t; }
  let longest = 1, cur = 1;
  for (let i = 1; i < presentDays.length; i++) {
    const a = parseDate(presentDays[i - 1]), b = parseDate(presentDays[i]);
    if (a && b) { const diff = Math.round((b - a) / 86400000); if (diff === 1) { cur++; longest = Math.max(longest, cur); } else cur = 1; }
  }
  // current streak: count back from today
  const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0);
  let curStreak = 0;
  const daysCopy = [...presentDays].reverse();
  let checkDate = new Date(todayDate);
  for (const d of daysCopy) {
    const pd = parseDate(d); if (!pd) continue;
    const diff = Math.round((checkDate - pd) / 86400000);
    if (diff === 0 || diff === 1) { curStreak++; checkDate = pd; } else if (diff > 1) break;
  }
  return { current: curStreak, longest: Math.max(longest, curStreak) };
}
window.computeAttendanceStreak = computeAttendanceStreak;

// ── Server-authoritative stat sync (Investigation Report §6.1) ─────────────
//
// THE BUG: db-service.js's debounced bulk sync re-upserts EVERY student's
// xp/coins/level/tier from whatever one browser tab has cached, on every
// saveDB() call anywhere in the app. Seven features (recitation award,
// campaign stage rewards, admin manual XP/coin adjust, world boss rewards,
// mail rewards, achievement grant/revoke, achievement claim) used to only
// mutate the local DB.students cache and rely on that bulk push to persist
// the change — meaning a stale tab's next unrelated saveDB() could silently
// overwrite the whole roster's xp/coins with old numbers.
//
// THE FIX: those seven call sites now ALSO call this helper right after
// applying their local optimistic xp/coins delta. It calls the new
// `adjust_student_stats` RPC (supabase/phase9_student_stat_rpc.sql), which
// applies the delta atomically in Postgres — there is nothing for a stale
// tab to clobber, since no absolute value is ever sent, only a delta. This
// mirrors the exact pattern AttendanceService/RecitationService already use
// for their own domains (call the RPC, then fold the authoritative result
// back into local state). db-service.js's bulk profiles upsert no longer
// sends xp/coins/level/tier at all (see its updated comment) — this RPC is
// now their sole write path.
//
// Fire-and-forget by design: every one of the seven call sites is a plain
// synchronous function (button onclick handlers, etc.) and none of them
// need to block on the network round-trip — the existing local mutation
// already gives the user instant feedback, exactly as before. This only
// adds a best-effort correction pass once the RPC resolves.
function syncStudentStatsToServer(studentId, xpDelta, coinsDelta) {
  if (!studentId) return;
  xpDelta = xpDelta || 0;
  coinsDelta = coinsDelta || 0;
  if (!xpDelta && !coinsDelta) return;
  if (typeof DBService === 'undefined' || typeof DBService.rpc !== 'function') return;

  DBService.rpc('adjust_student_stats', {
    p_student_id: studentId,
    p_xp_delta: xpDelta,
    p_coins_delta: coinsDelta,
  }).then(function (result) {
    const error = result && result.error;
    const data = result && result.data;
    if (error) {
      // Network/RLS failure: local cache already has the optimistic value
      // and localStorage mirror, same "stay on local cache, retry next
      // mutation" posture as _flushUpload() in db-service.js. No further
      // action needed here.
      console.warn('[EduQuest] syncStudentStatsToServer: RPC failed for', studentId, error);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return;

    // Reconcile the authoritative server totals (xp/coins/level/tier) back
    // into whatever this tab currently has cached, so the UI reflects the
    // real atomic result without waiting for a full reload. Best-effort
    // only — wrapped so a missing DB/AppStore never breaks the caller.
    try {
      if (typeof DB !== 'undefined' && DB && Array.isArray(DB.students)) {
        const s = DB.students.find(x => x.id === studentId);
        if (s) { s.xp = row.xp; s.coins = row.coins; s.level = row.level; s.tier = row.tier; }
      }
    } catch (e) { /* best-effort only */ }
    try {
      if (typeof currentUser !== 'undefined' && currentUser && currentUser.id === studentId) {
        currentUser.xp = row.xp; currentUser.coins = row.coins;
        currentUser.level = row.level; currentUser.tier = row.tier;
      }
    } catch (e) { /* best-effort only */ }
    try {
      if (typeof AppStore !== 'undefined' && AppStore && typeof AppStore.updateState === 'function') {
        AppStore.updateState(draft => {
          const s = (draft.students || []).find(x => x.id === studentId);
          if (s) { s.xp = row.xp; s.coins = row.coins; s.level = row.level; s.tier = row.tier; }
        }, { type: 'student:stats-synced', payload: { studentId } });
      }
    } catch (e) { /* best-effort only */ }
  }).catch(function (e) {
    console.warn('[EduQuest] syncStudentStatsToServer: RPC threw for', studentId, e);
  });
}
window.syncStudentStatsToServer = syncStudentStatsToServer;

// ── Self-service cosmetic profile sync (Phase 49 — profile picture / name
//    persistence fix) ───────────────────────────────────────────────────────
//
// THE BUG: db-service.js's bulk `profiles` upsert (the only thing that ever
// wrote display_name/first_name/last_name/init/profile_pic_url to Supabase)
// is deliberately gated to isStaffSession only — a student session skips it
// entirely, by design, so a student login can never trigger the is_staff()
// write path. That's correct for the bulk roster-editing upsert, but it
// left NO write path at all for a student (or teacher) editing their OWN
// cosmetic fields: the change would apply to the local DB/currentUser copy
// and look saved for the rest of the session, then vanish the moment
// loadDB() pulled the server's (unchanged) copy back down — e.g. on the
// next page refresh. The `profiles_self_update_cosmetic_only` RLS policy
// referenced in a phase14_section_isolation.sql comment as "untouched" was
// never actually created anywhere in supabase/, so even a direct
// client-side .update('profiles') call would have been rejected by RLS.
//
// THE FIX: update_own_profile_cosmetic() (supabase/phase49_student_self_
// profile_rpc.sql) is a SECURITY DEFINER RPC scoped to `id = auth.uid()`
// server-side — the caller can only ever touch their own row, no matter
// what id-like value is passed anywhere else in the app, and the function
// signature only exposes five cosmetic columns (no xp/coins/role/class_id/
// id parameter exists, so this RPC cannot reach those regardless of caller
// input). Works for students AND teachers/admins alike, since it's scoped
// by real Supabase identity, not by which local array/branch called it.
//
// Unlike the fire-and-forget stat syncs above, this is called from an
// explicit "Save Changes" button (saveProfileEdit() in index.html) where
// the person is actively waiting for confirmation the save worked — so
// this is awaited and returns a result the caller can toast on, rather than
// firing optimistically in the background.
//
// payload: { displayName, firstName, lastName, init, profilePic }
//   Each field follows the SAME null-means-unchanged convention already
//   used by _profPendingPic elsewhere in the profile panel: pass `null` to
//   leave a column untouched server-side (the RPC does
//   `coalesce(p_x, x)`), pass an empty string to explicitly clear it (e.g.
//   "Remove Photo"), or pass the new value to set it.
async function syncOwnProfileCosmeticToServer(payload) {
  payload = payload || {};
  if (typeof DBService === 'undefined' || typeof DBService.rpc !== 'function') {
    return { success: false, error: new Error('Not connected to Supabase (offline).') };
  }
  try {
    const result = await DBService.rpc('update_own_profile_cosmetic', {
      p_display_name:    payload.displayName !== undefined ? payload.displayName : null,
      p_first_name:      payload.firstName   !== undefined ? payload.firstName   : null,
      p_last_name:       payload.lastName    !== undefined ? payload.lastName    : null,
      p_init:            payload.init        !== undefined ? payload.init        : null,
      p_profile_pic_url: payload.profilePic  !== undefined ? payload.profilePic  : null,
    });
    if (result && result.error) {
      console.warn('[EduQuest] syncOwnProfileCosmeticToServer: RPC failed', result.error);
      return { success: false, error: result.error };
    }
    return { success: true, row: result && result.data };
  } catch (e) {
    console.warn('[EduQuest] syncOwnProfileCosmeticToServer: RPC threw', e);
    return { success: false, error: e };
  }
}
window.syncOwnProfileCosmeticToServer = syncOwnProfileCosmeticToServer;

// ── Server-authoritative derived-stat sync (Pending Fixes Report §3) ───────
//
// THE BUG: attendance_pct/quiz_avg were the "still open" half of the §6.1
// whole-roster clobber bug — they were deliberately left riding
// db-service.js's debounced bulk profiles upsert because neither had an RPC
// path of its own. Any tab's stale saveDB() call can still overwrite these
// two columns with whatever it had cached, even after recalcStudentStats()
// computed a fresher value on another device seconds earlier.
//
// THE FIX: every recalcStudentStats() call site now ALSO calls this helper
// right after recalculating, passing the just-recomputed absolute values.
// Unlike syncStudentStatsToServer() (which sends a delta), this sends
// already-derived values — recalcStudentStats() recomputes them from
// scratch every time (attendanceLogs / quizHistory), so the "current value"
// IS the correct value to persist. The RPC
// (supabase/phase11_derived_stats_rpc.sql) writes only these two columns on
// just that one student's row, so it can't clobber xp/coins/level/tier (owned
// by adjust_student_stats) or any identity/cosmetic field. Same
// fire-and-forget posture as syncStudentStatsToServer() — the caller's
// local optimistic mutation already gives the user instant feedback.
function syncStudentDerivedStatsToServer(studentId, attendancePct, quizAvg) {
  if (!studentId) return;
  if (attendancePct === undefined && quizAvg === undefined) return;
  if (typeof DBService === 'undefined' || typeof DBService.rpc !== 'function') return;

  DBService.rpc('sync_student_derived_stats', {
    p_student_id: studentId,
    p_attendance_pct: (attendancePct === undefined || attendancePct === null) ? null : attendancePct,
    p_quiz_avg: (quizAvg === undefined || quizAvg === null) ? null : quizAvg,
  }).then(function (result) {
    const error = result && result.error;
    if (error) {
      // Network/RLS failure: local cache already has the recomputed value
      // and localStorage mirror — same "stay on local cache, retry next
      // recalc" posture as syncStudentStatsToServer(). No further action
      // needed here.
      console.warn('[EduQuest] syncStudentDerivedStatsToServer: RPC failed for', studentId, error);
    }
  }).catch(function (e) {
    console.warn('[EduQuest] syncStudentDerivedStatsToServer: RPC threw for', studentId, e);
  });
}
window.syncStudentDerivedStatsToServer = syncStudentDerivedStatsToServer;

// Phase 17 — achievement sync. Same fire-and-forget posture as
// syncStudentStatsToServer(): local cache is the source of truth for the
// current tab, this just reconciles Supabase in the background so other
// devices see the same unlock/claim/revoke. A failure here is logged and
// otherwise ignored, exactly like the other two helpers above.

function syncAchievementUnlockToServer(studentId, achId, xpGranted, coinsGranted, claimed, classId) {
  if (!studentId || !achId) return;
  if (typeof DBService === 'undefined' || typeof DBService.rpc !== 'function') return;

  DBService.rpc('award_achievement_to_student', {
    p_student_id: studentId,
    p_achievement_id: achId,
    p_xp_granted: xpGranted || 0,
    p_coins_granted: coinsGranted || 0,
    p_claimed: !!claimed,
    p_class_id: classId || null,
  }).then(function (result) {
    const error = result && result.error;
    if (error) console.warn('[EduQuest] syncAchievementUnlockToServer: RPC failed for', studentId, achId, error);
  }).catch(function (e) {
    console.warn('[EduQuest] syncAchievementUnlockToServer: RPC threw for', studentId, achId, e);
  });
}
window.syncAchievementUnlockToServer = syncAchievementUnlockToServer;

function syncAchievementClaimToServer(studentId, achId, xpGranted, coinsGranted) {
  if (!studentId || !achId) return;
  if (typeof DBService === 'undefined' || typeof DBService.rpc !== 'function') return;

  DBService.rpc('claim_achievement_reward', {
    p_student_id: studentId,
    p_achievement_id: achId,
    p_xp_granted: xpGranted || 0,
    p_coins_granted: coinsGranted || 0,
  }).then(function (result) {
    const error = result && result.error;
    if (error) console.warn('[EduQuest] syncAchievementClaimToServer: RPC failed for', studentId, achId, error);
  }).catch(function (e) {
    console.warn('[EduQuest] syncAchievementClaimToServer: RPC threw for', studentId, achId, e);
  });
}
window.syncAchievementClaimToServer = syncAchievementClaimToServer;

function syncAchievementRevokeToServer(studentId, achId) {
  if (!studentId || !achId) return;
  if (typeof DBService === 'undefined' || typeof DBService.rpc !== 'function') return;

  DBService.rpc('revoke_achievement_from_student', {
    p_student_id: studentId,
    p_achievement_id: achId,
  }).then(function (result) {
    const error = result && result.error;
    if (error) console.warn('[EduQuest] syncAchievementRevokeToServer: RPC failed for', studentId, achId, error);
  }).catch(function (e) {
    console.warn('[EduQuest] syncAchievementRevokeToServer: RPC threw for', studentId, achId, e);
  });
}
window.syncAchievementRevokeToServer = syncAchievementRevokeToServer;

// Phase 18 — title sync. Same fire-and-forget posture as the achievement
// helpers above.

function syncTitleUnlockToServer(studentId, titleId, classId) {
  if (!studentId || !titleId) return;
  if (typeof DBService === 'undefined' || typeof DBService.rpc !== 'function') return;

  DBService.rpc('unlock_title_for_student', {
    p_student_id: studentId,
    p_title_id: titleId,
    p_class_id: classId || null,
  }).then(function (result) {
    const error = result && result.error;
    if (error) console.warn('[EduQuest] syncTitleUnlockToServer: RPC failed for', studentId, titleId, error);
  }).catch(function (e) {
    console.warn('[EduQuest] syncTitleUnlockToServer: RPC threw for', studentId, titleId, e);
  });
}
window.syncTitleUnlockToServer = syncTitleUnlockToServer;

function syncTitleRevokeToServer(studentId, titleId) {
  if (!studentId || !titleId) return;
  if (typeof DBService === 'undefined' || typeof DBService.rpc !== 'function') return;

  DBService.rpc('revoke_title_from_student', {
    p_student_id: studentId,
    p_title_id: titleId,
  }).then(function (result) {
    const error = result && result.error;
    if (error) console.warn('[EduQuest] syncTitleRevokeToServer: RPC failed for', studentId, titleId, error);
  }).catch(function (e) {
    console.warn('[EduQuest] syncTitleRevokeToServer: RPC threw for', studentId, titleId, e);
  });
}
window.syncTitleRevokeToServer = syncTitleRevokeToServer;

function syncEquippedTitleToServer(studentId, titleId) {
  if (!studentId) return;
  if (typeof DBService === 'undefined' || typeof DBService.rpc !== 'function') return;

  DBService.rpc('set_equipped_title', {
    p_student_id: studentId,
    p_title_id: titleId || null,
  }).then(function (result) {
    const error = result && result.error;
    if (error) console.warn('[EduQuest] syncEquippedTitleToServer: RPC failed for', studentId, titleId, error);
  }).catch(function (e) {
    console.warn('[EduQuest] syncEquippedTitleToServer: RPC threw for', studentId, titleId, e);
  });
}
window.syncEquippedTitleToServer = syncEquippedTitleToServer;

// RESTORED: _esc() is used by 30+ module files (boss-studio, world-boss, shop,
// titles, achievements, attendance, campaign, mail, admin) but was previously
// only defined inside modules/world-boss/admin-page.js, which loads quite late
// in the script order. Any module that loaded before admin-page.js and called
// _esc() during initial render would throw "ReferenceError: _esc is not
// defined". Moved here (utils.js loads near the very top) to guarantee it's
// available everywhere. Ported verbatim from the original inline script.
function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
window._esc = _esc;

function todayStr(){return new Date().toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'});}
function nowStr(){return new Date().toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'});}
// isoDate() → 'YYYY-MM-DD' for "today", in Philippine time (Asia/Manila).
// BUGFIX: this used to be `new Date().toISOString().slice(0,10)`, which is
// the UTC date, not the Manila date. Manila is UTC+8, so the old version
// rolled over to a new day at 8:00 AM Manila time instead of midnight —
// anything scanned/overridden between 12:00 AM and 8:00 AM got silently
// filed under "yesterday" while the real RFID scanner (which already used
// Asia/Manila server-side — see process_attendance_scan() in
// supabase/phase1_rfid_attendance.sql) correctly called it "today". en-CA
// isn't a locale choice, it's a formatting trick: en-CA is the one Intl
// locale whose short date format is already 'YYYY-MM-DD'.
function isoDate(){return new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'});}
function csvDownload(filename,rows){
  const csv=rows.map(r=>r.map(cell=>{const s=String(cell??'');return s.includes(',')||s.includes('"')||s.includes('\n')?`"${s.replace(/"/g,'""')}"`:`${s}`;}).join(',')).join('\r\n');
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
  toast(`📥 "${filename}" downloaded`);
}

// ═══════════════════════════════════════════════════════════════════════════
//  QUEST BOARD — Real Streak Tracking  (Phase 2)
//  Replaces the old fake "🔥 Streak" stat (Math.floor(completedQuizzes.length/2),
//  never resets, can't be broken — see quest_board_report.md §1). A quest
//  streak is now actual consecutive-day quest-completion tracking, built on
//  the exact same day-diff algorithm as computeAttendanceStreak() above so
//  the whole app has one consistent definition of "streak".
// ═══════════════════════════════════════════════════════════════════════════

/**
 * getStudentQuestRecords(sid) → [{status:'present', date:'YYYY-MM-DD'}, ...]
 *
 * Reads DB.quizHistory[sid] (one entry per completed quest) and normalizes
 * it into the same {status,date} shape computeAttendanceStreak() expects.
 * New entries (finishQuiz(), index.html) stamp a `date` field via isoDate()
 * at completion time — the correct Asia/Manila calendar day. Older history
 * entries only have `completedAt` (a raw ISO UTC timestamp from
 * `new Date().toISOString()`), so those fall back to slicing its UTC date;
 * good enough for legacy rows and never throws on a missing/malformed value.
 */
function getStudentQuestRecords(sid) {
  const history = (DB.quizHistory || {})[sid] || [];
  return history
    .map(h => ({ status: 'present', date: h.date || (h.completedAt ? String(h.completedAt).slice(0, 10) : null) }))
    .filter(r => r.date);
}
window.getStudentQuestRecords = getStudentQuestRecords;

/**
 * computeQuestStreak(sid) → { current, longest }
 * Real, breakable, day-based quest streak — one completed quest on a given
 * calendar day counts that day; a day with no completion breaks `current`
 * back to 0 the next time it's computed. Delegates to
 * computeAttendanceStreak() so both streak types stay in lockstep if the
 * underlying day-diff math is ever tuned.
 */
function computeQuestStreak(sid) {
  return computeAttendanceStreak(getStudentQuestRecords(sid));
}
window.computeQuestStreak = computeQuestStreak;

// ═══════════════════════════════════════════════════════════════════════════
//  QUEST BOARD — Question Type Helpers  (Phase 1: reviewer question types)
//  Every question in a quiz now carries a `type`: 'mc' (multiple choice,
//  the original/default format), 'tf' (true/false — same opts+answer-index
//  shape as mc, just 2 fixed options), or 'id' (identification / short
//  answer — free-text, fuzzy-matched). Quizzes saved before this phase have
//  no `type` field at all; eqQType() treats that as 'mc' so nothing old
//  breaks (including quizzes already imported into World Boss).
// ═══════════════════════════════════════════════════════════════════════════
function eqQType(q){ return (q && q.type) || 'mc'; }
window.eqQType = eqQType;

// Normalizes free-text answers for Identification-type grading: lowercases,
// trims, strips common punctuation, and collapses internal whitespace, so
// "Mitochondria." / " mitochondria " / "MITOCHONDRIA" all count as a match.
function eqNormalizeAnswer(s){
  return String(s ?? '')
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:'"()\[\]]/g,'')
    .replace(/\s+/g,' ');
}
window.eqNormalizeAnswer = eqNormalizeAnswer;

// Grades one question against a student's submitted answer. `studentAns` is
// an option-index (number) for mc/tf, a raw string for id, or an array of
// strings for enum. Returns a fraction 0..1 (1/0 for mc/tf/id, a matched-
// count ratio for enum — Phase 3 partial credit, quest_board_report.md
// §2.3/§3.6). Centralized here so the student quiz runner and (later)
// World Boss combat both grade the same forgiving way instead of
// duplicating the normalization logic.
function eqGradeAnswer(q, studentAns){
  const type = eqQType(q);
  if (type === 'id') {
    if (studentAns === null || studentAns === undefined) return 0;
    const given = eqNormalizeAnswer(studentAns);
    if (!given) return 0;
    const accepted = [q.answer, ...(Array.isArray(q.altAnswers) ? q.altAnswers : [])]
      .filter(a => a !== undefined && a !== null && a !== '')
      .map(eqNormalizeAnswer);
    return accepted.includes(given) ? 1 : 0;
  }
  if (type === 'enum') {
    // Order-independent partial credit: each correct item can only be
    // matched once, so guessing the same right answer twice doesn't inflate
    // the score. Empty/blank inputs never match.
    const correctList = Array.isArray(q.answers) ? q.answers.filter(a => a && String(a).trim()) : [];
    if (!correctList.length) return 0;
    const pool = correctList.map(eqNormalizeAnswer);
    const given = Array.isArray(studentAns) ? studentAns : [];
    let matched = 0;
    given.forEach(g => {
      const ng = eqNormalizeAnswer(g);
      if (!ng) return;
      const idx = pool.indexOf(ng);
      if (idx !== -1) { matched++; pool.splice(idx, 1); }
    });
    return matched / correctList.length;
  }
  if (type === 'match') {
    // Phase 5 — Matching type (quest_board_report.md §2.4): q.pairs is
    // [{left, right}, ...]; studentAns is an array of the student's chosen
    // `right` string per pair index (same order as q.pairs, NOT the
    // shuffled display order — submitMatchAnswer() in index.html already
    // maps the shuffled dropdown selection back to pair index before it
    // ever reaches quizAnswers). Partial credit per correct pair, same
    // "each blank scored independently" spirit as enum above.
    const pairs = Array.isArray(q.pairs) ? q.pairs.filter(p => p && p.left && String(p.left).trim()) : [];
    if (!pairs.length) return 0;
    const given = Array.isArray(studentAns) ? studentAns : [];
    let matched = 0;
    pairs.forEach((p, i) => {
      const g = given[i];
      if (g === undefined || g === null || g === '') return;
      if (eqNormalizeAnswer(g) === eqNormalizeAnswer(p.right)) matched++;
    });
    return matched / pairs.length;
  }
  // mc / tf — plain option-index compare (unchanged original behavior)
  return studentAns === q.answer ? 1 : 0;
}
window.eqGradeAnswer = eqGradeAnswer;

// ═══════════════════════════════════════════════════════════════════════════
//  QUEST BOARD — Phase 3 (Improvement Plan §2/§4): 3-Stage Escalation +
//  Per-Question Timer
//
//  Splits a quiz's questions into 3 stages — Warm-Up, Surge, Overdrive —
//  purely by question ORDER (first third/second third/final third), so
//  every existing quiz gets staged automatically with zero re-authoring.
//  Each stage has its own per-question countdown (resets every item, not
//  once per whole quiz). Defaults are 30/20/10 seconds; an admin can
//  override any/all of them per-quiz via quiz.stageTimers (quiz-builder.js),
//  and the system always falls back to the shipped default for any slot
//  that isn't overridden — see eqQuizStageSeconds() below.
// ═══════════════════════════════════════════════════════════════════════════
const QUIZ_STAGE_DEFAULT_SECONDS = [30, 20, 10];
const QUIZ_STAGE_NAMES = ['Warm-Up', 'Surge', 'Overdrive'];
window.QUIZ_STAGE_DEFAULT_SECONDS = QUIZ_STAGE_DEFAULT_SECONDS;
window.QUIZ_STAGE_NAMES = QUIZ_STAGE_NAMES;

// Per-stage seconds-per-question for this quiz. quiz.stageTimers (if
// present) is a 3-slot array of admin overrides; any missing/invalid slot
// (undefined, 0, non-numeric) falls back to that slot's shipped default,
// so a quiz that only overrode stage 3 doesn't lose its stage 1/2 defaults,
// and a quiz saved before this feature existed (no stageTimers at all)
// behaves identically to the shipped 30/20/10.
function eqQuizStageSeconds(quiz){
  const overrides = (quiz && Array.isArray(quiz.stageTimers)) ? quiz.stageTimers : [];
  return QUIZ_STAGE_DEFAULT_SECONDS.map((def, i) => {
    const v = parseInt(overrides[i], 10);
    return (Number.isFinite(v) && v > 0) ? v : def;
  });
}
window.eqQuizStageSeconds = eqQuizStageSeconds;

// Which stage (0=Warm-Up, 1=Surge, 2=Overdrive) a question index belongs
// to, given the quiz's total question count. Splits into 3 contiguous
// chunks as evenly as possible for n>=3. Degrades sensibly for very short
// quizzes: 1 question stays in stage 0; 2 questions go stage 0 then stage
// 2, so even a tiny quiz still feels like it escalates rather than sitting
// in Warm-Up the whole time.
function eqQuestionStage(totalQuestions, qIndex){
  const n = Math.max(1, totalQuestions | 0);
  if (n === 1) return 0;
  if (n === 2) return qIndex === 0 ? 0 : 2;
  const stage = Math.floor((qIndex / n) * 3);
  return Math.min(2, Math.max(0, stage));
}
window.eqQuestionStage = eqQuestionStage;

function eqStageName(stageIdx){ return QUIZ_STAGE_NAMES[stageIdx] || QUIZ_STAGE_NAMES[0]; }
window.eqStageName = eqStageName;

// ═══════════════════════════════════════════════════════════════════════════
//  QUEST BOARD — Rarity & Cadence Helpers  (Phase 3: content variety §3.4/§3.2)
//  A quest can carry a `rarity` (reusing the exact Common→Mythic palette
//  already built for Achievements — window.ACH_RARITY/ACH_RARITIES in
//  ach_engine.js — instead of a one-off quest-only system) and a `cadence`
//  ('daily' | 'weekly' | unset/'standing'). Quizzes saved before this phase
//  have neither field; both helpers default to the pre-Phase-3 behavior
//  (Common rarity, always-available standing quest) so nothing old breaks.
// ═══════════════════════════════════════════════════════════════════════════
function eqQuizRarity(quiz){ return (quiz && quiz.rarity) || 'Common'; }
window.eqQuizRarity = eqQuizRarity;

function eqQuizCadence(quiz){ return (quiz && quiz.cadence) || 'standing'; }
window.eqQuizCadence = eqQuizCadence;

// Deterministic seeded shuffle-and-take: every student computing this for
// the same seed string gets the exact same picks (no server round-trip
// needed to agree on "today's 3 dailies"), and it changes automatically
// the moment the date/week string changes. Simple LCG, not cryptographic —
// fairness/unpredictability-to-a-casual-glance is all this needs.
function _eqSeededPick(pool, seedStr, count){
  if (!pool.length || count <= 0) return [];
  const arr = pool.slice();
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  function rand(){ seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; }
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr.slice(0, Math.min(count, arr.length));
}

// eqGetDailyQuizIds(dateStr?) → [id, id, id] — up to 3 quests from the
// 'daily' cadence pool, refreshed at Manila midnight (isoDate() rolls over
// then). Stable for the whole day, same picks for every student.
function eqGetDailyQuizIds(dateStr){
  dateStr = dateStr || isoDate();
  const pool = (DB.quizzes || []).filter(q => eqQuizCadence(q) === 'daily').map(q => q.id).sort();
  return _eqSeededPick(pool, 'quest-daily-' + dateStr, 3);
}
window.eqGetDailyQuizIds = eqGetDailyQuizIds;

// eqGetWeeklyQuizId(dateStr?) → id | null — one quest from the 'weekly'
// cadence pool, refreshed every Monday (Manila calendar week).
function eqGetWeeklyQuizId(dateStr){
  dateStr = dateStr || isoDate();
  const pool = (DB.quizzes || []).filter(q => eqQuizCadence(q) === 'weekly').map(q => q.id).sort();
  if (!pool.length) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const dayIdx = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dayIdx);
  const weekKey = d.toISOString().slice(0, 10);
  return _eqSeededPick(pool, 'quest-weekly-' + weekKey, 1)[0] || null;
}
window.eqGetWeeklyQuizId = eqGetWeeklyQuizId;

// ═══════════════════════════════════════════════════════════════════════════
//  QUEST BOARD — Phase 5 Helpers (Admin tooling: quest_board_report.md §4)
//  Scheduling (§18): quiz.startDate / quiz.endDate are optional 'YYYY-MM-DD'
//  strings (Manila calendar day, same convention as isoDate()). Neither set
//  = the pre-Phase-5 default, always available. Purely additive — a quiz
//  saved before this phase has both fields undefined and behaves exactly
//  as before.
// ═══════════════════════════════════════════════════════════════════════════

// eqQuizScheduleStatus(quiz, dateStr?) → 'upcoming' | 'active' | 'expired' | null
// null means "no schedule set" (always available, same as pre-Phase-5).
function eqQuizScheduleStatus(quiz, dateStr){
  if (!quiz) return null;
  const today = dateStr || isoDate();
  const start = quiz.startDate || null;
  const end = quiz.endDate || null;
  if (!start && !end) return null;
  if (start && today < start) return 'upcoming';
  if (end && today > end) return 'expired';
  return 'active';
}
window.eqQuizScheduleStatus = eqQuizScheduleStatus;

// eqDaysUntil(dateStr) → integer day count from today (Manila calendar) to
// dateStr. Negative if dateStr is in the past. Used to render "Ends in N
// days" / "Starts in N days" badges without re-deriving the same date math
// in three different render functions.
function eqDaysUntil(dateStr){
  if (!dateStr) return null;
  const today = new Date(isoDate() + 'T00:00:00');
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target - today) / 86400000);
}
window.eqDaysUntil = eqDaysUntil;

// ═══════════════════════════════════════════════════════════════════════════
//  QUEST BOARD — Phase 5: Per-Quiz Analytics (quest_board_report.md §19)
//  Reads DB.quizHistory (Phase 57 — synced per-attempt log) to compute
//  completion rate, average score, and per-question miss-rate for a quiz.
//  `results` (per-question fraction array, same order as quiz.questions) is
//  a Phase 5 addition to each history entry — entries logged before this
//  phase simply have no `results`, so per-question stats silently exclude
//  them rather than throwing; completion rate / average score still include
//  every attempt regardless, since those only ever needed `score`.
// ═══════════════════════════════════════════════════════════════════════════
function eqComputeQuizAnalytics(quizId){
  const quiz = (DB.quizzes || []).find(q => q.id === quizId);
  const totalStudents = (DB.students || []).length;
  const completedCount = (DB.students || []).filter(s => (s.completedQuizzes || []).includes(quizId)).length;

  // Flatten every attempt across every student for this quiz.
  const attempts = [];
  Object.keys(DB.quizHistory || {}).forEach(sid => {
    (DB.quizHistory[sid] || []).forEach(h => { if (h.quizId === quizId) attempts.push(h); });
  });

  const avgScore = attempts.length
    ? Math.round(attempts.reduce((sum, a) => sum + (a.score || 0), 0) / attempts.length)
    : null;

  // Per-question miss-rate — only attempts carrying a `results` array
  // (Phase 5+) contribute. A question's %correct is the average of its
  // fraction across those attempts (so enum/match partial credit shows up
  // as a partial %, not forced into a binary hit/miss).
  const qCount = quiz ? quiz.questions.length : 0;
  const perQuestion = [];
  for (let i = 0; i < qCount; i++) {
    const samples = attempts
      .map(a => (Array.isArray(a.results) ? a.results[i] : undefined))
      .filter(v => typeof v === 'number');
    const pct = samples.length ? Math.round((samples.reduce((s, v) => s + v, 0) / samples.length) * 100) : null;
    perQuestion.push({
      index: i,
      text: quiz.questions[i].q,
      type: eqQType(quiz.questions[i]),
      pctCorrect: pct,
      sampleCount: samples.length,
    });
  }

  return {
    quizId,
    totalStudents,
    completedCount,
    completionRate: totalStudents ? Math.round((completedCount / totalStudents) * 100) : 0,
    attemptCount: attempts.length,
    avgScore,
    perQuestion,
  };
}
window.eqComputeQuizAnalytics = eqComputeQuizAnalytics;

// ═══════════════════════════════════════════════════════════════════════════
//  QUEST BOARD — Phase 4 Helpers (Depth & Retention)
//  quest_board_report.md §3.3 (combo), §3.7 (chains), §3.12 (leaderboard),
//  §7 (retry with escalating stakes). See index.html's quiz runner
//  (startQuiz/quizNext/finishQuiz) and modules/admin/quiz-builder.js (chain
//  fields) for where these get consumed.
// ═══════════════════════════════════════════════════════════════════════════

// eqComboMultiplier(streak) — tiered XP/coin multiplier from the peak
// consecutive-correct streak reached during a quiz attempt (mc/tf/id count
// as a "hit" only on a full 1.0 eqGradeAnswer() result; enum's partial
// credit never counts toward combo — see quizNext() in index.html).
function eqComboMultiplier(streak){
  streak = streak || 0;
  if (streak >= 5) return 2;
  if (streak >= 3) return 1.5;
  return 1;
}
window.eqComboMultiplier = eqComboMultiplier;

// eqIsComboMilestone(streak) — Phase 6 (Improvement Plan §5: "Milestone
// bursts: at streaks like x3, x5, x10 — a distinct particle/pop animation").
// x3 and x5 are one-off call-outs; from x10 on, every +5 (x10, x15, x20...)
// keeps re-celebrating a long run instead of going quiet after the first
// couple of milestones. Used by quizNext() (index.html) to decide whether
// THIS specific grow should also fire a particle burst, not just the pop.
function eqIsComboMilestone(streak){
  return streak === 3 || streak === 5 || (streak >= 10 && streak % 5 === 0);
}
window.eqIsComboMilestone = eqIsComboMilestone;

// eqQuizPassed(score) — single source of truth for the pass/fail threshold,
// used by both the quiz runner's own results screen (finishQuiz()) and the
// Quest Board's node-state treatment (renderStudentQuizzes()) so the two
// can never quietly disagree about what counts as a "pass."
function eqQuizPassed(score){ return score >= 60; }
window.eqQuizPassed = eqQuizPassed;

// eqQuestStars(score) — Phase 61 (Improvement Plan §8: "Star/medal rating
// per quest based on performance — gives a non-exploitable reason to feel
// good about a quest without re-answering it for free score"). Purely a
// display rating derived from the already-stored score; it grants nothing
// and unlocks nothing, so there's no incentive to replay a passed quiz
// just to chase a star. Thresholds sit above eqQuizPassed()'s 60% floor —
// a bare pass is 1 star, not a full sweep.
function eqQuestStars(score){
  score = score || 0;
  if (score >= 90) return 3;
  if (score >= 75) return 2;
  if (score >= 60) return 1;
  return 0;
}
window.eqQuestStars = eqQuestStars;

// eqStreakFireTier(streakCount) — Phase 61 (Improvement Plan §8: "streak-fire
// visual for consecutive quest completions"). Maps the day streak to one of
// three CSS animation tiers (renderStudentQuizzes() sets this as
// data-streak-tier on the Day Streak hero-stat-pill): 'cold' has no flicker
// at all (streak hasn't started or just broke), 'warm' is a gentle flicker
// from day 1, 'hot' kicks in at a week+ to reward sustained streaks with a
// visibly bigger, warmer flame instead of the same animation forever.
function eqStreakFireTier(streakCount){
  streakCount = streakCount || 0;
  if (streakCount >= 7) return 'hot';
  if (streakCount >= 1) return 'warm';
  return 'cold';
}
window.eqStreakFireTier = eqStreakFireTier;

// eqRetryMultiplier(attemptNumber) — Phase 60 (exploit fix — Improvement
// Plan §7). Superseded the old "unlimited retries, ever-shrinking reward"
// curve: 100% / 65% / 40% / 25% flat floor. Attempt 4 and anything that
// manages to run after it (post-cooldown or via teacher override — see
// eqQuizAttemptStatus() below) all earn the same 25% floor; there is
// still real incentive to nail it early, but nothing ever pays out 0%
// just for being a later attempt.
function eqRetryMultiplier(attemptNumber){
  attemptNumber = attemptNumber || 1;
  if (attemptNumber <= 1) return 1;
  if (attemptNumber === 2) return 0.65;
  if (attemptNumber === 3) return 0.40;
  return 0.25;
}
window.eqRetryMultiplier = eqRetryMultiplier;

// Phase 60 (exploit fix) — hard cap of 4 scored attempts per quiz. Every
// CLOSED attempt counts toward this counter, whether it finished (pass or
// fail) or was aborted — see finishQuiz()/abortQuiz() in index.html, both
// of which push a row into DB.quizHistory[studentId]. Switching between
// "answer badly on purpose" and "abort" can't dodge the cap either way.
const QUIZ_MAX_SCORED_ATTEMPTS = 4;
const QUIZ_LOCK_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h, per the plan's suggested default
window.QUIZ_MAX_SCORED_ATTEMPTS = QUIZ_MAX_SCORED_ATTEMPTS;

// eqQuizAttemptStatus(quizId, studentId) → whether a NEW attempt may start
// right now, and what attempt number it would be.
//   { allowed:true,  attemptNumber } — free to start (attempts 1-4, or the
//                                      cooldown has elapsed, or an override
//                                      is on file)
//   { allowed:false, attemptNumber, cooldownEndsAt } — locked; show the
//                                      remaining wait / ask-a-teacher copy
// Phase 63 (exploit fix — closes the gap Phase 60 left open). Phase 60's cap
// + 24h cooldown only ever slowed farming down: attempt 4 and every attempt
// after it, forever, still paid out a flat 25% of XP/coins once the
// cooldown elapsed — including on a quiz the student had already cleared
// with a perfect score. That's an infinite (if slow) source of reward.
// A genuine 100% clear is now a permanent stop, not just another cooldown
// tier — no countdown, no auto-unlock, no re-farming. Aborted attempts
// (h.aborted) never count toward this: an abandoned run that happened to
// have several correct answers locked in before quitting must not trigger
// a lock the student never actually earned. A teacher override still wins
// over the lock (same escape hatch as the cap below), for the rare case a
// teacher deliberately wants a student to redo an already-perfected quiz.
function eqQuizHasPerfected(quizId, studentId){
  const history = ((DB.quizHistory || {})[studentId] || []).filter(h => h.quizId === quizId);
  return history.some(h => !h.aborted && h.score === 100);
}
window.eqQuizHasPerfected = eqQuizHasPerfected;

function eqQuizAttemptStatus(quizId, studentId){
  const history = ((DB.quizHistory || {})[studentId] || []).filter(h => h.quizId === quizId);
  const attemptsSoFar = history.length;
  const nextAttemptNumber = attemptsSoFar + 1;
  const overrides = (DB.quizAttemptOverrides || {})[studentId] || {};

  if (eqQuizHasPerfected(quizId, studentId) && !overrides[quizId]) {
    return { allowed: false, attemptNumber: nextAttemptNumber, locked: true, perfected: true };
  }
  if (attemptsSoFar < QUIZ_MAX_SCORED_ATTEMPTS) {
    return { allowed: true, attemptNumber: nextAttemptNumber, locked: false };
  }
  if (overrides[quizId]) {
    return { allowed: true, attemptNumber: nextAttemptNumber, locked: false, viaOverride: true };
  }
  const last = history[history.length - 1];
  const lastAt = last ? new Date(last.completedAt).getTime() : 0;
  const cooldownEndsAt = lastAt + QUIZ_LOCK_COOLDOWN_MS;
  if (Date.now() >= cooldownEndsAt) {
    return { allowed: true, attemptNumber: nextAttemptNumber, locked: false };
  }
  return { allowed: false, attemptNumber: nextAttemptNumber, locked: true, cooldownEndsAt };
}
window.eqQuizAttemptStatus = eqQuizAttemptStatus;

// eqFormatCooldown(msRemaining) → "2h 14m" / "14m" — small display helper
// for the quest board's locked state and the blocked-start toast.
function eqFormatCooldown(msRemaining){
  const mins = Math.max(1, Math.ceil(msRemaining / 60000));
  const hrs = Math.floor(mins / 60), rem = mins % 60;
  return hrs > 0 ? `${hrs}h ${rem}m` : `${rem}m`;
}
window.eqFormatCooldown = eqFormatCooldown;

// ═══════════════════════════════════════════════════════════════════════════
//  QUEST BOARD — Phase 7: Mascot / Narrator (Improvement Plan §6, §12 item 7)
//
//  Builds on the Phase 4 mascot dock (placeholder orb) and the Phase 3
//  stage backbone (stageIdx). This section is pure data/logic — the actual
//  DOM wiring (fireMascotEvent, updateMascotAmbientMood) lives in index.html
//  next to renderQuizQuestion(), same split as every other quiz-runner
//  helper in this file.
//
//  EMOTION LIBRARY — exactly the 9 poses from §6's trigger table.
// ═══════════════════════════════════════════════════════════════════════════
const MASCOT_EMOTIONS = ['idle','confident','hyped','nervous','scared','hiding','relieved','sad','determined'];
window.MASCOT_EMOTIONS = MASCOT_EMOTIONS;

// Emoji sprite per emotion — matches the app's existing emoji-illustration
// convention (Command Center hero, Quest Board nodes, results screen 🏆/💀)
// rather than standing up a bespoke SVG art pipeline for one component.
const MASCOT_EMOJI = {
  idle:       '🐲',
  confident:  '😎',
  hyped:      '🤩',
  nervous:    '😅',
  scared:     '😱',
  hiding:     '🙈',
  relieved:   '😌',
  sad:        '🥺',
  determined: '💪',
};
window.MASCOT_EMOJI = MASCOT_EMOJI;

// Default line pools (§6: "ships with a default line pool for every event
// out of the box"). Admin-authored lines (MascotLinesService, see
// modules/shared/mascot-lines-service.js) are concatenated ON TOP of these
// in eqMascotLinePool() below — never a replacement — so a partially-
// customized set never leaves an event with nothing to say.
//
// Shape: events that escalate personality by stage (correct/wrong/lowTime)
// are keyed 0/1/2; stageTransition is keyed by the STAGE BEING ENTERED (1
// or 2 — there's no "transition into stage 0"); everything else is a flat
// array.
const MASCOT_DEFAULT_LINES = {
  start: [
    "Let's do this!", "Ready when you are!", "Deep breath — here we go!",
    "New quest, who dis?", "I believe in you!", "Let's make it count!",
  ],
  retry: [
    "Round two — let's go!", "We learn, we adapt, we conquer.",
    "Rolling up my sleeves for this one.", "This time's the one!",
    "Shake it off, here we go again!",
  ],
  correct: {
    0: ["Nice one!", "Yes! Exactly right.", "Smooth!", "You've got this rhythm.", "Clean answer!"],
    1: ["Yes! Keep it up!", "Boom! Right again!", "You're on fire!", "Nailed it — don't stop now!"],
    2: ["YES! INCREDIBLE!", "WOW — no hesitation!", "You're UNSTOPPABLE!", "That's how it's done!!"],
  },
  wrong: {
    0: ["Ah, not quite — shake it off!", "So close! Next one's yours.", "No worries, keep going!"],
    1: ["Whew, tricky one — you got this!", "It's okay! Stay focused.", "Shake it off, eyes forward!"],
    2: ["Yikes! But we push through!", "It's alright — don't panic!", "Deep breath, next one!"],
  },
  milestone: [
    "COMBO! You're on a roll!!", "Unstoppable streak!!", "Look at you go!!",
    "That's a hot streak!", "Keep the fire burning!!",
  ],
  stageTransition: {
    1: ["Ooh, things are heating up...", "Here comes Surge — stay sharp!", "Gear two, engage!"],
    2: ["Uh oh... Overdrive incoming!!", "Hang on tight — final gauntlet!", "This is it — give it everything!"],
  },
  lowTime: {
    0: ["Tick tock, almost there!", "Clock's ticking — you got this!"],
    1: ["Time's running low — hurry!", "Careful, the clock's closing in!"],
    2: ["TIME'S ALMOST UP!! GO GO GO!", "SO LITTLE TIME LEFT!!"],
  },
  pass: [
    "You did it! I'm so proud!", "Quest complete — amazing work!",
    "That's what I call a victory!", "You crushed it!",
  ],
  fail: [
    "Aw, not this time — but you'll get it!", "Every attempt makes you stronger.",
    "Don't worry, we'll get 'em next time.", "Chin up, champ — try again soon!",
  ],
};
window.MASCOT_DEFAULT_LINES = MASCOT_DEFAULT_LINES;

// eqMascotLinePool(event, stageKey) — default pool + any admin-authored
// lines layered on top. window._eqMascotCustomLines is populated once per
// session by MascotLinesService.get() (see startQuiz() in index.html);
// it's simply {} (never undefined/null) until that resolves or if it
// fails, so this always degrades gracefully to defaults-only.
function eqMascotLinePool(event, stageKey){
  const def = MASCOT_DEFAULT_LINES[event];
  const defPool = (stageKey === undefined || stageKey === null)
    ? (Array.isArray(def) ? def : [])
    : ((def && def[stageKey]) || []);
  const customRoot = (window._eqMascotCustomLines && window._eqMascotCustomLines[event]) || null;
  const customPool = (stageKey === undefined || stageKey === null)
    ? (Array.isArray(customRoot) ? customRoot : [])
    : ((customRoot && customRoot[stageKey]) || []);
  return defPool.concat(customPool.filter(l => l && String(l).trim()));
}
window.eqMascotLinePool = eqMascotLinePool;

// eqMascotLine(event, stageKey) — picks one line at random from whatever
// pool applies (§6: "picked at random... so it doesn't repeat identically
// every time"). Returns '' if somehow both default and custom pools are
// empty (never happens for shipped events, but stageTransition/lowTime
// keys are only ever 0/1/2 or 1/2 — a bad key just yields no line, not
// an error).
function eqMascotLine(event, stageKey){
  const pool = eqMascotLinePool(event, stageKey);
  if (!pool.length) return '';
  return pool[Math.floor(Math.random() * pool.length)];
}
window.eqMascotLine = eqMascotLine;

// eqMascotEmotionFor(event, opts) — §6's trigger table, condensed to one
// lookup per ACUTE event (an answer just landed, a stage just changed,
// etc). Ambient/idle body-pose (no event firing) is handled separately by
// updateMascotAmbientMood() in index.html, since that one needs live
// timer state, not just a one-shot event name.
function eqMascotEmotionFor(event, opts){
  opts = opts || {};
  switch (event) {
    case 'start':           return 'idle';
    case 'retry':           return 'determined';
    case 'correct':         return (opts.stageIdx >= 1) ? 'hyped' : 'confident';
    case 'milestone':       return 'hyped';
    case 'wrong':           return (opts.stageIdx >= 2) ? 'scared' : 'nervous';
    case 'stageTransition': return 'hiding';
    case 'lowTime':         return (opts.stageIdx >= 2) ? 'scared' : 'nervous';
    case 'pass':            return 'relieved';
    case 'fail':            return 'sad';
    default:                return 'idle';
  }
}
window.eqMascotEmotionFor = eqMascotEmotionFor;

// eqGrantQuizAttemptOverride(studentId, quizId) — the "teacher/parent
// override to unlock early" escape hatch from the plan. One-time use: it's
// deleted the moment the student actually starts the next attempt with it
// (see startQuiz() in index.html), so it can't be granted once and quietly
// remove the cap forever.
function eqGrantQuizAttemptOverride(studentId, quizId){
  DB = loadDB();
  if (!DB.quizAttemptOverrides) DB.quizAttemptOverrides = {};
  if (!DB.quizAttemptOverrides[studentId]) DB.quizAttemptOverrides[studentId] = {};
  DB.quizAttemptOverrides[studentId][quizId] = true;
  saveDB();
}
window.eqGrantQuizAttemptOverride = eqGrantQuizAttemptOverride;

// eqQuizChain(q) → { chainId, chainOrder, chainLabel } — normalizes the
// three chain fields with safe defaults, same defensive-fallback style as
// eqQuizRarity()/eqQuizCadence() above. A quiz with no chainId is simply
// not part of any chain (the pre-Phase-4 default — nothing old breaks).
function eqQuizChain(q){
  return {
    chainId:    (q && q.chainId) || null,
    chainOrder: (q && Number.isFinite(q.chainOrder)) ? q.chainOrder : 1,
    chainLabel: (q && q.chainLabel) || '',
  };
}
window.eqQuizChain = eqQuizChain;

// eqGetQuestChains() → [{ chainId, chainLabel, quizzes:[q,...] }, ...]
// Groups every chained quiz (chainId set) by chain, sorted by chainOrder.
// Unchained (standing/daily/weekly, no chainId) quizzes never appear here —
// renderStudentQuizzes() in index.html filters them out of the chain
// section and leaves them in the normal grid untouched.
function eqGetQuestChains(){
  const groups = {};
  (DB.quizzes || []).forEach(q => {
    const c = eqQuizChain(q);
    if (!c.chainId) return;
    if (!groups[c.chainId]) groups[c.chainId] = { chainId: c.chainId, chainLabel: c.chainLabel || c.chainId, quizzes: [] };
    if (c.chainLabel && !groups[c.chainId].chainLabel) groups[c.chainId].chainLabel = c.chainLabel;
    groups[c.chainId].quizzes.push(q);
  });
  return Object.values(groups).map(g => {
    g.quizzes.sort((a, b) => eqQuizChain(a).chainOrder - eqQuizChain(b).chainOrder);
    return g;
  });
}
window.eqGetQuestChains = eqGetQuestChains;

// eqChainStatus(chainQuizzes, qid, completedIds) → 'done' | 'unlocked' | 'locked'
// The next unlocked quest in a chain is the first one (in chainOrder) not
// yet in completedIds; everything before it is 'done', everything after
// stays 'locked' until the ones ahead of it clear.
function eqChainStatus(chainQuizzes, qid, completedIds){
  const idx = chainQuizzes.findIndex(q => q.id === qid);
  if (idx === -1) return 'locked';
  if (completedIds.includes(qid)) return 'done';
  const firstIncompleteIdx = chainQuizzes.findIndex(q => !completedIds.includes(q.id));
  return idx === firstIncompleteIdx ? 'unlocked' : 'locked';
}
window.eqChainStatus = eqChainStatus;

// eqWeekStartISO(dateStr?) → 'YYYY-MM-DD' of the Monday starting this
// (Manila-calendar) week. Same week-boundary math eqGetWeeklyQuizId() uses,
// pulled out standalone since eqGetTopQuestersThisWeek() below needs the
// boundary itself (as a resetAt cutoff), not a seeded pick from it.
function eqWeekStartISO(dateStr){
  dateStr = dateStr || isoDate();
  const d = new Date(dateStr + 'T00:00:00');
  const dayIdx = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dayIdx);
  return d.toISOString().slice(0, 10);
}
window.eqWeekStartISO = eqWeekStartISO;

// eqGetTopQuestersThisWeek(classId, limit?) → [{ student, quizCount,
// academicXP, bestScore, rank }, ...]
// quest_board_report.md §3.12 — "pulled from your existing leaderboard
// engine ... without needing a whole new leaderboard system": this reuses
// eqlComputeAcademic() (modules/leaderboard/eql-engine.js) with a rolling
// Monday-boundary resetAt, completely independent of the admin-controlled
// DB.leaderboardConfig.academic.resetAt the Hall of Fame page uses — "this
// week" here always means the current calendar week, not whenever an admin
// last hit reset. Ranked by academicXP (already time-filtered inside
// eqlComputeAcademic), same tiebreaker order the engine itself uses.
function eqGetTopQuestersThisWeek(classId, limit){
  limit = limit || 5;
  if (typeof eqlComputeAcademic !== 'function') return [];
  const resetAt = eqWeekStartISO() + 'T00:00:00.000Z';
  const pool = classId ? (DB.students || []).filter(s => s.classId === classId) : (DB.students || []);
  const entries = pool.map(s => {
    const stats = eqlComputeAcademic(s.id, resetAt);
    return { student: s, quizCount: stats.quizCount, academicXP: stats.academicXP, bestScore: stats.bestScore };
  }).filter(e => e.quizCount > 0);
  entries.sort((a, b) => b.academicXP - a.academicXP || b.quizCount - a.quizCount);
  entries.forEach((e, i) => { e.rank = i + 1; });
  return entries.slice(0, limit);
}
window.eqGetTopQuestersThisWeek = eqGetTopQuestersThisWeek;

