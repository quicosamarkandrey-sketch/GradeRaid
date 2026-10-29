// Shared UI foundation in the real app, with offline fixture controls only.
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
   document.getElementById('boot-overlay')?.remove();document.getElementById('login-screen').style.display='none';document.getElementById('main-app').style.display='block';
   const probe=document.createElement('section');probe.id='ui-foundation-probe';
   probe.innerHTML='<button id="dialog-trigger" class="btn btn-primary">Open dialog</button><div class="form-group"><label class="form-label">Reference name</label><input type="text" value="Kept value"></div><button class="btn btn-ghost" id="functional-action">💾 Save record</button><div id="reward-decoration">🏆 Earned reward</div><div class="quiz-options"><button id="quiz-content-probe">📚 Library</button></div><button class="topbar-avatar" id="avatar-content-probe">🏆</button>';
   probe.style.cssText='padding:24px;max-width:640px';document.getElementById('main-content').append(probe);UIPresentation.refresh(probe);
   document.getElementById('dialog-trigger').onclick=()=>showModal('<h2>Profile details</h2><div class="form-group"><label class="form-label">Display name</label><input id="dialog-name" value="Alex Rivera"></div><button id="dialog-cancel" class="btn btn-ghost" onclick="closeModalForce()">Cancel</button><button id="dialog-save" class="btn btn-primary">Save</button>');
  });
  assert.equal(await page.getByLabel('Reference name',{exact:true}).inputValue(),'Kept value');
  assert.equal(await page.locator('#functional-action svg').count(),1);
  assert.equal(await page.locator('#functional-action').textContent(),' Save record');
  assert.equal(await page.locator('#reward-decoration').textContent(),'🏆 Earned reward');
  assert.equal(await page.locator('#quiz-content-probe').textContent(),'📚 Library');
  assert.equal(await page.locator('#avatar-content-probe').textContent(),'🏆');
  assert.equal(await page.locator('#topbar-av').evaluate(el=>el.tagName),'BUTTON');
  assert.equal(await page.locator('#toast').getAttribute('role'),'status');
  for(const mode of ['dark','light']){
   await page.evaluate(mode=>UITheme.setMode(mode),mode);
   for(const width of [320,390,1440]){
    await page.setViewportSize({width,height:900});
    await page.locator('#dialog-trigger').click();
    const dialog=page.getByRole('dialog',{name:'Profile details',exact:true});
    await dialog.waitFor({state:'visible'});
    await page.waitForFunction(()=>document.activeElement.id==='dialog-name');
    assert.equal(await page.getByLabel('Display name',{exact:true}).inputValue(),'Alex Rivera');
    assert.equal(await dialog.getAttribute('aria-modal'),'true');
    await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'dialog-save');
    await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'dialog-name');
    const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1,'Dialog overflows');
    assert.ok(await page.locator('#dialog-save').evaluate(el=>el.getBoundingClientRect().height>=44));
    assert.equal(await page.locator('#dialog-name').evaluate(el=>getComputedStyle(el).fontSize),width<640?'16px':'14px');
    await page.locator('#dialog-name').evaluate(el=>el.setAttribute('aria-invalid','true'));
    await page.waitForTimeout(200);
    assert.ok(await page.locator('#dialog-name').evaluate(el=>{
      const marker=document.createElement('span');marker.style.color='var(--danger)';el.after(marker);
      const valid=getComputedStyle(el).borderTopColor===getComputedStyle(marker).color;
      marker.remove();el.removeAttribute('aria-invalid');return valid;
    }),'Invalid field uses the error color');
    const contrast=await page.locator('#dialog-save').evaluate(el=>{
     const rgb=value=>value.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});
     const lum=c=>c[0]*.2126+c[1]*.7152+c[2]*.0722;
     const style=getComputedStyle(el),a=lum(rgb(style.color)),b=lum(rgb(style.backgroundColor));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    });
    assert.ok(contrast>=4.5,'Primary button contrast '+contrast);
    assert.equal(await page.locator('.form-label').first().evaluate(el=>getComputedStyle(el).textTransform),'none');
    await page.screenshot({path:`/workspace/foundation-dialog-${mode}-${width}.png`});
    await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),false);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'dialog-trigger');
   }
  }
  await page.locator('#dialog-trigger').click();
  await page.evaluate(()=>showModal('<h2>Replacement dialog</h2><p>Read-only content.</p>'));
  await page.getByRole('dialog',{name:'Replacement dialog'}).waitFor({state:'visible'});
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'modal-box');
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'dialog-trigger');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('#dialog-trigger').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
  await page.evaluate(()=>toast('Changes saved'));
  assert.equal(await page.locator('#toast').textContent(),'Changes saved');
  assert.deepEqual(errors,[]);
  console.log('PASS: shared line icons and preserved rewards, associated labels, named modal, focus trap/restore, Escape, empty/replaced dialogs, native profile button, mobile field sizing, 44px controls, primary contrast in both themes, reduced motion and status toast; no backend writes.');
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exit(1)});
