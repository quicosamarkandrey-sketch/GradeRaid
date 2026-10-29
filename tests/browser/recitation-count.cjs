// Actual app, offline fixture records; visual feedback never writes points.
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
    d.admin={...d.admin,id:'teacher',name:'Morgan Reyes'};
    d.students=[{id:'student',name:'Alex Rivera',init:'AR',classId:'class',xp:100,coins:100,completedQuizzes:[]}];
    d.classSections=[{id:'class',label:'Science 10',gradeLevel:'10',sectionName:'Science',adviserId:'teacher',isArchived:false}];
    d.classroomLayouts=[{id:'layout',classId:'class',name:'Science room',roomData:[],seatOverlapFixed:true}];
    d.seats=[{id:'seat',layoutId:'layout',xCoord:400,yCoord:300}];
    d.seatAssignments=[{id:'assignment',layoutId:'layout',seatId:'seat',studentId:'student'}];
    d.attendanceLogs=[{id:'att',studentId:'student',classId:'class',status:'On Time',logDate:isoDate()}];
    d.recitationLog=[{id:'rec',studentId:'student',classId:'class',pts:7,createdAt:new Date().toISOString()}];
   },{type:'fixture:seed'});
   DB=loadDB();currentRole='teacher';currentUser=AppStore.getState().admin;
   document.getElementById('boot-overlay')?.remove();document.getElementById('login-screen').style.display='none';document.getElementById('main-app').style.display='block';setupSidebar();updateTopbar();navTo('a-classroom-monitor');
   _lmRecitationMode=true;_lmSessionStartAt=new Date(Date.now()-60000).toISOString();
   _lmRender(document.getElementById('a-classroom-monitor'),getActiveClassIds(AppStore.getState()),AppStore.getState());
  });
  await page.waitForTimeout(400);
  const state=await page.evaluate(()=>JSON.stringify(AppStore.getState().recitationLog));
  for(const mode of ['dark','light']){
   await page.evaluate(mode=>UITheme.setMode(mode),mode);
   assert.ok(await page.locator('.lm-recitation-feed-pts').evaluate(el=>{const c=getComputedStyle(el).color.match(/\d+/g).map(Number);return Math.max(...c)-Math.min(...c)<=8;}),'History count is neutral');
   await page.evaluate(()=>_lmSpawnFloatingPoint('student',2));
   assert.equal(await page.locator('.lm-float-point').textContent(),'+2');
   assert.equal(await page.locator('.lm-recitation-badge').textContent(),'7','Animation must not change totals');
   assert.equal(await page.locator('.lm-float-point').evaluate(el=>getComputedStyle(el).textShadow),'none');
   assert.equal(await page.locator('.lm-float-point').evaluate(el=>getComputedStyle(el).webkitTextStrokeWidth),'0px');
   assert.ok(await page.locator('.lm-float-point').evaluate(el=>{
    const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});
    const lum=c=>c[0]*.2126+c[1]*.7152+c[2]*.0722,style=getComputedStyle(el),a=lum(rgb(style.color)),b=lum(rgb(style.backgroundColor));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5;
   }),'Award contrast in '+mode);
   await page.locator('.lm-float-point').evaluate(el=>{const a=el.getAnimations()[0];a.pause();a.currentTime=300;});
   await page.screenshot({path:`/workspace/recitation-count-${mode}.png`});
   await page.evaluate(()=>_lmSpawnFloatingPoint('student',1));
   assert.equal(await page.locator('.lm-float-point').count(),1,'Rapid awards must not overlap');
   assert.equal(await page.locator('.lm-float-point').textContent(),'+3');
   await page.waitForFunction(()=>!document.querySelector('.lm-float-point'),{},{timeout:2000});
   assert.equal(await page.locator('.lm-seat.lm-score-updated').count(),0);
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>_lmSpawnFloatingPoint('student',5));
  assert.equal(await page.locator('.lm-float-point').evaluate(el=>getComputedStyle(el).animationName),'none');
  assert.equal(await page.locator('.lm-recitation-badge').evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.waitForFunction(()=>!document.querySelector('.lm-float-point'),{},{timeout:2000});
  await page.evaluate(()=>{document.body.classList.add('lm-private-scores');_lmSpawnFloatingPoint('student',3);});
  assert.equal(await page.locator('.lm-float-point').count(),0,'Projection privacy suppresses score effects');
  await page.evaluate(()=>{document.body.classList.remove('lm-private-scores');_lmSpawnFloatingPoint('student',0);_lmSpawnFloatingPoint('student',-1);_lmSpawnFloatingPoint('missing',1);});
  assert.equal(await page.locator('.lm-float-point').count(),0);
  assert.equal(await page.evaluate(()=>JSON.stringify(AppStore.getState().recitationLog)),state);
  assert.deepEqual(errors,[]);
  console.log('PASS: monochrome award chip in both themes, contrast, rapid-award grouping, unchanged totals, cleanup, reduced motion and projection privacy; no backend writes.');
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exit(1)});
