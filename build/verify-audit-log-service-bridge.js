// Phase 7, Stream B — equivalence check for modules/admin/audit-log-service.js.
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
      calls.push({ name, params: JSON.parse(JSON.stringify(params)) });
      if (name === 'log_edit_as_action') {
        if (params.p_action === 'FAIL') return { data: null, error: { message: 'boom: log failed' } };
        return { data: { id: 'log-1', ...params }, error: null };
      }
      if (name === 'get_audit_log') {
        if (params.p_target_teacher_id === 'nobody') return { data: null, error: { message: 'boom: get failed' } };
        return { data: [{ id: 'log-1' }, { id: 'log-2' }], error: null };
      }
      throw new Error('unexpected rpc: ' + name);
    },
  };
  return win;
}

async function runSequence(win) {
  const results = {};
  results.logOk = await win.AuditLogService.logEditAsAction({
    targetTeacherId: 't1', tableName: 'students', recordId: 's1', action: 'update', details: { x: 1 }, sessionId: 'sess-1',
  });
  results.logMinimal = await win.AuditLogService.logEditAsAction({
    targetTeacherId: 't2', tableName: 'quizzes', recordId: 'q1', action: 'create',
  });
  results.logFail = await win.AuditLogService.logEditAsAction({
    targetTeacherId: 't3', tableName: 'x', recordId: 'r1', action: 'FAIL',
  });
  results.getLogDefault = await win.AuditLogService.getLog();
  results.getLogFiltered = await win.AuditLogService.getLog({ targetTeacherId: 't1', limit: 5 });
  results.getLogFail = await win.AuditLogService.getLog({ targetTeacherId: 'nobody' });
  results.dbCalls = win.__dbCalls;
  return results;
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'audit-log-service.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'audit-log-service.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.AuditLogService, 'object');
  const resultOriginal = await runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.AuditLogService, 'object');
  const resultBridge = await runSequence(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original output');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('audit-log-service.js: logEditAsAction/getLog match across happy path, minimal args, and RPC errors.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
