// Actual app, offline fixture state; RPC writes are intercepted locally.
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
   const positions=[[170,180],[350,180],[650,300],[850,470],[200,650],[1000,650]];
   AppStore.updateState(d=>{
    d.admin={...d.admin,id:'teacher',name:'Morgan Reyes'};
    d.students=['Alex','Bea','Chris','Dee','Eli','Fran'].map((name,i)=>({id:'s'+i,name,init:name[0],classId:'class',xp:1200,coins:100,completedQuizzes:[]}));
    d.classSections=[{id:'class',label:'Science 10',adviserId:'teacher',isArchived:false}];
    d.classroomLayouts=[{id:'layout',classId:'class',name:'Science room',roomData:[],seatOverlapFixed:true}];
    d.seats=positions.map(([xCoord,yCoord],i)=>({id:'seat'+i,layoutId:'layout',xCoord,yCoord,rotation:0,isLocked:false}));
    d.seatAssignments=positions.slice(0,5).map((_,i)=>({id:'a'+i,layoutId:'layout',seatId:'seat'+i,studentId:'s'+i}));
    d.attendanceLogs=['On Time','Late','Absent','Excused'].map((status,i)=>({id:'log'+i,classId:'class',studentId:'s'+i,logDate:isoDate(),status}));
   },{type:'fixture:seed'});
   DB=loadDB();currentRole='teacher';currentUser=AppStore.getState().admin;
   document.getElementById('boot-overlay')?.remove();document.getElementById('login-screen').style.display='none';document.getElementById('main-app').style.display='block';setupSidebar();updateTopbar();
   window.rpcCalls=[];window.rejectMove=false;
   DBService.rpc=async (rpc,args)=>{
    rpcCalls.push({rpc,args});
    if(rpc!=='manual_move_student')return {data:{},error:null};
    if(rejectMove)return {data:null,error:{message:'Fixture rejected assignment'}};
    const all=AppStore.getState().seatAssignments;
    const source=all.find(a=>a.layoutId===args.p_layout_id && a.studentId===args.p_student_id);
    const dest=all.find(a=>a.layoutId===args.p_layout_id && a.seatId===args.p_target_seat_id);
    const affected=[];
    if(source)affected.push({seat_id:source.seatId,student_id:dest?.studentId||null});
    if(args.p_target_seat_id)affected.push({seat_id:args.p_target_seat_id,student_id:args.p_student_id});
    return {data:{affected,swapped:!!(source&&dest)},error:null};
   };
   navTo('a-classroom-monitor');
  });
  await page.waitForTimeout(500);
  const immutable=await page.evaluate(()=>JSON.stringify({seats:AppStore.getState().seats,logs:AppStore.getState().attendanceLogs}));
  assert.equal(await page.locator('[data-status=Present] strong').textContent(),'1');
  assert.equal(await page.locator('[data-status=Unscanned] strong').textContent(),'2');
  const candidates=await page.evaluate(()=>ClassroomService.getColdCallCandidates('class','layout').map(s=>s.studentId));
  await page.locator('[data-status=Late]').click();
  assert.equal(await page.locator('.lm-filter-match').getAttribute('data-student-id'),'s1');
  assert.equal(await page.locator('.lm-filter-muted').count(),5);
  assert.deepEqual(await page.evaluate(()=>ClassroomService.getColdCallCandidates('class','layout').map(s=>s.studentId)),candidates);
  await page.locator('[data-status=Unscanned]').click();
  assert.match(await page.locator('#lm-filter-summary').textContent(),/1 seated · 1 without a seat/);
  await page.locator('[data-status=All]').click();
  await page.locator('#lm-fullscreen-btn').click();await page.waitForTimeout(300);
  async function centered(){
   const value=await page.locator('#lm-canvas-wrap').evaluate(w=>{const r=w.getBoundingClientRect(),s=[...w.querySelectorAll('.lm-seat')].map(e=>e.getBoundingClientRect());return {dx:(Math.min(...s.map(s=>s.left))+Math.max(...s.map(s=>s.right)))/2-(r.left+r.right)/2,dy:(Math.min(...s.map(s=>s.top))+Math.max(...s.map(s=>s.bottom)))/2-(r.top+r.bottom)/2,fits:s.every(s=>s.left>=r.left&&s.right<=r.right&&s.top>=r.top&&s.bottom<=r.bottom)};});
   assert.ok(Math.abs(value.dx)<2&&Math.abs(value.dy)<2,JSON.stringify(value));assert.ok(value.fits);
  }
  await centered();
  const fit=await page.locator('#lm-canvas').getAttribute('style');
  await page.locator('[data-lm-action=in]').click();assert.equal(await page.locator('#lm-zoom-label').textContent(),'115%');
  assert.notEqual(await page.locator('#lm-canvas').getAttribute('style'),fit);
  const wrap=await page.locator('#lm-canvas-wrap').boundingBox();
  await page.mouse.move(wrap.x+10,wrap.y+10);await page.mouse.down();await page.mouse.move(wrap.x+70,wrap.y+40);await page.mouse.up();
  await page.locator('[data-lm-action=fit]').click();await centered();
  await page.evaluate(()=>{_lmRecitationMode=true;_lmSessionStartAt=new Date().toISOString();_lmRender(document.getElementById('a-classroom-monitor'),getActiveClassIds(AppStore.getState()),AppStore.getState());});
  await page.locator('[data-lm-action=projection]').click();await centered();
  assert.equal(await page.locator('#lm-sidebar').isVisible(),false);
  assert.equal(await page.locator('.lm-recitation-badge').first().isVisible(),false);
  await page.locator('#lm-show-scores').check();assert.equal(await page.locator('.lm-recitation-badge').first().isVisible(),true);
  await page.locator('#lm-show-scores').uncheck();
  for(const width of [390,1440]){
   await page.setViewportSize({width,height:1000});await page.waitForTimeout(200);await centered();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.screenshot({path:`/workspace/projection-${width}.png`,fullPage:true});
  }
  assert.equal(await page.evaluate(()=>JSON.stringify({seats:AppStore.getState().seats,logs:AppStore.getState().attendanceLogs})),immutable);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#lm-sidebar').isVisible(),true);
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.body.classList.contains('lm-kiosk-mode')),false);
  await page.evaluate(()=>{_lmRecitationMode=false;_lmSessionStartAt=null;navTo('a-classroom');});await page.waitForTimeout(300);
  await page.evaluate(()=>{_cbSelectedSeatIds=new Set(['seat0','seat1','seat2']);_cbEditorToolbar();});
  const draft=await page.evaluate(()=>JSON.stringify(_cbLocalSeats));
  await page.locator('[data-editor=align]').selectOption('left');
  assert.deepEqual(await page.evaluate(()=>_cbLocalSeats.slice(0,3).map(s=>s.xCoord)),[170,170,170]);
  await page.locator('[data-editor=undo]').click();assert.equal(await page.evaluate(()=>JSON.stringify(_cbLocalSeats)),draft);
  await page.evaluate(()=>{_cbSelectedSeatIds=new Set(['seat0','seat1','seat2']);_cbEditorToolbar();});
  await page.locator('[data-editor=align]').selectOption('space-x');
  assert.deepEqual(await page.evaluate(()=>_cbLocalSeats.slice(0,3).map(s=>s.xCoord)),[170,410,650]);
  await page.locator('[data-editor=undo]').click();
  await page.locator('[data-editor=snap]').click();
  async function point(x,y){return page.locator('#cb-canvas').evaluate((el,p)=>{const r=el.getBoundingClientRect();return {x:r.left+p.x*r.width/1200,y:r.top+p.y*r.height/800};},{x,y});}
  const start=await point(170,180),end=await point(219,227);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:6});
  assert.equal(await page.locator('.cb-snap-guide').count(),2);
  await page.mouse.up();assert.deepEqual(await page.evaluate(()=>[_cbLocalSeats[0].xCoord,_cbLocalSeats[0].yCoord]),[220,220]);
  await page.locator('[data-editor=undo]').click();
  await page.evaluate(()=>window._cbSetMode('assign'));
  const assignments=()=>page.evaluate(()=>AppStore.getState().seatAssignments.map(a=>[a.seatId,a.studentId]).sort());
  const original=await assignments();
  const seat=id=>page.locator(`.cb-seat[data-seat-id="seat${id}"]`);
  await seat(0).click();assert.deepEqual(await assignments(),original,'Selecting must not unseat');
  await seat(1).click();await page.waitForFunction(()=>rpcCalls.some(c=>c.rpc==='manual_move_student'));
  assert.equal(await seat(1).getAttribute('data-student-id'),'s0');assert.equal(await seat(0).getAttribute('data-student-id'),'s1');
  // Actual pointer drag, with a preview of the occupied destination.
  const source=await seat(1).boundingBox(),target=await seat(2).boundingBox();
  await page.mouse.move(source.x+source.width/2,source.y+source.height/2);await page.mouse.down();await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:8});
  assert.match(await page.locator('.cb-assignment-ghost').textContent(),/Swap with Chris/);
  assert.equal(await seat(2).evaluate(e=>e.classList.contains('cb-swap-target')),true);
  await page.mouse.up();await page.waitForTimeout(100);
  assert.equal(await seat(2).getAttribute('data-student-id'),'s0');assert.equal(await seat(1).getAttribute('data-student-id'),'s2');
  // Touch pointer sequence follows the same move/swap path and updates assignments.
  const cdp=await page.context().newCDPSession(page),t1=await seat(2).boundingBox(),t2=await seat(5).boundingBox();
  const touch=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]});
  await touch('touchStart',t1.x+t1.width/2,t1.y+t1.height/2);await touch('touchMove',t2.x+t2.width/2,t2.y+t2.height/2);await touch('touchEnd');await page.waitForTimeout(100);
  assert.equal(await seat(5).getAttribute('data-student-id'),'s0');assert.equal(await seat(2).getAttribute('data-student-id'),'');
  await page.waitForTimeout(650);
  await page.evaluate(()=>rejectMove=true);
  const beforeFailedMove=await assignments();
  await seat(0).click();await seat(2).click();await page.waitForTimeout(100);
  assert.deepEqual(await assignments(),beforeFailedMove,'Rejected save must retain assignments');
  await page.evaluate(()=>rejectMove=false);await page.locator('[data-placement=cancel]').click();
  await seat(0).focus();await page.keyboard.press('Enter');await seat(2).focus();await page.keyboard.press('Enter');await page.waitForTimeout(100);
  assert.equal(await seat(2).getAttribute('data-student-id'),'s1');
  assert.ok(await page.evaluate(()=>rpcCalls.filter(c=>c.rpc==='manual_move_student').every(c=>c.args.p_layout_id==='layout')));
  assert.equal(await page.evaluate(()=>document.body.classList.contains('lm-projection-mode')),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: attendance highlights, roster totals, centered fullscreen, zoom/pan/fit, private projection, resize, alignment and undo, snapped drag, safe click selection, mouse/touch swaps, keyboard moves, rejected save; no backend writes.');
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exit(1)});
