'use strict';
// Phase 5 — Data Layer Redesign, sub-phase B (Delta/patch sync):
// quizzes, the ninth table converted. Flat array, teacher-owned catalog
// rows — same pattern as titles. No new mechanism needed.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadDbServiceWindow, loadAppStoreWindow, makeFakeSupabaseClient } = require('./helpers/load-globals');

function dj(arr) { return Array.from(arr); }

function teacherSession(extra) {
  return Object.assign({ currentUser: { id: 't1', role: 'teacher' }, currentRole: 'teacher', classSections: [] }, extra);
}

function quiz(overrides) {
  return Object.assign({
    id: 'q1', ownerTeacherId: 't1', title: 'Fractions', desc: 'd', xpReward: 10, coinReward: 5, timeLimit: 60,
    rarity: 'Common', cadence: 'standing', chainId: null, chainOrder: 1, chainLabel: null,
    startDate: null, endDate: null, stageTimers: [null, null, null], questions: [], active: true,
  }, overrides);
}

test('quizzes delta sync: pushes only the dirty subset, and clears exactly the ids it successfully pushed', async () => {
  const dirtyIds = { quizzes: ['q2'] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  const cache = { quizzes: [quiz({ id: 'q1' }), quiz({ id: 'q2', title: 'Decimals' })] };
  await loaded.DBService._test.pushCacheToSupabase(client, cache);

  const call = calls.find(c => c.table === 'quizzes');
  assert.ok(call);
  assert.equal(call.rows.length, 1);
  assert.equal(call.rows[0].id, 'q2');
  assert.equal(call.rows[0].title, 'Decimals');
  assert.deepEqual(dj(loaded.win.clearDirtyCalls), [{ table: 'quizzes', ids: ['q2'] }]);
});

test('quizzes delta sync: an explicit empty dirty array skips the push entirely', async () => {
  const dirtyIds = { quizzes: [] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  await loaded.DBService._test.pushCacheToSupabase(client, { quizzes: [quiz()] });

  assert.ok(!calls.some(c => c.table === 'quizzes'));
  assert.deepEqual(dj(loaded.win.clearDirtyCalls), []);
});

test('quizzes delta sync: a failed push leaves its ids dirty so the next cycle retries them', async () => {
  const dirtyIds = { quizzes: ['q1'] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const client = makeFakeSupabaseClient((table) => {
    if (table === 'quizzes') return { error: { code: '42501', message: 'RLS denied' } };
    return { error: null };
  });
  await loaded.DBService._test.pushCacheToSupabase(client, { quizzes: [quiz({ title: 'Edited' })] });

  assert.deepEqual(dj(loaded.win.clearDirtyCalls), []);
});

test("no-clobber: the same teacher's second open tab does not revert an edit just saved from the first tab", async () => {
  const seed = [quiz({ id: 'q1', title: 'Original Title' })];
  const tabA = loadAppStoreWindow({ quizzes: seed.map(q => Object.assign({}, q)) });
  const tabB = loadAppStoreWindow({ quizzes: seed.map(q => Object.assign({}, q)) });
  await tabA.AppStore.ready;
  await tabB.AppStore.ready;

  tabA.AppStore.updateState((draft) => {
    draft.quizzes.find(q => q.id === 'q1').title = 'Renamed';
  });
  const serverCalls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { serverCalls.push({ table, rows, opts }); });
  const dbA = loadDbServiceWindow(teacherSession());
  dbA.win.AppStore.getDirtyIds = (t) => tabA.AppStore.getDirtyIds(t);
  dbA.win.AppStore.clearDirty = (t, ids) => tabA.AppStore.clearDirty(t, ids);
  await dbA.DBService._test.pushCacheToSupabase(client, { quizzes: tabA.AppStore.getState().quizzes });

  tabB.AppStore.updateState((draft) => {
    draft.quizzes.push(quiz({ id: 'q2', title: 'New Quiz' }));
  });
  const dbB = loadDbServiceWindow(teacherSession());
  dbB.win.AppStore.getDirtyIds = (t) => tabB.AppStore.getDirtyIds(t);
  dbB.win.AppStore.clearDirty = (t, ids) => tabB.AppStore.clearDirty(t, ids);
  await dbB.DBService._test.pushCacheToSupabase(client, { quizzes: tabB.AppStore.getState().quizzes });

  const quizCalls = serverCalls.filter(c => c.table === 'quizzes');
  assert.equal(quizCalls.length, 2);
  assert.deepEqual(dj(quizCalls[0].rows.map(r => r.id)), ['q1']);
  assert.deepEqual(dj(quizCalls[1].rows.map(r => r.id)), ['q2'], "tab B's push must only contain its own new q2");

  const q1Writes = quizCalls.flatMap(c => c.rows).filter(r => r.id === 'q1');
  assert.equal(q1Writes.length, 1);
  assert.equal(q1Writes[0].title, 'Renamed', "q1's rename from tab A must survive tab B's later, unrelated push");
});
