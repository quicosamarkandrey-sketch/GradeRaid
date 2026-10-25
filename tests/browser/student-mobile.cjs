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
 await page.route(baseURL+'/',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html class="theme-nocturne"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${['base','modules/shop','modules/recitation','modules/student-mobile','modules/nocturne'].map(p=>`<link rel="stylesheet" href="/styles/${p}.css">`).join('')}<style>.material-symbols-outlined{display:inline-block;width:20px;flex-shrink:0;font-size:0!important}.material-symbols-outlined::before{content:'◆';font-size:14px}</style></head><body>${['s-dashboard','s-my-section','s-inventory','s-store','s-attendance','s-mail'].map(id=>`<div id="${id}" class="page active"></div>`).join('')}</body></html>`}));
 await page.goto(baseURL+'/');
 await page.evaluate(()=>{
 window.currentUser={id:'s1',name:'Alexandra Rivera Santos',init:'AR',color:'#a78bfa',tier:'Scholar',classId:'c1',xp:12345,coins:1500,level:12,attendance:96,quizAvg:88,completedQuizzes:[]};
 const items=Array.from({length:6},(_,i)=>({id:'item'+i,itemId:'item'+i,itemName:'Supercharged Knowledge Potion '+i,name:'Supercharged Knowledge Potion '+i,desc:'A helpful reward to boost your next classroom adventure.',cat:'supplies',category:'supplies',cost:100,stock:10,quantity:2,emoji:'🧪',datePurchased:'2026-10-25'}));
 const data={students:[currentUser],quizzes:[{id:'q',title:'Exploring the Scientific Method',desc:'Practise observation and experimentation.',timeLimit:10,xpReward:100,coinReward:20}],store:items,inventory:{s1:items},achievementUnlocks:{},quizSectionAssignments:{}};
 window.DB=new Proxy(data,{get:(obj,key)=>obj[key]||[]});window.AppStore={getSlice:f=>f(DB),subscribe(){},emit(){}};
 window._esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');window._cssColor=s=>s;
 window.getLevel=x=>Math.floor(x/1000);window.XP_PER_LEVEL=1000;window.eqTimeAgo=()=> 'Today';window.updateTopbar=()=>{};
 window.getStudentAttendanceRecords=()=>[];window.computeAttendanceStreak=()=>({current:0,longest:0});
 });
 for(const file of ['dom.js','modules/section/my-section.js','modules/shop/shop_store.js','modules/shop/shop_inventory.js','modules/recitation/progress.js'])await page.addScriptTag({path:path.join(root,file)});
 await page.addScriptTag({content:dashboard});
 await page.evaluate(()=>{
 renderStudentDashboard();renderInventory();renderStudentStore();renderStudentProgress();
 _mySectionPaint({section:{label:'Grade 10 — Science and Technology'},teacher:{displayName:'Professor Danielle Montgomery',quizCount:12,campaignWorldCount:4,shopProductCount:18,achievementCount:6},classmates:Array.from({length:8},(_,i)=>({id:'s'+i,displayName:'Alexandra Rivera Santos '+i,init:'AR',level:12,tier:'Scholar',xp:12345,color:'#a78bfa'}))});
 });
 const pages=['s-dashboard','s-my-section','s-inventory','s-store','s-attendance'];
 const heights=[];
 assert.ok(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--fh').includes('Segoe UI')),'Sans-serif font not applied');
 await page.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<div id="modal-overlay" class="modal-overlay" style="display:none"><div id="modal-box" class="modal-box md"><div id="modal-content"></div></div></div><div id="toast" style="display:none"></div>'));
 for(const width of [320,375,390,430,640,1280]){
  await page.setViewportSize({width,height:844});
  for(const id of pages){
   await page.evaluate(id=>document.querySelectorAll('.page').forEach(el=>el.style.display=el.id===id?'block':'none'),id);
   const result=await page.evaluate(id=>{const el=document.getElementById(id);return {width:document.documentElement.scrollWidth,height:el.getBoundingClientRect().height};},id);
   if(result.width>width+1) console.log(await page.locator('#'+id).evaluate(el=>[...el.querySelectorAll('*')].filter(n=>n.getBoundingClientRect().right>innerWidth+1).map(n=>({tag:n.tagName,cls:n.className,style:n.getAttribute('style'),right:n.getBoundingClientRect().right})).slice(0,15)));
   assert.ok(result.width<=width+1,`${id} overflows at ${width}: ${result.width}`);
   if(width===1280){
    await page.evaluate(()=>document.querySelector('link[href*="student-mobile"]').disabled=true);
    const beforeDesktop=await page.locator('#'+id).evaluate(el=>el.getBoundingClientRect().height);
    await page.evaluate(()=>document.querySelector('link[href*="student-mobile"]').disabled=false);
    assert.ok(Math.abs(result.height-beforeDesktop)<1,'Desktop layout changed: '+id);
   }
   if(width===390){
    if(id!=='s-dashboard')assert.equal(await page.locator('#'+id).evaluate(el=>/\p{Extended_Pictographic}/u.test(el.textContent)),false,'Decorative emoji remains on '+id);
    const after=result.height;
    await page.evaluate(()=>document.querySelector('link[href*="student-mobile"]').disabled=true);
    const before=await page.locator('#'+id).evaluate(el=>el.getBoundingClientRect().height);
    await page.evaluate(()=>document.querySelector('link[href*="student-mobile"]').disabled=false);
    heights.push({page:id,before:Math.round(before),after:Math.round(after)});
    await page.screenshot({path:`/workspace/${id}-mobile.png`,fullPage:true});
   }
  }
 }
 // Every progress panel must fit, including its wide calendar and history.
 await page.setViewportSize({width:320,height:844});
 await page.evaluate(()=>document.querySelectorAll('.page').forEach(el=>el.style.display=el.id==='s-attendance'?'block':'none'));
 for(const tab of ['calendar','recitation','milestones','showcase']){
  await page.evaluate(tab=>progSwitchTab(tab),tab);
  if(await page.evaluate(()=>document.documentElement.scrollWidth>321)) console.log(tab,await page.locator('#s-attendance .prog-panel.active').evaluate(el=>[...el.querySelectorAll('*')].filter(n=>n.getBoundingClientRect().right>321).slice(0,8).map(n=>({cls:n.className,style:n.getAttribute('style'),width:n.getBoundingClientRect().width}))));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=321),'Progress tab overflow: '+tab);
  assert.equal(await page.locator('#s-attendance .prog-panel.active').evaluate(el=>/\p{Extended_Pictographic}/u.test(el.textContent)),false,'Progress emoji: '+tab);
 }
 await page.evaluate(()=>document.querySelectorAll('.page').forEach(el=>el.style.display=el.id==='s-inventory'?'block':'none'));
 await page.locator('#inv-search').fill('no-such-item');assert.equal(await page.locator('.inv-card').count(),0);
 await page.locator('#inv-search').fill('');assert.equal(await page.locator('.inv-card').count(),6);
 await page.locator('#invtab-history').click();assert.equal(await page.locator('#inv-panel-history').isVisible(),true);
 await page.evaluate(()=>invSwitchTab('items'));
 await page.locator('.inv-detail-btn').first().click();
 assert.equal(await page.locator('#modal-overlay').isVisible(),true);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=321),'Item detail overflows');
 await page.evaluate(()=>closeModalForce());
 await page.evaluate(()=>{document.querySelectorAll('.page').forEach(el=>el.style.display=el.id==='s-store'?'block':'none');renderStudentStore();});
 await page.locator('.store-redeem-btn').first().click();
 assert.equal(await page.evaluate(()=>_cartCount()),1);
 await page.evaluate(()=>cartOpenModal());
 assert.equal(await page.locator('#modal-overlay').isVisible(),true);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=321),'Cart overflows');
 await page.evaluate(()=>closeModalForce());
 await page.evaluate(()=>posShowClaimCode('ABC-234-XYZ',{name:'Classroom reward',cat:'supplies'},'order-1'));
 assert.equal(await page.locator('#pos-claim-display').textContent(),'ABC-234-XYZ');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=321),'Claim code overflows');
 await page.evaluate(()=>closeModalForce());
 assert.equal(await page.evaluate(()=>uiIcon('<img onerror=alert(1)>').includes('<img')),false);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify(heights));console.log('PASS: five real page renderers at six widths; all progress tabs at 320px; no horizontal page overflow or page errors.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exit(1)});
