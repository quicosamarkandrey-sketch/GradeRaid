'use strict';
// Phase 5 — Data Layer Redesign, sub-phase B (Delta/patch sync):
// profiles, the eleventh table converted — and the one that needed real
// new plumbing, not just a config addition:
//
// 1. `watchFields` (state-manager.js): a student row carries xp/coins/
//    level/tier/etc, which change constantly via ordinary gameplay and are
//    RPC-owned (never part of this table's own upsert payload). Diffing
//    the whole row would dirty `profiles` almost every save. `watchFields`
//    scopes the dirty-diff to just the columns this table's upsertRows
//    actually sends.
// 2. The upsertRows-return-value contract (db-service.js): this table's
//    upsert is chunked per class_id and warns-and-continues past a failed
//    chunk on purpose — a blanket "didn't throw, so clear everything"
//    rule would have cleared dirty ids for students in a chunk that just
//    failed. upsertRows now returns exactly the ids that landed in a
//    chunk that succeeded, and the engine clears only those.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadDbServiceWindow, loadAppStoreWindow, makeFakeSupabaseClient } = require('./helpers/load-globals');

function dj(arr) { return Array.from(arr); }
function jn(x) { return JSON.parse(JSON.stringify(x)); }

function adminSession(extra) {
  return Object.assign({ currentUser: { id: 't1', role: 'admin' }, currentRole: 'admin' }, extra);
}

function student(overrides) {
  return Object.assign({
    id: 's1', name: 'Alex', init: 'A', color: '#fff',
    firstName: 'Alex', lastName: 'Lee', profilePic: null, classId: 'classA',
    xp: 0, coins: 0, level: 1, tier: 'bronze', attendancePct: 0, quizAvg: 0,
  }, overrides);
}

test('profiles watchFields: an xp/coins/level change does NOT dirty the profiles table', async () => {
  const session = loadAppStoreWindow({ students: [student()] });
  await session.AppStore.ready;

  session.AppStore.updateState((draft) => {
    const s = draft.students.find(x => x.id === 's1');
    s.xp += 50;
    s.coins += 10;
    s.level = 2;
    s.attendancePct = 95;
    s.quizAvg = 88;
  });

  assert.deepEqual(dj(session.AppStore.getDirtyIds('profiles')), [],
    'none of these columns are ever sent by the profiles upsert (they are RPC-owned) — a change to only these must not dirty this table');
});

test('profiles watchFields: a cosmetic-field change (e.g. name) DOES dirty the profiles table', async () => {
  const session = loadAppStoreWindow({ students: [student()] });
  await session.AppStore.ready;

  session.AppStore.updateState((draft) => {
    draft.students.find(x => x.id === 's1').name = 'Alexander';
  });

  assert.deepEqual(dj(session.AppStore.getDirtyIds('profiles')), ['s1']);
});

test('profiles delta sync: pushes only the dirty student, scoped to their class chunk', async () => {
  const dirtyIds = { profiles: ['s2'] };
  const loaded = loadDbServiceWindow(adminSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  const cache = { students: [student({ id: 's1', classId: 'classA' }), student({ id: 's2', classId: 'classB', name: 'Sam' })] };
  await loaded.DBService._test.pushCacheToSupabase(client, cache);

  const profileCalls = calls.filter(c => c.table === 'profiles');
  assert.equal(profileCalls.length, 1, "only s2's class chunk should be pushed");
  assert.equal(profileCalls[0].rows.length, 1);
  assert.equal(profileCalls[0].rows[0].id, 's2');
  assert.deepEqual(jn(loaded.win.clearDirtyCalls), [{ table: 'profiles', ids: ['s2'] }]);
});

test('profiles delta sync PARTIAL-FAILURE CONTRACT: one class_id chunk failing does not clear the OTHER (successful) chunk\'s dirty id, and does not clear the failed one either', async () => {
  const dirtyIds = { profiles: ['s1', 's2'] };
  const loaded = loadDbServiceWindow(adminSession({ dirtyIds }));
  const client = makeFakeSupabaseClient((table, rows) => {
    if (table === 'profiles' && rows[0].class_id === 'classA') {
      return { error: { code: '42501', message: 'RLS denied' } };
    }
    return { error: null };
  });
  const cache = { students: [student({ id: 's1', classId: 'classA' }), student({ id: 's2', classId: 'classB' })] };
  await loaded.DBService._test.pushCacheToSupabase(client, cache);

  // classB (s2) succeeded — its id must be cleared. classA (s1) failed —
  // it must stay dirty for retry. A naive "call didn't throw → clear
  // everything" rule would have wrongly cleared s1 too, since upsertRows
  // itself never throws (it warns-and-continues per chunk by design).
  assert.deepEqual(jn(loaded.win.clearDirtyCalls), [{ table: 'profiles', ids: ['s2'] }],
    "only s2 (the succeeded chunk) may be cleared — s1's failed chunk must NOT be cleared");
});

test('profiles delta sync: a non-staff session pushes nothing and clears nothing, leaving dirty ids untouched for a later staff session', async () => {
  const dirtyIds = { profiles: ['s1'] };
  const loaded = loadDbServiceWindow({ currentUser: { id: 's1', role: 'student' }, currentRole: 'student', dirtyIds });
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  await loaded.DBService._test.pushCacheToSupabase(client, { students: [student({ id: 's1' })] });

  assert.ok(!calls.some(c => c.table === 'profiles'));
  assert.deepEqual(jn(loaded.win.clearDirtyCalls), []);
});

test("no-clobber: two concurrent admin sessions each editing a different student's cosmetic field both survive independent push cycles", async () => {
  // The literal property the Phase 5 doc requires before a table counts as
  // converted: "two concurrent sessions changing different fields on the
  // same entity/different entities — verify both survive." Every other
  // delta-tracked table's suite has this test; profiles' didn't when it
  // was first converted — added here to close that gap.
  //
  // Session A (admin) renames s1. Session B (a second admin session, or
  // the same admin's second tab — either way, never pulled A's edit, so
  // its local cache of s1 is still stale) independently renames the
  // DIFFERENT student s2 and pushes its own cycle. Before delta sync, B's
  // whole-slice push would have re-sent its stale s1 (old name) right
  // alongside s2, silently reverting A's already-confirmed edit.
  const seed = [student({ id: 's1', classId: 'classA', name: 'Original A' }), student({ id: 's2', classId: 'classB', name: 'Original B' })];
  const sessionA = loadAppStoreWindow({ students: seed.map(s => Object.assign({}, s)) });
  const sessionB = loadAppStoreWindow({ students: seed.map(s => Object.assign({}, s)) });
  await sessionA.AppStore.ready;
  await sessionB.AppStore.ready;

  sessionA.AppStore.updateState((draft) => {
    draft.students.find(s => s.id === 's1').name = 'Renamed A';
  });
  const serverCalls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { serverCalls.push({ table, rows, opts }); });
  const dbA = loadDbServiceWindow(adminSession());
  dbA.win.AppStore.getDirtyIds = (t) => sessionA.AppStore.getDirtyIds(t);
  dbA.win.AppStore.clearDirty = (t, ids) => sessionA.AppStore.clearDirty(t, ids);
  await dbA.DBService._test.pushCacheToSupabase(client, { students: sessionA.AppStore.getState().students });

  sessionB.AppStore.updateState((draft) => {
    draft.students.find(s => s.id === 's2').name = 'Renamed B';
  });
  const dbB = loadDbServiceWindow(adminSession());
  dbB.win.AppStore.getDirtyIds = (t) => sessionB.AppStore.getDirtyIds(t);
  dbB.win.AppStore.clearDirty = (t, ids) => sessionB.AppStore.clearDirty(t, ids);
  await dbB.DBService._test.pushCacheToSupabase(client, { students: sessionB.AppStore.getState().students });

  const profileCalls = serverCalls.filter(c => c.table === 'profiles');
  // Each session's push is itself chunked per class_id (s1 and s2 are in
  // different classes) — one call per session here since each only ever
  // dirtied one student, in one class.
  assert.equal(profileCalls.length, 2, 'each session pushes its own cycle independently');
  assert.deepEqual(dj(profileCalls[0].rows.map(r => r.id)), ['s1'], "session A's push must only touch s1");
  assert.deepEqual(dj(profileCalls[1].rows.map(r => r.id)), ['s2'],
    "session B's push must only touch s2 — its stale local s1 (still 'Original A') must NOT be re-sent");

  const s1Writes = profileCalls.flatMap(c => c.rows).filter(r => r.id === 's1');
  assert.equal(s1Writes.length, 1);
  assert.equal(s1Writes[0].display_name, 'Renamed A', "s1's rename from session A must survive session B's later, unrelated push");
});
