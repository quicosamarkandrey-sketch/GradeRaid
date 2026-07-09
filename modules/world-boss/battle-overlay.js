// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/world-boss/battle-overlay.js
//  Full-screen boss battle overlay (WBE), orientation prompt, random spawn-loop
//  replacement, and minion-inject monkey-patches.
//
//  LOAD AFTER: student-page.js, minions.js, leaderboard.js
//  (Monkey-patches _wbcStartLiveRefresh, renderStudentWorldBoss, wbcJoinBoss,
//   wbmStopSpawnLoop, wbmStartSpawnLoop — all must exist before this runs.)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Patch 1: _wbcStartLiveRefresh — also starts minion loop ──────────────────
;(function () {
  var _orig = _wbcStartLiveRefresh;
  _wbcStartLiveRefresh = function () {
    _orig();
    var found = wbcGetActiveBoss();
    if (found && currentRole === 'student') {
      wbmStartSpawnLoop(found.idx);
      var rec = wbmMyHp(found.idx);
      if (rec.isKO) wbmStartKoTimer(found.idx);
      var minion = wbmGetCurrentMinion(found.idx);
      if (minion) wbmStartMinionCountdown(found.idx);
    }
  };
})();

// ── Patch 2: renderStudentWorldBoss — injects HP hearts + minion sections ─────
;(function () {
  var _orig = renderStudentWorldBoss;
  renderStudentWorldBoss = function () {
    wbmStopSpawnLoop();
    _orig();
    var found = wbcGetActiveBoss();
    if (!found || currentRole !== 'student') return;
    var boss = found.boss, idx = found.idx;
    var s = wbmSettings(boss);
    if (!s.enabled) return;
    var combatArea = document.getElementById('wbc-combat-area');
    if (!combatArea) return;
    var myRec = wbcMyRecord(idx);
    if (!myRec) return;

    // HP bar above combat area
    var hpDiv = document.createElement('div');
    hpDiv.id = 'wbm-hp-bar-section';
    hpDiv.innerHTML = wbmRenderHpBar(idx);
    combatArea.parentNode.insertBefore(hpDiv, combatArea);

    // Minion / KO section above combat area
    var minionDiv = document.createElement('div');
    minionDiv.id = 'wbm-minion-section';
    var rec = wbmMyHp(idx);
    if (rec.isKO) {
      minionDiv.innerHTML = wbmRenderKOSection(idx);
    } else {
      var minion = wbmGetCurrentMinion(idx);
      if (minion) minionDiv.innerHTML = wbmRenderMinionSection(idx);
    }
    combatArea.parentNode.insertBefore(minionDiv, combatArea);
  };
})();

// ── Patch 3: wbcJoinBoss — initialise student HP on first join ────────────────
;(function () {
  var _orig = wbcJoinBoss;
  wbcJoinBoss = function (bossIdx) {
    _orig(bossIdx);
    var parts = wbcGetParticipants(bossIdx);
    var rec = parts[currentUser.id];
    if (rec && rec.hp === undefined) { rec.hp = 3; rec.maxHp = 3; rec.isKO = false; saveDB(); }
  };
})();

// ── Patch 4: replace wbmStopSpawnLoop + wbmStartSpawnLoop with random-delay ──
;(function () {
  wbmStopSpawnLoop = function () {
    if (WBM.spawnInterval)  { clearTimeout(WBM.spawnInterval);  WBM.spawnInterval  = null; }
    if (WBM.countdownTimer) { clearInterval(WBM.countdownTimer); WBM.countdownTimer = null; }
    if (WBM.koReviveTimer)  { clearInterval(WBM.koReviveTimer);  WBM.koReviveTimer  = null; }
  };

  wbmStartSpawnLoop = function (bossIdx) {
    wbmStopSpawnLoop();
    var scheduleNext = function () {
      DB = loadDB();
      var boss = DB.bossEvents[bossIdx];
      if (!boss || boss.status !== 'active') return;
      var s = wbmSettings(boss);
      if (!s.enabled) return;
      var delay = wbeRandomDelay(s);
      WBM.spawnInterval = setTimeout(function () {
        DB = loadDB();
        var liveBoss = DB.bossEvents[bossIdx];
        if (!liveBoss || liveBoss.status !== 'active') return;
        var liveSettings = wbmSettings(liveBoss);
        if (!liveSettings.enabled) return;
        wbmPruneExpiredMinions(bossIdx);
        wbmSpawnMinion(bossIdx);
        if (currentRole === 'student') {
          _wbmRefreshBattleArea(bossIdx);
          var minion = wbmGetCurrentMinion(bossIdx);
          if (minion) wbmStartMinionCountdown(bossIdx);
        }
        scheduleNext();
      }, delay);
    };
    scheduleNext();
  };
})();

// ── WBE state ─────────────────────────────────────────────────────────────────

var WBE = { activeBossIdx: null };

// ── Random delay helper ───────────────────────────────────────────────────────

function wbeRandomDelay(settings) {
  var base = Math.max(10, parseInt(settings.spawnIntervalSec) || 35) * 1000;
  var min  = Math.max(4500, base * 0.45);
  var max  = Math.max(min + 1000, base * 1.35);
  return Math.round(min + Math.random() * (max - min));
}

// ── Spark field particle background ──────────────────────────────────────────

function wbeSparkField() {
  return '<div class="wbe-sparks">' + Array.from({ length: 34 }, function (_, i) {
    var left  = Math.round(Math.random() * 100);
    var dur   = (5 + Math.random() * 8).toFixed(2);
    var delay = (Math.random() * -8).toFixed(2);
    var drift = Math.round((Math.random() - 0.5) * 120);
    return '<span class="wbe-spark" style="left:' + left + '%;animation-duration:' + dur + 's;animation-delay:' + delay + 's;--x:' + drift + 'px"></span>';
  }).join('') + '</div>';
}

// ── Intro "skip" handler ──────────────────────────────────────────────────────

function wbeFinishIntro(bossIdx) {
  DB = loadDB();
  var parts = wbcGetParticipants(bossIdx);
  if (parts[currentUser.id]) {
    parts[currentUser.id].bossIntroSeen = true;
    saveDB();
  }
  renderStudentWorldBoss();
}

// ── Question panel (used inside wbeRenderFullBattle) ─────────────────────────

function wbeQuestionPanel(bossIdx, boss, myRec) {
  var questions = wbcGetBossQuestions(boss);
  var myQIdx    = myRec ? (myRec.lastQIdx || 0) : 0;
  var allDone   = questions.length > 0 && myQIdx >= questions.length;

  if (myRec && myRec.isKO) {
    return '<div class="wbc-panel wbe-question" id="wbc-combat-area" style="text-align:center">' +
      '<div style="font-size:42px;margin-bottom:10px">KO</div>' +
      '<div style="font-family:var(--fh);font-size:22px;font-weight:900;color:#ef4444;margin-bottom:8px">You are knocked out</div>' +
      '<div style="font-size:13px;color:var(--text-muted)">Revive before you can damage the boss again.</div>' +
      '</div>';
  }
  if (!questions.length) {
    return '<div class="wbc-panel wbe-question" id="wbc-combat-area" style="text-align:center">' +
      '<div style="font-family:var(--fh);font-size:22px;font-weight:900;color:var(--tertiary);margin-bottom:8px">Waiting for questions</div>' +
      '<div style="font-size:13px;color:var(--text-muted)">The boss is active, but no combat questions have been added yet.</div>' +
      '</div>';
  }
  if (allDone) {
    return '<div class="wbc-panel wbe-question" id="wbc-combat-area" style="text-align:center">' +
      '<div style="font-family:var(--fh);font-size:24px;font-weight:900;color:#4edea3;margin-bottom:8px">Question deck complete</div>' +
      '<div style="font-size:13px;color:var(--text-muted);line-height:1.6">Your damage is locked in. Stay alert for random minion spawns while the raid continues.</div>' +
      '</div>';
  }

  var q          = questions[myQIdx];
  var myHistory  = myRec ? (myRec.answerHistory || []) : [];
  var dots = questions.map(function (_, i) {
    if (i < myQIdx) {
      var hist = myHistory[i];
      return '<div class="wbc-q-dot ' + (hist && hist.correct ? 'answered-correct' : 'answered-wrong') + '" title="Q' + (i + 1) + '"></div>';
    }
    return '<div class="wbc-q-dot ' + (i === myQIdx ? 'current' : '') + '" title="Q' + (i + 1) + '"></div>';
  }).join('');

  return '<div class="wbc-panel wbe-question" id="wbc-combat-area">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:8px;flex-wrap:wrap">' +
    '<div style="font-family:var(--fm);font-size:9px;color:#EC4899;letter-spacing:.14em">QUESTION ' + (myQIdx + 1) + ' OF ' + questions.length + '</div>' +
    '<div class="wb-joined-badge">LIVE BATTLE</div></div>' +
    '<div class="wbc-q-nav">' + dots + '</div>' +
    '<div class="wbc-q-text">' + q.q + '</div>' +
    '<div class="wbc-opts" id="wbc-opts-list">' +
    q.opts.map(function (opt, oi) {
      return '<div class="wbc-opt" id="wbc-opt-' + oi + '" onclick="wbcAnswer(' + bossIdx + ',' + myQIdx + ',' + oi + ')">' +
        '<div class="wbc-opt-letter">' + String.fromCharCode(65 + oi) + '</div>' + opt + '</div>';
    }).join('') +
    '</div>' +
    '<div class="wbc-cooldown-bar"><div class="wbc-cooldown-fill" id="wbc-cd-fill" style="width:0%"></div></div>' +
    '</div>';
}

// ── Minion panel (used inside wbeRenderFullBattle) ────────────────────────────

function wbeMinionPanel(bossIdx, boss, myRec) {
  var s = wbmSettings(boss);
  if (!s.enabled) {
    return '<div class="wbe-threat-idle"><span class="material-symbols-outlined">radar</span>Minion spawner is off.</div>';
  }
  if (myRec && myRec.isKO) return wbmRenderKOSection(bossIdx);
  var minion = wbmGetCurrentMinion(bossIdx);
  if (minion) return wbmRenderMinionSection(bossIdx);
  return '<div class="wbe-threat-idle"><span class="material-symbols-outlined">radar</span>Threat scanner active. Random minions can appear at any moment.</div>';
}

// ── Full-screen battle render ─────────────────────────────────────────────────

function wbeRenderFullBattle(bossIdx) {
  DB = loadDB();
  var boss = DB.bossEvents[bossIdx];
  var page = document.getElementById('s-world-boss');
  if (!page || !boss) return false;
  var myRec = wbcMyRecord(bossIdx);
  if (!myRec) return false;

  var bossArtCompact = (typeof bveRenderCompactArt === 'function') ? bveRenderCompactArt(boss, 26) : (boss.image || 'B');
  var bossArtFull    = (typeof bveRenderBossArt === 'function')    ? bveRenderBossArt(boss, { id: 'wb-boss-sprite-art', stateClass: 'state-idle' }) : (boss.image || 'B');

  if (!myRec.bossIntroSeen) {
    page.innerHTML = '<div class="wbe-shell">' +
      wbeSparkField() +
      '<div id="boss-orientation-prompt"><div class="bop-icon">📱</div><div class="bop-title">Rotate to Landscape</div><div class="bop-sub">The Boss Battle requires landscape orientation. Please rotate your device to continue.</div></div>' +
      '<div class="wbe-top"><div class="wbe-brand"><div class="wbe-boss-chip">' + bossArtCompact + '</div><div style="min-width:0"><div class="wbe-title">' + boss.name + '</div><div class="wbe-subtitle">Boss Encounter Intro</div></div></div>' +
      '<button class="wbe-close" onclick="navTo(\'s-dashboard\')">Dashboard</button></div>' +
      '<div class="wbe-intro"><div class="wbe-intro-card">' +
      '<div class="wbe-intro-boss">' + bossArtFull + '</div>' +
      '<div class="wbe-intro-kicker">A class raid begins</div>' +
      '<div class="wbe-intro-name">' + boss.name + '</div>' +
      '<div class="wbe-intro-copy">' + (boss.description || 'The boss has entered the arena. Answer fast, land critical hits, and watch for minions trying to break your focus.') + '</div>' +
      '<div class="wbe-intro-actions"><button class="wbe-begin" onclick="wbeFinishIntro(' + bossIdx + ')">Begin Battle</button></div>' +
      '</div></div></div>';
    wbmStopSpawnLoop();
    return true;
  }

  var stats       = wbcBattleStats(bossIdx);
  var parts       = Object.values(wbcGetParticipants(bossIdx)).sort(function (a, b) { return (b.totalDamage || 0) - (a.totalDamage || 0); }).slice(0, 5);
  var pct         = Math.max(0, Math.min(100, Math.round((boss.currentHp || boss.maxHp) / boss.maxHp * 100)));
  var hpText      = (boss.currentHp || boss.maxHp).toLocaleString() + ' / ' + boss.maxHp.toLocaleString();
  var s           = wbmSettings(boss);
  var minionCount = (boss.activeMinions || []).length;

  page.innerHTML = '<div class="wbe-shell">' +
    wbeSparkField() +
    '<div id="boss-orientation-prompt"><div class="bop-icon">📱</div><div class="bop-title">Rotate to Landscape</div><div class="bop-sub">The Boss Battle requires landscape orientation. Please rotate your device to continue.</div></div>' +
    '<div class="wbe-top"><div class="wbe-brand"><div class="wbe-boss-chip">' + bossArtCompact + '</div>' +
    '<div style="min-width:0"><div class="wbe-title">' + boss.name + '</div><div class="wbe-subtitle">Full-screen raid arena</div></div></div>' +
    '<button class="wbe-close" onclick="navTo(\'s-dashboard\')">Exit Screen</button></div>' +
    '<div class="wbe-arena">' +
    // Left column
    '<div class="wbe-side-stack">' +
    '<div class="wbe-panel"><div class="wbe-panel-title"><span>Your Status</span><span>' + myRec.totalDamage.toLocaleString() + ' DMG</span></div>' +
    '<div id="wbm-hp-bar-section">' + wbmRenderHpBar(bossIdx) + '</div>' +
    '<div class="wbe-stat-grid" style="margin-top:12px"><div class="wbe-stat"><div class="v" style="color:#4edea3">' + (myRec.correctAnswers || 0) + '</div><div class="l">Correct</div></div>' +
    '<div class="wbe-stat"><div class="v" style="color:#f97316">' + (myRec.minionsDefeated || 0) + '</div><div class="l">Minions</div></div></div></div>' +
    '<div class="wbe-panel"><div class="wbe-panel-title"><span>Raid Stats</span><span>' + stats.participants + ' raiders</span></div>' +
    '<div class="wbe-stat-grid">' +
    '<div class="wbe-stat"><div class="v" id="bss-total-dmg" style="color:#EC4899">' + stats.totalDmg.toLocaleString() + '</div><div class="l">Damage</div></div>' +
    '<div class="wbe-stat"><div class="v" id="bss-dps" style="color:#a78bfa">' + stats.dps.toLocaleString() + '/s</div><div class="l">DPS</div></div>' +
    '<div class="wbe-stat"><div class="v" id="bss-participants" style="color:#4edea3">' + stats.participants + '</div><div class="l">Raiders</div></div>' +
    '<div class="wbe-stat"><div class="v" id="bss-time" style="color:#ffb95f">' + (stats.timeRemaining || '-') + '</div><div class="l">Time</div></div>' +
    '</div></div></div>' +
    // Center column
    '<div class="wbe-center">' +
    '<div class="wbe-panel"><div class="wbe-panel-title"><span>Boss HP</span><span id="wb-hp-pct">' + pct + '% HP remaining</span></div>' +
    '<div class="wbe-hp-strip"><div class="wbe-hp-row"><span>' + (boss.difficulty || 'Normal') + '</span><span id="wb-hp-num">' + hpText + '</span></div>' +
    '<div class="wbe-hp-track"><div class="wbe-hp-fill" id="wb-hp-fill" style="width:' + pct + '%"></div></div></div></div>' +
    '<div class="wbe-boss-stage ' + (myRec.isKO ? 'wbe-ko-cover' : '') + '">' +
    '<div class="wb-boss-sprite" id="wb-boss-sprite">' + bossArtFull + '</div></div>' +
    wbeQuestionPanel(bossIdx, boss, myRec) +
    '</div>' +
    // Right column
    '<div class="wbe-side-stack">' +
    '<div class="wbe-panel"><div class="wbe-panel-title"><span>Minion Threat</span><span>' + (s.enabled ? 'ON' : 'OFF') + (minionCount ? ' - ' + minionCount + ' active' : '') + '</span></div>' +
    '<div id="wbm-minion-section">' + wbeMinionPanel(bossIdx, boss, myRec) + '</div></div>' +
    '<div class="wbe-panel"><div class="wbe-panel-title"><span>Top Raiders</span><span id="bss-remaining">' + Math.max(0, boss.currentHp || 0).toLocaleString() + ' HP left</span></div>' +
    '<div style="display:flex;flex-direction:column;gap:8px" id="wb-dmg-list">' +
    (parts.length ? parts.map(function (p, i) {
      return '<div class="wbl-row ' + (p.studentId === currentUser.id ? 'me' : '') + '" style="margin-bottom:0;padding:10px">' +
        '<div class="wbl-rank-badge ' + (i < 3 ? 'r' + (i + 1) : '') + '">' + (i + 1) + '</div>' +
        '<div class="wbl-info"><div class="wbl-info-name">' + p.studentName + '</div>' +
        '<div class="wbl-info-sub">' + (p.correctAnswers || 0) + ' correct - ' + (p.minionsDefeated || 0) + ' minions</div></div>' +
        '<div class="wbl-stat-cell"><div class="wbl-stat-main" style="color:#EC4899">' + (p.totalDamage || 0).toLocaleString() + '</div><div class="wbl-stat-label">DMG</div></div>' +
        '</div>';
    }).join('') : '<div class="wbe-threat-idle">No raid damage yet.</div>') +
    '</div></div></div>' +
    '</div>' +
    '<div id="wbc-float-container"></div><div class="wbc-combo" id="wbc-combo"></div>' +
    '</div>';

  WBE.activeBossIdx = bossIdx;
  _wbcStartLiveRefresh();
  wbcUpdateTopbarWidget();
  wbmStartSpawnLoop(bossIdx);
  if (myRec.isKO) wbmStartKoTimer(bossIdx);
  var minion = wbmGetCurrentMinion(bossIdx);
  if (minion) wbmStartMinionCountdown(bossIdx);
  _wbeInitOrientationPrompt();
  return true;
}

// ── Orientation prompt ────────────────────────────────────────────────────────

function _wbeInitOrientationPrompt() {
  if (window.screen && window.screen.width > 900 && window.screen.height > 900) return;
  function _updatePrompt() {
    var prompt      = document.getElementById('boss-orientation-prompt');
    if (!prompt) return;
    var isPortrait   = window.innerWidth < window.innerHeight;
    var isMobileSize = Math.min(window.innerWidth, window.innerHeight) <= 600;
    prompt.style.display = (isPortrait && isMobileSize) ? 'flex' : 'none';
  }
  _updatePrompt();
  window.addEventListener('orientationchange', function _wbeOrientListener() {
    setTimeout(_updatePrompt, 120);
    if (!document.querySelector('.wbe-shell')) {
      window.removeEventListener('orientationchange', _wbeOrientListener);
      window.removeEventListener('resize', _wbeOrientResizeListener);
    }
  });
  window.addEventListener('resize', function _wbeOrientResizeListener() { _updatePrompt(); });
}

// ── Patch 5: renderStudentWorldBoss — promote to full battle if joined ────────
;(function () {
  var _baseRenderStudentWorldBoss = renderStudentWorldBoss;
  renderStudentWorldBoss = function () {
    if (currentRole === 'student') {
      DB = loadDB();
      var loot = (typeof wblrGetCurrentLootBoss === 'function') ? wblrGetCurrentLootBoss() : null;
      if (!loot) {
        var found = wbcGetActiveBoss();
        if (found) {
          var rec = wbcMyRecord(found.idx);
          if (rec) {
            if (wbeRenderFullBattle(found.idx)) return;
          }
        }
      }
    }
    WBE.activeBossIdx = null;
    return _baseRenderStudentWorldBoss();
  };
})();
