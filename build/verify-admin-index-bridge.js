// Phase 7 (2026-08-10, session 17) — equivalence check for admin-index.js.
// Same discipline as the other aggregator-sink checks, scaled to the
// full 60-function list — including a PARTIAL case (some but not all
// present), which none of the smaller aggregator files had reason to
// test distinctly but this one's larger list makes worth confirming:
// the missing-list must be exactly the right subset, not just non-empty.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const ADMIN_EXPECTED = [
  'renderAdminDashboard', 'openAwardPoints', 'doAwardPoints',
  'renderAnalytics',
  'renderAdminQuizzes', 'openQuizBuilder', 'openEditQuiz',
  'addQuestion', 'removeQuestion', 'setCorrect', 'addOption', 'removeOption',
  'saveQuiz', 'deleteQuiz', 'confirmDeleteQuiz',
  'renderAdminRegistrations', 'regSetFilter', 'regAdminViewDetails',
  'regAdminApprove', 'regAdminRejectModal', 'regAdminConfirmReject',
  'showRegScreen', 'hideRegScreen', 'doRegister',
  'renderNavManager', 'dsmGetStudentNav', 'dsmGetTeacherNav', 'dsmGetAdminNav', 'dsmIsWidgetVisible', 'dsmGetWidgetConfig',
  'dsmSwitchTab', 'dsmToggle', 'dsmSetStatus', 'dsmSetField',
  'dsmExpandRow', 'dsmShowAll', 'dsmHideAll', 'dsmUnlockAll',
  'dsmApplyAndRefresh', 'dsmResetToDefaults',
  'renderSectionMaker', 'unmountSectionMaker',
  'getActiveClassIds', 'getClassLabel',
  'renderTeacherDirectory', 'doPromoteTeacher', 'doDemoteAdmin',
  'doDeactivateAccount', 'doReactivateAccount',
  '_tdOpenTransferModal', '_tdSubmitTransfer',
  'renderStarterPackEditor',
  'renderSchoolSettings', 'saveSchoolSettings',
  'renderContentOversight', 'openContentOversightFor', 'unmountContentOversight',
  'renderAuditLog', 'auditLogSetTeacherFilter', 'auditLogSetActionFilter',
  'auditLogSetTableFilter', 'auditLogLoadMore',
  'unmountCommandCenter',
];

function makeWindow(presentSubset) {
  const dom = new JSDOM('<!doctype html></html>', { runScripts: 'dangerously' });
  const win = dom.window;
  (presentSubset || []).forEach((name) => { win[name] = () => {}; });
  return win;
}

function captureConsole(win) {
  const logs = { error: [], log: [] };
  win.console.error = (...args) => logs.error.push(JSON.stringify(args));
  win.console.log = (...args) => logs.log.push(args.join(' '));
  return logs;
}

function run(src, presentSubset) {
  const win = makeWindow(presentSubset);
  const logs = captureConsole(win);
  win.eval(src);
  return {
    errorLog: logs.error[0] || null,
    successLog: logs.log.find((l) => l.includes('all')) || null,
    versionSet: win.__ADMIN_MODULE_VERSION__,
  };
}

function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'index.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'admin-index.bridge.js'), 'utf8');

  // Case 1: nothing present.
  const originalNone = run(originalSrc, []);
  const bridgeNone = run(bridgeSrc, []);
  assert.deepStrictEqual(bridgeNone, originalNone, 'nothing-present case must match');
  console.log('nothing present:', originalNone.versionSet, '| error logged:', !!originalNone.errorLog);

  // Case 2: everything present.
  const originalAll = run(originalSrc, ADMIN_EXPECTED);
  const bridgeAll = run(bridgeSrc, ADMIN_EXPECTED);
  assert.deepStrictEqual(bridgeAll, originalAll, 'everything-present case must match');
  assert.strictEqual(originalAll.errorLog, null, 'sanity: fully satisfied must not log an error');
  assert.ok(originalAll.successLog.includes('63'), 'sanity: success message must report the correct count (63)');
  console.log('everything present:', originalAll.successLog);

  // Case 3: partial — exactly the first half present. The missing-list
  // logged must be exactly the second half, not just "some list."
  const half = ADMIN_EXPECTED.length / 2;
  const present = ADMIN_EXPECTED.slice(0, half);
  const expectedMissing = ADMIN_EXPECTED.slice(half);
  const originalPartial = run(originalSrc, present);
  const bridgePartial = run(bridgeSrc, present);
  assert.deepStrictEqual(bridgePartial, originalPartial, 'partial case must match between original and bridge');
  const loggedMissing = JSON.parse(originalPartial.errorLog)[1];
  assert.deepStrictEqual(loggedMissing, expectedMissing, 'the logged missing-list must be EXACTLY the absent half, not approximate');
  console.log('partial (half present): missing-list exactly matches the absent half — OK,', loggedMissing.length, 'items');

  console.log('\nEQUIVALENCE CHECK PASSED');
}

main();
