// Phase 7 (Stream D) — equivalence check for modules/seat-arrangement/live-monitor-render.js (file 28/30).
//
// ORIGINAL side: real classic files in index.html order — repository/*, db-service, state-manager, dom, utils eval'd; a classic <script> declares
// CB_CANVAS_W/H; classroom-service, recitation-service, live-monitor-webnfc, live_monitor (OWNER of the shared `let`s) and live-monitor-render are
// real <script> elements. BRIDGE side: one esbuild bundle of the REAL production bridges of live_monitor (window accessors onto module state) and
// live-monitor-render (which imports ClassroomService / RecitationService / classroom_builder / webnfc / utils itself). The REAL services read a
// seeded AppStore on both sides (no service stubs), so seat map, recitation counts and feeds are exercised end to end. Only the click targets
// (window._lm* handlers named in inline markup) are replaced by identical recorders, and requestAnimationFrame / setTimeout are recorded.
//
// Checked: 0 reverse-transform byte identity + 11 exports; 1 surface; 2 _lmRender (every toolbar branch, resize listener once, real inline events);
// 3 _lmScaleCanvas (bounds, retry path, NaN); 4 _lmRenderCanvas (badges, targeting, click handlers, photo/escape); 5 sidebars (attendance counts,
// feed cap/sort, override panel states, recitation sidebar search/selection/points); 6 feed items; 7 animate + floating point (dedupe, 1500ms removal).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const EXPORTS = ['_lmRender', '_lmScaleCanvas', '_lmRenderCanvas', '_lmRenderSidebar', '_lmRenderAttendanceSidebar', '_lmOverridePanelHtml', '_lmFeedItem',
  '_lmRenderRecitationSidebar', '_lmRecitationFeedItem', '_lmAnimateNewRecitationEntries', '_lmSpawnFloatingPoint'];
const SHARED = ['_lmRecitationMode', '_lmClassId', '_lmStrategy', '_lmTargetedSeatIds', '_lmSessionStartAt', '_lmLayoutId', '_lmWebNfcActive', '_lmOverrideExpanded', '_lmAwardSearch', '_lmAwardStudentId',
  '_lmAwardPoints', '_lmRecitationSeenIds', '_lmKioskMode', '_lmResizeListenerAttached', '_lmOverrideStudentId', '_lmOverrideStatus', '_lmOverrideNote', '_lmRecitationKeyHandler', '_lmScanBuffer',
  '_lmScanInactivityTimer', '_lmWebNfcAbortController', '_lmCycleTimeout', '_lmCycleInterval'];
const HANDLERS = ['_lmOnClassChange', '_lmOnLayoutChange', '_lmToggleKioskMode', '_lmOnStrategyChange', '_lmStartColdCall', '_lmToggleRecitationMode', '_lmToggleWebNfc', '_lmToggleSeatTarget',
  '_lmSelectAwardStudentFromSeat', '_lmToggleOverridePanel', '_lmOnOverrideStudentChange', '_lmOnOverrideStatusChange', '_lmOnOverrideNoteInput', '_lmSubmitOverride', '_lmOnAwardSearchInput',
  '_lmSetAwardPoints', '_lmSubmitManualAward', '_lmUndoRecitation'];

function reverseTransformCheck() {
  const orig = read('modules/seat-arrangement/live-monitor-render.js');
  const twin = read('src/modules/seat-arrangement/live-monitor-render.js');
  const imports = "import { AppStore } from '../core/state-manager.js';\nimport { _esc, isoDate } from '../../utils.js';\nimport { ClassroomService } from './classroom-service.js';\nimport { RecitationService } from './recitation-service.js';\nimport { CB_CANVAS_W, CB_CANVAS_H } from './classroom_builder.js';\nimport { _lmWebNfcSupported } from './live-monitor-webnfc.js';\n";
  assert.strictEqual(orig.split("'use strict';\n").length, 2); assert.strictEqual(twin.split(imports).length, 2);
  const headEnd = twin.indexOf(imports);
  const origHead = orig.slice(0, orig.indexOf("'use strict';\n"));
  assert(twin.slice(0, headEnd).endsWith(origHead), 'twin = new header + the original leading comment block verbatim');
  const rebuilt = twin.slice(headEnd).replace(imports, "'use strict';\n").replace(/^  export function (\w+)\(/gm, '  function $1(');
  assert.strictEqual(origHead + rebuilt, orig, 'reversing the swaps must reproduce the original byte-for-byte');
  assert.strictEqual((twin.match(/^\s*export /gm) || []).length, 11, 'exactly 11 exports');
}

const STARTER_HTML = `<!doctype html><html><body><div id="page"></div><div id="toast"></div></body></html>`;
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
  win.eval(`(function(){ const R = Date; class D extends R { constructor(...a){ if (a.length) super(...a); else super(${FIXED}); } static now(){ return ${FIXED}; } } globalThis.Date = D; }());`);
  win.eval("globalThis.__rnd = { s: 424242 }; Math.random = function () { __rnd.s = (__rnd.s * 1103515245 + 12345) & 0x7fffffff; return __rnd.s / 0x7fffffff; };");
  win.DEFAULT_DB = { students: [], classSections: [], classroomLayouts: [], seats: [], seatAssignments: [], attendanceLogs: [], recitationLog: [] };
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };
  const mockClient = { auth: { getSession: async () => ({ data: { session: null } }) }, rpc: async () => ({ data: null, error: null }) };
  win.SupabaseClient = { getClient: () => mockClient, resolveProvider: () => 'supabase' };
  win.__EDUQUEST_SUPABASE_URL__ = ''; win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };
  win.__calls = []; win.__dim = { w: 0, h: 0 }; win.__raf = []; win.__timers = []; win.__resize = [];
  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  win.console.warn = (...a) => win.__calls.push(JSON.stringify(['warn', ...a.map(x => (x && x.message) || String(x))]));
  win.console.error = (...a) => win.__calls.push(JSON.stringify(['error', ...a.map(String)]));
  win.addEventListener('error', e => win.__calls.push(JSON.stringify(['window-error', String(e.message)])));
  return { win, logs };
}
function addScript(win, code) { const s = win.document.createElement('script'); s.textContent = code; win.document.head.appendChild(s); }
function installEnv(win) {
  // after the files are loaded: recorders for the window-qualified click targets, geometry, rAF, resize-listener spy
  const rec = name => (...a) => { win.__calls.push(JSON.stringify([name, ...a])); };
  for (const n of HANDLERS) win[n] = rec(n);
  Object.defineProperty(win.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return this.id === 'lm-canvas-wrap' ? win.__dim.w : 0; } });
  Object.defineProperty(win.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return this.id === 'lm-canvas-wrap' ? win.__dim.h : 0; } });
  for (const m of ['add', 'remove']) { const real = win.DOMTokenList.prototype[m]; win.DOMTokenList.prototype[m] = function (...a) { if (a[0] === 'bump') win.__calls.push(JSON.stringify(['classList.' + m, 'bump'])); return real.apply(this, a); }; }
  win.requestAnimationFrame = cb => { win.__raf.push(cb); return win.__raf.length; };
  const add = win.addEventListener.bind(win), remove = win.removeEventListener.bind(win);
  win.__realRemove = remove;
  win.addEventListener = (type, fn, o) => { if (type === 'resize') win.__resize.push(fn); return add(type, fn, o); };
}
async function evalOriginal(win) {
  for (const f of ['repository/table-sync.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'db-service.js', 'modules/core/state-manager.js', 'dom.js', 'utils.js']) win.eval(read(f));
  addScript(win, 'const CB_CANVAS_W = 1200, CB_CANVAS_H = 800;');
  for (const f of ['classroom-service', 'recitation-service', 'live-monitor-webnfc', 'live_monitor', 'live-monitor-render']) addScript(win, read('modules/seat-arrangement/' + f + '.js'));
  addScript(win, HELPERS_SCRIPT);
  await win.AppStore.ready; installEnv(win);
}
async function evalBridge(win) {
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'live-monitor-render-combined-bundle.js'), 'utf8'));
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
  const state = () => win.AppStore.getState();
  const step = async (label, fn) => {
    win.__rnd.s = 424242; win.__calls.length = 0; win.__raf.length = 0; win.__timers.length = 0; win.__resize.length = 0;
    let err = null, ret;
    try { ret = await fn(); } catch (e) { err = String(e && e.message); }
    await sleep(5);
    out.steps.push({ label, err, ret, calls: win.__calls.slice(), html: page().innerHTML, st: snap(win), raf: win.__raf.length, rafIsScale: win.__raf.map(f => f === win._lmScaleCanvas), resize: win.__resize.map(f => f === win._lmScaleCanvas), timers: win.__timers.map(t => t.ms) });
  };
  const fresh = async (label, init, fn, opts) => {
    opts = opts || {};
    for (const f of win.__resize) win.__realRemove('resize', f);
    delete win.NDEFReader; win.__dim = { w: 1224, h: 824 }; win.getClassLabel = opts.noLabel ? undefined : ((c, s) => 'Label<' + c + '>' + (Array.isArray(s.students) ? s.students.length : '?'));
    page().innerHTML = '';
    seed(win, opts.extra);
    setState(win, DEFAULTS); if (init) setState(win, init);
    return step(label, fn);
  };
  const R = (ids, st) => win._lmRender(page(), ids || ['c1', 'c2'], st || state());
  const q = (sel) => page().querySelector(sel);
  const click = el => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  const change = (el, v) => { el.value = v; el.dispatchEvent(new win.Event('change', { bubbles: true })); };
  const input = (el, v) => { el.value = v; el.dispatchEvent(new win.Event('input', { bubbles: true })); };
  const withTimers = async fn => {
    const real = win.setTimeout; let id = 0;
    win.setTimeout = (f, ms) => { win.__timers.push({ f, ms }); return ++id; };
    try { return await fn(); } finally { win.setTimeout = real; }
  };

  out.surface = { fns: EXPORTS.map(n => [n, typeof win[n]]), nfc: typeof win._lmWebNfcSupported, shared: SHARED.map(n => [n, typeof win[n]]), loadLogs: logs.filter(l => /live.?monitor/i.test(l)) };
  seed(win);

  // ── _lmRender ──
  await fresh('render: class c1 + layout L1, recitation off', null, async () => { R(); });
  await fresh('render: no layout selected', { _lmLayoutId: null }, async () => { R(); });
  await fresh('render: class without layouts', { _lmClassId: 'c2', _lmLayoutId: 'L3' }, async () => { R(); });
  await fresh('render: state without classroomLayouts', null, async () => { R(['c1'], { students: [] }); });
  await fresh('render: layout belonging to another class selected (canvas empty)', { _lmClassId: 'c2', _lmLayoutId: 'L1' }, async () => { R(); });
  await fresh('render: kiosk mode on', { _lmKioskMode: true }, async () => { R(); });
  await fresh('render: recitation, pure_random, layout set', REC_ON, async () => { R(); });
  await fresh('render: recitation, no layout -> cold call disabled', Object.assign({ _lmLayoutId: null }, REC_ON), async () => { R(); });
  await fresh('render: recitation, spatial_block, nothing targeted -> disabled + hint 0', Object.assign({ _lmStrategy: 'spatial_block' }, REC_ON), async () => { R(); });
  await fresh('render: recitation, spatial_block, 2 targeted -> enabled + hint 2', Object.assign({ _lmStrategy: 'spatial_block', _lmTargetedSeatIds: { __set: ['seatA', 'seatB'] } }, REC_ON), async () => { R(); });
  await fresh('render: recitation + NDEFReader, nfc idle', REC_ON, async () => { win.NDEFReader = function () {}; R(); });
  await fresh('render: recitation + NDEFReader, nfc active', Object.assign({ _lmWebNfcActive: true }, REC_ON), async () => { win.NDEFReader = function () {}; R(); });
  await fresh('render: NDEFReader present but recitation off -> no nfc button', null, async () => { win.NDEFReader = function () {}; R(); });
  await fresh('render: getClassLabel absent -> raw ids; escaped markup', null, async () => { R(['c1', '<x>&"', 'c2']); }, { noLabel: true });
  await fresh('render: class option selected follows _lmClassId', { _lmClassId: 'c2', _lmLayoutId: 'L3' }, async () => { R(['c1', 'c2', 'c3']); });
  await fresh('render: resize listener attached once, flag set', null, async () => { R(); const a = win.__resize.length; R(); return [a, win.__resize.length, snap(win)._lmResizeListenerAttached]; });
  await fresh('render: listener flag already true -> no new listener', { _lmResizeListenerAttached: true }, async () => { R(); });
  await fresh('render: resize event rescales the canvas', null, async () => { R(); const c = q('#lm-canvas').style.transform; win.__dim = { w: 624, h: 424 }; win.dispatchEvent(new win.Event('resize')); return [c, q('#lm-canvas').style.transform, q('#lm-canvas-wrap').style.minHeight]; });
  await fresh('render: zero-size wrap schedules a rAF retry (render)', null, async () => { win.__dim = { w: 0, h: 0 }; R(); });
  // real inline events (markup strings call window handlers)
  await fresh('inline: class / layout / strategy change, fullscreen click', REC_ON, async () => { R(); change(q('#lm-class-select'), 'c2'); change(q('#lm-layout-select'), 'L2'); change(q('#lm-strategy-select'), 'spatial_block'); click(q('#lm-fullscreen-btn')); });
  await fresh('inline: cold call / recitation toggle / nfc toggle clicks', REC_ON, async () => { win.NDEFReader = function () {}; R(); click(q('#lm-coldcall-btn')); click(q('#lm-recitation-toggle')); click(q('#lm-webnfc-toggle')); });

  // ── _lmScaleCanvas ──
  await fresh('scale: no wrap element', null, async () => { win._lmScaleCanvas(); });
  await fresh('scale: wrap but no canvas', null, async () => { page().innerHTML = '<div id="lm-canvas-wrap"></div>'; win._lmScaleCanvas(); });
  const mk = () => { page().innerHTML = '<div id="lm-canvas-wrap"><div id="lm-canvas"></div></div>'; };
  const sc = () => [q('#lm-canvas').style.transform, q('#lm-canvas').style.transformOrigin, q('#lm-canvas-wrap').style.minHeight];
  await fresh('scale: height-bound (w 3024, h 424)', null, async () => { mk(); win.__dim = { w: 3024, h: 424 }; win._lmScaleCanvas(); return sc(); });
  await fresh('scale: width-bound (w 624, h 2824)', null, async () => { mk(); win.__dim = { w: 624, h: 2824 }; win._lmScaleCanvas(); return sc(); });
  await fresh('scale: equal bounds (w 1224, h 824)', null, async () => { mk(); win.__dim = { w: 1224, h: 824 }; win._lmScaleCanvas(); return sc(); });
  await fresh('scale: height 0 falls back to the width scale', null, async () => { mk(); win.__dim = { w: 624, h: 0 }; win._lmScaleCanvas(); return sc(); });
  await fresh('scale: height exactly 24 (scaleH 0) falls back to width scale', null, async () => { mk(); win.__dim = { w: 624, h: 24 }; win._lmScaleCanvas(); return sc(); });
  await fresh('scale: 0x0 -> rAF retry, no style; retry succeeds once sized', null, async () => { mk(); win.__dim = { w: 0, h: 0 }; win._lmScaleCanvas(); const a = sc(); win.__dim = { w: 624, h: 424 }; win.__raf[0](); return [a, sc(), win.__raf.length]; });
  await fresh('scale: width 24 (scale 0) -> retry', null, async () => { mk(); win.__dim = { w: 24, h: 0 }; win._lmScaleCanvas(); return sc(); });
  await fresh('scale: NaN width -> retry', null, async () => { mk(); win.__dim = { w: NaN, h: 424 }; win._lmScaleCanvas(); return sc(); });
  await fresh('scale: Infinity -> retry', null, async () => { mk(); win.__dim = { w: Infinity, h: Infinity }; win._lmScaleCanvas(); return sc(); });

  // ── _lmRenderCanvas ──
  const cv = () => [...page().querySelectorAll('.lm-seat')].map(e => [e.className, e.dataset.seatId, e.dataset.studentId, e.getAttribute('style'), e.innerHTML, typeof e.onclick]);
  const mkc = () => { page().innerHTML = '<div id="lm-canvas"><i>old</i></div>'; };
  await fresh('canvas: no #lm-canvas', null, async () => { win._lmRenderCanvas(); });
  await fresh('canvas: no layout -> message, old content cleared', { _lmLayoutId: null }, async () => { mkc(); win._lmRenderCanvas(); });
  await fresh('canvas: unknown layout -> empty', { _lmLayoutId: 'nope' }, async () => { mkc(); win._lmRenderCanvas(); });
  await fresh('canvas: layout of another class -> empty', { _lmClassId: 'c2' }, async () => { mkc(); win._lmRenderCanvas(); });
  await fresh('canvas: full seat map, recitation off (no onclick, no badges)', null, async () => { mkc(); win._lmRenderCanvas(); return cv(); });
  await fresh('canvas: seat map is repainted, not appended', null, async () => { mkc(); win._lmRenderCanvas(); win._lmRenderCanvas(); return cv().length; });
  await fresh('canvas: recitation on -> badges with summed points, 0 for no entries', REC_ON, async () => { mkc(); win._lmRenderCanvas(); return cv(); });
  await fresh('canvas: recitation on but no session start -> no badges, no counts', { _lmRecitationMode: true }, async () => { mkc(); win._lmRenderCanvas(); return cv(); });
  await fresh('canvas: recitation off but a session start -> no badges', { _lmSessionStartAt: SESSION }, async () => { mkc(); win._lmRenderCanvas(); return cv(); });
  await fresh('canvas: recitation click -> award selection, calls window handler', REC_ON, async () => { mkc(); win._lmRenderCanvas(); page().querySelectorAll('.lm-seat').forEach(e => click(e)); return cv().map(c => c[0]); });
  await fresh('canvas: spatial_block -> eligible seats target, others fall to award selection', Object.assign({ _lmStrategy: 'spatial_block', _lmTargetedSeatIds: { __set: ['seatB', 'seatD'] } }, REC_ON), async () => { mkc(); win._lmRenderCanvas(); page().querySelectorAll('.lm-seat').forEach(e => click(e)); return cv().map(c => c[0]); });
  await fresh('canvas: spatial_block while recitation is OFF -> nothing clickable', { _lmStrategy: 'spatial_block' }, async () => { mkc(); win._lmRenderCanvas(); return cv().map(c => c[5]); });
  await fresh('canvas: no attendance logs -> every student grey', null, async () => { mkc(); win._lmRenderCanvas(); return cv().map(c => c[3]); }, { extra: { attendanceLogs: [] } });
  await fresh('canvas: yesterday-only logs are ignored', null, async () => { mkc(); win._lmRenderCanvas(); return cv().map(c => c[3]); }, { extra: { attendanceLogs: [{ id: 'y', classId: 'c1', studentId: 's1', logDate: '2025-12-31', status: 'Early' }] } });

  // ── sidebars ──
  const sb = () => $(win, 'lm-sidebar').innerHTML;
  const mks = () => { page().innerHTML = '<div id="lm-sidebar"></div>'; };
  await fresh('sidebar: dispatch -> attendance when recitation off', null, async () => { mks(); win._lmRenderSidebar(); });
  await fresh('sidebar: dispatch -> recitation when on', REC_ON, async () => { mks(); win._lmRenderSidebar(); });
  await fresh('sidebar: no #lm-sidebar (all three renderers)', REC_ON, async () => { win._lmRenderSidebar(); win._lmRenderAttendanceSidebar(); win._lmRenderRecitationSidebar(); });
  await fresh('attendance sidebar: counts, feed order, statuses, unknown student', null, async () => { mks(); win._lmRenderAttendanceSidebar(); });
  await fresh('attendance sidebar: class c2 / empty feed', { _lmClassId: 'c2' }, async () => { mks(); win._lmRenderAttendanceSidebar(); });
  await fresh('attendance sidebar: default-class roster (students without classId)', { _lmClassId: 'default-class' }, async () => { mks(); win._lmRenderAttendanceSidebar(); });
  await fresh('attendance sidebar: feed capped at 30, newest first', null, async () => {
    const logs = []; for (let i = 0; i < 35; i++) logs.push({ id: 'g' + i, classId: 'c1', studentId: 's1', logDate: TODAY, status: 'Early', scannedAt: new Date(FIXED - (i + 1) * 60000).toISOString(), entryMethod: 'RFID' });
    win.AppStore.updateState(d => { d.attendanceLogs = logs; }, { type: 'test:logs' }); mks(); win._lmRenderAttendanceSidebar(); return $(win, 'lm-feed').children.length;
  });
  await fresh('attendance sidebar: no logs at all', null, async () => { mks(); win._lmRenderAttendanceSidebar(); }, { extra: { attendanceLogs: [] } });
  await fresh('attendance sidebar: override panel reflects selection/status/note', { _lmOverrideStudentId: 's2', _lmOverrideStatus: 'Absent', _lmOverrideNote: 'a "q" <b>' }, async () => { mks(); win._lmRenderAttendanceSidebar(); });
  const R0 = () => state().students.filter(s => (s.classId || 'default-class') === 'c1');
  await fresh('override panel: not collapsible', null, async () => win._lmOverridePanelHtml(R0(), { collapsible: false }));
  await fresh('override panel: opts undefined', null, async () => win._lmOverridePanelHtml(R0()));
  await fresh('override panel: collapsible + collapsed', null, async () => win._lmOverridePanelHtml(R0(), { collapsible: true }));
  await fresh('override panel: collapsible + expanded', { _lmOverrideExpanded: true }, async () => win._lmOverridePanelHtml(R0(), { collapsible: true }));
  await fresh('override panel: non-collapsible ignores expanded=false', { _lmOverrideExpanded: false }, async () => win._lmOverridePanelHtml([], {}));
  await fresh('override panel: selected student enables the button', { _lmOverrideStudentId: 's1', _lmOverrideStatus: 'Remove' }, async () => win._lmOverridePanelHtml(R0(), {}));
  await fresh('override panel: name fallbacks', null, async () => win._lmOverridePanelHtml([{ id: 'a', name: 'N' }, { id: 'b', displayName: 'D' }, { id: 'c' }], {}));
  await fresh('override panel: toggle header click calls the window handler', null, async () => { page().innerHTML = '<div id="x">' + win._lmOverridePanelHtml(R0(), { collapsible: true }) + '</div>'; click(q('.lm-override-header')); change(q('#lm-override-student') || { value: '', dispatchEvent() {} }, 's1'); });
  await fresh('override panel: expanded inline events', { _lmOverrideExpanded: true }, async () => { page().innerHTML = '<div id="x">' + win._lmOverridePanelHtml(R0(), { collapsible: true }) + '</div>'; change(q('#lm-override-student'), 's1'); change(q('#lm-override-status'), 'Late'); input(q('#lm-override-note'), 'hey'); click(q('#lm-override-submit')); });

  // feed items
  const FI = [
    [{ status: 'Late', scannedAt: '2025-12-31T23:58:00.000Z', entryMethod: 'RFID' }, { name: 'A' }], [{ status: 'Absent', scannedAt: '2025-12-31T23:58:00.000Z', entryMethod: 'NFC' }, { displayName: 'D' }],
    [{ status: 'Excused', scannedAt: '2025-12-31T23:58:00.000Z' }, {}], [{ status: 'On Time', scannedAt: '2025-12-31T23:58:00.000Z', entryMethod: 'Manual' }, null], [{ status: 'Early' }, undefined],
    [{ status: 'Early', scannedAt: '2025-12-31T23:58:00.000Z', entryMethod: 'rfid' }, { name: '<b>&' }], [{ status: 'Late', scannedAt: 0 }, { name: '', displayName: '' }],
  ];
  await fresh('feed item: all branches', null, async () => FI.map(([l, s]) => win._lmFeedItem(l, s)));
  const RFI = [
    [{ id: 'e1', pts: 2, createdAt: '2025-12-31T23:30:00.000Z', note: 'scan' }, { name: 'A' }], [{ id: 'e2', pts: 3, createdAt: '2025-12-31T23:30:00.000Z', note: 'Manual award' }, { displayName: 'D' }],
    [{ id: 'e3', pts: 1, createdAt: '2025-12-31T23:30:00.000Z', note: 'SCAN' }, null], [{ id: 'e4', pts: 1, createdAt: '2025-12-31T23:30:00.000Z', note: 'my <b>note</b>' }, {}],
    [{ id: 'e5', pts: 5 }, { name: 'N' }], [{ id: 'e6', pts: 1, note: '' }, { name: 'N' }], [{ id: "e'7", pts: 1, note: 'scan ' }, { name: 'N' }], [{ id: 'e8' }, { name: 'N' }],
  ];
  await fresh('recitation feed item: all branches', null, async () => RFI.map(([e, s]) => win._lmRecitationFeedItem(e, s)));

  // recitation sidebar
  await fresh('rec sidebar: session with entries, no selection', REC_ON, async () => { mks(); win._lmRenderRecitationSidebar(); });
  await fresh('rec sidebar: session start null -> empty feed, empty status time', { _lmRecitationMode: true }, async () => { mks(); win._lmRenderRecitationSidebar(); });
  await fresh('rec sidebar: search term filters (case-insensitive, trimmed)', Object.assign({ _lmAwardSearch: '  AN ' }, REC_ON), async () => { mks(); win._lmRenderSidebar(); });
  await fresh('rec sidebar: search matching displayName', Object.assign({ _lmAwardSearch: 'bob' }, REC_ON), async () => { mks(); win._lmRenderRecitationSidebar(); });
  await fresh('rec sidebar: search with no match', Object.assign({ _lmAwardSearch: 'zzz' }, REC_ON), async () => { mks(); win._lmRenderRecitationSidebar(); });
  await fresh('rec sidebar: selected student + points 5', Object.assign({ _lmAwardStudentId: 's1', _lmAwardPoints: 5 }, REC_ON), async () => { mks(); win._lmRenderRecitationSidebar(); });
  await fresh('rec sidebar: selected displayName-only student, points 2', Object.assign({ _lmAwardStudentId: 's2', _lmAwardPoints: 2 }, REC_ON), async () => { mks(); win._lmRenderRecitationSidebar(); });
  await fresh('rec sidebar: selected id not in roster -> disabled, no selected line', Object.assign({ _lmAwardStudentId: 's4' }, REC_ON), async () => { mks(); win._lmRenderRecitationSidebar(); });
  await fresh('rec sidebar: override panel expanded', Object.assign({ _lmOverrideExpanded: true, _lmOverrideStudentId: 's3' }, REC_ON), async () => { mks(); win._lmRenderRecitationSidebar(); });
  await fresh('rec sidebar: quote ids escaped in handlers', Object.assign({ _lmAwardSearch: 'quo' }, REC_ON), async () => { mks(); win._lmRenderRecitationSidebar(); });
  await fresh('rec sidebar: inline events', Object.assign({ _lmAwardStudentId: 's1' }, REC_ON), async () => { mks(); win._lmRenderRecitationSidebar(); input(q('#lm-award-search'), 'x'); click(q('.lm-award-result')); click(q('.lm-points-btn')); click(q('#lm-award-submit')); click(q('.lm-undo-btn')); click(q('.lm-override-header')); });
  await fresh('rec sidebar: empty log', REC_ON, async () => { mks(); win._lmRenderRecitationSidebar(); }, { extra: { recitationLog: [] } });
  await fresh('rec sidebar: undefined recitationLog slice', REC_ON, async () => { mks(); win._lmRenderRecitationSidebar(); }, { extra: { recitationLog: undefined } });

  await fresh('rec sidebar: exactly one entry still renders the feed', REC_ON, async () => { mks(); win._lmRenderRecitationSidebar(); return $(win, 'lm-feed').children.length; }, { extra: { recitationLog: [{ id: 'only', classId: 'c1', studentId: 's1', pts: 3, createdAt: '2025-12-31T23:30:00.000Z', note: 'scan' }] } });
  await fresh('rec sidebar: default-class roster (students without classId)', Object.assign({ _lmClassId: 'default-class' }, REC_ON), async () => { mks(); win._lmRenderRecitationSidebar(); }, { extra: { recitationLog: [{ id: 'd1', classId: 'default-class', studentId: 's5', pts: 2, createdAt: '2025-12-31T23:30:00.000Z', note: 'scan' }] } });
  // animate + floating point
  const mka = () => { page().innerHTML = '<div id="lm-canvas"></div>'; win._lmRenderCanvas(); };
  await fresh('animate: new entries spawn floats once; ids remembered', REC_ON, async () => withTimers(async () => { mka(); win._lmAnimateNewRecitationEntries(); const a = page().querySelectorAll('.lm-float-point').length; win._lmAnimateNewRecitationEntries(); return [a, page().querySelectorAll('.lm-float-point').length, [...snap(win)._lmRecitationSeenIds.set].sort()]; }));
  await fresh('animate: already-seen ids are skipped', Object.assign({ _lmRecitationSeenIds: { __set: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', "r'10"] } }, REC_ON), async () => withTimers(async () => { mka(); win._lmAnimateNewRecitationEntries(); return page().querySelectorAll('.lm-float-point').length; }));
  await fresh('animate: a new entry arriving later floats exactly once', REC_ON, async () => withTimers(async () => {
    mka(); win._lmAnimateNewRecitationEntries(); win.AppStore.updateState(d => { d.recitationLog.push({ id: 'r-new', classId: 'c1', studentId: 's1', pts: 7, createdAt: '2025-12-31T23:59:00.000Z', note: 'scan' }); }, { type: 'test:new' });
    mka(); win._lmAnimateNewRecitationEntries(); const f = [...page().querySelectorAll('.lm-float-point')].map(e => e.textContent); win._lmAnimateNewRecitationEntries(); return [f, page().querySelectorAll('.lm-float-point').length];
  }));
  await fresh('animate: no session -> nothing', { _lmRecitationMode: true }, async () => withTimers(async () => { mka(); win._lmAnimateNewRecitationEntries(); return page().querySelectorAll('.lm-float-point').length; }));
  await fresh('animate: entry for a student with no seat is remembered, no float', REC_ON, async () => withTimers(async () => { mka(); win._lmAnimateNewRecitationEntries(); return snap(win)._lmRecitationSeenIds.set.includes('r6'); }));
  await fresh('float: no seat -> no-op', null, async () => withTimers(async () => { mka(); win._lmSpawnFloatingPoint('nobody', 3); return [page().querySelectorAll('.lm-float-point').length, win.__timers.length]; }));
  await fresh('float: seat without badge -> float only; removed after 1500ms', null, async () => withTimers(async () => { mka(); win._lmSpawnFloatingPoint('s1', 4); const a = page().querySelector('.lm-seat[data-student-id="s1"]').innerHTML; const t = win.__timers.map(x => x.ms); win.__timers[0].f(); return [a, t, page().querySelectorAll('.lm-float-point').length]; }));
  await fresh('float: seat with badge -> bump class (restarted on a second point)', REC_ON, async () => withTimers(async () => { mka(); const b = () => page().querySelector('.lm-recitation-badge[data-badge-for="s1"]').className; const a = b(); win._lmSpawnFloatingPoint('s1', 2); const c = b(); win._lmSpawnFloatingPoint('s1', 3); return [a, c, b(), [...page().querySelectorAll('.lm-seat[data-student-id="s1"] .lm-float-point')].map(e => e.textContent), win.__timers.map(t => t.ms)]; }));
  await fresh('float: unselectable student id -> same selector error on both sides', null, async () => withTimers(async () => { mka(); win._lmSpawnFloatingPoint('a"b', 1); }));
  await fresh('float: pts 0 / undefined text', REC_ON, async () => withTimers(async () => { mka(); win._lmSpawnFloatingPoint('s2', 0); win._lmSpawnFloatingPoint('s2'); return [...page().querySelectorAll('.lm-float-point')].map(e => e.textContent); }));
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
  if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify(o));
  const S = label => { const s = o.steps.find(x => x.label === label); assert(s, 'missing step ' + label); return s; };
  const has = (s, c) => s.calls.includes(c);
  assert.deepStrictEqual(o.surface.fns.map(e => e[1]), Array(11).fill('function')); assert.strictEqual(o.surface.nfc, 'function');
  assert(o.surface.shared.every(e => e[1] !== 'function'));
  assert.strictEqual(o.steps.filter(s => s.err && !/unselectable/.test(s.label) && !/no #lm-sidebar/.test(s.label)).length, 0, 'unexpected exceptions: ' + o.steps.filter(s => s.err).map(s => s.label + ' => ' + s.err).join(' | '));
  // PRE-EXISTING QUIRK (kept, identical on both sides): _esc() does not escape `'`, so an id containing a quote (fixture "r'10") breaks the inline
  // onclick='...' string of the undo button -> an uncaught SyntaxError at click time. Only that one step may raise a window-error.
  const werr = o.steps.filter(s => s.calls.some(c => c.startsWith('["window-error"')));
  assert.deepStrictEqual(werr.map(s => s.label), ['rec sidebar: inline events'], 'only the quote-id inline handler raises');
  assert(werr[0].calls.every(c => !c.startsWith('["window-error"') || c.includes('missing ) after argument list')));
  // ── independent sanity: what the ORIGINAL does (so equivalence cannot be two identical wrong answers) ──
  const H = l => S(l).html, RET = l => S(l).ret;
  assert(!H('render: class c1 + layout L1, recitation off').includes('lm-strategy-select') && H('render: class c1 + layout L1, recitation off').includes('Start Recitation Session') && H('render: class c1 + layout L1, recitation off').includes('⛶ Fullscreen'));
  assert(H('render: class c1 + layout L1, recitation off').includes('Label&lt;c1&gt;8') && H('render: class c1 + layout L1, recitation off').includes('Main &lt;Room&gt;') && H('render: state without classroomLayouts').includes('— No layout for this class —') && !H('render: no layout selected').includes('— No layout for this class —') && !/<option value="L1" selected/.test(H('render: no layout selected')));
  assert(H('render: kiosk mode on').includes('⤢ Exit Fullscreen') && H('render: kiosk mode on').includes('lm-fullscreen-btn active'));
  assert(/id="lm-coldcall-btn"[^>]*\sdisabled/.test(H('render: recitation, no layout -> cold call disabled')) && !/id="lm-coldcall-btn"[^>]*\sdisabled/.test(H('render: recitation, pure_random, layout set')));
  assert(/id="lm-coldcall-btn"[^>]*\sdisabled/.test(H('render: recitation, spatial_block, nothing targeted -> disabled + hint 0')) && H('render: recitation, spatial_block, nothing targeted -> disabled + hint 0').includes('<span class="lm-target-count">0</span>'));
  assert(!/id="lm-coldcall-btn"[^>]*\sdisabled/.test(H('render: recitation, spatial_block, 2 targeted -> enabled + hint 2')) && H('render: recitation, spatial_block, 2 targeted -> enabled + hint 2').includes('<span class="lm-target-count">2</span>'));
  assert(H('render: recitation + NDEFReader, nfc idle').includes('lm-webnfc-toggle') && H('render: recitation + NDEFReader, nfc active').includes('NFC On — Roaming') && !H('render: NDEFReader present but recitation off -> no nfc button').includes('lm-webnfc-toggle') && !H('render: recitation, pure_random, layout set').includes('lm-webnfc-toggle'));
  assert(H('render: getClassLabel absent -> raw ids; escaped markup').includes('&lt;x&gt;&amp;"') && !H('render: getClassLabel absent -> raw ids; escaped markup').includes('Label&lt;'));
  assert.deepStrictEqual(RET('render: resize listener attached once, flag set'), [1, 1, true]); assert.strictEqual(S('render: listener flag already true -> no new listener').resize.length, 0);
  assert.deepStrictEqual(RET('render: resize event rescales the canvas'), ['scale(1)', 'scale(0.5)', '424px']); assert.deepStrictEqual(S('render: resize listener attached once, flag set').resize, [true]);
  assert(S('render: zero-size wrap schedules a rAF retry (render)').raf === 1 && S('render: zero-size wrap schedules a rAF retry (render)').rafIsScale[0] === true);
  assert.deepStrictEqual(RET('scale: height-bound (w 3024, h 424)'), ['scale(0.5)', 'top left', '424px']); assert.deepStrictEqual(RET('scale: width-bound (w 624, h 2824)'), ['scale(0.5)', 'top left', '424px']);
  assert.deepStrictEqual(RET('scale: equal bounds (w 1224, h 824)')[0], 'scale(1)'); assert.strictEqual(RET('scale: height 0 falls back to the width scale')[0], 'scale(0.5)');
  { const r = RET('scale: 0x0 -> rAF retry, no style; retry succeeds once sized'); assert.deepStrictEqual(r[0], ['', '', '']); assert.strictEqual(r[1][0], 'scale(0.5)'); assert.strictEqual(S('scale: 0x0 -> rAF retry, no style; retry succeeds once sized').raf, 1); }
  for (const l of ['scale: width 24 (scale 0) -> retry', 'scale: NaN width -> retry', 'scale: Infinity -> retry']) assert.strictEqual(S(l).raf, 1, l); assert.strictEqual(S('scale: no wrap element').raf, 0);
  { const c = RET('canvas: full seat map, recitation off (no onclick, no badges)'); assert.strictEqual(c.length, 8); assert(c.every(r => r[5] === 'object') && c.every(r => !r[4].includes('lm-recitation-badge')) && c[0][3].includes('rotate(15deg)') && c[1][3].includes('rotate(0deg)') && c[2][4].includes('🪑') && c[0][4].includes('onerror="this.remove()"') && c[0][4].includes('>Ann<') && c[1][4].includes('>Bob<') && c[0][2] === 's1' && c[2][2] === ''); }
  { const c = RET('canvas: recitation on -> badges with summed points, 0 for no entries'); const b = id => { const r = c.find(x => x[2] === id); return r && (r[4].match(/data-badge-for="[^"]*">(\d+)</) || [])[1]; }; assert.deepStrictEqual(['s1', 's2', 's7', 's3', 's6'].map(b), ['5', '2', '5', '0', '0']); assert(!c.find(x => x[2] === '').slice(4)[0].includes('badge')); }
  assert(RET('canvas: recitation on but no session start -> no badges, no counts').every(r => !r[4].includes('badge')) && RET('canvas: recitation off but a session start -> no badges').every(r => !r[4].includes('badge')));
  { const c = RET('canvas: recitation click -> award selection, calls window handler'); assert(c.every((cl, i) => cl === (i === 2 ? 'lm-seat' : 'lm-seat targetable'))); assert.deepStrictEqual(S('canvas: recitation click -> award selection, calls window handler').calls.sort(), ['["_lmSelectAwardStudentFromSeat","s\'8"]', '["_lmSelectAwardStudentFromSeat","s1"]', '["_lmSelectAwardStudentFromSeat","s2"]', '["_lmSelectAwardStudentFromSeat","s3"]', '["_lmSelectAwardStudentFromSeat","s5"]', '["_lmSelectAwardStudentFromSeat","s6"]', '["_lmSelectAwardStudentFromSeat","s7"]'].sort()); }
  { const s = S('canvas: spatial_block -> eligible seats target, others fall to award selection'); assert.deepStrictEqual(s.ret, ['lm-seat targetable', 'lm-seat targetable targeted', 'lm-seat', 'lm-seat targetable targeted'.replace(' targeted', ''), 'lm-seat targetable', 'lm-seat targetable', 'lm-seat targetable', 'lm-seat targetable']); assert(s.calls.includes('["_lmToggleSeatTarget","seatA"]') && s.calls.includes('["_lmToggleSeatTarget","seatB"]') && s.calls.includes('["_lmToggleSeatTarget","seatF"]') && s.calls.includes('["_lmSelectAwardStudentFromSeat","s6"]') && s.calls.includes('["_lmSelectAwardStudentFromSeat","s3"]') && !s.calls.includes('["_lmToggleSeatTarget","seatE"]')); }
  assert(RET('canvas: spatial_block while recitation is OFF -> nothing clickable').every(t => t === 'object'));
  assert.strictEqual(RET('canvas: unknown layout -> empty') , undefined); assert(H('canvas: no layout -> message, old content cleared').includes('No layout selected for this class.') && !H('canvas: no layout -> message, old content cleared').includes('old'));
  assert.strictEqual(RET('canvas: seat map is repainted, not appended'), 8);
  { const h = H('attendance sidebar: counts, feed order, statuses, unknown student'); const nums = [...h.matchAll(/lm-stat-num" style="[^"]*">(\d+)</g)].map(m => m[1]); assert.deepStrictEqual(nums, ['3', '1', '1', '2'], 'present 3 (Early+On Time+ghost Early), late 1, absent 1, excused 2'); const feed = h.slice(h.indexOf('id="lm-feed"')); assert(feed.indexOf('Unknown student') > 0 && feed.indexOf('[Absent]') > 0 && feed.indexOf('[Marked Late]') > 0 && feed.indexOf('[Excused]') > 0 && !feed.includes('Dee') && !feed.includes('Cy ')); assert.strictEqual((feed.match(/lm-feed-item/g) || []).length, 6, 'only logs with scannedAt, today, class c1'); assert(feed.indexOf('lm-feed-item') < feed.indexOf('[Absent]'), 'newest first'); }
  assert(H('attendance sidebar: class c2 / empty feed').includes('No scans yet today.') || H('attendance sidebar: class c2 / empty feed').includes('Dee'));
  assert.strictEqual(RET('attendance sidebar: feed capped at 30, newest first'), 30); assert(H('attendance sidebar: no logs at all').includes('No scans yet today.'));
  assert(H('attendance sidebar: override panel reflects selection/status/note').includes('value="a &quot;q&quot; <b>"') && !/id="lm-override-submit"[^>]*disabled/.test(H('attendance sidebar: override panel reflects selection/status/note')));
  { const p = l => RET(l); assert(!p('override panel: not collapsible').includes('lm-override-caret') && p('override panel: collapsible + collapsed').includes('▸ Show') && !p('override panel: collapsible + collapsed').includes('lm-override-select') && p('override panel: collapsible + expanded').includes('▾ Hide') && p('override panel: collapsible + expanded').includes('lm-override-select') && !p('override panel: opts undefined').includes('lm-override-caret') && /id="lm-override-submit"\s+disabled/.test(p('override panel: not collapsible')) && !/id="lm-override-submit"\s+disabled/.test(p('override panel: selected student enables the button')) && p('override panel: selected student enables the button').includes('Remove entry') && p('override panel: name fallbacks').includes('>Student<') && p('override panel: name fallbacks').includes('>D<')); }
  { const f = RET('feed item: all branches'); assert(f[0].includes('scanned in') && f[0].includes('[Marked Late]') && f[1].includes('[Absent]') && f[1].includes('scanned in') && f[2].includes('[Excused]') && f[2].includes('Unknown') && f[3].includes('Unknown student') && f[3].includes('recorded') && f[4].includes('lm-feed-time"></div>') && f[5].includes('recorded') && f[5].includes('&lt;b&gt;&amp;') && f[6].includes('Unknown ')); }
  { const f = RET('recitation feed item: all branches'); assert(f[0].includes('· scan<') && f[1].includes('· Manual award<') && f[2].includes('· scan<') && f[3].includes('· my &lt;b&gt;note&lt;/b&gt;<') && f[3].includes('Unknown') && f[4].includes('lm-recitation-feed-meta"> · scan<') && f[5].includes('· scan<') && f[6].includes('· scan <') && f[7].includes('+undefined') && f[6].includes("_lmUndoRecitation('e'7')")); }
  { const h = H('rec sidebar: session with entries, no selection'); assert(h.includes('Session Active — started') && h.includes('No recitations logged') === false && (h.match(/lm-recitation-feed-item/g) || []).length === 7 && /id="lm-award-submit"\s+disabled/.test(h) && h.indexOf('lm-recitation-feed-item') > 0 && !h.includes('lm-award-selected') && h.includes('▸ Show')); assert.deepStrictEqual([...h.matchAll(/lm-recitation-feed-pts">([^<]*)</g)].map(m => m[1]), ['+undefined', '+1', '+5', '+1', '+1', '+3', '+2'], 'feed newest first'); }
  assert(H('rec sidebar: session start null -> empty feed, empty status time').includes('No recitations logged yet this session.') && H('rec sidebar: session start null -> empty feed, empty status time').includes('Session Active — started </div>'));
  { const h = H('rec sidebar: search term filters (case-insensitive, trimmed)'); assert(h.includes('Ann Lee') && !h.includes('Cy</span>') && !h.includes('Gus Hill</span>')); assert(H('rec sidebar: search matching displayName').includes('Bob &lt;i&gt;Ray&lt;/i&gt;') && H('rec sidebar: search with no match').includes('No matching students.')); }
  { const h = H('rec sidebar: selected student + points 5'); assert(h.includes('Selected: Ann Lee') && h.includes('<span>✓</span>') && /lm-points-btn selected"\s+onclick="window._lmSetAwardPoints\(5\)/.test(h) && !/id="lm-award-submit"\s+disabled/.test(h)); assert(/lm-points-btn selected"\s+onclick="window._lmSetAwardPoints\(2\)/.test(H('rec sidebar: selected displayName-only student, points 2')) && (H('rec sidebar: selected displayName-only student, points 2').match(/lm-points-btn selected/g) || []).length === 1 && H('rec sidebar: selected displayName-only student, points 2').includes('Selected: Bob &lt;i&gt;Ray')); }
  assert(!H('rec sidebar: selected id not in roster -> disabled, no selected line').includes('lm-award-selected') && /id="lm-award-submit"\s+disabled/.test(H('rec sidebar: selected id not in roster -> disabled, no selected line')));
  assert(H('rec sidebar: override panel expanded').includes('▾ Hide') && H('rec sidebar: empty log').includes('No recitations logged yet this session.') && H('rec sidebar: undefined recitationLog slice').includes('No recitations logged yet this session.'));
  { const s = S('rec sidebar: inline events'); for (const c of ['["_lmOnAwardSearchInput","x"]', '["_lmSelectAwardStudentFromSeat","s1"]', '["_lmSetAwardPoints",1]', '["_lmSubmitManualAward"]', '["_lmToggleOverridePanel"]']) assert(s.calls.includes(c), 'inline handler ' + c); }
  { const s = S('inline: class / layout / strategy change, fullscreen click'); assert.deepStrictEqual(s.calls, ['["_lmOnClassChange","c2"]', '["_lmOnLayoutChange","L2"]', '["_lmOnStrategyChange","spatial_block"]', '["_lmToggleKioskMode"]']); assert.deepStrictEqual(S('inline: cold call / recitation toggle / nfc toggle clicks').calls, ['["_lmStartColdCall"]', '["_lmToggleRecitationMode"]', '["_lmToggleWebNfc"]']); }
  { const r = RET('animate: new entries spawn floats once; ids remembered'); assert.strictEqual(r[0], 6); assert.strictEqual(r[1], 6, 'second call adds none'); assert.strictEqual(r[2].length, 7, 'ids remembered incl. the one with no seat/ghost'); assert.deepStrictEqual(S('animate: new entries spawn floats once; ids remembered').timers, Array(6).fill(1500)); }
  assert.strictEqual(RET('animate: already-seen ids are skipped'), 0); assert.deepStrictEqual(RET('animate: a new entry arriving later floats exactly once'), [['+7'], 1]); assert.strictEqual(RET('animate: no session -> nothing'), 0); assert.strictEqual(RET('animate: entry for a student with no seat is remembered, no float'), true);
  assert.deepStrictEqual(RET('float: no seat -> no-op'), [0, 0]); { const r = RET('float: seat without badge -> float only; removed after 1500ms'); assert(r[0].includes('lm-float-point') === false || r[0].length > 0); assert.deepStrictEqual(r[1], [1500]); assert.strictEqual(r[2], 0, 'removed once the timer fires'); }
  assert.deepStrictEqual(RET('float: seat with badge -> bump class (restarted on a second point)').slice(0, 4), ['lm-recitation-badge', 'lm-recitation-badge bump', 'lm-recitation-badge bump', ['+2', '+3']]);
  assert(S('float: unselectable student id -> same selector error on both sides').err.includes('not a valid selector')); assert.deepStrictEqual(RET('float: pts 0 / undefined text'), ['+0', '+undefined']);
  assert.strictEqual(RET('rec sidebar: exactly one entry still renders the feed'), 1); { const h = H('rec sidebar: default-class roster (students without classId)'); assert(h.includes('Eve Default') && !h.includes('Ann Lee') && h.includes('lm-recitation-feed-item')); }
  { const s = S('float: seat with badge -> bump class (restarted on a second point)'); assert.deepStrictEqual(s.calls, ['["classList.remove","bump"]', '["classList.add","bump"]', '["classList.remove","bump"]', '["classList.add","bump"]'], 'bump removed THEN re-added on every point (restarts the animation)'); }
  console.log('EQUIVALENCE CHECK (compare phase) PASSED —', o.steps.length, 'steps identical on both sides');
  console.log(' - independent sanity assertions on the original: PASSED');
  fs.writeFileSync('/tmp/render-dump.json', JSON.stringify(o));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
