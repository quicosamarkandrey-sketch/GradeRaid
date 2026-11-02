/* Shared-stock loot race inside the existing battle overlay. Claims use RaidService. */
;(function(){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const motion=matchMedia('(prefers-reduced-motion: reduce)');
 const glyph=kind=>`<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${kind==='Legendary'?'<path d="m7 13 7 6 6-11 6 11 7-6-4 19H11Z"/><path d="M13 27h14"/>':kind==='Epic'?'<path d="m20 4 13 16-13 16L7 20Z"/><path d="m20 4-5 16 5 16 5-16Zm-13 16h26"/>':kind==='Rare'?'<path d="m20 5 12 7v16l-12 7-12-7V12Z"/><path d="m20 11 6 9-6 9-6-9Z"/>':'<path d="m6 14 14-7 14 7v17l-14 7-14-7Zm0 0 14 8 14-8M20 22v16"/>'}</svg>`;
 let session=null;
 const boss=()=>session&&AppStore.getBossEvent(session.index);
 const same=c=>session===c&&currentUser?.id===c.owner&&boss()?._id===c.bossId&&(boss()?.raidRunId||'legacy')===c.run;
 function startTime(b){return Number(b.lootStartedAt)||Number(b.defeatedAt)||Date.now();}
 function opensAt(b){return startTime(b)+Math.min(4000,Math.max(0,(b.lootDuration??120)*250))-(b._raidClockOffset||0);}
 function remaining(b){return Math.max(0,Math.ceil((startTime(b)+(b.lootDuration??120)*1000-Date.now()-(b._raidClockOffset||0))/1000));}
 function schedule(c,fn,ms){const timer=setTimeout(()=>{c.timers.delete(timer);if(same(c))fn();},ms);c.timers.add(timer);return timer;}
 function stop(){
  const c=session;if(!c)return;session=null;for(const timer of c.timers)clearTimeout(timer);clearInterval(c.clock);c.resize?.disconnect();document.removeEventListener('keydown',c.keys);c.root.remove();
  document.getElementById('campaign-overlay')?.classList.remove('raid-loot-active');
 }
 function mountOverlay(index,b){
  if(WBR.bossIdx!=null)return;
  WBR.previousOverflow=document.body.style.overflow;WBR.previousSceneClick=document.getElementById('camp-scene').onclick;
  WBR.previousExitMarkup=document.querySelector('#campaign-overlay .camp-hud-left>button')?.innerHTML;
  WBR.bossIdx=index;WBR.bossUuid=b._id;WBR.bossRunId=b.raidRunId;
  document.body.style.overflow='hidden';
  const overlay=document.getElementById('campaign-overlay');overlay.classList.add('open','raid-battle');overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');
 }
 function random(seed){let value=2166136261;for(const ch of seed)value=Math.imul(value^ch.charCodeAt(0),16777619);return ()=>{value+=0x6D2B79F5;let n=Math.imul(value^(value>>>15),1|value);n^=n+Math.imul(n^(n>>>7),61|n);return ((n^(n>>>14))>>>0)/4294967296;};}
 function scatter(c){
  if(!same(c))return;const width=c.field.clientWidth,cols=Math.max(2,Math.floor((width-16)/64));
  let height=Math.max(420,Math.min(650,innerHeight-210)),cells=[];
  // Jittered packing keeps the complete pile around the boss with usable targets.
  do{const rand=random(c.run+':floor'),rows=Math.max(3,Math.floor((height-16)/70)),cw=(width-16)/cols,ch=(height-16)/rows;cells=[];
   for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const x=8+(col+.5)*cw+(rand()-.5)*Math.min(16,Math.max(0,cw-62)),y=8+(row+.5)*ch+(rand()-.5)*Math.min(14,Math.max(0,ch-66));
    if(Math.pow((x-width/2)/(width<600?102:142),2)+Math.pow((y-height/2)/102,2)<1)continue;
    cells.push({x,y,tilt:(rand()-.5)*12,apex:85+rand()*110,spin:(rand()>.5?1:-1)*(360+rand()*540)});
   }
   for(let i=cells.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[cells[i],cells[j]]=[cells[j],cells[i]];}
   if(cells.length<c.drops.size)height+=70;
  }while(cells.length<c.drops.size);
  const bossY=height/2;c.field.style.minHeight=height+'px';c.field.style.setProperty('--boss-y',bossY+'px');
  let i=0;for(const node of c.drops.values()){
   const desired=i++%4,index=cells.findIndex(p=>(p.x>=width/2?0:1)+(p.y>=bossY?0:2)===desired),point=cells.splice(Math.max(0,index),1)[0],half=node.offsetHeight/2||28,y=point.y-half;
   node.style.left=point.x+'px';node.style.top=y+'px';node.style.setProperty('--drop-tilt',point.tilt+'deg');node.style.setProperty('--drop-from-x',(width/2-point.x)+'px');node.style.setProperty('--drop-from-y',(bossY-y-half)+'px');node.style.setProperty('--drop-apex',point.apex+'px');node.style.setProperty('--drop-spin',point.spin+'deg');
  }
 }
 function claimedSlots(b){
  const used=new Map();for(const reward of b.lootRewards||[]){const slots=new Map(),legacy=[];for(const receipt of b.lootClaims||[]){if(receipt.rewardId!==reward.id)continue;if(Number.isInteger(receipt.dropIndex))slots.set(receipt.dropIndex,receipt);else legacy.push(receipt);}
   legacy.sort((a,b)=>(a.claimedAt||0)-(b.claimedAt||0)||String(a.id).localeCompare(String(b.id)));for(const receipt of legacy){let slot=0;while(slots.has(slot))slot++;slots.set(slot,receipt);}used.set(reward.id,slots);
  }return used;
 }
 function pickupBurst(c,node,receipt){
  if(motion.matches)return;const pop=document.createElement('div');pop.className='rla-pickup-pop';pop.setAttribute('aria-hidden','true');
  pop.style.left=node.style.left;pop.style.top=(parseFloat(node.style.top)+node.offsetHeight/2)+'px';pop.style.setProperty('--drop-accent',node.style.getPropertyValue('--drop-accent'));
  pop.innerHTML='<i></i>'+Array.from({length:8},(_,i)=>`<b style="--angle:${i*45}deg"></b>`).join('')+`<strong>${esc(receipt.itemName)}</strong>`;c.field.appendChild(pop);
  const effects=c.field.querySelectorAll('.rla-pickup-pop');if(effects.length>8)effects[0].remove();schedule(c,()=>pop.remove(),900);
 }
 function endEmission(c){
  for(const timer of c.emissionTimers){clearTimeout(timer);c.timers.delete(timer);}c.emissionTimers=[];c.emitting=false;c.root.classList.remove('rla-emitting');
  for(const node of c.drops.values()){node._landed=true;node.classList.remove('rla-awaiting');node.classList.add('rla-landed');}
 }
 function directEmission(c){
  const nodes=[...c.drops.values()],rand=random(c.run+':emission');for(let i=nodes.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[nodes[i],nodes[j]]=[nodes[j],nodes[i]];}
  if(!c.cinematic){nodes.forEach(n=>{n._landed=true;n.classList.add('rla-landed');});return;}
  c.root.classList.add('rla-cinematic','rla-emitting');c.emitting=true;
  // A local presentation clock prevents network/poll latency from skipping the rupture.
  // The server release/expiry clocks remain authoritative for every pickup.
  const span=Math.max(1,nodes.length-1),gap=Math.min(180,Math.max(100,2800/span),8000/span);
  nodes.forEach((node,i)=>{
   const delay=550+i*gap;node._landed=false;node.dataset.emissionOrder=i;node.classList.add('rla-awaiting');node.style.setProperty('--drop-delay',delay+'ms');
   c.emissionTimers.push(schedule(c,()=>{
    if(!node.isConnected||c.taken.has(node.dataset.tokenKey))return;node.classList.remove('rla-awaiting');node.dataset.emitted='true';
    const pulse=document.createElement('i');pulse.className='rla-ejection';pulse.setAttribute('aria-hidden','true');pulse.style.color=node.style.getPropertyValue('--drop-accent');c.field.appendChild(pulse);schedule(c,()=>pulse.remove(),320);
   },delay));
   c.emissionTimers.push(schedule(c,()=>{node._landed=true;node.classList.add('rla-landed');if(i===nodes.length-1){c.emitting=false;c.root.classList.remove('rla-emitting');if(boss()?.status==='loot'&&Date.now()>=opensAt(boss())&&wbcMyRecord(c.index)?.totalDamage>0&&boss()._raidLootVersion===2)message('Pick up each treasure. Your confirmed pieces are saved.');}update();},delay+1000));
  });
 }
 function collect(c,node,receipt){
  if(c.taken.has(node.dataset.tokenKey))return;c.taken.add(node.dataset.tokenKey);node.disabled=true;
  if(c.initial||motion.matches){node.remove();return;}
  // Confirmation precedes removal. Other clients remove this exact same piece.
  if(receipt.studentId===c.owner)pickupBurst(c,node,receipt);node.classList.add(receipt.studentId===c.owner?'is-collected':'is-claimed-away');schedule(c,()=>node.remove(),receipt.studentId===c.owner?520:300);
  if(node===document.activeElement){const next=[...c.drops.values()].find(n=>n!==node&&n.isConnected&&!n.disabled);(next||c.root.querySelector('.rla-exit')).focus({preventScroll:true});}
 }
 function message(text){const el=session?.root.querySelector('#raid-loot-notice');if(el)el.textContent=text;}
 function open(index,{resume=false}={}){
  const b=AppStore.getBossEvent(index);if(!b||currentRole!=='student'||!RaidService.visible(b)||b.currentHp!==0||!b.defeatedAt||!['loot','ended'].includes(b.status))return false;
  if(session&&same(session)&&session.index===index){update();return true;}
  if(WBR.bossIdx!=null&&WBR.bossIdx!==index)return false;
  stop();mountOverlay(index,b);wbrStop(true);WBR.phase='loot';WBR.bossIdx=index;
  const overlay=document.getElementById('campaign-overlay'),scene=document.getElementById('camp-scene');overlay.classList.add('raid-loot-active');overlay.setAttribute('aria-label','Boss treasure battlefield');overlay.scrollTop=0;scene.onclick=null;
  const root=document.createElement('section');root.id='raid-loot-arena';root.className=motion.matches?'is-reduced':'';
  const cinematic=!resume&&!motion.matches&&b.status==='loot'&&(b.lootRewards||[]).some(r=>r.quantity>0);
  if(!cinematic)root.classList.add('is-resumed');
  const art=typeof bveRenderBossArt==='function'?bveRenderBossArt(b,{id:'raid-loot-boss-art',stateClass:'state-defeated'}):esc(b.image||b.name);
  root.innerHTML=`<header class="rla-header"><div><span>WORLD BOSS · TREASURE</span><strong>${esc(b.name)}</strong></div><button type="button" class="rla-exit">Leave arena</button></header><div class="rla-victory"><span>RAID COMPLETE</span><h1>${esc(b.victoryTitle||'VICTORY')}</h1><p>${esc(b.victoryMessage||'The boss has fallen. Your claimed treasure is yours to keep.')}</p></div><div class="rla-field" aria-label="Scattered boss loot"><div class="rla-detonation" aria-hidden="true"><i></i><b></b><em></em></div><div class="rla-shockwave" aria-hidden="true"></div><div class="rla-boss">${art}<svg class="rla-body-rift" viewBox="0 0 180 160" aria-hidden="true"><path d="m90 25-9 30 14 13-16 20 12 20-10 27m1-80-26-4-14-15m51 31 26-11 18 5m-57 27-26 9-17-7m54 17 26 1 16 17"/></svg><div class="rla-boss-seal" aria-hidden="true"></div></div><div class="rla-fragments" aria-hidden="true">${Array.from({length:motion.matches?0:28},(_,i)=>`<i style="--i:${i};--angle:${i*137.5}deg;--reach:${110+(i%7)*25}px"></i>`).join('')}</div></div><footer class="rla-footer"><p id="raid-loot-notice" role="status" aria-live="polite"></p><div id="raid-loot-secured"></div><div id="raid-loot-latest"></div><button type="button" class="rla-results">View raid results</button><p class="rla-inventory-note">Confirmed drops are saved in My Inventory.</p></footer>`;
  scene.appendChild(root);
  const c={index,owner:currentUser.id,bossId:b._id,run:b.raidRunId||'legacy',root,field:root.querySelector('.rla-field'),drops:new Map(),busy:new Set(),timers:new Set(),taken:new Set(),initial:true,ready:false,cinematic,emitting:false,emissionTimers:[]};session=c;
  root.querySelector('.rla-exit').onclick=()=>wbrCloseBattle();root.querySelector('.rla-results').onclick=()=>RaidExperience.openSummary(index);
  c.keys=event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!document.querySelector('#modal-overlay[style*="flex"]')){event.preventDefault();wbrCloseBattle();}};document.addEventListener('keydown',c.keys);
  for(const reward of b.lootRewards||[])for(let slot=0;slot<Math.max(0,Math.floor(Number(reward.quantity)||0));slot++){
   const node=document.createElement('button'),key=JSON.stringify([reward.id,slot]);node.type='button';node.className='rla-drop';node.dataset.rewardId=reward.id;node.dataset.dropIndex=slot;node.dataset.tokenKey=key;
   node.dataset.rarity=reward.rarity||'Common';node.style.setProperty('--drop-delay','0ms');
   const tones={Common:'#c5d5df',Rare:'#8ecbef',Epic:'#c7a4ef',Legendary:'#ead18b'};node.style.setProperty('--drop-accent',tones[reward.rarity]||tones.Common);
   node.onclick=()=>claim(c,reward.id,slot,node);c.drops.set(key,node);c.field.appendChild(node);
  }
  if(!c.drops.size)c.field.insertAdjacentHTML('beforeend','<p class="rla-empty">Your class conquered the boss. No extra loot was configured.</p>');
  c.resize=new ResizeObserver(()=>scatter(c));c.resize.observe(c.field);scatter(c);directEmission(c);update();c.clock=setInterval(update,200);
  if(cinematic)message('Treasure is breaking free from the boss.');root.querySelector('.rla-exit').focus({preventScroll:true});return true;
 }
 async function claim(c,id,slot,node){
  const key=node.dataset.tokenKey;
  if(!node._landed||!same(c)||c.busy.has(key)||c.taken.has(key)||Date.now()<opensAt(boss())||boss().status!=='loot'||!remaining(boss())||boss()._raidLootVersion!==2)return;
  c.busy.add(key);update();const result=await wblrClaimReward(c.index,id,null,slot);c.busy.delete(key);if(!same(c))return;
  update();if(result?.ok)message(result.itemName+' picked up. Saved to My Inventory.');
  else{message(result?.reason||'Pickup not confirmed. Try again.');RaidService.action(c.index,'snapshot').then(()=>{if(same(c))update();});}
 }
 function update(){
  const c=session;if(!c)return;if(!same(c)||!RaidService.visible(boss())){wbrCloseBattle();return;}
  const b=boss(),left=remaining(b),wait=Math.max(0,Math.ceil((opensAt(b)-Date.now())/1000)),live=b.status==='loot'&&left>0,ready=live&&!wait,rec=wbcMyRecord(c.index),eligible=!!rec&&rec.totalDamage>0;
  c.root.dataset.stage=!live?'closed':ready?'race':'burst';
  if(ready&&!c.ready){c.ready=true;message(b._raidLootVersion!==2?'Treasure pickup needs a teacher update before the race can begin.':eligible?'Treasure is on the floor. Pick up each piece.':'Victory! Only raiders who dealt damage can pick up treasure.');}
  if(!live&&!c.finished){c.finished=true;endEmission(c);c.root.classList.add('is-settled');message('Your confirmed treasure is saved below.');}
  const slots=claimedSlots(b);
  for(const node of c.drops.values()){
   const id=node.dataset.rewardId,slot=Number(node.dataset.dropIndex),reward=(b.lootRewards||[]).find(r=>String(r.id)===id);if(!reward)continue;
   const receipt=slots.get(reward.id)?.get(slot);if(receipt){collect(c,node,receipt);continue;}if(!node.isConnected)continue;
   const mine=wblrClaimedByStudent(b,reward.id,c.owner),busy=c.busy.has(node.dataset.tokenKey),limit=reward.claimLimit||1;
   node.disabled=!node._landed||!ready||!eligible||mine>=limit||busy||b._raidLootVersion!==2;node.setAttribute('aria-busy',String(busy));
   const state=busy?'Picking up…':mine>=limit?'Personal limit reached':!live?'Looting finished':!node._landed?'Landing…':wait?'Get ready':!eligible?'Contribution required':'Pick up';
   const markup=`<span class="rla-drop-visual" aria-hidden="true"><span class="rla-drop-dust"></span><span class="rla-drop-icon">${glyph(reward.rarity)}</span></span><strong>${esc(reward.itemName)}</strong><span class="rla-drop-hint"></span>`;
   if(node._lootMarkup!==markup){node.innerHTML=markup;node._lootMarkup=markup;}
   const hint=node.querySelector('.rla-drop-hint');if(hint.textContent!==state)hint.textContent=state;
   node.setAttribute('aria-label',`${reward.itemName}, ${reward.rarity||'Common'}. ${state}`);node.title=reward.itemName+' · '+(reward.rarity||'Common');
  }
  c.initial=false;
  const mine=(b.lootClaims||[]).filter(x=>x.studentId===c.owner),secured=c.root.querySelector('#raid-loot-secured');
  const securedMarkup=mine.length?'<span>YOUR SECURED LOOT</span>'+mine.map(x=>`<strong>${esc(x.itemName)}</strong>`).join(''):'';if(c.securedMarkup!==securedMarkup){secured.innerHTML=securedMarkup;c.securedMarkup=securedMarkup;}
  const latest=(b.lootClaims||[]).slice().sort((a,b)=>(b.claimedAt||0)-(a.claimedAt||0))[0];c.root.querySelector('#raid-loot-latest').textContent=latest?(latest.studentId===c.owner?'You':latest.studentName||'A classmate')+' claimed '+latest.itemName:'';
 }
 AppStore.subscribe('raid-loot-arena',(state,event)=>{if(!session)return;if(event?.type==='session:booted'&&currentUser?.id!==session.owner){wbrCloseBattle();return;}queueMicrotask(()=>{if(session)update();});});
 window.RaidLootArena=Object.freeze({open,update,stop,opensAt,owns:index=>!!session&&session.index===index});
})();
