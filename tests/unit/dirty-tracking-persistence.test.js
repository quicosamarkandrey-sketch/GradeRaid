'use strict';
// Phase 5 — Data Layer Redesign, sub-phase B: bugfix found during a
// post-implementation review. Every prior delta-sync test in this phase
// simulated a COMPLETE session's lifecycle (edit → push → done) — none of
// them simulated an INTERRUPTED one (tab closes / crashes / goes offline
// before the debounced Supabase push runs). That's a real gap: _dirty
// previously lived only in a module-level JS variable, never persisted,
// while _state itself IS persisted to localStorage on every commit. A
// reload would restore the correct data but lose all memory of which of it
// was still unsynced — for append-only tables (point_log, redemptions) in
// particular, a row that's never edited again would then never get pushed,
// silently, forever, with no error anywhere.
//
// Fix: AppStore now persists a serialized snapshot of _dirty alongside
// every _state persist (and immediately on every clearDirty(), not just on
// the debounced flush), and restores it during init() — pruned against
// whatever _state actually loaded, so a stale/unreconcilable id can only
// ever cause a harmless extra idempotent push, never incorrect data.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadAppStoreWindow } = require('./helpers/load-globals');

function dj(arr) { return Array.from(arr); }

test('BUGFIX regression: an edit that never got pushed before "tab close" is still dirty after reload', async () => {
  // Session 1: user adds a point_log entry. It gets persisted locally
  // (flushNow simulates the debounced local write firing) but — this is
  // the scenario that used to lose data — the Supabase push never
  // happened (tab closed, offline, crashed, doesn't matter which).
  const session1 = loadAppStoreWindow();
  await session1.AppStore.ready;
  session1.AppStore.updateState((draft) => {
    draft.pointLog.push({ id: 'pl1', studentId: 's1', what: 'never synced', pts: 5, when: 'today' });
  });
  session1.AppStore.flushNow(); // forces the debounced local persist (and, now, the dirty-snapshot persist) to run immediately
  assert.deepEqual(dj(session1._lastDirtySnapshot.point_log), ['pl1'], 'sanity: the dirty snapshot that got "persisted" really does contain pl1');

  // Session 2 = reload: a fresh AppStore instance seeded with EXACTLY what
  // localStorage would actually contain — the persisted _state (the entry
  // IS there) AND the persisted dirty snapshot from session 1.
  const persistedState = session1.AppStore.getState();
  const session2 = loadAppStoreWindow({
    pointLog: persistedState.pointLog,
    dirtySnapshot: session1._lastDirtySnapshot,
  });
  await session2.AppStore.ready;

  assert.deepEqual(dj(session2.AppStore.getDirtyIds('point_log')), ['pl1'],
    'THE BUG: this used to come back empty — the never-pushed entry would be silently stuck forever. It must now survive the reload.');
});

test('BUGFIX regression: clearDirty() persists immediately, not only on the next unrelated flush', async () => {
  const session1 = loadAppStoreWindow();
  await session1.AppStore.ready;
  session1.AppStore.updateState((draft) => {
    draft.pointLog.push({ id: 'pl1', studentId: 's1', what: 'a', pts: 1, when: 't' });
  });
  session1.AppStore.flushNow();
  assert.deepEqual(dj(session1._lastDirtySnapshot.point_log), ['pl1']);

  // Simulate db-service.js's engine confirming a successful push, WITHOUT
  // any further updateState() call (this is exactly how it's really
  // called — see _runTableSync in db-service.js).
  session1.AppStore.clearDirty('point_log', ['pl1']);

  // No flushNow() call here on purpose — clearDirty() must have persisted
  // on its own.
  assert.deepEqual(dj(session1._lastDirtySnapshot.point_log), [],
    'clearDirty() must persist its own snapshot immediately, not wait for the next unrelated _flushNow()');
});

test('BUGFIX regression: a restored dirty id for a row that no longer exists is dropped, not kept', async () => {
  // Simulates a corrupted/stale dirty snapshot (e.g. from before some
  // unrelated data migration removed the row) — must not crash, and must
  // not keep an id that can never correspond to a real push.
  const session = loadAppStoreWindow({
    pointLog: [{ id: 'pl-real', studentId: 's1', what: 'still here', pts: 1, when: 't' }],
    dirtySnapshot: { point_log: ['pl-real', 'pl-ghost'] },
  });
  await session.AppStore.ready;

  assert.deepEqual(dj(session.AppStore.getDirtyIds('point_log')), ['pl-real'],
    'pl-ghost (no matching row in the loaded state) must be pruned; pl-real must survive');
});

test('BUGFIX regression: restoration also works for nested-shape tables (boss_participants)', async () => {
  const session1 = loadAppStoreWindow({
    bossParticipants: { 0: { s1: { totalDamage: 10, correctAnswers: 0, wrongAnswers: 0, critHits: 0, minionsDefeated: 0, lastQIdx: 0 } } },
  });
  await session1.AppStore.ready;
  session1.AppStore.updateState((draft) => {
    draft.bossParticipants[0].s1.totalDamage = 25;
  });
  session1.AppStore.flushNow();
  assert.deepEqual(dj(session1._lastDirtySnapshot.boss_participants), ['0:s1']);

  const persistedState = session1.AppStore.getState();
  const session2 = loadAppStoreWindow({
    bossParticipants: persistedState.bossParticipants,
    dirtySnapshot: session1._lastDirtySnapshot,
  });
  await session2.AppStore.ready;

  assert.deepEqual(dj(session2.AppStore.getDirtyIds('boss_participants')), ['0:s1'],
    'a never-pushed nested-shape edit must also survive a reload');
});
