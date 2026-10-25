// Phase 7 (Stream A) — equivalence check for topbar.js.
//
// No real imports in this file (all four external references —
// currentUser, currentRole, wbcUpdateTopbarWidget, refreshAllAvatars,
// NotificationService — are window-fallback), so a plain two-window
// eval (original classic script vs. bundled bridge) is sufficient, same
// shape as verify-button-loading-bridge.js. currentUser/currentRole are
// read as bare identifiers WITHOUT a typeof guard (unlike the other
// three), so both windows must always have them predefined or the
// original itself would throw a ReferenceError — that's real behavior
// to preserve, not something to paper over. The "noUser" scenario below
// calls updateTopbar() with currentUser left null/undefined to exercise
// the early-return path (verified via DOM staying untouched and the
// wbc/refresh/notification collaborators NOT being invoked for it).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const HTML = `<!doctype html><html><head></head><body>
  <div id="topbar-coin-val"></div>
  <div id="topbar-coins" style="display:none"></div>
  <div id="topbar-av"></div>
  <div id="sb-avatar"></div>
  <div id="sb-name"></div>
  <div id="sb-tier"></div>
  <div id="sb-xp-fill" style="width:0%"></div>
  <div id="sb-xp-label"></div>
  <div id="sb-xp-next"></div>
  <div id="sidebar"></div>
  <div id="main-app"></div>
</body></html>`;

function makeWindow(opts) {
  opts = opts || {};
  const win = new JSDOM(HTML, { runScripts: 'dangerously', url: 'https://example.org/app/index.html' }).window;
  win.currentUser = opts.currentUser !== undefined ? opts.currentUser : null;
  win.currentRole = opts.currentRole !== undefined ? opts.currentRole : null;
  if (opts.withWbc) win.wbcUpdateTopbarWidget = () => { win.__wbcCalls = (win.__wbcCalls || 0) + 1; };
  if (opts.withRefreshAvatars) win.refreshAllAvatars = () => { win.__refreshCalls = (win.__refreshCalls || 0) + 1; };
  if (opts.withNotificationService) win.NotificationService = { refresh: () => { win.__notifCalls = (win.__notifCalls || 0) + 1; } };
  if (opts.innerWidth !== undefined) {
    Object.defineProperty(win, 'innerWidth', { value: opts.innerWidth, configurable: true });
  }
  if (opts.brokenLocalStorage) {
    Object.defineProperty(win, 'localStorage', {
      get() { return { setItem() { throw new Error('storage disabled'); }, getItem() { throw new Error('storage disabled'); } }; },
      configurable: true,
    });
  }
  return win;
}

function snapshotTopbar(win) {
  const d = win.document;
  return {
    coinVal: d.getElementById('topbar-coin-val').textContent,
    coinsDisplay: d.getElementById('topbar-coins').style.display,
    avText: d.getElementById('topbar-av').textContent,
    avColor: d.getElementById('topbar-av').style.color,
    sbAvatarText: d.getElementById('sb-avatar').textContent,
    sbAvatarCss: d.getElementById('sb-avatar').style.cssText,
    sbName: d.getElementById('sb-name').textContent,
    sbTier: d.getElementById('sb-tier').textContent,
    sbXpFillWidth: d.getElementById('sb-xp-fill').style.width,
    sbXpLabel: d.getElementById('sb-xp-label').textContent,
    sbXpNext: d.getElementById('sb-xp-next').textContent,
  };
}

function snapshotSidebar(win) {
  const d = win.document;
  return {
    sidebarOpen: d.getElementById('sidebar').classList.contains('open'),
    mainCollapsed: d.getElementById('main-app').classList.contains('sidebar-collapsed'),
  };
}

function runUpdateTopbarScenarios(win) {
  const results = {};

  // 1. No currentUser: early return, DOM untouched.
  win.updateTopbar();
  results.noUser = snapshotTopbar(win);

  // 2. Student, multi-word name.
  win.currentUser = { coins: 12345, init: 'JM', color: '#8b5cf6', level: 3, xp: 1500, tier: 'Scholar', name: 'Jose Miguel Santos' };
  win.currentRole = 'student';
  win.updateTopbar();
  results.studentMultiWord = snapshotTopbar(win);

  // 3. Student, single-word name (nameParts guard).
  win.currentUser = { coins: 0, init: 'ZZ', color: '#111111', level: 0, xp: 0, tier: 'Novice', name: 'Cher' };
  win.currentRole = 'student';
  win.updateTopbar();
  results.studentSingleWord = snapshotTopbar(win);

  // 4. Teacher.
  win.currentUser = { name: 'Ms. Garcia' };
  win.currentRole = 'teacher';
  win.updateTopbar();
  results.teacher = snapshotTopbar(win);

  // 5. Admin.
  win.currentUser = { name: 'Root Admin' };
  win.currentRole = 'admin';
  win.updateTopbar();
  results.admin = snapshotTopbar(win);

  // 6. Non-numeric coins path (teacher/admin currentUser.coins is '-','-' string branch already
  //    covered structurally above via currentRole check; also check string coins passthrough)
  win.currentUser = { coins: 'N/A', init: 'AB', color: '#222222', level: 1, xp: 10, tier: 'Novice', name: 'A B' };
  win.currentRole = 'student';
  win.updateTopbar();
  results.studentStringCoins = snapshotTopbar(win);

  return results;
}

async function runFullSuite(src) {
  const results = {};

  // --- updateTopbar scenarios, on one window, sequential (matches how a real app calls it repeatedly) ---
  const win1 = makeWindow({ withWbc: true, withRefreshAvatars: true, withNotificationService: true });
  win1.eval(src);
  results.updateTopbar = runUpdateTopbarScenarios(win1);
  results.wbcCalls = win1.__wbcCalls || 0;
  results.refreshCalls = win1.__refreshCalls || 0;
  results.notifCalls = win1.__notifCalls || 0;

  // --- updateTopbar with the three optional collaborators absent (typeof-guarded; must not throw) ---
  const win2 = makeWindow({});
  win2.eval(src);
  win2.currentUser = { coins: 5, init: 'XY', color: '#333333', level: 1, xp: 5, tier: 'Novice', name: 'Solo' };
  win2.currentRole = 'student';
  let threw = false;
  try { win2.updateTopbar(); } catch (e) { threw = true; }
  results.noCollaboratorsThrew = threw;
  results.noCollaboratorsSnapshot = snapshotTopbar(win2);

  // --- toggleSidebar: mobile ---
  const win3 = makeWindow({ innerWidth: 800 });
  win3.eval(src);
  win3.toggleSidebar();
  results.mobileFirstToggle = snapshotSidebar(win3);
  win3.toggleSidebar();
  results.mobileSecondToggle = snapshotSidebar(win3);
  // mobile toggle must not touch localStorage-backed collapse key
  let mobileStorageErr = null;
  try { results.mobileStorageAfter = win3.localStorage.getItem('eq_sidebar_collapsed'); } catch (e) { mobileStorageErr = e.message; }
  results.mobileStorageErr = mobileStorageErr;

  // --- toggleSidebar: desktop, persists to localStorage ---
  const win4 = makeWindow({ innerWidth: 1400 });
  win4.eval(src);
  win4.toggleSidebar();
  results.desktopFirstToggle = { sidebar: snapshotSidebar(win4), stored: win4.localStorage.getItem('eq_sidebar_collapsed') };
  win4.toggleSidebar();
  results.desktopSecondToggle = { sidebar: snapshotSidebar(win4), stored: win4.localStorage.getItem('eq_sidebar_collapsed') };

  // --- toggleSidebar: desktop, localStorage throws (non-fatal) ---
  const win5 = makeWindow({ innerWidth: 1400, brokenLocalStorage: true });
  win5.eval(src);
  let brokenThrew = false;
  try { win5.toggleSidebar(); } catch (e) { brokenThrew = true; }
  results.brokenStorageToggleThrew = brokenThrew;
  results.brokenStorageToggleSnapshot = snapshotSidebar(win5);

  // --- restoreSidebarState: mobile is a no-op regardless of stored value ---
  const win6 = makeWindow({ innerWidth: 800 });
  win6.eval(src);
  win6.localStorage.setItem('eq_sidebar_collapsed', '1');
  win6.restoreSidebarState();
  results.restoreMobile = snapshotSidebar(win6);

  // --- restoreSidebarState: desktop, collapsed='1' ---
  const win7 = makeWindow({ innerWidth: 1400 });
  win7.eval(src);
  win7.localStorage.setItem('eq_sidebar_collapsed', '1');
  win7.restoreSidebarState();
  results.restoreDesktopCollapsed = snapshotSidebar(win7);

  // --- restoreSidebarState: desktop, no stored value -> expanded ---
  const win8 = makeWindow({ innerWidth: 1400 });
  win8.eval(src);
  win8.restoreSidebarState();
  results.restoreDesktopDefault = snapshotSidebar(win8);

  // --- restoreSidebarState: desktop, localStorage throws (defaults to expanded, non-fatal) ---
  const win9 = makeWindow({ innerWidth: 1400, brokenLocalStorage: true });
  win9.eval(src);
  let restoreBrokenThrew = false;
  try { win9.restoreSidebarState(); } catch (e) { restoreBrokenThrew = true; }
  results.restoreBrokenThrew = restoreBrokenThrew;
  results.restoreBrokenSnapshot = snapshotSidebar(win9);

  // --- SIDEBAR_COLLAPSE_KEY exported constant value ---
  results.sidebarCollapseKeyOnWindowBridgeOnly = typeof win9.SIDEBAR_COLLAPSE_KEY;

  return results;
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'topbar.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'topbar.bridge.js'), 'utf8');

  const resultOriginal = await runFullSuite(originalSrc);
  const resultBridge = await runFullSuite(bridgeSrc);

  // SIDEBAR_COLLAPSE_KEY is a plain top-level const in the original classic
  // script — per established project convention (confirmed on DB_KEY/
  // QUEST_IMAGES etc.) it never lands on window there, only the bridge
  // re-exports it. Compare everything else strictly; compare this one
  // field with the expected asymmetry instead of equality.
  assert.strictEqual(resultOriginal.sidebarCollapseKeyOnWindowBridgeOnly, 'undefined', 'sanity: original never puts the const on window');
  assert.strictEqual(resultBridge.sidebarCollapseKeyOnWindowBridgeOnly, 'string', 'bridge must re-export SIDEBAR_COLLAPSE_KEY onto window');
  delete resultOriginal.sidebarCollapseKeyOnWindowBridgeOnly;
  delete resultBridge.sidebarCollapseKeyOnWindowBridgeOnly;

  assert.deepStrictEqual(resultBridge, resultOriginal, 'bridge output must exactly match original at every step');

  // A few sanity checks on the original itself, so a trivially-passing
  // no-op comparison can't hide behind "both sides do nothing".
  assert.strictEqual(resultOriginal.updateTopbar.studentMultiWord.sbName, 'Jose Miguel', 'sanity: two-word name slice');
  assert.strictEqual(resultOriginal.updateTopbar.studentSingleWord.sbName, 'Cher', 'sanity: single-word name guard');
  assert.strictEqual(resultOriginal.updateTopbar.teacher.sbTier, 'Teacher', 'sanity: role-split fix shows Teacher label');
  assert.strictEqual(resultOriginal.updateTopbar.admin.sbTier, 'Administrator', 'sanity: role-split fix shows Administrator label');
  assert.strictEqual(resultOriginal.wbcCalls, 5, 'sanity: wbcUpdateTopbarWidget called once per non-early-return updateTopbar() invocation (noUser early-returns)');
  assert.strictEqual(resultOriginal.refreshCalls, 5, 'sanity: refreshAllAvatars called once per non-early-return updateTopbar() invocation');
  assert.strictEqual(resultOriginal.notifCalls, 5, 'sanity: NotificationService.refresh called once per non-early-return updateTopbar() invocation');
  assert.strictEqual(resultOriginal.noCollaboratorsThrew, false, 'sanity: typeof guards prevent throwing when collaborators are absent');
  assert.strictEqual(resultOriginal.mobileStorageErr, null, 'sanity: mobile path never touches localStorage in a way that throws');
  assert.strictEqual(resultOriginal.desktopFirstToggle.stored, '1', 'sanity: desktop toggle persists collapsed=1');
  assert.strictEqual(resultOriginal.desktopSecondToggle.stored, '0', 'sanity: desktop toggle persists collapsed=0 on second toggle');
  assert.strictEqual(resultOriginal.brokenStorageToggleThrew, false, 'sanity: broken localStorage.setItem is caught, non-fatal');
  assert.strictEqual(resultOriginal.restoreMobile.mainCollapsed, false, 'sanity: mobile restore is a no-op');
  assert.strictEqual(resultOriginal.restoreDesktopCollapsed.mainCollapsed, true, 'sanity: desktop restore applies stored collapsed=1');
  assert.strictEqual(resultOriginal.restoreDesktopDefault.mainCollapsed, false, 'sanity: desktop restore defaults to expanded with no stored value');
  assert.strictEqual(resultOriginal.restoreBrokenThrew, false, 'sanity: broken localStorage.getItem is caught, non-fatal');
  assert.strictEqual(resultOriginal.restoreBrokenSnapshot.mainCollapsed, false, 'sanity: broken storage on restore defaults to expanded');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log(JSON.stringify(resultOriginal, null, 2));
}

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
