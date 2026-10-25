// Phase 7 (Stream A) — equivalence check for student-stats.js.
// This file real-imports BOTH DBService and AppStore, so every code
// path that touches either MUST go through the real, fully-evaluated
// module chain — a manually-assigned `win.DBService = {...}` stub is
// silently ignored, since the converted code references the real
// imported BINDING, not `window.DBService`. Both windows therefore
// always eval the full real chain (or, for the bridge side, the
// combined test bundle — see the memory note on why a combined bundle
// is needed whenever external state access to a real-imported
// dependency is required), with RPC behavior controlled entirely via
// the fake `window.supabase` client's `.rpc()` implementation.
const { JSDOM } = require('jsdom');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function makeFakeSupabaseGlobal(calls, opts) {
  opts = opts || {};
  return {
    createClient() {
      return {
        auth: { async getSession() { return { data: { session: null } }; } },
        from() { return { select() { return this; }, order() { return this; }, limit() { return Promise.resolve({ data: [], error: null }); } }; },
        rpc(name, params) {
          calls.push({ name: 'rpc', rpcName: name, params });
          if (opts.rpcThrowsFor === name) return Promise.reject(new Error('boom: ' + name + ' threw'));
          if (opts.rpcFailsFor === name) return Promise.resolve({ data: null, error: { message: 'boom: ' + name + ' failed' } });
          if (name === 'adjust_student_stats') return Promise.resolve({ data: [{ xp: 999, coins: 888, level: 5, tier: 'Scholar' }], error: null });
          if (name === 'update_own_profile_cosmetic') return Promise.resolve({ data: { display_name: params.p_display_name }, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        channel() { return { on() { return this; }, subscribe(cb) { if (cb) cb('SUBSCRIBED'); return this; } }; },
        removeChannel() {},
      };
    },
  };
}

function makeWindow(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html></html>', { runScripts: 'dangerously', url: 'https://example.org/app/index.html' });
  const win = dom.window;
  const calls = [];
  win.__calls = calls;
  win.__logs = [];
  ['log', 'warn', 'error'].forEach(level => {
    win.console[level] = (...args) => { win.__logs.push({ level, args: args.map(a => (a instanceof Error ? a.message : (a && a.message) || String(a))) }); };
  });

  win.__EDUQUEST_SUPABASE_URL__ = opts.noClient ? '' : 'https://fake.supabase.co';
  win.__EDUQUEST_SUPABASE_ANON_KEY__ = opts.noClient ? '' : 'fake-anon-key';
  win.supabase = makeFakeSupabaseGlobal(calls, opts);
  win.DEFAULT_DB = { students: [], quizzes: [], bossEvents: [], classSections: [] };
  win.currentUser = opts.currentUser !== undefined ? opts.currentUser : { id: 's1', xp: 100, coins: 50, level: 1, tier: 'Novice' };

  // Always pre-set a temporary DBService stub. ANY bridge/combined-bundle
  // eval transitively includes state-manager.js (via table-sync.js's real
  // AppStore import, itself pulled in by student-stats.js's own real
  // DBService/AppStore imports), whose eager init() needs SOME
  // window.DBService to exist synchronously the instant it starts running
  // — regardless of whether a given test scenario otherwise cares about
  // DBService at all. This gets correctly overwritten by the real
  // db-service.js's own top-level assignment for the "original" chain,
  // or resolved via the microtask-timing behavior documented in the
  // memory note for the bridge/combined-bundle side.
  win.DBService = { initRemote: async () => {}, read: () => null, write: () => {} };

  return win;
}

function normalizeLogs(logs) {
  const filtered = logs.filter(l => !l.args.some(a => typeof a === 'string' && (a.includes('[AppStore]') || a.includes('No Supabase client configured'))));
  const deduped = [];
  for (const l of filtered) {
    const prev = deduped[deduped.length - 1];
    if (!prev || JSON.stringify(prev) !== JSON.stringify(l)) deduped.push(l);
  }
  return deduped;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function seedAppStore(win, cache) {
  await win.AppStore.ready;
  win.AppStore.updateState(draft => { Object.assign(draft, cache); }, { type: 'test:seed' });
  win.__logs.length = 0;
  win.__calls.length = 0;
}

function runRecalcCase(win) {
  const results = {};

  const s1 = { id: 's1', level: 7, tier: '', quizAvg: 40, attendance: 50 };
  win.DB = { quizHistory: { s1: [{ score: 80 }, { score: 90 }] }, attendanceLogs: [
    { studentId: 's1', status: 'On Time' }, { studentId: 's1', status: 'Late' },
    { studentId: 's1', status: 'Absent' }, { studentId: 's1', status: 'Excused' },
  ], attendanceSessions: [] };
  win.recalcStudentStats(s1);
  results.withHistoryAndLogs = s1;

  const s2 = { id: 's2', level: 22, tier: '', quizAvg: 0, attendance: 0 };
  win.DB = { quizHistory: {}, attendanceLogs: [], attendanceSessions: [{ studentId: 's2', status: 'present' }, { studentId: 's2', status: 'absent' }] };
  win.recalcStudentStats(s2);
  results.noHistoryFallbackToSessions = s2;

  const s3 = { id: 's3', level: 0, tier: '', quizAvg: 77, attendance: 88 };
  win.DB = { quizHistory: {}, attendanceLogs: [], attendanceSessions: [] };
  win.recalcStudentStats(s3);
  results.noDataAtAllPreservesSeed = s3;

  const s4 = { id: 's4', level: 12, tier: '', quizAvg: 0, attendance: 0 };
  win.DB = { quizHistory: {}, attendanceLogs: [{ studentId: 's4', status: 'On Time' }], attendanceSessions: [] };
  win.recalcStudentStats(s4, { attendanceLogs: [{ studentId: 's4', status: 'Absent' }, { studentId: 's4', status: 'On Time' }] });
  results.attendanceLogsOverride = s4;

  results.nullStudentNoThrow = (() => { win.recalcStudentStats(null); return 'no throw'; })();

  return results;
}

function runAttendanceHelpersCase(win) {
  const results = {};
  win.DB = { attendanceLogs: [
    { studentId: 's1', logDate: '2026-06-01', status: 'On Time' },
    { studentId: 's1', logDate: '2026-06-02', status: 'Late' },
    { studentId: 's1', logDate: '2026-06-03', status: 'Excused' },
    { studentId: 's1', logDate: '2026-06-04', status: 'Absent' },
  ] };
  results.recordsFromGlobalDB = win.getStudentAttendanceRecords('s1');
  results.recordsWithOverride = win.getStudentAttendanceRecords('s1', { attendanceLogs: [{ studentId: 's1', logDate: '2026-01-01', status: 'On Time' }] });

  results.streakEmpty = win.computeAttendanceStreak([]);
  results.streakAllAbsent = win.computeAttendanceStreak([{ status: 'absent', date: '2026-01-01' }]);
  results.streakConsecutive = win.computeAttendanceStreak([
    { status: 'present', date: '2020-01-01' }, { status: 'present', date: '2020-01-02' }, { status: 'present', date: '2020-01-03' },
    { status: 'present', date: '2020-01-05' },
  ]);
  return results;
}

async function runSyncStudentStatsCase(win) {
  const results = {};

  results.zeroDeltaNoop = win.syncStudentStatsToServer('s1', 0, 0);
  await sleep(20);
  results.callsAfterZeroDelta = win.__calls.slice();
  win.__calls.length = 0;

  results.noStudentIdNoop = win.syncStudentStatsToServer(null, 5, 5);
  await sleep(20);
  results.callsAfterNoStudentId = win.__calls.slice();
  win.__calls.length = 0;

  win.syncStudentStatsToServer('s1', 50, 20);
  await sleep(30);
  results.afterSuccess = {
    calls: win.__calls.slice(),
    currentUserAfter: win.currentUser,
    studentInAppStore: win.AppStore.getState().students.find(s => s.id === 's1'),
  };
  win.__calls.length = 0;

  return results;
}

async function runRpcFailCase(win) {
  win.syncStudentStatsToServer('s2', 10, 10);
  await sleep(30);
  return { calls: win.__calls.slice(), logs: normalizeLogs(win.__logs) };
}

async function runRpcThrowsCase(win) {
  win.syncStudentStatsToServer('s3', 10, 10);
  await sleep(30);
  return { calls: win.__calls.slice(), logs: normalizeLogs(win.__logs) };
}

async function runOwnProfileCosmeticCase(win, opts) {
  if (opts.noClient) return { offlineResult: await win.syncOwnProfileCosmeticToServer({ displayName: 'New Name' }) };
  const result = await win.syncOwnProfileCosmeticToServer({ displayName: 'New Name' });
  return { result, calls: win.__calls.slice() };
}

async function runRemainingSyncHelpersCase(win) {
  const results = {};

  win.syncStudentDerivedStatsToServer('s1', 95, 88);
  win.syncStudentDerivedStatsToServer(null, 1, 1);
  win.syncStudentDerivedStatsToServer('s1', undefined, undefined);
  win.syncAchievementUnlockToServer('s1', 'ach1', 10, 5, true, 'sec-a');
  win.syncAchievementUnlockToServer(null, 'ach1');
  win.syncAchievementClaimToServer('s1', 'ach1', 10, 5);
  win.syncAchievementRevokeToServer('s1', 'ach1');
  win.syncTitleUnlockToServer('s1', 'title1', 'sec-a');
  win.syncTitleRevokeToServer('s1', 'title1');
  win.syncEquippedTitleToServer('s1', 'title1');
  win.syncEquippedTitleToServer('s1', null);
  await sleep(30);

  results.calls = win.__calls.slice().sort((a, b) => a.rpcName.localeCompare(b.rpcName));
  return results;
}

async function evalFullOriginalChain(win, originalSrc) {
  const supabaseClientSrc = fs.readFileSync(path.join(__dirname, '..', 'supabase-client.js'), 'utf8');
  const pullMappersSrc = fs.readFileSync(path.join(__dirname, '..', 'repository', 'pull-mappers.js'), 'utf8');
  const realtimeGroupsSrc = fs.readFileSync(path.join(__dirname, '..', 'repository', 'realtime-groups.js'), 'utf8');
  const tableSyncSrc = fs.readFileSync(path.join(__dirname, '..', 'repository', 'table-sync.js'), 'utf8');
  const dbServiceSrc = fs.readFileSync(path.join(__dirname, '..', 'db-service.js'), 'utf8');
  const stateManagerSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'core', 'state-manager.js'), 'utf8');
  win.eval(supabaseClientSrc);
  win.eval(pullMappersSrc);
  win.eval(realtimeGroupsSrc);
  win.eval(tableSyncSrc);
  win.eval(dbServiceSrc);
  win.eval(stateManagerSrc);
  win.eval(originalSrc);
  await win.AppStore.ready;
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'student-stats.js'), 'utf8');
  const combinedBridgeSrc = fs.readFileSync(path.join(__dirname, 'test-helpers', 'student-stats-combined-bundle.js'), 'utf8');

  // Pure functions — no chain needed at all.
  {
    const winO = makeWindow({});
    winO.eval(originalSrc);
    const rO = runRecalcCase(winO);
    const winB = makeWindow({});
    winB.eval(combinedBridgeSrc);
    const rB = runRecalcCase(winB);
    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'recalc case mismatch');
  }
  {
    const winO = makeWindow({});
    winO.eval(originalSrc);
    const rO = runAttendanceHelpersCase(winO);
    const winB = makeWindow({});
    winB.eval(combinedBridgeSrc);
    const rB = runAttendanceHelpersCase(winB);
    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'attendance helpers case mismatch');
  }

  // Everything below needs the full real chain (or combined bundle for
  // the bridge side) since these functions use the real-imported
  // DBService/AppStore bindings directly.
  const scenarios = [
    { name: 'syncStudentStatsToServer success', run: runSyncStudentStatsCase, opts: {}, seed: { students: [{ id: 's1', xp: 100, coins: 50, level: 1, tier: 'Novice' }] } },
    { name: 'syncStudentStatsToServer RPC fail', run: runRpcFailCase, opts: { rpcFailsFor: 'adjust_student_stats' }, seed: { students: [] } },
    { name: 'syncStudentStatsToServer RPC throws', run: runRpcThrowsCase, opts: { rpcThrowsFor: 'adjust_student_stats' }, seed: { students: [] } },
    { name: 'syncOwnProfileCosmeticToServer offline', run: (w) => runOwnProfileCosmeticCase(w, { noClient: true }), opts: { noClient: true }, seed: { students: [] } },
    { name: 'syncOwnProfileCosmeticToServer success', run: (w) => runOwnProfileCosmeticCase(w, {}), opts: {}, seed: { students: [] } },
    { name: 'syncOwnProfileCosmeticToServer RPC fail', run: (w) => runOwnProfileCosmeticCase(w, {}), opts: { rpcFailsFor: 'update_own_profile_cosmetic' }, seed: { students: [] } },
    { name: 'syncOwnProfileCosmeticToServer RPC throws', run: (w) => runOwnProfileCosmeticCase(w, {}), opts: { rpcThrowsFor: 'update_own_profile_cosmetic' }, seed: { students: [] } },
    { name: 'remaining 7 sync helpers', run: runRemainingSyncHelpersCase, opts: {}, seed: { students: [] } },
  ];

  for (const s of scenarios) {
    const winO = makeWindow(s.opts);
    await evalFullOriginalChain(winO, originalSrc);
    await seedAppStore(winO, s.seed);
    const rO = await s.run(winO);

    const winB = makeWindow(s.opts);
    const supabaseClientSrc = fs.readFileSync(path.join(__dirname, '..', 'supabase-client.js'), 'utf8');
    winB.eval(supabaseClientSrc); // SupabaseClient is window-fallback (not real-imported by db-service.js) — must be eval'd for the bridge side too
    winB.eval(combinedBridgeSrc);
    await winB.AppStore.ready;
    await seedAppStore(winB, s.seed);
    const rB = await s.run(winB);

    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), `scenario "${s.name}" mismatch`);
  }

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('student-stats.js: recalcStudentStats, getStudentAttendanceRecords, computeAttendanceStreak,');
  console.log('syncStudentStatsToServer (zero-delta/no-id/success incl. reconciliation/RPC-fail/throws),');
  console.log('syncOwnProfileCosmeticToServer (offline/success/fail/throws), and all 7 remaining');
  console.log('fire-and-forget sync helpers all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
