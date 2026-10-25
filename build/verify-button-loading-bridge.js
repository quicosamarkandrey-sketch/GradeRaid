// Phase 7 (2026-08-10, session 12) — equivalence check for button-loading.js.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow() {
  return new JSDOM('<!doctype html><html><head></head><body><button id="btn">Enter Quest →</button></body></html>', {
    runScripts: 'dangerously',
  }).window;
}

function snapshotBtn(win) {
  const btn = win.document.getElementById('btn');
  return {
    innerHTML: btn.innerHTML,
    disabled: btn.disabled,
    hasLoadingClass: btn.classList.contains('eq-btn-loading'),
    minWidth: btn.style.minWidth,
    eqLoading: btn.dataset.eqLoading || null,
  };
}

async function runSequence(win) {
  const btn = win.document.getElementById('btn');
  const results = {};

  results.styleInjected = !!win.document.getElementById('eq-btn-loading-styles');

  // basic on/off toggle
  win.eqButtonLoading(btn, true, { label: 'Signing in…' });
  results.afterOn = snapshotBtn(win);

  win.eqButtonLoading(btn, false);
  results.afterOff = snapshotBtn(win);

  // double-on guard: second "true" call while already loading must not
  // clobber the saved original HTML
  btn.innerHTML = 'Original Label';
  win.eqButtonLoading(btn, true, { label: 'First…' });
  win.eqButtonLoading(btn, true, { label: 'Second…' }); // should be a no-op
  results.afterDoubleOn = snapshotBtn(win);
  win.eqButtonLoading(btn, false);
  results.afterRestoreFromDoubleOn = snapshotBtn(win);

  // off when never on: no-op, must not throw
  win.eqButtonLoading(btn, false);
  results.afterOffWhenNeverOn = snapshotBtn(win);

  // null btn: no-op, must not throw
  win.eqButtonLoading(null, true);
  results.nullBtnDidNotThrow = true;

  // eqWithButtonLoading — success path restores after
  btn.innerHTML = 'Claim';
  await win.eqWithButtonLoading(btn, 'Claiming…', async () => 'success-value');
  results.afterWithLoadingSuccess = snapshotBtn(win);

  // eqWithButtonLoading — error path still restores (finally), and
  // re-throws the original error
  btn.innerHTML = 'Claim';
  let caught = null;
  try {
    await win.eqWithButtonLoading(btn, 'Claiming…', async () => {
      throw new Error('boom');
    });
  } catch (e) {
    caught = e.message;
  }
  results.errorPropagated = caught;
  results.afterWithLoadingError = snapshotBtn(win);

  return results;
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'shared', 'button-loading.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'button-loading.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(originalSrc);
  const resultOriginal = await runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  const resultBridge = await runSequence(winBridge);

  assert.deepStrictEqual(resultBridge, resultOriginal, 'bridge output must exactly match original at every step');
  assert.strictEqual(resultOriginal.errorPropagated, 'boom', 'sanity: error must propagate through eqWithButtonLoading');
  assert.strictEqual(resultOriginal.afterWithLoadingError.eqLoading, null, 'sanity: button must be restored even after fn() throws');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log(JSON.stringify(resultOriginal, null, 2));
}

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
