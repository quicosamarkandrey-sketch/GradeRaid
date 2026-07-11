// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/world-boss/raid-flow.js
//  Campaign-overlay raid flow (WBR): lobby page, battle opening, intro scene,
//  question encounter, answer handler, live-feed, side overlays, victory hook,
//  and final renderStudentWorldBoss = wbrRenderLobby assignment.
//
//  LOAD AFTER: battle-overlay.js, leaderboard.js, loot-rain.js
// ═══════════════════════════════════════════════════════════════════════════════

// ── WBR state ─────────────────────────────────────────────────────────────────

var WBR = {
  bossIdx:      null,
  phase:        'intro',
  typingTimer:  null,
  fullText:     '',
  charIdx:      0,
  refreshTimer: null,
  keyHandler:   null,
};

// ── Boss stage descriptor ─────────────────────────────────────────────────────

function wbrBossStage(boss) {
  var qs      = wbcGetBossQuestions(boss) || [];
  var bossArt = (typeof bveRenderBossArt === 'function')
    ? bveRenderBossArt(boss, { id: 'wb-boss-sprite-art', stateClass: 'state-idle' })
    : (boss.image || 'B');
  var bossIcon = (typeof bveRenderCompactArt === 'function')
    ? bveRenderCompactArt(boss, 32)
    : (boss.image || 'B');
  return {
    title:   boss.name || 'World Boss',
    icon:    bossIcon,
    scenes:  [{
      speaker: 'RAID ALERT',
      bg:      '#190718',
      text:    (boss.name || 'The boss') + ' has entered the arena. This is a class-wide raid: every correct answer damages the same shared HP bar. Watch the live feed and strike when ready.',
    }],
    enemies: [{
      sprite:    bossArt,
      name:      boss.name || 'World Boss',
      title:     'BOSS ENCOUNTER',
      questions: qs,
    }],
  };
}

// ── Stop all WBR timers ───────────────────────────────────────────────────────

function wbrStop() {
  clearInterval(WBR.typingTimer);
  clearInterval(WBR.refreshTimer);
  WBR.typingTimer  = null;
  WBR.refreshTimer = null;
  if (WBR.keyHandler) { document.removeEventListener('keydown', WBR.keyHandler); WBR.keyHandler = null; }
  wbmStopSpawnLoop();
}

// ── Close overlay ─────────────────────────────────────────────────────────────

function wbrCloseBattle() {
  wbrStop();
  document.getElementById('campaign-overlay')?.classList.remove('open');
  WBR.bossIdx = null;
  renderStudentWorldBoss();
}

// ── Background tint ───────────────────────────────────────────────────────────

function wbrSetBg(color) {
  var bg = document.getElementById('camp-bg');
  if (bg) bg.style.background = 'radial-gradient(ellipse at 30% 40%,' + (color || '#190718') + ' 0%,#0a0914 100%)';
}

// ── HP percentage helper ──────────────────────────────────────────────────────

function wbrPct(boss) {
  if (!boss || !boss.maxHp) return 0;
  return Math.max(0, Math.min(100, Math.round((boss.currentHp || 0) / boss.maxHp * 100)));
}

// ── HUD update ────────────────────────────────────────────────────────────────

function wbrUpdateHUD() {
  var boss  = DB.bossEvents[WBR.bossIdx];
  if (!boss) return;
  var rec   = wbcMyRecord(WBR.bossIdx);
  var pct   = wbrPct(boss);
  var s     = (boss.minionSettings && boss.minionSettings.enabled) ? 'MINIONS ON' : 'MINIONS OFF';
  var stageLabel = document.getElementById('camp-stage-label');
  var titleHud   = document.getElementById('camp-title-hud');
  var lives      = document.getElementById('camp-lives');
  var enemyBar   = document.getElementById('camp-enemy-bar');
  var enemyName  = document.getElementById('camp-enemy-name');
  var enemyHp    = document.getElementById('camp-enemy-hp');
  if (stageLabel) stageLabel.textContent = 'WORLD BOSS RAID';
  if (titleHud)   titleHud.textContent   = boss.name;
  if (lives)      lives.innerHTML        = rec ? wbmRenderHearts(rec.hp != null ? rec.hp : 3, rec.maxHp || 3, true) : '';
  if (enemyBar)   enemyBar.style.display = 'block';
  if (enemyName)  enemyName.textContent  = boss.name + ' · ' + s;
  if (enemyHp)    enemyHp.style.width    = pct + '%';
}

// ── Typewriter ────────────────────────────────────────────────────────────────

function wbrType(text) {
  WBR.fullText = text || ''; WBR.charIdx = 0;
  var el   = document.getElementById('camp-narr-text');
  var hint = document.getElementById('camp-continue-hint');
  if (el)   el.textContent  = '';
  if (hint) hint.style.display = 'none';
  clearInterval(WBR.typingTimer);
  WBR.typingTimer = setInterval(function () {
    if (!el) return;
    if (WBR.charIdx < WBR.fullText.length) {
      el.textContent += WBR.fullText[WBR.charIdx++];
    } else {
      clearInterval(WBR.typingTimer);
      if (hint) hint.style.display = 'block';
    }
  }, 22);
}

// ── Scene click / keypress handler ───────────────────────────────────────────

function wbrSceneClick() {
  var story = document.getElementById('camp-story-panel');
  if (!story || story.style.display === 'none') return;
  var el   = document.getElementById('camp-narr-text');
  var hint = document.getElementById('camp-continue-hint');
  if (WBR.charIdx < WBR.fullText.length) {
    clearInterval(WBR.typingTimer);
    if (el) el.textContent = WBR.fullText;
    WBR.charIdx = WBR.fullText.length;
    if (hint) hint.style.display = 'block';
    return;
  }
  var parts = wbcGetParticipants(WBR.bossIdx);
  if (parts[currentUser.id]) parts[currentUser.id].bossIntroSeen = true;
  saveDB();
  wbrShowEncounter();
}

// ── Intro screen ──────────────────────────────────────────────────────────────

function wbrShowIntro() {
  DB = loadDB();
  var boss  = DB.bossEvents[WBR.bossIdx];
  if (!boss) return;
  var stage = wbrBossStage(boss);
  WBR.phase = 'intro';
  document.getElementById('camp-scene')?.querySelectorAll('#wbr-live-feed,#wbr-minion-dock,#wbr-minion-dock-right,#wbr-raid-meta')
    .forEach(function (el) { el.remove(); });
  document.getElementById('camp-story-panel').style.display = 'block';
  document.getElementById('camp-encounter').style.display   = 'none';
  document.getElementById('camp-result').style.display      = 'none';
  document.getElementById('camp-continue-hint').style.display = 'none';
  wbrSetBg(stage.scenes[0].bg);
  wbrUpdateHUD();
  document.getElementById('camp-speaker').textContent = stage.scenes[0].speaker;
  wbrType(stage.scenes[0].text);
}

// ── Damage feed ───────────────────────────────────────────────────────────────

function wbrRecordFeed(bossIdx, entry) {
  var boss = DB.bossEvents[bossIdx];
  if (!boss) return;
  if (!boss.damageFeed) boss.damageFeed = [];
  boss.damageFeed.unshift(Object.assign({ id: uid(), ts: Date.now() }, entry));
  boss.damageFeed = boss.damageFeed.slice(0, 40);
}

function wbrFeedHTML(bossIdx) {
  var boss  = DB.bossEvents[bossIdx];
  var feed  = (boss && boss.damageFeed) || [];
  if (!feed.length) return '<div class="wbr-feed-item"><div class="wbr-feed-copy">No raid hits yet.</div></div>';
  return feed.slice(0, 10).map(function (e) {
    var color = e.color || '#d0bcff';
    var label = e.type === 'kill'
      ? '<b>' + wblrEsc(e.name) + '</b> defeated the boss!'
      : '<b>' + wblrEsc(e.name) + '</b> dealt <b style="color:#EC4899">' + (e.damage || 0).toLocaleString() + '</b> damage' + (e.crit ? ' with a critical hit' : '') + '.';
    return '<div class="wbr-feed-item ' + (e.type === 'kill' ? 'kill' : '') + '">' +
      '<div class="wbr-feed-avatar" style="border-color:' + color + '66;background:' + color + '22;color:' + color + '">' + wblrEsc(e.init || '?') + '</div>' +
      '<div class="wbr-feed-copy">' + label + '</div></div>';
  }).join('');
}

// ── Side overlays (feed + minion docks) ───────────────────────────────────────

function wbrRenderSideOverlays() {
  var scene = document.getElementById('camp-scene');
  if (!scene) return;
  scene.querySelectorAll('#wbr-live-feed,#wbr-minion-dock,#wbr-minion-dock-right,#wbr-raid-meta,#wbr-close-btn')
       .forEach(function (el) { el.remove(); });
  var boss = DB.bossEvents[WBR.bossIdx];
  if (!boss) return;
  var stats = wbcBattleStats(WBR.bossIdx);
  var rec   = wbcMyRecord(WBR.bossIdx);

  // Meta pill strip
  var meta = document.createElement('div');
  meta.id = 'wbr-raid-meta'; meta.className = 'wbr-raid-meta';
  meta.innerHTML =
    '<button class="btn btn-ghost btn-sm" onclick="wbrCloseBattle()" style="justify-content:center">Exit Battle</button>' +
    '<div class="wbr-meta-pill"><div class="v" style="color:#EC4899">' + stats.totalDmg.toLocaleString() + '</div><div class="l">Class Damage</div></div>' +
    '<div class="wbr-meta-pill"><div class="v" style="color:#4edea3">' + stats.participants + '</div><div class="l">Raiders</div></div>' +
    '<div class="wbr-meta-pill"><div class="v" style="color:#f97316">' + (rec ? rec.minionsDefeated || 0 : 0) + '</div><div class="l">Your Minions</div></div>';
  scene.appendChild(meta);

  // Live feed
  var feed = document.createElement('div');
  feed.id = 'wbr-live-feed'; feed.className = 'wbr-live-feed';
  feed.innerHTML = '<div class="wbr-feed-title"><span>Live Raid Feed</span><span>' + Math.max(0, boss.currentHp || 0).toLocaleString() + ' HP</span></div>' +
    '<div class="wbr-feed-list">' + wbrFeedHTML(WBR.bossIdx) + '</div>';
  scene.appendChild(feed);

  var s = wbmSettings(boss);

  // Left minion dock
  var dock = document.createElement('div');
  dock.id = 'wbr-minion-dock'; dock.className = 'wbr-minion-dock';
  if (rec && rec.isKO) {
    dock.innerHTML = wbmRenderKOSection(WBR.bossIdx);
  } else if (s.enabled) {
    var spawnSide   = s.spawnSide || 'random';
    var minionLeft  = wbmGetCurrentMinionBySide(WBR.bossIdx, 'left');
    if (minionLeft) {
      dock.innerHTML = wbmRenderMinionSection(WBR.bossIdx, 'left');
    } else if (spawnSide !== 'right' && spawnSide !== 'both') {
      var oldest = wbmGetCurrentMinion(WBR.bossIdx);
      if (oldest) dock.innerHTML = wbmRenderMinionSection(WBR.bossIdx);
    }
  }
  scene.appendChild(dock);

  // Right minion dock
  var dockRight = document.createElement('div');
  dockRight.id = 'wbr-minion-dock-right'; dockRight.className = 'wbr-minion-dock-right';
  if (rec && !rec.isKO && s.enabled) {
    var minionRight = wbmGetCurrentMinionBySide(WBR.bossIdx, 'right');
    if (minionRight) dockRight.innerHTML = wbmRenderMinionSection(WBR.bossIdx, 'right');
  }
  scene.appendChild(dockRight);

  var anyMinion = wbmGetCurrentMinion(WBR.bossIdx);
  if (anyMinion) wbmStartMinionCountdown(WBR.bossIdx);
}

// ── Encounter screen ──────────────────────────────────────────────────────────

function wbrShowEncounter() {
  DB = loadDB();
  var boss = DB.bossEvents[WBR.bossIdx];
  if (!boss) return;
  if (boss.status === 'loot' || boss.status === 'ended') { wbrCloseBattle(); return; }

  WBR.phase = 'battle';
  var stage  = wbrBossStage(boss);
  var enemy  = stage.enemies[0];
  var rec    = wbcMyRecord(WBR.bossIdx);
  var qIdx   = rec ? (rec.lastQIdx || 0) : 0;
  var q      = enemy.questions[qIdx];

  document.getElementById('camp-story-panel').style.display = 'none';
  document.getElementById('camp-encounter').style.display   = 'flex';
  document.getElementById('camp-result').style.display      = 'none';
  wbrSetBg('#150a2e');
  wbrUpdateHUD();

  // Boss sprite (may be HTML art from BVE)
  var spriteEl = document.getElementById('camp-enemy-sprite');
  if (spriteEl) {
    if (enemy.sprite && enemy.sprite.indexOf('<') !== -1) { spriteEl.innerHTML = enemy.sprite; }
    else { spriteEl.textContent = enemy.sprite || '💀'; }
  }
  document.getElementById('camp-enemy-title').textContent = enemy.title;

  if (!q) {
    document.getElementById('camp-q-text').innerHTML = '<div class="wbr-empty-question">No more boss questions available. Stay in the raid and watch the live feed.</div>';
    document.getElementById('camp-options').innerHTML = '';
    document.getElementById('camp-q-progress').textContent = (rec ? (rec.totalDamage || 0).toLocaleString() : '0') + ' DMG · waiting with the raid';
  } else {
    document.getElementById('camp-q-text').textContent    = q.q;
    document.getElementById('camp-q-progress').textContent = 'QUESTION ' + (qIdx + 1) + ' OF ' + enemy.questions.length + ' · ' + Math.max(0, boss.currentHp || 0).toLocaleString() + ' HP LEFT';
    document.getElementById('camp-options').innerHTML = (q.opts || []).map(function (opt, i) {
      return '<button class="camp-opt" id="wbr-opt-' + i + '" onclick="wbrAnswer(' + WBR.bossIdx + ',' + qIdx + ',' + i + ')">' +
        '<span class="camp-opt-letter">' + String.fromCharCode(65 + i) + '</span>' + opt + '</button>';
    }).join('');
  }
  wbrRenderSideOverlays();
}

// ── Answer handler ────────────────────────────────────────────────────────────

async function wbrAnswer(bossIdx, qIdx, choice) {
  DB = loadDB();
  var boss = DB.bossEvents[bossIdx];
  if (!boss || boss.status !== 'active') return;
  var rec = wbcMyRecord(bossIdx);
  if (!rec || rec.isKO) return;
  var questions = wbcGetBossQuestions(boss);
  var q = questions[qIdx];
  if (!q) return;

  document.querySelectorAll('.camp-opt').forEach(function (el) { el.disabled = true; el.onclick = null; });
  var isCorrect = choice === q.answer;
  var chosen    = document.getElementById('wbr-opt-' + choice);
  var correct   = document.getElementById('wbr-opt-' + q.answer);

  if (isCorrect) {
    chosen?.classList.add('correct');
    var result  = wbcCalcDamage(boss);
    var outcome = await wbcApplyDamage(bossIdx, result.damage, currentUser.id, result.isCrit);
    // Re-fetch rec after wbcApplyDamage (rage patches may have called loadDB internally)
    var liveRec = wbcGetParticipants(bossIdx)[currentUser.id] || rec;
    if (result.isCrit) liveRec.critHits = (liveRec.critHits || 0) + 1;
    if (!liveRec.answerHistory) liveRec.answerHistory = [];
    liveRec.answerHistory[qIdx] = { correct: true, damage: result.damage };
    liveRec.lastQIdx = qIdx + 1;
    wbrRecordFeed(bossIdx, {
      type:      outcome === 'defeated' ? 'kill' : 'hit',
      studentId: currentUser.id, name: currentUser.name,
      init:      currentUser.init, color: currentUser.color,
      damage:    result.damage, crit: result.isCrit,
    });
    saveDB();
    toast(currentUser.name + ' dealt ' + result.damage.toLocaleString() + ' damage!', result.isCrit ? '#ffb95f' : '#EC4899');
    document.getElementById('camp-scene')?.classList.add('shake');
    setTimeout(function () { document.getElementById('camp-scene')?.classList.remove('shake'); }, 350);

    if (outcome === 'defeated') {
      toast(currentUser.name + ' defeated ' + boss.name + '! Loot Rush is open.', '#ffb95f');
      setTimeout(function () {
        wbrStop();
        document.getElementById('campaign-overlay')?.classList.remove('open');
        WBR.bossIdx = null;
        wblShowVictoryScreen(bossIdx, function () { renderStudentWorldBoss(); });
      }, 900);
      return;
    }
    setTimeout(function () { wbrShowEncounter(); }, 900);
  } else {
    chosen?.classList.add('wrong');
    correct?.classList.add('correct');
    rec.wrongAnswers = (rec.wrongAnswers || 0) + 1;
    if (!rec.answerHistory) rec.answerHistory = [];
    rec.answerHistory[qIdx] = { correct: false, damage: 0 };
    rec.lastQIdx = qIdx + 1;
    saveDB();
    toast('Wrong answer. The boss resists.', '#ffb4ab');
    setTimeout(function () { wbrShowEncounter(); }, 1100);
  }
}

// ── Open battle (with BVE art preload) ───────────────────────────────────────

function wbrOpenBattle(bossIdx) {
  DB = loadDB();
  var boss = DB.bossEvents[bossIdx];
  if (!boss || boss.status !== 'active') return;
  if (typeof bvePreloadBossArt === 'function') {
    bvePreloadBossArt(boss)
      .then(function () { _wbrOpenBattleRender(bossIdx); })
      .catch(function () { _wbrOpenBattleRender(bossIdx); });
    return;
  }
  _wbrOpenBattleRender(bossIdx);
}

function _wbrOpenBattleRender(bossIdx) {
  DB = loadDB();
  var boss = DB.bossEvents[bossIdx];
  if (!boss || boss.status !== 'active') return;
  WBR.bossIdx = bossIdx;
  document.getElementById('campaign-overlay').classList.add('open');
  document.getElementById('camp-scene').onclick = wbrSceneClick;
  if (WBR.keyHandler) document.removeEventListener('keydown', WBR.keyHandler);
  WBR.keyHandler = function (e) { if (e.key === ' ' || e.key === 'Enter') wbrSceneClick(); };
  document.addEventListener('keydown', WBR.keyHandler);
  clearInterval(WBR.refreshTimer);
  WBR.refreshTimer = setInterval(function () {
    if (WBR.bossIdx == null) return;
    DB = loadDB();
    var b = DB.bossEvents[WBR.bossIdx];
    if (!b || b.status !== 'active') { wbrCloseBattle(); return; }
    wbrUpdateHUD();
    if (WBR.phase === 'battle') {
      wbrRenderSideOverlays();
      var _rec = wbcMyRecord(WBR.bossIdx);
      if (_rec) {
        var _qs   = wbcGetBossQuestions(b);
        var _qIdx = _rec.lastQIdx || 0;
        var _noQ  = document.querySelector('.wbr-empty-question');
        if (_noQ && _qs.length > _qIdx) wbrShowEncounter();
      }
    }
  }, 1200);
  wbmStartSpawnLoop(bossIdx);
  var rec = wbcMyRecord(bossIdx);
  if (rec && rec.bossIntroSeen) wbrShowEncounter();
  else wbrShowIntro();
}

// ── Lobby page render ─────────────────────────────────────────────────────────

function wbrRenderLobby() {
  DB = loadDB();
  var page = document.getElementById('s-world-boss');
  if (!page) return;
  var loot = (typeof wblrGetCurrentLootBoss === 'function') ? wblrGetCurrentLootBoss() : null;
  if (loot) { wblrRenderStudentLootPage(loot.idx); return; }
  var found = wbcGetActiveBoss();
  if (found && typeof bvePreloadBossArt === 'function') {
    bvePreloadBossArt(found.boss)
      .then(function () { _wbrRenderLobbyCore(); })
      .catch(function () { _wbrRenderLobbyCore(); });
    _wbrRenderLobbyCore(); // immediate render with cached/fallback art
    return;
  }
  _wbrRenderLobbyCore();
}

function _wbrRenderLobbyCore() {
  DB = loadDB();
  var page = document.getElementById('s-world-boss');
  if (!page) return;
  var loot = (typeof wblrGetCurrentLootBoss === 'function') ? wblrGetCurrentLootBoss() : null;
  if (loot) { wblrRenderStudentLootPage(loot.idx); return; }
  var found = wbcGetActiveBoss();

  if (!found) {
    var summary = (typeof wblrGetLatestSummaryBoss === 'function') ? wblrGetLatestSummaryBoss() : null;
    if (summary) { wblrRenderFinalSummaryPage(summary.idx); return; }
    page.innerHTML = '<div style="padding:32px;max-width:1000px;margin:0 auto">' +
      '<div class="wb-hero" style="min-height:260px;display:flex;align-items:center;justify-content:center;text-align:center">' +
      '<div class="wb-hero-bg"></div>' +
      '<div style="position:relative;z-index:2">' +
      '<div style="font-size:64px;margin-bottom:16px;opacity:.5">💀</div>' +
      '<div style="font-family:var(--fh);font-size:24px;font-weight:900;color:var(--on-surface);margin-bottom:8px">No Active Boss Event</div>' +
      '<div style="font-size:14px;color:var(--text-muted)">Your teacher will activate a boss event soon.</div>' +
      '</div></div></div>';
    return;
  }

  var boss      = found.boss, idx = found.idx;
  var rec       = wbcMyRecord(idx);
  var stats     = wbcBattleStats(idx);
  var questions = wbcGetBossQuestions(boss);
  var pct       = wbrPct(boss);
  var bossArt   = (typeof bveRenderBossArt === 'function')
    ? bveRenderBossArt(boss, { id: 'wb-boss-sprite-lobby-art', stateClass: 'state-idle' })
    : (boss.image || '💀');

  page.innerHTML = '<div style="padding:32px;max-width:1100px;margin:0 auto">' +
    '<div class="wb-hero" style="margin-bottom:24px">' +
    '<div class="wb-hero-bg"></div><div class="wb-hero-grid"></div><div class="wb-hero-particles" id="wb-particles"></div>' +
    '<div class="wb-hero-content">' +
    '<div class="wb-hero-left">' +
    '<div class="wb-boss-tag">LIVE RAID LOBBY</div>' +
    '<div class="wb-boss-name">' + boss.name + '</div>' +
    '<div class="wb-boss-desc">' + (boss.description || 'A powerful boss has appeared. Join the raid to open the full-screen battle.') + '</div>' +
    '<div class="wb-hero-stats">' +
    '<div class="wb-stat-chip"><div class="v" style="color:#EC4899">' + pct + '%</div><div class="l">HP Remaining</div></div>' +
    '<div class="wb-stat-chip"><div class="v" style="color:var(--secondary)">' + stats.participants + '</div><div class="l">Raiders</div></div>' +
    '<div class="wb-stat-chip"><div class="v" style="color:#ffb95f">' + questions.length + '</div><div class="l">Questions</div></div>' +
    '</div></div>' +
    '<div class="wb-hero-right"><div class="wb-boss-sprite-wrap"><div class="wb-boss-sprite-ring"></div><div class="wb-boss-sprite-ring2"></div>' +
    '<div class="wb-boss-sprite" id="wb-boss-sprite-lobby">' + bossArt + '</div></div></div>' +
    '</div></div>' +
    '<div class="wb-hp-section">' +
    '<div class="wb-hp-header"><div class="wb-hp-label">SHARED BOSS HP</div><div class="wb-hp-numbers">' + Math.max(0, boss.currentHp || 0).toLocaleString() + ' <span>/ ' + boss.maxHp.toLocaleString() + '</span></div></div>' +
    '<div class="wb-hp-bar-track"><div class="wb-hp-bar-fill" style="width:' + pct + '%"></div></div>' +
    '<div class="wb-hp-pct">' + pct + '% HP remaining</div>' +
    '</div>' +
    '<div class="wbc-panel" style="text-align:center">' +
    '<div style="font-size:48px;margin-bottom:14px">' + (rec ? '⚔️' : '🛡️') + '</div>' +
    '<div style="font-family:var(--fh);font-size:22px;font-weight:900;color:var(--on-surface);margin-bottom:8px">' + (rec ? 'You are in the raid' : 'Join the Raid') + '</div>' +
    '<div style="font-size:14px;color:var(--text-muted);line-height:1.6;margin:0 auto 22px;max-width:620px">' +
    (rec ? 'Open the full-screen boss battle to attack. This lobby stays here while the fight happens in the battle overlay.'
         : 'Join to open the campaign-style boss battle: narration first, then shared collaborative combat.') +
    '</div>' +
    (questions.length === 0 ? '<div style="margin-bottom:18px;color:#ffb95f;font-size:13px">No boss questions are configured yet.</div>' : '') +
    '<button class="btn btn-primary" style="background:linear-gradient(135deg,#EC4899,#9333ea);padding:13px 32px;font-size:15px" ' +
    (questions.length === 0 ? 'disabled' : '') +
    ' onclick="' + (rec ? 'wbrOpenBattle(' + idx + ')' : 'wbcJoinBoss(' + idx + ')') + '">' +
    (rec ? 'Enter Battle' : 'Join Raid') + '</button></div>' +
    '<div class="wbc-panel">' +
    '<div style="font-family:var(--fm);font-size:9px;color:#ffb95f;letter-spacing:.16em;margin-bottom:12px">LIVE RAID FEED</div>' +
    '<div class="wbr-feed-list">' + wbrFeedHTML(idx) + '</div>' +
    '</div></div>';

  _wbcSpawnParticles();
  wbcUpdateTopbarWidget();
}

// ── Replace renderStudentWorldBoss with lobby ─────────────────────────────────
// NOTE: battle-overlay.js further wraps this below (its patch runs after).
window.renderStudentWorldBoss = wbrRenderLobby;

// ── Replace wbcJoinBoss to open battle immediately after joining ──────────────
window.wbcJoinBoss = function (bossIdx) {
  DB = loadDB();
  var boss = DB.bossEvents[bossIdx];
  if (!boss || boss.status !== 'active') return;
  var parts = wbcGetParticipants(bossIdx);
  if (!parts[currentUser.id]) {
    parts[currentUser.id] = {
      studentId: currentUser.id, studentName: currentUser.name,
      studentInit: currentUser.init, studentColor: currentUser.color,
      totalDamage: 0, correctAnswers: 0, wrongAnswers: 0,
      critHits: 0, minionsDefeated: 0,
      joinTime: Date.now(), lastQIdx: 0,
      hp: 3, maxHp: 3, isKO: false, bossIntroSeen: false,
    };
  }
  saveDB();
  WBC.joined = true; WBC.bossIdx = bossIdx;
  WBC.qIdx = parts[currentUser.id].lastQIdx || 0;
  WBC.battleStartTime = parts[currentUser.id].joinTime;
  renderStudentWorldBoss();
  toast('You joined the raid. Opening battle...', '#EC4899');
  setTimeout(function () { wbrOpenBattle(bossIdx); }, 150);
};

console.log('[EduQuest] world-boss/raid-flow.js loaded — WBR, wbrRenderLobby, wbrOpenBattle, wbrAnswer, wbrFeedHTML, side overlays, wbcJoinBoss replacement registered.');
