const {chromium}=require('@playwright/test'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const root=path.resolve(__dirname,'../..');const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(e,data)=>{res.writeHead(e?404:200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(e?'Missing':data);});});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;let browser;try{
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.fulfill({contentType:'application/javascript',body:''}));await page.goto(origin);await page.waitForFunction(()=>window.UXStates&&window.bsOpenCreate&&window.renderMySection);
 // Real login validation identifies each missing field, never stores passwords.
 await page.evaluate(()=>{document.getElementById('login-user').value='';document.getElementById('login-pass').value='';doLogin();});assert.equal(await page.locator('#login-user').getAttribute('aria-invalid'),'true');assert.equal(await page.locator('#login-pass').getAttribute('aria-invalid'),'true');
 await page.evaluate(()=>{window.authListener=null;window.remoteFlushCalls=0;DBService.getAuthClient=()=>({auth:{onAuthStateChange:fn=>{authListener=fn;return {data:{subscription:{unsubscribe(){}}}};},signOut:async()=>{throw new Error('Expired cleanup must not sign out again');}}});DBService.flushPendingUpload=async()=>{remoteFlushCalls++;};DBService.rpc=async()=>({error:{code:'42501',message:'permission denied'}});AppStore.updateState(d=>{d.admin={id:'teacher-a',name:'Teacher'};d.students=[{id:'student-a',name:'Alex Rivera',init:'AR',classId:'science',xp:0,level:1,tier:'Scholar',coins:100,completedQuizzes:[]}];d.classSections=[{id:'science',gradeLevel:'8',sectionName:'A',adviserId:'teacher-a',active:true}];d.bossEvents=[];d.inventory={'student-a':[]};d.store=[];});DB=loadDB();currentUser={id:'teacher-a',name:'Teacher'};currentRole='teacher';document.getElementById('boot-loading').style.display='none';document.getElementById('login-screen').style.display='none';document.getElementById('main-app').style.display='block';setupSidebar();navTo('a-boss-studio');AppStore.emit({type:'session:booted'});bsOpenCreate();});
 await page.locator('#bsf-name').fill('Recovered Wyrm');await page.locator('#bsf-name').dispatchEvent('input');await page.evaluate(()=>authListener('SIGNED_OUT'));await page.waitForFunction(()=>currentUser===null);assert.equal(await page.evaluate(()=>remoteFlushCalls),0);assert.equal(await page.locator('#bs-editor-overlay.open').count(),0);assert.match(await page.locator('#ux-session').textContent(),/same account/);assert.ok(await page.evaluate(()=>sessionStorage.getItem('eq-editor-recovery-v1:teacher-a').includes('Recovered Wyrm')));
 await page.evaluate(()=>{currentUser={id:'teacher-b',name:'Other teacher'};currentRole='teacher';AppStore.emit({type:'session:booted'});});assert.equal(await page.locator('#ux-recovery').count(),0);
 await page.evaluate(()=>{currentUser={id:'teacher-a',name:'Teacher'};document.getElementById('main-app').style.display='block';document.getElementById('login-screen').style.display='none';AppStore.emit({type:'session:booted'});});await page.getByRole('button',{name:'Resume boss profile',exact:true}).click();assert.equal(await page.locator('#bsf-name').inputValue(),'Recovered Wyrm');assert.equal(await page.evaluate(()=>sessionStorage.getItem('eq-editor-recovery-v1:teacher-a')),null);await page.evaluate(()=>_bsForceCloseEditor());
 // An edited profile can be rehydrated from the remote library before applying its unsaved draft.
 await page.evaluate(()=>{window.originalProfile=bsvpBlank();originalProfile.name='Original profile';AppStore.updateState(d=>{d.bossLibrary=[originalProfile];});bsOpenEdit(originalProfile.id);});await page.locator('#bsf-name').fill('Recovered remote edit');await page.evaluate(async()=>{UXStates.capture();_bsForceCloseEditor();AppStore.updateState(d=>{d.bossLibrary=[];});const old=DBService.rpc;DBService.rpc=async name=>name==='get_boss_library'?{data:[{id:originalProfile.id,data:originalProfile}]}:{error:{message:'Fixture'}};await UXStates.resume('boss-profile');DBService.rpc=old;});assert.equal(await page.locator('#bsf-name').inputValue(),'Recovered remote edit');await page.evaluate(()=>_bsForceCloseEditor());
 // Quest and event authoring adapters restore their actual editors, including question/section state.
 await page.evaluate(()=>{navTo('a-quizzes');openQuizBuilder();});await page.locator('#qb-title').fill('Recovered science quest');await page.evaluate(async()=>{UXStates.capture();closeModalForce();await UXStates.resume('quest');});assert.equal(await page.locator('#qb-title').inputValue(),'Recovered science quest');await page.evaluate(()=>closeModalForce());
 await page.evaluate(()=>{navTo('a-bossevents');openBossForm(null);});await page.locator('#bf-name').fill('Recovered event');await page.evaluate(async()=>{UXStates.capture();closeModalForce();await UXStates.resume('boss-event');});assert.equal(await page.locator('#bf-name').inputValue(),'Recovered event');await page.evaluate(()=>closeModalForce());
 // The full-screen workspace supports real entry buttons, previews, safe dismissal and pinned actions.
 await page.setViewportSize({width:320,height:720});
 await page.evaluate(()=>navTo('a-quizzes'));
 await page.locator('#a-quizzes [onclick="openQuestTemplateChooser()"]').click();
 await page.getByRole('button',{name:/Blank quest/}).click();
 await page.locator('#qb-title').fill('Lab safety');
 await page.locator('[data-jump="quest-questions"]').click();
 await page.getByRole('button',{name:/Add Question/}).click();
 await page.getByPlaceholder('Type your question...').fill('What protects your eyes?');
 for (const [letter, answer] of [['A','Gloves'],['B','Goggles'],['C','Apron']]) {
  await page.getByPlaceholder('Option '+letter,{exact:true}).fill(answer);
 }
 await page.getByRole('button',{name:'Mark option B correct'}).click();
 await page.locator('[onclick="removeOption(0,0)"]').click();
 assert.equal(await page.getByRole('button',{name:'Mark option A correct'}).getAttribute('aria-pressed'),'true');
 assert.match(await page.locator('.creator-summary').textContent(),/Lab safety/);
 assert.ok(await page.locator('.creator-footer').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight+1));
 await page.screenshot({path:'/tmp/creator-quest-mobile.png'});
 const horizontalOverflow = await page.locator('.creator-scroll').evaluate(el => [...el.querySelectorAll('*')]
  .filter(node => node.getBoundingClientRect().right > el.getBoundingClientRect().right + 1)
  .map(node => node.id || node.className || node.tagName));
 assert.deepEqual(horizontalOverflow, [], 'Quest form fits narrow phones');
 page.once('dialog', dialog => dialog.dismiss());
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('#qb-title').inputValue(),'Lab safety');
 page.once('dialog', dialog => dialog.accept());
 await page.getByRole('button',{name:'Close editor'}).click();
 await page.locator('#modal-overlay').waitFor({state:'hidden'});

 await page.setViewportSize({width:1440,height:960});
 await page.evaluate(()=>{ DBService.rpc=async()=>({data:null,error:null});navTo('a-store'); });
 await page.locator('#a-store [onclick="openAddProduct()"]').click();
 await page.getByLabel('Name',{exact:true}).fill('Field trip pass');
 await page.getByLabel('Stock',{exact:true}).fill('0');
 assert.match(await page.locator('.creator-summary').textContent(),/sold out/);
 await page.getByRole('button',{name:'Add product',exact:true}).click();
 assert.equal(await page.evaluate(()=>AppStore.getSlice(s=>s.store.find(item=>item.name==='Field trip pass')?.stock)),0);

 await page.evaluate(()=>navTo('a-achievements'));
 await page.locator('#a-achievements [onclick="achAdminOpenForm(null)"]').click();
 await page.getByLabel('Badge Name',{exact:false}).fill('Lab safety badge');
 await page.locator('[data-creator-kind=badge]').getByLabel('Description',{exact:false}).fill('Practice the safety rules.');
 await page.locator('#ach-f-sections input[type=checkbox]').first().check();
 assert.match(await page.locator('.creator-summary').textContent(),/1 selected/);
 await page.getByRole('button',{name:'Create badge',exact:true}).click();
 await page.waitForFunction(()=>AppStore.getSlice(s=>s.achievements.some(badge=>badge.name==='Lab safety badge'&&s.achievementSectionAssignments[badge.id]?.includes('science'))));

 await page.evaluate(()=>navTo('a-titles'));
 await page.locator('#a-titles [onclick="tsAdminOpenDesigner(null)"]').first().click();
 await page.locator('#ts3-name').fill('Laboratory Warden');
 await page.locator('#ts3-preview-badge').getByText('Laboratory Warden',{exact:true}).waitFor();
 await page.screenshot({path:'/tmp/creator-title-desktop.png'});
 page.once('dialog', dialog => dialog.accept());
 await page.keyboard.press('Escape');
 await page.locator('#modal-overlay').waitFor({state:'hidden'});

 await page.evaluate(()=>AppStore.updateState(d=>{d.store=[];}));
 // Permission denial explains the reason and leaves the teacher on an allowed page.
 await page.evaluate(()=>navTo('a-settings'));assert.equal(await page.locator('#a-dashboard.active').count(),1);assert.match(await page.locator('#ux-feedback').textContent(),/Administrator access required/);await page.locator('#ux-feedback .ux-notice-close').click();
 await page.evaluate(()=>{currentRole='student';currentUser=AppStore.getStudent('student-a');setupSidebar();navTo('s-inventory');});await page.getByRole('button',{name:'Explore the Armory',exact:true}).click();assert.equal(await page.locator('#s-store.active').count(),1);assert.match(await page.locator('#s-store').textContent(),/being stocked/);
 await page.evaluate(()=>{AppStore.updateState(d=>{d.inventory['student-a']=[{itemId:'pencil',itemName:'Pencil',category:'supplies',status:'active',quantity:1}];});navTo('s-inventory');});await page.locator('#inv-search').fill('nothing-matches');await page.getByRole('button',{name:'Clear filters',exact:true}).click();assert.equal(await page.locator('#inv-search').inputValue(),'');assert.equal(await page.locator('.inv-card').count(),1);
 // Slow reads retain the previous roster; rejected reads disclose cache fallback and provide retry.
 await page.evaluate(async()=>{DBService.rpc=async()=>({data:{section:{id:'science',label:'Grade 8 A'},teacher:{displayName:'Teacher'},classmates:[{id:'student-a',displayName:'Alex Rivera',init:'AR',xp:0}]}});await renderMySection();showPage('s-my-section');});
 await page.evaluate(()=>{DBService.rpc=()=>new Promise(resolve=>window.resolveSection=resolve);window.sectionRequest=renderMySection();});assert.match(await page.locator('#s-my-section').textContent(),/Alex Rivera/);await page.locator('#s-my-section .ux-state-slow').waitFor();await page.evaluate(async()=>{resolveSection({error:{message:'Failed to fetch'}});await sectionRequest;});assert.match(await page.locator('#s-my-section').textContent(),/stored on this device/);assert.match(await page.locator('#s-my-section').textContent(),/Alex Rivera/);assert.equal(await page.locator('#s-my-section').getAttribute('aria-busy'),null);
 // Global connectivity works at desktop and phone widths without erasing a page.
 await context.setOffline(true);await page.locator('#ux-connectivity .ux-state-offline').waitFor();for(const width of [320,390,1440]){await page.setViewportSize({width,height:950});assert.ok(await page.locator('#ux-connectivity').evaluate(n=>{const b=n.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth+1;}));}await page.setViewportSize({width:390,height:950});await page.screenshot({path:'/workspace/ux-states-mobile.png'});await context.setOffline(false);await page.locator('#ux-connectivity .ux-state-success').waitFor();
 assert.deepEqual(errors,[]);console.log('PASS: full-screen quest, badge, Armory and title authoring; real login inline validation; session expiry preserves authoring before teardown without a remote flush; owner-isolated recovery into Boss Studio, event and quest editors; permission recovery; inventory/Armory empty and filtered states; slow/cache-fallback section reads retain roster; offline/reconnection at 320/390/1440.');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exit(1)});
