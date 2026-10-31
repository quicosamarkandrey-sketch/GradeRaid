// src/modules/shop/shop_store.js — real-ESM twin of
// ../../../modules/shop/shop_store.js.
// Phase 7 (Stream D), file 22/30. Original stays untouched.
//
// All 17 top-level declared symbols exported, matching declaresCount 17 (dist/dependency-map.json):
// 12 `window.X = [async] function` (getItemRarity, renderStudentStore, cartAdd, cartRemove, cartSetQty,
// cartClear, cartOpenModal, cartCheckout, posGenCode, posShowClaimCode, buyItem, confirmBuy) -> `export const`,
// the module-level `const _CART` (the in-memory cart object; exported as the SAME object, never reassigned) and
// the 4 plain top-level `function _cartTotal/_cartCount/_cartRenderFab/_cartRenderModal` (real globals in the
// classic script, never window-assigned and never referenced by any OTHER file — repo-wide grep) -> `export`.
// Every other line is byte-identical to the original, incl. the trailing console.log.
//
// REAL IMPORTS: AppStore (../core/state-manager.js), DBService (../../db-service.js), toast/showModal/
// closeModalForce (../../dom.js), _esc/todayStr/nowStr (../../utils.js).
// BARE (global fallback — behavior, kept verbatim): currentUser (read ~20x AND reassigned in cartCheckout
// after the purchase: `currentUser = ...find(...)`; it is a classic-script global lexical binding, which a module
// may assign — same pattern as file 17), updateTopbar (topbar.js) and syncStudentStatsToServer (student-stats.js),
// both not in this stream; and the CLUSTER/CYCLE fallbacks, all behind `typeof` guards in the source:
// promoRenderCarousel / promoRecordPurchase (shop_promotions.js) and invUpdateSidebarBadge (shop_inventory.js),
// per the guide's rule not to import through the shop_store <-> shop_inventory <-> shop_promotions cluster.
// achCheckAndAward stays BARE on purpose: ach_engine.js's export is wrapped elsewhere (tools/audit-patched-exports.js),
// and a real import would bypass that wrapper; the `typeof` guard is kept verbatim.
//
// BINDING NOTE: internal bare calls to this file's own exports (getItemRarity, renderStudentStore, cartAdd,
// cartOpenModal, posGenCode, _cart* helpers, _CART) now resolve lexically instead of through window. WRAPPER AUDIT
// (tools/audit-patched-exports.js + repo-wide grep): see HANDOFF #19 — no other file assigns or wraps them.

// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/shop/store.js
//  Student-facing Armory (store) page + in-memory cart engine.
//
//  Exports: getItemRarity, renderStudentStore,
//           cartAdd, cartRemove, cartSetQty, cartClear, cartOpenModal,
//           posGenCode, posShowClaimCode,
//           buyItem, confirmBuy (compatibility stubs)
// ═══════════════════════════════════════════════════════════════════════════════

import { AppStore } from '../core/state-manager.js';
import { DBService } from '../../db-service.js';
import { uiIcon, toast, showModal, closeModalForce } from '../../dom.js';
import { _esc, todayStr, nowStr } from '../../utils.js';

// ── Item rarity helper ────────────────────────────────────────────────────────

/**
 * getItemRarity(item) → { label, cls, glow }  [window.getItemRarity]
 * Determines display rarity tier from item.cat and item.cost.
 * Used by store cards and inventory cards.
 */
export const getItemRarity = function (item) {
  if (item.cat === 'mystery')   return { label: 'LEGENDARY', cls: 'rarity-legendary', glow: 'rgba(202,202,194,0.3)' };
  if (item.cat === 'privilege') return { label: 'EPIC',      cls: 'rarity-epic',      glow: 'rgba(202,202,194,0.3)' };
  if (item.cost >= 200)         return { label: 'RARE',      cls: 'rarity-rare',      glow: 'rgba(144,180,255,0.25)' };
  return                               { label: 'COMMON',    cls: 'rarity-common',    glow: 'rgba(203,195,215,0.1)' };
};

// ── Student store renderer ────────────────────────────────────────────────────

/**
 * renderStudentStore(cat) → void  [window.renderStudentStore]
 *
 * Renders the Armory page into #s-store.
 * cat: 'all' | 'food' | 'supplies' | 'privilege' | 'mystery'  (default 'all')
 *
 * Sections: promo carousel banner | header + balance chip | category tabs | item grid.
 * After HTML set: calls _cartRenderFab() and promoRenderCarousel() (typeof guards).
 */
export const renderStudentStore = function (cat = 'all') {
  const st    = currentUser;
  const allStore = AppStore.getSlice(s => s.store) || [];
  const items = cat === 'all' ? allStore : allStore.filter(i => i.cat === cat);
  const cats  = ['all', 'food', 'supplies', 'privilege', 'mystery'];
  const catLabel = { all: 'All Items', food: 'Food & Snacks', supplies: 'Supplies', privilege: 'Privileges', mystery: 'Mystery' };

  document.getElementById('s-store').innerHTML = `
  <!-- PROMO CAROUSEL (populated by promotions.js) -->
  <div id="promo-carousel-wrap" class="store-banner">
    <div class="student-catalog-intro">
      <span class="store-banner-tag">Reward catalog</span>
      <div class="store-banner-title">Choose your next reward</div>
      <div class="store-banner-sub">Use the coins you earn from learning to choose your adviser’s available items and privileges.</div>
    </div>
  </div>

  <!-- HEADER -->
  <div class="student-store-heading" style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
    <div>
      <div style="font-family:var(--fm);font-size:10px;color:var(--text-muted);letter-spacing:.12em;margin-bottom:6px">THE ARMORY // REWARD_EXCHANGE</div>
      <div style="font-family:var(--fh);font-size:28px;font-weight:900;letter-spacing:-.5px;color:var(--on-surface)">The Armory</div>
      <div style="font-size:13px;color:var(--text-muted);margin-top:4px">Spend your learning coins on available items and privileges.</div><button class="learning-reward-guide-link" onclick="LearningRewards.openGuide()">How to earn coins</button>
    </div>
    <div style="display:flex;align-items:center;gap:10px;background:rgba(42,40,54,0.9);border:1px solid rgba(202,202,194,0.25);padding:14px 20px;border-radius:16px;box-shadow:0 0 20px rgba(202,202,194,0.12)">
      <span class="material-symbols-outlined" style="color:var(--tertiary);font-size:28px;font-variation-settings:'FILL' 1">monetization_on</span>
      <div>
        <div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase">Balance</div>
        <div style="font-family:var(--fh);font-size:24px;font-weight:900;color:var(--tertiary);line-height:1" class="float" data-learning-coins>${st.coins.toLocaleString()}</div>
      </div>
    </div>
  </div>

  <!-- CATEGORY TABS -->
  <div class="cat-tabs">
    ${cats.map(c => `<button class="cat-tab ${c === cat ? 'active' : ''}" onclick="renderStudentStore('${c}');showPage('s-store')">${catLabel[c]}</button>`).join('')}
  </div>

  <!-- ITEMS GRID -->
  ${items.length ? `
  <div class="store-grid">
    ${items.map(item => {
      const r = getItemRarity(item);
      const canAfford = st.coins >= item.cost;
      const out = item.stock === 0;
      const stockColor = item.stock === 0 ? '#d99b98' : item.stock <= 3 ? '#cbc7be' : 'rgba(255,255,255,0.35)';
      const stockLabel = item.stock === 0 ? 'Out of stock' : item.stock <= 3 ? `Only ${item.stock} left` : `${item.stock} in stock`;
      return `<div class="store-card cat-${item.cat} ${out ? 'out-of-stock' : ''}" id="store-item-${item.id}" style="${!canAfford && !out ? 'opacity:.65' : ''}">
        ${out ? `<div style="position:absolute;top:12px;right:12px;z-index:2"><span class="badge-pill bp-red" style="font-size:9px;letter-spacing:.04em">OUT OF STOCK</span></div>` : ''}
        <div class="store-emoji" style="filter:${out ? 'grayscale(1)' : ''}">${uiIcon(item.cat)}</div>
        <div class="store-rarity"><span class="rarity-pill ${r.cls}">${r.label}</span></div>
        <div class="store-name">${_esc(item.name)}</div>
        <div class="store-desc">${_esc(item.desc)}</div>
        <div style="font-size:10px;font-weight:700;color:${stockColor};margin-bottom:10px;letter-spacing:.04em">${stockLabel}</div>
        <div class="store-footer">
          <div class="store-price">
            <span class="material-symbols-outlined" style="font-variation-settings:'FILL' 1">monetization_on</span>${item.cost}
          </div>
          <button class="store-redeem-btn" ${out || !canAfford ? 'disabled' : ''} style="${out ? 'opacity:.5;cursor:not-allowed' : canAfford ? '' : 'opacity:.5;cursor:not-allowed'}" onclick="event.stopPropagation();${out || !canAfford ? '' : `cartAdd('${item.id}')`}">${out ? 'Unavailable' : canAfford ? 'Add to cart' : "Can't Afford"}</button>
        </div>
      </div>`;
    }).join('')}
  </div>` : `<div class="student-empty-state" style="text-align:center;padding:80px;color:var(--text-muted);font-size:13px">No items in this category.</div>`}`;

  _cartRenderFab();
  // Promotions carousel — typeof guard (promotions.js loads after store.js)
  if (typeof promoRenderCarousel === 'function') promoRenderCarousel();
};

// ── Cart engine ───────────────────────────────────────────────────────────────
// Session-only (in memory). Keys = item id, value = { item, qty }
export const _CART = {};
let _learningCartBusy=false;

export const cartAdd = function (id) {
  const item = (AppStore.getSlice(s => s.store) || []).find(i => i.id === id);
  if (!item) return;
  if (item.stock === 0) { toast('❌ Out of stock!', '#d99b98'); return; }
  const cartQty = _CART[id] ? _CART[id].qty : 0;
  if (cartQty >= item.stock) { toast(`❌ Only ${item.stock} in stock!`, '#d99b98'); return; }
  if (!_CART[id]) _CART[id] = { item, qty: 0 };
  _CART[id].qty++;
  _CART[id].item = item;
  toast(`Added ${uiIcon(item.cat)} ${_esc(item.name)} added to cart!`, '#96968e');
  _cartRenderFab();
};

export const cartRemove = function (id) {
  if (!_CART[id]) return;
  _CART[id].qty--;
  if (_CART[id].qty <= 0) delete _CART[id];
  _cartRenderFab();
  _cartRenderModal();
};

export const cartSetQty = function (id, qty) {
  const item = (AppStore.getSlice(s => s.store) || []).find(i => i.id === id);
  if (!item) return;
  const n = parseInt(qty);
  if (isNaN(n) || n <= 0) { delete _CART[id]; _cartRenderFab(); _cartRenderModal(); return; }
  const capped = Math.min(n, item.stock);
  if (!_CART[id]) _CART[id] = { item, qty: 0 };
  _CART[id].qty   = capped;
  _CART[id].item  = item;
  if (capped !== n) toast(`⚠️ Qty capped at ${capped} (max stock)`, '#cbc7be');
  _cartRenderFab();
  _cartRenderModal();
};

export const cartClear = function () { for (const k in _CART) delete _CART[k]; _cartRenderFab(); };

export function _cartTotal()  { return Object.values(_CART).reduce((s, e) => s + e.item.cost * e.qty, 0); }
export function _cartCount()  { return Object.values(_CART).reduce((s, e) => s + e.qty, 0); }

export function _cartRenderFab() {
  const old = document.getElementById('cart-fab');
  if (old) old.remove();
  const page = document.getElementById('s-store');
  if (!page || !page.classList.contains('active')) return;
  const count = _cartCount();
  if (count === 0) return;
  const fab = document.createElement('button');
  fab.id        = 'cart-fab';
  fab.className = 'cart-fab';
  fab.innerHTML = `Cart <span class="cart-count">${count}</span> &nbsp;·&nbsp; ${_cartTotal().toLocaleString()}`;
  fab.onclick   = cartOpenModal;
  document.body.appendChild(fab);
}

export const cartOpenModal = function () {
  const allStore = AppStore.getSlice(s => s.store) || [];
  for (const id in _CART) {
    const item = allStore.find(i => i.id === id);
    if (!item || item.stock === 0) { delete _CART[id]; continue; }
    _CART[id].item = item;
    if (_CART[id].qty > item.stock) _CART[id].qty = item.stock;
  }
  _cartRenderModal();
};

export function _cartRenderModal() {
  const entries  = Object.values(_CART);
  if (!entries.length) { closeModalForce(); return; }
  const total    = _cartTotal();
  const canAfford = currentUser.coins >= total;
  const rows = entries.map(e => `
    <div class="cart-item-row">
      <div style="font-size:28px;width:36px;text-align:center;flex-shrink:0">${uiIcon(e.item.cat)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:13px;color:var(--on-surface)">${_esc(e.item.name)}</div>
        <div style="font-size:11px;color:var(--text-muted)">Coins ${e.item.cost.toLocaleString()} each · ${e.item.stock} in stock</div>
      </div>
      <div class="cart-qty-ctrl">
        <button class="cart-qty-btn" onclick="cartSetQty('${e.item.id}',${e.qty - 1})">−</button>
        <input class="cart-qty-num" type="number" min="1" max="${e.item.stock}" value="${e.qty}"
          style="width:38px;background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:6px;color:var(--on-surface);text-align:center;padding:2px 0;font-family:var(--fh);font-weight:800;font-size:14px"
          oninput="cartSetQty('${e.item.id}',this.value)">
        <button class="cart-qty-btn" onclick="cartSetQty('${e.item.id}',${e.qty + 1})">+</button>
      </div>
      <div style="min-width:64px;text-align:right;font-family:var(--fh);font-weight:800;font-size:13px;color:var(--tertiary)">Coins ${(e.item.cost * e.qty).toLocaleString()}</div>
      <button onclick="cartSetQty('${e.item.id}',0)" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;padding:0 0 0 8px;line-height:1">✕</button>
    </div>`).join('');

  showModal(`
  <div class="student-shop-dialog" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
    <div style="font-family:var(--fh);font-size:18px;font-weight:900">🛒 Your Cart</div>
    <button onclick="cartClear();closeModalForce()" style="background:none;border:none;color:var(--text-muted);font-size:12px;cursor:pointer;font-weight:700">Clear all</button>
  </div>
  <div style="max-height:340px;overflow-y:auto;padding-right:4px">${rows}</div>
  <div style="background:#202123;border-radius:12px;padding:14px;margin:14px 0">
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
      <span style="color:var(--text-muted)">Your balance</span>
      <span class="coin-tag">Coins ${currentUser.coins.toLocaleString()}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
      <span style="color:var(--text-muted)">Total (${_cartCount()} item${_cartCount() !== 1 ? 's' : ''})</span>
      <span style="color:#cbc7be;font-weight:700">−${total.toLocaleString()}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:14px;border-top:1px solid var(--border);padding-top:10px;font-weight:800">
      <span>After purchase</span>
      <span class="coin-tag" style="${canAfford ? '' : 'color:#d99b98;border-color:rgba(255,180,171,0.3)'}">Coins ${(currentUser.coins - total).toLocaleString()}</span>
    </div>
    ${!canAfford ? `<div style="color:#d99b98;font-size:11px;font-weight:700;margin-top:8px;text-align:center">⚠️ Not enough coins — remove some items</div>` : ''}
  </div>
  <div style="display:flex;gap:10px">
    <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Keep Shopping</button>
    <button id="cart-checkout-btn" class="btn btn-primary" style="flex:1;background:linear-gradient(135deg,#96968e,#EC4899)" ${canAfford ? '' : 'disabled'} onclick="cartCheckout()">Checkout</button>
  </div>
  `, 'md');
}

// ── Checkout ──────────────────────────────────────────────────────────────────

/**
 * cartCheckout() → Promise<void>  [window.cartCheckout]
 *
 * Phase 14: stock for each cart item is reserved atomically server-side via
 * purchase_shop_product(product_id, student_id, quantity) BEFORE anything
 * else is written — this is what stops two students racing for the last
 * unit. Items that lose that race are reported via toast and left in the
 * cart; only items that actually reserved stock go on to:
 *   Creates orders-slice entries (one per unit): { orderId, claimCode, studentId, studentName,
 *     studentInit, studentColor, itemId, itemName, emoji, cost, category,
 *     status:'pending', createdAt, createdDateStr, claimedAt:null, ... }
 *   Creates redemptions-slice entries (one per unit): { studentId, itemId, itemName, emoji,
 *     item:'emoji name', pts:cost, date, time, orderId, claimCode }
 *   Updates the inventory slice for sid: upserts { itemId, itemName, emoji, category, quantity, datePurchased, source, status }
 * Deducts coins for successfully-reserved items only, persists via
 * AppStore.updateState(), shows the
 * consolidated claim-codes modal for those items.
 * Calls promoRecordPurchase(itemId) per item (typeof guard).
 * Calls achCheckAndAward(currentUser.id) after 400ms (typeof guard).
 * Calls renderStudentStore(), updateTopbar(), invUpdateSidebarBadge().
 */
export const cartCheckout = async function () {
  const entries = Object.values(_CART);
  if (!entries.length) return;
  const rewardMode=window.LearningRewards?await LearningRewards.ready():'legacy';
  if(rewardMode==='balanced'){
    if(_learningCartBusy)return;
    _learningCartBusy=true;
    const checkoutButton=document.getElementById('cart-checkout-btn');
    if(checkoutButton&&typeof eqButtonLoading==='function')eqButtonLoading(checkoutButton,true,{label:'Confirming purchase…'});
    try {
      const purchase=await LearningRewards.checkout(entries);
      if(!purchase.ok){toast(_esc(purchase.error),'var(--error)');return;}
      if(!purchase.recovered)purchase.items.forEach(item=>{if(_CART[item.id]?.qty===item.qty)delete _CART[item.id];});
      renderStudentStore();updateTopbar();if(typeof invUpdateSidebarBadge==='function')invUpdateSidebarBadge();
      const codes=(purchase.data.orders||[]).map(o=>`<div class="learning-claim-code"><strong>${_esc(o.item_name)}</strong><code>${_esc(o.claim_code)}</code></div>`).join('');
      showModal(`<h2>${purchase.recovered?'Previous checkout confirmed':'Your rewards are reserved'}</h2><p>Show these claim codes to your teacher to collect your rewards.</p>${codes}<p class="form-help">${purchase.data.total} coins spent. ${currentUser.coins} coins remaining.</p><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModalForce()">Close</button><button class="btn btn-primary" onclick="closeModalForce();navTo('s-orders')">View My Orders</button></div>`,'md');
      if(typeof achCheckAndAward==='function')achCheckAndAward(currentUser.id);
    } finally { _learningCartBusy=false;if(checkoutButton&&typeof eqButtonLoading==='function')eqButtonLoading(checkoutButton,false); }
    return;
  }
  if(rewardMode!=='legacy'){toast('Please reconnect so your coin balance can be confirmed.');return;}

  const student = (AppStore.getSlice(s => s.students) || []).find(s => s.id === currentUser.id);
  if (!student) return;

  // Check affordability against current cart contents BEFORE reserving any
  // stock — simpler and safer than trying to "refund" a stock reservation
  // afterward (an undo path has its own edge cases — e.g. a student session
  // isn't authorized to call the owner-gated restock RPC). The Checkout
  // button is already disabled client-side when unaffordable; this is the
  // authoritative re-check right before writing anything.
  const estimatedTotal = entries.reduce((s, e) => s + e.item.cost * e.qty, 0);
  if (student.coins < estimatedTotal) { toast('❌ Not enough coins!', '#d99b98'); return; }

  // Phase 14: reserve stock atomically per item BEFORE creating any
  // order/redemption/inventory record. The old code did `item.stock -= qty`
  // directly on the in-memory array and relied on the next bulk saveDB() to
  // persist it — two students checking out at once could both read the
  // last unit as available and both "win" it. purchase_shop_product() does
  // the check-and-decrement as one atomic statement server-side, so this
  // can't happen anymore; a request that loses the race gets told the real
  // remaining stock instead of silently succeeding.
  const succeeded = [];
  const failed    = [];
  for (const e of entries) {
    const item = (AppStore.getSlice(s => s.store) || []).find(i => i.id === e.item.id);
    if (!item) { failed.push({ e, reason: 'no longer available' }); continue; }
    const { data, error } = await DBService.rpc('purchase_shop_product', {
      p_product_id: item.id, p_student_id: currentUser.id, p_quantity: e.qty,
    });
    const result = Array.isArray(data) ? data[0] : data;
    if (error || !result || !result.ok) {
      const remaining = result ? result.remaining_stock : item.stock;
      item.stock = remaining ?? item.stock;
      failed.push({ e, reason: `only ${remaining ?? 0} left` });
      continue;
    }
    item.stock = result.remaining_stock;
    succeeded.push({ e, item });
  }

  if (!succeeded.length) {
    failed.forEach(f => toast(`❌ ${_esc(f.e.item.name)}: ${f.reason}`, '#d99b98'));
    _cartRenderModal(); // refreshes stock numbers shown in the still-open cart
    return;
  }

  const total = succeeded.reduce((s, { e }) => s + e.item.cost * e.qty, 0);
  const orderIds = [];

  // Coin deduction, order/redemption creation, and inventory upsert for
  // every purchased unit all commit as one atomic AppStore.updateState()
  // call — previously a sequence of direct DB.* mutations followed by one
  // saveDB(). promoRecordPurchase() is passed this same draft (see its
  // updated signature in shop_promotions.js) so its own analytics write
  // lands in this same atomic commit too, preserving that function's
  // original "one atomic flush covers this too" design intent.
  AppStore.updateState(draft => {
    const s = (draft.students || []).find(x => x.id === currentUser.id);
    if (s) s.coins = (s.coins || 0) - total;

    if (!Array.isArray(draft.orders))      draft.orders = [];
    if (!Array.isArray(draft.redemptions)) draft.redemptions = [];
    if (!draft.inventory)                  draft.inventory = {};
    if (!draft.inventory[currentUser.id])  draft.inventory[currentUser.id] = [];

    succeeded.forEach(({ e, item }) => {
      for (let q = 0; q < e.qty; q++) {
        const claimCode = posGenCode(draft.orders);
        const orderId   = 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + q;
        orderIds.push({ orderId, claimCode, item, qty: e.qty });
        draft.orders.unshift({
          orderId, claimCode,
          studentId: currentUser.id, studentName: currentUser.name,
          studentInit: currentUser.init, studentColor: currentUser.color,
          itemId: item.id, itemName: item.name, emoji: item.emoji,
          cost: item.cost, category: item.cat,
          status: 'pending',
          createdAt: new Date().toISOString(),
          createdDateStr: todayStr() + ' at ' + nowStr(),
          claimedAt: null, claimedBy: null, cancelledAt: null, cancelReason: null
        });
        draft.redemptions.unshift({
          studentId: currentUser.id, itemId: item.id, itemName: item.name,
          emoji: item.emoji, item: `${item.emoji} ${item.name}`,
          pts: item.cost, date: todayStr(), time: nowStr(), orderId, claimCode
        });
      }
      // Upsert inventory
      const inv      = draft.inventory[currentUser.id];
      const existing = inv.find(i => i.itemId === item.id);
      if (existing) {
        existing.quantity      = (existing.quantity || 1) + e.qty;
        existing.lastPurchased = todayStr() + ' ' + nowStr();
      } else {
        inv.unshift({
          itemId: item.id, itemName: item.name, emoji: item.emoji,
          category: item.cat, quantity: e.qty,
          datePurchased: todayStr() + ' at ' + nowStr(), source: 'Store', status: 'active'
        });
      }

      // Promo analytics — typeof guard (promotions.js)
      if (typeof promoRecordPurchase === 'function') promoRecordPurchase(item.id, draft);
    });
  }, { type: 'shop:checkout', payload: { studentId: currentUser.id, total, itemCount: succeeded.length } });

  // Phase 14: this local mutation alone is not enough to persist — Phase 9
  // deliberately removed coins from the bulk profiles upsert (see
  // db-service.js / phase9_student_stat_rpc.sql), specifically so it could
  // never be clobbered by a stale tab's snapshot. Every other spend/reward
  // site in this app (mail, campaign, recitation, achievements, world boss)
  // already calls this same helper right after its own local mutation; this
  // call site just hadn't been migrated yet. Without it, a purchase's coin
  // deduction was local-cache-only and would never actually reach the
  // server, let alone atomically — the next pull from any device (including
  // this one, after a refresh) would show the student's PRE-purchase coin
  // balance, effectively refunding them for free.
  syncStudentStatsToServer(currentUser.id, 0, -total);

  currentUser = (AppStore.getSlice(s => s.students) || []).find(x => x.id === currentUser.id);
  closeModalForce();

  // Only clear cart entries that actually succeeded — a failed item (lost
  // the stock race) stays in the cart so the student can see it and adjust
  // quantity/remove it themselves, instead of it silently vanishing.
  succeeded.forEach(({ e }) => delete _CART[e.item.id]);
  failed.forEach(f => toast(`❌ ${_esc(f.e.item.name)}: ${f.reason}`, '#d99b98'));

  // Consolidated claim codes modal
  const codesHtml = [...new Map(orderIds.map(o => [o.item.id, o])).values()].map(o => `
    <div style="background:#202123;border-radius:10px;padding:10px 14px;margin-bottom:8px;display:flex;align-items:center;gap:12px">
      <span style="font-size:24px">${uiIcon(o.item.cat)}</span>
      <div style="flex:1">
        <div style="font-weight:700;font-size:13px">${_esc(o.item.name)} ×${o.qty}</div>
        <div style="font-family:var(--fm);font-size:18px;font-weight:900;color:#deded7;letter-spacing:.12em;margin-top:2px">${o.claimCode}</div>
      </div>
    </div>`).join('');

  showModal(`
  <div class="student-shop-dialog" style="text-align:center;margin-bottom:16px">
    <div style="font-size:52px;margin-bottom:8px">🎉</div>
    <div style="font-family:var(--fm);font-size:10px;color:var(--secondary);letter-spacing:.14em;margin-bottom:4px;text-transform:uppercase">Order Confirmed</div>
    <div style="font-family:var(--fh);font-size:18px;font-weight:900;margin-bottom:4px">Show codes to your teacher</div>
    <div style="font-size:12px;color:var(--text-muted)">One code per item — present to claim each reward</div>
  </div>
  <div style="max-height:300px;overflow-y:auto">${codesHtml}</div>
  <button class="btn btn-primary btn-block" style="margin-top:14px" onclick="closeModalForce()">Got it</button>
  `, 'sm');

  renderStudentStore();
  updateTopbar();
  if (typeof invUpdateSidebarBadge === 'function') invUpdateSidebarBadge();
  if (typeof achCheckAndAward === 'function') setTimeout(() => achCheckAndAward(currentUser.id), 400);
};

// ── Claim code generator ──────────────────────────────────────────────────────

/**
 * posGenCode(existingOrders) → string  [window.posGenCode]
 * Format: XXX-NNN-XXX (alpha no I/O, digit, alpha). Retries up to 100× for uniqueness.
 * existingOrders (optional): a pre-fetched orders array to check uniqueness
 * against — passed by cartCheckout() so uniqueness is checked against the
 * in-progress draft.orders (which keeps growing as more codes are
 * generated in the same checkout), not a stale pre-transaction snapshot.
 * Falls back to a fresh AppStore.getSlice() read when omitted, so the
 * existing 0-arg call site in shop_pos_terminal.js is unaffected.
 */
export const posGenCode = function (existingOrders) {
  const orders = existingOrders || AppStore.getSlice(s => s.orders) || [];
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const rA = () => alpha[Math.floor(Math.random() * alpha.length)];
  const rN = () => Math.floor(Math.random() * 10);
  let code, tries = 0;
  do {
    code = `${rA()}${rA()}${rA()}-${rN()}${rN()}${rN()}-${rA()}${rA()}${rA()}`;
    tries++;
  } while (tries < 100 && orders.some(o => o.claimCode === code && o.status === 'pending'));
  return code;
};

/**
 * posShowClaimCode(code, item, orderId) → void  [window.posShowClaimCode]
 * Shows a 'sm' modal displaying the claim code for a single order.
 * item: { emoji, name }
 */
export const posShowClaimCode = function (code, item, orderId) {
  showModal(`
  <div class="student-shop-dialog" style="text-align:center">
    <div style="font-size:52px;margin-bottom:8px">${uiIcon(item.cat)}</div>
    <div style="font-family:var(--fm);font-size:10px;color:var(--secondary);letter-spacing:.14em;margin-bottom:6px;text-transform:uppercase">ORDER CONFIRMED</div>
    <div style="font-family:var(--fh);font-size:20px;font-weight:900;color:var(--on-surface);margin-bottom:4px">${_esc(item.name)}</div>
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:24px">Show this code to your teacher to claim your reward</div>
    <div style="background:rgba(202,202,194,0.07);border:2px solid rgba(202,202,194,0.3);border-radius:16px;padding:24px;margin-bottom:20px">
      <div style="font-family:var(--fm);font-size:9px;color:var(--text-muted);letter-spacing:.16em;text-transform:uppercase;margin-bottom:10px">YOUR CLAIM CODE</div>
      <div id="pos-claim-display" style="font-family:var(--fm);font-size:32px;font-weight:900;color:var(--secondary);letter-spacing:.18em;text-shadow:0 0 20px rgba(202,202,194,0.4)">${_esc(code)}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:8px">Order: <span style="color:var(--primary)">${_esc(orderId)}</span></div>
    </div>
    <div style="background:rgba(202,202,194,0.07);border:1px solid rgba(202,202,194,0.2);border-radius:10px;padding:10px 14px;margin-bottom:20px;font-size:12px;color:var(--tertiary);display:flex;align-items:center;gap:8px">
      <span class="material-symbols-outlined" style="font-size:16px">info</span>
      <span>Screenshot or memorize this code. Find it anytime in <b>My Inventory</b>.</span>
    </div>
    <button class="btn btn-primary btn-block" onclick="closeModalForce()">Got it! ✓</button>
  </div>`, 'sm');
};

// ── Compatibility stubs ───────────────────────────────────────────────────────
export const buyItem    = function (id) { cartAdd(id); };
export const confirmBuy = function (id) { /* replaced by cartCheckout */ };

console.log('[EduQuest] shop/store.js loaded — renderStudentStore, cart engine, posGenCode, posShowClaimCode registered.');
