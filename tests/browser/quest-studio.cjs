// Study UX exercised in the real app. External services are intercepted.
const {chromium}=require('@playwright/test'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+(req.url==='/'?'/index.html':req.url.split('?')[0]));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(e,data)=>{res.writeHead(e?404:200,{'Content-Type':file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html'});res.end(e?'Missing':data);});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.fulfill({contentType:'application/javascript',body:''}));
 await page.goto(origin);await page.waitForFunction(()=>window.QuestStudy&&AppStore.getState());
 await page.evaluate(()=>{
  window.studyRpcCalls=[];DBService.rpc=async(name)=>{studyRpcCalls.push(name);return {error:{code:'PGRST202',message:'Offline fixture'}};};
  const questions=[
   {type:'mc',q:'Which part of the cell contains genetic material?',opts:['Nucleus','Cell membrane','Cytoplasm','Ribosome'],answer:0},
   {type:'tf',q:'Plants use sunlight to make food.',opts:['True','False'],answer:0},
   {type:'id',q:'What is the basic unit of life?',answer:'Cell',altAnswers:['A cell']},
   {type:'enum',q:'Name two components found in a plant cell.',answers:['Cell wall','Chloroplast']},
   {type:'match',q:'Match each structure to its function.',pairs:[{left:'Nucleus',right:'Stores genetic material'},{left:'Cell membrane',right:'Controls what enters the cell'}]}
  ];
  AppStore.updateState(d=>{
   d.students=[{id:'student',name:'Alex Rivera',init:'AR',classId:'science',coins:100,xp:200,level:0,tier:'Novice',completedQuizzes:['review']}];
   d.quizzes=[{id:'biology',title:'Inside the living cell',desc:'A closer look at the small structures that make life possible.',active:true,questions,xpReward:100,coinReward:20,timeLimit:10,ownerTeacherId:'teacher',stageTimers:[45,35,25]},
    {id:'review',title:'Foundations of chemistry',desc:'Elements, compounds, and the building blocks of matter.',active:true,questions:[{type:'mc',q:'Water is a compound.',opts:['True','False'],answer:0}],xpReward:80,coinReward:20,ownerTeacherId:'teacher'},
    {id:'geometry',title:'Shapes in everyday spaces',desc:'Learn to recognize geometry in the world around you.',active:true,questions:[{type:'id',q:'A shape with three sides?',answer:'Triangle'}],xpReward:100,coinReward:20,ownerTeacherId:'teacher'},
    {id:'restricted',title:'Other section private quiz',active:true,questions,xpReward:100},
    {id:'future',title:'Coming next week',active:true,startDate:'2099-01-01',questions,xpReward:100},
    {id:'empty',title:'Preparing a new set',active:true,questions:[],xpReward:100},
    {id:'chain-a',title:'Learning path part one',active:true,chainId:'path',chainOrder:1,chainLabel:'A living world',questions:[questions[0]],xpReward:100},
    {id:'chain-b',title:'Learning path part two',active:true,chainId:'path',chainOrder:2,chainLabel:'A living world',questions:[questions[1]],xpReward:100}];
   d.quizSectionAssignments={restricted:['other']};d.quizHistory={student:[{id:'past',quizId:'review',score:40,attempt:1,completedAt:new Date().toISOString(),results:[0]}]};d.quizAttemptOverrides={};d.achievementDefs=[];d.pointLog=[];
  },{type:'fixture:study'});
  DB=loadDB();currentUser=AppStore.getStudent('student');currentRole='student';document.getElementById('boot-loading').style.display='none';document.getElementById('login-screen').style.display='none';document.getElementById('main-app').style.display='block';setupSidebar();updateTopbar();navTo('s-quizzes');
 });
 const invariant=()=>page.evaluate(()=>JSON.stringify({students:AppStore.getState().students,history:AppStore.getState().quizHistory,points:AppStore.getState().pointLog,quizzes:AppStore.getState().quizzes}));
 const original=await invariant();
 assert.equal(await page.locator('.qs-set-card').count(),7);assert.equal(await page.getByText('Other section private quiz',{exact:true}).count(),0);
 await page.getByRole('searchbox',{name:'Search study sets'}).fill('chemistry');assert.equal(await page.locator('.qs-set-card').count(),1);
 await page.getByRole('searchbox').fill('nothing matches');await page.getByRole('heading',{name:'No sets match this view.'}).waitFor();
 await page.getByRole('button',{name:'Show all sets',exact:true}).click();
 await page.getByRole('button',{name:'Save Inside the living cell',exact:true}).click();await page.locator('[data-qs-action=filter][data-filter=saved]').click();assert.equal(await page.locator('.qs-set-card').count(),1);
 await page.locator('[data-qs-action=filter][data-filter=all]').click();
 for(const mode of ['dark','light']){
  await page.evaluate(mode=>UITheme.setMode(mode),mode);
  for(const width of [320,390,1440]){
   await page.setViewportSize({width,height:1000});await page.waitForTimeout(350);await page.evaluate(()=>navTo('s-quizzes')); 
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Library overflow '+width+' '+mode+' '+JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('#s-quizzes *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>[el.className,Math.round(el.getBoundingClientRect().width),Math.round(el.getBoundingClientRect().right)]).slice(0,12))));
   await page.screenshot({path:`/workspace/quest-library-${mode}-${width}.png`,fullPage:true});
   await page.evaluate(()=>QuestStudy.open('biology'));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Detail overflow');
   await page.screenshot({path:`/workspace/quest-detail-${mode}-${width}.png`,fullPage:true});
   await page.getByRole('button',{name:'Open flashcards'}).click();
   await page.screenshot({path:`/workspace/quest-cards-${mode}-${width}.png`,fullPage:true});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Cards overflow');
  }
 }
 await page.setViewportSize({width:390,height:844});
 assert.match(await page.locator('.qs-flashcard-content').textContent(),/genetic material/);
 await page.locator('.qs-flashcard').click();assert.equal(await page.locator('.qs-flashcard-content').textContent(),'Nucleus');
 await page.keyboard.press('s');assert.equal(await page.locator('[data-qs-action=star]').getAttribute('aria-pressed'),'true');
 await page.keyboard.press('k');assert.equal(await page.locator('.qs-session-heading h1 span').textContent(),'2 / 5');
 await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('.qs-session-heading h1 span').textContent(),'1 / 5');
 await page.keyboard.press('Space');assert.equal(await page.locator('.qs-flashcard-content').textContent(),'Nucleus');
 await page.evaluate(()=>QuestStudy.open('biology'));await page.getByRole('button',{name:'Starred cards (1)',exact:true}).click();assert.equal(await page.locator('.qs-session-heading h1 span').textContent(),'1 / 1');
 await page.evaluate(()=>QuestStudy.open('biology'));await page.getByRole('button',{name:'Start practice',exact:false}).click();
 assert.equal(await page.locator('[data-qs-action=check]').isDisabled(),true);
 await page.locator('.qs-practice-option').nth(1).click();await page.getByRole('button',{name:'Check answer',exact:true}).click();assert.match(await page.locator('.qs-feedback').textContent(),/Nucleus/);
 await page.getByRole('button',{name:'Next question'}).click();await page.locator('.qs-practice-option').nth(0).click();await page.getByRole('button',{name:'Check answer',exact:true}).click();
 await page.getByRole('button',{name:'Next question'}).click();await page.locator('#qs-free-answer').fill('A cell');await page.getByRole('button',{name:'Check answer',exact:true}).click();assert.match(await page.locator('.qs-feedback').textContent(),/100% credit/);
 await page.getByRole('button',{name:'Next question'}).click();await page.locator('#qs-enum-0').fill('Cell wall');await page.locator('#qs-enum-1').fill('Wrong');await page.getByRole('button',{name:'Check answer',exact:true}).click();assert.match(await page.locator('.qs-feedback').textContent(),/50% credit/);
 await page.getByRole('button',{name:'Next question'}).click();await page.locator('[data-qs-answer=array]').nth(0).selectOption('Stores genetic material');await page.locator('[data-qs-answer=array]').nth(1).selectOption('Controls what enters the cell');
 await page.screenshot({path:'/workspace/quest-practice-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Check answer',exact:true}).click();await page.getByRole('button',{name:'See your review',exact:true}).click();
 assert.match(await page.locator('.qs-practice-summary').textContent(),/3 of 5 fully correct/);assert.equal(await page.locator('.qs-review-list details').count(),2);assert.equal(await invariant(),original,'Study must never mutate rewards, quiz history, grades or questions');
 await page.getByRole('button',{name:'Practice missed questions',exact:true}).click();assert.equal(await page.locator('.qs-session-heading h1 span').textContent(),'1 / 2');
 await page.evaluate(()=>QuestStudy.open('review'));await page.getByRole('button',{name:'Review missed questions',exact:true}).click();assert.equal(await page.locator('.qs-session-heading h1 span').textContent(),'1 / 1');
 await page.getByRole('button',{name:'I don’t know yet',exact:true}).click();assert.match(await page.locator('.qs-feedback').textContent(),/Correct answer/);
 // Schedule, section and chain restrictions are checked at entry and action time.
 await page.evaluate(()=>QuestStudy.open('future'));assert.equal(await page.getByRole('button',{name:'Open flashcards'}).isDisabled(),true);await page.getByText('Opens 2099-01-01.',{exact:false}).waitFor();
 await page.evaluate(()=>QuestStudy.open('chain-b'));assert.equal(await page.getByRole('button',{name:'Start practice',exact:false}).isDisabled(),true);
 await page.evaluate(()=>QuestStudy.open('biology'));await page.getByRole('button',{name:'Review quiz rules'}).click();await page.getByRole('button',{name:'Keep studying',exact:true}).click();assert.equal(await page.locator('#modal-overlay').evaluate(el=>el.style.display),'none','Keep studying must close confirmation');assert.equal(await invariant(),original);
 await page.getByRole('button',{name:'Review quiz rules'}).click();await page.getByRole('button',{name:'Start scored quiz'}).click();await page.locator('#s-quiz-active.active').waitFor();
 assert.equal(await page.locator('.quiz-progress-fill').evaluate(el=>el.style.width),'0%');assert.match(await page.locator('#quiz-timer').textContent(),/\d+s/);
 await page.waitForTimeout(350);await page.screenshot({path:'/workspace/quest-scored-mobile.png',fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Scored runner overflow');
 await page.locator('#opt-0').click();await page.locator('#btn-next').click();await page.waitForFunction(()=>document.querySelector('.quiz-q-text')?.textContent==='Plants use sunlight to make food.');
 assert.equal(await page.locator('.quiz-progress-fill').evaluate(el=>el.style.width),'20%');
 await page.locator('#opt-0').click();await page.locator('#btn-next').click();await page.getByRole('button',{name:'Leave quiz',exact:true}).click();await page.getByRole('button',{name:'Leave quiz anyway',exact:true}).click();await page.waitForTimeout(1700);
 assert.equal(await page.evaluate(()=>AppStore.getState().quizHistory.student.at(-1).aborted),true);assert.equal(await page.evaluate(()=>AppStore.getStudent('student').coins),100);
 // Saved flashcard state survives opening the set again and is scoped per student.
 await page.evaluate(()=>QuestStudy.open('biology'));assert.match(await page.locator('.qs-detail-meta').textContent(),/1 marked known/);
 await page.getByRole('button',{name:'Still learning (4)',exact:true}).click();assert.equal(await page.locator('.qs-session-heading h1 span').textContent(),'1 / 4');
 await page.evaluate(()=>QuestStudy.open('biology'));
 await page.evaluate(()=>{localStorage.setItem('eduquest-study-v1-other-student','42');currentUser={...currentUser,id:'other-student'};navTo('s-quizzes');QuestStudy.open('biology');});assert.match(await page.locator('.qs-detail-meta').textContent(),/0 marked known/);
 await page.evaluate(()=>{currentUser=AppStore.getStudent('student');navTo('s-quizzes');QuestStudy.open('biology');});assert.match(await page.locator('.qs-detail-meta').textContent(),/1 marked known/);
 // A teacher edit invalidates old self-assessments rather than mislabeling new content.
 await page.evaluate(()=>{AppStore.updateState(d=>{d.quizzes.find(q=>q.id==='biology').questions[0].q='Updated question';});QuestStudy.open('biology');});assert.match(await page.locator('.qs-detail-meta').textContent(),/0 marked known/);
 // Published content with HTML-looking strings stays literal text.
 await page.evaluate(()=>{AppStore.updateState(d=>{d.quizzes.find(q=>q.id==='geometry').questions[0].q='<img src=x onerror="window.studyInjection=true">';});QuestStudy.open('geometry');});await page.getByRole('button',{name:'Open flashcards'}).click();assert.equal(await page.locator('.qs-flashcard img').count(),0);assert.equal(await page.evaluate(()=>window.studyInjection),undefined);
 // Teacher flashcard preview has no student side effects.
 await page.evaluate(()=>{currentUser={id:'teacher',name:'Teacher'};currentRole='teacher';navTo('a-quizzes');});
 await page.locator('.admin-quest-card').filter({hasText:'Inside the living cell'}).getByRole('button',{name:'Study preview',exact:true}).click();
 await page.locator('.qs-preview-card').click();assert.equal(await page.locator('.qs-preview-card .qs-flashcard-content').textContent(),'Nucleus');await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.evaluate(()=>AppStore.flushNow());await page.reload();await page.waitForFunction(()=>window.QuestStudy&&AppStore.getState());
 await page.evaluate(()=>{DBService.rpc=async()=>({error:{code:'PGRST202'}});currentUser=AppStore.getStudent('student');currentRole='student';document.getElementById('boot-loading').style.display='none';document.getElementById('login-screen').style.display='none';document.getElementById('main-app').style.display='block';setupSidebar();navTo('s-quizzes');});
 assert.equal(await page.getByRole('button',{name:'Unsave Inside the living cell',exact:true}).count(),1,'Saved set must survive reload');
 assert.deepEqual(errors,[]);console.log('PASS: study library/search/filter/save; responsive dark/light library/detail/cards at 320/390/1440; keyboard flashcards, starred and known progress; all five practice types/partial credit/missed review without state or reward mutations; scored rules/timer/progress/safe abort; section/schedule/chains; account isolation/content invalidation/escaping; teacher preview; persistence after reload.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
