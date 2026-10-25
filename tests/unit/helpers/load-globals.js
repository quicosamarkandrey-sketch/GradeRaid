'use strict';
// Phase 0 safety net — minimal Node+jsdom harness for pure-logic functions.
//
// This app has no module system yet (that's Phase 7): utils.js just declares
// top-level functions and assigns them onto `window`. To unit test them
// without a browser, we load the real file's source into a real jsdom
// `window` (so `window.foo = foo` behaves exactly as it does in the app),
// then hand tests that window object to read functions off of and to seed
// `DB` on before calling anything that reads global state.
//
// This is intentionally still "the real file" — no reimplementation, no
// copy-pasted logic — so these tests catch a real regression the moment
// utils.js changes, not just a regression in a parallel copy of it.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function loadUtilsWindow() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'dangerously',
    url: 'http://localhost/',
  });
  // Phase 6: utils.js was split into three files by domain — generic
  // helpers stayed in utils.js, student-stat recalc/sync moved to
  // student-stats.js, and the Quest Board quiz engine moved to
  // modules/quest-engine.js. modules/quest-engine.js was itself later split
  // further — mascot lines to modules/quest-mascot-lines.js, quest chains +
  // weekly leaderboard to modules/quest-chains.js. Load all five, in the
  // same order index.html does, so this harness still exposes every
  // function tests call.
  const filePaths = [
    ['utils.js'],
    ['student-stats.js'],
    ['modules', 'quest-engine.js'],
    ['modules', 'quest-mascot-lines.js'],
    ['modules', 'quest-chains.js'],
  ];
  filePaths.forEach(function (parts) {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', ...parts), 'utf8');
    const scriptEl = dom.window.document.createElement('script');
    scriptEl.textContent = src;
    dom.window.document.body.appendChild(scriptEl);
  });
  return dom.window;
}

/**
 * loadTitlesSidebarRefreshWindow() — loads the real
 * modules/titles/titles_sidebar_refresh.js source into a jsdom window,
 * against a fake AppStore whose getSlice() returns caller-provided
 * equippedTitles/titles slices and whose emit() synchronously notifies
 * subscribers, same approach as the other Category A loaders. Only stubs
 * what the file's top-level execution and tsRefreshProfileTitle() actually
 * touch (tsBuildBadgeHTML) — the file's other exported functions
 * (tsEquipTitle, tsUnlockTitleForStudent, etc.) are real but untested here
 * since this loader exists specifically for the
 * dashboard:student-rendered conversion. Continuation Plan §3 Category A
 * (renderStudentDashboard) conversion.
 */
function loadTitlesSidebarRefreshWindow() {
  const dom = new JSDOM(
    '<!doctype html><html><body><div class="dash-hero-name">Alex</div></body></html>',
    { runScripts: 'dangerously', url: 'http://localhost/' }
  );
  const win = dom.window;

  win.subscribers = {};
  win.emitCalls = [];
  const state = { equippedTitles: {}, titles: [] };
  win.AppStore = {
    getSlice: (fn) => fn(state),
    updateState: () => {},
    subscribe: (key, fn) => { win.subscribers[key] = fn; },
    emit: (event) => { win.emitCalls.push(event); const subs = win.subscribers; Object.keys(subs).forEach((k) => subs[k](null, event)); },
  };
  win._eqTestState = state; // lets a test seed equippedTitles/titles before calling tsRefreshProfileTitle
  win.tsBuildBadgeHTML = (title) => `<span class="fake-badge">${title.name}</span>`;
  win.currentUser = { id: 's1' };
  win.currentRole = 'student';

  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'modules', 'titles', 'titles_sidebar_refresh.js'), 'utf8');
  const scriptEl = win.document.createElement('script');
  scriptEl.textContent = src;
  win.document.body.appendChild(scriptEl);
  return win;
}

/**
 * loadDbServiceWindow({ currentUser, currentRole, classSections }) — loads
 * the real db-service.js source into a jsdom window against a fake
 * window.supabase.createClient() (so _getClient() resolves to a fake client
 * instead of erroring for lack of real config) and a fake AppStore.getSlice()
 * (only classSections is read by the code path this loader exists for — the
 * profiles bulk-upsert's per-class chunking). DBService itself is a
 * top-level `const` in a classic (non-module) script, so it never becomes a
 * `window.DBService` property even inside jsdom — same lexical-scope-vs-
 * window-property gap documented elsewhere in this app (see the `let DB`
 * bug in AppStore). Grab it via `win.eval('DBService')`, exactly as
 * production code relies on lexical global scope across script tags.
 *
 * Phase 5A (Data Layer Redesign, repository-layer test coverage): exercises
 * DBService._test.pushCacheToSupabase — a seam that exists ONLY for tests
 * (see db-service.js's comment on `_test`); no runtime call site uses it.
 */
function loadDbServiceWindow(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'dangerously',
    url: 'http://localhost/',
  });
  const win = dom.window;
  win.currentUser = opts.currentUser || null;
  win.currentRole = opts.currentRole || null;
  win.clearDirtyCalls = [];
  win.AppStore = {
    getSlice: (fn) => fn({ classSections: opts.classSections || [] }),
    ready: Promise.resolve(),
    // [Phase 5B] Only defined when a test explicitly supplies `dirtyIds`
    // (a { [table]: string[] } map) — omitting it entirely (leaving
    // getDirtyIds undefined) is what exercises _runTableSync()'s
    // fall-back-to-full-push branch, same as an AppStore that predates
    // this feature. When supplied, getDirtyIds(table) returns
    // dirtyIds[table] verbatim (including [] if the caller wants to
    // assert the "tracked, nothing dirty — skip the push" branch).
    ...(opts.dirtyIds ? {
      getDirtyIds: (table) => opts.dirtyIds[table],
      clearDirty: (table, ids) => { win.clearDirtyCalls.push({ table, ids }); },
    } : {}),
  };
  // Phase 6: db-service.js's client singleton lives in supabase-client.js
  // and its table-sync repository lives in repository/table-sync.js — both
  // must load first, exactly as index.html does.
  const dbServiceDeps = [
    ['supabase-client.js'],
    ['repository', 'table-sync.js'],
    ['repository', 'pull-mappers.js'],
    ['repository', 'realtime-groups.js'],
    ['db-service.js'],
  ];
  dbServiceDeps.forEach(function (parts) {
    const fileSrc = fs.readFileSync(path.join(__dirname, '..', '..', '..', ...parts), 'utf8');
    const fileScriptEl = win.document.createElement('script');
    fileScriptEl.textContent = fileSrc;
    win.document.body.appendChild(fileScriptEl);
  });
  return { win, DBService: win.eval('DBService') };
}

/**
 * makeFakeSupabaseClient(onUpsert) — a minimal fake matching the shape
 * db-service.js's push path actually calls: auth.getSession() and
 * from(table).upsert(rows, opts). onUpsert(table, rows, opts) is invoked
 * synchronously for every upsert call and may return `{ error }` to
 * simulate a rejected write (e.g. RLS, or a 23502 not-null violation for
 * the boss_events retry path) — defaults to `{ error: null }`.
 */
function makeFakeSupabaseClient(onUpsert) {
  return {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'fake' } } } }) },
    from(table) {
      return {
        upsert(rows, opts) {
          // rows/opts are plain objects created inside the jsdom vm context
          // (a different realm from this test file's Object), so
          // assert.deepEqual would fail on prototype identity even with
          // identical own properties. Round-trip through JSON to normalize
          // into host-realm plain objects before handing them to the test.
          const plainRows = JSON.parse(JSON.stringify(rows));
          const plainOpts = JSON.parse(JSON.stringify(opts || {}));
          const result = (onUpsert && onUpsert(table, plainRows, plainOpts)) || { error: null };
          return Promise.resolve(result);
        },
      };
    },
  };
}

/**
 * loadAppStoreWindow({ pointLog, notifications }) — loads the real
 * modules/core/state-manager.js source into a jsdom window against a fake
 * `window.DBService` (only `read()` is required — `initRemote` is
 * deliberately left undefined, matching the "old db-service.js" fallback
 * branch AppStore's own init() already guards for, so this harness doesn't
 * need to fake a Supabase round trip just to get AppStore ready) and a real
 * `window.DEFAULT_DB` fallback object. `read()` returns a fresh object
 * seeded with the given `pointLog`/`notifications` arrays (each defaults to
 * []) plus every other DEFAULT_DB key AppStore's init() might touch.
 * Callers must `await win.AppStore.ready` before using the instance —
 * init() is async (it may await DBService.initRemote()), matching
 * production boot.
 *
 * Phase 5B (Data Layer Redesign, delta-sync dirty tracking): exercises
 * AppStore.updateState()'s _trackDirty() call plus the public
 * getDirtyIds()/clearDirty() surface it exposes, for both tables currently
 * in _DELTA_TRACKED_SLICES (point_log, notifications).
 */
function loadAppStoreWindow(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'dangerously',
    url: 'http://localhost/',
  });
  const win = dom.window;
  const seedState = {
    pointLog: opts.pointLog || [], notifications: opts.notifications || [], orders: opts.orders || [],
    bossParticipants: opts.bossParticipants || {}, inventory: opts.inventory || {}, redemptions: opts.redemptions || [],
    titles: opts.titles || [], quizHistory: opts.quizHistory || {}, quizzes: opts.quizzes || [], stageMap: opts.stageMap || [],
    students: opts.students || [], store: opts.store || [], achievements: opts.achievements || [],
  };
  win.DEFAULT_DB = { pointLog: [], notifications: [], orders: [], bossParticipants: {}, inventory: {}, redemptions: [], titles: [], quizHistory: {}, quizzes: [], stageMap: [], students: [], store: [], achievements: [] };
  // [Phase 5B bugfix] writeDirty/readDirty simulate the localStorage-backed
  // dirty-tracking persistence db-service.js now provides — see
  // _DIRTY_TRACKING_KEY's comment there. `opts.dirtySnapshot`, when passed,
  // is what readDirty() returns on THIS window's boot (i.e. "what a prior
  // session/tab already persisted"), enabling a genuine two-window reload
  // test: capture `win._lastDirtySnapshot` from a first loadAppStoreWindow()
  // instance after it persists, then pass it as `dirtySnapshot` to a second
  // instance to simulate that same browser reloading.
  win._dirtyWrites = [];
  win._lastDirtySnapshot = null;
  win.DBService = {
    read: () => seedState,
    write: () => {},
    writeDirty: (snapshot) => { win._dirtyWrites.push(snapshot); win._lastDirtySnapshot = snapshot; },
    readDirty: () => (opts.dirtySnapshot || null),
  };
  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'modules', 'core', 'state-manager.js'), 'utf8');
  const scriptEl = win.document.createElement('script');
  scriptEl.textContent = src;
  win.document.body.appendChild(scriptEl);
  return win;
}

module.exports = { loadUtilsWindow, loadLoggerWindow, loadAchEngineWindow, loadPhasesWindow, loadNavAndInventoryWindow, loadAchAdminAndTitlesWindow, loadAnalyticsAndRegistrationsWindow, loadTitlesSidebarRefreshWindow, loadBossFormButtonsWindow, loadNavAndBadgeRefreshWindow, loadAchAndTitlesRoundTripWindow, loadDbServiceWindow, makeFakeSupabaseClient, loadAppStoreWindow };

/**
 * loadAchAndTitlesRoundTripWindow() — loads the real
 * modules/achievements/ach_engine.js, then the real
 * modules/titles/titles_sidebar_refresh.js, in that order (matching
 * index.html's actual load order — ach_engine.js:807,
 * titles_sidebar_refresh.js:817), against a fake AppStore with a real
 * mutable state object (getSlice reads it, updateState mutates it and
 * synchronously notifies, same as emit — matching the real _notify()'s
 * registration-order guarantee), so a test can call the real,
 * un-monkey-patched achCheckAndAward() and assert on the title-unlock
 * subscriber's reaction the same way a real call from any of
 * achCheckAndAward's ~8 real call sites (campaign_engine.js,
 * combat-settings.js, shop_store.js, shop_pos_terminal.js, etc.) would
 * produce — this is the full round trip, not just one half of it in
 * isolation. `syncAchievementUnlockToServer`/`syncTitleUnlockToServer` are
 * stubbed no-ops (Phase 17/18 server sync, fire-and-forget, out of scope
 * for this event-wiring conversion). Continuation Plan §3 Category A
 * conversion (the highest-blast-radius item on the list).
 */
function loadAchAndTitlesRoundTripWindow() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'dangerously', url: 'http://localhost/',
  });
  const win = dom.window;

  win.subscribers = {};
  win.emitCalls = [];
  win.updateStateCalls = [];
  const state = { students: [], achievements: [], achievementUnlocks: {}, achievementSectionAssignments: {}, titles: [], titleUnlocks: {}, equippedTitles: {} };
  win.AppStore = {
    getSlice: (fn) => fn(state),
    updateState: (mutator, event) => {
      mutator(state);
      win.updateStateCalls.push(event);
      const subs = win.subscribers;
      Object.keys(subs).forEach((k) => subs[k](state, event || { type: 'state:updated', payload: null }));
    },
    subscribe: (key, fn) => { win.subscribers[key] = fn; },
    emit: (event) => {
      win.emitCalls.push(event);
      const subs = win.subscribers;
      Object.keys(subs).forEach((k) => subs[k](state, event));
    },
  };
  win._eqTestState = state;
  win.currentUser = null;
  win.currentRole = null;
  win.syncAchievementUnlockToServer = () => {};
  win.syncTitleUnlockToServer = () => {};
  win.tsShowTitleUnlockPopupCalls = [];
  win.tsBuildBadgeHTML = (title) => `<span class="fake-badge">${title.name}</span>`;
  win._esc = (s) => String(s);

  ['achievements/ach_engine.js', 'titles/titles_sidebar_refresh.js'].forEach((rel) => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'modules', rel), 'utf8');
    const scriptEl = win.document.createElement('script');
    scriptEl.textContent = src;
    win.document.body.appendChild(scriptEl);
  });
  // tsShowTitleUnlockPopup does real DOM work (appendChild, setTimeout auto-
  // remove) that isn't relevant to this round trip — stub it after load so
  // tsUnlockTitleForStudent's own logic (the part under test) still runs.
  win.tsShowTitleUnlockPopup = (title) => win.tsShowTitleUnlockPopupCalls.push(title);
  return win;
}

/**
 * loadNavAndBadgeRefreshWindow() — loads the real nav.js, then the real
 * modules/shared/reward-presenter.js, then the real
 * modules/titles/titles_sidebar_refresh.js, in that order (matching
 * index.html's actual load order — nav.js:642, reward-presenter.js:724,
 * titles_sidebar_refresh.js:817), against a fake AppStore whose emit()
 * synchronously notifies subscribers in registration order (same as the
 * real _notify()), so a test can call the real navTo() and assert on both
 * subscribers' reactions the same way a real navigation would produce them.
 * `_adminStoreInterval` and `currentRole` are declared with `var` before
 * nav.js loads — nav.js references both as bare globals (not
 * `typeof`-guarded), matching how a real classic-script global lexical
 * environment supplies them from modules/shop/shop_admin_store.js and
 * auth.js respectively; not loading those full files here, just their
 * global surface nav.js actually touches. renderStudentDashboard and
 * renderStudentQuizzes are stubbed as spies (nav.js calls whichever one
 * matches `id` directly, unguarded) — every other render-function branch is
 * avoided by picking test ids outside that list. Continuation Plan §3
 * Category A conversion.
 */
function loadNavAndBadgeRefreshWindow() {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="sidebar"></div><div id="sidebar-nav"></div></body></html>',
    { runScripts: 'dangerously', url: 'http://localhost/' }
  );
  const win = dom.window;

  win.subscribers = {};
  win.emitCalls = [];
  const state = { equippedTitles: {}, titles: [] };
  win.AppStore = {
    getSlice: (fn) => fn(state),
    updateState: () => {},
    subscribe: (key, fn) => { win.subscribers[key] = fn; },
    emit: (event) => { win.emitCalls.push(event); const subs = win.subscribers; Object.keys(subs).forEach((k) => subs[k](null, event)); },
  };
  win.currentUser = { id: 's1' };
  win.tsBuildBadgeHTML = (title) => `<span class="fake-badge">${title.name}</span>`;
  win.renderStudentDashboardCalls = [];
  win.renderStudentDashboard = () => win.renderStudentDashboardCalls.push('called');
  win.renderStudentQuizzesCalls = [];
  win.renderStudentQuizzes = () => win.renderStudentQuizzesCalls.push('called');
  win.mailUpdateSidebarBadgeCalls = [];
  win.mailUpdateSidebarBadge = () => win.mailUpdateSidebarBadgeCalls.push('called');
  win.achUpdateSidebarBadgeCalls = [];
  win.achUpdateSidebarBadge = () => win.achUpdateSidebarBadgeCalls.push('called');

  const preamble = win.document.createElement('script');
  preamble.textContent = 'var _adminStoreInterval = null; var currentRole = "student";';
  win.document.body.appendChild(preamble);

  ['nav.js', ['modules', 'shared', 'reward-presenter.js'], ['modules', 'titles', 'titles_sidebar_refresh.js']].forEach((rel) => {
    const parts = Array.isArray(rel) ? rel : [rel];
    const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', ...parts), 'utf8');
    const scriptEl = win.document.createElement('script');
    scriptEl.textContent = src;
    win.document.body.appendChild(scriptEl);
  });
  return win;
}

/**
 * loadBossFormButtonsWindow() — loads the real modules/world-boss/skills.js,
 * modules/world-boss/phases.js, and modules/world-boss/rage.js source into
 * one jsdom window, in that order (matching index.html's actual load order
 * within the World Boss group — skills.js then phases.js then rage.js,
 * both after admin-page.js, which this loader deliberately does NOT load:
 * openBossForm() itself is exercised by admin-page.js's own tests/manual
 * review, not here — this loader exists to verify the three subscribers
 * that react to the 'boss-form:opened' event it emits), against a fake
 * AppStore whose emit() synchronously notifies subscribers in registration
 * order (same as the real _notify() — see state-manager.js), so a test can
 * fire one emit() and assert on all three buttons' relative DOM order the
 * same way a real boss-form open would produce it. Continuation Plan §3
 * Category A conversion.
 */
function loadBossFormButtonsWindow() {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="modal-content"><button class="btn btn-primary">Save</button></div></body></html>',
    { runScripts: 'dangerously', url: 'http://localhost/' }
  );
  const win = dom.window;

  win.subscribers = {};
  win.emitCalls = [];
  win.AppStore = {
    getSlice: () => [],
    subscribe: (key, fn) => { win.subscribers[key] = fn; },
    emit: (event) => { win.emitCalls.push(event); const subs = win.subscribers; Object.keys(subs).forEach((k) => subs[k](null, event)); },
  };
  win.closeModalForce = () => {};
  win.wbsOpenSkillConfig = () => {};
  win.wbpOpenPhaseConfig = () => {};
  win.wbrageOpenConfig = () => {};
  // skills.js and phases.js each register a top-level setInterval() poll
  // loop (a same-tab fallback for a storage-event-based signal) that would
  // otherwise keep a standalone jsdom load running forever — not relevant
  // to the boss-form-button subscribers this loader exists to test, so
  // it's stubbed to a no-op rather than left to hang the test run (see this
  // function's own doc comment, and Continuation Plan §2 step 6).
  win.setInterval = () => 0;

  ['skills', 'phases', 'rage'].forEach((name) => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'modules', 'world-boss', name + '.js'), 'utf8');
    const scriptEl = win.document.createElement('script');
    scriptEl.textContent = src;
    win.document.body.appendChild(scriptEl);
  });
  return win;
}

/**
 * loadAnalyticsAndRegistrationsWindow() — loads the real
 * modules/admin/analytics.js then the real modules/admin/registrations.js,
 * in that order (matching index.html's actual load order — :874 before
 * :877). Deliberately does NOT also load modules/shop/shop_pos_terminal.js
 * — that file's renderAnalytics patch is confirmed dead (see the patch
 * site's own comment and this session's engineering-log entry), so it has
 * no behavior worth covering here; loading it would only add noise (and a
 * misleading implication that it's part of what this test verifies).
 * Continuation Plan §3 Category A conversion.
 */
function loadAnalyticsAndRegistrationsWindow() {
  const dom = new JSDOM('<!doctype html><html><body><div id="a-analytics"></div></body></html>', {
    runScripts: 'dangerously',
    url: 'http://localhost/',
  });
  const win = dom.window;

  win.subscribers = {};
  win.emitCalls = [];
  win.AppStore = {
    getSlice: () => [],
    subscribe: (key, fn) => { win.subscribers[key] = fn; },
    emit: (event) => { win.emitCalls.push(event); const subs = win.subscribers; Object.keys(subs).forEach((k) => subs[k](null, event)); },
  };
  win._esc = (s) => s;
  win.DB = { students: [], registrations: [] };
  win.currentRole = 'teacher'; // non-admin: keeps the mode-toggle UI branch simple, same default _anlMode:'mine' path

  ['analytics', 'registrations'].forEach((name) => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'modules', 'admin', name + '.js'), 'utf8');
    const scriptEl = win.document.createElement('script');
    scriptEl.textContent = src;
    win.document.body.appendChild(scriptEl);
  });
  return win;
}

/**
 * loadAchAdminAndTitlesWindow() — loads the real
 * modules/achievements/ach_admin_page.js then the real
 * modules/titles/titles_admin_page.js, in that order (matching
 * index.html's actual load order — :809 before :816), against a fake
 * AppStore whose getSlice() returns empty collections (renderAdminAchievements
 * takes its "0 achievements" branch, which is all this test needs — it
 * never touches ACH_RARITY/achRarityClass/etc., so those aren't stubbed)
 * and whose emit() synchronously notifies subscribers, same as the real
 * _notify(). Continuation Plan §3 Category A conversion.
 */
function loadAchAdminAndTitlesWindow() {
  const dom = new JSDOM('<!doctype html><html><body><div id="a-achievements"></div></body></html>', {
    runScripts: 'dangerously',
    url: 'http://localhost/',
  });
  const win = dom.window;

  win.subscribers = {};
  win.emitCalls = [];
  win.AppStore = {
    getSlice: () => [],
    subscribe: (key, fn) => { win.subscribers[key] = fn; },
    emit: (event) => { win.emitCalls.push(event); const subs = win.subscribers; Object.keys(subs).forEach((k) => subs[k](null, event)); },
  };
  win._esc = (s) => s;

  ['ach_admin_page', 'titles_admin_page'].forEach((name) => {
    const dir = name.startsWith('ach_') ? 'achievements' : 'titles';
    const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'modules', dir, name + '.js'), 'utf8');
    const scriptEl = win.document.createElement('script');
    scriptEl.textContent = src;
    win.document.body.appendChild(scriptEl);
  });
  return win;
}

/**
 * loadNavAndInventoryWindow() — loads the real nav.js then the real
 * modules/shop/shop_inventory.js source into one jsdom window, in that
 * order (matching index.html's actual load order — nav.js:642 before
 * shop_inventory.js:799), against a fake AppStore that both records
 * subscribers by key AND records emit() calls, so tests can call the real
 * setupSidebar() and assert both that it emits 'nav:sidebar-rendered' and
 * that shop_inventory.js's subscriber reacts to it — Continuation Plan §3
 * Category A conversion.
 */
function loadNavAndInventoryWindow() {
  const dom = new JSDOM('<!doctype html><html><body><div id="sidebar-nav"></div></body></html>', {
    runScripts: 'dangerously',
    url: 'http://localhost/',
  });
  const win = dom.window;

  win.subscribers = {};
  win.emitCalls = [];
  win.AppStore = {
    getSlice: () => ({}),
    subscribe: (key, fn) => { win.subscribers[key] = fn; },
    emit: (event) => { win.emitCalls.push(event); const subs = win.subscribers; Object.keys(subs).forEach((k) => subs[k](null, event)); },
  };
  win.currentUser = null;
  win.currentRole = null;

  ['nav.js', ['modules', 'shop', 'shop_inventory.js']].forEach((rel) => {
    const parts = Array.isArray(rel) ? rel : [rel];
    const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', ...parts), 'utf8');
    const scriptEl = win.document.createElement('script');
    scriptEl.textContent = src;
    win.document.body.appendChild(scriptEl);
  });
  return win;
}

/**
 * loadPhasesWindow() — loads the real modules/world-boss/phases.js source
 * into a jsdom window, against a fake AppStore whose subscribe() records
 * handlers by key (same approach as loadAchEngineWindow()).
 */
function loadPhasesWindow() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'dangerously',
    url: 'http://localhost/',
  });
  const win = dom.window;

  win.subscribers = {};
  win.AppStore = {
    getSlice: () => [],
    subscribe: (key, fn) => { win.subscribers[key] = fn; },
  };

  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'modules', 'world-boss', 'phases.js'), 'utf8');
  const scriptEl = win.document.createElement('script');
  scriptEl.textContent = src;
  win.document.body.appendChild(scriptEl);
  return win;
}

/**
 * loadAchEngineWindow() — loads the real modules/achievements/ach_engine.js
 * source into a jsdom window, against a fake AppStore whose subscribe()
 * just records handlers by key (so tests can invoke them directly with a
 * synthetic event, the same way AppStore._notify() would). Real AppStore
 * is intentionally not used here — see loadLoggerWindow()'s comment.
 */
function loadAchEngineWindow() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'dangerously',
    url: 'http://localhost/',
  });
  const win = dom.window;

  win.subscribers = {};
  win.AppStore = {
    getSlice: () => [],
    subscribe: (key, fn) => { win.subscribers[key] = fn; },
  };
  win.currentUser = null;
  win.currentRole = null;

  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'modules', 'achievements', 'ach_engine.js'), 'utf8');
  const scriptEl = win.document.createElement('script');
  scriptEl.textContent = src;
  win.document.body.appendChild(scriptEl);
  return win;
}

/**
 * loadLoggerWindow() — loads the real modules/recitation/logger.js source
 * into a jsdom window, against a lightweight fake AppStore (real AppStore
 * requires DBService.initRemote()/network access to init, which this Phase
 * 0-style harness intentionally avoids — see this file's header). The fake
 * only implements what logger.js actually calls: updateState() and
 * getStudent(). Everything updateState() is given gets recorded so tests
 * can assert on the event shape and draft-mutation behavior without
 * reimplementing logger.js's own logic.
 */
function loadLoggerWindow() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'dangerously',
    url: 'http://localhost/',
  });
  const win = dom.window;

  win.updateStateCalls = [];
  win.AppStore = {
    getStudent: (id) => win._fakeStudent && win._fakeStudent.id === id ? win._fakeStudent : null,
    updateState: (mutationFn, event) => {
      win.updateStateCalls.push({ mutationFn, event });
    },
  };
  // Stubs for logger.js's other ambient dependencies (DOM read, uid/nowStr
  // come from the real utils.js elsewhere in the app — stubbed here since
  // this harness only loads logger.js itself).
  win.uid = () => 'test-uid';
  win.nowStr = () => '2026-07-30T00:00:00.000Z';
  win._esc = (s) => s;
  win.syncStudentStatsToServer = () => {};
  win.toastCalls = [];
  win.toast = (msg) => win.toastCalls.push(msg);
  win.renderScannerCalls = 0;
  // Phase 7 (2026-08-10, session 4): logger.js's real call was
  // renderScanner() — a stale pre-Phase-1 name that doesn't exist in
  // production (only this mock kept it alive in tests). Fixed to call
  // renderRfidScanner(), the real Phase-1 replacement, matching what
  // nav.js already calls. Mock renamed to match; renderScannerCalls
  // kept as the counter name for a minimal diff against the test file.
  win.renderRfidScanner = () => { win.renderScannerCalls++; };

  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'modules', 'recitation', 'logger.js'), 'utf8');
  const scriptEl = win.document.createElement('script');
  scriptEl.textContent = src;
  win.document.body.appendChild(scriptEl);
  return win;
}
