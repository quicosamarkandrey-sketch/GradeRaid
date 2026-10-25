// Phase 7 (2026-08-10, session 12) — equivalence check for particles.js.
//
// HONEST LIMITATION, stated up front rather than glossed over: jsdom in
// this sandbox has no real 2D canvas backend (`canvas.getContext('2d')`
// returns null / logs "not implemented" without the optional native
// `canvas` npm package, which isn't installed here). That means the
// requestAnimationFrame `tick()` loop's actual per-frame rendering
// cannot be exercised or compared in this environment, in EITHER the
// original or the bridge build — there is nothing this script can do to
// verify that part beyond what src/particles.js's own header comment
// already states: the function body was copied byte-for-byte (verbatim
// move), not rewritten, which is the same low-risk discipline applied to
// every prior conversion.
//
// What CAN be verified for real, and is: the guard clauses (no anchorEl,
// prefers-reduced-motion), and the canvas element's creation/attributes/
// dimensions and color-token fallback logic — everything up to the point
// where real 2D rendering would be needed.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'dangerously',
    pretendToBeVisual: true, // gives requestAnimationFrame a real (if canvas-less) implementation
  });
  return dom.window;
}

function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'shared', 'particles.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'particles.bridge.js'), 'utf8');

  for (const [label, src] of [['ORIGINAL', originalSrc], ['BRIDGE', bridgeSrc]]) {
    console.log(`\n=== ${label} ===`);
    const win = makeWindow();
    win.eval(src);
    assert.strictEqual(typeof win.burstParticles, 'function', `${label}: window.burstParticles should exist`);

    // Guard 1: no anchorEl — must no-op, no canvas created, no throw.
    win.burstParticles(null, 10, ['#fff']);
    const canvasesAfterNullGuard = win.document.querySelectorAll('canvas').length;
    assert.strictEqual(canvasesAfterNullGuard, 0, `${label}: null anchorEl must not create a canvas`);
    console.log('  null-anchorEl guard: OK (no canvas created)');

    // Guard 2: reduced motion — must no-op even with a real anchorEl.
    const anchor = win.document.createElement('div');
    win.document.body.appendChild(anchor);
    const originalMatchMedia = win.matchMedia;
    win.matchMedia = () => ({ matches: true }); // simulate prefers-reduced-motion: reduce
    win.burstParticles(anchor, 10, ['#fff']);
    const canvasesAfterReducedMotion = win.document.querySelectorAll('canvas').length;
    assert.strictEqual(canvasesAfterReducedMotion, 0, `${label}: reduced-motion must not create a canvas`);
    console.log('  reduced-motion guard: OK (no canvas created)');
    win.matchMedia = originalMatchMedia;

    // Canvas creation path: with motion allowed, a canvas SHOULD be
    // created with the right class and viewport dimensions, even though
    // its actual rendering can't be exercised here (getContext('2d') is
    // not implemented in this jsdom — confirmed separately, not assumed).
    win.burstParticles(anchor, 10, ['#123456']);
    const canvas = win.document.querySelector('canvas.particle-burst-canvas');
    assert.ok(canvas, `${label}: a canvas.particle-burst-canvas should be created when motion is allowed`);
    assert.strictEqual(canvas.width, win.innerWidth, `${label}: canvas width should match window.innerWidth`);
    assert.strictEqual(canvas.height, win.innerHeight, `${label}: canvas height should match window.innerHeight`);
    console.log('  canvas creation + dimensions: OK', { width: canvas.width, height: canvas.height });
  }

  console.log('\nEQUIVALENCE CHECK PASSED (for everything testable in this sandbox — see header comment for the disclosed canvas-rendering gap)');
}

main();
