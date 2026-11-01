const {chromium}=require('@playwright/test'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+(req.url==='/'?'/index.html':req.url.split('?')[0]));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(e,data)=>{res.writeHead(e?404:200,{'Content-Type':file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html'});res.end(e?'Missing':data);});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.fulfill({contentType:'application/javascript',body:''}));await page.goto(origin);await page.waitForFunction(()=>window.eqRewardPresent&&window.AppStore);
 await page.evaluate(()=>{window.rewardClosed=0;const trigger=document.createElement('button');trigger.id='reward-test-trigger';trigger.textContent='Open rewards';document.body.appendChild(trigger);trigger.focus();});
 const original=await page.evaluate(()=>JSON.stringify(AppStore.getState()));
 const open=()=>page.evaluate(()=>eqRewardPresent({title:'A little effort, well rewarded.',subtitle:'Inside the living cell · Quest complete',rarity:'Legendary',source:'quest',icon:'🏆',rewards:[{type:'xp',amount:120,label:'Experience',icon:'⚡',color:'#ff8800'},{type:'coins',amount:20,label:'Coins',icon:'🪙',color:'#ff8800'},{type:'title',label:'Curious minds, remarkable discoveries',icon:'🏅'}],onClose:()=>rewardClosed++}));
 for(const mode of ['dark','light'])for(const width of [320,390,1440]){
  await page.setViewportSize({width,height:844});await page.evaluate(mode=>UITheme.setMode(mode),mode);await open();await page.waitForTimeout(250);
  assert.equal(await page.locator('[role=dialog][aria-labelledby=eqr-heading]').count(),1);assert.equal(await page.locator('.eqr-reward-card').count(),3);assert.equal(await page.locator('.eqr-canvas').count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.ok(await page.locator('#eqr-btn').isVisible());
  assert.equal(await page.locator('#eqr-btn').evaluate(el=>el===document.activeElement),true);
  await page.screenshot({path:`/workspace/reward-summary-${mode}-${width}.png`});await page.keyboard.press('Tab');assert.equal(await page.locator('.eqr-close').evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('#eqr-btn').evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Escape');await page.locator('#eq-reward-overlay').waitFor({state:'detached'});assert.equal(await page.locator('#app').evaluate(el=>el.inert),false);
 }
 assert.equal(await page.evaluate(()=>rewardClosed),6);assert.equal(await page.evaluate(()=>JSON.stringify(AppStore.getState())),original,'Presentation never grants rewards twice');
 await open();await page.evaluate(()=>{document.getElementById('eqr-btn').click();document.getElementById('eqr-btn').click();});await page.locator('#eq-reward-overlay').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>rewardClosed),7);
 await open();await open();assert.equal(await page.evaluate(()=>rewardClosed),8,'Replacing a summary runs its cleanup once');assert.equal(await page.locator('#eq-reward-overlay').count(),1);await page.keyboard.press('Escape');await page.locator('#eq-reward-overlay').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>rewardClosed),9);
 await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>eqRewardPresent({title:'<img src=x onerror="window.badReward=true">',source:'mail',icon:'<img src=x>',rewards:[]}));assert.equal(await page.locator('#eq-reward-overlay img').count(),0);assert.match(await page.locator('.eqr-no-rewards').textContent(),/No additional rewards/);assert.equal(await page.locator('.eqr-panel').evaluate(el=>getComputedStyle(el).animationName),'none');await page.keyboard.press('Escape');
 await page.setViewportSize({width:320,height:500});await page.evaluate(()=>eqRewardPresent({source:'achievement',title:'Your collection keeps growing',rewards:Array.from({length:20},(_,i)=>({type:'item',icon:'🎁',label:'A reward with a long description '+i,amount:1}))}));await page.waitForTimeout(100);assert.ok(await page.locator('#eqr-btn').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight));assert.ok(await page.locator('.eqr-body').evaluate(el=>el.scrollHeight>el.clientHeight));await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);console.log('PASS: reward summary in both themes at 320/390/1440; receipt amounts/title/empty/long lists; fixed visible Continue; focus trap/Escape/replacement/exactly-once callbacks; reduced motion, escaping and no reward mutations.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
