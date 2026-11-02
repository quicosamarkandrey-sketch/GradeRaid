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
  window.RaidFX?.stop();
  clearInterval(WBR.typingTimer);
  clearInterval(WBR.refreshTimer);
  WBR.typingTimer  = null;
  WBR.refreshTimer = null;
  if (WBR.keyHandler) { document.removeEventListener('keydown', WBR.keyHandler); WBR.keyHandler = null; }
  wbmStopSpawnLoop();
  if(typeof wbsStopSkillLoop==='function')wbsStopSkillLoop();
  if(typeof wbmStopKoTimer==='function')wbmStopKoTimer();
  clearInterval(WBM.countdownTimer);WBM.countdownTimer=null;
  if(WBR.answerTimer)clearTimeout(WBR.answerTimer);
  WBR.answerPending=false;document.getElementById('raid-answer-feedback')?.remove();document.getElementById('raid-intro-continue')?.remove();
  const overlay=document.getElementById('campaign-overlay');
  if(overlay?.classList.contains('raid-battle')){
    overlay.classList.remove('raid-battle');overlay.removeAttribute('role');overlay.removeAttribute('aria-modal');overlay.removeAttribute('aria-label');
    document.body.style.overflow=WBR.previousOverflow||'';
    const exit=overlay.querySelector('.camp-hud-left>button');if(exit){exit.setAttribute('onclick','confirmExitCampaign()');if(WBR.previousExitMarkup)exit.innerHTML=WBR.previousExitMarkup;}
    const scene=document.getElementById('camp-scene');if(scene)scene.onclick=WBR.previousSceneClick||null;
  }
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
  var boss  = (AppStore.getSlice(function (s) { return s.bossEvents; }) || [])[WBR.bossIdx];
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
  window.RaidFX?.sync(WBR.bossIdx);
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
  AppStore.updateState(function (draft) {
    var p = ((draft.bossParticipants || {})[WBR.bossIdx] || {})[currentUser.id];
    if (p) p.bossIntroSeen = true;
  }, { type: 'world-boss:intro-seen', payload: { bossIdx: WBR.bossIdx, studentId: currentUser.id } });
  wbrShowEncounter();
}

// ── Intro screen ──────────────────────────────────────────────────────────────

function wbrShowIntro() {
  var boss  = (AppStore.getSlice(function (s) { return s.bossEvents; }) || [])[WBR.bossIdx];
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
  if(!document.getElementById('raid-intro-continue')){const button=document.createElement('button');button.id='raid-intro-continue';button.className='btn btn-primary';button.textContent='Continue';button.onclick=event=>{event.stopPropagation();wbrSceneClick();};document.getElementById('camp-story-panel').appendChild(button);}
}

// ── Damage feed ───────────────────────────────────────────────────────────────

function wbrRecordFeed(bossIdx, entry) {
  AppStore.updateState(function (draft) {
    var boss = (draft.bossEvents || [])[bossIdx];
    if (!boss) return;
    if (!boss.damageFeed) boss.damageFeed = [];
    boss.damageFeed.unshift(Object.assign({ id: uid(), ts: Date.now() }, entry));
    boss.damageFeed = boss.damageFeed.slice(0, 40);
  }, { type: 'world-boss:feed-recorded', payload: { bossIdx: bossIdx } });
}

function wbrFeedHTML(bossIdx) {
  var boss  = (AppStore.getSlice(function (s) { return s.bossEvents; }) || [])[bossIdx];
  var feed  = (boss && boss.damageFeed) || [];
  if (!feed.length) return '<div class="wbr-feed-item"><div class="wbr-feed-copy">No raid hits yet.</div></div>';
  return feed.slice(0, 10).map(function (e) {
    var color = _cssColor(e.color);
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
  var boss = (AppStore.getSlice(function (s) { return s.bossEvents; }) || [])[WBR.bossIdx];
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
  dock.id = 'wbr-minion-dock'; dock.className = 'wbr-minion-dock';dock.setAttribute('role','region');dock.setAttribute('aria-label','Left minion flank');
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
  dockRight.id = 'wbr-minion-dock-right'; dockRight.className = 'wbr-minion-dock-right';dockRight.setAttribute('role','region');dockRight.setAttribute('aria-label','Right minion flank');
  if (rec && !rec.isKO && s.enabled) {
    var minionRight = wbmGetCurrentMinionBySide(WBR.bossIdx, 'right');
    if (minionRight) dockRight.innerHTML = wbmRenderMinionSection(WBR.bossIdx, 'right');
  }
  scene.appendChild(dockRight);

  var anyMinion = wbmGetCurrentMinion(WBR.bossIdx);
  if (anyMinion) wbmStartMinionCountdown(WBR.bossIdx);
  window.RaidFX?.minions();
}

// ── Encounter screen ──────────────────────────────────────────────────────────

function wbrShowEncounter() {
  var boss = (AppStore.getSlice(function (s) { return s.bossEvents; }) || [])[WBR.bossIdx];
  if (!boss) return;
  if (boss.status === 'loot' || boss.status === 'ended') { wbrCloseBattle(); return; }

  WBR.phase = 'battle';
  var stage  = wbrBossStage(boss);
  var enemy  = stage.enemies[0];
  var rec    = wbcMyRecord(WBR.bossIdx);
  var qIdx   = rec ? (rec.lastQIdx || 0) : 0;
  var q      = rec?.isKO ? null : enemy.questions[qIdx];

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
  if(typeof BVS!=='undefined'){BVS.init('wb-boss-sprite-art');if(typeof wbrageIsActive==='function'&&wbrageIsActive(boss))BVS.enterRage();}
  if(typeof BHS!=='undefined')BHS.reset();
  document.getElementById('camp-enemy-title').textContent = enemy.title;

  if (!q) {
    document.getElementById('camp-q-text').innerHTML = '<div class="wbr-empty-question">'+(rec?.isKO?'You are knocked out. Use the revive panel to return to the battle.':'You have completed the question set. Your damage is saved. Watch your class finish the raid.')+'</div>';
    document.getElementById('camp-options').innerHTML = '';
    document.getElementById('camp-q-progress').textContent = (rec ? (rec.totalDamage || 0).toLocaleString() : '0') + ' DMG · waiting with the raid';
  } else {
    document.getElementById('camp-q-text').textContent    = q.q;
    document.getElementById('camp-q-progress').textContent = 'QUESTION ' + (qIdx + 1) + ' OF ' + enemy.questions.length + ' · ' + Math.max(0, boss.currentHp || 0).toLocaleString() + ' HP LEFT';
    document.getElementById('camp-options').innerHTML = (q.opts || []).map(function (opt, i) {
      return '<button class="camp-opt" id="wbr-opt-' + i + '" onclick="wbrAnswer(' + WBR.bossIdx + ',' + qIdx + ',' + i + ')">' +
        '<span class="camp-opt-letter">' + String.fromCharCode(65 + i) + '</span>' + _esc(opt) + '</button>';
    }).join('');
  }
  wbrRenderSideOverlays();
  if(typeof wbsStartSkillLoop==='function')wbsStartSkillLoop(WBR.bossIdx);
  if(typeof wbpCheckPhaseChange==='function')wbpCheckPhaseChange(WBR.bossIdx);
  if(typeof wbrageCheckAndActivate==='function')wbrageCheckAndActivate(WBR.bossIdx);
  window.RaidFX?.sync(WBR.bossIdx);
}

// ── Answer handler ────────────────────────────────────────────────────────────

async function wbrAnswer(bossIdx, qIdx, choice) {
  let boss=AppStore.getBossEvent(bossIdx);const studentId=currentUser?.id,rec=studentId&&wbcMyRecord(bossIdx);
  if(!boss||boss.status!=='active'||!rec||rec.isKO||WBR.answerPending||qIdx!==(rec.lastQIdx||0))return;
  const q=wbcGetBossQuestions(boss)[qIdx];if(!q||!Number.isInteger(choice)||choice<0||choice>=(q.opts||[]).length)return;
  if(Date.now()<(WBR.nextAnswerAt||0))return;
  WBR.answerPending=true;
  document.querySelectorAll('.camp-opt').forEach(el=>el.disabled=true);
  let feedback=document.getElementById('raid-answer-feedback');
  if(!feedback){feedback=document.createElement('div');feedback.id='raid-answer-feedback';feedback.setAttribute('role','status');document.getElementById('camp-options')?.after(feedback);}
  feedback.textContent='Confirming your answer…';
  let correct=choice===q.answer,result={damage:0,isCrit:false},outcome='hit',cooldown=boss.combatSettings?.questionCooldown??0;
  try{
    const ready=await RaidService.prepare(bossIdx);if(!ready.ok)throw new Error(ready.reason);
    if(currentUser?.id!==studentId||WBR.bossIdx!==bossIdx)return;
    boss=AppStore.getBossEvent(bossIdx);
    if(ready.mode==='managed'||RaidService.managed(boss)){
      if(!WBR.bossRunId)WBR.bossRunId=boss.raidRunId;
      if(!wbcMyRecord(bossIdx)){const joined=await RaidService.action(bossIdx,'join');if(!joined.ok)throw new Error(joined.reason);}
      if((wbcMyRecord(bossIdx)?.lastQIdx||0)!==qIdx){wbrShowEncounter();throw new Error('Your saved progress has been refreshed. Answer the question now shown.');}

      const response=await RaidService.action(bossIdx,'answer',{questionIdx:qIdx,choice});
      if(!response.ok)throw new Error(response.reason);
      choice=response.outcome.choice??choice;correct=response.outcome.correct;result={damage:response.outcome.damage||0,isCrit:!!response.outcome.isCrit};
      outcome=response.boss.current_hp<=0?'defeated':'hit';cooldown=response.outcome.cooldown||0;
    }else{
      if(correct){result=wbcCalcDamage(boss);outcome=await wbcApplyDamage(bossIdx,result.damage,studentId,result.isCrit);if(outcome==='rejected')throw new Error(WBC.lastAttackError||'Attack not confirmed. Refresh the raid and try again.');}
      if(currentUser?.id!==studentId)return;
      AppStore.updateState(d=>{const p=d.bossParticipants?.[bossIdx]?.[studentId];if(!p)return;
        if(correct&&result.isCrit)p.critHits=(p.critHits||0)+1;
        if(!correct)p.wrongAnswers=(p.wrongAnswers||0)+1;
        if(!p.answerHistory)p.answerHistory=[];p.answerHistory[qIdx]={correct,damage:result.damage};p.lastQIdx=qIdx+1;
      },{type:'world-boss:answer-recorded',payload:{bossIdx,studentId}});
    }
    if(currentUser?.id!==studentId||WBR.bossIdx!==bossIdx)return;
    document.getElementById('wbr-opt-'+choice)?.classList.add(correct?'correct':'wrong');
    document.getElementById('wbr-opt-'+q.answer)?.classList.add('correct');
    feedback.textContent=correct?(result.isCrit?'Critical hit · ':'Correct · ')+result.damage.toLocaleString()+' damage':'Not quite. The highlighted option is correct.';
    if(correct){if(window.RaidFX)RaidFX.hit(result.damage,result.isCrit);else if(typeof BVS!=='undefined')BVS.request('hit',400);wbrRecordFeed(bossIdx,{type:outcome==='defeated'?'kill':'hit',studentId,name:currentUser.name,init:currentUser.init,color:currentUser.color,damage:result.damage,crit:result.isCrit});
      if(!window.RaidFX){document.getElementById('camp-enemy-sprite')?.classList.add('raid-hit');setTimeout(()=>document.getElementById('camp-enemy-sprite')?.classList.remove('raid-hit'),400);}}
    const wait=Math.max(1100,Number(cooldown)*1000);WBR.nextAnswerAt=Date.now()+wait;
    if(cooldown>1&&outcome!=='defeated')feedback.textContent+=' Next question in '+cooldown+' seconds.';
    WBR.answerTimer=setTimeout(()=>{
      WBR.answerPending=false;if(currentUser?.id!==studentId||WBR.bossIdx!==bossIdx)return;
      feedback.remove();
      if(outcome==='defeated'){wbrCloseBattle();if(window.RaidExperience)RaidExperience.showVictory(bossIdx);}
      else wbrShowEncounter();
    },outcome==='defeated'?1100:wait);
  }catch(error){
    if(currentUser?.id===studentId&&WBR.bossIdx===bossIdx){feedback.textContent=error.message||'Connection interrupted. Try again.';document.querySelectorAll('.camp-opt').forEach(el=>el.disabled=false);}
    WBR.answerPending=false;
  }
}

// ── Open battle (with BVE art preload) ───────────────────────────────────────

async function wbrOpenBattle(bossIdx) {
  let boss=AppStore.getBossEvent(bossIdx);const identity=currentUser?.id;
  if(!boss||boss.status!=='active'||!wbcMyRecord(bossIdx)||WBR.opening||WBR.bossIdx!=null)return;
  WBR.opening=true;
  try{
    const ready=await RaidService.prepare(bossIdx);if(!ready.ok){toast(ready.reason);return;}
    if(currentUser?.id!==identity)return;
    boss=AppStore.getBossEvent(bossIdx);
    if((ready.mode==='managed'||RaidService.managed(boss))&&!wbcMyRecord(bossIdx)){const joined=await RaidService.action(bossIdx,'join');if(!joined.ok){toast(joined.reason);return;}}
    if(typeof bvePreloadBossArt==='function')await bvePreloadBossArt(boss).catch(()=>{});
    if(currentUser?.id===identity&&AppStore.getBossEvent(bossIdx)?._id===boss._id)_wbrOpenBattleRender(bossIdx);
  }finally{WBR.opening=false;}
}

function _wbrOpenBattleRender(bossIdx) {
  var boss = (AppStore.getSlice(function (s) { return s.bossEvents; }) || [])[bossIdx];
  if (!boss || boss.status !== 'active') return;
  if(!wbcMyRecord(bossIdx)||currentRole!=='student'||!RaidService.visible(boss))return;
  WBR.bossIdx = bossIdx;WBR.bossUuid=boss._id;WBR.bossRunId=boss.raidRunId;WBR.nextAnswerAt=0;WBR.answerPending=false;
  WBR.previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
  const overlay=document.getElementById('campaign-overlay');overlay.classList.add('open','raid-battle');
  overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','World Boss battle');
  const exit=overlay.querySelector('.camp-hud-left>button');if(exit){WBR.previousExitMarkup=exit.innerHTML;exit.setAttribute('onclick','wbrCloseBattle()');exit.textContent='Exit battle';exit.focus();}

  WBR.previousSceneClick=document.getElementById('camp-scene').onclick;document.getElementById('camp-scene').onclick = wbrSceneClick;
  if (WBR.keyHandler) document.removeEventListener('keydown', WBR.keyHandler);
  WBR.keyHandler = function(e){if(e.key==='Escape'){wbrCloseBattle();return;}if((e.key===' '||e.key==='Enter')&&!e.target.closest('button,input,select,textarea')){e.preventDefault();wbrSceneClick();}};
  document.addEventListener('keydown', WBR.keyHandler);
  clearInterval(WBR.refreshTimer);
  WBR.refreshTimer = setInterval(function () {
    if (WBR.bossIdx == null) return;
    var b = (AppStore.getSlice(function (s) { return s.bossEvents; }) || [])[WBR.bossIdx];
    if(WBR.answerPending)return;
    if (!b || b.status !== 'active' || b._id!==WBR.bossUuid||b.raidRunId!==WBR.bossRunId) { const won=b?.currentHp===0&&!!b.defeatedAt;wbrCloseBattle();if(won&&window.RaidExperience)RaidExperience.showVictory(bossIdx);return; }
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
    '<div class="wb-boss-name">' + _esc(boss.name) + '</div>' +
    '<div class="wb-boss-desc">' + _esc(boss.description || 'A powerful boss has appeared. Join the raid to open the full-screen battle.') + '</div>' +
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

  // Event-Driven Communication phase (roadmap Phase 4) — restores the
  // trigger point 3 patches (skills.js, this file's OWN former patch, rage.js)
  // used to hook via monkey-patching window.renderStudentWorldBoss, before
  // being silently discarded: this function replaces renderStudentWorldBoss
  // wholesale (see below) rather than chaining, so anything that patched an
  // EARLIER definition of it never ran again after this line executed. Full
  // trace: skills.js/phases.js/rage.js patch → clobbered by student-page.js's
  // later non-chaining definition → battle-overlay.js patches THAT →
  // clobbered again by this file's own replacement below. Only bve-patches.js
  // (which chains on top of THIS function, loading after it) survived.
  const _activeForEmit = (typeof wbcGetActiveBoss === 'function') ? wbcGetActiveBoss() : null;
  AppStore.emit({ type: 'world-boss:student-view-rendered', payload: { bossIdx: _activeForEmit ? _activeForEmit.idx : null } });
}

// ── Replace renderStudentWorldBoss with lobby ─────────────────────────────────
// NOTE: battle-overlay.js further wraps this below (its patch runs after).
window.renderStudentWorldBoss = wbrRenderLobby;

// ── Replace wbcJoinBoss to open battle immediately after joining ──────────────
// [Phase 1 cleanup] This is now the only window.wbcJoinBoss definition in
// the module — combat-settings.js's original and battle-overlay.js's Patch
// 3 wrapper (which used to add hp/maxHp/isKO to a joined-but-missing-them
// record) were both confirmed-dead (unconditionally overwritten by this
// file, per this file's own header: "LOAD AFTER: battle-overlay.js") and
// removed 2026-07-21. This version already includes hp/maxHp/isKO/
// bossIntroSeen inline at creation, which is what made the battle-overlay.js
// patch redundant even before it was unreachable. See the refactor log's
// Tier-1 debt-review entry.
window.wbcJoinBoss = async function (bossIdx) {
  var boss = (AppStore.getSlice(function (s) { return s.bossEvents; }) || [])[bossIdx];
  if (!boss || boss.status !== 'active') return;
  if(window.WBSN){WBSN.dismissedBosses[bossIdx]=true;if(typeof wbsnRemove==='function')wbsnRemove();}
  if(!RaidService.visible(boss)||RaidService.expired(boss)||!wbcGetBossQuestions(boss).length)return;
  const identity=currentUser.id,ready=await RaidService.prepare(bossIdx);if(!ready.ok){toast(ready.reason);return;}if(currentUser?.id!==identity)return;boss=AppStore.getBossEvent(bossIdx);
  if(ready.mode==='managed'||RaidService.managed(boss)){const response=await RaidService.action(bossIdx,'join');if(!response.ok){toast(response.reason);return;}}
  var existing = wbcGetParticipants(bossIdx)[currentUser.id];
  if (!existing) {
    AppStore.updateState(function (draft) {
      if (!draft.bossParticipants) draft.bossParticipants = {};
      if (!draft.bossParticipants[bossIdx]) draft.bossParticipants[bossIdx] = {};
      if (!draft.bossParticipants[bossIdx][currentUser.id]) {
        draft.bossParticipants[bossIdx][currentUser.id] = {
          studentId: currentUser.id, studentName: currentUser.name,
          studentInit: currentUser.init, studentColor: currentUser.color,
          totalDamage: 0, correctAnswers: 0, wrongAnswers: 0,
          critHits: 0, minionsDefeated: 0,
          joinTime: Date.now(), lastQIdx: 0,
          hp: 3, maxHp: 3, isKO: false, bossIntroSeen: false, classId:boss.classId||'default-class',
        };
      }
    }, { type: 'world-boss:joined', payload: { bossIdx: bossIdx, studentId: currentUser.id } });
  }
  var myRec = wbcGetParticipants(bossIdx)[currentUser.id];
  WBC.joined = true; WBC.bossIdx = bossIdx;
  WBC.qIdx = myRec.lastQIdx || 0;
  WBC.battleStartTime = myRec.joinTime;
  renderStudentWorldBoss();
  toast('You joined the raid. Opening battle...', '#EC4899');
  const joinedStudent=currentUser.id;setTimeout(function(){if(currentRole==='student'&&currentUser?.id===joinedStudent)wbrOpenBattle(bossIdx);},150);
};

console.log('[EduQuest] world-boss/raid-flow.js loaded — WBR, wbrRenderLobby, wbrOpenBattle, wbrAnswer, wbrFeedHTML, side overlays, wbcJoinBoss replacement registered.');

// ── Phase 7 (2026-08-10, session 2): explicit window export ──
// These were previously implicit globals (bare top-level function
// declarations, exposed to window only via classic-script behavior).
// Made explicit ahead of any real module/bundle scoping change —
// see PHASE7_IMPLICIT_GLOBALS.md.
window.wbrAnswer = wbrAnswer;
window.wbrCloseBattle = wbrCloseBattle;

// ── Phase 7 (2026-08-10, session 7): explicit window exports ──
// These were previously implicit globals (bare top-level declarations,
// reachable to other files only via classic-script auto-attach-to-window
// behavior). Made explicit ahead of any real bundle/module scoping change
// — found by build/audit-window-exports.js, which checks every symbol with
// a real cross-file consumer, not just ones reachable from onclick markup.
// See PHASE7_WINDOW_EXPORT_AUDIT.md.
window.wbrSetBg = wbrSetBg;
window.WBR = WBR;
window.wbrStop = wbrStop;
window.wbrType = wbrType;

// Public handlers are also needed when classic files are bundled into modules.
window.wbrOpenBattle=wbrOpenBattle;
window.wbrShowEncounter=wbrShowEncounter;
window.wbrShowIntro=wbrShowIntro;
window.wbrSceneClick=wbrSceneClick;
window.wbrUpdateHUD=wbrUpdateHUD;
window.wbrRenderSideOverlays=wbrRenderSideOverlays;
window.wbrBossStage=wbrBossStage;
window.wbrPct=wbrPct;
window.wbrRenderLobby=wbrRenderLobby;
window.wbrFeedHTML=wbrFeedHTML;
window.wbrRecordFeed=wbrRecordFeed;
