'use strict';
// Phase 5 — Data Layer Redesign, sub-phase B (Delta/patch sync):
// point_log, the first table converted.
//
// db-service-repository-sync.test.js's existing point_log test still
// covers the "no dirty info available" fallback path (full-slice push,
// unchanged since Phase 5A) — it doesn't need to change for this session,
// since a fake AppStore with no getDirtyIds property is exactly what
// exercises that branch. This file covers what's NEW: _runTableSync()
// actually filtering to the dirty subset when AppStore.getDirtyIds returns
// an array, skipping the push entirely when that array is empty, and the
// no-clobber property required by the Phase 5 doc before converting the
// next table — adapted to point_log's append-only shape (see the test's
// own comment for why "two sessions editing the same row" doesn't apply
// here, and what the equivalent risk is instead).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadDbServiceWindow, loadAppStoreWindow, makeFakeSupabaseClient } = require('./helpers/load-globals');

// See app-store-dirty-tracking.test.js's own comment on this same helper —
// getDirtyIds() returns an array from a jsdom window's realm; Array.from()
// re-homes it here so assert.deepEqual doesn't fail on prototype identity.
function dj(arr) { return Array.from(arr); }

function teacherSession(extra) {
  return Object.assign({ currentUser: { id: 't1', role: 'teacher' }, currentRole: 'teacher', classSections: [] }, extra);
}

test('point_log delta sync: pushes only the dirty subset, and clears exactly the ids it successfully pushed', async () => {
  const dirtyIds = { point_log: ['pl2'] };
  const { DBService, clearDirtyCalls } = (() => {
    const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
    return { DBService: loaded.DBService, clearDirtyCalls: loaded.win.clearDirtyCalls };
  })();
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  const cache = {
    pointLog: [
      { id: 'pl1', studentId: 's1', what: 'not dirty this cycle', pts: 1, when: 't' },
      { id: 'pl2', studentId: 's2', what: 'dirty', pts: 2, when: 't' },
    ],
  };
  await DBService._test.pushCacheToSupabase(client, cache);

  const pointLogCall = calls.find(c => c.table === 'point_log');
  assert.ok(pointLogCall, 'point_log should still have been pushed — it had one dirty row');
  assert.deepEqual(pointLogCall.rows, [{ id: 'pl2', student_id: 's2', what: 'dirty', pts: 2, when_label: 't' }],
    'only the dirty row should be in the payload — pl1 must not be re-sent');
  assert.deepEqual(clearDirtyCalls, [{ table: 'point_log', ids: ['pl2'] }]);
});

test('point_log delta sync: an explicit empty dirty array skips the push entirely (no upsert call, no clearDirty call)', async () => {
  const dirtyIds = { point_log: [] };
  const { DBService, clearDirtyCalls } = (() => {
    const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
    return { DBService: loaded.DBService, clearDirtyCalls: loaded.win.clearDirtyCalls };
  })();
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  const cache = { pointLog: [{ id: 'pl1', studentId: 's1', what: 'nothing dirty', pts: 1, when: 't' }] };
  await DBService._test.pushCacheToSupabase(client, cache);

  assert.ok(!calls.some(c => c.table === 'point_log'), 'no point_log upsert should fire when nothing is dirty');
  assert.deepEqual(clearDirtyCalls, []);
});

test('point_log delta sync: a failed push leaves its ids dirty (no clearDirty call) so the next cycle retries them', async () => {
  const dirtyIds = { point_log: ['pl1'] };
  const { DBService, clearDirtyCalls } = (() => {
    const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
    return { DBService: loaded.DBService, clearDirtyCalls: loaded.win.clearDirtyCalls };
  })();
  const client = makeFakeSupabaseClient((table) => {
    if (table === 'point_log') return { error: { code: '42501', message: 'RLS denied' } };
    return { error: null };
  });
  const cache = { pointLog: [{ id: 'pl1', studentId: 's1', what: 'will fail', pts: 1, when: 't' }] };
  await DBService._test.pushCacheToSupabase(client, cache);

  assert.deepEqual(clearDirtyCalls, [], 'clearDirty must not be called when the upsert reported an error');
});

test('no-clobber: two concurrent sessions each dirtying a different point_log entry both survive independent push cycles', async () => {
  // Adapted from the Phase 5 doc's own no-clobber property ("two concurrent
  // sessions changing different fields on the same entity — verify both
  // survive"). point_log is append-only — a row's fields never change
  // after creation, so there's no same-row-different-field scenario to
  // construct here. The equivalent real risk this table's old whole-slice
  // push carried was two sessions with divergent local pointLog arrays
  // (each missing rows the other has already synced) each pushing their
  // own full snapshot every cycle — harmless for point_log specifically
  // (upsert never deletes), but exactly the shape that DOES clobber a
  // mutable-field table once this same pattern is generalized to one.
  // This test proves the plumbing itself — dirty-scoped pushes, cleared
  // independently per session — before that generalization happens.
  const sessionA = loadAppStoreWindow();
  const sessionB = loadAppStoreWindow();
  await sessionA.AppStore.ready;
  await sessionB.AppStore.ready;

  sessionA.AppStore.updateState((draft) => {
    draft.pointLog.push({ id: 'pl-a', studentId: 's1', what: 'From session A', pts: 5, when: 'today' });
  });
  sessionB.AppStore.updateState((draft) => {
    draft.pointLog.push({ id: 'pl-b', studentId: 's2', what: 'From session B', pts: 3, when: 'today' });
  });

  const serverCalls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { serverCalls.push({ table, rows, opts }); });

  const dbA = loadDbServiceWindow(teacherSession());
  dbA.win.AppStore.getDirtyIds = (t) => sessionA.AppStore.getDirtyIds(t);
  dbA.win.AppStore.clearDirty = (t, ids) => sessionA.AppStore.clearDirty(t, ids);
  await dbA.DBService._test.pushCacheToSupabase(client, { pointLog: sessionA.AppStore.getState().pointLog });

  const dbB = loadDbServiceWindow(teacherSession());
  dbB.win.AppStore.getDirtyIds = (t) => sessionB.AppStore.getDirtyIds(t);
  dbB.win.AppStore.clearDirty = (t, ids) => sessionB.AppStore.clearDirty(t, ids);
  await dbB.DBService._test.pushCacheToSupabase(client, { pointLog: sessionB.AppStore.getState().pointLog });

  const pointLogCalls = serverCalls.filter(c => c.table === 'point_log');
  assert.equal(pointLogCalls.length, 2, 'each session pushes its own cycle independently');
  assert.deepEqual(
    pointLogCalls[0].rows,
    [{ id: 'pl-a', student_id: 's1', what: 'From session A', pts: 5, when_label: 'today' }],
    "session A's push must contain only its own dirty row, never session B's"
  );
  assert.deepEqual(
    pointLogCalls[1].rows,
    [{ id: 'pl-b', student_id: 's2', what: 'From session B', pts: 3, when_label: 'today' }],
    "session B's push must contain only its own dirty row, never session A's"
  );

  assert.deepEqual(dj(sessionA.AppStore.getDirtyIds('point_log')), [], "session A's dirty id cleared after its own confirmed push");
  assert.deepEqual(dj(sessionB.AppStore.getDirtyIds('point_log')), [], "session B's dirty id cleared after its own confirmed push");
});
