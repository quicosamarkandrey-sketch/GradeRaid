// Phase 7, Stream B — equivalence check for modules/admin/school-settings.js.
// Same composition approach as verify-starter-pack-editor-bridge.js:
// SchoolSettingsService's own equivalence is already independently proven
// (verify-school-settings-service-bridge.js), so drive both windows off an
// identical fake DBService.rpc and let the ORIGINAL window run the real
// modules/admin/school-settings-service.js while the BRIDGE window uses its
// real internal import of src/modules/admin/school-settings-service.js.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const STARTER_HTML = `<!doctype html><html><body>
  <div id="a-settings"></div>
</body></html>`;

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously' });
  const win = dom.window;
  const calls = [];
  win.__calls = calls;

  win.currentRole = 'admin';
  win.toast = function (msg, color) { calls.push({ name: 'toast', msg, color }); };

  win.DBService = {
    async rpc(name, params) {
      calls.push({ name, params: JSON.parse(JSON.stringify(params || {})) });
      if (name === 'get_school_settings') {
        if (win.__getFail) return { data: null, error: { message: 'boom: get failed' } };
        return { data: { school_name: 'Rizal HS', school_year_label: 'SY 2026-2027', updated_at: 't1', updated_by: 'admin-1' }, error: null };
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

function snapshot(win) {
  return {
    html: win.document.getElementById('a-settings').innerHTML,
    calls: win.__calls,
  };
}

async function runSequence(win) {
  const results = {};

  // Non-admin gate.
  win.currentRole = 'teacher';
  await win.renderSchoolSettings();
  results.nonAdminGate = snapshot(win);
  win.__calls.length = 0;
  win.currentRole = 'admin';

  // Load failure.
  win.__getFail = true;
  await win.renderSchoolSettings();
  results.loadFail = snapshot(win);
  win.__calls.length = 0;
  win.__getFail = false;

  // Normal load.
  await win.renderSchoolSettings();
  results.afterLoad = snapshot(win);
  win.__calls.length = 0;

  // Save success.
  win.document.getElementById('ss-school-name').value = 'New School Name';
  win.document.getElementById('ss-school-year').value = 'SY 2027-2028';
  await win.saveSchoolSettings();
  results.saveOk = snapshot(win);
  win.__calls.length = 0;

  // Save failure.
  win.document.getElementById('ss-school-name').value = 'FAIL';
  win.document.getElementById('ss-school-year').value = 'x';
  await win.saveSchoolSettings();
  results.saveFail = snapshot(win);

  return results;
}

async function main() {
  const serviceSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'school-settings-service.js'), 'utf8');
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'school-settings.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'school-settings.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(serviceSrc);
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.renderSchoolSettings, 'function');
  const resultOriginal = await runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.renderSchoolSettings, 'function');
  const resultBridge = await runSequence(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original output');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('school-settings.js: non-admin gate, load success/failure, and save success/failure all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
