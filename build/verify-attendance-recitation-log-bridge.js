// Phase 7 (Stream A) — equivalence check for modules/attendance/attendance-recitation-log.js.
// AppStore's own equivalence is already independently proven, so this
// uses the combined-bundle pattern (see table-sync's memory note) for
// the bridge side. Covers: no-op with no DOM element, full paint +
// AppStore.subscribe registration, every filter setter (incl. the 220ms
// debounced search and the section/all-vs-drilldown branch), pagination
// (incl. next/prev + clamp), the legacy/unassigned classId bucket,
// talExportCsv (empty-filters toast path and the real CSV/Blob/anchor
// path), the subscribe callback's event-type filtering (matching vs
// non-matching), and unmountRecitationAttendanceLog's unsubscribe.
const { JSDOM } = require('jsdom');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const STARTER_HTML = `<!doctype html><html><body><div id="a-class-logs"></div></body></html>`;

function makeWindow(opts) {
  opts = opts || {};
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.org/app/index.html' });
  const win = dom.window;
  const calls = [];
  win.__calls = calls;

  win.currentUser = opts.currentUser || { id: 't1' };
  win.currentRole = opts.currentRole || 'teacher';
  win._esc = s => String(s == null ? '' : s);
  win.toast = function (msg, color) { calls.push({ name: 'toast', msg, color }); };
  win.isoDate = function () { return '2026-06-15'; };
  win.getMySectionsLabel = function (state) { calls.push({ name: 'getMySectionsLabel' }); return 'My Sections (2)'; };
  win.getClassLabel = function (classId, state) { calls.push({ name: 'getClassLabel', classId }); return 'Grade 10 - ' + classId; };
  win.getActiveClassIds = function (state) { calls.push({ name: 'getActiveClassIds' }); return []; };
  win.HTMLElement.prototype.scrollIntoView = function () {};
  win.URL.createObjectURL = function (blob) { calls.push({ name: 'createObjectURL' }); return 'blob:fake-url'; };
  win.URL.revokeObjectURL = function (url) { calls.push({ name: 'revokeObjectURL' }); };
  win.HTMLAnchorElement.prototype.click = function () { calls.push({ name: 'anchor.click', href: this.href, download: this.download }); };

  win.DBService = {
    async initRemote() {},
    read() { return null; },
    write(s) {},
  };
  win.DEFAULT_DB = { students: [], quizzes: [], bossEvents: [], pointLog: [], notifications: [], orders: [], bossParticipants: {}, inventory: {}, redemptions: [], titles: [], quizHistory: {}, stageMap: [], store: [], achievements: [], classSections: [] };

  const sections = [
    { id: 'sec-a', adviserId: 't1', archived: false },
    { id: 'sec-b', adviserId: 't2', archived: false },
    { id: 'sec-old', adviserId: 't1', archived: true },
  ];
  const students = [
    { id: 's1', name: 'Alice', classId: 'sec-a' },
    { id: 's2', name: 'Bob', classId: 'sec-a' },
    { id: 's3', name: 'Carol', classId: 'sec-b' },
  ];
  const attendanceLogs = [
    { id: 'a1', studentId: 's1', classId: 'sec-a', logDate: '2026-06-15', status: 'On Time', entryMethod: 'RFID', notes: '' },
    { id: 'a2', studentId: 's2', classId: 'sec-a', logDate: '2026-06-14', status: 'Late', entryMethod: 'Manual', notes: 'traffic' },
    { id: 'a3', studentId: 's3', classId: 'sec-b', logDate: '2026-06-15', status: 'Absent', entryMethod: 'Manual', notes: '' },
  ];
  const recitationLog = [
    { id: 'r1', studentId: 's1', classId: 'sec-a', createdAt: '2026-06-15T08:00:00+08:00', pts: 5, detail: 'Great answer' },
    { id: 'r2', studentId: 's3', classId: null, createdAt: '2025-01-01T08:00:00+08:00', pts: 2, detail: 'Legacy row' },
  ];

  let state = { students, classSections: sections, attendanceLogs, recitationLog };
  win.__seedState = () => state;
  win.__replaceState = (s) => { state = s; };

  return win;
}

function snapshot(win) {
  return { html: win.document.getElementById('a-class-logs').innerHTML, calls: win.__calls };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runSequence(win) {
  const results = {};

  const el = win.document.getElementById('a-class-logs');
  el.remove();
  win.renderRecitationAttendanceLog();
  results.noElementNoop = { calls: win.__calls.slice() };
  win.__calls.length = 0;

  win.document.body.innerHTML = '<div id="a-class-logs"></div>';
  win.renderRecitationAttendanceLog();
  results.afterRender = snapshot(win);
  win.__calls.length = 0;

  win.talSetSection('sec-a');
  results.afterSetSectionA = snapshot(win);
  win.__calls.length = 0;

  win.talSetSection('__unassigned__');
  results.afterSetUnassigned = snapshot(win);
  win.__calls.length = 0;

  win.talSetSection('all');
  win.__calls.length = 0;

  win.talSetType('recitation');
  results.afterSetTypeRecitation = snapshot(win);
  win.talSetRange('today');
  results.afterSetRangeToday = snapshot(win);
  win.__calls.length = 0;

  win.talSetSearch('ali');
  await sleep(50);
  results.duringSearchDebounce = snapshot(win);
  await sleep(250);
  results.afterSearchDebounceSettles = snapshot(win);
  win.__calls.length = 0;

  win.talClearFilters();
  results.afterClearFilters = snapshot(win);
  win.__calls.length = 0;

  win.talGoToPage(1);
  results.page1 = snapshot(win);
  win.talNextPage();
  results.pageNext = snapshot(win);
  win.talPrevPage();
  win.talPrevPage();
  results.pagePrevClamped = snapshot(win);
  win.__calls.length = 0;

  win.talSetType('attendance');
  win.talSetSearch('zzz-no-such-student');
  await sleep(250);
  win.__calls.length = 0;
  win.talExportCsv();
  results.exportEmptyRows = snapshot(win);
  win.__calls.length = 0;

  win.talClearFilters();
  win.__calls.length = 0;
  win.talExportCsv();
  results.exportWithRows = snapshot(win);
  win.__calls.length = 0;

  const el2 = win.document.getElementById('a-class-logs');
  el2.innerHTML = '<div id="marker">before</div>';
  win.AppStore.updateState(draft => {}, { type: 'some:unrelated:event' });
  results.subscribeNonMatchingNoop = snapshot(win);
  win.__calls.length = 0;

  win.AppStore.updateState(draft => {}, { type: 'attendance:scan-recorded' });
  results.subscribeMatchingRepaints = snapshot(win);
  win.__calls.length = 0;

  win.AppStore.updateState(draft => {}, { type: 'recitation:point-awarded' });
  results.subscribeRecitationPrefixMatches = snapshot(win);
  win.__calls.length = 0;

  win.unmountRecitationAttendanceLog();
  results.afterUnmount = { calls: win.__calls.slice() };

  return results;
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'attendance', 'attendance-recitation-log.js'), 'utf8');
  const stateManagerSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'core', 'state-manager.js'), 'utf8');
  const combinedBridgeSrc = fs.readFileSync(path.join(__dirname, 'test-helpers', 'attendance-recitation-log-combined-bundle.js'), 'utf8');

  const winOriginal = makeWindow({});
  winOriginal.eval(stateManagerSrc);
  await winOriginal.AppStore.ready;
  winOriginal.AppStore.updateState(draft => { Object.assign(draft, winOriginal.__seedState()); }, { type: 'test:seed' });
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.renderRecitationAttendanceLog, 'function');
  const resultOriginal = await runSequence(winOriginal);

  const winBridge = makeWindow({});
  winBridge.eval(combinedBridgeSrc);
  await winBridge.AppStore.ready;
  winBridge.AppStore.updateState(draft => { Object.assign(draft, winBridge.__seedState()); }, { type: 'test:seed' });
  assert.strictEqual(typeof winBridge.renderRecitationAttendanceLog, 'function');
  const resultBridge = await runSequence(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original output at every step');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('attendance-recitation-log.js: no-op with no DOM element, full paint + AppStore.subscribe');
  console.log('registration, section drill-down (incl. the legacy/unassigned bucket), type/range/debounced-');
  console.log('search filters, clear-filters, pagination (incl. next/prev + clamp), CSV export (empty-rows');
  console.log('toast path + real Blob/anchor path), the subscribe callback event-type filtering (non-');
  console.log('matching/attendance-prefix/recitation-prefix), and unmount unsubscribing all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
