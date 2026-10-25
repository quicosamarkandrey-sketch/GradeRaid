// Phase 7, Stream B — equivalence check for modules/admin/audit-log.js.
// Same composition approach used for content-oversight-service.js:
// AuditLogService and TeacherDirectoryService are already independently
// equivalence-checked, so drive both windows off an identical fake
// DBService.rpc, and let the ORIGINAL window eval the real, untouched
// service files first (so its bare `AuditLogService` / `TeacherDirectoryService`
// references resolve via window), while the BRIDGE window relies on its
// own real internal imports of both.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const STARTER_HTML = `<!doctype html><html><body>
  <div id="a-audit-log"></div>
</body></html>`;

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously' });
  const win = dom.window;
  const calls = [];
  win.__calls = calls;

  win.currentRole = 'admin';
  win._esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  win.toast = function (msg, color) { calls.push({ name: 'toast', msg, color }); };

  const allRows = [];
  for (let i = 1; i <= 5; i++) {
    allRows.push({
      id: 'log' + i, actor_id: 'admin1', target_teacher_id: i % 2 === 0 ? 't2' : 't1',
      table_name: i % 2 === 0 ? 'quizzes' : 'achievements', record_id: 'rec' + i,
      action: ['create', 'update', 'delete'][i % 3], details: i === 1 ? { note: 'x' } : {},
      session_id: i === 2 ? 'sess-2' : null, created_at: '2026-0' + i + '-01T00:00:00Z',
    });
  }

  win.DBService = {
    async rpc(name, params) {
      calls.push({ name, params: JSON.parse(JSON.stringify(params || {})) });
      if (name === 'get_audit_log') {
        if (params.p_target_teacher_id === 'FAIL') return { data: null, error: { message: 'boom: get failed' } };
        const limit = params.p_limit || 200;
        let rows = allRows;
        if (params.p_target_teacher_id) rows = rows.filter(r => r.target_teacher_id === params.p_target_teacher_id);
        return { data: rows.slice(0, limit), error: null };
      }
      if (name === 'get_teacher_directory') {
        return { data: [{ id: 't1', display_name: 'Ms. Alpha', email: 'a@x.com' }, { id: 't2', display_name: 'Mr. Beta', email: 'b@x.com' }, { id: 'admin1', display_name: 'Admin One', email: 'admin@x.com' }], error: null };
      }
      throw new Error('unexpected rpc: ' + name);
    },
  };

  return win;
}

function snapshot(win) {
  return { html: win.document.getElementById('a-audit-log').innerHTML, calls: win.__calls };
}

async function runSequence(win) {
  const results = {};

  // Non-admin gate.
  win.currentRole = 'teacher';
  await win.renderAuditLog();
  results.nonAdminGate = snapshot(win);
  win.__calls.length = 0;
  win.currentRole = 'admin';

  // Normal load.
  await win.renderAuditLog();
  results.afterLoad = snapshot(win);
  win.__calls.length = 0;

  // Teacher filter (server-side).
  win.auditLogSetTeacherFilter('t1');
  await new Promise(r => setTimeout(r, 10)); // renderAuditLog is fire-and-forget async inside the setter
  results.afterTeacherFilter = snapshot(win);
  win.__calls.length = 0;

  // Action filter (client-side, synchronous).
  win.auditLogSetActionFilter('update');
  results.afterActionFilter = snapshot(win);

  // Table filter (client-side, synchronous) stacked on top.
  win.auditLogSetTableFilter('achievements');
  results.afterTableFilterStacked = snapshot(win);

  // Clear filters.
  win.auditLogSetTeacherFilter('');
  await new Promise(r => setTimeout(r, 10));
  win.auditLogSetActionFilter('');
  win.auditLogSetTableFilter('');
  results.afterClearFilters = snapshot(win);
  win.__calls.length = 0;

  // Load more.
  await win.auditLogLoadMore();
  results.afterLoadMore = snapshot(win);
  win.__calls.length = 0;

  // Fetch failure path (force via a teacher filter of 'FAIL').
  win.auditLogSetTeacherFilter('FAIL');
  await new Promise(r => setTimeout(r, 10));
  results.fetchFail = snapshot(win);

  return results;
}

async function main() {
  const auditLogServiceSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'audit-log-service.js'), 'utf8');
  const teacherDirServiceSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'teacher-directory-service.js'), 'utf8');
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'audit-log.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'audit-log.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(auditLogServiceSrc);
  winOriginal.eval(teacherDirServiceSrc);
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.renderAuditLog, 'function');
  const resultOriginal = await runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.renderAuditLog, 'function');
  const resultBridge = await runSequence(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original output');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('audit-log.js: non-admin gate, load, server-side teacher filter, client-side action/table');
  console.log('filters (incl. stacking + the "Clear filters" button appearing), load-more, and the');
  console.log('fetch-error path all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
