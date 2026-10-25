// Phase 7 (Stream A) — equivalence check for dsm-service.js.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function makeWindow() {
  return new JSDOM('<!doctype html></html>', { runScripts: 'dangerously', url: 'https://example.org/' }).window;
}

async function runNoDBServiceScenario(win) {
  const results = {};

  await win.DSMService.initRemote();
  results.afterInitNoData = win.DSMService.read();

  win.DSMService.write({ student: ['a'], teacher: [], admin: [] });
  results.afterWrite = win.DSMService.read();
  results.storageKeyHasData = win.localStorage.getItem(win.DSMService.storageKey) !== null;

  const readResult = win.DSMService.read();
  readResult.student.push('MUTATED');
  results.secondReadUnaffectedByMutation = win.DSMService.read();

  win.DSMService.remove();
  results.afterRemove = win.DSMService.read();
  results.storageKeyClearedAfterRemove = win.localStorage.getItem(win.DSMService.storageKey);

  results.storageKey = win.DSMService.storageKey;
  return results;
}

async function runWithDBServiceScenario(win) {
  const rpcCalls = [];
  win.DBService = {
    rpc: async (name, params) => {
      rpcCalls.push({ name, params });
      if (name === 'get_dsm_settings') return { data: { student: ['from-remote'], teacher: [], admin: [] }, error: null };
      if (name === 'save_dsm_settings') return { data: null, error: null };
      return { data: null, error: null };
    },
    getAuthClient: () => ({ fake: 'session' }),
  };

  await win.DSMService.initRemote();
  const afterRemoteInit = win.DSMService.read();

  win.DSMService.write({ student: ['local-write'], teacher: [], admin: [] });
  const rpcCallsImmediatelyAfterWrite = rpcCalls.length;
  await wait(500);
  const rpcCallsAfterDebounce = rpcCalls.length;
  const saveCall = rpcCalls.find((c) => c.name === 'save_dsm_settings');

  return {
    afterRemoteInit,
    rpcCallsImmediatelyAfterWrite,
    rpcCallsAfterDebounce,
    saveCallParams: saveCall ? saveCall.params : null,
    getDsmSettingsWasCalled: rpcCalls.some((c) => c.name === 'get_dsm_settings'),
  };
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'dsm-service.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'dsm-service.bridge.js'), 'utf8');

  for (const [label, src] of [['ORIGINAL', originalSrc], ['BRIDGE', bridgeSrc]]) {
    console.log(`\n=== ${label} ===`);

    const win1 = makeWindow();
    win1.eval(src);
    const noDb = await runNoDBServiceScenario(win1);
    console.log('  no-DBService scenario:', JSON.stringify(noDb));

    const win2 = makeWindow();
    win2.eval(src);
    const withDb = await runWithDBServiceScenario(win2);
    console.log('  with-DBService scenario:', JSON.stringify(withDb));

    if (label === 'ORIGINAL') { global.__o1 = noDb; global.__o2 = withDb; }
    else { global.__b1 = noDb; global.__b2 = withDb; }
  }

  assert.strictEqual(JSON.stringify(global.__b1), JSON.stringify(global.__o1), 'no-DBService scenario must match exactly between original and bridge');
  assert.strictEqual(JSON.stringify(global.__b2), JSON.stringify(global.__o2), 'with-DBService scenario must match exactly between original and bridge');

  assert.strictEqual(global.__o1.afterInitNoData, null, 'sanity: no data anywhere -> read() is null');
  assert.strictEqual(JSON.stringify(global.__o1.afterWrite), JSON.stringify({ student: ['a'], teacher: [], admin: [] }));
  assert.strictEqual(global.__o1.storageKeyHasData, true);
  assert.strictEqual(JSON.stringify(global.__o1.secondReadUnaffectedByMutation), JSON.stringify({ student: ['a'], teacher: [], admin: [] }), 'sanity: read() must return a deep clone');
  assert.strictEqual(global.__o1.afterRemove, null, 'sanity: remove() must clear the cache');
  assert.strictEqual(global.__o1.storageKeyClearedAfterRemove, null, 'sanity: remove() must clear the localStorage mirror too');
  assert.strictEqual(global.__o1.storageKey, 'eduquest_dsm_v2');

  assert.strictEqual(JSON.stringify(global.__o2.afterRemoteInit), JSON.stringify({ student: ['from-remote'], teacher: [], admin: [] }), 'sanity: initRemote() must hydrate from the RPC result');
  assert.strictEqual(global.__o2.rpcCallsImmediatelyAfterWrite, 1, 'sanity: only initRemote get_dsm_settings should have fired before the debounce elapses');
  assert.strictEqual(global.__o2.rpcCallsAfterDebounce, 2, 'sanity: exactly one more RPC call after the 400ms debounce');
  assert.strictEqual(JSON.stringify(global.__o2.saveCallParams), JSON.stringify({ p_student: ['local-write'], p_teacher: [], p_admin: [] }), 'sanity: the debounced save must carry the written data, correctly reshaped');
  assert.strictEqual(global.__o2.getDsmSettingsWasCalled, true);

  console.log('\nEQUIVALENCE CHECK PASSED');
}

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
