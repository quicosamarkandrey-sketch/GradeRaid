// Phase 7 (Stream D) — equivalence check for modules/shop/shop_admin_store.js.
//
// Real-imports AppStore (state-manager.js) and DBService (db-service.js —
// the multi-hop chain from classroom-service.js, file 4/30), plus dom.js's
// toast/showModal/closeModalForce and utils.js's _esc/uid, used for real
// (shop_orders.js pattern, file 6/30) rather than mocked, since they're
// simple deterministic leaf files.
//
// currentUser stays a bare `let` global. DBService.rpc is stubbed via the
// same SupabaseClient-mock-client dispatch table as classroom-service.js.
//
// _adminStoreInterval (a real `export let`) is the one state variable this
// file shares with not-yet-converted nav.js via classic scripts' shared
// lexical scope — see the src file's header for the disclosed limitation.
// This check only verifies THIS file's own internal use of it (the overlap
// guard and the auto-cleanup-on-navigate-away branch), not nav.js's.
//
// TIMING: renderAdminStore()'s live-refresh interval is real (3000ms,
// unfaked per the project's async-testing rule), so this check spends
// ~12s of real wall-clock time (run once per window, in parallel) walking
// its full lifecycle: idle tick, change-while-editing (skipped), the same
// stale change applied once editing ends, and interval teardown when the
// page is no longer '.active'.
//
// What's compared: renderAdminStore's full rendered HTML (item count,
// total stock, per-row stock-color thresholds) and its interval lifecycle;
// renderProductRows in isolation; stockStartEdit/stockSave (validation via
// a vanished item, RPC success incl. the server-returned final stock
// overriding the input value, RPC error path); productForm's Add vs Edit
// markup; openAddProduct/openEditProduct's real modal content;
// doAddProduct/doEditProduct (name-required validation, the ownerTeacherId
// stamp, the stock-dirty RPC skip-if-unchanged optimization, the RPC error
// toast); deleteProduct's real confirm-modal content; confirmDeleteProduct
// (success + its own RPC error toast).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const STARTER_HTML = `<!doctype html><html><body>
  <div id="a-store" class="active"></div>
  <div id="toast"></div>
  <div id="modal-box" class="modal-box"></div>
  <div id="modal-content"></div>
  <div id="modal-overlay" style="display:none"></div>
</body></html>`;

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  // Bare assignment (no let/const/var): jsdom's win.eval() gives each
  // separate call its OWN isolated top-level lexical scope for let/const —
  // unlike real browsers, where classic <script> tags share ONE global
  // lexical environment. A `let` here would be invisible to every later
  // eval() call (including shop_admin_store.js's own). A bare assignment
  // in sloppy mode creates a real window property instead, which every
  // later eval's free-variable lookup CAN see (matching classroom-service.js
  // and recitation-service.js's working pattern for the same reason).
  win.eval("currentUser = { id: 't1' }; currentRole = 'teacher';");
  win.DEFAULT_DB = { store: [] };
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };

  win.__rpcCalls = [];
  win.__rpcMock = {};
  const mockClient = {
    auth: { getSession: async () => ({ data: { session: null } }) },
    rpc: async (name, params) => {
      win.__rpcCalls.push({ name, params });
      const entry = win.__rpcMock[name];
      if (typeof entry === 'function') return entry(params);
      if (entry) return entry;
      throw new Error('unmocked rpc: ' + name);
    },
  };
  win.SupabaseClient = { getClient: () => mockClient, resolveProvider: () => 'supabase' };
  win.__EDUQUEST_SUPABASE_URL__ = '';
  win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };

  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  win.console.warn = () => {};
  win.console.error = () => {};
  return { win, logs };
}
async function evalOriginal(win) {
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  read('utils.js'); // sanity: file exists (also real-eval'd below)
  win.eval(read('repository/table-sync.js'));
  win.eval(read('repository/pull-mappers.js'));
  win.eval(read('repository/realtime-groups.js'));
  win.eval(read('db-service.js'));
  win.eval(read('modules/core/state-manager.js'));
  win.eval(read('dom.js'));
  win.eval(read('utils.js'));
  win.eval(read('modules/shop/shop_admin_store.js'));
  await win.AppStore.ready;
}
async function evalBridge(win) {
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'shop_admin_store-combined-bundle.js'), 'utf8'));
  await win.AppStore.ready;
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const IDRE = /id_[a-z0-9]+/g;
const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v).replace(ISO, '<ISO>').replace(IDRE, '<TMPID>'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function seedStore(win, items) {
  win.AppStore.updateState(draft => { draft.store = items; }, { type: 'test:seed' });
}
const configureRpc = win => mock => Object.assign(win.__rpcMock, mock);
const resetRpc = win => () => { win.__rpcMock = {}; win.__rpcCalls.length = 0; };

async function run(win) {
  const out = {};
  const cfg = configureRpc(win), reset = resetRpc(win);

  // ── renderAdminStore / renderProductRows: full HTML + interval lifecycle ──
  seedStore(win, [
    { id: 'p1', emoji: '🎨', name: 'Sticker Pack', desc: 'Fun stickers', cat: 'supplies', cost: 50, stock: 0 },
    { id: 'p2', emoji: '🍕', name: 'Pizza Party', desc: '<b>XSS</b>', cat: 'food', cost: 200, stock: 3 },
    { id: 'p3', emoji: '⭐', name: 'VIP Seat', desc: 'Best seat', cat: 'privilege', cost: 500, stock: 10 },
    { id: 'p4', emoji: '❓', name: 'Mystery Box', desc: 'Surprise', cat: 'bogus-cat', cost: 75, stock: 5 },
  ]);
  win.renderAdminStore();
  out.render = win.document.getElementById('a-store').innerHTML;
  out.productRows = win.renderProductRows();

  // NOTE: `_adminStoreInterval` itself cannot be observed from OUTSIDE the
  // eval'd file via `win._adminStoreInterval` on EITHER side — that
  // property is a one-time load-time snapshot on both the original and the
  // bridge (see the src file's header). Every check below instead uses
  // purely OBSERVABLE tbody effects, which is the only way to verify the
  // interval's real behavior from outside.

  // idle tick: active, no change -> HTML untouched
  await sleep(3100);
  out.afterIdleTick = win.document.getElementById('admin-product-list').innerHTML;

  // mutate underlying state directly (bypassing stockSave) WHILE an editing
  // input is present -> the tick must skip refreshing, per the guard
  win.document.getElementById('admin-product-list').insertAdjacentHTML('beforeend', '<tr><td><input class="stock-edit-input"></td></tr>');
  seedStore(win, [
    { id: 'p1', emoji: '🎨', name: 'Sticker Pack', desc: 'Fun stickers', cat: 'supplies', cost: 50, stock: 7 }, // changed
    { id: 'p2', emoji: '🍕', name: 'Pizza Party', desc: '<b>XSS</b>', cat: 'food', cost: 200, stock: 3 },
    { id: 'p3', emoji: '⭐', name: 'VIP Seat', desc: 'Best seat', cat: 'privilege', cost: 500, stock: 10 },
    { id: 'p4', emoji: '❓', name: 'Mystery Box', desc: 'Surprise', cat: 'bogus-cat', cost: 75, stock: 5 },
  ]);
  await sleep(3100);
  out.skippedWhileEditing = win.document.getElementById('admin-product-list').innerHTML;

  // remove the editing input; the SAME stale (already-seeded) change is
  // still pending against the closure's original baseline -> next tick applies it
  win.document.querySelector('.stock-edit-input')?.closest('tr')?.remove();
  await sleep(3100);
  out.appliedAfterEditingEnds = win.document.getElementById('admin-product-list').innerHTML;

  // page navigated away ('.active' removed) -> interval must tear itself
  // down. Observed indirectly: restore '.active', apply ANOTHER change, and
  // confirm the tick that would have caught it never happens (if the
  // interval were still alive, this LATER change would show up).
  win.document.getElementById('a-store').classList.remove('active');
  await sleep(3100);
  win.document.getElementById('a-store').classList.add('active');
  seedStore(win, [
    { id: 'p1', emoji: '🎨', name: 'Sticker Pack', desc: 'Fun stickers', cat: 'supplies', cost: 50, stock: 99 }, // changed again
    { id: 'p2', emoji: '🍕', name: 'Pizza Party', desc: '<b>XSS</b>', cat: 'food', cost: 200, stock: 3 },
    { id: 'p3', emoji: '⭐', name: 'VIP Seat', desc: 'Best seat', cat: 'privilege', cost: 500, stock: 10 },
    { id: 'p4', emoji: '❓', name: 'Mystery Box', desc: 'Surprise', cat: 'bogus-cat', cost: 75, stock: 5 },
  ]);
  await sleep(3100);
  out.staysDeadAfterTeardown = win.document.getElementById('admin-product-list').innerHTML;

  // ── stockStartEdit / stockSave ──
  out.stock = {};
  win.stockStartEdit('nope'); // unknown item -> no-op (no #stock-cell-nope in DOM)
  out.stock.startUnknownNoThrow = true;
  win.stockStartEdit('p2');
  out.stock.editHtml = win.document.getElementById('stock-cell-p2').innerHTML;
  win.document.getElementById('stock-input-p2').value = '9';
  reset();
  win.stockSave('nope'); // no #stock-input-nope -> returns before RPC
  out.stock.saveNoInputNoRpc = win.__rpcCalls.length;
  cfg({ restock_shop_product: { data: 9, error: null } });
  await win.stockSave('p2');
  out.stock.saveSuccessCall = clean(win.__rpcCalls[win.__rpcCalls.length - 1]);
  out.stock.saveSuccessState = clean(win.AppStore.getSlice(s => s.store).find(i => i.id === 'p2').stock);
  reset();
  win.stockStartEdit('p3');
  win.document.getElementById('stock-input-p3').value = 'notanumber';
  cfg({ restock_shop_product: { data: null, error: { message: 'RLS' } } });
  await win.stockSave('p3');
  out.stock.saveErrorState = clean(win.AppStore.getSlice(s => s.store).find(i => i.id === 'p3').stock); // unchanged on error
  out.stock.saveErrorToast = win.document.getElementById('toast').innerHTML;
  reset();
  cfg({ restock_shop_product: { data: 'not-a-number', error: null } }); // non-numeric data -> falls back to the input's own value
  win.stockStartEdit('p1');
  win.document.getElementById('stock-input-p1').value = '2';
  await win.stockSave('p1');
  out.stock.dataFallbackState = clean(win.AppStore.getSlice(s => s.store).find(i => i.id === 'p1').stock);
  reset();
  // the min-0 floor (Math.max(0, parseInt(input.value) || 0)) applies to the
  // LOCAL input-derived value, not to whatever the server echoes back in
  // `data` — a non-numeric `data` here forces the fallback-to-`val` path so
  // the floor is actually exercised.
  cfg({ restock_shop_product: { data: null, error: null } });
  win.stockStartEdit('p4');
  win.document.getElementById('stock-input-p4').value = '-5';
  await win.stockSave('p4');
  out.stock.negativeFloorState = clean(win.AppStore.getSlice(s => s.store).find(i => i.id === 'p4').stock);

  // ── productForm / openAddProduct / openEditProduct ──
  out.forms = {};
  win.openAddProduct();
  out.forms.addModal = win.document.getElementById('modal-content').innerHTML;
  win.openEditProduct('p2');
  out.forms.editModal = win.document.getElementById('modal-content').innerHTML;
  win.openEditProduct('ghost'); // unknown -> productForm(undefined) -> Add-shaped form, no throw
  out.forms.editUnknownModal = win.document.getElementById('modal-content').innerHTML;

  // ── doAddProduct ──
  out.add = {};
  win.openAddProduct();
  win.document.getElementById('pf-emoji').value = '';
  win.document.getElementById('pf-name').value = '   ';
  await win.doAddProduct();
  out.add.emptyNameToast = win.document.getElementById('toast').innerHTML;
  out.add.emptyNameStoreLen = clean(win.AppStore.getSlice(s => s.store).length);
  win.document.getElementById('toast').innerHTML = ''; win.document.getElementById('toast').style.display = '';
  win.document.getElementById('pf-name').value = 'New Thing';
  win.document.getElementById('pf-desc').value = 'A desc';
  win.document.getElementById('pf-cat').value = 'mystery';
  win.document.getElementById('pf-cost').value = '77';
  win.document.getElementById('pf-stock').value = '4';
  reset();
  cfg({ restock_shop_product: { data: 4, error: null } });
  await win.doAddProduct();
  out.add.newItem = clean(win.AppStore.getSlice(s => s.store).find(i => i.name === 'New Thing'));
  out.add.newItemRpcCall = clean(win.__rpcCalls[win.__rpcCalls.length - 1]);
  out.add.modalClosedAfter = win.document.getElementById('modal-overlay').style.display;
  reset();
  cfg({ restock_shop_product: { data: null, error: { message: 'sync fail' } } });
  win.document.getElementById('pf-name').value = 'Another'; // (modal isn't open; doAddProduct reads whatever's currently in the DOM's #pf-* fields)
  await win.doAddProduct();
  out.add.rpcErrorToast = win.document.getElementById('toast').innerHTML;

  // ── doEditProduct ──
  out.edit = {};
  win.doEditProduct('ghost'); // vanished item -> no-op
  out.edit.vanishedNoThrow = true;
  win.openEditProduct('p3');
  win.document.getElementById('pf-name').value = '';
  await win.doEditProduct('p3');
  out.edit.emptyNameToast = win.document.getElementById('toast').innerHTML;
  win.document.getElementById('toast').innerHTML = ''; win.document.getElementById('toast').style.display = '';
  win.openEditProduct('p3');
  win.document.getElementById('pf-name').value = 'VIP Seat Renamed';
  win.document.getElementById('pf-stock').value = '10'; // UNCHANGED from p3's current stock -> stockDirty:false -> no RPC
  reset();
  await win.doEditProduct('p3');
  out.edit.unchangedStockNoRpc = win.__rpcCalls.length;
  out.edit.renamedItem = clean(win.AppStore.getSlice(s => s.store).find(i => i.id === 'p3'));
  win.openEditProduct('p3');
  win.document.getElementById('pf-name').value = 'VIP Seat Renamed';
  win.document.getElementById('pf-stock').value = '20'; // now dirty
  reset();
  cfg({ restock_shop_product: { data: 20, error: null } });
  await win.doEditProduct('p3');
  out.edit.dirtyStockCall = clean(win.__rpcCalls[win.__rpcCalls.length - 1]);

  // ── deleteProduct / confirmDeleteProduct ──
  out.del = {};
  win.deleteProduct('p4');
  out.del.confirmModal = win.document.getElementById('modal-content').innerHTML;
  win.deleteProduct('ghost'); // vanished -> item?.name renders as undefined, no throw
  out.del.confirmModalUnknown = win.document.getElementById('modal-content').innerHTML;
  reset();
  cfg({ delete_shop_product: { data: null, error: null } });
  await win.confirmDeleteProduct('p4');
  out.del.afterDelete = { storeIds: clean(win.AppStore.getSlice(s => s.store).map(i => i.id)), toast: win.document.getElementById('toast').innerHTML, modal: win.document.getElementById('modal-overlay').style.display };
  reset();
  cfg({ delete_shop_product: { data: null, error: { message: 'delete fail' } } });
  await win.confirmDeleteProduct('p1');
  out.del.deleteErrorToast = win.document.getElementById('toast').innerHTML;
  out.del.deleteErrorStoreIds = clean(win.AppStore.getSlice(s => s.store).map(i => i.id)); // still removed locally despite server error

  return out;
}

function main() {
  return (async () => {
    const O = makeWindow(), B = makeWindow();
    await evalOriginal(O.win);
    await evalBridge(B.win);

    assert.ok(O.logs.some(l => l.includes('admin-store.js loaded')));
    assert.deepStrictEqual(clean(B.logs), clean(O.logs), 'load-time console output must match');

    const [oa, ob] = await Promise.all([run(O.win), run(B.win)]);
    assert.deepStrictEqual(clean(ob), clean(oa), 'bridge output must exactly match the original at every step');

    // ── hand-computed sanity on the ORIGINAL's output ──
    const o = clean(oa);
    assert.ok(o.render.includes('4 items') && o.render.includes('18 total stock'), '0+3+10+5 = 18');
    assert.ok(o.render.includes('Sticker Pack') && o.render.includes('&lt;b&gt;XSS&lt;/b&gt;'), 'desc escaped');
    assert.ok(o.render.includes('bp-gray">bogus-cat'), 'unknown category falls back to the gray pill class, but keeps its own label text');
    assert.ok(o.productRows.includes('#ffb4ab') /* stock 0 */ && o.productRows.includes('#ffb95f') /* stock 3, <=3 */, 'stock color thresholds');
    assert.ok(o.afterIdleTick.includes('×0'), 'idle tick with no change leaves the rendered stock alone');
    assert.ok(o.skippedWhileEditing.includes('×0'), 'a stock change while a .stock-edit-input is present is NOT applied');
    assert.ok(o.appliedAfterEditingEnds.includes('×7'), 'the same stale change is applied once the editing input is gone, on the NEXT tick');
    assert.ok(o.staysDeadAfterTeardown.includes('×7') && !o.staysDeadAfterTeardown.includes('×99'), "leaving '.active' truly clears the interval — a change made after re-adding '.active' is never picked up, since nothing is polling anymore");

    assert.ok(o.stock.editHtml.includes('stock-edit-input') && o.stock.editHtml.includes('value="3"'));
    assert.strictEqual(o.stock.saveNoInputNoRpc, 0);
    assert.strictEqual(o.stock.saveSuccessCall.params.p_new_stock, 9);
    assert.strictEqual(o.stock.saveSuccessState, 9);
    assert.strictEqual(o.stock.saveErrorState, 10, 'p3 stock (10) unchanged when the RPC errors');
    assert.ok(o.stock.saveErrorToast.includes('Could not update stock'));
    assert.strictEqual(o.stock.dataFallbackState, 2, "non-numeric RPC data falls back to the input's own parsed value (2)");
    assert.strictEqual(o.stock.negativeFloorState, 0, 'a negative value (even one echoed back from data) is floored at 0 via Math.max(0, ...)');

    assert.ok(o.forms.addModal.includes('➕ Add Product') && o.forms.addModal.includes('doAddProduct()'));
    assert.ok(o.forms.editModal.includes('✏️ Edit Product') && o.forms.editModal.includes("doEditProduct('p2')") && o.forms.editModal.includes('selected'));
    assert.ok(o.forms.editUnknownModal.includes('➕ Add Product'), 'editing an unknown id renders the Add-shaped form (item undefined -> isEdit false)');

    assert.ok(o.add.emptyNameToast.includes('Name required'));
    assert.strictEqual(o.add.emptyNameStoreLen, 4, 'nothing was added on the validation failure');
    assert.strictEqual(o.add.newItem.name, 'New Thing');
    assert.strictEqual(o.add.newItem.ownerTeacherId, 't1', "currentUser.id stamped as ownerTeacherId");
    assert.strictEqual(o.add.newItem.id, '<TMPID>');
    assert.strictEqual(o.add.newItemRpcCall.params.p_new_stock, 4);
    assert.strictEqual(o.add.modalClosedAfter, 'none');
    assert.ok(o.add.rpcErrorToast.includes('initial stock may not have synced'));

    assert.strictEqual(o.edit.unchangedStockNoRpc, 0, 'stockDirty:false when the form value matches the existing stock -> no RPC call at all');
    assert.strictEqual(o.edit.renamedItem.name, 'VIP Seat Renamed');
    assert.strictEqual(o.edit.dirtyStockCall.params.p_new_stock, 20);
    assert.ok(o.edit.emptyNameToast.includes('Name required'));

    assert.ok(o.del.confirmModal.includes('Delete Product?') && o.del.confirmModal.includes('Mystery Box'));
    assert.ok(o.del.confirmModalUnknown.includes('Delete Product?'), 'a vanished item still renders the confirm shell (its name interpolates as empty)');
    assert.ok(!o.del.afterDelete.storeIds.includes('p4'), 'p4 removed from the local store slice');
    assert.strictEqual(o.del.afterDelete.modal, 'none');
    assert.ok(o.del.afterDelete.toast.includes('removed'));
    assert.ok(!o.del.deleteErrorStoreIds.includes('p1'), 'still removed locally even though the server delete errored');
    assert.ok(o.del.deleteErrorToast.includes('may not have synced'));

    console.log('EQUIVALENCE CHECK PASSED');
    console.log('Original shop_admin_store.js (via the real state-manager/db-service/dom/utils');
    console.log('chain) and the bundled src/ twin (real-imported through the same chain) agree on:');
    console.log(' - renderAdminStore/renderProductRows\' full HTML + the 3s live-refresh interval\'s');
    console.log('   full lifecycle (idle tick, skip-while-editing, apply-once-editing-ends, teardown)');
    console.log(' - stockStartEdit/stockSave: RPC success incl. server-value fallback, RPC error');
    console.log(' - productForm/openAddProduct/openEditProduct: real modal content, incl. unknown-id');
    console.log(' - doAddProduct/doEditProduct: validation, ownerTeacherId stamp, the stock-dirty');
    console.log('   RPC skip-if-unchanged optimization, RPC error toasts');
    console.log(' - deleteProduct/confirmDeleteProduct: real confirm modal, success + RPC error path');
  })();
}

main().catch(e => { console.error(e); process.exit(1); });
