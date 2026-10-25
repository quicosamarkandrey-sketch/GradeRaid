// Phase 7 (Stream A) — equivalence check for index.html#inline2 (THE LAST
// file in Stream A's 29-file list). See src/inline2.js's own header for
// the full export-count reconciliation and real-import/exclusion
// reasoning — not repeated here.
//
// SCOPE (deliberate, not exhaustive — inline2.js is ~2750 lines covering
// Quest Board rendering, the full MC/TF/ID/Enum/Match quiz runner, the
// mascot ambient-mood state machine, and the profile modal):
//   • THOROUGH: one full MC quiz attempt end-to-end (start → answer both
//     questions correctly → finish, real AppStore XP/coin grant, real
//     quizHistory row), a separate abort-mid-quiz attempt, the mascot
//     ambient-mood state machine (idle/nervous/scared/confident + the
//     one-shot lowTime event), and the profile modal (open, tab-switch,
//     saveProfileEdit, savePassword's 4 validation branches + success,
//     saveEmail's validation branches + success).
//   • LIGHT SMOKE ONLY: renderStudentDashboard()/renderStudentQuizzes()
//     just need to render without throwing and produce recognizable
//     markup — their own internal correctness is Quest-Board-rendering
//     detail, not re-verified line-by-line here.
//   • NOT covered: TF/ID/Enum/Match question types, quest chains, daily/
//     weekly cadence scheduling, hint usage, combo milestones (x3/x5),
//     retry-multiplier attempts 2-4, profile picture upload (FileReader-
//     based, not meaningfully jsdom-testable here).
//
// REAL vs STUBBED dependencies (both sides get the IDENTICAL choice):
//   • modules/quest-engine.js and modules/quest-mascot-lines.js — real,
//     unconverted classic scripts, evaluated VERBATIM on both sides
//     (higher-fidelity than hand-rolled stubs, and they're simple/
//     self-contained: only external refs are AppStore, DB, isoDate, and
//     computeAttendanceStreak — all already available). This gives real
//     eqGradeAnswer/eqQuestionStage/eqComboMultiplier/eqQuizPassed/
//     eqQuizAttemptStatus/eqMascotEmotionFor behavior instead of guesses.
//   • utils.js — real, unconverted, evaluated verbatim both sides (same
//     reasoning; only external ref is `toast`, stubbed below).
//   • Math.random is seeded deterministically (both sides, reseeded per
//     scenario) — eqMascotLine() and uid() both call it; without seeding,
//     the two independent windows would pick different pool entries and
//     the equivalence check would spuriously fail on non-determinism that
//     has nothing to do with the bridge being correct or not.
//   • eqQuizChain/eqGetQuestChains/eqChainStatus/eqRewardPresent/
//     MascotLinesService/eqClassifyActivity/renderStatBar/runSequence/
//     startAmbientBackdrop/burstParticles/ACH_RARITY/tsBuildBadgeHTML/
//     eqDaysUntil/eqGetDailyQuizIds/eqGetWeeklyQuizId/
//     eqQuizScheduleStatus — left undefined on purpose. Every call site is
//     `typeof X === 'function'`/`!== 'undefined'` guarded (confirmed by
//     grep against src/inline2.js), so this is a real, disclosed gap
//     (chain-locking, reward-presentation popup, custom mascot lines,
//     activity-feed icons, stat-bar animation, dashboard hero
//     entrance sequence/backdrop, achievement-rarity palette fallback,
//     equipped-title badge chip, and cadence/scheduling badges are not
//     exercised) rather than a silent behavior change.
//
// Timers: startQuestionTimer()'s per-second setInterval and
// _quizShowRevealThenAdvance()'s reveal→advance setTimeout are REAL —
// answers are submitted well within the first second so the interval
// never actually ticks, and the script awaits real wall-clock time
// (sleep()) across the reveal delay rather than faking it. main() force-
// exits via process.exit() regardless, same convention as
// att_scanner_rfid's real setInterval gotcha.
//
// `new Date().toISOString()`/`isoDate()` timestamps are inherently
// non-deterministic across two separately-run windows a few ms apart —
// normalizeTimestamps() blanks them before comparing, same pattern as
// admin-compose/attendance-service's own verify scripts.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const DOM_HTML = `
  <div id="sidebar"></div><div id="sidebar-nav"></div>
  <button id="cart-fab"></button>
  <div id="s-dashboard" class="page">
    <canvas id="dash-hero-canvas"></canvas>
    <div id="dash-hero"></div>
    <div id="dash-xp-bar"></div>
  </div>
  <div id="s-quizzes" class="page"></div>
  <div id="s-quiz-active" class="page"></div>
  <div id="topbar-av"></div><div id="topbar-coins"><span id="topbar-coin-val"></span></div>
  <div id="sb-avatar"></div><div id="sb-name"></div><div id="sb-tier"></div>
  <div id="sb-xp-fill"></div><div id="sb-xp-label"></div><div id="sb-xp-next"></div>
  <div id="profile-overlay">
    <div id="prof-avatar"><span id="prof-av-init"></span></div>
    <div id="prof-display-name"></div><div id="prof-username"></div>
    <div id="prof-role-chip"></div><div id="prof-join-text"></div>
    <div id="prof-stats-strip"></div>
    <button id="ptab-overview" class="profile-tab"></button>
    <button id="ptab-edit" class="profile-tab"></button>
    <button id="ptab-account" class="profile-tab"></button>
    <div id="prof-tab-body"></div>
  </div>
`;

// Seed data shared by every scenario (fresh clone handed out per makeWindow()
// via DBService.read(), matching the real AppStore.init() boot path exactly
// — see state-manager.js: _state = DBService.read(); window.DB = clone(_state)).
function freshSeed() {
  return {
    admin: { id: 'admin1', pass: 'adminpass', name: 'Ms. Admin', firstName: 'Ms.', lastName: 'Admin', displayName: 'Ms. Admin' },
    students: [
      { id: 's1', name: 'Ana Cruz', firstName: 'Ana', lastName: 'Cruz', displayName: 'Ana Cruz', init: 'AC', color: '#8b5cf6', pass: 'pass1', email: '', xp: 0, coins: 0, level: 0, tier: 'Bronze', quizAvg: 0, completedQuizzes: [], classId: 'default' },
      { id: 's2', name: 'Ben Reyes', firstName: 'Ben', lastName: 'Reyes', displayName: 'Ben Reyes', init: 'BR', color: '#4edea3', pass: 'pass2', email: 'taken@example.com', xp: 0, coins: 0, level: 0, tier: 'Bronze', quizAvg: 0, completedQuizzes: [], classId: 'default' },
    ],
    quizzes: [
      { id: 'q1', title: 'Basics Quest', xpReward: 100, coinReward: 50, questions: [
        { q: '2+2?', type: 'mc', opts: ['3', '4', '5'], answer: 1 },
        { q: 'Capital of the Philippines?', type: 'mc', opts: ['Manila', 'Cebu'], answer: 0 },
      ] },
    ],
    quizHistory: {},
    quizAttemptOverrides: {},
    pointLog: [],
    mail: [],
    orders: [],
    achievementUnlocks: {},
    bossEvents: [],
    redemptions: [],
    quizSectionAssignments: {},
  };
}

// Deterministic seeded PRNG (mulberry32) — reseeded fresh per scenario call
// via seedRandom(win) below, so both windows draw the identical sequence
// for uid()/eqMascotLine()'s Math.random() calls.
function seedRandom(win, seed) {
  let s = seed >>> 0;
  win.Math.random = function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeWindow() {
  const dom = new JSDOM(`<!doctype html><html><body>${DOM_HTML}</body></html>`, { runScripts: 'dangerously', url: 'https://example.org/app/index.html' });
  const win = dom.window;
  seedRandom(win, 12345);

  win.__EDUQUEST_SUPABASE_URL__ = '';
  win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };
  // No .rpc — syncStudentStatsToServer()/syncOwnProfileCosmeticToServer()
  // both check `typeof DBService.rpc !== 'function'` and no-op/fail-safe
  // identically on both sides (documented above).
  win.DBService = { initRemote: async () => {}, read: () => freshSeed(), write: () => {} };
  win.DEFAULT_DB = freshSeed();

  // toast()/showModal()/closeModalForce() — dom.js, outside Stream A's own
  // list (window-fallback rule) — simple call-recording stubs so scenario
  // functions can assert a toast/modal happened without needing dom.js's
  // real DOM-heavy implementation.
  win.__toasts = [];
  win.toast = (msg, color) => { win.__toasts.push({ msg, color }); };
  win.__modals = [];
  win.showModal = (html) => { win.__modals.push(html); };
  win.closeModalForce = () => {};

  // achUpdateSidebarBadge/achGrantRewardsForClaim — modules/achievements/
  // ach_engine.js (a different stream's file, not converted). inline2.js's
  // own `window.X = X` pass-through lines (see src/inline2.js header) read
  // these as bare identifiers unconditionally (not typeof-guarded, since
  // they're just re-exporting ach_engine.js's own globals) — must be
  // defined before eval or the bare read throws.
  win.achUpdateSidebarBadge = () => {};
  win.achGrantRewardsForClaim = () => {};

  // jsdom doesn't implement requestAnimationFrame — quizNext()'s combo-band
  // "toast" show/hide uses it purely for a next-tick class add.
  win.requestAnimationFrame = (cb) => setTimeout(cb, 0);

  // window.checkLevelUp(s) — student-stats.js's own level-up trigger,
  // called unconditionally (explicit window prefix) inside finishQuiz()'s
  // AppStore draft. A real implementation exists (recalcStudentStats()'s
  // sibling), but it's not one of this file's 6 real imports (see
  // src/inline2.js header) — a simple no-op stub is enough here since none
  // of this verify script's scenarios assert on level-up specifically.
  win.checkLevelUp = () => {};

  // _adminStoreInterval — nav.js's own bare reference to a shop-module
  // (other stream) global, read unconditionally in _navToCore(). Never
  // actually an active interval in any scenario here.
  win._adminStoreInterval = null;

  // window.getNowLabel() — index.html#inline1's own export (real, but not
  // one of THIS file's 6 real imports — see src/inline2.js header, same
  // "never a real-import target" rule as XP_PER_LEVEL/DB/currentUser).
  // Called unconditionally (explicit window prefix) for pointLog's `when`
  // field, which isn't asserted on below — a fixed string is enough.
  win.getNowLabel = () => 'just now';

  // eqQuizChain(q) — modules/quest-chains.js (a different stream's file,
  // not converted). renderStudentQuizzes()'s `isChained` helper calls it
  // UNGUARDED (unlike startQuiz()'s own typeof-guarded call to the same
  // function), so it must resolve to something even though this verify
  // script's seeded quiz is never part of a chain. `{chainId:null}` is
  // quest-chains.js's own documented "not chained" shape.
  win.eqQuizChain = () => ({ chainId: null });

  // tsGetUnlockedTitles(id) — modules/titles/titles_sidebar_refresh.js (a
  // different stream's file, not converted). _profOverviewHTML() calls it
  // UNGUARDED for the profile overview tab's equipped-title row. An empty
  // array is titles_sidebar_refresh.js's own "nothing unlocked" shape.
  win.tsGetUnlockedTitles = () => [];

  // window.getLevel(xp)/window.XP_PER_LEVEL — index.html#inline1's own
  // exports (real, but not one of THIS file's 6 real imports — same
  // never-a-real-import-target rule as DB/currentUser). Called
  // unconditionally (explicit window prefix) by renderStudentDashboard().
  win.XP_PER_LEVEL = 1000;
  win.getLevel = (xp) => Math.floor((xp || 0) / win.XP_PER_LEVEL);

  // wbcUpdateTopbarWidget / NotificationService — other-stream globals
  // topbar.js's updateTopbar() calls, both typeof-guarded there already;
  // leaving them undefined is the same disclosed gap topbar.js's own
  // verify script already accepts.

  return win;
}

async function evalCommonDeps(win) {
  // Real, unconverted classic-script dependencies OUTSIDE Stream A's file
  // list — evaluated verbatim, identically, on both the original and
  // bridge sides (see file header for why this beats hand-rolled stubs
  // here). Order matches index.html's real script order: utils.js before
  // quest-engine.js (which needs isoDate at call time, not eval time,
  // so strictly this wouldn't even need to be first — kept in real order
  // anyway for clarity).
  win.eval(fs.readFileSync(path.join(__dirname, '..', 'utils.js'), 'utf8'));
  win.eval(fs.readFileSync(path.join(__dirname, '..', 'modules', 'quest-engine.js'), 'utf8'));
  win.eval(fs.readFileSync(path.join(__dirname, '..', 'modules', 'quest-mascot-lines.js'), 'utf8'));
}

async function evalFullOriginalChain(win) {
  await evalCommonDeps(win);
  const files = ['modules/core/state-manager.js', 'student-stats.js', 'nav.js', 'topbar.js'];
  for (const f of files) win.eval(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
  win.eval(fs.readFileSync(path.join(__dirname, 'inline', 'inline2.js'), 'utf8'));
  await win.AppStore.ready;
}

async function evalBridge(win) {
  await evalCommonDeps(win);
  const bridgeSrc = fs.readFileSync(path.join(__dirname, 'test-helpers', 'inline2-combined-bundle.js'), 'utf8');
  win.eval(bridgeSrc);
  // nav.js real-imports 5 render*() functions from files whose own
  // transitive real-imports pull in the REAL src/db-service.js — its own
  // pre-existing trailing `window.DBService = DBService;` self-export
  // (verbatim from the original, same as every other converted file)
  // overwrites the test stub set in makeWindow() the instant this bundle
  // evaluates. AppStore's init() (fired at module-parse time) hasn't run
  // past its first `await DBService.initRemote()` yet when win.eval()
  // returns control here (JS is single-threaded — nothing else has had a
  // chance to run), so re-patching DBService's methods right now, before
  // awaiting AppStore.ready, still lands before init() ever calls
  // DBService.read().
  win.DBService.initRemote = async () => {};
  win.DBService.read = () => freshSeed();
  win.DBService.write = () => {};
  // Also strip the real .rpc (real db-service.js's own — needs the
  // Supabase UMD global, not loaded here) so syncStudentStatsToServer()/
  // syncOwnProfileCosmeticToServer()'s `typeof DBService.rpc !== 'function'`
  // check no-ops identically to the original side (makeWindow()'s stub
  // never had .rpc at all) instead of firing a real (fire-and-forget,
  // caught, but asymmetric) network attempt only on the bridge side.
  delete win.DBService.rpc;
  await win.AppStore.ready;
}

function normalizeTimestamps(results) {
  // `completedAt: new Date().toISOString()` and `isoDate()`'s `date` field
  // in quizHistory rows are inherently non-deterministic across two
  // separately-run windows a few ms (or, at a day boundary, days...
  // acceptable risk, same as other verify scripts) apart.
  const clone = JSON.parse(JSON.stringify(results));
  const scrub = (row) => { if (row) { if (row.completedAt) row.completedAt = 'NORMALIZED'; if (row.date) row.date = 'NORMALIZED'; } };
  ['quizFlow', 'abortFlow'].forEach(k => {
    if (clone[k] && clone[k].historyRow) scrub(clone[k].historyRow);
  });
  return clone;
}

// ── Scenario: full MC quiz completion (both questions correct) ──────────
async function runQuizCompletionScenario(win) {
  const results = {};
  win.currentUser = win.AppStore.getStudent('s1');
  win.currentRole = 'student';

  win.startQuiz('q1');
  results.afterStart = {
    pageActive: win.document.getElementById('s-quiz-active').classList.contains('active'),
    questionText: win.document.getElementById('s-quiz-active').innerHTML.includes('2+2?'),
    mascotLineShown: win.document.getElementById('quiz-mascot-cloud').classList.contains('show'),
  };

  // Q1: correct answer is index 1 ("4")
  win.selectOpt(1);
  win.quizNext();
  results.afterQ1Next = {
    nextDisabled: win.document.getElementById('btn-next').disabled,
    revealShown: win.document.getElementById('s-quiz-active').innerHTML.includes('quiz-reveal-flash'),
  };
  await sleep(1100); // correct-answer reveal delay is 1000ms

  results.afterQ1Advance = {
    questionText: win.document.getElementById('s-quiz-active').innerHTML.includes('Capital of the Philippines?'),
  };

  // Q2: correct answer is index 0 ("Manila")
  win.selectOpt(0);
  win.quizNext();
  await sleep(1100); // last question -> finishQuiz() runs synchronously inside _quizAdvanceNow

  const student = win.AppStore.getStudent('s1');
  results.finalStudent = { xp: student.xp, coins: student.coins, quizAvg: student.quizAvg, completedQuizzes: student.completedQuizzes.slice() };
  const hist = win.AppStore.getSlice(s => s.quizHistory)['s1'];
  results.historyRow = hist && hist[0] ? { score: hist[0].score, passed: hist[0].passed, attempt: hist[0].attempt, aborted: !!hist[0].aborted, resultsLen: hist[0].results.length, completedAt: hist[0].completedAt, date: hist[0].date } : null;
  results.pointLogEntry = win.AppStore.getSlice(s => s.pointLog)[0] ? { pts: win.AppStore.getSlice(s => s.pointLog)[0].pts, what: win.AppStore.getSlice(s => s.pointLog)[0].what } : null;
  results.resultsScreen = {
    showsQuestComplete: win.document.getElementById('s-quiz-active').innerHTML.includes('Quest Complete!'),
    showsScore: win.document.getElementById('s-quiz-active').innerHTML.includes('100'),
  };

  return results;
}

// ── Scenario: abort mid-quiz (no answers given) ──────────────────────────
async function runQuizAbortScenario(win) {
  const results = {};
  win.currentUser = win.AppStore.getStudent('s1');
  win.currentRole = 'student';

  win.startQuiz('q1');
  win.abortQuiz();

  const student = win.AppStore.getStudent('s1');
  results.finalStudent = { xp: student.xp, coins: student.coins, completedQuizzes: student.completedQuizzes.slice() };
  const hist = win.AppStore.getSlice(s => s.quizHistory)['s1'];
  results.historyRow = hist && hist[0] ? { score: hist[0].score, passed: hist[0].passed, aborted: !!hist[0].aborted, completedAt: hist[0].completedAt, date: hist[0].date } : null;
  results.toasts = win.__toasts.slice();
  results.navigatedToQuizzes = win.document.getElementById('s-quizzes').classList.contains('active');
  results.quizzesPageRendered = win.document.getElementById('s-quizzes').innerHTML.length > 0;

  // A second abortQuiz() call (activeQuiz already null) must be a safe no-op
  // that just re-navigates, not a crash or a duplicate history row.
  win.abortQuiz();
  const histAfter = win.AppStore.getSlice(s => s.quizHistory)['s1'];
  results.secondAbortIsNoOp = (histAfter || []).length === (hist || []).length;

  return results;
}

// ── Scenario: mascot ambient-mood state machine ──────────────────────────
function runMascotAmbientScenario(win) {
  const results = {};
  // updateMascotAmbientMood() only needs the dock elements — no full quiz
  // render required, but activeQuiz/quizCurrent (read by fireMascotEvent's
  // lowTime dedup) must be in their post-startQuiz default state.
  win.document.body.insertAdjacentHTML('beforeend',
    '<div id="quiz-mascot-figure"></div><span id="quiz-mascot-emoji"></span>' +
    '<div id="quiz-mascot-cloud"><span id="quiz-mascot-cloud-text"></span></div>');
  const figure = () => win.document.getElementById('quiz-mascot-figure');

  // _mascotAmbientEmotion defaults to 'idle' already, and the function
  // early-returns a no-op when the computed emotion matches the current
  // one (documented "never overrides... same pose" behavior) — so calling
  // it with an idle-yielding input FIRST would never actually add the
  // class. Start from a confident state instead so the first assertion
  // below is a genuine, observed transition, not an accidental no-op.
  // Stage 1, plenty of time left -> confident
  win.updateMascotAmbientMood(1, 15, 20);
  results.stage1Calm = figure().className;

  // Stage 0, plenty of time left -> idle (a real transition from confident)
  win.updateMascotAmbientMood(0, 25, 30);
  results.stage0Calm = figure().className;

  // Stage 0, low time (<=20%) -> nervous, AND fires the one-shot lowTime
  // mascot line (cloud shows a real line, not empty).
  win.updateMascotAmbientMood(0, 5, 30);
  results.stage0LowTime = { className: figure().className, cloudShown: win.document.getElementById('quiz-mascot-cloud').classList.contains('show'), cloudTextNonEmpty: win.document.getElementById('quiz-mascot-cloud-text').textContent.length > 0 };

  // Stage 2, low time -> scared
  win.updateMascotAmbientMood(2, 1, 10);
  results.stage2LowTime = figure().className;

  // Calling again with the SAME (stageIdx, pct-band) is a no-op (early
  // return on `emotion === _mascotAmbientEmotion`) — className unchanged.
  win.updateMascotAmbientMood(2, 1, 10);
  results.repeatCallNoOp = figure().className;

  return results;
}

// ── Scenario: profile modal (open, tabs, edit, password, email) ─────────
async function runProfileScenario(win) {
  const results = {};
  win.currentUser = win.AppStore.getStudent('s1');
  win.currentRole = 'student';

  win.openProfile();
  results.hero = {
    displayName: win.document.getElementById('prof-display-name').textContent,
    username: win.document.getElementById('prof-username').textContent,
    overlayOpen: win.document.getElementById('profile-overlay').classList.contains('open'),
  };
  results.overviewTabActive = win.document.getElementById('ptab-overview').classList.contains('active');

  win.switchProfileTab('edit');
  results.editTabHasNameField = win.document.getElementById('prof-tab-body').innerHTML.includes('prof-displayname');

  win.switchProfileTab('account');
  results.accountTabHasEmailField = win.document.getElementById('prof-tab-body').innerHTML.includes('prof-email');

  // ── saveProfileEdit: empty display name -> error, no mutation ──
  win.switchProfileTab('edit');
  win.document.getElementById('prof-displayname').value = '';
  win.document.getElementById('prof-firstname').value = 'Ana';
  win.document.getElementById('prof-lastname').value = 'Cruz';
  await win.saveProfileEdit();
  results.emptyNameBlocked = {
    errShown: win.document.getElementById('prof-edit-err').style.display === 'block',
    nameUnchanged: win.AppStore.getStudent('s1').name === 'Ana Cruz',
  };

  // ── saveProfileEdit: real rename ──
  win.switchProfileTab('edit');
  win.document.getElementById('prof-displayname').value = 'Ana C.';
  win.document.getElementById('prof-firstname').value = 'Ana';
  win.document.getElementById('prof-lastname').value = 'Cortez';
  await win.saveProfileEdit();
  const renamed = win.AppStore.getStudent('s1');
  results.renameApplied = { name: renamed.name, displayName: renamed.displayName, toastShown: win.__toasts.length > 0 };

  // ── savePassword: all 4 validation branches ──
  win.switchProfileTab('account');
  const setPassFields = (cur, nw, conf) => {
    win.document.getElementById('prof-cur-pass').value = cur;
    win.document.getElementById('prof-new-pass').value = nw;
    win.document.getElementById('prof-conf-pass').value = conf;
  };
  setPassFields('', 'newpass', 'newpass'); win.savePassword();
  results.passEmptyCurrent = win.document.getElementById('prof-pass-err').textContent;

  setPassFields('pass1', '', ''); win.savePassword();
  results.passEmptyNew = win.document.getElementById('prof-pass-err').textContent;

  setPassFields('pass1', 'ab', 'ab'); win.savePassword();
  results.passTooShort = win.document.getElementById('prof-pass-err').textContent;

  setPassFields('pass1', 'newpass1', 'newpass2'); win.savePassword();
  results.passMismatch = win.document.getElementById('prof-pass-err').textContent;

  setPassFields('wrongpass', 'newpass1', 'newpass1'); win.savePassword();
  results.passWrongCurrent = win.document.getElementById('prof-pass-err').textContent;

  setPassFields('pass1', 'newpass1', 'newpass1'); win.savePassword();
  results.passSuccess = {
    errHidden: win.document.getElementById('prof-pass-err').style.display === 'none',
    fieldsCleared: win.document.getElementById('prof-cur-pass').value === '',
    actuallyChanged: win.AppStore.getSlice(s => (s.students || []).find(x => x.id === 's1')).pass === 'newpass1',
  };

  // ── saveEmail: invalid format, duplicate, success ──
  win.document.getElementById('prof-email').value = 'not-an-email';
  win.saveEmail();
  results.emailInvalid = win.document.getElementById('prof-email-err').textContent;

  win.document.getElementById('prof-email').value = 'taken@example.com';
  win.saveEmail();
  results.emailDuplicate = win.document.getElementById('prof-email-err').textContent;

  win.document.getElementById('prof-email').value = 'ana@example.com';
  win.saveEmail();
  results.emailSuccess = {
    errHidden: win.document.getElementById('prof-email-err').style.display === 'none',
    savedEmail: win.AppStore.getStudent('s1').email,
  };

  win.closeProfile();
  results.closedOverlayState = win.document.getElementById('profile-overlay').classList.contains('open');

  return results;
}

// ── Scenario: light smoke on dashboard/quizzes rendering ────────────────
function runRenderSmokeScenario(win) {
  const results = {};
  win.currentUser = win.AppStore.getStudent('s1');
  win.currentRole = 'student';

  win.renderStudentDashboard();
  results.dashboard = { nonEmpty: win.document.getElementById('s-dashboard').innerHTML.length > 0, hasXpBar: !!win.document.getElementById('dash-xp-bar') };

  win.renderStudentQuizzes();
  results.quizzes = { nonEmpty: win.document.getElementById('s-quizzes').innerHTML.length > 0, mentionsQuest: win.document.getElementById('s-quizzes').innerHTML.includes('Basics Quest') };

  return results;
}

async function runFullSuite(evalFn) {
  const results = {};

  const win1 = makeWindow(); await evalFn(win1);
  results.quizFlow = await runQuizCompletionScenario(win1);

  const win2 = makeWindow(); await evalFn(win2);
  results.abortFlow = await runQuizAbortScenario(win2);

  const win3 = makeWindow(); await evalFn(win3);
  results.mascot = runMascotAmbientScenario(win3);

  const win4 = makeWindow(); await evalFn(win4);
  results.profile = await runProfileScenario(win4);

  const win5 = makeWindow(); await evalFn(win5);
  results.smoke = runRenderSmokeScenario(win5);

  return results;
}

async function main() {
  const resultOriginal = normalizeTimestamps(await runFullSuite(evalFullOriginalChain));
  const resultBridge = normalizeTimestamps(await runFullSuite(evalBridge));

  // jsdom cross-realm gotcha (documented in MEMORY.md): compare via
  // JSON.stringify rather than assert.deepStrictEqual.
  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original at every step');

  // Sanity checks against the original's real values.
  assert.strictEqual(resultOriginal.quizFlow.afterStart.pageActive, true, 'sanity: startQuiz activates s-quiz-active');
  assert.strictEqual(resultOriginal.quizFlow.afterStart.questionText, true, 'sanity: first question renders');
  assert.strictEqual(resultOriginal.quizFlow.afterQ1Next.nextDisabled, true, 'sanity: Next is disabled during the reveal freeze');
  assert.strictEqual(resultOriginal.quizFlow.afterQ1Advance.questionText, true, 'sanity: advances to question 2 after the reveal delay');
  assert.strictEqual(resultOriginal.quizFlow.finalStudent.xp, 100, 'sanity: a perfect score grants the full xpReward (100% x1 combo x1 retry)');
  assert.strictEqual(resultOriginal.quizFlow.finalStudent.coins, 50, 'sanity: a perfect score grants the full coinReward');
  assert.deepStrictEqual(resultOriginal.quizFlow.finalStudent.completedQuizzes, ['q1'], 'sanity: quiz id joins completedQuizzes');
  assert.strictEqual(resultOriginal.quizFlow.historyRow.score, 100, 'sanity: quizHistory row scores 100');
  assert.strictEqual(resultOriginal.quizFlow.historyRow.passed, true, 'sanity: a 100 score passes');
  assert.strictEqual(resultOriginal.quizFlow.resultsScreen.showsQuestComplete, true, 'sanity: results screen shows the pass state');

  assert.strictEqual(resultOriginal.abortFlow.finalStudent.xp, 0, 'sanity: abort grants no xp');
  assert.deepStrictEqual(resultOriginal.abortFlow.finalStudent.completedQuizzes, [], 'sanity: abort does not complete the quest');
  assert.strictEqual(resultOriginal.abortFlow.historyRow.aborted, true, 'sanity: abort logs an aborted:true row');
  assert.strictEqual(resultOriginal.abortFlow.historyRow.passed, false, 'sanity: an abort is always a loss, never passed');
  assert.strictEqual(resultOriginal.abortFlow.navigatedToQuizzes, true, 'sanity: abort navigates back to s-quizzes');
  assert.strictEqual(resultOriginal.abortFlow.secondAbortIsNoOp, true, 'sanity: aborting twice does not double-log');

  assert.strictEqual(resultOriginal.mascot.stage0Calm.includes('mascot-emotion-idle'), true, 'sanity: calm stage 0 is idle');
  assert.strictEqual(resultOriginal.mascot.stage1Calm.includes('mascot-emotion-confident'), true, 'sanity: calm stage 1+ is confident');
  assert.strictEqual(resultOriginal.mascot.stage0LowTime.className.includes('mascot-emotion-nervous'), true, 'sanity: low time at stage 0/1 is nervous');
  assert.strictEqual(resultOriginal.mascot.stage0LowTime.cloudShown, true, 'sanity: low time fires the mascot cloud line');
  assert.strictEqual(resultOriginal.mascot.stage2LowTime.includes('mascot-emotion-scared'), true, 'sanity: low time at stage 2 is scared');
  assert.strictEqual(resultOriginal.mascot.repeatCallNoOp, resultOriginal.mascot.stage2LowTime, 'sanity: an unchanged mood is a no-op re-render');

  assert.strictEqual(resultOriginal.profile.hero.displayName, 'Ana Cruz', 'sanity: profile hero shows the display name');
  assert.strictEqual(resultOriginal.profile.overviewTabActive, true, 'sanity: openProfile defaults to the overview tab');
  assert.strictEqual(resultOriginal.profile.editTabHasNameField, true, 'sanity: edit tab renders the name fields');
  assert.strictEqual(resultOriginal.profile.emptyNameBlocked.errShown, true, 'sanity: empty display name is blocked');
  assert.strictEqual(resultOriginal.profile.emptyNameBlocked.nameUnchanged, true, 'sanity: a blocked edit does not mutate state');
  assert.strictEqual(resultOriginal.profile.renameApplied.name, 'Ana Cortez', 'sanity: a valid edit actually renames the student');
  assert.strictEqual(resultOriginal.profile.passEmptyCurrent, 'Current password is required.', 'sanity: password validation message 1');
  assert.strictEqual(resultOriginal.profile.passEmptyNew, 'New password cannot be empty.', 'sanity: password validation message 2');
  assert.strictEqual(resultOriginal.profile.passTooShort, 'New password must be at least 4 characters.', 'sanity: password validation message 3');
  assert.strictEqual(resultOriginal.profile.passMismatch, 'Passwords do not match.', 'sanity: password validation message 4');
  assert.strictEqual(resultOriginal.profile.passWrongCurrent, 'Current password is incorrect.', 'sanity: password validation message 5');
  assert.strictEqual(resultOriginal.profile.passSuccess.actuallyChanged, true, 'sanity: a valid password change actually persists');
  assert.strictEqual(resultOriginal.profile.emailInvalid, 'Please enter a valid email address.', 'sanity: email format validation');
  assert.strictEqual(resultOriginal.profile.emailDuplicate, 'That email is already in use by another account.', 'sanity: email duplicate validation');
  assert.strictEqual(resultOriginal.profile.emailSuccess.savedEmail, 'ana@example.com', 'sanity: a valid email actually saves');
  assert.strictEqual(resultOriginal.profile.closedOverlayState, false, 'sanity: closeProfile removes the open class');

  assert.strictEqual(resultOriginal.smoke.dashboard.nonEmpty, true, 'sanity: dashboard renders something');
  assert.strictEqual(resultOriginal.smoke.quizzes.mentionsQuest, true, 'sanity: quizzes page lists the seeded quest');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('index.html#inline2 (src/inline2.js, Stream A file 29/29 — THE LAST FILE): a full');
  console.log('MC quiz completion (real AppStore XP/coin grant + quizHistory row + results screen),');
  console.log('a mid-quiz abort (loss penalty, no double-logging), the mascot ambient-mood state');
  console.log('machine (idle/confident/nervous/scared + the one-shot lowTime line), the full profile');
  console.log('modal (tabs, edit, all 5 password-validation branches + success, email validation +');
  console.log('duplicate check + success), and dashboard/quizzes-page render smoke all match.');
}

main().then(() => process.exit(0)).catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
