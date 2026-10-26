// Self-hosted browser check. Uses fixture data
// with the real renderers; never authenticates or writes to Supabase.
const {chromium}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const acorn=require('acorn');
const assert=require('node:assert/strict');
const http=require('node:http');
const root=path.resolve(__dirname,'../..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
let dashboard;
for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
  const tree=acorn.parse(match[1],{ecmaVersion:'latest'});
  const fn=tree.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='renderStudentDashboard');
  if(fn)dashboard=match[1].slice(fn.start,fn.end);
}
(async()=>{
 const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':file.endsWith('.css')?'text/css':'text/plain'});res.end(error?'Not found':data);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const baseURL='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
 const page=await browser.newPage();await page.emulateMedia({reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(baseURL+'/',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html class="theme-nocturne"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${['base','modules/shop','modules/recitation','modules/world-boss','modules/notifications','modules/student-mobile','modules/nocturne','modules/color-modes','modules/student-learning'].map(p=>`<link rel="stylesheet" href="/styles/${p}.css" ${(p.endsWith('color-modes')||p.endsWith('student-learning'))?'data-preserve-theme':''}>`).join('')}</head><body><div id="main-app">${html.slice(html.indexOf('  <!-- TOP BAR -->'),html.indexOf('  <!-- MAIN CONTENT -->'))}<main id="main-content">${['s-dashboard','s-my-section','s-inventory','s-store','s-attendance','s-mail'].map(id=>`<div id="${id}" class="page active"></div>`).join('')}</main></div></body></html>`}));
 await page.goto(baseURL+'/');
 await page.evaluate(()=>{
 window.currentUser={id:'s1',name:'Alexandra Rivera Santos',init:'AR',color:'#a78bfa',tier:'Scholar',classId:'c1',xp:12345,coins:1500,level:12,attendance:96,quizAvg:88,completedQuizzes:[]};
 const items=Array.from({length:6},(_,i)=>({id:'item'+i,itemId:'item'+i,itemName:'Supercharged Knowledge Potion '+i,name:'Supercharged Knowledge Potion '+i,desc:'A helpful reward to boost your next classroom adventure.',cat:'supplies',category:'supplies',cost:100,stock:10,quantity:2,emoji:'🧪',datePurchased:'2026-10-25'}));
 const data={students:[currentUser],quizzes:[{id:'q',title:'Exploring the Scientific Method',desc:'Practise observation and experimentation.',timeLimit:10,xpReward:100,coinReward:20}],store:items,inventory:{s1:items},achievementUnlocks:{},quizSectionAssignments:{}};
 window.startQuiz=id=>window.lastQuest=id;window.navTo=id=>window.lastNav=id;
 data.pointLog=[{studentId:'s1',what:'Recitation contribution',pts:5,createdAt:'2026-10-26'}];
 data.achievementUnlocks={s1:[{claimed:false}]};
 window.DB=new Proxy(data,{get:(obj,key)=>obj[key]||[]});window.AppStore={getSlice:f=>f(DB),subscribe(){},emit(){}};
 window._esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');window._cssColor=s=>s;
 window.getLevel=x=>Math.floor(x/1000);window.XP_PER_LEVEL=1000;window.eqTimeAgo=()=> 'Today';window.updateTopbar=()=>{};
 window.getStudentAttendanceRecords=()=>[];window.computeAttendanceStreak=()=>({current:0,longest:0});
 });
 for(const file of ['dom.js','modules/shared/presentation.js','modules/section/my-section.js','modules/shop/shop_store.js','modules/shop/shop_inventory.js','modules/recitation/progress.js'])await page.addScriptTag({path:path.join(root,file)});
 await page.addScriptTag({content:dashboard});
 await page.evaluate(()=>{
 renderStudentDashboard();renderInventory();renderStudentStore();renderStudentProgress();
 document.getElementById('topbar-coin-val').textContent='1,500';document.getElementById('notif-wrap').style.display='block';
 document.getElementById('topbar-av').textContent='AR';document.getElementById('sb-name').textContent=currentUser.name;
 document.getElementById('sidebar-nav').innerHTML=['Overview','My Section','Quests','Armory','My Progress'].map((n,i)=>'<button class="'+(i?'':'active')+'">'+n+'</button>').join('');
 _mySectionPaint({section:{label:'Grade 10 — Science and Technology'},teacher:{displayName:'Professor Danielle Montgomery',quizCount:12,campaignWorldCount:4,shopProductCount:18,achievementCount:6},classmates:Array.from({length:8},(_,i)=>({id:'s'+i,displayName:'Alexandra Rivera Santos '+i,init:'AR',level:12,tier:'Scholar',xp:12345,color:'#a78bfa'}))});
 });

 await page.evaluate(()=>document.querySelectorAll('.page').forEach(el=>el.style.display=el.id==='s-dashboard'?'block':'none'));
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:1000});
  await page.waitForTimeout(400);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Overflow at '+width);
  assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundImage),'none');
  assert.equal(await page.locator('#s-dashboard .dash-hero').evaluate(el=>getComputedStyle(el).boxShadow),'none');
  assert.equal(await page.locator('#s-dashboard .quest-btn').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(242, 242, 242)');
  assert.equal(await page.locator('#s-dashboard .quest-btn').evaluate(el=>getComputedStyle(el).color),'rgb(17, 17, 17)');
  assert.ok(await page.locator('#s-dashboard .quest-btn').evaluate(el=>el.getBoundingClientRect().height>=44));
  assert.equal(await page.locator('#s-dashboard').evaluate(el=>/\p{Extended_Pictographic}/u.test(el.textContent)),true,'Emoji icons missing');
  await page.locator('#wb-topbar-widget').evaluate(el=>el.style.display='flex');
  assert.ok(await page.locator('#topbar').evaluate(el=>[...el.querySelectorAll('.topbar-right>div,.hamburger,.logo')].filter(n=>n.getBoundingClientRect().width).every(n=>n.getBoundingClientRect().right<=innerWidth+1)),'Header overflow with an active raid at '+width);
  await page.screenshot({path:`/workspace/monochrome-${width}.png`,fullPage:true});
 }
 await page.locator('#s-dashboard .quest-btn').focus();
 assert.equal(await page.locator('#s-dashboard .quest-btn').evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
 await page.locator('#s-dashboard .quest-btn').click();assert.equal(await page.evaluate(()=>lastQuest),'q');
 await page.locator('#s-dashboard .dash-hero-right .btn').click();assert.equal(await page.evaluate(()=>lastNav),'s-store');
 await page.locator('#s-dashboard .dashboard-alert button').click();assert.equal(await page.evaluate(()=>lastNav),'s-badges');
 assert.deepEqual(errors,[]);
 console.log('PASS: Nocturne overview and chrome at 320/390/768/1440px; black and white surfaces, local icons, touch targets, quest/Armory/reward actions, no page errors.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exit(1)});
