/* Scoped raid presentation and temporary answer disruptions. Never changes
   question content, damage, health, wallets or rewards. */
;(function(){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const media=matchMedia('(prefers-reduced-motion: reduce)');
 const paths={earthquake:'M3 18h5l3-12 3 15 3-10 2 7h2',chaos_wind:'M3 7h12q6 0 4-4M3 12h16q5 0 2 4M3 17h8q5 0 3 4',darkness:'M19 15A8 8 0 0 1 9 5a8 8 0 1 0 10 10Z',mirror_trick:'m12 2 8 10-8 10-8-10Zm0 0v20M4 12h16',berserk_roar:'M5 4 2 8v8l3 4m14-16 3 4v8l-3 4M8 8h8v8H8Z',meteor_shower:'m20 3-8 8M15 3 6 12m15-4-8 8M8 12a4 4 0 1 0 4 4Z',gravity_well:'M20 12a8 8 0 1 1-8-8m0 4a4 4 0 1 0 4 4M12 2v5m-3-3 3 3 3-3',phantom_orbit:'M4 12a8 8 0 0 1 14-5m2 5a8 8 0 0 1-14 5M3 4v5h5m13 11v-5h-5',lightning_storm:'m13 2-8 11h6l-1 9 9-13h-6Z',glacial_prison:'m12 2 7 10-7 10-7-10Zm0 0v20M5 12h14',void_lance:'m3 21 8-8m2-2 8-8M8 3l13 13M3 8l13 13',rage:'m13 2-2 7h7L8 22l2-9H4Z',phase:'m3 12 6-8h6l6 8-6 8H9Z',hit:'m12 2 2 7 8 3-8 2-2 8-2-8-8-2 8-3Z'};
 const skills={gravity_well:{name:'Gravity Well',detail:'A singularity pulls and compresses the moving choices.',tone:'#bd91ff'},phantom_orbit:{name:'Phantom Orbit',detail:'Track choices as they circle in opposing paths.',tone:'#86a7ff'},earthquake:{name:'Earthquake',detail:'Choices fracture and shift. Tap buried choices to uncover them.',tone:'#eac485'},chaos_wind:{name:'Chaos Wind',detail:'Gale currents throw the choices off course. Catch the answer.',tone:'#74ddd1'},darkness:{name:'Eclipse',detail:'Answers fall into shadow. Tap once to reveal, again to answer.',tone:'#b8a0ff'},mirror_trick:{name:'Mirror Trick',detail:'Choices change places. Follow the answer, not its position.',tone:'#8fc8ff'},berserk_roar:{name:'Berserk Roar',detail:'The roar scrambles your focus. Tap obscured choices to recover.',tone:'#ff6b61'},meteor_shower:{name:'Meteor Shower',detail:'Meteors shatter choices. Tap a shattered choice to reform it.',tone:'#f4c979'},lightning_storm:{name:'Lightning Storm',detail:'A choice is charged. Tap to ground the lightning.',tone:'#79cdff'},glacial_prison:{name:'Glacial Prison',detail:'Choices are frozen. Tap to shatter their ice.',tone:'#81efee'},void_lance:{name:'Void Lance',detail:'A choice is sealed. Tap to dispel the rift.',tone:'#ee83ff'}};
 const svg=(key,cls='')=>`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[key]||paths.phase}"/></svg>`;
 let context=null,serial=0;
 function open(){return typeof WBR!=='undefined'&&WBR.bossIdx!=null&&document.querySelector('.raid-battle.open');}
 function scope(){
  if(!open())return null;
  const boss=AppStore.getBossEvent(WBR.bossIdx);if(!boss||currentRole!=='student'||!currentUser)return null;
  const key=[currentUser.id,boss._id,WBR.bossIdx,boss.raidRunId||'legacy'].join(':');
  if(!context||context.key!==key){stop();context={key,index:WBR.bossIdx,timers:new Set(),casts:new Map(),pressures:new Set(),seen:new Set(),phase:null,raging:false,ko:false,hp:null,notice:null};}
  const scene=document.getElementById('camp-scene'),stage=document.getElementById('camp-enemy-sprite'),bar=document.getElementById('camp-enemy-bar');
  if(!scene||!stage||!bar)return null;
  if(!context.field){context.field=document.createElement('div');context.field.id='rfx-arena';context.field.setAttribute('aria-hidden','true');}
  if(!context.field.isConnected)scene.appendChild(context.field);
  if(!context.screen){context.screen=document.createElement('div');context.screen.id='rfx-screen';context.screen.setAttribute('aria-hidden','true');}
  if(!context.screen.isConnected)scene.appendChild(context.screen);
  if(!context.stage){context.stage=document.createElement('div');context.stage.id='rfx-stage';context.stage.setAttribute('aria-hidden','true');}
  if(!context.stage.isConnected)stage.appendChild(context.stage);
  if(!context.stage.querySelector('.rfx-arena-floor')){const floor=document.createElement('div');floor.className='rfx-arena-floor';floor.innerHTML='<svg viewBox="0 0 600 220" fill="none"><ellipse cx="300" cy="110" rx="250" ry="84"/><ellipse cx="300" cy="110" rx="210" ry="67"/><path d="m50 110 250-84 250 84-250 84Z"/>'+Array.from({length:12},(_,i)=>`<path transform="translate(300 110) rotate(${i*30})" d="m0-75 5-7-5-7-5 7Z"/>`).join('')+'</svg><i></i>';context.stage.prepend(floor);}

  if(!document.getElementById('rfx-state')){const state=document.createElement('div');state.id='rfx-state';state.innerHTML='<div id="rfx-phase"></div><div id="rfx-rage"></div>';bar.appendChild(state);}
  if(!document.getElementById('rfx-announcer')){const announcer=document.createElement('div');announcer.id='rfx-announcer';announcer.setAttribute('role','status');announcer.setAttribute('aria-live','polite');bar.appendChild(announcer);}
  scene.classList.add('rfx-ready');scene.classList.toggle('rfx-reduced',media.matches);
  return {ctx:context,boss,scene,stage,bar};
 }
 function later(ctx,fn,ms){const timer=setTimeout(()=>{ctx.timers.delete(timer);if(context===ctx&&open())fn();},ms);ctx.timers.add(timer);return timer;}
 function clear(ctx,timer){clearTimeout(timer);ctx.timers.delete(timer);}
 function effect(kind,html,duration,where='stage'){
  const s=scope();if(!s)return null;const root=where==='screen'?s.ctx.screen:where==='arena'?s.ctx.field:s.ctx.stage;
  const node=document.createElement('div');node.className='rfx-effect rfx-'+kind;node.innerHTML=html;root.appendChild(node);
  // Capped DOM and scoped lifetime, including when several teachers send skills.
  const layers=[...root.querySelectorAll(':scope > .rfx-effect')];while(layers.length>4)layers.shift().remove();
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
 const choiceClasses=['rfx-choice','rfx-obscured','rfx-aimed','rfx-meteor-mark','rfx-mirror-turn'];
 const movingSkills=new Set(['chaos_wind','earthquake','berserk_roar','gravity_well','phantom_orbit']);
 const challenges={gravity_well:{hint:'Gravity Well · catch a choice as it is pulled into the vortex.'},phantom_orbit:{hint:'Phantom Orbit · track the moving answer, not its original position.'},lightning_storm:{hint:'Lightning Storm · ground a charged choice before answering.',cover:'Charged · tap to ground'},glacial_prison:{hint:'Glacial Prison · tap a frozen choice to shatter its ice.',cover:'Frozen · tap to shatter'},void_lance:{hint:'Void Lance · dispel the seal, then answer.',cover:'Sealed · tap to dispel'},earthquake:{hint:'Earthquake · shifting ground buries choices. Tap to uncover.',cover:'Buried · tap to uncover'},chaos_wind:{hint:'Chaos Wind · catch the answer while the choices are being swept away.'},darkness:{hint:'Eclipse · tap a shadowed choice to reveal it, then answer.',cover:'Shadowed · tap to reveal'},mirror_trick:{hint:'Mirror Trick · choices switch places. Track the answer text.'},berserk_roar:{hint:'Berserk Roar · tap a disrupted choice to regain focus.',cover:'Disrupted · tap to focus'},meteor_shower:{hint:'Meteor Shower · marked choices will shatter. Tap to reform.',cover:'Shattered · tap to reform'}};
 function challengeAlive(c){return c.list.isConnected&&c.nodes.every(n=>n.isConnected&&(c.flight||c.list).contains(n))&&(!c.origins||c.origins.every(o=>o.marker.isConnected));}
 function landChoices(c){
  if(!c.flight)return;
  const focus=document.activeElement;c.flyAnimations.forEach(a=>a.cancel());cancelAnimationFrame(c.flightFrame);
  window.removeEventListener('resize',c.flightResize);document.getElementById('campaign-overlay')?.removeEventListener('scroll',c.flightResize);
  for(const origin of c.origins){if(origin.marker.isConnected)origin.marker.replaceWith(origin.node);else origin.node.remove();}
  c.flight.remove();c.flightPlaceholder.remove();c.list.style.minHeight=c.originalMinHeight;
  c.nodes.forEach(n=>n.style.removeProperty('--rfx-flight-width'));if(c.nodes.includes(focus)&&focus.isConnected)focus.focus({preventScroll:true});
 }
 function releaseChoices(c,spec){
  if(media.matches||!movingSkills.has(c.kind))return;
  const overlay=document.getElementById('campaign-overlay'),focus=document.activeElement,starts=c.nodes.map(n=>n.getBoundingClientRect());
  c.originalMinHeight=c.list.style.minHeight;c.list.style.minHeight=Math.max(80,c.list.getBoundingClientRect().height)+'px';
  c.origins=c.nodes.map(node=>{const marker=document.createComment('raid choice '+node.id);node.before(marker);return {node,marker};});
  c.flight=document.createElement('div');c.flight.id='rfx-answer-flight';c.flight.className='rfx-flight-'+c.kind;c.flight.setAttribute('role','group');c.flight.setAttribute('aria-label','Moving answer choices');
  c.flightPlaceholder=document.createElement('div');c.flightPlaceholder.className='rfx-flight-placeholder';c.flightPlaceholder.setAttribute('aria-hidden','true');c.flightPlaceholder.textContent='The choices have been scattered across the battlefield.';c.list.appendChild(c.flightPlaceholder);
  overlay.appendChild(c.flight);c.nodes.forEach(n=>c.flight.appendChild(n));c.flyAnimations=[];
  const layout=initial=>{
   if(context?.challenge!==c||!challengeAlive(c))return;
   const current=initial?starts:c.nodes.map(n=>n.getBoundingClientRect());c.flyAnimations.forEach(a=>a.cancel());c.flyAnimations=[];
   const vw=innerWidth,vh=innerHeight,bw=vw<600?Math.min(168,Math.max(118,(vw-36)/2)):Math.min(270,Math.max(180,vw*.18));
   const hud=document.querySelector('.raid-battle .camp-hud')?.getBoundingClientRect(),question=document.querySelector('.raid-battle .camp-question-box')?.getBoundingClientRect();
   c.nodes.forEach((node,i)=>{
    node.style.setProperty('--rfx-flight-width',bw+'px');const bh=node.offsetHeight,minX=12,maxX=Math.max(minX,vw-bw-12),minY=Math.max(16,Math.min(vh-100,(hud?.bottom||70)+12));
    const questionTop=question&&question.top>minY+bh+30?question.top-14:vh-12,maxY=Math.max(minY,Math.min(vh-bh-12,questionTop-bh));
    const midX=(minX+maxX)/2,midY=(minY+maxY)/2,rx=(maxX-minX)/2,ry=(maxY-minY)/2,phase=i/c.nodes.length*Math.PI*2;
    const points=Array.from({length:9},(_,j)=>{
     const angle=phase+j/8*Math.PI*2;
     let x=midX+rx*Math.cos(angle),y=midY+ry*Math.sin(angle),scale=.94;
     if(c.kind==='chaos_wind'){x=minX+(maxX-minX)*(.5+.5*Math.sin(angle));y=minY+(maxY-minY)*(.5+.5*Math.cos(angle*2+i));scale=.9;}
     if(c.kind==='gravity_well'){const pull=j%2?.18:.95;x=midX+rx*Math.cos(angle)*pull;y=midY+ry*Math.sin(angle)*pull;scale=j%2?.82:.98;}
     if(c.kind==='earthquake'){x=minX+(maxX-minX)*(.5+.5*Math.sin(angle*3+i));y=minY+(maxY-minY)*(.5+.5*Math.cos(angle*2));}
     if(c.kind==='berserk_roar'){const force=j%2?.95:.35;x=midX+rx*Math.cos(angle)*force;y=midY+ry*Math.sin(angle)*force;}
     return {transform:`translate(${Math.max(minX,Math.min(maxX,x))}px,${Math.max(minY,Math.min(maxY,y))}px) scale(${scale}) rotate(${Math.sin(angle)*2}deg)`,offset:j/8};
    });
    points[8]={...points[0],offset:1};const entry=initial?280:150;
    c.flyAnimations.push(node.animate([{transform:`translate(${current[i].x}px,${current[i].y}px)`},{transform:points[0].transform}],{duration:entry,easing:'cubic-bezier(.2,.7,.3,1)',fill:'forwards'}));
    const duration=c.kind==='chaos_wind'?({slow:4200,medium:3000,fast:2100}[spec.windSpeed]||3000):c.kind==='gravity_well'?2900:c.kind==='earthquake'?2500:3200;
    c.flyAnimations.push(node.animate(points,{duration,delay:entry,iterations:Infinity,easing:c.kind==='earthquake'?'steps(2,end)':'linear'}));
   });
  };
  c.flightResize=()=>{cancelAnimationFrame(c.flightFrame);c.flightFrame=requestAnimationFrame(()=>layout(false));};
  window.addEventListener('resize',c.flightResize);overlay.addEventListener('scroll',c.flightResize,{passive:true});layout(true);
  if(c.nodes.includes(focus))focus.focus({preventScroll:true});
 }
 function clearChallenge(){
  if(!context?.challenge)return;const c=context.challenge;context.challenge=null;
  for(const timer of c.timers)clear(context,timer);landChoices(c);
  c.nodes.forEach(node=>{node.classList.remove(...choiceClasses);node.removeAttribute('data-rfx-cover');node.style.removeProperty('--rfx-slot');node.style.removeProperty('--rfx-dir');});
  c.list.classList.remove('rfx-challenge-'+c.kind);c.list.style.removeProperty('--rfx-choice-cycle');c.hint.remove();
 }
 function shuffleChoices(c){
  if(WBR.answerPending||c.pressed||Date.now()<c.aimUntil)return;
  const nodes=[...c.list.children],focus=document.activeElement;
  for(let i=nodes.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[nodes[i],nodes[j]]=[nodes[j],nodes[i]];}
  if(nodes.every((node,i)=>node===c.list.children[i]))nodes.push(nodes.shift());
  nodes.forEach(node=>c.list.appendChild(node));
  if(focus?.isConnected&&c.list.contains(focus))focus.focus({preventScroll:true});
 }
 function challenge(kind,duration,spec={}){
  const s=scope();if(!s)return;clearChallenge();
  const list=document.getElementById('camp-options'),nodes=[...list?.querySelectorAll('button.camp-opt:not(:disabled)')||[]];
  if(WBR.answerPending||nodes.length<2)return;
  const hint=document.createElement('div');hint.id='rfx-challenge-hint';hint.setAttribute('role','status');hint.textContent=challenges[kind].hint;list.before(hint);
  const c={kind,list,nodes,hint,timers:[],aimUntil:0,revealed:new WeakMap()};s.ctx.challenge=c;list.classList.add('rfx-challenge-'+kind);list.style.setProperty('--rfx-choice-cycle',({slow:1.8,medium:1.25,fast:.9}[spec.windSpeed]||1.25)+'s');
  nodes.forEach((node,i)=>{node.classList.add('rfx-choice');node.style.setProperty('--rfx-slot',i);node.style.setProperty('--rfx-dir',i%2?1:-1);node.dataset.rfxCover=challenges[kind].cover||'';});
  const schedule=(fn,ms)=>c.timers.push(later(s.ctx,()=>{if(context?.challenge!==c)return;if(WBR.answerPending||!challengeAlive(c)){clearChallenge();return;}fn();},ms));
  function obscure(count){
   nodes.forEach(n=>n.classList.remove('rfx-obscured','rfx-meteor-mark'));
   const candidates=nodes.filter(n=>Date.now()-(c.revealed.get(n)||0)>1500&&n!==document.activeElement).sort(()=>Math.random()-.5);
   // Always leave at least one visible choice. Focused/recently revealed choices stay readable.
   candidates.slice(0,Math.min(count,nodes.length-1)).forEach(n=>n.classList.add('rfx-obscured'));
  }
  if(kind==='mirror_trick'){
   shuffleChoices(c);nodes.forEach(n=>n.classList.add('rfx-mirror-turn'));
   if(!media.matches)for(let t=1400;t<duration-400;t+=1400)schedule(()=>shuffleChoices(c),t);
  }else if(kind==='meteor_shower'){
   const strike=()=>{const target=nodes[Math.floor(Math.random()*nodes.length)];target.classList.add('rfx-meteor-mark');schedule(()=>{nodes.forEach(n=>n.classList.remove('rfx-obscured','rfx-meteor-mark'));if(Date.now()-(c.revealed.get(target)||0)>1500&&target!==document.activeElement)target.classList.add('rfx-obscured');},500);};
   strike();for(let t=1800;t<duration-800;t+=1800)schedule(strike,t);
  }else if(!['chaos_wind','gravity_well','phantom_orbit'].includes(kind)){
   const count=kind==='darkness'?nodes.length-1:['lightning_storm','void_lance'].includes(kind)?1:Math.max(1,Math.floor(nodes.length/2));obscure(count);
   for(let t=1900;t<duration-500;t+=1900)schedule(()=>obscure(count),t);
  }
  releaseChoices(c,spec);
  schedule(clearChallenge,duration);
 }
 // The first click on a concealed choice only reveals it; it never submits a blind answer.
 document.addEventListener('click',event=>{
  const c=context?.challenge,node=event.target.closest?.('.raid-battle button.rfx-choice');if(!c||!node||!c.nodes.includes(node))return;
  if(node.classList.contains('rfx-obscured')){event.preventDefault();event.stopImmediatePropagation();node.classList.remove('rfx-obscured','rfx-meteor-mark');if(c.kind==='glacial_prison'&&!media.matches){const r=node.getBoundingClientRect();effect('ice-shatter',Array.from({length:7},(_,i)=>`<i style="--x:${r.x+r.width/2}px;--y:${r.y+r.height/2}px;--angle:${i*51}deg"></i>`).join(''),650,'screen');}c.revealed.set(node,Date.now());c.aimUntil=Date.now()+800;c.hint.textContent='Choice revealed · tap again to answer.';node.focus({preventScroll:true});return;}
  clearChallenge();
 },true);
 document.addEventListener('pointerover',event=>{const c=context?.challenge,node=event.target.closest?.('.raid-battle button.rfx-choice');if(c&&node&&c.nodes.includes(node)&&!movingSkills.has(c.kind))node.classList.add('rfx-aimed');},true);
 document.addEventListener('pointerout',event=>{const node=event.target.closest?.('.raid-battle button.rfx-choice');if(node&&!node.contains(event.relatedTarget))node.classList.remove('rfx-aimed');},true);
 document.addEventListener('pointerdown',event=>{const c=context?.challenge,node=event.target.closest?.('.raid-battle button.rfx-choice');if(c&&node&&c.nodes.includes(node)){c.pressed=true;c.aimUntil=Date.now()+800;if(!movingSkills.has(c.kind))node.classList.add('rfx-aimed');}},true);
 document.addEventListener('pointerup',()=>{if(context?.challenge){context.challenge.pressed=false;context.challenge.aimUntil=Date.now()+800;}},true);
 document.addEventListener('pointercancel',()=>{if(context?.challenge)context.challenge.pressed=false;},true);
 // Foreground weather crosses the reading plane without intercepting clicks.
 // One bounded pressure state per skill; timers are cancelled on raid exit.
 function pressure(kind,duration){
  const s=scope();if(!s)return;s.ctx.pressures.add(kind);s.scene.classList.add('rfx-under-'+kind);
  later(s.ctx,()=>{s.ctx.pressures.delete(kind);s.scene.classList.remove('rfx-under-'+kind);},duration);
 }
 function impact(kind){
  const s=scope();if(!s||media.matches)return;
  effect('screen-impact rfx-impact-'+kind,'<i></i><b></b>'+Array.from({length:innerWidth<600?6:10},(_,i)=>`<em style="--i:${i};--angle:${i*36}deg"></em>`).join(''),950,'screen');
  s.scene.classList.remove('rfx-camera-impact');void s.scene.offsetWidth;s.scene.classList.add('rfx-camera-impact');
  if(s.ctx.cameraTimer)clear(s.ctx,s.ctx.cameraTimer);
  s.ctx.cameraTimer=later(s.ctx,()=>s.scene.classList.remove('rfx-camera-impact'),750);
 }
 function surge(kind,title,detail){
  const s=scope();if(!s||media.matches)return;
  s.ctx.screen.querySelectorAll('.rfx-surge').forEach(n=>n.remove());
  effect('surge rfx-surge-'+kind,`<i></i><div><small>${esc(detail)}</small><strong>${esc(title)}</strong><b></b></div>`,1900,'screen');impact(kind);
 }
 function perform(kind,spec,duration){
  const s=scope();if(!s)return;const quiet=media.matches,life=quiet?900:duration;
  pressure(kind,life);challenge(kind,duration,spec);
  if(['earthquake','berserk_roar','meteor_shower','lightning_storm','void_lance'].includes(kind))impact(kind);
  if(kind==='chaos_wind')effect('tempest',Array.from({length:innerWidth<600?8:14},(_,i)=>`<i style="--i:${i};--y:${6+i*7}%"></i>`).join(''),life,'screen');
  if(kind==='darkness')effect('blackout','<i></i><b></b>',life,'screen');
  if(kind==='mirror_trick')effect('glass-shards',Array.from({length:6},(_,i)=>`<i style="--i:${i};--x:${i*19}%"></i>`).join(''),life,'screen');
  if(kind==='berserk_roar')effect('sonic','<i></i><i></i><i></i>',life,'screen');
  if(kind==='meteor_shower')effect('barrage',Array.from({length:innerWidth<600?6:12},(_,i)=>`<i style="--i:${i};--x:${3+i*9}%"><b></b></i>`).join(''),life,'screen');
  if(kind==='gravity_well')effect('gravity-field','<i></i><b></b>',life,'screen');
  if(kind==='phantom_orbit')effect('phantom-field','<i></i><b></b>',life,'screen');
  if(kind==='lightning_storm')effect('storm-sky','<i></i><b></b>',life,'screen');
  if(kind==='glacial_prison')effect('frost-field','<i></i><b></b>',life,'screen');
  if(kind==='void_lance')effect('void-field','<i></i><i></i><i></i>',life,'screen');
  switch(kind){
   case 'gravity_well':effect('singularity','<i></i><b></b><em></em>',life);break;
   case 'phantom_orbit':effect('phantom-orbit',`<i>${artwork()}</i><i>${artwork()}</i><i>${artwork()}</i>`,life);break;
   case 'lightning_storm':effect('lightning',`<svg viewBox="0 0 600 360">${[0,1,2].map(i=>`<path style="--i:${i}" d="M${170+i*130} 0  ${140+i*130} 76 ${195+i*90} 120 300 180 ${235+i*60} 235 ${190+i*95} 340 M300 180 ${330+i*40} 220 ${355+i*50} 205"/>`).join('')}</svg>`,life);break;
   case 'glacial_prison':effect('ice-prison',Array.from({length:6},(_,i)=>`<i style="--i:${i};--x:${14+i*14}%"></i>`).join(''),life);break;
   case 'void_lance':effect('void-rays','<i></i><i></i><i></i><b></b>',life);break;

   case 'earthquake':effect('fracture',`<svg viewBox="0 0 700 240" preserveAspectRatio="none"><path d="m350 45-40 45 23 20-52 37 22 23-57 55M350 45l34 48-16 19 49 35-16 25 54 56M281 147l-48-18-35 13-53-23m272 28 46-16 32 15 60-25"/><path class="rfx-fracture-core" d="m350 45-40 45 23 20-52 37 22 23-57 55M350 45l34 48-16 19 49 35-16 25 54 56"/></svg>`,life);s.stage.classList.add('rfx-stomp');later(s.ctx,()=>s.stage.classList.remove('rfx-stomp'),600);break;
   case 'chaos_wind':effect('wind',`<svg viewBox="0 0 700 240" preserveAspectRatio="none">${[0,1,2,3].map(i=>`<path style="--i:${i}" d="M-60 ${60+i*35}Q110 ${-5+i*30} 310 ${55+i*28}T760 ${35+i*45}"/>`).join('')}</svg>`,life);break;
   case 'darkness':effect('eclipse','<i></i><b></b>',life,'arena');effect('umbra','<i></i><b></b>',life);break;
   case 'mirror_trick':effect('mirror',`<i class="rfx-mirror-left">${artwork()}</i><i class="rfx-mirror-right">${artwork()}</i><b></b>`,life);
    break;
   case 'berserk_roar':effect('roar','<i></i><i></i><i></i>',life);s.stage.classList.add('rfx-roar-source');later(s.ctx,()=>s.stage.classList.remove('rfx-roar-source'),650);break;
   case 'meteor_shower':effect('meteors',Array.from({length:innerWidth<600?5:9},(_,i)=>`<i style="--i:${i};--x:${8+i*10}%"></i>`).join(''),life,'arena');effect('meteor-impacts','<i></i><i></i><i></i>',life);break;
  }
 }
 function cast(index,kind,spec={}){
  const s=scope();if(!s||s.ctx.index!==index||!skills[kind])return false;
  // Duplicate signals do not restart a skill or accumulate extra particle layers.
  if(s.ctx.casts.has(kind))return true;
  const requested=Number(spec.durationSec),duration=Number.isFinite(requested)&&requested>0?Math.min(60000,Math.max(600,requested*1000)):2500;
  const meta=skills[kind],id=++serial,delay=media.matches?0:650;
  const el=document.createElement('div');el.id='rfx-cast-'+id;el.className='rfx-cast';el.setAttribute('role','status');el.title=spec.name||meta.name;el.style.setProperty('--rfx-tone',meta.tone);el.style.setProperty('--rfx-cast-time',delay+'ms');
  el.innerHTML=`${svg(kind)}<div><span class="rfx-cast-state">Preparing skill</span><strong>${esc(spec.name||meta.name)}</strong><small>${esc(meta.detail)}</small></div><i class="rfx-cast-charge"></i>`;
  const bar=document.getElementById('camp-enemy-bar');bar.querySelectorAll('.rfx-cast').forEach(n=>n.remove());bar.appendChild(el);s.ctx.casts.set(kind,el);
  effect('telegraph',`<i></i><b></b>${svg(kind)}`,Math.max(100,delay));
  if(typeof BVS!=='undefined')BVS.request('cast',delay+400);
  later(s.ctx,()=>{if(!el.isConnected&&context!==s.ctx)return;el.classList.add('is-cast');el.querySelector('.rfx-cast-state').textContent='Skill active';perform(kind,spec,duration);},delay);
  later(s.ctx,()=>{el.remove();s.ctx.casts.delete(kind);},delay+duration);
  return true;
 }
 function phase(index,number){const s=scope();if(!s||s.ctx.index!==index)return false;const p=wbpGetPhases(s.boss).find(p=>Number(p.phase)===Number(number))||wbpGetCurrentPhase(s.boss);s.ctx.phase=Number(number);s.scene.dataset.rfxPhase=String(number);announce('Phase '+number+' · '+(p.label||p.name),' '+(p.description||'The boss changes its stance.'),'phase',5000,number>=3?'#ff6252':number>=2?'#dec498':'#b6ceda');if(!media.matches){effect('phase-wave','<i></i><i></i>',1600);surge('phase','Phase '+number,p.label||p.name||'The battle escalates');}return true;}
 function rage(index,cfg,first=false){const s=scope();if(!s||s.ctx.index!==index)return false;const active=wbrageIsActive(s.boss);const entering=active&&!s.ctx.raging;s.ctx.raging=active;s.scene.classList.toggle('rfx-raging',active);
  const badge=document.getElementById('rfx-rage');badge.innerHTML=active?`${svg('rage')}<strong>Enraged</strong><span>Faster skills · stronger minion pressure</span>`:'';
  badge.hidden=!active;
  let aura=s.ctx.stage.querySelector('.rfx-rage-aura');if(active&&cfg.showAura!==false&&!aura){aura=document.createElement('div');aura.className='rfx-rage-aura';aura.innerHTML='<i></i><b></b>'+Array.from({length:8},(_,i)=>`<em style="--i:${i}"></em>`).join('');s.ctx.stage.appendChild(aura);}if(!active||cfg.showAura===false)aura?.remove();
  if(entering&&cfg.showBanner!==false)surge('rage','ENRAGED','The boss unleashes its full power');
  if(entering&&(cfg.showBanner!==false||cfg.showToast!==false))announce('Rage mode · '+s.boss.name,cfg.dialogue||'The boss draws on its last reserves. Minions are enraged.','rage',5500,'#ff5c50');
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
 function sync(index){const s=scope();if(!s||s.ctx.index!==index)return;if(s.ctx.challenge&&(WBR.answerPending||!challengeAlive(s.ctx.challenge)))clearChallenge();
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
 function stop(){if(!context)return;clearChallenge();document.querySelectorAll('.raid-battle .wbm-minion-alert').forEach(node=>node.classList.remove('rfx-minion-enraged','rfx-arrive-left','rfx-arrive-right','rfx-minion-defeat','rfx-minion-resist'));document.querySelectorAll('.rfx-minion-rage').forEach(node=>node.remove());for(const t of context.timers)clearTimeout(t);context.field?.remove();context.stage?.remove();context.screen?.remove();document.querySelectorAll('#rfx-state,#rfx-announcer,.rfx-cast,.rfx-health-echo').forEach(n=>n.remove());const scene=document.getElementById('camp-scene');scene?.classList.remove('rfx-ready','rfx-raging','rfx-reduced','rfx-player-ko');if(scene){delete scene.dataset.rfxPhase;scene.classList.remove('rfx-camera-impact');for(const kind of context.pressures)scene.classList.remove('rfx-under-'+kind);}document.getElementById('camp-enemy-sprite')?.classList.remove('rfx-impact','rfx-stomp','rfx-roar-source');context=null;}
 media.addEventListener('change',()=>{const index=context?.index;stop();if(index!=null&&open())sync(index);});
 window.RaidFX=Object.freeze({cast,phase,rage,sync,minions,minionHit,hit,stop});
})();
