'use strict';
// Phase 5 — Data Layer Redesign, sub-phase B (Delta/patch sync):
// redemptions, the sixth table converted. Append-only, same shape as
// point_log (the first table converted) — no new mechanism, just the
// config addition. See point-log-delta-sync.test.js for the fuller
// rationale behind each of these four shapes; not re-derived here.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadDbServiceWindow, loadAppStoreWindow, makeFakeSupabaseClient } = require('./helpers/load-globals');

function dj(arr) { return Array.from(arr); }

function teacherSession(extra) {
  return Object.assign({ currentUser: { id: 't1', role: 'teacher' }, currentRole: 'teacher', classSections: [] }, extra);
}

function redemption(overrides) {
  return Object.assign({ orderId: 'r1', studentId: 's1', itemId: 'i1', itemName: 'Pencil', emoji: '✏️', item: 'Pencil', pts: 50, date: '2026-08-01', time: '10:00', claimCode: 'C1' }, overrides);
}

test('redemptions delta sync: pushes only the dirty subset, and clears exactly the ids it successfully pushed', async () => {
  const dirtyIds = { redemptions: ['r2'] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  const cache = { redemptions: [redemption({ orderId: 'r1' }), redemption({ orderId: 'r2' })] };
  await loaded.DBService._test.pushCacheToSupabase(client, cache);

  const call = calls.find(c => c.table === 'redemptions');
  assert.ok(call);
  assert.equal(call.rows.length, 1);
  assert.equal(call.rows[0].order_id, 'r2');
  assert.deepEqual(dj(loaded.win.clearDirtyCalls), [{ table: 'redemptions', ids: ['r2'] }]);
});

test('redemptions delta sync: an explicit empty dirty array skips the push entirely', async () => {
  const dirtyIds = { redemptions: [] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  await loaded.DBService._test.pushCacheToSupabase(client, { redemptions: [redemption()] });

  assert.ok(!calls.some(c => c.table === 'redemptions'));
  assert.deepEqual(dj(loaded.win.clearDirtyCalls), []);
});

test('redemptions delta sync: a failed push leaves its ids dirty so the next cycle retries them', async () => {
  const dirtyIds = { redemptions: ['r1'] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const client = makeFakeSupabaseClient((table) => {
    if (table === 'redemptions') return { error: { code: '42501', message: 'RLS denied' } };
    return { error: null };
  });
  await loaded.DBService._test.pushCacheToSupabase(client, { redemptions: [redemption()] });

  assert.deepEqual(dj(loaded.win.clearDirtyCalls), []);
});

test('no-clobber: two sessions each dirtying a different redemption entry both survive independent push cycles', async () => {
  const sessionA = loadAppStoreWindow();
  const sessionB = loadAppStoreWindow();
  await sessionA.AppStore.ready;
  await sessionB.AppStore.ready;

  sessionA.AppStore.updateState((draft) => { draft.redemptions.push(redemption({ orderId: 'r-a' })); });
  sessionB.AppStore.updateState((draft) => { draft.redemptions.push(redemption({ orderId: 'r-b' })); });

  const serverCalls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { serverCalls.push({ table, rows, opts }); });

  const dbA = loadDbServiceWindow(teacherSession());
  dbA.win.AppStore.getDirtyIds = (t) => sessionA.AppStore.getDirtyIds(t);
  dbA.win.AppStore.clearDirty = (t, ids) => sessionA.AppStore.clearDirty(t, ids);
  await dbA.DBService._test.pushCacheToSupabase(client, { redemptions: sessionA.AppStore.getState().redemptions });

  const dbB = loadDbServiceWindow(teacherSession());
  dbB.win.AppStore.getDirtyIds = (t) => sessionB.AppStore.getDirtyIds(t);
  dbB.win.AppStore.clearDirty = (t, ids) => sessionB.AppStore.clearDirty(t, ids);
  await dbB.DBService._test.pushCacheToSupabase(client, { redemptions: sessionB.AppStore.getState().redemptions });

  const redemptionCalls = serverCalls.filter(c => c.table === 'redemptions');
  assert.equal(redemptionCalls.length, 2);
  assert.deepEqual(dj(redemptionCalls[0].rows.map(r => r.order_id)), ['r-a']);
  assert.deepEqual(dj(redemptionCalls[1].rows.map(r => r.order_id)), ['r-b']);
});
