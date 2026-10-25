// Phase 7 (Stream D) — equivalence check for modules/shop/shop_inventory.js.
//
// Real-imports AppStore (state-manager.js, zero imports of its own), plus
// dom.js's toast/showModal/closeModalForce and utils.js's _esc/todayStr/
// nowStr — all clean leaf files, used FOR REAL on both sides (same pattern
// as shop_orders.js, file 6/30) rather than mocked, since their DOM/string
// manipulation is simple and deterministic.
//
// getItemRarity (bare, shop_store.js — not yet converted) is stubbed with a
// simple deterministic function; its own logic isn't under test here, only
// that shop_inventory.js threads its return value through correctly.
// currentUser/currentRole stay bare `let`-free stubs (bare assignment, not
// `let` — jsdom's win.eval() doesn't share `let` across separate calls).
//
// What's compared: renderInventory's full rendered HTML (hero stats,
// tab wiring) across empty/populated states; invFilter's search/category/
// status/sort combinations and its empty-state variants; invHistFilter's
// search/category filtering and its claim-code button branch; invUseItem/
// invConfirmUse (modal content, state mutation incl. quantity decrement vs.
// full consumption, toast, re-render, and the vanished-item early-return
// paths); invViewDetail's modal content; invShowCodes' single-vs-multiple
// pending order branches; invUpdateSidebarBadge's every branch; and the two
// load-time subscribers (session:booted / nav:sidebar-rendered), role-gated
// and delayed (50ms / 20ms respectively).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const STARTER_HTML = `<!doctype html><html><body>
  <button id="nav-s-inventory">Inventory</button>
  <div id="s-inventory"></div>
  <div id="toast"></div>
  <div id="modal-box" class="modal-box"></div>
  <div id="modal-content"></div>
  <div id="modal-overlay" style="display:none"></div>
</body></html>`;

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  win.eval("currentUser = null; currentRole = null;");
  win.__posShowClaimCodeCalls = [];
  win.posShowClaimCode = function (code, info, orderId) { win.__posShowClaimCodeCalls.push({ code, info, orderId }); };
  win.navTo = function () {};
  win.getItemRarity = function (item) { return { label: 'Epic', cls: 'rarity-epic-' + item.id }; };
  win.DEFAULT_DB = { inventory: {}, redemptions: [], store: [], orders: [] };
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };
  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  return { win, logs };
}
async function evalOriginal(win) {
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  win.eval(read('modules/core/state-manager.js'));
  win.eval(read('dom.js'));
  win.eval(read('utils.js'));
  win.eval(read('modules/shop/shop_inventory.js'));
  await win.AppStore.ready;
}
async function evalBridge(win) {
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'shop_inventory-combined-bundle.js'), 'utf8'));
  await win.AppStore.ready;
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v).replace(ISO, '<ISO>'));

function seedState(win, state) {
  win.AppStore.updateState(draft => Object.assign(draft, state), { type: 'test:seed' });
}
const modalSnap = win => ({
  visible: win.document.getElementById('modal-overlay').style.display,
  content: win.document.getElementById('modal-content').innerHTML,
});
const toastSnap = win => ({
  visible: win.document.getElementById('toast').style.display,
  html: win.document.getElementById('toast').innerHTML,
});
const badgeSnap = win => {
  const b = win.document.querySelector('#nav-s-inventory .inv-nav-badge');
  return b ? { text: b.textContent, count: win.document.querySelectorAll('#nav-s-inventory .inv-nav-badge').length } : null;
};

const s1Inventory = () => ({
  s1: [
    { itemId: 'i1', itemName: 'Sticker Pack', emoji: '🎨', category: 'supplies', quantity: 3, status: 'active', datePurchased: 'Jan 1', source: 'Store' },
    { itemId: 'i2', itemName: 'Nap Pass', emoji: '😴', category: 'privilege', quantity: 1, status: 'active', datePurchased: 'Jan 2', source: 'Store' },
    { itemId: 'i3', itemName: 'Used Thing', emoji: '📦', category: 'food', quantity: 1, status: 'used', datePurchased: 'Jan 3', source: 'Store' },
    { itemId: 'i4', itemName: 'Weird Thing', emoji: '🌀', category: 'bogus-cat', quantity: 1, status: 'active', datePurchased: 'Jan 4', source: 'Store' },
  ],
});
const fullState = () => ({
  inventory: s1Inventory(),
  redemptions: [
    { studentId: 's1', itemId: 'i1', itemName: 'Sticker Pack', pts: 50, date: 'Jan 1', time: '9:00 AM', orderId: 'o1' },
    { studentId: 's1', itemId: 'i2', itemName: 'Nap Pass', pts: 100, date: 'Jan 2', time: '10:00 AM', claimCode: 'ABC-123', orderId: 'o2' },
    { studentId: 's2', itemId: 'i9', itemName: 'Not mine', pts: 5, date: 'Jan 1' },
  ],
  store: [
    { id: 'i1', name: 'Sticker Pack', emoji: '🎨', cost: 50, cat: 'supplies', desc: 'Fun stickers' },
    { id: 'i2', name: 'Nap Pass', emoji: '😴', cost: 100, cat: 'privilege', desc: 'A nap' },
  ],
  orders: [
    { studentId: 's1', itemId: 'i1', orderId: 'o1', status: 'claimed', claimCode: 'X1', createdDateStr: 'Jan 1' },
    { studentId: 's1', itemId: 'i2', orderId: 'o2', status: 'pending', claimCode: 'ABC-123', createdDateStr: 'Jan 2' },
  ],
});

async function run(win) {
  const out = {};
  win.eval("currentUser = { id: 's1' };");

  // ── renderInventory: empty then populated ──
  out.render = {};
  seedState(win, { inventory: {}, redemptions: [], store: [], orders: [] });
  win.renderInventory();
  out.render.empty = win.document.getElementById('s-inventory').innerHTML;
  seedState(win, fullState());
  win.renderInventory();
  out.render.populatedGrid = win.document.getElementById('inv-grid').innerHTML;
  out.render.populatedResultsCount = win.document.getElementById('inv-results-count').textContent;

  // ── invFilter: search / category / status / sort ──
  out.filter = {};
  const setFilterInputs = (q, cat, status, sort) => {
    win.document.getElementById('inv-search').value = q;
    win.document.getElementById('inv-cat-filter').value = cat;
    win.document.getElementById('inv-status-filter').value = status;
    win.document.getElementById('inv-sort').value = sort;
  };
  setFilterInputs('nap', 'all', 'all', 'recent'); win.invFilter();
  out.filter.bySearch = win.document.getElementById('inv-grid').innerHTML;
  setFilterInputs('', 'food', 'all', 'recent'); win.invFilter();
  out.filter.byCategory = win.document.getElementById('inv-grid').innerHTML;
  setFilterInputs('', 'all', 'used', 'recent'); win.invFilter();
  out.filter.byStatus = win.document.getElementById('inv-grid').innerHTML;
  setFilterInputs('', 'all', 'all', 'name'); win.invFilter();
  out.filter.sortName = win.document.getElementById('inv-grid').innerHTML;
  setFilterInputs('', 'all', 'all', 'qty-desc'); win.invFilter();
  out.filter.sortQtyDesc = win.document.getElementById('inv-grid').innerHTML;
  setFilterInputs('nomatch', 'all', 'all', 'recent'); win.invFilter();
  out.filter.noMatch = win.document.getElementById('inv-grid').innerHTML;
  out.filter.noMatchCount = win.document.getElementById('inv-results-count').textContent;
  seedState(win, { inventory: {}, redemptions: [], store: [], orders: [] });
  setFilterInputs('', 'all', 'all', 'recent'); win.invFilter();
  out.filter.emptyInventory = win.document.getElementById('inv-grid').innerHTML;
  seedState(win, fullState());

  // ── invHistFilter ──
  out.hist = {};
  win.invHistFilter();
  out.hist.all = win.document.getElementById('inv-hist-list').innerHTML;
  win.document.getElementById('inv-hist-search').value = 'sticker';
  win.document.getElementById('inv-hist-cat').value = 'all';
  win.invHistFilter();
  out.hist.bySearch = win.document.getElementById('inv-hist-list').innerHTML;
  win.document.getElementById('inv-hist-search').value = '';
  win.document.getElementById('inv-hist-cat').value = 'privilege';
  win.invHistFilter();
  out.hist.byCategory = win.document.getElementById('inv-hist-list').innerHTML;
  win.document.getElementById('inv-hist-search').value = 'nomatch';
  win.invHistFilter();
  out.hist.noMatch = win.document.getElementById('inv-hist-list').innerHTML;
  win.document.getElementById('inv-hist-search').value = '';
  win.document.getElementById('inv-hist-cat').value = 'all';

  // ── invUseItem / invConfirmUse ──
  out.use = {};
  win.invUseItem('nope'); // unknown item -> toast, no modal
  out.use.unknownToast = toastSnap(win);
  win.document.getElementById('toast').innerHTML = ''; win.document.getElementById('toast').style.display = '';
  win.invUseItem('i3'); // already used
  out.use.usedToast = toastSnap(win);
  win.document.getElementById('toast').innerHTML = ''; win.document.getElementById('toast').style.display = '';
  win.invUseItem('i2'); // privilege item, quantity 1
  out.use.promptModal = modalSnap(win);
  win.invConfirmUse('i2');
  out.use.afterConsumeFully = { modal: modalSnap(win), toast: toastSnap(win), item: clean((win.AppStore.getSlice(s => s.inventory).s1 || []).find(i => i.itemId === 'i2')) };
  win.document.getElementById('toast').innerHTML = ''; win.document.getElementById('toast').style.display = '';
  win.invUseItem('i1'); win.invConfirmUse('i1'); // quantity 3 -> decrements, stays active
  out.use.afterDecrement = clean((win.AppStore.getSlice(s => s.inventory).s1 || []).find(i => i.itemId === 'i1'));
  win.invConfirmUse('nope'); // vanished list entry -> closeModalForce only
  out.use.confirmVanishedNoThrow = true;
  const van = { inventory: { s1: [] }, redemptions: [], store: [], orders: [] };
  seedState(win, van);
  win.invConfirmUse('i1'); // no list at all for this student
  out.use.confirmNoListNoThrow = true;
  seedState(win, fullState());

  // ── invViewDetail ──
  out.detail = {};
  win.invViewDetail('nope');
  out.detail.unknownToast = toastSnap(win);
  win.document.getElementById('toast').innerHTML = ''; win.document.getElementById('toast').style.display = '';
  win.invViewDetail('i1');
  out.detail.knownModal = modalSnap(win);

  // ── invShowCodes ──
  out.codes = {};
  win.invShowCodes('i9'); // no pending orders for this item
  out.codes.noPendingToast = toastSnap(win);
  win.document.getElementById('toast').innerHTML = ''; win.document.getElementById('toast').style.display = '';
  win.__posShowClaimCodeCalls.length = 0;
  win.invShowCodes('i2'); // exactly one pending order -> posShowClaimCode direct call, no modal
  out.codes.singlePendingCall = clean(win.__posShowClaimCodeCalls);
  const multi = fullState();
  multi.orders.push({ studentId: 's1', itemId: 'i2', orderId: 'o3', status: 'pending', claimCode: 'ZZZ-999', createdDateStr: 'Jan 3' });
  seedState(win, multi);
  win.invShowCodes('i2'); // two pending orders -> modal listing both
  out.codes.multiPendingModal = modalSnap(win);
  seedState(win, fullState());

  // ── invUpdateSidebarBadge ──
  out.badge = {};
  seedState(win, fullState());
  win.invUpdateSidebarBadge();
  out.badge.withItems = badgeSnap(win); // i1 qty3 + i2 qty1 = 4 (i3 used, still counted since badge sums quantity regardless of status)
  win.invUpdateSidebarBadge();
  out.badge.againNoDup = badgeSnap(win);
  seedState(win, { inventory: { s1: Array.from({ length: 5 }, (_, i) => ({ itemId: 'x' + i, quantity: 30 })) }, redemptions: [], store: [], orders: [] });
  win.invUpdateSidebarBadge();
  out.badge.capped = badgeSnap(win); // 150 -> 99+
  seedState(win, { inventory: {}, redemptions: [], store: [], orders: [] });
  win.invUpdateSidebarBadge();
  out.badge.zero = badgeSnap(win);
  win.eval("currentUser = null;");
  seedState(win, fullState());
  win.invUpdateSidebarBadge();
  out.badge.noCurrentUser = badgeSnap(win);
  win.eval("currentUser = { id: 's1' };");
  win.document.getElementById('nav-s-inventory').remove();
  win.invUpdateSidebarBadge();
  out.badge.noButtonNoThrow = true;
  win.document.body.insertAdjacentHTML('beforeend', '<button id="nav-s-inventory">Inventory</button>');

  // ── load-time subscribers ──
  // (Waits are deliberately generous: the subscribers fire after real 50ms / 20ms timers, and the original
  //  80ms / 50ms waits left only a 30ms margin — one slow tick produced a rare spurious failure.)
  out.subs = {};
  seedState(win, fullState());
  win.eval("currentRole = 'teacher';");
  win.document.getElementById('nav-s-inventory').querySelector('.inv-nav-badge')?.remove();
  win.AppStore.emit({ type: 'session:booted' });
  await new Promise(r => setTimeout(r, 250));
  out.subs.teacherBootIgnored = badgeSnap(win);
  win.eval("currentRole = 'student';");
  win.AppStore.emit({ type: 'session:booted' });
  await new Promise(r => setTimeout(r, 250));
  out.subs.studentBoot = badgeSnap(win);
  win.document.getElementById('nav-s-inventory').querySelector('.inv-nav-badge')?.remove();
  win.eval("currentRole = 'teacher';");
  win.AppStore.emit({ type: 'nav:sidebar-rendered' });
  await new Promise(r => setTimeout(r, 150));
  out.subs.teacherSidebarIgnored = badgeSnap(win);
  win.eval("currentRole = 'student';");
  win.AppStore.emit({ type: 'nav:sidebar-rendered' });
  await new Promise(r => setTimeout(r, 150));
  out.subs.studentSidebar = badgeSnap(win);

  return out;
}

async function main() {
  const A = makeWindow(), B = makeWindow();
  await evalOriginal(A.win);
  await evalBridge(B.win);

  assert.ok(A.logs.some(l => l.includes('shop/inventory.js loaded')));
  assert.deepStrictEqual(clean(B.logs), clean(A.logs), 'load-time console output must match');

  const oa = await run(A.win), ob = await run(B.win);
  assert.deepStrictEqual(clean(ob), clean(oa), 'bridge output must exactly match the original at every step');

  const o = clean(oa);
  assert.ok(o.render.empty.includes('id="inv-grid"') && !o.render.empty.includes('Sticker'));
  assert.ok(o.render.populatedGrid.includes('Sticker Pack') && o.render.populatedGrid.includes('Nap Pass') && o.render.populatedGrid.includes('Used Thing'));
  assert.ok(o.render.populatedGrid.includes('inv-card-used'), 'used item gets the used-card class');
  assert.strictEqual(o.render.populatedResultsCount, 'Showing 4 items');

  assert.ok(o.filter.bySearch.includes('Nap Pass') && !o.filter.bySearch.includes('Sticker Pack'));
  assert.ok(o.filter.byCategory.includes('Used Thing') && !o.filter.byCategory.includes('Sticker'));
  assert.ok(o.filter.byStatus.includes('Used Thing') && !o.filter.byStatus.includes('Sticker'));
  const nameOrder = [...o.filter.sortName.matchAll(/inv-name">([^<]*)</g)].map(m => m[1]);
  assert.deepStrictEqual(nameOrder, ['Nap Pass', 'Sticker Pack', 'Used Thing', 'Weird Thing'].sort((a, b) => a.localeCompare(b)));
  const qtyOrder = [...o.filter.sortQtyDesc.matchAll(/inv-qty-badge[^>]*">(\d+)×/g)].map(m => Number(m[1]));
  assert.deepStrictEqual(qtyOrder, [...qtyOrder].sort((a, b) => b - a));
  assert.ok(o.filter.noMatch.includes('No items match'));
  assert.strictEqual(o.filter.noMatchCount, 'Showing 0 items');
  assert.ok(o.filter.emptyInventory.includes('Inventory Empty') && o.filter.emptyInventory.includes("Visit the Armory"));

  assert.ok(o.hist.all.includes('Sticker Pack') && o.hist.all.includes('Nap Pass'), 'both s1 redemptions shown, s2 excluded');
  assert.ok(o.hist.bySearch.includes('Sticker Pack') && !o.hist.bySearch.includes('Nap Pass'));
  assert.ok(o.hist.byCategory.includes('Nap Pass') && !o.hist.byCategory.includes('Sticker Pack'));
  assert.ok(o.hist.noMatch.includes('No purchase history') && o.hist.noMatch.includes('No records match'));
  assert.ok(o.hist.all.includes('ABC-123'), 'claim code shown for the redemption that has one');

  assert.ok(o.use.unknownToast.html.includes('already used or not found'));
  assert.ok(o.use.usedToast.html.includes('already used or not found'));
  assert.strictEqual(o.use.promptModal.visible, 'flex');
  assert.ok(o.use.promptModal.content.includes('Use Nap Pass'));
  assert.strictEqual(o.use.afterConsumeFully.item.status, 'used');
  assert.strictEqual(o.use.afterConsumeFully.item.quantity, 1, 'quantity 1 stays 1, just flips to used');
  assert.ok(o.use.afterConsumeFully.toast.html.includes('used!'));
  assert.strictEqual(o.use.afterDecrement.quantity, 2, '3 -> 2 on use');
  assert.strictEqual(o.use.afterDecrement.status, 'active', 'decrementing keeps it active rather than marking used');

  assert.ok(o.detail.unknownToast.html.includes('not found'));
  assert.ok(o.detail.knownModal.content.includes('Sticker Pack') && o.detail.knownModal.content.includes('rarity-epic-i1'));

  assert.ok(o.codes.noPendingToast.html.includes('No pending orders'));
  assert.deepStrictEqual(o.codes.singlePendingCall, [{ code: 'ABC-123', info: { emoji: '😴', name: 'Nap Pass' }, orderId: 'o2' }]);
  assert.strictEqual(o.codes.multiPendingModal.visible, 'flex');
  assert.ok(o.codes.multiPendingModal.content.includes('2 pending orders'));

  assert.strictEqual(o.badge.withItems.text, '6', 'i1 qty3 + i2 qty1 + i3 qty1 + i4 qty1 = 6; the used item (i3) still counts toward the quantity total');
  assert.strictEqual(o.badge.againNoDup.count, 1);
  assert.strictEqual(o.badge.capped.text, '99+');
  assert.strictEqual(o.badge.zero, null);
  assert.strictEqual(o.badge.noCurrentUser, null);

  assert.strictEqual(o.subs.teacherBootIgnored, null);
  assert.strictEqual(o.subs.studentBoot && o.subs.studentBoot.text, '6');
  assert.strictEqual(o.subs.teacherSidebarIgnored, null);
  assert.strictEqual(o.subs.studentSidebar && o.subs.studentSidebar.text, '6');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('Original shop_inventory.js (via the real state-manager/dom/utils chain) and the');
  console.log('bundled src/ twin (real-imported through the same chain) agree on:');
  console.log(' - renderInventory (empty + populated) and invFilter\'s search/category/status/sort');
  console.log('   combinations, incl. every empty-state variant');
  console.log(' - invHistFilter\'s search/category filtering and its claim-code display');
  console.log(' - invUseItem/invConfirmUse: prompt+confirm, decrement vs. full consumption,');
  console.log('   toast, re-render, and every vanished-item early-return path');
  console.log(' - invViewDetail and invShowCodes (single vs. multiple pending orders)');
  console.log(' - invUpdateSidebarBadge: every branch incl. 99+ cap and no-currentUser');
  console.log(' - both load-time subscribers: role-gated, 50ms/20ms delayed');
}

main().catch(e => { console.error(e); process.exit(1); });
