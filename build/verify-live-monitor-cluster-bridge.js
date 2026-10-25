// Phase 7 (Stream D) — INTEGRATION check for the converted live-monitor cluster (files 17 + 25 + 27 together).
//
// The per-file checks prove each twin against its original in isolation (with the shared state declared by a classic helper
// script). This one proves the thing that actually matters once live_monitor.js becomes a MODULE: the three real twins, bundled as
// modules, still share ONE state through live_monitor's window accessors. ORIGINAL side: the three classic files loaded as <script>
// elements (shared global lexical lets, as in index.html). BRIDGE side: build/test-helpers/live-monitor-cluster-bundle.js, whose entry
// imports the three REAL production bridges. Same scenarios on both; every step snapshots every shared name BY BARE NAME.
//
// Scenarios: file 25 writes -> file 27 handlers read; file 27 writes -> file 25 reads; file 27's unmount drives file 25's stop which
// drives file 17's stop (a three-module call chain that writes state in each); file 17 (Web NFC) writes active/abort-controller and
// reads recitation mode; Scanner-B keystrokes end to end.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const SHARED = ['_lmRecitationMode', '_lmClassId', '_lmStrategy', '_lmTargetedSeatIds', '_lmSessionStartAt', '_lmLayoutId', '_lmWebNfcActive', '_lmOverrideExpanded', '_lmAwardSearch', '_lmAwardStudentId',
  '_lmAwardPoints', '_lmRecitationSeenIds', '_lmKioskMode', '_lmResizeListenerAttached', '_lmOverrideStudentId', '_lmOverrideStatus', '_lmOverrideNote', '_lmRecitationKeyHandler', '_lmScanBuffer',
  '_lmScanInactivityTimer', '_lmWebNfcAbortController', '_lmCycleTimeout', '_lmCycleInterval'];
const HELPERS = `
function __snap() { const s = (v) => (v instanceof Set ? { set: [...v] } : (v && typeof v === 'object' ? 'obj' : (typeof v === 'function' ? 'fn' : v))); return { ${SHARED.map(n => n + ': s(' + n + ')').join(', ')} }; }
`;
const STARTER = `<!doctype html><html><body><div id="a-classroom-monitor" class="active"></div><div id="toast"></div><button id="lm-webnfc-btn"></button></body></html>`;
const FIXED = 1767225600000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeWindow() {
  const win = new JSDOM(STARTER, { runScripts: 'dangerously', url: 'https://example.org/' }).window;
  win.eval(`(function(){ const R = Date; class D extends R { constructor(...a){ if (a.length) super(...a); else super(${FIXED}); } static now(){ return ${FIXED}; } } globalThis.Date = D; }());`);
  win.DEFAULT_DB = { students: [], classSections: [], classroomLayouts: [] };
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };
  const mockClient = { auth: { getSession: async () => ({ data: { session: null } }) }, rpc: async () => ({ data: null, error: null }) };
  win.SupabaseClient = { getClient: () => mockClient, resolveProvider: () => 'supabase' };
  win.__EDUQUEST_SUPABASE_URL__ = ''; win.__EDUQUEST_SUPABASE_ANON_KEY__ = ''; win.supabase = { createClient() { return {}; } };
  win.__calls = [];
  const rec = n => (...a) => { win.__calls.push(JSON.stringify([n, ...a.map(x => (x && x.nodeType ? '#' + x.id : (x && typeof x === 'object' && !Array.isArray(x) ? '<obj>' : x)))])); };
  for (const n of ['_lmRender', '_lmRenderCanvas', '_lmRenderSidebar', '_lmRenderRecitationSidebar', '_lmAnimateNewRecitationEntries', '_lmClearCycle']) win[n] = rec(n);
  win.getActiveClassIds = () => ['c1', 'c2'];
  win.CB_CANVAS_W = 1200; win.CB_CANVAS_H = 800;
  win.RecitationService = {
    getActiveSession: () => null, startSession: async cid => { win.__calls.push(JSON.stringify(['RS.start', cid])); return { ok: true, session: { startedAt: '2026-01-01T08:00:00.000Z' } }; },
    stopSession: async cid => { win.__calls.push(JSON.stringify(['RS.stop', cid])); return { ok: true }; }, processScannerTap: async (t, c) => { win.__calls.push(JSON.stringify(['RS.tap', t, c])); return { ok: true }; },
  };
  win.AttendanceService = {};
  win.confirm = () => true;
  win.NDEFReader = function () { this.scan = async opts => { win.__calls.push(JSON.stringify(['ndef.scan', !!(opts && opts.signal)])); win.__ndef = this; }; };
  const logs = []; win.console.log = (...a) => logs.push(a.join(' ')); win.console.warn = () => {}; win.console.error = (...a) => win.__calls.push(JSON.stringify(['error', ...a.map(String)]));
  win.addEventListener('error', e => win.__calls.push(JSON.stringify(['window-error', String(e.message)])));
  return win;
}
function addScript(win, code) { const s = win.document.createElement('script'); s.textContent = code; win.document.head.appendChild(s); }
async function loadOriginal(win) {
  for (const f of ['repository/table-sync.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'db-service.js', 'modules/core/state-manager.js', 'dom.js', 'utils.js']) win.eval(read(f));
  addScript(win, 'const CB_CANVAS_W_ = 1; ');
  for (const f of ['modules/seat-arrangement/live_monitor.js', 'modules/seat-arrangement/live-monitor-recitation.js', 'modules/seat-arrangement/live-monitor-webnfc.js']) addScript(win, read(f));
  addScript(win, HELPERS);
  await win.AppStore.ready;
}
async function loadCluster(win) {
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'live-monitor-cluster-bundle.js'), 'utf8'));
  addScript(win, HELPERS);
  await win.AppStore.ready;
}
const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
function firstDiff(a, b, p) {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], p + '.' + k); if (d) return d; }
  return p + ': ' + String(JSON.stringify(a)).slice(0, 160) + '  vs  ' + String(JSON.stringify(b)).slice(0, 160);
}
const key = (win, k) => { win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); };

async function run(win) {
  const out = { steps: [] };
  const snap = () => JSON.parse(win.eval('JSON.stringify(__snap())'));
  const step = async (label, fn) => {
    win.__calls.length = 0; let err = null, ret; try { ret = await fn(); } catch (e) { err = String(e && e.message); }
    await sleep(160);
    out.steps.push({ label, err, ret, calls: win.__calls.slice(), st: snap(), toast: win.document.getElementById('toast').innerHTML });
  };
  win.AppStore.updateState(d => { d.classSections = [{ id: 'c1' }, { id: 'c2' }]; d.classroomLayouts = [{ id: 'L1', classId: 'c1' }, { id: 'L3', classId: 'c2' }]; }, { type: 'test:seed' });
  out.surface = SHARED.map(n => [n, typeof win[n]]);

  await step('25 -> 27: starting a recitation session (file 25 writes) is seen by file 27 handlers (_lmRecitationMode gate)', async () => { win._lmStartRecitationSession('2026-01-01T08:00:00.000Z'); win._lmSelectAwardStudentFromSeat('stuQ'); win._lmSetAwardPoints(4); });
  await step('27 -> 25: file 27 changes class; file 25 submits a scan for THAT class', async () => { win._lmOnClassChange('c2'); await win._lmSubmitScan('TAG-1'); });
  await step('27 -> 25 -> 17: unmount stops the session (25) which stops Web NFC (17); every write lands on the shared bindings', async () => { win._lmStartRecitationSession(); win.eval("_lmWebNfcActive = true; _lmWebNfcAbortController = { abort() {} };"); win.unmountClassroomMonitor(); });
  await step('17: Web NFC toggle on/off round-trips the active flag + abort controller', async () => { win._lmToggleWebNfc(); await sleep(50); const on = win.eval('[_lmWebNfcActive, typeof _lmWebNfcAbortController]'); win._lmToggleWebNfc(); return [on, win.eval('[_lmWebNfcActive, _lmWebNfcAbortController]')]; });
  await step('17 reads 25: a phone tag is submitted only while recitation mode (file 25) is on', async () => { win._lmToggleWebNfc(); await sleep(50); const nd = win.__ndef; nd.onreading({ serialNumber: 'AA:BB' }); win._lmStartRecitationSession(); nd.onreading({ serialNumber: 'CC:DD' }); await sleep(20); win._lmToggleWebNfc(); });
  await step('25 end to end: toggle on via the service, scan by keystrokes + Enter, toggle off', async () => { win._lmOnClassChange('c1'); await win._lmToggleRecitationMode(); key(win, 'X'); key(win, 'Y'); key(win, 'Enter'); await sleep(30); await win._lmToggleRecitationMode(); });
  await step('27 render mounts, reconciles via file 25 and repaints on a store event', async () => { win._lmReconcileSessionState = win._lmReconcileSessionState; win.renderClassroomMonitor(); win.__calls.length = 0; win.AppStore.updateState(() => {}, { type: 'recitation:point-logged' }); win.unmountClassroomMonitor(); });
  await step('shared state: bare writes from any file are seen by every other (round trip)', async () => { win.eval("_lmStrategy = 'spatial_block'; _lmAwardPoints = 7; _lmKioskMode = true; _lmCycleTimeout = 3;"); win._lmToggleSeatTarget('seatZ'); return win.eval('[_lmStrategy, _lmAwardPoints, _lmKioskMode, _lmCycleTimeout, [..._lmTargetedSeatIds]]'); });
  return out;
}

async function main() {
  const A = makeWindow(), B = makeWindow();
  await loadOriginal(A); await loadCluster(B);
  const oa = await run(A), ob = await run(B);
  const fd = firstDiff(clean(oa), clean(ob), 'out');
  assert.strictEqual(fd, null, 'converted cluster must behave exactly like the classic trio — first difference: ' + fd);

  const o = clean(oa);
  const S = l => { const s = o.steps.find(x => x.label.startsWith(l)); assert(s, 'missing ' + l); return s; };
  assert(o.surface.every(e => e[1] !== 'function'), 'shared names are state');
  { const s = S('25 -> 27'); assert(s.st._lmRecitationMode === true && s.st._lmAwardStudentId === 'stuQ' && s.st._lmAwardPoints === 4 && s.calls.filter(c => c.startsWith('["_lmRenderRecitationSidebar"')).length === 2, 'file 27 handlers saw file 25\'s write (mode gate open) and wrote award state'); }
  { const s = S('27 -> 25: file 27 changes class'); assert(s.st._lmClassId === 'c2' && s.calls.includes('["RS.tap","TAG-1","c2"]'), 'file 25 used the class set by file 27'); }
  { const s = S('27 -> 25 -> 17'); assert(s.st._lmRecitationMode === false && s.st._lmWebNfcActive === false && s.st._lmWebNfcAbortController === null && s.st._lmRecitationKeyHandler === null && s.calls.includes('["_lmClearCycle"]'), 'unmount -> stop session -> stop web nfc: all three modules wrote the shared bindings'); }
  { const s = S('17: Web NFC toggle'); assert.deepStrictEqual(s.ret[0], [true, 'object']); assert.deepStrictEqual(s.ret[1], [false, null]); }
  { const s = S('17 reads 25'); const taps = s.calls.filter(c => c.startsWith('["RS.tap"')); assert.deepStrictEqual(taps, ['["RS.tap","CC:DD","c2"]'], 'only the scan while recitation mode was on'); }
  { const s = S('25 end to end'); assert(s.calls.includes('["RS.start","c1"]') && s.calls.includes('["RS.tap","XY","c1"]') && s.calls.includes('["RS.stop","c1"]') && s.st._lmRecitationMode === false); }
  { const s = S('27 render mounts'); assert(s.calls.filter(c => c.startsWith('["_lmRender"')).length === 1, 'one repaint on the store event, none after unmount'); }
  assert.deepStrictEqual(S('shared state: bare writes').ret, ['spatial_block', 7, true, 3, ['seatZ']]);
  assert(!o.steps.some(s => s.calls.some(c => c.startsWith('["window-error"'))), 'no uncaught errors');
  assert.strictEqual(o.steps.filter(s => s.err).length, 0, 'no exceptions: ' + o.steps.filter(s => s.err).map(s => s.label + ' => ' + s.err).join(' | '));
  console.log('CLUSTER INTEGRATION CHECK PASSED');
  console.log(' - ' + o.steps.length + ' steps: the converted modules (17 + 25 + 27) behave exactly like the classic trio');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
