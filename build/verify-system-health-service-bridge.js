// Phase 7, Stream B — equivalence check for modules/admin/system-health-service.js.
// Covers all RPC-backed methods (happy + error paths) plus the presence
// heartbeat lifecycle (start/stop, idempotent start, tick-skipping on a
// hidden document, and the visibilitychange catch-up ping) with real
// setInterval timing — no faked timers.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html></html>', { runScripts: 'dangerously', pretendToBeVisual: true });
  const win = dom.window;
  const calls = [];
  win.__dbCalls = calls;
  win.DBService = {
    async rpc(name, params) {
      calls.push({ name, params: JSON.parse(JSON.stringify(params || {})) });
      if (name === 'touch_presence') return { data: '2026-01-01T00:00:00Z', error: null };
      if (name === 'get_admin_user_counts') return { data: [{ total_users: 10, online_now: 3 }], error: null };
      if (name === 'get_client_error_logs') {
        if (params.p_role === 'FAIL') return { data: null, error: { message: 'boom: logs failed' } };
        return { data: [{ id: 'e1' }], error: null };
      }
      if (name === 'resolve_client_error_log') {
        if (params.p_id === 'missing') return { data: null, error: { message: 'boom: resolve failed' } };
        return { data: { id: params.p_id, resolved: params.p_resolved }, error: null };
      }
      if (name === 'log_client_error') {
        if (params.p_message === 'THROW') throw new Error('network exploded');
        if (params.p_message === 'FAIL') return { data: null, error: { message: 'boom: log failed' } };
        return { data: null, error: null };
      }
      throw new Error('unexpected rpc: ' + name);
    },
  };
  return win;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runSequence(win) {
  const results = {};
  results.touchPresence = await win.SystemHealthService.touchPresence();
  results.userCounts = await win.SystemHealthService.getUserCounts();
  results.errorLogsOk = await win.SystemHealthService.getErrorLogs({ resolved: true, limit: 10 });
  results.errorLogsDefault = await win.SystemHealthService.getErrorLogs();
  results.errorLogsFail = await win.SystemHealthService.getErrorLogs({ role: 'FAIL' });
  results.resolveOk = await win.SystemHealthService.resolveErrorLog({ id: 'e1' });
  results.resolveUnresolve = await win.SystemHealthService.resolveErrorLog({ id: 'e1', resolved: false });
  results.resolveFail = await win.SystemHealthService.resolveErrorLog({ id: 'missing' });
  results.logClientErrorOk = await win.SystemHealthService.logClientError({ message: 'hi', stack: 's', source: 'src', userAgent: 'ua', url: 'u' });
  results.logClientErrorRpcFail = await win.SystemHealthService.logClientError({ message: 'FAIL' });
  results.logClientErrorThrows = await win.SystemHealthService.logClientError({ message: 'THROW' });

  // Heartbeat lifecycle: start is idempotent, ticks immediately, then
  // skips while document.hidden is true, and doesn't tick again on stop.
  const callsBeforeStart = win.__dbCalls.length;
  win.SystemHealthService.startPresenceHeartbeat();
  await sleep(20);
  const callsAfterFirstTick = win.__dbCalls.length; // immediate tick on start
  win.SystemHealthService.startPresenceHeartbeat(); // no-op, already running
  await sleep(20);
  const callsAfterSecondStartCall = win.__dbCalls.length;

  Object.defineProperty(win.document, 'hidden', { value: true, configurable: true });
  win.document.dispatchEvent(new win.Event('visibilitychange')); // hidden -> no catch-up ping
  await sleep(20);
  const callsWhileHidden = win.__dbCalls.length;

  Object.defineProperty(win.document, 'hidden', { value: false, configurable: true });
  win.document.dispatchEvent(new win.Event('visibilitychange')); // visible again -> catch-up ping
  await sleep(20);
  const callsAfterVisibleAgain = win.__dbCalls.length;

  win.SystemHealthService.stopPresenceHeartbeat();
  const callsAfterStopCount = win.__dbCalls.length;
  await sleep(20);
  const callsSomeTimeAfterStop = win.__dbCalls.length;

  results.heartbeat = {
    tickedImmediatelyOnStart: callsAfterFirstTick > callsBeforeStart,
    secondStartWasNoop: callsAfterSecondStartCall === callsAfterFirstTick,
    noNewCallWhileHidden: callsWhileHidden === callsAfterSecondStartCall,
    gotCatchUpPingOnVisible: callsAfterVisibleAgain > callsWhileHidden,
    noMoreCallsAfterStop: callsSomeTimeAfterStop === callsAfterStopCount,
  };

  results.dbCallNames = win.__dbCalls.map(c => c.name);
  return results;
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'system-health-service.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'system-health-service.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.SystemHealthService, 'object');
  const resultOriginal = await runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.SystemHealthService, 'object');
  const resultBridge = await runSequence(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original output');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('system-health-service.js: all RPC methods + presence heartbeat lifecycle match, including');
  console.log('idempotent start, hidden-tab tick-skipping, visibilitychange catch-up ping, and clean stop.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
