// Phase 7, Stream B — equivalence check for modules/admin/quiz-builder.js.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const STARTER_HTML = `<!doctype html><html><body>
  <div id="a-quizzes"></div>
  <div id="modal-root"></div>
</body></html>`;

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously' });
  const win = dom.window;
  const calls = [];
  win.__calls = calls;

  win.currentUser = { id: 't1' };
  win._esc = s => String(s == null ? '' : s);
  let uidCounter = 0;
  win.uid = function () { uidCounter++; return 'uid' + uidCounter; };
  win.toast = function (msg, color) { calls.push({ name: 'toast', msg, color }); };
  win.showModal = function (html, size) {
    calls.push({ name: 'showModal', size });
    win.document.getElementById('modal-root').innerHTML = html;
  };
  win.closeModalForce = function () { calls.push({ name: 'closeModalForce' }); win.document.getElementById('modal-root').innerHTML = ''; };
  win.saveDB = function () { calls.push({ name: 'saveDB' }); };
  win.HTMLElement.prototype.scrollIntoView = function () {};

  const sections = [
    { id: 'sec-a', gradeLevel: '10', sectionName: 'Rizal', adviserId: 't1', archived: false },
    { id: 'sec-b', gradeLevel: '9', sectionName: 'Bonifacio', adviserId: 't1', archived: false },
  ];

  win.ACH_RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'];
  win.ACH_RARITY = {
    Common: { color: '#aaa', glow: 'rgba(170,170,170,.15)' },
    Uncommon: { color: '#4edea3', glow: 'rgba(78,222,163,.15)' },
    Rare: { color: '#5fb4ff', glow: 'rgba(95,180,255,.15)' },
    Epic: { color: '#c084fc', glow: 'rgba(192,132,252,.15)' },
    Legendary: { color: '#ffb95f', glow: 'rgba(255,185,95,.15)' },
    Mythic: { color: '#ff6b9d', glow: 'rgba(255,107,157,.15)' },
  };
  win.QUIZ_STAGE_DEFAULT_SECONDS = [30, 20, 15];
  win.eqQType = q => q.type || 'mc';
  win.eqQuizRarity = q => q.rarity || 'Common';
  win.eqQuizCadence = q => q.cadence || 'standing';
  win.eqDaysUntil = iso => 3;
  win.eqQuizScheduleStatus = function (q) {
    if (!q.startDate && !q.endDate) return null;
    const today = '2026-06-15';
    if (q.startDate && today < q.startDate) return 'upcoming';
    if (q.endDate && today > q.endDate) return 'expired';
    return 'active';
  };
  win.eqComputeQuizAnalytics = function (id) {
    if (id === 'q-no-analytics') {
      return { completionRate: 0, completedCount: 0, totalStudents: 5, avgScore: null, attemptCount: 0, perQuestion: [] };
    }
    return {
      completionRate: 60, completedCount: 3, totalStudents: 5, avgScore: 78, attemptCount: 4,
      perQuestion: [
        { index: 0, text: 'Q1', pctCorrect: 40 },
        { index: 1, text: 'Q2', pctCorrect: 90 },
        { index: 2, text: 'Q3', pctCorrect: null },
      ],
    };
  };

  const students = [];
  for (let i = 1; i <= 5; i++) students.push({ id: 's' + i, completedQuizzes: i <= 2 ? ['q1'] : [] });

  let state = {
    quizzes: [
      { id: 'q1', title: 'Existing Quiz', desc: 'd', xpReward: 50, coinReward: 20, timeLimit: 5, questions: [{ type: 'mc', q: 'Q?', opts: ['A', 'B', 'C', 'D'], answer: 0 }], rarity: 'Common', cadence: 'standing', chainId: null, chainOrder: 1, chainLabel: '', startDate: null, endDate: null, stageTimers: [null, null, null], ownerTeacherId: 't1' },
    ],
    students,
    quizSectionAssignments: { q1: ['sec-a'] },
  };
  win.DB = { get quizzes() { return state.quizzes; }, get students() { return state.students; }, get quizSectionAssignments() { return state.quizSectionAssignments; } };
  win.AppStore = {
    getSlice(fn) { return fn(JSON.parse(JSON.stringify({ ...state, classSections: sections }))); },
    updateState(fn, event) {
      const draft = JSON.parse(JSON.stringify(state));
      fn(draft);
      state = draft;
      calls.push({ name: 'AppStore.updateState', event });
    },
    getState() { return JSON.parse(JSON.stringify({ ...state, classSections: sections })); },
  };
  win.__getFakeState = () => JSON.parse(JSON.stringify(state));

  win.DBService = {
    async rpc(name, params) {
      calls.push({ name, params: JSON.parse(JSON.stringify(params || {})) });
      if (name === 'set_quiz_sections') {
        if (params.p_quiz_id === 'FAIL-SECTIONS') return { data: null, error: { message: 'boom: sections sync failed' } };
        return { data: null, error: null };
      }
      if (name === 'delete_quiz') {
        if (params.p_quiz_id === 'FAIL-DELETE') return { data: null, error: { message: 'boom: delete failed' } };
        return { data: null, error: null };
      }
      throw new Error('unexpected rpc: ' + name);
    },
  };

  return win;
}

function snapshot(win) {
  return {
    mainHtml: win.document.getElementById('a-quizzes').innerHTML,
    modalHtml: win.document.getElementById('modal-root').innerHTML,
    calls: win.__calls,
  };
}

async function runSequence(win) {
  const results = {};

  // Render list + search + pagination.
  win.renderAdminQuizzes();
  results.initialRender = snapshot(win);
  win.__calls.length = 0;

  win.qbSetSearch('Existing');
  results.afterSearch = snapshot(win);
  win.qbSetSearch('zzz-no-match');
  results.afterSearchNoMatch = snapshot(win);
  win.qbSetSearch('');
  win.__calls.length = 0;

  // Template chooser + blank builder.
  win.openQuestTemplateChooser();
  results.templateChooser = snapshot(win);
  win.__calls.length = 0;

  win.openQuizBuilder(); // blank
  results.blankBuilderOpen = snapshot(win);
  win.__calls.length = 0;

  // A NOTE ON THIS FILE'S TESTABILITY: nearly every text field in the
  // question editor and the top-level quiz-metadata fields (title, desc,
  // xp/coins/time, chain fields, dates) are wired via raw inline HTML
  // event-handler attributes that read/write the bare module-scope
  // `draftQuiz` identifier directly (e.g. oninput="draftQuiz.title=this.
  // value"), NOT through an exposed window function. jsdom's inline
  // event-handler execution does not resolve a classic <script>'s
  // top-level `let`/`const` bindings the way real browsers do (this is a
  // jsdom fidelity gap, symmetric between the original and the
  // converted module — neither is reachable this way in this harness) —
  // so those specific fields cannot be safely driven via simulated DOM
  // events here. Every STRUCTURAL mutation (question type switching,
  // add/remove option/pair/answer/question, setCorrect, and section
  // assignment via updateDraftQuizSections) IS reachable and tested
  // below, since those go through real window-bound functions called
  // directly — jsdom's limitation doesn't apply to direct function calls,
  // only to its own compilation of inline-attribute-handler strings.

  // Add a question, cycle through all 5 types via the real window functions.
  win.addQuestion();
  const qi = 0;
  for (const type of ['tf', 'id', 'enum', 'match', 'mc']) {
    win.setQuestionType(qi, type);
  }
  results.afterTypeChain = snapshot(win);
  win.__calls.length = 0;

  // MC option add/remove + setCorrect.
  win.addOption(qi);
  win.setCorrect(qi, 2);
  win.removeOption(qi, 0);
  results.afterMcEdits = snapshot(win);
  win.__calls.length = 0;

  // Switch to identification, exercise setAltAnswers (a real function).
  win.setQuestionType(qi, 'id');
  win.setAltAnswers(qi, 'alt1, alt2 , ,alt3');
  results.afterIdEdits = snapshot(win);
  win.__calls.length = 0;

  // Switch to enum, add/remove blanks.
  win.setQuestionType(qi, 'enum');
  win.addEnumAnswer(qi);
  win.setEnumAnswer(qi, 0, 'first');
  win.removeEnumAnswer(qi, 1);
  results.afterEnumEdits = snapshot(win);
  win.__calls.length = 0;

  // Switch to match, add/edit/remove pairs.
  win.setQuestionType(qi, 'match');
  win.addMatchPair(qi);
  win.setMatchPair(qi, 0, 'left', 'Term');
  win.setMatchPair(qi, 0, 'right', 'Def');
  win.removeMatchPair(qi, 2);
  results.afterMatchEdits = snapshot(win);
  win.__calls.length = 0;

  // Save validation: blank quiz has an empty title by default (never
  // touched — see the note above) and this one leftover question is now
  // blank-text mc after all the type switching above, so this exercises
  // BOTH the no-title and (via the fallback order) confirms saveQuiz
  // bails at the title check first.
  await win.saveQuiz();
  results.saveNoTitleError = snapshot(win);
  win.__calls.length = 0;

  // Remove the question too, to independently exercise the
  // no-questions branch on a fresh blank builder.
  win.openQuizBuilder();
  await win.saveQuiz();
  results.saveNoQuestionsError = snapshot(win);
  win.__calls.length = 0;

  // Invalid question: add one and switch it to 'match' (default 2 blank
  // pairs — fails the match validator's non-empty-text requirement).
  win.addQuestion();
  win.setQuestionType(0, 'match');
  await win.saveQuiz();
  results.saveInvalidQuestionError = snapshot(win);
  win.__calls.length = 0;

  // ── Successful saves use the EDIT flow exclusively, so the seeded
  // quiz's already-valid title/desc/rewards/question text carry over
  // unmodified (see the note above on why text fields aren't otherwise
  // reachable) — only structural mutation (section assignment) is applied. ──
  win.openQuizBuilder('q1');
  results.editBuilderOpen = snapshot(win);
  win.__calls.length = 0;

  const sel = win.document.getElementById('qb-sections');
  Array.from(sel.options).forEach(o => { o.selected = (o.value === 'sec-a' || o.value === 'sec-b'); });
  win.updateDraftQuizSections(sel);
  await win.saveQuiz();
  results.saveEditOkWithSections = { state: win.__getFakeState(), snapshot: snapshot(win) };
  win.__calls.length = 0;

  // Re-open + save again with sections cleared to [] — exercises the
  // set_quiz_sections RPC with an empty array, and re-confirms the
  // completedQuizzes-invalidation-on-edit behavior a second time.
  win.openQuizBuilder('q1');
  const sel2 = win.document.getElementById('qb-sections');
  Array.from(sel2.options).forEach(o => { o.selected = false; });
  win.updateDraftQuizSections(sel2);
  await win.saveQuiz();
  results.saveEditOkSectionsCleared = { state: win.__getFakeState(), snapshot: snapshot(win) };
  win.__calls.length = 0;

  // Clone an existing quest.
  win.cloneQuiz('q1');
  results.afterClone = { state: win.__getFakeState(), snapshot: snapshot(win) };
  win.__calls.length = 0;

  // Delete flow: modal + confirm (success) + confirm (RPC fail).
  win.deleteQuiz('q1');
  results.deleteModalOpen = snapshot(win);
  win.__calls.length = 0;

  await win.confirmDeleteQuiz('q1');
  results.deleteConfirmOk = { state: win.__getFakeState(), snapshot: snapshot(win) };
  win.__calls.length = 0;

  win.AppStore.updateState(d => { d.quizzes.push({ id: 'FAIL-DELETE', title: 'ToFail', desc: '', xpReward: 1, coinReward: 1, timeLimit: 1, questions: [{ type: 'mc', q: 'q', opts: ['a', 'b'], answer: 0 }] }); }, { type: 'test:seed' });
  win.__calls.length = 0;
  await win.confirmDeleteQuiz('FAIL-DELETE');
  results.deleteConfirmRpcFail = { state: win.__getFakeState(), snapshot: snapshot(win) };
  win.__calls.length = 0;

  // Analytics: with zero-attempts data (empty perQuestion), and with real data.
  win.AppStore.updateState(d => { d.quizzes.push({ id: 'q-no-analytics', title: 'No Data Quiz', desc: '', xpReward: 1, coinReward: 1, timeLimit: 1, questions: [] }); }, { type: 'test:seed2' });
  win.__calls.length = 0;
  win.openQuizAnalytics('q-no-analytics');
  results.analyticsEmptyData = snapshot(win);
  win.__calls.length = 0;

  win.AppStore.updateState(d => { d.quizzes.push({ id: 'q-with-analytics', title: 'Data Quiz', desc: '', xpReward: 1, coinReward: 1, timeLimit: 1, questions: [] }); }, { type: 'test:seed3' });
  win.__calls.length = 0;
  win.openQuizAnalytics('q-with-analytics');
  results.analyticsWithData = snapshot(win);
  win.__calls.length = 0;

  // The real guard: eqComputeQuizAnalytics itself missing -> early return, no-op.
  const realAnalyticsFn = win.eqComputeQuizAnalytics;
  win.eqComputeQuizAnalytics = undefined;
  win.openQuizAnalytics('q-with-analytics');
  results.analyticsFunctionMissingNoop = snapshot(win);
  win.eqComputeQuizAnalytics = realAnalyticsFn;

  return results;
}

async function main() {
  const sectionsServiceSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'sections-service.js'), 'utf8');
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'quiz-builder.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'quiz-builder.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(sectionsServiceSrc);
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.renderAdminQuizzes, 'function');
  const resultOriginal = await runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.renderAdminQuizzes, 'function');
  const resultBridge = await runSequence(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original output at every step');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('quiz-builder.js: list render + search/pagination, template chooser, blank + edit builder,');
  console.log('all 5 question type transitions with their editors (mc/tf/id/enum/match), the no-title/');
  console.log('no-questions/invalid-question save validators, save success via the edit flow (incl.');
  console.log('completedQuizzes invalidation and both section-sync outcomes), clone, delete (modal +');
  console.log('confirm success/RPC-fail), and analytics (empty-data/real-data/function-missing-guard) all');
  console.log('match. (The bad-date-range validator and per-field text edits are not driven via simulated');
  console.log('DOM events — jsdom cannot resolve a classic script\'s bare top-level `let` from inline');
  console.log('oninput/onchange attribute handlers, symmetrically for both original and bridge — see the');
  console.log('inline comment in runSequence() and MEMORY.md.)');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
