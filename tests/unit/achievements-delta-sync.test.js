'use strict';
// Phase 5 — Data Layer Redesign, sub-phase B (Delta/patch sync):
// achievements, the thirteenth and final table converted this session.
// Flat array, teacher-owned catalog rows — same pattern as titles/quizzes/
// shop_products. Per-student unlock/claim state (user_achievements) is
// explicitly out of scope for this push path, so no watchFields scoping
// is needed.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadDbServiceWindow, loadAppStoreWindow, makeFakeSupabaseClient } = require('./helpers/load-globals');

function dj(arr) { return Array.from(arr); }

function teacherSession(extra) {
  return Object.assign({ currentUser: { id: 't1', role: 'teacher' }, currentRole: 'teacher', classSections: [] }, extra);
}

function achievement(overrides) {
  return Object.assign({
    id: 'a1', ownerTeacherId: 't1', name: 'First Steps', description: 'd', icon: '🏅',
    category: 'general', rarity: 'common', xpReward: 10, coinReward: 5,
    triggerType: 'manual', triggerValue: null, active: true,
  }, overrides);
}

test('achievements delta sync: pushes only the dirty subset, and clears exactly the ids it successfully pushed', async () => {
  const dirtyIds = { achievements: ['a2'] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  const cache = { achievements: [achievement({ id: 'a1' }), achievement({ id: 'a2', name: 'Second Steps' })] };
  await loaded.DBService._test.pushCacheToSupabase(client, cache);

  const call = calls.find(c => c.table === 'achievements');
  assert.ok(call);
  assert.equal(call.rows.length, 1);
  assert.equal(call.rows[0].id, 'a2');
  assert.equal(call.rows[0].name, 'Second Steps');
  assert.deepEqual(dj(loaded.win.clearDirtyCalls), [{ table: 'achievements', ids: ['a2'] }]);
});

test('achievements delta sync: an explicit empty dirty array skips the push entirely', async () => {
  const dirtyIds = { achievements: [] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  await loaded.DBService._test.pushCacheToSupabase(client, { achievements: [achievement()] });

  assert.ok(!calls.some(c => c.table === 'achievements'));
  assert.deepEqual(dj(loaded.win.clearDirtyCalls), []);
});

test('achievements delta sync: a failed push leaves its ids dirty so the next cycle retries them', async () => {
  const dirtyIds = { achievements: ['a1'] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const client = makeFakeSupabaseClient((table) => {
    if (table === 'achievements') return { error: { code: '42501', message: 'RLS denied' } };
    return { error: null };
  });
  await loaded.DBService._test.pushCacheToSupabase(client, { achievements: [achievement({ name: 'Edited' })] });

  assert.deepEqual(dj(loaded.win.clearDirtyCalls), []);
});

test("no-clobber: the same teacher's second open tab does not revert an edit just saved from the first tab", async () => {
  const seed = [achievement({ id: 'a1', name: 'Original Name' })];
  const tabA = loadAppStoreWindow({ achievements: seed.map(a => Object.assign({}, a)) });
  const tabB = loadAppStoreWindow({ achievements: seed.map(a => Object.assign({}, a)) });
  await tabA.AppStore.ready;
  await tabB.AppStore.ready;

  tabA.AppStore.updateState((draft) => {
    draft.achievements.find(a => a.id === 'a1').name = 'Renamed';
  });
  const serverCalls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { serverCalls.push({ table, rows, opts }); });
  const dbA = loadDbServiceWindow(teacherSession());
  dbA.win.AppStore.getDirtyIds = (t) => tabA.AppStore.getDirtyIds(t);
  dbA.win.AppStore.clearDirty = (t, ids) => tabA.AppStore.clearDirty(t, ids);
  await dbA.DBService._test.pushCacheToSupabase(client, { achievements: tabA.AppStore.getState().achievements });

  tabB.AppStore.updateState((draft) => {
    draft.achievements.push(achievement({ id: 'a2', name: 'New Achievement' }));
  });
  const dbB = loadDbServiceWindow(teacherSession());
  dbB.win.AppStore.getDirtyIds = (t) => tabB.AppStore.getDirtyIds(t);
  dbB.win.AppStore.clearDirty = (t, ids) => tabB.AppStore.clearDirty(t, ids);
  await dbB.DBService._test.pushCacheToSupabase(client, { achievements: tabB.AppStore.getState().achievements });

  const achCalls = serverCalls.filter(c => c.table === 'achievements');
  assert.equal(achCalls.length, 2);
  assert.deepEqual(dj(achCalls[0].rows.map(r => r.id)), ['a1']);
  assert.deepEqual(dj(achCalls[1].rows.map(r => r.id)), ['a2'], "tab B's push must only contain its own new a2");

  const a1Writes = achCalls.flatMap(c => c.rows).filter(r => r.id === 'a1');
  assert.equal(a1Writes.length, 1);
  assert.equal(a1Writes[0].name, 'Renamed', "a1's rename from tab A must survive tab B's later, unrelated push");
});
