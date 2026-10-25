// Phase 7 (Stream D) — equivalence check for modules/seat-arrangement/live-monitor-recitation.js (file 25/30).
//
// ORIGINAL side: real classic files (repository/*, db-service, state-manager, dom, utils eval'd; the file under test is
// loaded as a real <script> element, like index.html does). BRIDGE side: one esbuild bundle whose entry imports the REAL
// production bridge. Both sides first run a CLASSIC <script> that declares the shared live_monitor.js state as top-level
// `let`/`const` (exactly what live_monitor.js does today), so the original's bare reads/writes AND the twin module's bare
// reads/writes hit the very same global-lexical bindings. Bare siblings stubbed identically: RecitationService (mock, also
// deleted: typeof guard), _lmRender, _lmStopWebNfcCapture, window.getActiveClassIds, confirm.
// document.addEventListener/removeEventListener are spied so the keydown-listener lifecycle is compared too.
//
// Checked: 0 reverse-transform byte identity + 8 exports; 1 surface; 2 _lmReconcileSessionState (all 6 branches);
// 3 _lmToggleRecitationMode (start ok / session-less / error, stop confirmed / declined / error, render args);
// 4 start/stop session state + teardown; 5 Scanner B listener (installed once, guards, Enter, buffering, inactivity
// timer, modifier keys, focus in inputs, stop); 6 _lmSubmitScan / _lmFinalizeScan; 7 an end-to-end keystroke scan.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const EXPORTS = ['_lmReconcileSessionState', '_lmToggleRecitationMode', '_lmStartRecitationSession', '_lmStopRecitationSession', '_lmStartScannerBListener', '_lmStopScannerBListener', '_lmSubmitScan', '_lmFinalizeScan'];

function reverseTransformCheck() {
  const orig = read('modules/seat-arrangement/live-monitor-recitation.js');
  const twin = read('src/modules/seat-arrangement/live-monitor-recitation.js');
  const strict = "'use strict';\n\n  // ── Recitation session lifecycle";
  const imports = "import { AppStore } from '../core/state-manager.js';\nimport { toast } from '../../dom.js';\n\n  // ── Recitation session lifecycle";
  assert.strictEqual(orig.split(strict).length, 2); assert.strictEqual(twin.split(imports).length, 2);
  const headEnd = twin.indexOf("import { AppStore }");
  const body = twin.slice(headEnd).replace(imports, strict);
  const rebuilt = body
    .replace(/^  export (async )?function /gm, '  $1function ')
    .replace('  export const _lmToggleRecitationMode = async function', '  window._lmToggleRecitationMode = async function');
  // the original's own leading comment block precedes 'use strict' in orig; the twin puts its own header first and then the original comment block
  const origStart = orig.indexOf(strict);
  const headerInTwin = twin.slice(0, headEnd);
  assert(headerInTwin.endsWith('\n\n') && headerInTwin.includes(orig.slice(0, origStart)), 'twin = new header + the original leading comment block verbatim');
  assert.strictEqual(headerInTwin.slice(headerInTwin.indexOf(orig.slice(0, origStart))) + rebuilt, orig, 'reversing the keyword swaps must reproduce the original byte-for-byte');
  assert.strictEqual((twin.match(/^\s*export /gm) || []).length, 8, 'exactly 8 exports (= declaresCount 8)');
}

const STARTER_HTML = `<!doctype html><html><body>
  <div id="a-classroom-monitor"></div><div id="toast"></div><input id="ti" /><textarea id="ta"></textarea><select id="se"><option>a</option></select><button id="bt">b</button>
</body></html>`;
const FIXED = 1767225600000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// the shared module state live_monitor.js declares at the top level of its classic script
const SHARED_STATE_SCRIPT = `
let _lmClassId = null, _lmRecitationMode = false, _lmSessionStartAt = null, _lmRecitationSeenIds = new Set(),
    _lmAwardStudentId = 'stuX', _lmAwardSearch = 'q', _lmAwardPoints = 7, _lmStrategy = 'spatial_block',
    _lmTargetedSeatIds = new Set(['s1']), _lmOverrideExpanded = true, _lmRecitationKeyHandler = null,
    _lmScanBuffer = '', _lmScanInactivityTimer = null;
const LM_SCAN_INACTIVITY_MS = 40;
function __lmState() {
  return { classId: _lmClassId, mode: _lmRecitationMode, startAt: _lmSessionStartAt, seen: [..._lmRecitationSeenIds], award: [_lmAwardStudentId, _lmAwardSearch, _lmAwardPoints],
    strategy: _lmStrategy, targeted: [..._lmTargetedSeatIds], override: _lmOverrideExpanded, handler: typeof _lmRecitationKeyHandler, buffer: _lmScanBuffer, timer: _lmScanInactivityTimer === null ? null : 'set' };
}
function __lmSet(o) {
  if ('classId' in o) _lmClassId = o.classId; if ('mode' in o) _lmRecitationMode = o.mode; if ('startAt' in o) _lmSessionStartAt = o.startAt;
  if ('seen' in o) _lmRecitationSeenIds = new Set(o.seen); if ('award' in o) { _lmAwardStudentId = o.award[0]; _lmAwardSearch = o.award[1]; _lmAwardPoints = o.award[2]; }
  if ('strategy' in o) _lmStrategy = o.strategy; if ('targeted' in o) _lmTargetedSeatIds = new Set(o.targeted); if ('override' in o) _lmOverrideExpanded = o.override;
  if ('handler' in o) _lmRecitationKeyHandler = o.handler; if ('buffer' in o) _lmScanBuffer = o.buffer; if ('timer' in o) _lmScanInactivityTimer = o.timer;
}
`;

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  win.eval(`(function(){ const R = Date; class D extends R { constructor(...a){ if (a.length) super(...a); else super(${FIXED}); } static now(){ return ${FIXED}; } } globalThis.Date = D; }());`);
  win.eval("globalThis.__rnd = { s: 424242 }; Math.random = function () { __rnd.s = (__rnd.s * 1103515245 + 12345) & 0x7fffffff; return __rnd.s / 0x7fffffff; };");
  win.DEFAULT_DB = { students: [] };
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };
  win.__rpcCalls = [];
  const mockClient = { auth: { getSession: async () => ({ data: { session: null } }) }, rpc: async (name, params) => { win.__rpcCalls.push({ name, params }); return { data: null, error: null }; } };
  win.SupabaseClient = { getClient: () => mockClient, resolveProvider: () => 'supabase' };
  win.__EDUQUEST_SUPABASE_URL__ = ''; win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };
  win.__calls = [];
  const logCall = (name, ...a) => win.__calls.push(JSON.stringify([name, ...a]));
  // document listener spy with stable handler numbering
  const hid = new Map(); let n = 0; const id = h => { if (!hid.has(h)) hid.set(h, ++n); return hid.get(h); };
  const realAdd = win.document.addEventListener.bind(win.document), realRemove = win.document.removeEventListener.bind(win.document);
  win.document.addEventListener = function (t, h, o) { logCall('doc.add', t, id(h)); return realAdd(t, h, o); };
  win.document.removeEventListener = function (t, h, o) { logCall('doc.remove', t, id(h)); return realRemove(t, h, o); };
  win.__rs = { active: null, start: { ok: true, session: { startedAt: '2026-01-01T10:00:00.000Z' } }, stop: { ok: true }, tap: { ok: true } };
  win.RecitationService = {
    getActiveSession: cid => { logCall('RS.getActiveSession', cid); return win.__rs.active; },
    startSession: async cid => { logCall('RS.startSession', cid); return win.__rs.start; },
    stopSession: async cid => { logCall('RS.stopSession', cid); return win.__rs.stop; },
    processScannerTap: async (tag, cid) => { logCall('RS.processScannerTap', tag, cid); return win.__rs.tap; },
  };
  win.__RS = win.RecitationService;
  win._lmRender = (page, classIds, state) => logCall('_lmRender', page && page.id, classIds, state && Object.keys(state).sort().length > 0);
  win._lmStopWebNfcCapture = () => logCall('_lmStopWebNfcCapture');
  win.getActiveClassIds = state => { logCall('getActiveClassIds', !!state); return ['c1', 'c2']; };
  win.__confirmAnswer = true;
  win.confirm = msg => { logCall('confirm', msg); return win.__confirmAnswer; };
  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  win.console.warn = () => {}; win.console.error = (...a) => logCall('error', ...a.map(String));
  win.addEventListener('error', e => logCall('window-error', String(e.message)));
  return { win, logs };
}
function addScript(win, code) { const s = win.document.createElement('script'); s.textContent = code; win.document.head.appendChild(s); }
async function evalOriginal(win) {
  for (const f of ['repository/table-sync.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'db-service.js', 'modules/core/state-manager.js', 'dom.js', 'utils.js']) win.eval(read(f));
  addScript(win, SHARED_STATE_SCRIPT);
  addScript(win, read('modules/seat-arrangement/live-monitor-recitation.js'));
  await win.AppStore.ready;
}
async function evalBridge(win) {
  addScript(win, SHARED_STATE_SCRIPT);
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'live-monitor-recitation-combined-bundle.js'), 'utf8'));
  await win.AppStore.ready;
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v)); // timestamps are NOT normalised: the clock is pinned, so a wrong start time must show
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
const key = (win, k, extra) => { const e = new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...(extra || {}) }); const r = win.document.dispatchEvent(e); return !e.defaultPrevented && r; };

async function run(win, logs) {
  const out = { steps: [] };
  const state = () => JSON.parse(win.eval('JSON.stringify(__lmState())'));
  const step = async (label, fn) => {
    win.__rnd.s = 424242; win.__calls.length = 0; $(win, 'toast').innerHTML = ''; $(win, 'toast').removeAttribute('style');
    let err = null, ret;
    try { ret = await fn(); } catch (e) { err = String(e && e.message); }
    await sleep(15);
    out.steps.push({ label, err, ret, calls: win.__calls.slice(), toast: $(win, 'toast').innerHTML, toastStyle: $(win, 'toast').getAttribute('style'), st: state() });
  };
  const fresh = async (label, init, fn) => {
    // tear any live listener down through the module under test so steps cannot leak into each other
    if (win.eval("typeof _lmRecitationKeyHandler") !== 'undefined' && win.eval('_lmRecitationKeyHandler')) { win.__lmSet = win.__lmSet; }
    try { win.eval("if (_lmRecitationKeyHandler) document.removeEventListener('keydown', _lmRecitationKeyHandler); clearTimeout(_lmScanInactivityTimer);"); } catch (e) {}
    win.eval("__lmSet({ classId: 'room-7', mode: false, startAt: null, seen: [], award: ['stuX', 'q', 7], strategy: 'spatial_block', targeted: ['s1'], override: true, handler: null, buffer: '', timer: null })");
    if (init) win.eval('__lmSet(' + JSON.stringify(init) + ')');
    win.RecitationService = win.__RS; win.__confirmAnswer = true;
    win.__rs.active = null; win.__rs.start = { ok: true, session: { startedAt: '2026-01-01T10:00:00.000Z' } }; win.__rs.stop = { ok: true }; win.__rs.tap = { ok: true };
    win.document.activeElement && win.document.activeElement.blur && win.document.activeElement.blur();
    return step(label, fn);
  };
  out.surface = { fns: EXPORTS.map(n => [n, typeof win[n]]), loadLogs: logs.slice().sort() };

  // ── 2. reconcile ──
  await fresh('reconcile: no class id', { classId: null }, async () => { win.__rs.active = { startedAt: '2026-01-01T09:00:00.000Z' }; win._lmReconcileSessionState(); });
  await fresh('reconcile: RecitationService absent (typeof guard)', null, async () => { delete win.RecitationService; win._lmReconcileSessionState(); });
  await fresh('reconcile: active session, not in mode -> join with the OTHER device start time', null, async () => { win.__rs.active = { startedAt: '2026-01-01T09:00:00.000Z' }; win._lmReconcileSessionState(); });
  await fresh('reconcile: no session, in mode -> stop', { mode: true, seen: ['a'] }, async () => { win._lmReconcileSessionState(); });
  await fresh('reconcile: session and in mode -> nothing', { mode: true }, async () => { win.__rs.active = { startedAt: 'x' }; win._lmReconcileSessionState(); });
  await fresh('reconcile: no session, not in mode -> nothing', null, async () => { win._lmReconcileSessionState(); });
  await fresh('reconcile: session without startedAt falls back to now', null, async () => { win.__rs.active = {}; win._lmReconcileSessionState(); });

  // ── 3. toggle ──
  await fresh('toggle: start ok joins the authoritative start time and re-renders', null, async () => { await win._lmToggleRecitationMode(); });
  await fresh('toggle: start ok without a session object -> own timestamp', null, async () => { win.__rs.start = { ok: true }; await win._lmToggleRecitationMode(); });
  await fresh('toggle: start fails -> warning toast, nothing started', null, async () => { win.__rs.start = { ok: false, error: 'boom' }; await win._lmToggleRecitationMode(); });
  await fresh('toggle: stop declined at the confirm', { mode: true }, async () => { win.__confirmAnswer = false; await win._lmToggleRecitationMode(); });
  await fresh('toggle: stop confirmed -> service stop, local teardown, re-render', { mode: true, seen: ['a', 'b'] }, async () => { await win._lmToggleRecitationMode(); });
  await fresh('toggle: stop fails -> warning toast, stays in mode', { mode: true }, async () => { win.__rs.stop = { ok: false, error: 'nope' }; await win._lmToggleRecitationMode(); });
  await fresh('toggle: twice (start then stop)', null, async () => { await win._lmToggleRecitationMode(); await win._lmToggleRecitationMode(); });

  // ── 4. start / stop session ──
  await fresh('start session: with an ISO start, resets award + seen, installs the listener, toasts', { seen: ['old'] }, async () => { win._lmStartRecitationSession('2026-01-01T08:00:00.000Z'); });
  await fresh('start session: without a start time uses now', null, async () => { win._lmStartRecitationSession(); });
  await fresh('start session: empty-string start time falls back to now', null, async () => { win._lmStartRecitationSession(''); });
  await fresh('stop session: not in mode is a safe no-op', null, async () => { win._lmStopRecitationSession(); });
  await fresh('stop session: full teardown (listener, webnfc, state, cold-call reset)', null, async () => { win._lmStartRecitationSession('2026-01-01T08:00:00.000Z'); win.eval("_lmRecitationSeenIds.add('x'); _lmStrategy = 'spatial_block'; _lmTargetedSeatIds.add('s2'); _lmOverrideExpanded = true;"); win.__calls.length = 0; win._lmStopRecitationSession(); });
  await fresh('stop session twice', null, async () => { win._lmStartRecitationSession(); win._lmStopRecitationSession(); win._lmStopRecitationSession(); });

  // ── 5. scanner B listener ──
  await fresh('listener: start installs one keydown handler and resets the buffer', { buffer: 'junk' }, async () => { win._lmStartScannerBListener(); });
  await fresh('listener: already listening -> second start is a no-op (same handler)', null, async () => { win._lmStartScannerBListener(); win.__calls.length = 0; win.eval("__lmSet({ buffer: 'keep' })"); win._lmStartScannerBListener(); });
  await fresh('listener: keys are ignored when not in recitation mode', null, async () => { win._lmStartScannerBListener(); key(win, 'A'); key(win, 'Enter'); });
  await fresh('listener: characters buffer and the inactivity timer submits the scan', { mode: true }, async () => { win._lmStartScannerBListener(); key(win, 'A'); key(win, 'B'); key(win, '1'); await sleep(120); });
  await fresh('listener: typing within the window keeps resetting the timer (no early submit)', { mode: true }, async () => { win._lmStartScannerBListener(); key(win, 'X'); await sleep(25); key(win, 'Y'); await sleep(25); const early = win.__calls.filter(c => c.startsWith('["RS.processScannerTap"')).length; await sleep(100); return early; });
  await fresh('listener: Enter finalizes immediately and is default-prevented', { mode: true }, async () => { win._lmStartScannerBListener(); key(win, 'Q'); key(win, 'R'); const notPrevented = key(win, 'Enter'); await sleep(10); return notPrevented; });
  await fresh('listener: Enter with an empty buffer submits nothing', { mode: true }, async () => { win._lmStartScannerBListener(); key(win, 'Enter'); await sleep(10); });
  await fresh('listener: modifier/navigation keys never enter the buffer', { mode: true }, async () => { win._lmStartScannerBListener(); for (const k of ['Shift', 'Tab', 'ArrowLeft', 'Escape', 'F5', 'Backspace']) key(win, k); const b = win.eval('_lmScanBuffer'); key(win, 'Z'); return [b, win.eval('_lmScanBuffer')]; });
  for (const tag of ['ti', 'ta', 'se']) {
    await fresh('listener: focus inside #' + tag + ' swallows nothing (keys ignored)', { mode: true }, async () => { win._lmStartScannerBListener(); $(win, tag).focus(); key(win, 'M'); const b = win.eval('_lmScanBuffer'); const prevented = !key(win, 'Enter'); $(win, tag).blur(); return [b, prevented]; });
  }
  await fresh('listener: focus on a button does NOT block scanning', { mode: true }, async () => { win._lmStartScannerBListener(); $(win, 'bt').focus(); key(win, 'N'); const b = win.eval('_lmScanBuffer'); $(win, 'bt').blur(); return b; });
  await fresh('stop listener: removes the handler, clears timer and buffer', { mode: true }, async () => { win._lmStartScannerBListener(); key(win, 'K'); win._lmStopScannerBListener(); key(win, 'L'); await sleep(100); });
  await fresh('stop listener: when never started', null, async () => { win._lmStopScannerBListener(); win._lmStopScannerBListener(); });

  // ── 6. submit / finalize ──
  await fresh('submit: empty tag is ignored', null, async () => { await win._lmSubmitScan(''); await win._lmSubmitScan(null); await win._lmSubmitScan(undefined); });
  await fresh('submit: ok passes the tag and the class id', null, async () => { await win._lmSubmitScan('TAG-1'); });
  await fresh('submit: cooldown message', null, async () => { win.__rs.tap = { ok: false, cooldown: true }; await win._lmSubmitScan('TAG-2'); });
  await fresh('submit: error message', null, async () => { win.__rs.tap = { ok: false, error: 'Unknown card' }; await win._lmSubmitScan('TAG-3'); });
  await fresh('submit: error with cooldown false', null, async () => { win.__rs.tap = { ok: false, cooldown: false, error: 'E' }; await win._lmSubmitScan('TAG-4'); });
  await fresh('finalize: trims the buffer, clears it and submits', { buffer: '  ABC123 \n' }, async () => { await win._lmFinalizeScan(); });
  await fresh('finalize: empty/whitespace buffer submits nothing', { buffer: '   ' }, async () => { await win._lmFinalizeScan(); });
  await fresh('finalize: clears a pending inactivity timer', { buffer: 'T', mode: true }, async () => { win._lmStartScannerBListener(); key(win, 'P'); await win._lmFinalizeScan(); await sleep(100); });

  // ── 7. end to end ──
  await fresh('e2e: toggle on, scan by keystrokes + Enter, toggle off (confirmed)', null, async () => { await win._lmToggleRecitationMode(); key(win, 'C'); key(win, 'D'); key(win, 'Enter'); await sleep(20); await win._lmToggleRecitationMode(); });
  await fresh('e2e: wedge scan finalizes by timeout after the session started via reconcile', null, async () => { win.__rs.active = { startedAt: '2026-01-01T09:00:00.000Z' }; win._lmReconcileSessionState(); key(win, 'E'); key(win, 'F'); await sleep(120); win.__rs.active = null; win._lmReconcileSessionState(); });
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

  // ── independent sanity ──
  const o = clean(oa);
  const S = label => { const s = o.steps.find(x => x.label === label); assert(s, 'missing step ' + label); return s; };
  const taps = s => s.calls.filter(c => c.startsWith('["RS.processScannerTap"'));
  assert.deepStrictEqual(o.surface.fns.map(e => e[1]), Array(8).fill('function'));
  assert(S('reconcile: no class id').calls.length === 0 && S('reconcile: no class id').st.mode === false, 'no class id: nothing');
  assert(S('reconcile: RecitationService absent (typeof guard)').err === null && S('reconcile: RecitationService absent (typeof guard)').calls.length === 0);
  const j = S('reconcile: active session, not in mode -> join with the OTHER device start time'); assert(j.st.mode === true && j.st.startAt === '2026-01-01T09:00:00.000Z' && j.calls.some(c => c.startsWith('["doc.add","keydown"')) && j.toast.includes('Recitation session started'), 'join: mode on, listener, toast');
  assert(S('reconcile: session without startedAt falls back to now').st.startAt === '2026-01-01T00:00:00.000Z' && !S('reconcile: session without startedAt falls back to now').err);
  const st = S('reconcile: no session, in mode -> stop'); assert(st.st.mode === false && st.st.seen.length === 0 && st.calls.includes('["_lmStopWebNfcCapture"]') && st.st.strategy === 'pure_random' && st.st.targeted.length === 0 && st.st.override === false && st.st.startAt === null, 'stop teardown');
  assert(S('reconcile: session and in mode -> nothing').st.mode === true && !S('reconcile: session and in mode -> nothing').calls.some(c => c.startsWith('["doc.')));
  assert(S('reconcile: no session, not in mode -> nothing').calls.length === 1, 'only the getActiveSession lookup');
  const t1 = S('toggle: start ok joins the authoritative start time and re-renders'); assert(t1.st.mode && t1.calls.includes('["RS.startSession","room-7"]') && t1.calls.includes('["_lmRender","a-classroom-monitor",["c1","c2"],true]') && t1.st.startAt === '2026-01-01T10:00:00.000Z');
  assert(S('toggle: start ok without a session object -> own timestamp').st.startAt === '2026-01-01T00:00:00.000Z', 'own timestamp = the pinned now');
  assert(S('start session: with an ISO start, resets award + seen, installs the listener, toasts').toastStyle.includes('rgb(78, 222, 163)') || S('start session: with an ISO start, resets award + seen, installs the listener, toasts').toastStyle.includes('#4edea3'), 'start toast is green');
  assert(S('submit: error message').toastStyle.includes('255, 185, 95') || S('submit: error message').toastStyle.includes('#ffb95f'), 'warning toast colour');
  const t3 = S('toggle: start fails -> warning toast, nothing started'); assert(t3.st.mode === false && t3.toast.includes('boom') && !t3.calls.some(c => c.startsWith('["_lmRender"')));
  const t4 = S('toggle: stop declined at the confirm'); assert(t4.st.mode === true && t4.calls.length === 1 && t4.calls[0].startsWith('["confirm"') && t4.calls[0].includes('End this recitation session?'));
  const t5 = S('toggle: stop confirmed -> service stop, local teardown, re-render'); assert(t5.st.mode === false && t5.calls.includes('["RS.stopSession","room-7"]') && t5.calls.some(c => c.startsWith('["_lmRender"')) && t5.st.seen.length === 0);
  const t6 = S('toggle: stop fails -> warning toast, stays in mode'); assert(t6.st.mode === true && t6.toast.includes('nope') && !t6.calls.some(c => c.startsWith('["_lmRender"')));
  assert.strictEqual(S('toggle: twice (start then stop)').st.mode, false);
  const ss = S('start session: with an ISO start, resets award + seen, installs the listener, toasts'); assert(ss.st.mode && ss.st.startAt === '2026-01-01T08:00:00.000Z' && ss.st.seen.length === 0 && JSON.stringify(ss.st.award) === '[null,"",1]' && ss.st.handler === 'function' && ss.toast.includes('started'));
  assert(S('start session: without a start time uses now').st.startAt === '2026-01-01T00:00:00.000Z' && S('start session: empty-string start time falls back to now').st.startAt === '2026-01-01T00:00:00.000Z');
  assert(S('stop session: not in mode is a safe no-op').calls.length === 0);
  const sf = S('stop session: full teardown (listener, webnfc, state, cold-call reset)'); assert(sf.calls.join('|').includes('doc.remove') && sf.calls.includes('["_lmStopWebNfcCapture"]') && sf.st.seen.length === 0 && sf.st.targeted.length === 0 && sf.st.strategy === 'pure_random' && sf.st.override === false && sf.st.handler === 'object' && sf.st.mode === false, 'teardown');
  const l1 = S('listener: start installs one keydown handler and resets the buffer'); assert(l1.st.handler === 'function' && l1.st.buffer === '' && l1.calls.filter(c => c.startsWith('["doc.add"')).length === 1);
  const l2 = S('listener: already listening -> second start is a no-op (same handler)'); assert(l2.calls.length === 0 && l2.st.buffer === 'keep');
  assert(taps(S('listener: keys are ignored when not in recitation mode')).length === 0 && S('listener: keys are ignored when not in recitation mode').st.buffer === '');
  const l3 = S('listener: characters buffer and the inactivity timer submits the scan'); assert(taps(l3).length === 1 && taps(l3)[0] === '["RS.processScannerTap","AB1","room-7"]' && l3.st.buffer === '');
  assert.strictEqual(S('listener: typing within the window keeps resetting the timer (no early submit)').ret, 0); assert(taps(S('listener: typing within the window keeps resetting the timer (no early submit)')).length === 1);
  const l4 = S('listener: Enter finalizes immediately and is default-prevented'); assert(l4.ret === false && taps(l4)[0] === '["RS.processScannerTap","QR","room-7"]');
  assert(taps(S('listener: Enter with an empty buffer submits nothing')).length === 0);
  assert.deepStrictEqual(S('listener: modifier/navigation keys never enter the buffer').ret, ['', 'Z']);
  for (const tag of ['ti', 'ta', 'se']) { const r = S('listener: focus inside #' + tag + ' swallows nothing (keys ignored)'); assert.deepStrictEqual(r.ret, ['', false]); assert(taps(r).length === 0); }
  assert.strictEqual(S('listener: focus on a button does NOT block scanning').ret, 'N');
  const sl = S('stop listener: removes the handler, clears timer and buffer'); assert(sl.calls.some(c => c.startsWith('["doc.remove"')) && taps(sl).length === 0 && sl.st.handler === 'object' && sl.st.buffer === '' && sl.st.timer === null);
  assert(S('stop listener: when never started').err === null && S('stop listener: when never started').calls.length === 0);
  assert(taps(S('submit: empty tag is ignored')).length === 0 && taps(S('submit: ok passes the tag and the class id'))[0] === '["RS.processScannerTap","TAG-1","room-7"]');
  assert(S('submit: cooldown message').toast.includes('just scanned') && S('submit: error message').toast.includes('Unknown card') && S('submit: error with cooldown false').toast.includes('E'));
  assert(taps(S('finalize: trims the buffer, clears it and submits'))[0] === '["RS.processScannerTap","ABC123","room-7"]' && S('finalize: trims the buffer, clears it and submits').st.buffer === '');
  assert(taps(S('finalize: empty/whitespace buffer submits nothing')).length === 0);
  assert.strictEqual(taps(S('finalize: clears a pending inactivity timer')).length, 1);
  const e1 = S('e2e: toggle on, scan by keystrokes + Enter, toggle off (confirmed)'); assert(taps(e1)[0] === '["RS.processScannerTap","CD","room-7"]' && e1.st.mode === false);
  const e2 = S('e2e: wedge scan finalizes by timeout after the session started via reconcile'); assert(taps(e2)[0] === '["RS.processScannerTap","EF","room-7"]' && e2.st.mode === false);
  assert(!o.steps.some(s => s.calls.some(c => c.startsWith('["window-error"'))), 'no uncaught errors inside timers');
  assert.strictEqual(o.steps.filter(s => s.err).length, 0, 'no unexpected exceptions in any step: ' + o.steps.filter(s => s.err).map(s => s.label + ' => ' + s.err).join(' | '));

  console.log('EQUIVALENCE CHECK PASSED');
  console.log(' - reverse-transform: original rebuilt byte-for-byte from the twin; 8 exports');
  console.log(' - ' + o.steps.length + ' steps compared');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
