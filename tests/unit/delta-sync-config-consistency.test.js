'use strict';
// Phase 5 — Data Layer Redesign, sub-phase B: the CI gate every prior
// session's log entry flagged as missing. Nothing previously stopped
// AppStore's `_DELTA_TRACKED_SLICES` (modules/core/state-manager.js) and
// db-service.js's `_TABLE_SYNC_CONFIGS` `deltaTracked` entries from
// silently drifting apart — a table added to one side and not the other
// would fail quietly at runtime (either dirty tracking with no engine to
// consume it, or an engine expecting dirty info that never arrives, which
// falls back to a full-slice push with no warning). This test fails the
// build the moment that happens, instead.
//
// Also asserts the shape-specific config requirement: an 'array'-shaped
// tracked slice needs `idField` on its db-service config (the generic
// engine's array filter reads it); a 'nested'/'nestedArray'-shaped slice
// needs `deltaFilterSource` instead (idField can't express dirtiness for
// either non-flat shape — see boss_participants'/inventory's own log
// entries for why).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadAppStoreWindow, loadDbServiceWindow } = require('./helpers/load-globals');

test('delta-sync config consistency: AppStore and db-service agree on exactly which tables are delta-tracked', async () => {
  const appStoreWin = loadAppStoreWindow();
  await appStoreWin.AppStore.ready;
  const trackedSlices = appStoreWin.AppStore._test.deltaTrackedSlices;
  const trackedTableNames = Array.from(Object.keys(trackedSlices));

  const { DBService } = loadDbServiceWindow({ currentUser: { id: 't1', role: 'admin' }, currentRole: 'admin' });
  const configs = Array.from(DBService._test.tableSyncConfigs);
  const deltaTrackedConfigNames = configs.filter(c => c.deltaTracked).map(c => c.table);

  assert.deepEqual(
    trackedTableNames.slice().sort(),
    deltaTrackedConfigNames.slice().sort(),
    'AppStore._DELTA_TRACKED_SLICES and db-service _TABLE_SYNC_CONFIGS\' deltaTracked entries must name exactly the same tables'
  );
});

test('delta-sync config consistency: every db-service deltaTracked config has the field its AppStore-side shape requires', async () => {
  const appStoreWin = loadAppStoreWindow();
  await appStoreWin.AppStore.ready;
  const trackedSlices = appStoreWin.AppStore._test.deltaTrackedSlices;

  const { DBService } = loadDbServiceWindow({ currentUser: { id: 't1', role: 'admin' }, currentRole: 'admin' });
  const configs = Array.from(DBService._test.tableSyncConfigs);

  configs.filter(c => c.deltaTracked).forEach((cfg) => {
    const slice = trackedSlices[cfg.table];
    assert.ok(slice, `db-service's "${cfg.table}" config is deltaTracked but AppStore has no matching _DELTA_TRACKED_SLICES entry`);
    const shape = slice.shape || 'array';
    if (shape === 'array') {
      assert.equal(typeof cfg.idField, 'string', `"${cfg.table}" is 'array'-shaped in AppStore but its db-service config has no idField`);
    } else {
      assert.equal(typeof cfg.deltaFilterSource, 'function', `"${cfg.table}" is '${shape}'-shaped in AppStore but its db-service config has no deltaFilterSource`);
    }
  });
});
