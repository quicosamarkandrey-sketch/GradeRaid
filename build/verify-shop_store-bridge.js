// Phase 7 (Stream D) — equivalence check for modules/shop/shop_store.js (file 22/30).
//
// ORIGINAL side: real classic files (repository/*, db-service, state-manager, dom, utils eval'd; shop_store loaded as a
// real <script> element so its top-level `const _CART` lives in the shared global lexical scope and can be peeked).
// BRIDGE side: one esbuild bundle whose entry imports the REAL production bridge (shop_store.bridge.js). Same DOM,
// fixtures and calls on both.
// Bare globals stubbed identically (toggled per step where it matters): currentUser (read AND reassigned by checkout),
// syncStudentStatsToServer, updateTopbar, invUpdateSidebarBadge, promoRenderCarousel, promoRecordPurchase,
// achCheckAndAward (ALSO tested wrapped — proves the deliberately-bare decision), showPage.
// purchase_shop_product goes through the REAL DBService.rpc and a mock Supabase client.
//
// Checked: 0 reverse-transform byte identity + 17 exports; 1 window surface; 2 getItemRarity at every boundary;
// 3 renderStudentStore (categories, afford/stock states, escaping, guards, FAB, missing page); 4 cart engine
// (add/remove/setQty/clear, caps, pruning in cartOpenModal); 5 REAL inline DOM events (cards, tabs, qty controls,
// FAB, checkout button); 6 cartCheckout — every RPC outcome, affordability, orders/redemptions/inventory upsert,
// promo/ach/sidebar guards, currentUser reassignment; 7 posGenCode retry/exhaustion; 8 posShowClaimCode; 9 stubs.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const WINDOW_FNS = ['getItemRarity', 'renderStudentStore', 'cartAdd', 'cartRemove', 'cartSetQty', 'cartClear', 'cartOpenModal', 'cartCheckout', 'posGenCode', 'posShowClaimCode', 'buyItem', 'confirmBuy'];
const PRIVATE_FNS = ['_cartTotal', '_cartCount', '_cartRenderFab', '_cartRenderModal'];

function reverseTransformCheck() {
  const orig = read('modules/shop/shop_store.js');
  const twin = read('src/modules/shop/shop_store.js');
  const marker = '// ── Item rarity helper';
  assert.strictEqual(orig.split(marker).length, 2); assert.strictEqual(twin.split(marker).length, 2);
  const origHead = orig.slice(0, orig.indexOf(marker));
  assert(twin.includes(origHead), 'twin carries the original header comment verbatim');
  const mid = twin.slice(twin.indexOf(origHead) + origHead.length, twin.indexOf(marker));
  assert(mid.startsWith('import ') && mid.endsWith(';\n\n'), 'only an import block precedes the first original statement');
  for (const line of mid.split('\n').filter(Boolean)) assert(/^import .*;$/.test(line), 'import block line: ' + line);
  const body = twin.slice(twin.indexOf(marker));
  const rebuilt = origHead + body
    .replace('export const _CART =', 'const _CART =')
    .replace(/^export function /gm, 'function ')
    .replace(/^export const (?=(?:getItemRarity|renderStudentStore|cart\w+|pos\w+|buyItem|confirmBuy)\b)/gm, 'window.');
  assert.strictEqual(rebuilt, orig, 'reversing the keyword swaps must reproduce the original byte-for-byte');
  assert.strictEqual((twin.match(/^export /gm) || []).length, 17, 'exactly 17 exports (= declaresCount 17)');
}

const STARTER_HTML = `<!doctype html><html><body>
  <div id="s-store" class="active"></div>
  <div id="toast"></div>
  <div id="modal-box" class="modal-box"></div><div id="modal-content"></div><div id="modal-overlay" style="display:none"></div>
</body></html>`;
const FIXED = 1767225600000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  win.eval(`(function(){ const R = Date; class D extends R { constructor(...a){ if (a.length) super(...a); else super(${FIXED}); } static now(){ return ${FIXED}; } } globalThis.Date = D; }());`);
  win.eval("globalThis.__rnd = { s: 424242 }; Math.random = function () { __rnd.s = (__rnd.s * 1103515245 + 12345) & 0x7fffffff; return __rnd.s / 0x7fffffff; }; globalThis.__seededRandom = Math.random;");
  win.DEFAULT_DB = { store: [], students: [], orders: [], redemptions: [], inventory: {} };
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
  win.__calls = [];
  const rec = (name) => (...a) => { win.__calls.push(JSON.stringify([name, ...a.map(x => (typeof x === 'function' ? '<fn>' : (x && typeof x === 'object' && !Array.isArray(x) && name === 'promoRecordPurchase' ? '<draft:' + Object.keys(x).sort().join(',') + '>' : x)))])); };
  win.syncStudentStatsToServer = rec('syncStudentStatsToServer');
  win.updateTopbar = rec('updateTopbar');
  win.invUpdateSidebarBadge = rec('invUpdateSidebarBadge');
  win.promoRenderCarousel = rec('promoRenderCarousel');
  win.promoRecordPurchase = rec('promoRecordPurchase');
  win.achCheckAndAward = rec('achCheckAndAward');
  win.showPage = rec('showPage');
  win.__stubFns = {}; for (const n of ['syncStudentStatsToServer', 'updateTopbar', 'invUpdateSidebarBadge', 'promoRenderCarousel', 'promoRecordPurchase', 'achCheckAndAward', 'showPage']) win.__stubFns[n] = win[n];
  win.addEventListener('error', e => win.__calls.push(JSON.stringify(['window-error', String(e.message)])));
  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  win.console.warn = () => {}; win.console.error = (...a) => win.__calls.push(JSON.stringify(['error', ...a.map(String)]));
  return { win, logs };
}
async function evalOriginal(win) {
  for (const f of ['repository/table-sync.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'db-service.js', 'modules/core/state-manager.js', 'dom.js', 'utils.js']) win.eval(read(f));
  const s = win.document.createElement('script'); s.textContent = read('modules/shop/shop_store.js'); win.document.head.appendChild(s);
  await win.AppStore.ready;
}
async function evalBridge(win) {
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'shop_store-combined-bundle.js'), 'utf8'));
  await win.AppStore.ready;
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v).replace(ISO, '<ISO>'));
const tick = () => new Promise(r => setTimeout(r, 5));
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
  { id: 's1', name: 'Snack <b>Pack</b>', desc: 'Tasty <i>"snack"</i> & more', emoji: '🍿', cat: 'food', cost: 50, stock: 5 },
  { id: 's2', name: 'Gold Pen', desc: 'Writes well', emoji: '🖊️', cat: 'supplies', cost: 250, stock: 2 },
  { id: 's3', name: 'Homework Pass', desc: 'Skip one', emoji: '🎫', cat: 'privilege', cost: 120, stock: 10 },
  { id: 's4', name: 'Mystery Box', desc: '???', emoji: '🎁', cat: 'mystery', cost: 300, stock: 0 },
  { id: 's5', name: 'Eraser', desc: 'Pink', emoji: '🧽', cat: 'supplies', cost: 20, stock: 3 },
  { id: 's6', name: 'Pencil', desc: 'HB', emoji: '✏️', cat: 'supplies', cost: 10, stock: 40 },
];
const STUDENTS = () => [
  { id: 'stu1', name: 'Ann <A>', init: 'AA', color: '#ff0000', coins: 1000 },
  { id: 'stu2', name: 'Bo', init: 'B', color: '#00ff00', coins: 30 },
];
function seed(win, extra) {
  win.AppStore.updateState(d => {
    d.store = STORE(); d.students = STUDENTS(); d.orders = []; d.redemptions = []; d.inventory = {};
    Object.assign(d, extra || {});
  }, { type: 'test:seed' });
}
const setUser = (win, id) => { const s = STUDENTS().find(x => x.id === id); win.eval('currentUser = ' + JSON.stringify(s || null) + ';'); };
const cartPeek = win => win.eval('JSON.stringify(_CART)');
const stateSnap = win => win.AppStore.getSlice(s => ({ store: s.store, students: s.students, orders: s.orders, redemptions: s.redemptions, inventory: s.inventory }));
const modalSnap = win => ({ visible: $(win, 'modal-overlay').style.display, content: $(win, 'modal-content').innerHTML });
function resetUi(win) { for (const n in win.__stubFns) win[n] = win.__stubFns[n]; win.eval('for (const k in _CART) delete _CART[k];'); $(win, 'modal-overlay').style.display = 'none'; $(win, 'modal-content').innerHTML = ''; $(win, 'toast').innerHTML = ''; $(win, 's-store').innerHTML = ''; const f = $(win, 'cart-fab'); if (f) f.remove(); win.__calls.length = 0; win.__rpcCalls.length = 0; win.__purchase = {}; }
const click = (win, el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
const ev = (win, el, type) => el.dispatchEvent(new win.Event(type, { bubbles: true }));
const ok = (rem) => ({ data: [{ ok: true, remaining_stock: rem }], error: null });

async function run(win, logs) {
  const out = { steps: [] };
  win.__events = [];
  win.AppStore.subscribe('verify-recorder', (st, e) => { win.__events.push(e.type + ':' + JSON.stringify(e.payload === undefined ? null : e.payload)); });
  const step = async (label, fn) => {
    win.__rnd.s = 424242; win.Math.random = win.__seededRandom;
    win.__events.length = 0;
    let err = null, ret;
    try { ret = await fn(); } catch (e) { err = String(e && e.message); }
    await tick();
    const fab = $(win, 'cart-fab');
    out.steps.push({ label, err, ret, events: win.__events.filter(e => !e.startsWith('test:seed')), calls: win.__calls.slice(), rpc: win.__rpcCalls.slice(), toast: $(win, 'toast').innerHTML, modal: modalSnap(win),
      page: $(win, 's-store') ? $(win, 's-store').innerHTML : null, fab: fab ? fab.outerHTML : null, cart: cartPeek(win), user: win.eval('JSON.stringify(currentUser)'), state: stateSnap(win) });
  };
  const fresh = async (label, fn) => { resetUi(win); return step(label, fn); };
  const surface = { fns: WINDOW_FNS.concat(PRIVATE_FNS).map(n => [n, typeof win[n]]), loadLogs: logs.slice().sort() };
  out.surface = surface;
  const doc = win.document;
  const restoreGuards = () => { win.promoRenderCarousel = (...a) => win.__calls.push(JSON.stringify(['promoRenderCarousel', ...a])); };

  seed(win); setUser(win, 'stu1');

  // ── 2. getItemRarity ──
  await fresh('getItemRarity: every branch + boundaries', async () => ['mystery', 'privilege', 'food', 'supplies'].flatMap(cat => [0, 199, 200, 201, undefined].map(cost => win.getItemRarity({ cat, cost }))));
  await fresh('getItemRarity: cat wins over cost', async () => [win.getItemRarity({ cat: 'mystery', cost: 999 }).label, win.getItemRarity({ cat: 'privilege', cost: 999 }).label]);

  // ── 3. renderStudentStore ──
  for (const cat of [undefined, 'all', 'food', 'supplies', 'privilege', 'mystery', 'zzz']) {
    await fresh('renderStudentStore: ' + String(cat), async () => { win.renderStudentStore(cat); });
  }
  await fresh('renderStudentStore: broke student (nothing affordable)', async () => { setUser(win, 'stu2'); win.renderStudentStore('all'); setUser(win, 'stu1'); });
  await fresh('renderStudentStore: cost exactly equals coins', async () => { win.eval('currentUser = { ...currentUser, coins: 120 };'); win.renderStudentStore('privilege'); setUser(win, 'stu1'); });
  seed(win, { store: null });
  await fresh('renderStudentStore: null store slice', async () => { win.renderStudentStore('all'); });
  seed(win);
  await fresh('renderStudentStore: promoRenderCarousel absent (typeof guard)', async () => { delete win.promoRenderCarousel; win.renderStudentStore('all'); restoreGuards(); });
  await fresh('renderStudentStore: FAB shown when the page is active and the cart has items', async () => { win.cartAdd('s1'); win.cartAdd('s1'); win.renderStudentStore('all'); });
  await fresh('renderStudentStore: no FAB when the page is not active', async () => { win.cartAdd('s1'); $(win, 's-store').classList.remove('active'); win.renderStudentStore('all'); $(win, 's-store').classList.add('active'); });
  await fresh('renderStudentStore: missing #s-store throws the same error', async () => { const el = $(win, 's-store'); el.id = 'x-store'; try { win.renderStudentStore('all'); } finally { el.id = 's-store'; } });

  // ── 4. cart engine ──
  await fresh('cartAdd: unknown id is a no-op', async () => { win.cartAdd('nope'); });
  await fresh('cartAdd: out of stock', async () => { win.cartAdd('s4'); });
  await fresh('cartAdd: up to stock, then the cap message (stock 2)', async () => { const r = []; for (let i = 0; i < 4; i++) { win.cartAdd('s2'); r.push(cartPeek(win)); } return r; });
  await fresh('cartAdd: two items + item refresh from the store', async () => { win.cartAdd('s1'); win.AppStore.updateState(d => { d.store.find(i => i.id === 's1').name = 'Renamed'; }, { type: 'test:edit' }); win.cartAdd('s1'); win.cartAdd('s3'); });
  await fresh('cartAdd: FAB appears on the active page', async () => { win.cartAdd('s5'); });
  await fresh('cartRemove: unknown id', async () => { win.cartRemove('s1'); });
  await fresh('cartRemove: decrement then delete (re-renders modal, closes when empty)', async () => { win.cartAdd('s1'); win.cartAdd('s1'); win.cartAdd('s3'); win.cartOpenModal(); const a = modalSnap(win).content; win.cartRemove('s1'); const b = cartPeek(win); win.cartRemove('s1'); win.cartRemove('s3'); return [a.length > 0, b]; });
  await fresh('cartSetQty: unknown id', async () => { win.cartSetQty('nope', 2); });
  await fresh('cartSetQty: valid, capped, string, non-numeric, zero, negative', async () => { const r = []; win.cartSetQty('s2', 1); r.push(cartPeek(win)); win.cartSetQty('s2', 9); r.push(cartPeek(win)); win.cartSetQty('s2', '2'); r.push(cartPeek(win)); win.cartSetQty('s2', 'abc'); r.push(cartPeek(win)); win.cartSetQty('s2', 1); win.cartSetQty('s2', 0); r.push(cartPeek(win)); win.cartSetQty('s2', 1); win.cartSetQty('s2', -3); r.push(cartPeek(win)); return r; });
  await fresh('cartSetQty: refreshes the open modal', async () => { win.cartAdd('s1'); win.cartOpenModal(); win.cartSetQty('s1', 3); });
  await fresh('cartSetQty: refreshes the cart item from the store', async () => { win.cartAdd('s1'); win.AppStore.updateState(d => { d.store.find(i => i.id === 's1').name = 'Renamed2'; }, { type: 'test:edit' }); win.cartSetQty('s1', 2); return cartPeek(win); });
  await fresh('fab: total shows thousands separators', async () => { for (let i = 0; i < 10; i++) win.cartAdd('s3'); win.renderStudentStore('all'); });
  await fresh('cartOpenModal: balance exactly equal to the total can afford', async () => { win.eval('currentUser = { ...currentUser, coins: 120 };'); win.cartAdd('s3'); win.cartOpenModal(); setUser(win, 'stu1'); });
  await fresh('cartClear', async () => { win.cartAdd('s1'); win.cartAdd('s3'); win.cartClear(); });
  await fresh('cartOpenModal: empty cart closes the modal', async () => { $(win, 'modal-overlay').style.display = 'flex'; win.cartOpenModal(); });
  await fresh('cartOpenModal: renders rows, totals, plural + affordable', async () => { win.cartAdd('s1'); win.cartAdd('s1'); win.cartAdd('s3'); win.cartOpenModal(); });
  await fresh('cartOpenModal: singular item label', async () => { win.cartAdd('s6'); win.cartOpenModal(); });
  await fresh('cartOpenModal: cannot afford', async () => { setUser(win, 'stu2'); win.cartAdd('s2'); win.cartOpenModal(); setUser(win, 'stu1'); });
  await fresh('cartOpenModal: prunes sold-out/removed items and clamps qty to the new stock', async () => { win.cartAdd('s1'); win.cartAdd('s1'); win.cartAdd('s1'); win.cartAdd('s3'); win.cartAdd('s5'); win.AppStore.updateState(d => { d.store.find(i => i.id === 's1').stock = 2; d.store.find(i => i.id === 's3').stock = 0; d.store = d.store.filter(i => i.id !== 's5'); }, { type: 'test:edit' }); win.cartOpenModal(); });
  await fresh('cartOpenModal: all items vanished -> empty -> closes', async () => { win.cartAdd('s1'); win.AppStore.updateState(d => { d.store = []; }, { type: 'test:edit' }); win.cartOpenModal(); });
  seed(win);

  // ── 5. real DOM events ──
  await fresh('dom: Add to Cart button on a store card (stopPropagation onclick)', async () => { win.renderStudentStore('all'); const b = doc.querySelector('#store-item-s1 .store-redeem-btn'); click(win, b); click(win, b); return cartPeek(win); });
  await fresh('dom: disabled/out-of-stock cards add nothing', async () => { win.renderStudentStore('all'); const b = doc.querySelector('#store-item-s4 .store-redeem-btn'); click(win, b); return [b.disabled, cartPeek(win)]; });
  await fresh('dom: category tabs re-render and call showPage', async () => { win.renderStudentStore('all'); const r = []; for (const t of [...doc.querySelectorAll('.cat-tab')]) { click(win, t); r.push([...doc.querySelectorAll('.cat-tab.active')].map(x => x.textContent)); } return r; });
  await fresh('dom: FAB click opens the cart modal', async () => { win.cartAdd('s1'); win.renderStudentStore('all'); click(win, $(win, 'cart-fab')); });
  await fresh('dom: qty +/- buttons, number input and trash button', async () => { win.cartAdd('s3'); win.cartAdd('s3'); win.cartOpenModal(); const r = []; const m = () => $(win, 'modal-content'); click(win, m().querySelectorAll('.cart-qty-btn')[1]); r.push(cartPeek(win)); click(win, m().querySelectorAll('.cart-qty-btn')[0]); r.push(cartPeek(win)); const i = m().querySelector('.cart-qty-num'); i.value = '7'; ev(win, i, 'input'); r.push(cartPeek(win)); const i2 = m().querySelector('.cart-qty-num'); i2.value = '0'; ev(win, i2, 'input'); r.push(cartPeek(win)); return r; });
  await fresh('dom: trash button removes the row', async () => { win.cartAdd('s1'); win.cartAdd('s3'); win.cartOpenModal(); const rows = $(win, 'modal-content').querySelectorAll('.cart-item-row'); click(win, rows[0].querySelector('button:last-child')); return cartPeek(win); });
  await fresh('dom: Clear all (cartClear + close) and Keep Shopping', async () => { win.cartAdd('s1'); win.cartOpenModal(); const b = [...$(win, 'modal-content').querySelectorAll('button')].find(x => x.textContent === 'Clear all'); click(win, b); const a = [cartPeek(win), modalSnap(win).visible]; win.cartAdd('s1'); win.cartOpenModal(); click(win, [...$(win, 'modal-content').querySelectorAll('button')].find(x => x.textContent === 'Keep Shopping')); return [a, cartPeek(win), modalSnap(win).visible]; });

  // ── 6. checkout ──
  const checkout = async (label, setup, opts = {}) => fresh(label, async () => { seed(win); setUser(win, opts.user || 'stu1'); if (setup) await setup(); await win.cartCheckout(); await sleep(450); });
  await checkout('checkout: empty cart is a no-op (an open modal stays open)', async () => { $(win, 'modal-overlay').style.display = 'flex'; });
  await checkout('checkout: student record not found', async () => { win.cartAdd('s1'); win.eval("currentUser = { id: 'ghost', coins: 999 };"); });
  await checkout('checkout: cannot afford (authoritative re-check, no rpc)', async () => { win.cartAdd('s2'); win.cartAdd('s2'); }, { user: 'stu2' });
  await checkout('checkout: single item success (orders, redemption, inventory, coins, rpc, events, calls)', async () => { win.cartAdd('s1'); win.__purchase.s1 = ok(4); });
  await checkout('checkout: multi-item multi-qty success (unique codes, upsert new + existing)', async () => { seed(win, { inventory: { stu1: [{ itemId: 's1', itemName: 'Snack', emoji: '🍿', category: 'food', quantity: 2, datePurchased: 'x', source: 'Store', status: 'active' }] } }); win.cartAdd('s1'); win.cartAdd('s1'); win.cartAdd('s3'); win.cartAdd('s6'); win.cartAdd('s6'); win.cartAdd('s6'); win.__purchase.s1 = ok(3); win.__purchase.s3 = ok(9); win.__purchase.s6 = ok(37); });
  await checkout('checkout: existing inventory row without quantity gets the default', async () => { seed(win, { inventory: { stu1: [{ itemId: 's1', itemName: 'Snack' }] } }); win.cartAdd('s1'); });
  await checkout('checkout: slices missing (orders/redemptions/inventory created)', async () => { seed(win, { orders: null, redemptions: null, inventory: null }); win.cartAdd('s1'); });
  await checkout('checkout: inventory for another student only', async () => { seed(win, { inventory: { stu2: [] } }); win.cartAdd('s1'); });
  await checkout('checkout: claim codes avoid pending codes already in orders', async () => { seed(win, { orders: Array.from({ length: 5 }, (_, i) => ({ claimCode: 'ZZZ-' + i, status: 'pending' })) }); win.cartAdd('s1'); win.cartAdd('s1'); });
  await checkout('checkout: one item loses the stock race, the other succeeds (failed one stays in the cart)', async () => { win.cartAdd('s1'); win.cartAdd('s3'); win.__purchase.s1 = { data: [{ ok: false, remaining_stock: 1 }], error: null }; win.__purchase.s3 = ok(8); });
  await checkout('checkout: balance exactly equal to the total succeeds', async () => { for (let i = 0; i < 3; i++) win.cartAdd('s6'); win.__purchase.s6 = ok(37); }, { user: 'stu2' });
  await checkout('checkout: an rpc error alongside an ok-looking result is still a failure', async () => { win.cartAdd('s1'); win.__purchase.s1 = { data: [{ ok: true, remaining_stock: 4 }], error: { message: 'x' } }; });
  await checkout('checkout: codes in one checkout are unique against the in-progress draft (random stub)', async () => { win.cartAdd('s1'); win.cartAdd('s1'); const seq = [...Array(18).fill(0), ...Array(9).fill(0.5)]; let i = 0; win.Math.random = () => (i < seq.length ? seq[i++] : 0.25); });
  await fresh('checkout: ach award fires after the 400ms delay, not before', async () => { seed(win); setUser(win, 'stu1'); win.cartAdd('s1'); await win.cartCheckout(); const n = () => win.__calls.filter(c => c.startsWith('["achCheckAndAward"')).length; await sleep(150); const early = n(); await sleep(400); return [early, n()]; });
  await checkout('checkout: every item fails -> toasts, modal refresh, nothing committed', async () => { win.cartAdd('s1'); win.cartAdd('s3'); win.__purchase.s1 = { data: [{ ok: false, remaining_stock: 0 }], error: null }; win.__purchase.s3 = { data: null, error: { message: 'boom' } }; });
  await checkout('checkout: rpc error object', async () => { win.cartAdd('s1'); win.__purchase.s1 = { data: null, error: { message: 'denied' } }; });
  await checkout('checkout: rpc returns a plain object (not an array)', async () => { win.cartAdd('s1'); win.__purchase.s1 = { data: { ok: true, remaining_stock: 2 }, error: null }; });
  await checkout('checkout: ok:false without remaining_stock', async () => { win.cartAdd('s1'); win.__purchase.s1 = { data: [{ ok: false }], error: null }; });
  await checkout('checkout: empty data array', async () => { win.cartAdd('s1'); win.__purchase.s1 = { data: [], error: null }; });
  await checkout('checkout: item removed from the store before checkout', async () => { win.cartAdd('s1'); win.cartAdd('s3'); win.AppStore.updateState(d => { d.store = d.store.filter(i => i.id !== 's1'); }, { type: 'test:edit' }); win.__purchase.s3 = ok(5); });
  await checkout('checkout: guards absent (promoRecordPurchase / invUpdateSidebarBadge / achCheckAndAward)', async () => { win.cartAdd('s1'); delete win.promoRecordPurchase; delete win.invUpdateSidebarBadge; delete win.achCheckAndAward; });
  await checkout('checkout: promoRecordPurchase receives the in-progress draft', async () => { win.cartAdd('s1'); win.cartAdd('s3'); win.promoRecordPurchase = (id, draft) => { win.__calls.push(JSON.stringify(['promoRecordPurchase', id, Array.isArray(draft.orders) ? draft.orders.length : 'no-orders', typeof draft.students])); }; });
  await checkout('checkout: achCheckAndAward WRAPPED after load is still honoured (kept bare on purpose)', async () => { win.cartAdd('s1'); const real = win.achCheckAndAward; win.achCheckAndAward = function (id) { win.__calls.push(JSON.stringify(['WRAPPER', id])); return real.apply(this, arguments); }; });
  await checkout('checkout: currentUser is reassigned from the store and the old reference is stale', async () => { win.cartAdd('s2'); win.__purchase.s2 = ok(1); win.eval('globalThis.__oldUser = currentUser;'); });
  await fresh('checkout: user snapshot after success reflects the deducted coins', async () => { seed(win); setUser(win, 'stu1'); win.cartAdd('s2'); win.__purchase.s2 = ok(1); await win.cartCheckout(); await sleep(450); return [win.eval('currentUser.coins'), win.eval('__oldUser.coins')]; });
  await fresh('checkout: full UI path (open cart, click Checkout)', async () => { seed(win); setUser(win, 'stu1'); win.renderStudentStore('all'); click(win, doc.querySelector('#store-item-s3 .store-redeem-btn')); win.cartOpenModal(); const b = [...$(win, 'modal-content').querySelectorAll('button')].find(x => x.textContent.includes('Checkout')); win.__purchase.s3 = ok(9); click(win, b); await sleep(500); });
  await fresh('checkout: Checkout button is disabled when unaffordable', async () => { seed(win); setUser(win, 'stu2'); win.cartAdd('s2'); win.cartOpenModal(); const b = [...$(win, 'modal-content').querySelectorAll('button')].find(x => x.textContent.includes('Checkout')); return b.disabled; });

  // ── 7. posGenCode ──
  seed(win); setUser(win, 'stu1');
  await fresh('posGenCode: no args reads the orders slice', async () => [win.posGenCode(), win.posGenCode()]);
  await fresh('posGenCode: explicit array', async () => win.posGenCode([]));
  await fresh('posGenCode: format + alphabet over many draws', async () => Array.from({ length: 30 }, () => win.posGenCode([])));
  await fresh('posGenCode: collision with a pending code retries (random stub)', async () => { const seq = [...Array(9).fill(0), ...Array(9).fill(0.5)]; let i = 0; win.Math.random = () => (i < seq.length ? seq[i++] : 0.25); return [win.posGenCode([{ claimCode: 'AAA-000-AAA', status: 'pending' }]), i]; });
  await fresh('posGenCode: a claimed/cancelled code does not count as a collision', async () => { let i = 0; win.Math.random = () => { i++; return 0; }; return [win.posGenCode([{ claimCode: 'AAA-000-AAA', status: 'claimed' }]), i]; });
  await fresh('posGenCode: exhausts 100 tries and returns the last code', async () => { let i = 0; win.Math.random = () => { i++; return 0; }; return [win.posGenCode([{ claimCode: 'AAA-000-AAA', status: 'pending' }]), i]; });
  await fresh('posGenCode: empty array is used as-is (truthy), not the slice', async () => { seed(win, { orders: [{ claimCode: 'AAA-000-AAA', status: 'pending' }] }); let i = 0; win.Math.random = () => { i++; return 0; }; const r = [win.posGenCode([]), i]; i = 0; r.push(win.posGenCode(), i); return r; });

  // ── 8. posShowClaimCode / 9. stubs ──
  await fresh('posShowClaimCode: renders the code, escaped name and order id', async () => { win.posShowClaimCode('ABC-123-XYZ', { emoji: '🎁', name: 'Box <i>"x"</i>' }, "ORD<b>1</b>&'"); });
  await fresh('posShowClaimCode: close button', async () => { win.posShowClaimCode('ABC-123-XYZ', { emoji: '🎁', name: 'Box' }, 'ORD-1'); click(win, [...$(win, 'modal-content').querySelectorAll('button')].find(x => x.textContent.startsWith('Got it'))); });
  await fresh('stubs: buyItem adds to the cart; confirmBuy does nothing', async () => { const r = [win.buyItem('s1'), win.confirmBuy('s1')]; return [r, cartPeek(win)]; });
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

  // _CART is a global lexical const in the original (not a window prop); the bridge adds the same live object to window
  assert.strictEqual(A.win._CART, undefined, 'original: _CART is NOT a window property');
  assert.strictEqual(typeof B.win._CART, 'object', 'bridge exposes the same _CART object on window');

  // ── independent sanity ──
  const o = clean(oa);
  const S = label => { const s = o.steps.find(x => x.label === label); assert(s, 'missing step ' + label); return s; };
  assert.deepStrictEqual(o.surface.fns.map(e => e[1]), Array(16).fill('function'), '12 window fns + 4 private fns are global functions');
  assert(o.surface.loadLogs.some(l => l.includes('shop/store.js loaded')), 'load log');
  const rar = S('getItemRarity: every branch + boundaries').ret.map(r => r.label);
  assert.deepStrictEqual(rar.slice(0, 5), Array(5).fill('LEGENDARY')); assert.deepStrictEqual(rar.slice(5, 10), Array(5).fill('EPIC'));
  assert.deepStrictEqual(rar.slice(10, 15), ['COMMON', 'COMMON', 'RARE', 'RARE', 'COMMON'], 'cost >= 200 is RARE; undefined cost is COMMON');
  const all = S('renderStudentStore: all').page;
  assert(all.includes('The Armory') && all.includes('1,000') && all.includes('Snack &lt;b&gt;Pack&lt;/b&gt;') && all.includes('OUT OF STOCK') && all.includes('Only 3 left') && all.includes('40 in stock'), 'full store render, escaping, stock labels');
  assert(S('renderStudentStore: all').calls.includes('["promoRenderCarousel"]'), 'carousel hook called');
  assert(S('renderStudentStore: zzz').page.includes('No items in this category.'), 'empty category message');
  assert(S('renderStudentStore: broke student (nothing affordable)').page.includes('Can&apos;t Afford') || S('renderStudentStore: broke student (nothing affordable)').page.includes("Can't Afford"), 'cannot afford label');
  assert(!S('renderStudentStore: cost exactly equals coins').page.includes('disabled=""') || S('renderStudentStore: cost exactly equals coins').page.includes('Add to Cart'), 'exact balance can buy');
  assert.strictEqual(S('renderStudentStore: null store slice').err, null);
  assert(!S('renderStudentStore: promoRenderCarousel absent (typeof guard)').calls.includes('["promoRenderCarousel"]') && S('renderStudentStore: promoRenderCarousel absent (typeof guard)').err === null);
  assert(S('renderStudentStore: FAB shown when the page is active and the cart has items').fab.includes('cart-count">2<'), 'FAB with count');
  assert.strictEqual(S('renderStudentStore: no FAB when the page is not active').fab, null);
  assert(S('renderStudentStore: missing #s-store throws the same error').err, 'missing page throws');
  assert(S('cartAdd: out of stock').toast.includes('Out of stock') && S('cartAdd: out of stock').cart === '{}');
  const cap = S('cartAdd: up to stock, then the cap message (stock 2)'); assert(cap.toast.includes('Only 2 in stock') && JSON.parse(cap.ret[3]).s2.qty === 2);
  assert.strictEqual(JSON.parse(S('cartAdd: two items + item refresh from the store').cart).s1.item.name, 'Renamed', 'cart item refreshed from the store');
  assert.strictEqual(S('cartAdd: unknown id is a no-op').cart, '{}');
  const sq = S('cartSetQty: valid, capped, string, non-numeric, zero, negative').ret.map(c => { const j = JSON.parse(c); return j.s2 ? j.s2.qty : null; });
  assert.deepStrictEqual(sq, [1, 2, 2, null, null, null], 'qty set / capped at stock / numeric string parsed / NaN, zero and negative all delete the row');
  assert(S('cartClear').cart === '{}');
  assert.strictEqual(S('cartOpenModal: empty cart closes the modal').modal.visible, 'none');
  const om = S('cartOpenModal: renders rows, totals, plural + affordable').modal.content; assert(om.includes('Total (3 items)') && om.includes('Your Cart') && !om.includes('Not enough coins'));
  assert(S('cartOpenModal: singular item label').modal.content.includes('Total (1 item)'));
  const na = S('cartOpenModal: cannot afford').modal.content; assert(na.includes('Not enough coins') && /Checkout[^<]*<\/button>/.test(na));
  const pr = JSON.parse(S('cartOpenModal: prunes sold-out/removed items and clamps qty to the new stock').cart); assert(Object.keys(pr).join() === 's1' && pr.s1.qty === 2, 'pruned + clamped');
  assert.strictEqual(S('cartOpenModal: all items vanished -> empty -> closes').modal.visible, 'none');
  assert.strictEqual(JSON.parse(S('dom: Add to Cart button on a store card (stopPropagation onclick)').ret).s1.qty, 2);
  assert.deepStrictEqual(S('dom: disabled/out-of-stock cards add nothing').ret, [true, '{}']);
  assert(S('dom: category tabs re-render and call showPage').calls.filter(c => c.startsWith('["showPage"')).length === 5);
  assert(S('dom: FAB click opens the cart modal').modal.content.includes('Your Cart'));
  const qb = S('dom: qty +/- buttons, number input and trash button').ret.map(c => { const j = JSON.parse(c); return j.s3 ? j.s3.qty : null; }); assert.deepStrictEqual(qb, [3, 2, 7, null]);
  { const cl = S('dom: Clear all (cartClear + close) and Keep Shopping').ret; assert.deepStrictEqual(cl[0], ['{}', 'none']); assert.strictEqual(JSON.parse(cl[1]).s1.qty, 1); assert.strictEqual(cl[2], 'none'); }
  // checkout
  assert.strictEqual(S('checkout: empty cart is a no-op (an open modal stays open)').rpc.length, 0);
  assert.strictEqual(S('checkout: student record not found').rpc.length, 0);
  assert(S('checkout: cannot afford (authoritative re-check, no rpc)').toast.includes('Not enough coins') && S('checkout: cannot afford (authoritative re-check, no rpc)').rpc.length === 0);
  const c1 = S('checkout: single item success (orders, redemption, inventory, coins, rpc, events, calls)');
  assert.deepStrictEqual(c1.rpc.map(r => r.params), [{ p_product_id: 's1', p_student_id: 'stu1', p_quantity: 1 }]);
  assert(c1.state.orders.length === 1 && c1.state.orders[0].status === 'pending' && c1.state.orders[0].studentId === 'stu1' && /^[A-Z]{3}-\d{3}-[A-Z]{3}$/.test(c1.state.orders[0].claimCode) && c1.state.orders[0].createdAt === '<ISO>', 'order created');
  assert(c1.state.redemptions.length === 1 && c1.state.inventory.stu1.length === 1 && c1.state.students[0].coins === 950, 'redemption, inventory, coins -50');
  assert.deepStrictEqual(c1.events, ['shop:checkout:{"studentId":"stu1","total":50,"itemCount":1}']);
  assert(c1.calls.includes('["syncStudentStatsToServer","stu1",0,-50]') && c1.calls.includes('["updateTopbar"]') && c1.calls.includes('["invUpdateSidebarBadge"]') && c1.calls.includes('["achCheckAndAward","stu1"]'), 'post-purchase hooks, incl. the 400ms ach call');
  assert(c1.modal.content.includes('Order Confirmed') && c1.cart === '{}' && JSON.parse(c1.user).coins === 950, 'confirmation modal, cart cleared, currentUser reassigned');
  const c2 = S('checkout: multi-item multi-qty success (unique codes, upsert new + existing)');
  assert(c2.state.orders.length === 6 && new Set(c2.state.orders.map(x => x.claimCode)).size === 6, '6 units -> 6 unique orders');
  assert(c2.state.inventory.stu1.find(i => i.itemId === 's1').quantity === 4 && c2.state.inventory.stu1.length === 3, 'existing row incremented, new rows added');
  assert.strictEqual(c2.state.students[0].coins, 1000 - (2 * 50 + 120 + 3 * 10));
  assert.strictEqual(S('checkout: existing inventory row without quantity gets the default').state.inventory.stu1[0].quantity, 2);
  const c3 = S('checkout: one item loses the stock race, the other succeeds (failed one stays in the cart)');
  assert(Object.keys(JSON.parse(c3.cart)).join() === 's1' && c3.toast.includes('only 1 left') && c3.state.orders.length === 1, 'failed item stays; the winner is committed');
  const c4 = S('checkout: every item fails -> toasts, modal refresh, nothing committed'); assert(c4.state.orders.length === 0 && c4.events.length === 0 && c4.toast.includes('only 10 left') && c4.modal.content.includes('Your Cart'));
  assert(S('checkout: rpc error object').toast.includes('only') && S('checkout: rpc error object').state.orders.length === 0);
  assert.strictEqual(S('checkout: rpc returns a plain object (not an array)').state.orders.length, 1);
  assert(S('checkout: ok:false without remaining_stock').toast.includes('only 0 left'), 'missing remaining_stock reports 0 left');
  assert(S('checkout: empty data array').state.orders.length === 0);
  assert(S('checkout: item removed from the store before checkout').toast.includes('no longer available'));
  const g = S('checkout: guards absent (promoRecordPurchase / invUpdateSidebarBadge / achCheckAndAward)'); assert(g.err === null && !g.calls.some(c => /promoRecordPurchase|invUpdateSidebarBadge|achCheckAndAward/.test(c)) && g.state.orders.length === 1);
  assert(S('checkout: promoRecordPurchase receives the in-progress draft').calls.some(c => c.startsWith('["promoRecordPurchase","s1",')), 'promo hook gets (id, draft)');
  assert(S('checkout: achCheckAndAward WRAPPED after load is still honoured (kept bare on purpose)').calls.includes('["WRAPPER","stu1"]'), 'wrapper honoured');
  assert.deepStrictEqual(S('checkout: user snapshot after success reflects the deducted coins').ret, [750, 1000]);
  const ui = S('checkout: full UI path (open cart, click Checkout)'); assert(ui.state.orders.length === 1 && ui.modal.content.includes('Order Confirmed'));
  assert.strictEqual(S('checkout: Checkout button is disabled when unaffordable').ret, true);
  // posGenCode / claim code
  const pg = S('posGenCode: format + alphabet over many draws').ret; assert(pg.every(c => /^[A-HJ-NP-Z]{3}-\d{3}-[A-HJ-NP-Z]{3}$/.test(c)) && !pg.join('').match(/[IO]/), 'XXX-NNN-XXX, no I/O'); assert(new Set(pg).size > 25);
  assert.strictEqual(S('posGenCode: collision with a pending code retries (random stub)').ret[1], 18, 'exactly two attempts (9 draws each)');
  assert.notStrictEqual(S('posGenCode: collision with a pending code retries (random stub)').ret[0], 'AAA-000-AAA');
  assert.deepStrictEqual(S('posGenCode: a claimed/cancelled code does not count as a collision').ret, ['AAA-000-AAA', 9]);
  assert.deepStrictEqual(S('posGenCode: exhausts 100 tries and returns the last code').ret, ['AAA-000-AAA', 900]);
  assert.deepStrictEqual(S('posGenCode: empty array is used as-is (truthy), not the slice').ret, ['AAA-000-AAA', 9, 'AAA-000-AAA', 900]);
  const pc = S('posShowClaimCode: renders the code, escaped name and order id').modal.content; assert(pc.includes('ABC-123-XYZ') && pc.includes('Box &lt;i&gt;&quot;x&quot;&lt;/i&gt;') || pc.includes('Box &lt;i&gt;"x"&lt;/i&gt;'), 'code + escaped name');
  assert.strictEqual(S('posShowClaimCode: close button').modal.visible, 'none');
  assert.deepStrictEqual(S('stubs: buyItem adds to the cart; confirmBuy does nothing').ret[0], [null, null]);
  assert(!o.steps.some(s => s.calls.some(c => c.startsWith('["window-error"'))), 'no uncaught errors inside timers in any step');
  assert(JSON.parse(S('cartSetQty: refreshes the cart item from the store').ret).s1.item.name === 'Renamed2', 'setQty refreshes the cart item');
  assert(S('fab: total shows thousands separators').fab.includes('1,200'), 'FAB total is locale-formatted');
  assert(!S('cartOpenModal: balance exactly equal to the total can afford').modal.content.includes('Not enough coins'), 'exact balance can afford in the modal');
  assert.strictEqual(S('checkout: empty cart is a no-op (an open modal stays open)').modal.visible, 'flex');
  assert(S('checkout: balance exactly equal to the total succeeds').state.orders.length === 3 && S('checkout: balance exactly equal to the total succeeds').state.students[1].coins === 0, 'exact balance buys');
  assert(S('checkout: an rpc error alongside an ok-looking result is still a failure').state.orders.length === 0);
  { const cs = S('checkout: codes in one checkout are unique against the in-progress draft (random stub)').state.orders.map(x => x.claimCode); assert(cs.length === 2 && cs[0] !== cs[1], 'second code retried against the draft'); }
  assert.deepStrictEqual(S('checkout: ach award fires after the 400ms delay, not before').ret, [0, 1]);
  assert(S('renderStudentStore: all').page.includes('<i>"snack"</i>') === false && S('renderStudentStore: all').page.includes('&lt;i&gt;'), 'description is escaped');
  assert.strictEqual(o.steps.filter(s => s.err && !/missing #s-store/.test(s.label)).length, 0, 'no unexpected exceptions in any step');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log(' - reverse-transform: original rebuilt byte-for-byte from the twin; 17 exports');
  console.log(' - ' + o.steps.length + ' steps compared');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
