(() => {
  // src/modules/achievements/ach_engine.js
  var ACH_RARITY = {
    Common: { color: "#9ca3af", glow: "rgba(156,163,175,0.2)", strip: "#6b7280" },
    Uncommon: { color: "#4ade80", glow: "rgba(74,222,128,0.2)", strip: "#22c55e" },
    Rare: { color: "#60a5fa", glow: "rgba(96,165,250,0.2)", strip: "#3b82f6" },
    Epic: { color: "#c084fc", glow: "rgba(192,132,252,0.2)", strip: "#9333ea" },
    Legendary: { color: "#fbbf24", glow: "rgba(251,191,36,0.3)", strip: "#f59e0b" },
    Mythic: { color: "#f472b6", glow: "rgba(244,114,182,0.3)", strip: "#ec4899" }
  };
  var ACH_RARITIES = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"];
  var ACH_TRIGGER_TYPES = [
    { value: "level", label: "Level Reached", hint: "Min level (e.g. 10)" },
    { value: "xp_earned", label: "Total XP Earned", hint: "XP amount (e.g. 5000)" },
    { value: "coins_earned", label: "Coins Held", hint: "Coin balance (e.g. 1000)" },
    { value: "coins_spent", label: "Coins Spent in Store", hint: "Total spent (e.g. 500)" },
    { value: "quests_completed", label: "Quests Completed", hint: "Quest count (e.g. 5)" },
    { value: "all_quests", label: "All Quests Completed", hint: "Set value to 1" },
    { value: "quiz_score", label: "Quiz Score (Best)", hint: "Score % (e.g. 100)" },
    { value: "quiz_avg", label: "Quiz Average", hint: "Average % (e.g. 90)" },
    { value: "perfect_streak", label: "Perfect Score Streak", hint: "Consecutive 100% quizzes" },
    { value: "boss_victories", label: "Boss Victories", hint: "Number of bosses defeated" },
    { value: "boss_damage", label: "Total Boss Damage", hint: "Total damage dealt" },
    { value: "boss_crits", label: "Critical Hits", hint: "Total crit count" },
    { value: "minions_killed", label: "Minions Defeated", hint: "Minion kill count" },
    { value: "attendance_present", label: "Attendance Present", hint: "Present sessions count" },
    { value: "attendance_pct", label: "Attendance Percentage", hint: "Attendance % (e.g. 95)" },
    { value: "store_purchases", label: "Store Purchases", hint: "Number of items bought" },
    { value: "recitations", label: "Recitation Count", hint: "Recitation sessions" },
    { value: "top_rank", label: "Top N Leaderboard", hint: "Rank position (e.g. 3 = top 3)" },
    // Phase 4 — quest chains/streak (quest_board_report.md §3.8/§13): stats
    // already computed in achBuildStats() below, just needed a trigger type
    // so admins can actually build a badge off them (same gap class Phase 56
    // closed for db-service.js — a value existing in the stats snapshot with
    // no way to reference it from the admin UI).
    { value: "quest_chains_completed", label: "Quest Chains Completed", hint: "Number of full chains cleared (e.g. 3)" },
    { value: "quest_streak", label: "Quest Board Day Streak", hint: "Consecutive active days (e.g. 7)" },
    { value: "manual", label: "Manual (Admin Grant)", hint: "Admin manually awards this badge" }
  ];
  var achRarityClass = function(rarity) {
    return "ach-rarity-" + (rarity || "Common").toLowerCase();
  };
  var achBuildStats = function(student) {
    if (!student) return {};
    const sid = student.id;
    let bossVictories = 0, totalBossDmg = 0, totalCrits = 0, totalMinionsKilled = 0;
    Object.values(AppStore.getSlice((s) => s.bossParticipants) || {}).forEach((roster) => {
      const rec = roster[sid];
      if (rec) {
        totalBossDmg += rec.totalDamage || 0;
        totalCrits += rec.critHits || 0;
        totalMinionsKilled += rec.minionsDefeated || 0;
      }
    });
    const bossParticipants = AppStore.getSlice((s) => s.bossParticipants) || {};
    (AppStore.getSlice((s) => s.bossEvents) || []).forEach((boss, bi) => {
      if (boss.status === "ended" || boss.status === "loot") {
        const roster = bossParticipants[bi] || {};
        if (roster[sid] && (roster[sid].totalDamage || 0) > 0) bossVictories++;
      }
    });
    const redemptions = AppStore.getSlice((s) => s.redemptions) || [];
    const storePurchases = redemptions.filter((r) => r.studentId === sid).length;
    const totalCoinsSpent = redemptions.filter((r) => r.studentId === sid).reduce((a, r) => a + (r.pts || 0), 0);
    const attendancePresent = (AppStore.getSlice((s) => s.attendanceLogs) || []).filter((r) => r.studentId === sid && (r.status === "Early" || r.status === "On Time" || r.status === "Late")).length;
    let bestQuizScore = 0;
    const pointLog = AppStore.getSlice((s) => s.pointLog) || [];
    pointLog.filter((e) => e.studentId === sid && e.what && e.what.startsWith("Quest:")).forEach((e) => {
      const m = e.what.match(/\((\d+)%\)/);
      if (m) {
        const s = parseInt(m[1]);
        if (s > bestQuizScore) bestQuizScore = s;
      }
    });
    const recitationCount = (AppStore.getSlice((s) => s.recitationLog) || []).filter((r) => r.studentId === sid).length;
    const sorted = [...AppStore.getSlice((s) => s.students) || []].sort((a, b) => b.xp - a.xp);
    const liveRank = sorted.findIndex((s) => s.id === sid) + 1;
    let maxPerfectStreak = 0, currentPerfect = 0;
    [...pointLog].filter((e) => e.studentId === sid && e.what && e.what.startsWith("Quest:")).reverse().forEach((e) => {
      const m = e.what.match(/\((\d+)%\)/);
      if (m && parseInt(m[1]) >= 100) {
        currentPerfect++;
        if (currentPerfect > maxPerfectStreak) maxPerfectStreak = currentPerfect;
      } else currentPerfect = 0;
    });
    const completedIds = student.completedQuizzes || [];
    const chainsCompleted = typeof eqGetQuestChains === "function" ? eqGetQuestChains().filter((c) => c.quizzes.length && c.quizzes.every((q) => completedIds.includes(q.id))).length : 0;
    const questStreak = typeof computeQuestStreak === "function" ? computeQuestStreak(sid).current : 0;
    return {
      level: student.level || 0,
      xp: student.xp || 0,
      coins: student.coins || 0,
      attendance: student.attendance || 0,
      quizAvg: student.quizAvg || 0,
      quests_completed: (student.completedQuizzes || []).length,
      total_quests: (AppStore.getSlice((s) => s.quizzes) || []).length,
      boss_victories: bossVictories,
      boss_damage: totalBossDmg,
      boss_crits: totalCrits,
      minions_killed: totalMinionsKilled,
      store_purchases: storePurchases,
      coins_spent: totalCoinsSpent,
      attendance_present: attendancePresent,
      best_quiz_score: bestQuizScore,
      recitation_count: recitationCount,
      live_rank: liveRank,
      perfect_streak: maxPerfectStreak,
      student_count: sorted.length,
      quest_chains_completed: chainsCompleted,
      quest_streak: questStreak
    };
  };
  function achEvaluateTrigger(ach, stats) {
    if (!ach || !ach.triggerType || !ach.active) return false;
    const v = parseFloat(ach.triggerValue) || 0;
    switch (ach.triggerType) {
      case "level":
        return stats.level >= v;
      case "xp_earned":
        return stats.xp >= v;
      case "coins_earned":
        return stats.coins >= v;
      case "coins_spent":
        return stats.coins_spent >= v;
      case "quests_completed":
        return stats.quests_completed >= v;
      case "all_quests":
        return stats.total_quests > 0 && stats.quests_completed >= stats.total_quests;
      case "quiz_score":
        return stats.best_quiz_score >= v;
      case "quiz_avg":
        return stats.quizAvg >= v;
      case "perfect_streak":
        return stats.perfect_streak >= v;
      case "boss_victories":
        return stats.boss_victories >= v;
      case "boss_damage":
        return stats.boss_damage >= v;
      case "boss_crits":
        return stats.boss_crits >= v;
      case "minions_killed":
        return stats.minions_killed >= v;
      case "attendance_present":
        return stats.attendance_present >= v;
      case "attendance_pct":
        return stats.attendance >= v;
      case "store_purchases":
        return stats.store_purchases >= v;
      case "recitations":
        return stats.recitation_count >= v;
      case "top_rank":
        return stats.live_rank > 0 && stats.live_rank <= v;
      case "quest_chains_completed":
        return stats.quest_chains_completed >= v;
      case "quest_streak":
        return stats.quest_streak >= v;
      case "manual":
        return false;
      default:
        return false;
    }
  }
  var achCheckAndAward = function(studentId, suppressPopup) {
    _achCheckAndAwardCore(studentId, suppressPopup);
    AppStore.emit({ type: "achievements:check-and-award-ran", payload: { studentId, suppressPopup } });
  };
  function _achCheckAndAwardCore(studentId, suppressPopup) {
    if (!studentId) return;
    const student = (AppStore.getSlice((s) => s.students) || []).find((s) => s.id === studentId);
    if (!student) return;
    const stats = achBuildStats(student);
    const alreadyUnlocked = new Set(((AppStore.getSlice((s) => s.achievementUnlocks) || {})[studentId] || []).map((u) => u.achId));
    const sectionAssignments = AppStore.getSlice((s) => s.achievementSectionAssignments) || {};
    const myClassId = student.classId || "default-class";
    const newlyUnlocked = (AppStore.getSlice((s) => s.achievements) || []).filter((ach) => {
      if (!ach.active || alreadyUnlocked.has(ach.id)) return false;
      const assignedSections = sectionAssignments[ach.id];
      if (assignedSections && assignedSections.length > 0 && !assignedSections.includes(myClassId)) return false;
      return achEvaluateTrigger(ach, stats);
    });
    if (!newlyUnlocked.length) return;
    AppStore.updateState((draft) => {
      if (!draft.achievementUnlocks) draft.achievementUnlocks = {};
      if (!draft.achievementUnlocks[studentId]) draft.achievementUnlocks[studentId] = [];
      newlyUnlocked.forEach((ach) => {
        draft.achievementUnlocks[studentId].push({
          achId: ach.id,
          unlockedAt: (/* @__PURE__ */ new Date()).toISOString(),
          xpGranted: parseInt(ach.xpReward) || 0,
          coinsGranted: parseInt(ach.coinReward) || 0,
          claimed: false,
          claimedAt: null
        });
      });
    }, { type: "achievements:unlocked", payload: { studentId, achIds: newlyUnlocked.map((a) => a.id) } });
    newlyUnlocked.forEach((ach) => syncAchievementUnlockToServer(studentId, ach.id, 0, 0, false, myClassId));
    currentUser = (AppStore.getSlice((s) => s.students) || []).find((s) => s.id === studentId);
    achUpdateSidebarBadge();
    if (!suppressPopup) newlyUnlocked.forEach((ach, i) => setTimeout(() => achShowUnlockPopup(ach), i * 1400));
  }
  var achGrantRewardsForClaim = function(studentId, achId) {
    const existingUnlock = ((AppStore.getSlice((s) => s.achievementUnlocks) || {})[studentId] || []).find((u) => u.achId === achId);
    if (!existingUnlock || existingUnlock.claimed) return false;
    const xpGrant = parseInt(existingUnlock.xpGranted) || 0;
    const coinGrant = parseInt(existingUnlock.coinsGranted) || 0;
    const achName = (AppStore.getSlice((s) => s.achievements) || []).find((a) => a.id === achId)?.name || "Achievement";
    let updatedStudent = null;
    AppStore.updateState((draft) => {
      const s = (draft.students || []).find((x) => x.id === studentId);
      if (!s) return;
      s.xp = (s.xp || 0) + xpGrant;
      s.coins = (s.coins || 0) + coinGrant;
      const unlockRec = ((draft.achievementUnlocks || {})[studentId] || []).find((u) => u.achId === achId);
      if (unlockRec) {
        unlockRec.claimed = true;
        unlockRec.claimedAt = (/* @__PURE__ */ new Date()).toISOString();
      }
      if (xpGrant > 0 || coinGrant > 0) {
        if (!Array.isArray(draft.pointLog)) draft.pointLog = [];
        draft.pointLog.unshift({ id: "pl_" + uid(), studentId, what: `\u{1F3C5} Achievement Claimed: ${achName}`, pts: coinGrant || xpGrant, when: "Just now", createdAt: (/* @__PURE__ */ new Date()).toISOString() });
      }
      updatedStudent = s;
    }, { type: "achievements:claimed", payload: { studentId, achId } });
    if (!updatedStudent) return false;
    syncStudentStatsToServer(studentId, xpGrant, coinGrant);
    syncAchievementClaimToServer(studentId, achId, xpGrant, coinGrant);
    currentUser = updatedStudent;
    achUpdateSidebarBadge();
    updateTopbar();
    return { xp: xpGrant, coins: coinGrant };
  };
  var achUpdateSidebarBadge = function() {
    if (currentRole !== "student" || !currentUser) return;
    const unlocks = (AppStore.getSlice((s) => s.achievementUnlocks) || {})[currentUser.id] || [];
    const unclaimedCount = unlocks.filter((u) => !u.claimed).length;
    const btn = document.getElementById("nav-s-badges");
    if (!btn) return;
    let badge = btn.querySelector(".ach-nav-badge");
    if (unclaimedCount > 0) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "ach-nav-badge";
        badge.style.cssText = "margin-left:auto;background:rgba(208,188,255,0.2);border:1px solid rgba(208,188,255,0.3);border-radius:10px;padding:1px 7px;font-size:10px;font-weight:800;color:var(--primary);font-family:var(--fh)";
        btn.appendChild(badge);
      }
      badge.textContent = unclaimedCount > 99 ? "99+" : String(unclaimedCount);
    } else {
      if (badge) badge.remove();
    }
  };
  var achShowUnlockPopup = function(ach) {
    const rarity = ACH_RARITY[ach.rarity] || ACH_RARITY.Common;
    const existing = document.getElementById("ach-unlock-popup");
    if (existing) existing.remove();
    const d = document.createElement("div");
    d.id = "ach-unlock-popup";
    d.className = "ach-unlock-popup";
    d.style.cssText = `border-color:${rarity.color}55;box-shadow:0 8px 40px ${rarity.glow};cursor:pointer`;
    const hasRewards = (ach.xpReward || 0) > 0 || (ach.coinReward || 0) > 0;
    d.innerHTML = `
    <div class="ach-popup-icon">${ach.icon || "\u{1F3C5}"}</div>
    <div style="flex:1">
      <div class="ach-popup-title" style="color:${rarity.color}">\u2728 Achievement Unlocked!</div>
      <div class="ach-popup-name">${_esc(ach.name)}</div>
      <div class="ach-popup-rewards" style="color:var(--text-muted)">${hasRewards ? "Tap to claim rewards \u2192" : "View in Achievements"}</div>
    </div>
    <div style="width:8px;height:8px;border-radius:50%;background:${rarity.color};box-shadow:0 0 8px ${rarity.color};flex-shrink:0;margin-top:4px;animation:achBadgePulse 1.5s ease-in-out infinite"></div>`;
    d.addEventListener("click", () => {
      d.style.animation = "achPopOut .4s ease forwards";
      setTimeout(() => {
        d.remove();
        navTo("s-badges");
      }, 400);
    });
    document.body.appendChild(d);
    setTimeout(() => {
      if (d.parentNode) {
        d.style.animation = "achPopOut .4s ease forwards";
        setTimeout(() => d.remove(), 400);
      }
    }, 4500);
  };
  AppStore.subscribe("ach-engine-boss-damage", function(state, event) {
    if (event.type !== "world-boss:damage-applied" && event.type !== "world-boss:defeated") return;
    const studentId = event.payload && event.payload.studentId;
    if (studentId) setTimeout(() => achCheckAndAward(studentId), 400);
  });
  AppStore.subscribe("ach-engine-session-booted", function(state, event) {
    if (event.type !== "session:booted") return;
    if (getCurrentRole() === "student" && getCurrentUser()) {
      setTimeout(() => achCheckAndAward(getCurrentUser().id), 400);
    }
  });
  console.log("[EduQuest] achievements/engine.js loaded \u2014 ACH_RARITY, achBuildStats, achCheckAndAward, achGrantRewardsForClaim, achUpdateSidebarBadge, achShowUnlockPopup registered. Trigger hooks patched.");
  AppStore.subscribe("ach-engine-state-sync", function(state, event) {
    const watchedEvents = [
      "recitation:logged",
      "loot:claimed",
      "xp:awarded",
      "state:legacy-sync",
      // Fills the gap left by the removed dead logAttendance patch — these are
      // the real, live events attendance-service.js emits for the two
      // attendance-based achievement trigger types (attendance_present,
      // attendance_pct). attendance:session-closed is deliberately NOT
      // watched: it's a bulk absence-sweep, and marking someone absent can
      // only decrease those stats, never newly cross an unlock threshold —
      // checking there would be a guaranteed no-op every time.
      "attendance:scan-recorded",
      "attendance:override"
    ];
    if (!watchedEvents.includes(event.type)) return;
    if (event.type === "attendance:scan-recorded" && event.payload && event.payload.alreadyRecorded) return;
    const studentId = event.payload && event.payload.studentId;
    if (studentId && typeof achCheckAndAward === "function") {
      setTimeout(function() {
        achCheckAndAward(studentId, true);
      }, 400);
    }
    if (typeof achUpdateSidebarBadge === "function") achUpdateSidebarBadge();
  });
  AppStore.subscribe("ach-engine-quiz-finished", function(state, event) {
    if (event.type !== "quiz:finished") return;
    const studentId = event.payload && event.payload.studentId;
    if (studentId && typeof achCheckAndAward === "function") {
      setTimeout(function() {
        achCheckAndAward(studentId);
      }, 500);
    }
  });

  // build/bridges/ach_engine.bridge.js
  window.ACH_RARITY = ACH_RARITY;
  window.ACH_RARITIES = ACH_RARITIES;
  window.ACH_TRIGGER_TYPES = ACH_TRIGGER_TYPES;
  window.achRarityClass = achRarityClass;
  window.achBuildStats = achBuildStats;
  window.achEvaluateTrigger = achEvaluateTrigger;
  window.achCheckAndAward = achCheckAndAward;
  window._achCheckAndAwardCore = _achCheckAndAwardCore;
  window.achGrantRewardsForClaim = achGrantRewardsForClaim;
  window.achUpdateSidebarBadge = achUpdateSidebarBadge;
  window.achShowUnlockPopup = achShowUnlockPopup;
})();
