// Phase 7, Stream B — equivalence check for modules/admin/system-health.js.
// Same composition approach as audit-log.js: SystemHealthService is
// already independently equivalence-checked, so drive both windows off an
// identical fake DBService.rpc, with the ORIGINAL window evaling the real,
// untouched service file first. setInterval/clearInterval are stubbed to
// capture the tick callback instead of waiting real wall-clock time, so
// the 30s auto-refresh tick logic (active-page check, stale-navigation
// guard after the await, patch-in-place on success, silent skip on
// failure) can be driven directly and deterministically.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const STARTER_HTML = `<!doctype html><html><body>
  <div id="a-system-health" class="active"></div>
</body></html>`;

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously' });
  const win = dom.window;
  const calls = [];
  win.__calls = calls;

  win.currentRole = 'admin';
  win._esc = s => String(s == null ? '' : s);
  win.toast = function (msg, color) { calls.push({ name: 'toast', msg, color }); };

  let intervalCounter = 0;
  win.__tickFns = {};
  win.setInterval = function (fn, ms) {
    intervalCounter++;
    const id = 'timer' + intervalCounter;
    win.__tickFns[id] = fn;
    calls.push({ name: 'setInterval', ms, id });
    return id;
  };
  win.clearInterval = function (id) { calls.push({ name: 'clearInterval', id }); delete win.__tickFns[id]; };

  win.__failCounts = false;
  win.__failLogs = false;
  win.__tickFailsCounts = false;

  const logRows = [];
  for (let i = 1; i <= 3; i++) {
    logRows.push({
      id: 'err' + i, role: ['admin', 'teacher', 'student'][i % 3], message: 'Error ' + i,
      url: 'https://x/' + i, source: 'client', stack: i === 1 ? 'Error: boom\\n  at x.js:1:1' : null,
      resolved: i === 3, created_at: '2026-0' + i + '-01T00:00:00Z',
    });
  }

  win.DBService = {
    async rpc(name, params) {
      calls.push({ name, params: JSON.parse(JSON.stringify(params || {})) });
      if (name === 'get_admin_user_counts') {
        if (win.__failCounts) return { data: null, error: { message: 'boom: counts failed' } };
        if (win.__tickFailsCounts) return { data: null, error: { message: 'boom: tick counts failed' } };
        return { data: [{ total_users: 12, total_admins: 2, total_teachers: 4, total_students: 6, online_now: 3 }], error: null };
      }
      if (name === 'get_client_error_logs') {
        if (win.__failLogs) return { data: null, error: { message: 'boom: logs failed' } };
        let rows = logRows;
        if (params.p_resolved !== null && params.p_resolved !== undefined) rows = rows.filter(r => r.resolved === params.p_resolved);
        if (params.p_role) rows = rows.filter(r => r.role === params.p_role);
        return { data: rows.slice(0, params.p_limit || 200), error: null };
      }
      if (name === 'resolve_client_error_log') {
        if (params.p_id === 'FAIL') return { data: null, error: { message: 'boom: resolve failed' } };
        return { data: { id: params.p_id, resolved: params.p_resolved }, error: null };
      }
      if (name === 'touch_presence' || name === 'log_client_error') return { data: null, error: null };
      throw new Error('unexpected rpc: ' + name);
    },
  };

  return win;
}

function snapshot(win) {
  return { html: win.document.getElementById('a-system-health').innerHTML, calls: win.__calls };
}

async function runSequence(win) {
  const results = {};

  // Non-admin gate.
  win.currentRole = 'teacher';
  await win.renderSystemHealth();
  results.nonAdminGate = snapshot(win);
  win.__calls.length = 0;
  win.currentRole = 'admin';

  // Both fail.
  win.__failCounts = true; win.__failLogs = true;
  await win.renderSystemHealth();
  results.bothFail = snapshot(win);
  win.__calls.length = 0;
  win.__failCounts = false; win.__failLogs = false;

  // Normal load — this also starts the counts-refresh interval.
  await win.renderSystemHealth();
  results.afterLoad = snapshot(win);
  win.__calls.length = 0;

  const tickIds = Object.keys(win.__tickFns);
  const latestTickId = tickIds[tickIds.length - 1];
  const tick = win.__tickFns[latestTickId];

  // Tick while page is active, RPC succeeds — patches stat cards only.
  await tick();
  results.tickActiveSuccess = snapshot(win);
  win.__calls.length = 0;

  // Tick while page is active, RPC fails — silent skip, no toast, no change.
  win.__tickFailsCounts = true;
  await tick();
  results.tickActiveRpcFail = snapshot(win);
  win.__calls.length = 0;
  win.__tickFailsCounts = false;

  // Tick while page is no longer active — self-clears via shStopCountsRefresh.
  win.document.getElementById('a-system-health').classList.remove('active');
  await tick();
  results.tickInactive = snapshot(win);
  win.__calls.length = 0;
  win.document.getElementById('a-system-health').classList.add('active');

  // Explicit shStopCountsRefresh (as nav.js would call on leaving the tab).
  win.shStopCountsRefresh();
  results.afterExplicitStop = snapshot(win);
  win.__calls.length = 0;

  // Resolved + role filters (server-side, stacked).
  win.shSetResolvedFilter('resolved');
  await new Promise(r => setTimeout(r, 10));
  results.afterResolvedFilter = snapshot(win);
  win.__calls.length = 0;

  win.shSetRoleFilter('student');
  await new Promise(r => setTimeout(r, 10));
  results.afterRoleFilterStacked = snapshot(win);
  win.__calls.length = 0;

  win.shSetResolvedFilter('');
  await new Promise(r => setTimeout(r, 10));
  win.shSetRoleFilter('');
  await new Promise(r => setTimeout(r, 10));
  results.afterClearFilters = snapshot(win);
  win.__calls.length = 0;

  // Toggle stack trace expand/collapse.
  win.shToggleStack('err1');
  results.afterExpandStack = snapshot(win);
  win.shToggleStack('err1');
  results.afterCollapseStack = snapshot(win);
  win.__calls.length = 0;

  // Toggle resolved: success (patches in place, no refetch) then failure.
  await win.shToggleResolved('err1', false);
  results.toggleResolvedOk = snapshot(win);
  win.__calls.length = 0;

  await win.shToggleResolved('FAIL', false);
  results.toggleResolvedFail = snapshot(win);
  win.__calls.length = 0;

  // Load more.
  await win.shLoadMoreLogs();
  results.afterLoadMore = snapshot(win);

  return results;
}

async function main() {
  const serviceSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'system-health-service.js'), 'utf8');
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'system-health.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'system-health.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(serviceSrc);
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.renderSystemHealth, 'function');
  const resultOriginal = await runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.renderSystemHealth, 'function');
  const resultBridge = await runSequence(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original output');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('system-health.js: non-admin gate, both-fail load, normal load, the counts-refresh tick');
  console.log('(active+success patch-in-place, active+RPC-failure silent skip, inactive self-clear via');
  console.log('shStopCountsRefresh), explicit stop, stacked server-side filters, stack-trace toggle,');
  console.log('resolve-toggle success/failure, and load-more all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
