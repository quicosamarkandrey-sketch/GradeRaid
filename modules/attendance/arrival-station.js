/* Dedicated reader station. One durable FIFO scan queue; only server-confirmed
 * arrivals are celebrated. Staff review is separate from the public display. */
(function(){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const id=()=>crypto.randomUUID();
 const memory={get(k,f){try{return JSON.parse(localStorage.getItem(k))??f;}catch{return f;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true;}catch{return false;}}};
 const svg=(type)=>{const paths={card:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/>',check:'<path d="m5 12 4 4L19 6"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',sound:'<path d="m11 5-6 4H2v6h3l6 4zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>'};return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[type]||paths.card}</svg>`;};
 const button=(action,text,attrs='')=>`<button type="button" data-as="${action}" ${attrs}>${text}</button>`;
 const here=status=>['Early','On Time','Late'].includes(status);
 const reasonLabels={unknown_card:'Card not registered',wrong_section:'Card belongs to another section',review_time:'Delayed scan / arrival time needs review',existing_exception:'An absent or excused entry already exists',no_schedule:'No attendance schedule',no_class_today:'No class scheduled today',not_open:'Tapped before opening',closed:'Tapped after the window closed',finalized:'Attendance already finalized'};
 let root=null,classId='',owner='',snapshot=null,generation=0,poll=null,tick=null,captureTimer=null,displayTimer=null,staffTimer=null,nfc=null,staff=false,teacherTab='here',processing=false,refreshing=false,modalBusy=false,paused=false,ready=false,offset=0,lastRead=null,displayQueue=[],showing=false,audio=null,sound=false,volume=memory.get('eq-attendance-volume',.25),lastTags=new Map(),proof=false,mutation=null;
 let lastLogSignature='',writeVersion=0;
 let queue=memory.get('eq-attendance-queue-v1',[]);
 const shown=new Set(memory.get('eq-attendance-shown-v1',[]));
 function recognize(result,receipt){if(shown.has(receipt))return;shown.add(receipt);if(shown.size>500)shown.delete(shown.values().next().value);memory.set('eq-attendance-shown-v1',[...shown]);enqueueDisplay(result);}
 const modalOpen=()=>{const n=document.getElementById('modal-overlay');return !!n&&getComputedStyle(n).display!=='none';};
 const identity=()=>typeof currentUser!=='undefined'?String(currentUser?.id||''):'';
 const ownQueue=()=>queue.filter(q=>q.owner===owner&&q.classId===classId);
 const persist=()=>memory.set('eq-attendance-queue-v1',queue);
 const now=()=>Date.now()+offset;
 const schoolDate=(time=now())=>new Date(time).toLocaleDateString('en-CA',{timeZone:'Asia/Manila'});
 const schoolTime=(value,seconds=false)=>value?new Date(value).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',...(seconds?{second:'2-digit'}:{})}):'—';
 const clockValue=value=>new Date(value).toLocaleTimeString('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hour12:false});
 const student=sid=>snapshot?.roster.find(r=>r.id===sid);
 const classLabel=()=>window.getClassLabel?window.getClassLabel(classId,AppStore.getState()):classId;
 const photo=r=>{const src=String(r?.photo||'').trim(),safe=/^https?:\/\//i.test(src)||/^data:image\/(png|jpe?g|webp|gif|avif);base64,[a-z0-9+/=\s]+$/i.test(src)||/^\.?\.?\//.test(src);return `<span>${esc(r?.init||r?.name?.split(' ').map(w=>w[0]).slice(0,2).join('')||'—')}</span>`+(safe?`<img src="${esc(src)}" alt="" onerror="this.remove()">`:'');};
 function message(text){const target=root?.querySelector('#as-staff-message');if(target)target.textContent=text;}
 function publicNotice(text){const n=root?.querySelector('#as-public-notice');if(n)n.textContent=text;}
 async function rpc(action,payload={}){
  const run=generation,who=owner;
  const {data,error}=await DBService.rpc('attendance_station',{p_class_id:classId,p_action:action,p_payload:payload});
  if(run!==generation||!root||identity()!==who)throw Object.assign(new Error('Station changed'),{stale:true});
  if(error)throw new Error(/PGRST202|function.*does not exist|schema cache/i.test(error.code+' '+error.message)?'Install phase83_attendance_station.sql in Supabase to enable the arrival station.':error.message||'Connection unavailable');
  if(!data)throw new Error('No attendance response received');return data;
 }
 function syncLog(result){
  if(!result.studentId||(!result.log&&!result.removed))return;
  AppStore.updateState(d=>{
   if(!Array.isArray(d.attendanceLogs))d.attendanceLogs=[];
   if(result.removed)d.attendanceLogs=d.attendanceLogs.filter(l=>!(l.studentId===result.studentId&&l.classId===classId&&l.logDate===(result.date||snapshot?.date)));
   else{const l=result.log,row={id:l.id,studentId:l.student_id,classId:l.class_id,logDate:l.log_date,status:l.status,scannedAt:l.scanned_at,entryMethod:l.entry_method,rfidTag:l.rfid_tag,recordedBy:l.recorded_by,notes:l.notes},i=d.attendanceLogs.findIndex(a=>a.id===row.id||(a.studentId===row.studentId&&a.classId===row.classId&&a.logDate===row.logDate));if(i>=0)d.attendanceLogs[i]=row;else d.attendanceLogs.unshift(row);}
   const person=(d.students||[]).find(s=>s.id===result.studentId);if(person&&typeof recalcStudentStats==='function'){recalcStudentStats(person,{attendanceLogs:d.attendanceLogs});window.syncStudentDerivedStatsToServer?.(person.id,person.attendance,person.quizAvg);}
  },{type:'attendance:station-confirmed',payload:{studentId:result.studentId}});
  Promise.resolve(window.LearningRewards?.refreshStudent(result.studentId)).catch(()=>{});
 }
 function mergeSnapshot(){
  const signature=JSON.stringify(snapshot.logs);if(signature===lastLogSignature)return;lastLogSignature=signature;
  AppStore.updateState(d=>{
   const rows=snapshot.logs.map(l=>({id:l.id,studentId:l.student_id,classId:l.class_id,logDate:l.log_date,status:l.status,scannedAt:l.scanned_at,entryMethod:l.entry_method,rfidTag:l.rfid_tag,recordedBy:l.recorded_by,notes:l.notes}));
   d.attendanceLogs=[...(d.attendanceLogs||[]).filter(l=>!(l.classId===classId&&l.logDate===snapshot.date)),...rows];
   for(const person of (d.students||[]).filter(s=>s.classId===classId)){if(typeof recalcStudentStats!=='function')continue;const previous=person.attendance;recalcStudentStats(person,{attendanceLogs:d.attendanceLogs});if(person.attendance!==previous)window.syncStudentDerivedStatsToServer?.(person.id,person.attendance,person.quizAvg);}
  },{type:'attendance:station-snapshot',payload:{classId}});
 }
 async function refresh(){
  if(!root||refreshing)return;refreshing=true;
  try{const version=writeVersion;const next=await rpc('snapshot');if(version!==writeVersion)return;snapshot=next;mergeSnapshot();offset=new Date(snapshot.serverTime).getTime()-Date.now();ready=true;renderSummary();renderStatus();if(staff&&!['manual','preflight','close'].includes(teacherTab)&&!document.activeElement?.closest('#as-teacher-body input,#as-teacher-body select'))renderTeacherBody();}
  catch(e){if(!e.stale){ready=false;renderStatus();publicNotice('Connection unavailable. Unconfirmed taps stay pending.');message(e.message);if(!snapshot)idle('Station needs attention','Ask your teacher to check the connection or finish setup.');}}
  finally{refreshing=false;}
 }
 function scheduleState(){
  const s=snapshot?.schedule;if(!s)return {label:'Schedule needed',detail:'Ask your teacher to set up today’s attendance window.',open:false};
  if(s.day_off)return {label:'No class today',detail:'There is no attendance session scheduled today.',open:false};
  if(snapshot.finalized)return {label:'Attendance finalized',detail:'See your teacher if your arrival needs to be added.',open:false};
  const time=new Date(now()).toLocaleTimeString('en-GB',{timeZone:'Asia/Manila',hour12:false});
  if(time<s.open_time)return {label:'Opens at '+s.open_time.slice(0,5),detail:'Please wait until the attendance window opens.',open:false};
  if(time>s.close_time)return {label:'Attendance closed',detail:'See your teacher to record a late arrival.',open:false};
  return {label:time>=s.late_cutoff?'Late window':'Attendance open',detail:'Late cutoff '+s.late_cutoff.slice(0,5)+' · Closes '+s.close_time.slice(0,5),open:true};
 }
 function renderStatus(){
  if(!root)return;
  const active=document.hasFocus()&&!document.hidden,s=scheduleState();
  const label=paused?'Scanner paused':!navigator.onLine?'Offline · taps will stay pending':!ready?'Connecting to attendance':!active?'Activate this window to scan':staff||modalOpen()?'Teacher controls open':!s.open?s.label:'Ready for cards';
  root.querySelector('#as-ready').textContent=label;root.querySelector('#as-ready').dataset.tone=paused||!ready||!active?'attention':'ready';
  root.querySelector('#as-window').textContent=s.detail;
  root.querySelector('#as-queue').textContent=ownQueue().length?ownQueue().length+' scans pending confirmation':'Only confirmed attendance is shown';
  root.querySelector('[data-as="pause"]').textContent=paused?'Resume scanner':'Pause scanner';
  root.querySelectorAll('[data-as="sound"]').forEach(n=>n.innerHTML=svg('sound')+(sound?'Sound on · mute':'Enable sound'));
  const stage=root.querySelector('#as-stage');if(stage?.dataset.state==='idle'){const key=[s.label,ready,paused].join();if(stage.dataset.key!==key){idle(paused?'Scanning is paused':s.open?'Welcome to class.':s.label,paused?'Your teacher will resume scanning shortly.':s.open?'Tap your card once on the reader.':s.detail);stage.dataset.key=key;}}
 }
 function renderSummary(){
  if(!root||!snapshot)return;
  const logs=snapshot.logs.filter(l=>snapshot.roster.some(r=>r.id===l.student_id)),arrived=logs.filter(l=>here(l.status)),late=arrived.filter(l=>l.status==='Late').length;
  root.querySelector('#as-arrived').textContent=arrived.length;root.querySelector('#as-total').textContent=snapshot.roster.length;
  root.querySelector('#as-progress').style.width=(snapshot.roster.length?arrived.length/snapshot.roster.length*100:0)+'%';
  root.querySelector('#as-count-caption').textContent=late?`${late} late · ${Math.max(0,snapshot.roster.length-logs.length)} not checked in`:`${Math.max(0,snapshot.roster.length-logs.length)} not checked in`;
  root.querySelector('#as-arrivals').innerHTML=arrived.slice(0,5).map(l=>{const r=student(l.student_id);return `<li><div class="as-small-photo">${photo(r)}</div><span>${esc(r?.name||'Student')}<small>Checked in · ${schoolTime(l.scanned_at)}</small></span>${svg('check')}</li>`;}).join('')||'<li class="as-empty">Your class is on its way.</li>';
 }
 function idle(title='Welcome to class.',detail='Tap your card once on the reader.'){
  const stage=root?.querySelector('#as-stage');if(!stage)return;stage.dataset.state='idle';stage.dataset.key='';
  const canTap=ready&&!paused&&scheduleState().open;
  stage.innerHTML=`<div class="as-idle"><div class="as-reader-mark">${svg('card')}<i></i><i></i></div><p class="as-eyebrow">YOUR CLASSROOM STARTS HERE</p><h1>${esc(title)}</h1><p>${esc(detail)}</p>${canTap?'<div class="as-tap-instruction"><span>01</span> Tap your card <b>→</b> <span>02</span> Wait for your name</div>':'<div class="as-tap-instruction">Your teacher can help with an attendance entry.</div>'}</div>`;
 }
 function enqueueDisplay(result){displayQueue.push(result);nextDisplay();}
 function nextDisplay(){
  if(showing||!displayQueue.length||!root||staff)return;showing=true;
  const result=displayQueue.shift(),stage=root.querySelector('#as-stage');clearTimeout(displayTimer);
  if(result.ok){
   const r=student(result.studentId),duplicate=result.alreadyRecorded,arrival=result.log?.scanned_at;
   stage.dataset.state='confirmed';
   stage.innerHTML=`<article class="as-receipt ${duplicate?'as-duplicate':''}"><div class="as-receipt-label">${svg(duplicate?'clock':'check')} ${duplicate?'YOU’RE ALREADY CHECKED IN':'ATTENDANCE RECORDED'}</div><div class="as-receipt-main"><div class="as-portrait">${photo(r)}</div><div><p class="as-eyebrow">${esc(classLabel())}</p><h1>${esc(r?.name||'Student')}</h1><p class="as-welcome">${duplicate?'Your first arrival time is saved.':'You’re checked in. Have a great class.'}</p><div class="as-arrival-time">${schoolTime(arrival)} <span>${esc(result.status)}</span></div></div></div><footer>${svg('check')} ${duplicate?'No new entry or rewards added.':'Saved to your attendance history.'}</footer></article>`;
   tone(duplicate?'duplicate':'success');
  }else{
   stage.dataset.state='attention';stage.innerHTML=`<div class="as-attention"><div class="as-reader-mark">${svg('card')}</div><p class="as-eyebrow">LET’S GET THIS SORTED</p><h1>Please see your teacher.</h1><p>${result.error==='review_time'?'Your tap was received. Your teacher will check the arrival time.':'Your attendance needs a quick check before it can be confirmed.'}</p><small>You can step aside so the next student can tap.</small></div>`;tone('attention');
  }
  // Accept every new tap immediately; recognition is a separate, bounded queue.
  displayTimer=setTimeout(()=>{showing=false;if(!root)return;if(displayQueue.length)nextDisplay();else{idle();renderStatus();}},displayQueue.length?950:1800);
 }
 async function ingest(raw){
  if(!root||paused||staff||modalOpen())return;
  if(!document.hasFocus()||document.hidden){publicNotice('Activate the attendance window before scanning.');return;}
  const normalized=typeof _rfidNormalizeTagId==='function'?_rfidNormalizeTagId(raw):String(raw||'').trim();const tag=String(normalized).trim();if(!tag)return;
  if(Date.now()-(lastTags.get(tag)||0)<2500)return;lastTags.set(tag,Date.now());proof=true;lastRead=new Date(now()).toISOString();
  const entry={id:id(),tag,classId,owner,capturedAt:lastRead};queue.push(entry);
  if(!persist()){queue.pop();publicNotice('This browser cannot save pending taps. Please see your teacher.');return;}
  renderStatus();publicNotice(navigator.onLine?'Card received · confirming attendance…':'Card received · pending confirmation until the connection returns.');await flush();
 }
 async function flush(){
  if(processing||!root||!navigator.onLine||!ready||!ownQueue().some(q=>!q.error))return;processing=true;
  try{for(const entry of [...ownQueue()]){
   if(entry.error)continue;
   try{const result=await rpc('scan',{id:entry.id,tag:entry.tag,capturedAt:entry.capturedAt});
    writeVersion++;queue=queue.filter(q=>q.id!==entry.id);persist();
    if(result.ok){syncLog(result);recognize(result,entry.id);publicNotice('Attendance confirmed. The next card can be tapped.');}
    else{recognize(result,entry.id);publicNotice('Tap sent for teacher review. The next student can scan.');}
   }catch(e){if(e.stale)break;ready=false;publicNotice('Not yet confirmed. The tap stays pending for a safe retry.');message(e.message);break;}
  }}finally{processing=false;renderStatus();await refresh();}
 }
 function captureKey(e){
  if(!root||staff||paused||e.ctrlKey||e.metaKey||e.altKey)return;
  const input=root.querySelector('#as-capture');if(e.target!==input)return;
  if(e.key==='Enter'){e.preventDefault();clearTimeout(captureTimer);const value=input.value;input.value='';ingest(value);return;}
  clearTimeout(captureTimer);captureTimer=setTimeout(()=>{const value=input.value;input.value='';if(value)ingest(value);},180);
 }
 function testReader(input){if(!staff||!root||!input.value)return;const length=input.value.trim().length;input.value='';proof=true;lastRead=new Date(now()).toISOString();const result=root.querySelector('#as-reader-test-result');if(result)result.textContent=`Received ${length} characters from the reader. No attendance was recorded.`;}
 function focusReader(){
  if(!root||staff||paused||document.hidden||!document.hasFocus()||modalOpen())return;
  const active=document.activeElement;if(active?.closest('input:not(#as-capture),textarea,select,[contenteditable]'))return;
  root.querySelector('#as-capture')?.focus({preventScroll:true});
 }
 async function toggleSound(){
  if(sound){sound=false;renderStatus();return;}
  try{audio=audio||new (window.AudioContext||window.webkitAudioContext)();await audio.resume();sound=audio.state==='running';if(sound)tone('success');renderStatus();}catch{publicNotice('Sound is unavailable here. Visual confirmations remain active.');}
 }
 function tone(type){
  if(!sound||!audio||audio.state!=='running')return;
  const notes=type==='success'?[660,880]:type==='duplicate'?[480]:[300,260];
  notes.forEach((frequency,i)=>{const oscillator=audio.createOscillator(),gain=audio.createGain(),at=audio.currentTime+i*.09;oscillator.type='sine';oscillator.frequency.value=frequency;gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(Math.max(0,Math.min(1,volume))*.15,at+.012);gain.gain.exponentialRampToValueAtTime(.0001,at+.12);oscillator.connect(gain);gain.connect(audio.destination);oscillator.start(at);oscillator.stop(at+.13);});
 }
 function touchTeacher(){clearTimeout(staffTimer);if(staff)staffTimer=setTimeout(lockTeacher,120000);}
 function lockTeacher(){
  staff=false;mutation=null;clearTimeout(staffTimer);root?.querySelector('#as-teacher')?.remove();root?.classList.remove('as-private');if(root){root.querySelector('.as-shell').inert=false;root.querySelector('#as-capture').disabled=false;}
  if(root){idle();renderStatus();nextDisplay();root.querySelector('#as-capture')?.focus({preventScroll:true});}
 }
 function openTeacher(requestedTab='here'){
  if(!root||staff)return;const panel=document.createElement('section');panel.id='as-teacher';panel.className='as-teacher';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Teacher controls');
  panel.innerHTML=`<form id="as-unlock"><p class="as-eyebrow">STAFF ACCESS</p><h2>Teacher controls</h2><p>Confirm your staff password to review attendance. Scanning pauses while these controls are open.</p><label>Password<input type="password" name="password" autocomplete="current-password" required></label><div class="as-actions"><button type="submit">Unlock teacher view</button>${button('lock','Back to scanning')}</div><p id="as-staff-message" role="status"></p></form>`;
  root.append(panel);root.querySelector('.as-shell').inert=true;root.querySelector('#as-capture').disabled=true;staff=true;root.classList.add('as-private');renderStatus();root.querySelector('#as-capture').value='';clearTimeout(captureTimer);nfc?.abort();nfc=null;
  panel.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();lockTeacher();return;}if(e.key==='Tab'){const nodes=[...panel.querySelectorAll('button,input,select,textarea')].filter(n=>!n.disabled&&n.getClientRects().length);if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0]?.focus();}}};panel.querySelector('input').focus();panel.querySelector('form').onsubmit=async e=>{
   e.preventDefault();const submit=panel.querySelector('[type=submit]');if(submit.disabled)return;submit.disabled=true;
   try{const client=DBService.getAuthClient(),{data,error}=await client.auth.getSession();if(error||!data?.session?.user?.email||data.session.user.id!==owner)throw new Error('Sign in again before opening teacher controls.');
    const verified=await client.auth.signInWithPassword({email:data.session.user.email,password:new FormData(e.target).get('password')});e.target.querySelector('input').value='';
    if(verified.error||verified.data?.user?.id!==owner)throw new Error('Password not confirmed. Try again.');
    if(!root||!panel.isConnected||identity()!==owner)return;panel.innerHTML=`<header><div><p class="as-eyebrow">TEACHER VIEW · ${esc(classLabel())}</p><h2>Today’s attendance</h2></div>${button('lock',svg('lock')+' Return to scanning')}</header><nav class="as-teacher-tabs">${[['here','Here'],['missing','Not checked in'],['late','Late'],['records','All records'],['reviews','Needs review'],['manual','Manual entry'],['preflight','Station setup'],['audit','Edit history'],['close','Finalize']].map(([key,label])=>button('tab',label,`data-tab="${key}"`)).join('')}</nav><div id="as-teacher-body"></div><p id="as-staff-message" role="status"></p>`;
    teacherTab=requestedTab;renderTeacherBody();touchTeacher();
   }catch(err){message(err.message);}finally{if(submit.isConnected)submit.disabled=false;}
  };
 }
 function renderTeacherBody(){
  const target=root?.querySelector('#as-teacher-body');if(!target||!snapshot)return;
  root.querySelectorAll('.as-teacher-tabs button').forEach(n=>n.setAttribute('aria-pressed',n.dataset.tab===teacherTab));
  const logs=snapshot.logs,lookup=new Map(logs.map(l=>[l.student_id,l]));
  if(['here','late','missing','records'].includes(teacherTab)){
   const rows=snapshot.roster.filter(r=>teacherTab==='records'?true:teacherTab==='missing'?!lookup.has(r.id):teacherTab==='late'?lookup.get(r.id)?.status==='Late':here(lookup.get(r.id)?.status));
   target.innerHTML=`<div class="as-board-heading"><h3>${teacherTab==='missing'?'Not checked in yet':teacherTab==='late'?'Late arrivals':teacherTab==='records'?'All student records':'Students here'} <span>${rows.length}</span></h3><input id="as-search" type="search" placeholder="Find a student" aria-label="Find a student"></div><div class="as-student-list">${rows.map(r=>{const l=lookup.get(r.id);return `<article data-name="${esc(r.name.toLowerCase())}"><div class="as-small-photo">${photo(r)}</div><div><strong>${esc(r.name)}</strong><small>${l?esc(l.status)+' · '+schoolTime(l.scanned_at)+(l.entry_method==='Manual'?' · Manual':''):'No attendance entry for today'}</small></div>${button('edit','Record / correct',`data-student="${esc(r.id)}"`)}</article>`;}).join('')||'<p class="as-empty">No students in this group.</p>'}</div>`;
  }else if(teacherTab==='reviews'){
   const local=ownQueue();target.innerHTML=`<h3>Unresolved scans <span>${snapshot.reviews.length+local.length}</span></h3><p>Delayed scans keep their captured time. Confirm the student and actual arrival before recording attendance.</p>${local.map(q=>`<article class="as-review"><div><strong>Pending on this computer</strong><p>Card …${esc(q.tag.slice(-4))} · captured ${schoolTime(q.capturedAt,true)}</p><small>Not confirmed. Retry after restoring the connection, or discard after checking the student.</small></div>${button('retry','Retry')}${button('discard','Discard',`data-id="${q.id}"`)}</article>`).join('')}${snapshot.reviews.map(r=>`<article class="as-review"><div><strong>${esc(reasonLabels[r.result.error]||'Scan needs review')}</strong><p>${esc(student(r.student_id)?.name||'Unrecognized student')} · captured ${schoolTime(r.captured_at,true)}</p><small>Card ${esc(r.tag_id)} · ${esc(new Date(r.captured_at).toLocaleDateString('en-PH',{timeZone:'Asia/Manila'}))}</small></div>${button('resolve','Record arrival',`data-id="${r.id}"`)}${button('dismiss','Dismiss',`data-id="${r.id}"`)}</article>`).join('')||'<p class="as-empty">No scans need review.</p>'}`;
  }else if(teacherTab==='manual')renderManual();
  else if(teacherTab==='preflight'){
   const s=snapshot.schedule;target.innerHTML=`<h3>Ready before the first tap</h3><div class="as-readiness"><p><b>${ready&&navigator.onLine?'Connected':'Connection needs attention'}</b> · Supabase confirmation</p><p><b>${esc(classLabel())}</b> · Selected section</p><p><b>${s&&!s.day_off?'Schedule configured':'No active class today'}</b>${s&&!s.day_off?' · '+esc(s.open_time.slice(0,5))+'–'+esc(s.close_time.slice(0,5)):''}</p><p><b>${proof?'Reader input received':'Reader not tested this visit'}</b> · ${lastRead?schoolTime(lastRead,true):'Return to scanning and tap a card to test'}</p><p><b>${ownQueue().length} pending on this device</b> · Must be resolved before finalizing</p></div><label>Test reader input (no attendance recorded)<input id="as-reader-test" autocomplete="off" autocapitalize="off" inputmode="none" placeholder="Focus here, then tap a test card"></label><p id="as-reader-test-result" role="status"></p><label>Confirmation volume<input data-as-volume type="range" min="0" max="1" step=".05" value="${volume}"></label><div class="as-actions">${button('sound',sound?'Mute sound':'Enable / test sound')}${button('settings','Schedule / card settings')}${button('nfc','Use phone NFC')}</div><p>Computer readers should type the card ID as a keyboard and ideally send Enter. A browser cannot verify that a keyboard-style reader is physically connected. Keep this browser window active while scanning.</p><p>On a teacher’s phone, open this same class and teacher view to see arrivals live. The classroom computer can continue scanning.</p>`;
  }else if(teacherTab==='audit'){
   target.innerHTML=`<h3>Attendance edit history</h3>${snapshot.audit.map(a=>`<article class="as-audit"><strong>${esc(student(a.student_id)?.name||classLabel())} · ${esc(a.action)}</strong><p>${esc(a.before_log?.status||'No entry')} → ${esc(a.after_log?.status||(a.action==='manual'?'Removed':a.action))}</p><small>${esc(a.reason)} · ${schoolTime(a.created_at,true)} · ${esc(a.actorName||'Staff')}</small></article>`).join('')||'<p class="as-empty">No changes made through this station yet.</p>'}`;
  }else if(teacherTab==='close'){
   const missing=snapshot.roster.filter(r=>!lookup.has(r.id));target.innerHTML=`<h3>${snapshot.finalized?'Attendance is finalized':'Review before finalizing'}</h3><p>${missing.length} students have no attendance entry. Finalizing marks those students absent; students already marked excused remain excused.</p><div class="as-missing-names">${missing.map(r=>`<span>${esc(r.name)}</span>`).join('')}</div><p>${snapshot.reviews.length} server issues · ${ownQueue().length} pending on this device.</p><label>Reason / note<input id="as-finalize-reason" value="${snapshot.finalized?'Reopen attendance for reviewed corrections':'End-of-class attendance review'}" maxlength="500"></label>${button(snapshot.finalized?'reopen':'finalize',snapshot.finalized?'Reopen station':'Finalize and mark remaining absent',snapshot.reviews.length||ownQueue().length?'disabled':'')}<p>Resolve scan issues first. To excuse a student or correct an entry, use Manual entry before finalizing.</p>`;
  }
 }
 function renderManual(options={}){
  const target=root.querySelector('#as-teacher-body');const r=options.receipt?snapshot.reviews.find(r=>r.id===options.receipt):null;
  const sid=options.student||r?.student_id||'',log=snapshot.logs.find(l=>l.student_id===sid),arrival=r?.captured_at||(log&&here(log.status)?log.scanned_at:new Date(now()).toISOString());
  target.innerHTML=`<form id="as-manual"><h3>${r?'Resolve scan issue':'Record or correct attendance'}</h3><p>Choose the actual arrival time. Your reason and the previous entry are retained in the edit history.</p><label>Student<select name="student" required><option value="">Choose student</option>${snapshot.roster.map(p=>`<option value="${esc(p.id)}" ${p.id===sid?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><div class="as-form-grid"><label>School date<input type="date" name="date" value="${schoolDate(new Date(arrival).getTime())}" max="${schoolDate()}" required></label><label>Actual arrival time<input type="time" name="time" value="${clockValue(arrival)}" required></label></div><label>Status<select name="status"><option value="Auto">Calculate from arrival time</option><option>Early</option><option>On Time</option><option>Late</option><option>Absent</option><option>Excused</option><option value="Remove">Remove entry</option></select></label><label>Reason<input name="reason" placeholder="e.g. Forgot card; arrived before the bell" value="${r?'Reviewed scan: '+esc(reasonLabels[r.result.error]||'arrival issue'):''}" minlength="3" maxlength="500" required></label><button type="submit">Save attendance</button><input type="hidden" name="receipt" value="${esc(r?.id||'')}"><p id="as-manual-existing"></p></form>`;
  target.querySelector('form').onsubmit=saveManual;target.querySelector('[name=student]').onchange=e=>{const existing=snapshot.logs.find(l=>l.student_id===e.target.value);root.querySelector('#as-manual-existing').textContent=existing?`Current entry: ${existing.status} · ${schoolTime(existing.scanned_at)}. Saving replaces this entry.`:'No existing entry.';};
 }
 async function mutate(action,payload){
  if(modalBusy)return null;modalBusy=true;root?.querySelectorAll('#as-teacher button[type=submit]').forEach(n=>n.disabled=true);
  const encoded=JSON.stringify([action,payload]);if(mutation?.key!==encoded)mutation={key:encoded,id:id()};
  try{const result=await rpc(action,{...payload,id:mutation.id});if(result.ok===false)throw new Error(result.message||'Change not confirmed');writeVersion++;syncLog({...result,date:payload.date});mutation=null;await refresh();message('Saved. Attendance and rewards follow the confirmed record.');return result;}
  catch(e){if(!e.stale)message(e.message+' Your change is not yet confirmed. Retry with the same values to check it safely.');return null;}
  finally{modalBusy=false;root?.querySelectorAll('#as-teacher button[type=submit]').forEach(n=>n.disabled=false);}
 }
 async function saveManual(e){
  e.preventDefault();touchTeacher();const form=new FormData(e.target),date=form.get('date'),status=form.get('status'),receipt=form.get('receipt'),payload={student:form.get('student'),status,date,reason:form.get('reason')};
  if(['Auto','Early','On Time','Late'].includes(status))payload.arrivedAt=new Date(date+'T'+form.get('time')+':00+08:00').toISOString();
  if(receipt)payload.receipt=receipt;const result=await mutate('manual',payload);if(result){teacherTab='here';renderTeacherBody();}
 }
 async function click(e){
  const b=e.target.closest('[data-as]');if(!b||b.disabled)return;const a=b.dataset.as;
  if(staff)touchTeacher();
  if(a==='teacher')return openTeacher();if(a==='lock')return lockTeacher();
  if(a==='pause'){paused=!paused;renderStatus();if(!paused)root.querySelector('#as-capture').focus();return;}
  if(a==='sound')return toggleSound();
  if(a==='fullscreen'){try{if(document.fullscreenElement)await document.exitFullscreen();else await root.requestFullscreen();}catch{publicNotice('Use the browser’s full-screen option.');}return;}
  if(a==='activate'){root.querySelector('#as-capture').focus();renderStatus();return;}
  if(!staff||!root.querySelector('#as-teacher-body'))return;
  if(a==='tab'){teacherTab=b.dataset.tab;mutation=null;renderTeacherBody();return;}
  if(a==='edit'||a==='resolve'){teacherTab='manual';renderManual(a==='edit'?{student:b.dataset.student}:{receipt:b.dataset.id});return;}
  if(a==='settings'){lockTeacher();window._rfidOpenSettings();return;}
  if(a==='nfc'){
   if(!('NDEFReader' in window))return message('Phone NFC requires a compatible Android browser and NFC card. Use the classroom computer reader for this station.');
   lockTeacher();try{nfc=new AbortController();const reader=new NDEFReader();await reader.scan({signal:nfc.signal});reader.onreading=e=>{if(nfc&&e.serialNumber)ingest(e.serialNumber);};reader.onreadingerror=()=>publicNotice('Card not read. Try holding it still.');publicNotice('Phone NFC armed. Keep this page open.');}catch{nfc=null;publicNotice('Phone NFC could not start. Use the computer reader.');}return;
  }
  if(a==='retry'){await refresh();return flush();}
  if(a==='discard'){if(confirm('Discard this unconfirmed local tap after checking the student?')){queue=queue.filter(q=>q.id!==b.dataset.id);persist();renderTeacherBody();renderStatus();}return;}
  if(a==='dismiss'){const reason=prompt('Why is this scan issue being dismissed?','Reviewed with student');if(reason?.trim().length>=3)await mutate('dismiss',{receipt:b.dataset.id,reason});return;}
  if(a==='finalize'||a==='reopen'){
   if(ownQueue().length||snapshot.reviews.length)return message('Resolve pending scans and review issues first.');
   const reason=root.querySelector('#as-finalize-reason').value;
   if(confirm(a==='finalize'?'Finalize today’s attendance and mark the listed students absent?':'Reopen the station? Existing attendance entries are kept for review.')){const result=await mutate(a,{reason,date:snapshot.date});if(result)renderTeacherBody();}return;
  }
 }
 function mount(options={}){
  unmount();root=document.getElementById('a-scanner');if(!root)return;root.classList.add('as-station');classId=options.classId||'default-class';owner=identity();
  const state=AppStore.getState(),classes=window.getActiveClassIds?window.getActiveClassIds(state):[...new Set((state.students||[]).map(r=>r.classId))].filter(Boolean);
  if(classes.length&&!classes.includes(classId)){root=null;window._rfidOnClassChange(classes[0]);return;}
  if(!classes.length)classes.push(classId);const at=generation;
  root.innerHTML=`<input id="as-capture" aria-label="RFID reader input" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="none"><div class="as-shell"><header class="as-header"><div class="as-brand">${svg('card')}<div><p class="as-eyebrow">CLASSROOM CHECK-IN</p><select id="as-class" aria-label="Attendance section">${classes.map(c=>`<option value="${esc(c)}" ${c===classId?'selected':''}>${esc(window.getClassLabel?window.getClassLabel(c,state):c)}</option>`).join('')}</select></div></div><div class="as-header-tools"><time id="as-clock"></time>${button('sound',svg('sound')+'Enable sound')}${button('fullscreen','Full screen')}${button('teacher',svg('lock')+'Teacher view')}</div></header><div class="as-status-strip"><span id="as-ready" role="status">Connecting to attendance</span><span id="as-window"></span>${button('activate','Activate scanner')}${button('pause','Pause scanner')}</div><main class="as-main"><section id="as-stage" aria-live="polite" aria-atomic="true"></section><aside class="as-sidebar"><p class="as-eyebrow">TODAY, TOGETHER</p><div class="as-headcount"><strong id="as-arrived">—</strong><span>/ <b id="as-total">—</b> here</span></div><div class="as-progress"><i id="as-progress"></i></div><p id="as-count-caption"></p><div class="as-arrivals-heading"><h2>Latest arrivals</h2><span>LIVE</span></div><ol id="as-arrivals"></ol><p class="as-sidebar-note">Wait for your name before moving on.<br>Only confirmed taps count as attendance.</p></aside></main><footer class="as-footer"><span id="as-public-notice" role="status">Waiting for the station to connect.</span><span id="as-queue"></span></footer></div>`;
  root.onclick=async e=>{await click(e);if(root&&!staff&&!paused)focusReader();};root.onkeydown=e=>{if(e.target.id==='as-reader-test'&&e.key==='Enter'){e.preventDefault();testReader(e.target);return;}captureKey(e);};root.onpointerdown=()=>{if(staff)touchTeacher();};root.oninput=e=>{if(staff)touchTeacher();if(e.target.id==='as-reader-test'){clearTimeout(captureTimer);captureTimer=setTimeout(()=>testReader(e.target),200);}if(e.target.matches('[data-as-volume]')){volume=Number(e.target.value);memory.set('eq-attendance-volume',volume);}if(e.target.id==='as-search'){const term=e.target.value.toLowerCase();root.querySelectorAll('[data-name]').forEach(n=>n.hidden=!n.dataset.name.includes(term));}};
  root.querySelector('#as-class').onchange=e=>window._rfidOnClassChange(e.target.value);
  idle('Getting the classroom ready…','Checking today’s attendance schedule.');
  refresh().then(()=>{if(generation===at&&root){if(ready)idle();renderStatus();flush();}});
  poll=setInterval(async()=>{await refresh();await flush();},3000);
  tick=setInterval(()=>{if(!root)return;const clock=root.querySelector('#as-clock');clock.textContent=schoolTime(new Date(now()),true);renderStatus();focusReader();if(ownQueue().length&&navigator.onLine&&ready)flush();},600);
  focusReader();
 }
 function unmount(){
  generation++;lastLogSignature='';writeVersion=0;refreshing=false;processing=false;modalBusy=false;clearInterval(poll);clearInterval(tick);clearTimeout(displayTimer);clearTimeout(captureTimer);clearTimeout(staffTimer);poll=tick=null;nfc?.abort();nfc=null;audio?.close().catch(()=>{});audio=null;sound=false;
  if(root){root.onclick=root.onkeydown=root.oninput=root.onpointerdown=null;root.classList.remove('as-station','as-private');root.querySelector('#as-teacher')?.remove();}root=null;snapshot=null;staff=false;ready=false;paused=false;showing=false;displayQueue=[];lastTags.clear();proof=false;lastRead=null;mutation=null;
 }
 window.AttendanceStation={mount,unmount,ingest,openTeacher,mounted:()=>!!root};
 window.addEventListener('online',()=>{if(root)refresh().then(flush);});window.addEventListener('offline',()=>{ready=false;renderStatus();});window.addEventListener('focus',()=>{renderStatus();focusReader();});window.addEventListener('blur',renderStatus);document.addEventListener('visibilitychange',()=>{renderStatus();if(!document.hidden)focusReader();});
})();
