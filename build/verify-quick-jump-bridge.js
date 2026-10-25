// Phase 7 (2026-08-10, session 14) — equivalence check for quick-jump.js.
// Fully testable in jsdom — no canvas, no localStorage, just DOM events.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const OVERLAY_HTML = `
  <div id="quick-jump-overlay">
    <input type="text">
    <ul class="quick-jump-results"></ul>
  </div>
`;

const ITEMS = [
  { label: 'Student Dashboard', action: () => {} },
  { label: 'Quiz Arena', action: () => {} },
  { label: 'World Boss', action: () => {} },
  { label: 'Shop', action: () => {} },
];

function makeWindow(withOverlay) {
  const dom = new JSDOM(`<!doctype html><html><body>${withOverlay ? OVERLAY_HTML : ''}</body></html>`, {
    runScripts: 'dangerously',
  });
  return dom.window;
}

function dispatchKeydown(win, target, opts) {
  const evt = new win.KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, opts));
  target.dispatchEvent(evt);
  return evt;
}

function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'shared', 'quick-jump.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'quick-jump.bridge.js'), 'utf8');

  for (const [label, src] of [['ORIGINAL', originalSrc], ['BRIDGE', bridgeSrc]]) {
    console.log(`\n=== ${label} ===`);

    // No-op guard: overlay missing from DOM must not throw.
    const winNoOverlay = makeWindow(false);
    winNoOverlay.eval(src);
    winNoOverlay.initQuickJump(ITEMS); // must not throw
    console.log('  missing-overlay no-op guard: OK (did not throw)');

    // Real interactive behavior.
    const win = makeWindow(true);
    win.eval(src);
    win.initQuickJump(ITEMS);
    const overlay = win.document.getElementById('quick-jump-overlay');
    const input = overlay.querySelector('input');
    const list = overlay.querySelector('.quick-jump-results');

    // Ctrl+K opens the overlay, focuses input, and renders all items (up to 8).
    dispatchKeydown(win, win.document, { key: 'k', ctrlKey: true });
    assert.strictEqual(overlay.classList.contains('open'), true, `${label}: Ctrl+K must open the overlay`);
    assert.strictEqual(list.querySelectorAll('li').length, ITEMS.length, `${label}: all items should render (under the 8-item cap)`);
    console.log('  Ctrl+K opens overlay + renders items: OK');

    // Filtering via input.
    input.value = 'quiz';
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    const filteredLabels = [...list.querySelectorAll('li')].map((li) => li.textContent);
    assert.deepStrictEqual(filteredLabels, ['Quiz Arena'], `${label}: filtering by "quiz" must show only the matching item`);
    console.log('  filtering: OK', filteredLabels);

    // Escape closes the overlay.
    dispatchKeydown(win, win.document, { key: 'Escape' });
    assert.strictEqual(overlay.classList.contains('open'), false, `${label}: Escape must close the overlay`);
    console.log('  Escape closes overlay: OK');

    // Click delegation on a result triggers its action and closes the overlay.
    dispatchKeydown(win, win.document, { key: 'k', ctrlKey: true }); // reopen, resets filter to all items
    let actionFired = false;
    ITEMS[1].action = () => { actionFired = true; }; // "Quiz Arena"
    const secondLi = list.querySelectorAll('li')[1];
    secondLi.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(actionFired, true, `${label}: clicking a result must invoke its action`);
    assert.strictEqual(overlay.classList.contains('open'), false, `${label}: clicking a result must close the overlay`);
    console.log('  click delegation invokes action + closes overlay: OK');
  }

  console.log('\nEQUIVALENCE CHECK PASSED');
}

main();
