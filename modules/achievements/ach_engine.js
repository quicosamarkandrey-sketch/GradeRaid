// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/achievements/engine.js
//  Achievement engine: rarity constants, stats snapshot, trigger evaluation,
//  check-and-award, claim-time reward granting, sidebar badge, unlock popup,
//  and all trigger-hook patches (finishQuiz, logAttendance, logRecitation,
//  wbcApplyDamage, bootApp).
//
//  NOTE: confirmBuy patch intentionally OMITTED — shop/store.js already calls
//  achCheckAndAward() via typeof guard in cartCheckout(). Patching confirmBuy
//  (the old stub) would double-fire on legacy callers; skip it.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Rarity colour palette ─────────────────────────────────────────────────────

window.ACH_RARITY = {
  Common:    { color: '#9ca3af', glow: 'rgba(156,163,175,0.2)', strip: '#6b7280' },
  Uncommon:  { color: '#4ade80', glow: 'rgba(74,222,128,0.2)',  strip: '#22c55e' },
  Rare:      { color: '#60a5fa', glow: 'rgba(96,165,250,0.2)',  strip: '#3b82f6' },
  Epic:      { color: '#c084fc', glow: 'rgba(192,132,252,0.2)', strip: '#9333ea' },
  Legendary: { color: '#fbbf24', glow: 'rgba(251,191,36,0.3)',  strip: '#f59e0b' },
  Mythic:    { color: '#f472b6', glow: 'rgba(244,114,182,0.3)', strip: '#ec4899' },
};

window.ACH_RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'];

window.ACH_TRIGGER_TYPES = [
  { value: 'level',            label: 'Level Reached',        hint: 'Min level (e.g. 10)' },
  { value: 'xp_earned',        label: 'Total XP Earned',       hint: 'XP amount (e.g. 5000)' },
  { value: 'coins_earned',     label: 'Coins Held',            hint: 'Coin balance (e.g. 1000)' },
  { value: 'coins_spent',      label: 'Coins Spent in Store',  hint: 'Total spent (e.g. 500)' },
  { value: 'quests_completed', label: 'Quests Completed',      hint: 'Quest count (e.g. 5)' },
  { value: 'all_quests',       label: 'All Quests Completed',  hint: 'Set value to 1' },
  { value: 'quiz_score',       label: 'Quiz Score (Best)',      hint: 'Score % (e.g. 100)' },
  { value: 'quiz_avg',         label: 'Quiz Average',           hint: 'Average % (e.g. 90)' },
  { value: 'perfect_streak',   label: 'Perfect Score Streak',   hint: 'Consecutive 100% quizzes' },
  { value: 'boss_victories',   label: 'Boss Victories',          hint: 'Number of bosses defeated' },
  { value: 'boss_damage',      label: 'Total Boss Damage',       hint: 'Total damage dealt' },
  { value: 'boss_crits',       label: 'Critical Hits',           hint: 'Total crit count' },
  { value: 'minions_killed',   label: 'Minions Defeated',        hint: 'Minion kill count' },
  { value: 'attendance_present', label: 'Attendance Present',   hint: 'Present sessions count' },
  { value: 'attendance_pct',   label: 'Attendance Percentage',   hint: 'Attendance % (e.g. 95)' },
  { value: 'store_purchases',  label: 'Store Purchases',         hint: 'Number of items bought' },
  { value: 'recitations',      label: 'Recitation Count',        hint: 'Recitation sessions' },
  { value: 'top_rank',         label: 'Top N Leaderboard',       hint: 'Rank position (e.g. 3 = top 3)' },
  // Phase 4 — quest chains/streak (quest_board_report.md §3.8/§13): stats
  // already computed in achBuildStats() below, just needed a trigger type
  // so admins can actually build a badge off them (same gap class Phase 56
  // closed for db-service.js — a value existing in the stats snapshot with
  // no way to reference it from the admin UI).
  { value: 'quest_chains_completed', label: 'Quest Chains Completed', hint: 'Number of full chains cleared (e.g. 3)' },
  { value: 'quest_streak',     label: 'Quest Board Day Streak',  hint: 'Consecutive active days (e.g. 7)' },
  { value: 'manual',           label: 'Manual (Admin Grant)',    hint: 'Admin manually awards this badge' },
];

window.achRarityClass = function (rarity) {
  return 'ach-rarity-' + (rarity || 'Common').toLowerCase();
};

// ── Stats snapshot ────────────────────────────────────────────────────────────

/**
 * achBuildStats(student) → StatSnapshot  [window.achBuildStats]
 *
 * Builds a live stats object from DB for a given student. Used by achCheckAndAward
 * and achEvaluateTrigger to check all trigger conditions.
 */
window.achBuildStats = function (student) {
  if (!student) return {};
  const sid = student.id;
  let bossVictories = 0, totalBossDmg = 0, totalCrits = 0, totalMinionsKilled = 0;
  Object.values(DB.bossParticipants || {}).forEach(roster => {
    const rec = roster[sid];
    if (rec) {
      totalBossDmg      += (rec.totalDamage     || 0);
      totalCrits        += (rec.critHits         || 0);
      totalMinionsKilled += (rec.minionsDefeated || 0);
    }
  });
  (DB.bossEvents || []).forEach((boss, bi) => {
    if (boss.status === 'ended' || boss.status === 'loot') {
      const roster = (DB.bossParticipants || {})[bi] || {};
      if (roster[sid] && (roster[sid].totalDamage || 0) > 0) bossVictories++;
    }
  });
  const storePurchases  = (DB.redemptions || []).filter(r => r.studentId === sid).length;
  const totalCoinsSpent = (DB.redemptions || []).filter(r => r.studentId === sid).reduce((a, r) => a + (r.pts || 0), 0);
  // BUGFIX (Investigation Report §1): DB.attendanceSessions is a dead
  // local-only array nothing has written to since Phase 1 shipped —
  // real attendance lives in DB.attendanceLogs (Early/On Time/Late = present).
  const attendancePresent = (DB.attendanceLogs || []).filter(r => r.studentId === sid && (r.status === 'Early' || r.status === 'On Time' || r.status === 'Late')).length;
  let bestQuizScore = 0;
  (DB.pointLog || []).filter(e => e.studentId === sid && e.what && e.what.startsWith('Quest:')).forEach(e => {
    const m = e.what.match(/\((\d+)%\)/);
    if (m) { const s = parseInt(m[1]); if (s > bestQuizScore) bestQuizScore = s; }
  });
  const recitationCount = (DB.recitationLog || []).filter(r => r.studentId === sid).length;
  const sorted   = [...DB.students].sort((a, b) => b.xp - a.xp);
  const liveRank = sorted.findIndex(s => s.id === sid) + 1;
  let maxPerfectStreak = 0, currentPerfect = 0;
  [...(DB.pointLog || [])].filter(e => e.studentId === sid && e.what && e.what.startsWith('Quest:')).reverse().forEach(e => {
    const m = e.what.match(/\((\d+)%\)/);
    if (m && parseInt(m[1]) >= 100) { currentPerfect++; if (currentPerfect > maxPerfectStreak) maxPerfectStreak = currentPerfect; }
    else currentPerfect = 0;
  });
  // Phase 4 — quest chains completed (quest_board_report.md §3.8/§13):
  // a chain counts as done when every one of its quizzes is in
  // completedQuizzes. Reuses eqGetQuestChains()/eqQuizChain() (utils.js) —
  // same grouping the student board itself renders from, so "chain done"
  // here always matches what the student actually sees clear on the board.
  const completedIds = student.completedQuizzes || [];
  const chainsCompleted = (typeof eqGetQuestChains === 'function')
    ? eqGetQuestChains().filter(c => c.quizzes.length && c.quizzes.every(q => completedIds.includes(q.id))).length
    : 0;
  // Phase 4 — current quest-board day streak (quest_board_report.md §1/§13),
  // reusing the same computeQuestStreak() the board itself displays, so an
  // achievement tied to it always agrees with what the student sees.
  const questStreak = (typeof computeQuestStreak === 'function') ? computeQuestStreak(sid).current : 0;
  return {
    level:              student.level       || 0,
    xp:                 student.xp          || 0,
    coins:              student.coins       || 0,
    attendance:         student.attendance  || 0,
    quizAvg:            student.quizAvg     || 0,
    quests_completed:   (student.completedQuizzes || []).length,
    total_quests:       (DB.quizzes || []).length,
    boss_victories:     bossVictories,
    boss_damage:        totalBossDmg,
    boss_crits:         totalCrits,
    minions_killed:     totalMinionsKilled,
    store_purchases:    storePurchases,
    coins_spent:        totalCoinsSpent,
    attendance_present: attendancePresent,
    best_quiz_score:    bestQuizScore,
    recitation_count:   recitationCount,
    live_rank:          liveRank,
    perfect_streak:     maxPerfectStreak,
    student_count:      DB.students.length,
    quest_chains_completed: chainsCompleted,
    quest_streak:       questStreak,
  };
};

// ── Trigger evaluator (private) ───────────────────────────────────────────────

function achEvaluateTrigger(ach, stats) {
  if (!ach || !ach.triggerType || !ach.active) return false;
  const v = parseFloat(ach.triggerValue) || 0;
  switch (ach.triggerType) {
    case 'level':              return stats.level              >= v;
    case 'xp_earned':         return stats.xp                 >= v;
    case 'coins_earned':      return stats.coins               >= v;
    case 'coins_spent':       return stats.coins_spent         >= v;
    case 'quests_completed':  return stats.quests_completed    >= v;
    case 'all_quests':        return stats.total_quests > 0 && stats.quests_completed >= stats.total_quests;
    case 'quiz_score':        return stats.best_quiz_score     >= v;
    case 'quiz_avg':          return stats.quizAvg             >= v;
    case 'perfect_streak':    return stats.perfect_streak      >= v;
    case 'boss_victories':    return stats.boss_victories      >= v;
    case 'boss_damage':       return stats.boss_damage         >= v;
    case 'boss_crits':        return stats.boss_crits          >= v;
    case 'minions_killed':    return stats.minions_killed      >= v;
    case 'attendance_present':return stats.attendance_present  >= v;
    case 'attendance_pct':    return stats.attendance          >= v;
    case 'store_purchases':   return stats.store_purchases     >= v;
    case 'recitations':       return stats.recitation_count    >= v;
    case 'top_rank':          return stats.live_rank > 0 && stats.live_rank <= v;
    case 'quest_chains_completed': return stats.quest_chains_completed >= v;
    case 'quest_streak':      return stats.quest_streak        >= v;
    case 'manual':            return false;
    default:                  return false;
  }
}

// ── Core check-and-award ──────────────────────────────────────────────────────

/**
 * achCheckAndAward(studentId, suppressPopup) → void  [window.achCheckAndAward]
 *
 * Evaluates all active achievements for a student. For each newly met trigger:
 *   DB.achievementUnlocks[sid].push({ achId, unlockedAt, xpGranted, coinsGranted,
 *                                      claimed: false, claimedAt: null })
 * NOTE: Rewards are NOT granted here — only granted when student clicks Claim.
 * On new unlocks: saveDB(), achUpdateSidebarBadge(), optionally achShowUnlockPopup().
 *
 * Called by: recitation/logger.js, attendance/scanner.js, shop/store.js,
 *            quiz engine, wbcApplyDamage, bootApp — all via typeof guard or direct.
 */
window.achCheckAndAward = function (studentId, suppressPopup) {
  if (!studentId) return;
  DB = loadDB();
  const sIdx = DB.students.findIndex(s => s.id === studentId);
  if (sIdx < 0) return;
  const student = DB.students[sIdx];
  const stats   = achBuildStats(student);

  if (!DB.achievementUnlocks)           DB.achievementUnlocks = {};
  if (!DB.achievementUnlocks[studentId]) DB.achievementUnlocks[studentId] = [];

  const alreadyUnlocked = new Set(DB.achievementUnlocks[studentId].map(u => u.achId));
  const newlyUnlocked   = [];

  // Phase 16: same section-scoping as renderBadges() (student-page.js) —
  // a badge assigned to specific section(s) should not auto-unlock for a
  // student outside those sections. Unassigned badges (no rows in
  // achievementSectionAssignments) stay global, matching the "opt-in
  // scoping" convention used for quiz/mail section assignment too.
  const sectionAssignments = DB.achievementSectionAssignments || {};
  const myClassId          = student.classId || 'default-class';

  (DB.achievements || []).forEach(ach => {
    if (!ach.active || alreadyUnlocked.has(ach.id)) return;
    const assignedSections = sectionAssignments[ach.id];
    if (assignedSections && assignedSections.length > 0 && !assignedSections.includes(myClassId)) return;
    if (!achEvaluateTrigger(ach, stats)) return;
    DB.achievementUnlocks[studentId].push({
      achId:         ach.id,
      unlockedAt:    new Date().toISOString(),
      xpGranted:     parseInt(ach.xpReward)   || 0,
      coinsGranted:  parseInt(ach.coinReward) || 0,
      claimed:       false,
      claimedAt:     null,
    });
    // Phase 17: record the unlock server-side too (claimed:false, 0/0 —
    // actual xp/coins are stamped at claim time by
    // syncAchievementClaimToServer). Fire-and-forget, same posture as
    // syncStudentStatsToServer elsewhere in this file.
    syncAchievementUnlockToServer(studentId, ach.id, 0, 0, false, myClassId);
    newlyUnlocked.push(ach);
  });

  if (newlyUnlocked.length) {
    currentUser = DB.students[sIdx];
    saveDB();
    achUpdateSidebarBadge();
    if (!suppressPopup) newlyUnlocked.forEach((ach, i) => setTimeout(() => achShowUnlockPopup(ach), i * 1400));
  }
};

// ── Claim-time reward granting ────────────────────────────────────────────────

/**
 * achGrantRewardsForClaim(studentId, achId) → { xp, coins } | false
 * [window.achGrantRewardsForClaim]
 *
 * Called from achClaimReward (student-page.js) and achAdminDoGrant (admin-page.js).
 * Grants XP + coins to student, marks unlock as claimed.
 * Returns { xp, coins } on success, false if already claimed.
 */
window.achGrantRewardsForClaim = function (studentId, achId) {
  DB = loadDB();
  const sIdx = DB.students.findIndex(s => s.id === studentId);
  if (sIdx < 0) return false;
  const unlockList = DB.achievementUnlocks[studentId] || [];
  const unlockRec  = unlockList.find(u => u.achId === achId);
  if (!unlockRec || unlockRec.claimed) return false;

  const xpGrant   = parseInt(unlockRec.xpGranted)   || 0;
  const coinGrant = parseInt(unlockRec.coinsGranted) || 0;
  DB.students[sIdx].xp    += xpGrant;
  DB.students[sIdx].coins += coinGrant;
  syncStudentStatsToServer(studentId, xpGrant, coinGrant);
  syncAchievementClaimToServer(studentId, achId, xpGrant, coinGrant);
  unlockRec.claimed   = true;
  unlockRec.claimedAt = new Date().toISOString();

  if (xpGrant > 0 || coinGrant > 0) {
    const achName = (DB.achievements || []).find(a => a.id === achId)?.name || 'Achievement';
    DB.pointLog.unshift({ id: 'pl_' + uid(), studentId, what: `🏅 Achievement Claimed: ${achName}`, pts: coinGrant || xpGrant, when: 'Just now', createdAt: new Date().toISOString() });
  }
  currentUser = DB.students[sIdx];
  saveDB();
  achUpdateSidebarBadge();
  updateTopbar();
  return { xp: xpGrant, coins: coinGrant };
};

// ── Sidebar badge ─────────────────────────────────────────────────────────────

/**
 * achUpdateSidebarBadge() → void  [window.achUpdateSidebarBadge]
 * Shows unclaimed achievement count on #nav-s-badges.
 */
window.achUpdateSidebarBadge = function () {
  if (currentRole !== 'student' || !currentUser) return;
  DB = loadDB();
  const unlocks       = (DB.achievementUnlocks || {})[currentUser.id] || [];
  const unclaimedCount = unlocks.filter(u => !u.claimed).length;
  const btn            = document.getElementById('nav-s-badges');
  if (!btn) return;
  let badge = btn.querySelector('.ach-nav-badge');
  if (unclaimedCount > 0) {
    if (!badge) {
      badge             = document.createElement('span');
      badge.className   = 'ach-nav-badge';
      badge.style.cssText = 'margin-left:auto;background:rgba(208,188,255,0.2);border:1px solid rgba(208,188,255,0.3);border-radius:10px;padding:1px 7px;font-size:10px;font-weight:800;color:var(--primary);font-family:var(--fh)';
      btn.appendChild(badge);
    }
    badge.textContent = unclaimedCount > 99 ? '99+' : String(unclaimedCount);
  } else {
    if (badge) badge.remove();
  }
};

// ── Unlock popup ──────────────────────────────────────────────────────────────

/**
 * achShowUnlockPopup(ach) → void  [window.achShowUnlockPopup]
 * Shows a floating popup in the bottom-right corner. Tapping it navigates to
 * s-badges. Auto-dismisses after 4.5s.
 */
window.achShowUnlockPopup = function (ach) {
  const rarity   = ACH_RARITY[ach.rarity] || ACH_RARITY.Common;
  const existing = document.getElementById('ach-unlock-popup');
  if (existing) existing.remove();

  const d    = document.createElement('div');
  d.id        = 'ach-unlock-popup';
  d.className = 'ach-unlock-popup';
  d.style.cssText = `border-color:${rarity.color}55;box-shadow:0 8px 40px ${rarity.glow};cursor:pointer`;

  const hasRewards = (ach.xpReward || 0) > 0 || (ach.coinReward || 0) > 0;
  d.innerHTML = `
    <div class="ach-popup-icon">${ach.icon || '🏅'}</div>
    <div style="flex:1">
      <div class="ach-popup-title" style="color:${rarity.color}">✨ Achievement Unlocked!</div>
      <div class="ach-popup-name">${_esc(ach.name)}</div>
      <div class="ach-popup-rewards" style="color:var(--text-muted)">${hasRewards ? 'Tap to claim rewards →' : 'View in Achievements'}</div>
    </div>
    <div style="width:8px;height:8px;border-radius:50%;background:${rarity.color};box-shadow:0 0 8px ${rarity.color};flex-shrink:0;margin-top:4px;animation:achBadgePulse 1.5s ease-in-out infinite"></div>`;

  d.addEventListener('click', () => {
    d.style.animation = 'achPopOut .4s ease forwards';
    setTimeout(() => { d.remove(); navTo('s-badges'); }, 400);
  });
  document.body.appendChild(d);
  setTimeout(() => {
    if (d.parentNode) { d.style.animation = 'achPopOut .4s ease forwards'; setTimeout(() => d.remove(), 400); }
  }, 4500);
};

// ── Trigger-hook patches ──────────────────────────────────────────────────────
// These replace the monolith's patch IIFEs. Each wraps an existing global.

// finishQuiz → achCheckAndAward
;(function () {
  const _orig = window.finishQuiz;
  window.finishQuiz = function () {
    if (typeof _orig === 'function') _orig();
    if (currentUser && currentRole === 'student') setTimeout(() => achCheckAndAward(currentUser.id), 500);
  };
})();

// logAttendance → achCheckAndAward (bulk-safe)
;(function () {
  const _orig = window.logAttendance;
  window.logAttendance = function (status) {
    if (typeof _orig === 'function') _orig(status);
    const sid     = document.getElementById('att-student')?.value;
    const targets = sid === 'all' ? DB.students.map(s => s.id) : [sid];
    setTimeout(() => targets.forEach(id => achCheckAndAward(id, true)), 400);
  };
})();

// logRecitation → achCheckAndAward
;(function () {
  const _orig = window.logRecitation;
  window.logRecitation = function () {
    if (typeof _orig === 'function') _orig();
    const sid = document.getElementById('rec-student')?.value;
    if (sid) setTimeout(() => achCheckAndAward(sid, true), 400);
  };
})();

// wbcApplyDamage → achCheckAndAward (world-boss module; typeof guard)
;(function () {
  const _orig = window.wbcApplyDamage;
  window.wbcApplyDamage = function (bossIdx, damage, studentId) {
    const result = typeof _orig === 'function' ? _orig(bossIdx, damage, studentId) : undefined;
    if (studentId) setTimeout(() => achCheckAndAward(studentId), 400);
    return result;
  };
})();

// bootApp → achCheckAndAward on student login
// bootApp → achCheckAndAward on student login
;(function () {
  const _orig = window.bootApp;
  window.bootApp = function () {
    if (typeof _orig === 'function') _orig();
    // Use getCurrentRole() and getCurrentUser() instead of raw globals
    if (getCurrentRole() === 'student' && getCurrentUser()) {
       setTimeout(() => achCheckAndAward(getCurrentUser().id), 400);
    }
  };
})();

console.log('[EduQuest] achievements/engine.js loaded — ACH_RARITY, achBuildStats, achCheckAndAward, achGrantRewardsForClaim, achUpdateSidebarBadge, achShowUnlockPopup registered. Trigger hooks patched.');

// ── Pub/Sub: Cross-module reactivity ─────────────────────────────────────────
AppStore.subscribe('ach-engine-state-sync', function (state, event) {
  const watchedEvents = [
    'attendance:logged',
    'recitation:logged',
    'loot:claimed',
    'xp:awarded',
    'state:legacy-sync',
  ];
  if (!watchedEvents.includes(event.type)) return;

  const studentId = event.payload && event.payload.studentId;
  if (studentId && typeof achCheckAndAward === 'function') {
    setTimeout(function () { achCheckAndAward(studentId, true); }, 400);
  }
  if (typeof achUpdateSidebarBadge === 'function') achUpdateSidebarBadge();
});
