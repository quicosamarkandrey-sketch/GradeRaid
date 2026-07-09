// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/world-boss/minions.js
//  World Boss Minion System: data model, spawning, HP hearts, KO state,
//  student-side encounter UI, admin settings and question pool.
//
//  LOAD AFTER: combat-settings.js, loot-rain.js, skills.js, phases.js, rage.js
// ═══════════════════════════════════════════════════════════════════════════════

// ── Runtime state ─────────────────────────────────────────────────────────────

window.WBM = {
  spawnInterval:    null,   // setInterval handle for spawning
  countdownTimer:   null,   // setInterval for student-side minion countdown
  koReviveTimer:    null,   // setInterval for KO countdown UI
  activeSpawnToast: null,   // timeout to remove spawn toast
};

// ── Default minion settings ────────────────────────────────────────────────────

window.wbmDefaultSettings = function () {
  return {
    enabled:           false,
    spawnIntervalSec:  35,
    maxActive:         3,
    lifetimeSec:       30,
    questionTimeSec:   20,
    minionDamage:      1,
    reviveTimeSec:     60,
    spawnSide:         'random',   // 'left' | 'right' | 'random' | 'both'
    questions:         [],
  };
};

// ── Get merged settings for a boss ────────────────────────────────────────────

window.wbmSettings = function (boss) {
  const settings = Object.assign({}, wbmDefaultSettings(), boss.minionSettings || {});
  if ((!settings.questions || settings.questions.length === 0) && typeof wbcGetBossQuestions === 'function') {
    const bossQs = wbcGetBossQuestions(boss) || [];
    if (bossQs.length) settings.questions = bossQs;
  }
  return settings;
};

// ── Minion name/sprite pool ────────────────────────────────────────────────────

window.WBM_MINIONS = [
  { name: 'Shadow Imp',   sprite: '👿' },
  { name: 'Void Slime',   sprite: '🫧' },
  { name: 'Dark Sprite',  sprite: '🧿' },
  { name: 'Hex Frog',     sprite: '🐸' },
  { name: 'Cursed Raven', sprite: '🪶' },
  { name: 'Bone Crawler', sprite: '🦴' },
  { name: 'Plague Rat',   sprite: '🐀' },
  { name: 'Soul Wisp',    sprite: '🌀' },
];

function _wbmRandomMinion() {
  return WBM_MINIONS[Math.floor(Math.random() * WBM_MINIONS.length)];
}

function _wbmResolveSide(spawnSide) {
  if (spawnSide === 'left')  return 'left';
  if (spawnSide === 'right') return 'right';
  if (spawnSide === 'both')  return 'both';
  return Math.random() < 0.5 ? 'left' : 'right';
}

// ── Initialise minion pool ─────────────────────────────────────────────────────

window.wbmEnsureActiveMinions = function (boss) {
  if (!boss.activeMinions) boss.activeMinions = [];
};

// ── Spawn a minion ─────────────────────────────────────────────────────────────

window.wbmSpawnMinion = function (bossIdx) {
  const boss = DB.bossEvents[bossIdx];
  if (!boss || boss.status !== 'active') return;
  const s = wbmSettings(boss);
  if (!s.enabled) return;
  wbmEnsureActiveMinions(boss);
  wbmPruneExpiredMinions(bossIdx);
  if (boss.activeMinions.length >= (s.maxActive || 3)) return;
  if (!s.questions || s.questions.length === 0) return;

  const resolvedSide = _wbmResolveSide(s.spawnSide || 'random');

  function _createMinion(side) {
    if (boss.activeMinions.length >= (s.maxActive || 3)) return null;
    const minion = _wbmRandomMinion();
    const qIdx = Math.floor(Math.random() * s.questions.length);
    boss.activeMinions.push({
      id:              'mn_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      name:            minion.name,
      sprite:          minion.sprite,
      spawnTime:       Date.now(),
      lifetimeSec:     s.lifetimeSec || 30,
      questionTimeSec: s.questionTimeSec || 20,
      questionIdx:     qIdx,
      side:            side,
    });
    return minion;
  }

  if (resolvedSide === 'both') {
    const m1 = _createMinion('left');
    const m2 = _createMinion('right');
    saveDB();
    if (m1) _wbmShowSpawnToast(m1.sprite, m1.name + ' (Left)');
    if (m2) setTimeout(() => _wbmShowSpawnToast(m2.sprite, m2.name + ' (Right)'), 600);
  } else {
    const m = _createMinion(resolvedSide);
    saveDB();
    if (m) _wbmShowSpawnToast(m.sprite, m.name);
  }

  if (currentRole === 'student') _wbmRefreshBattleArea(bossIdx);
};

// ── Prune expired minions ──────────────────────────────────────────────────────

window.wbmPruneExpiredMinions = function (bossIdx) {
  const boss = DB.bossEvents[bossIdx];
  if (!boss) return;
  wbmEnsureActiveMinions(boss);
  const now = Date.now();
  const before = boss.activeMinions.length;
  boss.activeMinions = boss.activeMinions.filter(m => {
    const age = (now - m.spawnTime) / 1000;
    return age < (m.lifetimeSec || 30);
  });
  if (boss.activeMinions.length < before) saveDB();
};

// ── Spawn loop ─────────────────────────────────────────────────────────────────
// NOTE: battle-overlay.js (wbe) patches wbmStartSpawnLoop and wbmStopSpawnLoop
// to use setTimeout-based random delays instead of setInterval.
// These are the base implementations — battle-overlay.js replaces them at load.

window.wbmStartSpawnLoop = function (bossIdx) {
  wbmStopSpawnLoop();
  const boss = DB.bossEvents[bossIdx];
  if (!boss) return;
  const s = wbmSettings(boss);
  if (!s.enabled || s.spawnIntervalSec <= 0) return;
  WBM.spawnInterval = setInterval(() => {
    wbmPruneExpiredMinions(bossIdx);
    wbmSpawnMinion(bossIdx);
    if (currentRole === 'student') _wbmRefreshBattleArea(bossIdx);
  }, (s.spawnIntervalSec || 60) * 1000);
};

window.wbmStopSpawnLoop = function () {
  if (WBM.spawnInterval)   { clearInterval(WBM.spawnInterval);  WBM.spawnInterval  = null; }
  if (WBM.countdownTimer)  { clearInterval(WBM.countdownTimer); WBM.countdownTimer = null; }
  if (WBM.koReviveTimer)   { clearInterval(WBM.koReviveTimer);  WBM.koReviveTimer  = null; }
};

// ── HP helpers ─────────────────────────────────────────────────────────────────

window.wbmMyHp = function (bossIdx) {
  const parts = wbcGetParticipants(bossIdx);
  const rec = parts[currentUser.id];
  if (!rec) return { hp: 3, maxHp: 3, isKO: false };
  if (rec.hp    === undefined) rec.hp    = 3;
  if (rec.maxHp === undefined) rec.maxHp = 3;
  return rec;
};

window.wbmGetCurrentMinion = function (bossIdx) {
  const boss = DB.bossEvents[bossIdx];
  if (!boss) return null;
  wbmPruneExpiredMinions(bossIdx);
  if (!boss.activeMinions || boss.activeMinions.length === 0) return null;
  return boss.activeMinions[0];
};

window.wbmGetCurrentMinionBySide = function (bossIdx, side) {
  const boss = DB.bossEvents[bossIdx];
  if (!boss) return null;
  wbmPruneExpiredMinions(bossIdx);
  if (!boss.activeMinions || boss.activeMinions.length === 0) return null;
  return boss.activeMinions.find(m => (m.side || 'left') === side) || null;
};

// ── HP / KO rendering ─────────────────────────────────────────────────────────

window.wbmRenderHearts = function (hp, maxHp, small) {
  maxHp = maxHp || 3;
  let html = `<div class="wbm-hearts${small ? ' wbm-hearts-sm' : ''}">`;
  for (let i = 0; i < maxHp; i++) {
    html += `<div class="wbm-heart${i >= hp ? ' lost' : ''}" id="wbm-heart-${i}">❤️</div>`;
  }
  html += '</div>';
  return html;
};

window.wbmRenderHpBar = function (bossIdx) {
  const rec = wbmMyHp(bossIdx);
  const hp = rec.hp || 0;
  const maxHp = rec.maxHp || 3;
  let statusText, statusClass;
  if (rec.isKO)     { statusText = 'KNOCKED OUT'; statusClass = 'ko'; }
  else if (hp <= 1) { statusText = 'CRITICAL!';   statusClass = 'ko'; }
  else              { statusText = hp + ' / ' + maxHp; statusClass = ''; }
  return `
  <div class="wbm-hp-bar">
    <div class="wbm-hp-label">YOUR HP</div>
    <div class="wbm-hearts-row">${wbmRenderHearts(hp, maxHp, false)}</div>
    <div class="wbm-hp-status ${statusClass}">${statusText}</div>
  </div>`;
};

// ── Damage application ────────────────────────────────────────────────────────

window.wbmDealDamage = function (bossIdx, reason) {
  const parts = wbcGetParticipants(bossIdx);
  if (!parts[currentUser.id]) return;
  const rec = parts[currentUser.id];
  if (rec.hp    === undefined) rec.hp    = 3;
  if (rec.maxHp === undefined) rec.maxHp = 3;
  if (rec.isKO) return;

  const boss = DB.bossEvents[bossIdx];
  const s = wbmSettings(boss);
  const damage = Math.max(1, Math.min(3, parseInt(s.minionDamage) || 1));
  rec.hp = Math.max(0, rec.hp - damage);

  const lostIdx = rec.hp;
  const heartEl = document.getElementById('wbm-heart-' + lostIdx);
  if (heartEl) { heartEl.classList.add('shake'); setTimeout(() => heartEl.classList.remove('shake'), 500); }

  if (!rec.minionLog) rec.minionLog = [];
  rec.minionLog.unshift({ ts: Date.now(), event: reason === 'timeout' ? 'timeout' : 'wrong' });

  if (rec.hp <= 0) {
    rec.isKO = true;
    rec.koTime = Date.now();
    rec.reviveAt = Date.now() + ((s.reviveTimeSec || 60) * 1000);
    rec.hp = 0;
    saveDB();
    toast('💀 You have been knocked out! Wait to revive or ask your teacher.', '#ef4444');
    _wbmRefreshBattleArea(bossIdx);
    wbmStartKoTimer(bossIdx);
  } else {
    saveDB();
    toast(`You lost ${damage} HP! (${rec.hp} remaining)`, reason === 'timeout' ? '#f97316' : '#ef4444');
    _wbmRefreshBattleArea(bossIdx);
  }
};

// ── Minion answer handler ─────────────────────────────────────────────────────

window.wbmAnswerMinion = function (bossIdx, minionId, chosenOpt) {
  const boss = DB.bossEvents[bossIdx];
  if (!boss) return;
  wbmEnsureActiveMinions(boss);
  const mIdx = boss.activeMinions.findIndex(m => m.id === minionId);
  if (mIdx < 0) return;

  const minion = boss.activeMinions[mIdx];
  const s = wbmSettings(boss);
  const q = s.questions[minion.questionIdx];
  if (!q) return;

  const isCorrect = chosenOpt === q.answer;

  document.querySelectorAll('.wbm-opt').forEach(el => { el.classList.add('disabled'); el.onclick = null; });
  const chosenEl  = document.getElementById('wbm-opt-' + chosenOpt);
  const correctEl = document.getElementById('wbm-opt-' + q.answer);

  if (isCorrect) {
    chosenEl?.classList.add('correct');
    boss.activeMinions.splice(mIdx, 1);
    if (currentUser) {
      const parts = wbcGetParticipants(bossIdx);
      if (parts[currentUser.id]) {
        parts[currentUser.id].minionsDefeated = (parts[currentUser.id].minionsDefeated || 0) + 1;
      }
    }
    saveDB();
    if (typeof wblTrackMinionKill === 'function') wblTrackMinionKill(bossIdx, currentUser.id);
    toast('✅ Minion defeated! +1 Minion Kill', '#4edea3');
    setTimeout(() => { _wbmRefreshBattleArea(bossIdx); }, 800);
  } else {
    chosenEl?.classList.add('wrong');
    correctEl?.classList.add('correct');
    wbmDealDamage(bossIdx, 'wrong');
  }
};

// ── Minion timeout ────────────────────────────────────────────────────────────

window.wbmMinionTimeout = function (bossIdx, minionId) {
  const boss = DB.bossEvents[bossIdx];
  if (!boss) return;
  wbmEnsureActiveMinions(boss);
  const mIdx = boss.activeMinions.findIndex(m => m.id === minionId);
  if (mIdx < 0) return;
  boss.activeMinions.splice(mIdx, 1);
  saveDB();
  wbmDealDamage(bossIdx, 'timeout');
};

// ── Minion encounter rendering ─────────────────────────────────────────────────

window.wbmRenderMinionSection = function (bossIdx, sideOverride) {
  const boss = DB.bossEvents[bossIdx];
  if (!boss) return '';
  const minion = sideOverride
    ? wbmGetCurrentMinionBySide(bossIdx, sideOverride)
    : wbmGetCurrentMinion(bossIdx);
  if (!minion) return '';
  const s = wbmSettings(boss);
  if (!s.enabled) return '';
  const q = s.questions[minion.questionIdx];
  if (!q) return '';

  const age = (Date.now() - minion.spawnTime) / 1000;
  const remaining = Math.max(0, (minion.questionTimeSec || 20) - age);
  const pct = Math.max(0, Math.min(100, (remaining / (minion.questionTimeSec || 20)) * 100));
  const entryClass = (minion.side || 'left') === 'right' ? 'wbm-entry-right' : 'wbm-entry-left';

  return `
  <div class="wbm-minion-alert ${entryClass}" id="wbm-minion-alert-${minion.id}">
    <div class="wbm-minion-alert-header">
      <div class="wbm-minion-sprite">${minion.sprite}</div>
      <div class="wbm-minion-info">
        <div class="wbm-minion-name">⚠️ MINION SPAWNED — ${minion.name.toUpperCase()}</div>
        <div class="wbm-minion-threat">Defeat it before time runs out or lose 1 HP!</div>
      </div>
      <div class="wbm-minion-timer-badge" id="wbm-minion-timer-${minion.id}">${Math.ceil(remaining)}s</div>
    </div>
    <div class="wbm-question-wrap">
      <div class="wbm-q-label">MINION CHALLENGE</div>
      <div class="wbm-q-text">${q.q}</div>
      <div class="wbm-opts" id="wbm-opts-${minion.id}">
        ${q.opts.map((opt, oi) => `
        <div class="wbm-opt" id="wbm-opt-${oi}" onclick="wbmAnswerMinion(${bossIdx},'${minion.id}',${oi})">
          <div class="wbm-opt-letter">${String.fromCharCode(65 + oi)}</div>
          ${opt}
        </div>`).join('')}
      </div>
      <div class="wbm-timer-bar-track">
        <div class="wbm-timer-bar-fill" id="wbm-timer-bar-${minion.id}" style="width:${pct}%"></div>
      </div>
    </div>
  </div>`;
};

// ── KO section rendering ───────────────────────────────────────────────────────

window.wbmRenderKOSection = function (bossIdx) {
  const rec = wbmMyHp(bossIdx);
  if (!rec.isKO) return '';
  const now = Date.now();
  const reviveAt = rec.reviveAt || now;
  const msLeft = Math.max(0, reviveAt - now);
  const sLeft = Math.ceil(msLeft / 1000);
  const m = Math.floor(sLeft / 60);
  const s = sLeft % 60;
  const timeStr = m > 0 ? `${m}m ${s}s` : `${s}s`;

  return `
  <div class="wbm-ko-banner">
    <div style="position:relative;z-index:1">
      <div class="wbm-ko-icon">💀</div>
      <div class="wbm-ko-title">KNOCKED OUT</div>
      <div class="wbm-ko-sub">You've run out of HP and can't deal damage to the boss until revived. Wait for auto-revive or ask your teacher.</div>
      ${msLeft > 0 ? `
      <div>
        <div style="font-family:var(--fm);font-size:9px;color:rgba(239,68,68,.6);letter-spacing:.1em;margin-bottom:6px">AUTO-REVIVE IN</div>
        <div class="wbm-ko-timer" id="wbm-ko-countdown">⏱️ ${timeStr}</div>
      </div>` : `
      <div class="wbm-ko-timer" style="color:#4edea3;border-color:rgba(78,222,163,.3)">✅ Ready to Revive</div>`}
      <div class="wbm-ko-actions">
        ${msLeft <= 0 ? `<button class="wbm-revive-btn" onclick="wbmSelfRevive(${bossIdx})">✨ Auto-Revive</button>` : ''}
        <button class="wbm-revive-btn" onclick="toast('Ask your teacher to revive you from the Boss Events admin panel!','#f97316')" style="border-color:rgba(255,185,95,.3);color:var(--tertiary)">📢 Ask Teacher</button>
      </div>
    </div>
  </div>`;
};

// ── Self-revive ────────────────────────────────────────────────────────────────

window.wbmSelfRevive = function (bossIdx) {
  const parts = wbcGetParticipants(bossIdx);
  const rec = parts[currentUser.id];
  if (!rec || !rec.isKO) return;
  if (rec.reviveAt && Date.now() < rec.reviveAt) {
    toast('Auto-revive timer not finished yet!', '#ffb4ab');
    return;
  }
  rec.isKO = false; rec.hp = 1; rec.koTime = 0; rec.reviveAt = 0;
  saveDB();
  toast('✨ You have been revived with 1 HP!', '#4edea3');
  wbmStopKoTimer();
  _wbmRefreshBattleArea(bossIdx);
};

// ── KO countdown timer ────────────────────────────────────────────────────────

window.wbmStartKoTimer = function (bossIdx) {
  wbmStopKoTimer();
  WBM.koReviveTimer = setInterval(() => {
    const rec = wbmMyHp(bossIdx);
    if (!rec.isKO) { clearInterval(WBM.koReviveTimer); WBM.koReviveTimer = null; return; }
    const now = Date.now();
    const msLeft = Math.max(0, (rec.reviveAt || now) - now);
    if (msLeft <= 0) {
      clearInterval(WBM.koReviveTimer); WBM.koReviveTimer = null;
      wbmSelfRevive(bossIdx);
      return;
    }
    const sLeft = Math.ceil(msLeft / 1000);
    const m = Math.floor(sLeft / 60);
    const s = sLeft % 60;
    const el = document.getElementById('wbm-ko-countdown');
    if (el) el.textContent = `⏱️ ${m > 0 ? m + 'm ' : ''}${s}s`;
  }, 1000);
};

window.wbmStopKoTimer = function () {
  if (WBM.koReviveTimer) { clearInterval(WBM.koReviveTimer); WBM.koReviveTimer = null; }
};

// ── Minion countdown timer (student side) ─────────────────────────────────────

window.wbmStartMinionCountdown = function (bossIdx) {
  if (WBM.countdownTimer) clearInterval(WBM.countdownTimer);
  WBM.countdownTimer = setInterval(() => {
    const boss = DB.bossEvents[bossIdx];
    if (!boss) { clearInterval(WBM.countdownTimer); return; }
    wbmPruneExpiredMinions(bossIdx);
    const minions = (boss.activeMinions || []).slice();
    if (!minions.length) { clearInterval(WBM.countdownTimer); return; }
    let anyTimeout = false;
    minions.forEach(minion => {
      const age = (Date.now() - minion.spawnTime) / 1000;
      const remaining = Math.max(0, (minion.questionTimeSec || 20) - age);
      const timerEl = document.getElementById('wbm-minion-timer-' + minion.id);
      if (timerEl) timerEl.textContent = Math.ceil(remaining) + 's';
      const barEl = document.getElementById('wbm-timer-bar-' + minion.id);
      if (barEl) {
        const pct = Math.max(0, Math.min(100, (remaining / (minion.questionTimeSec || 20)) * 100));
        barEl.style.width = pct + '%';
        barEl.style.background = pct > 40
          ? 'linear-gradient(90deg,#4edea3,#f97316)'
          : 'linear-gradient(90deg,#ef4444,#f97316)';
      }
      if (remaining <= 0) anyTimeout = true;
    });
    if (anyTimeout) {
      clearInterval(WBM.countdownTimer); WBM.countdownTimer = null;
      const boss2 = DB.bossEvents[bossIdx];
      if (boss2 && boss2.activeMinions) {
        const now = Date.now();
        const expired = boss2.activeMinions.find(m => (now - m.spawnTime) / 1000 >= (m.questionTimeSec || 20));
        if (expired) wbmMinionTimeout(bossIdx, expired.id);
      }
    }
  }, 250);
};

// ── Refresh battle area in place ───────────────────────────────────────────────

function _wbmRefreshBattleArea(bossIdx) {
  const rec = wbmMyHp(bossIdx);
  const hpBarEl = document.getElementById('wbm-hp-bar-section');
  if (hpBarEl) hpBarEl.innerHTML = wbmRenderHpBar(bossIdx);

  // Dual-side dock (battle overlay wbr-minion-dock)
  const dockLeft  = document.getElementById('wbr-minion-dock');
  const dockRight = document.getElementById('wbr-minion-dock-right');
  if (dockLeft || dockRight) {
    if (rec.isKO) {
      if (dockLeft)  dockLeft.innerHTML  = wbmRenderKOSection(bossIdx);
      if (dockRight) dockRight.innerHTML = '';
    } else {
      if (dockLeft)  dockLeft.innerHTML  = wbmRenderMinionSection(bossIdx, 'left')  || '';
      if (dockRight) dockRight.innerHTML = wbmRenderMinionSection(bossIdx, 'right') || '';
    }
    const anyMinion = wbmGetCurrentMinion(bossIdx);
    if (anyMinion) wbmStartMinionCountdown(bossIdx);
    return;
  }

  // Single-panel (lobby / wbe-arena view)
  const minionAreaEl = document.getElementById('wbm-minion-section');
  if (minionAreaEl) {
    if (rec.isKO) {
      minionAreaEl.innerHTML = wbmRenderKOSection(bossIdx);
      wbmStartKoTimer(bossIdx);
    } else {
      const minion = wbmGetCurrentMinion(bossIdx);
      if (minion) {
        minionAreaEl.innerHTML = wbmRenderMinionSection(bossIdx);
        wbmStartMinionCountdown(bossIdx);
      } else {
        minionAreaEl.innerHTML = '';
      }
    }
  }
}

// ── Spawn toast notification ───────────────────────────────────────────────────

function _wbmShowSpawnToast(sprite, name) {
  const old = document.getElementById('wbm-spawn-toast');
  if (old) old.remove();
  if (WBM.activeSpawnToast) clearTimeout(WBM.activeSpawnToast);
  const el = document.createElement('div');
  el.id = 'wbm-spawn-toast';
  el.className = 'wbm-spawn-toast';
  el.innerHTML = `
    <div class="wbm-spawn-toast-icon">${sprite}</div>
    <div class="wbm-spawn-toast-text">
      <div class="wbm-spawn-toast-title">⚠️ MINION SPAWNED!</div>
      <div class="wbm-spawn-toast-sub">${name} has appeared! Answer quickly!</div>
    </div>`;
  document.body.appendChild(el);
  WBM.activeSpawnToast = setTimeout(() => { el.remove(); WBM.activeSpawnToast = null; }, 3500);
}

// ── Admin: Force spawn ────────────────────────────────────────────────────────

window.wbmAdminForceSpawn = function (bossIdx) {
  const boss = DB.bossEvents[bossIdx];
  if (!boss) return;
  const s = wbmSettings(boss);
  if (!s.enabled)                                      { toast('Enable minions first!', '#ffb4ab'); return; }
  if (!s.questions || s.questions.length === 0)        { toast('Add minion questions first!', '#ffb4ab'); return; }
  wbmSpawnMinion(bossIdx);
  toast('👹 Minion force-spawned!', '#f97316');
  renderAdminBossEvents();
};

// ── Admin: Revive student ─────────────────────────────────────────────────────

window.wbmAdminReviveStudent = function (bossIdx, studentId) {
  const parts = wbcGetParticipants(bossIdx);
  const rec = parts[studentId];
  if (!rec) return;
  rec.isKO = false; rec.hp = 3; rec.koTime = 0; rec.reviveAt = 0;
  saveDB();
  const st = DB.students.find(s => s.id === studentId);
  toast(`✨ ${st ? st.name : 'Student'} has been revived with full HP!`, '#4edea3');
  if (currentUser && currentUser.id === studentId) _wbmRefreshBattleArea(bossIdx);
};

// ── Admin: Revive panel modal ─────────────────────────────────────────────────

window.wbmOpenRevivePanel = function (bossIdx) {
  const parts = Object.values(wbcGetParticipants(bossIdx));
  showModal(`
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
    <div style="width:40px;height:40px;border-radius:10px;background:rgba(78,222,163,.15);border:1px solid rgba(78,222,163,.3);display:flex;align-items:center;justify-content:center;font-size:22px">✨</div>
    <div>
      <div class="modal-h2" style="margin-bottom:2px">Revive Students</div>
      <div style="font-size:12px;color:var(--text-muted)">Manually revive knocked-out students to full HP</div>
    </div>
  </div>
  ${parts.length === 0
    ? `<div style="text-align:center;padding:32px;color:var(--text-muted)">No students have joined yet.</div>`
    : parts.map(p => {
        const st = DB.students.find(s => s.id === p.studentId);
        const hp = p.hp !== undefined ? p.hp : 3;
        const isKO = !!p.isKO;
        return `<div class="wbm-revive-student-row ${isKO ? 'ko-row' : ''}">
      <div style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--fh);font-weight:900;font-size:12px;border:2px solid ${(p.studentColor||'#8b5cf6')+'55'};background:${(p.studentColor||'#8b5cf6')+'22'};color:${p.studentColor||'#8b5cf6'};flex-shrink:0">${p.studentInit || '?'}</div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:700;color:var(--on-surface)">${p.studentName || 'Student'}</div>
        <div style="display:flex;align-items:center;gap:4px;margin-top:3px">
          ${Array.from({ length: 3 }, (_, i) => `<span style="font-size:14px;${i >= hp ? 'filter:grayscale(1);opacity:.3' : ''}">❤️</span>`).join('')}
          ${isKO ? `<span style="font-family:var(--fm);font-size:9px;color:#ef4444;margin-left:6px;letter-spacing:.06em">KO</span>` : ''}
        </div>
      </div>
      <button class="wbm-revive-btn" onclick="wbmAdminReviveStudent(${bossIdx},'${p.studentId}');closeModalForce();wbmOpenRevivePanel(${bossIdx})" ${!isKO && hp >= 3 ? 'disabled' : ''}>
        ${isKO ? '✨ Revive' : '💉 Restore HP'}
      </button>
    </div>`;
      }).join('')}
  <div style="padding-top:12px;border-top:1px solid var(--border);margin-top:12px">
    <button class="btn btn-ghost btn-block" onclick="closeModalForce()">Close</button>
  </div>
  `, 'md');
};

// ── Admin: Minion settings modal ──────────────────────────────────────────────

window.wbmOpenMinionSettings = function (bossIdx) {
  const boss = DB.bossEvents[bossIdx];
  if (!boss) return;
  const s = wbmSettings(boss);
  window._wbmEditingBossIdx = bossIdx;
  window._wbmDraftMinionQs = JSON.parse(JSON.stringify(s.questions || []));

  showModal(`
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
    <div style="width:40px;height:40px;border-radius:10px;background:rgba(249,115,22,.15);border:1px solid rgba(249,115,22,.35);display:flex;align-items:center;justify-content:center;font-size:22px">👿</div>
    <div>
      <div class="modal-h2" style="margin-bottom:2px">Minion Settings — ${boss.name}</div>
      <div style="font-size:12px;color:var(--text-muted)">Configure minion spawning, HP damage, and question pool</div>
    </div>
  </div>

  <div class="wbm-admin-section">
    <div class="wbm-admin-section-title">👿 Minion Spawning</div>
    <div style="margin-bottom:14px">
      <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="wbm-enabled" ${s.enabled ? 'checked' : ''} style="width:auto;accent-color:#f97316">
        Enable Boss Minion System
      </label>
    </div>
    <div class="combat-settings-grid">
      <div class="form-group" style="margin:0">
        <label class="form-label">Average Spawn Interval (seconds)</label>
        <input type="number" id="wbm-interval" value="${s.spawnIntervalSec || 60}" min="10" max="600" style="width:100%">
        <div style="font-size:10px;color:var(--text-muted);margin-top:4px">Actual spawns are randomized around this average.</div>
      </div>
      <div class="form-group" style="margin:0">
        <label class="form-label">Maximum Active Minions</label>
        <input type="number" id="wbm-max" value="${s.maxActive || 3}" min="1" max="10" style="width:100%">
      </div>
    </div>
    <div style="margin-top:14px">
      <label class="form-label">Spawn Side</label>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:6px" id="wbm-side-selector">
        ${[
          { val: 'left',   icon: '⬅️', label: 'Left Only'  },
          { val: 'right',  icon: '➡️', label: 'Right Only' },
          { val: 'random', icon: '🎲', label: 'Random'     },
          { val: 'both',   icon: '⚡', label: 'Both Sides' },
        ].map(opt => `
        <button type="button" onclick="wbmSelectSide('${opt.val}')" id="wbm-side-${opt.val}"
          style="padding:10px 6px;border-radius:10px;border:2px solid ${(s.spawnSide||'random')===opt.val?'#f97316':'rgba(255,255,255,0.1)'};
                 background:${(s.spawnSide||'random')===opt.val?'rgba(249,115,22,0.15)':'rgba(255,255,255,0.03)'};
                 color:${(s.spawnSide||'random')===opt.val?'#f97316':'var(--text-muted)'};
                 cursor:pointer;font-family:var(--fh);font-size:11px;font-weight:800;text-align:center;line-height:1.4;transition:all .18s">
          ${opt.icon}<br>${opt.label}
        </button>`).join('')}
      </div>
      <input type="hidden" id="wbm-spawn-side" value="${s.spawnSide || 'random'}">
      <div style="font-size:10px;color:var(--text-muted);margin-top:6px">
        <b style="color:#f97316">Both Sides</b> spawns two simultaneous minions, one on each side of the arena.
      </div>
    </div>
  </div>

  <div class="wbm-admin-section">
    <div class="wbm-admin-section-title">⏱️ Timing</div>
    <div class="combat-settings-grid">
      <div class="form-group" style="margin:0">
        <label class="form-label">Minion Lifetime (seconds)</label>
        <input type="number" id="wbm-lifetime" value="${s.lifetimeSec || 30}" min="5" max="300" style="width:100%">
      </div>
      <div class="form-group" style="margin:0">
        <label class="form-label">Student Answer Time (seconds)</label>
        <input type="number" id="wbm-qtime" value="${s.questionTimeSec || 20}" min="5" max="120" style="width:100%">
      </div>
    </div>
  </div>

  <div class="wbm-admin-section">
    <div class="wbm-admin-section-title">💔 Player Damage</div>
    <div class="combat-settings-grid">
      <div class="form-group" style="margin:0">
        <label class="form-label">HP Lost on Wrong / Timeout</label>
        <input type="number" id="wbm-damage" value="${s.minionDamage || 1}" min="1" max="3" style="width:100%">
        <div style="font-size:10px;color:var(--text-muted);margin-top:4px">Max: 3</div>
      </div>
      <div class="form-group" style="margin:0">
        <label class="form-label">Auto-Revive Time (seconds)</label>
        <input type="number" id="wbm-revive" value="${s.reviveTimeSec || 60}" min="10" max="600" style="width:100%">
      </div>
    </div>
  </div>

  <div class="wbm-admin-section">
    <div class="wbm-admin-section-title" style="display:flex;align-items:center;justify-content:space-between">
      <span>📋 Minion Question Pool</span>
      <button class="btn btn-ghost btn-xs" onclick="wbmAdminAddMinionQ()">＋ Add</button>
    </div>
    <div id="wbm-q-list">${_wbmRenderMinionQList(window._wbmDraftMinionQs)}</div>
    ${(DB.quizzes || []).length > 0 ? `
    <div style="display:flex;gap:8px;align-items:flex-end;margin-top:10px">
      <div class="form-group" style="flex:1;margin:0">
        <label class="form-label">Import from Quest</label>
        <select id="wbm-import-quiz" style="width:100%">
          <option value="">— Pick a quest —</option>
          ${(DB.quizzes || []).map(q => `<option value="${q.id}">${q.title} (${q.questions.length} Qs)</option>`).join('')}
        </select>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="wbmAdminImportQs()">Import</button>
    </div>` : ''}
  </div>

  <div style="display:flex;gap:10px;padding-top:4px">
    <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
    <button class="btn btn-primary" style="flex:1;background:linear-gradient(135deg,#f97316,#ea580c);box-shadow:0 4px 14px rgba(249,115,22,.3)" onclick="wbmSaveMinionSettings(${bossIdx})">👿 Save Minion Settings</button>
  </div>
  `, 'lg');
};

// ── Admin: side selector button handler ───────────────────────────────────────

window.wbmSelectSide = function (side) {
  const hidden = document.getElementById('wbm-spawn-side');
  if (hidden) hidden.value = side;
  ['left', 'right', 'random', 'both'].forEach(v => {
    const btn = document.getElementById('wbm-side-' + v);
    if (!btn) return;
    const active = v === side;
    btn.style.borderColor = active ? '#f97316' : 'rgba(255,255,255,0.1)';
    btn.style.background  = active ? 'rgba(249,115,22,0.15)' : 'rgba(255,255,255,0.03)';
    btn.style.color       = active ? '#f97316' : 'var(--text-muted)';
  });
};

// ── Admin: question list renderer ─────────────────────────────────────────────

function _wbmRenderMinionQList(qs) {
  if (!qs || qs.length === 0) {
    return `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px;background:rgba(35,31,56,.5);border-radius:8px;border:1px dashed rgba(255,255,255,.08)">No minion questions yet. Add some for minions to challenge students with.</div>`;
  }
  return qs.map((q, qi) => `
  <div class="qb-block" style="margin-bottom:8px;border-color:rgba(249,115,22,0.15)">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-size:11px;font-weight:700;color:#f97316">Minion Question ${qi + 1}</div>
      <button class="btn btn-danger btn-xs" onclick="wbmAdminRemoveMinionQ(${qi})">✕</button>
    </div>
    <input type="text" value="${q.q || ''}" placeholder="Type the question..." style="width:100%;margin-bottom:8px" oninput="window._wbmDraftMinionQs[${qi}].q=this.value">
    <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px">Click ● to mark correct answer</div>
    ${(q.opts || ['', '', '', '']).map((opt, oi) => `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
      <div onclick="window._wbmDraftMinionQs[${qi}].answer=${oi};document.getElementById('wbm-q-list').innerHTML=_wbmRenderMinionQList(window._wbmDraftMinionQs)"
        style="width:20px;height:20px;border-radius:50%;border:2px solid ${q.answer===oi?'#4edea3':'rgba(255,255,255,.15)'};background:${q.answer===oi?'rgba(78,222,163,.2)':''};cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:9px">
        ${q.answer === oi ? '✓' : ''}
      </div>
      <input type="text" value="${opt || ''}" placeholder="Option ${String.fromCharCode(65 + oi)}" style="flex:1;font-size:12px;padding:7px 10px" oninput="window._wbmDraftMinionQs[${qi}].opts[${oi}]=this.value">
    </div>`).join('')}
  </div>`).join('');
}

window.wbmAdminAddMinionQ = function () {
  if (!window._wbmDraftMinionQs) window._wbmDraftMinionQs = [];
  window._wbmDraftMinionQs.push({ q: '', opts: ['', '', '', ''], answer: 0 });
  document.getElementById('wbm-q-list').innerHTML = _wbmRenderMinionQList(window._wbmDraftMinionQs);
};

window.wbmAdminRemoveMinionQ = function (qi) {
  if (!window._wbmDraftMinionQs) return;
  window._wbmDraftMinionQs.splice(qi, 1);
  document.getElementById('wbm-q-list').innerHTML = _wbmRenderMinionQList(window._wbmDraftMinionQs);
};

window.wbmAdminImportQs = function () {
  const qid = document.getElementById('wbm-import-quiz')?.value;
  if (!qid) { toast('Select a quest first', '#ffb4ab'); return; }
  const quiz = (DB.quizzes || []).find(q => q.id === qid);
  if (!quiz) return;
  window._wbmDraftMinionQs = JSON.parse(JSON.stringify(quiz.questions));
  document.getElementById('wbm-q-list').innerHTML = _wbmRenderMinionQList(window._wbmDraftMinionQs);
  toast(`✅ Imported ${quiz.questions.length} questions`, '#4edea3');
};

window.wbmSaveMinionSettings = function (bossIdx) {
  const boss = DB.bossEvents[bossIdx];
  if (!boss) return;
  boss.minionSettings = {
    enabled:          document.getElementById('wbm-enabled')?.checked  || false,
    spawnIntervalSec: parseInt(document.getElementById('wbm-interval')?.value) || 60,
    maxActive:        parseInt(document.getElementById('wbm-max')?.value)      || 3,
    lifetimeSec:      parseInt(document.getElementById('wbm-lifetime')?.value) || 30,
    questionTimeSec:  parseInt(document.getElementById('wbm-qtime')?.value)    || 20,
    minionDamage:     parseInt(document.getElementById('wbm-damage')?.value)   || 1,
    reviveTimeSec:    parseInt(document.getElementById('wbm-revive')?.value)   || 60,
    spawnSide:        document.getElementById('wbm-spawn-side')?.value         || 'random',
    questions:        window._wbmDraftMinionQs || [],
  };
  saveDB();
  closeModalForce();
  toast('👿 Minion settings saved!', '#f97316');
  renderAdminBossEvents();
};
