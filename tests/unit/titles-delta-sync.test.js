'use strict';
// Phase 5 — Data Layer Redesign, sub-phase B (Delta/patch sync):
// titles, the seventh table converted. Flat array, teacher-owned catalog
// rows edited via a title editor — same "whole-row-replacement is fine,
// just needs to be scoped to the row this session actually touched"
// reasoning as point_log/redemptions. See db-service.js's config comment
// for why the practical risk here is the same teacher's own second tab,
// not necessarily two different people.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadDbServiceWindow, loadAppStoreWindow, makeFakeSupabaseClient } = require('./helpers/load-globals');

function dj(arr) { return Array.from(arr); }

function teacherSession(extra) {
  return Object.assign({ currentUser: { id: 't1', role: 'teacher' }, currentRole: 'teacher', classSections: [] }, extra);
}

function title(overrides) {
  return Object.assign({
    id: 'ti1', ownerTeacherId: 't1', name: 'Champion', description: 'd', icon: '🏆', rarity: 'gold', active: true,
    achievementId: null, textColor: null, borderColor: null, glowColor: null, bgColor: null, primaryColor: null,
    secondaryColor: null, gradientFrom: null, gradientTo: null, borderStyle: null, animation: null, particles: null,
    bgEffect: null, customBorderCSS: null, customAnimationCSS: null, customBgCSS: null, frameShape: null,
    frameStyle: null, accentColor: null, effect: null, frameTemplate: null,
  }, overrides);
}

test('titles delta sync: pushes only the dirty subset, and clears exactly the ids it successfully pushed', async () => {
  const dirtyIds = { titles: ['ti2'] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  const cache = { titles: [title({ id: 'ti1' }), title({ id: 'ti2', name: 'Legend' })] };
  await loaded.DBService._test.pushCacheToSupabase(client, cache);

  const call = calls.find(c => c.table === 'titles');
  assert.ok(call);
  assert.equal(call.rows.length, 1);
  assert.equal(call.rows[0].id, 'ti2');
  assert.equal(call.rows[0].name, 'Legend');
  assert.deepEqual(dj(loaded.win.clearDirtyCalls), [{ table: 'titles', ids: ['ti2'] }]);
});

test('titles delta sync: an explicit empty dirty array skips the push entirely', async () => {
  const dirtyIds = { titles: [] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  await loaded.DBService._test.pushCacheToSupabase(client, { titles: [title()] });

  assert.ok(!calls.some(c => c.table === 'titles'));
  assert.deepEqual(dj(loaded.win.clearDirtyCalls), []);
});

test('titles delta sync: a failed push leaves its ids dirty so the next cycle retries them', async () => {
  const dirtyIds = { titles: ['ti1'] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const client = makeFakeSupabaseClient((table) => {
    if (table === 'titles') return { error: { code: '42501', message: 'RLS denied' } };
    return { error: null };
  });
  await loaded.DBService._test.pushCacheToSupabase(client, { titles: [title({ name: 'Edited' })] });

  assert.deepEqual(dj(loaded.win.clearDirtyCalls), []);
});

test("no-clobber: the same teacher's second open tab does not revert an edit just saved from the first tab", async () => {
  // Tab A (the title editor) saves a name change to ti1. Tab B — the same
  // teacher's second open tab, showing a title gallery or dashboard, never
  // pulled A's edit, so its local cache still has the OLD name for ti1. Tab
  // B independently creates a brand-new title ti2 (unrelated) and pushes
  // its own cycle. Before delta sync, B's whole-slice push would have
  // re-sent its stale ti1 (old name) right alongside ti2, silently
  // reverting the edit A just made the moment B's push landed.
  const seed = [title({ id: 'ti1', name: 'Original Name' })];
  const tabA = loadAppStoreWindow({ titles: seed.map(t => Object.assign({}, t)) });
  const tabB = loadAppStoreWindow({ titles: seed.map(t => Object.assign({}, t)) });
  await tabA.AppStore.ready;
  await tabB.AppStore.ready;

  tabA.AppStore.updateState((draft) => {
    draft.titles.find(t => t.id === 'ti1').name = 'Renamed';
  });
  const serverCalls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { serverCalls.push({ table, rows, opts }); });
  const dbA = loadDbServiceWindow(teacherSession());
  dbA.win.AppStore.getDirtyIds = (t) => tabA.AppStore.getDirtyIds(t);
  dbA.win.AppStore.clearDirty = (t, ids) => tabA.AppStore.clearDirty(t, ids);
  await dbA.DBService._test.pushCacheToSupabase(client, { titles: tabA.AppStore.getState().titles });

  tabB.AppStore.updateState((draft) => {
    draft.titles.push(title({ id: 'ti2', name: 'New Title' }));
  });
  const dbB = loadDbServiceWindow(teacherSession());
  dbB.win.AppStore.getDirtyIds = (t) => tabB.AppStore.getDirtyIds(t);
  dbB.win.AppStore.clearDirty = (t, ids) => tabB.AppStore.clearDirty(t, ids);
  await dbB.DBService._test.pushCacheToSupabase(client, { titles: tabB.AppStore.getState().titles });

  const titleCalls = serverCalls.filter(c => c.table === 'titles');
  assert.equal(titleCalls.length, 2);
  assert.deepEqual(dj(titleCalls[0].rows.map(r => r.id)), ['ti1']);
  assert.deepEqual(dj(titleCalls[1].rows.map(r => r.id)), ['ti2'], "tab B's push must only contain its own new ti2 — its stale local ti1 must NOT be re-sent");

  const ti1Writes = titleCalls.flatMap(c => c.rows).filter(r => r.id === 'ti1');
  assert.equal(ti1Writes.length, 1);
  assert.equal(ti1Writes[0].name, 'Renamed', "ti1's rename from tab A must survive tab B's later, unrelated push");
});
