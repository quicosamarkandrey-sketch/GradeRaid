// Phase 7 (2026-08-10, session 15) — equivalence check for the
// index.html#inline0 -> src/config.js conversion. Simplest check in the
// series so far — pure config, no functions, no DOM — but still run
// through the same real-execution discipline as every other conversion
// rather than assumed safe because it "looks trivial."
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'build', 'inline', 'inline0.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'config.bridge.js'), 'utf8');

  const winOriginal = new JSDOM('<!doctype html></html>', { runScripts: 'dangerously' }).window;
  winOriginal.eval(originalSrc);

  const winBridge = new JSDOM('<!doctype html></html>', { runScripts: 'dangerously' }).window;
  winBridge.eval(bridgeSrc);

  assert.strictEqual(winBridge.__EDUQUEST_SUPABASE_URL__, winOriginal.__EDUQUEST_SUPABASE_URL__, 'SUPABASE_URL must match exactly');
  assert.strictEqual(winBridge.__EDUQUEST_SUPABASE_ANON_KEY__, winOriginal.__EDUQUEST_SUPABASE_ANON_KEY__, 'SUPABASE_ANON_KEY must match exactly');
  assert.strictEqual(winOriginal.__EDUQUEST_SUPABASE_URL__, 'https://ptxzsllndtacrnpaoxvq.supabase.co', 'sanity: URL value itself must be correct, not just self-consistent');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('URL:', winOriginal.__EDUQUEST_SUPABASE_URL__);
  console.log('ANON_KEY:', winOriginal.__EDUQUEST_SUPABASE_ANON_KEY__);
}

main();
