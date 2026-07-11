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

