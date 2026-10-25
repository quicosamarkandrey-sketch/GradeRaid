// Phase 7, Stream B — equivalence check for modules/admin/content-oversight-service.js.
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
      if (name === 'get_teacher_content') {
        if (win.__fetchFail) return { data: null, error: { message: 'boom: fetch failed' } };
        if (win.__fetchNull) return { data: null, error: null };
        return { data: { achievements: [{ id: 'a1' }], titles: [], quizzes: [], campaignWorlds: [], shopProducts: [] }, error: null };
      }
      if (name === 'log_edit_as_action') {
        if (win.__logFailFor === params.p_table_name) return { data: null, error: { message: 'boom: log failed' } };
        return { data: { id: 'log-1' }, error: null };
      }
      if (String(name).startsWith('oversight_upsert_')) {
        if (params.p_id === 'FAIL') return { data: null, error: { message: 'boom: ' + name + ' failed' } };
        return { data: { id: params.p_id, ...params }, error: null };
      }
      if (String(name).startsWith('delete_')) {
        const idParam = Object.keys(params).find(k => k !== 'p_owner_teacher_id');
        if (params[idParam] === 'FAIL') return { data: null, error: { message: 'boom: ' + name + ' failed' } };
        return { data: null, error: null };
      }
      throw new Error('unexpected rpc: ' + name);
    },
  };
  return win;
}

async function runSequence(win) {
  const results = {};

  results.fetchOk = await win.ContentOversightService.fetchTeacherContent('t1');
  win.__fetchNull = true;
  results.fetchNullFallback = await win.ContentOversightService.fetchTeacherContent('t1');
  win.__fetchNull = false;
  win.__fetchFail = true;
  results.fetchFail = await win.ContentOversightService.fetchTeacherContent('t1');
  win.__fetchFail = false;

  results.saveAchievementOk = await win.ContentOversightService.saveAchievement('t1', { id: 'a1', name: 'Ach' }, true);
  results.saveAchievementRpcFail = await win.ContentOversightService.saveAchievement('t1', { id: 'FAIL', name: 'X' }, true);
  win.__logFailFor = 'titles';
  results.saveTitleLogFailsButWriteSucceeds = await win.ContentOversightService.saveTitle('t1', { id: 't1', name: 'Title' }, false);
  win.__logFailFor = null;

  results.saveQuizOk = await win.ContentOversightService.saveQuiz('t1', { id: 'q1', title: 'Quiz' }, true);
  results.saveCampaignWorldOk = await win.ContentOversightService.saveCampaignWorld('t1', { id: 'w1', label: 'World' }, true);
  results.saveShopItemOk = await win.ContentOversightService.saveShopItem('t1', { id: 'p1', name: 'Item' }, true);

  results.deleteAchievementOk = await win.ContentOversightService.deleteAchievement('t1', 'a1');
  results.deleteAchievementFail = await win.ContentOversightService.deleteAchievement('t1', 'FAIL');
  results.deleteTitleOk = await win.ContentOversightService.deleteTitle('t1', 't1');
  results.deleteQuizOk = await win.ContentOversightService.deleteQuiz('t1', 'q1');
  results.deleteCampaignWorldOk = await win.ContentOversightService.deleteCampaignWorld('t1', 'w1');
  results.deleteShopItemOk = await win.ContentOversightService.deleteShopItem('t1', 'p1');

  results.dbCalls = win.__dbCalls;
  return results;
}

async function main() {
  const auditLogSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'audit-log-service.js'), 'utf8');
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'content-oversight-service.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'content-oversight-service.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(auditLogSrc); // real, untouched — sets window.AuditLogService
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.ContentOversightService, 'object');
  const resultOriginal = await runSequence(winOriginal);

  const winBridge = makeWindow();
  // No audit-log eval needed — the bridge's bundle already contains a real
  // `import` of src/modules/admin/audit-log-service.js.
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.ContentOversightService, 'object');
  const resultBridge = await runSequence(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original output');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('content-oversight-service.js: fetchTeacherContent (incl. null-data fallback + RPC error),');
  console.log('all 5 save*() (incl. RPC error + the log-fails-but-write-still-succeeds branch), and all 5');
  console.log('delete*() (incl. RPC error) match — and every write logs via the real AuditLogService.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
