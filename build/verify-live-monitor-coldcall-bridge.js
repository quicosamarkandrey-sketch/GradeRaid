// Phase 7 (Stream D) — equivalence check for modules/seat-arrangement/live-monitor-coldcall.js (file 29/30).
//
// ORIGINAL side: real classic files in index.html order — repository/*, db-service, state-manager, dom, utils eval'd; a classic <script> declares
// CB_CANVAS_W/H; classroom-service, recitation-service, live_monitor (OWNER of the shared `let`s) and live-monitor-coldcall are real <script>s.
// BRIDGE side: one esbuild bundle of the REAL production bridges of live_monitor (window accessors onto module state) and live-monitor-coldcall
// (which imports AppStore / toast / showModal / _esc / _cssColor / ClassroomService / RecitationService itself). The REAL services read a seeded
// AppStore on both sides (no service stubs). The cold-call cycle is a recursive setTimeout chain driven by Date.now(), so BOTH sides run on the same
// fake clock: window.setTimeout/clearTimeout queue timers, win.runTimers() fires them in time order while advancing the Date.now()/new Date() clock, and
// every fire is traced (delay + which seats carry .flash-cycle). Math.random is seeded identically. Inline handlers (Close / Roll Again) are real clicks.
//
// Checked: 0 reverse-transform byte identity + 4 exports; 1 surface; 2 _lmStartColdCall (every early return / toast, every strategy, button states,
// double start, mid-run state changes, full cycle timeline, Roll Again); 3 _lmClearCycle; 4 _lmLandOnWinner (confirm pulse -> winner flash timeline);
// 5 _lmShowSpotlight (student lookup, escaping, defaults, title badge guards, point totals + typeof guards, session stat).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const EXPORTS = ['_lmStartColdCall', '_lmClearCycle', '_lmLandOnWinner', '_lmShowSpotlight'];
const SHARED = ['_lmRecitationMode', '_lmClassId', '_lmStrategy', '_lmTargetedSeatIds', '_lmSessionStartAt', '_lmLayoutId', '_lmWebNfcActive', '_lmOverrideExpanded', '_lmAwardSearch', '_lmAwardStudentId',
  '_lmAwardPoints', '_lmRecitationSeenIds', '_lmKioskMode', '_lmResizeListenerAttached', '_lmOverrideStudentId', '_lmOverrideStatus', '_lmOverrideNote', '_lmRecitationKeyHandler', '_lmScanBuffer',
  '_lmScanInactivityTimer', '_lmWebNfcAbortController', '_lmCycleTimeout', '_lmCycleInterval'];

function reverseTransformCheck() {
  const orig = read('modules/seat-arrangement/live-monitor-coldcall.js');
  const twin = read('src/modules/seat-arrangement/live-monitor-coldcall.js');
  const imports = "import { AppStore } from '../core/state-manager.js';\nimport { toast, showModal } from '../../dom.js';\nimport { _esc, _cssColor } from '../../utils.js';\nimport { ClassroomService } from './classroom-service.js';\nimport { RecitationService } from './recitation-service.js';\n";
  assert.strictEqual(orig.split("'use strict';\n").length, 2); assert.strictEqual(twin.split(imports).length, 2);
  const headEnd = twin.indexOf(imports);
  const origHead = orig.slice(0, orig.indexOf("'use strict';\n"));
  assert(twin.slice(0, headEnd).endsWith(origHead), 'twin = new header + the original leading comment block verbatim');
  const rebuilt = twin.slice(headEnd).replace(imports, "'use strict';\n")
    .replace(/^  export function (\w+)\(/gm, '  function $1(').replace('  export const _lmStartColdCall = function () {', '  window._lmStartColdCall = function () {');
  assert.strictEqual(origHead + rebuilt, orig, 'reversing the swaps must reproduce the original byte-for-byte');
  assert.strictEqual((twin.match(/^\s*export /gm) || []).length, 4, 'exactly 4 exports');
}

const STARTER_HTML = `<!doctype html><html><body><div id="page"></div><div id="toast"></div><div id="modal-overlay" style="display:none"><div id="modal-box" class="modal-box"><div id="modal-content"></div></div></div></body></html>`;
const FIXED = 1767225600000; // 2026-01-01T00:00:00Z -> Manila 2026-01-01
const TODAY = '2026-01-01';
const SESSION = '2025-12-31T23:00:00.000Z';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const HELPERS_SCRIPT = `
function __lmSnap() {
  const s = (v) => (v instanceof Set ? { set: [...v] } : (v && typeof v === 'object' ? 'obj' : (typeof v === 'function' ? 'fn' : v)));
  return { ${SHARED.map(n => n + ': s(' + n + ')').join(', ')} };
}
function __lmSet(o) { ${SHARED.map(n => `if ('${n}' in o) ${n} = (o.${n} && o.${n}.__set) ? new Set(o.${n}.__set) : o.${n};`).join(' ')} }
`;

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  // controllable clock: Date.now() / new Date() read globalThis.__now (the fake-timer loop advances it)
  win.eval(`globalThis.__now = ${FIXED}; (function(){ const R = Date; class D extends R { constructor(...a){ if (a.length) super(...a); else super(globalThis.__now); } static now(){ return globalThis.__now; } } globalThis.Date = D; }());`);
  win.eval("globalThis.__rnd = { s: 424242 }; Math.random = function () { __rnd.s = (__rnd.s * 1103515245 + 12345) & 0x7fffffff; return __rnd.s / 0x7fffffff; };");
  win.DEFAULT_DB = { students: [], classSections: [], classroomLayouts: [], seats: [], seatAssignments: [], attendanceLogs: [], recitationLog: [] };
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };
  const mockClient = { auth: { getSession: async () => ({ data: { session: null } }) }, rpc: async () => ({ data: null, error: null }) };
  win.SupabaseClient = { getClient: () => mockClient, resolveProvider: () => 'supabase' };
  win.__EDUQUEST_SUPABASE_URL__ = ''; win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };
  win.__calls = []; win.__tq = []; win.__trace = [];
  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  win.console.warn = (...a) => win.__calls.push(JSON.stringify(['warn', ...a.map(x => (x && x.message) || String(x))]));
  win.console.error = (...a) => win.__calls.push(JSON.stringify(['error', ...a.map(String)]));
  win.addEventListener('error', e => win.__calls.push(JSON.stringify(['window-error', String(e.message)])));
  return { win, logs };
}
function addScript(win, code) { const s = win.document.createElement('script'); s.textContent = code; win.document.head.appendChild(s); }
function installEnv(win) {
  Object.defineProperty(win.HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value(o) { win.__calls.push(JSON.stringify(['scrollIntoView', this.dataset.seatId, o])); } });
  win.__RSreal = win.__RS || win.RecitationService;
}
async function evalOriginal(win) {
  for (const f of ['repository/table-sync.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'db-service.js', 'modules/core/state-manager.js', 'dom.js', 'utils.js']) win.eval(read(f));
  addScript(win, 'const CB_CANVAS_W = 1200, CB_CANVAS_H = 800;');
  for (const f of ['classroom-service', 'recitation-service', 'live_monitor', 'live-monitor-coldcall']) addScript(win, read('modules/seat-arrangement/' + f + '.js'));
  addScript(win, HELPERS_SCRIPT);
  await win.AppStore.ready; win.__RS = win.RecitationService; installEnv(win);
}
async function evalBridge(win) {
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'live-monitor-coldcall-combined-bundle.js'), 'utf8'));
  addScript(win, HELPERS_SCRIPT);
  await win.AppStore.ready; installEnv(win);
}

const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
const $ = (win, id) => win.document.getElementById(id);
function firstDiff(a, b, p) {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], p + '.' + k); if (d) return d; }
  }
  const t = v => { const j = JSON.stringify(v); return j === undefined ? 'undefined' : j; };
  let i = 0; const sa = t(a), sb = t(b); while (i < sa.length && sa[i] === sb[i]) i++;
  return p + '\n  original: ...' + sa.slice(Math.max(0, i - 80), i + 200) + '\n  bridge:   ...' + sb.slice(Math.max(0, i - 80), i + 200);
}

const STUDENTS = () => [
  { id: 's1', classId: 'c1', name: 'Ann Lee', init: 'AL', color: 'rgba(1,2,3,0.5)', profilePic: 'https://img.test/a.png?x=1&y="2"' },
  { id: 's2', classId: 'c1', displayName: 'Bob <i>Ray</i>', init: 'BR' },
  { id: 's3', classId: 'c1', name: 'Cy', init: '' },
  { id: 's4', classId: 'c2', name: 'Dee', init: 'D' },
  { id: 's5', name: 'Eve Default', init: 'E' },
  { id: 's6', classId: 'c1', name: '', displayName: '', init: 'Z' },
  { id: 's7', classId: 'c1', name: 'Gus Hill', init: 'GH' },
  { id: "s'8", classId: 'c1', name: 'Quo"te', init: 'Q' },
];
const SEATS = () => [
  { id: 'seatA', layoutId: 'L1', xCoord: 100, yCoord: 150, rotation: 15, label: 'A' }, { id: 'seatB', layoutId: 'L1', xCoord: 300, yCoord: 150, label: 'B' },
  { id: 'seatC', layoutId: 'L1', xCoord: 500, yCoord: 150, rotation: 0, label: 'C' }, { id: 'seatD', layoutId: 'L1', xCoord: 100, yCoord: 350, rotation: 90, label: 'D' },
  { id: 'seatE', layoutId: 'L1', xCoord: 300, yCoord: 350, label: 'E' }, { id: 'seatF', layoutId: 'L1', xCoord: 500, yCoord: 350, label: 'F' },
  { id: 'seatG', layoutId: 'L1', xCoord: 700, yCoord: 350, label: 'G' }, { id: 'seatH', layoutId: 'L1', xCoord: 700, yCoord: 150, label: 'H' },
  { id: 'seatZ', layoutId: 'L2', xCoord: 1, yCoord: 2, label: 'Z' },
];
const ASSIGN = () => [['seatA', 's1'], ['seatB', 's2'], ['seatD', 's3'], ['seatE', 's6'], ['seatF', 's7'], ['seatG', 's5'], ['seatH', "s'8"], ['seatZ', 's4']]
  .map(([seatId, studentId]) => ({ id: 'as-' + seatId, seatId, studentId, layoutId: seatId === 'seatZ' ? 'L2' : 'L1' }));
const LOGS = () => [
  { id: 'l1', classId: 'c1', studentId: 's1', logDate: TODAY, status: 'Early', scannedAt: '2025-12-31T23:55:00.000Z', entryMethod: 'RFID' },
  { id: 'l2', classId: 'c1', studentId: 's2', logDate: TODAY, status: 'Late', scannedAt: '2025-12-31T23:58:00.000Z', entryMethod: 'NFC' },
  { id: 'l3', classId: 'c1', studentId: 's6', logDate: TODAY, status: 'Absent', scannedAt: '2025-12-31T23:59:00.000Z', entryMethod: 'Manual' },
  { id: 'l4', classId: 'c1', studentId: 's7', logDate: TODAY, status: 'On Time', scannedAt: '2025-12-31T23:58:00.000Z' },
  { id: 'l5', classId: 'c1', studentId: 's3', logDate: TODAY, status: 'Excused' },
  { id: 'l6', classId: 'c1', studentId: "s'8", logDate: TODAY, status: 'Excused', scannedAt: '2025-12-31T23:40:00.000Z', entryMethod: 'x' },
  { id: 'l7', classId: 'c2', studentId: 's4', logDate: TODAY, status: 'Early', scannedAt: '2025-12-31T23:41:00.000Z' },
  { id: 'l8', classId: 'c1', studentId: 's4', logDate: '2025-12-31', status: 'Late', scannedAt: '2025-12-30T23:41:00.000Z' },
  { id: 'l9', classId: 'c1', studentId: 'ghost', logDate: TODAY, status: 'Early', scannedAt: '2025-12-31T23:20:00.000Z', entryMethod: 'RFID' },
  { id: 'l10', classId: 'c1', studentId: 's5', logDate: TODAY, status: 'Weird' },
];
const RECS = () => [
  { id: 'r1', classId: 'c1', studentId: 's1', pts: 2, createdAt: '2025-12-31T23:30:00.000Z', note: 'scan' },
  { id: 'r2', classId: 'c1', studentId: 's1', pts: 3, createdAt: '2025-12-31T23:40:00.000Z', note: 'Manual award' },
  { id: 'r3', classId: 'c1', studentId: 's2', pts: 1, createdAt: '2025-12-31T23:50:00.000Z', note: 'SCAN' },
  { id: 'r4', classId: 'c1', studentId: 's2', pts: 1, createdAt: '2025-12-31T23:51:00.000Z', note: 'custom <b>note</b>' },
  { id: 'r5', classId: 'c1', studentId: 's7', pts: 5, createdAt: '2025-12-31T23:52:00.000Z' },
  { id: 'r6', classId: 'c1', studentId: 'ghost', pts: 1, createdAt: '2025-12-31T23:53:00.000Z', note: '' },
  { id: 'r7', classId: 'c1', studentId: 's3', pts: 4, createdAt: '2025-12-31T22:00:00.000Z', note: 'scan' },
  { id: 'r8', classId: 'c2', studentId: 's4', pts: 4, createdAt: '2025-12-31T23:54:00.000Z', note: 'scan' },
  { id: 'r9', classId: 'c1', studentId: 's3', pts: 4, note: 'scan' },
  { id: "r'10", classId: 'c1', studentId: "s'8", createdAt: '2025-12-31T23:55:00.000Z', note: 'scan' },
];
const LAYOUTS = () => [{ id: 'L1', classId: 'c1', name: 'Main <Room>' }, { id: 'L2', classId: 'c1', name: 'Alt' }, { id: 'L3', classId: 'c2', name: 'Other' }];
function seed(win, extra) {
  win.AppStore.updateState(d => { d.students = STUDENTS(); d.classSections = [{ id: 'c1' }, { id: 'c2' }]; d.classroomLayouts = LAYOUTS(); d.seats = SEATS(); d.seatAssignments = ASSIGN(); d.attendanceLogs = LOGS(); d.recitationLog = RECS(); Object.assign(d, extra || {}); }, { type: 'test:seed' });
}
const snap = win => JSON.parse(win.eval('JSON.stringify(__lmSnap())'));
const setState = (win, o) => win.eval('__lmSet(' + JSON.stringify(o) + ')');
const DEFAULTS = { _lmClassId: 'c1', _lmLayoutId: 'L1', _lmStrategy: 'pure_random', _lmTargetedSeatIds: { __set: [] }, _lmKioskMode: false, _lmRecitationMode: false, _lmOverrideStudentId: '', _lmOverrideStatus: 'On Time',
  _lmOverrideNote: '', _lmOverrideExpanded: false, _lmAwardSearch: '', _lmAwardStudentId: null, _lmAwardPoints: 1, _lmRecitationSeenIds: { __set: [] }, _lmSessionStartAt: null, _lmResizeListenerAttached: false, _lmWebNfcActive: false };
const REC_ON = { _lmRecitationMode: true, _lmSessionStartAt: SESSION };


async function run(win, logs) {
  const out = { steps: [] };
  const page = () => $(win, 'page');
  const flashed = () => [...win.document.querySelectorAll('.lm-seat')].filter(e => /flash/.test(e.className)).map(e => [e.dataset.seatId, e.className]);
  win.runTimers = (n = 800) => { let k = 0; while (win.__tq.length && k++ < n) { win.__tq.sort((a, b) => a.at - b.at || a.i - b.i); const t = win.__tq.shift(); win.__now = t.at; t.f(); win.__trace.push([t.at - FIXED, t.ms, flashed()]); } return k; };
  const step = async (label, fn) => {
    win.__rnd.s = 424242; win.__now = FIXED; win.__calls.length = 0; win.__tq.length = 0; win.__trace.length = 0;
    const rT = win.setTimeout, rC = win.clearTimeout; let tid = 0;
    win.setTimeout = (f, ms) => { const i = ++tid; win.__tq.push({ i, f, at: win.__now + (ms || 0), ms }); win.__calls.push(JSON.stringify(['setTimeout', ms === undefined ? null : ms])); return i; };
    win.clearTimeout = id => { win.__calls.push(JSON.stringify(['clearTimeout', id === undefined ? 'undef' : id])); win.__tq = win.__tq.filter(t => t.i !== id); };
    let err = null, ret;
    try { ret = await fn(); } catch (e) { err = String(e && e.message); }
    const pending = win.__tq.map(t => [t.at - FIXED, t.ms]);
    win.setTimeout = rT; win.clearTimeout = rC;
    await sleep(2);
    const btn = $(win, 'lm-coldcall-btn');
    out.steps.push({ label, err, ret, calls: win.__calls.slice(), trace: win.__trace.map(x => x), pending, now: win.__now - FIXED, btn: btn && [btn.disabled, btn.textContent], html: page().innerHTML, modal: $(win, 'modal-overlay').outerHTML, toast: $(win, 'toast').outerHTML, st: snap(win) });
    delete win.tsGetEquippedTitle; delete win.tsBuildBadgeHTML;
  };
  const mkDom = (o = {}) => {
    page().innerHTML = ''; const p = page();
    if (o.btn !== false) { const b = win.document.createElement('button'); b.id = 'lm-coldcall-btn'; b.textContent = '🎯 Pick Random Student'; p.appendChild(b); }
    const ids = o.seats || SEATS().filter(s => s.layoutId === 'L1').map(s => s.id);
    for (const sid of ids) { const as = ASSIGN().find(a => a.seatId === sid); const e = win.document.createElement('div'); e.className = 'lm-seat'; e.dataset.seatId = sid; e.dataset.studentId = as ? as.studentId : ''; p.appendChild(e); }
  };
  const fresh = async (label, init, fn, opts) => {
    opts = opts || {};
    win.$_ = null; $(win, 'modal-overlay').style.display = 'none'; $(win, 'modal-content').innerHTML = ''; $(win, 'toast').removeAttribute('style'); $(win, 'toast').innerHTML = '';
    seed(win, opts.extra); setState(win, DEFAULTS); setState(win, { _lmCycleTimeout: null, _lmCycleInterval: null }); if (init) setState(win, init);
    mkDom(opts.dom);
    return step(label, fn);
  };
  const S1 = () => win.AppStore.getState().students;
  const click = el => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  const modalName = () => (win.document.querySelector('.lm-spotlight-name') || {}).textContent;
  const START = () => win._lmStartColdCall();
  const vm = (sid, studentId, status, border) => ({ seatId: sid, studentId, attendanceStatus: status, color: { border: border || '#4edea3' } });
  const STUD = () => STUDENTS().map(s => Object.assign({}, s, { s1: 0 }));
  const withStudents = f => ({ students: f(STUDENTS()) });

  out.surface = { fns: EXPORTS.map(n => [n, typeof win[n]]), shared: SHARED.map(n => [n, typeof win[n]]), rs: ['getAllTimeTotalForStudent', 'getTodayTotalForStudent', 'getSessionCounts'].map(n => typeof win.__RS[n]) };
  seed(win);

  // ── _lmStartColdCall: early returns and error toasts ──
  await fresh('start: no layout -> silent return', { _lmLayoutId: null }, async () => START());
  await fresh('start: unknown layout id -> error toast', { _lmLayoutId: 'nope' }, async () => START());
  await fresh('start: nobody eligible -> error toast, button untouched', null, async () => START(), { extra: { attendanceLogs: [] } });
  await fresh('start: spatial_block, nothing targeted -> toast', { _lmStrategy: 'spatial_block' }, async () => START());
  await fresh('start: spatial_block, targets without a present student -> toast', { _lmStrategy: 'spatial_block', _lmTargetedSeatIds: { __set: ['seatC', 'seatD'] } }, async () => START());
  await fresh('start: late_only, nobody late -> toast', { _lmStrategy: 'late_only' }, async () => START(), { extra: { attendanceLogs: LOGS().filter(l => l.status !== 'Late') } });
  // ── full cycles ──
  await fresh('start: just started (before any timer)', null, async () => { START(); return [flashed(), win.__tq.length]; });
  await fresh('start: pure_random full cycle -> spotlight', null, async () => { START(); const k = win.runTimers(); return [k, modalName()]; });
  await fresh('start: full cycle, no button element', null, async () => { START(); return [win.runTimers(), modalName()]; }, { dom: { btn: false } });
  await fresh('start: no seat elements on screen -> bail, button restored', null, async () => { START(); return [win.__tq.length, win.runTimers()]; }, { dom: { seats: [] } });
  await fresh('start: no seat elements and no button', null, async () => { START(); return win.__tq.length; }, { dom: { seats: [], btn: false } });
  await fresh('start: only some pool seats on screen', null, async () => { START(); return [win.runTimers(), modalName()]; }, { dom: { seats: ['seatA', 'seatC', 'seatD'] } });
  await fresh('start: only non-pool seats on screen -> bail', null, async () => { START(); return win.__tq.length; }, { dom: { seats: ['seatC', 'seatD', 'seatE'] } });
  await fresh('start: late_only strategy', { _lmStrategy: 'late_only' }, async () => { START(); return [win.runTimers(), modalName()]; });
  await fresh('start: least_participative strategy', { _lmStrategy: 'least_participative' }, async () => { START(); return [win.runTimers(), modalName()]; });
  await fresh('start: unknown strategy falls back to pure_random', { _lmStrategy: 'zzz' }, async () => { START(); return [win.runTimers(), modalName()]; });
  await fresh('start: spatial_block, targeted seats', { _lmStrategy: 'spatial_block', _lmTargetedSeatIds: { __set: ['seatB', 'seatD'] } }, async () => { START(); return [win.runTimers(), modalName()]; });
  await fresh('start: spatial_block, targets cleared mid-run -> button ends disabled', { _lmStrategy: 'spatial_block', _lmTargetedSeatIds: { __set: ['seatA', 'seatB'] } }, async () => { START(); win.runTimers(6); setState(win, { _lmTargetedSeatIds: { __set: [] } }); return [win.runTimers(), modalName()]; });
  await fresh('start: spatial_block, targets kept -> button ends enabled', { _lmStrategy: 'spatial_block', _lmTargetedSeatIds: { __set: ['seatA', 'seatB'] } }, async () => { START(); return [win.runTimers(), modalName()]; });
  await fresh('start: layout cleared mid-run -> button ends disabled', null, async () => { START(); win.runTimers(6); setState(win, { _lmLayoutId: null }); return [win.runTimers(), modalName()]; });
  await fresh('start: double start clears the first cycle', null, async () => { START(); win.runTimers(5); const mid = flashed(); START(); return [mid, flashed(), win.runTimers(), modalName()]; });
  await fresh('start: recitation + session -> spotlight shows This Session', REC_ON, async () => { START(); return [win.runTimers(), modalName()]; });
  await fresh('start: Roll Again re-runs the sequence; Close hides', null, async () => {
    START(); win.runTimers(); const first = modalName(); const ov = $(win, 'modal-overlay');
    click([...win.document.querySelectorAll('.lm-spotlight-actions button')][1]); const afterRoll = [ov.style.display, win.__tq.length, flashed().length];
    const k = win.runTimers(); const second = modalName(); click([...win.document.querySelectorAll('.lm-spotlight-actions button')][0]);
    return [first, afterRoll, k, second, ov.style.display];
  });
  await fresh('start: different random seed -> different winner', null, async () => { win.__rnd.s = 7; START(); return [win.runTimers(), modalName()]; });

  // ── _lmClearCycle ──
  const flashAll = () => win.document.querySelectorAll('.lm-seat').forEach((e, i) => { if (i % 2 === 0) e.classList.add('flash-cycle'); });
  await fresh('clear: both timers set + flashed seats', { _lmCycleInterval: 5, _lmCycleTimeout: 7 }, async () => { flashAll(); win._lmClearCycle(); return flashed(); });
  await fresh('clear: nothing set', null, async () => { win._lmClearCycle(); });
  await fresh('clear: only the interval timer set', { _lmCycleInterval: 9 }, async () => { flashAll(); win._lmClearCycle(); return flashed(); });
  await fresh('clear: only the timeout timer set', { _lmCycleTimeout: 11 }, async () => { win._lmClearCycle(); });
  await fresh('clear: flash-confirm / flash-winner classes are NOT touched', null, async () => { const e = win.document.querySelector('.lm-seat'); e.classList.add('flash-confirm', 'flash-winner', 'flash-cycle'); win._lmClearCycle(); return flashed(); });

  // ── _lmLandOnWinner ──
  await fresh('land: seat present -> confirm pulse, then winner flash, spotlight', null, async () => { win._lmLandOnWinner(vm('seatA', 's1', 'Early')); const a = [flashed(), win.__tq.map(t => t.ms), win.document.querySelector('.lm-seat[data-seat-id="seatA"]').innerHTML]; const k = win.runTimers(); return [a, k, modalName(), flashed()]; });
  await fresh('land: seat present, mid-way states', null, async () => { win._lmLandOnWinner(vm('seatB', 's2', 'Late')); const out2 = []; for (let i = 0; i < 4; i++) { win.runTimers(1); out2.push([win.__now - FIXED, flashed(), win.document.querySelectorAll('.lm-confirm-label').length, modalName() || null]); } return out2; });
  await fresh('land: seat missing -> spotlight only after the pause', null, async () => { win._lmLandOnWinner(vm('seatXX', 's1', 'Early')); const a = win.__tq.map(t => t.ms); win.runTimers(); return [a, modalName()]; });
  await fresh('land: seat id with a quote -> same selector error', null, async () => { win._lmLandOnWinner(vm('a"b', 's1', 'Early')); });
  await fresh('land: winner without a student record -> toast after the pause', null, async () => { win._lmLandOnWinner(vm('seatA', 'ghost', 'Early')); win.runTimers(); });

  // ── _lmShowSpotlight ──
  const RICH = ss => ss.map(s => s.id === 's1' ? Object.assign(s, { tier: 'Hero', level: 12, coins: 340 }) : s);
  const SP = (v) => () => { win._lmShowSpotlight(v); return modalName(); };
  await fresh('spot: unknown student -> toast, no modal', null, SP(vm('seatA', 'zzz', 'Early')));
  await fresh('spot: rich student (photo, tier, level, coins)', null, SP(vm('seatA', 's1', 'Early', '#123456')), { extra: withStudents(RICH) });
  await fresh('spot: displayName-only student -> defaults, status dash', null, SP({ seatId: 'seatB', studentId: 's2', color: { border: '#abc' } }));
  await fresh('spot: init empty -> first letter of name', null, SP(vm('seatD', 's3', 'Excused')));
  await fresh('spot: no name, no init -> "?" and Student', null, SP(vm('x', 's9', 'Late')), { extra: withStudents(ss => ss.concat([{ id: 's9', classId: 'c1' }])) });
  await fresh('spot: HTML in name / tier / status / photo is escaped', null, SP(vm('x', 's10', '<i>Late</i>')), { extra: withStudents(ss => ss.concat([{ id: 's10', classId: 'c1', name: '<img src=x onerror=alert(1)>', init: '<u>u</u>', tier: '<b>T</b>', level: 3, coins: 1, profilePic: 'a" onerror="x' }])) });
  await fresh('spot: equipped title + badge builder', null, async () => { win.tsGetEquippedTitle = id => { win.__calls.push(JSON.stringify(['tsGetEquippedTitle', id])); return { id: 't1' }; }; win.tsBuildBadgeHTML = (t, o) => { win.__calls.push(JSON.stringify(['tsBuildBadgeHTML', t, o])); return '<b class="bdg">T</b>'; }; return SP(vm('seatA', 's1', 'Early'))(); });
  await fresh('spot: equipped title but no badge builder -> no title slot', null, async () => { win.tsGetEquippedTitle = () => ({ id: 't1' }); return SP(vm('seatA', 's1', 'Early'))(); });
  await fresh('spot: title getter returns null -> no title slot', null, async () => { win.tsGetEquippedTitle = () => null; win.tsBuildBadgeHTML = () => 'X'; return SP(vm('seatA', 's1', 'Early'))(); });
  await fresh('spot: no title functions at all', null, SP(vm('seatA', 's1', 'Early')));
  await fresh('spot: recitation + session -> This Session stat with the student count', REC_ON, SP(vm('seatA', 's1', 'Early')));
  await fresh('spot: recitation + session, student without entries -> 0', REC_ON, SP(vm('seatD', 's3', 'Excused')));
  await fresh('spot: recitation without a session start -> no session stat', { _lmRecitationMode: true }, SP(vm('seatA', 's1', 'Early')));
  await fresh('spot: session start without recitation mode -> no session stat', { _lmSessionStartAt: SESSION }, SP(vm('seatA', 's1', 'Early')));
  await fresh('spot: point-total methods missing -> zeros', REC_ON, async () => { const rs = win.__RS, a = rs.getAllTimeTotalForStudent, b = rs.getTodayTotalForStudent; delete rs.getAllTimeTotalForStudent; delete rs.getTodayTotalForStudent; try { return SP(vm('seatA', 's1', 'Early'))(); } finally { rs.getAllTimeTotalForStudent = a; rs.getTodayTotalForStudent = b; } });
  await fresh('spot: only the all-time method missing', null, async () => { const rs = win.__RS, a = rs.getAllTimeTotalForStudent; delete rs.getAllTimeTotalForStudent; try { return SP(vm('seatA', 's1', 'Early'))(); } finally { rs.getAllTimeTotalForStudent = a; } });
  await fresh('spot: only the today method missing', null, async () => { const rs = win.__RS, a = rs.getTodayTotalForStudent; delete rs.getTodayTotalForStudent; try { return SP(vm('seatA', 's1', 'Early'))(); } finally { rs.getTodayTotalForStudent = a; } });
  await fresh('spot: state without a students slice -> not found', null, async () => { win.AppStore.updateState(d => { d.students = undefined; }, { type: 'test:nostudents' }); return SP(vm('seatA', 's1', 'Early'))(); });
  await fresh('spot: Close button hides, Roll Again button wiring', null, async () => { win._lmShowSpotlight(vm('seatA', 's1', 'Early')); const btns = [...win.document.querySelectorAll('.lm-spotlight-actions button')]; return [btns.map(b => b.getAttribute('onclick')), btns.map(b => b.textContent)]; });
  return out;
}

async function main() {
  if (!process.env.MUTATION_RUN) reverseTransformCheck();
  const A = makeWindow(), B = makeWindow();
  await evalOriginal(A.win);
  await evalBridge(B.win);
  const oa = await run(A.win, A.logs), ob = await run(B.win, B.logs);
  const fd = firstDiff(clean(oa), clean(ob), 'out');
  assert.strictEqual(fd, null, 'bridge output must exactly match the original at every step — first difference at: ' + fd);
  const o = clean(oa);
  fs.writeFileSync('/tmp/coldcall-dump.json', JSON.stringify(o));
  const S = label => { const s = o.steps.find(x => x.label === label); assert(s, 'missing step ' + label); return s; };
  assert.deepStrictEqual(o.surface.fns.map(e => e[1]), Array(4).fill('function'));
  assert(o.surface.shared.every(e => e[1] !== 'function'));
  assert(!o.steps.some(s => s.calls.some(c => c.startsWith('["window-error"'))), 'no uncaught errors');
  const T = l => S(l).toast, MOD = l => S(l).modal, RET = l => S(l).ret;
  const BTN = [false, '🎯 Pick Random Student'];
  const nums = l => [...MOD(l).matchAll(/lm-spotlight-(?:headline-num|stat-num)"[^>]*>([^<]*)</g)].map(m => m[1]);
  const labels = l => [...MOD(l).matchAll(/lm-spotlight-stat-label">([^<]*)</g)].map(m => m[1]);
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  // early returns / error toasts: no cycle is scheduled, only the toast's own hide timer, button untouched
  assert.deepStrictEqual(S('start: no layout -> silent return').calls, []);
  for (const [l, msg] of [['start: unknown layout id -> error toast', 'Unknown layoutId.'], ['start: nobody eligible -> error toast, button untouched', 'No present or late students are currently seated.'],
    ['start: spatial_block, nothing targeted -> toast', 'Select at least one seat to roll among first.'], ['start: spatial_block, targets without a present student -> toast', 'None of the targeted seats currently have a present or late student in them.'],
    ['start: late_only, nobody late -> toast', 'No students are currently marked Late.']]) {
    assert(T(l).includes('⚠️ ' + msg) && T(l).includes('rgba(255, 185, 95'), l); assert.deepStrictEqual(S(l).btn, BTN, l); assert.deepStrictEqual(S(l).pending, [[2800, 2800]], l); assert.strictEqual(S(l).trace.length, 0, l);
    assert.strictEqual(S(l).st._lmCycleInterval, null, l); assert.strictEqual(S(l).st._lmCycleTimeout, null, l);
  }
  // cycle start
  { const s = S('start: just started (before any timer)'); assert.deepStrictEqual(s.btn, [true, '🎲 Picking…']); assert.strictEqual(RET('start: just started (before any timer)')[1], 1); assert.strictEqual(RET('start: just started (before any timer)')[0].length, 1); assert(RET('start: just started (before any timer)')[0][0][1] === 'lm-seat flash-cycle'); assert.strictEqual(typeof s.st._lmCycleInterval, 'number'); assert.strictEqual(s.st._lmCycleTimeout, null); }
  // full timeline: ticks 60ms -> ~420ms (cubic ease-out), final tick crosses 4200ms, then confirm pulse (900) + spotlight (900) + winner flash removal (2300)
  { const l = 'start: pure_random full cycle -> spotlight', s = S(l), tr = s.trace, POOL = ['seatA', 'seatB', 'seatF'];
    assert.strictEqual(tr.length, 20); assert.strictEqual(tr[0][1], 60); const ticks = tr.slice(0, 17);
    assert(ticks.every(x => x[1] >= 60 && x[1] <= 420) && ticks.every((x, i) => i === 0 || x[1] > ticks[i - 1][1]), 'tick delays rise monotonically within [60, 420]');
    assert(ticks[15][0] < 4200 && ticks[16][0] >= 4200, 'the landing timeout is the first one that crosses 4200ms');
    assert(tr.slice(0, 16).every(x => x[2].length === 1 && x[2][0][1] === 'lm-seat flash-cycle' && POOL.includes(x[2][0][0])), 'exactly one pool seat flashes per tick');
    assert.deepStrictEqual(tr[16][2].map(f => f[1]), ['lm-seat flash-confirm']); assert(near(tr[17][0], tr[16][0] + 900) && near(tr[18][0], tr[16][0] + 900) && near(tr[19][0], tr[16][0] + 3200));
    assert.deepStrictEqual(s.btn, BTN); assert(['Ann Lee', 'Bob <i>Ray</i>', 'Gus Hill'].includes(RET(l)[1])); assert.deepStrictEqual(s.st._lmCycleTimeout, null); assert.strictEqual(s.st._lmCycleInterval, null); assert.strictEqual(s.pending.length, 0);
    assert(MOD(l).includes('display: flex')); assert(s.calls.filter(c => c.startsWith('["scrollIntoView"')).length === 1); }
  assert.strictEqual(S('start: different random seed -> different winner').ret[1], 'Bob <i>Ray</i>'); assert.notStrictEqual(S('start: different random seed -> different winner').ret[1], RET('start: pure_random full cycle -> spotlight')[1]);
  assert.deepStrictEqual(S('start: full cycle, no button element').btn, null); assert.strictEqual(S('start: full cycle, no button element').trace.length, 20);
  for (const l of ['start: no seat elements on screen -> bail, button restored', 'start: only non-pool seats on screen -> bail']) { assert.deepStrictEqual(S(l).btn, BTN, l); assert(!S(l).calls.some(c => c.startsWith('["setTimeout"')), l); assert.strictEqual(S(l).trace.length, 0, l); }
  assert.deepStrictEqual(S('start: no seat elements and no button').btn, null);
  { const s = S('start: only some pool seats on screen'); assert.strictEqual(s.trace.length, 18, '17 ticks + the delayed spotlight (no seat -> no label/winner timers)'); assert(s.trace.slice(0, 16).every(x => x[2].length === 1 && x[2][0][0] === 'seatA')); assert.strictEqual(RET('start: only some pool seats on screen')[1], 'Gus Hill'); assert(!s.calls.some(c => c.startsWith('["scrollIntoView"'))); }
  assert.strictEqual(RET('start: late_only strategy')[1], 'Bob <i>Ray</i>'); assert.strictEqual(RET('start: spatial_block, targeted seats')[1], 'Bob <i>Ray</i>');
  assert(S('start: late_only strategy').trace.slice(0, 16).every(x => x[2][0][0] === 'seatB') && S('start: spatial_block, targeted seats').trace.slice(0, 16).every(x => x[2][0][0] === 'seatB'));
  assert(['Ann Lee', 'Bob <i>Ray</i>', 'Gus Hill'].includes(RET('start: least_participative strategy')[1]) && ['Ann Lee', 'Bob <i>Ray</i>', 'Gus Hill'].includes(RET('start: unknown strategy falls back to pure_random')[1]));
  assert.deepStrictEqual(S('start: spatial_block, targets cleared mid-run -> button ends disabled').btn, [true, '🎯 Pick Random Student']); assert.deepStrictEqual(S('start: layout cleared mid-run -> button ends disabled').btn, [true, '🎯 Pick Random Student']);
  assert.deepStrictEqual(S('start: spatial_block, targets kept -> button ends enabled').btn, BTN); assert.deepStrictEqual(S('start: spatial_block, targeted seats').btn, BTN);
  { const l = 'start: double start clears the first cycle', s = S(l); assert(s.calls.some(c => /^\["clearTimeout",\d+\]$/.test(c)), 'the first cycle\'s pending tick is cleared'); assert(RET(l)[0].length === 1 && RET(l)[1].length === 1); assert.strictEqual(s.trace.length, 25); assert.strictEqual(s.pending.length, 0); assert.deepStrictEqual(s.btn, BTN); }
  assert(labels('start: recitation + session -> spotlight shows This Session').includes('This Session'));
  { const l = 'start: Roll Again re-runs the sequence; Close hides', r = RET(l); assert.deepStrictEqual(r[1], ['none', 1, 1], 'Roll Again hides the modal and immediately starts a new cycle'); assert.strictEqual(r[2], 20); assert.notStrictEqual(r[0], r[3]); assert.strictEqual(r[4], 'none'); assert.strictEqual(S(l).trace.length, 40); }
  // _lmClearCycle
  assert.deepStrictEqual(S('clear: both timers set + flashed seats').calls, ['["clearTimeout",5]', '["clearTimeout",7]']); assert.deepStrictEqual(RET('clear: both timers set + flashed seats'), []);
  assert.strictEqual(S('clear: both timers set + flashed seats').st._lmCycleInterval, null); assert.strictEqual(S('clear: both timers set + flashed seats').st._lmCycleTimeout, null);
  assert.deepStrictEqual(S('clear: nothing set').calls, []); assert.deepStrictEqual(S('clear: only the interval timer set').calls, ['["clearTimeout",9]']); assert.deepStrictEqual(S('clear: only the timeout timer set').calls, ['["clearTimeout",11]']);
  assert.strictEqual(S('clear: only the interval timer set').st._lmCycleInterval, null); assert.strictEqual(S('clear: only the timeout timer set').st._lmCycleTimeout, null);
  assert.deepStrictEqual(RET('clear: flash-confirm / flash-winner classes are NOT touched'), [['seatA', 'lm-seat flash-confirm flash-winner']]);
  // _lmLandOnWinner
  { const l = 'land: seat present -> confirm pulse, then winner flash, spotlight', r = RET(l); assert.deepStrictEqual(r[0].slice(0, 2), [[['seatA', 'lm-seat flash-confirm']], [900, 900]]); assert.strictEqual(r[0][2], '<div class="lm-confirm-label">✓ Confirming…</div>', 'the confirmation label is appended to the seat until it is removed'); assert.strictEqual(r[1], 3); assert.strictEqual(r[2], 'Ann Lee'); assert.deepStrictEqual(r[3], []);
    assert(S(l).calls.includes('["scrollIntoView","seatA",{"behavior":"smooth","block":"center","inline":"center"}]') && S(l).calls.includes('["setTimeout",2300]')); assert(!S(l).html.includes('lm-confirm-label')); }
  { const r = RET('land: seat present, mid-way states'); assert.deepStrictEqual(r[0], [900, [['seatB', 'lm-seat flash-confirm']], 0, null]); assert.deepStrictEqual(r[1], [900, [['seatB', 'lm-seat flash-winner']], 0, 'Bob <i>Ray</i>']); assert.deepStrictEqual(r[2][1], []); assert.strictEqual(r[2][0], 3200); }
  assert.deepStrictEqual(RET('land: seat missing -> spotlight only after the pause'), [[900], 'Ann Lee']); assert(!S('land: seat missing -> spotlight only after the pause').calls.some(c => c.startsWith('["scrollIntoView"')));
  assert(S('land: seat id with a quote -> same selector error').err.includes('not a valid selector')); assert(T('land: winner without a student record -> toast after the pause').includes('Could not load that student'));
  // _lmShowSpotlight
  assert(T('spot: unknown student -> toast, no modal').includes('❌ Could not load that student\'s profile.') && T('spot: unknown student -> toast, no modal').includes('rgba(255, 180, 171') && MOD('spot: unknown student -> toast, no modal').includes('display: none'));
  assert(T('spot: state without a students slice -> not found').includes('Could not load'));
  { const l = 'spot: rich student (photo, tier, level, coins)'; assert.deepStrictEqual(nums(l), ['5', '5', '340', 'Early']); assert.deepStrictEqual(labels(l), ['Today', 'Coins', 'Status']); assert(MOD(l).includes('Hero · LV 12') && MOD(l).includes('--hl:') && MOD(l).includes('style="color:#123456"') && MOD(l).includes('src="https://img.test/a.png?x=1&amp;y=&quot;2&quot;"') && MOD(l).includes('>Ann Lee<') && MOD(l).includes('modal-box md')); assert(MOD(l).includes('AL\n')); assert(MOD(l).includes('⭐ Overall Recitation Points')); }
  { const l = 'spot: displayName-only student -> defaults, status dash'; assert.deepStrictEqual(nums(l), ['2', '2', '0', '—']); assert(MOD(l).includes('Novice · LV 0') && !MOD(l).includes('<img'));}
  assert.deepStrictEqual(nums('spot: init empty -> first letter of name'), ['8', '4', '0', 'Excused']); assert(MOD('spot: init empty -> first letter of name').includes('C\n'));
  assert(MOD('spot: no name, no init -> "?" and Student').includes('?\n') && RET('spot: no name, no init -> "?" and Student') === 'Student'); assert.deepStrictEqual(nums('spot: no name, no init -> "?" and Student'), ['0', '0', '0', 'Late']);
  { const l = 'spot: HTML in name / tier / status / photo is escaped', m = MOD(l); assert(m.includes('&lt;img src=x onerror=alert(1)&gt;') && m.includes('&lt;b&gt;T&lt;/b&gt; · LV 3') && m.includes('&lt;i&gt;Late&lt;/i&gt;') && m.includes('src="a&quot; onerror=&quot;x"') && !/<img src=x/.test(m) && m.includes('&lt;u&gt;u&lt;/u&gt;')); }
  assert.deepStrictEqual(S('spot: equipped title + badge builder').calls, ['["tsGetEquippedTitle","s1"]', '["tsBuildBadgeHTML",{"id":"t1"},{"small":true,"noParticles":true}]']); assert(MOD('spot: equipped title + badge builder').includes('<div class="lm-spotlight-title-slot"><b class="bdg">T</b></div>'));
  for (const l of ['spot: equipped title but no badge builder -> no title slot', 'spot: title getter returns null -> no title slot', 'spot: no title functions at all']) assert(!MOD(l).includes('lm-spotlight-title-slot'), l);
  assert.deepStrictEqual(nums('spot: recitation + session -> This Session stat with the student count'), ['5', '5', '5', '0', 'Early']); assert.deepStrictEqual(labels('spot: recitation + session -> This Session stat with the student count'), ['Today', 'This Session', 'Coins', 'Status']);
  assert.deepStrictEqual(nums('spot: recitation + session, student without entries -> 0'), ['8', '4', '0', '0', 'Excused']);
  for (const l of ['spot: recitation without a session start -> no session stat', 'spot: session start without recitation mode -> no session stat']) assert(!labels(l).includes('This Session'), l);
  assert.deepStrictEqual(nums('spot: point-total methods missing -> zeros').slice(0, 2), ['0', '0']); assert.deepStrictEqual(nums('spot: only the all-time method missing').slice(0, 2), ['0', '5']); assert.deepStrictEqual(nums('spot: only the today method missing').slice(0, 2), ['5', '0']);
  assert.deepStrictEqual(RET('spot: Close button hides, Roll Again button wiring'), [['closeModalForce()', 'closeModalForce(); window._lmStartColdCall();'], ['Close', '🎲 Roll Again']]);
  assert.deepStrictEqual(o.surface.rs, ['function', 'function', 'function']);
  console.log(' - independent sanity assertions on the original: PASSED');
  console.log('EQUIVALENCE CHECK (compare phase) PASSED —', o.steps.length, 'steps identical on both sides');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
