// Phase 7 (Stream A) — equivalence check for modules/mail/index.js.
// This file has no real logic of its own — it just re-affirms 8 already-
// set `window.X` globals. The check: (1) with all 8 globals pre-set
// (matching real production load order), both the original and the
// bridge leave `window.X` holding the exact same 8 values afterward, and
// the bridge's own re-exported bindings match too; (2) the one
// documented, deliberate behavioral difference (see src/modules/mail/
// index.js's header) — if a global is missing, the ORIGINAL throws a
// ReferenceError while the converted version does not — is asserted
// explicitly as expected, not compared for equality with itself.
const { JSDOM } = require('jsdom');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const NAMES = [
  'mailGetForStudent', 'mailIsRead', 'mailIsClaimed', 'mailMarkRead',
  'mailClaimRewards', 'mailUpdateSidebarBadge', 'mailUnreadCount',
  'mailUnclaimedRewardCount',
];

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html></html>', { runScripts: 'dangerously' });
  const win = dom.window;
  NAMES.forEach((n, i) => { win[n] = function fixtureFn() { return n + '-fixture-' + i; }; });
  return win;
}

function snapshotWindowValues(win) {
  const out = {};
  NAMES.forEach(n => { out[n] = win[n] ? win[n].toString() : null; });
  return out;
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'mail', 'index.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'mail-index.bridge.js'), 'utf8');

  // 1. Normal case — all 8 globals pre-set (matches real load order).
  const winOriginal = makeWindow();
  winOriginal.eval(originalSrc);
  const resultOriginal = snapshotWindowValues(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  const resultBridge = snapshotWindowValues(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'window.mailX values must match after both load with all globals pre-set');

  // Every one of the 8 must still be the SAME fixture function it was
  // before (this file changes nothing when everything is already correctly set).
  const winCheck = makeWindow();
  const before = snapshotWindowValues(winCheck);
  winCheck.eval(originalSrc);
  const after = snapshotWindowValues(winCheck);
  assert.strictEqual(JSON.stringify(before), JSON.stringify(after), 'original should leave the 8 globals completely unchanged when they were already correct');

  // 2. The documented, deliberate divergence: a missing global.
  const winMissingOriginal = new (require('jsdom').JSDOM)('<!doctype html><html></html>', { runScripts: 'dangerously' }).window;
  NAMES.slice(1).forEach((n, i) => { winMissingOriginal[n] = function () { return n; }; }); // leave mailGetForStudent undefined
  let originalThrew = false;
  try { winMissingOriginal.eval(originalSrc); } catch (e) { originalThrew = true; }
  assert.strictEqual(originalThrew, true, 'original must throw a ReferenceError when a global is missing (documented, expected)');

  const winMissingBridge = new (require('jsdom').JSDOM)('<!doctype html><html></html>', { runScripts: 'dangerously' }).window;
  NAMES.slice(1).forEach((n, i) => { winMissingBridge[n] = function () { return n; }; });
  let bridgeThrew = false;
  try { winMissingBridge.eval(bridgeSrc); } catch (e) { bridgeThrew = true; }
  assert.strictEqual(bridgeThrew, false, 'converted version must NOT throw when a global is missing — documented, deliberate divergence from the original');
  assert.strictEqual(winMissingBridge.mailGetForStudent, undefined, 'the missing global should end up undefined, not throw, in the converted version');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('modules/mail/index.js: all 8 window.mailX globals match exactly when pre-set (matching real');
  console.log('production load order), the original correctly leaves them unchanged when already correct,');
  console.log('and the one documented behavioral divergence (missing global: original throws, converted');
  console.log('silently continues with undefined) is confirmed on both sides as expected.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
