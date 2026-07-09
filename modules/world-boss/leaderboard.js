// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/world-boss/leaderboard.js
//  World Boss Leaderboard: stat tracking, ranked panels, podium, CSV export.
//  Victory Experience: in-overlay defeat narration → victory screen flow.
//  LOAD AFTER: combat-settings.js, loot-rain.js, minions.js
// ═══════════════════════════════════════════════════════════════════════════════

// ── Stat tracking helpers ──────────────────────────────────────────────────────

window.wblTrackCrit = function (bossIdx, studentId) {
  const parts = wbcGetParticipants(bossIdx);
  if (parts[studentId]) {
    parts[studentId].critHits = (parts[studentId].critHits || 0) + 1;
    saveDB();
  }
};

window.wblTrackMinionKill = function (bossIdx, studentId) {
  const parts = wbcGetParticipants(bossIdx);
  if (parts[studentId]) {
    parts[studentId].minionsDefeated = (parts[studentId].minionsDefeated || 0) + 1;
    saveDB();
  }
};

// ── Participation time ─────────────────────────────────────────────────────────

function wblParticipationSec(rec) {
  if (!rec || !rec.joinTime) return 0;
  const end = rec.leaveTime || Date.now();
  return Math.round((end - rec.joinTime) / 1000);
}

// ── Rankings ───────────────────────────────────────────────────────────────────

function wblGetRankings(bossIdx) {
  const parts = Object.values(wbcGetParticipants(bossIdx));
  const withTime = parts.map(p => ({ ...p, participationSec: wblParticipationSec(p) }));

  const scoreOf = p =>
    p.totalDamage + (p.correctAnswers || 0) * 80 + (p.critHits || 0) * 150 +
    (p.minionsDefeated || 0) * 200 + Math.min(p.participationSec || 0, 600) * 2;

  const byDamage = [...withTime].sort((a, b) => (b.totalDamage || 0) - (a.totalDamage || 0));
  const byEvent  = [...withTime].sort((a, b) => scoreOf(b) - scoreOf(a));
  const byMinion = [...withTime].sort((a, b) =>
    ((b.minionsDefeated || 0) - (a.minionsDefeated || 0)) || ((b.totalDamage || 0) - (a.totalDamage || 0)));

  return { byDamage, byEvent, byMinion, scoreOf };
}

// ── Rendering helpers ──────────────────────────────────────────────────────────

function wblRewardLabel(rank) {
  if (rank === 1) return '<span class="wbl-reward-badge wbl-reward-gold">🥇 MVP</span>';
  if (rank === 2) return '<span class="wbl-reward-badge wbl-reward-silver">🥈 Elite</span>';
  if (rank === 3) return '<span class="wbl-reward-badge wbl-reward-bronze">🥉 Veteran</span>';
  return '<span class="wbl-reward-badge wbl-reward-part">🎖️ Raider</span>';
}

function wblFmtTime(sec) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function wblRenderPodium(sorted) {
  const slots  = [sorted[1], sorted[0], sorted[2]];
  const ranks  = [2, 1, 3];
  const medals = ['🥈', '🥇', '🥉'];
  return `<div class="wbl-podium">
    ${slots.map((p, i) => {
      const rank = ranks[i];
      if (!p) return `<div class="wbl-podium-slot rank${rank}"><div class="wbl-podium-block">${rank}</div></div>`;
      let titleBadgeHTML = '';
      try {
        if (typeof tsGetEquippedTitle === 'function') {
          const eqT = tsGetEquippedTitle(p.studentId);
          if (eqT && typeof tsBuildBadgeHTML === 'function')
            titleBadgeHTML = '<div style="margin-bottom:4px;transform:scale(0.8);transform-origin:center top">' + tsBuildBadgeHTML(eqT, { small: true, noParticles: true }) + '</div>';
        }
      } catch (e) {}
      return `
      <div class="wbl-podium-slot rank${rank}">
        <div class="wbl-podium-avatar" style="border-color:${p.studentColor};background:${p.studentColor}22;color:${p.studentColor}">
          <div class="wbl-medal">${medals[i]}</div>
          ${p.studentInit}
        </div>
        <div class="wbl-podium-name">${p.studentName}</div>
        ${titleBadgeHTML}
        <div class="wbl-podium-stat" style="color:${p.studentColor}">${(p.totalDamage || 0).toLocaleString()}</div>
        <div class="wbl-podium-block">#${rank}</div>
      </div>`;
    }).join('')}
  </div>`;
}

function wblRenderRow(p, rank, statValue, statLabel, statColor) {
  const rankClass     = rank <= 3 ? 'top3' : '';
  const isMe          = currentUser && p.studentId === currentUser.id;
  const rankBadgeClass = rank === 1 ? 'r1' : rank === 2 ? 'r2' : rank === 3 ? 'r3' : '';
  let titleBadgeHTML = '';
  try {
    if (typeof tsGetEquippedTitle === 'function') {
      const eqT = tsGetEquippedTitle(p.studentId);
      if (eqT && typeof tsBuildBadgeHTML === 'function')
        titleBadgeHTML = '<div style="margin-top:2px">' + tsBuildBadgeHTML(eqT, { small: true, noParticles: true }) + '</div>';
    }
  } catch (e) {}
  return `<div class="wbl-row ${rankClass} ${isMe ? 'me' : ''}">
    <div class="wbl-rank-badge ${rankBadgeClass}">${rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank}</div>
    <div class="wbl-participant-av" style="border:2px solid ${p.studentColor}55;background:${p.studentColor}22;color:${p.studentColor}">${p.studentInit}</div>
    <div class="wbl-info">
      <div class="wbl-info-name">${p.studentName}${isMe ? '<span style="font-size:9px;color:#EC4899;font-family:var(--fm)">YOU</span>' : ''}</div>
      ${titleBadgeHTML}
      <div class="wbl-info-sub">✅ ${p.correctAnswers || 0} correct · 💥 ${p.critHits || 0} crits · 👿 ${p.minionsDefeated || 0} minions · ⏱ ${wblFmtTime(p.participationSec)}</div>
    </div>
    <div class="wbl-stat-cell">
      <div class="wbl-stat-main" style="color:${statColor}">${statValue}</div>
      <div class="wbl-stat-label">${statLabel}</div>
    </div>
    <div style="flex-shrink:0">${wblRewardLabel(rank)}</div>
  </div>`;
}

// ── Tabbed leaderboard panel ───────────────────────────────────────────────────

function wblRenderPanel(bossIdx, activeTab) {
  activeTab = activeTab || 'damage';
  const boss = DB.bossEvents[bossIdx];
  if (!boss) return '<div style="padding:20px;text-align:center;color:var(--text-muted)">No boss data.</div>';
  const { byDamage, byEvent, byMinion, scoreOf } = wblGetRankings(bossIdx);
  const parts = Object.values(wbcGetParticipants(bossIdx));
  const totalDmg     = parts.reduce((a, p) => a + (p.totalDamage || 0), 0);
  const totalCorrect = parts.reduce((a, p) => a + (p.correctAnswers || 0), 0);
  const totalCrits   = parts.reduce((a, p) => a + (p.critHits || 0), 0);
  const totalMinions = parts.reduce((a, p) => a + (p.minionsDefeated || 0), 0);

  const tabBtn = (id, label, icon) =>
    `<button class="wbl-tab ${activeTab === id ? 'active' : ''}" onclick="wblSwitchTab(${bossIdx},'${id}')">${icon} ${label}</button>`;

  let rowsHtml = '';
  if (activeTab === 'damage') {
    rowsHtml = byDamage.length === 0
      ? '<div style="text-align:center;padding:32px;color:var(--text-muted)">No participants yet.</div>'
      : wblRenderPodium(byDamage) + byDamage.map((p, i) => wblRenderRow(p, i + 1, (p.totalDamage || 0).toLocaleString() + ' DMG', 'Damage', '#EC4899')).join('');
  } else if (activeTab === 'event') {
    rowsHtml = byEvent.length === 0
      ? '<div style="text-align:center;padding:32px;color:var(--text-muted)">No participants yet.</div>'
      : wblRenderPodium(byEvent) + byEvent.map((p, i) => wblRenderRow(p, i + 1, scoreOf(p).toLocaleString() + ' pts', 'Event Score', '#d0bcff')).join('');
  } else if (activeTab === 'minion') {
    rowsHtml = byMinion.length === 0
      ? '<div style="text-align:center;padding:32px;color:var(--text-muted)">No minion data yet.</div>'
      : byMinion.map((p, i) => wblRenderRow(p, i + 1, (p.minionsDefeated || 0) + ' kills', 'Minions Slain', '#f97316')).join('');
  }

  return `
  <div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
      <div class="wbl-summary-pill"><div class="v" style="color:#EC4899">${totalDmg.toLocaleString()}</div><div class="l">Total Damage</div></div>
      <div class="wbl-summary-pill"><div class="v" style="color:#4edea3">${totalCorrect}</div><div class="l">Correct Answers</div></div>
      <div class="wbl-summary-pill"><div class="v" style="color:#ffb95f">${totalCrits}</div><div class="l">Critical Hits</div></div>
      <div class="wbl-summary-pill"><div class="v" style="color:#f97316">${totalMinions}</div><div class="l">Minions Slain</div></div>
    </div>
    <div class="wbl-tabs">
      ${tabBtn('event',  'Event LB',        '🏆')}
      ${tabBtn('damage', 'Damage LB',       '💥')}
      ${tabBtn('minion', 'Minion Hunter LB','👿')}
    </div>
    <div id="wbl-rows-${bossIdx}">
      ${rowsHtml}
    </div>
  </div>`;
}

window.wblRenderPanel = wblRenderPanel;

window.wblSwitchTab = function (bossIdx, tab) {
  const container = document.getElementById('wbl-lb-container-' + bossIdx);
  if (container) { container.innerHTML = wblRenderPanel(bossIdx, tab); return; }
  wblOpenAdminLeaderboard(bossIdx, tab);
};

window.wblOpenAdminLeaderboard = function (bossIdx, activeTab) {
  activeTab = activeTab || 'event';
  const boss = DB.bossEvents[bossIdx];
  if (!boss) return;
  showModal(`
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
    <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,rgba(255,185,95,0.2),rgba(236,72,153,0.15));border:1px solid rgba(255,185,95,0.35);display:flex;align-items:center;justify-content:center;font-size:22px">🏆</div>
    <div>
      <div class="modal-h2" style="margin-bottom:2px">Leaderboard — ${boss.name}</div>
      <div style="font-size:12px;color:var(--text-muted)">Post-raid rankings and stats</div>
    </div>
    <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="wblExportCSV(${bossIdx})">📥 Export CSV</button>
  </div>
  <div id="wbl-lb-container-${bossIdx}">
    ${wblRenderPanel(bossIdx, activeTab)}
  </div>
  `, 'lg');
};

window.wblExportCSV = function (bossIdx) {
  const boss = DB.bossEvents[bossIdx];
  const { byEvent } = wblGetRankings(bossIdx);
  const rows = [
    ['Rank', 'Student Name', 'Total Damage', 'Correct Answers', 'Wrong Answers', 'Critical Hits', 'Minions Slain', 'Participation Time', 'Reward Tier'],
    ...byEvent.map((p, i) => [
      i + 1, p.studentName || p.studentId,
      p.totalDamage || 0, p.correctAnswers || 0, p.wrongAnswers || 0,
      p.critHits || 0, p.minionsDefeated || 0,
      wblFmtTime(p.participationSec),
      i === 0 ? 'MVP' : i === 1 ? 'Elite' : i === 2 ? 'Veteran' : 'Raider',
    ]),
  ];
  csvDownload(`leaderboard_${(boss?.name || 'boss').replace(/\s+/g, '_')}.csv`, rows);
};

// ── In-overlay victory experience helpers ──────────────────────────────────────

function _wbvHideAllPanels() {
  ['camp-story-panel', 'camp-encounter', 'camp-result',
   'camp-boss-defeat', 'camp-boss-victory', 'camp-boss-loot'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

function _wbvEnsureOverlayOpen() {
  document.getElementById('campaign-overlay')?.classList.add('open');
}

function _wbvCloseOverlay() {
  document.getElementById('campaign-overlay')?.classList.remove('open');
}

function _wbvNarrFallback(boss) {
  const name = boss.name || 'The Boss';
  return {
    title: name.toUpperCase(),
    text:  `${name} lets out a final roar.\nThe battlefield falls silent.\nThe heroes stand victorious.`,
  };
}

function _wbvVictoryFallback(boss) {
  const name = boss.name || 'The Boss';
  return {
    title:   `${name.toUpperCase()} DEFEATED!`,
    message: `The students united and defeated ${name}. Every correct answer brought the raid one step closer to victory.`,
  };
}

function _wbvFireworks(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width  = canvas.offsetWidth  || 600;
  canvas.height = canvas.offsetHeight || 400;
  const colors = ['#EC4899', '#ffb95f', '#4edea3', '#d0bcff', '#f97316', '#ef4444', '#22d3ee'];
  const particles = [];
  for (let i = 0; i < 90; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 5;
    particles.push({
      x: canvas.width * 0.15 + Math.random() * canvas.width * 0.7,
      y: canvas.height * 0.15 + Math.random() * canvas.height * 0.5,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 2,
      life: 1, decay: 0.011 + Math.random() * 0.017,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: 2 + Math.random() * 3,
    });
  }
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.life -= p.decay;
      if (p.life <= 0) return;
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
    if (particles.some(p => p.life > 0)) requestAnimationFrame(draw);
  }
  draw();
}

// ── Defeat narration screen ────────────────────────────────────────────────────

window.wbrShowBossDefeat = function (bossIdx, onDone) {
  DB = loadDB();
  const boss = DB.bossEvents[bossIdx];

  wbrStop();
  _wbvEnsureOverlayOpen();

  const scene = document.getElementById('camp-scene');
  if (scene) {
    scene.querySelectorAll('#wbr-live-feed,#wbr-minion-dock,#wbr-minion-dock-right,#wbr-raid-meta')
         .forEach(el => el.remove());
  }

  _wbvHideAllPanels();
  const panel = document.getElementById('camp-boss-defeat');
  if (!panel) { if (onDone) onDone(); return; }
  panel.style.display = 'flex';

  wbrSetBg('#0e0318');

  const fb        = _wbvNarrFallback(boss || {});
  const narrTitle = ((boss?.defeatNarrTitle || '').trim()) || fb.title;
  const narrRaw   = ((boss?.defeatNarrText  || '').trim()) || fb.text;
  const narrText  = narrRaw.replace(/\\n/g, '\n');

  const portrait = document.getElementById('cbd-portrait');
  if (portrait) {
    const img = boss?.image || '💀';
    if (img.startsWith('http') || img.startsWith('data:')) {
      portrait.innerHTML = `<img src="${img}" style="width:110px;height:110px;object-fit:cover;border-radius:20px;" onerror="this.parentElement.textContent='💀'">`;
    } else {
      portrait.textContent = img;
    }
  }

  const titleEl = document.getElementById('cbd-title');
  if (titleEl) titleEl.textContent = narrTitle;

  const hintEl  = document.getElementById('cbd-hint');
  if (hintEl) hintEl.style.display = 'none';

  const linesEl = document.getElementById('cbd-lines');
  if (linesEl) linesEl.innerHTML = '<span id="camp-narr-text"></span><span class="cbd-cursor"></span>';
  if (hintEl) hintEl.id = 'camp-continue-hint';

  wbrType(narrText);

  function advanceToVictory() {
    if (WBR.charIdx < WBR.fullText.length) {
      clearInterval(WBR.typingTimer);
      const narr = document.getElementById('camp-narr-text');
      if (narr) narr.textContent = WBR.fullText;
      WBR.charIdx = WBR.fullText.length;
      const hint2 = document.getElementById('camp-continue-hint');
      if (hint2) hint2.style.display = 'block';
      return;
    }
    panel.style.display = 'none';
    const h = document.getElementById('camp-continue-hint');
    if (h) h.id = 'cbd-hint';
    panel.removeEventListener('click', advanceToVictory);
    document.removeEventListener('keydown', _wbvKeyAdvance);
    if (onDone) onDone();
  }

  function _wbvKeyAdvance(e) {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); advanceToVictory(); }
  }

  panel.addEventListener('click', advanceToVictory);
  document.addEventListener('keydown', _wbvKeyAdvance);
};

// ── Victory screen ─────────────────────────────────────────────────────────────

window.wbrShowBossVictory = function (bossIdx, onContinue) {
  DB = loadDB();
  const boss = DB.bossEvents[bossIdx];
  if (typeof bvePreloadBossArt === 'function') {
    bvePreloadBossArt(boss)
      .then(() => _wbrShowBossVictoryRender(bossIdx, onContinue))
      .catch(() => _wbrShowBossVictoryRender(bossIdx, onContinue));
    return;
  }
  _wbrShowBossVictoryRender(bossIdx, onContinue);
};

function _wbrShowBossVictoryRender(bossIdx, onContinue) {
  DB = loadDB();
  const boss = DB.bossEvents[bossIdx];

  _wbvHideAllPanels();
  const panel = document.getElementById('camp-boss-victory');
  if (!panel) { _wbvCloseOverlay(); if (onContinue) onContinue(); return; }
  panel.style.display = 'flex';

  wbrSetBg('#0a0620');

  const fb       = _wbvVictoryFallback(boss || {});
  const vicTitle = ((boss?.victoryTitle   || '').trim()) || fb.title;
  const vicMsg   = ((boss?.victoryMessage || '').trim()) || fb.message;
  const bossName = boss?.name        || 'World Boss';
  const bossImg  = boss?.image       || '💀';
  const bossDesc = boss?.description || '';

  const bannerEl = document.getElementById('cbv-banner');
  if (bannerEl) bannerEl.innerHTML = `
    <div class="cbv-banner-label">WORLD BOSS RAID</div>
    <div class="cbv-banner-title">${vicTitle}</div>
    <div class="cbv-banner-sub">QUEST COMPLETE</div>`;

  const portraitInner = (typeof bveRenderBossArt === 'function')
    ? bveRenderBossArt(boss, { stateClass: 'state-idle' })
    : (bossImg.startsWith('http') || bossImg.startsWith('data:'))
      ? `<img src="${bossImg}" style="width:100%;height:100%;object-fit:cover;border-radius:14px;" onerror="this.style.display='none';this.insertAdjacentText('afterend','💀')">`
      : bossImg;

  const cardEl = document.getElementById('cbv-boss-card');
  if (cardEl) cardEl.innerHTML = `
    <div class="cbv-boss-portrait" style="overflow:hidden;display:flex;align-items:center;justify-content:center;">${portraitInner}</div>
    <div class="cbv-boss-meta">
      <div class="cbv-boss-defeated-lbl">DEFEATED</div>
      <div class="cbv-boss-name">${bossName}</div>
      ${bossDesc ? `<div class="cbv-boss-desc">${bossDesc}</div>` : ''}
    </div>`;

  const msgEl = document.getElementById('cbv-message');
  if (msgEl) msgEl.textContent = vicMsg ? `"${vicMsg}"` : '';

  const btn = document.getElementById('cbv-continue-btn');
  if (btn) {
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);
    fresh.addEventListener('click', function handleContinue() {
      fresh.removeEventListener('click', handleContinue);
      panel.style.display = 'none';
      wblrShowInOverlayLoot(bossIdx, function () {
        window._wbvShown = false;
        _wbvCloseOverlay();
        if (onContinue) onContinue();
      });
    });
  }

  const canvas = document.getElementById('cbv-fw-canvas');
  if (canvas) {
    canvas.width  = panel.offsetWidth  || window.innerWidth;
    canvas.height = panel.offsetHeight || window.innerHeight;
  }
  _wbvFireworks('cbv-fw-canvas');
}

// ── Public entry point: victory sequence ──────────────────────────────────────

window.wblShowVictoryScreen = function (bossIdx, onContinue) {
  if (window._wbvShown) return;
  window._wbvShown = true;
  setTimeout(() => { window._wbvShown = false; }, 10000);

  wbrShowBossDefeat(bossIdx, function () {
    wbrShowBossVictory(bossIdx, function () {
      window._wbvShown = false;
      if (onContinue) onContinue();
    });
  });
};
