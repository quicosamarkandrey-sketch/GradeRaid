// Phase 7 (2026-08-10, session 12) — equivalence check for sequence.js.
// Unlike dom.js/stat-bars.js, runSequence is inherently async (setTimeout-
// driven) and returns a cancel handle — both need real exercising, not
// just a synchronous snapshot.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow() {
  return new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously' }).window;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runFullSequence(win) {
  const order = [];
  win.runSequence([
    { delay: 0, run: () => order.push('a') },
    { delay: 10, run: () => order.push('b') },
    { delay: 10, run: () => order.push('c') },
  ]);
  await wait(60);
  return order;
}

async function runCancelledSequence(win) {
  const order = [];
  const cancel = win.runSequence([
    { delay: 0, run: () => order.push('x') },
    { delay: 20, run: () => order.push('y') },
    { delay: 40, run: () => order.push('z') },
  ]);
  await wait(5);
  cancel(); // cancel before y/z fire
  await wait(60);
  return order;
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'shared', 'sequence.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'sequence.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.runSequence, 'function');
  const fullOriginal = await runFullSequence(winOriginal);
  const winOriginal2 = makeWindow();
  winOriginal2.eval(originalSrc);
  const cancelOriginal = await runCancelledSequence(winOriginal2);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.runSequence, 'function');
  const fullBridge = await runFullSequence(winBridge);
  const winBridge2 = makeWindow();
  winBridge2.eval(bridgeSrc);
  const cancelBridge = await runCancelledSequence(winBridge2);

  assert.deepStrictEqual(fullBridge, fullOriginal, 'full sequence execution order must match');
  assert.deepStrictEqual(fullOriginal, ['a', 'b', 'c'], 'sanity: full sequence should run all 3 steps in order');
  assert.deepStrictEqual(cancelBridge, cancelOriginal, 'cancelled sequence behavior must match');
  assert.deepStrictEqual(cancelOriginal, ['x'], 'sanity: cancel() should stop y/z from ever running');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('Full sequence order (both builds):', fullOriginal);
  console.log('Cancelled sequence order (both builds):', cancelOriginal);
}

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
