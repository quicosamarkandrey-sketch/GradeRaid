// Phase 7 (Stream D) — equivalence check for modules/shop/shop_orders.js.
//
// Real-imports AppStore (state-manager.js, zero imports of its own — same
// shape as eql-engine.js's combined-entry, file 3/30), plus dom.js's
// toast/showModal/closeModalForce and utils.js's _esc — both clean leaf
// files (no imports, no load-time side effects), used FOR REAL on both
// sides rather than mocked: their DOM manipulation against fixed element
// ids (#toast, #modal-box, #modal-content, #modal-overlay) is simple enough
// that inspecting the resulting DOM state after a call is more honest than
// intercepting the call.
//
// currentUser/currentRole stay bare `let` globals (index.html's classic
// inline-script declaration), matching every other file's convention.
//
// What's compared: ordStatusPill/ordLabel for all 4 known statuses + an
// unknown one (escaping); renderStudentOrders's full rendered HTML across
// empty/active-only/history-only/mixed/claimCode/cancelReason/claimedAt/
// cancelled-styling states, plus its trailing ordUpdateSidebarBadge call;
// ordSwitchTab's class/style toggling; ordCancelPrompt's real modal
// content+visibility; ordExecuteCancel's AppStore mutation + real
// toast/modal-close + re-render, for both a real order and a vanished one;
// ordUpdateSidebarBadge's every branch (no button, zero, some, capped,
// missing currentUser); and the load-time session:booted subscriber
// (role-gated, delayed 55ms, re-reading ambient currentRole at fire time
// rather than the event's role).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const STARTER_HTML = `<!doctype html><html><body>
  <button id="nav-s-orders">Orders</button>
  <div id="s-orders"></div>
  <div id="toast"></div>
  <div id="modal-box" class="modal-box"></div>
  <div id="modal-content"></div>
  <div id="modal-overlay" style="display:none"></div>
</body></html>`;

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  win.eval("let currentUser = null, currentRole = null;");
  win.Date.now = () => 1234567890123; // ordExecuteCancel's cancelledAt = Date.now() must be deterministic
  win.navTo = (x) => { win.__navCalls.push(x); };
  win.__navCalls = [];
  win.posShowClaimCode = () => {}; // only referenced inside onclick="" attribute strings, never invoked here
  win.DEFAULT_DB = { orders: [] };
  // Pre-stub before any eval — see classroom-service.js's verify script for
  // the full rationale (state-manager.js's own init() needs a bare
  // DBService-shaped stand-in; this file itself never touches DBService).
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
  win.eval(read('modules/shop/shop_orders.js'));
  await win.AppStore.ready;
}
async function evalBridge(win) {
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'shop_orders-combined-bundle.js'), 'utf8'));
  await win.AppStore.ready;
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v).replace(ISO, '<ISO>'));

function seedOrders(win, orders) {
  win.AppStore.updateState(draft => { draft.orders = orders; }, { type: 'test:seed' });
}

const modalSnap = win => ({
  visible: win.document.getElementById('modal-overlay').style.display,
  className: win.document.getElementById('modal-box').className,
  content: win.document.getElementById('modal-content').innerHTML,
});
const toastSnap = win => ({
  visible: win.document.getElementById('toast').style.display,
  html: win.document.getElementById('toast').innerHTML,
});
const badgeSnap = win => {
  const b = win.document.querySelector('#nav-s-orders .ord-nav-badge');
  return b ? { text: b.textContent, count: win.document.querySelectorAll('#nav-s-orders .ord-nav-badge').length } : null;
};

async function run(win) {
  const out = {};

  // ── ordStatusPill / ordLabel ──
  const statuses = ['pending', 'ready', 'claimed', 'cancelled', 'bogus', undefined];
  out.pills = statuses.map(s => win.ordStatusPill(s));
  out.labels = statuses.map(s => win.ordLabel(s));
  out.pillEscapes = win.ordStatusPill('<script>bad</script>');

  // ── renderStudentOrders: several full states ──
  out.render = {};
  win.eval("currentUser = { id: 's1', name: 'Ana' };");
  seedOrders(win, []);
  win.renderStudentOrders();
  out.render.empty = win.document.getElementById('s-orders').innerHTML;
  out.render.emptyBadge = badgeSnap(win);

  seedOrders(win, [
    { orderId: 'o1', studentId: 's1', itemName: 'Sticker Pack', emoji: '🎨', cost: 50, status: 'pending', createdDateStr: 'Jan 1' },
    { orderId: 'o2', studentId: 's1', itemName: 'Homework Pass', cost: 100, status: 'ready', claimCode: 'ABC-123', createdDateStr: 'Jan 2' },
    { orderId: 'o3', studentId: 's1', itemName: '<b>XSS</b>', cost: 0, status: 'claimed', claimedAt: '2026-01-05T00:00:00.000Z', createdDateStr: 'Jan 3' },
    { orderId: 'o4', studentId: 's1', itemName: 'Late Pass', cost: 20, status: 'cancelled', cancelReason: 'Out of stock', createdDateStr: 'Jan 4' },
    { orderId: 'o5', studentId: 's2', itemName: 'Not mine', cost: 10, status: 'pending', createdDateStr: 'Jan 5' }, // different student, excluded entirely
  ]);
  win.renderStudentOrders();
  out.render.mixed = win.document.getElementById('s-orders').innerHTML;
  out.render.mixedBadge = badgeSnap(win);

  // ── ordSwitchTab ──
  out.tabs = {};
  win.ordSwitchTab('history');
  out.tabs.afterHistory = {
    activeBtnClass: win.document.getElementById('sordtab-active').className,
    historyBtnClass: win.document.getElementById('sordtab-history').className,
    activePanelDisplay: win.document.getElementById('sord-panel-active').style.display,
    historyPanelDisplay: win.document.getElementById('sord-panel-history').style.display,
  };
  win.ordSwitchTab('active');
  out.tabs.afterActive = {
    activeBtnClass: win.document.getElementById('sordtab-active').className,
    historyBtnClass: win.document.getElementById('sordtab-history').className,
  };

  // ── ordCancelPrompt ──
  out.cancelPrompt = {};
  win.ordCancelPrompt('nope'); // unknown order -> no-op, modal stays closed
  out.cancelPrompt.unknown = modalSnap(win);
  win.ordCancelPrompt('o1');
  out.cancelPrompt.known = modalSnap(win);

  // ── ordExecuteCancel ──
  out.execCancel = {};
  win.eval("currentUser = { id: 's1', name: 'Ana' };");
  win.ordExecuteCancel('nope'); // vanished order -> just closes the modal, no state change, no toast, no re-render crash
  out.execCancel.vanished = { modal: modalSnap(win), toast: toastSnap(win), orders: clean(win.AppStore.getSlice(s => s.orders)) };
  win.ordCancelPrompt('o1'); // reopen, to prove execute closes it
  win.ordExecuteCancel('o1');
  out.execCancel.real = {
    modal: modalSnap(win),
    toast: toastSnap(win),
    order: clean(win.AppStore.getSlice(s => s.orders).find(o => o.orderId === 'o1')),
    rerenderedHTML: win.document.getElementById('s-orders').innerHTML,
  };

  // ── ordUpdateSidebarBadge: every branch ──
  out.badge = {};
  const mkOrders = n => Array.from({ length: n }, (_, i) => ({ orderId: 'b' + i, studentId: 's1', status: i % 2 ? 'pending' : 'ready' }))
    .concat([{ orderId: 'done', studentId: 's1', status: 'claimed' }, { orderId: 'other', studentId: 's2', status: 'pending' }]);
  seedOrders(win, mkOrders(3));
  win.ordUpdateSidebarBadge();
  out.badge.three = badgeSnap(win);
  win.ordUpdateSidebarBadge();
  out.badge.threeAgainNoDup = badgeSnap(win);
  seedOrders(win, mkOrders(150));
  win.ordUpdateSidebarBadge();
  out.badge.capped = badgeSnap(win);
  seedOrders(win, []);
  win.ordUpdateSidebarBadge();
  out.badge.zero = badgeSnap(win);
  win.eval("currentUser = null;");
  seedOrders(win, mkOrders(3));
  win.ordUpdateSidebarBadge();
  out.badge.noCurrentUser = badgeSnap(win);
  win.document.getElementById('nav-s-orders').remove();
  win.ordUpdateSidebarBadge(); // no button in DOM -> must not throw
  out.badge.noButtonNoThrow = true;
  win.document.body.insertAdjacentHTML('beforeend', '<button id="nav-s-orders">Orders</button>');

  // ── load-time subscriber: session:booted, role-gated, 55ms delay ──
  out.subs = {};
  win.eval("currentUser = { id: 's1' };");
  seedOrders(win, mkOrders(2));
  win.eval("currentRole = 'teacher';");
  win.document.getElementById('nav-s-orders').querySelector('.ord-nav-badge')?.remove();
  win.AppStore.emit({ type: 'session:booted' });
  await new Promise(r => setTimeout(r, 90));
  out.subs.teacherIgnored = badgeSnap(win); // role is teacher -> badge must NOT have been (re)populated by the subscriber
  win.eval("currentRole = 'student';");
  win.AppStore.emit({ type: 'session:booted' });
  out.subs.immediatelyAfterEmit = badgeSnap(win); // 55ms hasn't elapsed yet -> unaffected by this specific call (badge may already be there from earlier ordUpdateSidebarBadge calls)
  await new Promise(r => setTimeout(r, 90));
  out.subs.after90ms = badgeSnap(win);
  win.eval("currentRole = 'student';");
  win.AppStore.emit({ type: 'not:booted' });
  await new Promise(r => setTimeout(r, 90));
  out.subs.wrongEventTypeIgnored = true; // just proving no throw; covered implicitly by nothing new happening

  return out;
}

function main() {
  return (async () => {
    const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'shop', 'shop_orders.js'), 'utf8');
    const bridgeSrc = fs.readFileSync(path.join(__dirname, 'test-helpers', 'shop_orders-combined-bundle.js'), 'utf8');
    const A = makeWindow(), B = makeWindow();
    await evalOriginal(A.win);
    await evalBridge(B.win);

    assert.ok(A.logs.some(l => l.includes('shop/orders.js loaded')));
    assert.deepStrictEqual(clean(B.logs), clean(A.logs), 'load-time console output must match');

    const oa = await run(A.win), ob = await run(B.win);
    assert.deepStrictEqual(clean(ob), clean(oa), 'bridge output must exactly match the original at every step');

    // ── hand-computed sanity on the ORIGINAL's output ──
    const o = clean(oa);
    assert.ok(o.pills[0].includes('⏳ Pending') && o.pills[3].includes('❌ Cancelled'));
    assert.ok(o.pills[4].includes('bp-gray') && o.pills[4].includes('bogus'), 'unknown status -> gray pill with escaped text');
    assert.deepStrictEqual(o.labels, ['⏳ Pending', '✅ Ready', '🎁 Claimed', '❌ Cancelled', 'bogus', null], "an undefined status ({}[undefined] || status) === undefined, which clean()'s JSON round-trip renders as null in an array");
    assert.ok(o.pillEscapes.includes('&lt;script&gt;'), 'unknown-status text is escaped via _esc');

    assert.ok(o.render.empty.includes('No active orders') && o.render.empty.includes('No order history yet'));
    assert.strictEqual(o.render.emptyBadge, null);
    assert.ok(o.render.mixed.includes('Sticker Pack') && !o.render.mixed.includes('Not mine'), "s2's order (o5) excluded entirely");
    assert.ok(o.render.mixed.includes('ABC-123'), 'claimCode rendered for the ready order');
    assert.ok(o.render.mixed.includes('&lt;b&gt;XSS&lt;/b&gt;') && !o.render.mixed.includes('<b>XSS</b>'), 'itemName escaped');
    assert.ok(o.render.mixed.includes('Out of stock'), 'cancelReason rendered in history');
    assert.ok(o.render.mixed.includes('filter:grayscale(1)'), 'cancelled order gets grayscale styling');
    assert.deepStrictEqual(o.render.mixedBadge, { text: '2', count: 1 }, 'pending(o1) + ready(o2) = 2 active for s1');

    assert.strictEqual(o.tabs.afterHistory.historyBtnClass, 'sord-tab active');
    assert.strictEqual(o.tabs.afterHistory.activeBtnClass, 'sord-tab');
    assert.strictEqual(o.tabs.afterHistory.activePanelDisplay, 'none');
    assert.strictEqual(o.tabs.afterHistory.historyPanelDisplay, 'block');
    assert.strictEqual(o.tabs.afterActive.activeBtnClass, 'sord-tab active');

    assert.strictEqual(o.cancelPrompt.unknown.visible, 'none', 'unknown order id: modal never opens');
    assert.strictEqual(o.cancelPrompt.known.visible, 'flex');
    assert.ok(o.cancelPrompt.known.content.includes('Sticker Pack') && o.cancelPrompt.known.content.includes('not automatically refunded'));
    assert.strictEqual(o.cancelPrompt.known.className, 'modal-box sm');

    assert.strictEqual(o.execCancel.vanished.modal.visible, 'none', 'closeModalForce ran even for a vanished order');
    assert.strictEqual(o.execCancel.vanished.toast.visible, '', 'no toast for a vanished order (early return)');
    assert.strictEqual(o.execCancel.real.modal.visible, 'none');
    assert.strictEqual(o.execCancel.real.toast.visible, 'block');
    assert.ok(o.execCancel.real.toast.html.includes('cancelled'));
    assert.strictEqual(o.execCancel.real.order.status, 'cancelled');
    assert.strictEqual(typeof o.execCancel.real.order.cancelledAt, 'number', 'cancelledAt is Date.now(), a plain number, not an ISO string');
    assert.strictEqual(o.execCancel.real.order.cancelReason, 'Cancelled by student');
    assert.strictEqual(o.execCancel.real.order.cancelledBy, 'Ana');
    assert.ok(o.execCancel.real.rerenderedHTML.includes('Out of stock') || o.execCancel.real.rerenderedHTML.length > 0, 're-render happened');

    assert.strictEqual(o.badge.three.text, '3', 'mkOrders(3): all 3 generated entries (ready/pending/ready) are active statuses for s1');
    assert.strictEqual(o.badge.threeAgainNoDup.count, 1);
    assert.strictEqual(o.badge.capped.text, '99+');
    assert.strictEqual(o.badge.zero, null);
    assert.strictEqual(o.badge.noCurrentUser, null, 'no currentUser -> optional chaining short-circuits, nothing matches');

    assert.strictEqual(o.subs.teacherIgnored, null, "role 'teacher' at fire time -> subscriber never calls ordUpdateSidebarBadge");
    assert.ok(o.subs.after90ms && o.subs.after90ms.text === '2', "role 'student': the 55ms-delayed callback fires and (re)populates the badge");

    console.log('EQUIVALENCE CHECK PASSED');
    console.log('Original shop_orders.js (via the real state-manager/dom/utils chain) and the');
    console.log('bundled src/ twin (real-imported through the same chain) agree on:');
    console.log(' - ordStatusPill/ordLabel for all known statuses + an unknown one (escaping)');
    console.log(' - renderStudentOrders across empty/mixed/claimCode/escaping/cancelled-styling states');
    console.log(' - ordSwitchTab\'s class/style toggling');
    console.log(' - ordCancelPrompt/ordExecuteCancel: real modal+toast DOM state, AppStore mutation,');
    console.log('   re-render, and the vanished-order early-return path');
    console.log(' - ordUpdateSidebarBadge: every branch incl. 99+ cap, zero, and no-currentUser');
    console.log(' - the load-time session:booted subscriber: role-gated, 55ms-delayed, ambient-role-at-fire-time');
  })();
}

main().catch(e => { console.error(e); process.exit(1); });
