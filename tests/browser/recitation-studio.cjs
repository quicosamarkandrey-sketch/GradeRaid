const {setup}=require('../helpers/recitation-db.cjs'),{chromium}=require('@playwright/test'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const {db,rpc}=await setup();let browser,server;try{
 const base=path.resolve(__dirname,'../..');
 server=http.createServer((req,res)=>{const file=path.resolve(base,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!file.startsWith(base+path.sep))return res.writeHead(403).end();fs.readFile(file,(err,data)=>{res.writeHead(err?404:200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(err?'Missing':data);});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const errors=[],pages=[];
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:1000},hasTouch:true});pages.push(page);page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.fulfill({contentType:'application/javascript',body:''}));
  await page.exposeFunction('recitationRPC',async(args)=>{try{return {data:await rpc(args.p_action,args.p_payload,args.p_device,'teacher',args.p_class_id)};}catch(e){return {error:{message:e.message}};}});
  await page.goto(origin);await page.waitForFunction(()=>window.RecitationStudio&&window.AppStore);
  await page.evaluate(()=>{
   window.recognitions=0;new MutationObserver(records=>{records.forEach(r=>r.addedNodes.forEach(n=>{if(n.nodeType===1&&n.matches('.rs-recognition-card'))recognitions++;}));}).observe(document.body,{childList:true,subtree:true});
   DBService.rpc=(name,args)=>name==='recitation_presentation'?recitationRPC(args):Promise.resolve({error:{message:'Fixture only'}});
   AppStore.updateState(d=>{d.students=[{id:'alex',name:'Alex Rivera',classId:'room-a',init:'AR'},{id:'bea',name:'Bea Cruz',classId:'room-a',init:'BC'}];d.classroomLayouts=[{id:'00000000-0000-4000-8000-000000000010',classId:'room-a',name:'Main room'}];d.quizzes=[{id:'quiz1',classId:'room-a',title:'Plants',questions:[{q:'Why are leaves green?',opts:['Chlorophyll','Water'],answer:0}]}];});
   currentRole='teacher';currentUser={id:'00000000-0000-4000-8000-000000000001',name:'Teacher'};document.getElementById('boot-loading').style.display='none';document.getElementById('login-screen').style.display='none';document.getElementById('main-app').style.display='block';setupSidebar();
  });
 }
 const [phone,display]=pages;
 const profilePhoto=await phone.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=48;const ctx=c.getContext('2d');ctx.fillStyle='#5687ae';ctx.fillRect(0,0,48,48);return c.toDataURL('image/png');});
 await db.query("update profiles set profile_pic_url=$1 where role='student'",[profilePhoto]);
 await phone.evaluate(()=>RecitationStudio.open({classId:'room-a'}));await phone.locator('[data-rs=host]').click();await phone.locator('[data-rs=pick]').waitFor();
 await phone.evaluate(()=>{window.NDEFReader=class{async scan({signal}){window.testNFC=this;window.nfcArmed=true;signal.addEventListener('abort',()=>window.nfcArmed=false);}};});await phone.locator('[data-rs=nfc]').click();assert.equal(await phone.evaluate(()=>nfcArmed),true);
 await phone.locator('[data-tab=connect]').click();const code=await phone.locator('.rs-code').textContent();
 await display.evaluate(()=>RecitationStudio.open());await display.locator('[name=code]').fill(code);await display.locator('#rs-join button').click();await display.locator('.rs-display').waitFor();
 assert.equal(await display.locator('.rs-remote').count(),0,'Projection never shows private controls');
 await phone.locator('[data-tab=questions]').click();await phone.locator('#rs-questions').fill('What makes a strong explanation? | Private answer: evidence\nHow can you improve it? | Private answer: revision');await phone.locator('[data-rs=save-questions]').click();await display.getByRole('heading',{name:'What makes a strong explanation?'}).waitFor();
 assert.doesNotMatch(await display.locator('#rs-stage').textContent(),/Private answer/);
 await phone.locator('[data-rs=timer][data-seconds="20"]').click();await display.locator('#rs-timer').filter({hasText:'think it through'}).waitFor();
 await phone.locator('[data-tab=live]').click();const pickStart=Date.now();await phone.locator('[data-rs=pick]').click();await phone.locator('.rs-draw').waitFor();await display.locator('.rs-draw').waitFor();
 assert.equal(await phone.locator('.rs-speaker').count(),0,'Winner is hidden during suspense');assert.match(await phone.locator('#rs-selected').textContent(),/Choosing/);assert.equal(await phone.locator('[data-rs=pick]').isDisabled(),true);
 assert.equal((await db.query('select count(*)::int n from recitation_log')).rows[0].n,0);
 await phone.screenshot({path:'/workspace/recitation-suspense-phone.png'});await display.screenshot({path:'/workspace/recitation-suspense-desktop.png'});
 await display.locator('.rs-speaker h2').waitFor();assert.ok(Date.now()-pickStart>=2200,'Shared suspense lasts roughly 2.4 seconds');await phone.locator('.rs-speaker h2').waitFor();
 const portrait=display.locator('.rs-speaker-avatar img');assert.equal(await portrait.getAttribute('src'),profilePhoto);await display.waitForFunction(()=>{const n=document.querySelector('.rs-speaker-avatar img');return n?.complete&&n.naturalWidth>0;});
 assert.ok(await display.locator('.rs-speaker-avatar').evaluate(n=>parseFloat(getComputedStyle(n).borderRadius)<n.clientWidth/3),'Profile frame is square');
 const selectedId=await display.locator('.rs-speaker-avatar').getAttribute('data-student');
 const newPhoto=await phone.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=48;const ctx=c.getContext('2d');ctx.fillStyle='#8b6f97';ctx.fillRect(0,0,48,48);return c.toDataURL();});
 await db.query('update profiles set profile_pic_url=$1 where id=$2',[newPhoto,selectedId]);
 await display.waitForFunction(src=>document.querySelector('.rs-speaker-avatar img')?.getAttribute('src')===src,newPhoto);

 assert.equal((await db.query('select count(*)::int n from recitation_log')).rows[0].n,0);
 const called=await phone.locator('#rs-selected').textContent(),other=called.includes('Alex')?'ccdd':'aabb';await phone.locator('#rs-scanner').selectOption('selected');
 assert.equal(await phone.evaluate(()=>nfcArmed),true,'NFC remains armed across remote tabs and question controls');await phone.evaluate(tag=>testNFC.onreading({serialNumber:tag}),other);await phone.locator('.rs-warning').waitFor();assert.equal((await db.query('select count(*)::int n from recitation_log')).rows[0].n,0);
 await phone.locator('[data-rs=mismatch-award]').click();await display.locator('.rs-recognition-card').waitFor();await phone.waitForTimeout(2200);await display.waitForTimeout(500);
 assert.equal(await display.evaluate(()=>recognitions),1,'One animation despite polling echoes');
 await phone.locator('[data-rs=undo]').click();await display.locator('.rs-corrected').waitFor();assert.equal((await db.query('select count(*)::int n from recitation_log')).rows[0].n,0);
 // A cardless student receives the same confirmed award/undo feedback.
 await phone.locator('.rs-manual summary').click();await phone.locator('#rs-manual-student').selectOption('cam');await phone.locator('#rs-manual-points').fill('3');await phone.locator('#rs-manual-note').fill('Clear explanation');
 await phone.locator('#rs-manual-form button[type=submit]').click();await display.locator('.rs-recognition-card').filter({hasText:'+3'}).waitFor();assert.match(await phone.locator('#rs-live-summary').textContent(),/3 points/);
 const manualLog=(await db.query("select * from recitation_log where student_id='cam'")).rows[0];assert.equal(manualLog.pts,3);assert.match(manualLog.note,/Clear explanation/);assert.doesNotMatch(await display.locator('#rs-stage').textContent(),/Clear explanation/);
 assert.match(await phone.locator('[data-rs=undo]').textContent(),/Undo \+3/);await phone.locator('[data-rs=undo]').click();await display.locator('.rs-corrected').filter({hasText:'−3'}).waitFor();assert.equal((await db.query('select count(*)::int n from recitation_log')).rows[0].n,0);
 // Offline queue survives browser reload without optimistic scoring.
 await phone.locator('#rs-scanner').selectOption('open');await phone.context().setOffline(true);await phone.evaluate(()=>RecitationStudio.ingest('eeff'));assert.match(await phone.locator('#rs-status').textContent(),/pending/);assert.equal((await db.query('select count(*)::int n from recitation_log')).rows[0].n,0);
 await phone.evaluate(()=>RecitationStudio.close());await phone.context().setOffline(false);await phone.reload();await phone.waitForFunction(()=>window.RecitationStudio);
 await phone.evaluate(()=>{DBService.rpc=(name,args)=>name==='recitation_presentation'?recitationRPC(args):Promise.resolve({error:{message:'Fixture only'}});AppStore.updateState(d=>{d.classroomLayouts=[{id:'00000000-0000-4000-8000-000000000010',classId:'room-a',name:'Main room'}];});RecitationStudio.open({classId:'room-a'});});
 await phone.locator('[data-rs=host]').click();await phone.locator('[data-rs=pick]').waitFor();await phone.waitForFunction(()=>!JSON.parse(localStorage.getItem('eq-recitation-pending')).length);assert.equal((await db.query('select count(*)::int n from recitation_log')).rows[0].n,1);
 await phone.locator('[data-tab=questions]').click();await phone.locator('#rs-layout').selectOption('00000000-0000-4000-8000-000000000010');await phone.locator('#rs-view').selectOption('seats');await display.locator('.rs-seat-room').waitFor();assert.match(await display.locator('.rs-unseated').textContent(),/Cam Reyes/);
 await phone.screenshot({path:'/workspace/recitation-remote-phone.png'});await display.screenshot({path:'/workspace/recitation-presentation-desktop.png'});
 for(const width of [320,390,768]){await phone.setViewportSize({width,height:1000});assert.ok(await phone.locator('.rs-app').evaluate(n=>n.scrollWidth<=innerWidth+1),'Phone has no horizontal overflow at '+width);}
 await phone.emulateMedia({reducedMotion:'reduce'});await phone.locator('[data-tab=live]').click();await phone.locator('[data-rs=undo]').click();await phone.locator('.rs-corrected').waitFor();assert.equal(await phone.locator('.rs-corrected').evaluate(n=>getComputedStyle(n).animationName),'none');
 await phone.locator('[data-rs=pick]').click();await phone.locator('.rs-draw').waitFor();assert.equal(await phone.locator('.rs-draw-avatar img').count(),0,'Reduced-motion picker keeps a steady placeholder');
 await phone.waitForTimeout(500);assert.equal(await phone.locator('.rs-draw-name').textContent(),'Your next speaker');await phone.locator('.rs-speaker').waitFor();await display.locator('.rs-speaker').waitFor();
 assert.equal(await phone.locator('.rs-speaker-avatar').getAttribute('data-student'),await display.locator('.rs-speaker-avatar').getAttribute('data-student'),'Both devices reveal the same server-selected student');
 assert.equal((await db.query('select count(*)::int n from recitation_log')).rows[0].n,0,'Suspense still awards no points');
 phone.on('dialog',d=>d.accept());await phone.locator('[data-rs=finish]').click();await display.locator('.rs-summary').waitFor();assert.match(await display.locator('.rs-summary').textContent(),/Session complete/);
 await phone.locator('[data-rs=close]').click();await display.locator('[data-rs=close]').click();await phone.waitForTimeout(100);assert.deepEqual(errors,[]);assert.equal(await phone.locator('.rs-app').count(),0);assert.equal(await phone.locator('body').evaluate(n=>n.classList.contains('rs-open')),false);
 assert.deepEqual(errors,[]);console.log('PASS: real app, authenticated phone + projector backed by actual SQL; private notes, question/timer sync, no points on pick, mismatch, shared 2.4s suspense, saved embedded profile photos and live photo updates, square frames, manual +3 and undo, single confirmation animation, offline reload queue, seating/unseated, 320/390/768 layouts, reduced motion, summary and cleanup.');
 }finally{await browser?.close();if(server)await new Promise(r=>server.close(r));await db.close();}})().catch(e=>{console.error(e);process.exit(1)});
