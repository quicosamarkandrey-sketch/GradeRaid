// Phase 7 (2026-08-10, session 17) — equivalence check for
// world-boss-index.js. The key thing to verify precisely: this file's
// check is `typeof window[sym] === 'undefined'`, which accepts ANY
// defined value (object, string, number — not just functions), unlike
// admin-index.js/recitation-index.js/attendance-index.js's `!== 'function'`
// checks. Tested directly with a non-function value, not assumed to
// behave the same as the other three aggregators just because the
// surrounding shape looks similar.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow(setup) {
  const dom = new JSDOM('<!doctype html></html>', { runScripts: 'dangerously' });
  const win = dom.window;
  if (setup) setup(win);
  return win;
}

function captureConsole(win) {
  const logs = { error: [], log: [] };
  win.console.error = (...args) => logs.error.push(args.join(' '));
  win.console.log = (...args) => logs.log.push(args.join(' '));
  return logs;
}

function run(src, setup) {
  const win = makeWindow(setup);
  const logs = captureConsole(win);
  win.eval(src);
  return {
    errorLog: logs.error[0] || null,
    successLog: logs.log[0] || null,
    versionSet: win.__WB_MODULE_VERSION__,
    signalKeysIsArray: Array.isArray(win.__WB_SIGNAL_KEYS__),
    signalKeysContent: Array.isArray(win.__WB_SIGNAL_KEYS__) ? win.__WB_SIGNAL_KEYS__.join(',') : null,
  };
}

function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'world-boss', 'index.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'world-boss-index.bridge.js'), 'utf8');

  // Case 1: nothing present.
  const originalNone = run(originalSrc);
  const bridgeNone = run(bridgeSrc);
  assert.deepStrictEqual(bridgeNone, originalNone, 'nothing-present case must match');
  console.log('nothing present: error logged:', !!originalNone.errorLog, '| signal keys:', originalNone.signalKeysContent);

  // Case 2: THE KEY TEST — set every required symbol to a NON-FUNCTION
  // value (a plain object). Under a `!== 'function'` check (like the
  // other 3 aggregators) this would still report everything missing.
  // Under THIS file's real `=== 'undefined'` check, it must report
  // everything present, since a defined non-function value still counts.
  function setAllToNonFunctionObject(win) {
    // Re-derive the full REQUIRED list from the original source itself,
    // so this test doesn't silently drift from the real list if it
    // changes — not hand-copied a second time here.
    const listMatch = originalSrc.match(/const REQUIRED = \[([\s\S]*?)\];/);
    const names = listMatch[1].match(/'[^']+'/g).map((s) => s.slice(1, -1));
    names.forEach((name) => { win[name] = { notAFunction: true }; }); // plain object, not a function
  }
  const originalNonFn = run(originalSrc, setAllToNonFunctionObject);
  const bridgeNonFn = run(bridgeSrc, setAllToNonFunctionObject);
  assert.deepStrictEqual(bridgeNonFn, originalNonFn, 'non-function-values-present case must match between original and bridge');
  assert.strictEqual(originalNonFn.errorLog, null, 'sanity: non-function but DEFINED values must satisfy this check (=== "undefined", not !== "function")');
  assert.ok(originalNonFn.successLog.includes('verified'), 'sanity: must log success when all symbols are merely defined');
  console.log('all-defined-as-non-functions: correctly treated as satisfied (the distinguishing behavior) — OK');

  console.log('\nEQUIVALENCE CHECK PASSED');
}

main();
