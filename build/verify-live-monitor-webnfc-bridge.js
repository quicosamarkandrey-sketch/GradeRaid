// Phase 7 (Stream D) — equivalence check for modules/seat-arrangement/live-monitor-webnfc.js.
//
// The shared live_monitor.js state this file reads AND writes by bare name (_lmRecitationMode,
// _lmWebNfcActive, _lmWebNfcAbortController) is declared by a classic <script> element on BOTH sides —
// i.e. in the real global lexical environment, exactly as in the browser — and the file under test is
// then run as a <script> element too (original: the classic file; bridge: the esbuild bundle of the
// REAL production bridge + twin). That is deliberate: `win.eval` gives each call its own `let` scope
// and would NOT model the cross-file sharing this file depends on. A __peek() declared in the same
// state script reads the true bindings after every step.
// Stubbed identically on both sides: NDEFReader (scripted scan / failure, records instances + signals),
// _lmSubmitScan (recorder; the cyclic recitation partner is file 23), _rfidNormalizeTagId (present /
// absent — its typeof guard is behavior). dom.js's real toast writes #toast (classic on the original
// side, bundled import on the bridge side).
// Checked: 0 reverse-transform byte-identity + 5 exports + verbatim trailing window block; 1 window surface;
// 2 support detection; 3 button refresh (absent / off / on); 4 start (unsupported, success + every ndef
// handler branch, failures with message / bare string / null); 5 stop (with/without controller, aborts the
// signal); 6 toggle both directions. Disclosed: fn.name of _lmToggleWebNfc differs ('' vs inferred) because
// the original assigns an anonymous function to a window property — not compared; nothing reads it.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function reverseTransformCheck() {
  const orig = read('modules/seat-arrangement/live-monitor-webnfc.js');
  const twin = read('src/modules/seat-arrangement/live-monitor-webnfc.js');
  const startMarker = '// ─────────────────────────────────────────────────────────────────────────────\n// LIVE MONITOR — phone-as-NFC-reader (Web NFC)';
  assert.strictEqual(orig.split(startMarker).length, 2);
  assert(orig.startsWith(startMarker), 'original starts at its own header');
  const body = twin.slice(twin.indexOf(startMarker));
  assert(twin.indexOf(startMarker) > 0, 'twin has its own header before the original one');
  const rebuilt = body
    .replace("import { toast } from '../../dom.js';\n\n\n", "'use strict';\n\n\n")
    .replace(/^( *)export const (\w+) = function/gm, '$1window.$2 = function')
    .replace(/^( *)export (async function|function) /gm, '$1$2 ');
  assert.strictEqual(rebuilt, orig, 'reversing the edits must reproduce the original byte-for-byte');
  assert.strictEqual((twin.match(/^\s*export /gm) || []).length, 5, 'exactly 5 exports (declaresCount 5)');
  assert.strictEqual((twin.match(/^window\.\w+ = \w+;$/gm) || []).length, 2, 'original 2-line trailing window block kept verbatim');
}

const STARTER_HTML = `<!doctype html><html><body>
  <button id="lm-webnfc-toggle" class="lm-btn">x</button>
  <div id="toast"></div>
</body></html>`;
const STATE_SCRIPT = `
let _lmRecitationMode = false;
let _lmWebNfcActive = false;
let _lmWebNfcAbortController = null;
window.__peek = () => ({ rec: _lmRecitationMode, active: _lmWebNfcActive, hasCtl: _lmWebNfcAbortController !== null,
  aborted: _lmWebNfcAbortController ? _lmWebNfcAbortController.signal.aborted : null });
window.__setRec = v => { _lmRecitationMode = v; };
window.__setActive = v => { _lmWebNfcActive = v; };
window.__setCtl = c => { _lmWebNfcAbortController = c; };
`;

function runScript(win, code) {
  const s = win.document.createElement('script');
  s.textContent = code;
  win.document.body.appendChild(s);
  if (win.__scriptErrors.length) throw new Error('script error: ' + win.__scriptErrors.splice(0).join(' | '));
}
function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  win.__scriptErrors = [];
  win.addEventListener('error', e => win.__scriptErrors.push(e.message));
  win.__calls = []; win.__ndefs = []; win.__signals = []; win.__scan = 'ok';
  win.NDEFReader = class {
    constructor() { win.__ndefs.push(this); win.__calls.push('new NDEFReader'); }
    async scan(opts) {
      win.__calls.push('scan signal=' + (opts && opts.signal ? 'yes' : 'no'));
      win.__signals.push(opts && opts.signal);
      if (win.__scan === 'msg') throw new Error('boom');
      if (win.__scan === 'noMessage') throw { code: 7 };
      if (win.__scan === 'string') throw 'plain failure';
      if (win.__scan === 'null') throw null;
    }
  };
  win._lmSubmitScan = tag => { win.__calls.push('_lmSubmitScan ' + JSON.stringify(tag)); };
  win._rfidNormalizeTagId = id => 'N:' + String(id).toUpperCase();
  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  return { win, logs };
}
async function evalOriginal(win) {
  runScript(win, STATE_SCRIPT);
  runScript(win, read('dom.js'));
  runScript(win, read('modules/seat-arrangement/live-monitor-webnfc.js'));
}
async function evalBridge(win) {
  runScript(win, STATE_SCRIPT);
  runScript(win, fs.readFileSync(path.join(__dirname, 'test-helpers', 'live-monitor-webnfc-combined-bundle.js'), 'utf8'));
}

const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const $ = (win, id) => win.document.getElementById(id);

async function run(win, logs) {
  const out = { steps: [] };
  const toastEl = () => $(win, 'toast');
  const btnSnap = () => { const b = $(win, 'lm-webnfc-toggle'); return b && { cls: b.className, text: b.textContent, title: b.title }; };
  const step = async (label, fn) => {
    toastEl().innerHTML = ''; toastEl().style.display = ''; win.__calls.length = 0;
    let err = null, ret;
    try { ret = await fn(); } catch (e) { err = String(e && e.message); }
    await tick();
    out.steps.push({ label, err, ret, calls: win.__calls.slice(), toast: toastEl().innerHTML, peek: JSON.parse(JSON.stringify(win.__peek())), btn: btnSnap() });
  };
  const NAMES = ['_lmWebNfcSupported', '_lmToggleWebNfc', '_lmStartWebNfcCapture', '_lmStopWebNfcCapture', '_lmRefreshWebNfcButton'];
  out.surface = { fns: NAMES.map(n => [n, typeof win[n]]), keys: Object.keys(win).filter(k => k.startsWith('_lm')).sort(), loadLogs: logs.slice() };

  // 2. support detection
  await step('supported: NDEFReader present', () => win._lmWebNfcSupported());
  const NDEF = win.NDEFReader; delete win.NDEFReader;
  await step('supported: NDEFReader absent', () => win._lmWebNfcSupported());
  await step('start: unsupported returns silently', () => win._lmStartWebNfcCapture());
  win.NDEFReader = NDEF;

  // 3. button refresh
  const btn = $(win, 'lm-webnfc-toggle'); btn.remove();
  await step('refresh: no button', () => win._lmRefreshWebNfcButton());
  win.document.body.insertBefore(btn, win.document.body.firstChild);
  await step('refresh: inactive', () => win._lmRefreshWebNfcButton());
  win.__setActive(true);
  await step('refresh: active', () => win._lmRefreshWebNfcButton());
  win.__setActive(false);

  // 4. start
  await step('start: success arms reader', () => win._lmStartWebNfcCapture());
  const ndef = win.__ndefs[win.__ndefs.length - 1];
  await step('reading: recitation mode off -> ignored', () => { win.__setRec(false); ndef.onreading({ serialNumber: 'ab12' }); });
  await step('reading: recitation on, no serial -> ignored', () => { win.__setRec(true); ndef.onreading({}); ndef.onreading({ serialNumber: '' }); });
  await step('reading: normalized via _rfidNormalizeTagId', () => ndef.onreading({ serialNumber: 'ab:12' }));
  const norm = win._rfidNormalizeTagId; win._rfidNormalizeTagId = undefined;
  await step('reading: raw id when normalizer absent', () => ndef.onreading({ serialNumber: 'ab:12' }));
  win._rfidNormalizeTagId = 'not a function';
  await step('reading: raw id when normalizer is not a function', () => ndef.onreading({ serialNumber: 'cd34' }));
  win._rfidNormalizeTagId = norm;
  await step('readingerror: warning toast', () => ndef.onreadingerror());
  win.__setRec(false);
  // stop disarms and aborts the signal handed to scan()
  await step('stop: aborts + clears controller', () => { const sig = win.__signals[win.__signals.length - 1]; win._lmStopWebNfcCapture(); return sig.aborted; });
  await step('stop: nothing armed (no controller)', () => win._lmStopWebNfcCapture());

  // failures
  win.__scan = 'msg';
  await step('start: scan throws Error(message)', () => win._lmStartWebNfcCapture());
  win.__scan = 'noMessage';
  await step('start: scan throws object without message', () => win._lmStartWebNfcCapture());
  win.__scan = 'string';
  await step('start: scan throws a string', () => win._lmStartWebNfcCapture());
  win.__scan = 'null';
  await step('start: scan throws null', () => win._lmStartWebNfcCapture());
  win.__scan = 'ok';

  // 6. toggle
  await step('toggle: inactive -> start', () => win._lmToggleWebNfc());
  await step('toggle: active -> stop', () => { const sig = win.__signals[win.__signals.length - 1]; win._lmToggleWebNfc(); return sig.aborted; });
  await step('stop with active flag but no controller', () => { win.__setActive(true); win._lmStopWebNfcCapture(); });
  await step('start twice replaces the controller', async () => { await win._lmStartWebNfcCapture(); const first = win.__signals[win.__signals.length - 1]; await win._lmStartWebNfcCapture(); return [first.aborted, win.__signals[win.__signals.length - 1] === first]; });
  await step('final stop', () => win._lmStopWebNfcCapture());
  return out;
}

function firstDiff(a, b, p) {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], p + '.' + k); if (d) return d; }
  }
  const t = v => { const j = JSON.stringify(v); return j === undefined ? 'undefined' : j; };
  let i = 0; const sa = t(a), sb = t(b); while (i < sa.length && sa[i] === sb[i]) i++;
  return p + '\n  original: ...' + sa.slice(Math.max(0, i - 80), i + 200) + '\n  bridge:   ...' + sb.slice(Math.max(0, i - 80), i + 200);
}

async function main() {
  reverseTransformCheck();
  const A = makeWindow(), B = makeWindow();
  await evalOriginal(A.win);
  await evalBridge(B.win);
  if (process.env.V17_TRACE) console.error('loaded');
  const oa = await run(A.win, A.logs);
  const ob = await run(B.win, B.logs);
  const fd = firstDiff(JSON.parse(JSON.stringify(oa)), JSON.parse(JSON.stringify(ob)), 'out');
  assert.strictEqual(fd, null, 'bridge output must exactly match the original at every step — first difference at: ' + fd);

  // ── independent sanity (guards against a vacuous both-sides-wrong pass) ──
  const o = JSON.parse(JSON.stringify(oa));
  const S = label => { const s = o.steps.find(x => x.label === label); assert(s, 'missing step ' + label); return s; };
  assert.deepStrictEqual(o.surface.fns.map(e => e[1]), Array(5).fill('function'));
  assert.deepStrictEqual(o.surface.keys, ['_lmRefreshWebNfcButton', '_lmStartWebNfcCapture', '_lmStopWebNfcCapture', '_lmSubmitScan', '_lmToggleWebNfc', '_lmWebNfcSupported'], 'window surface: the 5 exports + the harness _lmSubmitScan stub, nothing else');
  assert.strictEqual(S('supported: NDEFReader present').ret, true); assert.strictEqual(S('supported: NDEFReader absent').ret, false);
  assert.deepStrictEqual(S('start: unsupported returns silently').calls, []); assert.strictEqual(S('start: unsupported returns silently').peek.active, false);
  assert.deepStrictEqual(S('refresh: inactive').btn, { cls: 'lm-btn', text: '📱 Use This Phone as Reader', title: 'Use this phone as an NFC reader — tap to arm, then hold cards to the back of the phone' });
  assert.deepStrictEqual(S('refresh: active').btn, { cls: 'lm-btn active', text: '📱 NFC On — Roaming', title: 'Stop using this phone as an NFC reader' });
  assert.strictEqual(S('refresh: no button').btn, null);
  const ok = S('start: success arms reader');
  assert.deepStrictEqual(ok.calls, ['new NDEFReader', 'scan signal=yes']); assert.strictEqual(ok.peek.active, true); assert.strictEqual(ok.peek.hasCtl, true);
  assert(ok.toast.includes('Phone NFC reader armed') && ok.btn.cls.includes('active') && ok.btn.text.includes('NFC On'), 'start toast + button refresh');
  assert.deepStrictEqual(S('reading: recitation mode off -> ignored').calls, []);
  assert.deepStrictEqual(S('reading: recitation on, no serial -> ignored').calls, []);
  assert.deepStrictEqual(S('reading: normalized via _rfidNormalizeTagId').calls, ['_lmSubmitScan "N:AB:12"']);
  assert.deepStrictEqual(S('reading: raw id when normalizer absent').calls, ['_lmSubmitScan "ab:12"']);
  assert.deepStrictEqual(S('reading: raw id when normalizer is not a function').calls, ['_lmSubmitScan "cd34"']);
  assert(S('readingerror: warning toast').toast.includes('Could not read that tag'));
  const st = S('stop: aborts + clears controller'); assert.strictEqual(st.ret, true, 'signal aborted'); assert.deepStrictEqual([st.peek.active, st.peek.hasCtl], [false, false]);
  assert.deepStrictEqual([S('stop: nothing armed (no controller)').peek.active, S('stop: nothing armed (no controller)').peek.hasCtl], [false, false]);
  const f1 = S('start: scan throws Error(message)'); assert(f1.toast.includes('Could not start phone NFC: boom')); assert.deepStrictEqual([f1.peek.active, f1.peek.hasCtl], [false, false]);
  assert(S('start: scan throws object without message').toast.includes('[object Object]'));
  assert(S('start: scan throws a string').toast.includes('plain failure')); assert(S('start: scan throws null').toast.includes('Could not start phone NFC: null'));
  assert.strictEqual(S('toggle: inactive -> start').peek.active, true); const tg = S('toggle: active -> stop'); assert.strictEqual(tg.peek.active, false); assert.strictEqual(tg.ret, true);
  assert.deepStrictEqual(S('start twice replaces the controller').ret, [false, false], 'first controller is NOT aborted by a second start (verbatim behavior)');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log(' - reverse-transform: original rebuilt byte-for-byte from the twin; 5 exports; 2-line trailing window block verbatim');
  console.log(' - ' + o.steps.length + ' steps compared incl. the shared global-lexical state after each');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
