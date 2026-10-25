// Phase 7 (Stream A) — equivalence check for error-capture.js.
// Drives both windows through: no-DBService queueing + later flush once
// DBService appears (real ~250ms poll timing, not faked), immediate send
// when DBService is already available, RPC rejection being silently
// swallowed, the cross-origin "Script error." (no `.error` object) case,
// a real `unhandledrejection` event with both an Error reason and a
// plain-string reason, message/stack truncation, and window.onerror's
// return value (false — must not suppress console reporting).
const { JSDOM } = require('jsdom');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'dangerously',
    url: 'https://example.org/app/index.html',
  });
  const win = dom.window;
  const calls = [];
  win.__calls = calls;
  win.__rpcAvailable = false;
  win.DBService = undefined;
  win.__installDBService = function (opts) {
    opts = opts || {};
    win.DBService = {
      rpc(name, params) {
        calls.push({ name, params: JSON.parse(JSON.stringify(params)) });
        if (opts.fail) return Promise.reject(new Error('network down'));
        return Promise.resolve({ data: null, error: null });
      },
    };
  };
  return win;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalizeStacks(calls) {
  // p_stack captures the real Error.stack of a manually-constructed test
  // Error — its exact text depends on Node's own call stack at the
  // moment `new Error(...)` ran (module wrapper frames, CLI invocation
  // frames, etc.), which varies by HOW this script itself is invoked and
  // has nothing to do with error-capture.js's own logic. Normalize to
  // "first line only" (the part error-capture.js's own truncation logic
  // actually cares about) so the comparison reflects real behavior, not
  // Node's incidental stack-formatting.
  return calls.map(c => {
    const params = { ...c.params };
    if (typeof params.p_stack === 'string') {
      params.p_stack = params.p_stack.split('\n')[0] + ' [REST NORMALIZED]';
    }
    return { ...c, params };
  });
}

async function runSequence(win) {
  const results = {};

  // 1. No DBService at all — error gets queued, not sent immediately.
  const retVal = win.onerror('Boom happened', 'https://x/app.js', 10, 5, new Error('Boom happened'));
  results.onerrorReturnValue = retVal;
  results.callsRightAfterQueuedError = normalizeStacks(win.__calls);
  win.__calls.length = 0;

  // 2. A cross-origin-style error: no `.error` object, generic message.
  win.onerror('Script error.', 'https://cdn.other/lib.js', 0, 0, undefined);
  results.callsAfterCrossOriginQueued = normalizeStacks(win.__calls);
  win.__calls.length = 0;

  // 3. unhandledrejection with an Error reason, still queued (no DBService yet).
  const err = new Error('rejected promise boom');
  win.dispatchEvent(Object.assign(new win.Event('unhandledrejection'), { reason: err }));
  results.callsAfterRejectionQueued = normalizeStacks(win.__calls);
  win.__calls.length = 0;

  // 4. unhandledrejection with a plain string reason.
  win.dispatchEvent(Object.assign(new win.Event('unhandledrejection'), { reason: 'plain string reason' }));
  results.callsAfterStringRejectionQueued = normalizeStacks(win.__calls);
  win.__calls.length = 0;

  // Now DBService becomes available — the ~250ms poll should flush all 4 queued entries.
  win.__installDBService();
  await sleep(400);
  results.flushedCalls = normalizeStacks(win.__calls);
  win.__calls.length = 0;

  // 5. With DBService already available, a new error sends immediately (no queueing wait needed).
  win.onerror('Immediate error', 'https://x/app.js', 1, 1, new Error('Immediate error'));
  await sleep(20);
  results.immediateSendCalls = normalizeStacks(win.__calls);
  win.__calls.length = 0;

  // 6. RPC rejection is swallowed silently — no throw, no extra call recorded beyond the attempt.
  win.__installDBService({ fail: true });
  win.onerror('Will fail to log', 'https://x/app.js', 2, 2, new Error('Will fail to log'));
  await sleep(20);
  results.rpcFailureStillOnlyOneCallAttempt = normalizeStacks(win.__calls);
  win.__calls.length = 0;
  win.__installDBService(); // back to succeeding for anything after

  // 7. Message/stack truncation.
  const longMessage = 'X'.repeat(3000);
  const longStackErr = new Error('trunc test');
  longStackErr.stack = 'Y'.repeat(9000);
  win.onerror(longMessage, 'https://x/app.js', 1, 1, longStackErr);
  await sleep(20);
  const truncCall = win.__calls[win.__calls.length - 1];
  results.messageTruncatedLength = truncCall.params.p_message.length;
  results.stackTruncatedLength = truncCall.params.p_stack.length;
  win.__calls.length = 0;
  win.onerror('ua test', 'https://x/app.js', 1, 1, new Error('ua test'));
  await sleep(20);
  const uaCall = win.__calls[win.__calls.length - 1];
  results.userAgentCaptured = typeof uaCall.params.p_user_agent === 'string' && uaCall.params.p_user_agent.length > 0;
  results.urlCaptured = uaCall.params.p_url;

  return results;
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'error-capture.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'error-capture.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.onerror, 'function', 'original: window.onerror should be set');
  const resultOriginal = await runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.onerror, 'function', 'bridge: window.onerror should be set');
  const resultBridge = await runSequence(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original output at every step');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('error-capture.js: no-DBService queueing (window.onerror, cross-origin error, Error-reason');
  console.log('unhandledrejection, string-reason unhandledrejection), the ~250ms flush poll picking up all');
  console.log('4 queued entries once DBService appears, immediate send when already available, RPC');
  console.log('rejection being silently swallowed, message/stack truncation, and userAgent/url capture all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
