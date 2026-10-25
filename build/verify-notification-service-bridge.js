// Phase 7 (Stream A) — equivalence check for modules/shared/notification-service.js.
//
// Real-imports AppStore (state-manager.js, this stream's own file) —
// same combined-bundle need as reward-presenter.js/table-sync.js/
// student-stats.js: the ORIGINAL window evals the real, untouched
// state-manager.js first (AppStore-dependent code here runs lazily,
// inside function calls, not at file-load time — unlike
// reward-presenter.js's subscribers — but load order still matters so
// `AppStore`/`DBService`/etc. bare identifiers resolve), then the real,
// untouched notification-service.js on top; the BRIDGE side evals the
// combined test bundle sharing one real AppStore instance the same way
// a real ES module graph would.
//
// External window-fallback deps (toast/navTo/uid/_esc) are given real,
// small, deterministic-where-needed implementations below (uid() is
// deterministic here specifically so notification IDs are comparable
// between the two windows — the real utils.js uid() is randomized,
// which would never match between two independently-seeded runs; using
// the SAME substitute on both sides is the correct move here, same as
// _esc/_cssColor got real bodies in reward-presenter's verify script).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow(opts) {
  opts = opts || {};
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="notif-wrap"></div><span id="notif-badge"></span><div id="notif-panel"></div></body></html>',
    { runScripts: 'dangerously', url: 'https://example.org/app/index.html' }
  );
  const win = dom.window;

  win.currentUser = opts.currentUser !== undefined ? opts.currentUser : null;
  win.currentRole = opts.currentRole !== undefined ? opts.currentRole : null;

  win.__toastCalls = [];
  win.toast = (msg, color) => { win.__toastCalls.push({ msg, color }); };
  win.__navToCalls = [];
  win.navTo = (action) => { win.__navToCalls.push(action); };
  let uidCounter = 0;
  win.uid = () => 'UID' + (++uidCounter);
  win._esc = function (s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  win.DEFAULT_DB = { students: [], quizzes: [], bossEvents: [], pointLog: [], notifications: [], orders: [], bossParticipants: {}, inventory: {}, redemptions: [], titles: [], quizHistory: {}, stageMap: [], store: [], achievements: [], classSections: [] };
  win.DBService = { initRemote: async () => {}, read: () => win.DEFAULT_DB, write: () => {} };

  return win;
}

function getGlobal(win, expr) { return win.eval(expr); }

async function seedSlices(win, { pointLog, orders, notifications }) {
  await win.AppStore.ready;
  win.AppStore.updateState(draft => {
    draft.pointLog = pointLog || [];
    draft.orders = orders || [];
    draft.notifications = notifications || [];
  }, { type: 'test:seed' });
}

function runEqTimeAgoScenarios(win) {
  const now = Date.now();
  const iso = (offsetMs) => new Date(now - offsetMs).toISOString();
  return {
    nullInput: win.eqTimeAgo(null),
    emptyInput: win.eqTimeAgo(''),
    invalidDate: win.eqTimeAgo('not-a-date'),
    justNow10s: win.eqTimeAgo(iso(10 * 1000)),
    futureIsJustNow: win.eqTimeAgo(iso(-5000)),
    fiveMinAgo: win.eqTimeAgo(iso(5 * 60 * 1000)),
    twoHoursAgo: win.eqTimeAgo(iso(2 * 3600 * 1000)),
    yesterday: win.eqTimeAgo(new Date(new Date(now).setDate(new Date(now).getDate() - 1)).toISOString()),
    threeDaysAgo: win.eqTimeAgo(new Date(new Date(now).setDate(new Date(now).getDate() - 3)).toISOString()),
    tenDaysAgo: win.eqTimeAgo(new Date(new Date(now).setDate(new Date(now).getDate() - 10)).toISOString()),
  };
}

function runClassifyScenarios(win) {
  const cases = [
    { what: 'Quest: Algebra Basics (86%)', pts: 15 },
    { what: 'Quest: Algebra Basics (86%)', pts: 0 },
    { what: 'Stage: Frozen Peaks', pts: 20 },
    { what: 'Boss Raid: "Molecule Dragon"', pts: 0 },
    { what: 'Achievement Claimed: Perfect Streak', pts: 0 },
    { what: 'Mail Reward: Welcome Gift', pts: 0 },
    { what: 'Recitation bonus', pts: 5 },
    { what: 'Recitation deduction', pts: -3 },
    { what: 'Attendance recorded', pts: 2 },
    { what: 'Attendance recorded', pts: 0 },
    { what: 'Random teacher note', pts: -10 },
    { what: 'Random teacher note', pts: 10 },
    { what: '', pts: 0 },
  ];
  return cases.map(c => win.eqClassifyActivity(c));
}

async function runSynthesizeScenarios(win) {
  const results = {};

  // --- Non-student role: synthesize/refresh no-ops entirely ---
  win.currentRole = 'teacher';
  win.currentUser = { id: 't1' };
  await seedSlices(win, { pointLog: [{ id: 'p1', studentId: 's1', what: 'Quest: X (50%)', pts: 10, createdAt: new Date().toISOString() }] });
  win.NotificationService.refresh();
  results.nonStudentRefresh = {
    wrapDisplay: win.document.getElementById('notif-wrap').style.display,
    toastCalls: win.__toastCalls.length,
    notifCount: (getGlobal(win, 'AppStore').getSlice(s => s.notifications) || []).length,
  };

  // --- Student, first-ever refresh: bootstrap backfill, no toast, all read ---
  win.currentRole = 'student';
  win.currentUser = { id: 's1' };
  await seedSlices(win, {
    pointLog: [
      { id: 'p1', studentId: 's1', what: 'Quest: Algebra Basics (86%)', pts: 15, createdAt: new Date(Date.now() - 100000).toISOString() },
      { id: 'p2', studentId: 's1', what: 'Boss Raid: "Molecule Dragon"', pts: 0, createdAt: new Date(Date.now() - 50000).toISOString() },
      { id: 'p3', studentId: 'OTHER_STUDENT', what: 'Quest: Not Mine (10%)', pts: 1, createdAt: new Date().toISOString() },
    ],
    orders: [
      { orderId: 'o1', studentId: 's1', itemName: 'Cape of Focus', cost: 200, emoji: '🧣', createdAt: new Date(Date.now() - 20000).toISOString() },
    ],
  });
  win.NotificationService.refresh();
  const afterBootstrap = getGlobal(win, 'AppStore').getSlice(s => s.notifications) || [];
  results.bootstrap = {
    toastCalls: win.__toastCalls.length,
    createdCount: afterBootstrap.filter(n => n.studentId === 's1').length,
    allRead: afterBootstrap.filter(n => n.studentId === 's1').every(n => n.read === true),
    badgeDisplay: win.document.getElementById('notif-badge').style.display,
    wrapDisplay: win.document.getElementById('notif-wrap').style.display,
  };

  // --- Student, second refresh: one genuinely new pointLog row -> single toast ---
  win.__toastCalls.length = 0;
  const current = getGlobal(win, 'AppStore').getSlice(s => s.pointLog) || [];
  getGlobal(win, 'AppStore').updateState(draft => {
    draft.pointLog = current.concat([{ id: 'p4', studentId: 's1', what: 'Achievement Claimed: Perfect Streak', pts: 0, createdAt: new Date().toISOString() }]);
  }, { type: 'test:seed2' });
  win.NotificationService.refresh();
  results.singleFreshToast = {
    toastCalls: win.__toastCalls.slice(),
    badgeText: win.document.getElementById('notif-badge').textContent,
    badgeDisplay: win.document.getElementById('notif-badge').style.display,
  };

  // --- Two genuinely new rows at once -> plural toast ---
  win.__toastCalls.length = 0;
  const current2 = getGlobal(win, 'AppStore').getSlice(s => s.pointLog) || [];
  getGlobal(win, 'AppStore').updateState(draft => {
    draft.pointLog = current2.concat([
      { id: 'p5', studentId: 's1', what: 'Recitation nice job', pts: 3, createdAt: new Date().toISOString() },
      { id: 'p6', studentId: 's1', what: 'Attendance recorded', pts: 1, createdAt: new Date().toISOString() },
    ]);
  }, { type: 'test:seed3' });
  win.NotificationService.refresh();
  results.pluralFreshToast = { toastCalls: win.__toastCalls.slice() };

  // --- Panel rendering while open ---
  win.NotificationService.toggle(); // open
  const panelHtmlOpen = win.document.getElementById('notif-panel').innerHTML;
  results.panelHasMarkAllWhenUnread = panelHtmlOpen.includes('Mark all read');
  results.panelRowCount = (panelHtmlOpen.match(/class="notif-row/g) || []).length;

  // --- markAllRead ---
  win.NotificationService.markAllRead();
  const afterMarkAll = getGlobal(win, 'AppStore').getSlice(s => s.notifications) || [];
  results.afterMarkAllUnreadCount = afterMarkAll.filter(n => n.studentId === 's1' && !n.read).length;
  results.badgeDisplayAfterMarkAll = win.document.getElementById('notif-badge').style.display;

  // --- markRead on an already-read id: no-op, doesn't throw ---
  const anyId = afterMarkAll.find(n => n.studentId === 's1').id;
  let markReadAgainThrew = false;
  try { win.NotificationService.markRead(anyId); } catch (e) { markReadAgainThrew = true; }
  results.markReadAgainThrew = markReadAgainThrew;

  // --- markRead on unknown id: no-op, doesn't throw ---
  let markReadUnknownThrew = false;
  try { win.NotificationService.markRead('does-not-exist'); } catch (e) { markReadUnknownThrew = true; }
  results.markReadUnknownThrew = markReadUnknownThrew;

  // --- Create one fresh unread notification, then openRow it: marks
  //     read, closes panel, calls navTo with its action ---
  const current3 = getGlobal(win, 'AppStore').getSlice(s => s.pointLog) || [];
  getGlobal(win, 'AppStore').updateState(draft => {
    draft.pointLog = current3.concat([{ id: 'p7', studentId: 's1', what: 'Mail Reward: Welcome Gift', pts: 0, createdAt: new Date().toISOString() }]);
  }, { type: 'test:seed4' });
  win.NotificationService.refresh();
  const beforeOpen = getGlobal(win, 'AppStore').getSlice(s => s.notifications) || [];
  const targetNotif = beforeOpen.find(n => n.sourceId === 'p7');
  win.__navToCalls.length = 0;
  win.NotificationService.openRow(targetNotif.id);
  const afterOpen = getGlobal(win, 'AppStore').getSlice(s => s.notifications) || [];
  results.openRow = {
    nowRead: afterOpen.find(n => n.id === targetNotif.id).read,
    panelDisplayAfter: win.document.getElementById('notif-panel').style.display,
    navToCalls: win.__navToCalls.slice(),
  };

  // --- close() explicitly ---
  win.NotificationService.toggle(); // reopen
  win.NotificationService.close();
  results.panelDisplayAfterClose = win.document.getElementById('notif-panel').style.display;

  return results;
}

async function runFullSuite(makeEval) {
  const results = {};

  const win1 = makeWindow({});
  makeEval(win1);
  results.eqTimeAgo = runEqTimeAgoScenarios(win1);
  results.classify = runClassifyScenarios(win1);

  const win2 = makeWindow({});
  makeEval(win2);
  results.synthesize = await runSynthesizeScenarios(win2);

  return results;
}

async function main() {
  const stateManagerSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'core', 'state-manager.js'), 'utf8');
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'shared', 'notification-service.js'), 'utf8');
  const combinedBridgeSrc = fs.readFileSync(path.join(__dirname, 'test-helpers', 'notification-service-combined-bundle.js'), 'utf8');

  const resultOriginal = await runFullSuite(win => { win.eval(stateManagerSrc); win.eval(originalSrc); });
  const resultBridge = await runFullSuite(win => { win.eval(combinedBridgeSrc); });

  // jsdom gotcha (documented in the global rules): assert.deepStrictEqual
  // can fail on two content-identical objects that came from different
  // jsdom vm realms (e.g. arrays/objects cloned inside AppStore's own
  // realm via getSlice()). Compare via JSON.stringify instead — not a
  // real behavioral difference.
  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original at every step');

  // Sanity checks against the original's real values.
  assert.strictEqual(resultOriginal.eqTimeAgo.nullInput, '', 'sanity: null input -> empty string');
  assert.strictEqual(resultOriginal.eqTimeAgo.invalidDate, '', 'sanity: invalid date -> empty string');
  assert.strictEqual(resultOriginal.eqTimeAgo.justNow10s, 'Just now', 'sanity: 10s ago -> Just now');
  assert.strictEqual(resultOriginal.eqTimeAgo.futureIsJustNow, 'Just now', 'sanity: future timestamp treated as Just now');
  assert.strictEqual(resultOriginal.eqTimeAgo.fiveMinAgo, '5m ago', 'sanity: 5 minutes ago');
  assert.strictEqual(resultOriginal.eqTimeAgo.twoHoursAgo, '2h ago', 'sanity: 2 hours ago');
  assert.strictEqual(resultOriginal.eqTimeAgo.yesterday, 'Yesterday', 'sanity: calendar-day Yesterday');
  assert.strictEqual(resultOriginal.eqTimeAgo.threeDaysAgo, '3d ago', 'sanity: 3 days ago');

  assert.strictEqual(resultOriginal.classify[0].type, 'quiz', 'sanity: Quest: classification');
  assert.strictEqual(resultOriginal.classify[2].type, 'campaign', 'sanity: Stage: classification');
  assert.strictEqual(resultOriginal.classify[3].type, 'boss', 'sanity: Boss Raid: classification');
  assert.strictEqual(resultOriginal.classify[4].type, 'achievement', 'sanity: Achievement Claimed: classification');
  assert.strictEqual(resultOriginal.classify[5].type, 'mail_reward', 'sanity: Mail Reward: classification');
  assert.strictEqual(resultOriginal.classify[6].title, 'Recitation Points', 'sanity: positive recitation');
  assert.strictEqual(resultOriginal.classify[7].title, 'Recitation Deduction', 'sanity: negative recitation');
  assert.strictEqual(resultOriginal.classify[8].title, 'Attendance Logged', 'sanity: attendance classification');
  assert.strictEqual(resultOriginal.classify[10].title, 'Points Deducted', 'sanity: generic negative fallback');
  assert.strictEqual(resultOriginal.classify[11].title, 'Points Awarded', 'sanity: generic positive fallback');

  assert.strictEqual(resultOriginal.synthesize.nonStudentRefresh.wrapDisplay, 'none', 'sanity: bell hidden for non-student roles');
  assert.strictEqual(resultOriginal.synthesize.nonStudentRefresh.toastCalls, 0, 'sanity: non-student refresh never toasts');
  assert.strictEqual(resultOriginal.synthesize.nonStudentRefresh.notifCount, 0, 'sanity: non-student refresh synthesizes nothing');
  assert.strictEqual(resultOriginal.synthesize.bootstrap.toastCalls, 0, 'sanity: bootstrap backfill never toasts');
  assert.strictEqual(resultOriginal.synthesize.bootstrap.createdCount, 3, 'sanity: bootstrap backfills only this student\'s 3 relevant rows (2 pointLog + 1 order; the 3rd pointLog row belongs to a different student and is excluded)');
  assert.strictEqual(resultOriginal.synthesize.bootstrap.allRead, true, 'sanity: bootstrap backfill is pre-marked read');
  assert.strictEqual(resultOriginal.synthesize.bootstrap.badgeDisplay, 'none', 'sanity: bootstrap creates no unread badge');
  assert.strictEqual(resultOriginal.synthesize.singleFreshToast.toastCalls.length, 1, 'sanity: exactly one new row -> exactly one toast');
  assert.ok(resultOriginal.synthesize.singleFreshToast.toastCalls[0].msg.includes('Achievement Unlocked!'), 'sanity: single-toast uses the notification\'s own title');
  assert.strictEqual(resultOriginal.synthesize.singleFreshToast.badgeText, '1', 'sanity: badge shows 1 unread');
  assert.strictEqual(resultOriginal.synthesize.pluralFreshToast.toastCalls.length, 1, 'sanity: two new rows -> exactly one (plural) toast call');
  assert.ok(resultOriginal.synthesize.pluralFreshToast.toastCalls[0].msg.includes('2 new updates'), 'sanity: plural toast message');
  assert.strictEqual(resultOriginal.synthesize.panelHasMarkAllWhenUnread, true, 'sanity: "Mark all read" shown while unread notifications exist');
  assert.ok(resultOriginal.synthesize.panelRowCount > 0, 'sanity: panel renders row markup');
  assert.strictEqual(resultOriginal.synthesize.afterMarkAllUnreadCount, 0, 'sanity: markAllRead clears all unread for this student');
  assert.strictEqual(resultOriginal.synthesize.badgeDisplayAfterMarkAll, 'none', 'sanity: badge hides once nothing unread');
  assert.strictEqual(resultOriginal.synthesize.markReadAgainThrew, false, 'sanity: markRead on an already-read id is a safe no-op');
  assert.strictEqual(resultOriginal.synthesize.markReadUnknownThrew, false, 'sanity: markRead on an unknown id is a safe no-op');
  assert.strictEqual(resultOriginal.synthesize.openRow.nowRead, true, 'sanity: openRow marks the notification read');
  assert.strictEqual(resultOriginal.synthesize.openRow.panelDisplayAfter, 'none', 'sanity: openRow closes the panel');
  assert.deepStrictEqual(resultOriginal.synthesize.openRow.navToCalls, ['s-mail'], 'sanity: openRow navigates using the notification\'s own action');
  assert.strictEqual(resultOriginal.synthesize.panelDisplayAfterClose, 'none', 'sanity: close() hides the panel');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('notification-service.js: eqTimeAgo bucket boundaries, all 9 classification branches, bootstrap');
  console.log('vs. normal synthesis, single/plural toast wording, badge rendering, panel rendering, markRead/');
  console.log('markAllRead/openRow/toggle/close, and the non-student no-op path all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
