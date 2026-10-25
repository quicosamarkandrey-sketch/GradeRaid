// Phase 7 (Stream D) — equivalence check for
// modules/seat-arrangement/classroom_index.js.
//
// Real-imports AppStore (state-manager.js) and DBService (db-service.js —
// the multi-hop chain from classroom-service.js, file 4/30).
// DBService.getAuthClient() -> SupabaseClient.getClient() (bare global) is
// mocked with a client exposing `.from(table).select().order()` (queued,
// per-table, per-call responses with a configurable artificial delay — used
// to construct the stale-response race deterministically) and
// `.channel(name).on(event,filter,cb).subscribe(statusCb)` (records every
// registered postgres_changes callback so a realtime event can be
// simulated by invoking it directly, and calls statusCb('SUBSCRIBED')
// synchronously).
//
// LOAD-TIME AUTOMATIC BOOTSTRAP: as soon as AppStore.ready resolves, the
// file itself calls _bootstrapClassroomData().then(_setupClassroomRealtime)
// with no test involvement — the mock's queue must already hold each
// table's FIRST response before eval'ing the file at all.
//
// What's compared: the initial automatic bootstrap + realtime-subscribe
// (incl. its 3 registered table filters), refreshClassroomData's manual
// re-trigger (success, RPC-error non-fatal catch, no-client "offline"
// branch), the stale-response race (an earlier, slower call's result must
// be discarded once a later call has already started), a simulated
// realtime postgres_changes event triggering the 400ms-debounced refresh
// (including debounce COALESCING — two events within 400ms produce only
// one refresh), and _classroomIndexTeardown (unsubscribe + timer clear,
// including a second, harmless no-op call).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeMockClient(win) {
  win.__fromQueue = { classroom_layouts: [], seats: [], seat_assignments: [] };
  win.__channelOns = [];
  win.__unsubscribeCalls = 0;
  win.__channelCalls = [];
  const pop = table => {
    const q = win.__fromQueue[table];
    if (!q || !q.length) throw new Error('no queued response for table: ' + table);
    return q.shift();
  };
  return {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: table => ({
      // The real code awaits `.select('*')` directly for seats/seat_assignments
      // but chains `.order(...)` for classroom_layouts — so select() must return
      // a thenable that ALSO exposes .order(). Each await/order() pops exactly one
      // queued response for that table.
      select: () => {
        const fetchOne = () => new Promise(resolve => {
          const { data, error, delayMs } = pop(table);
          setTimeout(() => resolve({ data, error: error || null }), delayMs || 0);
        });
        return {
          order: fetchOne,
          then: (res, rej) => fetchOne().then(res, rej),
        };
      },
    }),
    channel: name => {
      win.__channelCalls.push(name);
      const chain = {
        on: (event, filter, cb) => { win.__channelOns.push({ event, filter, cb }); return chain; },
        subscribe: statusCb => { if (typeof statusCb === 'function') statusCb('SUBSCRIBED'); return { unsubscribe: () => { win.__unsubscribeCalls++; } }; },
      };
      return chain;
    },
  };
}

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  win.DEFAULT_DB = { classroomLayouts: [], seats: [], seatAssignments: [] };
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };
  win.__EDUQUEST_SUPABASE_URL__ = '';
  win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };
  win.__offline = false;
  const client = makeMockClient(win);
  win.SupabaseClient = { getClient: () => (win.__offline ? null : client), resolveProvider: () => 'supabase' };
  win.ClassroomService = {};
  win.renderClassroomBuilder = function () {};
  win.renderStudentSeating = function () {};
  win.unmountClassroomBuilder = function () {};

  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  win.console.info = (...a) => logs.push('INFO ' + a.join(' '));
  win.console.warn = (...a) => logs.push('WARN ' + a.join(' '));
  win.console.error = (...a) => logs.push('ERROR ' + a.join(' '));
  return { win, logs };
}

function queueInitial(win) {
  win.__fromQueue.classroom_layouts.push({ data: [{ id: 'L1', class_id: 'c1', name: 'Room A', room_data: [], shape: 'custom', walkway_preset: 'traditional', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }] });
  win.__fromQueue.classroom_layouts[0].data.push({ id: 'L0', class_id: 'c0', name: 'Bare', room_data: null, shape: null, walkway_preset: null, created_at: '2026-01-02T00:00:00.000Z', updated_at: null }); // every || default
  win.__fromQueue.seats.push({ data: [
    { id: 's1', layout_id: 'L1', x_coord: 0, y_coord: 0, rotation: 0, label: null, is_locked: false },
    { id: 's2', layout_id: 'L1', x_coord: 5, y_coord: 6, rotation: null, label: '', is_locked: null },   // rotation||0, label||null, !!null
    { id: 's3', layout_id: 'L1', x_coord: 7, y_coord: 8, rotation: 90, label: 'A1', is_locked: 1 },      // !!1 -> true
  ] });
  win.__fromQueue.seat_assignments.push({ data: [
    { id: 'a1', seat_id: 's1', layout_id: 'L1', student_id: 'st1', assigned_at: '2026-01-03T00:00:00.000Z', assigned_by: '' },   // '' -> || null gives null (null alone wouldn't distinguish)
    { id: 'a2', seat_id: 's2', layout_id: 'L1', student_id: 'st2', assigned_at: '2026-01-03T00:00:00.000Z', assigned_by: 't1' },
  ] });
}

async function evalOriginal(win) {
  queueInitial(win);
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  win.eval(read('repository/table-sync.js'));
  win.eval(read('repository/pull-mappers.js'));
  win.eval(read('repository/realtime-groups.js'));
  win.eval(read('db-service.js'));
  win.eval(read('modules/core/state-manager.js'));
  win.eval(read('modules/seat-arrangement/classroom_index.js'));
  await win.AppStore.ready;
}
async function evalBridge(win) {
  queueInitial(win);
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'classroom_index-combined-bundle.js'), 'utf8'));
  await win.AppStore.ready;
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v).replace(ISO, '<ISO>'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(win, logs) {
  const out = {};

  // the 3 exports on window, with their kinds and the version constant's value
  out.exportsOnWindow = {
    version: win.__CLASSROOM_MODULE_VERSION__,
    refreshKind: typeof win.refreshClassroomData,
    teardownKind: typeof win._classroomIndexTeardown,
  };

  // wait for the automatic load-time bootstrap + realtime-subscribe chain
  await sleep(50);
  out.initialState = clean(win.AppStore.getSlice(s => ({ layouts: s.classroomLayouts, seats: s.seats, assignments: s.seatAssignments })));
  // Scope to THIS file's own channel/tables: the original side's real
  // db-service.js initRemote() ALSO registers its own channels/tables
  // (eduquest-signals, eduquest-table-sync, profiles, ...), which the bridge
  // side's stand-in DBService never does — a harness artefact, not behavior.
  const CLASSROOM_TABLES = ['classroom_layouts', 'seats', 'seat_assignments'];
  const classroomOns = () => win.__channelOns.filter(o => o.filter && CLASSROOM_TABLES.includes(o.filter.table));
  out.initialChannelCalls = clean(win.__channelCalls.filter(n => n === 'eduquest-classroom-sync'));
  out.initialOnTables = clean(classroomOns().map(o => o.filter.table));

  // ── manual refreshClassroomData: success with different data ──
  win.__fromQueue.classroom_layouts.push({ data: [{ id: 'L2', class_id: 'c2', name: 'Room B', room_data: [], shape: 'grid', walkway_preset: 'traditional', created_at: '2026-02-01T00:00:00.000Z', updated_at: '2026-02-01T00:00:00.000Z' }] });
  win.__fromQueue.seats.push({ data: [] });
  win.__fromQueue.seat_assignments.push({ data: [] });
  await win.refreshClassroomData();
  out.afterManualRefresh = clean(win.AppStore.getSlice(s => s.classroomLayouts));

  // ── RPC error path: one table errors -> non-fatal, state left as-is ──
  win.__fromQueue.classroom_layouts.push({ data: null, error: { message: 'RLS violation' } });
  win.__fromQueue.seats.push({ data: [] });
  win.__fromQueue.seat_assignments.push({ data: [] });
  await win.refreshClassroomData();
  out.afterErrorState = clean(win.AppStore.getSlice(s => s.classroomLayouts));

  // ── offline branch: no client -> early return, no throw, state unchanged ──
  win.__offline = true;
  await win.refreshClassroomData();
  out.afterOfflineState = clean(win.AppStore.getSlice(s => s.classroomLayouts));
  win.__offline = false;

  // ── stale-response race: call A (slow) starts, call B (fast) starts
  // before A resolves and finishes first -> A's late result must be
  // discarded, B's must win ──
  win.__fromQueue.classroom_layouts.push({ data: [{ id: 'STALE_A', class_id: 'c1', name: 'From A', room_data: [], shape: 'custom', walkway_preset: 'traditional', created_at: '<ISO>', updated_at: '<ISO>' }], delayMs: 120 });
  win.__fromQueue.seats.push({ data: [], delayMs: 120 });
  win.__fromQueue.seat_assignments.push({ data: [], delayMs: 120 });
  const callA = win.refreshClassroomData();
  win.__fromQueue.classroom_layouts.push({ data: [{ id: 'FRESH_B', class_id: 'c1', name: 'From B', room_data: [], shape: 'custom', walkway_preset: 'traditional', created_at: '<ISO>', updated_at: '<ISO>' }], delayMs: 10 });
  win.__fromQueue.seats.push({ data: [], delayMs: 10 });
  win.__fromQueue.seat_assignments.push({ data: [], delayMs: 10 });
  const callB = win.refreshClassroomData();
  await Promise.all([callA, callB]);
  out.afterRace = clean(win.AppStore.getSlice(s => s.classroomLayouts));

  // ── simulated realtime event: debounced 400ms refresh, with coalescing ──
  win.__fromQueue.classroom_layouts.push({ data: [{ id: 'RT1', class_id: 'c1', name: 'Realtime Update', room_data: [], shape: 'custom', walkway_preset: 'traditional', created_at: '<ISO>', updated_at: '<ISO>' }] });
  win.__fromQueue.seats.push({ data: [] });
  win.__fromQueue.seat_assignments.push({ data: [] });
  const onCb = classroomOns()[0].cb; // any of this file's 3 registered callbacks schedules the same debounced refresh
  onCb({}); // first event
  await sleep(150);
  onCb({}); // second event within the 400ms window -> must coalesce to ONE refresh, not two
  out.midDebounce = clean(win.AppStore.getSlice(s => s.classroomLayouts)); // still the pre-event data at this point
  await sleep(450);
  out.afterDebouncedRefresh = clean(win.AppStore.getSlice(s => s.classroomLayouts));
  out.queueDrainedByExactlyOneRefresh = { layouts: win.__fromQueue.classroom_layouts.length, seats: win.__fromQueue.seats.length, assignments: win.__fromQueue.seat_assignments.length };

  // ── teardown ──
  win._classroomIndexTeardown();
  out.unsubscribeCallsAfterFirstTeardown = win.__unsubscribeCalls;
  win._classroomIndexTeardown(); // second call: must be a harmless no-op
  out.unsubscribeCallsAfterSecondTeardown = win.__unsubscribeCalls;
  // a realtime event fired AFTER teardown must not schedule anything that
  // could still mutate state (the channel itself is gone, but prove the
  // debounce timer doesn't fire something stale by trying a manual refresh
  // right after and confirming it still behaves normally, not double-fired)
  win.__fromQueue.classroom_layouts.push({ data: [{ id: 'AFTER_TEARDOWN', class_id: 'c1', name: 'X', room_data: [], shape: 'custom', walkway_preset: 'traditional', created_at: '<ISO>', updated_at: '<ISO>' }] });
  win.__fromQueue.seats.push({ data: [] });
  win.__fromQueue.seat_assignments.push({ data: [] });
  await win.refreshClassroomData();
  out.refreshStillWorksAfterTeardown = clean(win.AppStore.getSlice(s => s.classroomLayouts));
  // every runtime line THIS file logged (bootstrap counts, stale-discard, offline, failures, subscribe)
  out.ownRuntimeLogs = clean(logs.filter(l => l.includes('[ClassroomIndex]')));

  return out;
}

function main() {
  return (async () => {
    const O = makeWindow(), B = makeWindow();
    await evalOriginal(O.win);
    await evalBridge(B.win);

    assert.ok(O.logs.some(l => l.includes('classroom_index.js loaded')));
    assert.ok(O.logs.some(l => l.includes('All exports verified')), 'load-order verification passed with the stubbed dependencies');
    // Compare only what THIS file emits. '[DBService]'/'[AppStore]' init chatter
    // legitimately differs: on the original side the real classic db-service.js
    // runs its initRemote() before state-manager.js's init(); on the bridge side
    // state-manager's init() sees the pre-stubbed stand-in DBService (the real
    // one only overwrites window.DBService once the bundle finishes evaluating).
    const own = logs => logs.filter(l => l.includes('classroom_index.js') || l.includes('[ClassroomIndex]'));
    assert.deepStrictEqual(clean(own(B.logs)), clean(own(O.logs)), "this file's own load-time console output must match");
    assert.strictEqual(own(O.logs).length, 2, 'load-order verification line + trailing banner');

    const oa = await run(O.win, O.logs), ob = await run(B.win, B.logs);
    assert.deepStrictEqual(clean(ob), clean(oa), 'bridge output must exactly match the original at every step');

    // ── hand-computed sanity on the ORIGINAL's output ──
    const o = clean(oa);
    assert.deepStrictEqual(o.initialState.layouts.map(l => l.id), ['L1', 'L0'], 'response order preserved');
    assert.strictEqual(o.initialState.seats.length, 3);
    const [sa, sb, sc] = o.initialState.seats;
    assert.deepStrictEqual([sa.rotation, sa.label, sa.isLocked], [0, null, false]);
    assert.deepStrictEqual([sb.rotation, sb.label, sb.isLocked], [0, null, false], 'rotation||0, label||null, !!null -> false');
    assert.deepStrictEqual([sc.rotation, sc.label, sc.isLocked], [90, 'A1', true], '!!1 -> true');
    const l0 = o.initialState.layouts.find(l => l.id === 'L0');
    assert.deepStrictEqual([l0.roomData, l0.shape, l0.walkwayPreset], [[], 'custom', 'traditional'], 'every || default applied');
    assert.deepStrictEqual(o.exportsOnWindow, { version: '2.0.0', refreshKind: 'function', teardownKind: 'function' });
    assert.strictEqual(o.initialState.assignments.length, 2);
    assert.deepStrictEqual(o.initialState.assignments.map(a => a.assignedBy), [null, 't1'], 'assigned_by || null');
    assert.deepStrictEqual(o.initialChannelCalls, ['eduquest-classroom-sync']);
    assert.deepStrictEqual(o.initialOnTables.sort(), ['classroom_layouts', 'seat_assignments', 'seats']);

    assert.strictEqual(o.afterManualRefresh[0].id, 'L2', 'manual refresh replaced the layouts slice');
    assert.strictEqual(o.afterErrorState[0].id, 'L2', 'an RPC error leaves state exactly as the last successful fetch left it');
    assert.strictEqual(o.afterOfflineState[0].id, 'L2', 'offline (no client) is a silent no-op, state unchanged');

    assert.strictEqual(o.afterRace[0].id, 'FRESH_B', "call B's fresh result wins; call A's late, stale result was discarded");

    assert.strictEqual(o.midDebounce[0].id, 'FRESH_B', 'mid-debounce: the scheduled refresh has not fired yet, state is still the pre-event value');
    assert.strictEqual(o.afterDebouncedRefresh[0].id, 'RT1', 'the debounced refresh eventually applied the queued realtime-triggered data');
    assert.deepStrictEqual(o.queueDrainedByExactlyOneRefresh, { layouts: 0, seats: 0, assignments: 0 }, 'exactly ONE refresh consumed the queue — two events within 400ms coalesced into a single fetch, not two');

    const rl = o.ownRuntimeLogs.join('\n');
    assert.ok(rl.includes('Bootstrapped — 2 layouts, 3 seats, 2 assignments.'), 'initial counts logged');
    assert.ok(rl.includes('Realtime channel subscribed'), 'SUBSCRIBED status branch logged');
    assert.ok(rl.includes('Bootstrap fetch failed (non-fatal): RLS violation'), 'error path logged as non-fatal');
    assert.ok(rl.includes('offline mode'), 'offline branch logged');
    assert.ok(rl.includes('Discarding stale classroom fetch'), 'stale-guard discard logged');
    assert.strictEqual(o.unsubscribeCallsAfterFirstTeardown, 1);
    assert.strictEqual(o.unsubscribeCallsAfterSecondTeardown, 1, 'a second teardown call is a harmless no-op (guarded by the now-null channel reference)');
    assert.strictEqual(o.refreshStillWorksAfterTeardown[0].id, 'AFTER_TEARDOWN', 'refreshClassroomData itself is independent of the realtime channel and keeps working after teardown');

    console.log('EQUIVALENCE CHECK PASSED');
    console.log('Original classroom_index.js (via the real state-manager/db-service chain) and');
    console.log('the bundled src/ twin (real-imported through the same chain) agree on:');
    console.log(' - the load-order verification banner + the automatic load-time bootstrap');
    console.log('   (AppStore.ready.then(...)) and its chained realtime-channel subscribe');
    console.log(' - refreshClassroomData: success, non-fatal RPC error, and the offline branch');
    console.log(" - the stale-response race guard (a slower, earlier call's result is discarded");
    console.log('   once a later call has already started)');
    console.log(' - the realtime-triggered 400ms debounced refresh, including event coalescing');
    console.log(' - _classroomIndexTeardown: unsubscribe + timer clear, and a harmless double-call');
  })();
}

main().catch(e => { console.error(e); process.exit(1); });
