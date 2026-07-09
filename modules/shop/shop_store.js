// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/shop/store.js
//  Student-facing Armory (store) page + in-memory cart engine.
//
//  Exports: getItemRarity, renderStudentStore,
//           cartAdd, cartRemove, cartSetQty, cartClear, cartOpenModal,
//           posGenCode, posShowClaimCode,
//           buyItem, confirmBuy (compatibility stubs)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Item rarity helper ────────────────────────────────────────────────────────

/**
 * getItemRarity(item) → { label, cls, glow }  [window.getItemRarity]
 * Determines display rarity tier from item.cat and item.cost.
 * Used by store cards and inventory cards.
 */
window.getItemRarity = function (item) {
  if (item.cat === 'mystery')   return { label: 'LEGENDARY', cls: 'rarity-legendary', glow: 'rgba(255,185,95,0.3)' };
  if (item.cat === 'privilege') return { label: 'EPIC',      cls: 'rarity-epic',      glow: 'rgba(208,188,255,0.3)' };
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
window.renderStudentStore = function (cat = 'all') {
  DB = loadDB();
  const st    = currentUser;
  const items = cat === 'all' ? DB.store : DB.store.filter(i => i.cat === cat);
  const cats  = ['all', 'food', 'supplies', 'privilege', 'mystery'];
  const catLabel = { all: 'All Items', food: 'Food & Snacks', supplies: 'Supplies', privilege: 'Privileges', mystery: 'Mystery' };

  document.getElementById('s-store').innerHTML = `
  <!-- PROMO CAROUSEL (populated by promotions.js) -->
  <div id="promo-carousel-wrap" class="store-banner">
    <div style="width:100%;height:100%;background:linear-gradient(135deg,rgba(26,20,56,0.98),rgba(139,92,246,0.15));display:flex;align-items:center;padding:0 32px">
      <div class="store-banner-inner">
        <span class="store-banner-tag">🔥 Limited Offer</span>
        <div class="store-banner-title">Mystic Knowledge Potion</div>
        <div class="store-banner-sub">Instant +500 XP boost and a permanent +2 multiplier for your next Quest. Only this week!</div>
        <div class="store-banner-cta">
          <div class="store-banner-price"><span class="material-symbols-outlined" style="font-size:16px;font-variation-settings:'FILL' 1">monetization_on</span>750</div>
          <button class="store-banner-btn">Claim Special</button>
        </div>
      </div>
      <div style="font-size:96px;margin-left:auto;padding-right:32px;display:none;filter:drop-shadow(0 0 32px rgba(255,185,95,0.4))">🧪</div>
    </div>
  </div>

  <!-- HEADER -->
  <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
    <div>
      <div style="font-family:var(--fm);font-size:10px;color:var(--text-muted);letter-spacing:.12em;margin-bottom:6px">THE ARMORY // REWARD_EXCHANGE</div>
      <div style="font-family:var(--fh);font-size:28px;font-weight:900;letter-spacing:-.5px;color:var(--on-surface)">The Armory</div>
      <div style="font-size:13px;color:var(--text-muted);margin-top:4px">Exchange your coins for legendary rewards</div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;background:rgba(42,40,54,0.9);border:1px solid rgba(255,185,95,0.25);padding:14px 20px;border-radius:16px;box-shadow:0 0 20px rgba(255,185,95,0.12)">
      <span class="material-symbols-outlined" style="color:var(--tertiary);font-size:28px;font-variation-settings:'FILL' 1">monetization_on</span>
      <div>
        <div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase">Balance</div>
        <div style="font-family:var(--fh);font-size:24px;font-weight:900;color:var(--tertiary);line-height:1" class="float">${st.coins.toLocaleString()}</div>
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
      const stockColor = item.stock === 0 ? '#ffb4ab' : item.stock <= 3 ? '#ffb95f' : 'rgba(255,255,255,0.35)';
      const stockLabel = item.stock === 0 ? 'Out of stock' : item.stock <= 3 ? `Only ${item.stock} left` : `${item.stock} in stock`;
      return `<div class="store-card cat-${item.cat} ${out ? 'out-of-stock' : ''}" id="store-item-${item.id}" style="${!canAfford && !out ? 'opacity:.65' : ''}">
        ${out ? `<div style="position:absolute;top:12px;right:12px;z-index:2"><span class="badge-pill bp-red" style="font-size:9px;letter-spacing:.04em">OUT OF STOCK</span></div>` : ''}
        <div class="store-emoji" style="filter:${out ? 'grayscale(1)' : ''}">${item.emoji}</div>
        <div class="store-rarity"><span class="rarity-pill ${r.cls}">${r.label}</span></div>
        <div class="store-name">${_esc(item.name)}</div>
        <div class="store-desc">${_esc(item.desc)}</div>
        <div style="font-size:10px;font-weight:700;color:${stockColor};margin-bottom:10px;letter-spacing:.04em">${stockLabel}</div>
        <div class="store-footer">
          <div class="store-price">
            <span class="material-symbols-outlined" style="font-variation-settings:'FILL' 1">monetization_on</span>${item.cost}
          </div>
          <button class="store-redeem-btn" ${out || !canAfford ? 'disabled' : ''} style="${out ? 'opacity:.5;cursor:not-allowed' : canAfford ? '' : 'opacity:.5;cursor:not-allowed'}" onclick="event.stopPropagation();${out || !canAfford ? '' : `cartAdd('${item.id}')`}">${out ? 'Unavailable' : canAfford ? '🛒 Add to Cart' : "Can't Afford"}</button>
        </div>
      </div>`;
    }).join('')}
  </div>` : `<div style="text-align:center;padding:80px;color:var(--text-muted);font-size:13px">No items in this category.</div>`}`;

  _cartRenderFab();
  // Promotions carousel — typeof guard (promotions.js loads after store.js)
  if (typeof promoRenderCarousel === 'function') promoRenderCarousel();
};

// ── Cart engine ───────────────────────────────────────────────────────────────
// Session-only (in memory). Keys = item id, value = { item, qty }
const _CART = {};

window.cartAdd = function (id) {
  DB = loadDB();
  const item = DB.store.find(i => i.id === id);
  if (!item) return;
  if (item.stock === 0) { toast('❌ Out of stock!', '#ffb4ab'); return; }
  const cartQty = _CART[id] ? _CART[id].qty : 0;
  if (cartQty >= item.stock) { toast(`❌ Only ${item.stock} in stock!`, '#ffb4ab'); return; }
  if (!_CART[id]) _CART[id] = { item, qty: 0 };
  _CART[id].qty++;
  _CART[id].item = item;
  toast(`🛒 ${item.emoji} ${item.name} added to cart!`, '#8b5cf6');
  _cartRenderFab();
};

window.cartRemove = function (id) {
  if (!_CART[id]) return;
  _CART[id].qty--;
  if (_CART[id].qty <= 0) delete _CART[id];
  _cartRenderFab();
  _cartRenderModal();
};

window.cartSetQty = function (id, qty) {
  DB = loadDB();
  const item = DB.store.find(i => i.id === id);
  if (!item) return;
  const n = parseInt(qty);
  if (isNaN(n) || n <= 0) { delete _CART[id]; _cartRenderFab(); _cartRenderModal(); return; }
  const capped = Math.min(n, item.stock);
  if (!_CART[id]) _CART[id] = { item, qty: 0 };
  _CART[id].qty   = capped;
  _CART[id].item  = item;
  if (capped !== n) toast(`⚠️ Qty capped at ${capped} (max stock)`, '#ffb95f');
  _cartRenderFab();
  _cartRenderModal();
};

window.cartClear = function () { for (const k in _CART) delete _CART[k]; _cartRenderFab(); };

function _cartTotal()  { return Object.values(_CART).reduce((s, e) => s + e.item.cost * e.qty, 0); }
function _cartCount()  { return Object.values(_CART).reduce((s, e) => s + e.qty, 0); }

function _cartRenderFab() {
  const old = document.getElementById('cart-fab');
  if (old) old.remove();
  const page = document.getElementById('s-store');
  if (!page || !page.classList.contains('active')) return;
  const count = _cartCount();
  if (count === 0) return;
  const fab = document.createElement('button');
  fab.id        = 'cart-fab';
  fab.className = 'cart-fab';
  fab.innerHTML = `🛒 Cart <span class="cart-count">${count}</span> &nbsp;·&nbsp; 🪙 ${_cartTotal().toLocaleString()}`;
  fab.onclick   = cartOpenModal;
  document.body.appendChild(fab);
}

window.cartOpenModal = function () {
  DB = loadDB();
  for (const id in _CART) {
    const item = DB.store.find(i => i.id === id);
    if (!item || item.stock === 0) { delete _CART[id]; continue; }
    _CART[id].item = item;
    if (_CART[id].qty > item.stock) _CART[id].qty = item.stock;
  }
  _cartRenderModal();
};

function _cartRenderModal() {
  const entries  = Object.values(_CART);
  if (!entries.length) { closeModalForce(); return; }
  const total    = _cartTotal();
  const canAfford = currentUser.coins >= total;
  const rows = entries.map(e => `
    <div class="cart-item-row">
      <div style="font-size:28px;width:36px;text-align:center;flex-shrink:0">${e.item.emoji}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:13px;color:var(--on-surface)">${_esc(e.item.name)}</div>
        <div style="font-size:11px;color:var(--text-muted)">🪙 ${e.item.cost.toLocaleString()} each · ${e.item.stock} in stock</div>
      </div>
      <div class="cart-qty-ctrl">
        <button class="cart-qty-btn" onclick="cartSetQty('${e.item.id}',${e.qty - 1})">−</button>
        <input class="cart-qty-num" type="number" min="1" max="${e.item.stock}" value="${e.qty}"
          style="width:38px;background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:6px;color:var(--on-surface);text-align:center;padding:2px 0;font-family:var(--fh);font-weight:800;font-size:14px"
          oninput="cartSetQty('${e.item.id}',this.value)">
        <button class="cart-qty-btn" onclick="cartSetQty('${e.item.id}',${e.qty + 1})">+</button>
      </div>
      <div style="min-width:64px;text-align:right;font-family:var(--fh);font-weight:800;font-size:13px;color:var(--tertiary)">🪙 ${(e.item.cost * e.qty).toLocaleString()}</div>
      <button onclick="cartSetQty('${e.item.id}',0)" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;padding:0 0 0 8px;line-height:1">✕</button>
    </div>`).join('');

  showModal(`
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
    <div style="font-family:var(--fh);font-size:18px;font-weight:900">🛒 Your Cart</div>
    <button onclick="cartClear();closeModalForce()" style="background:none;border:none;color:var(--text-muted);font-size:12px;cursor:pointer;font-weight:700">Clear all</button>
  </div>
  <div style="max-height:340px;overflow-y:auto;padding-right:4px">${rows}</div>
  <div style="background:rgba(26,24,44,0.9);border-radius:12px;padding:14px;margin:14px 0">
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
      <span style="color:var(--text-muted)">Your balance</span>
      <span class="coin-tag">🪙 ${currentUser.coins.toLocaleString()}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
      <span style="color:var(--text-muted)">Total (${_cartCount()} item${_cartCount() !== 1 ? 's' : ''})</span>
      <span style="color:#ffb95f;font-weight:700">−${total.toLocaleString()}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:14px;border-top:1px solid var(--border);padding-top:10px;font-weight:800">
      <span>After purchase</span>
      <span class="coin-tag" style="${canAfford ? '' : 'color:#ffb4ab;border-color:rgba(255,180,171,0.3)'}">🪙 ${(currentUser.coins - total).toLocaleString()}</span>
    </div>
    ${!canAfford ? `<div style="color:#ffb4ab;font-size:11px;font-weight:700;margin-top:8px;text-align:center">⚠️ Not enough coins — remove some items</div>` : ''}
  </div>
  <div style="display:flex;gap:10px">
    <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Keep Shopping</button>
    <button class="btn btn-primary" style="flex:1;background:linear-gradient(135deg,#8b5cf6,#EC4899)" ${canAfford ? '' : 'disabled'} onclick="cartCheckout()">Checkout ✅</button>
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
 *   Creates DB.orders entries (one per unit): { orderId, claimCode, studentId, studentName,
 *     studentInit, studentColor, itemId, itemName, emoji, cost, category,
 *     status:'pending', createdAt, createdDateStr, claimedAt:null, ... }
 *   Creates DB.redemptions entries (one per unit): { studentId, itemId, itemName, emoji,
 *     item:'emoji name', pts:cost, date, time, orderId, claimCode }
 *   Updates DB.inventory[sid]: upserts { itemId, itemName, emoji, category, quantity, datePurchased, source, status }
 * Deducts coins for successfully-reserved items only, saves DB, shows the
 * consolidated claim-codes modal for those items.
 * Calls promoRecordPurchase(itemId) per item (typeof guard).
 * Calls achCheckAndAward(currentUser.id) after 400ms (typeof guard).
 * Calls renderStudentStore(), updateTopbar(), invUpdateSidebarBadge().
 */
window.cartCheckout = async function () {
  DB = loadDB();
  const entries = Object.values(_CART);
  if (!entries.length) return;
  const stIdx  = DB.students.findIndex(s => s.id === currentUser.id);
  if (stIdx < 0) return;

  // Check affordability against current cart contents BEFORE reserving any
  // stock — simpler and safer than trying to "refund" a stock reservation
  // afterward (an undo path has its own edge cases — e.g. a student session
  // isn't authorized to call the owner-gated restock RPC). The Checkout
  // button is already disabled client-side when unaffordable; this is the
  // authoritative re-check right before writing anything.
  const estimatedTotal = entries.reduce((s, e) => s + e.item.cost * e.qty, 0);
  if (DB.students[stIdx].coins < estimatedTotal) { toast('❌ Not enough coins!', '#ffb4ab'); return; }

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
    const item = DB.store.find(i => i.id === e.item.id);
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
    failed.forEach(f => toast(`❌ ${f.e.item.name}: ${f.reason}`, '#ffb4ab'));
    _cartRenderModal(); // refreshes stock numbers shown in the still-open cart
    return;
  }

  const total = succeeded.reduce((s, { e }) => s + e.item.cost * e.qty, 0);

  DB.students[stIdx].coins -= total;
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
  if (!DB.orders)                           DB.orders = [];
  if (!DB.redemptions)                      DB.redemptions = [];
  if (!DB.inventory)                        DB.inventory = {};
  if (!DB.inventory[currentUser.id])        DB.inventory[currentUser.id] = [];

  const orderIds = [];
  succeeded.forEach(({ e, item }) => {
    for (let q = 0; q < e.qty; q++) {
      const claimCode = posGenCode();
      const orderId   = 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + q;
      orderIds.push({ orderId, claimCode, item, qty: e.qty });
      DB.orders.unshift({
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
      DB.redemptions.unshift({
        studentId: currentUser.id, itemId: item.id, itemName: item.name,
        emoji: item.emoji, item: `${item.emoji} ${item.name}`,
        pts: item.cost, date: todayStr(), time: nowStr(), orderId, claimCode
      });
    }
    // Upsert inventory
    const inv      = DB.inventory[currentUser.id];
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
    if (typeof promoRecordPurchase === 'function') promoRecordPurchase(item.id);
  });

  currentUser = DB.students[stIdx];
  saveDB();
  closeModalForce();

  // Only clear cart entries that actually succeeded — a failed item (lost
  // the stock race) stays in the cart so the student can see it and adjust
  // quantity/remove it themselves, instead of it silently vanishing.
  succeeded.forEach(({ e }) => delete _CART[e.item.id]);
  failed.forEach(f => toast(`❌ ${f.e.item.name}: ${f.reason}`, '#ffb4ab'));

  // Consolidated claim codes modal
  const codesHtml = [...new Map(orderIds.map(o => [o.item.id, o])).values()].map(o => `
    <div style="background:rgba(26,24,44,0.9);border-radius:10px;padding:10px 14px;margin-bottom:8px;display:flex;align-items:center;gap:12px">
      <span style="font-size:24px">${o.item.emoji}</span>
      <div style="flex:1">
        <div style="font-weight:700;font-size:13px">${_esc(o.item.name)} ×${o.qty}</div>
        <div style="font-family:var(--fm);font-size:18px;font-weight:900;color:#d0bcff;letter-spacing:.12em;margin-top:2px">${o.claimCode}</div>
      </div>
    </div>`).join('');

  showModal(`
  <div style="text-align:center;margin-bottom:16px">
    <div style="font-size:52px;margin-bottom:8px">🎉</div>
    <div style="font-family:var(--fm);font-size:10px;color:var(--secondary);letter-spacing:.14em;margin-bottom:4px;text-transform:uppercase">Order Confirmed</div>
    <div style="font-family:var(--fh);font-size:18px;font-weight:900;margin-bottom:4px">Show codes to your teacher</div>
    <div style="font-size:12px;color:var(--text-muted)">One code per item — present to claim each reward</div>
  </div>
  <div style="max-height:300px;overflow-y:auto">${codesHtml}</div>
  <button class="btn btn-primary btn-block" style="margin-top:14px" onclick="closeModalForce()">Got it! ✅</button>
  `, 'sm');

  renderStudentStore();
  updateTopbar();
  if (typeof invUpdateSidebarBadge === 'function') invUpdateSidebarBadge();
  if (typeof achCheckAndAward === 'function') setTimeout(() => achCheckAndAward(currentUser.id), 400);
};

// ── Claim code generator ──────────────────────────────────────────────────────

/**
 * posGenCode() → string  [window.posGenCode]
 * Format: XXX-NNN-XXX (alpha no I/O, digit, alpha). Retries up to 100× for uniqueness.
 */
window.posGenCode = function () {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const rA = () => alpha[Math.floor(Math.random() * alpha.length)];
  const rN = () => Math.floor(Math.random() * 10);
  let code, tries = 0;
  do {
    code = `${rA()}${rA()}${rA()}-${rN()}${rN()}${rN()}-${rA()}${rA()}${rA()}`;
    tries++;
  } while (tries < 100 && (DB.orders || []).some(o => o.claimCode === code && o.status === 'pending'));
  return code;
};

/**
 * posShowClaimCode(code, item, orderId) → void  [window.posShowClaimCode]
 * Shows a 'sm' modal displaying the claim code for a single order.
 * item: { emoji, name }
 */
window.posShowClaimCode = function (code, item, orderId) {
  showModal(`
  <div style="text-align:center">
    <div style="font-size:52px;margin-bottom:8px">${item.emoji}</div>
    <div style="font-family:var(--fm);font-size:10px;color:var(--secondary);letter-spacing:.14em;margin-bottom:6px;text-transform:uppercase">ORDER CONFIRMED</div>
    <div style="font-family:var(--fh);font-size:20px;font-weight:900;color:var(--on-surface);margin-bottom:4px">${_esc(item.name)}</div>
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:24px">Show this code to your teacher to claim your reward</div>
    <div style="background:rgba(78,222,163,0.07);border:2px solid rgba(78,222,163,0.3);border-radius:16px;padding:24px;margin-bottom:20px">
      <div style="font-family:var(--fm);font-size:9px;color:var(--text-muted);letter-spacing:.16em;text-transform:uppercase;margin-bottom:10px">YOUR CLAIM CODE</div>
      <div id="pos-claim-display" style="font-family:var(--fm);font-size:32px;font-weight:900;color:var(--secondary);letter-spacing:.18em;text-shadow:0 0 20px rgba(78,222,163,0.4)">${_esc(code)}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:8px">Order: <span style="color:var(--primary)">${_esc(orderId)}</span></div>
    </div>
    <div style="background:rgba(255,185,95,0.07);border:1px solid rgba(255,185,95,0.2);border-radius:10px;padding:10px 14px;margin-bottom:20px;font-size:12px;color:var(--tertiary);display:flex;align-items:center;gap:8px">
      <span class="material-symbols-outlined" style="font-size:16px">info</span>
      <span>Screenshot or memorize this code. Find it anytime in <b>My Inventory</b>.</span>
    </div>
    <button class="btn btn-primary btn-block" onclick="closeModalForce()">Got it! ✓</button>
  </div>`, 'sm');
};

// ── Compatibility stubs ───────────────────────────────────────────────────────
window.buyItem    = function (id) { cartAdd(id); };
window.confirmBuy = function (id) { /* replaced by cartCheckout */ };

console.log('[EduQuest] shop/store.js loaded — renderStudentStore, cart engine, posGenCode, posShowClaimCode registered.');
