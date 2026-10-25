// Phase 7 (2026-08-10, session 14) — equivalence check for
// active-section.js. Real browsers fire the 'storage' event in OTHER
// tabs automatically when localStorage changes in one; jsdom doesn't
// simulate that across separate JSDOM instances (that's a browser-level
// mechanism, not something jsdom replicates). So the cross-tab handler
// logic itself is tested directly here — manually dispatching a
// StorageEvent on the window and confirming the module's own registered
// listener correctly fires — which exercises the actual code path
// (`window.addEventListener('storage', ...)`) without needing real
// cross-tab magic neither build could provide anyway.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow(url) {
  const dom = new JSDOM('<!doctype html></html>', {
    runScripts: 'dangerously',
    url: url || 'https://example.org/',
  });
  return dom.window;
}

function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'core', 'active-section.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'active-section.bridge.js'), 'utf8');

  for (const [label, src] of [['ORIGINAL', originalSrc], ['BRIDGE', bridgeSrc]]) {
    console.log(`\n=== ${label} ===`);
    const win = makeWindow();
    win.eval(src);
    assert.strictEqual(typeof win.ActiveSection, 'object', `${label}: window.ActiveSection should exist`);

    // Initial state: no localStorage entry yet.
    assert.strictEqual(win.ActiveSection.get(), null, `${label}: get() with nothing set must return null`);
    console.log('  initial get() === null: OK');

    // set() + onChange listener firing.
    const changes = [];
    win.ActiveSection.onChange((newVal) => changes.push(newVal));
    win.ActiveSection.set('sec_alpha');
    assert.strictEqual(win.ActiveSection.get(), 'sec_alpha', `${label}: get() after set() must return the set value`);
    assert.deepStrictEqual(changes, ['sec_alpha'], `${label}: onChange listener must fire once with the new value`);
    console.log('  set() + onChange firing: OK', changes);

    // set() to the SAME value must NOT re-fire listeners (prev === classId guard).
    win.ActiveSection.set('sec_alpha');
    assert.deepStrictEqual(changes, ['sec_alpha'], `${label}: setting the same value again must not re-fire onChange`);
    console.log('  same-value set() does not re-fire: OK');

    // set(null/falsy) must no-op entirely.
    win.ActiveSection.set(null);
    assert.strictEqual(win.ActiveSection.get(), 'sec_alpha', `${label}: set(null) must be a no-op`);
    console.log('  set(null) no-op: OK');

    // Simulated cross-tab storage event — manually dispatch what a real
    // browser would fire in another tab, confirm the module's own
    // listener registration correctly reacts to it.
    const event = new win.StorageEvent('storage', { key: 'eduquest_active_section', newValue: 'sec_from_other_tab' });
    win.dispatchEvent(event);
    assert.deepStrictEqual(changes, ['sec_alpha', 'sec_from_other_tab'], `${label}: a real 'storage' event for the right key must fire onChange listeners`);
    console.log('  simulated cross-tab storage event: OK', changes);

    // storage event for a DIFFERENT key must be ignored.
    const irrelevantEvent = new win.StorageEvent('storage', { key: 'some_other_app_key', newValue: 'should-be-ignored' });
    win.dispatchEvent(irrelevantEvent);
    assert.deepStrictEqual(changes, ['sec_alpha', 'sec_from_other_tab'], `${label}: storage event for an unrelated key must be ignored`);
    console.log('  unrelated-key storage event ignored: OK');
  }

  // initFromURL — separate windows (fresh localStorage) with a query param.
  for (const [label, src] of [['ORIGINAL', originalSrc], ['BRIDGE', bridgeSrc]]) {
    const win = makeWindow('https://example.org/kiosk?section=sec_from_url');
    win.eval(src);
    const result = win.ActiveSection.initFromURL('section');
    assert.strictEqual(result, 'sec_from_url', `${label}: initFromURL must pick up the query param on first call`);
    assert.strictEqual(win.ActiveSection.get(), 'sec_from_url', `${label}: initFromURL must persist the value via set()`);

    // second call: get() already has a value, so the URL param must NOT override it
    const win2 = makeWindow('https://example.org/kiosk?section=sec_from_url');
    win2.eval(src);
    win2.ActiveSection.set('sec_already_chosen');
    const result2 = win2.ActiveSection.initFromURL('section');
    assert.strictEqual(result2, 'sec_already_chosen', `${label}: initFromURL must NOT override an already-set section`);
    console.log(`${label}: initFromURL first-call and already-set cases: OK`);
  }

  console.log('\nEQUIVALENCE CHECK PASSED');
}

main();
