// Phase 7 (2026-08-10, session 13) — equivalence check for
// supabase-client.js. Exercises three real behaviors, not just structural
// shape: (1) the no-config/no-CDN fallback path, (2) the configured path
// with a stubbed window.supabase.createClient (no real network needed),
// and (3) the lazy-singleton caching — getClient() called twice with a
// real config must return the SAME object reference both times, not
// construct a new client on every call.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow(withConfig) {
  const dom = new JSDOM('<!doctype html><html></html>', { runScripts: 'dangerously' });
  const win = dom.window;
  if (withConfig) {
    win.__EDUQUEST_SUPABASE_URL__ = 'https://example.supabase.co';
    win.__EDUQUEST_SUPABASE_ANON_KEY__ = 'fake-anon-key';
    let createClientCallCount = 0;
    win.supabase = {
      createClient: (url, key, opts) => {
        createClientCallCount++;
        return { __fakeClient: true, url, key, opts, callNumber: createClientCallCount };
      },
    };
    win.__getCreateClientCallCount = () => createClientCallCount;
  }
  return win;
}

function runNoConfigCase(win) {
  return {
    getClient: win.SupabaseClient.getClient(),
    resolveProvider: win.SupabaseClient.resolveProvider(),
  };
}

function runConfiguredCase(win) {
  const first = win.SupabaseClient.getClient();
  const second = win.SupabaseClient.getClient(); // should be cached, not a new client
  return {
    firstClientUrl: first.url,
    firstClientKey: first.key,
    firstClientOptsAuth: first.opts.auth,
    sameReferenceBothCalls: first === second,
    createClientCallCount: win.__getCreateClientCallCount(),
    resolveProvider: win.SupabaseClient.resolveProvider(),
  };
}

function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'supabase-client.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'supabase-client.bridge.js'), 'utf8');

  for (const [label, src] of [['ORIGINAL', originalSrc], ['BRIDGE', bridgeSrc]]) {
    console.log(`\n=== ${label} ===`);

    const winNoConfig = makeWindow(false);
    winNoConfig.eval(src);
    const noConfigResult = runNoConfigCase(winNoConfig);
    assert.strictEqual(noConfigResult.getClient, null, `${label}: getClient() with no config must return null`);
    assert.strictEqual(noConfigResult.resolveProvider, 'localStorage', `${label}: resolveProvider() with no config must return 'localStorage'`);
    console.log('  no-config fallback path: OK', noConfigResult);

    const winConfigured = makeWindow(true);
    winConfigured.eval(src);
    const configuredResult = runConfiguredCase(winConfigured);
    assert.strictEqual(configuredResult.firstClientUrl, 'https://example.supabase.co', `${label}: client should receive the configured URL`);
    assert.strictEqual(configuredResult.firstClientKey, 'fake-anon-key', `${label}: client should receive the configured key`);
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(configuredResult.firstClientOptsAuth)),
      { persistSession: true, autoRefreshToken: true },
      `${label}: auth options must match`
    );
    assert.strictEqual(configuredResult.sameReferenceBothCalls, true, `${label}: getClient() must return the cached singleton, not construct a new client each call`);
    assert.strictEqual(configuredResult.createClientCallCount, 1, `${label}: createClient should only be called ONCE despite getClient() being called twice`);
    assert.strictEqual(configuredResult.resolveProvider, 'supabase', `${label}: resolveProvider() with a real client must return 'supabase'`);
    console.log('  configured path + singleton caching: OK', configuredResult);
  }

  console.log('\nEQUIVALENCE CHECK PASSED — no-config fallback, configured client creation, and lazy-singleton caching all confirmed identical between original and bridge.');
}

main();
