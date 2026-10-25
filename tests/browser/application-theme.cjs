// Full application, local fixture data, all three roles. External services are
// blocked: this check never authenticates or writes to a hosted backend.
const {chromium}=require('@playwright/test');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
(async()=>{
 const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html'});res.end(error?'Not found':data);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.fulfill({contentType:'application/javascript',body:''}));
  await page.goto(origin);await page.waitForFunction(()=>window.AppStore&&AppStore.getState());
  await page.evaluate(()=>{
   AppStore.updateState(draft=>{
    draft.admin={...draft.admin,id:'fixture-teacher',name:'Morgan Reyes'};
    draft.students=[{id:'fixture-student',name:'Alex Rivera',init:'AR',classId:'fixture-class',tier:'Scholar',level:1,xp:1200,coins:250,color:'#8b5cf6',completedQuizzes:[],attendance:100,quizAvg:85}];
    draft.classSections=[{id:'fixture-class',label:'Science 10',adviserId:'fixture-teacher',isArchived:false}];
    draft.classroomLayouts=[{id:'fixture-layout',classId:'fixture-class',name:'Main classroom',roomData:[],seatOverlapFixed:true}];
    draft.seats=[{id:'fixture-seat',layoutId:'fixture-layout',xCoord:240,yCoord:240,rotation:0,isLocked:false}];
    draft.seatAssignments=[{id:'fixture-assignment',layoutId:'fixture-layout',seatId:'fixture-seat',studentId:'fixture-student'}];
    draft.attendanceLogs=[{id:'fixture-att',classId:'fixture-class',studentId:'fixture-student',logDate:isoDate(),status:'On Time'}];
   },{type:'fixture:seed'});
   DB=loadDB();
   document.getElementById('boot-overlay')?.remove();
   document.getElementById('login-screen').style.display='none';
   document.getElementById('main-app').style.display='block';
  });
  const routes={admin:['a-dashboard','a-sections','a-store','a-quizzes','a-classroom','a-classroom-monitor','a-scanner','a-settings'],teacher:['a-dashboard','a-sections','a-store','a-classroom','a-classroom-monitor'],student:['s-dashboard','s-my-section','s-inventory','s-store','s-attendance','s-quizzes','s-world-boss','s-badges','s-mail','s-orders','s-leaderboard']};
  let count=0;
  for(const [role,ids] of Object.entries(routes)){
   await page.evaluate(role=>{currentRole=role;currentUser=AppStore.getSlice(s=>role==='student'?s.students[0]:s.admin);setupSidebar();updateTopbar();},role);
   for(const width of [390,1440]){
    await page.setViewportSize({width,height:1000});await page.waitForTimeout(350);
    for(const id of ids){
     await page.evaluate(id=>navTo(id),id);await page.waitForTimeout(80);
     assert.ok(await page.locator('#'+id).isVisible(),role+': '+id+' not visible');
     assert.ok(await page.locator('#'+id).evaluate(el=>el.textContent.trim().length>0),id+' empty');
     assert.equal(await page.locator('#sidebar .material-symbols-outlined').evaluateAll(nodes=>nodes.every(el=>el.querySelector('svg'))),true,'Icon-font dependency in navigation');
     if(id==='a-dashboard'||id==='s-dashboard')await page.screenshot({path:`/workspace/warm-${role}-${width}.png`,fullPage:true});
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),role+' '+id+' overflows at '+width);
     count++;
    }
   }
  }
  // Presentation is idempotent and does not rewrite fields, user prose,
  // uploaded photos, selected values, or attendance status colors.
  await page.evaluate(()=>{
   const el=document.createElement('section');el.id='theme-probe';
   el.innerHTML='<h2>📊 Reports</h2><button><span class="material-symbols-outlined">settings</span> Settings</button><span class="student-name">⭐ Alex</span><textarea>🔥 Draft message</textarea><select><option value="keep">📦 Saved option</option></select><img alt="Uploaded photo" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E"><div class="avatar" style="color:#8b5cf6">AR</div><div class="lm-seat" style="border-color:rgb(78,222,163)"></div>';
   document.body.append(el);UIPresentation.refresh(el);
   const style=document.createElement('style');style.id='theme-injection-probe';style.textContent='.theme-legacy-probe{background:rgb(35,31,56);color:#d0bcff}';document.head.append(style);
   const probe=document.createElement('div');probe.className='theme-legacy-probe';el.append(probe);
  });
  assert.ok(await page.locator('#theme-probe h2 svg').count());
  assert.equal(await page.locator('#theme-probe .student-name').textContent(),'⭐ Alex');
  assert.equal(await page.locator('#theme-probe textarea').inputValue(),'🔥 Draft message');
  assert.equal(await page.locator('#theme-probe select').inputValue(),'keep');
  assert.equal(await page.locator('#theme-probe img').getAttribute('alt'),'Uploaded photo');
  assert.equal(await page.locator('#theme-probe .avatar').evaluate(el=>el.style.color),'rgb(139, 92, 246)');
  assert.equal(await page.locator('#theme-probe .lm-seat').evaluate(el=>el.style.borderColor),'rgb(78, 222, 163)');
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.theme-legacy-probe')).color==='rgb(228, 198, 140)');
  const before=await page.locator('#theme-probe').innerHTML();
  await page.evaluate(()=>UIPresentation.refresh(document.getElementById('theme-probe')));
  assert.equal(await page.locator('#theme-probe').innerHTML(),before);
  assert.deepEqual(errors,[]);
  console.log(`PASS: ${count} full-app page visits across admin, teacher, student and two widths; offline SVG navigation; user content and attendance colors preserved; no page errors.`);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exit(1)});
