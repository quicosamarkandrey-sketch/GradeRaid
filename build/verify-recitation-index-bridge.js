// Phase 7 (2026-08-10, session 15) — equivalence check for
// recitation-index.js. Exercises the verification logic under BOTH real
// conditions it's designed for: dependencies missing (logs an error,
// listing exactly which ones) and dependencies present (logs success) —
// not just "it ran without throwing."
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow(withDeps) {
  const dom = new JSDOM('<!doctype html></html>', { runScripts: 'dangerously' });
  const win = dom.window;
  if (withDeps) {
    win.logRecitation = () => {};
    win.renderStudentProgress = () => {};
    win.progSwitchTab = () => {};
    win.progCalNav = () => {};
    win.progShowCalDay = () => {};
  }
  return win;
}

function captureConsole(win) {
  const logs = { error: [], log: [] };
  win.console.error = (...args) => logs.error.push(args.join(' '));
  win.console.log = (...args) => logs.log.push(args.join(' '));
  return logs;
}

function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'recitation', 'recitation_index.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'recitation-index.bridge.js'), 'utf8');

  const results = {};
  for (const [label, src] of [['original', originalSrc], ['bridge', bridgeSrc]]) {
    // Case 1: dependencies missing — must log an error, not throw.
    const winMissing = makeWindow(false);
    const logsMissing = captureConsole(winMissing);
    winMissing.eval(src);
    results[`${label}_missingCase_errorLogged`] = logsMissing.error.length === 1;
    results[`${label}_missingCase_versionSet`] = winMissing.__RECITATION_MODULE_VERSION__;

    // Case 2: dependencies present — must log success.
    const winPresent = makeWindow(true);
    const logsPresent = captureConsole(winPresent);
    winPresent.eval(src);
    results[`${label}_presentCase_successLogged`] = logsPresent.log.some((l) => l.includes('All exports verified'));
    results[`${label}_presentCase_noErrorLogged`] = logsPresent.error.length === 0;
    results[`${label}_presentCase_versionSet`] = winPresent.__RECITATION_MODULE_VERSION__;
  }

  console.log(JSON.stringify(results, null, 2));

  assert.strictEqual(results.original_missingCase_errorLogged, results.bridge_missingCase_errorLogged, 'missing-deps error logging must match');
  assert.strictEqual(results.original_missingCase_versionSet, results.bridge_missingCase_versionSet, 'version stamp must match in missing-deps case');
  assert.strictEqual(results.original_presentCase_successLogged, results.bridge_presentCase_successLogged, 'present-deps success logging must match');
  assert.strictEqual(results.original_presentCase_noErrorLogged, results.bridge_presentCase_noErrorLogged, 'present-deps must not log an error');
  assert.strictEqual(results.original_presentCase_versionSet, results.bridge_presentCase_versionSet, 'version stamp must match in present-deps case');
  assert.strictEqual(results.original_missingCase_errorLogged, true, 'sanity: missing deps must actually produce an error log');
  assert.strictEqual(results.original_presentCase_successLogged, true, 'sanity: present deps must actually produce a success log');

  console.log('\nEQUIVALENCE CHECK PASSED');
}

main();
