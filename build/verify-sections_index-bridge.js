// Phase 7, Stream B — equivalence check for modules/admin/sections_index.js.
// This file's real behavior is almost entirely load-time side effects (the
// load-order verification log, and wiring into AppStore.ready to bootstrap
// + subscribe to realtime), plus two window-exposed functions
// (refreshSectionData, _sectionsIndexTeardown). The check captures every
// console.* call (redirected into an array instead of stdout, so it's a
// real comparable value) and drives: the happy load-order path, the
// missing-exports path, the no-Supabase-client offline path, the stale-
// response discard guard (two overlapping _bootstrapSectionData() calls),
// and the realtime-subscribe + teardown lifecycle.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeFakeSupabaseClient(calls, opts) {
  opts = opts || {};
  let resolveFetch;
  const fetchGate = new Promise(r => { resolveFetch = r; });
  return {
    from(table) {
      calls.push({ name: 'from', table });
      return {
        select(cols) {
          calls.push({ name: 'select', cols });
          return {
            async order(col, ordOpts) {
              calls.push({ name: 'order', col, ordOpts });
              if (opts.delayed) await fetchGate;
              if (opts.errorMode) return { data: null, error: { message: 'boom: fetch failed' } };
              return {
                data: [
                  { id: 's1', grade_level: '10', section_name: 'Rizal', adviser_id: 'a1', archived: false, created_at: 'c1', updated_at: 'u1' },
                  { id: 's2', grade_level: '9', section_name: 'Bonifacio', adviser_id: null, archived: true, created_at: 'c2', updated_at: 'u2' },
                ],
                error: null,
              };
            },
          };
        },
      };
    },
    channel(name) {
      calls.push({ name: 'channel', channelName: name });
      const chan = {
        _handlers: [],
        on(event, filter, handler) {
          calls.push({ name: 'channel.on', event, filter });
          chan._handlers.push(handler);
          return chan;
        },
        subscribe(cb) {
          calls.push({ name: 'channel.subscribe' });
          if (cb) cb('SUBSCRIBED');
          return chan;
        },
        unsubscribe() {
          calls.push({ name: 'channel.unsubscribe' });
        },
      };
      return chan;
    },
    __resolveFetch: () => resolveFetch(),
  };
}

function makeWindow(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html></html>', { runScripts: 'dangerously' });
  const win = dom.window;
  const logs = [];
  win.__logs = logs;
  ['log', 'error', 'warn', 'info'].forEach(level => {
    win.console[level] = (...args) => { logs.push({ level, args: args.map(a => (a instanceof Error ? a.message : a)) }); };
  });

  const calls = [];
  win.__dbCalls = calls;
  const fakeClient = makeFakeSupabaseClient(calls, opts);
  win.__fakeClient = fakeClient;

  if (!opts.noDBService) {
    win.DBService = { getAuthClient: () => (opts.noClient ? null : fakeClient) };
  }

  let state = { classSections: [] };
  let readyResolve;
  win.AppStore = {
    ready: new Promise(r => { readyResolve = r; }),
    updateState(fn, event) {
      const draft = JSON.parse(JSON.stringify(state));
      fn(draft);
      state = draft;
      calls.push({ name: 'AppStore.updateState', event });
    },
    getState() { return JSON.parse(JSON.stringify(state)); },
  };
  win.__resolveReady = () => readyResolve();
  win.__getFakeState = () => JSON.parse(JSON.stringify(state));

  if (!opts.missingExports) {
    win.SectionService = {};
    win.getActiveClassIds = function () {};
    win.getClassLabel = function () {};
    win.renderSectionMaker = function () {};
    win.unmountSectionMaker = function () {};
  }

  return win;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runHappyPath(win) {
  const results = {};
  results.logsAtLoad = JSON.parse(JSON.stringify(win.__logs));
  win.__logs.length = 0;

  win.__resolveReady();
  await sleep(30); // let AppStore.ready.then(...) chain run: bootstrap -> setupRealtime

  results.stateAfterReady = win.__getFakeState();
  results.callsAfterReady = win.__dbCalls;
  results.logsAfterReady = win.__logs;

  // refreshSectionData is directly callable and re-fetches.
  win.__dbCalls.length = 0;
  win.__logs.length = 0;
  await win.refreshSectionData();
  results.stateAfterManualRefresh = win.__getFakeState();
  results.callsAfterManualRefresh = win.__dbCalls;

  // Teardown.
  win.__dbCalls.length = 0;
  win._sectionsIndexTeardown();
  results.callsAfterTeardown = win.__dbCalls;

  return results;
}

async function runMissingExportsCase(win) {
  await sleep(10);
  return { logs: win.__logs };
}

async function runNoClientCase(win) {
  win.__resolveReady();
  await sleep(20);
  return { logs: win.__logs, state: win.__getFakeState(), calls: win.__dbCalls };
}

async function runErrorCase(win) {
  win.__resolveReady();
  await sleep(20);
  return { logs: win.__logs.map(l => ({ level: l.level, args: l.args.map(a => (typeof a === 'string' ? a.replace(/\bat\b.*$/s, '') : a)) })), state: win.__getFakeState() };
}

async function runStaleGuardCase(win) {
  // Two overlapping calls, both delayed on the same gate — resolving the
  // gate lets both fetches "complete" near-simultaneously; only the LATER
  // call's sequence number should win and apply to AppStore.
  const p1 = win.refreshSectionData();
  const p2 = win.refreshSectionData();
  win.__fakeClient.__resolveFetch();
  await Promise.all([p1, p2]);
  await sleep(10);
  return { logs: win.__logs, state: win.__getFakeState() };
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'sections_index.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'sections_index.bridge.js'), 'utf8');

  // 1. Happy path.
  {
    const winO = makeWindow();
    winO.eval(originalSrc);
    const rO = await runHappyPath(winO);
    const winB = makeWindow();
    winB.eval(bridgeSrc);
    const rB = await runHappyPath(winB);
    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'happy path mismatch');
  }

  // 2. Missing exports (load-order guard fires).
  {
    const winO = makeWindow({ missingExports: true });
    winO.eval(originalSrc);
    const rO = await runMissingExportsCase(winO);
    const winB = makeWindow({ missingExports: true });
    winB.eval(bridgeSrc);
    const rB = await runMissingExportsCase(winB);
    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'missing-exports path mismatch');
  }

  // 3. No Supabase client (offline mode).
  {
    const winO = makeWindow({ noClient: true });
    winO.eval(originalSrc);
    const rO = await runNoClientCase(winO);
    const winB = makeWindow({ noClient: true });
    winB.eval(bridgeSrc);
    const rB = await runNoClientCase(winB);
    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'no-client path mismatch');
  }

  // 4. Fetch RPC error (non-fatal warn path).
  {
    const winO = makeWindow({ errorMode: true });
    winO.eval(originalSrc);
    const rO = await runErrorCase(winO);
    const winB = makeWindow({ errorMode: true });
    winB.eval(bridgeSrc);
    const rB = await runErrorCase(winB);
    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'error path mismatch');
  }

  // 5. Stale-response discard guard.
  {
    const winO = makeWindow({ delayed: true });
    winO.eval(originalSrc);
    winO.__resolveReady();
    await sleep(10);
    winO.__dbCalls.length = 0; winO.__logs.length = 0;
    const rO = await runStaleGuardCase(winO);

    const winB = makeWindow({ delayed: true });
    winB.eval(bridgeSrc);
    winB.__resolveReady();
    await sleep(10);
    winB.__dbCalls.length = 0; winB.__logs.length = 0;
    const rB = await runStaleGuardCase(winB);

    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'stale-guard path mismatch');
  }

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('sections_index.js: load-order verification (happy + missing-exports), AppStore.ready');
  console.log('wiring (bootstrap + realtime subscribe), refreshSectionData, _sectionsIndexTeardown,');
  console.log('the offline/no-client branch, the non-fatal fetch-error branch, and the stale-response');
  console.log('sequence-number discard guard all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
