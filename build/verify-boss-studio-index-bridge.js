// Phase 7 (2026-08-10, session 17) — equivalence check for
// boss-studio-index.js. Three distinct behaviors tested: CSS injection
// idempotency, DOM scaffold injection idempotency (both guarded by
// `if (document.getElementById(...)) return;`), and the verification
// logic's THIRD distinct check variant this session has now covered
// (accepts function OR object — `!== 'function' && !== 'object'`,
// different from both admin/recitation/attendance's function-only check
// and world-boss's undefined-only check).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'dangerously' });
  return dom.window;
}

function captureConsole(win) {
  const logs = { error: [], log: [] };
  win.console.error = (...args) => logs.error.push(args.join(' '));
  win.console.log = (...args) => logs.log.push(args.join(' '));
  return logs;
}

function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'boss-studio', 'bs_index.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'boss-studio-index.bridge.js'), 'utf8');

  for (const [label, src] of [['ORIGINAL', originalSrc], ['BRIDGE', bridgeSrc]]) {
    console.log(`\n=== ${label} ===`);
    const win = makeWindow();
    const logs = captureConsole(win);
    win.eval(src);

    const cssEls = win.document.querySelectorAll('#boss-studio-module-css');
    const overlayEls = win.document.querySelectorAll('#bs-editor-overlay');
    assert.strictEqual(cssEls.length, 1, `${label}: CSS style tag must be injected exactly once`);
    assert.strictEqual(overlayEls.length, 1, `${label}: editor overlay scaffold must be injected exactly once`);
    assert.ok(cssEls[0].textContent.includes('.bs-hero'), `${label}: injected CSS must contain real content`);
    assert.ok(overlayEls[0].innerHTML.includes('bsSaveForm'), `${label}: injected overlay must contain the real save-button wiring`);
    console.log('  CSS + overlay scaffold injected exactly once, with real content: OK');

    win.eval(src);
    const cssElsAfterSecondEval = win.document.querySelectorAll('#boss-studio-module-css');
    const overlayElsAfterSecondEval = win.document.querySelectorAll('#bs-editor-overlay');
    assert.strictEqual(cssElsAfterSecondEval.length, 1, `${label}: re-evaluating must NOT duplicate the CSS tag (idempotency guard)`);
    assert.strictEqual(overlayElsAfterSecondEval.length, 1, `${label}: re-evaluating must NOT duplicate the overlay scaffold (idempotency guard)`);
    console.log('  idempotency guards hold across re-evaluation: OK');

    for (const mode of ['function', 'object', 'neither']) {
      const winV = makeWindow();
      const logsV = captureConsole(winV);
      if (mode !== 'neither') {
        const listMatch = originalSrc.match(/const EXPECTED = \[([\s\S]*?)\];/);
        const names = listMatch[1].match(/'[^']+'/g).map((s) => s.slice(1, -1));
        names.forEach((name) => {
          winV[name] = mode === 'function' ? () => {} : { notAFunctionButAnObject: true };
        });
      }
      winV.eval(src);
      const errored = logsV.error.length > 0;
      console.log(`  verification, mode="${mode}": errorLogged=${errored}`);
      if (mode === 'neither') assert.strictEqual(errored, true, `${label}/${mode}: nothing present must error`);
      else assert.strictEqual(errored, false, `${label}/${mode}: ${mode} values must satisfy the function-OR-object check`);
    }
  }

  console.log('\nEQUIVALENCE CHECK PASSED');
}

main();
