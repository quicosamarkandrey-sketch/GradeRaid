// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/world-boss/combat-settings.js
//  World Boss Combat Engine: WBC runtime state, damage calculation,
//  participant tracking, topbar widget, combat settings modal, question editor.
//  LOAD FIRST in world-boss module.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Runtime state ─────────────────────────────────────────────────────────────

window.WBC = {
  joined:         false,
  bossIdx:        -1,
  qIdx:           0,
  answered:       [],
  comboCount:     0,
  battleStartTime: 0,
  refreshInterval: null,
  cooldownTimeout: null,
  cooldownActive:  false,
};

// ── Default combat settings ───────────────────────────────────────────────────

window.wbcDefaultSettings = function () {
  return {
    damagePerAnswer:  150,
    damageMinRandom:  80,
    damageMaxRandom:  200,
    useRandomDamage:  false,
    critChance:       20,
    critMultiplier:   2.5,
    questionCooldown: 0,
  };
};

// ── Core helpers ──────────────────────────────────────────────────────────────

window.wbcGetActiveBoss = function () {
  const bosses = AppStore.getSlice(s => s.bossEvents) || [];
  const idx    = bosses.findIndex(b => b.status === 'active');
  return idx >= 0 ? { boss: bosses[idx], idx } : null;
};

// [Phase 3 migration] Now returns a fresh AppStore.getSlice() clone instead
// of a live reference into DB.bossParticipants[bossIdx] — every write path
// in this module used to mutate whatever this function returned, then call
// saveDB() separately, relying on DB being one shared mutable object.
// wbcApplyDamage() below (and, in other files, raid-flow.js's wbcJoinBoss
// and various minions.js/raid-flow.js handlers) now build their mutations
// inside AppStore.updateState() draft callbacks instead of mutating this
// function's return value directly.
window.wbcGetParticipants = function (bossIdx) {
  return (AppStore.getSlice(s => s.bossParticipants) || {})[bossIdx] || {};
};

window.wbcMyRecord = function (bossIdx) {
  return wbcGetParticipants(bossIdx)[currentUser.id] || null;
};

// [Phase 1 cleanup] wbcJoinBoss used to be defined here too, until
// raid-flow.js's own window.wbcJoinBoss (loaded after this file, and after
// battle-overlay.js's now-also-removed patch of this same function)
// unconditionally overwrote it. Removed 2026-07-21 — see the refactor
// log's Tier-1 debt-review entry for the verification behind this deletion.

// ── Damage calculation ────────────────────────────────────────────────────────

window.wbcCalcDamage = function (boss) {
  const s    = boss.combatSettings || wbcDefaultSettings();
  let base;
  if (s.useRandomDamage) {
    const min = parseInt(s.damageMinRandom) || 80;
    const max = parseInt(s.damageMaxRandom) || 200;
    base      = Math.floor(Math.random() * (max - min + 1)) + min;
  } else {
    base = parseInt(s.damagePerAnswer) || 150;
  }
  const isCrit     = Math.random() * 100 < (parseFloat(s.critChance) || 0);
  const multiplier = isCrit ? (parseFloat(s.critMultiplier) || 2.5) : 1;
  return { damage: Math.round(base * multiplier), isCrit, base };
};

/**
 * wbcApplyDamage(bossIdx, damage, studentId, isCrit) → Promise<'defeated'|'hit'>  [window.wbcApplyDamage]
 * Deducts HP, updates participant record. On defeat: distributes XP/coin rewards,
 * calls wblrPrepareLootRush. achCheckAndAward typeof guard preserved.
 *
 * Phase 23 follow-up: current_hp/status used to be pure local
 * read-decrement-write, then whatever the next bulk saveDB()→push cycle
 * happened to sync — the exact clobber race documented in db-service.js
 * (two students hitting the boss on different devices around the same
 * time could each push a stale locally-computed HP and stomp the other's
 * damage). apply_boss_damage() (phase14_section_isolation.sql) was written
 * to close this atomically but was never actually called from anywhere.
 * We still update local state optimistically first for instant feedback,
 * then correct it to whatever the RPC actually returns — so even if two
 * devices race, each ends up holding the server's real number instead of
 * its own guess by the time the next bulk push fires.
 */
window.wbcApplyDamage = async function (bossIdx, damage, studentId, isCrit) {
  const bossBefore = (AppStore.getSlice(s => s.bossEvents) || [])[bossIdx];
  if (!bossBefore) return;

  let newHp    = Math.max(0, (bossBefore.currentHp || bossBefore.maxHp) - damage);
  let defeated = newHp <= 0;

  if (typeof DBService !== 'undefined' && typeof DBService.rpc === 'function' && bossBefore._id) {
    try {
      const { data, error } = await DBService.rpc('apply_boss_damage', {
        p_boss_id: bossBefore._id, p_class_id: bossBefore.classId || 'default-class',
        p_student_id: studentId, p_damage: damage, p_is_crit: !!isCrit,
      });
      if (error) {
        console.warn('[EduQuest] apply_boss_damage RPC failed, keeping local optimistic HP:', error);
      } else {
        const row = Array.isArray(data) ? data[0] : data;
        if (row && typeof row.new_hp === 'number') {
          newHp    = row.new_hp;
          defeated = !!row.defeated;
        }
      }
    } catch (e) {
      console.warn('[EduQuest] apply_boss_damage RPC threw, keeping local optimistic HP:', e);
    }
  }
  if (defeated) newHp = 0;
  if (defeated && typeof wblrPrepareLootRush === 'function') await wblrPrepareLootRush(bossBefore, bossIdx);

  const victoryPayouts = [];
  AppStore.updateState(draft => {
    const boss = (draft.bossEvents || [])[bossIdx];
    if (!boss) return;
    boss.currentHp = newHp;

    if (!draft.bossParticipants) draft.bossParticipants = {};
    if (!draft.bossParticipants[bossIdx]) draft.bossParticipants[bossIdx] = {};
    const parts = draft.bossParticipants[bossIdx];
    if (parts[studentId]) {
      parts[studentId].totalDamage    = (parts[studentId].totalDamage || 0) + damage;
      parts[studentId].correctAnswers = (parts[studentId].correctAnswers || 0) + 1;
    }

    if (defeated) {
      Object.values(parts).forEach(p => {
        const s = (draft.students || []).find(x => x.id === p.studentId);
        if (!s || p.totalDamage <= 0) return;
        const xpReward   = (boss.xpReward   || 500) + (boss.participationReward || 100);
        const coinReward = (boss.coinReward || 250) + (boss.victoryReward       || 300);
        s.xp    = (s.xp || 0)    + xpReward;
        s.coins = (s.coins || 0) + coinReward;
        if (!Array.isArray(draft.pointLog)) draft.pointLog = [];
        draft.pointLog.unshift({ id: 'pl_' + uid(), studentId: p.studentId, what: `⚔️ Boss Raid: "${boss.name}" DEFEATED! Victory rewards granted.`, pts: xpReward, when: 'Just now', createdAt: new Date().toISOString() });
        victoryPayouts.push({ studentId: p.studentId, xpReward, coinReward });
      });
    }
  }, { type: defeated ? 'world-boss:defeated' : 'world-boss:damage-applied', payload: { bossIdx, studentId, damage } });

  if (defeated) {
    victoryPayouts.forEach(({ studentId: sid, xpReward, coinReward }) => syncStudentStatsToServer(sid, xpReward, coinReward));
    if (typeof achCheckAndAward === 'function') {
      Object.keys(wbcGetParticipants(bossIdx)).forEach(sid => setTimeout(() => achCheckAndAward(sid), 600));
    }
    return 'defeated';
  }
  return 'hit';
};

// ── Question access ───────────────────────────────────────────────────────────

window.wbcGetBossQuestions = function (boss) {
  if (boss.bossQuestions && boss.bossQuestions.length) return boss.bossQuestions;
  if (boss.linkedQuizId) {
    const q = (AppStore.getSlice(s => s.quizzes) || []).find(q => q.id === boss.linkedQuizId);
    if (q) return q.questions;
  }
  return boss._generatedQuestions || [];
};

// ── Battle statistics ─────────────────────────────────────────────────────────

window.wbcBattleStats = function (bossIdx) {
  const boss  = (AppStore.getSlice(s => s.bossEvents) || [])[bossIdx]; if (!boss) return {};
  const parts = Object.values(wbcGetParticipants(bossIdx));
  const now   = Date.now();
  const totalDmg   = parts.reduce((a, p) => a + p.totalDamage, 0);
  const remainingHp = Math.max(0, boss.currentHp || 0);
  let timeRemaining = '';
  if (boss.endDate) {
    const diff = Math.max(0, new Date(boss.endDate).getTime() - now);
    const h    = Math.floor(diff / 3600000);
    const m    = Math.floor((diff % 3600000) / 60000);
    const s    = Math.floor((diff % 60000) / 1000);
    timeRemaining = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  }
  let dps = 0;
  if (parts.length > 0) {
    const firstJoin = Math.min(...parts.map(p => p.joinTime || now));
    const elapsed   = Math.max(1, (now - firstJoin) / 1000);
    dps             = Math.round(totalDmg / elapsed);
  }
  return { totalDmg, participants: parts.length, remainingHp, dps, timeRemaining };
};

// ── Topbar widget ─────────────────────────────────────────────────────────────

window.wbcUpdateTopbarWidget = function () {
  const w = document.getElementById('wb-topbar-widget'); if (!w) return;
  const found = wbcGetActiveBoss();
  if (!found || currentRole !== 'student') { w.style.display = 'none'; return; }
  const { boss } = found;
  const pct      = Math.max(0, Math.min(100, Math.round((boss.currentHp || boss.maxHp) / boss.maxHp * 100)));
  document.getElementById('wb-widget-name').textContent        = boss.name.toUpperCase().substring(0, 18);
  const widgetTrack = document.getElementById('wb-widget-hp-track');
  if (widgetTrack && typeof renderStatBar === 'function') {
    // Same call site pattern as the full-page HP bar (§2.1 / §3.3): one
    // renderer, two places it's called from. The widget's pink/purple
    // gradient stays fully CSS-owned (#wb-widget-hp-fill is an ID selector,
    // so it already wins over the generic .stat-bar-fill background).
    const tookDamage = typeof window._wbcLastWidgetHpPct === 'number' && pct < window._wbcLastWidgetHpPct;
    renderStatBar(widgetTrack, { percent: pct, tier: pct <= 20 ? 'critical' : 'normal', justChanged: tookDamage });
  } else {
    const fallbackFill = document.getElementById('wb-widget-hp-fill');
    if (fallbackFill) fallbackFill.style.width = pct + '%';
  }
  window._wbcLastWidgetHpPct = pct;
  document.getElementById('wb-widget-pct').textContent         = pct + '%';
  document.getElementById('wb-widget-hp-txt').textContent      = (boss.currentHp || boss.maxHp).toLocaleString() + ' HP';
  w.style.display = 'flex';
};

// ── Answer handler ─────────────────────────────────────────────────────────────
// [Phase 1 cleanup] The dead wbcAnswer definition that used to live here was
// removed 2026-07-21 — student-page.js's own window.wbcAnswer (that file's
// header: "LOAD AFTER: combat-settings.js") always won at load time, so this
// copy never ran. See the refactor log's Tier-1 debt-review entry for the
// verification behind this deletion.

// [Phase 1 cleanup] wbcOpenCombatSettings/wbcSaveCombatSettings used to be
// defined here too. Removed 2026-07-21 — admin-page.js's own header says
// "LOAD AFTER: combat-settings.js", confirming its versions of both
// functions always won at load time, so these copies never ran. See the
// refactor log's Tier-1 debt-review entry for the verification behind
// this deletion.
