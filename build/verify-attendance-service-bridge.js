// Phase 7 (Stream A) — equivalence check for
// modules/attendance/attendance-service.js.
//
// Real-imports AppStore, DBService, recalcStudentStats, and
// syncStudentDerivedStatsToServer — all this stream's own already-
// converted files/symbols, all confirmed via repo-wide grep against
// the "no runtime reassignment anywhere" rule (MEMORY.md) before
// finalizing.
//
// DBService.rpc is mocked by mutating the METHOD on the shared real
// DBService object (not replacing window.DBService) — works across the
// real-import boundary since both sides' AttendanceService/
// syncStudentDerivedStatsToServer read the SAME object's .rpc property
// at call time. Keyed by RPC name so every method (and the internal
// syncStudentDerivedStatsToServer fire-and-forget call, RPC name
// 'sync_student_derived_stats') gets a sensible canned response.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html></html>', { runScripts: 'dangerously', url: 'https://example.org/app/index.html' });
  const win = dom.window;
  win.__EDUQUEST_SUPABASE_URL__ = '';
  win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };
  win.DBService = { initRemote: async () => {}, read: () => null, write: () => {} };
  win.DEFAULT_DB = { students: [], attendanceLogs: [], rfidCards: [], attendanceSchedules: [] };
  win.currentUser = null;
  win.isoDate = () => '2026-08-31';
  win.__rpcCalls = [];
  return win;
}

async function evalFullOriginalChain(win) {
  const files = ['supabase-client.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'repository/table-sync.js', 'db-service.js', 'modules/core/state-manager.js', 'student-stats.js', 'modules/attendance/attendance-service.js'];
  for (const f of files) win.eval(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
  await win.AppStore.ready;
}

async function evalBridge(win) {
  const supabaseClientSrc = fs.readFileSync(path.join(__dirname, '..', 'supabase-client.js'), 'utf8');
  win.eval(supabaseClientSrc);
  const bridgeSrc = fs.readFileSync(path.join(__dirname, 'test-helpers', 'attendance-service-combined-bundle.js'), 'utf8');
  win.eval(bridgeSrc);
  await win.AppStore.ready;
}

// Installs a fresh RPC mock keyed by name; returns a call-log array.
function mockRpc(win, handlers) {
  const calls = [];
  win.DBService.rpc = async function (name, params) {
    calls.push({ name, params });
    const h = handlers[name];
    if (!h) return { data: null, error: null };
    const result = typeof h === 'function' ? h(params) : h;
    return result;
  };
  return calls;
}

async function seedState(win, overrides) {
  await win.AppStore.ready;
  win.AppStore.updateState(draft => {
    Object.assign(draft, {
      students: [
        { id: 's1', name: 'Ana Cruz', classId: 'c1', attendance: 0, quizAvg: 0 },
        { id: 's2', name: 'Solo', classId: 'c1', attendance: 0, quizAvg: 0 },
      ],
      attendanceLogs: [],
      rfidCards: [],
      attendanceSchedules: [],
    }, overrides || {});
  }, { type: 'test:seed' });
}

async function runScenarios(win) {
  const results = {};

  // --- assignCard: success, deactivates prior card on either side ---
  await seedState(win, { rfidCards: [{ id: 'card-old', tagId: 'TAG-OLD', studentId: 's1', isActive: true, assignedAt: '2026-01-01', revokedAt: null }] });
  mockRpc(win, {
    assign_rfid_card: { data: { id: 'card-new', tag_id: 'TAG-NEW', student_id: 's1', is_active: true, assigned_at: '2026-08-31', revoked_at: null }, error: null },
  });
  const assignResult = await win.AttendanceService.assignCard('s1', 'TAG-NEW');
  results.assignCard = {
    ok: assignResult.ok,
    cards: win.AppStore.getSlice(s => s.rfidCards),
  };

  // --- assignCard: missing args -> validation error, no RPC call ---
  const noRpcCalls = mockRpc(win, {});
  results.assignCardValidation = await win.AttendanceService.assignCard('', '');
  results.assignCardValidationNoRpc = noRpcCalls.length;

  // --- assignCard: RPC error path ---
  mockRpc(win, { assign_rfid_card: { data: null, error: { message: 'card already taken' } } });
  results.assignCardError = await win.AttendanceService.assignCard('s1', 'TAG-X');

  // --- assignStudentToClass: success + error ---
  await seedState(win, {});
  mockRpc(win, { set_student_class: { data: null, error: null } });
  await win.AttendanceService.assignStudentToClass('s1', 'c2');
  results.assignStudentToClass = { classId: win.AppStore.getStudent('s1').classId };
  mockRpc(win, { set_student_class: { data: null, error: { message: 'nope' } } });
  results.assignStudentToClassError = await win.AttendanceService.assignStudentToClass('s1', 'c3');

  // --- upsertSchedule: validation error + success (new + update) ---
  results.upsertScheduleValidation = await win.AttendanceService.upsertSchedule('c1', {});
  mockRpc(win, {
    upsert_attendance_schedule: (params) => ({
      data: { id: 'sched-1', class_id: params.p_class_id, day_of_week: params.p_day_of_week, day_off: params.p_day_off, open_time: params.p_open_time, start_time: params.p_start_time, late_cutoff: params.p_late_cutoff, close_time: params.p_close_time, active: true },
      error: null,
    }),
  });
  await win.AttendanceService.upsertSchedule('c1', { openTime: '07:00', startTime: '08:00', lateCutoff: '08:15', closeTime: '09:00' });
  results.upsertScheduleNew = win.AppStore.getSlice(s => s.attendanceSchedules);
  await win.AttendanceService.upsertSchedule('c1', { openTime: '07:30', startTime: '08:30', lateCutoff: '08:45', closeTime: '09:30' });
  results.upsertScheduleUpdatedInPlace = win.AppStore.getSlice(s => s.attendanceSchedules);

  // --- clearScheduleOverride: validation + success ---
  results.clearOverrideValidation = await win.AttendanceService.clearScheduleOverride('c1', 0);
  await win.AttendanceService.upsertSchedule('c1', { openTime: '07:00', startTime: '08:00', lateCutoff: '08:15', closeTime: '09:00' }, 1);
  mockRpc(win, { clear_attendance_schedule_override: { data: true, error: null } });
  await win.AttendanceService.clearScheduleOverride('c1', 1);
  results.afterClearOverride = win.AppStore.getSlice(s => s.attendanceSchedules).map(s => s.dayOfWeek);

  // --- getEffectiveSchedule: override day vs default, no RPC involved ---
  await seedState(win, {
    attendanceSchedules: [
      { id: 'default', classId: 'c1', dayOfWeek: 0, active: true, openTime: '07:00', startTime: '08:00', lateCutoff: '08:15', closeTime: '09:00' },
      { id: 'monday', classId: 'c1', dayOfWeek: 1, active: true, openTime: '06:30', startTime: '07:30', lateCutoff: '07:45', closeTime: '08:30' },
    ],
  });
  const monday = new Date('2026-08-31T04:00:00.000Z'); // a Monday in UTC, well inside Monday Manila time too
  const tuesday = new Date('2026-09-01T04:00:00.000Z');
  results.effectiveScheduleMonday = win.AttendanceService.getEffectiveSchedule('c1', { date: monday });
  results.effectiveScheduleTuesdayFallsBackToDefault = win.AttendanceService.getEffectiveSchedule('c1', { date: tuesday });
  results.effectiveScheduleUnknownClass = win.AttendanceService.getEffectiveSchedule('does-not-exist');
  results.effectiveScheduleNoClassId = win.AttendanceService.getEffectiveSchedule();

  // --- processScan: empty/no-class validation, then success (recalc + sync side effects) ---
  results.processScanEmpty = await win.AttendanceService.processScan('', 'c1');
  results.processScanNoClass = await win.AttendanceService.processScan('TAG-1', '');
  await seedState(win, {});
  const rpcCallsForScan = mockRpc(win, {
    process_attendance_scan: { data: { ok: true, log: { id: 'log-1', student_id: 's1', class_id: 'c1', log_date: '2026-08-31', status: 'On Time', scanned_at: '2026-08-31T08:00:00.000Z', entry_method: 'RFID' }, student_id: 's1', status: 'On Time', already_recorded: false }, error: null },
    sync_student_derived_stats: { data: {}, error: null },
  });
  const scanResult = await win.AttendanceService.processScan('TAG-1', 'c1');
  results.processScanSuccess = {
    result: scanResult,
    attendanceLogs: win.AppStore.getSlice(s => s.attendanceLogs),
    studentAttendanceChanged: win.AppStore.getStudent('s1').attendance !== 0,
    syncRpcCalled: rpcCallsForScan.some(c => c.name === 'sync_student_derived_stats'),
  };

  // --- processScan: RPC network error, unknown_card rejection ---
  mockRpc(win, { process_attendance_scan: { data: null, error: { message: 'timeout' } } });
  results.processScanNetworkError = await win.AttendanceService.processScan('TAG-BAD', 'c1');
  mockRpc(win, { process_attendance_scan: { data: { ok: false, error: 'unknown_card', message: 'Card not recognized.' }, error: null } });
  results.processScanUnknownCard = await win.AttendanceService.processScan('TAG-UNKNOWN', 'c1');

  // --- overrideAttendance: validation, recordedBy from currentUser, upsert + remove ---
  results.overrideValidation = await win.AttendanceService.overrideAttendance('', '', '');
  await seedState(win, {});
  win.currentUser = { id: 'teacher-1' };
  const rpcCallsForOverride = mockRpc(win, {
    override_attendance: (params) => ({ data: { ok: true, log: { id: 'log-2', student_id: params.p_student_id, class_id: params.p_class_id, log_date: '2026-08-31', status: params.p_status, recorded_by: params.p_recorded_by } }, error: null }),
    sync_student_derived_stats: { data: {}, error: null },
  });
  await win.AttendanceService.overrideAttendance('s1', 'c1', 'Late', { notes: 'traffic' });
  results.overrideAttendanceRecordedBy = rpcCallsForOverride.find(c => c.name === 'override_attendance').params.p_recorded_by;
  results.overrideAttendanceLogs = win.AppStore.getSlice(s => s.attendanceLogs);
  win.currentUser = null;
  mockRpc(win, { override_attendance: { data: { ok: true, removed: true }, error: null } });
  await win.AttendanceService.overrideAttendance('s1', 'c1', 'Remove');
  results.overrideAttendanceAfterRemove = win.AppStore.getSlice(s => s.attendanceLogs);
  mockRpc(win, { override_attendance: { data: { ok: false, message: 'not allowed' }, error: null } });
  results.overrideAttendanceRejected = await win.AttendanceService.overrideAttendance('s1', 'c1', 'Present');

  // --- closeAttendanceSession: validation + sweep absent students ---
  results.closeSessionValidation = await win.AttendanceService.closeAttendanceSession('');
  await seedState(win, { attendanceLogs: [{ id: 'existing', studentId: 's2', classId: 'c1', logDate: '2026-08-31', status: 'On Time' }] });
  mockRpc(win, { close_attendance_session: { data: { absences_recorded: 1 }, error: null } });
  const closeResult = await win.AttendanceService.closeAttendanceSession('c1', '2026-08-31');
  results.closeSession = {
    result: closeResult,
    logs: win.AppStore.getSlice(s => s.attendanceLogs),
  };
  mockRpc(win, { close_attendance_session: { data: null, error: { message: 'server error' } } });
  results.closeSessionError = await win.AttendanceService.closeAttendanceSession('c1', '2026-08-31');

  return results;
}

function normalizeTimestamps(results) {
  // `new Date().toISOString()` in the source (not a stubbable helper)
  // for revokedAt (assignCard) and scannedAt (closeAttendanceSession's
  // swept rows) — inherently non-deterministic across two separate
  // runs a few ms apart. Not a real correctness signal; normalize.
  const clone = JSON.parse(JSON.stringify(results));
  if (clone.assignCard && clone.assignCard.cards) {
    clone.assignCard.cards.forEach(c => { if (c.revokedAt) c.revokedAt = 'NORMALIZED'; });
  }
  if (clone.closeSession && clone.closeSession.logs) {
    clone.closeSession.logs.forEach(l => { if (l.scannedAt) l.scannedAt = 'NORMALIZED'; });
  }
  return clone;
}

async function main() {
  const winO = makeWindow();
  await evalFullOriginalChain(winO);
  const resultOriginal = normalizeTimestamps(await runScenarios(winO));

  const winB = makeWindow();
  await evalBridge(winB);
  const resultBridge = normalizeTimestamps(await runScenarios(winB));

  // jsdom cross-realm gotcha (documented in MEMORY.md): compare via
  // JSON.stringify rather than assert.deepStrictEqual.
  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original at every step');

  // Sanity checks against the original's real values.
  assert.strictEqual(resultOriginal.assignCard.ok, true, 'sanity: assignCard success');
  assert.strictEqual(resultOriginal.assignCard.cards.find(c => c.id === 'card-old').isActive, false, 'sanity: old card deactivated');
  assert.strictEqual(resultOriginal.assignCard.cards.find(c => c.id === 'card-new').isActive, true, 'sanity: new card active');
  assert.strictEqual(resultOriginal.assignCardValidation.ok, false, 'sanity: assignCard validation error');
  assert.strictEqual(resultOriginal.assignCardValidationNoRpc, 0, 'sanity: validation failure never calls the RPC');
  assert.strictEqual(resultOriginal.assignCardError.ok, false, 'sanity: assignCard RPC error surfaced');
  assert.ok(resultOriginal.assignCardError.error.includes('card already taken'), 'sanity: RPC error message passed through');

  assert.strictEqual(resultOriginal.assignStudentToClass.classId, 'c2', 'sanity: assignStudentToClass updates local state');
  assert.strictEqual(resultOriginal.assignStudentToClassError.ok, false, 'sanity: assignStudentToClass RPC error surfaced');

  assert.strictEqual(resultOriginal.upsertScheduleValidation.ok, false, 'sanity: upsertSchedule validation error on missing fields');
  assert.strictEqual(resultOriginal.upsertScheduleNew.length, 1, 'sanity: upsertSchedule creates one row');
  assert.strictEqual(resultOriginal.upsertScheduleUpdatedInPlace.length, 1, 'sanity: a second upsert for the same class/day updates in place, not a duplicate');
  assert.strictEqual(resultOriginal.upsertScheduleUpdatedInPlace[0].openTime, '07:30', 'sanity: the update actually took the new values');

  assert.strictEqual(resultOriginal.clearOverrideValidation.ok, false, 'sanity: clearScheduleOverride rejects dayOfWeek 0');
  assert.deepStrictEqual(resultOriginal.afterClearOverride, [0], 'sanity: clearing day 1\'s override leaves only the default (day 0) row');

  assert.strictEqual(resultOriginal.effectiveScheduleMonday.dayOfWeek, 1, 'sanity: Monday resolves to the Monday override');
  assert.strictEqual(resultOriginal.effectiveScheduleTuesdayFallsBackToDefault.dayOfWeek, 0, 'sanity: Tuesday (no override) falls back to the default row');
  assert.strictEqual(resultOriginal.effectiveScheduleUnknownClass, null, 'sanity: unknown class -> null');
  assert.strictEqual(resultOriginal.effectiveScheduleNoClassId, null, 'sanity: no classId -> null');

  assert.strictEqual(resultOriginal.processScanEmpty.error, 'empty_scan', 'sanity: empty tag rejected');
  assert.strictEqual(resultOriginal.processScanNoClass.error, 'no_class', 'sanity: missing classId rejected');
  assert.strictEqual(resultOriginal.processScanSuccess.result.ok, true, 'sanity: processScan success');
  assert.strictEqual(resultOriginal.processScanSuccess.result.status, 'On Time', 'sanity: status passed through');
  assert.strictEqual(resultOriginal.processScanSuccess.attendanceLogs.length, 1, 'sanity: log upserted into draft');
  assert.strictEqual(resultOriginal.processScanSuccess.studentAttendanceChanged, true, 'sanity: recalcStudentStats actually ran and changed the student\'s attendance %');
  assert.strictEqual(resultOriginal.processScanSuccess.syncRpcCalled, true, 'sanity: syncStudentDerivedStatsToServer fired its own RPC');
  assert.strictEqual(resultOriginal.processScanNetworkError.error, 'network', 'sanity: RPC network error surfaced');
  assert.strictEqual(resultOriginal.processScanUnknownCard.error, 'unknown_card', 'sanity: RPC-rejected scan surfaces its own error code');

  assert.strictEqual(resultOriginal.overrideValidation.ok, false, 'sanity: overrideAttendance validation error');
  assert.strictEqual(resultOriginal.overrideAttendanceRecordedBy, 'teacher-1', 'sanity: recordedBy derived from currentUser.id when present');
  assert.strictEqual(resultOriginal.overrideAttendanceLogs.length, 1, 'sanity: override upserts a log row');
  assert.strictEqual(resultOriginal.overrideAttendanceAfterRemove.length, 0, 'sanity: "Remove" status removes the log row (recordedBy null -> currentUser was cleared first)');
  assert.strictEqual(resultOriginal.overrideAttendanceRejected.ok, false, 'sanity: a data.ok===false response surfaces as a rejection, not a silent success');

  assert.strictEqual(resultOriginal.closeSessionValidation.ok, false, 'sanity: closeAttendanceSession validation error');
  assert.strictEqual(resultOriginal.closeSession.result.absencesRecorded, 1, 'sanity: closeAttendanceSession reports the RPC\'s absence count');
  assert.strictEqual(resultOriginal.closeSession.logs.length, 2, 'sanity: sweep adds one Absent row for the unlogged student, existing row untouched');
  assert.ok(resultOriginal.closeSession.logs.some(l => l.studentId === 's1' && l.status === 'Absent'), 'sanity: the swept student is marked Absent');
  assert.strictEqual(resultOriginal.closeSessionError.ok, false, 'sanity: closeAttendanceSession RPC error surfaced');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('attendance-service.js: all 8 public methods (assignCard, assignStudentToClass,');
  console.log('upsertSchedule, clearScheduleOverride, getEffectiveSchedule, processScan,');
  console.log('overrideAttendance, closeAttendanceSession) — success paths, validation errors, RPC error');
  console.log('paths, the optimistic AppStore updates, recalcStudentStats/syncStudentDerivedStatsToServer');
  console.log('side effects, and currentUser-derived recordedBy all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
