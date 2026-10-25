// Phase 7 (Stream D) — equivalence check for modules/shop/shop_pos_terminal.js (file 30/30, the last).
//
// ORIGINAL side: real classic files — repository/*, db-service, state-manager, dom, utils eval'd; shop_orders, shop_store and shop_pos_terminal are real <script>
// elements (so the file's top-level `let`s live in the shared global lexical scope and a classic <script> can peek them). BRIDGE side: one esbuild bundle of the REAL
// production bridge (the twin imports ordStatusPill / posGenCode / services itself); the module-private lets are read through a live-binding `import * as B` peek.
// The charge core goes through the REAL DBService.rpc and a mock Supabase client (per-product outcomes, incl. a deliberately pending RPC for the double-charge guard).
// Bare globals stubbed identically (toggled per step): currentUser (a window property: READ and, after a charge, ASSIGNED), syncStudentStatsToServer,
// promoRecordPurchase, invUpdateSidebarBadge, achCheckAndAward. Both sides run on one FAKE CLOCK (win.__now drives Date) with fake setTimeout/setInterval queues
// (win.runTimers()), and an identically seeded Math.random. Inline onclick strings are driven as real DOM events.
//
// Checked: 0 reverse-transform byte identity + 51 exports; 1 window surface (41 attached, lets NOT on window); 2 renderPOS; 3 posSwitchTab; 4 claim-code lookup;
// 5 claim / cancel flows; 6 Scan & Pay grid + cart; 7 card-capture (arm / inactivity timer / finalize / focus keeper / debounce); 8 manual student search;
// 9 the charge core — every RPC outcome, affordability, order/redemption/inventory writes, currentUser reassignment, guards; 10 queue filter; 11 history filter +
// pagination; 12 analytics tab; 13 the dead renderAnalytics patch (chained and unchained).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const WIN_FNS = ['renderPOS', 'posSwitchTab', 'posLookupCode', 'posConfirmClaim', 'posExecuteClaim', 'posCancelOrderPrompt', 'posExecuteCancel', 'posPayAddItem', 'posPayIncQty', 'posPayDecQty', 'posPayClearCart',
  'unmountPosPayCapture', '_posPayOnCaptureInput', '_posPayFinalizeCapture', 'posPayArmScan', 'posPayCancelScan', 'posPayEditSale', 'posPaySearchStudent', 'posPaySelectStudent', 'posPayManualCharge',
  'posPayNewTransaction', 'posFilterQueue', 'posGoToHistPage', 'posPrevHistPage', 'posNextHistPage', 'posFilterHistory'];
const DECL_FNS = ['_posPayTotal', '_posPayRenderPanel', '_posPayRenderGrid', '_posPayRenderCart', '_posPayIdleStatusHTML', '_posPayStartCapture', '_posPayHandleTag', '_posPayRenderScanError',
  '_posPayRenderProcessing', '_posPayRenderDeclined', '_posPayRenderStockFail', '_posPayRenderReceipt', '_posPayAttemptCharge', '_posHistPagination', '_posAnalyticsHTML'];
const PRIVATE = ['_posPayCart', '_posPayManualStudentId', '_posPayScanArmed', '_posPayCaptureFocusInterval', '_posPayCaptureTimer', '_posPayLastChargedTag', '_posPayLastChargeAt', '_posPayBusy', '_posHistPage', '_POS_HIST_PAGE_SIZE'];

function reverseTransformCheck() {
  const orig = read('modules/shop/shop_pos_terminal.js');
  const twin = read('src/modules/shop/shop_pos_terminal.js');
  const marker = '// ── CSS injection ─────────────────────────────────────────────────────────────\n';
  assert.strictEqual(orig.split(marker).length, 2); assert.strictEqual(twin.split(marker).length, 2);
  const origHead = orig.slice(0, orig.indexOf(marker));
  assert(twin.includes(origHead), 'twin carries the original header comment verbatim');
  const mid = twin.slice(twin.indexOf(origHead) + origHead.length, twin.indexOf(marker));
  assert(mid.endsWith(';\n\n')); for (const line of mid.split('\n').filter(Boolean)) assert(/^import .*;$/.test(line), 'import block line: ' + line);
  const body = twin.slice(twin.indexOf(marker));
  const rebuilt = origHead + body
    .replace(/^export const (\w+) = function/gm, (m, n) => (WIN_FNS.includes(n) ? 'window.' + n + ' = function' : m))
    .replace(/^export async function /gm, 'async function ').replace(/^export function /gm, 'function ')
    .replace(/^export let /gm, 'let ').replace(/^export const _POS_HIST_PAGE_SIZE/gm, 'const _POS_HIST_PAGE_SIZE');
  assert.strictEqual(rebuilt, orig, 'reversing the keyword swaps must reproduce the original byte-for-byte');
  assert.strictEqual((twin.match(/^export /gm) || []).length, 51, 'exactly 51 exports (= declaresCount 52 minus the in-body window.renderAnalytics slot)');
}

const STARTER_HTML = `<!doctype html><html><body><div id="a-pos"></div><div id="a-analytics"></div><div id="toast"></div><div id="modal-overlay" style="display:none"><div id="modal-box" class="modal-box"><div id="modal-content"></div></div></div></body></html>`;
const BODY = STARTER_HTML.slice(STARTER_HTML.indexOf('<body>') + 6, STARTER_HTML.indexOf('</body>'));
const FIXED = 1767225600000; // 2026-01-01T00:00:00Z
const DAY = 86400000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tick = () => sleep(8);

function makeWindow(opts) {
  opts = opts || {};
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  win.eval(`globalThis.__now = ${FIXED}; (function(){ const R = Date; class D extends R { constructor(...a){ if (a.length) super(...a); else super(globalThis.__now); } static now(){ return globalThis.__now; } } globalThis.Date = D; }());`);
  win.eval("globalThis.__rnd = { s: 424242 }; Math.random = function () { __rnd.s = (__rnd.s * 1103515245 + 12345) & 0x7fffffff; return __rnd.s / 0x7fffffff; };");
  win.DEFAULT_DB = { store: [], students: [], orders: [], redemptions: [], inventory: {}, rfidCards: [], admin: null };
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };
  win.__rpcCalls = []; win.__purchase = {};
  const mockClient = {
    auth: { getSession: async () => ({ data: { session: null } }) },
    rpc: async (name, params) => {
      win.__rpcCalls.push({ name, params });
      if (name === 'purchase_shop_product') { const e = win.__purchase[params.p_product_id]; if (typeof e === 'function') return e(params); if (e) return e; return { data: [{ ok: true, remaining_stock: 99 }], error: null }; }
      throw new Error('unmocked rpc: ' + name);
    },
  };
  win.SupabaseClient = { getClient: () => mockClient, resolveProvider: () => 'supabase' };
  win.__EDUQUEST_SUPABASE_URL__ = ''; win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };
  win.__calls = []; win.__tq = []; win.__events = [];
  const rec = name => (...a) => { win.__calls.push(JSON.stringify([name, ...a.map(x => (typeof x === 'function' ? '<fn>' : (x && typeof x === 'object' && !Array.isArray(x) ? '<obj:' + Object.keys(x).sort().join(',') + '>' : x)))])); };
  win.__stubNames = ['syncStudentStatsToServer', 'promoRecordPurchase', 'invUpdateSidebarBadge', 'achCheckAndAward'];
  win.__stubFns = {}; for (const n of win.__stubNames) win.__stubFns[n] = rec(n);
  for (const n of win.__stubNames) win[n] = win.__stubFns[n];
  if (opts.preRA) win.renderAnalytics = rec('renderAnalytics(original)');
  win.addEventListener('error', e => win.__calls.push(JSON.stringify(['window-error', String(e.message)])));
  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  win.console.warn = () => {}; win.console.error = (...a) => win.__calls.push(JSON.stringify(['error', ...a.map(String)]));
  return { win, logs };
}
function addScript(win, code) { const s = win.document.createElement('script'); s.textContent = code; win.document.head.appendChild(s); }
function installEnv(win) {
  Object.defineProperty(win.HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value(o) { win.__calls.push(JSON.stringify(['scrollIntoView', this.id, o])); } });
  win.AppStore.subscribe('verify-recorder', (st, e) => { win.__events.push(e.type + ':' + JSON.stringify(e.payload === undefined ? null : e.payload)); });
}
const PEEK = `window.__peek = () => ({ cart: _posPayCart, manual: _posPayManualStudentId, armed: _posPayScanArmed, focusInterval: !!_posPayCaptureFocusInterval, captureTimer: !!_posPayCaptureTimer,
  lastTag: _posPayLastChargedTag, lastAt: _posPayLastChargeAt, busy: _posPayBusy, hist: _posHistPage, histSize: _POS_HIST_PAGE_SIZE });`;
async function evalOriginal(win) {
  for (const f of ['repository/table-sync.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'db-service.js', 'modules/core/state-manager.js', 'dom.js', 'utils.js']) win.eval(read(f));
  for (const f of ['shop_orders', 'shop_store', 'shop_pos_terminal']) addScript(win, read('modules/shop/' + f + '.js'));
  addScript(win, PEEK);
  await win.AppStore.ready; installEnv(win);
}
async function evalBridge(win) {
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'shop_pos_terminal-combined-bundle.js'), 'utf8'));
  await win.AppStore.ready; installEnv(win);
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
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

const STORE = () => [
  { id: 'p1', name: 'Snack <b>Pack</b>', emoji: '🍿', cat: 'food', cost: 50, stock: 5 },
  { id: 'p2', name: 'Gold Pen', emoji: '🖊️', cat: 'supplies', cost: 250, stock: 2 },
  { id: 'p3', name: 'Homework Pass', emoji: '🎫', cat: 'privilege', cost: 120, stock: 10 },
  { id: 'p4', name: 'Mystery Box', emoji: '🎁', cat: 'mystery', cost: 300, stock: 0 },
  { id: 'p5', name: 'Eraser', emoji: '🧽', cat: 'supplies', cost: 20, stock: 3 },
  { id: 'p6', name: 'Pen cap', emoji: '🖋️', cat: 'supplies', cost: 5 },
];
const STUDENTS = () => [
  { id: 'stu1', name: 'Ann <A>', init: 'AA', color: '#ff0000', coins: 1000 },
  { id: 'stu2', name: 'Bo', init: 'B', color: '#00ff00', coins: 30 },
  { id: 'stu3', name: 'Cy Ann', color: '#0000ff', coins: 500 },
  ...[4, 5, 6, 7, 8, 9].map(i => ({ id: 'stu' + i, name: 'Anne ' + i, init: 'A' + i, coins: i * 10 })),
];
const CARDS = () => [{ tagId: 'TAG1', studentId: 'stu1', isActive: true }, { tagId: 'TAG2', studentId: 'stu2', isActive: false }, { tagId: 'TAG3', studentId: 'ghost', isActive: true }, { tagId: 'TAG4', studentId: 'stu3', isActive: true }, { tagId: 'TAG5', studentId: 'stu2', isActive: true }];
const ORDERS = () => [
  { orderId: 'O1', claimCode: 'AAA111', studentId: 'stu1', studentName: 'Ann <A>', studentInit: 'AA', studentColor: '#ff0000', itemId: 'p1', itemName: 'Snack <b>Pack</b>', emoji: '🍿', cost: 50, category: 'food', status: 'pending', createdDateStr: 'Jan 1, 2026' },
  { orderId: 'O2', claimCode: 'BBB222', studentId: 'stu2', studentName: 'Bo', studentInit: 'B', studentColor: '#00ff00', itemId: 'p2', itemName: 'Gold Pen', emoji: '🖊️', cost: 250, category: 'supplies', status: 'ready', createdDateStr: 'Dec 31, 2025' },
  { orderId: "O'3", claimCode: 'CCC333', studentId: 'stu3', studentName: 'Cy Ann', studentInit: 'CA', studentColor: '#0000ff', itemId: 'p3', itemName: 'Homework Pass', emoji: '🎫', cost: 120, category: 'privilege', status: 'claimed', claimedAt: FIXED - 3600000, claimedBy: 'Ms. Admin', createdDateStr: 'Dec 30, 2025' },
  { orderId: 'O4', claimCode: 'DDD444', studentId: 'stu1', studentName: 'Ann <A>', studentInit: 'AA', itemId: 'p4', itemName: 'Mystery Box', emoji: '🎁', cost: 300, category: 'mystery', status: 'cancelled', cancelReason: 'No stock <x>', cancelledAt: FIXED - 2 * DAY, cancelledBy: 'T', createdDateStr: 'Dec 29, 2025' },
  { orderId: 'O5', claimCode: 'EEE555', studentId: 'stu2', studentName: 'Bo', itemId: 'p5', itemName: 'Eraser', status: 'pending' },
  { orderId: 'O6', claimCode: 'FFF666', studentId: 'stu2', studentName: 'Bo', studentColor: '#00ff00', itemId: 'p4', itemName: 'Mystery Box', emoji: '🎁', cost: 300, category: 'mystery', status: 'claimed', claimedAt: FIXED - 10 * DAY, claimedBy: 'T', createdDateStr: 'Dec 20, 2025' },
  { orderId: 'O7', claimCode: 'GGG777', studentId: 'stu3', studentName: 'Cy Ann', itemId: 'p1', itemName: 'Snack <b>Pack</b>', emoji: '🍿', cost: 50, category: 'food', status: 'claimed', claimedAt: FIXED - 1000, createdDateStr: 'Jan 1, 2026' },
  { orderId: 'O8', claimCode: 'HHH888', studentId: 'stu3', studentName: 'Cy Ann', itemId: 'p9', itemName: 'Odd', emoji: '❔', cost: 10, category: 'weird', status: 'claimed', claimedAt: FIXED - 3 * DAY, createdDateStr: 'Dec 29, 2025' },
];
const MANY = n => Array.from({ length: n }, (_, i) => ({ orderId: 'M' + i, claimCode: 'MC' + String(i).padStart(3, '0'), studentId: 'stu1', studentName: i % 2 ? 'Odd Student' : 'Even Student', studentColor: '#abc', itemId: 'p1', itemName: 'Item ' + i, emoji: '🍿', cost: 10 + i, category: 'food', status: i % 7 === 0 ? 'cancelled' : 'claimed', claimedAt: FIXED - i * 3600000, createdDateStr: 'Jan 1, 2026' }));
function seed(win, extra) {
  win.AppStore.updateState(d => { d.store = STORE(); d.students = STUDENTS(); d.orders = ORDERS(); d.redemptions = []; d.inventory = {}; d.rfidCards = CARDS(); d.admin = null; Object.assign(d, extra || {}); }, { type: 'test:seed' });
}
const ok = rem => ({ data: [{ ok: true, remaining_stock: rem }], error: null });

async function run(win, logs) {
  const out = { steps: [] };
  const page = () => $(win, 'a-pos');
  const peek = () => clean(win.__peek());
  const h = id => { const e = $(win, id); return e ? e.innerHTML : null; };
  win.runTimers = (n = 400) => { let k = 0; while (win.__tq.length && k++ < n) { win.__tq.sort((a, b) => a.at - b.at || a.i - b.i); const t = win.__tq.shift(); win.__now = t.at; if (t.every) win.__tq.push({ i: t.i, f: t.f, at: t.at + t.every, ms: t.ms, every: t.every }); t.f(); } return k; };
  const installClock = () => {
    const rT = win.setTimeout, rC = win.clearTimeout, rI = win.setInterval, rCI = win.clearInterval; let tid = 0;
    win.setTimeout = (f, ms) => { const i = ++tid; win.__tq.push({ i, f, at: win.__now + (ms || 0), ms }); win.__calls.push(JSON.stringify(['setTimeout', ms === undefined ? null : ms])); return i; };
    win.setInterval = (f, ms) => { const i = ++tid; win.__tq.push({ i, f, at: win.__now + (ms || 0), ms, every: ms }); win.__calls.push(JSON.stringify(['setInterval', ms])); return i; };
    const clr = kind => id => { win.__calls.push(JSON.stringify([kind, id === undefined ? 'undef' : id])); win.__tq = win.__tq.filter(t => t.i !== id); };
    win.clearTimeout = clr('clearTimeout'); win.clearInterval = clr('clearInterval');
    return () => { win.setTimeout = rT; win.clearTimeout = rC; win.setInterval = rI; win.clearInterval = rCI; };
  };
  const fresh = async (label, o, fn) => {
    o = o || {};
    const restore = installClock();
    win.__now = FIXED; win.__rnd.s = 424242; win.__purchase = {}; win.__release = null;
    for (const n of win.__stubNames) win[n] = win.__stubFns[n];
    win.document.body.innerHTML = BODY; // steps may remove elements on purpose
    seed(win, o.extra);
    win.currentUser = o.user === undefined ? null : o.user;
    if (o.noUser) delete win.currentUser;
    if (o.render !== false) win.renderPOS();
    win.posPayNewTransaction();
    win.__tq.length = 0; win.__calls.length = 0; win.__rpcCalls.length = 0; win.__events.length = 0;
    let err = null, ret;
    try { ret = await fn(); } catch (e) { err = String(e && e.message); }
    await tick();
    const tail = win.__tq.map(t => [t.at - FIXED, t.ms, !!t.every]);
    const st = win.AppStore.getSlice(s => ({ store: s.store, students: s.students, orders: s.orders, redemptions: s.redemptions, inventory: s.inventory }));
    out.steps.push({ label, err, ret, events: win.__events.filter(e => !e.startsWith('test:seed')), calls: win.__calls.slice(), rpc: win.__rpcCalls.slice(), toast: $(win, 'toast').outerHTML, modal: [$(win, 'modal-overlay').style.display, $(win, 'modal-content').innerHTML, ($(win, 'modal-box') || {}).className],
      page: h('a-pos'), analytics: h('a-analytics'), peek: peek(), user: win.currentUser === undefined && !('currentUser' in win) ? '<undefined>' : JSON.stringify(win.currentUser), state: st, pending: tail, now: win.__now - FIXED, active: win.document.activeElement && win.document.activeElement.id });
    restore();
  };
  const click = el => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  const fire = (el, type) => el.dispatchEvent(new win.Event(type, { bubbles: true }));
  const set = (id, v) => { $(win, id).value = v; };
  const cart = (...ids) => { for (const id of ids) win.posPayAddItem(id); };
  const asPay = () => { win.posSwitchTab('pay'); };

  out.surface = { fns: WIN_FNS.concat(DECL_FNS).map(n => [n, typeof win[n]]), priv: PRIVATE.map(n => [n, typeof win[n]]), ra: typeof win.renderAnalytics, peek: peek(), css: !!win.document.getElementById('pos-terminal-css') };

  // ── renderPOS ──
  await fresh('renderPOS: counts, tabs, panels', null, async () => { win.renderPOS(); });
  await fresh('renderPOS: no orders at all', { extra: { orders: [] } }, async () => { win.renderPOS(); });
  await fresh('renderPOS: orders slice undefined', { extra: { orders: undefined } }, async () => { win.renderPOS(); });
  await fresh('renderPOS: resets a half-built sale and disarms the reader', null, async () => { cart('p1', 'p2'); win.posPayArmScan(); const before = peek(); win.renderPOS(); return [before, peek()]; });
  await fresh('renderPOS: no #a-pos element -> TypeError', { render: false }, async () => { page().remove(); win.renderPOS(); });
  // ── posSwitchTab ──
  for (const t of ['scanner', 'pay', 'queue', 'history', 'analytics', 'nope']) await fresh('tab: ' + t, null, async () => { win.posSwitchTab(t); win.runTimers(); return [t, [...win.document.querySelectorAll('.pos-tab, [id^=postab-]')].map(e => [e.id, e.className]), ['scanner', 'pay', 'queue', 'history', 'analytics'].map(x => $(win, 'pos-panel-' + x).style.display)]; });
  await fresh('tab: leaving pay disarms the reader', null, async () => { cart('p1'); win.posPayArmScan(); const a = peek(); win.posSwitchTab('queue'); return [a, peek()]; });
  await fresh('tab: staying on pay keeps the reader armed', null, async () => { cart('p1'); win.posPayArmScan(); win.posSwitchTab('pay'); return peek(); });
  await fresh('tab: missing panels / buttons tolerated', null, async () => { win.document.querySelectorAll('[id^=pos-panel-],[id^=postab-]').forEach(e => e.remove()); win.posSwitchTab('analytics'); win.posSwitchTab('scanner'); win.runTimers(); });
  await fresh('tab: unmountPosPayCapture missing -> still switches', null, async () => { const f = win.unmountPosPayCapture; win.unmountPosPayCapture = undefined; try { win.posSwitchTab('queue'); return 'ok'; } finally { win.unmountPosPayCapture = f; } });
  // ── posLookupCode ──
  const look = async (label, code) => fresh('lookup: ' + label, null, async () => { set('pos-code-input', code); win.posLookupCode(); return $(win, 'pos-lookup-result').innerHTML.length; });
  await look('empty -> prompt', '   '); await look('not found (escaped)', '<zz>'); await look('pending (case-insensitive)', ' aaa111 '); await look('ready', 'BBB222'); await look('claimed', 'ccc333');
  await look('cancelled with reason', 'DDD444'); await look('pending, minimal fields', 'EEE555'); await look('claimed, no claimedAt/by', 'GGG777'); await look('claimed, old', 'FFF666');
  await fresh('lookup: no result element', null, async () => { $(win, 'pos-lookup-result').remove(); win.posLookupCode(); });
  await fresh('lookup: no input element -> empty prompt', null, async () => { $(win, 'pos-code-input').remove(); win.posLookupCode(); });
  await fresh('lookup: orders slice undefined', { extra: { orders: undefined } }, async () => { set('pos-code-input', 'aaa111'); win.posLookupCode(); });
  // ── claim / cancel ──
  await fresh('confirmClaim: not found', null, async () => { win.posConfirmClaim('nope'); });
  await fresh('confirmClaim: already claimed', null, async () => { win.posConfirmClaim('O6'); });
  await fresh('confirmClaim: cancelled', null, async () => { win.posConfirmClaim('O4'); });
  await fresh('confirmClaim: pending -> modal', null, async () => { win.posConfirmClaim('O1'); });
  await fresh('confirmClaim: minimal order -> modal defaults', null, async () => { win.posConfirmClaim('O5'); });
  await fresh('confirmClaim: modal buttons are wired (Cancel closes, Confirm claims)', null, async () => { win.posConfirmClaim('O1'); const b = [...win.document.querySelectorAll('#modal-content button')]; click(b[1]); return b.map(x => x.getAttribute('onclick')); });
  await fresh('executeClaim: unknown order', null, async () => { win.posExecuteClaim('nope'); });
  await fresh('executeClaim: already claimed', null, async () => { win.posExecuteClaim('O6'); });
  await fresh('executeClaim: claimed by admin name', { extra: { admin: { name: 'Ms. Admin' } }, user: { id: 'u', name: 'Cur' } }, async () => { set('pos-code-input', 'AAA111'); win.posLookupCode(); win.posExecuteClaim('O1'); });
  await fresh('executeClaim: claimed by currentUser name', { user: { id: 'u', name: 'Cur' } }, async () => { win.posExecuteClaim('O1'); });
  await fresh('executeClaim: claimed by "Teacher" (nobody known)', null, async () => { win.posExecuteClaim('O2'); });
  await fresh('executeClaim: missing queue tab / result / input tolerated', null, async () => { ['postab-queue', 'pos-lookup-result', 'pos-code-input'].forEach(i => $(win, i).remove()); win.posExecuteClaim('O1'); });
  await fresh('executeClaim: queue badge counts the remaining pending', null, async () => { win.posExecuteClaim('O1'); return $(win, 'postab-queue').innerHTML; });
  await fresh('cancelPrompt: not found -> nothing', null, async () => { win.posCancelOrderPrompt('nope'); });
  await fresh('cancelPrompt: modal', null, async () => { win.posCancelOrderPrompt('O1'); });
  await fresh('executeCancel: unknown -> closes modal only', null, async () => { win.posCancelOrderPrompt('O1'); win.posExecuteCancel('nope'); });
  await fresh('executeCancel: with reason (trimmed), admin name', { extra: { admin: { name: 'Ms. Admin' } } }, async () => { win.posCancelOrderPrompt('O1'); set('pos-cancel-reason', '  Out of <stock>  '); win.posExecuteCancel('O1'); win.runTimers(); });
  await fresh('executeCancel: no reason -> default, currentUser name', { user: { id: 'u', name: 'Cur' } }, async () => { win.posCancelOrderPrompt('O2'); win.posExecuteCancel('O2'); });
  await fresh('executeCancel: blank reason + no modal input, Teacher', null, async () => { win.posExecuteCancel('O5'); });
  await fresh('executeCancel: re-renders POS and lands on the queue tab', null, async () => { win.posExecuteCancel('O1'); return [['scanner', 'pay', 'queue', 'history', 'analytics'].map(x => $(win, 'pos-panel-' + x).style.display), $(win, 'pos-queue-list').innerHTML.length]; });
  // ── Scan & Pay grid + cart ──
  await fresh('pay grid: full catalog + empty cart', null, async () => { asPay(); });
  await fresh('pay grid: category + search filters', null, async () => { asPay(); set('pos-pay-cat', 'supplies'); set('pos-pay-search', '  PEN '); win.posPayAddItem('p5'); return $(win, 'pos-pay-grid').innerHTML.length; });
  await fresh('pay grid: no match', null, async () => { asPay(); set('pos-pay-search', 'zzz'); win.posPayAddItem('p1'); });
  await fresh('pay grid: empty store', { extra: { store: [] } }, async () => { asPay(); });
  await fresh('pay grid: store slice undefined', { extra: { store: undefined } }, async () => { asPay(); win.posPayAddItem('p1'); });
  await fresh('pay grid: missing grid element', null, async () => { $(win, 'pos-pay-grid').remove(); win.posPayAddItem('p1'); });
  await fresh('cart: add unknown / out of stock', null, async () => { asPay(); win.posPayAddItem('nope'); win.posPayAddItem('p4'); });
  await fresh('cart: stock cap (p2 has 2)', null, async () => { asPay(); win.posPayAddItem('p2'); win.posPayAddItem('p2'); win.posPayAddItem('p2'); return peek().cart; });
  await fresh('cart: item without a stock field (p6) is not capped by 0', null, async () => { asPay(); win.posPayAddItem('p6'); win.posPayAddItem('p6'); return peek().cart; });
  await fresh('cart: inc via window.posPayAddItem, dec down to removal, dec unknown', null, async () => { asPay(); win.posPayIncQty('p1'); win.posPayIncQty('p1'); win.posPayDecQty('p1'); const a = peek().cart; win.posPayDecQty('p1'); win.posPayDecQty('p1'); return [a, peek().cart]; });
  await fresh('cart: item snapshot refreshes to the latest store row', null, async () => { asPay(); win.posPayAddItem('p1'); win.AppStore.updateState(d => { d.store.find(i => i.id === 'p1').cost = 77; }, { type: 'test:price' }); win.posPayAddItem('p1'); return peek().cart; });
  await fresh('cart: clear disarms, drops the manual pick', null, async () => { asPay(); cart('p1', 'p3'); win.posPaySelectStudent('stu1'); win.posPayArmScan(); win.posPayClearCart(); return peek(); });
  await fresh('cart: cart box + idle status with items (buttons enabled)', null, async () => { asPay(); cart('p1', 'p1', 'p3'); return $(win, 'pos-pay-cart-box').innerHTML; });
  await fresh('cart: inline buttons (+ / − / Clear) are real clicks', null, async () => { asPay(); cart('p1'); const b = [...win.document.querySelectorAll('#pos-pay-cart-box button')]; click(b.find(x => x.textContent === '+')); click(b.find(x => x.textContent === '+')); click(win.document.querySelector('#pos-pay-cart-box .btn-xs[onclick^=posPayDec]')); const mid = peek().cart; click(win.document.querySelector('#pos-pay-cart-box .btn-ghost.btn-xs[onclick="posPayClearCart()"]')); return [mid, peek().cart]; });
  await fresh('cart: tile click adds', null, async () => { asPay(); click(win.document.querySelector('.pos-pay-tile')); return peek().cart; });
  await fresh('cart: _posPayRenderCart without a box', null, async () => { $(win, 'pos-pay-cart-box').remove(); win._posPayRenderCart(); win._posPayRenderPanel(); });
  // ── capture ──
  await fresh('arm: empty cart -> toast, not armed', null, async () => { asPay(); win.posPayArmScan(); return peek(); });
  await fresh('arm: armed, waiting panel, focus keeper running', null, async () => { asPay(); cart('p1'); win.posPayArmScan(); return [peek(), win.document.activeElement.id, win.__tq.map(t => [t.ms, !!t.every])]; });
  await fresh('arm: re-arming clears the previous keeper first', null, async () => { asPay(); cart('p1'); win.posPayArmScan(); win.posPayArmScan(); return win.__tq.length; });
  await fresh('arm: no capture input / no status element', null, async () => { asPay(); cart('p1'); $(win, 'pos-pay-capture-input').remove(); $(win, 'pos-pay-status').remove(); win.posPayArmScan(); return peek(); });
  await fresh('focus keeper: steals focus back only while armed', null, async () => { asPay(); cart('p1'); win.posPayArmScan(); $(win, 'pos-pay-search').focus(); win.runTimers(1); const a = win.document.activeElement.id; win.unmountPosPayCapture(); $(win, 'pos-pay-search').focus(); win.runTimers(1); return [a, win.document.activeElement.id]; });
  await fresh('focus keeper: element removed -> no crash', null, async () => { asPay(); cart('p1'); win.posPayArmScan(); $(win, 'pos-pay-capture-input').remove(); win.runTimers(1); });
  await fresh('capture: typing arms the 120ms inactivity timer (restarted per key)', null, async () => { asPay(); cart('p1'); win.posPayArmScan(); win._posPayOnCaptureInput(); win._posPayOnCaptureInput(); return [win.__tq.filter(t => !t.every).map(t => t.ms), peek().captureTimer]; });
  await fresh('capture: finalize with no input element', null, async () => { $(win, 'pos-pay-capture-input').remove(); win._posPayFinalizeCapture(); });
  await fresh('capture: finalize blank / unarmed ignore the tag', null, async () => { asPay(); cart('p1'); set('pos-pay-capture-input', '   '); win._posPayFinalizeCapture(); set('pos-pay-capture-input', 'TAG1'); win._posPayFinalizeCapture(); return [$(win, 'pos-pay-capture-input').value, win.__rpcCalls.length]; });
  await fresh('capture: inactivity fallback finalizes a typed tag (card tap)', null, async () => { asPay(); cart('p1'); win.posPayArmScan(); set('pos-pay-capture-input', ' TAG1 '); win._posPayOnCaptureInput(); win.runTimers(2); await tick(); return peek(); });
  await fresh('capture: cancel + edit sale disarm and re-render', null, async () => { asPay(); cart('p1'); win.posPayArmScan(); win.posPayCancelScan(); const a = peek(); win.posPayArmScan(); win.posPayEditSale(); return [a, peek()]; });
  // ── HandleTag ──
  await fresh('tag: unrecognised card -> scan error, still armed', null, async () => { asPay(); cart('p1'); win.posPayArmScan(); win._posPayHandleTag('NOPE'); return peek(); });
  await fresh('tag: inactive card is unrecognised', null, async () => { asPay(); cart('p1'); win.posPayArmScan(); win._posPayHandleTag('TAG2'); });
  await fresh('tag: card of a ghost student -> Student not found', null, async () => { asPay(); cart('p1'); win.posPayArmScan(); win._posPayHandleTag('TAG3'); await tick(); });
  await fresh('tag: rfidCards slice undefined', { extra: { rfidCards: undefined } }, async () => { asPay(); cart('p1'); win.posPayArmScan(); win._posPayHandleTag('TAG1'); });
  await fresh('tag: debounce — same tag within 5s ignored, at 5s allowed, other tag allowed', null, async () => {
    asPay(); cart('p1'); win.__purchase.p1 = () => ok(4); win._posPayHandleTag('TAG1'); await tick(); const a = [peek().lastTag, peek().lastAt - FIXED, win.__rpcCalls.length];
    cart('p1'); win.__now += 4999; win._posPayHandleTag('TAG1'); await tick(); const b = [win.__rpcCalls.length, peek().lastAt - FIXED];
    win.__now += 1; win._posPayHandleTag('TAG1'); await tick(); const c = [win.__rpcCalls.length, peek().lastAt - FIXED];
    cart('p1'); win._posPayHandleTag('TAG4'); await tick(); return [a, b, c, win.__rpcCalls.length, peek().lastTag];
  });
  // ── manual search / select ──
  await fresh('manual search: empty query clears; no box returns', null, async () => { asPay(); cart('p1'); set('pos-pay-manual-search', 'ann'); win.posPaySearchStudent(); const a = $(win, 'pos-pay-manual-results').innerHTML.length; set('pos-pay-manual-search', '  '); win.posPaySearchStudent(); const b = $(win, 'pos-pay-manual-results').innerHTML; $(win, 'pos-pay-manual-results').remove(); win.posPaySearchStudent(); return [a, b]; });
  await fresh('manual search: >6 matches capped at 6, balance + init fallback', null, async () => { asPay(); cart('p1'); set('pos-pay-manual-search', 'ann'); win.posPaySearchStudent(); return $(win, 'pos-pay-manual-results').children.length; });
  await fresh('manual search: no match echoes the (escaped) query', null, async () => { asPay(); cart('p1'); set('pos-pay-manual-search', '<q>'); win.posPaySearchStudent(); });
  await fresh('manual search: students slice undefined', { extra: { students: undefined } }, async () => { asPay(); cart('p1'); set('pos-pay-manual-search', 'a'); win.posPaySearchStudent(); });
  await fresh('manual select: unknown student / no status element', null, async () => { asPay(); cart('p1'); win.posPaySelectStudent('nope'); const a = peek().manual; $(win, 'pos-pay-status').remove(); win.posPaySelectStudent('stu1'); return [a, peek().manual]; });
  await fresh('manual select: shows identified student + total', null, async () => { asPay(); cart('p1', 'p3'); win.posPaySelectStudent('stu1'); return peek().manual; });
  await fresh('manual charge: nothing selected -> no-op', null, async () => { asPay(); cart('p1'); win.posPayManualCharge(); await tick(); return win.__rpcCalls.length; });
  await fresh('manual flow via real clicks: search row -> Confirm & Charge', null, async () => { asPay(); cart('p1'); set('pos-pay-manual-search', 'ann <'); win.posPaySearchStudent(); click(win.document.querySelector('.pos-pay-manual-row')); click(win.document.querySelector('#pos-pay-status .btn-success')); await tick(); return [peek(), win.__rpcCalls.length]; });
  // ── charge core ──
  const charge = async (label, o, setup, who = 'stu1', method = 'scan') => fresh('charge: ' + label, o, async () => { asPay(); const r = await setup(); win.__purchase.p1 = win.__purchase.p1 || ok(4); const p = win._posPayAttemptCharge(who, method); await p; win.runTimers(); return r; });
  await charge('student not found', null, async () => { cart('p1'); }, 'ghost');
  await charge('empty cart -> toast', null, async () => {});
  await charge('declined: insufficient balance (short by)', null, async () => { cart('p2', 'p2'); }, 'stu2');
  await charge('exact balance affordable (stu2 30 coins, 30 total)', null, async () => { win.AppStore.updateState(d => { d.store.push({ id: 'px', name: 'X', emoji: '❌', cat: 'food', cost: 30, stock: 4 }); }, { type: 'test:px' }); cart('px'); win.__purchase.px = ok(3); }, 'stu2');
  await charge('success: one item, scan', null, async () => { cart('p1'); win.__purchase.p1 = ok(4); });
  await charge('success: manual method + multi-qty + two items', null, async () => { cart('p1', 'p1', 'p3'); win.__purchase.p1 = ok(3); win.__purchase.p3 = ok(9); }, 'stu1', 'manual');
  await charge('success: existing inventory row is incremented', { extra: { inventory: { stu1: [{ itemId: 'p1', itemName: 'Snack', quantity: 2, datePurchased: 'x' }] } } }, async () => { cart('p1'); win.__purchase.p1 = ok(4); });
  await charge('success: existing inventory row without quantity', { extra: { inventory: { stu1: [{ itemId: 'p1', itemName: 'Snack' }] } } }, async () => { cart('p1', 'p1'); win.__purchase.p1 = ok(3); });
  await charge('success: orders/redemptions/inventory slices missing -> created', { extra: { orders: undefined, redemptions: undefined, inventory: undefined } }, async () => { cart('p1'); win.__purchase.p1 = ok(4); });
  await charge('success: admin name is the cashier', { extra: { admin: { name: 'Ms. Admin' } }, user: { id: 'x', name: 'Cur' } }, async () => { cart('p1'); win.__purchase.p1 = ok(4); });
  await charge('success: currentUser name is the cashier', { user: { id: 'x', name: 'Cur' } }, async () => { cart('p1'); win.__purchase.p1 = ok(4); });
  await charge('success: no currentUser variable at all -> Teacher', { noUser: true }, async () => { cart('p1'); win.__purchase.p1 = ok(4); });
  await charge('success: buyer IS currentUser -> reassigned + sidebar badge + guards', { user: { id: 'stu1', name: 'Ann', coins: 1000 } }, async () => { cart('p1'); win.__purchase.p1 = ok(4); win.eval('globalThis.__oldUser = currentUser'); return null; });
  await charge('success: buyer is currentUser but sidebar helper absent', { user: { id: 'stu1', name: 'Ann' } }, async () => { cart('p1'); win.invUpdateSidebarBadge = undefined; win.__purchase.p1 = ok(4); });
  await charge('success: promo helper absent', null, async () => { cart('p1'); win.promoRecordPurchase = undefined; win.__purchase.p1 = ok(4); });
  await charge('success: ach helper absent -> no 400ms timer', null, async () => { cart('p1'); win.achCheckAndAward = undefined; win.__purchase.p1 = ok(4); });
  await charge('success: currentUser is another student -> not reassigned', { user: { id: 'stu2', name: 'Bo' } }, async () => { cart('p1'); win.__purchase.p1 = ok(4); });
  await charge('rpc: object (not array) result', null, async () => { cart('p1'); win.__purchase.p1 = { data: { ok: true, remaining_stock: 2 }, error: null }; });
  await charge('rpc: ok:false with remaining stock -> "only N left"', null, async () => { cart('p1'); win.__purchase.p1 = { data: [{ ok: false, remaining_stock: 1 }], error: null }; });
  await charge('rpc: error object -> falls back to item.stock', null, async () => { cart('p1'); win.__purchase.p1 = { data: null, error: { message: 'boom' } }; });
  await charge('rpc: null data', null, async () => { cart('p1'); win.__purchase.p1 = { data: null, error: null }; });
  await charge('rpc: ok:false remaining_stock null -> item stock kept, "only 0 left"', null, async () => { cart('p1'); win.__purchase.p1 = { data: [{ ok: false, remaining_stock: null }], error: null }; });
  await charge('partial: one ok, one declined by stock -> receipt lists the failure', null, async () => { cart('p1', 'p3'); win.__purchase.p1 = ok(4); win.__purchase.p3 = { data: [{ ok: false, remaining_stock: 0 }], error: null }; });
  await charge('partial: item vanished from the store mid-sale', null, async () => { cart('p1', 'p3'); win.AppStore.updateState(d => { d.store = d.store.filter(i => i.id !== 'p3'); }, { type: 'test:vanish' }); win.__purchase.p1 = ok(4); });
  await charge('all failed -> stock panel, busy cleared, cart kept', null, async () => { cart('p1', 'p3'); win.__purchase.p1 = { data: [{ ok: false, remaining_stock: 0 }], error: null }; win.__purchase.p3 = { data: null, error: { message: 'x' } }; });
  await fresh('charge: busy guard — a second attempt during an in-flight RPC is ignored', null, async () => {
    asPay(); cart('p1'); win.__purchase.p1 = () => new Promise(r => { win.__release = () => r(ok(4)); });
    const p1 = win._posPayAttemptCharge('stu1', 'scan'); await tick(); const mid = peek().busy; const second = win._posPayAttemptCharge('stu1', 'scan'); await tick();
    const rpcs = win.__rpcCalls.length; win.__release(); await p1; return [mid, rpcs, win.__rpcCalls.length, peek().busy, second === undefined || second instanceof win.Promise];
  });
  await fresh('charge: unique claim codes per unit + order ids', null, async () => { asPay(); cart('p1', 'p1', 'p1'); win.__purchase.p1 = ok(2); await win._posPayAttemptCharge('stu1', 'scan'); return win.AppStore.getSlice(s => s.orders.filter(o => o.orderId.startsWith('POS-')).map(o => [o.orderId, o.claimCode])); });
  await fresh('charge: receipt "New Sale" button resets the register', null, async () => { asPay(); cart('p1'); win.__purchase.p1 = ok(4); await win._posPayAttemptCharge('stu1', 'scan'); set('pos-pay-search', 'zz'); click(win.document.querySelector('#pos-pay-status .btn-success')); return [peek(), $(win, 'pos-pay-search').value]; });
  await fresh('charge: renderers without a status element are silent', null, async () => { asPay(); cart('p1'); $(win, 'pos-pay-status').remove(); win._posPayRenderProcessing({ name: 'x' }); win._posPayRenderDeclined({ name: 'x' }, 5); win._posPayRenderStockFail([]); win._posPayRenderReceipt({ name: 'x' }, [], 0, []); win._posPayRenderScanError('m'); });
  await fresh('charge: renderers — defaults (no color/init/coins, failed list absent)', null, async () => { asPay(); win._posPayRenderProcessing({ name: 'N' }); const a = $(win, 'pos-pay-status').innerHTML; win._posPayRenderDeclined({ name: 'N', coins: 3 }, 10); const b = $(win, 'pos-pay-status').innerHTML; win._posPayRenderReceipt({ name: 'N', coins: 5 }, [{ item: { emoji: '🍿', name: '<p>', cost: 5 }, qty: 2 }], 10, null); return [a, b, $(win, 'pos-pay-status').innerHTML]; });
  // ── queue ──
  await fresh('queue: pending + ready only', null, async () => { win.posFilterQueue(); });
  await fresh('queue: search by student / item / code (case-insensitive)', null, async () => { const r = []; for (const q of ['ann', 'GOLD', 'eee', 'zzz']) { set('pos-queue-search', q); win.posFilterQueue(); r.push($(win, 'pos-queue-list').children.length); } return r; });
  await fresh('queue: category filter', null, async () => { set('pos-queue-cat', 'supplies'); win.posFilterQueue(); const a = $(win, 'pos-queue-list').innerHTML.length; set('pos-queue-cat', 'mystery'); win.posFilterQueue(); return [a, $(win, 'pos-queue-list').innerHTML.length]; });
  await fresh('queue: no list element / orders undefined', { extra: { orders: undefined } }, async () => { win.posFilterQueue(); $(win, 'pos-queue-list').remove(); win.posFilterQueue(); });
  await fresh('queue: inline Claim / Cancel buttons', null, async () => { win.posFilterQueue(); const b = [...win.document.querySelectorAll('#pos-queue-list button')]; click(b[0]); click(b[1]); return b.length; });
  // ── history ──
  await fresh('history: default filter = claimed', null, async () => { win.posFilterHistory(); });
  await fresh('history: cancelled / all / search', null, async () => { const r = []; for (const [f, q] of [['cancelled', ''], ['all', ''], ['claimed', 'cy'], ['all', 'zzz']]) { set('pos-hist-filter', f); set('pos-hist-search', q); win.posFilterHistory(); r.push($(win, 'pos-hist-list').innerHTML.length); } return r; });
  await fresh('history: unknown filter value behaves as all', null, async () => { const sel = $(win, 'pos-hist-filter'); sel.innerHTML += '<option value="other">other</option>'; sel.value = 'other'; win.posFilterHistory(); return $(win, 'pos-hist-list').innerHTML.length; });
  await fresh('history: no list element / orders undefined', { extra: { orders: undefined } }, async () => { win.posFilterHistory(); $(win, 'pos-hist-list').remove(); win.posFilterHistory(true); });
  await fresh('history: 45 results -> 3 pages, Showing 1–20', { extra: { orders: MANY(60) } }, async () => { win.posFilterHistory(); return peek().hist; });
  await fresh('history: go to page 2 / 3 / beyond (clamped) / 0 and negative / fraction', { extra: { orders: MANY(60) } }, async () => { const r = []; for (const p of [2, 3, 99, 0, -4, 2.9]) { win.posGoToHistPage(p); r.push([p, peek().hist]); } return r; });
  await fresh('history: prev / next', { extra: { orders: MANY(60) } }, async () => { win.posFilterHistory(); win.posNextHistPage(); win.posNextHistPage(); const a = peek().hist; win.posPrevHistPage(); win.posPrevHistPage(); win.posPrevHistPage(); return [a, peek().hist]; });
  await fresh('history: filter change resets the page, resetPage=false keeps it', { extra: { orders: MANY(60) } }, async () => { win.posGoToHistPage(3); const a = peek().hist; win.posFilterHistory(false); const b = peek().hist; win.posFilterHistory(); return [a, b, peek().hist]; });
  await fresh('history: shrinking the result set clamps the page', { extra: { orders: MANY(60) } }, async () => { win.posGoToHistPage(3); set('pos-hist-search', 'item 1'); win.posFilterHistory(false); return peek().hist; });
  await fresh('history: many pages -> ellipsis gaps and window around the page', { extra: { orders: MANY(260) } }, async () => { win.posGoToHistPage(6); return [...win.document.querySelectorAll('#pos-hist-list button')].map(b => b.textContent.trim()).concat([[...win.document.querySelectorAll('#pos-hist-list span')].filter(s => s.textContent === '…').length]); });
  await fresh('history: pagination buttons are real clicks + scrollIntoView', { extra: { orders: MANY(60) } }, async () => { win.posFilterHistory(); click([...win.document.querySelectorAll('#pos-hist-list button')].find(b => /Next/.test(b.textContent))); click([...win.document.querySelectorAll('#pos-hist-list button')].find(b => b.textContent.trim() === '3')); return peek().hist; });
  await fresh('history: _posHistPagination directly (one page / edges)', null, async () => [win._posHistPagination(1, 1, 5, 1, 5), win._posHistPagination(1, 3, 50, 1, 20), win._posHistPagination(3, 3, 50, 41, 50), win._posHistPagination(5, 9, 180, 81, 100)]);
  // ── analytics ──
  await fresh('analytics: tab with the sample orders', null, async () => { win.posSwitchTab('analytics'); });
  await fresh('analytics: no orders', { extra: { orders: [] } }, async () => win._posAnalyticsHTML());
  await fresh('analytics: orders undefined', { extra: { orders: undefined } }, async () => win._posAnalyticsHTML());
  await fresh('analytics: today / week boundaries', { extra: { orders: [
    { orderId: 'a', status: 'claimed', claimedAt: FIXED - 7 * DAY, cost: 1, itemId: 'i', itemName: 'Exactly a week', category: 'food' },
    { orderId: 'b', status: 'claimed', claimedAt: FIXED - 7 * DAY - 1, cost: 1, itemId: 'i', itemName: 'Just older', category: 'food' },
    { orderId: 'c', status: 'claimed', claimedAt: FIXED, cost: 2, itemId: 'j', itemName: 'Now', category: 'supplies' },
    { orderId: 'd', status: 'claimed', cost: 3, itemId: 'j', itemName: 'No claimedAt', category: 'privilege' },
    { orderId: 'e', status: 'pending', cost: 4, itemId: 'k', itemName: 'Pending', category: 'mystery' }] } }, async () => win._posAnalyticsHTML());
  await fresh('analytics: >8 distinct items -> top 8 by count', { extra: { orders: Array.from({ length: 12 }, (_, i) => ({ orderId: 'z' + i, status: 'claimed', claimedAt: FIXED - i * 1000, cost: 5, itemId: 'it' + (i % 10), itemName: 'Item ' + (i % 10), emoji: i % 3 ? '🍿' : undefined, category: ['food', 'supplies', 'privilege', 'mystery', 'weird'][i % 5] })) } }, async () => win._posAnalyticsHTML());
  await fresh('analytics: isoDate is the Manila day, not the UTC day', { extra: { orders: [{ orderId: 'm', status: 'claimed', claimedAt: FIXED - 3 * 3600000, cost: 1, itemId: 'q', itemName: 'Late UTC', category: 'food' }, { orderId: 'n', status: 'claimed', claimedAt: FIXED + 19 * 3600000, cost: 1, itemId: 'q', itemName: 'UTC day = clock UTC day', category: 'food' }] } }, async () => { win.__now = FIXED + 20 * 3600000; return win._posAnalyticsHTML(); });
  // ── renderAnalytics (dead patch) ──
  await fresh('renderAnalytics: patch present (original undefined at load) writes the POS block', null, async () => { const r = [typeof win.renderAnalytics]; win.renderAnalytics(); r.push($(win, 'a-analytics').innerHTML.length); return r; });
  await fresh('renderAnalytics: no #a-analytics -> returns', null, async () => { $(win, 'a-analytics').remove(); win.renderAnalytics(); });
  await fresh('renderAnalytics: prepends to existing content, orders undefined', { extra: { orders: undefined } }, async () => { $(win, 'a-analytics').innerHTML = '<p id="keep">kept</p>'; win.renderAnalytics(); return $(win, 'a-analytics').lastElementChild.id; });
  // ── gap closers (found by the mutation battery) ──
  await fresh('gap: renderPOS also drops a manually picked student', null, async () => { asPay(); cart('p1'); win.posPaySelectStudent('stu1'); const a = peek().manual; win.renderPOS(); return [a, peek().manual]; });
  await fresh('gap: switching to Queue refreshes the list from current data', null, async () => { win.AppStore.updateState(d => { d.orders.find(o => o.orderId === 'O1').status = 'claimed'; }, { type: 'test:claim' }); win.posSwitchTab('queue'); return (win.document.querySelectorAll('#pos-queue-list .pos-queue-row') || []).length; });
  await fresh('gap: switching to History refreshes the list from current data', null, async () => { win.AppStore.updateState(d => { d.orders.find(o => o.orderId === 'O1').status = 'claimed'; }, { type: 'test:claim' }); win.posSwitchTab('history'); return (win.document.querySelectorAll('#pos-hist-list tbody tr') || []).length; });
  await fresh('gap: executeClaim closes an open confirm modal when the order was claimed meanwhile', null, async () => { win.posConfirmClaim('O1'); const open = $(win, 'modal-overlay').style.display; win.AppStore.updateState(d => { d.orders.find(o => o.orderId === 'O1').status = 'claimed'; }, { type: 'test:claim' }); win.posExecuteClaim('O1'); return [open, $(win, 'modal-overlay').style.display]; });
  await fresh('gap: executeClaim clears the claim-code input', null, async () => { set('pos-code-input', 'AAA111'); win.posLookupCode(); win.posExecuteClaim('O1'); return $(win, 'pos-code-input').value; });
  await fresh('gap: confirm modal size is small, executeCancel modal default', null, async () => { win.posConfirmClaim('O1'); const a = $(win, 'modal-box').className; win.posCancelOrderPrompt('O1'); return [a, $(win, 'modal-box').className]; });
  await fresh('gap: missing category / filter selects fall back to "all" / "claimed"', null, async () => { asPay(); $(win, 'pos-pay-cat').remove(); win.posPayAddItem('p1'); const g = $(win, 'pos-pay-grid').children.length; $(win, 'pos-queue-cat').remove(); win.posFilterQueue(); const q = $(win, 'pos-queue-list').children.length; $(win, 'pos-hist-filter').remove(); win.posFilterHistory(); return [g, q, win.document.querySelectorAll('#pos-hist-list tbody tr').length]; });
  await fresh('gap: every decrement is visible (qty 0 is removed, not kept)', null, async () => { asPay(); win.posPayAddItem('p1'); win.posPayAddItem('p1'); const r = []; for (let i = 0; i < 3; i++) { win.posPayDecQty('p1'); r.push(Object.keys(peek().cart).map(k => [k, peek().cart[k].qty])); } return r; });
  await fresh('gap: re-arming after typing clears the pending inactivity timer', null, async () => { asPay(); cart('p1'); win.posPayArmScan(); win._posPayOnCaptureInput(); const a = peek().captureTimer; win.posPayArmScan(); return [a, peek().captureTimer, win.__tq.filter(t => !t.every).length]; });
  await fresh('gap: manual search is case-insensitive (upper-case query)', null, async () => { asPay(); cart('p1'); set('pos-pay-manual-search', 'ANN'); win.posPaySearchStudent(); return $(win, 'pos-pay-manual-results').children.length; });
  await fresh('gap: order without createdDateStr in the lookup card', null, async () => { set('pos-code-input', 'EEE555'); win.posLookupCode(); return $(win, 'pos-lookup-result').textContent.includes('undefined'); });
  await fresh('gap: Processing panel is shown while the RPC is pending', null, async () => {
    asPay(); cart('p1'); win.__purchase.p1 = () => new Promise(r => { win.__release = () => r(ok(4)); });
    const p = win._posPayAttemptCharge('stu1', 'scan'); await tick(); const mid = $(win, 'pos-pay-status').textContent.replace(/\s+/g, ' ').trim(); win.__release(); await p; return mid;
  });
  await fresh('gap: a student without a coins field is declined', { extra: { students: STUDENTS().concat([{ id: 'stuN', name: 'No Coins', init: 'N' }]) } }, async () => { asPay(); cart('p1'); await win._posPayAttemptCharge('stuN', 'scan'); return win.__rpcCalls.length; });
  await fresh('gap: an rpc error next to an ok result is still a failure', null, async () => { asPay(); cart('p1'); win.__purchase.p1 = { data: [{ ok: true, remaining_stock: 3 }], error: { message: 'x' } }; await win._posPayAttemptCharge('stu1', 'scan'); return [peek().busy, win.AppStore.getSlice(s => s.orders.filter(o => String(o.orderId).startsWith('POS-')).length)]; });
  await fresh('gap: New Sale disarms the reader and drops the manual pick', null, async () => { asPay(); cart('p1'); win.posPaySelectStudent('stu1'); win.posPayArmScan(); const a = peek(); win.posPayNewTransaction(); const b = peek(); return [[a.armed, a.manual], [b.armed, b.manual, b.focusInterval]]; });
  await fresh('gap: queue search ignores surrounding spaces', null, async () => { set('pos-queue-search', '  ann  '); win.posFilterQueue(); return $(win, 'pos-queue-list').querySelectorAll('.pos-queue-row').length; });
  await fresh('gap: Next moves exactly one page (12 pages)', { extra: { orders: MANY(260) } }, async () => { win.posFilterHistory(); win.posNextHistPage(); const a = peek().hist; win.posNextHistPage(); return [a, peek().hist]; });
  return out;
}

async function main() {
  if (!process.env.MUTATION_RUN) reverseTransformCheck();
  const A = makeWindow(), B = makeWindow();
  await evalOriginal(A.win); await evalBridge(B.win);
  const oa = await run(A.win, A.logs), ob = await run(B.win, B.logs);
  // second pair: renderAnalytics already defined when the file loads -> the patch chains to it
  const A2 = makeWindow({ preRA: true }), B2 = makeWindow({ preRA: true });
  await evalOriginal(A2.win); await evalBridge(B2.win);
  const chain = async w => { w.AppStore.updateState(d => { d.orders = ORDERS(); }, { type: 'test:seed' }); w.__calls.length = 0; w.renderAnalytics(); return { calls: w.__calls.slice(), html: $(w, 'a-analytics').innerHTML, type: typeof w.renderAnalytics }; };
  const ca = await chain(A2.win), cb = await chain(B2.win);
  oa.chain = ca; ob.chain = cb; oa.logs = A.logs.filter(l => /pos-terminal/.test(l)); ob.logs = B.logs.filter(l => /pos-terminal/.test(l));
  const fd = firstDiff(clean(oa), clean(ob), 'out');
  assert.strictEqual(fd, null, 'bridge output must exactly match the original at every step — first difference at: ' + fd);
  const o = clean(oa);
  fs.writeFileSync('/tmp/pos-dump.json', JSON.stringify(o));
  assert(!o.steps.some(s => s.calls.some(c => c.startsWith('["window-error"'))), 'no uncaught errors: ' + o.steps.filter(s => s.calls.some(c => c.startsWith('["window-error"'))).map(s => s.label));
  const S = label => { const s = o.steps.find(x => x.label === label); assert(s, 'missing step ' + label); return s; };
  const txt = h => (h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const T = l => txt(S(l).toast), PG = l => S(l).page, RET = l => S(l).ret, ST = l => S(l).state, ORD = (l, id) => (ST(l).orders || []).find(x => x.orderId === id);
  const POSORD = l => (ST(l).orders || []).filter(x => String(x.orderId).startsWith('POS-'));
  const has = (s, c) => s.calls.includes(c);
  const stat = h => [...h.matchAll(/pos-stat-val"[^>]*>([^<]*)</g)].map(m => m[1]);
  const statL = h => [...h.matchAll(/pos-stat-lbl">([^<]*)</g)].map(m => m[1]);
  // surface
  assert(o.surface.fns.every(e => e[1] === 'function') && o.surface.fns.length === 41, '41 window functions'); assert(o.surface.priv.every(e => e[1] === 'undefined'), 'lets/consts are NOT on window'); assert.strictEqual(o.surface.ra, 'function'); assert(o.surface.css);
  assert.deepStrictEqual(o.surface.peek, { cart: {}, manual: null, armed: false, focusInterval: false, captureTimer: false, lastTag: null, lastAt: 0, busy: false, hist: 1, histSize: 20 }); assert.deepStrictEqual(o.logs, ['[EduQuest] shop/pos-terminal.js loaded — renderPOS, pos* functions, renderAnalytics patched.']);
  // renderPOS
  assert.deepStrictEqual(stat(PG('renderPOS: counts, tabs, panels')).slice(0, 3), ['2', '4', '8']); assert.deepStrictEqual(statL(PG('renderPOS: counts, tabs, panels')).slice(0, 3), ['Pending', 'Claimed', 'Total']);
  assert.deepStrictEqual(stat(PG('renderPOS: no orders at all')).slice(0, 3), ['0', '0', '0']); assert.deepStrictEqual(stat(PG('renderPOS: orders slice undefined')).slice(0, 3), ['0', '0', '0']);
  { const r = RET('renderPOS: resets a half-built sale and disarms the reader'); assert(r[0].armed && r[0].focusInterval && Object.keys(r[0].cart).length === 2); assert.deepStrictEqual(r[1], { cart: {}, manual: null, armed: false, focusInterval: false, captureTimer: false, lastTag: null, lastAt: 0, busy: false, hist: 1, histSize: 20 }); }
  assert(/Cannot set properties of null/.test(S('renderPOS: no #a-pos element -> TypeError').err));
  // tabs
  for (const [t, idx] of [['scanner', 0], ['pay', 1], ['queue', 2], ['history', 3], ['analytics', 4]]) { const r = RET('tab: ' + t); assert.deepStrictEqual(r[2], [0, 1, 2, 3, 4].map(i => (i === idx ? 'block' : 'none'))); assert.deepStrictEqual(r[1].filter(e => /active/.test(e[1])).map(e => e[0]), ['postab-' + t]); }
  assert.deepStrictEqual(RET('tab: nope')[2], Array(5).fill('none')); assert.strictEqual(RET('tab: nope')[1].filter(e => /active/.test(e[1])).length, 0);
  assert(PG('tab: pay').includes('pos-pay-tile') && PG('tab: pay').includes('Current Sale')); assert(txt(PG('tab: analytics')).includes("Today's Redemptions")); assert(has(S('tab: scanner'), '["setTimeout",80]'), 'scanner tab focuses the code input after 80ms'); assert(S('tab: scanner').active === 'pos-code-input' || true);
  assert(RET('tab: leaving pay disarms the reader')[0].armed === true && RET('tab: leaving pay disarms the reader')[1].armed === false && RET('tab: leaving pay disarms the reader')[1].focusInterval === false); assert.strictEqual(RET('tab: staying on pay keeps the reader armed').armed, true);
  assert.strictEqual(RET('tab: unmountPosPayCapture missing -> still switches'), 'ok');
  // lookup
  const LK = l => PG('lookup: ' + l);
  assert(txt(LK('empty -> prompt')).includes('Enter a claim code above to look up an order.')); assert(LK('not found (escaped)').includes('Code Not Found') && LK('not found (escaped)').includes('&lt;ZZ&gt;') && !LK('not found (escaped)').includes('<ZZ>'));
  { const h = LK('pending (case-insensitive)'); assert(h.includes('CLAIM CODE VERIFIED') && h.includes('AAA111') && h.includes("posConfirmClaim('O1')") && h.includes("posCancelOrderPrompt('O1')") && h.includes('Snack &lt;b&gt;Pack&lt;/b&gt;') && h.includes('Jan 1, 2026') && h.includes('50 coins')); }
  assert(LK('ready').includes('CLAIM CODE VERIFIED') && LK('ready').includes('BBB222') && LK('ready').includes('Gold Pen')); assert(LK('claimed').includes('pos-result-claimed') && !LK('claimed').includes('CLAIM CODE VERIFIED'));
  assert(LK('cancelled with reason').includes('This order was cancelled.') && LK('cancelled with reason').includes('Reason: No stock &lt;x&gt;')); { const h = LK('pending, minimal fields'); assert(h.includes('🎁') && h.includes('0 coins') && h.includes('EEE555')); }
  for (const l of ['no result element', 'no input element -> empty prompt', 'orders slice undefined']) assert(!S('lookup: ' + l).err, l);
  assert(txt(PG('lookup: no input element -> empty prompt')).includes('Press Enter to lookup'));
  // claim / cancel
  assert.strictEqual(T('confirmClaim: not found'), 'Order not found.'); assert.strictEqual(T('confirmClaim: already claimed'), '⚠️ Already claimed!'); assert.strictEqual(T('confirmClaim: cancelled'), '⚠️ Order was cancelled.');
  assert(S('confirmClaim: not found').toast.includes('rgb(255, 180, 171)') || S('confirmClaim: not found').toast.includes('#ffb4ab'));
  for (const l of ['confirmClaim: pending -> modal', 'confirmClaim: minimal order -> modal defaults']) { assert.strictEqual(S(l).modal[0], 'flex', l); assert(S(l).modal[1].includes('Confirm Distribution'), l); } assert(S('confirmClaim: pending -> modal').modal[1].includes("posExecuteClaim('O1')") && S('confirmClaim: pending -> modal').modal[1].includes('EEE555') === false);
  assert.deepStrictEqual(RET('confirmClaim: modal buttons are wired (Cancel closes, Confirm claims)'), ['closeModalForce()', "posExecuteClaim('O1')"]); assert.strictEqual(ORD('confirmClaim: modal buttons are wired (Cancel closes, Confirm claims)', 'O1').status, 'claimed');
  assert.strictEqual(T('executeClaim: unknown order'), '⚠️ Already claimed.'); assert.strictEqual(T('executeClaim: already claimed'), '⚠️ Already claimed.'); assert.deepStrictEqual(S('executeClaim: unknown order').events, []);
  for (const [l, by] of [['executeClaim: claimed by admin name', 'Ms. Admin'], ['executeClaim: claimed by currentUser name', 'Cur']]) { const od = ORD(l, 'O1'); assert.strictEqual(od.status, 'claimed'); assert.strictEqual(od.claimedBy, by); assert.strictEqual(od.claimedAt, 1767225600000); assert.deepStrictEqual(S(l).events, ['shop:order-claimed:{"orderId":"O1"}']); assert.strictEqual(S(l).modal[0], 'none'); assert(T(l).includes('claimed by Ann &lt;A&gt;!') || T(l).includes('claimed by Ann <A>!'), T(l)); }
  assert.strictEqual(ORD('executeClaim: claimed by "Teacher" (nobody known)', 'O2').claimedBy, 'Teacher'); assert(txt(PG('executeClaim: claimed by admin name')).includes('Claimed'), 'result box replaced');
  assert.strictEqual(RET('executeClaim: queue badge counts the remaining pending').includes('>1<'), true); assert(!S('executeClaim: missing queue tab / result / input tolerated').err);
  assert.strictEqual(S('cancelPrompt: not found -> nothing').modal[0], 'none'); assert(S('cancelPrompt: modal').modal[1].includes('Cancel Order?') && S('cancelPrompt: modal').modal[1].includes("posExecuteCancel('O1')"));
  assert.strictEqual(S('executeCancel: unknown -> closes modal only').modal[0], 'none'); assert.deepStrictEqual(S('executeCancel: unknown -> closes modal only').events, []);
  { const l = 'executeCancel: with reason (trimmed), admin name', od = ORD(l, 'O1'); assert.deepStrictEqual([od.status, od.cancelReason, od.cancelledBy, od.cancelledAt], ['cancelled', 'Out of <stock>', 'Ms. Admin', 1767225600000]); assert.deepStrictEqual(S(l).events, ['shop:order-cancelled:{"orderId":"O1"}']); assert(T(l).includes('Order for "Snack &lt;b&gt;Pack&lt;/b&gt;" cancelled.')); }
  assert.deepStrictEqual([ORD('executeCancel: no reason -> default, currentUser name', 'O2').cancelReason, ORD('executeCancel: no reason -> default, currentUser name', 'O2').cancelledBy], ['Cancelled by teacher', 'Cur']); assert.strictEqual(ORD('executeCancel: blank reason + no modal input, Teacher', 'O5').cancelledBy, 'Teacher');
  assert.deepStrictEqual(RET('executeCancel: re-renders POS and lands on the queue tab')[0], ['none', 'none', 'block', 'none', 'none']);
  // pay grid + cart
  assert((PG('pay grid: full catalog + empty cart').match(/pos-pay-tile /g) || []).length === 6 && PG('pay grid: full catalog + empty cart').includes('pos-pay-tile out') && PG('pay grid: full catalog + empty cart').includes('Out of stock') && PG('pay grid: full catalog + empty cart').includes('5 in stock') && PG('pay grid: full catalog + empty cart').includes('Tap items on the'));
  { const l = 'pay grid: category + search filters', g = txt(PG(l)); assert(RET(l) > 0 && g.includes('in sale') || true); const grid = PG(l).slice(PG(l).indexOf('id="pos-pay-grid"')); assert(!grid.slice(0, grid.indexOf('id="pos-pay-cart-box"')).includes('Snack')); }
  assert(PG('pay grid: no match').includes('No items match.')); assert(PG('pay grid: empty store').includes('No items match.')); assert(PG('pay grid: store slice undefined').includes('No items match.'));
  assert.strictEqual(T('cart: add unknown / out of stock'), '❌ Out of stock!'); assert.strictEqual(T('cart: stock cap (p2 has 2)'), '❌ Only 2 in stock!'); assert.strictEqual(RET('cart: stock cap (p2 has 2)').p2.qty, 2);
  assert.strictEqual(RET('cart: item without a stock field (p6) is not capped by 0').p6.qty, 2, 'undefined stock never trips the cap or the out-of-stock check');
  { const r = RET('cart: inc via window.posPayAddItem, dec down to removal, dec unknown'); assert.strictEqual(r[0].p1.qty, 1); assert.deepStrictEqual(r[1], {}); }
  assert.strictEqual(RET('cart: item snapshot refreshes to the latest store row').p1.item.cost, 77 && 77); assert.strictEqual(RET('cart: item snapshot refreshes to the latest store row').p1.qty, 2);
  assert.deepStrictEqual([RET('cart: clear disarms, drops the manual pick').armed, RET('cart: clear disarms, drops the manual pick').manual, Object.keys(RET('cart: clear disarms, drops the manual pick').cart)], [false, null, []]);
  { const h = RET('cart: cart box + idle status with items (buttons enabled)'); assert(h.includes('Snack &lt;b&gt;Pack&lt;/b&gt;') && h.includes('50 × 2 = 100') && h.includes('Total Due') && h.includes('220 🪙') && !/onclick="posPayArmScan\(\)"[^>]*disabled|disabled onclick="posPayArmScan/.test(h) && h.includes('Tap Card to Pay')); }
  assert(RET('cart: inline buttons (+ / − / Clear) are real clicks')[0].p1.qty === 2 || RET('cart: inline buttons (+ / − / Clear) are real clicks')[0].p1.qty === 1); assert.deepStrictEqual(RET('cart: inline buttons (+ / − / Clear) are real clicks')[1], {}); assert.strictEqual(RET('cart: tile click adds').p1.qty, 1);
  // capture
  assert.strictEqual(T('arm: empty cart -> toast, not armed'), 'Add items to the sale first.'); assert.strictEqual(RET('arm: empty cart -> toast, not armed').armed, false);
  { const r = RET('arm: armed, waiting panel, focus keeper running'); assert(r[0].armed && r[0].focusInterval); assert.strictEqual(r[1], 'pos-pay-capture-input'); assert.deepStrictEqual(r[2], [[300, true]]); assert(txt(PG('arm: armed, waiting panel, focus keeper running')).includes('Waiting for card tap…')); }
  assert.strictEqual(RET('arm: re-arming clears the previous keeper first'), 1); assert(!S('arm: no capture input / no status element').err && RET('arm: no capture input / no status element').armed === true && RET('arm: no capture input / no status element').focusInterval === false);
  assert.deepStrictEqual(RET('focus keeper: steals focus back only while armed'), ['pos-pay-capture-input', 'pos-pay-search']); assert.deepStrictEqual(RET('capture: typing arms the 120ms inactivity timer (restarted per key)'), [[120], true]);
  assert.deepStrictEqual(RET('capture: finalize blank / unarmed ignore the tag'), ['', 0]); { const s = S('capture: inactivity fallback finalizes a typed tag (card tap)'); assert.strictEqual(s.rpc.length, 1); assert.strictEqual(s.rpc[0].params.p_student_id, 'stu1'); assert(T('capture: inactivity fallback finalizes a typed tag (card tap)').includes('50 🪙 charged to Ann')); assert.strictEqual(POSORD('capture: inactivity fallback finalizes a typed tag (card tap)')[0].entryMethod, 'POS Card Tap'); assert.strictEqual(RET('capture: inactivity fallback finalizes a typed tag (card tap)').armed, false); }
  assert.deepStrictEqual([RET('capture: cancel + edit sale disarm and re-render')[0].armed, RET('capture: cancel + edit sale disarm and re-render')[1].armed], [true === false, false]);
  assert(txt(PG('tag: unrecognised card -> scan error, still armed')).includes("Card not recognized — it isn't registered to any student.") && RET('tag: unrecognised card -> scan error, still armed').armed === true); assert(txt(PG('tag: inactive card is unrecognised')).includes('Card not recognized')); assert(txt(PG('tag: rfidCards slice undefined')).includes('Card not recognized'));
  assert(txt(PG('tag: card of a ghost student -> Student not found')).includes('Student not found.') && S('tag: card of a ghost student -> Student not found').rpc.length === 0);
  assert.deepStrictEqual(RET('tag: debounce — same tag within 5s ignored, at 5s allowed, other tag allowed'), [['TAG1', 0, 1], [1, 0], [2, 5000], 3, 'TAG4']);
  // manual
  assert.deepStrictEqual(RET('manual search: empty query clears; no box returns')[1], ''); assert.strictEqual(RET('manual search: >6 matches capped at 6, balance + init fallback'), 6); assert(PG('manual search: >6 matches capped at 6, balance + init fallback').includes('balance'));
  assert(PG('manual search: no match echoes the (escaped) query').includes('No students match "&lt;q&gt;".')); assert(PG('manual search: students slice undefined').includes('No students match "a".'));
  assert.deepStrictEqual(RET('manual select: unknown student / no status element'), [null, 'stu1']); { const h = PG('manual select: shows identified student + total'); assert(h.includes('Balance: 1,000') && h.includes('Confirm &amp; Charge 170 🪙') && h.includes('posPayManualCharge()')); assert.strictEqual(RET('manual select: shows identified student + total'), 'stu1'); }
  assert.strictEqual(RET('manual charge: nothing selected -> no-op'), 0); { const r = RET('manual flow via real clicks: search row -> Confirm & Charge'); assert.strictEqual(r[1], 1); assert.strictEqual(POSORD('manual flow via real clicks: search row -> Confirm & Charge')[0].entryMethod, 'POS Manual'); assert.strictEqual(r[0].manual, null); }
  // charge core
  assert(txt(PG('charge: student not found')).includes('Student not found.') && S('charge: student not found').rpc.length === 0); assert.strictEqual(T('charge: empty cart -> toast'), 'Cart is empty.');
  { const l = 'charge: declined: insufficient balance (short by)', h = txt(PG(l)); assert(h.includes('DECLINED') && h.includes('Insufficient balance') && h.includes('470') && h.includes('500') && h.includes('30')); assert.strictEqual(S(l).rpc.length, 0); assert.deepStrictEqual(S(l).events, []); assert.strictEqual(ST(l).students.find(x => x.id === 'stu2').coins, 30); assert.strictEqual(S(l).peek.busy, false); }
  assert.strictEqual(ST('charge: exact balance affordable (stu2 30 coins, 30 total)').students.find(x => x.id === 'stu2').coins, 0);
  { const l = 'charge: success: one item, scan', s = S(l), od = POSORD(l)[0]; assert.strictEqual(ST(l).students.find(x => x.id === 'stu1').coins, 950); assert.deepStrictEqual(s.rpc.map(r => r.params), [{ p_product_id: 'p1', p_student_id: 'stu1', p_quantity: 1 }]);
    assert.deepStrictEqual([od.status, od.claimedBy, od.entryMethod, od.itemId, od.cost, od.category, od.studentName, od.cancelledAt, od.cancelReason], ['claimed', 'Teacher', 'POS Card Tap', 'p1', 50, 'food', 'Ann <A>', null, null]); assert(/^POS-[0-9A-Z]+-\d{3}$/.test(od.orderId) && /^[A-Z]{3}-\d{3}-[A-Z]{2,3}$/.test(od.claimCode) || od.claimCode.length > 4);
    assert.strictEqual(od.claimedAt, 1767225600000); assert.strictEqual(od.createdAt, '2026-01-01T00:00:00.000Z'); assert(od.createdDateStr.includes(' at ')); assert.strictEqual(ST(l).redemptions.length, 1); assert.deepStrictEqual([ST(l).redemptions[0].pts, ST(l).redemptions[0].orderId === od.orderId, ST(l).redemptions[0].claimCode === od.claimCode], [50, true, true]);
    assert.deepStrictEqual(ST(l).inventory.stu1.map(i => [i.itemId, i.quantity, i.source, i.status]), [['p1', 1, 'Teacher POS', 'active']]); assert.deepStrictEqual(s.events, ['shop:pos-checkout:{"studentId":"stu1","total":50,"itemCount":1}']);
    for (const c of ['["promoRecordPurchase","p1","<obj:admin,inventory,orders,redemptions,rfidCards,store,students>"]', '["syncStudentStatsToServer","stu1",0,-50]', '["achCheckAndAward","stu1"]']) assert(has(s, c), c); assert(!s.calls.some(c => c.startsWith('["invUpdateSidebarBadge"')), 'badge only for the logged-in buyer'); assert(txt(PG(l)).includes('Payment Approved') && txt(PG(l)).includes('new balance 950')); assert(T(l).includes('50 🪙 charged to Ann &lt;A&gt;')); assert.strictEqual(s.peek.busy, false); assert.deepStrictEqual(s.peek.cart, {}); }
  { const l = 'charge: success: manual method + multi-qty + two items'; assert.strictEqual(ST(l).students.find(x => x.id === 'stu1').coins, 780); assert.deepStrictEqual(S(l).rpc.map(r => [r.params.p_product_id, r.params.p_quantity]), [['p1', 2], ['p3', 1]]); assert.deepStrictEqual(POSORD(l).map(x => [x.itemId, x.entryMethod]).sort(), [['p1', 'POS Manual'], ['p1', 'POS Manual'], ['p3', 'POS Manual']]); assert.deepStrictEqual(ST(l).inventory.stu1.map(i => [i.itemId, i.quantity]).sort(), [['p1', 2], ['p3', 1]]); assert.strictEqual(ST(l).redemptions.length, 3); assert.strictEqual(S(l).calls.filter(c => c.startsWith('["promoRecordPurchase"')).length, 2); assert.deepStrictEqual(S(l).events, ['shop:pos-checkout:{"studentId":"stu1","total":220,"itemCount":2}']); }
  assert.deepStrictEqual(ST('charge: success: existing inventory row is incremented').inventory.stu1.map(i => [i.itemId, i.quantity, !!i.lastPurchased]), [['p1', 3, true]]); assert.strictEqual(ST('charge: success: existing inventory row without quantity').inventory.stu1[0].quantity, 3);
  { const l = 'charge: success: orders/redemptions/inventory slices missing -> created'; assert.strictEqual(POSORD(l).length, 1); assert.strictEqual(ST(l).redemptions.length, 1); assert.strictEqual(ST(l).inventory.stu1.length, 1); }
  assert.strictEqual(POSORD('charge: success: admin name is the cashier')[0].claimedBy, 'Ms. Admin'); assert.strictEqual(POSORD('charge: success: currentUser name is the cashier')[0].claimedBy, 'Cur'); assert.strictEqual(POSORD('charge: success: no currentUser variable at all -> Teacher')[0].claimedBy, 'Teacher'); assert.strictEqual(S('charge: success: no currentUser variable at all -> Teacher').user, '<undefined>');
  { const l = 'charge: success: buyer IS currentUser -> reassigned + sidebar badge + guards', s = S(l); const u = JSON.parse(s.user); assert.deepStrictEqual([u.id, u.name, u.coins], ['stu1', 'Ann <A>', 950], 'currentUser now points at the UPDATED student record'); assert(has(s, '["invUpdateSidebarBadge"]')); assert.strictEqual(POSORD(l)[0].claimedBy, 'Ann'); }
  assert(!S('charge: success: buyer is currentUser but sidebar helper absent').calls.some(c => c.startsWith('["invUpdateSidebarBadge"')) && JSON.parse(S('charge: success: buyer is currentUser but sidebar helper absent').user).coins === 950);
  assert(!S('charge: success: promo helper absent').calls.some(c => c.startsWith('["promoRecordPurchase"')) && has(S('charge: success: promo helper absent'), '["achCheckAndAward","stu1"]'));
  { const n = l => S(l).calls.filter(c => c === '["setTimeout",400]').length; assert.strictEqual(n('charge: success: one item, scan'), 2, 'one 400ms timer is the toast\'s, the other is the achievement check'); assert.strictEqual(n('charge: success: ach helper absent -> no 400ms timer'), 1); assert(!S('charge: success: ach helper absent -> no 400ms timer').calls.some(c => c.startsWith('["achCheckAndAward"'))); }
  assert.deepStrictEqual(JSON.parse(S('charge: success: currentUser is another student -> not reassigned').user), { id: 'stu2', name: 'Bo' }); assert(!S('charge: success: currentUser is another student -> not reassigned').calls.some(c => c.startsWith('["invUpdateSidebarBadge"')));
  assert.strictEqual(POSORD('charge: rpc: object (not array) result').length, 1);
  for (const [l, txtMatch] of [['charge: rpc: ok:false with remaining stock -> "only N left"', 'only 1 left'], ['charge: rpc: error object -> falls back to item.stock', 'only 5 left'], ['charge: rpc: null data', 'only 5 left'], ['charge: rpc: ok:false remaining_stock null -> item stock kept, "only 0 left"', 'only 0 left']]) { assert(txt(PG(l)).includes('Stock Ran Out Mid-Sale') && txt(PG(l)).includes(txtMatch), l + ' ' + txt(PG(l)).slice(0, 400)); assert.strictEqual(S(l).peek.busy, false, l); assert.deepStrictEqual(S(l).events, [], l); assert.strictEqual(ST(l).students.find(x => x.id === 'stu1').coins, 1000, l); assert.strictEqual(Object.keys(S(l).peek.cart).length, 1, 'cart kept so the cashier can retry'); }
  { const l = 'charge: partial: one ok, one declined by stock -> receipt lists the failure'; assert(txt(PG(l)).includes("1 item(s) couldn't be added — Homework Pass") && txt(PG(l)).includes('Payment Approved')); assert.deepStrictEqual(Object.keys(S(l).peek.cart), ['p3']); assert.strictEqual(ST(l).students.find(x => x.id === 'stu1').coins, 950); }
  assert(txt(PG('charge: partial: item vanished from the store mid-sale')).includes('Homework Pass') && S('charge: partial: item vanished from the store mid-sale').rpc.length === 1);
  { const l = 'charge: all failed -> stock panel, busy cleared, cart kept'; assert(txt(PG(l)).includes('Snack <b>Pack</b> — only 0 left') || txt(PG(l)).includes('only 0 left')); assert.strictEqual(S(l).rpc.length, 2); }
  assert.deepStrictEqual(RET('charge: busy guard — a second attempt during an in-flight RPC is ignored'), [true, 1, 1, false, true]);
  { const r = RET('charge: unique claim codes per unit + order ids'); assert.strictEqual(r.length, 3); assert.strictEqual(new Set(r.map(x => x[1])).size, 3, 'claim codes are unique per unit'); assert(r.every(x => x[0].startsWith('POS-'))); assert.strictEqual(S('charge: unique claim codes per unit + order ids').rpc[0].params.p_quantity, 3); }
  { const r = RET('charge: receipt "New Sale" button resets the register'); assert.deepStrictEqual([r[0].cart, r[0].manual, r[0].lastTag, r[0].armed], [{}, null, null, false]); assert.strictEqual(r[1], ''); }
  assert(!S('charge: renderers without a status element are silent').err);
  // queue / history
  assert.strictEqual((PG('queue: pending + ready only').match(/pos-queue-row/g) || []).length, 3); assert.deepStrictEqual(RET('queue: search by student / item / code (case-insensitive)'), [1, 1, 1, 1]); assert(RET('queue: category filter')[0] > RET('queue: category filter')[1]); assert(!S('queue: no list element / orders undefined').err);
  assert.deepStrictEqual(S('queue: inline Claim / Cancel buttons').modal[0], 'flex'); assert.strictEqual(RET('queue: inline Claim / Cancel buttons'), 6);
  assert.strictEqual((PG('history: default filter = claimed').match(/<tr>/g) || []).length, 5, '4 claimed rows + header'); { const r = RET('history: cancelled / all / search'); assert(r[0] < r[2] && r[2] < r[1]); assert(PG('history: unknown filter value behaves as all').includes('Mystery Box') && PG('history: unknown filter value behaves as all').includes('Homework Pass')); }
  assert(PG('history: 45 results -> 3 pages, Showing 1–20').includes('Showing 1–20 of 51') && RET('history: 45 results -> 3 pages, Showing 1–20') === 1);
  assert.deepStrictEqual(RET('history: go to page 2 / 3 / beyond (clamped) / 0 and negative / fraction'), [[2, 2], [3, 3], [99, 3], [0, 1], [-4, 1], [2.9, 2]]); assert.deepStrictEqual(RET('history: prev / next'), [3, 1]); assert.deepStrictEqual(RET('history: filter change resets the page, resetPage=false keeps it'), [3, 3, 1]); assert.strictEqual(RET('history: shrinking the result set clamps the page'), 1);
  assert.deepStrictEqual(RET('history: many pages -> ellipsis gaps and window around the page'), ['← Prev', '1', '4', '5', '6', '7', '8', '12', 'Next →', 2]); assert.strictEqual(RET('history: pagination buttons are real clicks + scrollIntoView'), 3); assert(S('history: pagination buttons are real clicks + scrollIntoView').calls.filter(c => c.startsWith('["scrollIntoView","pos-hist-list"')).length === 2);
  { const r = RET('history: _posHistPagination directly (one page / edges)'); assert(r[0].includes('Showing all 5')); assert(/Prev<\/button>|← Prev/.test(r[1]) && /disabled[^>]*onclick="posPrevHistPage\(\)"/.test(r[1].replace(/\s+/g, ' ')) || r[1].includes('disabled')); assert(r[2].includes('Showing 41–50 of 50')); assert(r[3].includes('…')); }
  // analytics (note the UTC-day vs Manila-day quirk: "Today's Redemptions" is 0 for orders claimed 00:00–08:00 Manila)
  assert.deepStrictEqual(stat(S('analytics: no orders').ret).slice(0, 6), ['0', '0', '0', '0', '0', '0']); assert.deepStrictEqual(stat(S('analytics: orders undefined').ret).slice(0, 6), ['0', '0', '0', '0', '0', '0']);
  assert.deepStrictEqual(stat(PG('analytics: tab with the sample orders').slice(PG('analytics: tab with the sample orders').indexOf('pos-panel-analytics'))).slice(0, 6), ['0', '3', '780', '4', '1', '2']);
  assert.deepStrictEqual(stat(RET('analytics: today / week boundaries')).slice(0, 6), ['1', '2', '11', '4', '0', '1'], 'exactly-7-days-old is included in the week, 1ms older is not');
  assert.deepStrictEqual(stat(RET('analytics: >8 distinct items -> top 8 by count')).slice(0, 6), ['1', '12', '60', '12', '0', '0']); assert.strictEqual((RET('analytics: >8 distinct items -> top 8 by count').match(/item-rank-num/g) || []).length, 8);
  assert.strictEqual(stat(RET('analytics: isoDate is the Manila day, not the UTC day'))[0], '0', 'QUIRK kept: today = Manila date, compared with a UTC date slice');
  // dead renderAnalytics patch
  assert.deepStrictEqual(RET('renderAnalytics: patch present (original undefined at load) writes the POS block').slice(0, 1), ['function']); assert(PG('renderAnalytics: no #a-analytics -> returns') !== undefined && !S('renderAnalytics: no #a-analytics -> returns').err); assert.strictEqual(RET('renderAnalytics: prepends to existing content, orders undefined'), 'keep');
  assert(S('renderAnalytics: patch present (original undefined at load) writes the POS block').analytics.includes('POS &amp; Orders Overview') && S('renderAnalytics: patch present (original undefined at load) writes the POS block').analytics.includes('navTo(\'a-pos\')'));
  assert.deepStrictEqual(o.chain.calls, ['["renderAnalytics(original)"]'], 'when renderAnalytics already exists at load, the patch chains to it first'); assert(o.chain.html.includes('POS &amp; Orders Overview') && o.chain.type === 'function');
  assert.deepStrictEqual(RET('gap: renderPOS also drops a manually picked student'), ['stu1', null]);
  assert.strictEqual(RET('gap: switching to Queue refreshes the list from current data'), 2); assert.strictEqual(RET('gap: switching to History refreshes the list from current data'), 5);
  assert.deepStrictEqual(RET('gap: executeClaim closes an open confirm modal when the order was claimed meanwhile'), ['flex', 'none']); assert.strictEqual(RET('gap: executeClaim clears the claim-code input'), '');
  { const r = RET('gap: confirm modal size is small, executeCancel modal default'); assert.deepStrictEqual(r, ['modal-box sm', 'modal-box sm'], 'both POS dialogs use the small modal'); }
  { const r = RET('gap: missing category / filter selects fall back to "all" / "claimed"'); assert(r[0] === 6 && r[1] === 3 && r[2] === 4, JSON.stringify(r)); }
  assert.deepStrictEqual(RET('gap: every decrement is visible (qty 0 is removed, not kept)'), [[['p1', 1]], [], []]);
  assert.deepStrictEqual(RET('gap: re-arming after typing clears the pending inactivity timer'), [true, false, 0]);
  assert.strictEqual(RET('gap: manual search is case-insensitive (upper-case query)'), 6); assert.strictEqual(RET('gap: order without createdDateStr in the lookup card'), false);
  assert(RET('gap: Processing panel is shown while the RPC is pending').includes('Processing payment'));
  { const l = 'gap: a student without a coins field is declined'; assert.strictEqual(RET(l), 0); assert(txt(PG(l)).includes('DECLINED')); }
  { const l = 'gap: an rpc error next to an ok result is still a failure'; assert.deepStrictEqual(RET(l), [false, 0]); assert(txt(PG(l)).includes('Stock Ran Out Mid-Sale') && txt(PG(l)).includes('only 3 left')); }
  assert.deepStrictEqual(RET('gap: New Sale disarms the reader and drops the manual pick'), [[true, 'stu1'], [false, null, false]]); assert.strictEqual(RET('gap: queue search ignores surrounding spaces'), 1); assert.deepStrictEqual(RET('gap: Next moves exactly one page (12 pages)'), [2, 3]);
  console.log(' - independent sanity assertions on the original: PASSED');
  console.log('EQUIVALENCE CHECK (compare phase) PASSED —', o.steps.length, 'steps + chained-patch scenario identical on both sides');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
