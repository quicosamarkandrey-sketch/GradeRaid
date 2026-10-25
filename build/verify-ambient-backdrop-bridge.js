// Phase 7 (2026-08-10, session 14) — equivalence check for
// ambient-backdrop.js. Same disclosed limitation as
// build/verify-particles-bridge.js: jsdom has no real 2D canvas backend
// in this sandbox. Here `tick()` runs SYNCHRONOUSLY on the first call, so
// only the two guard-clause early-return paths are exercisable — that's
// stated up front, not discovered mid-script.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow() {
  return new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously' }).window;
}

function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'shared', 'ambient-backdrop.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'ambient-backdrop.bridge.js'), 'utf8');

  for (const [label, src] of [['ORIGINAL', originalSrc], ['BRIDGE', bridgeSrc]]) {
    console.log(`\n=== ${label} ===`);
    const win = makeWindow();
    win.eval(src);
    assert.strictEqual(typeof win.startAmbientBackdrop, 'function', `${label}: window.startAmbientBackdrop should exist`);

    // Guard 1: null canvas — must return a no-op stop function, no throw.
    const stop1 = win.startAmbientBackdrop(null);
    assert.strictEqual(typeof stop1, 'function', `${label}: null canvas must still return a callable stop function`);
    stop1(); // calling the no-op stop must not throw either
    console.log('  null-canvas guard: OK (no-op stop function returned and callable)');

    // Guard 2: reduced motion — must return a no-op stop function even
    // with a real canvas element, before any canvas/rendering code runs.
    const canvas = win.document.createElement('canvas');
    win.document.body.appendChild(canvas);
    const originalMatchMedia = win.matchMedia;
    win.matchMedia = () => ({ matches: true });
    const stop2 = win.startAmbientBackdrop(canvas);
    assert.strictEqual(typeof stop2, 'function', `${label}: reduced-motion must still return a callable stop function`);
    stop2();
    console.log('  reduced-motion guard: OK (no-op stop function returned and callable)');
    win.matchMedia = originalMatchMedia;
  }

  console.log('\nEQUIVALENCE CHECK PASSED (for everything testable in this sandbox — canvas rendering itself not exercisable here, see header comment)');
}

main();
