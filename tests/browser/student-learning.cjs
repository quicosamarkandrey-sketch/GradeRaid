// Actual app with local fixture records; no hosted authentication or backend writes.
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
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},hasTouch:true}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.fulfill({contentType:'application/javascript',body:''}));
  await page.goto(origin);await page.waitForFunction(()=>window.AppStore&&AppStore.getState());
  await page.evaluate(()=>{
   AppStore.updateState(d=>{
    d.students=Array.from({length:26},(_,i)=>({id:'student'+i,name:i===25?'Alex Rivera':'Classmate '+(i+1),init:i===25?'AR':'C'+i,classId:'science',xp:3000-i*100,coins:150,level:2,tier:'Scholar',completedQuizzes:[],color:'#8b5cf6'}));
    d.students.push({id:'other-section',name:'Other section student',classId:'elsewhere',xp:999999,coins:10,level:100,completedQuizzes:[]});
    d.classSections=[{id:'science',label:'Grade 10 · Science',isArchived:false}];
    d.recitationLog=Array.from({length:25},(_,i)=>({id:'rec'+i,studentId:'student25',classId:'science',pts:i+1,note:i===24?'Latest contribution':'Contribution '+(i+1),when:'Just now',createdAt:`2026-10-${String(i+1).padStart(2,'0')}T18:30:00Z`}));
    d.recitationLog.push({id:'other-record',studentId:'other-section',pts:999,note:'Other student record',createdAt:'2026-10-26T12:00:00Z'});
    d.attendanceLogs=['On Time','Late','Absent','Excused'].map((status,i)=>({id:'att'+i,studentId:'student25',classId:'science',status,logDate:`2026-10-0${i+2}`}));
    d.leaderboardConfig={};d.quizzes=[];d.pointLog=[];
   },{type:'fixture:seed'});
   DB=loadDB();currentRole='student';currentUser=AppStore.getStudent('student25');
   document.getElementById('boot-overlay')?.remove();document.getElementById('login-screen').style.display='none';document.getElementById('main-app').style.display='block';setupSidebar();updateTopbar();navTo('s-dashboard');
  });
  await page.waitForTimeout(300);
  const original=await page.evaluate(()=>JSON.stringify({students:AppStore.getState().students,recitations:AppStore.getState().recitationLog,attendance:AppStore.getState().attendanceLogs,unlocks:AppStore.getState().achievementUnlocks}));
  assert.equal(await page.locator('[data-student-recitation=points]').textContent(),'325');
  assert.equal(await page.locator('[data-student-recitation=count]').textContent(),'25');
  assert.equal(await page.locator('#s-dashboard .dash-hero-stats').count(),0);
  await page.getByRole('button',{name:'View recitation history →',exact:true}).click();
  assert.ok(await page.locator('#prog-panel-recitation').isVisible());
  assert.equal(await page.locator('.prog-tabs .prog-tab').count(),5,'Original progress tabs restored');
  assert.equal(await page.locator('.rec-entry').count(),25);
  assert.ok(await page.locator('#prog-panel-milestones').count());
  assert.ok(await page.locator('#prog-panel-showcase').count());
  await page.evaluate(()=>navTo('s-dashboard'));
  await page.locator('.student-shortcut').filter({hasText:'My Progress'}).click();
  assert.ok(await page.locator('#prog-panel-streaks').isVisible());
  await page.evaluate(()=>navTo('s-dashboard'));
  await page.locator('.student-shortcut').filter({hasText:'Hall of Fame'}).click();
  assert.ok(await page.locator('.hol-cat-bar').isVisible(),'Original Hall of Fame restored');
  for(const mode of ['dark','light']){
   await page.evaluate(mode=>UITheme.setMode(mode),mode);
   for(const width of [320,390,1440]){
    await page.setViewportSize({width,height:1000});
    await page.evaluate(()=>navTo('s-dashboard'));await page.waitForTimeout(350);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Dashboard overflow');
    assert.equal(await page.locator('[data-student-recitation=points]').textContent(),'325');
    assert.equal(await page.locator('[data-student-recitation=count]').textContent(),'25');
   }
  }
  assert.equal(await page.evaluate(()=>JSON.stringify({students:AppStore.getState().students,recitations:AppStore.getState().recitationLog,attendance:AppStore.getState().attendanceLogs,unlocks:AppStore.getState().achievementUnlocks})),original,'Student records and awards must remain unchanged');
  assert.deepEqual(errors,[]);
  console.log('PASS: dashboard retained, direct history/overview links work with restored five-tab Progress, original Hall of Fame navigation restored; both themes at 320/390/1440; records unchanged.');
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exit(1)});
