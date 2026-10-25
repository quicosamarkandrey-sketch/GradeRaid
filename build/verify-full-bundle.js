// Phase 7 (2026-08-10, session 8) — real execution test for the first
// full esbuild bundle (dist/app.full-bundle.js), against the ACTUAL
// index.html <body> (not a minimal stub), compared to the legacy
// concatenation build (dist/app.legacy-concat.js) — which is text-
// identical in effect to today's 133+3 separate <script> tags, so it's
// the right baseline to diff against.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

function extractBody(html) {
  const m = /<body[^>]*>([\s\S]*)<\/body>/.exec(html);
  if (!m) throw new Error('Could not find <body> in index.html');
  // strip all <script> tags from the body — we're supplying the JS
  // ourselves via eval, not letting jsdom auto-load 133+ files
  return m[1].replace(/<script[\s\S]*?<\/script>/g, '');
}

function runBuild(label, jsSource, bodyHtml) {
  console.log(`\n=== ${label} ===`);
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, {
    runScripts: 'dangerously',
    url: 'https://example.org/', // avoid file: origin restrictions some code may check
  });
  const win = dom.window;
  const errors = [];
  win.addEventListener('error', (e) => errors.push(e.error ? e.error.message : e.message));

  let threw = null;
  try {
    win.eval(jsSource);
  } catch (err) {
    threw = err;
  }

  if (threw) {
    console.log('THREW SYNCHRONOUSLY:', threw.message);
    console.log(threw.stack);
  } else {
    console.log('Evaluated without throwing synchronously.');
  }
  if (errors.length) {
    console.log(`${errors.length} async/event error(s) captured:`, errors.slice(0, 10));
  }

  // snapshot the resulting global surface: function/object properties
  // added to window beyond a completely fresh jsdom window's own baseline
  const freshWin = new JSDOM('<!doctype html><html><body></body></html>').window;
  const baseline = new Set(Object.getOwnPropertyNames(freshWin));
  const added = Object.getOwnPropertyNames(win)
    .filter((k) => !baseline.has(k))
    .filter((k) => typeof win[k] === 'function' || (typeof win[k] === 'object' && win[k] !== null && !(k.startsWith('on'))))
    .sort();

  console.log(`Global surface added: ${added.length} function/object properties.`);
  return { win, threw, errors, added };
}

function main() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const bodyHtml = extractBody(html);
  console.log(`Extracted real <body> from index.html: ${bodyHtml.length} chars.`);

  const legacySrc = fs.readFileSync(path.join(ROOT, 'dist', 'app.legacy-concat.js'), 'utf8');
  const bundleSrc = fs.readFileSync(path.join(ROOT, 'dist', 'app.full-bundle.js'), 'utf8');

  const legacy = runBuild('LEGACY CONCAT (baseline — equivalent to today\'s real script tags)', legacySrc, bodyHtml);
  const bundle = runBuild('REAL ESBUILD BUNDLE (new, step 5.4 precursor)', bundleSrc, bodyHtml);

  console.log('\n=== COMPARISON ===');
  const legacySet = new Set(legacy.added);
  const bundleSet = new Set(bundle.added);
  const onlyInLegacy = legacy.added.filter((k) => !bundleSet.has(k));
  const onlyInBundle = bundle.added.filter((k) => !legacySet.has(k));

  console.log(`Legacy global surface: ${legacy.added.length}`);
  console.log(`Bundle global surface: ${bundle.added.length}`);
  console.log(`Present in legacy but NOT in bundle (${onlyInLegacy.length}):`, onlyInLegacy);
  console.log(`Present in bundle but NOT in legacy (${onlyInBundle.length}):`, onlyInBundle);
  fs.writeFileSync(
    path.join(ROOT, 'dist', 'full-bundle-diff.json'),
    JSON.stringify({ onlyInLegacy, onlyInBundle, legacyThrew: !!legacy.threw, bundleThrew: !!bundle.threw }, null, 2)
  );

  if (onlyInLegacy.length === 0 && onlyInBundle.length === 0 && !legacy.threw && !bundle.threw) {
    console.log('\nRESULT: IDENTICAL global surface, both evaluated without throwing.');
  } else {
    console.log('\nRESULT: DIFFERENCES FOUND — see above, needs investigation before trusting the bundle.');
  }
  process.exit(0); // force exit — jsdom windows may have pending timers (retry loops, etc.) that would otherwise hang the process indefinitely
}

main();
