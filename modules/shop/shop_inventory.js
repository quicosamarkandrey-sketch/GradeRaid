// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/shop/inventory.js
//  Student Inventory page: items grid, purchase history, use-item flow.
//  Also owns invUpdateSidebarBadge and the bootApp/setupSidebar patches.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Category constants ────────────────────────────────────────────────────────
window.INV_CAT_LABELS  = { food: 'Food',    supplies: 'Supplies', privilege: 'Privilege', mystery: 'Mystery', unknown: 'Other'     };
window.INV_CAT_ICONS   = { food: '🍔',      supplies: '📦',       privilege: '⭐',        mystery: '❓',      unknown: '🎁'        };
window.INV_CAT_COLORS  = { food: 'var(--secondary)', supplies: 'var(--primary)', privilege: 'var(--tertiary)', mystery: '#fb923c', unknown: 'var(--text-muted)' };

// ── Main renderer ─────────────────────────────────────────────────────────────

/**
 * renderInventory() → void  [window.renderInventory]
 * Renders the "My Inventory" student page into #s-inventory.
 * Tabs: Items | Purchase History. Calls invFilter() + invHistFilter() after render.
 */
window.renderInventory = function () {
  DB = loadDB();
  const st          = currentUser;
  const inv         = (DB.inventory && DB.inventory[st.id]) ? DB.inventory[st.id] : [];
  const redemptions = DB.redemptions.filter(r => r.studentId === st.id);
  const totalSpent  = redemptions.reduce((s, r) => s + (r.pts || 0), 0);
  const totalItems  = inv.reduce((s, i) => s + (i.quantity || 1), 0);
  const uniqueItems = inv.length;

  document.getElementById('s-inventory').innerHTML = `
  <div class="page-hero" style="background:linear-gradient(135deg,#1a0a2e,#0d1a2e)">
    <div class="page-hero-bg"></div>
    <div class="page-hero-bg2"></div>
    <div style="position:relative;z-index:1">
      <div class="page-hero-label">🎒 ITEM REGISTRY // OWNED_ITEMS</div>
      <h1 style="font-size:30px">My Inventory</h1>
      <p>All items you've redeemed from the Armory, tracked and organized.</p>
      <div class="page-hero-stats">
        <div class="hero-stat-pill"><div class="val" style="color:var(--primary)">${uniqueItems}</div><div class="lbl">Unique Items</div></div>
        <div class="hero-stat-pill"><div class="val" style="color:var(--secondary)">${totalItems}</div><div class="lbl">Total Owned</div></div>
        <div class="hero-stat-pill"><div class="val" style="color:var(--tertiary)">${totalSpent.toLocaleString()}</div><div class="lbl">Coins Spent</div></div>
        <div class="hero-stat-pill"><div class="val" style="color:#fb923c">${redemptions.length}</div><div class="lbl">Purchases</div></div>
      </div>
    </div>
  </div>

  <div class="inv-tab-row" id="inv-tab-row">
    <button class="inv-tab active" id="invtab-items"   onclick="invSwitchTab('items')"><span class="material-symbols-outlined">inventory_2</span> Items</button>
    <button class="inv-tab"        id="invtab-history" onclick="invSwitchTab('history')"><span class="material-symbols-outlined">history</span> Purchase History</button>
  </div>

  <div id="inv-panel-items">
    <div class="inv-toolbar">
      <div class="inv-search-wrap">
        <span class="material-symbols-outlined" style="font-size:18px;color:var(--text-muted)">search</span>
        <input type="text" id="inv-search" placeholder="Search items…" oninput="invFilter()" style="background:none;border:none;outline:none;color:var(--text);font-family:var(--fb);font-size:14px;flex:1;min-width:0">
      </div>
      <div class="inv-filter-row">
        <select id="inv-cat-filter"    onchange="invFilter()" style="background:rgba(35,31,56,0.9);border:1px solid var(--border2);border-radius:10px;padding:8px 12px;font-size:12px;font-family:var(--fb);color:var(--text);cursor:pointer">
          <option value="all">All Categories</option><option value="food">🍔 Food</option><option value="supplies">✏️ Supplies</option><option value="privilege">⭐ Privilege</option><option value="mystery">❓ Mystery</option>
        </select>
        <select id="inv-status-filter" onchange="invFilter()" style="background:rgba(35,31,56,0.9);border:1px solid var(--border2);border-radius:10px;padding:8px 12px;font-size:12px;font-family:var(--fb);color:var(--text);cursor:pointer">
          <option value="all">All Status</option><option value="active">Active</option><option value="used">Used</option>
        </select>
        <select id="inv-sort"          onchange="invFilter()" style="background:rgba(35,31,56,0.9);border:1px solid var(--border2);border-radius:10px;padding:8px 12px;font-size:12px;font-family:var(--fb);color:var(--text);cursor:pointer">
          <option value="recent">Recently Added</option><option value="name">Name A–Z</option><option value="qty-desc">Quantity ↓</option><option value="qty-asc">Quantity ↑</option>
        </select>
      </div>
    </div>
    <div id="inv-results-count" style="font-size:12px;color:var(--text-muted);margin-bottom:16px;font-weight:600"></div>
    <div id="inv-grid" class="inv-grid"></div>
  </div>

  <div id="inv-panel-history" style="display:none">
    <div class="inv-toolbar">
      <div class="inv-search-wrap">
        <span class="material-symbols-outlined" style="font-size:18px;color:var(--text-muted)">search</span>
        <input type="text" id="inv-hist-search" placeholder="Search history…" oninput="invHistFilter()" style="background:none;border:none;outline:none;color:var(--text);font-family:var(--fb);font-size:14px;flex:1;min-width:0">
      </div>
      <div class="inv-filter-row">
        <select id="inv-hist-cat" onchange="invHistFilter()" style="background:rgba(35,31,56,0.9);border:1px solid var(--border2);border-radius:10px;padding:8px 12px;font-size:12px;font-family:var(--fb);color:var(--text);cursor:pointer">
          <option value="all">All Categories</option><option value="food">🍔 Food</option><option value="supplies">✏️ Supplies</option><option value="privilege">⭐ Privilege</option><option value="mystery">❓ Mystery</option>
        </select>
      </div>
    </div>
    <div id="inv-hist-count" style="font-size:12px;color:var(--text-muted);margin-bottom:16px;font-weight:600"></div>
    <div id="inv-hist-list" class="inv-hist-list"></div>
  </div>`;

  invFilter();
  invHistFilter();
};

window.invSwitchTab = function (tab) {
  ['items', 'history'].forEach(t => {
    const btn   = document.getElementById('invtab-' + t);
    const panel = document.getElementById('inv-panel-' + t);
    if (btn)   btn.classList.toggle('active', t === tab);
    if (panel) panel.style.display = t === tab ? 'block' : 'none';
  });
};

window.invFilter = function () {
  DB = loadDB();
  const st = currentUser;
  let inv  = (DB.inventory && DB.inventory[st.id]) ? [...DB.inventory[st.id]] : [];
  const q        = (document.getElementById('inv-search')?.value || '').toLowerCase().trim();
  const cat      = document.getElementById('inv-cat-filter')?.value    || 'all';
  const statusF  = document.getElementById('inv-status-filter')?.value || 'all';
  const sort     = document.getElementById('inv-sort')?.value          || 'recent';

  if (q)           inv = inv.filter(i => (i.itemName || '').toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q));
  if (cat !== 'all')    inv = inv.filter(i => i.category === cat);
  if (statusF !== 'all') inv = inv.filter(i => (i.status || 'active') === statusF);

  if (sort === 'name')     inv.sort((a, b) => (a.itemName || '').localeCompare(b.itemName || ''));
  else if (sort === 'qty-desc') inv.sort((a, b) => (b.quantity || 1) - (a.quantity || 1));
  else if (sort === 'qty-asc')  inv.sort((a, b) => (a.quantity || 1) - (b.quantity || 1));

  const countEl = document.getElementById('inv-results-count');
  if (countEl) countEl.textContent = `Showing ${inv.length} item${inv.length !== 1 ? 's' : ''}`;

  const grid = document.getElementById('inv-grid');
  if (!grid) return;

  if (!inv.length) {
    const isEmpty = !q && cat === 'all' && statusF === 'all';
    grid.innerHTML = `<div class="inv-empty">
      <div style="font-size:56px;margin-bottom:16px">🎒</div>
      <div style="font-family:var(--fh);font-size:18px;font-weight:800;margin-bottom:8px;color:var(--on-surface)">${isEmpty ? 'Inventory Empty' : 'No items match'}</div>
      <div style="color:var(--text-muted);font-size:13px;max-width:280px;margin:0 auto">${isEmpty ? 'Visit the Armory to redeem your first item!' : 'Try adjusting your search or filters.'}</div>
      ${isEmpty ? `<button class="btn btn-primary" style="margin-top:20px" onclick="navTo('s-store')">🛍️ Visit Armory</button>` : ''}
    </div>`;
    return;
  }

  grid.innerHTML = inv.map(item => {
    const isUsed   = (item.status || 'active') === 'used';
    const catColor = INV_CAT_COLORS[item.category] || 'var(--text-muted)';
    const catLabel = INV_CAT_LABELS[item.category] || 'Other';
    const qty       = item.quantity || 1;
    const storeItem = DB.store.find(s => s.id === item.itemId);
    const rarity    = storeItem ? getItemRarity(storeItem) : { label: 'Common', cls: 'rarity-common' };
    const pending   = (DB.orders || []).filter(o => o.studentId === currentUser.id && o.itemId === item.itemId && o.status === 'pending');
    return `<div class="inv-card ${isUsed ? 'inv-card-used' : ''}">
      <div class="inv-card-top">
        <div class="inv-qty-badge ${qty > 1 ? 'inv-qty-multi' : ''}">${qty}×</div>
        ${pending.length ? `<div class="inv-pending-dot" title="${pending.length} unclaimed"></div>` : ''}
        ${isUsed ? `<div class="inv-used-badge">USED</div>` : ''}
      </div>
      <div class="inv-emoji">${item.emoji || '🎁'}</div>
      <div class="inv-rarity"><span class="rarity-pill ${rarity.cls}">${rarity.label}</span></div>
      <div class="inv-name">${_esc(item.itemName)}</div>
      <div class="inv-cat-pill" style="color:${catColor};border-color:${catColor}33;background:${catColor}11">
        ${INV_CAT_ICONS[item.category] || '🎁'} ${catLabel}
      </div>
      <div class="inv-date"><span class="material-symbols-outlined" style="font-size:12px">calendar_today</span>${_esc(item.datePurchased || '')}</div>
      <div class="inv-source"><span class="material-symbols-outlined" style="font-size:12px">storefront</span>${_esc(item.source || 'Store')}</div>
      ${pending.length ? `<button class="inv-code-btn" onclick="invShowCodes('${item.itemId}')"><span class="material-symbols-outlined" style="font-size:13px">qr_code</span> Show Claim Code${pending.length > 1 ? ' (' + pending.length + ')' : ''}</button>` : ''}
      <div class="inv-card-actions">
        ${!isUsed && item.category === 'privilege' ? `<button class="inv-use-btn" onclick="invUseItem('${item.itemId}')">Use Item</button>` : ''}
        <button class="inv-detail-btn" onclick="invViewDetail('${item.itemId}')">Details</button>
      </div>
    </div>`;
  }).join('');
};

window.invHistFilter = function () {
  DB = loadDB();
  let records = DB.redemptions.filter(r => r.studentId === currentUser.id);
  const q   = (document.getElementById('inv-hist-search')?.value || '').toLowerCase().trim();
  const cat = document.getElementById('inv-hist-cat')?.value || 'all';
  if (q)          records = records.filter(r => (r.itemName || r.item || '').toLowerCase().includes(q));
  if (cat !== 'all') records = records.filter(r => { const s = DB.store.find(x => x.id === r.itemId); return s && s.cat === cat; });

  const countEl = document.getElementById('inv-hist-count');
  if (countEl) countEl.textContent = `${records.length} purchase${records.length !== 1 ? 's' : ''}`;
  const list = document.getElementById('inv-hist-list');
  if (!list) return;

  if (!records.length) {
    list.innerHTML = `<div style="text-align:center;padding:60px;color:var(--text-muted);font-size:13px">
      <div style="font-size:40px;margin-bottom:12px">📋</div>
      <div style="font-weight:700;margin-bottom:4px">No purchase history</div>
      <div>${q || cat !== 'all' ? 'No records match your filters.' : 'Redeem items from the Armory to see history here.'}</div>
    </div>`;
    return;
  }

  list.innerHTML = records.map(r => {
    const storeItem  = DB.store.find(s => s.id === r.itemId);
    const catLabel   = storeItem ? INV_CAT_LABELS[storeItem.cat] : 'Store';
    const catColor   = storeItem ? INV_CAT_COLORS[storeItem.cat] : 'var(--text-muted)';
    const emoji      = r.emoji || (storeItem ? storeItem.emoji : '🎁');
    const name       = r.itemName || r.item || 'Unknown Item';
    const order      = r.orderId ? (DB.orders || []).find(o => o.orderId === r.orderId) : null;
    const statusColor = { pending: '#ffb95f', claimed: '#4edea3', cancelled: '#ffb4ab' }[order?.status] || 'var(--text-muted)';
    const statusLabel = { pending: '⏳ Pending', claimed: '✅ Claimed', cancelled: '❌ Cancelled' }[order?.status] || '';
    return `<div class="inv-hist-row">
      <div class="inv-hist-emoji">${emoji}</div>
      <div class="inv-hist-info">
        <div class="inv-hist-name">${_esc(name)}</div>
        <div class="inv-hist-meta">
          <span style="color:${catColor}">${catLabel}</span>
          <span style="color:var(--border2)">·</span>
          <span class="material-symbols-outlined" style="font-size:11px;vertical-align:middle">calendar_today</span>
          ${_esc(r.date || 'Unknown date')}
          ${r.time ? `<span style="color:var(--border2)">·</span>${_esc(r.time)}` : ''}
          ${order ? `<span style="color:var(--border2)">·</span><span style="color:${statusColor};font-weight:700">${statusLabel}</span>` : ''}
        </div>
        ${r.claimCode ? `<div style="margin-top:5px;display:flex;align-items:center;gap:6px">
          <span style="font-family:var(--fm);font-size:12px;color:var(--secondary);letter-spacing:.1em">${_esc(r.claimCode)}</span>
          ${order && order.status === 'pending' ? `<button onclick="posShowClaimCode('${r.claimCode}',{emoji:'${emoji}',name:'${_esc(name)}'},${r.orderId ? `'${r.orderId}'` : 'null'})" style="background:rgba(78,222,163,0.1);border:1px solid rgba(78,222,163,0.25);color:var(--secondary);border-radius:6px;padding:2px 8px;font-size:10px;font-weight:700;cursor:pointer;font-family:var(--fb)">Show Code</button>` : ''}
        </div>` : ''}
      </div>
      <div class="inv-hist-cost">
        <span class="material-symbols-outlined" style="font-size:14px;color:var(--tertiary);font-variation-settings:'FILL' 1">monetization_on</span>
        <span style="font-family:var(--fh);font-weight:800;color:var(--tertiary)">${(r.pts || 0).toLocaleString()}</span>
      </div>
    </div>`;
  }).join('');
};

window.invUseItem = function (itemId) {
  DB = loadDB();
  const inv  = DB.inventory?.[currentUser.id];
  if (!inv) return;
  const item      = inv.find(i => i.itemId === itemId);
  if (!item || item.status === 'used') { toast('⚠️ Item already used or not found.', '#ffb4ab'); return; }
  const storeItem = DB.store.find(s => s.id === itemId);
  showModal(`<div style="text-align:center">
    <div style="font-size:56px;margin-bottom:12px">${item.emoji || '🎁'}</div>
    <div class="modal-h2" style="text-align:center">Use ${_esc(item.itemName)}?</div>
    <div style="color:var(--text-muted);font-size:13px;margin-bottom:20px;line-height:1.6">${storeItem ? _esc(storeItem.desc) : 'This will mark the item as used.'}</div>
    <div style="background:rgba(255,185,95,0.08);border:1px solid rgba(255,185,95,0.2);border-radius:12px;padding:12px;margin-bottom:20px;font-size:13px;color:var(--tertiary)">
      ⚠️ This action cannot be undone. The item will be marked as used.
    </div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" style="flex:1" onclick="invConfirmUse('${itemId}')">✅ Confirm Use</button>
    </div>
  </div>`, 'sm');
};

window.invConfirmUse = function (itemId) {
  DB = loadDB();
  if (!DB.inventory?.[currentUser.id]) { closeModalForce(); return; }
  const item = DB.inventory[currentUser.id].find(i => i.itemId === itemId);
  if (!item) { closeModalForce(); return; }
  item.status = 'used';
  item.usedAt = todayStr() + ' at ' + nowStr();
  if (item.quantity > 1) { item.quantity--; item.status = 'active'; }
  saveDB();
  closeModalForce();
  toast(`✅ ${item.emoji} ${item.itemName} used!`, '#4edea3');
  renderInventory();
};

window.invViewDetail = function (itemId) {
  DB = loadDB();
  const inv  = (DB.inventory?.[currentUser.id]) || [];
  const item  = inv.find(i => i.itemId === itemId);
  if (!item) { toast('Item not found.', '#ffb4ab'); return; }
  const storeItem = DB.store.find(s => s.id === itemId);
  const rarity    = storeItem ? getItemRarity(storeItem) : { label: 'Common', cls: 'rarity-common' };
  const purchases = DB.redemptions.filter(r => r.studentId === currentUser.id && r.itemId === itemId);
  const catColor  = INV_CAT_COLORS[item.category] || 'var(--text-muted)';
  showModal(`<div style="text-align:center">
    <div style="font-size:60px;margin-bottom:10px">${item.emoji || '🎁'}</div>
    <span class="rarity-pill ${rarity.cls}" style="margin-bottom:12px;display:inline-block">${rarity.label}</span>
    <div class="modal-h2" style="text-align:center;margin-bottom:4px">${_esc(item.itemName)}</div>
    <div style="color:${catColor};font-size:12px;font-weight:700;margin-bottom:16px">${INV_CAT_ICONS[item.category] || '🎁'} ${INV_CAT_LABELS[item.category] || 'Store'}</div>
    ${storeItem ? `<div style="background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:16px;font-size:13px;color:var(--text-muted);line-height:1.6;text-align:left">${_esc(storeItem.desc)}</div>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px">
      <div style="background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:10px;padding:10px;text-align:center">
        <div style="font-family:var(--fh);font-size:22px;font-weight:900;color:var(--primary)">${item.quantity || 1}</div>
        <div style="font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.06em;text-transform:uppercase">Owned</div>
      </div>
      <div style="background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:10px;padding:10px;text-align:center">
        <div style="font-family:var(--fh);font-size:22px;font-weight:900;color:var(--tertiary)">${purchases.length}</div>
        <div style="font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.06em;text-transform:uppercase">Purchases</div>
      </div>
      <div style="background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:10px;padding:10px;text-align:center">
        <div style="font-family:var(--fh);font-size:22px;font-weight:900;color:var(--tertiary)">${storeItem?.cost || '?'}</div>
        <div style="font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.06em;text-transform:uppercase">Coins Each</div>
      </div>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:16px">
      First purchased: ${_esc(item.datePurchased || 'Unknown')}<br>Source: ${_esc(item.source || 'Store')}
    </div>
    <div style="display:flex;gap:10px">
      ${(item.status || 'active') !== 'used' && item.category === 'privilege' ? `<button class="btn btn-primary" style="flex:1" onclick="closeModalForce();invUseItem('${itemId}')">Use Item</button>` : ''}
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Close</button>
    </div>
  </div>`, 'sm');
};

window.invShowCodes = function (itemId) {
  DB = loadDB();
  const orders = (DB.orders || []).filter(o => o.studentId === currentUser.id && o.itemId === itemId && o.status === 'pending');
  if (!orders.length) { toast('No pending orders for this item.', '#ffb4ab'); return; }
  const item  = DB.store.find(s => s.id === itemId);
  const emoji = item ? item.emoji : '🎁';
  const name  = item ? item.name  : (orders[0].itemName || 'Item');
  if (orders.length === 1) { posShowClaimCode(orders[0].claimCode, { emoji, name }, orders[0].orderId); return; }
  showModal(`<div>
    <div style="text-align:center;margin-bottom:16px">
      <div style="font-size:44px;margin-bottom:8px">${emoji}</div>
      <div class="modal-h2" style="text-align:center;margin-bottom:4px">${_esc(name)}</div>
      <div style="font-size:13px;color:var(--text-muted)">${orders.length} pending orders</div>
    </div>
    ${orders.map((o, i) => `
    <div style="background:rgba(78,222,163,0.06);border:1px solid rgba(78,222,163,0.2);border-radius:12px;padding:14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-size:11px;color:var(--text-muted)">Order ${i + 1}</div>
        <div style="font-size:10px;color:var(--text-muted)">${_esc(o.createdDateStr || '')}</div>
      </div>
      <div style="font-family:var(--fm);font-size:22px;font-weight:900;color:var(--secondary);letter-spacing:.16em;text-align:center;text-shadow:0 0 16px rgba(78,222,163,0.3)">${_esc(o.claimCode)}</div>
    </div>`).join('')}
    <button class="btn btn-ghost btn-block" style="margin-top:4px" onclick="closeModalForce()">Close</button>
  </div>`, 'md');
};

// ── Sidebar badge ─────────────────────────────────────────────────────────────

/**
 * invUpdateSidebarBadge() → void  [window.invUpdateSidebarBadge]
 * Shows total owned quantity on #nav-s-inventory nav button.
 * Called by bootApp patch and setupSidebar patch (both below).
 */
window.invUpdateSidebarBadge = function () {
  const btn = document.getElementById('nav-s-inventory');
  if (!btn) return;
  DB = loadDB();
  const total = ((DB.inventory && DB.inventory[currentUser?.id]) || []).reduce((s, i) => s + (i.quantity || 1), 0);
  const old   = btn.querySelector('.inv-nav-badge');
  if (old) old.remove();
  if (total > 0) {
    const badge = document.createElement('span');
    badge.className = 'inv-nav-badge';
    badge.textContent = total > 99 ? '99+' : String(total);
    badge.style.cssText = 'margin-left:auto;background:rgba(208,188,255,0.2);border:1px solid rgba(208,188,255,0.3);border-radius:10px;padding:1px 7px;font-size:10px;font-weight:800;color:var(--primary);font-family:var(--fh)';
    btn.appendChild(badge);
  }
};

// ── bootApp patch — show inventory badge on login ─────────────────────────────
;(function () {
  const _orig = window.bootApp;
  window.bootApp = function () {
    if (typeof _orig === 'function') _orig();
    if (currentRole === 'student') setTimeout(invUpdateSidebarBadge, 50);
  };
})();

// ── setupSidebar patch — refresh badge after nav rebuild ──────────────────────
;(function () {
  const _orig = window.setupSidebar;
  window.setupSidebar = function () {
    if (typeof _orig === 'function') _orig();
    if (currentRole === 'student') setTimeout(invUpdateSidebarBadge, 20);
  };
})();

console.log('[EduQuest] shop/inventory.js loaded — renderInventory, inv* helpers, invUpdateSidebarBadge registered.');
