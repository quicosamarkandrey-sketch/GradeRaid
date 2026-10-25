// Phase 7 (Stream D) — equivalence check for modules/seat-arrangement/live_monitor.js (file 27/30), the OWNER of the
// live-monitor shared state.
//
// ORIGINAL side: real classic files (repository/*, db-service, state-manager, dom, utils eval'd); a classic <script> declares
// CB_CANVAS_W/H (as classroom_builder.js does); the file under test is loaded as a real <script> element so its top-level `let`s live
// in the global lexical scope, exactly as in index.html. BRIDGE side: one esbuild bundle whose entry imports the REAL production
// bridge (the twin imports classroom_builder for CB_CANVAS_W/H itself); there the same names are window ACCESSORS onto module-private
// bindings. A classic helper script (loaded after, on both sides) snapshots / sets every shared name BY BARE NAME — exactly how the
// sibling files (render, recitation, webnfc, coldcall) touch them — so any difference in how the two worlds resolve those names
// shows up as a diff. Bare siblings stubbed identically: _lmRender family, _lmClearCycle, _lmReconcileSessionState,
// _lmStopRecitationSession, AttendanceService, RecitationService, window.getActiveClassIds, window.refreshClassroomData.
//
// Checked: 0 reverse-transform byte identity + 18 exports; 1 load-time style injection + surface; 2 renderClassroomMonitor (every
// class/layout selection branch, missing page, refreshClassroomData present/rejecting/absent); 3 unmount; 4 kiosk toggle; 5 the store
// subscription (every event family, unmounted/inactive page, sections reassignment, recitation animate); 6 class/layout/strategy/
// seat-target handlers; 7 override + award handlers (guards, success, error, DOM focus restoration); 8 sibling-style bare reads and
// writes of the shared state (both directions, Sets, handles).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const EXPORTS = ['renderClassroomMonitor', 'unmountClassroomMonitor', '_lmToggleKioskMode', '_lmOnClassChange', '_lmOnLayoutChange', '_lmOnStrategyChange', '_lmToggleSeatTarget',
  '_lmOnOverrideStudentChange', '_lmOnOverrideStatusChange', '_lmOnOverrideNoteInput', '_lmToggleOverridePanel', '_lmSubmitOverride', '_lmOnAwardSearchInput',
  '_lmSelectAwardStudentFromSeat', '_lmSetAwardPoints', '_lmSubmitManualAward', '_lmUndoRecitation', '_lmSubscribeToStore'];
const SHARED = ['_lmRecitationMode', '_lmClassId', '_lmStrategy', '_lmTargetedSeatIds', '_lmSessionStartAt', '_lmLayoutId', '_lmWebNfcActive', '_lmOverrideExpanded', '_lmAwardSearch', '_lmAwardStudentId',
  '_lmAwardPoints', '_lmRecitationSeenIds', '_lmKioskMode', '_lmResizeListenerAttached', '_lmOverrideStudentId', '_lmOverrideStatus', '_lmOverrideNote', '_lmRecitationKeyHandler', '_lmScanBuffer',
  '_lmScanInactivityTimer', '_lmWebNfcAbortController', '_lmCycleTimeout', '_lmCycleInterval'];

function reverseTransformCheck() {
  const orig = read('modules/seat-arrangement/live_monitor.js');
  const twin = read('src/modules/seat-arrangement/live_monitor.js');
  const imports = "import { AppStore } from '../core/state-manager.js';\nimport { toast } from '../../dom.js';\nimport { CB_CANVAS_W, CB_CANVAS_H } from './classroom_builder.js';\n";
  assert.strictEqual(orig.split("'use strict';\n").length, 2); assert.strictEqual(twin.split(imports).length, 2);
  const headEnd = twin.indexOf(imports);
  const origHead = orig.slice(0, orig.indexOf("'use strict';\n"));
  assert(twin.slice(0, headEnd).endsWith(origHead) && twin.slice(0, headEnd).includes(origHead), 'twin = new header + the original leading comment block verbatim');
  // remove the accessor block (it is the ONLY inserted code besides the imports)
  const a = twin.indexOf('  // ── Phase 7 (Stream D, file 27): cross-file shared-state ACCESSORS');
  const endMarker = "  ].forEach(([name, get, set]) => Object.defineProperty(window, name, { get, set, enumerable: true, configurable: true }));\n\n";
  const b = twin.indexOf(endMarker);
  assert(a > 0 && b > a, 'accessor block located');
  const block = twin.slice(a, b + endMarker.length);
  for (const n of SHARED) assert(block.includes(`['${n}', () => ${n}, v => { ${n} = v; }],`), 'accessor row for ' + n);
  assert.strictEqual((block.match(/^    \['/gm) || []).length, 23, '23 accessor rows');
  const withoutBlock = twin.slice(0, a) + twin.slice(b + endMarker.length);
  const rebuilt = withoutBlock.slice(headEnd).replace(imports, "'use strict';\n")
    .replace(/^  export const (\w+) = (async )?function /gm, '  window.$1 = $2function ')
    .replace('  export function _lmSubscribeToStore() {', '  function _lmSubscribeToStore() {');
  assert.strictEqual(origHead + rebuilt, orig, 'reversing the swaps + removing the accessor block must reproduce the original byte-for-byte');
  assert.strictEqual((twin.match(/^\s*export /gm) || []).length, 18, 'exactly 18 exports');
}

const STARTER_HTML = `<!doctype html><html><body>
  <div id="a-classroom-monitor" class="active"><div class="lm-seat" data-seat-id="seatA"></div><div class="lm-seat" data-seat-id="seatB"></div><span class="lm-target-count">0</span><button id="lm-coldcall-btn">go</button>
    <input id="lm-override-note" /><input id="lm-award-search" /><button id="lm-override-submit">Save Override</button><button id="lm-award-submit">Award</button></div>
  <div id="toast"></div>
</body></html>`;
const FIXED = 1767225600000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const HELPERS_SCRIPT = `
function __lmSnap() {
  const s = (v) => (v instanceof Set ? { set: [...v] } : (v && typeof v === 'object' ? 'obj' : (typeof v === 'function' ? 'fn' : v)));
  return { ${SHARED.map(n => n + ': s(' + n + ')').join(', ')}, scanMs: LM_SCAN_INACTIVITY_MS };
}
function __lmSet(o) { ${SHARED.map(n => `if ('${n}' in o) ${n} = (o.${n} && o.${n}.__set) ? new Set(o.${n}.__set) : o.${n};`).join(' ')} }
`;

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  win.eval(`(function(){ const R = Date; class D extends R { constructor(...a){ if (a.length) super(...a); else super(${FIXED}); } static now(){ return ${FIXED}; } } globalThis.Date = D; }());`);
  win.eval("globalThis.__rnd = { s: 424242 }; Math.random = function () { __rnd.s = (__rnd.s * 1103515245 + 12345) & 0x7fffffff; return __rnd.s / 0x7fffffff; };");
  win.DEFAULT_DB = { students: [], classSections: [], classroomLayouts: [] };
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };
  win.__rpcCalls = [];
  const mockClient = { auth: { getSession: async () => ({ data: { session: null } }) }, rpc: async (name, params) => { win.__rpcCalls.push({ name, params }); return { data: null, error: null }; } };
  win.SupabaseClient = { getClient: () => mockClient, resolveProvider: () => 'supabase' };
  win.__EDUQUEST_SUPABASE_URL__ = ''; win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };
  win.__calls = [];
  const rec = (name) => (...a) => { win.__calls.push(JSON.stringify([name, ...a.map(x => (x && x.id !== undefined && x.nodeType ? '#' + x.id : (x && typeof x === 'object' && !Array.isArray(x) ? '<obj>' : x)))])); };
  win._lmRender = rec('_lmRender'); win._lmRenderCanvas = rec('_lmRenderCanvas'); win._lmRenderSidebar = rec('_lmRenderSidebar'); win._lmRenderRecitationSidebar = rec('_lmRenderRecitationSidebar');
  win._lmAnimateNewRecitationEntries = rec('_lmAnimateNewRecitationEntries'); win._lmClearCycle = rec('_lmClearCycle');
  win._lmReconcileSessionState = rec('_lmReconcileSessionState'); win._lmStopRecitationSession = rec('_lmStopRecitationSession');
  win.__classIds = ['c1', 'c2'];
  win.getActiveClassIds = state => { win.__calls.push(JSON.stringify(['getActiveClassIds', Array.isArray(state && state.classSections) ? state.classSections.length : null])); return win.__classIds; };
  win.__refresh = 'ok';
  win.refreshClassroomData = () => { win.__calls.push('["refreshClassroomData"]'); return win.__refresh === 'reject' ? Promise.reject(new Error('refresh boom')) : Promise.resolve(); };
  win.__att = { ok: true }; win.__rs = { award: { ok: true }, undo: { ok: true } };
  win.AttendanceService = { overrideAttendance: async (...a) => { win.__calls.push(JSON.stringify(['AttendanceService.overrideAttendance', ...a])); return win.__att; } };
  win.RecitationService = { manualAward: async (...a) => { win.__calls.push(JSON.stringify(['RecitationService.manualAward', ...a])); return win.__rs.award; }, undoRecitation: async id => { win.__calls.push(JSON.stringify(['RecitationService.undoRecitation', id])); return win.__rs.undo; } };
  win.__stubFns = {}; for (const n of ['_lmRender', '_lmRenderCanvas', '_lmRenderSidebar', '_lmRenderRecitationSidebar', '_lmAnimateNewRecitationEntries', '_lmClearCycle', '_lmReconcileSessionState', '_lmStopRecitationSession', 'getActiveClassIds', 'refreshClassroomData', 'AttendanceService', 'RecitationService']) win.__stubFns[n] = win[n];
  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  win.console.warn = (...a) => win.__calls.push(JSON.stringify(['warn', ...a.map(x => (x && x.message) || String(x))]));
  win.console.error = (...a) => win.__calls.push(JSON.stringify(['error', ...a.map(String)]));
  win.addEventListener('error', e => win.__calls.push(JSON.stringify(['window-error', String(e.message)])));
  return { win, logs };
}
function addScript(win, code) { const s = win.document.createElement('script'); s.textContent = code; win.document.head.appendChild(s); }
async function evalOriginal(win) {
  for (const f of ['repository/table-sync.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'db-service.js', 'modules/core/state-manager.js', 'dom.js', 'utils.js']) win.eval(read(f));
  addScript(win, 'const CB_CANVAS_W = 1200, CB_CANVAS_H = 800;');
  addScript(win, read('modules/seat-arrangement/live_monitor.js'));
  addScript(win, HELPERS_SCRIPT);
  await win.AppStore.ready;
}
async function evalBridge(win) {
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'live_monitor-combined-bundle.js'), 'utf8'));
  addScript(win, HELPERS_SCRIPT);
  await win.AppStore.ready;
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

const SECTIONS = [{ id: 'c1' }, { id: 'c2' }];
const LAYOUTS = () => [{ id: 'L1', classId: 'c1' }, { id: 'L2', classId: 'c1' }, { id: 'L3', classId: 'c2' }];
function seed(win, extra) {
  win.AppStore.updateState(d => { d.classSections = SECTIONS.map(s => ({ ...s })); d.classroomLayouts = LAYOUTS(); d.students = []; Object.assign(d, extra || {}); }, { type: 'test:seed' });
}
const snap = win => JSON.parse(win.eval('JSON.stringify(__lmSnap())'));
const setState = (win, o) => win.eval('__lmSet(' + JSON.stringify(o) + ')');
const emit = (win, type) => win.AppStore.updateState(() => {}, { type });
const click = (win, el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));

async function run(win, logs) {
  const out = { steps: [] };
  const step = async (label, fn) => {
    win.__rnd.s = 424242; win.__calls.length = 0;
    let err = null, ret;
    try { ret = await fn(); } catch (e) { err = String(e && e.message); }
    await sleep(15);
    const page = $(win, 'a-classroom-monitor');
    out.steps.push({ label, err, ret, calls: win.__calls.slice(), toast: $(win, 'toast').innerHTML, toastStyle: $(win, 'toast').getAttribute('style'), st: snap(win), kiosk: win.document.body.classList.contains('lm-kiosk-mode'),
      seatA: page.querySelector('[data-seat-id="seatA"]').className, seatB: page.querySelector('[data-seat-id="seatB"]').className, count: page.querySelector('.lm-target-count').textContent,
      btn: $(win, 'lm-coldcall-btn').disabled, ovBtn: [$(win, 'lm-override-submit').disabled, $(win, 'lm-override-submit').textContent], awBtn: [$(win, 'lm-award-submit').disabled, $(win, 'lm-award-submit').textContent],
      ovNote: $(win, 'lm-override-note').value, awSearch: $(win, 'lm-award-search').value, focus: win.document.activeElement && win.document.activeElement.id });
  };
  const fresh = async (label, init, fn) => {
    for (const n in win.__stubFns) win[n] = win.__stubFns[n];
    win.unmountClassroomMonitor(); win.AppStore.unsubscribe('live-monitor');
    win.__classIds = ['c1', 'c2']; win.__refresh = 'ok'; win.__att = { ok: true }; win.__rs = { award: { ok: true }, undo: { ok: true } };
    const page = $(win, 'a-classroom-monitor'); page.className = 'active';
    page.querySelectorAll('.lm-seat').forEach(s => { s.className = 'lm-seat'; }); page.querySelector('.lm-target-count').textContent = '0'; $(win, 'lm-coldcall-btn').disabled = false;
    for (const id of ['lm-override-submit', 'lm-award-submit']) { $(win, id).disabled = false; } $(win, 'lm-override-submit').textContent = 'Save Override'; $(win, 'lm-award-submit').textContent = 'Award';
    $(win, 'lm-override-note').value = ''; $(win, 'lm-award-search').value = ''; win.document.body.classList.remove('lm-kiosk-mode'); $(win, 'toast').innerHTML = ''; $(win, 'toast').removeAttribute('style');
    seed(win);
    setState(win, { _lmClassId: 'default-class', _lmLayoutId: null, _lmStrategy: 'pure_random', _lmTargetedSeatIds: { __set: [] }, _lmKioskMode: false, _lmRecitationMode: false, _lmOverrideStudentId: '', _lmOverrideStatus: 'On Time',
      _lmOverrideNote: '', _lmOverrideExpanded: false, _lmAwardSearch: '', _lmAwardStudentId: null, _lmAwardPoints: 1, _lmRecitationSeenIds: { __set: [] }, _lmSessionStartAt: null });
    if (init) setState(win, init);
    win.__calls.length = 0;
    return step(label, fn);
  };
  const doc = win.document;
  out.surface = { fns: EXPORTS.map(n => [n, typeof win[n]]), style: (doc.getElementById('lm-styles') || {}).textContent, styleCount: doc.querySelectorAll('#lm-styles').length,
    initial: snap(win), shared: SHARED.map(n => [n, typeof win[n]]), scan: typeof win.LM_SCAN_INACTIVITY_MS, loadLogs: logs.filter(l => /live.?monitor/i.test(l)) }; // the twin also evaluates classroom_builder/classroom-service (they log); only this file's own lines are compared (it logs none)

  seed(win);
  // ── 2. renderClassroomMonitor ──
  await fresh('render: no page element logs an error', null, async () => { const p = $(win, 'a-classroom-monitor'); p.id = 'x-mon'; try { win.renderClassroomMonitor(); } finally { p.id = 'a-classroom-monitor'; } });
  await fresh('render: default class + sections loaded -> first class, first layout', null, async () => { win.renderClassroomMonitor(); });
  await fresh('render: default class + NO classIds keeps default-class', null, async () => { win.__classIds = []; win.renderClassroomMonitor(); });
  await fresh('render: current class valid -> kept; its first layout picked', { _lmClassId: 'c2' }, async () => { win.renderClassroomMonitor(); });
  await fresh('render: layout already valid for the class is kept', { _lmClassId: 'c1', _lmLayoutId: 'L2' }, async () => { win.renderClassroomMonitor(); });
  await fresh('render: layout belongs to another class -> replaced', { _lmClassId: 'c1', _lmLayoutId: 'L3' }, async () => { win.renderClassroomMonitor(); });
  await fresh('render: stale class + sections loaded -> reassigned to the first', { _lmClassId: 'gone' }, async () => { win.renderClassroomMonitor(); });
  await fresh('render: stale class + sections NOT loaded -> kept (race guard)', { _lmClassId: 'gone' }, async () => { seed(win, { classSections: [] }); win.renderClassroomMonitor(); });
  await fresh('render: sections slice not an array -> kept (race guard)', { _lmClassId: 'gone' }, async () => { seed(win, { classSections: null }); win.renderClassroomMonitor(); });
  await fresh('render: class with no layouts -> layout null', { _lmClassId: 'c2' }, async () => { seed(win, { classroomLayouts: [{ id: 'L1', classId: 'c1' }] }); win.renderClassroomMonitor(); });
  await fresh('render: classroomLayouts slice missing', { _lmClassId: 'c1' }, async () => { seed(win, { classroomLayouts: null }); win.renderClassroomMonitor(); });
  await fresh('render: refreshClassroomData runs; a rejection only warns', null, async () => { win.__refresh = 'reject'; win.renderClassroomMonitor(); await sleep(20); });
  await fresh('render: refreshClassroomData absent', null, async () => { delete win.refreshClassroomData; win.renderClassroomMonitor(); });
  await fresh('render: mounts and subscribes (an event repaints)', null, async () => { win.renderClassroomMonitor(); win.__calls.length = 0; emit(win, 'classroom:bootstrapped'); });

  // ── 3. unmount / 4. kiosk ──
  await fresh('unmount: clears cycle, targeting, session; unsubscribes', { _lmTargetedSeatIds: { __set: ['seatA'] } }, async () => { win.renderClassroomMonitor(); win.__calls.length = 0; win.unmountClassroomMonitor(); emit(win, 'classroom:bootstrapped'); });
  await fresh('unmount: leaves kiosk mode', { _lmKioskMode: true }, async () => { doc.body.classList.add('lm-kiosk-mode'); win.unmountClassroomMonitor(); });
  await fresh('unmount: twice is safe', null, async () => { win.unmountClassroomMonitor(); win.unmountClassroomMonitor(); });
  await fresh('kiosk: toggle on re-renders', null, async () => { win._lmToggleKioskMode(); });
  await fresh('kiosk: toggle on then off', null, async () => { win._lmToggleKioskMode(); win._lmToggleKioskMode(); });

  // ── 5. subscription ──
  const EVENTS = ['attendance:scan-recorded', 'attendance:override', 'classroom:anything', 'state:remote-sync', 'state:legacy-sync', 'recitation:point-logged', 'recitation:x'];
  for (const type of EVENTS) await fresh('sub: ' + type + ' repaints', null, async () => { win.renderClassroomMonitor(); win.__calls.length = 0; emit(win, type); });
  await fresh('sub: unrelated event does nothing', null, async () => { win.renderClassroomMonitor(); win.__calls.length = 0; emit(win, 'titles:equipped'); });
  await fresh('sub: not mounted -> ignored', null, async () => { win._lmSubscribeToStore(); win.__calls.length = 0; emit(win, 'classroom:x'); });
  await fresh('sub: page inactive -> reconcile only, no render', null, async () => { win.renderClassroomMonitor(); $(win, 'a-classroom-monitor').classList.remove('active'); win.__calls.length = 0; emit(win, 'classroom:x'); });
  await fresh('sub: recitation mode animates new entries after the repaint', { _lmRecitationMode: true }, async () => { win.renderClassroomMonitor(); win.__calls.length = 0; emit(win, 'recitation:point-logged'); });
  await fresh('sub: no page element', null, async () => { win.renderClassroomMonitor(); const p = $(win, 'a-classroom-monitor'); p.id = 'x-mon'; win.__calls.length = 0; try { emit(win, 'classroom:x'); } finally { p.id = 'a-classroom-monitor'; } });
  await fresh('sub: sections event reassigns a class that vanished', { _lmClassId: 'gone' }, async () => { win.renderClassroomMonitor(); setState(win, { _lmClassId: 'gone' }); win.__calls.length = 0; emit(win, 'sections:loaded'); });
  await fresh('sub: sections event with a valid class only repaints', { _lmClassId: 'c2' }, async () => { win.renderClassroomMonitor(); win.__calls.length = 0; emit(win, 'sections:loaded'); });
  await fresh('sub: sections event with an empty first class id falls back to default-class', null, async () => { win.renderClassroomMonitor(); setState(win, { _lmClassId: 'gone' }); win.__classIds = ['']; win.__calls.length = 0; emit(win, 'sections:loaded'); });
  await fresh('sub: sections event with NO class ids leaves the class alone', null, async () => { win.renderClassroomMonitor(); setState(win, { _lmClassId: 'gone' }); win.__classIds = []; win.__calls.length = 0; emit(win, 'sections:loaded'); });
  await fresh('sub: sections event on an inactive page is ignored', null, async () => { win.renderClassroomMonitor(); $(win, 'a-classroom-monitor').classList.remove('active'); win.__calls.length = 0; emit(win, 'sections:loaded'); });
  await fresh('sub: sections event with no page', null, async () => { win.renderClassroomMonitor(); const p = $(win, 'a-classroom-monitor'); p.id = 'x-mon'; win.__calls.length = 0; try { emit(win, 'sections:loaded'); } finally { p.id = 'a-classroom-monitor'; } });
  await fresh('sub: subscribing twice replaces (one repaint per event)', null, async () => { win.renderClassroomMonitor(); win._lmSubscribeToStore(); win.__calls.length = 0; emit(win, 'classroom:x'); return win.__calls.filter(c => c.startsWith('["_lmRender"')).length; });

  // ── 6. class / layout / strategy / seat-target ──
  await fresh('onClassChange: switches class, clears targeting, picks the new first layout', { _lmClassId: 'c1', _lmLayoutId: 'L1', _lmTargetedSeatIds: { __set: ['seatA'] } }, async () => { win._lmOnClassChange('c2'); });
  await fresh('onClassChange: class without layouts -> null layout', null, async () => { seed(win, { classroomLayouts: [] }); win._lmOnClassChange('c2'); });
  await fresh('onClassChange: layouts slice missing', null, async () => { seed(win, { classroomLayouts: null }); win._lmOnClassChange('c1'); });
  await fresh('onLayoutChange: sets the layout, clears targeting, repaints the canvas, enables the button', { _lmTargetedSeatIds: { __set: ['seatA'] } }, async () => { win._lmOnLayoutChange('L2'); });
  await fresh('onLayoutChange: empty id -> null layout disables the button', null, async () => { win._lmOnLayoutChange(''); });
  await fresh('onLayoutChange: spatial_block with nothing targeted disables the button', { _lmStrategy: 'spatial_block' }, async () => { win._lmOnLayoutChange('L1'); });
  await fresh('onLayoutChange: no cold-call button', null, async () => { const b = $(win, 'lm-coldcall-btn'); b.id = 'x'; try { win._lmOnLayoutChange('L1'); } finally { b.id = 'lm-coldcall-btn'; } });
  await fresh('onStrategyChange: stores the strategy, clears targeting, re-renders', { _lmTargetedSeatIds: { __set: ['seatA'] } }, async () => { win._lmOnStrategyChange('spatial_block'); });
  await fresh('toggleSeatTarget: add then remove (class, count, button)', { _lmLayoutId: 'L1', _lmStrategy: 'spatial_block' }, async () => { const r = []; win._lmToggleSeatTarget('seatA'); r.push(snap(win)._lmTargetedSeatIds); win._lmToggleSeatTarget('seatB'); win._lmToggleSeatTarget('seatA'); r.push(snap(win)._lmTargetedSeatIds); return r; });
  await fresh('toggleSeatTarget: pure_random strategy keeps the button enabled', { _lmLayoutId: 'L1' }, async () => { win._lmToggleSeatTarget('seatA'); });
  await fresh('toggleSeatTarget: no layout disables the button', null, async () => { win._lmToggleSeatTarget('seatA'); });
  await fresh('toggleSeatTarget: unknown seat id / missing elements', { _lmLayoutId: 'L1' }, async () => { win._lmToggleSeatTarget('nope'); const c = doc.querySelector('.lm-target-count'); c.className = 'x'; const b = $(win, 'lm-coldcall-btn'); b.id = 'y'; try { win._lmToggleSeatTarget('seatB'); } finally { c.className = 'lm-target-count'; b.id = 'lm-coldcall-btn'; } });

  // ── 7. override + award ──
  await fresh('override: student change stores it and repaints the sidebar', null, async () => { win._lmOnOverrideStudentChange('stu9'); });
  await fresh('override: status change stores it', null, async () => { win._lmOnOverrideStatusChange('Absent'); });
  await fresh('override: note input stores it and restores focus + value', null, async () => { $(win, 'lm-override-note').value = 'hello'; win._lmOnOverrideNoteInput('hello'); });
  await fresh('override: note input without the element', null, async () => { const i = $(win, 'lm-override-note'); i.id = 'x'; try { win._lmOnOverrideNoteInput('n'); } finally { i.id = 'lm-override-note'; } });
  await fresh('override: toggle panel flips and repaints', null, async () => { const r = []; for (let i = 0; i < 3; i++) { win._lmToggleOverridePanel(); r.push(snap(win)._lmOverrideExpanded); } return r; });
  await fresh('override: submit with no student is a no-op', null, async () => { await win._lmSubmitOverride(); });
  await fresh('override: submit ok -> toast, note cleared', { _lmOverrideStudentId: 'stu1', _lmClassId: 'c1', _lmOverrideStatus: 'Late', _lmOverrideNote: 'bus' }, async () => { await win._lmSubmitOverride(); });
  await fresh('override: submit "Remove" shows the removal toast', { _lmOverrideStudentId: 'stu1', _lmOverrideStatus: 'Remove' }, async () => { await win._lmSubmitOverride(); });
  await fresh('override: submit error restores the button and warns', { _lmOverrideStudentId: 'stu1' }, async () => { win.__att = { ok: false, error: 'Nope' }; await win._lmSubmitOverride(); });
  await fresh('override: submit error without a message', { _lmOverrideStudentId: 'stu1' }, async () => { win.__att = { ok: false }; await win._lmSubmitOverride(); });
  await fresh('override: submit without the button', { _lmOverrideStudentId: 'stu1' }, async () => { const b = $(win, 'lm-override-submit'); b.id = 'x'; try { await win._lmSubmitOverride(); } finally { b.id = 'lm-override-submit'; } });
  await fresh('award: search input stores, repaints, restores focus', null, async () => { $(win, 'lm-award-search').value = 'ann'; win._lmOnAwardSearchInput('ann'); });
  await fresh('award: search input without the element', null, async () => { const i = $(win, 'lm-award-search'); i.id = 'x'; try { win._lmOnAwardSearchInput('q'); } finally { i.id = 'lm-award-search'; } });
  await fresh('award: select student from seat (recitation off -> no repaint)', null, async () => { win._lmSelectAwardStudentFromSeat('stu5'); });
  await fresh('award: select student from seat (recitation on -> repaint)', { _lmRecitationMode: true }, async () => { win._lmSelectAwardStudentFromSeat('stu5'); });
  await fresh('award: set points off / on', null, async () => { win._lmSetAwardPoints(3); setState(win, { _lmRecitationMode: true }); win._lmSetAwardPoints(5); });
  await fresh('award: manual award with no student is a no-op', null, async () => { await win._lmSubmitManualAward(); });
  await fresh('award: manual award ok -> toast and the picker resets', { _lmAwardStudentId: 'stu1', _lmClassId: 'c1', _lmAwardPoints: 4 }, async () => { await win._lmSubmitManualAward(); });
  await fresh('award: manual award error restores the button', { _lmAwardStudentId: 'stu1' }, async () => { win.__rs.award = { ok: false, error: 'No coins' }; await win._lmSubmitManualAward(); });
  await fresh('award: manual award without the button', { _lmAwardStudentId: 'stu1' }, async () => { const b = $(win, 'lm-award-submit'); b.id = 'x'; try { await win._lmSubmitManualAward(); } finally { b.id = 'lm-award-submit'; } });
  await fresh('undo: ok toast', null, async () => { await win._lmUndoRecitation('log1'); });
  await fresh('undo: error toast', null, async () => { win.__rs.undo = { ok: false, error: 'Too late' }; await win._lmUndoRecitation('log2'); });

  // ── 8. sibling-style bare reads / writes of the shared state ──
  await fresh('shared state: a sibling-style bare WRITE is seen by the handlers', null, async () => { win.eval("_lmClassId = 'c2'; _lmLayoutId = 'L3'; _lmStrategy = 'spatial_block'; _lmRecitationMode = true;"); win._lmOnLayoutChange('L3'); win._lmSelectAwardStudentFromSeat('sx'); return snap(win); });
  await fresh('shared state: a handler WRITE is seen by a sibling-style bare READ', null, async () => { win._lmOnStrategyChange('late_only'); win._lmOnAwardSearchInput('zz'); win._lmSetAwardPoints(9); win._lmOnOverrideStatusChange('Late'); return win.eval('[_lmStrategy, _lmAwardSearch, _lmAwardPoints, _lmOverrideStatus]'); });
  await fresh('shared state: Sets are shared by identity (clear/add from a sibling)', null, async () => { win.eval("_lmTargetedSeatIds.add('seatA'); _lmTargetedSeatIds.add('seatB');"); win._lmToggleSeatTarget('seatA'); const a = win.eval('[..._lmTargetedSeatIds]'); win.eval("_lmTargetedSeatIds = new Set(['seatX']);"); win._lmOnStrategyChange('x'); return [a, win.eval('[..._lmTargetedSeatIds]')]; });
  await fresh('shared state: handles (timers, controllers, key handler) round-trip', null, async () => { win.eval("_lmCycleInterval = 7; _lmCycleTimeout = 8; _lmRecitationKeyHandler = function () {}; _lmScanInactivityTimer = 9; _lmWebNfcActive = true; _lmWebNfcAbortController = {}; _lmResizeListenerAttached = true; _lmScanBuffer = 'abc';"); return snap(win); });
  await fresh('shared state: EVERY name round-trips a bare write -> bare read (sentinels, Sets by identity)', null, async () => { const r = {}; for (const n of ['_lmRecitationMode', '_lmClassId', '_lmStrategy', '_lmTargetedSeatIds', '_lmSessionStartAt', '_lmLayoutId', '_lmWebNfcActive', '_lmOverrideExpanded', '_lmAwardSearch', '_lmAwardStudentId', '_lmAwardPoints', '_lmRecitationSeenIds', '_lmKioskMode', '_lmResizeListenerAttached', '_lmOverrideStudentId', '_lmOverrideStatus', '_lmOverrideNote', '_lmRecitationKeyHandler', '_lmScanBuffer', '_lmScanInactivityTimer', '_lmWebNfcAbortController', '_lmCycleTimeout', '_lmCycleInterval']) { const isSet = n === '_lmTargetedSeatIds' || n === '_lmRecitationSeenIds'; win.eval(isSet ? n + " = new Set(['" + n + "'])" : n + " = 'SENT-" + n + "'"); r[n] = win.eval(isSet ? '[...' + n + ']' : n); } return r; });
  await fresh('subscription key: unsubscribing the documented key stops the repaints', null, async () => { win.renderClassroomMonitor(); win.AppStore.unsubscribe('live-monitor'); win.__calls.length = 0; emit(win, 'classroom:x'); });
  await fresh('subscription: an update with no event meta does not throw', null, async () => { win.renderClassroomMonitor(); win.__calls.length = 0; win.AppStore.updateState(() => {}); });
  await fresh('shared state: typeof on every shared name from a sibling', null, async () => win.eval('[' + SHARED.map(n => 'typeof ' + n).join(', ') + ']'));
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

  // injectStyles guard: re-evaluating the module must not add a second stylesheet (the classic original cannot even re-parse: its lets are already declared)
  B.win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'live_monitor-combined-bundle.js'), 'utf8'));
  assert.strictEqual(B.win.document.querySelectorAll('#lm-styles').length, 1, 'a second evaluation keeps ONE #lm-styles element');
  // ── independent sanity ──
  const o = clean(oa);
  if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify(o));
  const S = label => { const s = o.steps.find(x => x.label === label); assert(s, 'missing step ' + label); return s; };
  const has = (s, c) => s.calls.includes(c), starts = (s, p) => s.calls.filter(c => c.startsWith(p));
  assert.deepStrictEqual(o.surface.fns.map(e => e[1]), Array(18).fill('function'));
  assert(o.surface.style.includes('width:1200px;height:800px') && o.surface.styleCount === 1 && o.surface.style.includes('width:120px;height:120px'), 'styles injected once with the canvas and seat sizes');
  assert(o.surface.shared.every(e => e[1] !== 'function'), 'shared names are state, not functions'); assert.strictEqual(o.surface.scan, 'number');
  assert(S('render: no page element logs an error').calls.some(c => c.startsWith('["error","[LiveMonitor] #a-classroom-monitor not found')) && S('render: no page element logs an error').calls.length === 1);
  const r2 = S('render: default class + sections loaded -> first class, first layout'); assert(r2.st._lmClassId === 'c1' && r2.st._lmLayoutId === 'L1' && has(r2, '["_lmReconcileSessionState"]') && has(r2, '["_lmRender","#a-classroom-monitor",["c1","c2"],"<obj>"]') && has(r2, '["refreshClassroomData"]'));
  assert.strictEqual(S('render: default class + NO classIds keeps default-class').st._lmClassId, 'default-class');
  const r4 = S('render: current class valid -> kept; its first layout picked'); assert(r4.st._lmClassId === 'c2' && r4.st._lmLayoutId === 'L3');
  assert.strictEqual(S('render: layout already valid for the class is kept').st._lmLayoutId, 'L2'); assert.strictEqual(S('render: layout belongs to another class -> replaced').st._lmLayoutId, 'L1');
  assert.strictEqual(S('render: stale class + sections loaded -> reassigned to the first').st._lmClassId, 'c1');
  assert.strictEqual(S('render: stale class + sections NOT loaded -> kept (race guard)').st._lmClassId, 'gone'); assert.strictEqual(S('render: sections slice not an array -> kept (race guard)').st._lmClassId, 'gone');
  assert.strictEqual(S('render: class with no layouts -> layout null').st._lmLayoutId, null); assert.strictEqual(S('render: classroomLayouts slice missing').st._lmLayoutId, null);
  assert(S('render: refreshClassroomData runs; a rejection only warns').calls.some(c => c.startsWith('["warn","[LiveMonitor] mount-time classroom data refresh failed:"')));
  assert(!has(S('render: refreshClassroomData absent'), '["refreshClassroomData"]') && S('render: refreshClassroomData absent').err === null);
  assert(starts(S('render: mounts and subscribes (an event repaints)'), '["_lmRender"').length === 1);
  const um = S('unmount: clears cycle, targeting, session; unsubscribes'); assert(has(um, '["_lmClearCycle"]') && has(um, '["_lmStopRecitationSession"]') && um.st._lmTargetedSeatIds.set.length === 0 && starts(um, '["_lmRender"').length === 0, 'unsubscribed: no repaint after unmount');
  assert(S('unmount: leaves kiosk mode').kiosk === false && S('unmount: leaves kiosk mode').st._lmKioskMode === false);
  assert(S('kiosk: toggle on re-renders').kiosk === true && has(S('kiosk: toggle on re-renders'), '["_lmRender","#a-classroom-monitor",["c1","c2"],"<obj>"]') && S('kiosk: toggle on then off').kiosk === false);
  for (const type of ['attendance:scan-recorded', 'attendance:override', 'classroom:anything', 'state:remote-sync', 'state:legacy-sync', 'recitation:point-logged', 'recitation:x']) {
    const s = S('sub: ' + type + ' repaints'); assert(s.calls[0] === '["_lmReconcileSessionState"]' && starts(s, '["_lmRender"').length === 1 && !has(s, '["_lmAnimateNewRecitationEntries"]'), type + ': reconcile first, one repaint');
  }
  assert.strictEqual(S('sub: unrelated event does nothing').calls.length, 0); assert.strictEqual(S('sub: not mounted -> ignored').calls.length, 0);
  assert(has(S('sub: page inactive -> reconcile only, no render'), '["_lmReconcileSessionState"]') && starts(S('sub: page inactive -> reconcile only, no render'), '["_lmRender"').length === 0);
  assert(has(S('sub: recitation mode animates new entries after the repaint'), '["_lmAnimateNewRecitationEntries"]'));
  assert.strictEqual(S('sub: no page element').err, null);
  assert.strictEqual(S('sub: sections event reassigns a class that vanished').st._lmClassId, 'c1'); assert.strictEqual(S('sub: sections event with a valid class only repaints').st._lmClassId, 'c2');
  assert.strictEqual(S('sub: sections event with an empty first class id falls back to default-class').st._lmClassId, 'default-class'); assert.strictEqual(S('sub: sections event with NO class ids leaves the class alone').st._lmClassId, 'gone');
  assert.strictEqual(starts(S('sub: sections event on an inactive page is ignored'), '["_lmRender"').length, 0); assert.strictEqual(S('sub: sections event with no page').calls.length, 0);
  assert.strictEqual(S('sub: subscribing twice replaces (one repaint per event)').ret, 1);
  const oc = S('onClassChange: switches class, clears targeting, picks the new first layout'); assert(oc.st._lmClassId === 'c2' && oc.st._lmLayoutId === 'L3' && oc.st._lmTargetedSeatIds.set.length === 0 && has(oc, '["_lmReconcileSessionState"]'));
  assert.strictEqual(S('onClassChange: class without layouts -> null layout').st._lmLayoutId, null);
  const ol = S('onLayoutChange: sets the layout, clears targeting, repaints the canvas, enables the button'); assert(ol.st._lmLayoutId === 'L2' && ol.btn === false && has(ol, '["_lmRenderCanvas"]'));
  assert(S('onLayoutChange: empty id -> null layout disables the button').btn === true && S('onLayoutChange: spatial_block with nothing targeted disables the button').btn === true);
  assert(S('onStrategyChange: stores the strategy, clears targeting, re-renders').st._lmStrategy === 'spatial_block' && S('onStrategyChange: stores the strategy, clears targeting, re-renders').st._lmTargetedSeatIds.set.length === 0);
  { const t = S('toggleSeatTarget: add then remove (class, count, button)'); assert.deepStrictEqual(t.ret[0].set, ['seatA']); assert.deepStrictEqual(t.ret[1].set, ['seatB']); assert(t.seatA === 'lm-seat' && t.seatB === 'lm-seat targeted' && t.count === '1' && t.btn === false); }
  assert(S('toggleSeatTarget: pure_random strategy keeps the button enabled').btn === false && S('toggleSeatTarget: no layout disables the button').btn === true);
  assert.strictEqual(S('toggleSeatTarget: unknown seat id / missing elements').err, null);
  assert(has(S('override: student change stores it and repaints the sidebar'), '["_lmRenderSidebar"]') && S('override: student change stores it and repaints the sidebar').st._lmOverrideStudentId === 'stu9');
  assert.strictEqual(S('override: status change stores it').st._lmOverrideStatus, 'Absent');
  { const n = S('override: note input stores it and restores focus + value'); assert(n.st._lmOverrideNote === 'hello' && n.ovNote === 'hello' && n.focus === 'lm-override-note'); }
  assert.deepStrictEqual(S('override: toggle panel flips and repaints').ret, [true, false, true]);
  assert.strictEqual(S('override: submit with no student is a no-op').calls.length, 0);
  { const s = S('override: submit ok -> toast, note cleared'); assert(has(s, '["AttendanceService.overrideAttendance","stu1","c1","Late",{"notes":"bus"}]') && s.toast.includes('Marked Late') && s.st._lmOverrideNote === '' && s.ovBtn[0] === true, 'override ok'); }
  assert(S('override: submit "Remove" shows the removal toast').toast.includes('Entry removed'));
  { const s = S('override: submit error restores the button and warns'); assert(s.toast.includes('Nope') && s.ovBtn[0] === false && s.ovBtn[1] === 'Save Override'); }
  assert(S('override: submit error without a message').toast.includes('Override failed.')); assert.strictEqual(S('override: submit without the button').err, null);
  { const s = S('award: search input stores, repaints, restores focus'); assert(s.st._lmAwardSearch === 'ann' && s.awSearch === 'ann' && s.focus === 'lm-award-search' && has(s, '["_lmRenderRecitationSidebar"]')); }
  assert(starts(S('award: select student from seat (recitation off -> no repaint)'), '["_lmRenderRecitationSidebar"').length === 0 && starts(S('award: select student from seat (recitation on -> repaint)'), '["_lmRenderRecitationSidebar"').length === 1);
  assert.strictEqual(starts(S('award: set points off / on'), '["_lmRenderRecitationSidebar"').length, 1); assert.strictEqual(S('award: set points off / on').st._lmAwardPoints, 5);
  assert.strictEqual(S('award: manual award with no student is a no-op').calls.length, 0);
  { const s = S('award: manual award ok -> toast and the picker resets'); assert(has(s, '["RecitationService.manualAward","stu1","c1",4,"Manual award"]') && s.toast.includes('+4 pts logged') && s.st._lmAwardStudentId === null); }
  { const s = S('award: manual award error restores the button'); assert(s.toast.includes('No coins') && s.awBtn[0] === false && s.st._lmAwardStudentId === 'stu1'); }
  assert(S('undo: ok toast').toast.includes('undone') && S('undo: error toast').toast.includes('Too late'));
  // shared state, sibling-style
  { const s = S('shared state: a sibling-style bare WRITE is seen by the handlers'); assert(s.ret._lmClassId === 'c2' && s.ret._lmLayoutId === 'L3' && s.ret._lmStrategy === 'spatial_block' && s.ret._lmRecitationMode === true && has(s, '["_lmRenderRecitationSidebar"]') && s.btn === true, 'bare writes land on the live binding'); }
  assert.deepStrictEqual(S('shared state: a handler WRITE is seen by a sibling-style bare READ').ret, ['late_only', 'zz', 9, 'Late']);
  assert.deepStrictEqual(S('shared state: Sets are shared by identity (clear/add from a sibling)').ret, [['seatB'], []]);
  { const s = S('shared state: handles (timers, controllers, key handler) round-trip').ret; assert(s._lmCycleInterval === 7 && s._lmCycleTimeout === 8 && s._lmRecitationKeyHandler === 'fn' && s._lmScanInactivityTimer === 9 && s._lmWebNfcActive === true && s._lmResizeListenerAttached === true && s._lmScanBuffer === 'abc'); }
  { const r = S('shared state: EVERY name round-trips a bare write -> bare read (sentinels, Sets by identity)').ret; for (const [n, v] of Object.entries(r)) assert.deepStrictEqual(v, (n === '_lmTargetedSeatIds' || n === '_lmRecitationSeenIds') ? [n] : 'SENT-' + n, n + ' round trip'); assert.strictEqual(Object.keys(r).length, 23); }
  assert.strictEqual(starts(S('subscription key: unsubscribing the documented key stops the repaints'), '["_lmRender"').length, 0, 'the subscription key is "live-monitor"');
  assert(!S('subscription: an update with no event meta does not throw').calls.some(c => c.startsWith('["window-error"')) && S('subscription: an update with no event meta does not throw').err === null);
  { const i = o.surface.initial; assert(i._lmClassId === 'default-class' && i._lmStrategy === 'pure_random' && i._lmAwardPoints === 1 && i._lmOverrideStatus === 'On Time' && i._lmRecitationMode === false && i._lmSessionStartAt === null && i._lmLayoutId === null && i._lmAwardSearch === '' && i._lmScanBuffer === '' && i._lmOverrideExpanded === false && i._lmKioskMode === false && i._lmWebNfcActive === false && i.scanMs === 120 && JSON.stringify(i._lmTargetedSeatIds) === '{"set":[]}', 'initial state at load'); }
  assert.strictEqual(S('shared state: typeof on every shared name from a sibling').ret.filter(t => t === 'undefined').length, 0, 'every shared name resolves from a sibling');
  assert(!o.steps.some(s => s.calls.some(c => c.startsWith('["window-error"'))), 'no uncaught errors inside timers');
  assert.strictEqual(o.steps.filter(s => s.err).length, 0, 'no unexpected exceptions in any step: ' + o.steps.filter(s => s.err).map(s => s.label + ' => ' + s.err).join(' | '));

  console.log('EQUIVALENCE CHECK PASSED');
  console.log(' - reverse-transform: original rebuilt byte-for-byte from the twin (modulo the accessor block); 18 exports');
  console.log(' - ' + o.steps.length + ' steps compared');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
