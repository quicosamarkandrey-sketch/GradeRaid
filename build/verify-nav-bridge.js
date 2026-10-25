// Phase 7 (Stream A) — equivalence check for nav.js.
//
// Real-imports AppStore and 5 render*() functions (renderStudentMail,
// renderStudentProgress, renderRfidScanner, renderRecitationAttendanceLog,
// renderAdminMail) — all this stream's own already-converted files/
// symbols, all confirmed via repo-wide grep against the "no runtime
// reassignment anywhere" rule (MEMORY.md) before finalizing.
//
// Because these 5 are real-imported, a `window.renderX = spy` override
// is silently ignored (documented gotcha) — dispatch correctness is
// instead verified by actually invoking the REAL render function (full
// environment setup per target, reusing what each function's own
// verify script already established) and checking for a characteristic
// piece of its real output. This script does NOT re-verify each
// render function's own internal correctness (already covered by
// their own verify-*-bridge.js scripts) — only that nav.js's routing
// table calls the RIGHT one for each page id.
//
// renderRfidScanner() starts real setInterval timers (documented
// att_scanner_rfid.js gotcha) — unmountRfidScanner() is called after
// testing it, and main() force-exits via process.exit() regardless.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const DOM_HTML = `
  <div id="sidebar-nav"></div><div id="sidebar" class=""></div>
  <div id="s-dashboard" class="page"></div><div id="a-dashboard" class="page"></div>
  <div id="s-mail" class="page"></div><div id="a-mail" class="page"></div>
  <div id="s-attendance" class="page"></div><div id="a-scanner" class="page"></div>
  <div id="a-class-logs" class="page"></div>
  <button id="nav-s-dashboard" class="nav-btn"></button>
  <button id="nav-a-dashboard" class="nav-btn"></button>
  <button id="nav-s-mail" class="nav-btn"></button>
  <button id="cart-fab"></button>
`;

function makeWindow() {
  const dom = new JSDOM(`<!doctype html><html><body>${DOM_HTML}</body></html>`, { runScripts: 'dangerously', url: 'https://example.org/app/index.html' });
  const win = dom.window;
  win.__EDUQUEST_SUPABASE_URL__ = '';
  win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };
  win.DBService = { initRemote: async () => {}, read: () => null, write: () => {} };
  win.DEFAULT_DB = { students: [], mail: [], recitationLog: [], pointLog: [], attendanceSchedules: [], rfidCards: [], attendanceLogs: [] };

  win.currentUser = null;
  win.currentRole = null;
  win.DB = { attendanceLogs: [] };
  win._esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  win._cssColor = (s, fallback) => {
    fallback = fallback || '#8b5cf6';
    const v = String(s || '').trim();
    return /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ? v : fallback;
  };
  win.isoDate = () => '2026-08-31';
  win.uid = () => 'UID' + Math.floor(Math.random() * 1e9);
  win.getClassLabel = (c) => 'Section ' + c;
  win.mailUpdateSidebarBadge = () => {};
  win.mailIsRead = () => false;
  win.mailIsClaimed = () => false;
  win.mailGetForStudent = () => (win.AppStore.getSlice(s => s.mail) || []).slice();
  win._adminStoreInterval = null; // shop module global, bare reference (no typeof guard) in _navToCore

  // Other-stream render/unmount stand-ins used across the various nav
  // ids exercised below — plain call-tracking stubs, not real
  // implementations (those modules belong to other streams).
  win.__otherCalls = [];
  ['renderStudentDashboard', 'renderMySection', 'renderStudentQuizzes', 'renderStudentWorldBoss',
    'renderStudentStore', 'renderInventory', 'renderStudentOrders', 'renderLeaderboard', 'renderBadges',
    'renderAdminDashboard', 'renderAdminStore', 'renderPOS', 'renderAdminQuizzes', 'renderAnalytics',
    'renderAdminStageMap', 'renderAdminBossEvents', 'renderAdminAchievements', 'renderAdminTitles',
    'renderAdminPromotions', 'renderSectionMaker', 'renderEnrollmentHub', 'renderAdminRegistrations',
    'renderNavManager', 'renderBossStudio', 'renderClassroomBuilder', 'renderClassroomMonitor',
    'renderAdminLeaderboards', 'renderTeacherDirectory', 'renderStarterPackEditor', 'renderSchoolSettings',
    'renderContentOversight', 'renderMascotLines', 'renderAuditLog', 'renderSystemHealth',
  ].forEach(name => { win[name] = () => { win.__otherCalls.push(name); }; });

  return win;
}

async function evalFullOriginalChain(win) {
  const files = ['supabase-client.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'repository/table-sync.js', 'db-service.js', 'modules/core/state-manager.js', 'student-stats.js', 'modules/attendance/attendance-service.js', 'modules/mail/student-inbox.js', 'modules/recitation/progress.js', 'modules/attendance/att_scanner_rfid.js', 'modules/attendance/attendance-recitation-log.js', 'modules/mail/admin-compose.js', 'nav.js'];
  for (const f of files) win.eval(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
  await win.AppStore.ready;
}

async function evalBridge(win) {
  const supabaseClientSrc = fs.readFileSync(path.join(__dirname, '..', 'supabase-client.js'), 'utf8');
  win.eval(supabaseClientSrc);
  const bridgeSrc = fs.readFileSync(path.join(__dirname, 'test-helpers', 'nav-combined-bundle.js'), 'utf8');
  win.eval(bridgeSrc);
  await win.AppStore.ready;
}

async function seedState(win, overrides) {
  await win.AppStore.ready;
  win.AppStore.updateState(draft => { Object.assign(draft, { students: [], mail: [], recitationLog: [], pointLog: [] }, overrides || {}); }, { type: 'test:seed' });
}

function runSetupSidebarScenarios(win) {
  const results = {};

  win.currentRole = 'student';
  win.setupSidebar();
  results.studentNavHtmlHasDashboard = win.document.getElementById('sidebar-nav').innerHTML.includes('nav-s-dashboard');
  results.studentNavHtmlHasAdminOnly = win.document.getElementById('sidebar-nav').innerHTML.includes('nav-a-nav-manager');

  win.currentRole = 'teacher';
  win.setupSidebar();
  const teacherHtml = win.document.getElementById('sidebar-nav').innerHTML;
  results.teacherNavExcludesAdminOnly = !teacherHtml.includes('nav-a-nav-manager') && !teacherHtml.includes('nav-a-settings');
  results.teacherNavHasDashboard = teacherHtml.includes('nav-a-dashboard');

  win.currentRole = 'admin';
  win.setupSidebar();
  const adminHtml = win.document.getElementById('sidebar-nav').innerHTML;
  results.adminNavIncludesAdminOnly = adminHtml.includes('nav-a-nav-manager');

  // AppStore.emit fires nav:sidebar-rendered
  let captured = null;
  win.AppStore.subscribe('test-sidebar-listener', (state, event) => { if (event.type === 'nav:sidebar-rendered') captured = event; });
  win.currentRole = 'student';
  win.setupSidebar();
  results.emittedEvent = captured;
  win.AppStore.unsubscribe('test-sidebar-listener');

  return results;
}

function runNavHelperScenarios(win) {
  const results = {};

  results.dsmGetStudentNav = win.dsmGetStudentNav().map(t => t.id);
  results.dsmGetAdminNav = win.dsmGetAdminNav().map(t => t.id);
  const teacherNav = win.dsmGetTeacherNav().map(t => t.id);
  results.dsmGetTeacherNavExcludesAdminOnly = win.ADMIN_ONLY_NAV_IDS.every(id => !teacherNav.includes(id));
  results.dsmGetTeacherNavKeepsOthers = teacherNav.includes('a-dashboard');

  return results;
}

function runLastPageScenarios(win) {
  const results = {};

  win.saveLastVisitedPage('s-quizzes');
  results.getForStudent = win.getLastVisitedPage('student');
  results.getForAdminMismatch = win.getLastVisitedPage('admin');

  win.saveLastVisitedPage('a-store');
  results.getForAdminMatch = win.getLastVisitedPage('admin');
  results.getForTeacherMatch = win.getLastVisitedPage('teacher');
  results.getForStudentMismatch = win.getLastVisitedPage('student');

  try { win.localStorage.removeItem('eq_last_page'); } catch (e) {}
  results.getWithNothingStored = win.getLastVisitedPage('student');

  return results;
}

function runShowPageScenarios(win) {
  const results = {};
  win.document.getElementById('s-dashboard').classList.add('active');
  win.showPage('a-dashboard');
  results.oldPageInactive = win.document.getElementById('s-dashboard').classList.contains('active');
  results.newPageActive = win.document.getElementById('a-dashboard').classList.contains('active');
  results.unknownIdDoesNotThrow = (() => { try { win.showPage('does-not-exist'); return false; } catch (e) { return true; } })();
  return results;
}

async function runNavToDispatchScenarios(win) {
  const results = {};
  await seedState(win, {});

  // --- non-admin blocked from an admin-only page, bounced to dashboard ---
  win.currentRole = 'teacher';
  win.currentUser = { id: 't1' };
  win.navTo('a-nav-manager');
  results.blockedAdminOnlyForTeacher = { showPageCalledWith: win.document.getElementById('a-dashboard').classList.contains('active'), lastSaved: win.getLastVisitedPage('teacher') };

  // --- cart-fab removed when leaving the store ---
  await seedState(win, {});
  win.currentRole = 'student';
  win.currentUser = { id: 's1', name: 'Ana Cruz', init: 'AC', color: '#8b5cf6' };
  win.navTo('s-dashboard');
  results.cartFabRemoved = win.document.getElementById('cart-fab') === null;

  // --- active button styling swaps correctly ---
  win.document.body.insertAdjacentHTML('beforeend', '<button id="nav-s-dashboard" class="nav-btn"></button>');
  win.navTo('s-dashboard');
  results.activeButtonClass = win.document.getElementById('nav-s-dashboard').classList.contains('active');

  // --- dispatch: renderStudentMail (real import) ---
  win.currentUser = { id: 's1', name: 'Ana Cruz' };
  win.currentRole = 'student';
  win.navTo('s-mail');
  results.studentMailRendered = win.document.getElementById('s-mail').innerHTML.length > 0;

  // --- dispatch: renderAdminMail (real import) ---
  win.currentUser = { id: 't1', name: 'Ms. Garcia' };
  win.currentRole = 'teacher';
  await seedState(win, { titles: [] });
  win.navTo('a-mail');
  results.adminMailRendered = win.document.getElementById('a-mail').innerHTML.length > 0;

  // --- dispatch: renderStudentProgress (real import) — not-logged-in path is enough proof of dispatch ---
  win.currentUser = null;
  win.currentRole = 'student';
  win.navTo('s-attendance');
  results.studentProgressRendered = win.document.getElementById('s-attendance').innerHTML.includes('Not logged in');

  // --- dispatch: renderRecitationAttendanceLog (real import) ---
  win.currentUser = { id: 't1' };
  win.currentRole = 'teacher';
  win.navTo('a-class-logs');
  results.recitationLogRendered = win.document.getElementById('a-class-logs').innerHTML.length > 0;

  // --- dispatch: renderRfidScanner (real import) — starts real timers, unmount immediately after ---
  win.navTo('a-scanner');
  results.rfidScannerRendered = win.document.getElementById('a-scanner').innerHTML.includes('rfid-capture-input');
  if (typeof win.unmountRfidScanner === 'function') win.unmountRfidScanner();

  // --- dispatch: an "other stream" id still routes correctly (sanity on the general mechanism) ---
  win.__otherCalls.length = 0;
  win.navTo('s-quizzes');
  results.otherStreamDispatch = win.__otherCalls.slice();

  // --- navTo emits nav:navigated with the id ---
  let capturedNav = null;
  win.AppStore.subscribe('test-navto-listener', (state, event) => { if (event.type === 'nav:navigated') capturedNav = event; });
  win.navTo('s-dashboard');
  results.emittedNavEvent = capturedNav;
  win.AppStore.unsubscribe('test-navto-listener');

  return results;
}

async function runFullSuite(evalFn) {
  const results = {};

  const win1 = makeWindow();
  await evalFn(win1);
  results.sidebar = runSetupSidebarScenarios(win1);
  results.helpers = runNavHelperScenarios(win1);

  const win2 = makeWindow();
  await evalFn(win2);
  results.lastPage = runLastPageScenarios(win2);

  const win3 = makeWindow();
  await evalFn(win3);
  results.showPage = runShowPageScenarios(win3);

  const win4 = makeWindow();
  await evalFn(win4);
  results.navToDispatch = await runNavToDispatchScenarios(win4);

  return results;
}

async function main() {
  const resultOriginal = await runFullSuite(evalFullOriginalChain);
  const resultBridge = await runFullSuite(evalBridge);

  // jsdom cross-realm gotcha (documented in MEMORY.md): compare via
  // JSON.stringify rather than assert.deepStrictEqual.
  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original at every step');

  // Sanity checks against the original's real values.
  assert.strictEqual(resultOriginal.sidebar.studentNavHtmlHasDashboard, true, 'sanity: student sidebar renders');
  assert.strictEqual(resultOriginal.sidebar.studentNavHtmlHasAdminOnly, false, 'sanity: student sidebar never shows admin-only items');
  assert.strictEqual(resultOriginal.sidebar.teacherNavExcludesAdminOnly, true, 'sanity: teacher sidebar excludes ADMIN_ONLY_NAV_IDS');
  assert.strictEqual(resultOriginal.sidebar.teacherNavHasDashboard, true, 'sanity: teacher still gets its own dashboard item');
  assert.strictEqual(resultOriginal.sidebar.adminNavIncludesAdminOnly, true, 'sanity: real admin sees admin-only items');
  assert.strictEqual(resultOriginal.sidebar.emittedEvent.type, 'nav:sidebar-rendered', 'sanity: setupSidebar emits nav:sidebar-rendered');
  assert.strictEqual(resultOriginal.sidebar.emittedEvent.payload.role, 'student', 'sanity: emitted payload carries the role');

  assert.strictEqual(resultOriginal.helpers.dsmGetStudentNav.length, 11, 'sanity: student nav has 11 items');
  assert.strictEqual(resultOriginal.helpers.dsmGetAdminNav.length, 29, 'sanity: admin nav has 29 items');
  assert.strictEqual(resultOriginal.helpers.dsmGetTeacherNavExcludesAdminOnly, true, 'sanity: dsmGetTeacherNav strips every ADMIN_ONLY_NAV_IDS item');
  assert.strictEqual(resultOriginal.helpers.dsmGetTeacherNavKeepsOthers, true, 'sanity: dsmGetTeacherNav keeps non-restricted items');

  assert.strictEqual(resultOriginal.lastPage.getForStudent, 's-quizzes', 'sanity: student role reads back its own saved page');
  assert.strictEqual(resultOriginal.lastPage.getForAdminMismatch, null, 'sanity: an admin role reading a student-prefixed page gets null');
  assert.strictEqual(resultOriginal.lastPage.getForAdminMatch, 'a-store', 'sanity: admin role reads back its own saved page');
  assert.strictEqual(resultOriginal.lastPage.getForTeacherMatch, 'a-store', 'sanity: teacher shares the admin-prefix scope');
  assert.strictEqual(resultOriginal.lastPage.getForStudentMismatch, null, 'sanity: student role reading an admin-prefixed page gets null');
  assert.strictEqual(resultOriginal.lastPage.getWithNothingStored, null, 'sanity: nothing stored -> null');

  assert.strictEqual(resultOriginal.showPage.oldPageInactive, false, 'sanity: showPage deactivates the previous page');
  assert.strictEqual(resultOriginal.showPage.newPageActive, true, 'sanity: showPage activates the requested page');
  assert.strictEqual(resultOriginal.showPage.unknownIdDoesNotThrow, false, 'sanity: an unknown page id is a safe no-op');

  assert.strictEqual(resultOriginal.navToDispatch.blockedAdminOnlyForTeacher.showPageCalledWith, true, 'sanity: a teacher navigating to an admin-only id gets bounced to a-dashboard instead');
  assert.strictEqual(resultOriginal.navToDispatch.cartFabRemoved, true, 'sanity: leaving anywhere but the store removes the cart FAB');
  assert.strictEqual(resultOriginal.navToDispatch.activeButtonClass, true, 'sanity: the matching nav button gets the active class');
  assert.strictEqual(resultOriginal.navToDispatch.studentMailRendered, true, 'sanity: navTo(\'s-mail\') really dispatches to the real, real-imported renderStudentMail()');
  assert.strictEqual(resultOriginal.navToDispatch.adminMailRendered, true, 'sanity: navTo(\'a-mail\') really dispatches to the real, real-imported renderAdminMail()');
  assert.strictEqual(resultOriginal.navToDispatch.studentProgressRendered, true, 'sanity: navTo(\'s-attendance\') really dispatches to the real, real-imported renderStudentProgress()');
  assert.strictEqual(resultOriginal.navToDispatch.recitationLogRendered, true, 'sanity: navTo(\'a-class-logs\') really dispatches to the real, real-imported renderRecitationAttendanceLog()');
  assert.strictEqual(resultOriginal.navToDispatch.rfidScannerRendered, true, 'sanity: navTo(\'a-scanner\') really dispatches to the real, real-imported renderRfidScanner()');
  assert.deepStrictEqual(resultOriginal.navToDispatch.otherStreamDispatch, ['renderStudentQuizzes'], 'sanity: an other-stream page id still dispatches to the right (stubbed) function');
  assert.strictEqual(resultOriginal.navToDispatch.emittedNavEvent.type, 'nav:navigated', 'sanity: navTo emits nav:navigated');
  assert.strictEqual(resultOriginal.navToDispatch.emittedNavEvent.payload.id, 's-dashboard', 'sanity: emitted payload carries the target id');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('nav.js: sidebar rendering per role (incl. ADMIN_ONLY_NAV_IDS gating and the');
  console.log('nav:sidebar-rendered emit), the DSM nav-config stub helpers, last-visited-page');
  console.log('persistence (role-prefix scoping), showPage, and navTo/_navToCore dispatch — including');
  console.log('all 5 real-imported render*() targets actually running, the admin-only-id bounce, cart-FAB');
  console.log('cleanup, active-button styling, and the nav:navigated emit — all match.');
}

main().then(() => process.exit(0)).catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
