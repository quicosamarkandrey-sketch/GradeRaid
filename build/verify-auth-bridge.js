// Phase 7 (Stream A) — equivalence check for auth.js.
//
// Real-imports AppStore, DBService, and updateTopbar — all this
// stream's own already-converted files, all confirmed via repo-wide
// grep against the "no runtime reassignment anywhere" rule (MEMORY.md)
// before finalizing. DBService's methods (getAuthClient/
// refreshAfterAuthChange/teardownRealtime/flushPendingUpload/remove)
// are mocked by mutating them on the shared real object — same
// established technique as attendance-service.js/admin-compose.js/
// mail-engine.js. `restoreSidebarState` stays window-fallback despite
// being from topbar.js (this stream's own file) because it's
// explicitly typeof-guarded here — a real "may not exist" signal, not
// defensive boilerplate (see this file's src header).
//
// getAuthClient() returns a small fake Supabase client object built
// per scenario (`.auth.signInWithPassword`/`.auth.getSession`/
// `.auth.signOut`, `.from().select().eq().single()`) — this file
// itself never touches `window.supabase`/`createClient()` directly
// (that's entirely inside db-service.js, unaffected by this
// conversion), so faking the CLIENT shape here is the right level to
// mock at, not the transport underneath it.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const DOM_HTML = `
  <input id="login-user"><input id="login-pass">
  <div id="login-err" style="display:none"></div>
  <div id="login-pending-err" style="display:none"></div>
  <button id="login-submit-btn"></button>
  <div id="boot-loading"></div>
  <div id="login-screen"></div>
  <div id="main-app" style="display:none"></div>
  <button id="sidebar-logout-btn"></button>
  <button id="stage-map-btn"></button>
  <div id="stage-notif"></div>
  <div id="topbar-coin-val"></div><div id="topbar-coins" style="display:none"></div>
  <div id="topbar-av"></div><div id="sb-avatar"></div><div id="sb-name"></div>
  <div id="sb-tier"></div><div id="sb-xp-fill" style="width:0%"></div>
  <div id="sb-xp-label"></div><div id="sb-xp-next"></div>
`;

function fakeClient({ signInError, authUser, profile, profileError, sessionUser, getSessionThrows } = {}) {
  return {
    auth: {
      signInWithPassword: async () => signInError ? { data: null, error: signInError } : { data: { user: authUser }, error: null },
      getSession: async () => {
        if (getSessionThrows) throw new Error('network blip');
        return sessionUser ? { data: { session: { user: sessionUser } } } : { data: { session: null } };
      },
      signOut: async () => ({ error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => profileError ? { data: null, error: profileError } : { data: profile, error: null },
        }),
      }),
    }),
  };
}

function makeWindow() {
  const dom = new JSDOM(`<!doctype html><html><body>${DOM_HTML}</body></html>`, { runScripts: 'dangerously', url: 'https://example.org/app/index.html' });
  const win = dom.window;
  win.__EDUQUEST_SUPABASE_URL__ = '';
  win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };
  win.DBService = { initRemote: async () => {}, read: () => null, write: () => {} };
  win.DEFAULT_DB = { students: [] };

  win.currentUser = null;
  win.currentRole = null;
  win.selectedLoginRole = 'student';

  win.__buttonLoadingCalls = [];
  win.eqButtonLoading = (btn, loading, opts) => { win.__buttonLoadingCalls.push({ loading, label: opts && opts.label }); };
  win.__warnCalls = [];
  const realWarn = win.console.warn.bind(win.console);
  win.console.warn = (...args) => { win.__warnCalls.push(args.map(a => (a instanceof Error ? a.message : String(a)))); };

  win.RegistrationService = { checkStatus: async () => ({ ok: true, found: false }) };
  win.WBC = { joined: false, bossIdx: -1, qIdx: 0, answered: [], comboCount: 0, battleStartTime: 0, cooldownActive: false, refreshInterval: null, cooldownTimeout: null };
  win.__wbmStopCalls = 0;
  win.wbmStopSpawnLoop = () => { win.__wbmStopCalls++; };
  win.SystemHealthService = { startPresenceHeartbeat: () => {}, stopPresenceHeartbeat: () => {} };
  win.shStopCountsRefresh = () => {};
  win.quizTimer = null;
  win._enrollPersistLock = () => {};
  win._enrollHasPersistedLock = () => false;
  win._enrollRestoreLockedKioskOnBoot = () => {};
  win.getLastVisitedPage = () => null;
  win.__navToCalls = [];
  win.navTo = (id) => { win.__navToCalls.push(id); };
  win.__renderAdminCalls = 0;
  win.renderAdminDashboard = () => { win.__renderAdminCalls++; };
  win.__renderStudentCalls = 0;
  win.renderStudentDashboard = () => { win.__renderStudentCalls++; };
  win.__showPageCalls = [];
  win.showPage = (id) => { win.__showPageCalls.push(id); };
  win.dsmGetWidgetConfig = () => ({ visible: true, locked: false, disabled: false, status: 'active', lockMsg: '' });
  win.getStageProgress = () => ({ activeStageId: null });
  win.__wbcTopbarCalls = 0;
  win.wbcUpdateTopbarWidget = () => { win.__wbcTopbarCalls++; };
  win.__refreshAvatarsCalls = 0;
  win.refreshAllAvatars = () => { win.__refreshAvatarsCalls++; };
  win.__profInitCalls = 0;
  win.profInitAll = () => { win.__profInitCalls++; };
  win.__closeProfileCalls = 0;
  win.closeProfile = () => { win.__closeProfileCalls++; };
  win.__setupSidebarCalls = 0;
  win.setupSidebar = () => { win.__setupSidebarCalls++; };
  win.activeWorld = 1;
  win.localStorage.setItem('eq_last_page', 'stale');

  return win;
}

async function evalFullOriginalChain(win) {
  const files = ['supabase-client.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'repository/table-sync.js', 'db-service.js', 'modules/core/state-manager.js', 'topbar.js', 'auth.js'];
  for (const f of files) win.eval(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
  await win.AppStore.ready;
}

async function evalBridge(win) {
  const supabaseClientSrc = fs.readFileSync(path.join(__dirname, '..', 'supabase-client.js'), 'utf8');
  win.eval(supabaseClientSrc);
  const bridgeSrc = fs.readFileSync(path.join(__dirname, 'test-helpers', 'auth-combined-bundle.js'), 'utf8');
  win.eval(bridgeSrc);
  await win.AppStore.ready;
}

async function seedState(win, overrides) {
  await win.AppStore.ready;
  win.AppStore.updateState(draft => { Object.assign(draft, { students: [] }, overrides || {}); }, { type: 'test:seed' });
}

function setLoginForm(win, email, pass) {
  win.document.getElementById('login-user').value = email;
  win.document.getElementById('login-pass').value = pass;
}

async function runDoLoginScenarios(win) {
  const results = {};

  // --- validation: empty fields ---
  await seedState(win, {});
  setLoginForm(win, '', '');
  win.__buttonLoadingCalls.length = 0;
  await win.doLogin();
  results.emptyFields = {
    errHtml: win.document.getElementById('login-err').innerHTML,
    errShown: win.document.getElementById('login-err').style.display,
    buttonLoadingCalls: win.__buttonLoadingCalls.slice(),
  };

  // --- no auth client ---
  win.DBService.getAuthClient = () => null;
  setLoginForm(win, 'ana@school.test', 'pw');
  await win.doLogin();
  results.noClient = { errHtml: win.document.getElementById('login-err').innerHTML };

  // --- signIn fails, no matching registration ---
  win.DBService.getAuthClient = () => fakeClient({ signInError: { message: 'Invalid login credentials' } });
  win.RegistrationService.checkStatus = async () => ({ ok: true, found: false });
  setLoginForm(win, 'ana@school.test', 'wrongpw');
  await win.doLogin();
  results.wrongPassword = { errHtml: win.document.getElementById('login-err').innerHTML, pendingShown: win.document.getElementById('login-pending-err').style.display };

  // --- signIn fails, but registration is pending ---
  win.RegistrationService.checkStatus = async () => ({ ok: true, found: true, status: 'pending' });
  setLoginForm(win, 'pending@school.test', 'pw');
  await win.doLogin();
  results.pendingRegistration = { pendingShown: win.document.getElementById('login-pending-err').style.display, passCleared: win.document.getElementById('login-pass').value === '' };

  // --- signIn fails, registration rejected ---
  win.RegistrationService.checkStatus = async () => ({ ok: true, found: true, status: 'rejected' });
  setLoginForm(win, 'rejected@school.test', 'pw');
  await win.doLogin();
  results.rejectedRegistration = { errHtml: win.document.getElementById('login-err').innerHTML };

  // --- signIn succeeds, profile missing, no registration match -> generic message, signs out ---
  win.RegistrationService.checkStatus = async () => ({ ok: true, found: false });
  win.DBService.getAuthClient = () => fakeClient({ authUser: { id: 'u1', email: 'new@school.test' }, profileError: { message: 'not found' } });
  setLoginForm(win, 'new@school.test', 'pw');
  await win.doLogin();
  results.noProfile = { errHtml: win.document.getElementById('login-err').innerHTML };

  // --- signIn succeeds, profile deactivated ---
  win.DBService.getAuthClient = () => fakeClient({ authUser: { id: 'u2', email: 'deact@school.test' }, profile: { id: 'u2', is_active: false } });
  setLoginForm(win, 'deact@school.test', 'pw');
  await win.doLogin();
  results.deactivated = { errHtml: win.document.getElementById('login-err').innerHTML };

  // --- full success: student ---
  win.__buttonLoadingCalls.length = 0;
  win.DBService.refreshAfterAuthChange = async () => {};
  win.document.getElementById('main-app').style.display = 'none';
  win.document.getElementById('login-screen').style.display = 'flex';
  const studentProfile = {
    id: 's1', display_name: 'Ana Cruz', first_name: 'Ana', last_name: 'Cruz', init: 'AC', color: '#8b5cf6',
    xp: 500, coins: 40, level: 2, tier: 'Scholar', attendance_pct: 92, quiz_avg: 85, profile_pic_url: '',
    class_id: 'c1', role: 'student', join_date: '2026-01-01', is_active: true,
  };
  win.DBService.getAuthClient = () => fakeClient({ authUser: { id: 's1', email: 'ana@school.test' }, profile: studentProfile });
  win.__renderStudentCalls = 0; win.__setupSidebarCalls = 0;
  setLoginForm(win, 'ana@school.test', 'correctpw');
  await win.doLogin();
  results.studentSuccess = {
    currentUser: win.currentUser,
    currentRole: win.currentRole,
    mainAppShown: win.document.getElementById('main-app').style.display,
    loginScreenHidden: win.document.getElementById('login-screen').style.display,
    setupSidebarCalls: win.__setupSidebarCalls,
    buttonLoadingSequence: win.__buttonLoadingCalls.map(c => c.loading),
  };

  return results;
}

async function runRestoreSessionScenarios(win) {
  const results = {};

  // --- no client ---
  await seedState(win, {});
  win.DBService.getAuthClient = () => null;
  win.document.getElementById('boot-loading').style.display = '';
  win.document.getElementById('login-screen').style.display = 'none';
  await win.restoreSession();
  results.noClient = { loginScreenShown: win.document.getElementById('login-screen').style.display, bootHidden: win.document.getElementById('boot-loading').style.display };

  // --- no session ---
  win.document.getElementById('login-screen').style.display = 'none';
  win.DBService.getAuthClient = () => fakeClient({ sessionUser: null });
  await win.restoreSession();
  results.noSession = { loginScreenShown: win.document.getElementById('login-screen').style.display };

  // --- session present, profile missing -> signs out, shows login ---
  win.document.getElementById('login-screen').style.display = 'none';
  win.DBService.getAuthClient = () => fakeClient({ sessionUser: { id: 'u9', email: 'x@x.com' }, profileError: { message: 'gone' } });
  await win.restoreSession();
  results.profileMissing = { loginScreenShown: win.document.getElementById('login-screen').style.display, warned: win.__warnCalls.some(w => w[0].includes('profile missing/inactive')) };

  // --- exception thrown ---
  win.__warnCalls.length = 0;
  win.document.getElementById('login-screen').style.display = 'none';
  win.DBService.getAuthClient = () => fakeClient({ getSessionThrows: true });
  await win.restoreSession();
  results.exceptionCaught = { loginScreenShown: win.document.getElementById('login-screen').style.display, warned: win.__warnCalls.some(w => w[0].includes('restoreSession failed')) };

  // --- full success ---
  await seedState(win, {});
  const teacherProfile = {
    id: 't1', display_name: 'Mr. Reyes', first_name: 'Mr.', last_name: 'Reyes', init: 'MR', color: '#22c55e',
    xp: 0, coins: 0, level: 0, tier: '', attendance_pct: 0, quiz_avg: 0, profile_pic_url: '',
    class_id: null, role: 'teacher', join_date: '2025-06-01', is_active: true,
  };
  win.DBService.getAuthClient = () => fakeClient({ sessionUser: { id: 't1', email: 'reyes@school.test' }, profile: teacherProfile });
  win.__renderAdminCalls = 0; win.__setupSidebarCalls = 0;
  await win.restoreSession();
  results.fullSuccess = {
    currentUser: win.currentUser,
    currentRole: win.currentRole,
    renderAdminCalls: win.__renderAdminCalls,
    showPageCalls: win.__showPageCalls.slice(),
  };

  return results;
}

async function runDoLogoutScenarios(win) {
  const results = {};
  await seedState(win, {});
  win.currentUser = { id: 's1' };
  win.currentRole = 'student';
  win.DBService.getAuthClient = () => fakeClient({});
  win.DBService.flushPendingUpload = async () => { win.__flushCalled = true; };
  win.DBService.remove = () => { win.__removeCalled = true; };
  win.DBService.teardownRealtime = () => { win.__teardownCalled = true; };
  win.__flushCalled = false; win.__removeCalled = false; win.__teardownCalled = false;
  win.__closeProfileCalls = 0; win.__wbmStopCalls = 0;
  win.document.getElementById('main-app').style.display = 'block';
  win.document.getElementById('login-screen').style.display = 'none';
  win.localStorage.setItem('eq_last_page', 'a-dashboard');

  await win.doLogout();

  results.afterLogout = {
    currentUser: win.currentUser,
    currentRole: win.currentRole,
    mainAppHidden: win.document.getElementById('main-app').style.display,
    loginScreenShown: win.document.getElementById('login-screen').style.display,
    loginUserCleared: win.document.getElementById('login-user').value === '',
    stageMapBtnHidden: win.document.getElementById('stage-map-btn').style.display,
    closeProfileCalled: win.__closeProfileCalls === 1,
    wbmStopCalled: win.__wbmStopCalls === 1,
    flushCalled: win.__flushCalled,
    removeCalled: win.__removeCalled,
    teardownCalled: win.__teardownCalled,
    lastPageCleared: win.localStorage.getItem('eq_last_page'),
    activeWorldReset: win.activeWorld,
  };

  return results;
}

async function runBootAppScenarios(win) {
  const results = {};

  // --- admin, fresh login (no last page) ---
  await seedState(win, {});
  win.currentUser = { id: 'a1' };
  win.currentRole = 'admin';
  win.getLastVisitedPage = () => null;
  win.__renderAdminCalls = 0; win.__showPageCalls = [];
  win.document.getElementById('boot-loading').style.display = '';
  win.bootApp();
  results.adminFresh = { renderAdminCalls: win.__renderAdminCalls, showPageCalls: win.__showPageCalls.slice(), stageMapDisplay: win.document.getElementById('stage-map-btn').style.display };

  // --- student, resumes last visited page ---
  win.currentUser = { id: 's1', name: 'Ana Cruz', init: 'AC', color: '#8b5cf6', level: 2, xp: 2500, coins: 40, tier: 'Scholar' };
  win.currentRole = 'student';
  win.getLastVisitedPage = (role) => (role === 'student' ? 's-quests' : null);
  win.__navToCalls = []; win.__renderStudentCalls = 0;
  win.bootApp();
  results.studentResumesPage = { navToCalls: win.__navToCalls.slice(), renderStudentCalls: win.__renderStudentCalls };

  // --- student, stage-map button gated (locked) ---
  win.getLastVisitedPage = () => null;
  win.dsmGetWidgetConfig = () => ({ visible: true, locked: true, disabled: false, status: 'active', lockMsg: 'Come back later' });
  win.bootApp();
  results.stageMapLocked = {
    display: win.document.getElementById('stage-map-btn').style.display,
    disabled: win.document.getElementById('stage-map-btn').disabled,
    title: win.document.getElementById('stage-map-btn').title,
  };

  // --- student, stage-map button hidden entirely ---
  win.dsmGetWidgetConfig = () => ({ visible: false, locked: false, disabled: false, status: 'active', lockMsg: '' });
  win.bootApp();
  results.stageMapHidden = { display: win.document.getElementById('stage-map-btn').style.display };

  // --- student with an active stage -> notif dot shown ---
  win.dsmGetWidgetConfig = () => ({ visible: true, locked: false, disabled: false, status: 'active', lockMsg: '' });
  win.getStageProgress = () => ({ activeStageId: 'stage-3' });
  win.bootApp();
  results.stageNotifShown = { display: win.document.getElementById('stage-notif').style.display };

  // --- kiosk-locked admin skips the normal dashboard branch entirely ---
  win.currentUser = { id: 'a1' };
  win.currentRole = 'admin';
  win._enrollHasPersistedLock = () => true;
  win.__kioskRestoreCalls = 0;
  win._enrollRestoreLockedKioskOnBoot = () => { win.__kioskRestoreCalls++; };
  win.__renderAdminCalls = 0; win.__showPageCalls = [];
  win.bootApp();
  results.kioskLocked = { kioskRestoreCalls: win.__kioskRestoreCalls, renderAdminCalls: win.__renderAdminCalls, showPageCalls: win.__showPageCalls.slice() };

  // --- AppStore.emit fires session:booted with the right payload ---
  win._enrollHasPersistedLock = () => false;
  let capturedEvent = null;
  win.AppStore.subscribe('test-boot-listener', (state, event) => { if (event.type === 'session:booted') capturedEvent = event; });
  win.currentUser = { id: 'z9' };
  win.currentRole = 'teacher';
  win.getLastVisitedPage = () => null;
  win.bootApp();
  results.emittedEvent = capturedEvent;
  win.AppStore.unsubscribe('test-boot-listener');

  return results;
}

async function runFullSuite(evalFn) {
  const results = {};

  const win1 = makeWindow();
  await evalFn(win1);
  results.doLogin = await runDoLoginScenarios(win1);

  const win2 = makeWindow();
  await evalFn(win2);
  results.restoreSession = await runRestoreSessionScenarios(win2);

  const win3 = makeWindow();
  await evalFn(win3);
  results.doLogout = await runDoLogoutScenarios(win3);

  const win4 = makeWindow();
  await evalFn(win4);
  results.bootApp = await runBootAppScenarios(win4);

  return results;
}

async function main() {
  const resultOriginal = await runFullSuite(evalFullOriginalChain);
  const resultBridge = await runFullSuite(evalBridge);

  // jsdom cross-realm gotcha (documented in MEMORY.md): compare via
  // JSON.stringify rather than assert.deepStrictEqual.
  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original at every step');

  // Sanity checks against the original's real values.
  assert.ok(resultOriginal.doLogin.emptyFields.errHtml.includes('enter your email'), 'sanity: empty-fields validation message');
  assert.strictEqual(resultOriginal.doLogin.emptyFields.buttonLoadingCalls.length, 0, 'sanity: validation failure never touches the loading button (returns before the try block)');
  assert.ok(resultOriginal.doLogin.noClient.errHtml.includes('Still connecting'), 'sanity: no auth client message');
  assert.ok(resultOriginal.doLogin.wrongPassword.errHtml.includes('Incorrect email or password'), 'sanity: generic wrong-password message');
  assert.strictEqual(resultOriginal.doLogin.pendingRegistration.pendingShown, 'block', 'sanity: pending registration shows the pending banner');
  assert.strictEqual(resultOriginal.doLogin.pendingRegistration.passCleared, true, 'sanity: password field cleared after a failed attempt');
  assert.ok(resultOriginal.doLogin.rejectedRegistration.errHtml.includes('not approved'), 'sanity: rejected registration message');
  assert.ok(resultOriginal.doLogin.noProfile.errHtml.includes('no profile was found'), 'sanity: no-profile-at-all message');
  assert.ok(resultOriginal.doLogin.deactivated.errHtml.includes('deactivated'), 'sanity: deactivated account message');
  assert.strictEqual(resultOriginal.doLogin.studentSuccess.currentUser.name, 'Ana Cruz', 'sanity: shape-bridge maps display_name -> name');
  assert.strictEqual(resultOriginal.doLogin.studentSuccess.currentUser.attendance, 92, 'sanity: shape-bridge maps attendance_pct -> attendance');
  assert.strictEqual(resultOriginal.doLogin.studentSuccess.currentUser.completedQuizzes.length, 0, 'sanity: completedQuizzes defaults to empty array with no matching DB.students row');
  assert.strictEqual(resultOriginal.doLogin.studentSuccess.currentRole, 'student', 'sanity: role resolved correctly');
  assert.strictEqual(resultOriginal.doLogin.studentSuccess.mainAppShown, 'block', 'sanity: successful login shows main-app (via bootApp)');
  assert.strictEqual(resultOriginal.doLogin.studentSuccess.setupSidebarCalls, 1, 'sanity: bootApp -> setupSidebar() called');
  assert.strictEqual(JSON.stringify(resultOriginal.doLogin.studentSuccess.buttonLoadingSequence), JSON.stringify([true, false]), 'sanity: button loading true then false (finally), even on the success path');

  assert.strictEqual(resultOriginal.restoreSession.noClient.loginScreenShown, 'flex', 'sanity: no client -> login screen shown');
  assert.strictEqual(resultOriginal.restoreSession.noSession.loginScreenShown, 'flex', 'sanity: no saved session -> login screen shown');
  assert.strictEqual(resultOriginal.restoreSession.profileMissing.loginScreenShown, 'flex', 'sanity: missing profile -> login screen shown');
  assert.strictEqual(resultOriginal.restoreSession.profileMissing.warned, true, 'sanity: missing profile warns');
  assert.strictEqual(resultOriginal.restoreSession.exceptionCaught.loginScreenShown, 'flex', 'sanity: thrown exception -> login screen shown, not left hanging');
  assert.strictEqual(resultOriginal.restoreSession.exceptionCaught.warned, true, 'sanity: thrown exception warns');
  assert.strictEqual(resultOriginal.restoreSession.fullSuccess.currentUser.name, 'Mr. Reyes', 'sanity: restoreSession uses the same shape bridge as doLogin');
  assert.strictEqual(resultOriginal.restoreSession.fullSuccess.currentRole, 'teacher', 'sanity: teacher role passed through, not collapsed to student');
  assert.strictEqual(resultOriginal.restoreSession.fullSuccess.renderAdminCalls, 1, 'sanity: teacher goes to the admin dashboard branch');

  assert.strictEqual(resultOriginal.doLogout.afterLogout.currentUser, null, 'sanity: logout clears currentUser');
  assert.strictEqual(resultOriginal.doLogout.afterLogout.currentRole, null, 'sanity: logout clears currentRole');
  assert.strictEqual(resultOriginal.doLogout.afterLogout.mainAppHidden, 'none', 'sanity: logout hides main-app');
  assert.strictEqual(resultOriginal.doLogout.afterLogout.loginScreenShown, 'flex', 'sanity: logout shows login screen');
  assert.strictEqual(resultOriginal.doLogout.afterLogout.closeProfileCalled, true, 'sanity: closeProfile() called if defined');
  assert.strictEqual(resultOriginal.doLogout.afterLogout.wbmStopCalled, true, 'sanity: wbmStopSpawnLoop() called');
  assert.strictEqual(resultOriginal.doLogout.afterLogout.flushCalled, true, 'sanity: pending upload flushed before signOut');
  assert.strictEqual(resultOriginal.doLogout.afterLogout.removeCalled, true, 'sanity: local cache cleared to avoid leaking into the next login');
  assert.strictEqual(resultOriginal.doLogout.afterLogout.teardownCalled, true, 'sanity: realtime channels torn down');
  assert.strictEqual(resultOriginal.doLogout.afterLogout.lastPageCleared, null, 'sanity: eq_last_page cleared on logout');
  assert.strictEqual(resultOriginal.doLogout.afterLogout.activeWorldReset, 0, 'sanity: activeWorld reset to 0 on logout');

  assert.strictEqual(resultOriginal.bootApp.adminFresh.renderAdminCalls, 1, 'sanity: fresh admin login renders the admin dashboard');
  assert.strictEqual(JSON.stringify(resultOriginal.bootApp.adminFresh.showPageCalls), JSON.stringify(['a-dashboard']), 'sanity: fresh admin login shows a-dashboard');
  assert.strictEqual(JSON.stringify(resultOriginal.bootApp.studentResumesPage.navToCalls), JSON.stringify(['s-quests']), 'sanity: a saved last-page navigates there via navTo instead of the dashboard');
  assert.strictEqual(resultOriginal.bootApp.stageMapLocked.disabled, true, 'sanity: a locked stage-map button is disabled');
  assert.strictEqual(resultOriginal.bootApp.stageMapLocked.title, 'Come back later', 'sanity: a locked stage-map button shows its lock message');
  assert.strictEqual(resultOriginal.bootApp.stageMapHidden.display, 'none', 'sanity: an invisible stage-map widget is hidden entirely');
  assert.strictEqual(resultOriginal.bootApp.stageNotifShown.display, 'flex', 'sanity: an active stage shows the notif dot');
  assert.strictEqual(resultOriginal.bootApp.kioskLocked.kioskRestoreCalls, 1, 'sanity: a persisted kiosk lock takes priority over the normal dashboard branch');
  assert.strictEqual(resultOriginal.bootApp.kioskLocked.renderAdminCalls, 0, 'sanity: kiosk-locked boot never reaches the normal dashboard render');
  assert.strictEqual(resultOriginal.bootApp.kioskLocked.showPageCalls.length, 0, 'sanity: kiosk-locked boot never calls showPage either');
  assert.strictEqual(resultOriginal.bootApp.emittedEvent.type, 'session:booted', 'sanity: bootApp emits session:booted');
  assert.strictEqual(resultOriginal.bootApp.emittedEvent.payload.role, 'teacher', 'sanity: emitted payload carries the current role');
  assert.strictEqual(resultOriginal.bootApp.emittedEvent.payload.userId, 'z9', 'sanity: emitted payload carries the current user id');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('auth.js: doLogin (validation, no-client, wrong-password + registration-status lookups,');
  console.log('no-profile, deactivated, full success + shape-bridge mapping), restoreSession (no-client,');
  console.log('no-session, missing-profile, thrown-exception, full success), doLogout (state reset, all');
  console.log('cleanup calls, DOM reset), and bootApp (dashboard branch selection, last-page resume,');
  console.log('stage-map-button gating, kiosk-lock priority, and the session:booted emit) all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
