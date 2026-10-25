// Phase 7 (2026-08-10, session 15) — equivalence check for
// attendance-index.js. Same discipline as recitation-index.js's check,
// plus the extra `typeof window.AttendanceService !== 'object'` branch
// this file has that recitation-index.js didn't — exercised specifically,
// not assumed to work the same way just because the rest of the file
// looks similar.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow(mode) {
  // mode: 'none' | 'functionsOnlyNoService' | 'all'
  const dom = new JSDOM('<!doctype html></html>', { runScripts: 'dangerously' });
  const win = dom.window;
  if (mode === 'functionsOnlyNoService' || mode === 'all') {
    win.renderRfidScanner = () => {};
    win.unmountRfidScanner = () => {};
    win.renderRecitationAttendanceLog = () => {};
    win.unmountRecitationAttendanceLog = () => {};
  }
  if (mode === 'all') {
    win.AttendanceService = { getClient: () => {} }; // must be an object, not a function
  }
  return win;
}

function captureConsole(win) {
  const logs = { error: [], log: [] };
  win.console.error = (...args) => logs.error.push(JSON.stringify(args));
  win.console.log = (...args) => logs.log.push(args.join(' '));
  return logs;
}

function run(src, mode) {
  const win = makeWindow(mode);
  const logs = captureConsole(win);
  win.eval(src);
  return {
    errorLog: logs.error[0] || null,
    successLogged: logs.log.some((l) => l.includes('All exports verified')),
    versionSet: win.__ATTENDANCE_MODULE_VERSION__,
  };
}

function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'attendance', 'att_index.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'attendance-index.bridge.js'), 'utf8');

  for (const mode of ['none', 'functionsOnlyNoService', 'all']) {
    const original = run(originalSrc, mode);
    const bridge = run(bridgeSrc, mode);
    assert.deepStrictEqual(bridge, original, `mode="${mode}": bridge output must match original exactly`);
    console.log(`mode="${mode}":`, original);
  }

  // Sanity: the three modes must actually behave differently from each other.
  const none = run(originalSrc, 'none');
  const functionsOnly = run(originalSrc, 'functionsOnlyNoService');
  const all = run(originalSrc, 'all');
  assert.notStrictEqual(none.errorLog, null, 'sanity: fully-missing case must log an error');
  assert.notStrictEqual(functionsOnly.errorLog, null, 'sanity: functions-present-but-no-AttendanceService must STILL log an error (the object-type branch)');
  assert.ok(functionsOnly.errorLog.includes('AttendanceService'), 'sanity: that error must specifically call out AttendanceService as missing');
  assert.strictEqual(all.errorLog, null, 'sanity: fully-satisfied case must not log an error');
  assert.strictEqual(all.successLogged, true, 'sanity: fully-satisfied case must log success');

  console.log('\nEQUIVALENCE CHECK PASSED (including the AttendanceService object-type branch specifically)');
}

main();
