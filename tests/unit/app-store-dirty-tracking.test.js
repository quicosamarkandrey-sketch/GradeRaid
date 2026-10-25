'use strict';
// Phase 5 — Data Layer Redesign, sub-phase B (Delta/patch sync), first
// increment: dirty-row tracking in AppStore.updateState().
//
// Covers the _trackDirty()/getDirtyIds()/clearDirty() machinery added to
// modules/core/state-manager.js, tracked so far for exactly one table
// (point_log — see _DELTA_TRACKED_SLICES and this session's Refactoring
// Report entry for why it was picked first). This is the piece
// db-service.js's repository layer (tested separately, in
// db-service-repository-sync.test.js) reads from to decide whether to push
// a whole slice or just the dirtied subset.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadAppStoreWindow } = require('./helpers/load-globals');

// getDirtyIds() runs inside a jsdom window's own realm, so the array it
// returns has that realm's Array.prototype, not this test file's — the
// same cross-realm gotcha load-globals.js's makeFakeSupabaseClient already
// documents/works around for upsert rows. Array.from() re-homes it in this
// realm so assert.deepEqual doesn't fail on prototype identity alone.
function dj(arr) { return Array.from(arr); }

test('AppStore dirty tracking: a new point_log row is marked dirty after updateState', async () => {
  const win = loadAppStoreWindow();
  await win.AppStore.ready;
  assert.deepEqual(dj(win.AppStore.getDirtyIds('point_log')), []);

  win.AppStore.updateState((draft) => {
    draft.pointLog.push({ id: 'pl1', studentId: 's1', what: 'Good job', pts: 5, when: 'today' });
  });

  assert.deepEqual(dj(win.AppStore.getDirtyIds('point_log')), ['pl1']);
});

test('AppStore dirty tracking: an unrelated updateState (no point_log change) does not add dirty ids', async () => {
  const win = loadAppStoreWindow({ pointLog: [{ id: 'pl1', studentId: 's1', what: 'seed', pts: 1, when: 't' }] });
  await win.AppStore.ready;

  win.AppStore.updateState((draft) => {
    draft.students.push({ id: 's2', name: 'New Student' });
  });

  assert.deepEqual(dj(win.AppStore.getDirtyIds('point_log')), [], 'pre-existing point_log rows untouched by this commit must not be dirty');
});

test('AppStore dirty tracking: clearDirty removes exactly the ids given, leaving others pending', async () => {
  const win = loadAppStoreWindow();
  await win.AppStore.ready;

  win.AppStore.updateState((draft) => {
    draft.pointLog.push({ id: 'pl1', studentId: 's1', what: 'a', pts: 1, when: 't' });
    draft.pointLog.push({ id: 'pl2', studentId: 's1', what: 'b', pts: 2, when: 't' });
  });
  assert.deepEqual(dj(win.AppStore.getDirtyIds('point_log')).sort(), ['pl1', 'pl2']);

  win.AppStore.clearDirty('point_log', ['pl1']);
  assert.deepEqual(dj(win.AppStore.getDirtyIds('point_log')), ['pl2']);
});

test('AppStore dirty tracking: a mutation that throws never reaches the dirty diff (atomicity preserved)', async () => {
  const win = loadAppStoreWindow();
  await win.AppStore.ready;

  assert.throws(() => {
    win.AppStore.updateState((draft) => {
      draft.pointLog.push({ id: 'pl1', studentId: 's1', what: 'a', pts: 1, when: 't' });
      throw new Error('boom mid-mutation');
    });
  });

  assert.deepEqual(dj(win.AppStore.getDirtyIds('point_log')), [], 'an aborted mutation must not leave a dangling dirty id');
});

test('AppStore dirty tracking: getDirtyIds/clearDirty on an untracked table name behave as "nothing dirty", not an error', async () => {
  const win = loadAppStoreWindow();
  await win.AppStore.ready;
  assert.deepEqual(dj(win.AppStore.getDirtyIds('shop_products')), []);
  assert.doesNotThrow(() => win.AppStore.clearDirty('shop_products', ['x']));
});
