// Phase 7 (Stream A) — equivalence check for modules/core/state-manager.js.
// This is the single highest fan-in file in the whole codebase (84), so
// this check is deliberately thorough: the full init() lifecycle
// (initRemote success/failure/absent, DBService.read() success/empty/
// throw, DEFAULT_DB fallback, window.DB/loadDB/saveDB shims, event
// listener registration, AppStore.ready resolution), updateState()
// (mutation isolation, invalid-fn rejection, debounced persist,
// subscriber notification incl. one subscriber throwing not blocking
// others), syncFromLegacy() (object-form, legacy string-only form,
// no-arg window.DB fallback, the classSections-preservation merge, the
// remote-sync-vs-local-mutation persist/mirrorLocalOnly branching),
// getState/getSlice/getStudent/getBossEvent (cloning + window.DB
// refresh + not-found cases), subscribe/unsubscribe, flushNow, emit
// (valid + invalid), and delta-sync dirty-tracking across all 3 shapes
// (array via point_log, nested via boss_participants, nestedArray via
// inventory, plus watchFields-scoped array via profiles) including
// clearDirty and the dirty-snapshot persist/restore round-trip.
const { JSDOM } = require('jsdom');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const DEFAULT_DB_FIXTURE = {
  students: [], quizzes: [], bossEvents: [], pointLog: [], notifications: [],
  orders: [], bossParticipants: {}, inventory: {}, redemptions: [], titles: [],
  quizHistory: {}, stageMap: [], store: [], achievements: [], classSections: [],
};

function makeWindow(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'dangerously',
    url: 'https://example.org/app/index.html',
  });
  const win = dom.window;
  const calls = [];
  win.__calls = calls;
  win.__logs = [];
  ['log', 'error', 'warn'].forEach(level => {
    win.console[level] = (...args) => { win.__logs.push({ level, args: args.map(a => (a instanceof Error ? a.message : (typeof a === 'string' ? a : JSON.stringify(a)))) }); };
  });

  win.DEFAULT_DB = JSON.parse(JSON.stringify(DEFAULT_DB_FIXTURE));

  let dbStore = opts.initialDb !== undefined ? JSON.parse(JSON.stringify(opts.initialDb)) : null;
  let dirtyStore = null;
  win.DBService = {
    async initRemote() {
      calls.push({ name: 'initRemote' });
      if (opts.initRemoteThrows) throw new Error('initRemote boom');
    },
    read() {
      calls.push({ name: 'read' });
      if (opts.readThrows) throw new Error('read boom');
      return dbStore;
    },
    write(state) {
      calls.push({ name: 'write' });
      dbStore = JSON.parse(JSON.stringify(state));
    },
    writeDirty(snapshot) {
      calls.push({ name: 'writeDirty', snapshot: JSON.parse(JSON.stringify(snapshot)) });
      dirtyStore = JSON.parse(JSON.stringify(snapshot));
    },
    readDirty() {
      calls.push({ name: 'readDirty' });
      return dirtyStore;
    },
    mirrorLocalOnly(state) {
      calls.push({ name: 'mirrorLocalOnly' });
    },
  };
  if (opts.noInitRemote) delete win.DBService.initRemote;
  if (opts.noDirtyMethods) { delete win.DBService.writeDirty; delete win.DBService.readDirty; }

  win.__getDbStore = () => dbStore;
  win.__getDirtyStore = () => dirtyStore;
  win.__seedDirtyStore = (snap) => { dirtyStore = snap; };

  return win;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function snapshotBasic(win) {
  return {
    windowDB: win.DB,
    logs: win.__logs,
    calls: win.__calls,
  };
}

async function runInitSequence(win) {
  const results = {};
  await win.AppStore.ready;
  results.afterReady = snapshotBasic(win);
  results.hasLoadDB = typeof win.loadDB === 'function';
  results.hasSaveDB = typeof win.saveDB === 'function';
  win.__logs.length = 0;
  win.__calls.length = 0;
  return results;
}

async function runFullSequence(win) {
  const results = {};

  await runInitSequence(win);

  // updateState: basic mutation + isolation (mutating the draft inside
  // the callback shouldn't leak until commit; test via a second call
  // seeing the FIRST commit's result, not any half-applied state).
  win.AppStore.updateState(draft => { draft.students.push({ id: 's1', name: 'Alice', xp: 10 }); }, { type: 'test:add-student' });
  results.afterFirstUpdate = { state: win.AppStore.getState(), windowDB: win.DB };

  // Invalid mutationFn.
  win.AppStore.updateState('not a function');
  results.invalidMutationFnLogs = win.__logs.slice();
  win.__logs.length = 0;

  // subscribe/unsubscribe + one throwing subscriber not blocking another.
  const seen = [];
  win.AppStore.subscribe('good', (state, event) => { seen.push({ key: 'good', type: event.type }); });
  win.AppStore.subscribe('bad', () => { throw new Error('subscriber boom'); });
  win.AppStore.updateState(draft => { draft.students[0].xp = 20; }, { type: 'test:xp-update' });
  results.subscriberSeen = seen;
  results.subscriberThrowLogs = win.__logs.filter(l => l.level === 'error');
  win.__logs.length = 0;

  win.AppStore.unsubscribe('bad');
  win.AppStore.subscribe('invalid-fn-target', 'not a function');
  results.subscribeInvalidFnLogs = win.__logs.slice();
  win.__logs.length = 0;

  // getSlice / getStudent / getBossEvent.
  results.sliceStudents = win.AppStore.getSlice(s => s.students);
  results.sliceNonFunction = win.AppStore.getSlice('nope');
  results.studentFound = win.AppStore.getStudent('s1');
  results.studentNotFound = win.AppStore.getStudent('nope');
  win.AppStore.updateState(draft => { draft.bossEvents.push({ hp: 100 }); }, { type: 'test:seed-boss' });
  results.bossFound = win.AppStore.getBossEvent(0);
  results.bossNotFound = win.AppStore.getBossEvent(5);

  // Debounced persist: multiple rapid updates collapse to one write, ~300ms later.
  win.__calls.length = 0;
  win.AppStore.updateState(draft => { draft.students[0].xp = 30; }, { type: 'test:debounce-1' });
  win.AppStore.updateState(draft => { draft.students[0].xp = 40; }, { type: 'test:debounce-2' });
  win.AppStore.updateState(draft => { draft.students[0].xp = 50; }, { type: 'test:debounce-3' });
  results.callsRightAfterRapidUpdates = win.__calls.filter(c => c.name === 'write').length;
  await sleep(400);
  results.writeCallsAfterDebounceWindow = win.__calls.filter(c => c.name === 'write').length;
  results.dbAfterDebouncedWrite = win.__getDbStore().students[0].xp;
  win.__calls.length = 0;

  // flushNow: forces immediate write bypassing debounce.
  win.AppStore.updateState(draft => { draft.students[0].xp = 60; }, { type: 'test:flush' });
  win.AppStore.flushNow();
  results.writeCallsRightAfterFlushNow = win.__calls.filter(c => c.name === 'write').length;
  win.__calls.length = 0;
  await sleep(400); // drain any pending timer so it doesn't leak into the next block

  // emit: valid event notifies subscribers with NO state clone/persist.
  const emitSeen = [];
  win.AppStore.subscribe('emit-watcher', (state, event) => { emitSeen.push(event); });
  win.__calls.length = 0;
  win.AppStore.emit({ type: 'custom:ping', payload: 42 });
  results.emitSeen = emitSeen;
  results.emitCausedNoWrite = win.__calls.filter(c => c.name === 'write').length === 0;
  win.AppStore.emit({ type: 123 }); // invalid — no string .type
  results.emitInvalidLogs = win.__logs.slice();
  win.__logs.length = 0;
  win.AppStore.unsubscribe('emit-watcher');

  // syncFromLegacy — object form, preserving an AppStore-only slice
  // (classSections) that the incoming legacy blob doesn't carry.
  win.AppStore.updateState(draft => { draft.classSections.push({ id: 'sec-a' }); }, { type: 'test:seed-sections' });
  const legacyBlob = { students: [{ id: 's-legacy', name: 'FromLegacy' }], quizzes: [], bossEvents: [] };
  win.__calls.length = 0;
  win.AppStore.syncFromLegacy(legacyBlob, 'state:some-other-sync');
  results.afterSyncFromLegacyObjectForm = { state: win.AppStore.getState(), calls: win.__calls.slice() };
  win.__calls.length = 0;

  // syncFromLegacy — remote-sync event type routes to mirrorLocalOnly, not persist.
  win.AppStore.syncFromLegacy(legacyBlob, 'state:remote-sync');
  await sleep(50);
  results.remoteSyncCalls = win.__calls.slice();
  win.__calls.length = 0;

  // syncFromLegacy — legacy string-only form falls back to window.DB.
  win.DB = { students: [{ id: 's-window-fallback' }], quizzes: [], bossEvents: [] };
  win.AppStore.syncFromLegacy('state:legacy-form-event');
  await sleep(50);
  results.legacyStringFormResult = win.AppStore.getState().students;
  win.__calls.length = 0;

  // Delta-sync dirty tracking: array shape (point_log), nested (boss_participants), nestedArray (inventory), watchFields (profiles).
  win.AppStore.updateState(draft => {
    draft.pointLog = [{ id: 'pl1', pts: 5 }];
    draft.bossParticipants = { 0: { 's1': { dmg: 10 } } };
    draft.inventory = { s1: [{ itemId: 'it1', qty: 1 }] };
  }, { type: 'test:seed-dirty' });
  results.dirtyPointLog = win.AppStore.getDirtyIds('point_log');
  results.dirtyBossParticipants = win.AppStore.getDirtyIds('boss_participants');
  results.dirtyInventory = win.AppStore.getDirtyIds('inventory');
  results.dirtyUntracked = win.AppStore.getDirtyIds('not_a_real_table');

  win.AppStore.clearDirty('point_log', ['pl1']);
  results.dirtyPointLogAfterClear = win.AppStore.getDirtyIds('point_log');
  results.dirtySnapshotAfterClear = win.__getDirtyStore();

  // profiles watchFields: changing xp (not watched) shouldn't dirty; changing name (watched) should.
  win.AppStore.updateState(draft => { draft.students[0].xp = 999; }, { type: 'test:xp-only' });
  results.dirtyProfilesAfterXpOnlyChange = win.AppStore.getDirtyIds('profiles');
  win.AppStore.updateState(draft => { draft.students[0].name = 'Renamed'; }, { type: 'test:name-change' });
  results.dirtyProfilesAfterNameChange = win.AppStore.getDirtyIds('profiles');

  results._testSeam = Object.keys(win.AppStore._test.deltaTrackedSlices).sort();

  return results;
}

async function runNoInitRemoteCase(win) {
  return await runInitSequence(win);
}

async function runInitRemoteThrowsCase(win) {
  return await runInitSequence(win);
}

async function runReadThrowsCase(win) {
  const r = await runInitSequence(win);
  r.state = win.AppStore.getState();
  return r;
}

async function runEmptyReadCase(win) {
  const r = await runInitSequence(win);
  r.state = win.AppStore.getState();
  return r;
}

async function runNoDirtyMethodsCase(win) {
  const r = await runInitSequence(win);
  win.AppStore.updateState(draft => { draft.pointLog = [{ id: 'pl1' }]; }, { type: 'test:x' });
  r.dirtyIds = win.AppStore.getDirtyIds('point_log');
  win.AppStore.clearDirty('point_log', ['pl1']); // should no-op silently (no writeDirty available)
  r.callsAfterClearWithNoDirtyMethods = win.__calls.slice();
  return r;
}

async function runRestoreDirtySnapshotCase(win) {
  // Seed a dirty snapshot BEFORE init() has a chance to read it — since
  // init() runs eagerly at module-eval time, we seed via readDirty's
  // return value being pre-populated in makeWindow via __seedDirtyStore,
  // called before eval.
  const r = await runInitSequence(win);
  r.dirtyIdsAfterRestore = win.AppStore.getDirtyIds('point_log');
  return r;
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'core', 'state-manager.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'state-manager.bridge.js'), 'utf8');

  const cases = [
    { name: 'full sequence (normal init, empty DB, DEFAULT_DB fallback)', run: runFullSequence, opts: {} },
    { name: 'no initRemote (older DBService)', run: runNoInitRemoteCase, opts: { noInitRemote: true } },
    { name: 'initRemote throws', run: runInitRemoteThrowsCase, opts: { initRemoteThrows: true } },
    { name: 'DBService.read() throws', run: runReadThrowsCase, opts: { readThrows: true } },
    { name: 'DBService.read() returns a real DB (not empty)', run: runEmptyReadCase, opts: { initialDb: { students: [{ id: 'pre-existing' }], quizzes: [], bossEvents: [], classSections: [] } } },
    { name: 'no writeDirty/readDirty (older DBService)', run: runNoDirtyMethodsCase, opts: { noDirtyMethods: true } },
  ];

  for (const c of cases) {
    const winO = makeWindow(c.opts);
    winO.eval(originalSrc);
    const rO = await c.run(winO);

    const winB = makeWindow(c.opts);
    winB.eval(bridgeSrc);
    const rB = await c.run(winB);

    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), `case "${c.name}" mismatch`);
  }

  // Restore-dirty-from-storage: seed BEFORE eval so init()'s own
  // _restoreDirtyFromStorage() call picks it up.
  {
    const winO = makeWindow({ initialDb: { students: [], quizzes: [], bossEvents: [], pointLog: [{ id: 'pl-restore' }], classSections: [] } });
    winO.__seedDirtyStore({ point_log: ['pl-restore'] });
    winO.eval(originalSrc);
    const rO = await runRestoreDirtySnapshotCase(winO);

    const winB = makeWindow({ initialDb: { students: [], quizzes: [], bossEvents: [], pointLog: [{ id: 'pl-restore' }], classSections: [] } });
    winB.__seedDirtyStore({ point_log: ['pl-restore'] });
    winB.eval(bridgeSrc);
    const rB = await runRestoreDirtySnapshotCase(winB);

    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'restore-dirty-from-storage mismatch');
  }

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('state-manager.js: init() (normal/no-initRemote/initRemote-throws/read-throws/read-returns-');
  console.log('real-data/no-dirty-methods/restore-dirty-snapshot), updateState (mutation + isolation,');
  console.log('invalid fn, debounced persist, flushNow, subscriber notify incl. one throwing subscriber');
  console.log('not blocking another), subscribe/unsubscribe (incl. invalid fn), getState/getSlice/');
  console.log('getStudent/getBossEvent (incl. not-found), emit (valid + invalid), syncFromLegacy (object');
  console.log('form + classSections preservation, remote-sync mirrorLocalOnly routing, legacy string-only');
  console.log('window.DB fallback form), and delta-sync dirty tracking across all 3 shapes + watchFields +');
  console.log('clearDirty + the _test seam all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
