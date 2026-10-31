/* Quest study modes. Practice state stays on this browser/account and never
   writes quiz history, XP, coins, attempts, or teacher-authored questions. */
;(function () {
  'use strict';
  const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const icons = {
    book:'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4z M20 4h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-2h3z',
    cards:'M5 7h15v13H5z M2 16V3h15', arrow:'M4 12h16 M14 6l6 6-6 6', back:'M20 12H4 M10 6l-6 6 6 6',
    star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z',
    check:'m5 12 4 4L19 6', shuffle:'m3 5 18 14 M3 19l7-6 M14 9l7-4 M17 5h4v4 M17 19h4v-4',
    flip:'M4 8a8 8 0 0 1 14-2l2 2 M20 3v5h-5 M20 16a8 8 0 0 1-14 2l-2-2 M4 21v-5h5',
    search:'M16 16l5 5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0', clock:'M12 7v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    learn:'M9 18h6 M10 21h4 M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2', bookmark:'M6 3h12v18l-6-4-6 4z'
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(icons[name] || icons.book).split(' M').map((p,i)=>`<path d="${i?'M':''}${p}"/>`).join('')}</svg>`;
  const button = (action, text, attrs = '', primary = false) => `<button type="button" class="qs-button${primary?' qs-primary':''}" data-qs-action="${action}" ${attrs}>${text}</button>`;
  let owner = null, memory = {}, query = '', filter = 'all', sort = 'recommended', view = 'library', selected = null, session = null, preview = null;
  const uid = () => typeof currentUser !== 'undefined' ? currentUser?.id : null;
  function identity() {
    if (owner === uid()) return;
    owner = uid(); memory = {}; query = ''; filter = 'all'; sort = 'recommended'; view = 'library'; selected = session = preview = null;
    try { memory = JSON.parse(localStorage.getItem('eduquest-study-v1-' + owner) || '{}') || {}; } catch {}
    if (typeof memory!=='object' || Array.isArray(memory)) memory={};
    if (!memory.sets || typeof memory.sets !== 'object' || Array.isArray(memory.sets)) memory.sets = {};
    if (!Array.isArray(memory.saved)) memory.saved = [];
  }
  function persist() { try { localStorage.setItem('eduquest-study-v1-' + owner, JSON.stringify(memory)); } catch { if (!memory.warned) { memory.warned = true; toast('Study progress will last for this session. Browser storage is unavailable.'); } } }
  function signature(quiz) {
    const text = JSON.stringify(quiz.questions || []); let hash = 2166136261;
    for (let i=0; i<text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(36);
  }
  function progress(quiz) {
    const total=quiz.questions?.length||0; const hash = signature(quiz); let saved = memory.sets[quiz.id];
    if (!saved || saved.signature !== hash) saved = memory.sets[quiz.id] = {signature:hash, known:[], starred:[], position:0};
    for (const key of ['known','starred']) saved[key] = [...new Set(Array.isArray(saved[key])?saved[key]:[])].filter(i=>Number.isInteger(i) && i>=0 && i<total);
    saved.position = Math.max(0, Math.min(total-1, Number(saved.position)||0));
    return saved;
  }
  const all = () => AppStore.getSlice(state=>state.quizzes || []).map(quiz=>({...quiz,questions:Array.isArray(quiz.questions)?quiz.questions:[]}));
  function findQuiz(id) {
    const quiz=AppStore.getSlice(state=>(state.quizzes||[]).find(q=>q.id===id));
    return quiz?{...quiz,questions:Array.isArray(quiz.questions)?quiz.questions:[]}:null;
  }
  const history = qid => AppStore.getSlice(state=>state.quizHistory?.[uid()] || []).filter(h=>h.quizId===qid && !h.aborted);
  function inSection(quiz) {
    const sections = AppStore.getSlice(state=>state.quizSectionAssignments?.[quiz.id]);
    return !sections?.length || sections.includes(currentUser.classId || 'default-class');
  }
  function availability(quiz) {
    if (!quiz || !inSection(quiz)) return 'Not assigned to your section';
    if (quiz.active === false) return 'Currently unavailable';
    if (!quiz.questions?.length) return 'No questions yet';
    const timing = eqQuizScheduleStatus(quiz);
    if (timing==='upcoming') return 'Opens ' + (quiz.startDate || 'soon');
    if (timing==='expired') return 'Quest has ended';
    const cadence = eqQuizCadence(quiz);
    if (cadence==='daily' && !eqGetDailyQuizIds().includes(quiz.id)) return 'Returns in the daily rotation';
    if (cadence==='weekly' && eqGetWeeklyQuizId()!==quiz.id) return 'Returns in the weekly rotation';
    const chainId = eqQuizChain(quiz).chainId;
    if (chainId) {
      const chain = eqGetQuestChains().find(c=>c.chainId===chainId);
      if (chain && eqChainStatus(chain.quizzes, quiz.id, currentUser.completedQuizzes || [])==='locked') return 'Finish the previous part first';
    }
    return '';
  }
  const visible = () => all().filter(q=>inSection(q) || (currentUser.completedQuizzes || []).includes(q.id));
  const best = quiz => { const rows = history(quiz.id); return rows.length ? Math.max(...rows.map(r=>Number(r.score)||0)) : null; };
  function rememberAttempt(quiz, id) {
    identity();
    if (!memory.attemptVersions || typeof memory.attemptVersions!=='object') memory.attemptVersions={};
    memory.attemptVersions['attempt:'+id]=signature(quiz);persist();
  }
  function missed(quiz) {
    const record = history(quiz.id).slice().sort((a,b)=>String(a.completedAt||'').localeCompare(String(b.completedAt||''))).pop();
    const version=record && memory.attemptVersions?.['attempt:'+record.id];
    if (version && version!==signature(quiz)) return [];
    // Older records do not have revision metadata; require matching counts.
    if (!Array.isArray(record?.results) || record.results.length!==quiz.questions.length) return [];
    return record.results.flatMap((value,i)=>Number(value)<1?[i]:[]);
  }
  function prompt(question) {
    return String(question.q || '') + (eqQType(question)==='match'?'\n\n'+(question.pairs||[]).map(p=>p.left).join('\n'):'');
  }
  function answer(quizQuestion) {
    const type = eqQType(quizQuestion);
    if (type==='match') return (quizQuestion.pairs || []).map(p=>p.left+' → '+p.right).join('\n');
    if (type==='enum') return (quizQuestion.answers || []).join('\n');
    if (type==='id') return String(quizQuestion.answer ?? '');
    return String(quizQuestion.opts?.[quizQuestion.answer] ?? '');
  }
  function estimate(quiz) {
    const stages = eqQuizStageSeconds(quiz);
    return Math.max(1, Math.ceil(quiz.questions.reduce((sum,_q,i)=>sum+stages[eqQuestionStage(quiz.questions.length,i)],0)/60));
  }
  const container = () => document.getElementById('s-quizzes');
  function mount(html, focus = false) {
    container().innerHTML = `<div class="quest-studio">${html}</div>`;
    if (focus) { const heading=container().querySelector('h1'); heading?.setAttribute('tabindex','-1'); heading?.focus({preventScroll:true}); container().scrollIntoView({block:'start'}); }
  }
  function backBar(quiz) {
    return `<div class="qs-breadcrumb">${button('library',icon('back')+' Study library')}<span> / </span><span>${escape(quiz.title)}</span></div>`;
  }
  function renderLibrary() {
    identity(); view='library'; selected=session=null;
    const sets=visible(), open=sets.filter(q=>!availability(q)), completed=sets.filter(q=>history(q.id).length), last=sets.find(q=>q.id===memory.lastSet && !availability(q));
    mount(`<header class="qs-library-header"><div><p class="qs-eyebrow">Quest Board / Your learning space</p><h1>Your study library.</h1><p>Understand it. Remember it. Put it into practice.</p></div><div class="qs-library-count"><strong>${open.length}</strong><span>sets ready to explore</span></div></header>
      <section class="qs-start-panel"><div class="qs-start-symbol">${icon('book')}</div><div><span class="qs-eyebrow">${last?'Pick up where you left off':'Make room for a little practice'}</span><h2>${last?escape(last.title):'Learn at your own pace.'}</h2><p>${last?'Your flashcard progress is saved on this browser.':'Flip through flashcards, try a practice round, then take a scored quiz when you’re ready.'}</p></div>${last?button('open','Continue studying '+icon('arrow'),`data-id="${escape(last.id)}"`,true):`<div class="qs-start-steps"><span>${icon('cards')} Flashcards</span><span>${icon('learn')} Practice</span><span>${icon('check')} Scored quiz</span></div>`}</section>
      <div class="qs-library-toolbar"><div class="qs-filter-group" role="group" aria-label="Filter study sets">${[['all','All sets',sets.length],['review','To review',sets.filter(q=>best(q)!==null && best(q)<100).length],['attempted','Attempted',completed.length],['saved','Saved',sets.filter(q=>memory.saved.includes(q.id)).length]].map(([id,label,count])=>`<button type="button" data-qs-action="filter" data-filter="${id}" aria-pressed="${filter===id}">${label}<span>${count}</span></button>`).join('')}</div>
      <div class="qs-library-controls"><label class="qs-search">${icon('search')}<input type="search" id="qs-search" aria-label="Search study sets" placeholder="Search your sets" value="${escape(query)}"></label><select id="qs-sort" aria-label="Sort study sets"><option value="recommended" ${sort==='recommended'?'selected':''}>Recommended</option><option value="title" ${sort==='title'?'selected':''}>Title A–Z</option><option value="recent" ${sort==='recent'?'selected':''}>Recently attempted</option></select></div></div>
      <div id="qs-library-results" aria-live="polite"></div><p class="qs-storage-note">Flashcard progress and saved sets stay on this browser and account. Practice does not spend attempts or award XP and coins.</p>`);
    renderResults();
  }
  function renderResults() {
    let sets=visible().filter(q=>(q.title+' '+(q.desc||'')).toLowerCase().includes(query.trim().toLowerCase()));
    if (filter==='saved') sets=sets.filter(q=>memory.saved.includes(q.id));
    if (filter==='attempted') sets=sets.filter(q=>history(q.id).length);
    if (filter==='review') sets=sets.filter(q=>best(q)!==null && best(q)<100);
    sets.sort((a,b)=>sort==='title'?String(a.title).localeCompare(String(b.title)):sort==='recent'?String(history(b.id).at(-1)?.completedAt||'').localeCompare(String(history(a.id).at(-1)?.completedAt||'')):Number(!!availability(a))-Number(!!availability(b)));
    const result=document.getElementById('qs-library-results'); if (!result) return;
    result.innerHTML=sets.length?`<div class="qs-set-grid">${sets.map((q,i)=>{
      const state=progress(q), score=best(q), blocked=availability(q), saved=memory.saved.includes(q.id), known=state.known.length, total=q.questions?.length||0;
      return `<article class="qs-set-card${blocked?' qs-set-unavailable':''}"><div class="qs-set-top"><span class="qs-set-category">${q.chainId?escape(q.chainLabel||'Learning path')+' · Part '+escape(q.chainOrder||1):eqQuizCadence(q)==='standing'?'Classroom set':escape(eqQuizCadence(q))+' selection'}</span><button class="qs-save" type="button" data-qs-action="save" data-id="${escape(q.id)}" aria-label="${saved?'Unsave':'Save'} ${escape(q.title)}" aria-pressed="${saved}">${icon('bookmark')}</button></div>
      <div class="qs-set-icon" aria-hidden="true">${icon('book')}<span>${String(i+1).padStart(2,'0')}</span></div><h2><button type="button" data-qs-action="open" data-id="${escape(q.id)}">${escape(q.title)}</button></h2><p class="qs-set-description">${escape(q.desc||'A little practice for your next class.')}</p>
      <div class="qs-set-meta"><span>${total} questions</span><span>${score===null?'Not attempted':'Best score '+score+'%'}</span></div><div class="qs-knowledge-track" role="progressbar" aria-label="Questions marked known" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${known}"><i style="width:${total?known/total*100:0}%"></i></div><div class="qs-set-bottom"><span>${blocked?escape(blocked):known+' / '+total+' marked known'}</span>${button('open',blocked?'View details':score===100?'Keep learning':'Study set '+icon('arrow'),`data-id="${escape(q.id)}"`)}</div></article>`;
    }).join('')}</div>`:`<div class="qs-empty">${icon('search')}<h2>${query||filter!=='all'?'No sets match this view.':'Your next set is on its way.'}</h2><p>${query||filter!=='all'?'Try another search or choose All sets.':'Your teacher’s published quests will appear here.'}</p>${button('clear','Show all sets')}</div>`;
  }
  function open(id, focus = true) {
    if (!container()?.classList.contains('active')) navTo('s-quizzes');
    identity(); const quiz=visible().find(q=>q.id===id);if (!quiz) return;
    selected=quiz.id; view='detail'; session=null;
    const blocked=availability(quiz), state=progress(quiz), score=best(quiz), gate=eqQuizAttemptStatus(quiz.id,uid()), review=missed(quiz), timers=eqQuizStageSeconds(quiz);
    const label=gate.perfected?'Perfect score achieved':!gate.allowed?'Retry in '+eqFormatCooldown(gate.cooldownEndsAt-Date.now()):`Attempt ${gate.attemptNumber} · about ${estimate(quiz)} min`;
    mount(`${backBar(quiz)}<header class="qs-detail-header"><div class="qs-detail-icon">${icon('book')}</div><div><p class="qs-eyebrow">${quiz.chainId?'Learning path · Part '+escape(quiz.chainOrder||1):'Your classroom study set'}</p><h1>${escape(quiz.title)}</h1><p>${escape(quiz.desc||'Get comfortable with the material before your next scored attempt.')}</p><div class="qs-detail-meta"><span>${quiz.questions.length} questions</span><span>${score===null?'No scored attempt yet':'Best score: '+score+'%'}</span><span>${state.known.length} marked known</span></div></div></header>
      ${blocked?`<div class="qs-notice" role="status">${escape(blocked)}. Study and scored modes are unavailable for this set.</div>`:''}
      <div class="qs-mode-grid"><article class="qs-mode-card"><span class="qs-mode-icon">${icon('cards')}</span><span class="qs-eyebrow">01 / Remember</span><h2>Flashcards</h2><p>One question at a time. Flip to reveal the answer and mark what you know.</p><small>${state.known.length} of ${quiz.questions.length} marked known</small>${button('cards','Open flashcards '+icon('arrow'),blocked?'disabled':'',true)}</article>
      <article class="qs-mode-card"><span class="qs-mode-icon">${icon('learn')}</span><span class="qs-eyebrow">02 / Understand</span><h2>Practice</h2><p>Try the questions without a timer. Get feedback, then revisit the ones you miss.</p><small>No attempt limit · No XP or coins</small>${button('practice','Start practice '+icon('arrow'),blocked?'disabled':'')}</article>
      <article class="qs-mode-card qs-scored-mode"><span class="qs-mode-icon">${icon('check')}</span><span class="qs-eyebrow">03 / Put it to the test</span><h2>Scored quiz</h2><p>Your teacher’s timed challenge. Earn XP and coins through your scored results.</p><small>${escape(label)}</small>${button('confirm','Review quiz rules '+icon('arrow'),blocked||!gate.allowed?'disabled':'')}</article></div>
      <div class="qs-detail-bottom"><section><h2>Make your next round count.</h2><p>${review.length?review.length+' questions to revisit from your latest scored result.':'Star tricky flashcards to build a focused review round.'}</p><div class="qs-inline-actions">${button('practice-missed','Review missed questions',blocked||!review.length?'disabled':'')}${button('cards-starred',icon('star')+' Starred cards ('+state.starred.length+')',blocked||!state.starred.length?'disabled':'')}${button('cards-learning','Still learning ('+(quiz.questions.length-state.known.length)+')',blocked||state.known.length===quiz.questions.length?'disabled':'')}</div></section><section class="qs-reward-note"><h2>Study freely. Earn when you’re ready.</h2><p>Practice and flashcards do not change your grade or wallet. Scored quizzes keep your class’s reward and attempt rules.</p><p>Quiz timing: ${timers.map(s=>s+'s').join(' / ')} per question across the three stages.</p>${button('reward-guide','How coins work')}</section></div>`,focus);
  }
  function currentQuiz() {
    const quiz=findQuiz(selected);
    if (quiz && session?.signature && signature(quiz)!==session.signature) {session=null;toast('This set was updated. Open it again to study the latest questions.');return null;}
    return quiz && !availability(quiz)?quiz:null;
  }
  function startCards(subset = 'all') {
    const quiz=currentQuiz();if (!quiz) return;
    const state=progress(quiz), order=subset==='starred'?[...state.starred]:quiz.questions.map((_q,i)=>i).filter(i=>subset!=='learning'||!state.known.includes(i));
    if (!order.length) return;
    memory.lastSet=quiz.id;persist();view='cards';
    session={signature:signature(quiz),order,index:subset==='all'?Math.max(0,order.indexOf(state.position)):0,flipped:false,subset};renderCards();
  }
  function renderCards() {
    const quiz=currentQuiz();if (!quiz || !session) return renderLibrary();
    const state=progress(quiz), qi=session.order[session.index], q=quiz.questions[qi], starred=state.starred.includes(qi), known=state.known.includes(qi);
    state.position=qi;persist();
    mount(`${backBar(quiz)}<div class="qs-session-heading"><div><p class="qs-eyebrow">${escape(quiz.title)}</p><h1>Flashcards<span>${session.index+1} / ${session.order.length}</span></h1></div>${button('open','Set overview',`data-id="${escape(quiz.id)}"`)}</div>
      <div class="qs-card-tools"><span>${session.subset==='starred'?'Starred cards':session.subset==='learning'?'Still learning':state.known.length+' of '+quiz.questions.length+' marked known'}</span><div>${button('shuffle',icon('shuffle')+' Shuffle')}${button('star',icon('star')+(starred?' Starred':' Star'),`aria-pressed="${starred}"`)}</div></div>
      <button type="button" class="qs-flashcard${session.flipped?' is-flipped':''}" data-qs-action="flip" aria-label="${session.flipped?'Answer. '+escape(answer(q))+'. Show question':'Question. '+escape(prompt(q))+'. Reveal answer'}"><span class="qs-flashcard-label">${session.flipped?'Answer':'Question'}${known?' · Marked known':''}</span><span class="qs-flashcard-content">${escape(session.flipped?answer(q):prompt(q))}</span><span class="qs-flashcard-hint">${icon('flip')} ${session.flipped?'Back to question':'Tap to reveal answer'}<kbd>Space</kbd></span></button>
      <div class="qs-flashcard-nav">${button('previous',icon('back')+' Previous',session.index===0?'disabled':'')}<div class="qs-card-dots" aria-hidden="true">${session.order.slice(Math.max(0,session.index-3),session.index+4).map(i=>`<i class="${i===qi?'active':''}"></i>`).join('')}</div>${button('next','Next '+icon('arrow'),session.index===session.order.length-1?'disabled':'')}</div>
      <div class="qs-self-check"><p>How well did you remember this?</p><div>${button('learning','Still learning',`aria-pressed="${!known}" ${!session.flipped?'disabled':''}`)}${button('known',icon('check')+' I know this',`aria-pressed="${known}" ${!session.flipped?'disabled':''}`,true)}</div></div>
      ${session.index===session.order.length-1?`<div class="qs-round-end"><span>You’re at the end of this round.</span>${button('practice','Put it into practice '+icon('arrow'))}${button('restart-cards','Go through again')}</div>`:''}<p class="qs-storage-note">Space to flip · Left and right arrows to move · K to mark known · S to star. Your progress is saved on this browser.</p>`);
  }
  function shuffle(array) { const copy=[...array]; for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}return copy; }
  function startPractice(indices = null) {
    const quiz=currentQuiz();if (!quiz) return;
    const order=indices || quiz.questions.map((_q,i)=>i);if (!order.length) return;
    view='practice';session={signature:signature(quiz),order:[...order],index:0,answers:[],results:[],checked:false};renderPractice();
  }
  function practiceInputs(q, qi) {
    const type=eqQType(q), value=session.answers[qi], disabled=session.checked?'disabled':'';
    if (type==='id') return `<label class="qs-answer-label" for="qs-free-answer">Your answer</label><input id="qs-free-answer" data-qs-answer="text" autocomplete="off" placeholder="Type what you remember" value="${escape(value||'')}" ${disabled}>`;
    if (type==='enum') return `<p class="qs-input-help">Name ${(q.answers||[]).length} answers. Each correct answer earns partial credit.</p>${(q.answers||[]).map((_a,i)=>`<label class="qs-answer-label" for="qs-enum-${i}">Answer ${i+1}</label><input id="qs-enum-${i}" data-qs-answer="array" data-index="${i}" autocomplete="off" value="${escape(value?.[i]||'')}" ${disabled}>`).join('')}`;
    if (type==='match') {
      session.matchOptions=session.matchOptions || {};session.matchOptions[qi]=session.matchOptions[qi]||shuffle((q.pairs||[]).map(p=>p.right));
      return (q.pairs||[]).map((p,i)=>`<label class="qs-match-row"><span>${escape(p.left)}</span><select data-qs-answer="array" data-index="${i}" ${disabled}><option value="">Choose a match</option>${session.matchOptions[qi].map(a=>`<option value="${escape(a)}" ${value?.[i]===a?'selected':''}>${escape(a)}</option>`).join('')}</select></label>`).join('');
    }
    return `<fieldset class="qs-practice-options"><legend class="qs-answer-label">Choose an answer</legend>${(q.opts||[]).map((opt,i)=>`<label class="qs-practice-option${session.checked&&i===q.answer?' qs-correct':session.checked&&i===value?' qs-incorrect':''}"><input type="radio" name="qs-option" data-qs-answer="option" value="${i}" ${value===i?'checked':''} ${disabled}><span class="qs-option-letter">${String.fromCharCode(65+i)}</span><span>${escape(opt)}</span></label>`).join('')}</fieldset>`;
  }
  function hasAnswer(q, value) { return ['enum','match'].includes(eqQType(q))?Array.isArray(value)&&value.some(v=>String(v||'').trim()):eqQType(q)==='id'?!!String(value||'').trim():Number.isInteger(value); }
  function renderPractice() {
    const quiz=currentQuiz();if (!quiz || !session) return renderLibrary();
    const qi=session.order[session.index],q=quiz.questions[qi],result=session.results[qi],checked=session.checked;
    mount(`${backBar(quiz)}<div class="qs-session-heading"><div><p class="qs-eyebrow">${escape(quiz.title)} / No timer. No pressure.</p><h1>Practice<span>${session.index+1} / ${session.order.length}</span></h1></div>${button('open','Leave practice',`data-id="${escape(quiz.id)}"`)}</div><div class="qs-session-progress"><i style="width:${session.index/session.order.length*100}%"></i></div>
      <section class="qs-practice-card"><span class="qs-eyebrow">Question ${session.index+1}</span><h2>${escape(q.q)}</h2><div class="qs-answer-fields">${practiceInputs(q,qi)}</div>
      ${checked?`<div class="qs-feedback ${result===1?'is-correct':'is-review'}" role="status"><strong>${result===1?'You’ve got it.':result>0?'Partly correct. Keep building on it.':'A good one to revisit.'}</strong>${result<1?`<span class="qs-feedback-label">Correct answer</span><p>${escape(answer(q))}</p>`:''}<span>${Math.round(result*100)}% credit${result<1?' · You can review this after the round.':''}</span></div>`:''}
      <div class="qs-practice-footer"><span>Practice only · No XP or coins</span>${checked?button('practice-next',session.index===session.order.length-1?'See your review':'Next question '+icon('arrow'),'',true):`<div class="qs-practice-actions">${button('skip','I don’t know yet')}${button('check','Check answer',hasAnswer(q,session.answers[qi])?'':'disabled',true)}</div>`}</div></section>`);
  }
  function practiceSummary() {
    const quiz=currentQuiz();if (!quiz) return renderLibrary();view='summary';
    const count=session.order.filter(i=>session.results[i]===1).length, review=session.order.filter(i=>session.results[i]<1);
    mount(`${backBar(quiz)}<section class="qs-practice-summary"><span class="qs-summary-icon">${icon('check')}</span><p class="qs-eyebrow">Practice complete</p><h1>That’s progress.</h1><p>${count} of ${session.order.length} fully correct. ${review.length?'Give the tricky ones another look.':'You’re ready to put this knowledge to work.'}</p><div class="qs-summary-stats"><div><strong>${count}</strong><span>Correct</span></div><div><strong>${review.length}</strong><span>To revisit</span></div><div><strong>0</strong><span>Attempts spent</span></div></div><div class="qs-inline-actions">${review.length?button('retry-missed','Practice missed questions','',true):button('confirm','Try a scored quiz','',true)}${button('open','Back to set',`data-id="${escape(quiz.id)}"`)}</div><p class="qs-storage-note">This was a practice round. Your scored results, XP and coins are unchanged.</p></section>${review.length?`<section class="qs-review-list"><h2>Your review list</h2>${review.map(i=>`<details><summary>${escape(quiz.questions[i].q)}<span>${Math.round(session.results[i]*100)}%</span></summary><p>${escape(answer(quiz.questions[i]))}</p></details>`).join('')}</section>`:''}`,true);
  }
  function confirmScored() {
    const quiz=currentQuiz();if (!quiz) return;
    const gate=eqQuizAttemptStatus(quiz.id,uid());if (!gate.allowed) return toast(gate.perfected?'You have already perfected this quiz. Keep learning in Practice.':'Scored attempts are on cooldown. Practice is still available.');
    const budget=window.LearningRewards?.active()?LearningRewards.questBudget(quiz):quiz.coinReward;
    showModal(`<div class="quest-studio qs-preflight"><p class="qs-eyebrow">Scored quiz / Attempt ${gate.attemptNumber}</p><h2>${escape(quiz.title)}</h2><p>Take a breath. Here’s what to expect.</p><ul><li>${quiz.questions.length} questions, with a timer for each question.</li><li>Time per question: ${eqQuizStageSeconds(quiz).map(s=>s+'s').join(' / ')} across three stages.</li><li>Answers lock when submitted. Leaving early counts as an attempt.</li><li>Up to ${Number(quiz.xpReward)||0} base XP and a ${Number(budget)||0}-coin budget, subject to your class reward rules.</li></ul><p>Need more time to prepare? Flashcards and practice are always free of attempt limits while this set is open.</p><div class="modal-actions">${button('close-confirm','Keep studying')}${button('start-scored','Start scored quiz '+icon('arrow'),'data-id="'+escape(quiz.id)+'"',true)}</div></div>`,'md');
  }
  function teacherPreview(id) {
    identity();
    if (!['teacher','admin'].includes(typeof currentRole==='undefined'?'':currentRole)) return;
    const quiz=all().find(q=>q.id===id);if (!quiz?.questions?.length) return;
    if(currentRole==='teacher' && quiz.ownerTeacherId && quiz.ownerTeacherId!==uid())return;
    preview={quiz,index:0,flipped:false};renderPreview();
  }
  function renderPreview() {
    if (!preview) return;const q=preview.quiz.questions[preview.index];
    showModal(`<div class="quest-studio"><p class="qs-eyebrow">Student flashcard preview / ${preview.index+1} of ${preview.quiz.questions.length}</p><h2>${escape(preview.quiz.title)}</h2><button class="qs-flashcard qs-preview-card" data-qs-action="preview-flip"><span class="qs-flashcard-label">${preview.flipped?'Answer':'Question'}</span><span class="qs-flashcard-content">${escape(preview.flipped?answer(q):prompt(q))}</span><span class="qs-flashcard-hint">${icon('flip')} Click to flip</span></button><p class="qs-storage-note">All five question types become flashcards and untimed practice automatically. Preview does not create a student attempt.</p><div class="modal-actions">${button('preview-prev','Previous',preview.index===0?'disabled':'')}${button('preview-next','Next',preview.index===preview.quiz.questions.length-1?'disabled':'')}${button('close-preview','Done')}</div></div>`,'lg');
  }
  function act(action, el) {
    identity();
    if (action==='library') return renderLibrary();
    if (action==='clear') {query='';filter='all';return renderLibrary();}
    if (action==='filter') {filter=el.dataset.filter;return renderLibrary();}
    if (action==='open') return open(el.dataset.id);
    if (action==='save') {const id=el.dataset.id;memory.saved=memory.saved.includes(id)?memory.saved.filter(v=>v!==id):[...memory.saved,id];persist();return renderLibrary();}
    if (action==='reward-guide') return window.LearningRewards?.openGuide();
    if (action==='close-confirm') return closeModalForce();
    if (action==='preview-flip' && preview) {preview.flipped=!preview.flipped;return renderPreview();}
    if (action==='preview-next' && preview) {preview.index=Math.min(preview.quiz.questions.length-1,preview.index+1);preview.flipped=false;return renderPreview();}
    if (action==='preview-prev' && preview) {preview.index=Math.max(0,preview.index-1);preview.flipped=false;return renderPreview();}
    if (action==='close-preview') {preview=null;return closeModalForce();}
    const quiz=currentQuiz();if (!quiz) return renderLibrary();
    if (action==='start-scored') {if(el.dataset.id!==quiz.id || !eqQuizAttemptStatus(quiz.id,uid()).allowed)return;closeModalForce();session=null;view='library';return startQuiz(quiz.id);}
    if (action==='confirm') return confirmScored();
    if (action==='cards') return startCards();
    if (action==='cards-starred') return startCards('starred');
    if (action==='cards-learning') return startCards('learning');
    if (action==='practice') return startPractice();
    if (action==='practice-missed') return startPractice(missed(quiz));
    if (!session) return;
    if (action==='retry-missed') return startPractice(session.order.filter(i=>session.results[i]<1));
    if (view==='cards') {
      const state=progress(quiz),qi=session.order[session.index];
      if (action==='flip') session.flipped=!session.flipped;
      else if (action==='previous') {session.index=Math.max(0,session.index-1);session.flipped=false;}
      else if (action==='next') {session.index=Math.min(session.order.length-1,session.index+1);session.flipped=false;}
      else if (action==='shuffle') {session.order=shuffle(session.order);session.index=0;session.flipped=false;}
      else if (action==='restart-cards') {session.index=0;session.flipped=false;}
      else if (action==='star') state.starred=state.starred.includes(qi)?state.starred.filter(i=>i!==qi):[...state.starred,qi];
      else if (['known','learning'].includes(action) && session.flipped) {
        state.known=state.known.filter(i=>i!==qi);if(action==='known')state.known.push(qi);
        if(session.index<session.order.length-1){session.index++;session.flipped=false;}
      } else return;
      persist();return renderCards();
    }
    if (view==='practice') {
      const qi=session.order[session.index],q=quiz.questions[qi];
      if (action==='skip' && !session.checked) {session.results[qi]=0;session.checked=true;return renderPractice();}
      if (action==='check' && !session.checked && hasAnswer(q,session.answers[qi])) {session.results[qi]=eqGradeAnswer(q,session.answers[qi]);session.checked=true;return renderPractice();}
      if (action==='practice-next' && session.checked) {if(session.index===session.order.length-1)return practiceSummary();session.index++;session.checked=false;return renderPractice();}
    }
  }
  document.addEventListener('click', event=>{
    const teacher=event.target.closest('[data-quest-preview]');if(teacher)return teacherPreview(teacher.dataset.questPreview);
    const review=event.target.closest('[data-quest-review]');if(review){navTo('s-quizzes');return open(review.dataset.questReview);}
    const el=event.target.closest('[data-qs-action]');if(!el || el.disabled || !el.closest('.quest-studio'))return;
    act(el.dataset.qsAction,el);
  },true); // The shared modal shell intentionally stops bubbling clicks.
  document.addEventListener('input',event=>{
    if(event.target.id==='qs-search'){query=event.target.value;return renderResults();}
    if(!event.target.matches('[data-qs-answer]') || view!=='practice' || !session || session.checked)return;
    if(owner!==uid())return;const qi=session.order[session.index],kind=event.target.dataset.qsAnswer;
    if(kind==='array'){if(!Array.isArray(session.answers[qi]))session.answers[qi]=[];session.answers[qi][Number(event.target.dataset.index)]=event.target.value;}
    else session.answers[qi]=kind==='option'?Number(event.target.value):event.target.value;
    const btn=container().querySelector('[data-qs-action="check"]');const q=currentQuiz()?.questions[qi];if(btn&&q)btn.disabled=!hasAnswer(q,session.answers[qi]);
  });
  document.addEventListener('change',event=>{if(event.target.id==='qs-sort'){sort=event.target.value;renderResults();}});
  document.addEventListener('keydown',event=>{
    if(view==='practice' && event.key==='Enter' && event.target.id==='qs-free-answer'){event.preventDefault();const btn=container()?.querySelector('[data-qs-action=check]');if(btn&&!btn.disabled)btn.click();return;}
    if(view!=='cards' || owner!==uid() || !container()?.classList.contains('active') || document.getElementById('modal-overlay')?.getClientRects().length || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,textarea,select,[contenteditable]'))return;
    if(event.repeat || (event.key===' ' && event.target.closest('button,a')))return;
    const action={' ':'flip',ArrowLeft:'previous',ArrowRight:'next',k:'known',K:'known',s:'star',S:'star'}[event.key];
    if(action){event.preventDefault();act(action,container());}
  });
  AppStore.subscribe('quest-study-session',(_state,event)=>{
    if(event?.type==='session:booted')identity();
    if(event?.type==='nav:navigated'){session=null;view='library';}
  });
  window.QuestStudy=Object.freeze({renderLibrary,open,teacherPreview,answer,signature,availability,rememberAttempt});
})();
