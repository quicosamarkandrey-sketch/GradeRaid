'use strict';
// Phase 5 — Data Layer Redesign, sub-phase B (Delta/patch sync):
// notifications, the second table converted.
//
// Structurally this mirrors point-log-delta-sync.test.js (same
// dirty-subset-push / empty-skip / failed-push-stays-dirty shape — see
// that file for why each of those matters), so this file doesn't re-derive
// them in as much detail. What's NEW and load-bearing here: notifications
// has a genuinely mutable field (`read`), so this is the first table where
// the doc's literal no-clobber scenario — a session with a stale cached
// copy of a row it never touched clobbering another session's write to
// that same row — can actually be constructed and proven fixed.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadDbServiceWindow, loadAppStoreWindow, makeFakeSupabaseClient } = require('./helpers/load-globals');

function dj(arr) { return Array.from(arr); }

function teacherSession(extra) {
  return Object.assign({ currentUser: { id: 't1', role: 'teacher' }, currentRole: 'teacher', classSections: [] }, extra);
}

test('notifications delta sync: pushes only the dirty subset, and clears exactly the ids it successfully pushed', async () => {
  const dirtyIds = { notifications: ['n2'] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  const cache = {
    notifications: [
      { id: 'n1', studentId: 's1', type: 'xp', icon: '⭐', title: 'XP', body: 'b', action: null, pts: 5, sourceId: null, read: false },
      { id: 'n2', studentId: 's1', type: 'xp', icon: '⭐', title: 'XP2', body: 'b2', action: null, pts: 3, sourceId: null, read: true },
    ],
  };
  await loaded.DBService._test.pushCacheToSupabase(client, cache);

  const call = calls.find(c => c.table === 'notifications');
  assert.ok(call, 'notifications should still have been pushed — it had one dirty row');
  assert.deepEqual(call.rows, [{ id: 'n2', student_id: 's1', type: 'xp', icon: '⭐', title: 'XP2', body: 'b2', action: null, pts: 3, source_id: null, read: true }],
    'only the dirty row should be in the payload — n1 must not be re-sent');
  assert.deepEqual(loaded.win.clearDirtyCalls, [{ table: 'notifications', ids: ['n2'] }]);
});

test('notifications delta sync: an explicit empty dirty array skips the push entirely', async () => {
  const dirtyIds = { notifications: [] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  const cache = { notifications: [{ id: 'n1', studentId: 's1', type: 'xp', icon: '⭐', title: 'XP', body: 'b', action: null, pts: 5, sourceId: null, read: false }] };
  await loaded.DBService._test.pushCacheToSupabase(client, cache);

  assert.ok(!calls.some(c => c.table === 'notifications'), 'no notifications upsert should fire when nothing is dirty');
  assert.deepEqual(loaded.win.clearDirtyCalls, []);
});

test('notifications delta sync: a failed push leaves its ids dirty so the next cycle retries them', async () => {
  const dirtyIds = { notifications: ['n1'] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const client = makeFakeSupabaseClient((table) => {
    if (table === 'notifications') return { error: { code: '42501', message: 'RLS denied' } };
    return { error: null };
  });
  const cache = { notifications: [{ id: 'n1', studentId: 's1', type: 'xp', icon: '⭐', title: 'XP', body: 'b', action: null, pts: 5, sourceId: null, read: true }] };
  await loaded.DBService._test.pushCacheToSupabase(client, cache);

  assert.deepEqual(loaded.win.clearDirtyCalls, [], 'clearDirty must not be called when the upsert reported an error');
});

test('no-clobber: a session with a stale cached copy of a notification it never touched does not overwrite another session\'s already-synced read flag', async () => {
  // This is the doc's literal scenario, made concrete: two sessions (two
  // browser tabs/devices on the same account) both start from a pull where
  // n1 and n2 are unread. Session A marks n1 read and pushes. Session B —
  // which never pulled A's change, so its local cache still has n1 as
  // unread — independently marks a DIFFERENT notification (n2) read and
  // pushes. Under the pre-delta-sync whole-slice push, B's cycle would
  // have re-sent its stale n1 (read:false) right alongside n2, silently
  // reverting A's already-confirmed write the moment B's push landed.
  // Delta sync fixes this structurally: B only ever pushes rows IT
  // dirtied, so its stale copy of n1 (a row it never touched) never makes
  // it into a payload at all, regardless of what value is sitting in B's
  // local cache.
  const seed = [
    { id: 'n1', studentId: 's1', type: 'xp', icon: '⭐', title: 'XP1', body: 'b1', action: null, pts: 5, sourceId: null, read: false },
    { id: 'n2', studentId: 's1', type: 'xp', icon: '⭐', title: 'XP2', body: 'b2', action: null, pts: 3, sourceId: null, read: false },
  ];
  const sessionA = loadAppStoreWindow({ notifications: seed.map(n => Object.assign({}, n)) });
  const sessionB = loadAppStoreWindow({ notifications: seed.map(n => Object.assign({}, n)) });
  await sessionA.AppStore.ready;
  await sessionB.AppStore.ready;

  // Session A marks n1 read and pushes first.
  sessionA.AppStore.updateState((draft) => {
    draft.notifications.find(n => n.id === 'n1').read = true;
  });
  const serverCalls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { serverCalls.push({ table, rows, opts }); });
  const dbA = loadDbServiceWindow(teacherSession());
  dbA.win.AppStore.getDirtyIds = (t) => sessionA.AppStore.getDirtyIds(t);
  dbA.win.AppStore.clearDirty = (t, ids) => sessionA.AppStore.clearDirty(t, ids);
  await dbA.DBService._test.pushCacheToSupabase(client, { notifications: sessionA.AppStore.getState().notifications });

  // Session B, never having pulled A's change, still has n1 as unread
  // locally. It marks n2 read (unrelated) and pushes its own cycle.
  sessionB.AppStore.updateState((draft) => {
    draft.notifications.find(n => n.id === 'n2').read = true;
  });
  const dbB = loadDbServiceWindow(teacherSession());
  dbB.win.AppStore.getDirtyIds = (t) => sessionB.AppStore.getDirtyIds(t);
  dbB.win.AppStore.clearDirty = (t, ids) => sessionB.AppStore.clearDirty(t, ids);
  await dbB.DBService._test.pushCacheToSupabase(client, { notifications: sessionB.AppStore.getState().notifications });

  const notifCalls = serverCalls.filter(c => c.table === 'notifications');
  assert.equal(notifCalls.length, 2, 'each session pushes its own cycle independently');
  assert.deepEqual(dj(notifCalls[0].rows.map(r => r.id)), ['n1'], "session A's push must only touch n1");
  assert.deepEqual(dj(notifCalls[1].rows.map(r => r.id)), ['n2'],
    "session B's push must only touch n2 — its stale local n1 (still read:false) must NOT be re-sent");

  // The server-visible state, reconstructed from every row any push
  // actually sent: n1's read:true (from A) was never overwritten by B's
  // stale copy, because B's payload never contained n1 at all.
  const n1Writes = notifCalls.flatMap(c => c.rows).filter(r => r.id === 'n1');
  assert.equal(n1Writes.length, 1);
  assert.equal(n1Writes[0].read, true, "n1's read:true from session A must survive session B's later, unrelated push");
});
