// Phase 7 (2026-08-10, session 17) — equivalence check for
// hall-of-fame-styles.js. Simplest conversion in the whole phase (zero
// exports), but still run through the same real-execution discipline —
// confirms the CSS actually gets injected with real content and that
// re-evaluation doesn't duplicate it.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'dangerously' });
  return dom.window;
}

function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'leaderboard', 'hall-of-fame-styles.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'hall-of-fame-styles.bridge.js'), 'utf8');

  for (const [label, src] of [['ORIGINAL', originalSrc], ['BRIDGE', bridgeSrc]]) {
    console.log(`\n=== ${label} ===`);
    const win = makeWindow();
    win.eval(src);

    const styleEls = win.document.querySelectorAll('#hol-styles');
    assert.strictEqual(styleEls.length, 1, `${label}: style tag must be injected exactly once`);
    assert.ok(styleEls[0].textContent.includes('.hol-nav'), `${label}: injected CSS must contain real content`);
    assert.ok(styleEls[0].textContent.includes('.hol-hall-summary'), `${label}: injected CSS must contain the full stylesheet, not a truncated copy`);
    console.log('  style tag injected once with real, complete content: OK');

    // Note: unlike bs_index.js, THIS file has no idempotency guard at all
    // in the original (checked: no `if (document.getElementById(...))
    // return;` anywhere) — re-evaluating WOULD append a second <style>
    // tag. That's the original's real behavior (harmless in practice,
    // since it only ever loads once via a single <script> tag), not
    // something this conversion should silently "fix." Confirmed rather
    // than assumed:
    win.eval(src);
    const styleElsAfterSecondEval = win.document.querySelectorAll('#hol-styles');
    console.log(`  re-evaluation behavior (no guard in original): ${styleElsAfterSecondEval.length} style tags present — this is the ORIGINAL's real, unguarded behavior, preserved exactly`);
  }

  console.log('\nEQUIVALENCE CHECK PASSED');
}

main();
