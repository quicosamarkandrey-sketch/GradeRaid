/* Battle presentation only. This module never changes questions, damage,
   health, wallets or rewards. Each effect belongs to one open raid session. */
;(function(){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const media=matchMedia('(prefers-reduced-motion: reduce)');
 const paths={earthquake:'M3 18h5l3-12 3 15 3-10 2 7h2',chaos_wind:'M3 7h12q6 0 4-4M3 12h16q5 0 2 4M3 17h8q5 0 3 4',darkness:'M19 15A8 8 0 0 1 9 5a8 8 0 1 0 10 10Z',mirror_trick:'m12 2 8 10-8 10-8-10Zm0 0v20M4 12h16',berserk_roar:'M5 4 2 8v8l3 4m14-16 3 4v8l-3 4M8 8h8v8H8Z',meteor_shower:'m20 3-8 8M15 3 6 12m15-4-8 8M8 12a4 4 0 1 0 4 4Z',rage:'m13 2-2 7h7L8 22l2-9H4Z',phase:'m3 12 6-8h6l6 8-6 8H9Z',hit:'m12 2 2 7 8 3-8 2-2 8-2-8-8-2 8-3Z'};
 const skills={earthquake:{name:'Earthquake',detail:'The arena fractures beneath the boss.',tone:'#d4bb93'},chaos_wind:{name:'Chaos Wind',detail:'Gale currents sweep the arena.',tone:'#a8d6e2'},darkness:{name:'Eclipse',detail:'The arena darkens. Your question stays illuminated.',tone:'#c1b4df'},mirror_trick:{name:'Mirror Trick',detail:'Prismatic echoes herald a shuffle of the choices.',tone:'#b8d9df'},berserk_roar:{name:'Berserk Roar',detail:'A shockwave rolls out from the boss.',tone:'#e1a3a1'},meteor_shower:{name:'Meteor Shower',detail:'Watch the sky. The barrage is visual.',tone:'#e4ce9d'}};
 const svg=(key,cls='')=>`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[key]||paths.phase}"/></svg>`;
 let context=null,serial=0;
 function open(){return typeof WBR!=='undefined'&&WBR.bossIdx!=null&&document.querySelector('.raid-battle.open');}
 function scope(){
  if(!open())return null;
  const boss=AppStore.getBossEvent(WBR.bossIdx);if(!boss||currentRole!=='student'||!currentUser)return null;
  const key=[currentUser.id,boss._id,WBR.bossIdx,boss.raidRunId||'legacy'].join(':');
  if(!context||context.key!==key){stop();context={key,index:WBR.bossIdx,timers:new Set(),casts:new Map(),seen:new Set(),phase:null,raging:false,ko:false,hp:null,notice:null};}
  const scene=document.getElementById('camp-scene'),stage=document.getElementById('camp-enemy-sprite'),bar=document.getElementById('camp-enemy-bar');
  if(!scene||!stage||!bar)return null;
  if(!context.field){context.field=document.createElement('div');context.field.id='rfx-arena';context.field.setAttribute('aria-hidden','true');}
  if(!context.field.isConnected)scene.appendChild(context.field);
  if(!context.stage){context.stage=document.createElement('div');context.stage.id='rfx-stage';context.stage.setAttribute('aria-hidden','true');}
  if(!context.stage.isConnected)stage.appendChild(context.stage);
  if(!document.getElementById('rfx-state')){const state=document.createElement('div');state.id='rfx-state';state.innerHTML='<div id="rfx-phase"></div><div id="rfx-rage"></div>';bar.appendChild(state);}
  if(!document.getElementById('rfx-announcer')){const announcer=document.createElement('div');announcer.id='rfx-announcer';announcer.setAttribute('role','status');announcer.setAttribute('aria-live','polite');bar.appendChild(announcer);}
  scene.classList.add('rfx-ready');scene.classList.toggle('rfx-reduced',media.matches);
  return {ctx:context,boss,scene,stage,bar};
 }
 function later(ctx,fn,ms){const timer=setTimeout(()=>{ctx.timers.delete(timer);if(context===ctx&&open())fn();},ms);ctx.timers.add(timer);return timer;}
 function clear(ctx,timer){clearTimeout(timer);ctx.timers.delete(timer);}
 function effect(kind,html,duration,where='stage'){
  const s=scope();if(!s)return null;const root=where==='arena'?s.ctx.field:s.ctx.stage;
  const node=document.createElement('div');node.className='rfx-effect rfx-'+kind;node.innerHTML=html;root.appendChild(node);
  // Capped DOM and scoped lifetime, including when several teachers send skills.
  while(root.children.length>4)root.firstElementChild.remove();
  later(s.ctx,()=>node.remove(),duration);return node;
 }
 function announce(title,detail,kind='phase',duration=4500,tone='#b6ceda'){
  const s=scope();if(!s)return;const el=document.getElementById('rfx-announcer');
  if(s.ctx.notice)clear(s.ctx,s.ctx.notice);
  el.style.setProperty('--rfx-tone',tone);el.dataset.kind=kind;
  el.innerHTML=`${svg(kind)}<div><strong>${esc(title)}</strong><span>${esc(detail)}</span></div>`;el.classList.add('is-visible');
  s.ctx.notice=later(s.ctx,()=>{el.classList.remove('is-visible');el.replaceChildren();},duration);
 }
 function artwork(){const art=document.getElementById('wb-boss-sprite-art');if(!art)return '';if(art.tagName==='IMG')return `<img src="${esc(art.currentSrc||art.src)}" alt="">`;return `<span>${esc(art.textContent)}</span>`;}
 function perform(kind,spec,duration){
  const s=scope();if(!s)return;const quiet=media.matches,life=quiet?900:duration;
  switch(kind){
   case 'earthquake':effect('fracture',`<svg viewBox="0 0 700 240" preserveAspectRatio="none"><path d="m350 45-40 45 23 20-52 37 22 23-57 55M350 45l34 48-16 19 49 35-16 25 54 56M281 147l-48-18-35 13-53-23m272 28 46-16 32 15 60-25"/><path class="rfx-fracture-core" d="m350 45-40 45 23 20-52 37 22 23-57 55M350 45l34 48-16 19 49 35-16 25 54 56"/></svg>`,life);s.stage.classList.add('rfx-stomp');later(s.ctx,()=>s.stage.classList.remove('rfx-stomp'),600);break;
   case 'chaos_wind':effect('wind',`<svg viewBox="0 0 700 240" preserveAspectRatio="none">${[0,1,2,3].map(i=>`<path style="--i:${i}" d="M-60 ${60+i*35}Q110 ${-5+i*30} 310 ${55+i*28}T760 ${35+i*45}"/>`).join('')}</svg>`,life);break;
   case 'darkness':effect('eclipse','<i></i><b></b>',life,'arena');effect('umbra','<i></i><b></b>',life);break;
   case 'mirror_trick':effect('mirror',`<i class="rfx-mirror-left">${artwork()}</i><i class="rfx-mirror-right">${artwork()}</i><b></b>`,life);
    // Preserve the real button nodes, IDs, handlers and keyboard focus.
    if(!WBR.answerPending){const list=document.getElementById('camp-options'),focus=document.activeElement;if(list){const nodes=[...list.children];for(let i=nodes.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[nodes[i],nodes[j]]=[nodes[j],nodes[i]];}nodes.forEach(n=>list.appendChild(n));if(focus?.isConnected&&list.contains(focus))focus.focus({preventScroll:true});}}
    break;
   case 'berserk_roar':effect('roar','<i></i><i></i><i></i>',life);s.stage.classList.add('rfx-roar-source');later(s.ctx,()=>s.stage.classList.remove('rfx-roar-source'),650);break;
   case 'meteor_shower':effect('meteors',Array.from({length:innerWidth<600?5:9},(_,i)=>`<i style="--i:${i};--x:${8+i*10}%"></i>`).join(''),life,'arena');effect('meteor-impacts','<i></i><i></i><i></i>',life);break;
  }
 }
 function cast(index,kind,spec={}){
  const s=scope();if(!s||s.ctx.index!==index||!skills[kind])return false;
  // Duplicate signals do not restart a skill or accumulate extra particle layers.
  if(s.ctx.casts.has(kind))return true;
  const meta=skills[kind],id=++serial,delay=media.matches?0:650,duration=Math.min(10000,Math.max(1600,Number(spec.durationSec||2.5)*1000));
  const el=document.createElement('div');el.id='rfx-cast-'+id;el.className='rfx-cast';el.setAttribute('role','status');el.title=spec.name||meta.name;el.style.setProperty('--rfx-tone',meta.tone);el.style.setProperty('--rfx-cast-time',delay+'ms');
  el.innerHTML=`${svg(kind)}<div><span class="rfx-cast-state">Preparing skill</span><strong>${esc(spec.name||meta.name)}</strong><small>${esc(meta.detail)}</small></div><i class="rfx-cast-charge"></i>`;
  const bar=document.getElementById('camp-enemy-bar');bar.querySelectorAll('.rfx-cast').forEach(n=>n.remove());bar.appendChild(el);s.ctx.casts.set(kind,el);
  if(typeof BVS!=='undefined')BVS.request('cast',delay+400);
  later(s.ctx,()=>{if(!el.isConnected&&context!==s.ctx)return;el.classList.add('is-cast');el.querySelector('.rfx-cast-state').textContent='Skill active';perform(kind,spec,duration);},delay);
  later(s.ctx,()=>{el.remove();s.ctx.casts.delete(kind);},delay+duration);
  return true;
 }
 function phase(index,number){const s=scope();if(!s||s.ctx.index!==index)return false;const p=wbpGetPhases(s.boss).find(p=>Number(p.phase)===Number(number))||wbpGetCurrentPhase(s.boss);s.ctx.phase=Number(number);s.scene.dataset.rfxPhase=String(number);announce('Phase '+number+' · '+(p.label||p.name),' '+(p.description||'The boss changes its stance.'),'phase',5000,number>=3?'#dfaaa3':number>=2?'#dec498':'#b6ceda');if(!media.matches)effect('phase-wave','<i></i><i></i>',1600);return true;}
 function rage(index,cfg,first=false){const s=scope();if(!s||s.ctx.index!==index)return false;const active=wbrageIsActive(s.boss);const entering=active&&!s.ctx.raging;s.ctx.raging=active;s.scene.classList.toggle('rfx-raging',active);
  const badge=document.getElementById('rfx-rage');badge.innerHTML=active?`${svg('rage')}<strong>Enraged</strong><span>Faster skills · stronger minion pressure</span>`:'';
  badge.hidden=!active;
  let aura=s.ctx.stage.querySelector('.rfx-rage-aura');if(active&&cfg.showAura!==false&&!aura){aura=document.createElement('div');aura.className='rfx-rage-aura';aura.innerHTML='<i></i><b></b>'+Array.from({length:8},(_,i)=>`<em style="--i:${i}"></em>`).join('');s.ctx.stage.appendChild(aura);}if(!active||cfg.showAura===false)aura?.remove();
  if(entering&&(cfg.showBanner!==false||cfg.showToast!==false))announce('Rage mode · '+s.boss.name,cfg.dialogue||'The boss draws on its last reserves. Minions are enraged.','rage',5500,'#e1aaa4');
  minions();return true;
 }
 function minions(){if(!context||!open())return;const s=scope();if(!s)return;const raging=wbrageIsActive(s.boss);
  document.querySelectorAll('.raid-battle .wbm-minion-alert').forEach(node=>{
   const id=node.id;node.classList.remove('wbm-entry-left','wbm-entry-right');
   if(!s.ctx.seen.has(id)){s.ctx.seen.add(id);node.classList.add(node.closest('#wbr-minion-dock-right')?'rfx-arrive-right':'rfx-arrive-left');later(s.ctx,()=>node.classList.remove('rfx-arrive-left','rfx-arrive-right'),650);}
   node.classList.toggle('rfx-minion-enraged',raging);let chip=node.querySelector('.rfx-minion-rage');
   if(raging&&!chip){chip=document.createElement('span');chip.className='rfx-minion-rage';chip.textContent='Enraged';node.querySelector('.wbm-minion-info')?.appendChild(chip);}if(!raging)chip?.remove();
  });
 }
 function minionHit(id,correct){const s=scope();if(!s)return;const node=document.getElementById('wbm-minion-alert-'+id);if(!node)return;node.classList.remove('rfx-arrive-left','rfx-arrive-right');node.classList.add(correct?'rfx-minion-defeat':'rfx-minion-resist');if(!correct)later(s.ctx,()=>node.classList.remove('rfx-minion-resist'),600);}
 function hit(damage,critical=false){const s=scope();if(!s)return;const el=effect('hit'+(critical?' is-critical':''),`${svg('hit','rfx-hit-sigil')}<span class="rfx-hit-value">−${Math.max(0,Number(damage)||0).toLocaleString()}<small>${critical?'Critical strike':'Confirmed hit'}</small></span>`,1100);if(el)el.setAttribute('aria-hidden','true');s.stage.classList.add('rfx-impact');later(s.ctx,()=>s.stage.classList.remove('rfx-impact'),420);}
 function sync(index){const s=scope();if(!s||s.ctx.index!==index)return;
  const p=wbpGetCurrentPhase(s.boss),number=Number(p.phase||1);s.scene.dataset.rfxPhase=String(number);
  document.getElementById('rfx-phase').innerHTML=`${svg('phase')}<strong>Phase ${number}</strong><span>${esc(p.label||p.name||'Battle')}</span>`;
  if(s.ctx.phase!==null&&s.ctx.phase!==number)phase(index,number);else s.ctx.phase=number;
  rage(index,wbrageSettings(s.boss));
  const rec=wbcMyRecord(index),ko=!!rec?.isKO;s.scene.classList.toggle('rfx-player-ko',ko);
  if(s.ctx.ko&&!ko)announce('Back in battle','Your revive is confirmed. You can answer again.','phase',3500,'#a4d1c1');s.ctx.ko=ko;
  const hp=Math.max(0,Math.min(100,(s.boss.currentHp??s.boss.maxHp)/Math.max(1,s.boss.maxHp)*100)),track=document.querySelector('.camp-enemy-hp-wrap');
  if(track&&!track.querySelector('.rfx-health-echo')){const echo=document.createElement('i');echo.className='rfx-health-echo';track.prepend(echo);}
  const echo=track?.querySelector('.rfx-health-echo');if(echo){if(s.ctx.hp===null||hp>=s.ctx.hp)echo.style.width=hp+'%';else{echo.style.width=s.ctx.hp+'%';later(s.ctx,()=>{if(echo.isConnected)echo.style.width=hp+'%';},180);}s.ctx.hp=hp;}
  minions();
 }
 function stop(){if(!context)return;document.querySelectorAll('.raid-battle .wbm-minion-alert').forEach(node=>node.classList.remove('rfx-minion-enraged','rfx-arrive-left','rfx-arrive-right','rfx-minion-defeat','rfx-minion-resist'));document.querySelectorAll('.rfx-minion-rage').forEach(node=>node.remove());for(const t of context.timers)clearTimeout(t);context.field?.remove();context.stage?.remove();document.querySelectorAll('#rfx-state,#rfx-announcer,.rfx-cast,.rfx-health-echo').forEach(n=>n.remove());const scene=document.getElementById('camp-scene');scene?.classList.remove('rfx-ready','rfx-raging','rfx-reduced','rfx-player-ko');if(scene)delete scene.dataset.rfxPhase;document.getElementById('camp-enemy-sprite')?.classList.remove('rfx-impact','rfx-stomp','rfx-roar-source');context=null;}
 media.addEventListener('change',()=>{const index=context?.index;stop();if(index!=null&&open())sync(index);});
 window.RaidFX=Object.freeze({cast,phase,rage,sync,minions,minionHit,hit,stop});
})();
