// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/world-boss/student-page.js
//  Student-facing world boss page: render, answer handler, HP/stats live
//  updates, damage float, combo display, particles, damage list refresh.
//  LOAD AFTER: combat-settings.js, loot-rain.js, minions.js, leaderboard.js
// ═══════════════════════════════════════════════════════════════════════════════

/* ── Student World Boss Page Entry Point ── */
window.renderStudentWorldBoss = function () {
  DB = loadDB();
  const found = wbcGetActiveBoss();
  const page  = document.getElementById('s-world-boss');
  if (!page) return;

  if (found && typeof bvePreloadBossArt === 'function') {
    bvePreloadBossArt(found.boss)
      .then(() => _renderStudentWorldBossCore())
      .catch(() => _renderStudentWorldBossCore());
    _renderStudentWorldBossCore(); // render immediately with fallback
    return;
  }
  _renderStudentWorldBossCore();
};

/* ── Core render ── */
function _renderStudentWorldBossCore() {
  DB = loadDB();
  const found = wbcGetActiveBoss();
  const page  = document.getElementById('s-world-boss');
  if (!page) return;

  if (!found) {
    page.innerHTML = `
    <div style="padding:32px;max-width:1000px;margin:0 auto">
      <div class="wb-hero" style="min-height:200px;display:flex;align-items:center;justify-content:center;text-align:center">
        <div class="wb-hero-bg"></div>
        <div style="position:relative;z-index:2">
          <div style="font-size:64px;margin-bottom:16px;opacity:.5">💀</div>
          <div style="font-family:var(--fh);font-size:24px;font-weight:900;color:var(--on-surface);margin-bottom:8px">No Active Boss Event</div>
          <div style="font-size:14px;color:var(--text-muted)">Your teacher will activate a boss event soon. Check back!</div>
        </div>
      </div>
    </div>`;
    return;
  }

  const { boss, idx } = found;
  WBC.bossIdx = idx;
  const myRec   = wbcMyRecord(idx);
  const isJoined = !!myRec;
  if (isJoined) WBC.joined = true;

  const stats    = wbcBattleStats(idx);
  const pct      = Math.max(0, Math.min(100, Math.round((boss.currentHp || boss.maxHp) / boss.maxHp * 100)));
  const hpColor  = pct > 60 ? '#EC4899' : pct > 30 ? '#ffb95f' : '#ef4444';
  const parts    = Object.values(wbcGetParticipants(idx)).sort((a, b) => b.totalDamage - a.totalDamage);
  const questions = wbcGetBossQuestions(boss);
  const myQIdx   = myRec ? (myRec.lastQIdx || 0) : 0;
  const allDone  = questions.length > 0 && myQIdx >= questions.length;
  const myHistory = myRec ? (myRec.answerHistory || []) : [];

  /* ── Combat section ── */
  let combatSection = '';

  if (!isJoined) {
    combatSection = `
    <div class="wbc-panel" style="text-align:center">
      <div style="font-size:48px;margin-bottom:16px">⚔️</div>
      <div style="font-family:var(--fh);font-size:20px;font-weight:900;margin-bottom:8px;color:var(--on-surface)">Join the Raid!</div>
      <div style="font-size:14px;color:var(--text-muted);margin-bottom:24px;line-height:1.6">Answer questions to deal damage to <b style="color:#EC4899">${boss.name}</b>. Every correct answer chips away at the boss's HP. Work together with your classmates to defeat it!</div>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:20px">
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px 18px;text-align:center;min-width:100px">
          <div style="font-family:var(--fh);font-size:18px;font-weight:900;color:#EC4899">${stats.participants}</div>
          <div style="font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-top:2px">Raiders</div>
        </div>
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px 18px;text-align:center;min-width:100px">
          <div style="font-family:var(--fh);font-size:18px;font-weight:900;color:var(--tertiary)">${questions.length}</div>
          <div style="font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-top:2px">Questions</div>
        </div>
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px 18px;text-align:center;min-width:100px">
          <div style="font-family:var(--fh);font-size:18px;font-weight:900;color:var(--secondary)">${(boss.xpReward || 500).toLocaleString()} XP</div>
          <div style="font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-top:2px">If Defeated</div>
        </div>
      </div>
      ${questions.length === 0 ? `<div style="margin-bottom:20px;padding:12px;background:rgba(255,185,95,.08);border:1px solid rgba(255,185,95,.2);border-radius:10px;font-size:13px;color:var(--tertiary)">⚠️ No questions added yet. Ask your teacher to add boss questions.</div>` : ''}
      <button class="btn btn-primary" style="background:linear-gradient(135deg,#EC4899,#9333ea);box-shadow:0 6px 24px rgba(236,72,153,.4);padding:13px 36px;font-size:15px" onclick="wbcJoinBoss(${idx})" ${questions.length === 0 ? 'disabled' : ''}>
        ⚔️ Join the Raid
      </button>
    </div>`;

  } else if (allDone) {
    const totalDmgDealt = myRec.totalDamage || 0;
    combatSection = `
    <div class="wbc-panel" style="text-align:center">
      <div style="font-size:56px;margin-bottom:14px">🎯</div>
      <div style="font-family:var(--fh);font-size:22px;font-weight:900;margin-bottom:6px;color:var(--on-surface)">All Questions Answered!</div>
      <div style="font-size:14px;color:var(--text-muted);margin-bottom:20px">You've answered all available questions. Your damage has been recorded!</div>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
        <div style="background:rgba(236,72,153,.08);border:1px solid rgba(236,72,153,.2);border-radius:12px;padding:14px 20px;text-align:center">
          <div style="font-family:var(--fh);font-size:22px;font-weight:900;color:#EC4899">${totalDmgDealt.toLocaleString()}</div>
          <div style="font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-top:2px">Total Damage</div>
        </div>
        <div style="background:rgba(78,222,163,.08);border:1px solid rgba(78,222,163,.2);border-radius:12px;padding:14px 20px;text-align:center">
          <div style="font-family:var(--fh);font-size:22px;font-weight:900;color:#4edea3">${myRec.correctAnswers || 0}/${questions.length}</div>
          <div style="font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-top:2px">Correct</div>
        </div>
      </div>
    </div>`;

  } else if (isJoined && questions.length > 0) {
    const q    = questions[myQIdx];
    const dots = questions.map((_, i) => {
      if (i < myQIdx) {
        const hist = myHistory[i];
        const cls  = hist && hist.correct ? 'answered-correct' : 'answered-wrong';
        return `<div class="wbc-q-dot ${cls}" title="Q${i + 1}"></div>`;
      } else if (i === myQIdx) {
        return `<div class="wbc-q-dot current" title="Current Q${i + 1}"></div>`;
      }
      return `<div class="wbc-q-dot" title="Q${i + 1}"></div>`;
    }).join('');

    combatSection = `
    <div class="wbc-panel">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <div style="font-family:var(--fm);font-size:9px;color:#EC4899;letter-spacing:.12em">QUESTION ${myQIdx + 1} OF ${questions.length}</div>
        <div class="wb-joined-badge">⚔️ RAIDING</div>
      </div>
      <div class="wbc-q-nav">${dots}</div>
      <div class="wbc-q-text">${q.q}</div>
      <div class="wbc-opts" id="wbc-opts-list">
        ${q.opts.map((opt, oi) => `
        <div class="wbc-opt" id="wbc-opt-${oi}" onclick="wbcAnswer(${idx},${myQIdx},${oi})">
          <div class="wbc-opt-letter">${String.fromCharCode(65 + oi)}</div>
          ${opt}
        </div>`).join('')}
      </div>
      <div class="wbc-cooldown-bar"><div class="wbc-cooldown-fill" id="wbc-cd-fill" style="width:0%"></div></div>
    </div>`;

  } else if (isJoined && questions.length === 0) {
    combatSection = `
    <div class="wbc-panel" style="text-align:center;padding:40px">
      <div style="font-size:40px;margin-bottom:12px">📝</div>
      <div style="font-family:var(--fh);font-size:18px;font-weight:800;margin-bottom:6px">Waiting for Questions</div>
      <div style="font-size:13px;color:var(--text-muted)">Your teacher hasn't added combat questions yet. Stand by!</div>
    </div>`;
  }

  /* ── Full page render ── */
  page.innerHTML = `
  <div style="padding:32px;max-width:1100px;margin:0 auto">

    <div class="wb-hero" style="margin-bottom:24px">
      <div class="wb-hero-bg"></div><div class="wb-hero-grid"></div>
      <div class="wb-hero-particles" id="wb-particles"></div>
      <div class="wb-hero-content">
        <div class="wb-hero-left">
          <div class="wb-boss-tag">LIVE RAID</div>
          <div class="wb-boss-name">${boss.name}</div>
          <div class="wb-boss-desc">${boss.description || 'A powerful boss has appeared. Work together to defeat it!'}</div>
          <div class="wb-hero-stats">
            <div class="wb-stat-chip"><div class="v" style="color:#EC4899">${pct}%</div><div class="l">HP Remaining</div></div>
            <div class="wb-stat-chip"><div class="v" style="color:var(--tertiary)">${boss.difficulty || 'Normal'}</div><div class="l">Difficulty</div></div>
            <div class="wb-stat-chip"><div class="v" style="color:var(--secondary)">${stats.participants}</div><div class="l">Raiders</div></div>
          </div>
        </div>
        <div class="wb-hero-right">
          <div class="wb-boss-sprite-wrap">
            <div class="wb-boss-sprite-ring"></div>
            <div class="wb-boss-sprite-ring2"></div>
            <div class="wb-boss-sprite" id="wb-boss-sprite">
              ${(typeof bveRenderBossArt === 'function')
                ? bveRenderBossArt(boss, { id: 'wb-boss-sprite-art', stateClass: 'state-idle' })
                : (boss.image || '💀')}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="wb-hp-section" style="margin-bottom:20px">
      <div class="wb-hp-header">
        <div class="wb-hp-label">💀 BOSS HP — SHARED ACROSS ALL PLAYERS</div>
        <div class="wb-hp-numbers" id="wb-hp-num">${(boss.currentHp || boss.maxHp).toLocaleString()} <span>/ ${boss.maxHp.toLocaleString()}</span></div>
      </div>
      <div class="wb-hp-bar-track">
        <div class="wb-hp-bar-fill" id="wb-hp-fill" style="width:${pct}%;background:linear-gradient(90deg,${hpColor},${pct > 30 ? '#8b5cf6' : '#ef4444'})"></div>
      </div>
      <div class="wb-hp-pct" id="wb-hp-pct">${pct}% HP remaining</div>
    </div>

    <div class="battle-stats-grid" id="wb-stats-grid">
      <div class="bs-stat"><div class="v" style="color:#EC4899" id="bss-total-dmg">${stats.totalDmg.toLocaleString()}</div><div class="l">Total Damage</div></div>
      <div class="bs-stat"><div class="v" style="color:var(--secondary)" id="bss-participants">${stats.participants}</div><div class="l">Participants</div></div>
      <div class="bs-stat"><div class="v" style="color:var(--tertiary)" id="bss-remaining">${stats.remainingHp.toLocaleString()}</div><div class="l">Remaining HP</div></div>
      <div class="bs-stat"><div class="v" style="color:#a78bfa" id="bss-dps">${stats.dps.toLocaleString()}/s</div><div class="l">DPS</div></div>
      <div class="bs-stat"><div class="v" style="color:var(--on-surface)" id="bss-time">${stats.timeRemaining || '—'}</div><div class="l">Time Remaining</div></div>
    </div>

    <div id="wbc-combat-area">${combatSection}</div>

    <div class="wb-section-hd" style="margin-top:28px;margin-bottom:14px">
      <div class="ic">🏆</div>
      <h2>Damage Rankings</h2>
      <span class="badge-pill" style="background:rgba(236,72,153,0.12);color:#EC4899;border:1px solid rgba(236,72,153,0.22)">${parts.length} raiders</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px" id="wb-dmg-list">
      ${parts.length === 0
        ? `<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:13px;background:rgba(35,31,56,0.5);border:1px solid var(--border);border-radius:14px">No raiders yet. Be the first to join!</div>`
        : parts.map((p, i) => {
            const isMe = p.studentId === currentUser.id;
            const acc  = p.correctAnswers + p.wrongAnswers > 0
              ? Math.round(p.correctAnswers / (p.correctAnswers + p.wrongAnswers) * 100) : 0;
            return `<div class="wb-dmg-rank ${isMe ? 'me' : ''}">
              <div class="wb-dmg-rank-num">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1)}</div>
              <div class="wb-participant-av" style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--fh);font-weight:900;font-size:12px;border:2px solid ${p.studentColor + '55'};background:${p.studentColor + '22'};color:${p.studentColor};flex-shrink:0">${p.studentInit}</div>
              <div class="wb-dmg-rank-info">
                <div class="wb-dmg-rank-name">${p.studentName}${isMe ? ' <span style="font-size:9px;color:#EC4899;font-family:var(--fm)">YOU</span>' : ''}</div>
                <div class="wb-dmg-rank-sub">✅ ${p.correctAnswers} correct · ❌ ${p.wrongAnswers} wrong · ${acc}% acc</div>
              </div>
              <div class="wb-dmg-rank-val">${p.totalDamage.toLocaleString()} DMG</div>
            </div>`;
          }).join('')}
    </div>

    <div class="wb-section-hd" style="margin-top:28px;margin-bottom:14px">
      <div class="ic">🏆</div><h2>Victory Rewards</h2>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:32px">
      <div class="wb-info-card"><div class="ic">⚡</div><div class="lb">XP on Defeat</div><div class="vl" style="color:#d0bcff">${((boss.xpReward || 0) + (boss.participationReward || 0)).toLocaleString()}</div><div class="sub">Per participant</div></div>
      <div class="wb-info-card"><div class="ic">🪙</div><div class="lb">Coins on Defeat</div><div class="vl" style="color:var(--tertiary)">${((boss.coinReward || 0) + (boss.victoryReward || 0)).toLocaleString()}</div><div class="sub">Per participant</div></div>
      <div class="wb-info-card"><div class="ic">🎖️</div><div class="lb">Participation</div><div class="vl" style="color:#4edea3">${(boss.participationReward || 0).toLocaleString()}</div><div class="sub">Just for joining</div></div>
    </div>

  </div>
  <div id="wbc-float-container"></div>
  <div class="wbc-combo" id="wbc-combo"></div>`;

  _wbcSpawnParticles();
  _wbcStartLiveRefresh();
  wbcUpdateTopbarWidget();
}

/* ── Answer handler ── */
window.wbcAnswer = async function (bossIdx, qIdx, chosenOpt) {
  if (WBC.cooldownActive) return;
  DB = loadDB();
  const boss = DB.bossEvents[bossIdx];
  if (!boss || boss.status !== 'active') return;
  const questions = wbcGetBossQuestions(boss);
  if (qIdx >= questions.length) return;

  const q         = questions[qIdx];
  const isCorrect = chosenOpt === q.answer;
  let resultDmg   = 0, isCrit = false;

  // Disable all options immediately
  document.querySelectorAll('.wbc-opt').forEach(el => { el.classList.add('disabled'); el.onclick = null; });
  const chosenEl  = document.getElementById('wbc-opt-' + chosenOpt);
  const correctEl = document.getElementById('wbc-opt-' + q.answer);

  if (isCorrect) {
    chosenEl?.classList.add('correct');
    const { damage, isCrit: crit } = wbcCalcDamage(boss);
    resultDmg = damage; isCrit = crit;

    // Combo tracking
    WBC.comboCount = (WBC.comboCount || 0) + 1;
    if (WBC.comboCount >= 3) _wbcShowCombo(WBC.comboCount);

    // Crit tracking
    if (isCrit && typeof wblTrackCrit === 'function') wblTrackCrit(bossIdx, currentUser.id);

    // Apply damage
    const result = await wbcApplyDamage(bossIdx, resultDmg, currentUser.id, isCrit);
    DB = loadDB();

    // Track answer history
    const parts = wbcGetParticipants(bossIdx);
    if (parts[currentUser.id]) {
      if (!parts[currentUser.id].answerHistory) parts[currentUser.id].answerHistory = [];
      parts[currentUser.id].answerHistory[qIdx] = { correct: true, damage: resultDmg, isCrit };
      parts[currentUser.id].lastQIdx = qIdx + 1;
    }
    saveDB();

    _wbcFloatDamage(resultDmg, isCrit);
    toast(`${isCrit ? '💥 CRIT! ' : '✅ '}+${resultDmg.toLocaleString()} damage!`, isCrit ? '#ffb95f' : '#4edea3');
    _wbcUpdateHPDisplay(bossIdx);

    if (result === 'defeated' || DB.bossEvents[bossIdx].currentHp <= 0) {
      setTimeout(() => {
        if (typeof wblShowVictoryScreen === 'function') {
          wblShowVictoryScreen(bossIdx, () => renderStudentWorldBoss());
        } else {
          renderStudentWorldBoss();
        }
      }, 800);
      return;
    }

  } else {
    chosenEl?.classList.add('wrong');
    correctEl?.classList.add('correct');
    WBC.comboCount = 0;

    const parts = wbcGetParticipants(bossIdx);
    if (parts[currentUser.id]) {
      parts[currentUser.id].wrongAnswers = (parts[currentUser.id].wrongAnswers || 0) + 1;
      if (!parts[currentUser.id].answerHistory) parts[currentUser.id].answerHistory = [];
      parts[currentUser.id].answerHistory[qIdx] = { correct: false };
      parts[currentUser.id].lastQIdx = qIdx + 1;
    }
    saveDB();
    toast('❌ Wrong answer! No damage dealt.', '#ef4444');
  }

  // Advance to next question after delay
  const s         = boss.combatSettings || wbcDefaultSettings();
  const cooldown  = Math.max(0, parseInt(s.questionCooldown) || 0);
  const delay     = 1200 + cooldown * 1000;

  if (cooldown > 0) {
    WBC.cooldownActive = true;
    const fill = document.getElementById('wbc-cd-fill');
    if (fill) {
      fill.style.transition = `width ${cooldown}s linear`;
      fill.style.width = '100%';
    }
    WBC.cooldownTimeout = setTimeout(() => {
      WBC.cooldownActive = false;
      renderStudentWorldBoss();
    }, delay);
  } else {
    setTimeout(() => renderStudentWorldBoss(), delay);
  }

  _wbcUpdateHPDisplay(bossIdx);
};

/* ── HP display update ── */
function _wbcUpdateHPDisplay(bossIdx) {
  const boss = DB.bossEvents[bossIdx];
  if (!boss) return;
  const pct      = Math.max(0, Math.min(100, Math.round((boss.currentHp || boss.maxHp) / boss.maxHp * 100)));
  const hpColor  = pct > 60 ? '#EC4899' : pct > 30 ? '#ffb95f' : '#ef4444';
  const hpNum    = document.getElementById('wb-hp-num');
  const hpFill   = document.getElementById('wb-hp-fill');
  const hpPct    = document.getElementById('wb-hp-pct');
  if (hpNum)  hpNum.innerHTML  = `${(boss.currentHp || boss.maxHp).toLocaleString()} <span>/ ${boss.maxHp.toLocaleString()}</span>`;
  if (hpFill) { hpFill.style.width = pct + '%'; hpFill.style.background = `linear-gradient(90deg,${hpColor},${pct > 30 ? '#8b5cf6' : '#ef4444'})`; }
  if (hpPct)  hpPct.textContent = pct + '% HP remaining';
  _wbcUpdateStatsDisplay(bossIdx);
  wbcUpdateTopbarWidget();
  // BVE rage-mode visual at low HP
  if (typeof BVS !== 'undefined' && pct <= 30 && BVS._current !== 'rage') {
    BVS.enterRage();
    const hero = document.querySelector('.wb-hero');
    if (hero && !hero.dataset.rageActive) hero.dataset.rageActive = '1';
  }
}

/* ── Stats display update ── */
function _wbcUpdateStatsDisplay(bossIdx) {
  const stats = wbcBattleStats(bossIdx);
  const e = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  e('bss-total-dmg',   stats.totalDmg.toLocaleString());
  e('bss-participants', stats.participants);
  e('bss-remaining',   stats.remainingHp.toLocaleString());
  e('bss-dps',         stats.dps.toLocaleString() + '/s');
  e('bss-time',        stats.timeRemaining || '—');
}

/* ── Damage float animation ── */
function _wbcFloatDamage(dmg, isCrit) {
  const container = document.getElementById('wbc-float-container');
  if (!container) return;
  const sprite = document.getElementById('wb-boss-sprite');
  let x = window.innerWidth / 2, y = 200;
  if (sprite) {
    const r = sprite.getBoundingClientRect();
    x = r.left + r.width / 2 + (Math.random() - 0.5) * 60;
    y = r.top  + r.height / 2;
  }
  const el = document.createElement('div');
  el.className = 'dmg-float';
  el.textContent = (isCrit ? '💥 ' : '') + '-' + dmg.toLocaleString();
  el.style.cssText = `left:${x}px;top:${y}px;color:${isCrit ? '#ffb95f' : '#EC4899'};font-size:${isCrit ? '36px' : '26px'}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

/* ── Combo display ── */
function _wbcShowCombo(count) {
  const el = document.getElementById('wbc-combo');
  if (!el) return;
  el.textContent = `🔥 ${count}x COMBO!`;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2000);
}

/* ── Particle spawner ── */
function _wbcSpawnParticles() {
  const container = document.getElementById('wb-particles');
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < 18; i++) {
    const p    = document.createElement('div');
    p.className = 'wb-particle';
    const size = 1 + Math.random() * 3;
    p.style.cssText = `left:${Math.random() * 100}%;bottom:0;width:${size}px;height:${size}px;animation-duration:${4 + Math.random() * 8}s;animation-delay:${Math.random() * 6}s;--drift:${(Math.random() - 0.5) * 80}px`;
    container.appendChild(p);
  }
}

/* ── Live refresh loop ── */
function _wbcStartLiveRefresh() {
  if (WBC.refreshInterval) clearInterval(WBC.refreshInterval);
  WBC.refreshInterval = setInterval(() => {
    DB = loadDB();
    const lootBoss = typeof wblrGetCurrentLootBoss === 'function' ? wblrGetCurrentLootBoss() : null;
    if (lootBoss && currentRole === 'student') { renderStudentWorldBoss(); return; }
    const found = wbcGetActiveBoss();
    if (!found) { clearInterval(WBC.refreshInterval); renderStudentWorldBoss(); return; }
    if (currentRole === 'student') {
      const myRec = wbcMyRecord(found.idx);
      if (myRec) {
        const questions = wbcGetBossQuestions(found.boss);
        if (questions.length > (myRec.lastQIdx || 0)) { renderStudentWorldBoss(); return; }
      }
    }
    _wbcUpdateHPDisplay(found.idx);
    _wbcUpdateDmgList(found.idx);
  }, 3000);
}

/* ── Damage list update ── */
function _wbcUpdateDmgList(bossIdx) {
  const parts = Object.values(wbcGetParticipants(bossIdx)).sort((a, b) => b.totalDamage - a.totalDamage);
  const list  = document.getElementById('wb-dmg-list');
  if (!list || !parts.length) return;
  list.innerHTML = parts.map((p, i) => {
    const isMe = p.studentId === currentUser.id;
    const acc  = p.correctAnswers + p.wrongAnswers > 0
      ? Math.round(p.correctAnswers / (p.correctAnswers + p.wrongAnswers) * 100) : 0;
    return `<div class="wb-dmg-rank ${isMe ? 'me' : ''}">
      <div class="wb-dmg-rank-num">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1)}</div>
      <div class="wb-participant-av" style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--fh);font-weight:900;font-size:12px;border:2px solid ${p.studentColor + '55'};background:${p.studentColor + '22'};color:${p.studentColor};flex-shrink:0">${p.studentInit}</div>
      <div class="wb-dmg-rank-info">
        <div class="wb-dmg-rank-name">${p.studentName}${isMe ? ' <span style="font-size:9px;color:#EC4899;font-family:var(--fm)">YOU</span>' : ''}</div>
        <div class="wb-dmg-rank-sub">✅ ${p.correctAnswers} correct · ❌ ${p.wrongAnswers} wrong · ${acc}% acc</div>
      </div>
      <div class="wb-dmg-rank-val">${p.totalDamage.toLocaleString()} DMG</div>
    </div>`;
  }).join('');
}

console.log('[EduQuest] world-boss/student-page.js loaded — renderStudentWorldBoss, wbcAnswer, HP/stats live helpers registered.');
