// Phase 7 (2026-08-10, session 11) — equivalence check for the stat-bars.js
// conversion, same discipline as build/verify-dom-bridge.js.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const STARTER_HTML = `<!doctype html><html><body>
  <div class="stat-bar" id="bar1" data-tier="normal">
    <div class="stat-bar-fill"></div>
  </div>
</body></html>`;

function makeWindow() {
  return new JSDOM(STARTER_HTML, { runScripts: 'dangerously' }).window;
}

function snapshot(win) {
  const el = win.document.getElementById('bar1');
  const fill = el.querySelector('.stat-bar-fill');
  return {
    fillWidth: fill.style.width,
    dataTier: el.dataset.tier,
    hasPulseClass: el.classList.contains('stat-bar-pulse'),
  };
}

function runSequence(win) {
  const el = win.document.getElementById('bar1');
  win.renderStatBar(el, { percent: 42, tier: 'critical' });
  const afterFirst = snapshot(win);

  win.renderStatBar(el, { percent: 5, tier: 'critical', justChanged: true });
  const afterPulse = snapshot(win);

  win.renderStatBar(el, { percent: 150 }); // clamp test
  const afterClamp = snapshot(win);

  win.renderStatBar(el, { percent: -20 }); // clamp test, negative
  const afterNegClamp = snapshot(win);

  win.renderStatBar(null, { percent: 50 }); // no-op guard test — must not throw
  win.renderStatBar(el, {}); // missing state fields — must not throw

  return { afterFirst, afterPulse, afterClamp, afterNegClamp };
}

function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'shared', 'stat-bars.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'stat-bars.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.renderStatBar, 'function', 'original: window.renderStatBar should exist');
  const resultOriginal = runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.renderStatBar, 'function', 'bridge: window.renderStatBar should exist');
  const resultBridge = runSequence(winBridge);

  assert.deepStrictEqual(resultBridge, resultOriginal, 'bridge output must exactly match original output at every step');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('Both original stat-bars.js and the bundled src/stat-bars.js bridge');
  console.log('produce identical DOM state across percent/tier/justChanged/clamp/guard cases.');
  console.log(JSON.stringify(resultOriginal, null, 2));
}

main();
