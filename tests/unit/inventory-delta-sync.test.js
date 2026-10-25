'use strict';
// Phase 5 — Data Layer Redesign, sub-phase B (Delta/patch sync):
// inventory, the fifth table converted.
//
// inventory[studentId] = [items...] — exercises AppStore's 'nestedArray'
// dirty-tracking shape (object keyed by studentId, whose value is an array,
// unlike boss_participants' object-of-objects). What's genuinely new here,
// not just a shape variant: the second actor isn't another student's own
// session (as in boss_participants) — it's a TEACHER running the shop POS
// terminal on that student's behalf, concurrently with the student's own
// device. See db-service.js's config comment for the full mechanism.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadDbServiceWindow, loadAppStoreWindow, makeFakeSupabaseClient } = require('./helpers/load-globals');

function dj(arr) { return Array.from(arr); }
function jn(x) { return JSON.parse(JSON.stringify(x)); }

function teacherSession(extra) {
  return Object.assign({ currentUser: { id: 't1', role: 'teacher' }, currentRole: 'teacher', classSections: [] }, extra);
}

function item(overrides) {
  return Object.assign({ itemId: 'i1', itemName: 'Hat', emoji: '🎩', category: 'cosmetic', quantity: 1, datePurchased: 't', lastPurchased: 't', source: 'Store', status: 'active', usedAt: null }, overrides);
}

test('inventory delta sync: pushes only the dirty (studentId, itemId) pair', async () => {
  const dirtyIds = { inventory: ['s2:i1'] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  const cache = {
    inventory: {
      s1: [item({ itemId: 'i1' })],
      s2: [item({ itemId: 'i1' }), item({ itemId: 'i2' })],
    },
  };
  await loaded.DBService._test.pushCacheToSupabase(client, cache);

  const call = calls.find(c => c.table === 'inventory');
  assert.ok(call, 'inventory should still have been pushed — it had one dirty pair');
  assert.equal(call.rows.length, 1);
  assert.equal(call.rows[0].student_id, 's2');
  assert.equal(call.rows[0].item_id, 'i1');
  assert.deepEqual(jn(loaded.win.clearDirtyCalls), [{ table: 'inventory', ids: ['s2:i1'] }]);
});

test('inventory delta sync: an explicit empty dirty array skips the push entirely', async () => {
  const dirtyIds = { inventory: [] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  await loaded.DBService._test.pushCacheToSupabase(client, { inventory: { s1: [item()] } });

  assert.ok(!calls.some(c => c.table === 'inventory'));
  assert.deepEqual(jn(loaded.win.clearDirtyCalls), []);
});

test('inventory delta sync: a failed push leaves its ids dirty so the next cycle retries them', async () => {
  const dirtyIds = { inventory: ['s1:i1'] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const client = makeFakeSupabaseClient((table) => {
    if (table === 'inventory') return { error: { code: '42501', message: 'RLS denied' } };
    return { error: null };
  });
  await loaded.DBService._test.pushCacheToSupabase(client, { inventory: { s1: [item()] } });

  assert.deepEqual(jn(loaded.win.clearDirtyCalls), [], 'clearDirty must not be called when the upsert reported an error');
});

test("no-clobber: a teacher's POS-terminal grant and the same student's own purchase — from two different sessions — both survive", async () => {
  // Both sessions start from the same pull: student s1 already owns i1.
  // Session A is the student's OWN device — they buy i2 from the shop
  // (shop_store.js), dirtying only i2. Session B is a TEACHER running the
  // POS terminal (shop_pos_terminal.js) — from B's stale cache (still just
  // i1, since B never pulled A's purchase), they grant i3 on the student's
  // behalf, dirtying only i3. Neither push should touch the other's item —
  // and both new items must show up across the two pushes without either
  // session's stale copy of the other's addition (or lack thereof)
  // reverting anything.
  const seed = [item({ itemId: 'i1' })];
  const sessionA = loadAppStoreWindow({ inventory: { s1: seed.map(i => Object.assign({}, i)) } });
  const sessionB = loadAppStoreWindow({ inventory: { s1: seed.map(i => Object.assign({}, i)) } });
  await sessionA.AppStore.ready;
  await sessionB.AppStore.ready;

  sessionA.AppStore.updateState((draft) => {
    draft.inventory.s1.push(item({ itemId: 'i2', source: 'Store' }));
  });
  const serverCalls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { serverCalls.push({ table, rows, opts }); });
  const dbA = loadDbServiceWindow(teacherSession());
  dbA.win.AppStore.getDirtyIds = (t) => sessionA.AppStore.getDirtyIds(t);
  dbA.win.AppStore.clearDirty = (t, ids) => sessionA.AppStore.clearDirty(t, ids);
  await dbA.DBService._test.pushCacheToSupabase(client, { inventory: sessionA.AppStore.getState().inventory });

  sessionB.AppStore.updateState((draft) => {
    draft.inventory.s1.push(item({ itemId: 'i3', source: 'POS Grant' }));
  });
  const dbB = loadDbServiceWindow(teacherSession());
  dbB.win.AppStore.getDirtyIds = (t) => sessionB.AppStore.getDirtyIds(t);
  dbB.win.AppStore.clearDirty = (t, ids) => sessionB.AppStore.clearDirty(t, ids);
  await dbB.DBService._test.pushCacheToSupabase(client, { inventory: sessionB.AppStore.getState().inventory });

  const invCalls = serverCalls.filter(c => c.table === 'inventory');
  assert.equal(invCalls.length, 2, 'each session pushes its own cycle independently');
  assert.deepEqual(dj(invCalls[0].rows.map(r => r.item_id)), ['i2'], "session A's push must only contain i2");
  assert.deepEqual(dj(invCalls[1].rows.map(r => r.item_id)), ['i3'],
    "session B's push must only contain i3 — its stale local copy (missing i2) must not overwrite/omit A's addition");
});
