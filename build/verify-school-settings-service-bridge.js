// Phase 7, Stream B — equivalence check for modules/admin/school-settings-service.js.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html></html>', { runScripts: 'dangerously' });
  const win = dom.window;
  const calls = [];
  win.__dbCalls = calls;
  win.DBService = {
    async rpc(name, params) {
      calls.push({ name, params: JSON.parse(JSON.stringify(params || {})) });
      if (name === 'get_school_settings') {
        if (win.__getFailMode) return { data: null, error: { message: 'boom: get failed' } };
        if (win.__getEmptyMode) return { data: null, error: null };
        return { data: { school_name: 'Rizal HS', school_year_label: 'SY 2026-2027', updated_at: 't', updated_by: 'admin-1' }, error: null };
      }
      if (name === 'save_school_settings') {
        if (params.p_school_name === 'FAIL') return { data: null, error: { message: 'boom: save failed' } };
        return { data: { school_name: params.p_school_name, school_year_label: params.p_school_year_label, updated_at: 't2', updated_by: 'admin-1' }, error: null };
      }
      throw new Error('unexpected rpc: ' + name);
    },
  };
  return win;
}

async function runSequence(win) {
  const results = {};
  results.getOk = await win.SchoolSettingsService.get();

  win.__getEmptyMode = true;
  results.getEmptyRow = await win.SchoolSettingsService.get();
  win.__getEmptyMode = false;

  win.__getFailMode = true;
  results.getFail = await win.SchoolSettingsService.get();
  win.__getFailMode = false;

  results.saveOk = await win.SchoolSettingsService.save({ schoolName: 'New Name', schoolYearLabel: 'SY 2027-2028' });
  results.saveNulls = await win.SchoolSettingsService.save({});
  results.saveFail = await win.SchoolSettingsService.save({ schoolName: 'FAIL', schoolYearLabel: 'x' });

  results.dbCalls = win.__dbCalls;
  return results;
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'school-settings-service.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'school-settings-service.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.SchoolSettingsService, 'object');
  const resultOriginal = await runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.SchoolSettingsService, 'object');
  const resultBridge = await runSequence(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original output');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('school-settings-service.js: get() (incl. null-data and RPC-error) and save() (incl. null');
  console.log('fields and RPC-error) match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
