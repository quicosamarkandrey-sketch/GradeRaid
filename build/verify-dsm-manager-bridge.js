// Phase 7, Stream B — equivalence check for modules/admin/dsm-manager.js.
// Covers: fresh load + persisted-merge load, NAV_STUDENT/NAV_ADMIN
// reconciliation (a nav item present in nav.js but missing from the DSM
// defaults gets appended), dsmGetStudentNav/AdminNav/TeacherNav (incl.
// group blocks, adminOnly filtering, widget-row exclusion), full
// renderNavManager DOM for all 3 tabs, search, every mutation
// (toggle/status/field/expand/assignGroup incl. the "+ New group…"
// prompt flow/rename-via-prompt/moveGroup boundary conditions/showAll/
// hideAll/unlockAll/resetToDefaults per-tab and full/applyAndRefresh),
// and the widget-visibility helpers.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const STARTER_HTML = `<!doctype html><html><body>
  <div id="a-nav-manager"></div>
</body></html>`;

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously' });
  const win = dom.window;
  const calls = [];
  win.__calls = calls;

  win._esc = s => String(s == null ? '' : s);
  win.toast = function (msg, color) { calls.push({ name: 'toast', msg, color }); };
  win.setupSidebar = function () { calls.push({ name: 'setupSidebar' }); };

  win.NAV_STUDENT = [
    { id: 's-dashboard', label: 'Dashboard', icon: 'home' },
    { id: 's-my-section', label: 'My Section', icon: 'groups' },
    { id: 's-new-feature', label: 'Brand New Feature', icon: 'star' }, // not in DSM_STUDENT_DEFAULTS
  ];
  win.NAV_ADMIN = [
    { id: 'a-dashboard', label: 'Command Center', icon: 'home' },
    { id: 'a-audit-log', label: 'Audit Log', icon: 'fact_check' },
    { id: 'a-new-admin-feature', label: 'Brand New Admin Feature', icon: 'star' }, // not in defaults
  ];
  win.ADMIN_ONLY_NAV_IDS = ['a-nav-manager', 'a-teachers', 'a-starter-pack', 'a-settings', 'a-content-oversight', 'a-audit-log'];

  win.__promptQueue = [];
  win.prompt = function (msg, def) { calls.push({ name: 'prompt', msg, def }); return win.__promptQueue.length ? win.__promptQueue.shift() : null; };

  win.__dsmStorage = null;
  win.DSMService = {
    read() { calls.push({ name: 'DSMService.read' }); return win.__dsmStorage; },
    write(data) { calls.push({ name: 'DSMService.write' }); win.__dsmStorage = JSON.parse(JSON.stringify(data)); },
  };

  return win;
}

function snapshot(win) {
  return { html: win.document.getElementById('a-nav-manager').innerHTML, calls: win.__calls };
}

function runSequence(win) {
  const results = {};

  // Fresh load (no persisted data) — nav builders + reconciliation.
  results.studentNavFresh = win.dsmGetStudentNav();
  results.adminNavFresh = win.dsmGetAdminNav();
  results.teacherNavFresh = win.dsmGetTeacherNav();
  results.dbCallsAfterFreshLoad = win.__calls;
  win.__calls.length = 0;

  // Widget helpers on fresh state.
  results.widgetVisibleKnown = win.dsmIsWidgetVisible('s-stagemap-btn', 'student');
  results.widgetVisibleUnknown = win.dsmIsWidgetVisible('nope', 'student');
  results.widgetConfigKnown = win.dsmGetWidgetConfig('s-stagemap-btn', 'student');
  results.widgetConfigUnknown = win.dsmGetWidgetConfig('nope', 'student');

  // renderNavManager for all 3 tabs.
  win.renderNavManager();
  results.renderAdminTab = snapshot(win);
  win.__calls.length = 0;

  win.dsmSwitchTab('student');
  results.renderStudentTab = snapshot(win);
  win.__calls.length = 0;

  win.dsmSwitchTab('teacher');
  results.renderTeacherTab = snapshot(win);
  win.__calls.length = 0;

  win.dsmSwitchTab('bogus'); // invalid tab — no-op, stays on 'teacher'
  results.switchToBogusNoop = snapshot(win);
  win.__calls.length = 0;

  // Search filter.
  win.dsmSwitchTab('admin');
  win.__calls.length = 0;
  win.dsmSetSearch('audit');
  results.afterSearch = snapshot(win);
  win.dsmSetSearch('zzz-no-match');
  results.afterSearchNoMatch = snapshot(win);
  win.dsmSetSearch('');
  win.__calls.length = 0;

  // Toggle visible/locked/disabled.
  win.dsmToggle('admin', 'a-store', 'visible');
  results.afterToggleVisible = snapshot(win);
  win.__calls.length = 0;
  win.dsmToggle('admin', 'a-store', 'locked');
  results.afterToggleLocked = snapshot(win);
  win.__calls.length = 0;
  win.dsmToggle('admin', 'nope', 'visible'); // unknown id — no-op
  results.toggleUnknownNoop = snapshot(win);
  win.__calls.length = 0;

  // Status + field edits.
  win.dsmSetStatus('admin', 'a-boss-studio', 'coming_soon');
  results.afterSetStatus = snapshot(win);
  win.__calls.length = 0;
  win.dsmSetField('admin', 'a-boss-studio', 'label', 'Renamed Studio');
  results.afterSetLabel = snapshot(win);
  win.__calls.length = 0;
  win.dsmSetField('admin', 'a-boss-studio', 'order', 'not-a-number'); // NaN -> unchanged
  results.afterSetOrderInvalid = snapshot(win);
  win.dsmSetField('admin', 'a-boss-studio', 'order', '2.5');
  results.afterSetOrderValid = snapshot(win);
  win.__calls.length = 0;

  // Expand row.
  win.dsmExpandRow('admin', 'a-boss-studio');
  results.afterExpandRow = snapshot(win);
  win.dsmExpandRow('admin', 'a-boss-studio');
  results.afterCollapseRow = snapshot(win);
  win.__calls.length = 0;

  // Assign to existing group, then a brand-new group via prompt, then cancel.
  win.dsmAssignGroup('admin', 'a-dashboard', 'Tools');
  results.assignExistingGroup = snapshot(win);
  win.__calls.length = 0;

  win.__promptQueue = ['Custom Group'];
  win.dsmAssignGroup('admin', 'a-analytics', '__new__');
  results.assignNewGroupViaPrompt = snapshot(win);
  win.__calls.length = 0;

  win.__promptQueue = [null]; // cancelled
  win.dsmAssignGroup('admin', 'a-mail', '__new__');
  results.assignNewGroupCancelled = snapshot(win);
  win.__calls.length = 0;

  win.__promptQueue = ['   ']; // whitespace-only — treated as cancel
  win.dsmAssignGroup('admin', 'a-mail', '__new__');
  results.assignNewGroupBlank = snapshot(win);
  win.__calls.length = 0;

  // Rename group.
  win.__promptQueue = ['Renamed Tools'];
  win.dsmRenameGroup('admin', 'Tools');
  results.renameGroupOk = snapshot(win);
  win.__calls.length = 0;

  win.__promptQueue = [null];
  win.dsmRenameGroup('admin', 'Content');
  results.renameGroupCancelled = snapshot(win);
  win.__calls.length = 0;

  win.__promptQueue = ['Content']; // same name — treated as no-op
  win.dsmRenameGroup('admin', 'Content');
  results.renameGroupSameNameNoop = snapshot(win);
  win.__calls.length = 0;

  // Move group up/down, incl. boundary clamps.
  win.dsmMoveGroup('admin', 'Content', -1);
  results.moveGroupUp = snapshot(win);
  win.__calls.length = 0;
  win.dsmMoveGroup('admin', 'Content', 1);
  results.moveGroupDown = snapshot(win);
  win.__calls.length = 0;
  win.dsmMoveGroup('admin', 'NoSuchGroup', -1); // unknown group — no-op
  results.moveGroupUnknownNoop = snapshot(win);
  win.__calls.length = 0;

  // Show/hide/unlock all.
  win.dsmHideAll('student');
  results.afterHideAllStudent = snapshot(win);
  win.__calls.length = 0;
  win.dsmSwitchTab('student');
  results.studentTabAfterHideAll = snapshot(win);
  win.__calls.length = 0;
  win.dsmShowAll('student');
  results.afterShowAllStudent = snapshot(win);
  win.__calls.length = 0;
  win.dsmUnlockAll('admin');
  results.afterUnlockAllAdmin = snapshot(win);
  win.__calls.length = 0;

  // Reset to defaults — per-tab and full.
  win.dsmResetToDefaults('student');
  results.resetStudent = snapshot(win);
  win.__calls.length = 0;

  win.dsmResetToDefaults('bogus'); // falls into the "full reset" else-branch
  results.resetFull = snapshot(win);
  win.__calls.length = 0;

  // Apply & Refresh.
  win.dsmApplyAndRefresh();
  results.applyAndRefresh = snapshot(win);

  return results;
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'dsm-manager.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'dsm-manager.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.renderNavManager, 'function');
  const resultOriginal = runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.renderNavManager, 'function');
  const resultBridge = runSequence(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original output at every step');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('dsm-manager.js: fresh load + NAV_STUDENT/NAV_ADMIN reconciliation, all 3 nav builders,');
  console.log('widget helpers, full renderNavManager DOM for all 3 tabs (incl. invalid-tab no-op), search,');
  console.log('every mutation (toggle/status/field incl. NaN-order guard/expand/assignGroup incl. new-group');
  console.log('prompt flow and cancel/blank paths/renameGroup incl. cancel/same-name/moveGroup incl. boundary');
  console.log('clamps and unknown-group no-op/showAll/hideAll/unlockAll/resetToDefaults per-tab+full/');
  console.log('applyAndRefresh) all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
