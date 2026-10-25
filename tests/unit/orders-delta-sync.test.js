'use strict';
// Phase 5 — Data Layer Redesign, sub-phase B (Delta/patch sync):
// orders, the third table converted.
//
// Same three shapes as point_log's and notifications' suites (dirty-subset
// push, empty-dirty skip, failed-push-stays-dirty — not re-derived here).
// What's NEW: orders is the first delta-tracked table where several
// columns change together as one transition (status/claimed_at/claimed_by
// via a staff claim, or cancelled_at/cancel_reason/cancelled_by via a
// self-cancel), rather than a single boolean, so the no-clobber test below
// proves a stale whole-row push can't revert that whole bundle at once —
// not just one field.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadDbServiceWindow, loadAppStoreWindow, makeFakeSupabaseClient } = require('./helpers/load-globals');

function dj(arr) { return Array.from(arr); }

function teacherSession(extra) {
  return Object.assign({ currentUser: { id: 't1', role: 'teacher' }, currentRole: 'teacher', classSections: [] }, extra);
}

function baseOrder(overrides) {
  return Object.assign({
    orderId: 'o1', studentId: 's1', studentName: 'Alex', studentInit: 'A', studentColor: '#fff',
    itemId: 'i1', itemName: 'Pencil', emoji: '✏️', cost: 100, category: 'supplies', claimCode: 'C1',
    status: 'pending', createdAt: 1000, createdDateStr: '2026-08-01',
    claimedAt: null, claimedBy: null, cancelledAt: null, cancelReason: null, cancelledBy: null,
  }, overrides);
}

test('orders delta sync: pushes only the dirty subset, and clears exactly the ids it successfully pushed', async () => {
  const dirtyIds = { orders: ['o2'] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  const cache = {
    orders: [
      baseOrder({ orderId: 'o1' }),
      baseOrder({ orderId: 'o2', status: 'claimed', claimedAt: 2000, claimedBy: 't1' }),
    ],
  };
  await loaded.DBService._test.pushCacheToSupabase(client, cache);

  const call = calls.find(c => c.table === 'orders');
  assert.ok(call, 'orders should still have been pushed — it had one dirty row');
  assert.equal(call.rows.length, 1);
  assert.equal(call.rows[0].order_id, 'o2');
  assert.equal(call.rows[0].status, 'claimed');
  assert.deepEqual(loaded.win.clearDirtyCalls, [{ table: 'orders', ids: ['o2'] }]);
});

test('orders delta sync: an explicit empty dirty array skips the push entirely', async () => {
  const dirtyIds = { orders: [] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  await loaded.DBService._test.pushCacheToSupabase(client, { orders: [baseOrder()] });

  assert.ok(!calls.some(c => c.table === 'orders'), 'no orders upsert should fire when nothing is dirty');
  assert.deepEqual(loaded.win.clearDirtyCalls, []);
});

test('orders delta sync: a failed push leaves its ids dirty so the next cycle retries them', async () => {
  const dirtyIds = { orders: ['o1'] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const client = makeFakeSupabaseClient((table) => {
    if (table === 'orders') return { error: { code: '42501', message: 'RLS denied' } };
    return { error: null };
  });
  await loaded.DBService._test.pushCacheToSupabase(client, { orders: [baseOrder({ status: 'claimed' })] });

  assert.deepEqual(loaded.win.clearDirtyCalls, [], 'clearDirty must not be called when the upsert reported an error');
});

test("no-clobber: a stale session's whole-row push cannot revert another session's multi-field claim transition on an order it never touched", async () => {
  // Session A (staff, POS terminal) claims o1: status/claimed_at/claimed_by
  // all change together as one bundle. Session B — a second staff tab that
  // never pulled A's claim, so its local o1 is still 'pending' with no
  // claimed_at/claimed_by — independently checks out a brand-new order o2
  // (an unrelated cartCheckout) and pushes its own cycle. Before delta
  // sync, B's whole-slice push would have re-sent its stale o1 (status
  // still 'pending', claimed_at/claimed_by still null) right alongside o2,
  // silently un-claiming an order the moment B's cart-checkout push landed
  // — reverting THREE columns at once, not just one flag.
  const seed = [baseOrder({ orderId: 'o1' })];
  const sessionA = loadAppStoreWindow({ orders: seed.map(o => Object.assign({}, o)) });
  const sessionB = loadAppStoreWindow({ orders: seed.map(o => Object.assign({}, o)) });
  await sessionA.AppStore.ready;
  await sessionB.AppStore.ready;

  sessionA.AppStore.updateState((draft) => {
    const o1 = draft.orders.find(o => o.orderId === 'o1');
    o1.status = 'claimed';
    o1.claimedAt = 5000;
    o1.claimedBy = 't1';
  });
  const serverCalls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { serverCalls.push({ table, rows, opts }); });
  const dbA = loadDbServiceWindow(teacherSession());
  dbA.win.AppStore.getDirtyIds = (t) => sessionA.AppStore.getDirtyIds(t);
  dbA.win.AppStore.clearDirty = (t, ids) => sessionA.AppStore.clearDirty(t, ids);
  await dbA.DBService._test.pushCacheToSupabase(client, { orders: sessionA.AppStore.getState().orders });

  sessionB.AppStore.updateState((draft) => {
    draft.orders.push(baseOrder({ orderId: 'o2', studentId: 's2', createdAt: 6000 }));
  });
  const dbB = loadDbServiceWindow(teacherSession());
  dbB.win.AppStore.getDirtyIds = (t) => sessionB.AppStore.getDirtyIds(t);
  dbB.win.AppStore.clearDirty = (t, ids) => sessionB.AppStore.clearDirty(t, ids);
  await dbB.DBService._test.pushCacheToSupabase(client, { orders: sessionB.AppStore.getState().orders });

  const orderCalls = serverCalls.filter(c => c.table === 'orders');
  assert.equal(orderCalls.length, 2, 'each session pushes its own cycle independently');
  assert.deepEqual(dj(orderCalls[0].rows.map(r => r.order_id)), ['o1'], "session A's push must only touch o1");
  assert.deepEqual(dj(orderCalls[1].rows.map(r => r.order_id)), ['o2'],
    "session B's push must only touch its own new o2 — its stale local o1 must NOT be re-sent");

  const o1Writes = orderCalls.flatMap(c => c.rows).filter(r => r.order_id === 'o1');
  assert.equal(o1Writes.length, 1);
  assert.equal(o1Writes[0].status, 'claimed', "o1's claimed status from session A must survive session B's later, unrelated push");
  assert.equal(o1Writes[0].claimed_by, 't1');
});
