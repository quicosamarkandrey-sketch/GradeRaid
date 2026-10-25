'use strict';
// Phase 5 — Data Layer Redesign, sub-phase B (Delta/patch sync):
// shop_products, the twelfth table converted. Flat array, teacher-owned
// catalog rows — same pattern as titles/quizzes. `stock` deliberately
// isn't in buildRows' output (RPC-only), so no watchFields scoping is
// needed here the way profiles needed it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadDbServiceWindow, loadAppStoreWindow, makeFakeSupabaseClient } = require('./helpers/load-globals');

function dj(arr) { return Array.from(arr); }

function teacherSession(extra) {
  return Object.assign({ currentUser: { id: 't1', role: 'teacher' }, currentRole: 'teacher', classSections: [] }, extra);
}

function product(overrides) {
  return Object.assign({ id: 'p1', ownerTeacherId: 't1', name: 'Sticker', emoji: '⭐', desc: 'd', cat: 'cosmetic', cost: 50, active: true, stock: 10 }, overrides);
}

test('shop_products delta sync: pushes only the dirty subset, and clears exactly the ids it successfully pushed', async () => {
  const dirtyIds = { shop_products: ['p2'] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  const cache = { store: [product({ id: 'p1' }), product({ id: 'p2', name: 'Pencil' })] };
  await loaded.DBService._test.pushCacheToSupabase(client, cache);

  const call = calls.find(c => c.table === 'shop_products');
  assert.ok(call);
  assert.equal(call.rows.length, 1);
  assert.equal(call.rows[0].id, 'p2');
  assert.equal(call.rows[0].name, 'Pencil');
  assert.ok(!('stock' in call.rows[0]), 'stock must never ride along in this bulk upsert — RPC-only');
  assert.deepEqual(dj(loaded.win.clearDirtyCalls), [{ table: 'shop_products', ids: ['p2'] }]);
});

test('shop_products delta sync: an explicit empty dirty array skips the push entirely', async () => {
  const dirtyIds = { shop_products: [] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  await loaded.DBService._test.pushCacheToSupabase(client, { store: [product()] });

  assert.ok(!calls.some(c => c.table === 'shop_products'));
  assert.deepEqual(dj(loaded.win.clearDirtyCalls), []);
});

test('shop_products delta sync: a failed push leaves its ids dirty so the next cycle retries them', async () => {
  const dirtyIds = { shop_products: ['p1'] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const client = makeFakeSupabaseClient((table) => {
    if (table === 'shop_products') return { error: { code: '42501', message: 'RLS denied' } };
    return { error: null };
  });
  await loaded.DBService._test.pushCacheToSupabase(client, { store: [product({ name: 'Edited' })] });

  assert.deepEqual(dj(loaded.win.clearDirtyCalls), []);
});

test("no-clobber: the same teacher's second open tab does not revert an edit just saved from the first tab", async () => {
  const seed = [product({ id: 'p1', name: 'Original Name' })];
  const tabA = loadAppStoreWindow({ store: seed.map(p => Object.assign({}, p)) });
  const tabB = loadAppStoreWindow({ store: seed.map(p => Object.assign({}, p)) });
  await tabA.AppStore.ready;
  await tabB.AppStore.ready;

  tabA.AppStore.updateState((draft) => {
    draft.store.find(p => p.id === 'p1').name = 'Renamed';
  });
  const serverCalls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { serverCalls.push({ table, rows, opts }); });
  const dbA = loadDbServiceWindow(teacherSession());
  dbA.win.AppStore.getDirtyIds = (t) => tabA.AppStore.getDirtyIds(t);
  dbA.win.AppStore.clearDirty = (t, ids) => tabA.AppStore.clearDirty(t, ids);
  await dbA.DBService._test.pushCacheToSupabase(client, { store: tabA.AppStore.getState().store });

  tabB.AppStore.updateState((draft) => {
    draft.store.push(product({ id: 'p2', name: 'New Product' }));
  });
  const dbB = loadDbServiceWindow(teacherSession());
  dbB.win.AppStore.getDirtyIds = (t) => tabB.AppStore.getDirtyIds(t);
  dbB.win.AppStore.clearDirty = (t, ids) => tabB.AppStore.clearDirty(t, ids);
  await dbB.DBService._test.pushCacheToSupabase(client, { store: tabB.AppStore.getState().store });

  const productCalls = serverCalls.filter(c => c.table === 'shop_products');
  assert.equal(productCalls.length, 2);
  assert.deepEqual(dj(productCalls[0].rows.map(r => r.id)), ['p1']);
  assert.deepEqual(dj(productCalls[1].rows.map(r => r.id)), ['p2'], "tab B's push must only contain its own new p2");

  const p1Writes = productCalls.flatMap(c => c.rows).filter(r => r.id === 'p1');
  assert.equal(p1Writes.length, 1);
  assert.equal(p1Writes[0].name, 'Renamed', "p1's rename from tab A must survive tab B's later, unrelated push");
});
