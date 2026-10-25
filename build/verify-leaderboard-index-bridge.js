// Phase 7 (2026-08-10, session 16) — equivalence check for
// leaderboard-index.js. Exercises the missing/present verification
// branches (same discipline as recitation-index.js/attendance-index.js)
// PLUS the window.Leaderboard alias logic specifically, including its
// "don't override if already set" guard — a real behavior, not assumed
// to carry over correctly just because the rest of the file matches.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const ALL_REQUIRED = [
  'eqlComputeRecitation', 'eqlComputeBoss', 'eqlComputeAcademic',
  'eqlComputeOverall', 'eqlBuildCategory', 'renderLeaderboard',
  'renderAdminLeaderboards', 'eqlToggle', 'eqlAdminPreview',
  'eqlAdminResetConfirm', 'eqlDoReset', 'eqlDoClearReset',
];

function makeWindow(withDeps, eqlValue, preSetLeaderboard) {
  const dom = new JSDOM('<!doctype html></html>', { runScripts: 'dangerously' });
  const win = dom.window;
  if (withDeps) {
    win.EQL = eqlValue !== undefined ? eqlValue : { getLeaderboard: () => [] };
    ALL_REQUIRED.forEach((name) => { win[name] = () => {}; });
  }
  if (preSetLeaderboard !== undefined) win.Leaderboard = preSetLeaderboard;
  return win;
}

function captureConsole(win) {
  const logs = { error: [], log: [] };
  win.console.error = (...args) => logs.error.push(args.join(' '));
  win.console.log = (...args) => logs.log.push(args.join(' '));
  return logs;
}

function run(src, withDeps, eqlValue, preSetLeaderboard) {
  const win = makeWindow(withDeps, eqlValue, preSetLeaderboard);
  const logs = captureConsole(win);
  win.eval(src);
  return {
    errorLogged: logs.error.length > 0,
    successLogged: logs.log.some((l) => l.includes('fully loaded')),
    versionSet: win.__EQL_MODULE_VERSION__,
    leaderboardIsEQL: withDeps ? win.Leaderboard === win.EQL : undefined,
    // NOT the raw object — cross-realm objects fail deepStrictEqual even
    // with identical content (different Object.prototype per jsdom vm
    // context, same gotcha hit and fixed in sessions 13). The
    // leaderboardIsEQL boolean above already proves reference identity;
    // this just needs a realm-safe presence check.
    leaderboardValueIsObject: typeof win.Leaderboard === 'object' && win.Leaderboard !== null,
  };
}

function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'leaderboard', 'index.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'leaderboard-index.bridge.js'), 'utf8');

  // Case 1: deps missing.
  const originalMissing = run(originalSrc, false);
  const bridgeMissing = run(bridgeSrc, false);
  assert.deepStrictEqual(bridgeMissing, originalMissing, 'missing-deps case must match');
  console.log('missing-deps case:', originalMissing);

  // Case 2: deps present, window.Leaderboard NOT pre-set -> should become window.EQL.
  const originalPresent = run(originalSrc, true);
  const bridgePresent = run(bridgeSrc, true);
  assert.deepStrictEqual(bridgePresent, originalPresent, 'present-deps case must match');
  assert.strictEqual(originalPresent.leaderboardIsEQL, true, 'sanity: Leaderboard alias must point at EQL when not pre-set');
  console.log('present-deps, no pre-set Leaderboard:', originalPresent);

  // Case 3: deps present, window.Leaderboard ALREADY set to something else
  // -> guard must preserve the existing value, not overwrite it.
  const sentinel = 'PRE_EXISTING_VALUE';
  const winOriginal3 = makeWindow(true, undefined, sentinel);
  const logs3o = captureConsole(winOriginal3);
  winOriginal3.eval(originalSrc);
  const winBridge3 = makeWindow(true, undefined, sentinel);
  const logs3b = captureConsole(winBridge3);
  winBridge3.eval(bridgeSrc);
  assert.strictEqual(winOriginal3.Leaderboard, sentinel, 'sanity: original must NOT overwrite a pre-set window.Leaderboard');
  assert.strictEqual(winBridge3.Leaderboard, sentinel, 'bridge must NOT overwrite a pre-set window.Leaderboard either');
  console.log('present-deps, pre-set Leaderboard guard: OK (preserved)', winOriginal3.Leaderboard);

  console.log('\nEQUIVALENCE CHECK PASSED');
}

main();
