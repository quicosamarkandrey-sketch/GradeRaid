// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/shop/orders.js
//  Student "My Orders" page (renderStudentOrders) and the sidebar badge patch
//  for the orders nav button. Also owns ordStatusPill / ordLabel helpers.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Order status helpers ──────────────────────────────────────────────────────

/**
 * ordStatusPill(status) → HTML string  [window.ordStatusPill]
 * Returns a styled <span class="badge-pill ord-status-*"> for the given status.
 */
window.ordStatusPill = function (status) {
  const map = {
    pending:   '<span class="badge-pill ord-status-pending">⏳ Pending</span>',
    ready:     '<span class="badge-pill ord-status-ready">✅ Ready</span>',
    claimed:   '<span class="badge-pill ord-status-claimed">🎁 Claimed</span>',
    cancelled: '<span class="badge-pill ord-status-cancelled">❌ Cancelled</span>',
  };
  return map[status] || `<span class="badge-pill bp-gray">${_esc(status)}</span>`;
};

/**
 * ordLabel(status) → string  [window.ordLabel]
 * Returns a short emoji+text label for a given order status.
 */
window.ordLabel = function (status) {
  return { pending: '⏳ Pending', ready: '✅ Ready', claimed: '🎁 Claimed', cancelled: '❌ Cancelled' }[status] || status;
};

// ── Student orders page ───────────────────────────────────────────────────────

/**
 * renderStudentOrders() → void  [window.renderStudentOrders]
 *
 * Renders the "My Orders" student page into #s-orders.
 * Tabs: Active Orders | Order History.
 * After render: calls ordUpdateSidebarBadge().
 *
 * Active row actions: "Show Code" → posShowClaimCode(); "Cancel" → ordCancelPrompt().
 */
window.renderStudentOrders = function () {
  DB = loadDB();
  const st         = currentUser;
  const allOrders  = (DB.orders || []).filter(o => o.studentId === st.id);
  const active     = allOrders.filter(o => o.status === 'pending' || o.status === 'ready');
  const history    = allOrders.filter(o => o.status === 'claimed' || o.status === 'cancelled');
  const totalSpent = allOrders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + (o.cost || 0), 0);

  document.getElementById('s-orders').innerHTML = `
  <div class="page-hero" style="background:linear-gradient(135deg,#0d1a2e,#1a0a2e)">
    <div class="page-hero-bg"></div>
    <div class="page-hero-bg2"></div>
    <div style="position:relative;z-index:1">
      <div class="page-hero-label">🧾 ORDER TRACKER // REWARD_CLAIMS</div>
      <h1 style="font-size:28px">My Orders</h1>
      <p>Track your reward purchases. Show your claim code to the teacher.</p>
      <div class="page-hero-stats">
        <div class="hero-stat-pill"><div class="val" style="color:var(--tertiary)">${active.length}</div><div class="lbl">Active</div></div>
        <div class="hero-stat-pill"><div class="val" style="color:var(--secondary)">${history.filter(o => o.status === 'claimed').length}</div><div class="lbl">Claimed</div></div>
        <div class="hero-stat-pill"><div class="val" style="color:var(--primary)">${allOrders.length}</div><div class="lbl">Total Orders</div></div>
        <div class="hero-stat-pill"><div class="val" style="color:#ffb95f">${totalSpent.toLocaleString()}</div><div class="lbl">Coins Spent</div></div>
      </div>
    </div>
  </div>

  <!-- TABS -->
  <div style="display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:24px;overflow-x:auto">
    <button class="sord-tab active" id="sordtab-active"  onclick="ordSwitchTab('active')"><span class="material-symbols-outlined" style="font-size:16px">pending_actions</span> Active Orders ${active.length > 0 ? `<span style="background:rgba(255,185,95,.2);border:1px solid rgba(255,185,95,.3);border-radius:10px;padding:1px 7px;font-size:10px;font-weight:900;color:var(--tertiary);font-family:var(--fh)">${active.length}</span>` : ''}</button>
    <button class="sord-tab"        id="sordtab-history" onclick="ordSwitchTab('history')"><span class="material-symbols-outlined" style="font-size:16px">history</span> Order History</button>
  </div>

  <!-- ACTIVE TAB -->
  <div id="sord-panel-active">
    ${active.length ? active.map(o => `
    <div class="ord-row">
      <div class="ord-emoji">${o.emoji || '🎁'}</div>
      <div class="ord-info">
        <div class="ord-name">${_esc(o.itemName)}</div>
        <div class="ord-meta">
          ${ordStatusPill(o.status)}
          <span><span class="material-symbols-outlined" style="font-size:11px;vertical-align:middle">monetization_on</span> ${(o.cost || 0).toLocaleString()} coins</span>
          <span>${_esc(o.createdDateStr || '')}</span>
        </div>
        ${o.claimCode ? `<div class="ord-code">${_esc(o.claimCode)}</div>` : ''}
      </div>
      <div class="ord-actions">
        ${o.claimCode ? `<button class="btn btn-ghost btn-sm" onclick="posShowClaimCode('${o.claimCode}',{emoji:'${o.emoji || '🎁'}',name:'${_esc(o.itemName)}'},'${o.orderId}')"><span class="material-symbols-outlined" style="font-size:14px">qr_code</span> Code</button>` : ''}
        <button class="btn btn-danger btn-sm" onclick="ordCancelPrompt('${o.orderId}')"><span class="material-symbols-outlined" style="font-size:14px">cancel</span></button>
      </div>
    </div>`).join('') : `
    <div style="text-align:center;padding:72px 20px;background:rgba(35,31,56,.7);border:1px dashed var(--border);border-radius:16px">
      <div style="font-size:48px;margin-bottom:12px">🛒</div>
      <div style="font-family:var(--fh);font-size:16px;font-weight:800;margin-bottom:6px">No active orders</div>
      <div style="color:var(--text-muted);font-size:13px">Visit the Armory to redeem your coins!</div>
      <button class="btn btn-primary" style="margin-top:16px" onclick="navTo('s-store')">🏪 Visit Armory</button>
    </div>`}
  </div>

  <!-- HISTORY TAB -->
  <div id="sord-panel-history" style="display:none">
    ${history.length ? history.map(o => `
    <div class="ord-row" style="${o.status === 'cancelled' ? 'opacity:.65' : ''}">
      <div class="ord-emoji" style="${o.status === 'cancelled' ? 'filter:grayscale(1)' : ''}">${o.emoji || '🎁'}</div>
      <div class="ord-info">
        <div class="ord-name">${_esc(o.itemName)}</div>
        <div class="ord-meta">
          ${ordStatusPill(o.status)}
          <span><span class="material-symbols-outlined" style="font-size:11px;vertical-align:middle">monetization_on</span> ${(o.cost || 0).toLocaleString()} coins</span>
          <span>${_esc(o.createdDateStr || '')}</span>
          ${o.claimedAt ? `<span>· Claimed ${new Date(o.claimedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</span>` : ''}
          ${o.cancelReason ? `<span style="color:#ffb4ab">· ${_esc(o.cancelReason)}</span>` : ''}
        </div>
      </div>
    </div>`).join('') : `
    <div style="text-align:center;padding:60px;color:var(--text-muted);font-size:13px">
      <div style="font-size:40px;margin-bottom:12px">📋</div>
      <div>No order history yet.</div>
    </div>`}
  </div>`;

  ordUpdateSidebarBadge();
};

// ── Tab switcher ──────────────────────────────────────────────────────────────

window.ordSwitchTab = function (tab) {
  ['active', 'history'].forEach(t => {
    const btn   = document.getElementById('sordtab-' + t);
    const panel = document.getElementById('sord-panel-' + t);
    if (btn)   btn.classList.toggle('active', t === tab);
    if (panel) panel.style.display = t === tab ? 'block' : 'none';
  });
};

// ── Student cancel flow ───────────────────────────────────────────────────────

/**
 * ordCancelPrompt(orderId) → void  [window.ordCancelPrompt]
 * Opens a confirmation modal for the student to cancel their own pending order.
 * Warns: coins are NOT auto-refunded.
 */
window.ordCancelPrompt = function (orderId) {
  DB = loadDB();
  const order = (DB.orders || []).find(o => o.orderId === orderId);
  if (!order) return;
  showModal(`<div>
    <div class="modal-h2">Cancel Order?</div>
    <div style="color:var(--text-muted);font-size:13px;margin-bottom:16px">
      Cancel <b style="color:var(--on-surface)">${_esc(order.itemName)}</b>?
    </div>
    <div style="background:rgba(255,180,171,.06);border:1px solid rgba(255,180,171,.2);border-radius:12px;padding:14px;margin-bottom:16px;font-size:12px;color:#ffb4ab">
      ⚠️ Coins are not automatically refunded. Ask your teacher if you need a refund.
    </div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Keep Order</button>
      <button class="btn btn-danger" style="flex:1" onclick="ordExecuteCancel('${orderId}')">Cancel Order</button>
    </div>
  </div>`, 'sm');
};

/**
 * ordExecuteCancel(orderId) → void  [window.ordExecuteCancel]
 * Sets order.status = 'cancelled', order.cancelledAt, order.cancelReason = 'Cancelled by student'.
 * saveDB() → closeModalForce() → toast → renderStudentOrders().
 */
window.ordExecuteCancel = function (orderId) {
  DB = loadDB();
  const order = (DB.orders || []).find(o => o.orderId === orderId);
  if (!order) { closeModalForce(); return; }
  order.status       = 'cancelled';
  order.cancelledAt  = Date.now();
  order.cancelReason = 'Cancelled by student';
  order.cancelledBy  = currentUser.name || 'Student';
  saveDB();
  closeModalForce();
  toast('🚫 Order cancelled.', '#ffb4ab');
  renderStudentOrders();
};

// ── Sidebar badge ─────────────────────────────────────────────────────────────

/**
 * ordUpdateSidebarBadge() → void  [window.ordUpdateSidebarBadge]
 * Shows active order count on #nav-s-orders nav button.
 */
window.ordUpdateSidebarBadge = function () {
  const btn = document.getElementById('nav-s-orders');
  if (!btn) return;
  DB = loadDB();
  const active = (DB.orders || []).filter(o => o.studentId === currentUser?.id && (o.status === 'pending' || o.status === 'ready'));
  const old = btn.querySelector('.ord-nav-badge');
  if (old) old.remove();
  if (active.length > 0) {
    const badge = document.createElement('span');
    badge.className   = 'ord-nav-badge';
    badge.textContent = active.length > 99 ? '99+' : String(active.length);
    badge.style.cssText = 'margin-left:auto;background:rgba(255,185,95,0.2);border:1px solid rgba(255,185,95,0.3);border-radius:10px;padding:1px 7px;font-size:10px;font-weight:800;color:var(--tertiary);font-family:var(--fh)';
    btn.appendChild(badge);
  }
};

// ── bootApp patch — show orders badge on login ────────────────────────────────
;(function () {
  const _orig = window.bootApp;
  window.bootApp = function () {
    if (typeof _orig === 'function') _orig();
    if (currentRole === 'student') setTimeout(ordUpdateSidebarBadge, 55);
  };
})();

console.log('[EduQuest] shop/orders.js loaded — renderStudentOrders, ord* helpers, ordUpdateSidebarBadge registered.');
