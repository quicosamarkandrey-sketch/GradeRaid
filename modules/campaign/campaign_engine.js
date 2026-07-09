// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/campaign/engine.js
//  Campaign Stage Engine: launch, story scenes, encounter/combat loop,
//  victory, defeat, retry/next/exit navigation.
//  LOAD ORDER: First in the campaign module.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Campaign runtime state ─────────────────────────────────────────────────────
// (module-scoped; not on window — only exported helpers are on window)
let camp = {
  worldId: null, stageId: null, stage: null, world: null,
  lives: 3, maxLives: 3,
  sceneIdx: 0, scenePhase: 'story',
  enemyIdx: 0, qIdx: 0, answered: false,
  totalQ: 0, correctQ: 0, bossHp: 100,
  typeTimer: null, fullText: '', charIdx: 0,
};

// ── Progress helpers ──────────────────────────────────────────────────────────

window.isStageCleared = function (stageId) {
  if (!currentUser) return false;
  if (!DB.stageProgress) DB.stageProgress = {};
  return !!((DB.stageProgress[currentUser.id] || {})[stageId]);
};

window.markStageCleared = function (stageId) {
  if (!currentUser) return;
  DB = loadDB();
  if (!DB.stageProgress) DB.stageProgress = {};
  if (!DB.stageProgress[currentUser.id]) DB.stageProgress[currentUser.id] = {};
  DB.stageProgress[currentUser.id][stageId] = true;
  saveDB();
};

window.getMapProgress = function () {
  const allStages = [];
  (DB.stageMap || []).forEach(w => w.stages.forEach(s => allStages.push(s)));
  const cleared  = allStages.filter(s => isStageCleared(s.id)).length;
  let activeId   = null;
  for (const s of allStages) { if (!isStageCleared(s.id)) { activeId = s.id; break; } }
  return { cleared, total: allStages.length, activeId };
};

window.getStageProgress = function (st) {
  if (!st) return { completedStageIds: new Set(), activeStageId: null, totalClear: 0 };
  const allStages        = [];
  (DB.stageMap || []).forEach(w => w.stages.forEach(s => allStages.push(s)));
  const completedStageIds = new Set();
  let activeStageId       = null;
  let totalClear          = 0;
  for (const stage of allStages) {
    if (isStageCleared(stage.id)) { completedStageIds.add(stage.id); totalClear++; }
    else if (!activeStageId) { activeStageId = stage.id; }
  }
  return { completedStageIds, activeStageId, totalClear };
};

// ── Launch ────────────────────────────────────────────────────────────────────

window.launchCampaignStage = function (worldId, stageId) {
  closeStageMap();
  const world = (DB.stageMap || []).find(w => w.id === worldId);
  if (!world) return;
  const stage = world.stages.find(s => s.id === stageId);
  if (!stage) return toast('Stage not found!');
  if (!stage.scenes || !stage.enemies) return toast('This stage has no content yet. Ask your instructor to add scenes and questions.', '#ffb95f');

  camp.worldId = worldId; camp.stageId = stageId; camp.stage = stage; camp.world = world;
  camp.lives = stage.lives || 3; camp.maxLives = stage.lives || 3;
  camp.sceneIdx = 0; camp.scenePhase = 'story'; camp.enemyIdx = 0; camp.qIdx = 0;
  camp.answered = false; camp.totalQ = 0; camp.correctQ = 0; camp.bossHp = 100;
  (stage.enemies || []).forEach(e => { camp.totalQ += (e.questions || []).length; });

  document.getElementById('campaign-overlay').classList.add('open');
  _campUpdateHUD();
  _campShowScene();
  document.getElementById('camp-scene').onclick = _campSceneClick;
  document.addEventListener('keydown', _campKeyHandler);
};

window._campKeyHandler = function (e) {
  if (e.key === ' ' || e.key === 'Enter') _campSceneClick();
};

// ── Story scenes ──────────────────────────────────────────────────────────────

function _campSceneClick() {
  if (document.getElementById('camp-story-panel').style.display === 'none') return;
  if (camp.charIdx < camp.fullText.length) {
    clearInterval(camp.typeTimer);
    document.getElementById('camp-narr-text').textContent = camp.fullText;
    camp.charIdx = camp.fullText.length;
    document.getElementById('camp-continue-hint').style.display = 'block';
    return;
  }
  _campAdvance();
}

function _campAdvance() {
  if (camp.scenePhase === 'story') {
    camp.sceneIdx++;
    const scenes = camp.stage.scenes || [];
    if (camp.sceneIdx < scenes.length) _campShowScene();
    else { camp.scenePhase = 'encounter'; camp.enemyIdx = 0; camp.qIdx = 0; _campShowEncounter(); }
  } else if (camp.scenePhase === 'outro') {
    camp.sceneIdx++;
    const outro = camp.stage.outro || [];
    if (camp.sceneIdx < outro.length) _campShowOutroScene();
    else _campVictory();
  }
}

function _campUpdateHUD() {
  document.getElementById('camp-stage-label').textContent = camp.world.icon + ' ' + camp.world.label;
  document.getElementById('camp-title-hud').textContent   = camp.stage.title;
  document.getElementById('camp-lives').innerHTML = Array(camp.maxLives).fill(0).map((_, i) =>
    `<span class="camp-heart${i >= camp.lives ? ' lost' : ''}">❤️</span>`
  ).join('');
  const isBoss = camp.stage.type === 'boss';
  const bar    = document.getElementById('camp-enemy-bar');
  bar.style.display = isBoss ? 'block' : 'none';
  if (isBoss) {
    const en = (camp.stage.enemies || [])[camp.enemyIdx];
    document.getElementById('camp-enemy-name').textContent = en ? en.name : 'BOSS';
    document.getElementById('camp-enemy-hp').style.width   = camp.bossHp + '%';
  }
}

function _campSetBg(color) {
  document.getElementById('camp-bg').style.background = `radial-gradient(ellipse at 30% 40%,${color || '#1a0a2e'} 0%,#0a0914 100%)`;
}

function _campShowScene() {
  const sc = (camp.stage.scenes || [])[camp.sceneIdx]; if (!sc) return;
  document.getElementById('camp-story-panel').style.display  = 'block';
  document.getElementById('camp-encounter').style.display    = 'none';
  document.getElementById('camp-result').style.display       = 'none';
  document.getElementById('camp-continue-hint').style.display = 'none';
  _campSetBg(sc.bg);
  document.getElementById('camp-speaker').textContent = sc.speaker || 'NARRATOR';
  _campTypewrite(sc.text || '');
}

function _campTypewrite(text) {
  camp.fullText = text; camp.charIdx = 0;
  const el = document.getElementById('camp-narr-text'); el.textContent = '';
  clearInterval(camp.typeTimer);
  camp.typeTimer = setInterval(() => {
    if (camp.charIdx < camp.fullText.length) { el.textContent += camp.fullText[camp.charIdx]; camp.charIdx++; }
    else { clearInterval(camp.typeTimer); document.getElementById('camp-continue-hint').style.display = 'block'; }
  }, 22);
}

// ── Encounter / combat loop ───────────────────────────────────────────────────

function _campShowEncounter() {
  const enemies = camp.stage.enemies || [];
  if (camp.enemyIdx >= enemies.length) {
    camp.scenePhase = 'outro'; camp.sceneIdx = 0;
    const o = camp.stage.outro || [];
    o.length ? _campShowOutroScene() : _campVictory();
    return;
  }
  const enemy     = enemies[camp.enemyIdx];
  const questions = enemy.questions || [];
  if (camp.qIdx >= questions.length) { camp.enemyIdx++; camp.qIdx = 0; _campShowEncounter(); return; }

  document.getElementById('camp-story-panel').style.display = 'none';
  document.getElementById('camp-encounter').style.display   = 'flex';
  document.getElementById('camp-result').style.display      = 'none';
  _campSetBg('#150a2e');

  const sprite = enemy.sprite || '👹';
  const sprEl  = document.getElementById('camp-enemy-sprite');
  if (sprEl) {
    if (sprite && sprite.indexOf('<') !== -1) sprEl.innerHTML = sprite;
    else sprEl.textContent = sprite;
  }
  document.getElementById('camp-enemy-title').textContent = enemy.title || 'ENEMY ENCOUNTER';

  const q = questions[camp.qIdx];
  document.getElementById('camp-q-text').textContent    = q.q;
  document.getElementById('camp-q-progress').textContent = `QUESTION ${camp.qIdx + 1} OF ${questions.length}  ·  ❤️ ${camp.lives}/${camp.maxLives}`;
  document.getElementById('camp-options').innerHTML = q.opts.map((opt, i) =>
    `<button class="camp-opt" id="camp-opt-${i}" onclick="campAnswer(${i})">
      <span class="camp-opt-letter">${String.fromCharCode(65 + i)}</span>${_esc(opt)}
    </button>`
  ).join('');
  camp.answered = false;
  _campUpdateHUD();
}

window.campAnswer = function (idx) {
  if (camp.answered) return;
  camp.answered = true;
  const enemy   = camp.stage.enemies[camp.enemyIdx];
  const q       = enemy.questions[camp.qIdx];
  const correct = idx === q.answer;

  q.opts.forEach((_, i) => {
    const el = document.getElementById('camp-opt-' + i); if (!el) return;
    el.onclick = null;
    if (i === q.answer)          el.classList.add('correct');
    else if (i === idx && !correct) el.classList.add('wrong');
  });

  if (correct) {
    camp.correctQ++;
    camp.bossHp = Math.max(0, camp.bossHp - Math.round(100 / Math.max(1, camp.totalQ)));
    _campUpdateHUD();
    setTimeout(() => { camp.qIdx++; _campShowEncounter(); }, 1200);
  } else {
    camp.lives--;
    _campUpdateHUD();
    const scene = document.getElementById('camp-scene');
    scene.classList.add('shake');
    setTimeout(() => scene.classList.remove('shake'), 400);
    if (camp.lives <= 0) { setTimeout(() => _campDefeat(), 1000); }
    else                 { setTimeout(() => { camp.qIdx++; _campShowEncounter(); }, 1400); }
  }
};

function _campShowOutroScene() {
  const sc = (camp.stage.outro || [])[camp.sceneIdx]; if (!sc) return;
  document.getElementById('camp-story-panel').style.display   = 'block';
  document.getElementById('camp-encounter').style.display     = 'none';
  document.getElementById('camp-continue-hint').style.display = 'none';
  _campSetBg(sc.bg || '#0e1a0e');
  document.getElementById('camp-speaker').textContent = sc.speaker || 'NARRATOR';
  _campTypewrite(sc.text || '');
}

// ── Victory / defeat ──────────────────────────────────────────────────────────

function _campVictory() {
  clearInterval(camp.typeTimer);
  document.getElementById('camp-story-panel').style.display  = 'none';
  document.getElementById('camp-encounter').style.display    = 'none';
  document.getElementById('camp-result').style.display       = 'flex';
  document.getElementById('camp-enemy-bar').style.display    = 'none';

  const accuracy    = Math.round(camp.correctQ / Math.max(1, camp.totalQ) * 100);
  const xpEarned    = Math.round(camp.stage.xp    * (accuracy / 100));
  const coinsEarned = Math.round(camp.stage.coins  * (accuracy / 100));

  const isBoss = camp.stage.type === 'boss';
  document.getElementById('camp-res-emoji').textContent  = isBoss ? '🏆' : '✨';
  document.getElementById('camp-res-title').textContent  = isBoss ? 'BOSS DEFEATED!' : 'STAGE CLEARED!';
  document.getElementById('camp-res-title').style.color  = isBoss ? '#fcd34d' : '#4edea3';
  document.getElementById('camp-res-sub').textContent    = `${camp.correctQ}/${camp.totalQ} correct · ${accuracy}% accuracy · ${camp.lives}/${camp.maxLives} lives remaining`;
  document.getElementById('camp-rewards-row').innerHTML  = `
    <div class="camp-reward-badge" style="border-color:rgba(208,188,255,.25)"><div class="camp-reward-val" style="color:#c4b5fd">+${xpEarned}</div><div class="camp-reward-lbl">XP EARNED</div></div>
    <div class="camp-reward-badge" style="border-color:rgba(255,185,95,.25)"><div class="camp-reward-val" style="color:#ffb95f">+${coinsEarned} 🪙</div><div class="camp-reward-lbl">COINS</div></div>
    <div class="camp-reward-badge" style="border-color:rgba(78,222,163,.25)"><div class="camp-reward-val" style="color:#4edea3">${accuracy}%</div><div class="camp-reward-lbl">ACCURACY</div></div>`;

  if (currentRole === 'student' && currentUser) {
    DB = loadDB();
    const idx = DB.students.findIndex(s => s.id === currentUser.id);
    if (idx >= 0) {
      DB.students[idx].xp    += xpEarned;
      DB.students[idx].coins += coinsEarned;
      currentUser.xp    += xpEarned;
      currentUser.coins += coinsEarned;
      syncStudentStatsToServer(currentUser.id, xpEarned, coinsEarned);
      DB.pointLog.unshift({ id: 'pl_' + uid(), studentId: currentUser.id, what: 'Stage: ' + camp.stage.title, pts: xpEarned, when: 'Just now' });
    }
    markStageCleared(camp.stage.id);
    saveDB();
    updateTopbar();
    if (typeof achCheckAndAward === 'function') setTimeout(() => achCheckAndAward(currentUser.id), 400);
  }

  const worlds = DB.stageMap || [];
  const wIdx   = worlds.findIndex(w => w.id === camp.worldId);
  const sIdx   = (worlds[wIdx]?.stages || []).findIndex(s => s.id === camp.stageId);
  const hasNext = worlds[wIdx]?.stages[sIdx + 1] || worlds[wIdx + 1]?.stages[0];
  document.getElementById('camp-res-retry').style.display = 'none';
  document.getElementById('camp-res-next').style.display  = hasNext ? 'inline-flex' : 'none';
}

function _campDefeat() {
  clearInterval(camp.typeTimer);
  document.getElementById('camp-story-panel').style.display = 'none';
  document.getElementById('camp-encounter').style.display   = 'none';
  document.getElementById('camp-result').style.display      = 'flex';
  document.getElementById('camp-res-emoji').textContent     = '💀';
  document.getElementById('camp-res-title').textContent     = 'DEFEATED!';
  document.getElementById('camp-res-title').style.color     = '#ef4444';
  document.getElementById('camp-res-sub').textContent       = 'You ran out of lives. Review the material and try again!';
  document.getElementById('camp-rewards-row').innerHTML     = '';
  document.getElementById('camp-res-retry').style.display   = 'inline-flex';
  document.getElementById('camp-res-next').style.display    = 'none';
}

// ── Navigation controls ───────────────────────────────────────────────────────

window.retryCampaign = function () {
  document.getElementById('campaign-overlay').classList.remove('open');
  document.removeEventListener('keydown', _campKeyHandler);
  setTimeout(() => launchCampaignStage(camp.worldId, camp.stageId), 200);
};

window.nextStageCampaign = function () {
  const worlds = DB.stageMap || [];
  const wIdx   = worlds.findIndex(w => w.id === camp.worldId);
  const sIdx   = (worlds[wIdx]?.stages || []).findIndex(s => s.id === camp.stageId);
  let nw = worlds[wIdx], ns = worlds[wIdx]?.stages[sIdx + 1];
  if (!ns && worlds[wIdx + 1]) { nw = worlds[wIdx + 1]; ns = nw.stages[0]; }
  document.getElementById('campaign-overlay').classList.remove('open');
  document.removeEventListener('keydown', _campKeyHandler);
  if (ns) setTimeout(() => launchCampaignStage(nw.id, ns.id), 200);
  else    setTimeout(() => openStageMap(), 200);
};

window.exitCampaign = function () {
  clearInterval(camp.typeTimer);
  document.getElementById('campaign-overlay').classList.remove('open');
  document.removeEventListener('keydown', _campKeyHandler);
  setTimeout(() => openStageMap(), 200);
};

window.confirmExitCampaign = function () {
  if (confirm('Exit this stage? Your progress will not be saved.')) exitCampaign();
};

console.log('[EduQuest] campaign/engine.js loaded — launchCampaignStage, campAnswer, victory/defeat, navigation registered.');
