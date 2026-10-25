// src/modules/achievements/ach_engine.js — real-ESM twin of
// ../../../modules/achievements/ach_engine.js.
// Phase 7 (Stream D), file 1/30. Original stays untouched.
//
// All 11 top-level declared symbols exported, matching declaresCount 11
// exactly (dist/dependency-map.json): 9 that were `window.X = ...`
// assignments in the classic script (ACH_RARITY, ACH_RARITIES,
// ACH_TRIGGER_TYPES, achRarityClass, achBuildStats, achCheckAndAward,
// achGrantRewardsForClaim, achUpdateSidebarBadge, achShowUnlockPopup) plus
// 2 plain top-level function declarations (achEvaluateTrigger,
// _achCheckAndAwardCore). The 2 "private" ones ARE real globals in the
// classic script (top-level function declarations become window
// properties), so they're exported and bridged like the rest.
//
// Whole-value `window.X = <value>` -> `export const X = <value>`, same
// convention as the other converted files (see e.g.
// src/modules/shared/reward-presenter.js). No redundant `window.X = X` in
// src/ — only the bridge re-attaches.
//
// Everything outside this file stays bare-identifier window fallback per
// the global rule: AppStore, uid, _esc, navTo, updateTopbar,
// getCurrentRole/getCurrentUser, eqGetQuestChains, computeQuestStreak,
// syncStudentStatsToServer, syncAchievementUnlockToServer,
// syncAchievementClaimToServer, and the currentUser/currentRole bindings
// from index.html's inline block. `currentUser = ...` (two sites) is a
// bare-global assignment, kept verbatim — same as src/modules/admin/
// student-manager.js — it targets the existing top-level binding.
//
// One deliberate semantic note: inside this file, calls to this file's own
// exports (achCheckAndAward from the subscribers, achBuildStats from the
// core, ACH_RARITY from the popup, ...) now bind to the module's own
// exports instead of resolving through `window` at call time. That only
// differs if something reassigns window.<name> AFTER load. Checked
// codebase-wide: the only reassignment of any of these is
// modules/world-boss/titles_sidebar_refresh.js:183 (window.achCheckAndAward
// wrapper), and that file is NOT loaded by index.html (the live
// modules/titles/titles_sidebar_refresh.js was already moved to an
// AppStore event instead — unit test ach-check-and-award-event.test.js
// asserts exactly that). No live behavior difference.
//
// Load-time side effects (4 AppStore.subscribe() calls + 1 console.log)
// are preserved in place, in original order.

// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/achievements/engine.js
//  Achievement engine: rarity constants, stats snapshot, trigger evaluation,
//  check-and-award, claim-time reward granting, sidebar badge, unlock popup,
//  plus the pub/sub subscribers below. All 5 of the Event-Driven
//  Communication phase's target functions (roadmap Phase 4) are now
//  converted or resolved: finishQuiz, logRecitation, and wbcApplyDamage
//  became AppStore.subscribe() handlers; the logAttendance patch was
//  removed as dead code (its intent restored via the real live attendance
//  events instead); bootApp's 6 live patches (across this file and 5
//  others) converted to AppStore.emit()-driven subscribers.
//
//  NOTE: confirmBuy patch intentionally OMITTED — shop/store.js already calls
//  achCheckAndAward() via typeof guard in cartCheckout(). Patching confirmBuy
//  (the old stub) would double-fire on legacy callers; skip it.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Rarity colour palette ─────────────────────────────────────────────────────

export const ACH_RARITY = {
  Common:    { color: '#9ca3af', glow: 'rgba(156,163,175,0.2)', strip: '#6b7280' },
  Uncommon:  { color: '#4ade80', glow: 'rgba(74,222,128,0.2)',  strip: '#22c55e' },
  Rare:      { color: '#60a5fa', glow: 'rgba(96,165,250,0.2)',  strip: '#3b82f6' },
  Epic:      { color: '#c084fc', glow: 'rgba(192,132,252,0.2)', strip: '#9333ea' },
  Legendary: { color: '#fbbf24', glow: 'rgba(251,191,36,0.3)',  strip: '#f59e0b' },
  Mythic:    { color: '#f472b6', glow: 'rgba(244,114,182,0.3)', strip: '#ec4899' },
};

export const ACH_RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'];

export const ACH_TRIGGER_TYPES = [
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

export const achRarityClass = function (rarity) {
  return 'ach-rarity-' + (rarity || 'Common').toLowerCase();
};

// ── Stats snapshot ────────────────────────────────────────────────────────────

/**
 * achBuildStats(student) → StatSnapshot  [window.achBuildStats]
 *
 * Builds a live stats object from AppStore for a given student. Used by achCheckAndAward
 * and achEvaluateTrigger to check all trigger conditions.
 */
export const achBuildStats = function (student) {
  if (!student) return {};
  const sid = student.id;
  let bossVictories = 0, totalBossDmg = 0, totalCrits = 0, totalMinionsKilled = 0;
  Object.values(AppStore.getSlice(s => s.bossParticipants) || {}).forEach(roster => {
    const rec = roster[sid];
    if (rec) {
      totalBossDmg      += (rec.totalDamage     || 0);
      totalCrits        += (rec.critHits         || 0);
      totalMinionsKilled += (rec.minionsDefeated || 0);
    }
  });
  const bossParticipants = AppStore.getSlice(s => s.bossParticipants) || {};
  (AppStore.getSlice(s => s.bossEvents) || []).forEach((boss, bi) => {
    if (boss.status === 'ended' || boss.status === 'loot') {
      const roster = bossParticipants[bi] || {};
      if (roster[sid] && (roster[sid].totalDamage || 0) > 0) bossVictories++;
    }
  });
  const redemptions = AppStore.getSlice(s => s.redemptions) || [];
  const storePurchases  = redemptions.filter(r => r.studentId === sid).length;
  const totalCoinsSpent = redemptions.filter(r => r.studentId === sid).reduce((a, r) => a + (r.pts || 0), 0);
  // BUGFIX (Investigation Report §1): DB.attendanceSessions is a dead
  // local-only array nothing has written to since Phase 1 shipped —
  // real attendance lives in the attendanceLogs slice (Early/On Time/Late = present).
  const attendancePresent = (AppStore.getSlice(s => s.attendanceLogs) || []).filter(r => r.studentId === sid && (r.status === 'Early' || r.status === 'On Time' || r.status === 'Late')).length;
  let bestQuizScore = 0;
  const pointLog = AppStore.getSlice(s => s.pointLog) || [];
  pointLog.filter(e => e.studentId === sid && e.what && e.what.startsWith('Quest:')).forEach(e => {
    const m = e.what.match(/\((\d+)%\)/);
    if (m) { const s = parseInt(m[1]); if (s > bestQuizScore) bestQuizScore = s; }
  });
  const recitationCount = (AppStore.getSlice(s => s.recitationLog) || []).filter(r => r.studentId === sid).length;
  const sorted   = [...(AppStore.getSlice(s => s.students) || [])].sort((a, b) => b.xp - a.xp);
  const liveRank = sorted.findIndex(s => s.id === sid) + 1;
  let maxPerfectStreak = 0, currentPerfect = 0;
  [...pointLog].filter(e => e.studentId === sid && e.what && e.what.startsWith('Quest:')).reverse().forEach(e => {
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
    total_quests:       (AppStore.getSlice(s => s.quizzes) || []).length,
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
    student_count:      sorted.length,
    quest_chains_completed: chainsCompleted,
    quest_streak:       questStreak,
  };
};

// ── Trigger evaluator (private) ───────────────────────────────────────────────

export function achEvaluateTrigger(ach, stats) {
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
 *   the achievementUnlocks slice for sid gets pushed({ achId, unlockedAt, xpGranted, coinsGranted,
 *                                      claimed: false, claimedAt: null })
 * NOTE: Rewards are NOT granted here — only granted when student clicks Claim.
 * On new unlocks: saveDB(), achUpdateSidebarBadge(), optionally achShowUnlockPopup().
 *
 * Called by: recitation/logger.js, attendance/scanner.js, shop/store.js,
 *            quiz engine, wbcApplyDamage, bootApp — all via typeof guard or direct.
 */
export const achCheckAndAward = function (studentId, suppressPopup) {
  _achCheckAndAwardCore(studentId, suppressPopup);
  // Event-Driven Communication (Continuation Plan §3, Category A —
  // achCheckAndAward-as-title-hook, highest blast radius on the list:
  // achCheckAndAward is called directly from ~8 places across the app —
  // campaign_engine.js, combat-settings.js, shop_store.js,
  // shop_pos_terminal.js, plus this file's own subscribers below — none of
  // which needed to change, since all of them call the single global
  // achCheckAndAward and this wrapper is now the only thing that name
  // resolves to. Wrapping the whole function (rather than emitting from
  // _achCheckAndAwardCore's own tail) preserves the old monkey-patch's
  // "always runs after the original, regardless of which internal branch
  // fired" semantics exactly — same reasoning as navTo/renderAnalytics:
  // the old patch in titles_sidebar_refresh.js called `_orig(studentId,
  // suppressPopup)` first and ran its own title-unlock scan unconditionally
  // afterward (guarded only by its own `if (!studentId) return`), even on
  // _achCheckAndAwardCore's early returns (no studentId, unknown student,
  // or zero newly-unlocked achievements this call — that last one matters:
  // an admin can link a title to an achievement AFTER a student already
  // unlocked it, so a later achCheckAndAward() call that finds nothing NEW
  // to unlock still needs to let the title-scan catch up on titles linked
  // after the fact). The existing 'achievements:unlocked' event (emitted a
  // few lines up) does NOT cover that catch-up case — it only fires when
  // newlyUnlocked.length > 0 — so a dedicated event was needed here rather
  // than reusing it.
  AppStore.emit({ type: 'achievements:check-and-award-ran', payload: { studentId, suppressPopup } });
};

export function _achCheckAndAwardCore(studentId, suppressPopup) {
  if (!studentId) return;
  const student = (AppStore.getSlice(s => s.students) || []).find(s => s.id === studentId);
  if (!student) return;
  const stats   = achBuildStats(student);

  const alreadyUnlocked = new Set(((AppStore.getSlice(s => s.achievementUnlocks) || {})[studentId] || []).map(u => u.achId));

  // Phase 16: same section-scoping as renderBadges() (student-page.js) —
  // a badge assigned to specific section(s) should not auto-unlock for a
  // student outside those sections. Unassigned badges (no rows in
  // achievementSectionAssignments) stay global, matching the "opt-in
  // scoping" convention used for quiz/mail section assignment too.
  const sectionAssignments = AppStore.getSlice(s => s.achievementSectionAssignments) || {};
  const myClassId          = student.classId || 'default-class';

  const newlyUnlocked = (AppStore.getSlice(s => s.achievements) || []).filter(ach => {
    if (!ach.active || alreadyUnlocked.has(ach.id)) return false;
    const assignedSections = sectionAssignments[ach.id];
    if (assignedSections && assignedSections.length > 0 && !assignedSections.includes(myClassId)) return false;
    return achEvaluateTrigger(ach, stats);
  });

  if (!newlyUnlocked.length) return;

  AppStore.updateState(draft => {
    if (!draft.achievementUnlocks) draft.achievementUnlocks = {};
    if (!draft.achievementUnlocks[studentId]) draft.achievementUnlocks[studentId] = [];
    newlyUnlocked.forEach(ach => {
      draft.achievementUnlocks[studentId].push({
        achId:         ach.id,
        unlockedAt:    new Date().toISOString(),
        xpGranted:     parseInt(ach.xpReward)   || 0,
        coinsGranted:  parseInt(ach.coinReward) || 0,
        claimed:       false,
        claimedAt:     null,
      });
    });
  }, { type: 'achievements:unlocked', payload: { studentId, achIds: newlyUnlocked.map(a => a.id) } });

  // Phase 17: record the unlock server-side too (claimed:false, 0/0 —
  // actual xp/coins are stamped at claim time by
  // syncAchievementClaimToServer). Fire-and-forget, same posture as
  // syncStudentStatsToServer elsewhere in this file.
  newlyUnlocked.forEach(ach => syncAchievementUnlockToServer(studentId, ach.id, 0, 0, false, myClassId));

  // [Preserved from pre-migration behavior, not introduced by this
  // migration] This reassigns currentUser unconditionally, even when
  // studentId isn't the logged-in session's own id (achCheckAndAward is
  // sometimes called for other students — e.g. every boss-fight
  // participant in combat-settings.js). Whether that's correct for those
  // call sites is a pre-existing question, not something this phase's
  // storage-layer migration should silently change.
  currentUser = (AppStore.getSlice(s => s.students) || []).find(s => s.id === studentId);
  achUpdateSidebarBadge();
  if (!suppressPopup) newlyUnlocked.forEach((ach, i) => setTimeout(() => achShowUnlockPopup(ach), i * 1400));
}

// ── Claim-time reward granting ────────────────────────────────────────────────

/**
 * achGrantRewardsForClaim(studentId, achId) → { xp, coins } | false
 * [window.achGrantRewardsForClaim]
 *
 * Called from achClaimReward (student-page.js) and achAdminDoGrant (admin-page.js).
 * Grants XP + coins to student, marks unlock as claimed.
 * Returns { xp, coins } on success, false if already claimed.
 */
export const achGrantRewardsForClaim = function (studentId, achId) {
  const existingUnlock = ((AppStore.getSlice(s => s.achievementUnlocks) || {})[studentId] || []).find(u => u.achId === achId);
  if (!existingUnlock || existingUnlock.claimed) return false;

  const xpGrant   = parseInt(existingUnlock.xpGranted)   || 0;
  const coinGrant = parseInt(existingUnlock.coinsGranted) || 0;
  const achName   = (AppStore.getSlice(s => s.achievements) || []).find(a => a.id === achId)?.name || 'Achievement';

  let updatedStudent = null;
  AppStore.updateState(draft => {
    const s = (draft.students || []).find(x => x.id === studentId);
    if (!s) return;
    s.xp    = (s.xp || 0) + xpGrant;
    s.coins = (s.coins || 0) + coinGrant;

    const unlockRec = ((draft.achievementUnlocks || {})[studentId] || []).find(u => u.achId === achId);
    if (unlockRec) { unlockRec.claimed = true; unlockRec.claimedAt = new Date().toISOString(); }

    if (xpGrant > 0 || coinGrant > 0) {
      if (!Array.isArray(draft.pointLog)) draft.pointLog = [];
      draft.pointLog.unshift({ id: 'pl_' + uid(), studentId, what: `🏅 Achievement Claimed: ${achName}`, pts: coinGrant || xpGrant, when: 'Just now', createdAt: new Date().toISOString() });
    }
    updatedStudent = s;
  }, { type: 'achievements:claimed', payload: { studentId, achId } });

  if (!updatedStudent) return false; // student or unlock record vanished between the pre-check and the update

  syncStudentStatsToServer(studentId, xpGrant, coinGrant);
  syncAchievementClaimToServer(studentId, achId, xpGrant, coinGrant);

  currentUser = updatedStudent;
  achUpdateSidebarBadge();
  updateTopbar();
  return { xp: xpGrant, coins: coinGrant };
};

// ── Sidebar badge ─────────────────────────────────────────────────────────────

/**
 * achUpdateSidebarBadge() → void  [window.achUpdateSidebarBadge]
 * Shows unclaimed achievement count on #nav-s-badges.
 */
export const achUpdateSidebarBadge = function () {
  if (currentRole !== 'student' || !currentUser) return;
  const unlocks       = (AppStore.getSlice(s => s.achievementUnlocks) || {})[currentUser.id] || [];
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
export const achShowUnlockPopup = function (ach) {
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

// finishQuiz → achCheckAndAward: now handled by the dedicated
// 'ach-engine-quiz-finished' subscriber below (not folded into the shared
// 'ach-engine-state-sync' handler — that one hardcodes suppressPopup=true,
// but a quiz is the student's own foreground action, so the original patch
// left the popup showing. Folding this in would have silently killed it.)

// logAttendance → achCheckAndAward: this patch was dead code, not a live
// conversion target. Nothing in the codebase calls logAttendance() (grepped
// the whole repo — zero hits outside this file) or emits 'attendance:logged'
// (same — zero hits). The real, live attendance system
// (modules/attendance/attendance-service.js) uses a completely different
// event name, 'attendance:scan-recorded', which this patch never hooked —
// attendance-triggered achievement checks were silently non-functional,
// likely since attendance moved to RFID scanning and this patch was never
// updated to match. That gap is now closed: see the pub/sub subscriber
// below, which watches 'attendance:scan-recorded'/'attendance:override'.

// logRecitation → achCheckAndAward: now handled entirely by the
// AppStore.subscribe('ach-engine-state-sync', ...) pub/sub handler below,
// which watches 'recitation:logged' (see logger.js's AppStore.updateState()
// call). The monkey-patch that used to live here duplicated that handler —
// both fired achCheckAndAward(sid, true) on every recitation log. Removed
// as part of the Event-Driven Communication phase (roadmap Phase 4).

// wbcApplyDamage → achCheckAndAward, per hit: this used to be a monkey-patch
// that NEVER ACTUALLY RAN — index.html loads ach_engine.js (807) before
// combat-settings.js (853), so by the time this patch's IIFE captured
// `_orig = window.wbcApplyDamage`, nothing had defined it yet (_orig was
// undefined). combat-settings.js then OVERWRITES window.wbcApplyDamage
// outright (it doesn't chain via _orig), silently discarding this patch for
// good. Net effect: boss_damage/boss_crits achievements — the two trigger
// types that are running totals crossable on ANY hit, not just a kill —
// never got checked until some unrelated trigger happened to fire later.
// Restored here as a real subscriber on the events wbcApplyDamage actually
// emits (see combat-settings.js's own AppStore.updateState() call), on both
// a normal hit and the killing blow — a crit landed as the finishing hit
// should still count toward boss_crits. No suppressPopup, matching the
// original patch and the finishQuiz/session-booted precedent: dealing damage
// in a live raid is the student's own real-time action.
AppStore.subscribe('ach-engine-boss-damage', function (state, event) {
  if (event.type !== 'world-boss:damage-applied' && event.type !== 'world-boss:defeated') return;
  const studentId = event.payload && event.payload.studentId;
  if (studentId) setTimeout(() => achCheckAndAward(studentId), 400);
});

// session:booted → achCheckAndAward: dedicated subscriber, not folded into
// the shared 'ach-engine-state-sync' one — this patch never passed
// suppressPopup, so a login that pushes a student over an achievement
// threshold shows the unlock popup (matches the finishQuiz precedent above).
AppStore.subscribe('ach-engine-session-booted', function (state, event) {
  if (event.type !== 'session:booted') return;
  if (getCurrentRole() === 'student' && getCurrentUser()) {
    setTimeout(() => achCheckAndAward(getCurrentUser().id), 400);
  }
});

console.log('[EduQuest] achievements/engine.js loaded — ACH_RARITY, achBuildStats, achCheckAndAward, achGrantRewardsForClaim, achUpdateSidebarBadge, achShowUnlockPopup registered. Trigger hooks patched.');

// ── Pub/Sub: Cross-module reactivity ─────────────────────────────────────────
AppStore.subscribe('ach-engine-state-sync', function (state, event) {
  const watchedEvents = [
    'recitation:logged',
    'loot:claimed',
    'xp:awarded',
    'state:legacy-sync',
    // Fills the gap left by the removed dead logAttendance patch — these are
    // the real, live events attendance-service.js emits for the two
    // attendance-based achievement trigger types (attendance_present,
    // attendance_pct). attendance:session-closed is deliberately NOT
    // watched: it's a bulk absence-sweep, and marking someone absent can
    // only decrease those stats, never newly cross an unlock threshold —
    // checking there would be a guaranteed no-op every time.
    'attendance:scan-recorded',
    'attendance:override',
  ];
  if (!watchedEvents.includes(event.type)) return;

  // A duplicate re-scan (student already logged today) changed nothing —
  // skip the check rather than fire it for no reason.
  if (event.type === 'attendance:scan-recorded' && event.payload && event.payload.alreadyRecorded) return;

  const studentId = event.payload && event.payload.studentId;
  if (studentId && typeof achCheckAndAward === 'function') {
    setTimeout(function () { achCheckAndAward(studentId, true); }, 400);
  }
  if (typeof achUpdateSidebarBadge === 'function') achUpdateSidebarBadge();
});

// Separate from the subscriber above on purpose — see the comment where the
// old finishQuiz monkey-patch used to live. Same 500ms delay and
// suppressPopup left at its default (shows the unlock popup) as the
// original patch had.
AppStore.subscribe('ach-engine-quiz-finished', function (state, event) {
  if (event.type !== 'quiz:finished') return;
  const studentId = event.payload && event.payload.studentId;
  if (studentId && typeof achCheckAndAward === 'function') {
    setTimeout(function () { achCheckAndAward(studentId); }, 500);
  }
});
