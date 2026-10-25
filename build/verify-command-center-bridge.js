// Phase 7, Stream B — equivalence check for modules/admin/command-center.js.
// SectionService's own equivalence is already independently proven, so
// the ORIGINAL window evals the real, untouched sections-service.js
// first. setInterval is stubbed to capture the tick callback (instead of
// waiting real wall-clock time) so _ccTick's clock/countdown updates and
// its self-unmount guard can be driven directly. Date itself is frozen
// (per test window, via a real `new Date()` snapshot taken once and
// shared) so schedule cutoffs AND the live clock text rendered on every
// renderAdminDashboard()/tick() call are byte-identical between the
// original window and the bridge window, no matter how many real
// milliseconds pass while driving both through the same sequence — every
// timeline-card branch (locked, day-off, ongoing, finished, upcoming) is
// still hit deterministically, without any risk of a real-clock second
// boundary flipping a value between the two runs.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function nowHMS(frozenMs) {
  return new Date(frozenMs).toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour12: false });
}
function hmsToSec(hms) {
  const p = hms.split(':').map(n => parseInt(n, 10));
  return p[0] * 3600 + p[1] * 60 + p[2];
}
function secToHms(sec) {
  sec = ((sec % 86400) + 86400) % 86400;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const STARTER_HTML = `<!doctype html><html><body>
  <div id="a-dashboard"></div>
</body></html>`;

function installFrozenClock(win, frozenMs) {
  const RealDate = win.Date;
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) { super(frozenMs); return; }
      super(...args);
    }
    static now() { return frozenMs; }
  }
  win.Date = FrozenDate;
}

function makeWindow(opts) {
  opts = opts || {};
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously' });
  const win = dom.window;
  const calls = [];
  win.__calls = calls;

  installFrozenClock(win, opts.frozenMs);

  win._esc = s => String(s == null ? '' : s);
  win.navTo = function (id) { calls.push({ name: 'navTo', id }); };
  win.isoDate = function () { return new win.Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); };
  win.currentUser = { id: opts.userId || 't1', name: 'Ms. Alpha' };
  win.currentRole = opts.role || 'teacher';

  // nowSec is derived from the SAME frozen timestamp installed above, so
  // it lines up exactly with what the window's own `new Date()` calls
  // (including the live clock text rendered by renderAdminDashboard()/
  // tick()) will produce — not just the schedule cutoffs below.
  const nowSec = hmsToSec(nowHMS(opts.frozenMs));
  const today = win.isoDate();

  win.DB = {
    students: [
      { id: 's1', classId: 'sec-locked' }, { id: 's2', classId: 'sec-locked' },
      { id: 's3', classId: 'sec-dayoff' },
      { id: 's4', classId: 'sec-finished' }, { id: 's5', classId: 'sec-finished' }, { id: 's6', classId: 'sec-finished' },
      { id: 's7', classId: 'sec-ongoing' }, { id: 's8', classId: 'sec-ongoing' },
      { id: 's9', classId: 'sec-upcoming' },
    ],
    attendanceSchedules: [
      { classId: 'sec-dayoff-fallback', dayOfWeek: 0, active: true, openTime: '07:00:00', closeTime: '08:00:00' },
    ],
    attendanceLogs: [
      { classId: 'sec-finished', logDate: today, status: 'Present' },
      { classId: 'sec-finished', logDate: today, status: 'Late' },
      { classId: 'sec-finished', logDate: today, status: 'Absent' },
      { classId: 'sec-ongoing', logDate: today, status: 'Present' },
    ],
    recitationLog: [
      { classId: 'sec-finished', studentId: 's4', pts: 5, createdAt: new Date().toISOString() },
      { classId: 'sec-ongoing', studentId: 's7', pts: 3, createdAt: new Date().toISOString() },
    ],
  };

  const schedules = {
    'sec-dayoff': { dayOff: true, openTime: '00:00', closeTime: '00:00' },
    'sec-finished': { dayOff: false, openTime: secToHms(nowSec - 7200), closeTime: secToHms(nowSec - 3600) },
    'sec-ongoing': { dayOff: false, openTime: secToHms(nowSec - 600), closeTime: secToHms(nowSec + 600) },
    'sec-upcoming': { dayOff: false, openTime: secToHms(nowSec + 600), closeTime: secToHms(nowSec + 1200) },
    // 'sec-locked' intentionally has no entry -> _ccScheduleFor falls through to DB.attendanceSchedules (also empty for it) -> null -> Locked card.
  };

  if (!opts.noAttendanceService) {
    win.AttendanceService = { getEffectiveSchedule: (classId) => schedules[classId] || null };
  }

  const sections = [
    { id: 'sec-locked', gradeLevel: '7', sectionName: 'Locked', adviserId: 't1', archived: false },
    { id: 'sec-dayoff', gradeLevel: '8', sectionName: 'DayOff', adviserId: 't1', archived: false },
    { id: 'sec-finished', gradeLevel: '9', sectionName: 'Finished', adviserId: 't1', archived: false },
    { id: 'sec-ongoing', gradeLevel: '10', sectionName: 'Ongoing', adviserId: 't1', archived: false },
    { id: 'sec-upcoming', gradeLevel: '11', sectionName: 'Upcoming', adviserId: 't1', archived: false },
    { id: 'sec-other-teacher', gradeLevel: '12', sectionName: 'OtherTeacher', adviserId: 't2', archived: false },
  ];

  let subscribedCallback = null;
  win.AppStore = {
    subscribe(key, fn) { calls.push({ name: 'AppStore.subscribe', key }); subscribedCallback = fn; },
    getState() { return { classSections: sections }; },
    getSlice(fn) { return fn({ classSections: sections }); },
  };
  win.__getSubscribedCallback = () => subscribedCallback;

  let intervalCounter = 0;
  win.__tickFns = {};
  win.setInterval = function (fn, ms) {
    intervalCounter++;
    const id = 'timer' + intervalCounter;
    win.__tickFns[id] = fn;
    calls.push({ name: 'setInterval', ms, id });
    return id;
  };
  win.clearInterval = function (id) { calls.push({ name: 'clearInterval', id }); delete win.__tickFns[id]; };

  return win;
}

function snapshot(win) {
  return { html: win.document.getElementById('a-dashboard').innerHTML, calls: win.__calls };
}

function runSequence(win) {
  const results = {};

  // Nothing should have called renderAdminDashboard via the subscribe
  // wiring yet — subscribe() only registers, it doesn't fire immediately.
  results.callsRightAfterLoad = win.__calls.map(c => c.name);
  win.__calls.length = 0;

  // Teacher role — only sees their own (adviserId === currentUser.id) sections.
  win.renderAdminDashboard();
  results.teacherRoleRender = snapshot(win);
  win.__calls.length = 0;

  const tickIds = Object.keys(win.__tickFns);
  const tick = win.__tickFns[tickIds[tickIds.length - 1]];
  tick();
  results.afterFirstTick = snapshot(win);
  win.__calls.length = 0;

  // Admin role — sees every section, including the other teacher's.
  win.currentRole = 'admin';
  win.renderAdminDashboard();
  results.adminRoleRender = snapshot(win);
  win.__calls.length = 0;

  // AppStore event wiring: a matching event type triggers a re-render.
  const cb = win.__getSubscribedCallback();
  cb({}, { type: 'sections:bootstrapped' });
  results.afterMatchingEvent = snapshot(win);
  win.__calls.length = 0;

  // A non-matching event type does NOT trigger a re-render.
  win.document.getElementById('a-dashboard').innerHTML = '<div id="marker">unchanged</div>';
  cb({}, { type: 'some:other:event' });
  results.afterNonMatchingEventNoop = snapshot(win);
  win.__calls.length = 0;

  // unmountCommandCenter stops the ticking interval.
  win.unmountCommandCenter();
  results.afterUnmount = { calls: win.__calls, tickFnsRemaining: Object.keys(win.__tickFns).length };
  win.__calls.length = 0;

  // After unmount, _ccMounted is false — a subscribe event now no-ops too.
  win.document.getElementById('a-dashboard').innerHTML = '<div id="marker2">still-unchanged</div>';
  cb({}, { type: 'state:updated' });
  results.eventAfterUnmountNoop = snapshot(win);

  return results;
}

function runNoAttendanceServiceCase(win) {
  win.renderAdminDashboard();
  return snapshot(win);
}

function runTickSelfUnmountCase(win) {
  win.renderAdminDashboard();
  win.__calls.length = 0;
  const tickIds = Object.keys(win.__tickFns);
  const tick = win.__tickFns[tickIds[tickIds.length - 1]];
  // Simulate having navigated away without going through nav.js: the
  // clock element is gone, but the interval (and _ccMounted) weren't
  // cleaned up by anyone else yet.
  win.document.getElementById('a-dashboard').innerHTML = '';
  tick();
  return { calls: win.__calls, tickFnsRemaining: Object.keys(win.__tickFns).length };
}

async function main() {
  const sectionsServiceSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'sections-service.js'), 'utf8');
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'command-center.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'command-center.bridge.js'), 'utf8');

  // Main sequence.
  {
    const frozenMs = Date.now();
    const winO = makeWindow({ role: 'teacher', frozenMs });
    winO.eval(sectionsServiceSrc);
    winO.eval(originalSrc);
    assert.strictEqual(typeof winO.renderAdminDashboard, 'function');
    const rO = runSequence(winO);

    const winB = makeWindow({ role: 'teacher', frozenMs });
    winB.eval(bridgeSrc);
    assert.strictEqual(typeof winB.renderAdminDashboard, 'function');
    const rB = runSequence(winB);

    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'main sequence mismatch');
  }

  // No AttendanceService — falls back to DB.attendanceSchedules (dayOfWeek===0 only).
  {
    const frozenMs = Date.now();
    const winO = makeWindow({ role: 'admin', noAttendanceService: true, frozenMs });
    winO.eval(sectionsServiceSrc);
    winO.eval(originalSrc);
    const rO = runNoAttendanceServiceCase(winO);

    const winB = makeWindow({ role: 'admin', noAttendanceService: true, frozenMs });
    winB.eval(bridgeSrc);
    const rB = runNoAttendanceServiceCase(winB);

    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'no-AttendanceService mismatch');
  }

  // Tick's self-unmount guard when the clock element has vanished.
  {
    const frozenMs = Date.now();
    const winO = makeWindow({ role: 'admin', frozenMs });
    winO.eval(sectionsServiceSrc);
    winO.eval(originalSrc);
    const rO = runTickSelfUnmountCase(winO);

    const winB = makeWindow({ role: 'admin', frozenMs });
    winB.eval(bridgeSrc);
    const rB = runTickSelfUnmountCase(winB);

    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'tick self-unmount mismatch');
  }

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('command-center.js: no synchronous render on subscribe(), teacher-role section scoping,');
  console.log('admin-role full scoping, the tick (clock + countdown), every timeline-card branch (locked/');
  console.log('day-off/finished/ongoing/upcoming), matching vs non-matching AppStore events, unmount');
  console.log('stopping the interval and gating further events, the no-AttendanceService DB fallback, and');
  console.log("the tick's self-unmount-when-clock-element-is-gone guard all match.");
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
