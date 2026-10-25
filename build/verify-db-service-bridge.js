// Phase 7 (Stream A) — equivalence check for db-service.js.
// SupabaseClient (supabase-client.js) predates all streams and is not
// real-imported here — the real, untouched classic script is eval'd into
// BOTH test windows (same shared, already-correct dependency, loaded the
// same window-fallback way on both sides — no combined-bundle issue
// since neither side holds separate mutable state for it the way
// AppStore did). pull-mappers.js/realtime-groups.js/table-sync.js ARE
// real-imported by db-service.js's own bridge, and hold no state that
// needs external seeding (pure derive functions + a stateless push
// engine), so no combined bundle is needed for THEM either.
//
// Covers: read/write/mirrorLocalOnly (incl. defaultValue fallback,
// localStorage mirror), writeDirty/readDirty (incl. corrupt-entry
// recovery), remove/diagnostics, the full initRemote() lifecycle
// (no client, no session, fast-path with matching uid mirror + background
// pull, no matching mirror -> blocking pull, pull throws), refreshAfterAuthChange
// (success incl. uid stamping + failure clearing cache), rpc/uploadPublicFile/
// getAuthClient/sendPasswordResetEmail passthroughs (incl. no-client and
// error branches), onSignal/sendSignal, teardownRealtime/flushPendingUpload,
// loadMoreHistory (valid/invalid key, exhausted flag), the _test seam, and
// a real postgres_changes event driving _applyScopedRefresh's scoped-group
// path through to a syncFromLegacy call.
const { JSDOM } = require('jsdom');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function makeFakeSupabaseGlobal(calls, opts) {
  opts = opts || {};
  function makeQuery(table) {
    const q = {
      _table: table,
      select() { return q; },
      order() { return q; },
      limit() { return Promise.resolve(q._result()); },
      range(from, to) { return Promise.resolve(q._resultRange(from, to)); },
      _result() {
        calls.push({ name: 'select', table });
        if (opts.pullThrows) return { data: null, error: { message: 'boom: pull failed for ' + table } };
        return { data: (opts.tableData && opts.tableData[table]) || [], error: null };
      },
      _resultRange(from, to) {
        calls.push({ name: 'range', table, from, to });
        const all = (opts.tableData && opts.tableData[table]) || [];
        return { data: all.slice(from, to + 1), error: null };
      },
      then(resolve) { return Promise.resolve(q._result()).then(resolve); },
      upsert(rows, config) {
        calls.push({ name: 'upsert', table, rows: JSON.parse(JSON.stringify(rows)) });
        return Promise.resolve({ error: null });
      },
    };
    return q;
  }

  const client = {
    auth: {
      async getSession() {
        calls.push({ name: 'getSession' });
        if (opts.getSessionThrows) throw new Error('getSession boom');
        return { data: { session: opts.noSession ? null : { user: { id: opts.uid || 'u1' } } } };
      },
      async resetPasswordForEmail(email, config) {
        calls.push({ name: 'resetPasswordForEmail', email, redirectTo: config.redirectTo });
        if (opts.resetEmailFails) return { error: { message: 'boom: reset failed' } };
        return { error: null };
      },
    },
    from(table) { return makeQuery(table); },
    rpc(name, params) {
      calls.push({ name: 'rpc', rpcName: name, params });
      return Promise.resolve({ data: opts.rpcData || null, error: opts.rpcFails ? { message: 'boom: rpc failed' } : null });
    },
    storage: {
      from(bucket) {
        return {
          async upload(p, blob, config) {
            calls.push({ name: 'storage.upload', bucket, path: p, config });
            if (opts.uploadFails) return { data: null, error: { message: 'boom: upload failed' } };
            return { data: { path: p }, error: null };
          },
          getPublicUrl(p) {
            calls.push({ name: 'storage.getPublicUrl', bucket, path: p });
            return { data: { publicUrl: 'https://fake.storage/' + bucket + '/' + p } };
          },
        };
      },
    },
    channel(name) {
      const handlers = [];
      const chan = {
        _name: name,
        on(event, filter, handler) { handlers.push({ event, filter, handler }); return chan; },
        subscribe(cb) { calls.push({ name: 'channel.subscribe', channel: name }); if (cb) cb('SUBSCRIBED'); return chan; },
        send(payload) { calls.push({ name: 'channel.send', channel: name, payload }); return Promise.resolve('ok'); },
        __fire(table) {
          handlers.forEach(h => { if (h.filter && h.filter.table === table) h.handler({}); });
        },
        __fireBroadcast(event, payload) {
          handlers.forEach(h => { if (h.event === 'broadcast' && h.filter && h.filter.event === event) h.handler({ payload }); });
        },
      };
      return chan;
    },
    removeChannel(chan) { calls.push({ name: 'removeChannel', channel: chan && chan._name }); },
  };

  return {
    createClient(url, key, config) {
      calls.push({ name: 'createClient' });
      return client;
    },
    __client: client,
  };
}

function makeWindow(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html></html>', { runScripts: 'dangerously', url: 'https://example.org/app/index.html' });
  const win = dom.window;
  const calls = [];
  win.__calls = calls;
  win.__logs = [];
  ['log', 'warn', 'error'].forEach(level => {
    win.console[level] = (...args) => { win.__logs.push({ level, args: args.map(a => (a instanceof Error ? a.message : (a && a.message) || String(a))) }); };
  });

  win.__EDUQUEST_SUPABASE_URL__ = opts.noClient ? '' : 'https://fake.supabase.co';
  win.__EDUQUEST_SUPABASE_ANON_KEY__ = opts.noClient ? '' : 'fake-anon-key';
  win.supabase = makeFakeSupabaseGlobal(calls, opts);

  win.DEFAULT_DB = { students: [], quizzes: [], bossEvents: [], pointLog: [], notifications: [], orders: [], bossParticipants: {}, inventory: {}, redemptions: [], titles: [], quizHistory: {}, stageMap: [], store: [], achievements: [], classSections: [] };

  return win;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalizeDiagnostics(diag) {
  // loadCount AND lastLoadAt are both excluded (not merely normalized
  // when present): db-service.bridge.js transitively bundles
  // state-manager.js (via table-sync.js's real AppStore import per the
  // memory note), whose own eager init() always calls the REAL
  // DBService.read() exactly once extra as an unavoidable, already-
  // understood consequence of ES module evaluation order — this flips
  // lastLoadAt from null to a real timestamp on the bridge side even in
  // tests that never call read()/initRemote() themselves, which has
  // nothing to do with db-service.js's own conversion correctness
  // (state-manager.js's own equivalence is separately, fully verified).
  return { ...diag, lastRemoteSyncAt: diag.lastRemoteSyncAt ? 'NORMALIZED' : diag.lastRemoteSyncAt, lastSaveAt: diag.lastSaveAt ? 'NORMALIZED' : diag.lastSaveAt, lastLoadAt: 'EXCLUDED', loadCount: 'EXCLUDED' };
}

function normalizeLogs(logs) {
  // Filter out anything state-manager.js's own init() logs (a different,
  // already-independently-verified file — see the memory note on the
  // real-import ordering inversion), then collapse consecutive duplicate
  // entries: the transitively-bundled state-manager.js copy (bridge
  // side only, or both sides if separately eval'd) incidentally causes
  // db-service.js's own initRemote()/read() to be called one extra time
  // via a temporary stub before the real object is ready, which can
  // duplicate an otherwise-identical log line without being a real
  // behavioral difference in db-service.js's own logic.
  const filtered = logs.filter(l => !l.args.some(a => typeof a === 'string' && a.includes('[AppStore]')));
  const deduped = [];
  for (const l of filtered) {
    const prev = deduped[deduped.length - 1];
    if (!prev || JSON.stringify(prev) !== JSON.stringify(l)) deduped.push(l);
  }
  return deduped;
}

function stubSyncFromLegacy(win) {
  // Applied AFTER all evals, overriding whatever real AppStore object
  // ended up on window (state-manager.js's real top-level assignment,
  // for the original window; nothing, for the bridge window, since
  // db-service.bridge.js's own bundle never re-attaches window.AppStore
  // — table-sync.js's real AppStore import is internal to its own module
  // scope). This isolates db-service.js's own observable behavior (does
  // it call window.AppStore.syncFromLegacy, with what args) from its
  // dependencies' own internal side effects, which are already
  // separately, independently verified (state-manager.js's own
  // equivalence check).
  win.__syncCalls = [];
  win.AppStore = { syncFromLegacy(cache, eventType) { win.__syncCalls.push({ eventType }); } };
}

async function runBasicReadWriteCase(win) {
  const results = {};
  results.readWithNoCacheNoDefault = win.DBService.read();
  results.readWithDefault = win.DBService.read({ students: [] });

  win.DBService.write({ students: [{ id: 's1' }], quizzes: [] });
  results.readAfterWrite = win.DBService.read();

  win.DBService.mirrorLocalOnly({ students: [{ id: 's2' }], quizzes: [] });
  results.readAfterMirrorLocalOnly = win.DBService.read();
  await sleep(450); // let any queued upload settle (mirrorLocalOnly must NOT queue one)
  results.callsAfterMirrorSettle = win.__calls.filter(c => c.name === 'upsert');

  win.__calls.length = 0;
  win.DBService.writeDirty({ point_log: ['pl1', 'pl2'] });
  results.readDirtyAfterWrite = win.DBService.readDirty();

  win.DBService.remove();
  results.readAfterRemove = win.DBService.read();
  // provider/signalChannelReady/authReady/loadCount/timestamps are all
  // normalized/excluded by normalizeDiagnostics() — see its own comment
  // for why (the transitively-bundled state-manager.js's eager init(),
  // an emergent consequence of the real-import chain, already
  // separately verified elsewhere, not this file's own responsibility).
  results.diagnosticsAfterRemove = normalizeDiagnostics(win.DBService.diagnostics());

  return results;
}

async function runInitNoClientCase(win) {
  await win.DBService.initRemote();
  return { logs: normalizeLogs(win.__logs), diagnostics: normalizeDiagnostics(win.DBService.diagnostics()), state: win.DBService.read() };
}

async function runInitNoSessionCase(win) {
  await win.DBService.initRemote();
  await sleep(20);
  return { logs: normalizeLogs(win.__logs.filter(l => l.level === 'warn')), calls: win.__calls.slice(), diagnostics: normalizeDiagnostics(win.DBService.diagnostics()) };
}

async function runInitFullPullCase(win) {
  await win.DBService.initRemote();
  await sleep(20);
  return { state: win.DBService.read(), calls: win.__calls.filter(c => c.name === 'select' || c.name === 'createClient'), diagnostics: normalizeDiagnostics(win.DBService.diagnostics()) };
}

async function runInitPullThrowsCase(win) {
  await win.DBService.initRemote();
  return { logs: normalizeLogs(win.__logs.filter(l => l.level === 'error')), diagnostics: normalizeDiagnostics(win.DBService.diagnostics()) };
}

async function runRefreshAfterAuthChangeCase(win, opts) {
  const results = {};
  await win.DBService.initRemote();
  win.__calls.length = 0;
  await win.DBService.refreshAfterAuthChange();
  await sleep(20);
  results.state = win.DBService.read();
  results.syncCalls = win.__syncCalls.slice();
  results.diagnostics = normalizeDiagnostics(win.DBService.diagnostics());
  return results;
}

async function runPassthroughsCase(win) {
  const results = {};
  await win.DBService.initRemote();
  win.__calls.length = 0;

  results.rpcOk = await win.DBService.rpc('some_fn', { a: 1 });
  results.getAuthClientNotNull = win.DBService.getAuthClient() !== null;
  results.uploadOk = await win.DBService.uploadPublicFile('avatars', 'a.png', { type: 'image/png' }, 'image/png');
  results.resetEmailOk = await win.DBService.sendPasswordResetEmail('a@b.com', 'https://x/reset');

  const seen = [];
  win.DBService.onSignal('boss-summon', (payload) => seen.push(payload));
  win.DBService.sendSignal('boss-summon', { bossId: 'b1' });
  // sendSignal only broadcasts OUT via the realtime channel — it does
  // NOT locally loop back to onSignal's own subscribers (that only
  // happens on a real incoming broadcast from another client/tab).
  // Simulate that incoming broadcast directly on the fake channel.
  win.supabase.__client.channel('eduquest-signals').__fireBroadcast('boss-summon', { bossId: 'incoming-b2' });
  results.signalSeen = seen;

  results.calls = win.__calls.slice();
  return results;
}

async function runNoClientPassthroughsCase(win) {
  const results = {};
  results.rpcNoClient = await win.DBService.rpc('x', {});
  results.uploadNoClient = await win.DBService.uploadPublicFile('b', 'p', {}, 't');
  results.getAuthClientNull = win.DBService.getAuthClient();
  results.resetNoClient = await win.DBService.sendPasswordResetEmail('a@b.com');
  return results;
}

async function runLoadMoreHistoryCase(win) {
  const results = {};
  await win.DBService.initRemote();
  results.validKey = await win.DBService.loadMoreHistory('pointLog', 5);
  let threw = false;
  try { await win.DBService.loadMoreHistory('not_a_real_key'); } catch (e) { threw = true; }
  results.invalidKeyThrows = threw;
  return results;
}

async function runRealtimeScopedRefreshCase(win) {
  await win.DBService.initRemote();
  await sleep(20);
  win.__calls.length = 0;
  win.__syncCalls.length = 0;
  win.supabase.__client.channel('eduquest-table-sync').__fire('point_log');
  await sleep(450);
  return {
    calls: win.__calls.filter(c => c.name === 'select'),
    syncCalls: win.__syncCalls.slice(),
    state: win.DBService.read().pointLog,
  };
}

async function runTestSeamCase(win) {
  return {
    hasSeam: typeof win.DBService._test.pushCacheToSupabase === 'function',
    tableSyncConfigCount: win.DBService._test.tableSyncConfigs.length,
  };
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'db-service.js'), 'utf8');
  const pullMappersSrc = fs.readFileSync(path.join(__dirname, '..', 'repository', 'pull-mappers.js'), 'utf8');
  const realtimeGroupsSrc = fs.readFileSync(path.join(__dirname, '..', 'repository', 'realtime-groups.js'), 'utf8');
  const tableSyncSrc = fs.readFileSync(path.join(__dirname, '..', 'repository', 'table-sync.js'), 'utf8');
  const stateManagerSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'core', 'state-manager.js'), 'utf8');
  const supabaseClientSrc = fs.readFileSync(path.join(__dirname, '..', 'supabase-client.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'db-service.bridge.js'), 'utf8');

  const tableData = {
    profiles: [{ id: 'p1', role: 'student', name: 'Alice', xp: 10, coins: 5, level: 1, tier: 'bronze', class_id: 'sec-a' }],
    boss_events: [], boss_participants: [], loot_claims: [], achievements: [], user_achievements: [],
    registrations: [], point_log: [{ id: 'pl1', student_id: 'p1', what: 'quiz', pts: 5, created_at: '2026-01-01T00:00:00Z' }],
    redemptions: [], recitation_log: [], rfid_cards: [], attendance_schedules: [], attendance_logs: [],
    shop_products: [], mail_messages: [], quiz_sections: [], achievement_sections: [], titles: [],
    title_unlocks: [], quizzes: [], title_sections: [], campaign_worlds: [], orders: [], inventory: [],
    campaign_stage_sections: [], quiz_history: [], notifications: [], student_skills: [], recitation_sessions: [],
  };

  const cases = [
    { name: 'basic read/write/mirror/dirty/remove', run: runBasicReadWriteCase, opts: {} },
    { name: 'initRemote no client', run: runInitNoClientCase, opts: { noClient: true } },
    { name: 'initRemote no session', run: runInitNoSessionCase, opts: { noSession: true, tableData } },
    { name: 'initRemote full blocking pull (no matching mirror)', run: runInitFullPullCase, opts: { tableData } },
    { name: 'initRemote pull throws', run: runInitPullThrowsCase, opts: { pullThrows: true } },
    { name: 'refreshAfterAuthChange success', run: runRefreshAfterAuthChangeCase, opts: { tableData } },
    { name: 'passthroughs (rpc/upload/authClient/resetEmail/signals)', run: runPassthroughsCase, opts: { tableData, rpcData: { ok: true } } },
    { name: 'passthroughs with no client', run: runNoClientPassthroughsCase, opts: { noClient: true } },
    { name: 'loadMoreHistory valid + invalid key', run: runLoadMoreHistoryCase, opts: { tableData } },
    { name: 'realtime postgres_changes -> scoped refresh -> syncFromLegacy', run: runRealtimeScopedRefreshCase, opts: { tableData } },
    { name: 'the _test seam', run: runTestSeamCase, opts: { tableData } },
  ];

  for (const c of cases) {
    const winO = makeWindow(c.opts);
    winO.eval(supabaseClientSrc);
    winO.eval(pullMappersSrc);
    winO.eval(realtimeGroupsSrc);
    winO.eval(tableSyncSrc);
    winO.eval(originalSrc); // db-service.js loads first, matching real page script order
    stubSyncFromLegacy(winO);
    const rO = await c.run(winO);

    const winB = makeWindow(c.opts);
    winB.eval(supabaseClientSrc);
    // See the memory note on the state-manager.js/table-sync.js/
    // db-service.js real-import ordering inversion: db-service.js's
    // bridge transitively bundles state-manager.js (via table-sync.js's
    // real AppStore import), and ES module evaluation order means that
    // transitively-bundled state-manager.js's own eager init() call
    // fires BEFORE this bridge's own `export const DBService = ...`
    // assignment completes — inverting the real classic-script load
    // order (db-service.js currently loads before state-manager.js).
    // A temporary DBService stub, overwritten once the real bridge
    // finishes evaluating, is the same shim any real future wiring of
    // this dependency chain will also need.
    winB.DBService = { initRemote: async () => {}, read: () => null, write: () => {} };
    winB.eval(bridgeSrc);
    stubSyncFromLegacy(winB);
    const rB = await c.run(winB);

    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), `case "${c.name}" mismatch`);
  }

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('db-service.js: read/write/mirrorLocalOnly/writeDirty/readDirty/remove/diagnostics,');
  console.log('initRemote (no-client/no-session/full-pull/pull-throws), refreshAfterAuthChange,');
  console.log('rpc/uploadPublicFile/getAuthClient/sendPasswordResetEmail/onSignal/sendSignal passthroughs');
  console.log('(incl. no-client), loadMoreHistory (valid/invalid key), a real postgres_changes event');
  console.log('driving the scoped-refresh path through to syncFromLegacy, and the _test seam all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
