// Phase 7 (2026-08-10, session 18) — equivalence check for utils.js.
// The one thing worth verifying specifically here that no prior check
// needed: csvDownload()'s internal call to toast() must actually fire
// and produce the right DOM side effect, confirming the real cross-
// module import (utils.js -> dom.js) works end to end, not just that
// esbuild bundled it without erroring.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow() {
  const win = new JSDOM('<!doctype html><html><body><div id="toast"></div></body></html>', {
    runScripts: 'dangerously',
    url: 'https://example.org/',
  }).window;
  // jsdom doesn't implement URL.createObjectURL/revokeObjectURL (Blob
  // itself IS supported — confirmed separately, only these two are
  // missing). Minimal standard stub, test-harness-only, not touching
  // source — same disclosed-gap discipline as sessions 12/14's canvas
  // limitation, just narrow enough here to actually work around cleanly
  // rather than only being able to test guard clauses.
  win.URL.createObjectURL = () => 'blob:mock-url';
  win.URL.revokeObjectURL = () => {};
  return win;
}

function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'utils.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'utils.bridge.js'), 'utf8');

  for (const [label, src] of [['ORIGINAL', originalSrc], ['BRIDGE', bridgeSrc]]) {
    console.log(`\n=== ${label} ===`);
    const win = makeWindow();

    if (label === 'ORIGINAL') {
      win.eval(`function toast(msg){ document.getElementById('toast').innerHTML = msg; }`);
    }
    win.eval(src);

    const id1 = win.uid();
    const id2 = win.uid();
    assert.ok(/^id_[a-z0-9]+$/.test(id1), `${label}: uid() must match the expected id_XXXXXXXXX format`);
    assert.notStrictEqual(id1, id2, `${label}: uid() must produce different values across calls`);
    console.log('  uid() format + uniqueness: OK');

    assert.strictEqual(win._esc(`<script>alert("x")</script>`), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;', `${label}: _esc must escape all 4 special chars`);
    assert.strictEqual(win._esc(null), '', `${label}: _esc(null) must return empty string, not throw`);
    console.log('  _esc(): OK');

    assert.strictEqual(win._cssColor('#ff0000'), '#ff0000', `${label}: valid 6-digit hex must pass through`);
    assert.strictEqual(win._cssColor('#f00'), '#f00', `${label}: valid 3-digit hex must pass through`);
    assert.strictEqual(win._cssColor('var(--primary)'), 'var(--primary)', `${label}: valid CSS var reference must pass through`);
    assert.strictEqual(win._cssColor('javascript:alert(1)'), '#8b5cf6', `${label}: an attribute-breakout attempt must fall back to the default`);
    assert.strictEqual(win._cssColor('#ff0000', '#000000'), '#ff0000', `${label}: valid color must win even with a custom fallback given`);
    assert.strictEqual(win._cssColor('not-a-color', '#000000'), '#000000', `${label}: invalid color must use the CUSTOM fallback when given`);
    console.log('  _cssColor(): OK — including the attribute-breakout-hazard fallback case');

    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(win.isoDate()), `${label}: isoDate() must match YYYY-MM-DD`);
    assert.ok(win.todayStr().length > 0, `${label}: todayStr() must return non-empty`);
    assert.ok(win.nowStr().length > 0, `${label}: nowStr() must return non-empty`);
    console.log('  todayStr/nowStr/isoDate format checks: OK');

    win.csvDownload('report.csv', [['Name', 'Score'], ['Ana, B', '95'], ['Bo "Q"', '88']]);
    const toastEl = win.document.getElementById('toast');
    assert.ok(toastEl.innerHTML.includes('report.csv'), `${label}: csvDownload's internal toast() call must fire with the filename`);
    assert.ok(toastEl.innerHTML.includes('downloaded'), `${label}: toast message content must match`);
    console.log('  csvDownload() internal toast() side effect fired correctly: OK —', toastEl.innerHTML);
  }

  console.log('\nEQUIVALENCE CHECK PASSED');
}

main();
