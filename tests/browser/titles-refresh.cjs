// Actual application; rewards and data writes are intercepted locally.
const {chromium}=require('@playwright/test'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+(req.url==='/'?'/index.html':req.url.split('?')[0]));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(e,data)=>{res.writeHead(e?404:200,{'Content-Type':file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html'});res.end(e?'Missing':data);});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.fulfill({contentType:'application/javascript',body:''}));await page.goto(origin);await page.waitForFunction(()=>window.TitleCollection&&window.tsBuildBadgeHTML);
 await page.evaluate(()=>{
  DBService.rpc=async()=>({error:{code:'PGRST202'}});
  AppStore.updateState(d=>{d.students=[{id:'student',name:'Alex Rivera',init:'AR',classId:'science',coins:150,xp:1200,level:1,tier:'Novice',completedQuizzes:[]}];
   d.achievements=[{id:'reading',name:'Read beyond the lesson',active:true},{id:'foreign-ach',name:'Other section achievement',active:true}];d.achievementSectionAssignments={'foreign-ach':['other']};d.achievementUnlocks={student:[]};
   d.titles=TS_MMORPG_TEMPLATES.filter(t=>t.id.startsWith('study_')).map((t,i)=>({...t,id:'title'+i,name:['Cobalt Scholar','Emerald Sage','Golden Luminary','A curious mind with a remarkably long constellation of discoveries'][i],description:['For asking the question that takes the whole class further.','For steady growth, one thoughtful contribution at a time.','An outstanding contribution to a shared learning journey.','An extraordinary title with a long name that must remain readable on mobile.'][i],achievementId:i===2?'reading':null,active:true}));
   d.titles.push({...d.titles[0],id:'foreign',name:'Other section secret',achievementId:'foreign-ach'},{...d.titles[0],id:'inactive',name:'Retired title',active:false});d.titleUnlocks={student:['title0','title1','inactive']};d.equippedTitles={student:'title0'};d.titleSectionAssignments={title3:['science']};d.quizHistory={};d.quizzes=[];d.pointLog=[];
  });DB=loadDB();currentRole='student';currentUser=AppStore.getStudent('student');document.getElementById('boot-loading').style.display='none';document.getElementById('login-screen').style.display='none';document.getElementById('main-app').style.display='block';setupSidebar();updateTopbar();navTo('s-badges');tsTabSwitch('titles');
 });
 await page.locator('#tab-titles-btn').click();
 const original=await page.evaluate(()=>JSON.stringify({students:AppStore.getState().students,titles:AppStore.getState().titles,unlocks:AppStore.getState().titleUnlocks}));
 assert.equal(await page.locator('.tc-card').count(),4);assert.equal(await page.getByText('Other section secret',{exact:true}).count(),0);assert.equal(await page.getByText('Retired title',{exact:true}).count(),0);assert.equal(await page.locator('#tab-titles-btn span').textContent(),'2');
 await page.locator('[data-tc-action=filter][data-filter=locked]').click();assert.equal(await page.locator('.tc-card').count(),2);assert.equal(await page.locator('.tc-card [data-tc-action=equip]').count(),0);
 await page.locator('[data-tc-action=filter][data-filter=unlocked]').click();assert.equal(await page.locator('.tc-card').count(),2);
 await page.locator('[data-tc-action=filter][data-filter=all]').click();await page.getByRole('searchbox',{name:'Search titles'}).fill('no match');await page.getByRole('heading',{name:'No titles match this view.'}).waitFor();await page.getByRole('button',{name:'Show all titles',exact:true}).click();
 for(const mode of ['dark','light'])for(const width of [320,390,1440]){
  await page.setViewportSize({width,height:1000});await page.waitForTimeout(350);await page.evaluate(mode=>UITheme.setMode(mode),mode);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Title collection overflow '+mode+width);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`/workspace/titles-${mode}-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Preview Cobalt Scholar',exact:true}).click();await page.locator('.tc-preview-modal').waitFor();assert.equal(await page.locator('.tc-preview-modal .ts-plate-v2').count(),3);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Preview overflow');
  await page.screenshot({path:`/workspace/title-preview-${mode}-${width}.png`});await page.keyboard.press('Escape');
 }
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Preview Emerald Sage',exact:true}).click();await page.getByRole('button',{name:'Equip this title',exact:true}).click();assert.equal(await page.evaluate(()=>AppStore.getSlice(s=>s.equippedTitles.student)),'title1');assert.match(await page.locator('.tc-profile-stage').textContent(),/Emerald Sage/);assert.equal(await page.locator('#ts-tab-titles').getAttribute('class'),'ts-form-panel active');
 await page.locator('.tc-card.is-equipped [data-tc-action=unequip]').click();assert.equal(await page.evaluate(()=>AppStore.getSlice(s=>s.equippedTitles.student)),null);await page.getByText('Your next title belongs here',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Preview Golden Luminary',exact:true}).click();assert.match(await page.locator('.tc-preview-requirement').textContent(),/Read beyond the lesson/);assert.equal(await page.getByRole('button',{name:'Equip this title',exact:true}).count(),0);await page.keyboard.press('Escape');
 // Tabs have keyboard navigation; collection filtering never changes awards.
 await page.locator('#tab-titles-btn').focus();await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('#tab-badges-btn').getAttribute('aria-selected'),'true');await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#tab-titles-btn').getAttribute('aria-selected'),'true');
 assert.equal(await page.evaluate(()=>JSON.stringify({students:AppStore.getState().students,titles:AppStore.getState().titles,unlocks:AppStore.getState().titleUnlocks})),original);
 // Text contrast recovery and static compact variants.
 await page.evaluate(()=>{const target=document.createElement('div');target.id='contrast-fixture';target.innerHTML=tsBuildBadgeHTML({name:'Readable white plate',icon:'📘',bgColor:'#ffffff',textColor:'#ffffff',borderColor:'#4268b5',frameShape:'rectangle',rarity:'Rare'},{small:true,noParticles:true});document.body.appendChild(target);});
 assert.equal(await page.locator('#contrast-fixture .ts-badge-text').evaluate(el=>getComputedStyle(el).color),'rgb(0, 0, 0)');assert.equal(await page.locator('#contrast-fixture .ts-badge-wrap').evaluate(el=>getComputedStyle(el).animationName),'none');
 // Teacher preview and palettes, with no draft persisted until Save.
 await page.evaluate(()=>{document.getElementById('contrast-fixture').remove();currentRole='teacher';currentUser={id:'teacher',name:'Teacher'};navTo('a-titles');tsAdminOpenDesigner('title0');});await page.waitForTimeout(150);
 assert.equal(await page.locator('.ts3-template-card').filter({hasText:'Cobalt Scholar'}).count(),1);
 const palette=page.locator('.ts3-template-card').filter({hasText:'Golden Luminary'});await palette.focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window._tsDraft.primaryColor),'#efc679');
 await page.screenshot({path:'/workspace/title-designer-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Designer overflow');await page.keyboard.press('Escape');
 await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>{currentRole='student';currentUser=AppStore.getStudent('student');navTo('s-badges');tsTabSwitch('titles');});await page.getByRole('button',{name:'Preview Cobalt Scholar',exact:true}).click();assert.equal(await page.locator('.tc-modal-stage .ts-badge-wrap').evaluate(el=>getComputedStyle(el).animationName),'none');await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);console.log('PASS: colorful titles at 320/390/1440 in both themes; full names, collection filters/search and scope; contextual full/small/xs previews; equip/unequip without reward/unlock/catalog mutations; keyboard tabs/designer presets; readable fallback and reduced motion.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
