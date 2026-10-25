// Phase 7 (2026-08-10, session 6) — equivalence check for the dom.js
// conversion. Loads the ORIGINAL classic dom.js into one jsdom window, and
// the BUNDLED BRIDGE (dist/bridges/dom.bridge.js, built from src/dom.js)
// into a separate jsdom window with identical starter DOM, then drives
// each through the same sequence of calls and diffs the resulting DOM
// state. This is a real behavioral check, not a syntax/import check —
// confirms the conversion doesn't just "parse," it produces identical
// output.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const STARTER_HTML = `<!doctype html><html><body>
  <div id="toast"></div>
  <div id="modal-box" class="modal-box"></div>
  <div id="modal-content"></div>
  <div id="modal-overlay" style="display:none"></div>
</body></html>`;

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously' });
  return dom.window;
}

function snapshotRelevantDOM(win) {
  const doc = win.document;
  return {
    toastHTML: doc.getElementById('toast').innerHTML,
    toastDisplay: doc.getElementById('toast').style.display,
    toastBorderColor: doc.getElementById('toast').style.borderColor,
    modalBoxClass: doc.getElementById('modal-box').className,
    modalContentHTML: doc.getElementById('modal-content').innerHTML,
    modalOverlayDisplay: doc.getElementById('modal-overlay').style.display,
  };
}

function runSequence(win) {
  // Exercise every exported function with the same inputs, in the same order.
  win.toast('Hello <b>world</b>', '#ff0000');
  const afterToast = snapshotRelevantDOM(win);

  win.showModal('<p>Modal body</p>', 'lg');
  const afterShowModal = snapshotRelevantDOM(win);

  // closeModal with no event arg (the "always close" branch)
  win.closeModal();
  const afterCloseModal = snapshotRelevantDOM(win);

  // re-open, then closeModalForce
  win.showModal('<p>Again</p>', 'md');
  win.closeModalForce();
  const afterCloseModalForce = snapshotRelevantDOM(win);

  return { afterToast, afterShowModal, afterCloseModal, afterCloseModalForce };
}

function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'dom.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'dom.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.toast, 'function', 'original: window.toast should exist');
  assert.strictEqual(typeof winOriginal.showModal, 'function', 'original: window.showModal should exist');
  assert.strictEqual(typeof winOriginal.closeModal, 'function', 'original: window.closeModal should exist');
  assert.strictEqual(typeof winOriginal.closeModalForce, 'function', 'original: window.closeModalForce should exist');
  const resultOriginal = runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.toast, 'function', 'bridge: window.toast should exist');
  assert.strictEqual(typeof winBridge.showModal, 'function', 'bridge: window.showModal should exist');
  assert.strictEqual(typeof winBridge.closeModal, 'function', 'bridge: window.closeModal should exist');
  assert.strictEqual(typeof winBridge.closeModalForce, 'function', 'bridge: window.closeModalForce should exist');
  const resultBridge = runSequence(winBridge);

  assert.deepStrictEqual(resultBridge, resultOriginal, 'bridge output must exactly match original output at every step');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('Both original dom.js and the bundled src/dom.js bridge produce');
  console.log('identical DOM state through toast() / showModal() / closeModal() / closeModalForce().');
  console.log(JSON.stringify(resultOriginal, null, 2));
}

main();
