// Real app integration; all external calls are intercepted locally.
const {chromium}=require('@playwright/test'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+(req.url==='/'?'/index.html':req.url.split('?')[0]));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(e,data)=>{res.writeHead(e?404:200,{'Content-Type':file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html'});res.end(e?'Missing':data);});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.fulfill({contentType:'application/javascript',body:''}));
 await page.goto(origin);await page.waitForFunction(()=>window.LearningRewards&&window.AppStore);
 await page.evaluate(async()=>{
  AppStore.updateState(d=>{d.students=[{id:'student',name:'Alex',init:'A',classId:'class',coins:100,xp:0,completedQuizzes:[]}];d.store=[{id:'book',name:'Notebook',emoji:'📘',cat:'supplies',cost:20,stock:2,active:true}];d.inventory={};d.orders=[];d.redemptions=[];});
  currentUser=AppStore.getStudent('student');currentRole='student';window.fixtureCalls=[];
  DBService.rpc=async(name,args)=>{fixtureCalls.push(name);if(name==='learning_reward_status')return {data:{version:1,enabled:true}};
   if(name==='learning_reward_wallet')return {data:{profile:{id:'student',coins:100,xp:0},todayRecitationCoins:0}};
   if(name==='checkout_learning_rewards')return {data:{total:20,wallet:{profile:{id:'student',coins:80,xp:0}},orders:[{order_id:'order',student_id:'student',item_name:'Notebook',claim_code:'TESTCODE12',status:'pending',cost:20}],inventory:[{item_id:'book',item_name:'Notebook',quantity:1,category:'supplies',status:'active'}],stock:{book:1}}};
   return {data:null,error:{code:'PGRST202'}};};
  document.getElementById('boot-loading').style.display='none';document.getElementById('login-screen').style.display='none';document.getElementById('main-app').style.display='flex';
  await LearningRewards.ready(true);navTo('s-store');
 });
 for(const mode of ['dark','light']){
  await page.evaluate(mode=>UITheme.setMode(mode),mode);await page.getByRole('button',{name:'How to earn coins',exact:true}).click();
  await page.getByRole('heading',{name:'How learning rewards work'}).waitFor();
  assert.match(await page.locator('.learning-reward-table').textContent(),/Attendance streak/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:`/workspace/rewards-guide-${mode}.png`});await page.evaluate(()=>closeModalForce());
 }
 await page.evaluate(async()=>{cartAdd('book');await cartCheckout();});
 await page.getByRole('heading',{name:'Your rewards are reserved'}).waitFor();assert.match(await page.locator('.learning-claim-code').textContent(),/TESTCODE12/);
 assert.equal(await page.evaluate(()=>currentUser.coins),80);assert.equal(await page.evaluate(()=>AppStore.getStudent('student').coins),80);
 assert.equal(await page.evaluate(()=>fixtureCalls.filter(n=>n==='checkout_learning_rewards').length),1);
 await page.evaluate(async()=>{
  closeModalForce();const prior=DBService.rpc;
  DBService.rpc=async(name,args)=>{
   if(name==='adjust_student_stats'){if(args.p_coins_delta!==0)throw new Error('Unexpected legacy coin payout');return {data:{id:'student',coins:80,xp:100,level:0,tier:'Novice'}};}
   if(name==='record_learning_quest'){fixtureCalls.push(name);return {data:{coinsEarned:20,wallet:{profile:{id:'student',coins:100,xp:100,level:0,tier:'Novice'}}}};}
   return prior(name,args);
  };
  activeQuiz={id:'quest',title:'Learning test',xpReward:100,coinReward:20,questions:[{type:'id',answer:'correct'}]};quizAnswers=['correct'];quizFinishing=false;quizAttemptNumber=1;quizComboMax=0;
  await finishQuiz();
 });
 assert.equal(await page.evaluate(()=>fixtureCalls.filter(n=>n==='record_learning_quest').length),1);
 assert.equal(await page.evaluate(()=>AppStore.getStudent('student').coins),100);
 assert.match(await page.locator('.results-bonus-row').textContent(),/\+20 coins/);
 assert.deepEqual(errors,[]);console.log('PASS: real app reward guide in both themes on mobile; atomic checkout renders server claim code and authoritative balance without double deduction; completed quest uses one new settlement and no legacy coin delta.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
