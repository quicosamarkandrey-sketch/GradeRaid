/* World Boss presentation and orchestration. Loaded after legacy UI decorators. */
;(function(){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const icon=(name)=>`<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
 const num=n=>Math.max(0,Number(n)||0).toLocaleString();
 const events=()=>AppStore.getSlice(s=>s.bossEvents||[]);
 const visible=()=>events().map((boss,index)=>({boss,index})).filter(x=>x.boss.status!=='deleted'&&RaidService.visible(x.boss));
 const hp=b=>Math.max(0,b.currentHp??b.maxHp??0),pct=b=>b.maxHp?Math.min(100,hp(b)/b.maxHp*100):0;
 const payout=b=>({xp:Math.max(0,b.xpReward??500)+Math.max(0,b.participationReward??100),coins:Math.max(0,b.coinReward??250)+Math.max(0,b.victoryReward??300)});
 const date=d=>d?new Intl.DateTimeFormat('en',{month:'short',day:'numeric',year:'numeric',timeZone:'Asia/Manila'}).format(new Date(String(d).length===10?d+'T00:00:00+08:00':d)):'No date';
 function art(b){const profile=typeof bveGetLinkedProfile==='function'?bveGetLinkedProfile(b):null,preset=typeof bveResolveAnimation==='function'?bveResolveAnimation(profile,'idle'):null;return typeof bveRenderBossArt==='function'?bveRenderBossArt(b,{stateClass:'state-idle'+(preset?.cssClass?' '+preset.cssClass:'')}):esc(b.image||'');}
 let lastPagePoll=0;
 let search='',filter='all',owner=null,ticker=null,polling=false,claimKeys=new Map(),claimPending=new Set(),selected=null;
 function reset(){if(owner!==currentUser?.id){owner=currentUser?.id;search='';filter='all';selected=null;claimKeys.clear();claimPending.clear();}}
 const status=b=>b.status==='loot'?'Loot open':b.status==='active'?(RaidService.expired(b)?'Expired':'Live now'):b.status==='ended'?(b.defeatedAt?'Completed':'Ended'):'Draft';
 function meter(b){return `<div class="raid-health"><div><span>Shared boss health</span><strong>${num(hp(b))}<small> / ${num(b.maxHp)}</small></strong></div><div class="raid-health-track" role="progressbar" aria-label="Boss health" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct(b))}"><i style="width:${pct(b)}%"></i></div></div>`;}
 function head(eyebrow,title,copy,actions=''){return `<header class="raid-heading"><div><span class="raid-eyebrow">${eyebrow}</span><h1>${title}</h1><p>${copy}</p></div><div class="raid-heading-actions">${actions}</div></header>`;}
 function stat(value,label){return `<div><strong>${value}</strong><span>${label}</span></div>`;}
 function readiness(b){const qs=wbcGetBossQuestions(b);return `<div class="raid-readiness"><span class="${b.image?'is-ready':''}">${icon(b.image?'check_circle':'radio_button_unchecked')}Identity</span><span class="${qs.length?'is-ready':''}">${icon(qs.length?'check_circle':'radio_button_unchecked')}${qs.length} questions</span><span class="${(b.lootRewards||[]).length?'is-ready':''}">${icon((b.lootRewards||[]).length?'check_circle':'radio_button_unchecked')}${(b.lootRewards||[]).length} loot items</span></div>`;}
 function adminCards(){
  const rows=visible().filter(({boss:b})=>(filter==='all'||b.status===filter)&&(b.name+' '+(b.description||'')).toLowerCase().includes(search.toLowerCase()));
  if(!rows.length)return `<div class="raid-empty">${icon('swords')}<h2>${visible().length?'No raids match this view':'Build your first class raid'}</h2><p>Create a boss identity in Studio, add questions, then launch an event for your section.</p><button class="btn btn-primary" onclick="openBossForm(null)">Create event</button></div>`;
  return rows.map(({boss:b,index:i})=>{
   const rewards=payout(b),participants=Object.values(wbcGetParticipants(i)),running=['active','loot'].includes(b.status);
   return `<article class="raid-event-card" data-raid-index="${i}"><div class="raid-event-art">${art(b)}<span class="raid-state is-${esc(b.status)}">${status(b)}</span><span class="raid-difficulty">${esc(b.difficulty||'Normal')}</span></div><div class="raid-event-body"><span class="raid-eyebrow">${esc(typeof getClassLabel==='function'?getClassLabel(b.classId):b.classId||'Class raid')}</span><h2>${esc(b.name||'Untitled boss')}</h2><p>${esc(b.description||'A shared challenge for your class.')}</p><div class="raid-event-dates">${icon('calendar_month')}${date(b.startDate)} — ${date(b.endDate)}</div>${meter(b)}<div class="raid-card-stats">${stat(num(rewards.xp),'Victory XP')}${stat(num(rewards.coins),'Victory coins')}${stat(num(participants.length),'Raiders')}</div>${readiness(b)}
   <div class="raid-card-actions"><button class="btn btn-ghost" onclick="openBossForm(${i})">${icon('edit')}Edit event</button>${b.status==='active'?`<button class="btn btn-ghost" onclick="bossEnd(${i})">End raid</button>`:b.status==='loot'?`<button class="btn btn-primary" onclick="wblrAdminFinalizeLoot(${i})">Finish loot</button>`:`<button class="btn btn-primary" onclick="bossActivate(${i})" ${b._pendingInsert?'disabled':''}>${icon('play_arrow')}${b._pendingInsert?'Saving…':b.status==='ended'?'Run again':'Launch raid'}</button>`}</div>
   <details class="raid-tools"><summary>Questions, loot & battle tools</summary><div><button class="btn btn-ghost" onclick="wbcOpenQuestionEditor(${i})">${icon('quiz')}Questions</button><button class="btn btn-ghost" onclick="wblrOpenLootSettings(${i})">${icon('redeem')}Loot pool</button><button class="btn btn-ghost" onclick="wbcOpenCombatSettings(${i})">Combat</button><button class="btn btn-ghost" onclick="wbmOpenMinionSettings(${i})">Minions</button><button class="btn btn-ghost" onclick="wbsOpenSkillConfig(${i})">Skills</button><button class="btn btn-ghost" onclick="wbpOpenPhaseConfig(${i})">Phases</button><button class="btn btn-ghost" onclick="wbrageOpenConfig(${i})">Rage mode</button>${running?`<button class="btn btn-ghost" onclick="wbmOpenRevivePanel(${i})">Revive raiders</button>${b.minionSettings?.enabled?`<button class="btn btn-ghost" onclick="wbmAdminForceSpawn(${i})">Spawn minion</button>`:''}`:''}<button class="btn btn-ghost" onclick="wblOpenAdminLeaderboard(${i},'event')">Rankings</button>${b.defeatedAt?`<button class="btn btn-ghost" onclick="RaidExperience.openSummary(${i})">Results</button>`:''}<button class="btn btn-danger" onclick="bossDelete(${i})">Delete</button></div></details></div></article>`;
  }).join('');
 }
 function renderAdmin(){
  reset();const page=document.getElementById('a-bossevents');if(!page)return;const list=visible();
  page.innerHTML=`<div class="raid-page">${head('Teacher command','World Boss events','Turn a question set into a shared class challenge.',`<button class="btn btn-ghost" onclick="navTo('a-boss-studio')">${icon('auto_awesome')}Boss Studio</button><button class="btn btn-primary" onclick="openBossForm(null)">${icon('add')}Create event</button>`)}<div class="raid-overview">${stat(list.filter(x=>x.boss.status==='active').length,'Live raids')}${stat(list.filter(x=>x.boss.status==='draft').length,'Drafts')}${stat(list.filter(x=>x.boss.status==='loot').length,'Loot windows')}${stat(list.filter(x=>x.boss.status==='ended').length,'Past raids')}</div><div class="raid-toolbar"><div class="raid-filters" role="group" aria-label="Filter raids">${[['all','All events'],['active','Live'],['draft','Drafts'],['loot','Loot'],['ended','Past raids']].map(([id,label])=>`<button data-raid-filter="${id}" aria-pressed="${filter===id}">${label}</button>`).join('')}</div><label class="raid-search">${icon('search')}<input type="search" id="raid-search" aria-label="Search raid events" placeholder="Find an event" value="${esc(search)}"></label></div><div id="raid-event-list" class="raid-event-grid">${adminCards()}</div></div>`;
 }
 function archive(){const rows=visible().filter(x=>x.boss.status==='ended');return rows.length?`<section class="raid-history"><h2>Past raids</h2>${rows.slice().reverse().slice(0,8).map(({boss:b,index:i})=>`<button class="raid-history-row" onclick="RaidExperience.openSummary(${i})"><span><strong>${esc(b.name)}</strong><small>${b.defeatedAt?'Boss defeated':'Event ended'} · ${date(b.endDate)}</small></span>${icon('arrow_forward')}</button>`).join('')}</section>`:'';}
 function renderStudent(){
  reset();const page=document.getElementById('s-world-boss');if(!page||currentRole!=='student')return;
  const loot=wblrGetCurrentLootBoss();if(loot){renderLoot(loot.idx);return;}
  const found=wbcGetActiveBoss();if(!found){page.innerHTML=`<div class="raid-page">${head('Class challenge','World Boss','One class. One boss. Every answer counts.')}<section class="raid-empty raid-awaiting">${icon('shield')}<span class="raid-eyebrow">The arena is quiet</span><h2>Your next raid is on its way</h2><p>Your teacher will open the next challenge here. Completed raids stay below so you can revisit your contribution and loot.</p></section>${archive()}</div>`;return;}
  const {boss:b,idx:i}=found,rec=wbcMyRecord(i),stats=wbcBattleStats(i),qs=wbcGetBossQuestions(b),rewards=payout(b),done=rec?.lastQIdx||0;
  selected=i;
  page.innerHTML=`<div class="raid-page">${head('Class challenge','World Boss','Knowledge is your weapon. Take this one down together.')}<section class="raid-lobby-hero"><div class="raid-lobby-copy"><span class="raid-state is-active">Live class raid</span><h2>${esc(b.name)}</h2><p>${esc(b.description||'Team up with your classmates. Every correct answer chips away at the same boss health bar.')}</p><div class="raid-hero-meta"><span>${icon('groups')}${stats.participants} raiders</span><span>${icon('quiz')}${qs.length} questions</span><span>${icon('calendar_month')}Until ${date(b.endDate)}</span></div></div><div class="raid-lobby-art">${art(b)}</div><div class="raid-lobby-health">${meter(b)}</div></section><div class="raid-lobby-grid"><section class="raid-panel raid-join"><span class="raid-eyebrow">${rec?'Your raid progress':'Ready when you are'}</span><h2>${rec?(rec.isKO?'Recover and return':done>=qs.length?'Your contribution is saved':'Continue the fight'):'Join your class in the arena'}</h2><p>${rec?`${num(rec.totalDamage)} damage dealt · ${done} / ${qs.length} questions answered`:'Answer questions to deal damage. Take breaks and return with your progress saved.'}</p>${rec?`<div class="raid-progress-track"><i style="width:${qs.length?Math.min(100,done/qs.length*100):0}%"></i></div>`:''}<button class="btn btn-primary raid-enter" ${!qs.length?'disabled':''} onclick="${rec?'wbrOpenBattle':'wbcJoinBoss'}(${i})">${icon('swords')}${!qs.length?'Questions coming soon':rec?'Enter battle':'Join raid'}</button><span class="raid-help">${qs.length?'Victory rewards go to raiders who deal damage. Loot opens after the boss falls.':'Your teacher needs to add questions before the battle can begin.'}</span></section><section class="raid-panel"><span class="raid-eyebrow">On victory</span><h2>Make your effort count</h2><div class="raid-reward-totals">${stat(num(rewards.xp),'XP per contributor')}${stat(num(rewards.coins),'Coins per contributor')}</div><p>Includes the participation XP and victory coin bonuses. Limited loot is claimed separately after victory.</p><div class="raid-loot-preview">${(b.lootRewards||[]).slice(0,3).map(r=>`<span>${icon('redeem')}${esc(r.itemName)}<small>${num(r.quantity)} available</small></span>`).join('')||'<span>No extra loot configured</span>'}</div></section></div><section class="raid-panel"><div class="raid-panel-heading"><h2>Raid activity</h2><button class="btn btn-ghost" onclick="wblOpenAdminLeaderboard(${i},'event')">Rankings</button></div><div class="wbr-feed-list">${wbrFeedHTML(i)}</div></section>${archive()}</div>`;
  wbcUpdateTopbarWidget();AppStore.emit({type:'world-boss:student-view-rendered',payload:{bossIdx:i}});
 }
 function seconds(b){return Math.max(0,Math.ceil(((b.lootStartedAt||Date.now())+(b.lootDuration??120)*1000-Date.now()-(b._raidClockOffset||0))/1000));}
 function renderLoot(i){
  const b=AppStore.getBossEvent(i),page=document.getElementById('s-world-boss');if(!b||!page||!RaidService.visible(b))return;
  wblrStopLootTimers();selected=i;const reward=b._raidReward;window.scrollTo(0,0);page.scrollTop=0;
  page.innerHTML=`<div class="raid-page" data-raid-loot="${i}">${head('Boss defeated','Treasure on the battlefield','Return to the arena to pick up scattered treasure.',`<div class="raid-loot-timer">${icon('timer')}<strong id="raid-loot-clock"></strong><span>left to claim</span></div>`)}<section class="raid-victory-strip"><div class="raid-victory-art">${art(b)}</div><div><span class="raid-eyebrow">Victory belongs to your class</span><h2>${esc(b.name)}</h2><button class="btn btn-primary" onclick="RaidLootArena.open(${i},{resume:true})">Enter loot battlefield</button><p>${reward?`Victory rewards confirmed: ${num(reward.xp)} XP · ${num(reward.coins)} coins.`:'Your contribution and confirmed rewards are saved.'}</p></div><button class="btn btn-ghost" onclick="RaidExperience.openSummary(${i})">Raid results</button></section><section class="raid-panel"><div class="raid-panel-heading"><h2>Claim activity</h2><button class="btn btn-ghost" onclick="navTo('s-inventory')">My Inventory</button></div><div id="raid-claim-feed">${wblrClaimFeedHTML(i,12)}</div></section></div>`;updateLootClock();
 }
 function summary(i){const b=AppStore.getBossEvent(i);if(!b||!RaidService.visible(b))return '';const rec=wbcMyRecord(i),parts=Object.values(wbcGetParticipants(i)),mine=(b.lootClaims||[]).filter(c=>c.studentId===currentUser?.id),reward=b._raidReward;
  return `<div class="raid-summary"><span class="raid-eyebrow">${b.defeatedAt?'Class victory':'Raid record'}</span><h2>${esc(b.victoryTitle||(b.defeatedAt?'A challenge conquered.':'The raid has ended.'))}</h2><p>${esc(b.victoryMessage||b.name)}</p><div class="raid-overview">${stat(num(parts.reduce((n,r)=>n+(r.totalDamage||0),0)),'Class damage')}${stat(num(parts.length),'Raiders')}${stat(num(rec?.totalDamage),'Your damage')}${stat(num(mine.length),'Your loot')}</div>${reward?`<div class="raid-notice">${icon('check_circle')}${num(reward.xp)} XP and ${num(reward.coins)} coins awarded to your account.</div>`:''}${b.defeatNarrText?`<p class="raid-victory-story">${esc(b.defeatNarrText).replaceAll('\\n','<br>')}</p>`:''}${mine.length?`<h3>Your claimed loot</h3><div class="raid-summary-loot">${mine.map(c=>`<span>${icon('redeem')}${esc(c.itemName)}</span>`).join('')}</div>`:''}<h3>Raid standings</h3>${typeof wblRenderPanel==='function'?wblRenderPanel(i,'event'):''}</div>`;
 }
 function openSummary(i){showModal(summary(i),'lg');}
 function showVictory(i){if(window.RaidLootArena?.open(i))return;const b=AppStore.getBossEvent(i);if(!b||!RaidService.visible(b))return;showModal(`<div class="raid-victory-dialog"><div class="raid-victory-emblem">${icon('workspace_premium')}</div><span class="raid-eyebrow">A class effort. A shared victory.</span><h2>${esc(b.victoryTitle||'Boss defeated.')}</h2><p>${esc(b.victoryMessage||'Every answer brought your class closer. Your contribution is saved.')}</p><div class="raid-overview">${stat(num(wbcMyRecord(i)?.totalDamage),'Your damage')}${stat(num(Object.keys(wbcGetParticipants(i)).length),'Raiders')}</div><button class="btn btn-primary" onclick="closeModalForce();${b.status==='loot'?'renderStudentWorldBoss()':'RaidExperience.openSummary('+i+')'}">${b.status==='loot'?'Explore the loot pool':'View raid results'}</button><button class="btn btn-ghost" onclick="RaidExperience.openSummary(${i})">View your contribution</button></div>`,'md');}
 async function lifecycle(i,kind){
  const b=AppStore.getBossEvent(i);if(!b||!RaidService.visible(b)||!['admin','teacher'].includes(currentRole))return;
  if(kind==='activate'&&!wbcGetBossQuestions(b).length){toast('Add questions before launching this raid.');wbcOpenQuestionEditor(i);return;}
  if(kind==='activate'&&RaidService.expired(b)){toast('Update the event end date before launching.');openBossForm(i);return;}
  const message=kind==='activate'?`Launch "${b.name}" for its section? A new run resets raid and loot progress. Already claimed inventory is kept.`:kind==='delete'?`Delete "${b.name}"? This cannot be undone.`:kind==='finalize'?`Close the remaining loot window for "${b.name}"?`:`End "${b.name}" without a victory payout?`;
  if(!confirm(message))return;
  const identity=currentUser.id,operation='lifecycle:'+b._id;if(claimPending.has(operation))return;claimPending.add(operation);
  try{
   if(RaidService.managed(b)){const response=await RaidService.action(i,kind);if(!response.ok)throw new Error(response.reason);}
   else{
    if(b._pendingInsert||!b._id)throw new Error('Wait for the event to finish saving before launching it.');
    const rpc={activate:'start_boss_event',end:'end_boss_event',delete:'delete_boss_event',finalize:'finalize_loot_rush'}[kind];
    const {error}=await DBService.rpc(rpc,{p_boss_id:b._id,...(kind==='delete'?{}:{p_class_id:b.classId||'default-class'})});if(error)throw new Error(error.message);
    if(currentUser?.id!==identity)return;
    AppStore.updateState(d=>{const x=d.bossEvents.find(x=>x._id===b._id);if(!x)return;
      if(kind==='activate'){
       d.bossEvents.forEach(y=>{if(y!==x&&y.classId===x.classId&&['active','loot'].includes(y.status)){y.status='ended';y.endedAt=Date.now();}});
       Object.assign(x,{status:'active',currentHp:x.maxHp,lootClaims:[],activeMinions:[],activatedAt:Date.now()});
       ['defeatedAt','endedAt','lootStartedAt','lootFinalizedAt','_lootRainShown','_victoryRewardedAt'].forEach(k=>delete x[k]);d.bossParticipants[i]={};
      }else{x.status=kind==='delete'?'deleted':'ended';x.endedAt=Date.now();if(kind==='finalize')x.lootFinalizedAt=Date.now();}
    },{type:'world-boss:'+kind,payload:{bossIdx:i}});
   }
   if(currentUser?.id!==identity)return;
   if(kind==='activate'&&typeof wbsnWriteSignal==='function')wbsnWriteSignal(i);
   closeModalForce();renderAdmin();toast(kind==='activate'?'Raid launched.':kind==='delete'?'Event deleted.':'Event updated.');
  }catch(error){toast(error.message||'Could not update the raid. Reconnect and retry.');}finally{claimPending.delete(operation);}
 }
 async function claim(i,rewardId,button,dropIndex){
  reset();if(currentRole!=='student'||!currentUser)return;const b=AppStore.getBossEvent(i);if(!b||!RaidService.visible(b))return;
  if(window.RaidLootArena&&Date.now()<RaidLootArena.opensAt(b)){const reason='Loot is scattering. Wait for the shared countdown.';toast(reason);return {ok:false,reason};}
  const identity=currentUser.id,key=[b._id||i,b.raidRunId||'',rewardId,identity,dropIndex??'any'].join(':');if(claimPending.has(key))return;
  const reward=(b.lootRewards||[]).find(r=>r.id===rewardId);if(!reward)return;
  if(!claimKeys.has(key))claimKeys.set(key,uid());const claimId=claimKeys.get(key);claimPending.add(key);
  if(button){button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='Confirming…';}
  const notice=document.getElementById('raid-claim-status');if(notice)notice.textContent='Confirming your reward…';
  try{
   if(RaidService.managed(b)){const response=await RaidService.action(i,'claim',{rewardId,claimId,...(Number.isInteger(dropIndex)?{dropIndex}:{})});if(!response.ok)throw new Error(response.reason);}
   else{
    const rec=wbcMyRecord(i);if(!rec||rec.totalDamage<=0)throw new Error('Contribute damage in this raid to claim loot.');
    const valid=LootService.validateClaim(b,rewardId,identity);if(!valid.ok)throw new Error(valid.reason);
    if(!b._id)throw new Error('Reconnect to claim this reward.');
    const {data,error}=await DBService.rpc('claim_loot_reward',{p_boss_id:b._id,p_class_id:b.classId||'default-class',p_reward_id:rewardId,p_student_id:identity,p_student_name:currentUser.name,p_student_init:currentUser.init,p_student_color:currentUser.color,p_claim_id:claimId});
    if(error)throw new Error(error.message);const receipt=Array.isArray(data)?data[0]:data;if(!receipt?.ok)throw new Error(receipt?.reason||'Claim not confirmed. Please retry.');
    if(currentUser?.id!==identity)return;
    if(!(AppStore.getBossEvent(i).lootClaims||[]).some(c=>c.id===claimId)){
      const result=LootService.claimReward(i,rewardId,currentUser,{id:claimId});if(!result.ok)throw new Error('Reward confirmed. Refresh to load your inventory.');
    }
   }
   if(currentUser?.id!==identity)return;claimKeys.delete(key);toast('Added '+esc(reward.itemName)+' to My Inventory.');if(notice)notice.textContent=reward.itemName+' added to My Inventory.';return {ok:true,itemName:reward.itemName,claimId};
  }catch(error){if(currentUser?.id===identity){if(notice)notice.textContent=error.message;else toast(error.message);}return {ok:false,reason:error.message};}
  finally{
   claimPending.delete(key);if(currentUser?.id===identity){const fresh=AppStore.getBossEvent(i);if(!window.RaidLootArena?.owns(i)&&document.querySelector('[data-raid-loot]')){renderStudent();}updateTopbar();}
   if(button?.isConnected){button.removeAttribute('aria-busy');button.disabled=false;}window.RaidLootArena?.update();
  }
 }
 function updateLootClock(){const root=document.querySelector('[data-raid-loot]');if(!root)return;const b=AppStore.getBossEvent(Number(root.dataset.raidLoot));if(!b)return;const left=seconds(b),clock=document.getElementById('raid-loot-clock');if(clock)clock.textContent=Math.floor(left/60)+':'+String(left%60).padStart(2,'0');if(!left)document.querySelectorAll('.raid-loot-card button').forEach(el=>{el.disabled=true;el.textContent='Loot closed';});}
 function connection(ok){
  const status=document.getElementById('raid-sync-state');if(!status)return;
  status.classList.toggle('is-offline',!ok);status.textContent=ok?'Raid synced':'Reconnecting · progress is saved';
  status.title=ok?'Last confirmed server update: '+new Date().toLocaleTimeString():'Waiting for the server. Attacks and rewards require confirmation.';
 }
 async function refresh(){
  if(polling||document.hidden||!currentUser)return;const studentPage=document.getElementById('s-world-boss')?.classList.contains('active'),battle=WBR.bossIdx!=null,adminPage=document.getElementById('a-bossevents')?.classList.contains('active');if(!studentPage&&!battle&&!adminPage)return;
  polling=true;try{const indices=battle?[WBR.bossIdx]:visible().filter(x=>['active','loot','defeated'].includes(x.boss.status)).map(x=>x.index);
   for(const i of indices){const b=AppStore.getBossEvent(i);if(!RaidService.managed(b)||WBR.answerPending||claimPending.size)continue;const before=b.status;const result=await RaidService.action(i,'snapshot');if(WBR.bossIdx===i)connection(result.ok);if(!result.ok)continue;
    const fresh=AppStore.getBossEvent(i);if(battle){if(WBR.phase==='loot')window.RaidLootArena?.update();continue;}
    if(studentPage){if(before!==fresh.status||!document.querySelector('[data-raid-loot]'))renderStudent();else renderLoot(i);}
    else if(adminPage&&document.getElementById('modal-overlay')?.style.display==='none'){const list=document.getElementById('raid-event-list');if(list)list.innerHTML=adminCards();}
   }
  }finally{polling=false;}
 }
 const studio=window.renderBossStudio;
 window.renderBossStudio=function(){studio();const root=document.getElementById('bs-tab-root');if(!root||root.querySelector('.raid-starters'))return;root.insertAdjacentHTML('afterbegin',`<section class="raid-starters"><div><span class="raid-eyebrow">Start with a character</span><h2>Give your next raid an identity.</h2><p>Choose a starter, then make its artwork, colors and animations your own.</p></div><div class="raid-starter-grid">${[['wyrm','Obsidian Wyrm'],['sentinel','Clockwork Sentinel'],['phantom','Veil Phantom']].map(([id,label])=>`<button onclick="RaidExperience.createStarter('${id}')"><img src="./assets/bosses/${id}.svg" alt=""><span>${label}</span>${icon('add')}</button>`).join('')}</div></section>`);};
 function createStarter(id){const presets={wyrm:{name:'Obsidian Wyrm',description:'An ancient guardian forged in stone and fire.',visual:{themeColor:'#a35442',auraColor:'#df9c64',cardAccent:'#efd1a4'}},sentinel:{name:'Clockwork Sentinel',description:'Precision armor. A relentless mechanical mind.',visual:{themeColor:'#4d7884',auraColor:'#82b9c5',cardAccent:'#c6e6ed'}},phantom:{name:'Veil Phantom',description:'A whisper in the dark, waiting for a worthy class.',visual:{themeColor:'#78668f',auraColor:'#bda2cd',cardAccent:'#e7d7ef'}}};if(!presets[id])return;bsOpenCreate();Object.assign(window._bsDraft,presets[id],{artwork:{type:'url',value:'./assets/bosses/'+id+'.svg'}});window._bsRenderFormModal(false);window._bsSyncEditorPreview();}
 const previousPicker=window.bfOpenLibraryPicker;
 window.bfOpenLibraryPicker=function(){previousPicker();const identity=currentUser?.id,draft=window._bossDraft;if(typeof _bsInitRemoteLibrary==='function')_bsInitRemoteLibrary().then(()=>{if(currentUser?.id===identity&&window._bossDraft===draft&&document.getElementById('bflp-overlay'))_bflpRefreshGrid(document.getElementById('bflp-search-inp')?.value||'');});};
 const previousSkill=window.wbsAdminFireSkill,previousSpawn=window.wbmAdminForceSpawn,previousRevive=window.wbmAdminReviveStudent,previousSelfRevive=window.wbmSelfRevive;
 async function command(i,kind,payload,after){const result=await RaidService.action(i,kind,payload);if(!result.ok){toast(result.reason);return;}toast(kind==='revive'?'Raider revived.':'Battle command sent to raiders.');after?.();}
 window.wbsAdminFireSkill=(i,skillId)=>RaidService.managed(AppStore.getBossEvent(i))?command(i,'signal',{kind:'skill',skillId}):previousSkill(i,skillId);
 window.wbmAdminForceSpawn=i=>RaidService.managed(AppStore.getBossEvent(i))?command(i,'signal',{kind:'minion'}):previousSpawn(i);
 window.wbmAdminReviveStudent=(i,studentId)=>RaidService.managed(AppStore.getBossEvent(i))?command(i,'revive',{studentId},()=>wbmOpenRevivePanel(i)):previousRevive(i,studentId);
 window.wbmSelfRevive=async i=>{if(!RaidService.managed(AppStore.getBossEvent(i)))return previousSelfRevive(i);AppStore.flushNow?.();await DBService.flushPendingUpload?.();return command(i,'revive',{studentId:currentUser.id},()=>{wbmStopKoTimer();_wbmRefreshBattleArea(i);if(WBR.bossIdx===i)wbrShowEncounter();});};
 document.addEventListener('keydown',e=>{const picker=document.getElementById('bflp-overlay');if(!picker)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();picker.remove();document.querySelector('[onclick="bfOpenLibraryPicker()"]')?.focus();}else if(['Enter',' '].includes(e.key)&&e.target.matches('.bflp-card')){e.preventDefault();e.target.click();}},true);
 window.RaidExperience=Object.freeze({renderAdmin,renderStudent,renderLoot,openSummary,showVictory,createStarter,refresh});
 window.renderAdminBossEvents=renderAdmin;window.renderStudentWorldBoss=renderStudent;
 window.bossActivate=i=>lifecycle(i,'activate');window.bossEnd=i=>lifecycle(i,'end');window.bossDelete=i=>lifecycle(i,'delete');window.wblrAdminFinalizeLoot=i=>lifecycle(i,'finalize');
 window.wblrClaimReward=claim;window.wblrRenderStudentLootPage=renderLoot;window.wblrShowLootRain=renderLoot;
 window.wblrRenderFinalSummaryPage=()=>renderStudent();window.wblrOpenFinalSummary=openSummary;
 // Keep the battle overlay mounted for the shared-stock loot race.
 window.wblrShowInOverlayLoot=i=>RaidLootArena.open(i);
 const oldMaybe=window.wblrMaybeAutoFinalize;
 window.wblrMaybeAutoFinalize=i=>RaidService.managed(AppStore.getBossEvent(i))?RaidService.action(i,'snapshot'):oldMaybe(i);
 document.addEventListener('input',e=>{if(e.target.id==='raid-search'){search=e.target.value;document.getElementById('raid-event-list').innerHTML=adminCards();}});
 document.addEventListener('click',e=>{const button=e.target.closest('[data-raid-filter]');if(!button)return;filter=button.dataset.raidFilter;document.querySelectorAll('[data-raid-filter]').forEach(el=>el.setAttribute('aria-pressed',el===button));document.getElementById('raid-event-list').innerHTML=adminCards();});
 document.addEventListener('keydown',e=>{if(WBR.bossIdx==null)return;if(e.key==='Tab'){if(document.querySelector('#modal-overlay[style*="flex"]'))return;const nodes=[...document.querySelectorAll('.raid-battle button:not(:disabled),.raid-battle input,.raid-battle select,.raid-battle [tabindex="0"]')].filter(el=>el.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(nodes.length&&e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(nodes.length&&!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}return;}if(e.target.closest('input,textarea,select,button'))return;if(['1','2','3','4'].includes(e.key)&&WBR.phase==='battle'){const button=document.getElementById('wbr-opt-'+(Number(e.key)-1));if(button&&!button.disabled){e.preventDefault();button.click();}}});
 AppStore.subscribe('raid-experience',(state,event)=>{
  if(event?.type==='session:booted')reset();
  if(['world-boss:server-synced','world-boss:defeated'].includes(event?.type)&&WBR.bossIdx===event.payload?.bossIdx){connection(true);if(WBR.phase==='battle')wbrUpdateHUD();else window.RaidUltimate?.sync(WBR.bossIdx);}
  if(event?.type==='world-boss:player-hit'&&WBR.bossIdx===event.payload?.bossIdx&&WBR.phase==='battle')window.RaidUltimate?.playerHit(event.payload);
  if(event?.type==='world-boss:raid-hits'&&WBR.bossIdx===event.payload?.bossIdx&&WBR.phase==='battle'){
   const hits=event.payload.hits;
   window.RaidFX?.raidHits(hits);
   const feed=document.querySelector('#wbr-live-feed .wbr-feed-list');if(feed)feed.innerHTML=wbrFeedHTML(WBR.bossIdx);
  }
  if(event?.type==='nav:navigated'){if(WBR.bossIdx!=null&&event.payload?.id!=='s-world-boss')wbrCloseBattle();setTimeout(refresh,50);}
 });
 ticker=setInterval(()=>{updateLootClock();},1000);setInterval(()=>{if(WBR.bossIdx!=null)refresh();else if(Date.now()-lastPagePoll>=5000){lastPagePoll=Date.now();refresh();}},1000);
})();
