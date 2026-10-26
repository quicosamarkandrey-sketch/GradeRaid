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
  assert.equal(await page.locator('.learning-tabs [role=tab]').count(),3);
  assert.equal(await page.locator('#student-recitation-history li').count(),20);
  assert.match(await page.locator('#student-recitation-history li').first().textContent(),/Latest contribution.*Oct 26, 2026.*25 pts/);
  await page.getByRole('button',{name:'Show more',exact:true}).click();assert.equal(await page.locator('#student-recitation-history li').count(),25);
  assert.equal(await page.locator('#s-attendance .milestone-grid,#s-attendance .showcase-header').count(),0);
  await page.getByRole('tab',{name:'Overview',exact:true}).click();
  assert.equal(await page.locator('.learning-metric strong').first().textContent(),'67%');
  await page.getByRole('tab',{name:'Attendance',exact:true}).click();
  await page.evaluate(()=>{progCalYear=2026;progCalMonth=9;document.getElementById('prog-panel-calendar').innerHTML=progRenderCalendarPanel(currentUser);});
  // The record at 18:30 UTC belongs to the following Philippine calendar day.
  assert.ok(await page.evaluate(()=>progBuildCalendar(currentUser.id,2026,9)[2].recitations.some(r=>r.id==='rec0')));
  await page.getByRole('button',{name:'October 3, 2026: Late',exact:true}).click();assert.match(await page.locator('#cal-day-detail').textContent(),/Late/);
  await page.getByRole('button',{name:'October 5, 2026: Excused',exact:true}).click();assert.match(await page.locator('#cal-day-detail').textContent(),/Excused/);
  await page.getByRole('button',{name:'Previous month',exact:true}).click();assert.match(await page.locator('.cal-month-label').textContent(),/September 2026/);
  await page.getByRole('button',{name:'Next month',exact:true}).click();
  await page.getByRole('tab',{name:'Overview',exact:true}).focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#progress-tab-calendar').getAttribute('aria-selected'),'true');
  await page.evaluate(()=>navTo('s-leaderboard'));
  assert.equal(await page.locator('#student-rank-category option').count(),4);
  assert.match(await page.locator('.student-standing').textContent(),/#26/);
  assert.equal(await page.getByText('Other section student',{exact:true}).count(),0);
  assert.equal(await page.locator('.student-rank-row').count(),10);
  await page.getByRole('button',{name:'Next →',exact:true}).click();await page.getByRole('button',{name:'Next →',exact:true}).click();assert.equal(await page.locator('.student-rank-row.is-you').count(),1);
  await page.locator('#student-rank-category').selectOption('recitation');
  assert.match(await page.locator('.student-standing').textContent(),/#1.*325 pts/);
  await page.locator('#student-rank-period').selectOption('monthly');assert.equal(await page.locator('#student-rank-period').inputValue(),'monthly');
  await page.evaluate(()=>{AppStore.updateState(d=>{d.leaderboardConfig.recitation={enabled:false};},{type:'fixture:disabled'});renderLeaderboard('recitation','all');});
  assert.match(await page.locator('#s-leaderboard').textContent(),/Rankings are currently unavailable/);
  await page.evaluate(()=>AppStore.updateState(d=>{d.leaderboardConfig={};},{type:'fixture:enabled'}));
  // Tied scores retain the same rank.
  await page.evaluate(()=>{AppStore.updateState(d=>{d.students[1].xp=d.students[0].xp;},{type:'fixture:tie'});renderLeaderboard('hall','all');});
  assert.deepEqual(await page.locator('.student-rank-position').evaluateAll(els=>els.slice(0,2).map(el=>el.textContent)),['#1','#1']);
  await page.evaluate(()=>AppStore.updateState(d=>{d.students[1].xp=2900;},{type:'fixture:restore'}));
  for(const mode of ['dark','light']){
   await page.evaluate(mode=>UITheme.setMode(mode),mode);
   for(const width of [320,390,1440]){
    await page.setViewportSize({width,height:1000});
    for(const id of ['s-dashboard','s-attendance','s-leaderboard']){
     await page.evaluate(id=>{if(id==='s-attendance')progActiveTab='streaks';navTo(id);},id);await page.waitForTimeout(350);
     assert.ok(await page.locator('#'+id).isVisible());
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),id+' '+mode+' '+width+' overflow');
     await page.screenshot({path:`/workspace/student-clean-${id}-${mode}-${width}.png`,fullPage:true});
    }
   }
  }
  assert.equal(await page.evaluate(()=>JSON.stringify({students:AppStore.getState().students,recitations:AppStore.getState().recitationLog,attendance:AppStore.getState().attendanceLogs,unlocks:AppStore.getState().achievementUnlocks})),original,'Presentation must not alter student records or awards');
  // No records should never imply a 0% attendance rate or a fabricated first rank.
  await page.evaluate(()=>{currentUser={id:'new-student',classId:'science',name:'New student'};progActiveTab='streaks';navTo('s-attendance');});
  assert.equal(await page.locator('.learning-metric strong').first().textContent(),'—');
  assert.match(await page.locator('#s-attendance').textContent(),/No attendance records yet/);
  await page.getByRole('tab',{name:'Participation',exact:true}).click();assert.match(await page.locator('#s-attendance').textContent(),/No participation recorded yet/);
  await page.evaluate(()=>renderLeaderboard('recitation','all'));assert.match(await page.locator('.student-standing').textContent(),/Not ranked yet/);
  assert.deepEqual(errors,[]);
  console.log('PASS: dashboard totals and direct history link; three progress tabs; history sorting/pagination; attendance rate, late/excused calendar and timezone; keyboard tabs; section rankings, personal standing, ties, periods, pagination, disabled/empty states; all three pages at 320/390/1440 in both themes; records unchanged.');
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exit(1)});
