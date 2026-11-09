/* Teacher-controlled recitation. Students participate face to face, without devices.
 * One authenticated controller; other teacher devices present the server snapshot.
 * Scan UUIDs survive reconnects. A pending scan never appears as confirmed. */
(function () {
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const uid=()=>crypto.randomUUID();
 const store={get(k,f){try{return JSON.parse(localStorage.getItem(k))??f;}catch{return f;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true;}catch{return false;}}};
 const device=store.get('eq-recitation-device',null)||uid();store.set('eq-recitation-device',device);
 let generation=0;
 let root=null,snap=null,role='display',classId='',poll=null,tick=null,abort=null,busy=false,syncing=false,offset=0,seen=new Map(),awardQueue=[],playing=false,recognitionTimer=null,queue=store.get('eq-recitation-pending',[]),mismatch=null,lastTag=new Map(),keyBuffer='',keyAt=0,keyTimer=null,lastFocus=null,lastManualAt=0;
 const button=(a,t,extra='')=>`<button type="button" data-rs="${a}" ${extra}>${t}</button>`;
 const state=()=>snap?.state||{};
 const current=()=>state().questions?.[state().index||0];
 const person=id=>snap?.roster.find(r=>r.id===id);
 const name=id=>person(id)?.name||'Student';
 const pending=()=>queue.filter(q=>q.session===snap?.session.id);
 const photo=r=>{
  const source=String(r?.photo||'').trim(),initials=esc(r?.init||r?.name?.split(' ').map(n=>n[0]).slice(0,2).join('')||'—');
  const safe=/^https?:\/\//i.test(source)||/^data:image\/(png|jpe?g|webp|gif|avif);base64,[a-z0-9+/=\s]+$/i.test(source)||/^\.?\.?\//.test(source);
  return `<span class="rs-photo-fallback">${initials}</span>`+(safe?`<img src="${esc(source)}" alt="" onerror="this.remove()">`:'');
 };
 const points=r=>Number(r.points)||1;
 const total=receipts=>receipts.reduce((sum,r)=>sum+points(r),0);
 const drawing=()=>!!(snap?.session.is_active&&state().draw&&new Date(state().draw.revealAt).getTime()>Date.now()+offset);
 function report(message){const n=root?.querySelector('#rs-message');if(n)n.textContent=message;}
 async function rpc(action,payload={}){
  const requestGeneration=generation;
  const {data,error}=await DBService.rpc('recitation_presentation',{p_class_id:classId,p_action:action,p_device:device,p_payload:{session:snap?.session.id,...payload}});
  if(requestGeneration!==generation||!root)throw Object.assign(new Error('Session view changed'),{stale:true});
  if(error)throw new Error(error.message||'Connection unavailable');
  if(!data?.session)throw new Error('No session returned');
  return data;
 }
 function adopt(data,initial=false){
  if(!root)return;
  // An older poll response must not roll back a newer control/award response.
  if(snap&&data.session.id===snap.session.id&&data.revision<snap.revision)return;
  snap=data;classId=data.session.class_id;
  if(!initial&&role==='remote'&&!data.controllerMine){role='display';stopNFC();build();report('Control moved to another device.');}
  offset=new Date(data.serverTime).getTime()-Date.now();
  for(const r of data.receipts){
   if(!initial&&seen.has(r.id)&&seen.get(r.id)!==r.undone&&r.undone)awardQueue.push({...r,undo:true});
   if(!initial&&!seen.has(r.id)&&!r.undone)awardQueue.push(r);
   seen.set(r.id,r.undone);
  }
  paintStage();paintStatus();updatePrivateNote();animateNext();
 }
 async function act(action,payload={}){
  if(busy)return;busy=true;paintStatus();
  try{const data=await rpc(action,payload);adopt(data);if(action==='manual'&&!data.receipt)throw new Error('Install phase82_recitation_spotlight.sql to enable manual awards.');if(data.emptyPool)report('No students match these filters. Adjust the filters; nothing was relaxed.');return data;}
  catch(e){if(!e.stale)report(friendly(e));return null;}
  finally{busy=false;paintStatus();}
 }
 function friendly(e){if(/Unknown recitation action/i.test(e.message))return 'Install phase82_recitation_spotlight.sql in Supabase to enable manual awards and shared calling animations.';return /recitation_presentation|schema cache|does not exist/i.test(e.message)?'Recitation Studio needs its Supabase migrations (phase81 and phase82) installed before it can connect.':e.message;}
 async function patch(values){return act('update',{revision:snap.revision,patch:values});}
 function connection(){return navigator.onLine?'Connected':role==='display'?'Offline · showing last confirmed state':'Offline · scans stay pending';}
 function paintStatus(){
  if(!root||!snap)return;
  const n=root.querySelector('#rs-status');if(n)n.textContent=`${connection()} · ${!snap.session.is_active?'Session ended':role==='display'?(navigator.onLine?'Presentation synced':'Reconnecting'):state().paused?'Scanner paused':abort?'NFC ready':'Reader ready'}${pending().length?' · '+pending().length+' pending':''}`;
  root.querySelectorAll('[data-controller]').forEach(n=>n.disabled=busy||drawing()||role!=='remote'||!snap.session.is_active);
  root.querySelector('#rs-role')?.replaceChildren(document.createTextNode(role==='remote'?'Teacher remote':'Classroom presentation'));
  const score=root.querySelector('#rs-live-summary');if(score)score.textContent=`${total(snap.receipts.filter(r=>!r.undone))} points · ${new Set(snap.receipts.filter(r=>!r.undone).map(r=>r.student_id)).size} contributors`;
  const last=[...snap.receipts].reverse().find(r=>!r.undone);const undo=root.querySelector('[data-rs="undo"]');if(undo){undo.disabled=busy||role!=='remote'||!last;undo.textContent=last?`Undo +${points(last)} · ${name(last.student_id)}`:'No award to undo';}
  const selected=root.querySelector('#rs-selected');if(selected)selected.textContent=drawing()?'Choosing a student…':state().selected?`Called: ${name(state().selected)}`:'No speaker selected';
  const waiting=root.querySelector('#rs-pending');if(waiting)waiting.innerHTML=queue.filter(q=>q.classId===classId).map(q=>`<div class="rs-pending-row"><span>${esc(q.label||'Card')} · ${esc(q.error||(q.session!==snap.session.id?'Previous session · waiting to reconcile':'Waiting to sync'))}</span>${button('discard','Discard',`data-id="${q.id}"`)}</div>`).join('');
  for(const id of ['rs-manual-student','rs-volunteer']){
   const select=root.querySelector('#'+id);if(!select)continue;
   const members=snap.roster.filter(r=>['Early','On Time','Late'].includes(r.status)),signature=JSON.stringify(members.map(r=>[r.id,r.name]));
   if(select.dataset.roster!==signature){const value=select.value;select.innerHTML=`<option value="">${id==='rs-volunteer'?'Choose a raised hand':'Choose a student'}</option>`+members.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');select.value=members.some(r=>r.id===value)?value:'';select.dataset.roster=signature;}
  }
  const later=root.querySelector('#rs-later-count');if(later)later.textContent=`${(state().later||[]).length} in return-later queue`;
  if(!snap.session.is_active)stopNFC();
 }
 let stageKey='',stagePhotos=[];
 const inertSiblings=new Map();
 function paintStage(){
  const target=root?.querySelector('#rs-stage');if(!target||!snap)return;
  const st=state(),q=current(),selected=person(st.selected),scope=st.scoreScope||'session';
  const oldSeat=[...target.querySelectorAll('.rs-seat')].find(n=>n.dataset.student===st.selected)?.getBoundingClientRect()||target.querySelector('.rs-draw-avatar')?.getBoundingClientRect();
  const scopeLabel={session:'this session',today:'today',period:'reporting period'}[scope];
  const sources=snap.roster.map(r=>r.photo),photosChanged=sources.length!==stagePhotos.length||sources.some((src,i)=>src!==stagePhotos[i]);
  const key=JSON.stringify([snap.revision,role,drawing()]);if(stageKey===key&&!photosChanged)return;stageKey=key;stagePhotos=sources;
  const question=`<div class="rs-question"><p class="rs-eyebrow">${q?'Question '+((st.index||0)+1)+' / '+st.questions.length:'Classroom recitation'}</p><h1>${esc(q?.text||'Every voice counts.')}</h1>${q?.image&&/^https?:\/\//i.test(q.image)?`<img class="rs-question-image" src="${esc(q.image)}" alt="Question illustration">`:''}</div>`;
  let body='';
  if(!snap.session.is_active){
   const awarded=snap.receipts.filter(r=>!r.undone),contributors=new Set(awarded.map(r=>r.student_id));
   body=`<div class="rs-summary"><p class="rs-eyebrow">Session complete</p><h1>Thank you for showing up.<br>And speaking up.</h1><div class="rs-summary-stats"><div><strong>${total(awarded)}</strong><span>recitation points</span></div><div><strong>${contributors.size}</strong><span>contributors</span></div><div><strong>${new Set([...(st.calls||[]).map(c=>c.question),...awarded.map(r=>r.question_index)]).size}</strong><span>questions discussed</span></div></div><p>Your confirmed points are saved to your recitation history.</p></div>`;
  }else if(drawing()){
   body=`<div class="rs-draw" data-draw="${esc(st.draw.id)}"><div class="rs-draw-question">${question}</div><div class="rs-draw-card"><p class="rs-eyebrow">Who will take the floor?</p><div class="rs-draw-avatar"></div><h2 class="rs-draw-name" aria-hidden="true"></h2><p class="rs-draw-caption" role="status">Choosing a student…</p><div class="rs-draw-track"><i></i></div></div></div>`;
  }else if(st.view==='seats'){
   const seated=snap.roster.filter(r=>(r.seats||[]).some(s=>s.layout===st.layout));
   const allSeats=seated.flatMap(r=>r.seats.filter(s=>s.layout===st.layout));
   const xs=allSeats.map(s=>Number(s.x)),ys=allSeats.map(s=>Number(s.y));
   const minX=Math.min(0,...xs),minY=Math.min(0,...ys),w=Math.max(...xs,0)-minX+130,h=Math.max(...ys,0)-minY+145;
   const seatCard=(r,seat)=>`<article class="rs-seat ${r.id===st.selected?'rs-seat-selected':''} ${['Early','On Time','Late'].includes(r.status)?'':'rs-seat-away'}" data-student="${esc(r.id)}" style="${seat?`left:${(Number(seat.x)-minX)/w*100}%;top:${(Number(seat.y)-minY)/h*100}%;width:${120/w*100}%;height:${135/h*100}%;`:''}"><div class="rs-seat-avatar">${photo(r)}<strong>${esc(r[scope]||0)}</strong></div><span>${esc(r.name)}</span></article>`;
   body=`<div class="rs-seat-heading"><span>${esc(q?.text||'Your classroom, together.')}</span><small>Recitation points · ${scopeLabel}</small></div>${seated.length?`<div class="rs-seat-room" style="aspect-ratio:${w}/${h};width:min(100%, calc(65vh * ${w/h}))">${seated.map(r=>seatCard(r,r.seats.find(s=>s.layout===st.layout))).join('')}</div>`:`<div class="rs-roster-grid">${snap.roster.map(r=>seatCard(r)).join('')}</div>`}${seated.length&&snap.roster.some(r=>!seated.includes(r))?`<div class="rs-unseated"><small>Additional students</small>${snap.roster.filter(r=>!seated.includes(r)).map(r=>`<span>${esc(r.name)} <b>${esc(r[scope]||0)}</b></span>`).join('')}</div>`:''}`;
  }else if(st.view==='spotlight'&&selected){
   const latestCall=[...(st.calls||[])].reverse().find(c=>c.student===selected.id);
   body=`<div class="rs-spotlight" data-call="${esc(latestCall?.at||'')}"><div class="rs-spot-question">${question}</div><div class="rs-speaker"><p class="rs-eyebrow">The floor is yours</p><div class="rs-speaker-avatar" data-student="${esc(selected.id)}">${photo(selected)}<strong>${esc(selected[scope]||0)}</strong></div><h2>${esc(selected.name)}</h2><p>Recitation points · ${scopeLabel}</p></div></div>`;
  }else body=question;
  target.innerHTML=`<div class="rs-stage-content">${body}</div><div id="rs-timer" class="rs-timer" aria-live="off"></div><div class="rs-stage-footer"><span>${esc(window.getClassLabel?window.getClassLabel(classId,AppStore.getState()):classId)}</span><span>${esc(scopeLabel)} · recitation</span></div>`;
  paintTimer();paintDraw();
  const avatar=target.querySelector('.rs-speaker-avatar');if(oldSeat&&avatar&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
   const to=avatar.getBoundingClientRect();avatar.animate([{transform:`translate(${oldSeat.x+oldSeat.width/2-to.x-to.width/2}px,${oldSeat.y+oldSeat.height/2-to.y-to.height/2}px) scale(${Math.min(oldSeat.width/to.width,1)})`,opacity:.35},{transform:'translate(0,0) scale(1)',opacity:1}],{duration:700,easing:'cubic-bezier(.15,.8,.2,1)'});
  }
 }
 function paintDraw(){
  const card=root?.querySelector('.rs-draw');if(!card||!drawing())return;
  const draw=state().draw,elapsed=Math.max(0,Date.now()+offset-new Date(draw.startedAt).getTime()),ids=draw.candidates||[];
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const step=Math.floor(12*Math.log1p(elapsed/600));
  const candidate=person(ids[step%Math.max(ids.length,1)]);
  const avatar=card.querySelector('.rs-draw-avatar'),label=card.querySelector('.rs-draw-name');
  if(!reduced&&candidate&&avatar.dataset.student!==candidate.id){avatar.innerHTML=photo(candidate);avatar.dataset.student=candidate.id;label.textContent=candidate.name;}
  if(reduced){avatar.innerHTML='<span aria-hidden="true">?</span>';label.textContent='Your next speaker';}
  card.querySelector('.rs-draw-track i').style.width=(reduced?100:Math.min(100,elapsed/2400*100))+'%';
 }
 function paintTimer(){
  if(root?.querySelector('.rs-draw')&&!drawing()){stageKey='';paintStage();paintStatus();poolCount();animateNext();return;}
  paintDraw();
  const n=root?.querySelector('#rs-timer'),t=state().timer;if(!n)return;
  const seconds=t?.paused?Number(t.remaining):Math.max(0,Math.ceil((new Date(t?.endsAt).getTime()-(Date.now()+offset))/1000));
  n.hidden=!t||!snap?.session.is_active;
  n.textContent=t?(t.paused?seconds+'s · paused':seconds>0?seconds+'s · think it through':'Thinking time complete'):'';
 }
 function animateNext(){
  if(playing||drawing()||!awardQueue.length||!root)return;
  const r=awardQueue.shift(),student=person(r.student_id);if(!student)return animateNext();
  playing=true;const layer=root.querySelector('#rs-recognition');
  layer.innerHTML=`<div class="rs-recognition-card ${r.undo?'rs-corrected':''}" role="status"><div class="rs-recognition-avatar">${photo(student)}<strong>${r.undo?'−':'+'}${points(r)}</strong></div><div><p>${r.undo?'Score corrected':'Answer recognised'}</p><h2>${esc(student.name)}</h2><span>${esc(student[state().scoreScope||'session']||0)} points · ${{session:'this session',today:'today',period:'reporting period'}[state().scoreScope||'session']}</span></div></div>`;
  recognitionTimer=setTimeout(()=>{if(layer.isConnected){flyToScore(r,layer);layer.innerHTML='';}playing=false;animateNext();},1800);
 }
 function flyToScore(receipt,layer){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const target=[...root.querySelectorAll('[data-student]')].find(n=>n.dataset.student===receipt.student_id);
  const source=layer.querySelector('.rs-recognition-avatar');if(!target||!source)return;
  const a=source.getBoundingClientRect(),b=target.getBoundingClientRect(),spark=document.createElement('span');
  spark.className='rs-score-flight';spark.textContent=(receipt.undo?'−':'+')+points(receipt);spark.style.cssText=`left:${a.x+a.width/2}px;top:${a.y+a.height/2}px`;root.append(spark);
  const animation=spark.animate([{transform:'translate(-50%,-50%) scale(1)',opacity:1},{transform:`translate(${b.x+b.width/2-a.x-a.width/2}px,${b.y+b.height/2-a.y-a.height/2}px) scale(.4)`,opacity:0}],{duration:550,easing:'cubic-bezier(.2,.7,.2,1)'});
  animation.onfinish=()=>{spark.remove();target.classList.add('rs-score-confirmed');setTimeout(()=>target.classList.remove('rs-score-confirmed'),600);};
 }
 function build(){
  root.innerHTML=`<header class="rs-header"><div><p class="rs-eyebrow" id="rs-role"></p><strong>Recitation Studio</strong></div><div class="rs-header-actions"><span id="rs-status" role="status"></span>${button('fullscreen','Full screen')}${button('switch',role==='remote'?'Preview presentation':'Remote controls')}${button('close','Close','aria-label="Close Recitation Studio"')}</div></header>
   <main class="rs-workspace ${role==='display'?'rs-display':''}"><section id="rs-stage" class="rs-stage" aria-label="Classroom presentation"></section>${role==='remote'?`<aside class="rs-remote"><div class="rs-remote-tabs" role="tablist" aria-label="Remote tools">${['live','questions','filters','connect'].map((t,i)=>button('tab',t[0].toUpperCase()+t.slice(1),`role="tab" aria-selected="${i===0}" data-tab="${t}"`)).join('')}</div>
   <section class="rs-tab" data-panel="live"><p class="rs-eyebrow">Face-to-face participation</p><h2 id="rs-selected">No speaker selected</h2><div class="rs-actions">${button('pick','Call a student','class="rs-primary" data-controller')}${button('later','Return later','data-controller')}</div><label>Volunteer<select id="rs-volunteer"><option value="">Choose a raised hand</option>${snap.roster.filter(r=>['Early','On Time','Late'].includes(r.status)).map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></label>${button('volunteer','Give this student the floor','data-controller')}<label>Calling preset<select id="rs-preset"><option value="everyone">Everyone present</option><option value="fresh">Fresh voices · not called this session</option><option value="opportunities">Fewer speaking opportunities</option><option value="low">Lower recitation score</option><option value="later">Return-later queue</option></select></label><small id="rs-later-count"></small><div class="rs-rule"></div><label>Scanner mode<select id="rs-scanner"><option value="open">Open · award any present student</option><option value="selected">Selected speaker · check card identity</option></select></label><div class="rs-actions">${button('nfc','Enable phone NFC','data-controller')}${button('pause','Pause scans','data-controller')}</div><form id="rs-card-form"><label>External reader / card ID<input id="rs-card" autocomplete="off" placeholder="Tap card or enter ID" aria-label="Card ID"></label><button type="submit" data-controller>Record +1</button></form><small>Keyboard readers work while the studio is open. NFC requires a compatible Android browser and readable NFC cards.</small><div id="rs-mismatch"></div><div class="rs-rule"></div><details class="rs-manual"><summary>No card? Give points manually</summary><form id="rs-manual-form"><label>Student<select id="rs-manual-student" required><option value="">Choose a student</option>${snap.roster.filter(r=>['Early','On Time','Late'].includes(r.status)).map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></label>${button('manual-called','Use called student','data-controller')}<div class="rs-manual-fields"><label>Points<input id="rs-manual-points" type="number" min="1" max="10" step="1" value="1" required></label><label>Private note (optional)<input id="rs-manual-note" maxlength="300" placeholder="e.g. Explained their reasoning"></label></div><button type="submit" data-controller>Award points</button><small>Only present students. Uses the same rewards and undo as a card tap.</small></form></details><div class="rs-rule"></div><div class="rs-actions">${button('undo','Undo last point')}${button('finish','Finish session','data-controller')}</div><p id="rs-live-summary"></p><div id="rs-pending"></div></section>
   <section class="rs-tab" data-panel="questions" hidden><h2>Question stage</h2><div class="rs-actions">${button('prev','← Previous','data-controller')}${button('next','Next →','data-controller')}</div><label>Presentation mode<select id="rs-view"><option value="question">Question focus</option><option value="seats">Seating and scores</option><option value="spotlight">Speaker spotlight</option></select></label><label>Seating layout<select id="rs-layout"></select></label><label>Show score totals<select id="rs-scope"><option value="session">This session</option><option value="today">Today</option><option value="period">Reporting period</option></select></label><label>Reporting period starts<input type="date" id="rs-period"></label><div class="rs-rule"></div><h3>Thinking time</h3><div class="rs-actions">${[10,20,30].map(s=>button('timer',s+'s',`data-seconds="${s}" data-controller`)).join('')}${button('timer-pause','Pause','data-controller')}${button('timer-resume','Resume','data-controller')}${button('timer-extend','+10s','data-controller')}</div><small>The timer never calls a student automatically.</small><div class="rs-rule"></div><label>Import a quiz<select id="rs-quiz"><option value="">Choose a question set</option></select></label>${button('import','Import questions','data-controller')}<label>Questions · one per line<textarea id="rs-questions" rows="5" placeholder="What did you notice? | Private answer note"></textarea></label><small>Add | followed by a private answer note. Notes never appear on the presentation.</small>${button('save-questions','Save question deck','data-controller')}<label>Image URL for current question<input type="url" id="rs-image" placeholder="https://…"></label>${button('image','Save question image','data-controller')}<div id="rs-answer-note" class="rs-answer-note"></div></section>
   <section class="rs-tab" data-panel="filters" hidden><h2>Who can be called?</h2><p>Only students marked Early, On Time or Late are eligible, including students without seats.</p><label>Exclude recent picks<select id="rs-recent"><option value="0">None</option><option value="2">Last 2</option><option value="3">Last 3</option><option value="5">Last 5</option></select></label><label>No repeats<select id="rs-repeat"><option value="question">Within this question</option><option value="session">Within this session</option><option value="off">Allow repeats</option></select></label><label>Lower-score period<select id="rs-filter-scope"><option value="session">This session</option><option value="today">Today</option><option value="period">Reporting period</option></select></label><label>Seat group<select id="rs-seat-group"><option value="">All students</option></select></label><p>Or select students below to make a temporary group. Leave the group empty to include everyone.</p><div class="rs-filter-roster" id="rs-filter-roster"></div><div class="rs-actions">${button('save-filters','Apply filters','data-controller')}${button('clear-filters','Reset filters','data-controller')}</div><p id="rs-pool"></p></section>
   <section class="rs-tab" data-panel="connect" hidden><h2>Pair the presentation</h2><p>Open Live Monitor → Recitation Studio on the classroom computer, choose Join presentation and enter:</p><strong class="rs-code">${esc(snap.code)}</strong><p>Both devices must be signed in as staff for this class. Students do not need a device.</p>${button('display-tab','Open presentation in new tab')}${button('takeover','Take control on this phone')}<label><input type="checkbox" id="rs-vibration" ${store.get('eq-recitation-vibration',true)?'checked':''}> Vibrate on confirmed scan</label><p>Phone and presentation need internet for live updates. Offline scans remain pending on this phone until confirmed. Keep this browser open for NFC scanning.</p><p>Web NFC cannot read 125 kHz RFID cards. Use a compatible external reader or enter the card ID.</p></section>
   <div class="rs-message" id="rs-message" role="status" aria-live="polite"></div></aside>`:''}</main><div id="rs-recognition" class="rs-recognition" aria-live="polite"></div>`;
  root.onclick=click;root.onchange=change;root.onkeydown=e=>{if(e.key!=='Tab')return;const nodes=[...root.querySelectorAll('button,input,select,textarea')].filter(n=>!n.disabled&&n.getClientRects().length);if(!nodes.length)return;if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0].focus();}};
  root.querySelector('#rs-card-form')?.addEventListener('submit',e=>{e.preventDefault();const input=root.querySelector('#rs-card');if(input.value.trim()){ingest(input.value.trim());input.value='';}});
  root.querySelector('#rs-manual-form')?.addEventListener('submit',manualAward);
  hydrate();stageKey='';paintStage();paintStatus();
 }
 function hydrate(){
  if(role!=='remote')return;
  const st=state(),f=st.filters;
  const set=(id,v)=>{const n=root.querySelector('#rs-'+id);if(n)n.value=v??'';};
  set('preset',f.preset);set('scanner',st.scanner);set('view',st.view);set('scope',st.scoreScope);set('period',st.periodStart?.slice(0,10));set('recent',f.recent);set('repeat',f.repeat);set('filter-scope',f.scope);set('questions',(st.questions||[]).map(q=>q.text+(q.note?' | '+q.note:'')).join('\n'));set('image',current()?.image);
  const layouts=(AppStore.getState().classroomLayouts||[]).filter(l=>l.classId===classId);
  root.querySelector('#rs-layout').innerHTML='<option value="">Roster view</option>'+layouts.map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');set('layout',st.layout);
  const quizzes=(AppStore.getState().quizzes||[]).filter(q=>!q.classId||q.classId===classId);
  root.querySelector('#rs-quiz').innerHTML='<option value="">Choose a question set</option>'+quizzes.map(q=>`<option value="${esc(q.id)}">${esc(q.title)}</option>`).join('');
  root.querySelector('#rs-filter-roster').innerHTML=snap.roster.map(r=>`<div><span>${esc(r.name)}<small>${esc(r.status||'Not marked present')}</small></span><label><input type="checkbox" data-group="${esc(r.id)}" ${(f.selected||[]).includes(r.id)?'checked':''}> Group</label><label><input type="checkbox" data-exclude="${esc(r.id)}" ${(f.excluded||[]).includes(r.id)?'checked':''}> Skip</label></div>`).join('');
  const seats=snap.roster.flatMap(r=>r.seats.filter(s=>s.layout===st.layout).map(s=>({...s,student:r.id}))),groups=new Map();
  for(const [axis,label] of [['y','Row'],['x','Column']])for(const v of [...new Set(seats.map(s=>Number(s[axis])))].sort((a,b)=>a-b)){const ids=seats.filter(s=>Number(s[axis])===v).map(s=>s.student);groups.set(label+' '+([...new Set(seats.map(s=>Number(s[axis])))].sort((a,b)=>a-b).indexOf(v)+1),ids);}
  const selector=root.querySelector('#rs-seat-group');selector.innerHTML='<option value="">All students</option>'+[...groups].map(([label,ids])=>`<option value="${esc(JSON.stringify(ids))}">${esc(label)}</option>`).join('');
  updatePrivateNote();poolCount();
 }
 function updatePrivateNote(){const n=root?.querySelector('#rs-answer-note');if(n)n.textContent=current()?.note?'Private note: '+current().note:'No private answer note for this question.';}
 function eligible(){
  const f=state().filters,calls=state().calls||[],idx=state().index||0,recent=calls.slice(-Number(f.recent||0)).map(c=>c.student);
  let candidates=snap.roster.filter(r=>['Early','On Time','Late'].includes(r.status)&&!(f.excluded||[]).includes(r.id)&&(!f.recent||!recent.includes(r.id))&&(!(f.selected||[]).length||f.selected.includes(r.id))&&(f.repeat==='off'||!calls.some(c=>c.student===r.id&&(f.repeat==='session'||c.question===idx)))&&(f.preset!=='fresh'||!calls.some(c=>c.student===r.id))&&(f.preset!=='later'||(state().later||[]).includes(r.id)));
  if(f.preset==='low'){const min=Math.min(...candidates.map(r=>Number(r[f.scope||'session']||0)));candidates=candidates.filter(r=>Number(r[f.scope||'session']||0)===min);}
  if(f.preset==='opportunities'){const counts=r=>calls.filter(c=>c.student===r.id).length,min=Math.min(...candidates.map(counts));candidates=candidates.filter(r=>counts(r)===min);}
  return candidates;
 }
 function poolCount(){const n=root?.querySelector('#rs-pool');if(n)n.textContent=`${eligible().length} students currently eligible. Picking never awards points.`;const pick=root?.querySelector('[data-rs="pick"]');if(pick)pick.textContent=`Call a student · ${eligible().length} eligible`;}
 async function click(e){
  const b=e.target.closest('[data-rs]');if(!b||b.disabled)return;const a=b.dataset.rs;
  if(a==='close')return close();
  if(a==='tab'){root.querySelectorAll('[data-panel]').forEach(n=>n.hidden=n.dataset.panel!==b.dataset.tab);root.querySelectorAll('[role="tab"]').forEach(n=>n.setAttribute('aria-selected',n===b));return;}
  if(a==='fullscreen'){try{if(document.fullscreenElement)await document.exitFullscreen();else await root.requestFullscreen();}catch{report('Use your browser’s full-screen option.');}return;}
  if(a==='switch'){
   if(role==='remote'){stopNFC();role='display';build();}
   else {if(snap.controllerActive&&!snap.controllerMine&&!confirm('Move remote control to this device? The other phone will become a display.'))return;const data=await act('claim',{takeover:true});if(data){role='remote';build();}}
   return;
  }
  if(a==='takeover'){if(confirm('Move control to this phone? The other device will become a display.')){const data=await act('claim',{takeover:true});if(data){role='remote';build();}}return;}
  if(a==='display-tab'){const url=new URL(location.href);url.searchParams.set('recitation',snap.code);window.open(url.href,'_blank','noopener');return;}
  if(a==='nfc')return abort?stopNFC():startNFC();
  if(a==='manual-called'){if(!state().selected)return report('Call a student first, or choose one from the list.');root.querySelector('#rs-manual-student').value=state().selected;return;}
  if(a==='volunteer'){const student=root.querySelector('#rs-volunteer').value;if(!student)return report('Choose the student who volunteered.');await act('select',{student});poolCount();return;}
  if(a==='pick'||a==='later'){await act(a);poolCount();return;}
  if(a==='pause'){await patch({paused:!state().paused});b.textContent=state().paused?'Resume scans':'Pause scans';return;}
  if(a==='undo'){const last=[...snap.receipts].reverse().find(r=>!r.undone);if(last){await act('undo',{id:last.id});await window.LearningRewards?.refreshStudent(last.student_id);}return;}
  if(a==='finish'){
   if(pending().length){report('Sync or discard the pending awards before finishing.');return;}
   if(confirm('Finish this session and show the classroom summary?')){await act('finish');stopNFC();}return;
  }
  if(a==='prev'||a==='next'){const next=(state().index||0)+(a==='next'?1:-1);if(next>=0&&next<(state().questions||[]).length){await patch({index:next,view:'question'});updatePrivateNote();poolCount();}return;}
  if(a==='timer')return act('timer',{seconds:Number(b.dataset.seconds)});
  if(a.startsWith('timer-'))return act('timer',{mode:a.slice(6)});
  if(a==='save-questions'){
   const questions=root.querySelector('#rs-questions').value.split('\n').filter(s=>s.trim()).map((line,i)=>{const [text,...note]=line.split('|');return {text:text.trim(),note:note.join('|').trim(),image:state().questions?.[i]?.image||''};});
   await patch({questions,index:0});updatePrivateNote();return;
  }
  if(a==='import'){
   const quiz=(AppStore.getState().quizzes||[]).find(q=>q.id===root.querySelector('#rs-quiz').value);if(!quiz)return report('Choose a quiz first.');
   const questions=(quiz.questions||[]).slice(0,100).map(q=>({text:q.text||q.question||q.q||'',image:q.image||q.imageUrl||'',note:q.pairs?.map(p=>p.left+' → '+p.right).join('; ')||q.answers?.join('; ')||q.opts?.[q.answer]||q.options?.[q.correct]||String(q.answer??'')}));await patch({questions,index:0});hydrate();return;
  }
  if(a==='image'){const questions=[...(state().questions||[])],i=state().index||0,url=root.querySelector('#rs-image').value.trim();if(!questions[i])return report('Add a question first.');if(url&&!/^https?:\/\//i.test(url))return report('Use an https image URL.');questions[i]={...questions[i],image:url};return patch({questions});}
  if(a==='save-filters'){
   const checked=attr=>[...root.querySelectorAll(`[data-${attr}]:checked`)].map(n=>n.dataset[attr]);
   await patch({filters:{...state().filters,recent:Number(root.querySelector('#rs-recent').value),repeat:root.querySelector('#rs-repeat').value,scope:root.querySelector('#rs-filter-scope').value,selected:checked('group'),excluded:checked('exclude')}});poolCount();return;
  }
  if(a==='clear-filters'){await patch({filters:{preset:'everyone',recent:2,repeat:'question',scope:'session',selected:[],excluded:[]}});hydrate();return;}
  if(a==='discard'){queue=queue.filter(q=>q.id!==b.dataset.id);persistQueue();paintStatus();return;}
  if(a==='mismatch-keep'){const id=mismatch?.id;queue=queue.filter(q=>q.id!==id);mismatch=null;persistQueue();root.querySelector('#rs-mismatch').innerHTML='';paintStatus();return;}
  if(a==='mismatch-award'){const item=queue.find(q=>q.id===mismatch?.id);if(item){item.override=true;item.error=null;mismatch=null;root.querySelector('#rs-mismatch').innerHTML='';persistQueue();await flush();}return;}
 }
 async function change(e){const id=e.target.id,v=e.target.value;
  if(id==='rs-preset'){await patch({filters:{...state().filters,preset:v}});poolCount();}
  if(id==='rs-scanner')await patch({scanner:v});
  if(id==='rs-view')await patch({view:v});
  if(id==='rs-layout'){await patch({layout:v});hydrate();}
  if(id==='rs-scope'){if(v==='period'&&!state().periodStart){report('Choose a reporting period start date first.');e.target.value=state().scoreScope;return;}await patch({scoreScope:v});}
  if(id==='rs-period'&&v)await patch({periodStart:new Date(v+'T00:00:00+08:00').toISOString()});
  if(id==='rs-seat-group'){const ids=v?JSON.parse(v):[];root.querySelectorAll('[data-group]').forEach(n=>n.checked=ids.includes(n.dataset.group));}
  if(id==='rs-vibration')store.set('eq-recitation-vibration',e.target.checked);
 }
 function persistQueue(){return store.set('eq-recitation-pending',queue);}
 async function ingest(raw){
  if(role!=='remote'||!snap?.session.is_active||state().paused)return report('Scanner paused. No point recorded.');
  const tag=String(raw).trim().replace(/[^a-zA-Z0-9]/g,'').toLowerCase();if(!tag)return;
  if(Date.now()-(lastTag.get(tag)||0)<5000)return report('Card just read. Wait five seconds before another award.');
  lastTag.set(tag,Date.now());
  const item={id:uid(),tag,session:snap.session.id,classId,question:state().index||0,questionText:current()?.text||'',createdAt:Date.now(),label:'Card …'+tag.slice(-4)};
  queue.push(item);if(!persistQueue()){queue.pop();return report('Phone storage is unavailable. No scan sent; enable browser storage and scan again.');}
  report(navigator.onLine?'Reading card…':'Offline. Card saved as pending; no point confirmed yet.');paintStatus();await flush();
 }
 async function manualAward(e){
  e.preventDefault();if(Date.now()-lastManualAt<1000)return;if(busy||syncing||drawing()||role!=='remote'||!snap?.session.is_active)return;
  const student=root.querySelector('#rs-manual-student').value,amount=Number(root.querySelector('#rs-manual-points').value),note=root.querySelector('#rs-manual-note').value.trim();
  if(!person(student)||!Number.isInteger(amount)||amount<1||amount>10)return report('Choose a present student and 1–10 whole points.');
  if(pending().some(q=>q.kind==='manual'&&q.student===student&&q.question===(state().index||0)))return report('An award for this student is already pending. Sync or discard it first.');
  lastManualAt=Date.now();
  const item={id:uid(),kind:'manual',student,points:amount,note,session:snap.session.id,classId,question:state().index||0,questionText:current()?.text||'',createdAt:Date.now(),label:`Manual +${amount} · ${name(student)}`};
  queue.push(item);if(!persistQueue()){queue.pop();return report('Phone storage unavailable. No points sent.');}
  report(navigator.onLine?'Saving manual award…':'Manual award saved as pending. No point confirmed yet.');paintStatus();await flush();
 }
 async function flush(){
  if(syncing||drawing()||role!=='remote'||!navigator.onLine||!root||!snap)return;syncing=true;
  try{for(const item of queue.filter(q=>q.classId===classId)){
   if(item.error)continue;
   try{
    const data=await rpc(item.kind==='manual'?'manual':'scan',{student:item.student,points:item.points,note:item.note,session:item.session,id:item.id,tag:item.tag,question:item.question,questionText:item.questionText,override:!!item.override});if(data.session.id===snap.session.id)adopt(data);
    if(item.kind==='manual'&&!data.receipt)throw new Error('Install phase82_recitation_spotlight.sql to enable manual awards.');
    if(data.mismatch){mismatch=item;item.error='Different card — teacher decision needed';persistQueue();root.querySelector('#rs-mismatch').innerHTML=`<div class="rs-warning"><strong>${esc(name(data.scannedStudent))} tapped.</strong><p>The called speaker is ${esc(name(state().selected))}. No point has been recorded.</p>${button('mismatch-award','Award the student who tapped')}${button('mismatch-keep','Keep waiting for called speaker')}</div>`;break;}
    queue=queue.filter(q=>q.id!==item.id);persistQueue();report(data.receipt?.undone?'This scan was already corrected.':'Confirmed +'+points(data.receipt)+' · '+name(data.receipt?.student_id));
    if(!data.duplicate&&store.get('eq-recitation-vibration',true))navigator.vibrate?.([45,35,70]);
    if(data.receipt)window.LearningRewards?.refreshStudent(data.receipt.student_id);
   }catch(e){
    if(e.stale)break;
    const message=friendly(e);if(/fetch|network|connection|timeout|offline/i.test(message)){report('Connection interrupted. Award stays pending and will retry safely.');break;}
    item.error=message;persistQueue();report(message);
   }
  }}finally{syncing=false;paintStatus();poolCount();}
 }
 async function startNFC(){
  if(!('NDEFReader' in window))return report('Phone NFC is unavailable here. Use a compatible Android Chrome browser, an external reader, or the card ID field.');
  const controller=new AbortController();abort=controller;try{const reader=new NDEFReader();await reader.scan({signal:controller.signal});if(abort!==controller||!root){controller.abort();return;}reader.onreading=e=>{if(abort!==controller||!root)return;if(e.serialNumber)ingest(e.serialNumber);else report('No card serial received. Use an external reader for this card.');};reader.onreadingerror=()=>report('Could not read that card. Hold it still and try again.');report('NFC ready. Keep this page open while students tap.');paintStatus();}
  catch(e){if(abort!==controller)return;stopNFC();report('NFC could not start: '+e.message);}
 }
 function stopNFC(){const wasActive=!!abort;abort?.abort();abort=null;if(wasActive)paintStatus();}
 function keyScan(e){
  if(!root||role!=='remote'||!snap?.session.is_active||state().paused||e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,textarea,select,[contenteditable]'))return;
  if(e.key==='Enter'){if(keyBuffer.length>2){e.preventDefault();ingest(keyBuffer);}keyBuffer='';return;}
  if(e.key.length!==1)return;
  if(Date.now()-keyAt>100)keyBuffer='';keyAt=Date.now();keyBuffer+=e.key;
  clearTimeout(keyTimer);keyTimer=setTimeout(()=>{if(keyBuffer.length>2)ingest(keyBuffer);keyBuffer='';},140);
 }
 async function refresh(){if(!root||!snap)return;try{const data=await rpc('snapshot');adopt(data);poolCount();await flush();}catch(e){if(e.stale)return;report(friendly(e));const status=root?.querySelector('#rs-status');if(status)status.textContent='Reconnecting · unconfirmed cards stay pending';}}
 function close(){generation++;clearTimeout(recognitionTimer);playing=false;busy=false;clearInterval(poll);clearInterval(tick);clearTimeout(keyTimer);keyBuffer='';poll=tick=null;stopNFC();document.removeEventListener('keydown',keyScan,true);root?.remove();for(const [n,value] of inertSiblings)n.inert=value;inertSiblings.clear();root=null;snap=null;awardQueue=[];seen.clear();stageKey='';stagePhotos=[];document.body.classList.remove('rs-open');lastFocus?.focus?.();}
 async function open(options={}){
  if(root)close();generation++;window._lmStopWebNfcCapture?.();lastFocus=document.activeElement;classId=options.classId||document.querySelector('#lm-class-select')?.value||window.ActiveSection?.get?.()||'default-class';role=options.role||'remote';
  root=document.createElement('div');root.className='rs-app';root.setAttribute('role','dialog');root.setAttribute('aria-label','Recitation Studio');root.setAttribute('aria-modal','true');for(const n of document.body.children){if(n.tagName!=='SCRIPT'&&n.tagName!=='STYLE'){inertSiblings.set(n,n.inert);n.inert=true;}}document.body.append(root);document.body.classList.add('rs-open');
  root.innerHTML=`<div class="rs-setup"><p class="rs-eyebrow">Teach from anywhere in the room</p><h1>One classroom.<br>Every voice.</h1><p>Use your phone as the scanner and remote. Keep questions and confirmed scores on the classroom screen.</p><div class="rs-actions">${button('host','Start / resume on this phone','class="rs-primary"')}${button('close','Close')}</div><form id="rs-join"><label>Join an existing presentation<input name="code" maxlength="8" placeholder="8-character pairing code" autocomplete="off" required></label><button>Join presentation</button></form><p id="rs-message" role="status"></p></div>`;
  const connect=async(code)=>{
   try{
    const data=await rpc(code?'join':'start',code?{code}:{});adopt(data,true);
    if(!code&&(!data.controllerActive||data.controllerMine)){const claimed=await rpc('claim');adopt(claimed,true);role='remote';}else role='display';
    build();root.querySelector('button')?.focus();document.addEventListener('keydown',keyScan,true);poll=setInterval(refresh,1200);tick=setInterval(paintTimer,250);for(const q of queue)if(q.error==='Different card — teacher decision needed')q.error=null;persistQueue();flush();
   }catch(e){if(!e.stale)report(friendly(e));}
  };
  root.onclick=e=>{const a=e.target.closest('[data-rs]')?.dataset.rs;if(a==='close')close();if(a==='host')connect();};
  root.querySelector('#rs-join').onsubmit=e=>{e.preventDefault();connect(new FormData(e.target).get('code'));};
  if(options.code)await connect(options.code);
 }
 window.RecitationStudio={open,close,ingest,eligible};
 window.addEventListener('online',()=>{paintStatus();refresh();});window.addEventListener('offline',paintStatus);
 // A paired presentation URL opens only after authenticated staff state is available.
 const code=new URL(location.href).searchParams.get('recitation');if(code){const auto=setInterval(()=>{if(typeof currentRole!=='undefined'&&['admin','teacher'].includes(currentRole)&&typeof currentUser!=='undefined'&&currentUser){clearInterval(auto);open({code,role:'display'});}},750);setTimeout(()=>clearInterval(auto),120000);}
})();
