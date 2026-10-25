'use strict';
// Phase 5 — Data Layer Redesign, sub-phase B (Delta/patch sync):
// campaign_worlds, the tenth table converted. Flat array, client-generated
// id — same shape as titles/quizzes, BUT this table's buildRows used to
// compute `sort_order` from array position within whatever it was handed.
// That's correct for a full-slice push (src IS cache.stageMap) but would
// have been silently WRONG for a delta-filtered push (src is a small
// dirty-only subset, so position-within-src != true position in the map).
// See db-service.js's config comment for the fix; the second test below
// is the one that actually proves it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadDbServiceWindow, loadAppStoreWindow, makeFakeSupabaseClient } = require('./helpers/load-globals');

function dj(arr) { return Array.from(arr); }

function teacherSession(extra) {
  return Object.assign({ currentUser: { id: 't1', role: 'teacher' }, currentRole: 'teacher', classSections: [] }, extra);
}

function world(overrides) {
  return Object.assign({ id: 'w1', ownerTeacherId: 't1', label: 'World 1', icon: '🌍', color: '#8b5cf6', desc: 'd', stages: [] }, overrides);
}

test('campaign_worlds delta sync: pushes only the dirty subset, and clears exactly the ids it successfully pushed', async () => {
  const dirtyIds = { campaign_worlds: ['w2'] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  const cache = { stageMap: [world({ id: 'w1' }), world({ id: 'w2', label: 'World 2' })] };
  await loaded.DBService._test.pushCacheToSupabase(client, cache);

  const call = calls.find(c => c.table === 'campaign_worlds');
  assert.ok(call);
  assert.equal(call.rows.length, 1);
  assert.equal(call.rows[0].id, 'w2');
  assert.deepEqual(dj(loaded.win.clearDirtyCalls), [{ table: 'campaign_worlds', ids: ['w2'] }]);
});

test('REGRESSION: sort_order reflects true position in the full map, not position within a delta-filtered subset', async () => {
  // Three worlds, true order w1(0), w2(1), w3(2). Only w3 (the LAST one)
  // is dirty this cycle. Before the fix, buildRows would compute sort_order
  // from the filtered subset's own index — a single-element array — giving
  // w3 sort_order: 0 and silently moving it to the front server-side.
  const dirtyIds = { campaign_worlds: ['w3'] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  const cache = { stageMap: [world({ id: 'w1' }), world({ id: 'w2' }), world({ id: 'w3' })] };
  await loaded.DBService._test.pushCacheToSupabase(client, cache);

  const call = calls.find(c => c.table === 'campaign_worlds');
  assert.equal(call.rows.length, 1);
  assert.equal(call.rows[0].id, 'w3');
  assert.equal(call.rows[0].sort_order, 2, "w3's true position (index 2 in the full map) must survive being the only dirty row — NOT 0");
});

test('campaign_worlds delta sync: an explicit empty dirty array skips the push entirely', async () => {
  const dirtyIds = { campaign_worlds: [] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  await loaded.DBService._test.pushCacheToSupabase(client, { stageMap: [world()] });

  assert.ok(!calls.some(c => c.table === 'campaign_worlds'));
  assert.deepEqual(dj(loaded.win.clearDirtyCalls), []);
});

test('campaign_worlds delta sync: a failed push leaves its ids dirty so the next cycle retries them', async () => {
  const dirtyIds = { campaign_worlds: ['w1'] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const client = makeFakeSupabaseClient((table) => {
    if (table === 'campaign_worlds') return { error: { code: '42501', message: 'RLS denied' } };
    return { error: null };
  });
  await loaded.DBService._test.pushCacheToSupabase(client, { stageMap: [world({ label: 'Edited' })] });

  assert.deepEqual(dj(loaded.win.clearDirtyCalls), []);
});

test("no-clobber: the same teacher's second open tab does not revert an edit just saved from the first tab", async () => {
  const seed = [world({ id: 'w1', label: 'Original Label' })];
  const tabA = loadAppStoreWindow({ stageMap: seed.map(w => Object.assign({}, w)) });
  const tabB = loadAppStoreWindow({ stageMap: seed.map(w => Object.assign({}, w)) });
  await tabA.AppStore.ready;
  await tabB.AppStore.ready;

  tabA.AppStore.updateState((draft) => {
    draft.stageMap.find(w => w.id === 'w1').label = 'Renamed';
  });
  const serverCalls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { serverCalls.push({ table, rows, opts }); });
  const dbA = loadDbServiceWindow(teacherSession());
  dbA.win.AppStore.getDirtyIds = (t) => tabA.AppStore.getDirtyIds(t);
  dbA.win.AppStore.clearDirty = (t, ids) => tabA.AppStore.clearDirty(t, ids);
  await dbA.DBService._test.pushCacheToSupabase(client, { stageMap: tabA.AppStore.getState().stageMap });

  tabB.AppStore.updateState((draft) => {
    draft.stageMap.push(world({ id: 'w2', label: 'New World' }));
  });
  const dbB = loadDbServiceWindow(teacherSession());
  dbB.win.AppStore.getDirtyIds = (t) => tabB.AppStore.getDirtyIds(t);
  dbB.win.AppStore.clearDirty = (t, ids) => tabB.AppStore.clearDirty(t, ids);
  await dbB.DBService._test.pushCacheToSupabase(client, { stageMap: tabB.AppStore.getState().stageMap });

  const worldCalls = serverCalls.filter(c => c.table === 'campaign_worlds');
  assert.equal(worldCalls.length, 2);
  assert.deepEqual(dj(worldCalls[0].rows.map(r => r.id)), ['w1']);
  assert.deepEqual(dj(worldCalls[1].rows.map(r => r.id)), ['w2'], "tab B's push must only contain its own new w2");

  const w1Writes = worldCalls.flatMap(c => c.rows).filter(r => r.id === 'w1');
  assert.equal(w1Writes.length, 1);
  assert.equal(w1Writes[0].label, 'Renamed', "w1's rename from tab A must survive tab B's later, unrelated push");
});
