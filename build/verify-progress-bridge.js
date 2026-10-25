// Phase 7 (Stream A) — equivalence check for modules/recitation/progress.js.
//
// Real-imports AppStore (state-manager.js) and getStudentAttendanceRecords/
// computeAttendanceStreak (student-stats.js), all this stream's own
// already-converted files, all confirmed via repo-wide grep to never be
// reassigned at runtime (see this file's src header and MEMORY.md's
// critical rule about db-migrations.js's saveDB near-miss). ORIGINAL
// side evals the full real chain (state-manager.js needs the same
// transitive DBService setup documented elsewhere) then student-stats.js
// then the original progress.js; BRIDGE side evals the combined test
// bundle sharing one real AppStore instance the same way a real ES
// module graph would.
//
// getStudentAttendanceRecords() reads `DB.attendanceLogs` — the plain
// legacy `DB` global (state-manager.js side-effect, not AppStore) — so
// this script sets `win.DB = { attendanceLogs: [...] }` directly,
// independent of AppStore's own seeded slices (recitationLog/pointLog),
// mirroring how the real app keeps both in sync but letting this test
// control each independently for clearer scenarios.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow(opts) {
  opts = opts || {};
  const html = '<!doctype html><html><body>' +
    '<div id="s-attendance"></div>' +
    '<div id="cal-day-detail" class=""></div>' +
    '</body></html>';
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.org/app/index.html' });
  const win = dom.window;
  win.__EDUQUEST_SUPABASE_URL__ = '';
  win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };
  win.DBService = { initRemote: async () => {}, read: () => null, write: () => {} };

  win.currentUser = opts.currentUser !== undefined ? opts.currentUser : null;
  win.currentRole = opts.currentRole !== undefined ? opts.currentRole : 'student';
  win.DB = { attendanceLogs: [] };
  // state-manager.js's init() falls back to cloning the bare global
  // DEFAULT_DB when DBService.read() returns empty. The ORIGINAL chain
  // gets a real DEFAULT_DB from evaling db-schema.js; the BRIDGE's
  // combined bundle for THIS file doesn't include db-schema.js at all
  // (progress.js/student-stats.js don't import it), so window.DEFAULT_DB
  // would otherwise never exist there. A minimal stub here satisfies
  // state-manager.js's init() on both sides identically — this file
  // never reads DEFAULT_DB itself, only pointLog/recitationLog/students,
  // all seeded explicitly via AppStore.updateState() in this script.
  win.DEFAULT_DB = { students: [], pointLog: [], recitationLog: [], attendanceSessions: [] };

  win._esc = function (s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  win._cssColor = function (s, fallback) {
    fallback = fallback || '#8b5cf6';
    const v = String(s || '').trim();
    if (/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) return v;
    return fallback;
  };
  return win;
}

async function evalFullOriginalChain(win) {
  const files = ['supabase-client.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'repository/table-sync.js', 'db-service.js', 'modules/core/state-manager.js', 'student-stats.js', 'modules/recitation/progress.js'];
  for (const f of files) win.eval(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
  await win.AppStore.ready;
}

async function evalBridge(win) {
  const supabaseClientSrc = fs.readFileSync(path.join(__dirname, '..', 'supabase-client.js'), 'utf8');
  win.eval(supabaseClientSrc);
  const bridgeSrc = fs.readFileSync(path.join(__dirname, 'test-helpers', 'progress-combined-bundle.js'), 'utf8');
  win.eval(bridgeSrc);
  await win.AppStore.ready;
}

const STUDENT = { id: 's1', name: 'Ana Cruz', tier: 'Scholar', level: 5, color: '#8b5cf6', init: 'AC', xp: 3200, coins: 400 };

function seedAttendance(win) {
  win.DB.attendanceLogs = [
    { studentId: 's1', logDate: '2026-08-24', status: 'On Time' },
    { studentId: 's1', logDate: '2026-08-25', status: 'Early' },
    { studentId: 's1', logDate: '2026-08-26', status: 'Late' },
    { studentId: 's1', logDate: '2026-08-27', status: 'Excused' },
    { studentId: 's1', logDate: '2026-08-28', status: 'Absent' },
    { studentId: 'OTHER', logDate: '2026-08-24', status: 'On Time' },
  ];
}

async function seedRecitationAndQuiz(win) {
  await win.AppStore.ready;
  win.AppStore.updateState(draft => {
    draft.recitationLog = [
      { studentId: 's1', when: '2026-08-24', note: 'Great answer', pts: 10 },
      { studentId: 's1', when: '2026-08-25', note: 'Good try', pts: 5 },
      { studentId: 'OTHER', when: '2026-08-24', note: 'x', pts: 1 },
    ];
    draft.pointLog = [
      { studentId: 's1', what: 'Quest: Fractions (90%)', pts: 18, when: '2026-08-25' },
      { studentId: 's1', what: 'Attendance recorded', pts: 2, when: '2026-08-24' },
    ];
  }, { type: 'test:seed' });
}

function runPureFunctionScenarios(win) {
  const results = {};

  results.attStreakEmpty = win.progAttStreak([]);
  results.attStreakMixed = win.progAttStreak([
    { status: 'present', date: '2026-08-20' },
    { status: 'present', date: '2026-08-21' },
    { status: 'absent', date: '2026-08-22' },
    { status: 'present', date: '2026-08-23' },
  ]);

  results.recStreakEmpty = win.progRecStreak([]);
  results.recStreakBasic = win.progRecStreak([
    { when: '2026-08-20', pts: 5 },
    { when: '2026-08-21', pts: 5 },
    { when: '2026-08-23', pts: 5 },
  ]);

  results.perfectMonthsNone = win.progPerfectMonths([]);
  results.perfectMonthsMixed = win.progPerfectMonths([
    { status: 'present', date: '2026-01-05' },
    { status: 'present', date: '2026-01-12' },
    { status: 'present', date: '2026-02-05' },
    { status: 'absent', date: '2026-02-12' },
  ]);

  return results;
}

async function runDataPlumbingScenarios(win) {
  const results = {};
  // Order matters: AppStore.updateState() (used by seedRecitationAndQuiz)
  // keeps `window.DB` in sync with its own tracked state as a side
  // effect, which does NOT include `attendanceLogs` (a legacy field
  // AppStore never adopted) — so it would silently wipe out
  // `win.DB.attendanceLogs` if seeded first. Seed attendance LAST.
  await seedRecitationAndQuiz(win);
  seedAttendance(win);

  results.attendanceForStudent = win.progGetAttendanceForStudent('s1');
  results.attendanceForOther = win.progGetAttendanceForStudent('OTHER');
  results.recitationsForStudent = win.progGetRecitationsForStudent('s1');
  results.calendarAug2026 = win.progBuildCalendar('s1', 2026, 7); // August = month index 7

  return results;
}

async function runRenderScenarios(win) {
  const results = {};

  // Not logged in.
  win.currentUser = null;
  win.renderStudentProgress();
  results.notLoggedIn = win.document.getElementById('s-attendance').innerHTML;

  // Logged in, default tab (streaks). Don't write win.progActiveTab
  // directly — same shadowing issue as progCalYear (see below): a
  // window property write here would just create an inert shadow,
  // never seen by the module's own internal `let` binding. The
  // module's own initial default is already 'streaks', so no setup is
  // needed here at all.
  win.currentUser = STUDENT;
  win.renderStudentProgress();
  const full = win.document.getElementById('s-attendance').innerHTML;
  results.loggedInHasHero = full.includes('Ana Cruz');
  results.loggedInStreaksActive = /class="prog-tab active"[^>]*>.*local_fire_department/s.test(full) || full.includes('local_fire_department');
  results.loggedInPanelStreaksActive = full.includes('id="prog-panel-streaks"');
  results.fullPageHTML = full;

  // Switch tab -> calendar, re-renders full page with calendar panel
  // active. Verify via the rendered HTML's active-panel marker, not by
  // reading win.progActiveTab externally afterward (same window-
  // shadowing/staleness issue as progCalYear — never a reliable
  // external read on either side; see this file's header).
  win.progSwitchTab('calendar');
  const afterSwitch = win.document.getElementById('s-attendance').innerHTML;
  results.afterSwitchCalendarPanelActive = afterSwitch.includes('class="prog-panel active" id="prog-panel-calendar"');
  results.afterSwitchStreaksPanelInactive = afterSwitch.includes('class="prog-panel " id="prog-panel-streaks"');
  results.afterSwitchHTML = afterSwitch;

  // Calendar nav: advance a month, only the calendar panel re-renders.
  // NOTE: do NOT read win.progCalYear/win.progCalMonth directly here to
  // check the effect — see this file's own header and MEMORY.md for why
  // that's unreliable cross-side (never exposed on window in the
  // ORIGINAL at all; only a one-time stale snapshot on the BRIDGE).
  // The calendar panel's own rendered month label is the correct,
  // symmetric way to observe the internal state change on both sides.
  win.progCalNav(1);
  results.calPanelAfterNav = win.document.getElementById('prog-panel-calendar').innerHTML;

  // Calendar nav wraps year boundary going backward from January.
  // Reset via progSwitchTab-free direct render: call progCalNav()
  // enough times to reach a known state is fragile, so instead drive it
  // from the CURRENT (unknown-to-this-script, but consistent) internal
  // state by reading the rendered label before/after rather than
  // asserting specific absolute year/month numbers.
  results.calPanelBeforeWrapTest = win.document.getElementById('prog-panel-calendar').innerHTML.match(/cal-month-label">([^<]+)</)[1];
  for (let i = 0; i < 13; i++) win.progCalNav(-1); // walk back just over a year
  results.calPanelAfterThirteenBack = win.document.getElementById('prog-panel-calendar').innerHTML.match(/cal-month-label">([^<]+)</)[1];

  // Day detail popup: a day with recitation + quiz activity (explicit
  // year/month args — progShowCalDay takes them directly, unaffected by
  // the internal nav state we just walked around above).
  win.progShowCalDay(25, 2026, 7);
  results.dayDetailHTML = win.document.getElementById('cal-day-detail').innerHTML;
  results.dayDetailOpenClass = win.document.getElementById('cal-day-detail').classList.contains('open');

  // Day detail popup: clicking a day with NO calendar-data entry at all
  // (progBuildCalendar never creates a key for it) hits progShowCalDay's
  // `if (!d) return;` early exit — the popup's content from the
  // PREVIOUS call is left on screen unchanged. (The function's later
  // "No activities recorded" empty-state branch is effectively dead
  // code in practice: reaching it requires a data[key] entry to exist
  // with empty recitations/quizzes AND a falsy status, but
  // progBuildCalendar only ever creates a key when at least one of
  // those three sources has something for that day.) Verified as real
  // original behavior, not a conversion bug — asserting the true
  // behavior here, not the code's apparent intent.
  win.progShowCalDay(1, 2026, 7);
  results.emptyDayDetailHTML = win.document.getElementById('cal-day-detail').innerHTML;
  results.emptyDayDetailUnchangedFromPrevious = results.emptyDayDetailHTML === results.dayDetailHTML;

  return results;
}

async function runFullSuite(evalFn) {
  const results = {};

  const win1 = makeWindow({});
  await evalFn(win1);
  results.pure = runPureFunctionScenarios(win1);
  results.plumbing = await runDataPlumbingScenarios(win1);

  const win2 = makeWindow({});
  await evalFn(win2);
  await seedRecitationAndQuiz(win2);
  seedAttendance(win2);
  results.render = await runRenderScenarios(win2);

  return results;
}

async function main() {
  const resultOriginal = await runFullSuite(evalFullOriginalChain);
  const resultBridge = await runFullSuite(evalBridge);

  // jsdom cross-realm gotcha (documented in MEMORY.md): compare via
  // JSON.stringify rather than assert.deepStrictEqual.
  // jsdom cross-realm gotcha (documented in MEMORY.md): compare via
  // JSON.stringify rather than assert.deepStrictEqual.
  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original at every step');

  // Sanity checks against the original's real values.
  assert.strictEqual(JSON.stringify(resultOriginal.pure.attStreakEmpty), JSON.stringify({ current: 0, longest: 0 }), 'sanity: empty attendance -> zero streaks');
  assert.strictEqual(resultOriginal.pure.attStreakMixed.longest >= 2, true, 'sanity: two consecutive present days form a streak of at least 2');
  assert.strictEqual(JSON.stringify(resultOriginal.pure.recStreakEmpty), JSON.stringify({ current: 0, longest: 0 }), 'sanity: empty recitations -> zero streaks');
  assert.strictEqual(resultOriginal.pure.perfectMonthsNone, 0, 'sanity: no sessions -> zero perfect months');
  assert.strictEqual(resultOriginal.pure.perfectMonthsMixed, 1, 'sanity: only January (2/2 present) counts as perfect; February has an absence');

  assert.strictEqual(resultOriginal.plumbing.attendanceForStudent.length, 4, 'sanity: 4 of 5 s1 attendance logs count (Excused is dropped entirely)');
  assert.strictEqual(resultOriginal.plumbing.attendanceForStudent.every(a => a.status === 'present' || a.status === 'absent'), true, 'sanity: statuses normalized to present/absent only');
  assert.strictEqual(resultOriginal.plumbing.attendanceForOther.length, 1, 'sanity: per-student filtering works');
  assert.strictEqual(resultOriginal.plumbing.recitationsForStudent.length, 2, 'sanity: recitationLog filtered by studentId');
  assert.strictEqual(Object.keys(resultOriginal.plumbing.calendarAug2026).length > 0, true, 'sanity: calendar has at least one populated day for August 2026');
  assert.strictEqual(resultOriginal.plumbing.calendarAug2026['25'].recitations.length, 1, 'sanity: Aug 25 recitation attributed to the right day');
  assert.strictEqual(resultOriginal.plumbing.calendarAug2026['25'].quizzes.length, 1, 'sanity: Aug 25 quiz-type pointLog entry attributed to the right day');

  assert.ok(resultOriginal.render.notLoggedIn.includes('Not logged in'), 'sanity: logged-out state shows the not-logged-in message');
  assert.strictEqual(resultOriginal.render.loggedInHasHero, true, 'sanity: logged-in render shows the student\'s name');
  assert.strictEqual(resultOriginal.render.loggedInPanelStreaksActive, true, 'sanity: default tab is streaks');
  assert.strictEqual(resultOriginal.render.afterSwitchCalendarPanelActive, true, 'sanity: after switching, the calendar panel is the active one');
  assert.strictEqual(resultOriginal.render.afterSwitchStreaksPanelInactive, true, 'sanity: after switching, the streaks panel is no longer active');
  assert.notStrictEqual(resultOriginal.render.calPanelAfterNav.match(/cal-month-label">([^<]+)</)[1], undefined, 'sanity: calendar panel re-renders after progCalNav');
  assert.notStrictEqual(resultOriginal.render.calPanelAfterThirteenBack, resultOriginal.render.calPanelBeforeWrapTest, 'sanity: walking back 13 months changes the rendered month label');
  assert.ok(/\b(2024|2025)\b/.test(resultOriginal.render.calPanelAfterThirteenBack), 'sanity: walking back 13 months from a page freshly rendered in the current month lands in a past year');
  assert.strictEqual(resultOriginal.render.dayDetailOpenClass, true, 'sanity: showing a day detail adds the open class');
  assert.ok(resultOriginal.render.dayDetailHTML.includes('Recitations'), 'sanity: day with a recitation shows the recitations section');
  assert.ok(resultOriginal.render.dayDetailHTML.includes('Quests Completed'), 'sanity: day with a quiz shows the quests section');
  assert.strictEqual(resultOriginal.render.emptyDayDetailUnchangedFromPrevious, true, 'sanity: clicking a day with no calendar-data entry at all no-ops (leaves the previous popup content on screen) — see this script\'s comment for why the "No activities recorded" branch is effectively unreachable in practice');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('progress.js: streak/perfect-month math, attendance-log normalization (Excused dropped,');
  console.log('Early/On Time/Late -> present), calendar day-bucketing across attendance/recitation/quiz');
  console.log('sources, the not-logged-in guard, tab switching, calendar month nav (incl. walking back');
  console.log('across a year boundary), and the day-detail popup (with activity, and the no-op-on-empty-day');
  console.log('quirk) all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
