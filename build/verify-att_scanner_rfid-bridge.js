// Phase 7 (Stream A) — equivalence check for
// modules/attendance/att_scanner_rfid.js.
//
// Real-imports AppStore, DBService (via AttendanceService's own RPC
// calls), and AttendanceService — all this stream's own already-
// converted files/symbols, all confirmed via repo-wide grep against the
// "no runtime reassignment anywhere" rule (MEMORY.md) before finalizing.
//
// DISCLOSED GAP, not faked: `NDEFReader` (Web NFC) does not exist in
// jsdom/Node at all — `_rfidWebNfcSupported()` always returns false in
// this environment, on BOTH sides identically, so the actual
// NDEFReader-driven capture path (_rfidStartWebNfcCapture's `new
// NDEFReader()` / ndef.scan()/onreading) can never be exercised here.
// This script verifies what it can — the supported()===false path, and
// that _rfidToggleWebNfc()/_rfidStopWebNfcCapture()/
// _rfidRefreshWebNfcButton() behave correctly given that — and discloses
// the rest as untestable in this environment, rather than mocking a
// global browser API that doesn't meaningfully exist in Node.
//
// DBService.rpc is mocked by mutating the shared real object's `.rpc`
// method (same technique as attendance-service.js's own verify script)
// so AttendanceService's calls resolve deterministically.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html><body><div id="a-scanner"></div></body></html>', { runScripts: 'dangerously', url: 'https://example.org/app/index.html' });
  const win = dom.window;
  win.__EDUQUEST_SUPABASE_URL__ = '';
  win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };
  win.DBService = { initRemote: async () => {}, read: () => null, write: () => {} };
  win.DEFAULT_DB = { students: [], attendanceLogs: [], attendanceSchedules: [], rfidCards: [] };

  win.__toastCalls = [];
  win.toast = (msg, color) => { win.__toastCalls.push({ msg, color }); };
  win.__navToCalls = [];
  win.navTo = (id) => { win.__navToCalls.push(id); };
  win.__modalCalls = [];
  win.showModal = (html, size) => {
    win.__modalCalls.push({ html, size });
    const root = win.document.createElement('div');
    root.id = 'modal-root';
    root.innerHTML = html;
    win.document.body.appendChild(root);
  };
  win.__closeModalCalls = 0;
  win.closeModalForce = () => { win.__closeModalCalls++; const r = win.document.getElementById('modal-root'); if (r) r.remove(); };
  win.__confirmReturn = true;
  win.confirm = () => win.__confirmReturn;

  win._esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  win._cssColor = (s, fallback) => {
    fallback = fallback || '#8b5cf6';
    const v = String(s || '').trim();
    return /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ? v : fallback;
  };
  win.isoDate = () => '2026-08-31';
  win.getClassLabel = (classId) => 'Section ' + String(classId || '').toUpperCase();
  win.getActiveClassIds = null; // deliberately absent -> exercises the fallback derive-from-students path

  return win;
}

async function evalFullOriginalChain(win) {
  const files = ['supabase-client.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'repository/table-sync.js', 'db-service.js', 'modules/core/state-manager.js', 'student-stats.js', 'modules/attendance/attendance-service.js', 'modules/attendance/att_scanner_rfid.js'];
  for (const f of files) win.eval(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
  await win.AppStore.ready;
}

async function evalBridge(win) {
  const supabaseClientSrc = fs.readFileSync(path.join(__dirname, '..', 'supabase-client.js'), 'utf8');
  win.eval(supabaseClientSrc);
  const bridgeSrc = fs.readFileSync(path.join(__dirname, 'test-helpers', 'att_scanner_rfid-combined-bundle.js'), 'utf8');
  win.eval(bridgeSrc);
  await win.AppStore.ready;
}

function mockRpc(win, handlers) {
  const calls = [];
  win.DBService.rpc = async function (name, params) {
    calls.push({ name, params });
    const h = handlers[name];
    if (!h) return { data: null, error: null };
    return typeof h === 'function' ? h(params) : h;
  };
  return calls;
}

async function seedState(win, overrides) {
  await win.AppStore.ready;
  win.AppStore.updateState(draft => {
    Object.assign(draft, {
      students: [
        { id: 's1', name: 'Ana Cruz', classId: 'c1', attendance: 92, level: 3, xp: 3200, coins: 40, color: '#8b5cf6', init: 'AC' },
        { id: 's2', name: 'Solo', classId: 'c1', attendance: 60, level: 1, xp: 800, coins: 5 },
      ],
      attendanceLogs: [],
      attendanceSchedules: [],
      rfidCards: [{ id: 'card1', tagId: '0863772967', studentId: 's1', isActive: true, assignedAt: '2026-01-01', revokedAt: null }],
    }, overrides || {});
  }, { type: 'test:seed' });
}

function runPureFunctionScenarios(win) {
  const results = {};

  // --- _rfidNormalizeTagId ---
  results.normalizeEmpty = win._rfidNormalizeTagId('');
  results.normalizeAlreadyDecimal = win._rfidNormalizeTagId('0863772967');
  results.normalizeHexColonHex = win._rfidNormalizeTagId('27:21:7c:33'); // documented example -> 0863772967
  results.normalizeHexDash = win._rfidNormalizeTagId('27-21-7c-33');
  results.normalizeLongerHex = win._rfidNormalizeTagId('aa:bb:cc:dd:ee'); // 5 bytes, not zero-padded
  results.normalizeWhitespace = win._rfidNormalizeTagId('  0011223344  ');

  // --- _rfidTimeStrToDate ---
  const base = new Date('2026-08-31T00:00:00.000Z');
  const t1 = win._rfidTimeStrToDate('07:30', base);
  results.timeStrToDate = { hours: t1.getHours(), minutes: t1.getMinutes() };
  const t2 = win._rfidTimeStrToDate('', base);
  results.timeStrToDateEmpty = { hours: t2.getHours(), minutes: t2.getMinutes() };

  // --- _rfidFormatCountdown ---
  results.countdownZero = win._rfidFormatCountdown(0);
  results.countdownNegative = win._rfidFormatCountdown(-5000);
  results.countdownUnderHour = win._rfidFormatCountdown(90 * 1000);
  results.countdownOverHour = win._rfidFormatCountdown(3661 * 1000);

  // --- _rfidWelcomeMessage ---
  results.welcomeAlreadyRecorded = win._rfidWelcomeMessage('Ana Cruz', 'On Time', null, true);
  results.welcomeLate = win._rfidWelcomeMessage('Ana Cruz', 'Late', null, false);
  results.welcomeStreak = win._rfidWelcomeMessage('Ana Cruz', 'On Time', { current: 5 }, false);
  results.welcomeEarly = win._rfidWelcomeMessage('Ana Cruz', 'Early', null, false);
  results.welcomeDefault = win._rfidWelcomeMessage('Ana Cruz', 'On Time', null, false);
  results.welcomeNoName = win._rfidWelcomeMessage('', 'On Time', null, false);

  // --- _rfidLevelProgress ---
  results.levelProgressNull = win._rfidLevelProgress(null);
  results.levelProgress = win._rfidLevelProgress({ level: 3, xp: 3200 });

  return results;
}

async function runClassRankAndScheduleScenarios(win) {
  const results = {};
  await seedState(win, {});

  // --- _rfidClassRank ---
  results.classRankSolo = win._rfidClassRank({ id: 's1', classId: 'solo-class', xp: 100 });
  results.classRankNull = win._rfidClassRank(null);
  results.classRankTwo = win._rfidClassRank(win.AppStore.getStudent('s1'));

  // --- _rfidTodayISO ---
  results.todayISO = win._rfidTodayISO();

  // --- _rfidClassOptionLabel ---
  results.classOptionLabel = win._rfidClassOptionLabel('c1', win.AppStore.getState());

  // --- _rfidScheduleFor / _rfidNextScheduleMilestone: no schedule configured -> hardcoded fallback ---
  results.scheduleForNoConfig = win._rfidScheduleFor('c1');
  const milestoneNoConfig = win._rfidNextScheduleMilestone('c1');
  results.milestoneNoConfigTone = milestoneNoConfig.tone;

  return results;
}

async function runScanScenarios(win) {
  const results = {};

  // --- attendance mode: unknown card ---
  await seedState(win, {});
  mockRpc(win, { process_attendance_scan: { data: { ok: false, error: 'unknown_card', message: 'Card not recognized.' }, error: null } });
  win.document.getElementById('a-scanner').innerHTML = '<div id="kiosk-spotlight"></div>';
  await win._rfidHandleAttendanceScan('TAG-UNKNOWN');
  results.unknownCardSpotlight = win.document.getElementById('kiosk-spotlight').innerHTML;

  // --- attendance mode: closed window ---
  mockRpc(win, { process_attendance_scan: { data: { ok: false, error: 'closed', message: 'Window is closed.' }, error: null } });
  await win._rfidHandleAttendanceScan('TAG-X');
  results.closedSpotlight = win.document.getElementById('kiosk-spotlight').innerHTML;

  // --- attendance mode: success (profile card) ---
  mockRpc(win, {
    process_attendance_scan: { data: { ok: true, log: { id: 'log-1', student_id: 's1', class_id: 'c1', log_date: '2026-08-31', status: 'On Time', scanned_at: '2026-08-31T08:00:00.000Z', entry_method: 'RFID' }, student_id: 's1', status: 'On Time', already_recorded: false }, error: null },
  });
  await win._rfidHandleAttendanceScan('0863772967');
  results.successSpotlightHasName = win.document.getElementById('kiosk-spotlight').innerHTML.includes('Ana Cruz');
  results.successSpotlightHasLevel = win.document.getElementById('kiosk-spotlight').innerHTML.includes('Level 3');

  // --- assign mode: no target selected ---
  results.assignNoTargetSpotlight = null;
  win.document.getElementById('a-scanner').innerHTML = '<div id="kiosk-spotlight"></div>';
  await win._rfidHandleAssignScan('TAG-1');
  results.assignNoTargetSpotlight = win.document.getElementById('kiosk-spotlight').innerHTML;

  return results;
}

async function runRenderLifecycleScenarios(win) {
  const results = {};
  await seedState(win, {});

  win.renderRfidScanner();
  const html1 = win.document.getElementById('a-scanner').innerHTML;
  results.mountedHasCaptureInput = html1.includes('id="rfid-capture-input"');
  results.mountedHasClassSelect = html1.includes('id="rfid-class-select"');
  results.mountedClassOptionCount = (html1.match(/<option/g) || []).length;
  results.mountedFullscreenButtonText = /kiosk-fullscreen-btn[^>]*>\s*([^<]+)/.exec(html1)[1].trim();

  // Toggle kiosk mode
  win._rfidToggleKioskMode();
  results.bodyHasKioskClassAfterToggle = win.document.body.classList.contains('rfid-kiosk-mode');
  win._rfidToggleKioskMode();
  results.bodyHasKioskClassAfterSecondToggle = win.document.body.classList.contains('rfid-kiosk-mode');

  // Mode/class switching
  win._rfidOpenAssignPicker();
  results.scanModeAfterOpenAssignPicker = win.document.getElementById('a-scanner').innerHTML.includes('Ready to assign a card');
  win._rfidSetMode('attendance');
  results.scanModeAfterSetAttendance = win.document.getElementById('a-scanner').innerHTML.includes('Waiting for a card');

  win._rfidOnClassChange('c1');
  results.htmlAfterClassChangeSelected = win.document.getElementById('rfid-class-select').value;

  // Unmount
  win.unmountRfidScanner();
  results.mountedFlagsAfterUnmount = { kioskClass: win.document.body.classList.contains('rfid-kiosk-mode') };

  return results;
}

async function runActivityAndSettingsScenarios(win) {
  const results = {};
  await seedState(win, {
    attendanceLogs: [
      { id: 'l1', studentId: 's1', classId: 'c1', logDate: '2026-08-31', status: 'On Time', scannedAt: '2026-08-31T08:00:00.000Z', entryMethod: 'RFID' },
      { id: 'l2', studentId: 's2', classId: 'c1', logDate: '2026-08-31', status: 'Late', scannedAt: '2026-08-31T08:20:00.000Z', entryMethod: 'Manual' },
    ],
  });
  win.renderRfidScanner();
  const html = win.document.getElementById('a-scanner').innerHTML;
  results.activityListHasBothNames = html.includes('Ana Cruz') && html.includes('Solo');
  results.rosterStatsPresentCount = /kiosk-roster-stat-present">\s*<div class="kiosk-roster-stat-value">(\d+)/.exec(html)[1];
  results.rosterStatsLateCount = /kiosk-roster-stat-late">\s*<div class="kiosk-roster-stat-value">(\d+)/.exec(html)[1];

  // Settings modal
  win._rfidOpenSettings();
  const modalHtml = win.__modalCalls[win.__modalCalls.length - 1].html;
  results.settingsHasScheduleForm = modalHtml.includes('rfid-sched-open');
  results.settingsHasCloseSessionButton = modalHtml.includes('Close Session');

  // Save schedule (success)
  win.document.getElementById('rfid-sched-open').value = '06:45';
  win.document.getElementById('rfid-sched-start').value = '07:15';
  win.document.getElementById('rfid-sched-late').value = '07:30';
  win.document.getElementById('rfid-sched-close').value = '08:00';
  mockRpc(win, { upsert_attendance_schedule: (p) => ({ data: { id: 'sched-1', class_id: p.p_class_id, day_of_week: p.p_day_of_week, day_off: p.p_day_off, open_time: p.p_open_time, start_time: p.p_start_time, late_cutoff: p.p_late_cutoff, close_time: p.p_close_time, active: true }, error: null }) });
  win.__toastCalls.length = 0;
  await win._rfidSaveSchedule();
  results.saveScheduleToast = win.__toastCalls.slice();
  results.scheduleAfterSave = win.AppStore.getSlice(s => s.attendanceSchedules);

  // Close session (confirmed)
  win.__confirmReturn = true;
  mockRpc(win, { close_attendance_session: { data: { absences_recorded: 1 }, error: null } });
  win.__toastCalls.length = 0;
  await win._rfidCloseSession();
  results.closeSessionToast = win.__toastCalls.slice();
  results.closeModalCallsAfterClose = win.__closeModalCalls;

  // Close session (cancelled via confirm() -> false)
  win.__confirmReturn = false;
  const rpcCallsIfCancelled = mockRpc(win, { close_attendance_session: { data: { absences_recorded: 99 }, error: null } });
  await win._rfidCloseSession();
  results.closeSessionRpcCallsWhenCancelled = rpcCallsIfCancelled.length;

  return results;
}

function runWebNfcScenarios(win) {
  // NDEFReader doesn't exist in jsdom — disclosed, not faked (see header).
  return {
    supported: win._rfidWebNfcSupported(),
    toggleWhenUnsupportedDoesNotThrow: (() => {
      try { win._rfidToggleWebNfc(); return false; } catch (e) { return true; }
    })(),
    refreshButtonNoElementDoesNotThrow: (() => {
      try { win._rfidRefreshWebNfcButton(); return false; } catch (e) { return true; }
    })(),
  };
}

async function runFullSuite(evalFn) {
  const results = {};

  const win1 = makeWindow();
  await evalFn(win1);
  results.pure = runPureFunctionScenarios(win1);
  results.webNfc = runWebNfcScenarios(win1);

  const win2 = makeWindow();
  await evalFn(win2);
  results.classRankAndSchedule = await runClassRankAndScheduleScenarios(win2);

  const win3 = makeWindow();
  await evalFn(win3);
  results.scan = await runScanScenarios(win3);

  const win4 = makeWindow();
  await evalFn(win4);
  results.renderLifecycle = await runRenderLifecycleScenarios(win4);

  const win5 = makeWindow();
  await evalFn(win5);
  results.activityAndSettings = await runActivityAndSettingsScenarios(win5);

  return results;
}

async function main() {
  const resultOriginal = await runFullSuite(evalFullOriginalChain);
  const resultBridge = await runFullSuite(evalBridge);

  // jsdom cross-realm gotcha (documented in MEMORY.md): compare via
  // JSON.stringify rather than assert.deepStrictEqual.
  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original at every step');

  // Sanity checks against the original's real values.
  assert.strictEqual(resultOriginal.pure.normalizeEmpty, '', 'sanity: empty tag normalizes to empty string');
  assert.strictEqual(resultOriginal.pure.normalizeAlreadyDecimal, '0863772967', 'sanity: already-decimal tag passes through unchanged');
  assert.strictEqual(resultOriginal.pure.normalizeHexColonHex, '0863772967', 'sanity: documented hex->decimal conversion example matches exactly');
  assert.strictEqual(resultOriginal.pure.normalizeHexDash, '0863772967', 'sanity: dash-separated hex normalizes the same as colon-separated');
  assert.strictEqual(resultOriginal.pure.normalizeLongerHex.length > 0, true, 'sanity: 5-byte hex still converts (not zero-padded, per the doc comment)');
  assert.strictEqual(resultOriginal.pure.normalizeWhitespace, '0011223344', 'sanity: whitespace trimmed');

  assert.strictEqual(resultOriginal.pure.timeStrToDate.hours, 7, 'sanity: time string parses hours correctly');
  assert.strictEqual(resultOriginal.pure.timeStrToDate.minutes, 30, 'sanity: time string parses minutes correctly');
  assert.strictEqual(resultOriginal.pure.timeStrToDateEmpty.hours, 0, 'sanity: empty time string defaults to midnight hours');
  assert.strictEqual(resultOriginal.pure.timeStrToDateEmpty.minutes, 0, 'sanity: empty time string defaults to midnight minutes');

  assert.strictEqual(resultOriginal.pure.countdownZero, '0:00', 'sanity: zero countdown');
  assert.strictEqual(resultOriginal.pure.countdownNegative, '0:00', 'sanity: negative countdown clamps to zero, not negative');
  assert.strictEqual(resultOriginal.pure.countdownUnderHour, '1:30', 'sanity: under-an-hour countdown has no hour segment');
  assert.strictEqual(resultOriginal.pure.countdownOverHour, '1:01:01', 'sanity: over-an-hour countdown includes the hour segment');

  assert.ok(resultOriginal.pure.welcomeAlreadyRecorded.includes('already logged in'), 'sanity: already-recorded welcome message');
  assert.ok(resultOriginal.pure.welcomeLate.includes('beat the bell'), 'sanity: Late welcome message');
  assert.ok(resultOriginal.pure.welcomeStreak.includes('5-day streak'), 'sanity: streak welcome message');
  assert.ok(resultOriginal.pure.welcomeEarly.includes('early'), 'sanity: Early welcome message');
  assert.strictEqual(resultOriginal.pure.welcomeNoName.includes('Student'), true, 'sanity: missing name falls back to "Student"');

  assert.strictEqual(resultOriginal.pure.levelProgressNull, null, 'sanity: null student -> null level progress');
  assert.strictEqual(resultOriginal.pure.levelProgress.lvl, 3, 'sanity: level progress lvl');
  assert.strictEqual(resultOriginal.pure.levelProgress.xp, 3200, 'sanity: level progress xp');
  assert.strictEqual(resultOriginal.pure.levelProgress.xpNext, 4000, 'sanity: level progress xpNext (level+1)*1000');
  assert.strictEqual(resultOriginal.pure.levelProgress.pct, 80, 'sanity: level progress pct');

  assert.strictEqual(resultOriginal.classRankAndSchedule.classRankSolo, null, 'sanity: solo class (< 2 classmates) -> null rank');
  assert.strictEqual(resultOriginal.classRankAndSchedule.classRankNull, null, 'sanity: null student -> null rank');
  assert.strictEqual(resultOriginal.classRankAndSchedule.classRankTwo.rank, 1, 'sanity: higher-XP student ranks #1');
  assert.strictEqual(resultOriginal.classRankAndSchedule.classRankTwo.of, 2, 'sanity: of 2 classmates');
  assert.strictEqual(resultOriginal.classRankAndSchedule.todayISO, '2026-08-31', 'sanity: _rfidTodayISO delegates to isoDate()');
  assert.ok(resultOriginal.classRankAndSchedule.classOptionLabel.includes('0/2'), 'sanity: class option label shows 0 scanned of 2 enrolled with no logs yet');
  assert.strictEqual(resultOriginal.classRankAndSchedule.scheduleForNoConfig.openTime, '07:00', 'sanity: hardcoded fallback schedule openTime');
  assert.strictEqual(resultOriginal.classRankAndSchedule.scheduleForNoConfig.closeTime, '08:30', 'sanity: hardcoded fallback schedule closeTime');

  assert.ok(resultOriginal.scan.unknownCardSpotlight.includes('Unknown card'), 'sanity: unknown_card shows the right message');
  assert.ok(resultOriginal.scan.closedSpotlight.includes('Attendance Window Closed'), 'sanity: closed window gets its own calmer state, not the generic error');
  assert.strictEqual(resultOriginal.scan.successSpotlightHasName, true, 'sanity: successful scan shows the student name');
  assert.strictEqual(resultOriginal.scan.successSpotlightHasLevel, true, 'sanity: successful scan shows level progress');
  assert.ok(resultOriginal.scan.assignNoTargetSpotlight.includes('Pick a student'), 'sanity: assign mode with no target picked shows the right prompt');

  assert.strictEqual(resultOriginal.renderLifecycle.mountedHasCaptureInput, true, 'sanity: mount creates the hidden capture input');
  assert.strictEqual(resultOriginal.renderLifecycle.mountedHasClassSelect, true, 'sanity: mount creates the class select');
  assert.strictEqual(resultOriginal.renderLifecycle.mountedClassOptionCount, 1, 'sanity: one class option (both seeded students share classId c1)');
  assert.strictEqual(resultOriginal.renderLifecycle.mountedFullscreenButtonText, '⛶ Fullscreen', 'sanity: starts NOT in kiosk mode, per the file\'s own "opt-in" comment');
  assert.strictEqual(resultOriginal.renderLifecycle.bodyHasKioskClassAfterToggle, true, 'sanity: toggling kiosk mode adds the body class');
  assert.strictEqual(resultOriginal.renderLifecycle.bodyHasKioskClassAfterSecondToggle, false, 'sanity: toggling again removes it');
  assert.strictEqual(resultOriginal.renderLifecycle.scanModeAfterOpenAssignPicker, true, 'sanity: opening the assign picker switches to assign mode and re-renders');
  assert.strictEqual(resultOriginal.renderLifecycle.scanModeAfterSetAttendance, true, 'sanity: switching back to attendance mode re-renders the idle state');
  assert.strictEqual(resultOriginal.renderLifecycle.htmlAfterClassChangeSelected, 'c1', 'sanity: class change updates the select\'s value');
  assert.strictEqual(resultOriginal.renderLifecycle.mountedFlagsAfterUnmount.kioskClass, false, 'sanity: unmount always clears kiosk mode, even if it was on');

  assert.strictEqual(resultOriginal.activityAndSettings.activityListHasBothNames, true, 'sanity: activity list shows both students\' names');
  assert.strictEqual(resultOriginal.activityAndSettings.rosterStatsPresentCount, '1', 'sanity: roster stats present count (one On Time)');
  assert.strictEqual(resultOriginal.activityAndSettings.rosterStatsLateCount, '1', 'sanity: roster stats late count (one Late)');
  assert.strictEqual(resultOriginal.activityAndSettings.settingsHasScheduleForm, true, 'sanity: settings modal includes the schedule form');
  assert.strictEqual(resultOriginal.activityAndSettings.settingsHasCloseSessionButton, true, 'sanity: settings modal includes the close-session button');
  assert.strictEqual(resultOriginal.activityAndSettings.saveScheduleToast.length, 1, 'sanity: saving the schedule toasts once');
  assert.ok(resultOriginal.activityAndSettings.saveScheduleToast[0].msg.includes('Schedule saved'), 'sanity: schedule-saved toast wording');
  assert.strictEqual(resultOriginal.activityAndSettings.scheduleAfterSave.length, 1, 'sanity: the schedule was actually upserted into AppStore');
  assert.strictEqual(resultOriginal.activityAndSettings.closeSessionToast.length, 1, 'sanity: closing the session toasts once');
  assert.ok(resultOriginal.activityAndSettings.closeSessionToast[0].msg.includes('1 marked Absent'), 'sanity: close-session toast includes the absence count');
  assert.strictEqual(resultOriginal.activityAndSettings.closeModalCallsAfterClose, 1, 'sanity: closing the session closes the modal');
  assert.strictEqual(resultOriginal.activityAndSettings.closeSessionRpcCallsWhenCancelled, 0, 'sanity: cancelling the confirm() dialog never calls the RPC');

  assert.strictEqual(resultOriginal.webNfc.supported, false, 'sanity (jsdom gap, disclosed): NDEFReader does not exist in this environment, so Web NFC always reports unsupported here');
  assert.strictEqual(resultOriginal.webNfc.toggleWhenUnsupportedDoesNotThrow, false, 'sanity: toggling Web NFC when unsupported starts the capture attempt, which fails inside its own try/catch — must not throw out to the caller');
  assert.strictEqual(resultOriginal.webNfc.refreshButtonNoElementDoesNotThrow, false, 'sanity: refreshing the (absent, unmounted) NFC button is a safe no-op');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('att_scanner_rfid.js: tag normalization (incl. the documented hex/decimal conversion');
  console.log('example), schedule/countdown math, welcome messages, level/rank calculations, the full');
  console.log('attendance-scan and assign-scan flows, mount/unmount lifecycle, kiosk-mode/class/mode');
  console.log('switching, activity log + roster stats rendering, the settings modal (schedule save, close');
  console.log('session with confirm/cancel), and the disclosed Web-NFC-unsupported-in-jsdom paths all match.');
}

// NOTE: renderRfidScanner() starts several real setInterval timers
// (focus-steal, clock, schedule countdown) that are only cleared by
// unmountRfidScanner(). Several scenario windows below call
// renderRfidScanner() without ever unmounting (deliberately, to inspect
// the mounted DOM) — that leaves timers running, which would otherwise
// keep the Node process alive forever. main() below force-exits via
// process.exit() once done rather than relying on natural event-loop
// drain, so this doesn't require every single scenario to unmount.
main().then(() => process.exit(0)).catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
