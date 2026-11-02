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
 function scatter(c){
  if(!same(c))return;const width=c.field.clientWidth,cols=Math.min(c.drops.size||1,width<600?2:width<1000?3:4),rows=Math.ceil(c.drops.size/cols);
  c.field.style.minHeight=Math.max(width<600?340:400,160+rows*174)+'px';
  let i=0;for(const [id,node] of c.drops){let seed=0;for(const char of c.run+id)seed=(seed*31+char.charCodeAt(0))>>>0;
   const row=Math.floor(i/cols),count=Math.min(cols,c.drops.size-row*cols),col=i%cols;
   const x=width*(col+.5)/count+((seed%9)-4),y=175+row*174+((seed%17)-8);
   node.style.setProperty('--drop-tilt',((seed%9)-4)+'deg');node.style.left=x+'px';node.style.top=y+'px';node.style.setProperty('--drop-from-x',(width/2-x)+'px');node.style.setProperty('--drop-from-y',(68-y)+'px');i++;
  }
 }
 function message(text){const el=session?.root.querySelector('#raid-loot-notice');if(el)el.textContent=text;}
 function open(index,{resume=false}={}){
  const b=AppStore.getBossEvent(index);if(!b||currentRole!=='student'||!RaidService.visible(b)||b.currentHp!==0||!b.defeatedAt||!['loot','ended'].includes(b.status))return false;
  if(session&&same(session)&&session.index===index){update();return true;}
  if(WBR.bossIdx!=null&&WBR.bossIdx!==index)return false;
  stop();mountOverlay(index,b);wbrStop(true);WBR.phase='loot';WBR.bossIdx=index;
  const overlay=document.getElementById('campaign-overlay'),scene=document.getElementById('camp-scene');overlay.classList.add('raid-loot-active');overlay.setAttribute('aria-label','Victory and shared loot race');overlay.scrollTop=0;scene.onclick=null;
  const root=document.createElement('section');root.id='raid-loot-arena';root.className=motion.matches?'is-reduced':'';
  const elapsed=Math.max(0,Date.now()+(b._raidClockOffset||0)-startTime(b));root.style.setProperty('--victory-delay',Math.max(-1900,450-elapsed)+'ms');root.style.setProperty('--collapse-delay',Math.max(-1600,-elapsed)+'ms');
  const art=typeof bveRenderBossArt==='function'?bveRenderBossArt(b,{id:'raid-loot-boss-art',stateClass:'state-defeated'}):esc(b.image||b.name);
  root.innerHTML=`<header class="rla-header"><div><span>WORLD BOSS · SHARED LOOT</span><strong>${esc(b.name)}</strong></div><button type="button" class="rla-exit">Leave arena</button></header><div class="rla-victory"><span>THE FINAL STRIKE</span><h1>${esc(b.victoryTitle||'VICTORY')}</h1><p>${esc(b.victoryMessage||'The guardian has fallen. Claim the spoils before your classmates do.')}</p></div><div class="rla-race-bar"><div><span id="raid-loot-state">Boss defeated</span><strong id="raid-loot-countdown"></strong></div><p>Shared stock · first confirmed claim wins</p></div><div class="rla-field" aria-label="Scattered boss loot"><div class="rla-shockwave" aria-hidden="true"></div><div class="rla-boss">${art}<div class="rla-boss-seal" aria-hidden="true"></div></div><div class="rla-fragments" aria-hidden="true">${Array.from({length:motion.matches?0:12},(_,i)=>`<i style="--i:${i};--angle:${i*30}deg"></i>`).join('')}</div></div><footer class="rla-footer"><p id="raid-loot-notice" role="status" aria-live="polite"></p><div id="raid-loot-secured"></div><div id="raid-loot-latest"></div><button type="button" class="rla-results">View raid results</button><p class="rla-inventory-note">Confirmed drops are saved in My Inventory.</p></footer>`;
  scene.appendChild(root);
  const c={index,owner:currentUser.id,bossId:b._id,run:b.raidRunId||'legacy',root,field:root.querySelector('.rla-field'),drops:new Map(),busy:new Set(),timers:new Set(),ready:false};session=c;
  root.querySelector('.rla-exit').onclick=()=>wbrCloseBattle();root.querySelector('.rla-results').onclick=()=>RaidExperience.openSummary(index);
  c.keys=event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!document.querySelector('#modal-overlay[style*="flex"]')){event.preventDefault();wbrCloseBattle();}};document.addEventListener('keydown',c.keys);
  const ranks={Common:0,Rare:1,Epic:2,Legendary:3};
  let i=0;for(const reward of [...(b.lootRewards||[])].sort((a,b)=>(ranks[b.rarity]||0)-(ranks[a.rarity]||0)||String(a.id).localeCompare(String(b.id)))){
   const node=document.createElement('button');node.type='button';node.className='rla-drop';node.dataset.rewardId=reward.id;node.style.setProperty('--drop-delay',motion.matches?'0ms':Math.max(-1000,1000+Math.min(i*35,400)-elapsed)+'ms');
   const tones={Common:'#c5d5df',Rare:'#8ecbef',Epic:'#c7a4ef',Legendary:'#ead18b'};node.style.setProperty('--drop-accent',tones[reward.rarity]||tones.Common);
   node.onclick=()=>claim(c,reward.id,node);c.drops.set(reward.id,node);c.field.appendChild(node);i++;
  }
  if(!c.drops.size)c.field.insertAdjacentHTML('beforeend','<p class="rla-empty">Your class conquered the boss. No extra loot was configured.</p>');
  c.resize=new ResizeObserver(()=>scatter(c));c.resize.observe(c.field);scatter(c);update();c.clock=setInterval(update,200);
  if(resume||elapsed>4000)root.classList.add('is-resumed');root.querySelector('.rla-exit').focus({preventScroll:true});return true;
 }
 async function claim(c,id,node){
  if(!same(c)||c.busy.has(id)||Date.now()<opensAt(boss())||boss().status!=='loot'||!remaining(boss()))return;
  c.busy.add(id);update();const result=await wblrClaimReward(c.index,id);c.busy.delete(id);if(!same(c))return;
  update();if(result?.ok){node.classList.add('is-secured');schedule(c,()=>node.classList.remove('is-secured'),850);message(result.itemName+' secured. Saved to My Inventory.');}
  else{message(result?.reason||'Claim not confirmed. Try again.');RaidService.action(c.index,'snapshot').then(()=>{if(same(c))update();});}
 }
 function update(){
  const c=session;if(!c)return;if(!same(c)||!RaidService.visible(boss())){wbrCloseBattle();return;}
  const b=boss(),left=remaining(b),wait=Math.max(0,Math.ceil((opensAt(b)-Date.now())/1000)),live=b.status==='loot'&&left>0,ready=live&&!wait,rec=wbcMyRecord(c.index),eligible=!!rec&&rec.totalDamage>0;
  c.root.dataset.stage=!live?'closed':ready?'race':'burst';
  c.root.querySelector('#raid-loot-state').textContent=!live?'Loot race finished':wait?'Loot scattering · get ready':'LOOT RACE LIVE';
  c.root.querySelector('#raid-loot-countdown').textContent=!live?'':wait?'Opens in '+wait:Math.floor(left/60)+':'+String(left%60).padStart(2,'0')+' remaining';
  if(ready&&!c.ready){c.ready=true;message(eligible?'The loot is live. Choose a drop to claim it.':'Victory! Only raiders who dealt damage can claim limited loot.');}
  if(!live&&!c.finished){c.finished=true;message('The loot race has ended. Your confirmed drops are saved below.');}
  for(const reward of b.lootRewards||[]){const node=c.drops.get(reward.id);if(!node)continue;const stock=wblrRemaining(b,reward),mine=wblrClaimedByStudent(b,reward.id,c.owner),limit=reward.claimLimit||1,busy=c.busy.has(reward.id);
   node.disabled=!ready||!eligible||!stock||mine>=limit||busy;node.setAttribute('aria-busy',String(busy));
   const state=busy?'Confirming…':mine>=limit?'Secured':!stock?'Taken':!live?'Closed':wait?'Get ready':!eligible?'Contribution required':'Grab loot';
   const markup=`<span class="rla-drop-icon">${glyph(reward.rarity)}</span><span class="rla-drop-rarity">${esc(reward.rarity||'Common')}</span><strong>${esc(reward.itemName)}</strong><span class="rla-drop-stock">${stock} left · ${esc(state)}</span>`;
   if(node._lootMarkup!==markup){node.innerHTML=markup;node._lootMarkup=markup;}node.classList.toggle('is-taken',!stock);node.setAttribute('aria-label',`${reward.itemName}, ${reward.rarity||'Common'}, ${stock} remaining. ${state}`);
  }
  const mine=(b.lootClaims||[]).filter(x=>x.studentId===c.owner),secured=c.root.querySelector('#raid-loot-secured');
  const securedMarkup=mine.length?'<span>YOUR SECURED LOOT</span>'+mine.map(x=>`<strong>${esc(x.itemName)}</strong>`).join(''):'';if(c.securedMarkup!==securedMarkup){secured.innerHTML=securedMarkup;c.securedMarkup=securedMarkup;}
  const latest=(b.lootClaims||[]).slice().sort((a,b)=>(b.claimedAt||0)-(a.claimedAt||0))[0];c.root.querySelector('#raid-loot-latest').textContent=latest?(latest.studentId===c.owner?'You':latest.studentName||'A classmate')+' claimed '+latest.itemName:'';
 }
 AppStore.subscribe('raid-loot-arena',(state,event)=>{if(!session)return;if(event?.type==='session:booted'&&currentUser?.id!==session.owner){wbrCloseBattle();return;}queueMicrotask(()=>{if(session)update();});});
 window.RaidLootArena=Object.freeze({open,update,stop,opensAt,owns:index=>!!session&&session.index===index});
})();
