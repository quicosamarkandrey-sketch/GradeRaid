'use strict';
// Phase 5 — Data Layer Redesign, sub-phase B (Delta/patch sync):
// boss_participants, the fourth table converted, and the first one where a
// truly different SESSION (a second student, concurrently) can dirty a row
// this session never touched. See the config comment in db-service.js for
// the full mechanism this closes: combat damage already lands via a scoped
// apply_boss_damage RPC, atomically, per student — but the old whole-slice
// push still re-sent every OTHER student's cached roster entry on every
// save, so a session with a stale copy of another student's row could
// silently revert that student's already-RPC-committed damage.
//
// boss_participants also isn't a flat array (bossParticipants[bossIdx]
// [studentId]), so this table exercises AppStore's 'nested' dirty-tracking
// shape and db-service.js's deltaFilterSource escape hatch, not the plain
// idField path point_log/notifications/orders use.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadDbServiceWindow, loadAppStoreWindow, makeFakeSupabaseClient } = require('./helpers/load-globals');

function dj(arr) { return Array.from(arr); }
// Cross-realm safety for nested arrays-of-objects (an object literal built
// inside a jsdom window's realm can trip assert.deepStrictEqual's prototype
// check even when its own contents are structurally identical) — JSON
// round-trip strips realm identity entirely, safe here since every value
// compared is plain strings/booleans/numbers.
function jn(x) { return JSON.parse(JSON.stringify(x)); }

function teacherSession(extra) {
  return Object.assign({ currentUser: { id: 't1', role: 'teacher' }, currentRole: 'teacher', classSections: [] }, extra);
}

function participant(overrides) {
  return Object.assign({ classId: 'classA', totalDamage: 0, correctAnswers: 0, wrongAnswers: 0, critHits: 0, minionsDefeated: 0, lastQIdx: 0 }, overrides);
}

test('boss_participants delta sync: pushes only the dirty (bossIdx, studentId) pair', async () => {
  const dirtyIds = { boss_participants: ['0:s2'] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  const cache = {
    _bossIdById: { 'boss-uuid-1': 0 },
    bossParticipants: {
      0: { s1: participant({ totalDamage: 10 }), s2: participant({ totalDamage: 20 }) },
    },
  };
  await loaded.DBService._test.pushCacheToSupabase(client, cache);

  const call = calls.find(c => c.table === 'boss_participants');
  assert.ok(call, 'boss_participants should still have been pushed — it had one dirty pair');
  assert.equal(call.rows.length, 1);
  assert.equal(call.rows[0].student_id, 's2');
  assert.equal(call.rows[0].total_damage, 20);
  assert.deepEqual(jn(loaded.win.clearDirtyCalls), [{ table: 'boss_participants', ids: ['0:s2'] }]);
});

test('boss_participants delta sync: a dirty pair on an unresolved boss (no uuid yet) is neither pushed nor cleared', async () => {
  const dirtyIds = { boss_participants: ['1:s2'] }; // boss idx 1 has no uuid in _bossIdById below
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  const cache = {
    _bossIdById: { 'boss-uuid-1': 0 },
    bossParticipants: { 1: { s2: participant({ totalDamage: 20 }) } },
  };
  await loaded.DBService._test.pushCacheToSupabase(client, cache);

  assert.ok(!calls.some(c => c.table === 'boss_participants'), 'nothing resolvable to push this cycle');
  assert.deepEqual(jn(loaded.win.clearDirtyCalls), [], 'must not clear a dirty id for a row that was never actually pushed');
});

test('boss_participants delta sync: an explicit empty dirty array skips the push entirely', async () => {
  const dirtyIds = { boss_participants: [] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  const cache = { _bossIdById: { 'boss-uuid-1': 0 }, bossParticipants: { 0: { s1: participant() } } };
  await loaded.DBService._test.pushCacheToSupabase(client, cache);

  assert.ok(!calls.some(c => c.table === 'boss_participants'));
  assert.deepEqual(jn(loaded.win.clearDirtyCalls), []);
});

test('no-clobber: two students concurrently fighting the same boss — one dirtying their own row does not resend, and clobber, the other', async () => {
  // Both students' clients start from the same pull: s1 at 10 damage, s2 at
  // 20. Student A (playing as s1) lands another hit — only s1's row is
  // dirtied on A's client. Student B's client never touched s2's row this
  // session (B IS s2, or is simply idle) but shares the same cache shape.
  // Before delta sync, A's whole-slice push would have re-sent A's cached
  // (stale, pre-hit-from-B-if-any) copy of s2 right alongside s1 — this
  // test proves it now only sends what A actually dirtied.
  const seedRoster = { s1: participant({ totalDamage: 10 }), s2: participant({ totalDamage: 20 }) };
  const sessionA = loadAppStoreWindow({ bossParticipants: { 0: Object.assign({}, seedRoster) } });
  await sessionA.AppStore.ready;

  sessionA.AppStore.updateState((draft) => {
    draft.bossParticipants[0].s1.totalDamage = 25;
    draft.bossParticipants[0].s1.correctAnswers = 1;
  });
  assert.deepEqual(dj(sessionA.AppStore.getDirtyIds('boss_participants')), ['0:s1'], 'only s1 — the row A actually hit — should be dirty');

  const serverCalls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { serverCalls.push({ table, rows, opts }); });
  const dbA = loadDbServiceWindow(teacherSession());
  dbA.win.AppStore.getDirtyIds = (t) => sessionA.AppStore.getDirtyIds(t);
  dbA.win.AppStore.clearDirty = (t, ids) => sessionA.AppStore.clearDirty(t, ids);
  const cache = {
    _bossIdById: { 'boss-uuid-1': 0 },
    bossParticipants: sessionA.AppStore.getState().bossParticipants,
  };
  await dbA.DBService._test.pushCacheToSupabase(client, cache);

  const bpCall = serverCalls.find(c => c.table === 'boss_participants');
  assert.ok(bpCall);
  assert.equal(bpCall.rows.length, 1, "s2's row must not be re-sent — A never touched it this cycle");
  assert.equal(bpCall.rows[0].student_id, 's1');
  assert.equal(bpCall.rows[0].total_damage, 25);
  assert.deepEqual(dj(sessionA.AppStore.getDirtyIds('boss_participants')), [], "s1's dirty id cleared after the confirmed push");
});
