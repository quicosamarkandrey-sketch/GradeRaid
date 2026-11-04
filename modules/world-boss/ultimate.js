/* Shared Cataclysm presentation. The server owns targets, progress, deadlines
   and damage. No client timers can decide success or remove a heart. */
;(function(){
 'use strict';
 const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
 let session=null,timer=null,damageTimer=null,lastDamageKey=null;
 const now=b=>Date.now()+(b?._raidClockOffset||0);
 function busy(index){const b=AppStore.getBossEvent(index),u=b?.raidUltimate;return !!(u&&['casting','eruption'].includes(u.phase)&&(u.phase==='casting'||now(b)<u.endsAt));}
 function stop(){clearTimeout(damageTimer);document.getElementById('rux-player-damage')?.remove();document.getElementById('camp-lives')?.classList.remove('rux-health-hit');window.RaidFX?.endCataclysm();clearInterval(timer);timer=null;session=null;document.querySelectorAll('#raid-ultimate,#raid-ultimate-core').forEach(n=>n.remove());document.getElementById('camp-scene')?.classList.remove('rux-charging','rux-eruption','rux-broken');}
 function sync(index){
  const b=AppStore.getBossEvent(index),u=b?.raidUltimate,scene=document.getElementById('camp-scene');
  if(!scene||!document.querySelector('.raid-battle.open')||WBR.phase!=='battle'||b?.status!=='active'||!u?.id||!['casting','eruption','interrupted'].includes(u.phase)){if(session)stop();return;}
  const time=now(b);if(u.phase!=='casting'&&time>=u.endsAt){if(session)stop();return;}
  const key=[currentUser?.id,b._id,b.raidRunId,u.id].join(':');
  if(session?.key!==key){stop();session={key,index,phase:null,progress:-1};timer=setInterval(()=>sync(index),150);}
  let panel=document.getElementById('raid-ultimate');
  if(!panel){panel=document.createElement('section');panel.id='raid-ultimate';panel.setAttribute('aria-label','Class ultimate challenge');panel.innerHTML='<div class="rux-heading"><span class="rux-tag">CLASS INTERRUPT</span><strong>CATACLYSM</strong><span class="rux-clock"></span></div><p class="rux-instruction"></p><div class="rux-track"><i></i></div><div class="rux-foot"><strong></strong><span></span></div><div class="rux-announcement" role="status" aria-live="polite"></div>';document.querySelector('.camp-question-box')?.before(panel);}
  let core=document.getElementById('raid-ultimate-core');
  if(!core){core=document.createElement('div');core.id='raid-ultimate-core';core.setAttribute('aria-hidden','true');core.innerHTML='<div class="rux-solar-shaft"></div><div class="rux-solar-crown"><svg viewBox="0 0 200 200">'+Array.from({length:12},(_,i)=>`<path transform="rotate(${i*30} 100 100)" d="m100 8 6 51-6 14-6-14Z"/>`).join('')+'<circle cx="100" cy="100" r="32"/><circle class="rux-sun-disc" cx="100" cy="100" r="23"/></svg></div><svg class="rux-cracks" viewBox="0 0 200 200"><path d="m100 15-16 43 20 18-18 26 15 17-24 66M84 58 49 66 29 94m75-18 32-22 36 8m-86 40-35 25-27-8m77 0 37 18 28 40"/></svg>'+Array.from({length:10},(_,i)=>`<i class="rux-splinter" style="--angle:${i*36}deg"></i>`).join('')+'<div class="rux-outcome"></div>';document.getElementById('camp-enemy-sprite')?.appendChild(core);}
  panel.dataset.phase=u.phase;core.dataset.phase=u.phase;
  core.querySelector('.rux-outcome').textContent=u.phase==='interrupted'?'CAST BROKEN':u.phase==='eruption'&&reduced()?'SOLAR BARRAGE':'';
  const changed=session.phase!==u.phase;
  if(changed){session.phase=u.phase;panel.dataset.phase=u.phase;core.dataset.phase=u.phase;scene.classList.toggle('rux-charging',u.phase==='casting');scene.classList.toggle('rux-eruption',u.phase==='eruption');scene.classList.toggle('rux-broken',u.phase==='interrupted');
   if(typeof BVS!=='undefined'){if(u.phase==='casting')BVS.request('cast',Math.min(10000,Math.max(120,u.deadline-time)));else {BVS.request('idle');BVS.request(u.phase==='interrupted'?'hit':'cast',u.phase==='interrupted'?650:1200);}}
   panel.querySelector('.rux-announcement').textContent=u.phase==='casting'?'Ultimate incoming. Answer correctly together to break the cast.':u.phase==='interrupted'?'Cast broken. Your class stopped Cataclysm.':'Cataclysm unleashed. The class took damage. Solar beams are targeting your answers.';
   if(u.phase==='eruption'&&wbcMyRecord(index)?.isKO)queueMicrotask(()=>{if(WBR.bossIdx===index&&WBR.phase==='battle')wbrShowEncounter();});
   core.querySelector('.rux-outcome').textContent=u.phase==='interrupted'?'CAST BROKEN':u.phase==='eruption'&&reduced()?'SOLAR BARRAGE':'';
  }
  const left=Math.max(0,Math.ceil(((u.phase==='casting'?u.deadline:u.endsAt)-time)/1000)),progress=Math.min(u.target,u.progress||0),ratio=progress/Math.max(1,u.target);
  panel.querySelector('.rux-clock').textContent=u.phase==='casting'?(left?left+'s':'Confirming…'):u.phase==='eruption'?left+'s':'';
  panel.querySelector('.rux-instruction').textContent=u.phase==='casting'?'Break the solar crown with correct answers before the barrage begins.':u.phase==='interrupted'?'Your class shattered the solar crown. The barrage was stopped.':'Sun rays shatter marked choices. Tap to rebuild them, or wait for them to recover.';
  panel.querySelector('.rux-track i').style.width=(u.phase==='casting'?ratio*100:u.phase==='interrupted'?100:Math.max(0,(u.endsAt-time)/Math.max(1,u.endsAt-u.resolvedAt)*100))+'%';
  panel.querySelector('.rux-foot strong').textContent=u.phase==='casting'?progress+' / '+u.target+' answers':u.phase==='interrupted'?'Class interrupt successful':'−'+(u.damage||1)+' heart · server confirmed';
  const mine=Number(u.contributors?.[currentUser?.id]||0);panel.querySelector('.rux-foot span').textContent=u.phase==='casting'?(mine?'You contributed '+mine:'Every correct answer counts'):' ';core.style.setProperty('--rux-fracture',ratio);
  if(session.progress!==progress){session.progress=progress;core.classList.remove('rux-struck');void core.offsetWidth;core.classList.add('rux-struck');}
  // Hold the boss's configured casting stance throughout the complete wind-up.
  if(u.phase==='casting'&&typeof BVS!=='undefined'&&BVS._current!=='cast')BVS.request('cast',Math.min(10000,Math.max(120,u.deadline-time)));
  if(u.phase==='eruption'&&time<u.endsAt)window.RaidFX?.cataclysm(index,u);
 }
 function playerHit(hit){
  if(hit.studentId!==currentUser?.id||WBR.bossIdx!==hit.bossIdx||WBR.phase!=='battle'||!(hit.damage>0))return;
  const boss=AppStore.getBossEvent(hit.bossIdx),key=[currentUser.id,boss?._id,boss?.raidRunId,hit.castId].join(':');if(key===lastDamageKey)return;lastDamageKey=key;
  clearTimeout(damageTimer);document.getElementById('rux-player-damage')?.remove();
  const heart='<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 28 4 16C-4 5 10-2 16 8 22-2 36 5 28 16Z"/><path class="rux-heart-crack" d="m18 6-5 9 7 1-6 12"/></svg>';
  const layer=document.createElement('div');layer.id='rux-player-damage';layer.setAttribute('role','alert');layer.innerHTML='<div class="rux-damage-cut"></div><div class="rux-damage-card"><span>CATACLYSM HIT YOU</span><div>'+heart+'<strong>−'+Math.min(99,Number(hit.damage))+'<small> HEART'+(hit.damage===1?'':'S')+'</small></strong></div><p>'+(hit.after===0?'Knocked out · recover to return':hit.after+' / '+hit.maxHp+' hearts remaining')+'</p></div>';
  const hud=document.getElementById('camp-lives');hud?.classList.remove('rux-health-hit');if(hud){void hud.offsetWidth;hud.classList.add('rux-health-hit');}
  for(let i=hit.after;i<Math.min(hit.before,hit.after+3);i++){
   const rect=hud?.querySelectorAll('.wbm-heart')[i]?.getBoundingClientRect();if(!rect)continue;
   const ghost=document.createElement('div');ghost.className='rux-heart-echo';ghost.setAttribute('aria-hidden','true');ghost.innerHTML=heart;ghost.style.left=rect.x+'px';ghost.style.top=rect.y+'px';ghost.style.animationDelay=((i-hit.after)*100)+'ms';layer.appendChild(ghost);
  }
  document.getElementById('campaign-overlay').appendChild(layer);
  damageTimer=setTimeout(()=>{layer.remove();hud?.classList.remove('rux-health-hit');},2800);
 }
 async function fire(index){const response=await RaidService.action(index,'ultimate');if(!response.ok)toast(response.reason);else toast('Cataclysm is charging. The class must break its cast.');}
 window.RaidUltimate=Object.freeze({sync,stop,isBusy:busy,fire,playerHit});
})();
