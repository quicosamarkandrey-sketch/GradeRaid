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
  if (typeof DB === 'undefined' || !DB) return null;
  const bosses = DB.bossEvents || [];
  const idx    = bosses.findIndex(b => b.status === 'active');
  return idx >= 0 ? { boss: bosses[idx], idx } : null;
};

window.wbcGetParticipants = function (bossIdx) {
  if (!DB.bossParticipants)          DB.bossParticipants = {};
  if (!DB.bossParticipants[bossIdx]) DB.bossParticipants[bossIdx] = {};
  return DB.bossParticipants[bossIdx];
};

window.wbcMyRecord = function (bossIdx) {
  return wbcGetParticipants(bossIdx)[currentUser.id] || null;
};

window.wbcJoinBoss = function (bossIdx) {
  const parts = wbcGetParticipants(bossIdx);
  if (!parts[currentUser.id]) {
    parts[currentUser.id] = {
      studentId:       currentUser.id,
      studentName:     currentUser.name,
      studentInit:     currentUser.init,
      studentColor:    currentUser.color,
      totalDamage:     0,
      correctAnswers:  0,
      wrongAnswers:    0,
      critHits:        0,
      minionsDefeated: 0,
      joinTime:        Date.now(),
      lastQIdx:        0,
    };
  }
  saveDB();
  WBC.joined          = true;
  WBC.bossIdx         = bossIdx;
  const myRec         = parts[currentUser.id];
  WBC.qIdx            = myRec.lastQIdx || 0;
  WBC.battleStartTime = myRec.joinTime;
  toast('⚔️ You joined the raid! Answer questions to deal damage!', '#EC4899');
  renderStudentWorldBoss();
};

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
  const boss = DB.bossEvents[bossIdx]; if (!boss) return;
  boss.currentHp = Math.max(0, (boss.currentHp || boss.maxHp) - damage);
  const parts    = wbcGetParticipants(bossIdx);
  if (parts[studentId]) {
    parts[studentId].totalDamage    += damage;
    parts[studentId].correctAnswers += 1;
  }
  let defeated = boss.currentHp <= 0;

  if (typeof DBService !== 'undefined' && typeof DBService.rpc === 'function' && boss._id) {
    try {
      const { data, error } = await DBService.rpc('apply_boss_damage', {
        p_boss_id: boss._id, p_class_id: boss.classId || 'default-class',
        p_student_id: studentId, p_damage: damage, p_is_crit: !!isCrit,
      });
      if (error) {
        console.warn('[EduQuest] apply_boss_damage RPC failed, keeping local optimistic HP:', error);
      } else {
        const row = Array.isArray(data) ? data[0] : data;
        if (row && typeof row.new_hp === 'number') {
          boss.currentHp = row.new_hp;
          defeated       = !!row.defeated;
        }
      }
    } catch (e) {
      console.warn('[EduQuest] apply_boss_damage RPC threw, keeping local optimistic HP:', e);
    }
  }

  if (defeated) {
    boss.currentHp = 0;
    if (typeof wblrPrepareLootRush === 'function') await wblrPrepareLootRush(boss, bossIdx);
    Object.values(parts).forEach(p => {
      const si = DB.students.findIndex(s => s.id === p.studentId);
      if (si < 0 || p.totalDamage <= 0) return;
      const xpReward   = (boss.xpReward    || 500) + (boss.participationReward || 100);
      const coinReward = (boss.coinReward   || 250) + (boss.victoryReward      || 300);
      DB.students[si].xp    += xpReward;
      DB.students[si].coins += coinReward;
      syncStudentStatsToServer(p.studentId, xpReward, coinReward);
      DB.pointLog.unshift({ id: 'pl_' + uid(), studentId: p.studentId, what: `⚔️ Boss Raid: "${boss.name}" DEFEATED! Victory rewards granted.`, pts: xpReward, when: 'Just now', createdAt: new Date().toISOString() });
    });
    saveDB();
    if (typeof achCheckAndAward === 'function') {
      Object.keys(parts).forEach(sid => setTimeout(() => achCheckAndAward(sid), 600));
    }
    return 'defeated';
  }
  saveDB();
  return 'hit';
};

// ── Question access ───────────────────────────────────────────────────────────

window.wbcGetBossQuestions = function (boss) {
  if (boss.bossQuestions && boss.bossQuestions.length) return boss.bossQuestions;
  if (boss.linkedQuizId) {
    const q = (DB.quizzes || []).find(q => q.id === boss.linkedQuizId);
    if (q) return q.questions;
  }
  return boss._generatedQuestions || [];
};

// ── Battle statistics ─────────────────────────────────────────────────────────

window.wbcBattleStats = function (bossIdx) {
  const boss  = DB.bossEvents[bossIdx]; if (!boss) return {};
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

window.wbcAnswer = async function (bossIdx, qIdx, chosenOpt) {
  if (WBC.cooldownActive) return;
  DB = loadDB();
  const boss      = DB.bossEvents[bossIdx]; if (!boss) return;
  const questions = wbcGetBossQuestions(boss);
  const q         = questions[qIdx]; if (!q) return;
  const correct   = chosenOpt === q.answer;

  // Mark answer buttons
  document.querySelectorAll('.wb-answer-btn').forEach((btn, i) => {
    btn.onclick = null;
    if (i === q.answer)              btn.classList.add('correct');
    else if (i === chosenOpt && !correct) btn.classList.add('wrong');
  });

  const parts = wbcGetParticipants(bossIdx);
  const myRec = parts[currentUser.id]; if (!myRec) return;

  if (correct) {
    const { damage, isCrit } = wbcCalcDamage(boss);
    if (isCrit) { wblTrackCrit(bossIdx, currentUser.id); toast('🌟 CRITICAL HIT! ×2.5 damage!', '#fbbf24'); }
    WBC.comboCount++;
    WBC.answered.push({ correct: true, damage });
    const result = await wbcApplyDamage(bossIdx, damage, currentUser.id, isCrit);
    myRec.lastQIdx = qIdx + 1;
    saveDB();
    DB = loadDB();
    wbcUpdateTopbarWidget();
    if (result === 'defeated') {
      setTimeout(() => { if (typeof wbrShowBossVictory === 'function') wbrShowBossVictory(bossIdx, () => renderStudentWorldBoss()); }, 600);
      return;
    }
  } else {
    WBC.comboCount = 0;
    WBC.answered.push({ correct: false, damage: 0 });
    if (parts[currentUser.id]) parts[currentUser.id].wrongAnswers++;
    myRec.lastQIdx = qIdx + 1;
    saveDB();
  }

  WBC.qIdx = qIdx + 1;
  const cooldown = parseInt(boss.combatSettings?.questionCooldown) || 0;
  if (cooldown > 0) {
    WBC.cooldownActive = true;
    setTimeout(() => { WBC.cooldownActive = false; renderStudentWorldBoss(); }, cooldown * 1000);
  } else {
    setTimeout(() => renderStudentWorldBoss(), correct ? 1000 : 1400);
  }
};

// ── Combat settings modal ─────────────────────────────────────────────────────

window.wbcOpenCombatSettings = function (bossIdx) {
  DB = loadDB();
  const boss = DB.bossEvents[bossIdx]; if (!boss) return;
  const s    = boss.combatSettings || wbcDefaultSettings();
  showModal(`<div>
    <div class="modal-h2" style="margin-bottom:16px">⚙️ Combat Settings — ${_esc(boss.name)}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group"><label class="form-label">Damage Per Answer</label><input type="number" id="cs-dmg" value="${s.damagePerAnswer||150}" min="1" style="width:100%"></div>
      <div class="form-group"><label class="form-label">Crit Chance (%)</label><input type="number" id="cs-crit" value="${s.critChance||20}" min="0" max="100" style="width:100%"></div>
      <div class="form-group"><label class="form-label">Crit Multiplier</label><input type="number" id="cs-critmul" value="${s.critMultiplier||2.5}" min="1" step="0.1" style="width:100%"></div>
      <div class="form-group"><label class="form-label">Question Cooldown (s)</label><input type="number" id="cs-cooldown" value="${s.questionCooldown||0}" min="0" style="width:100%"></div>
    </div>
    <div class="form-group">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:10px"><input type="checkbox" id="cs-rnd" ${s.useRandomDamage?'checked':''} style="width:16px;height:16px"> Use random damage range</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><label class="form-label">Min Damage</label><input type="number" id="cs-dmin" value="${s.damageMinRandom||80}" min="1" style="width:100%"></div>
        <div><label class="form-label">Max Damage</label><input type="number" id="cs-dmax" value="${s.damageMaxRandom||200}" min="1" style="width:100%"></div>
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-top:8px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" style="flex:1" onclick="wbcSaveCombatSettings(${bossIdx})">Save Settings</button>
    </div>
  </div>`, 'md');
};

window.wbcSaveCombatSettings = function (bossIdx) {
  DB = loadDB();
  const boss = DB.bossEvents[bossIdx]; if (!boss) return;
  boss.combatSettings = {
    damagePerAnswer:  parseInt(document.getElementById('cs-dmg')?.value)     || 150,
    critChance:       parseInt(document.getElementById('cs-crit')?.value)    || 20,
    critMultiplier:   parseFloat(document.getElementById('cs-critmul')?.value) || 2.5,
    questionCooldown: parseInt(document.getElementById('cs-cooldown')?.value) || 0,
    useRandomDamage:  document.getElementById('cs-rnd')?.checked || false,
    damageMinRandom:  parseInt(document.getElementById('cs-dmin')?.value) || 80,
    damageMaxRandom:  parseInt(document.getElementById('cs-dmax')?.value) || 200,
  };
  saveDB();
  closeModalForce();
  toast('✅ Combat settings saved!');
  renderAdminBossEvents();
};

