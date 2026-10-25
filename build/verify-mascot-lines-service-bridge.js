// Phase 7 (Stream A) — equivalence check for mascot-lines-service.js.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow(dbServiceImpl) {
  const win = new JSDOM('<!doctype html></html>', { runScripts: 'dangerously' }).window;
  if (dbServiceImpl) win.DBService = dbServiceImpl;
  // else: leave DBService completely undefined, testing the no-guard
  // bare-reference-inside-try/catch path specifically.
  return win;
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'shared', 'mascot-lines-service.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'mascot-lines-service.bridge.js'), 'utf8');

  const results = {};
  for (const [label, src] of [['original', originalSrc], ['bridge', bridgeSrc]]) {
    console.log(`\n=== ${label} ===`);

    // Case 1: DBService entirely undefined — the unguarded bare reference
    // must be caught by the existing try/catch, not crash the caller.
    const win1 = makeWindow(null);
    win1.eval(src);
    const r1get = await win1.MascotLinesService.get();
    const r1save = await win1.MascotLinesService.save({ start: ['hi'] });
    results[`${label}_noDBService_get`] = r1get;
    results[`${label}_noDBService_save`] = r1save;
    console.log('  no-DBService case (both get/save):', JSON.stringify(r1get), JSON.stringify(r1save));

    // Case 2: DBService present, RPC succeeds with full data.
    const win2 = makeWindow({
      rpc: async (name) => {
        if (name === 'get_mascot_line_settings') {
          return { data: { custom_lines: { start: ['Custom!'] }, updated_at: '2026-01-01', updated_by: 'admin1' }, error: null };
        }
        return { data: null, error: null };
      },
    });
    win2.eval(src);
    const r2 = await win2.MascotLinesService.get();
    results[`${label}_success_get`] = r2;
    console.log('  success case:', JSON.stringify(r2));

    // Case 3: DBService present, RPC succeeds but returns an EMPTY row
    // (no custom_lines/updated_at/updated_by at all) — defaults must apply.
    const win3 = makeWindow({ rpc: async () => ({ data: {}, error: null }) });
    win3.eval(src);
    const r3 = await win3.MascotLinesService.get();
    results[`${label}_emptyRow_get`] = r3;
    console.log('  empty-row defaults case:', JSON.stringify(r3));

    // Case 4: DBService present, RPC returns a real error.
    const win4 = makeWindow({ rpc: async () => ({ data: null, error: { message: 'permission denied' } }) });
    win4.eval(src);
    const r4 = await win4.MascotLinesService.get();
    results[`${label}_rpcError_get`] = r4;
    console.log('  rpc-error case:', JSON.stringify(r4));

    // Case 5: DBService.rpc itself throws (network failure, etc.).
    const win5 = makeWindow({ rpc: async () => { throw new Error('network down'); } });
    win5.eval(src);
    const r5 = await win5.MascotLinesService.get();
    results[`${label}_thrownError_get`] = r5;
    console.log('  thrown-exception case:', JSON.stringify(r5));

    // Case 6: save() with no argument at all — must default p_custom_lines to {}.
    let capturedParams = null;
    const win6 = makeWindow({
      rpc: async (name, params) => {
        if (name === 'save_mascot_line_settings') capturedParams = params;
        return { data: { custom_lines: {} }, error: null };
      },
    });
    win6.eval(src);
    await win6.MascotLinesService.save(); // no argument
    results[`${label}_saveNoArg_params`] = capturedParams;
    console.log('  save() with no argument, captured RPC params:', JSON.stringify(capturedParams));
  }

  const pairs = ['noDBService_get', 'noDBService_save', 'success_get', 'emptyRow_get', 'rpcError_get', 'thrownError_get', 'saveNoArg_params'];
  for (const p of pairs) {
    assert.strictEqual(JSON.stringify(results[`bridge_${p}`]), JSON.stringify(results[`original_${p}`]), `${p}: bridge must match original exactly`);
  }

  // Sanity checks on real values.
  assert.strictEqual(results.original_noDBService_get.ok, false, 'sanity: no DBService -> ok:false, not a throw');
  assert.strictEqual(results.original_success_get.ok, true);
  assert.strictEqual(JSON.stringify(results.original_success_get.customLines), JSON.stringify({ start: ['Custom!'] }));
  assert.strictEqual(results.original_emptyRow_get.ok, true);
  assert.strictEqual(JSON.stringify(results.original_emptyRow_get.customLines), '{}', 'sanity: missing custom_lines must default to {}');
  assert.strictEqual(results.original_emptyRow_get.updatedAt, null, 'sanity: missing updated_at must default to null');
  assert.strictEqual(results.original_rpcError_get.ok, false);
  assert.strictEqual(results.original_rpcError_get.error, 'permission denied');
  assert.strictEqual(results.original_thrownError_get.ok, false);
  assert.strictEqual(results.original_thrownError_get.error, 'network down');
  assert.strictEqual(JSON.stringify(results.original_saveNoArg_params), JSON.stringify({ p_custom_lines: {} }), 'sanity: save() with no argument must default to an empty object, not throw or send undefined');

  console.log('\nEQUIVALENCE CHECK PASSED');
}

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
