// Public landing and existing auth boundaries, using offline fixture responses.
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
  await page.locator('#login-screen').waitFor({state:'visible'});
  assert.equal(await page.locator('#boot-loading').isVisible(),false);
  assert.equal(await page.locator('#main-app').isVisible(),false);
  assert.equal(await page.locator('#login-user').getAttribute('autocomplete'),'username');
  assert.equal(await page.locator('#login-pass').getAttribute('autocomplete'),'current-password');
  assert.equal(await page.locator('#login-form').count(),1);
  assert.equal(await page.locator('#landing-title').textContent(),'Make learning more rewarding.');
  assert.equal(await page.locator('.landing-learning-preview').count(),1);
  assert.equal(await page.locator('.landing-reward-token').count(),2);
  assert.equal(await page.locator('.landing-seat-grid').count(),0);
  for(const mode of ['dark','light']){
   await page.evaluate(mode=>UITheme.setMode(mode),mode);
   assert.equal(await page.locator('#landing-color-mode-toggle').getAttribute('aria-label'),'Switch to '+(mode==='dark'?'light':'dark')+' mode');
   assert.equal(await page.locator('#color-mode-toggle').getAttribute('aria-label'),await page.locator('#landing-color-mode-toggle').getAttribute('aria-label'));
   for(const width of [320,390,768,1024,1440]){
    await page.setViewportSize({width,height:1000});await page.waitForTimeout(100);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Landing overflow at '+width+' '+mode);
    assert.ok(await page.locator('#login-submit-btn').isVisible());
    assert.ok(await page.locator('#login-submit-btn').evaluate(el=>el.getBoundingClientRect().height>=44));
    assert.equal(await page.locator('#login-user').evaluate(el=>getComputedStyle(el).fontSize),'16px');
    assert.equal(await page.locator('.landing-preview').isVisible(),width>700);
    await page.screenshot({path:`/workspace/landing-${mode}-${width}.png`,fullPage:true});
   }
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('.landing-nav-signin').click();assert.equal(await page.locator('#login-user').evaluate(el=>el===document.activeElement),true);
  await page.locator('#login-pass').fill('fixture-password');
  await page.getByRole('button',{name:'Show password',exact:true}).click();assert.equal(await page.locator('#login-pass').getAttribute('type'),'text');
  await page.getByRole('button',{name:'Hide password',exact:true}).click();assert.equal(await page.locator('#login-pass').getAttribute('type'),'password');
  await page.locator('#login-pass').fill('');
  await page.locator('#login-submit-btn').click();assert.match(await page.locator('#login-err').textContent(),/Please enter your email and password/);
  // Intercept only the existing authentication boundary; fixture credentials never leave this page.
  await page.evaluate(()=>{
   window.signInCount=0;window.fixtureStatus='invalid';
   DBService.getAuthClient=()=>({auth:{signInWithPassword:async ()=>{signInCount++;return new Promise(resolve=>window.finishFixtureSignin=()=>resolve({data:{user:null},error:{message:'Invalid login credentials'}}));}}});
   RegistrationService.checkStatus=async ()=>fixtureStatus==='pending'?{ok:true,found:true,status:'pending'}:{ok:true,found:false};
  });
  await page.locator('#login-user').fill('student@example.invalid');await page.locator('#login-pass').fill('fixture-password');
  await page.locator('#login-pass').press('Enter');await page.waitForFunction(()=>signInCount===1);
  assert.equal(await page.locator('#login-submit-btn').isDisabled(),true);assert.match(await page.locator('#login-submit-btn').textContent(),/Signing in/);
  await page.locator('#login-pass').press('Enter');assert.equal(await page.evaluate(()=>signInCount),1,'Enter should not duplicate sign-in while loading');
  await page.evaluate(()=>finishFixtureSignin());await page.waitForFunction(()=>!document.getElementById('login-submit-btn').disabled);
  assert.match(await page.locator('#login-err').textContent(),/Incorrect email or password/);assert.equal(await page.locator('#login-pass').inputValue(),'');
  await page.evaluate(()=>fixtureStatus='pending');await page.locator('#login-pass').fill('fixture-password');await page.locator('#login-submit-btn').click();await page.waitForFunction(()=>signInCount===2);await page.evaluate(()=>finishFixtureSignin());
  await page.locator('#login-pending-err').waitFor({state:'visible'});assert.equal(await page.locator('#main-app').isVisible(),false);
  await page.getByRole('button',{name:'Request a student account',exact:false}).click();assert.equal(await page.locator('#reg-screen').isVisible(),true);assert.equal(await page.locator('#login-screen').isVisible(),false);
  await page.evaluate(()=>hideRegScreen());assert.equal(await page.locator('#login-screen').isVisible(),true);
  await page.getByRole('button',{name:'Check registration status',exact:true}).click();await page.getByRole('dialog',{name:/Check Registration Status/}).waitFor({state:'visible'});
  await page.keyboard.press('Escape');assert.equal(await page.locator('#modal-overlay').isVisible(),false);
  await page.evaluate(()=>UITheme.setMode('dark'));await page.locator('#landing-color-mode-toggle').click();assert.equal(await page.evaluate(()=>UITheme.getMode()),'light');
  await page.reload();await page.locator('#login-screen').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>UITheme.getMode()),'light');
  assert.equal(await page.locator('#login-screen h1').count(),1);
  // Boot the real app shell from a scrolled landing page using a local profile.
  await page.evaluate(()=>{
   AppStore.updateState(d=>{d.students=[{id:'fixture-user',name:'Alex Rivera',init:'AR',classId:'fixture-class',xp:1200,coins:100,level:1,tier:'Scholar',color:'#888888',completedQuizzes:[]}];},{type:'fixture:profile'});
   DB=loadDB();currentRole='student';currentUser=AppStore.getStudent('fixture-user');
   window.scrollTo(0,500);bootApp();
  });
  assert.equal(await page.locator('#login-screen').isVisible(),false);
  assert.equal(await page.locator('#main-app').isVisible(),true);
  assert.equal(await page.evaluate(()=>window.scrollY),0,'Landing scroll should not carry into the app');

  assert.deepEqual(errors,[]);
  console.log('PASS: responsive landing at 320/390/768/1024/1440 in both themes; preserved session gate; native sign-in form, focus links, password reveal, empty/invalid/pending states, single Enter submission/loading, registration/back/status, synced persisted theme; external services blocked.');
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exit(1)});
