// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/shop/promotions.js
//  Dynamic Promotion & Banner Management System.
//  Exports: PROMO_TYPES, promoTypeConfig, promoIsActive, promoGetActive,
//           promoRecordView/Click/Purchase, promoGetAutoLabel,
//           promoCountdownStr, promoRenderCarousel, promoNav, promoGoTo,
//           promoClickBanner, promoGetCardBadge, promoBuildSlideHTML,
//           promoStartCountdownTick,
//           renderAdminPromotions, promoAdminOpenForm, promoAdminSaveForm,
//           promoAdminToggle, promoAdminDelete, promoAdminConfirmDelete,
//           promoAdminPreview, promoAdminPreviewStore, promoFormTypeChange.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Type config ───────────────────────────────────────────────────────────────

window.PROMO_TYPES = [
  { value: 'new',      label: '🆕 New Item',        tagLabel: 'NEW',      btnColor: '#8b5cf6' },
  { value: 'hot',      label: '🔥 Hot Item',        tagLabel: '🔥 HOT',   btnColor: '#f97316' },
  { value: 'sale',     label: '💰 Sale',             tagLabel: 'SALE',     btnColor: '#ef4444' },
  { value: 'limited',  label: '⏰ Limited Offer',    tagLabel: 'LIMITED',  btnColor: '#ffb95f' },
  { value: 'featured', label: '⭐ Featured Reward',  tagLabel: 'FEATURED', btnColor: '#4edea3' },
  { value: 'event',    label: '🎉 Event Promotion',  tagLabel: 'EVENT',    btnColor: '#EC4899' },
  { value: 'seasonal', label: '🌸 Seasonal',         tagLabel: 'SEASONAL', btnColor: '#8b5cf6' },
  { value: 'custom',   label: '✏️ Custom',           tagLabel: 'PROMO',    btnColor: '#60a5fa' },
];

window.promoTypeConfig = function (type) {
  return PROMO_TYPES.find(t => t.value === type) || PROMO_TYPES[PROMO_TYPES.length - 1];
};

// ── Active check & getters ────────────────────────────────────────────────────

window.promoIsActive = function (p) {
  if (!p.active) return false;
  const now = new Date();
  if (p.startDate && new Date(p.startDate) > now) return false;
  if (p.endDate   && new Date(p.endDate)   < now) return false;
  return true;
};

window.promoGetActive = function () {
  DB = loadDB();
  return (DB.promotions || []).filter(promoIsActive).sort((a, b) => (b.priority || 0) - (a.priority || 0));
};

// ── Analytics recorders ───────────────────────────────────────────────────────

window.promoRecordView = function (id) {
  if (!id) return;
  DB = loadDB();
  if (!DB.promoAnalytics) DB.promoAnalytics = {};
  if (!DB.promoAnalytics[id]) DB.promoAnalytics[id] = { views: 0, clicks: 0, purchases: 0 };
  DB.promoAnalytics[id].views++;
  saveDB();
};

window.promoRecordClick = function (id) {
  if (!id) return;
  DB = loadDB();
  if (!DB.promoAnalytics) DB.promoAnalytics = {};
  if (!DB.promoAnalytics[id]) DB.promoAnalytics[id] = { views: 0, clicks: 0, purchases: 0 };
  DB.promoAnalytics[id].clicks++;
  saveDB();
};

/**
 * promoRecordPurchase(itemId) → void  [window.promoRecordPurchase]
 * Called from cartCheckout() / POS's _posPayAttemptCharge() — both are
 * mid-transaction: they've already built up (but not yet saved) new
 * DB.orders/DB.redemptions/DB.inventory entries on the live `DB` object and
 * only call saveDB() once, after their own forEach loop finishes.
 *
 * BUGFIX: this used to call `DB = loadDB(); ...; saveDB();` itself. Since
 * `DB` is a single shared global, that reassigned it to a completely fresh
 * snapshot mid-loop, silently discarding every order/redemption/inventory
 * mutation the caller had made so far (and any it makes for the next cart
 * item) — the caller's own saveDB() at the end then persisted that fresh,
 * still-order-less snapshot. For a purchase whose cart had 2+ distinct
 * items, the *next* iteration's `DB.inventory[studentId]` lookup then hit
 * this fresh snapshot (never initialized for that student) and threw
 * ("Cannot read properties of undefined (reading 'find')"), aborting the
 * whole checkout before the final saveDB() ever ran. Either way — crash or
 * not — the purchased item's order/history/inventory records were lost even
 * though the coins were already charged server-side (that RPC is separate
 * and unaffected). Fix: operate on the DB object the caller already has
 * loaded, and don't save here — the caller's own saveDB() call right after
 * its loop covers this write along with everything else it just did, in one
 * atomic flush.
 */
window.promoRecordPurchase = function (itemId) {
  if (!DB.promoAnalytics) DB.promoAnalytics = {};
  (DB.promotions || []).filter(p => p.linkedItemId === itemId && promoIsActive(p)).forEach(p => {
    if (!DB.promoAnalytics[p.id]) DB.promoAnalytics[p.id] = { views: 0, clicks: 0, purchases: 0 };
    DB.promoAnalytics[p.id].purchases++;
  });
};

// ── Auto-label logic ──────────────────────────────────────────────────────────

window.promoGetAutoLabel = function (item) {
  const now         = new Date();
  const twoDaysAgo  = new Date(now - 2 * 24 * 60 * 60 * 1000);
  if (item._promoLabel) return item._promoLabel;
  if (item.addedAt && new Date(item.addedAt) >= twoDaysAgo) return 'new';
  if (item.stock !== undefined && item.stock <= 3 && item.stock > 0) return 'limited';
  const count = (DB.redemptions || []).filter(r => r.itemId === item.id).length;
  if (count >= 3) return 'hot';
  return null;
};

// ── Countdown ─────────────────────────────────────────────────────────────────

window.promoCountdownStr = function (endDate) {
  if (!endDate) return null;
  const diff = new Date(endDate) - new Date();
  if (diff <= 0) return null;
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (d > 0) return `⏰ ${d}d ${h}h left`;
  if (h > 0) return `⏰ ${h}h ${m}m left`;
  return `⏰ ${m}m left`;
};

// ── Carousel state ────────────────────────────────────────────────────────────
let promoCarousel = { idx: 0, slides: [], timer: null, interval: 6000 };

// ── Slide builder ─────────────────────────────────────────────────────────────

window.promoBuildSlideHTML = function (p) {
  const cfg       = promoTypeConfig(p.type);
  const item      = p.linkedItemId ? (DB.store || []).find(i => i.id === p.linkedItemId) : null;
  const emoji     = p.image || item?.emoji || '🎁';
  const countdown = p.endDate ? promoCountdownStr(p.endDate) : null;
  const tagLabel  = p.adminLabel || (p.type === 'custom' && p.customTypeLabel ? p.customTypeLabel : cfg.tagLabel);
  const price     = item ? item.cost : null;
  return `<div class="promo-slide type-${p.type}" id="promo-slide-${p.id}">
    <div class="promo-slide-bg"></div>
    <div class="promo-slide-content" onclick="promoClickBanner('${p.id}')">
      <div class="promo-slide-inner">
        ${countdown ? `<div class="promo-countdown${new Date(p.endDate) - new Date() < 3600000 ? ' urgent' : ''}">${countdown}</div>` : ''}
        <span class="promo-tag type-${p.type}">${tagLabel}</span>
        <div class="promo-title">${_esc(p.title)}</div>
        <div class="promo-sub">${_esc(p.subtitle || '')}</div>
        <div class="promo-cta">
          ${price !== null ? `<div class="promo-price"><span class="material-symbols-outlined" style="font-size:16px;font-variation-settings:'FILL' 1">monetization_on</span>${price}</div>` : ''}
          <button class="promo-btn" onclick="event.stopPropagation();promoClickBanner('${p.id}')">${item ? 'Redeem' : 'View →'}</button>
        </div>
      </div>
      <div class="promo-slide-emoji">${emoji}</div>
    </div>
  </div>`;
};

// ── Carousel render ───────────────────────────────────────────────────────────

window.promoRenderCarousel = function () {
  const wrap = document.getElementById('promo-carousel-wrap');
  if (!wrap) return;
  const active = promoGetActive();

  if (!active.length) {
    wrap.innerHTML = `<div class="promo-empty-banner">
      <div style="width:100%;height:100%;background:linear-gradient(135deg,rgba(26,20,56,0.98),rgba(139,92,246,0.15));display:flex;align-items:center;padding:0 32px">
        <div class="store-banner-inner">
          <span class="store-banner-tag">🏪 Welcome</span>
          <div class="store-banner-title">The Armory</div>
          <div class="store-banner-sub">Browse all available rewards and exchange your coins!</div>
        </div>
        <div style="font-size:96px;margin-left:auto;padding-right:32px;filter:drop-shadow(0 0 32px rgba(255,185,95,0.4))">⚔️</div>
      </div>
    </div>`;
    return;
  }

  promoRecordView(active[promoCarousel.idx % active.length]?.id);

  const slidesHTML = active.map(p => promoBuildSlideHTML(p)).join('');
  const dotsHTML   = active.length > 1
    ? active.map((_, i) => `<span class="promo-dot${i === 0 ? ' active' : ''}" onclick="promoGoTo(${i})"></span>`).join('')
    : '';

  wrap.innerHTML = `<div class="promo-carousel" id="promo-carousel">
    ${slidesHTML}
    ${active.length > 1 ? `<div class="promo-carousel-controls">
      <button class="promo-nav-btn" onclick="event.stopPropagation();promoNav(-1)">‹</button>
      ${dotsHTML}
      <button class="promo-nav-btn" onclick="event.stopPropagation();promoNav(1)">›</button>
    </div>` : ''}
  </div>`;

  promoCarousel.slides = active;
  promoCarousel.idx    = 0;
  promoActivateSlide(0);

  if (promoCarousel.timer) clearInterval(promoCarousel.timer);
  if (active.length > 1) {
    const interval = active[0].rotationInterval ? active[0].rotationInterval * 1000 : 6000;
    promoCarousel.timer = setInterval(() => promoNav(1), interval);
  }
};

function promoActivateSlide(idx) {
  const slides = promoCarousel.slides;
  if (!slides.length) return;
  idx = ((idx % slides.length) + slides.length) % slides.length;
  promoCarousel.idx = idx;
  document.querySelectorAll('.promo-slide').forEach((el, i) => {
    el.classList.remove('active', 'exit');
    if (i === idx) el.classList.add('active');
  });
  document.querySelectorAll('.promo-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
  promoRecordView(slides[idx]?.id);
}

window.promoNav = function (dir) {
  promoActivateSlide(promoCarousel.idx + dir);
  if (promoCarousel.timer) {
    clearInterval(promoCarousel.timer);
    const slides = promoCarousel.slides;
    if (slides.length > 1) {
      const interval = slides[promoCarousel.idx]?.rotationInterval ? slides[promoCarousel.idx].rotationInterval * 1000 : 6000;
      promoCarousel.timer = setInterval(() => promoNav(1), interval);
    }
  }
};

window.promoGoTo = function (idx) {
  promoActivateSlide(idx);
  if (promoCarousel.timer) {
    clearInterval(promoCarousel.timer);
    const slides = promoCarousel.slides;
    if (slides.length > 1) {
      const interval = slides[promoCarousel.idx]?.rotationInterval ? slides[promoCarousel.idx].rotationInterval * 1000 : 6000;
      promoCarousel.timer = setInterval(() => promoNav(1), interval);
    }
  }
};

window.promoClickBanner = function (id) {
  promoRecordClick(id);
  const p = (DB.promotions || []).find(x => x.id === id);
  if (!p) return;
  if (p.linkedItemId) {
    const item = (DB.store || []).find(i => i.id === p.linkedItemId);
    if (item) {
      renderStudentStore(item.cat);
      showPage('s-store');
      setTimeout(() => {
        const el = document.getElementById('store-item-' + p.linkedItemId);
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.boxShadow = '0 0 32px rgba(208,188,255,0.5)'; setTimeout(() => el.style.boxShadow = '', 1800); }
      }, 300);
    }
  } else {
    navTo('s-store');
  }
};

window.promoGetCardBadge = function (item) {
  const linked = (DB.promotions || []).find(p => p.linkedItemId === item.id && promoIsActive(p));
  if (linked) {
    const cfg      = promoTypeConfig(linked.type);
    const tagLabel = linked.adminLabel || (linked.type === 'custom' && linked.customTypeLabel ? linked.customTypeLabel : cfg.tagLabel);
    return { cls: linked.type, label: tagLabel };
  }
  const auto = promoGetAutoLabel(item);
  if (auto) return { cls: auto, label: { new: 'NEW', hot: '🔥 HOT', limited: 'LIMITED', sale: 'SALE', featured: '⭐' }[auto] || 'PROMO' };
  return null;
};

// ── Countdown tick (live) ─────────────────────────────────────────────────────
let promoCountdownInterval = null;
window.promoStartCountdownTick = function () {
  if (promoCountdownInterval) clearInterval(promoCountdownInterval);
  promoCountdownInterval = setInterval(() => {
    document.querySelectorAll('.promo-countdown').forEach(el => {
      const slide = el.closest('.promo-slide');
      if (!slide) return;
      const id  = slide.id?.replace('promo-slide-', '');
      const p   = (DB.promotions || []).find(x => x.id === id);
      if (!p?.endDate) return;
      const str = promoCountdownStr(p.endDate);
      if (str) { el.textContent = str; el.classList.toggle('urgent', new Date(p.endDate) - new Date() < 3600000); }
      else      { el.remove(); }
    });
  }, 60000);
};

// ── Admin: renderAdminPromotions ──────────────────────────────────────────────

window.renderAdminPromotions = function () {
  DB = loadDB();
  const promos    = DB.promotions || [];
  const analytics = DB.promoAnalytics || {};

  const activeCount    = promos.filter(p => promoIsActive(p)).length;
  const totalViews     = Object.values(analytics).reduce((s, a) => s + (a.views     || 0), 0);
  const totalClicks    = Object.values(analytics).reduce((s, a) => s + (a.clicks    || 0), 0);
  const totalPurchases = Object.values(analytics).reduce((s, a) => s + (a.purchases || 0), 0);

  let mostClicked = null, maxClicks = 0;
  Object.entries(analytics).forEach(([id, a]) => { if ((a.clicks || 0) > maxClicks) { maxClicks = a.clicks; mostClicked = promos.find(p => p.id === id); } });
  let mostPurchased = null, maxPurchases = 0;
  Object.entries(analytics).forEach(([id, a]) => { if ((a.purchases || 0) > maxPurchases) { maxPurchases = a.purchases; mostPurchased = promos.find(p => p.id === id); } });

  document.getElementById('a-promotions').innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
    <div>
      <div style="font-family:var(--fh);font-size:26px;font-weight:900">📣 Store Promotions</div>
      <div style="color:var(--text-muted);font-size:13px;margin-top:4px">${promos.length} total · ${activeCount} currently live</div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" onclick="promoAdminPreviewStore()">👁 Preview Carousel</button>
      <button class="btn btn-primary" onclick="promoAdminOpenForm()">＋ Create Promotion</button>
    </div>
  </div>

  <div class="promo-analytics-grid" style="margin-bottom:24px">
    <div class="promo-stat-card"><div class="promo-stat-val" style="color:var(--primary)">${activeCount}</div><div class="promo-stat-lbl">Active Promos</div></div>
    <div class="promo-stat-card"><div class="promo-stat-val" style="color:var(--secondary)">${totalViews.toLocaleString()}</div><div class="promo-stat-lbl">Banner Views</div></div>
    <div class="promo-stat-card"><div class="promo-stat-val" style="color:var(--tertiary)">${totalClicks.toLocaleString()}</div><div class="promo-stat-lbl">Banner Clicks</div></div>
    <div class="promo-stat-card"><div class="promo-stat-val" style="color:#4edea3">${totalPurchases.toLocaleString()}</div><div class="promo-stat-lbl">Promo Purchases</div></div>
    <div class="promo-stat-card"><div class="promo-stat-val" style="color:#f97316">${totalViews ? Math.round(totalClicks / totalViews * 100) : 0}%</div><div class="promo-stat-lbl">Click-Through Rate</div></div>
    <div class="promo-stat-card"><div class="promo-stat-val" style="color:var(--error)">${totalClicks ? Math.round(totalPurchases / totalClicks * 100) : 0}%</div><div class="promo-stat-lbl">Conversion Rate</div></div>
  </div>

  ${mostClicked || mostPurchased ? `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:24px">
    ${mostClicked ? `<div class="glass-card" style="padding:14px"><div style="font-size:11px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">🏆 Most Clicked</div><div style="font-size:14px;font-weight:800;color:var(--on-surface)">${_esc(mostClicked.title)}</div><div style="font-size:12px;color:var(--tertiary);margin-top:4px">${maxClicks} clicks</div></div>` : ''}
    ${mostPurchased ? `<div class="glass-card" style="padding:14px"><div style="font-size:11px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">💰 Most Purchased</div><div style="font-size:14px;font-weight:800;color:var(--on-surface)">${_esc(mostPurchased.title)}</div><div style="font-size:12px;color:var(--secondary);margin-top:4px">${maxPurchases} purchases</div></div>` : ''}
  </div>` : ''}

  <div class="section-header"><span class="material-symbols-outlined">campaign</span><h2>All Promotions</h2><span class="badge-pill bp-primary">${promos.length}</span></div>

  ${!promos.length ? `
  <div style="text-align:center;padding:72px;background:rgba(35,31,56,0.7);border:1px solid var(--border);border-radius:16px">
    <div style="font-size:56px;margin-bottom:14px">📣</div>
    <div style="font-family:var(--fh);font-size:18px;font-weight:800;margin-bottom:6px">No promotions yet</div>
    <div style="color:var(--text-muted);font-size:13px;margin-bottom:20px">Create your first promotion to transform the store banner.</div>
    <button class="btn btn-primary" onclick="promoAdminOpenForm()">＋ Create First Promotion</button>
  </div>` :
  [...promos].sort((a, b) => (b.priority || 0) - (a.priority || 0)).map(p => {
    const cfg      = promoTypeConfig(p.type);
    const isLive   = promoIsActive(p);
    const a        = analytics[p.id] || { views: 0, clicks: 0, purchases: 0 };
    const item     = p.linkedItemId ? (DB.store || []).find(i => i.id === p.linkedItemId) : null;
    const ctr      = a.views  ? Math.round(a.clicks    / a.views  * 100) : 0;
    const conv     = a.clicks ? Math.round(a.purchases / a.clicks * 100) : 0;
    const tagLabel = p.adminLabel || (p.type === 'custom' && p.customTypeLabel ? p.customTypeLabel : cfg.tagLabel);
    const countdown = p.endDate ? promoCountdownStr(p.endDate) : null;
    return `<div class="promo-admin-card">
      <div class="promo-admin-header">
        <div class="promo-admin-preview" style="font-size:28px">${p.image || item?.emoji || '📣'}</div>
        <div class="promo-admin-info">
          <div class="promo-admin-title">${_esc(p.title)}</div>
          <div class="promo-admin-meta">
            <span class="promo-type-pill type-${p.type}" style="background:${cfg.btnColor}22;color:${cfg.btnColor};border:1px solid ${cfg.btnColor}44">${cfg.label}</span>
            <span class="badge-pill ${isLive ? 'bp-green' : 'bp-gray'}">${isLive ? '● LIVE' : '○ Inactive'}</span>
            ${p.priority > 0 ? `<span class="badge-pill bp-gold">Priority ${p.priority}</span>` : ''}
            ${item ? `<span class="badge-pill bp-primary">🔗 ${_esc(item.name)}</span>` : ''}
            ${countdown ? `<span style="font-size:11px;color:#fca5a5;font-weight:700">${countdown}</span>` : ''}
          </div>
          <div style="display:flex;gap:16px;margin-top:8px;font-size:11px;color:var(--text-muted)">
            <span>👁 ${a.views} views</span><span>👆 ${a.clicks} clicks</span>
            <span>🛒 ${a.purchases} purchases</span><span>CTR: ${ctr}%</span><span>Conv: ${conv}%</span>
          </div>
          ${p.startDate || p.endDate ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">${p.startDate ? 'From ' + new Date(p.startDate).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}${p.endDate ? ' → ' + new Date(p.endDate).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</div>` : ''}
        </div>
        <div class="promo-admin-actions">
          <button class="btn btn-ghost btn-xs"                        onclick="promoAdminPreview('${p.id}')" title="Preview">👁</button>
          <button class="btn btn-ghost btn-xs"                        onclick="promoAdminOpenForm('${p.id}')" title="Edit">✏️</button>
          <button class="btn ${isLive ? 'btn-success' : 'btn-ghost'} btn-xs" onclick="promoAdminToggle('${p.id}')" title="${isLive ? 'Disable' : 'Enable'}">${isLive ? '✓ Live' : '○ Off'}</button>
          <button class="btn btn-danger btn-xs"                       onclick="promoAdminDelete('${p.id}')" title="Delete">🗑</button>
        </div>
      </div>
    </div>`;
  }).join('')}`;
};

// ── Admin: Create/Edit form ───────────────────────────────────────────────────

window.promoAdminOpenForm = function (editId = null) {
  DB = loadDB();
  const p        = editId ? (DB.promotions || []).find(x => x.id === editId) : null;
  const isEdit   = !!p;
  const storeOpts = (DB.store || []).map(i => `<option value="${i.id}" ${p?.linkedItemId === i.id ? 'selected' : ''}>${i.emoji} ${_esc(i.name)} (${i.cost} coins)</option>`).join('');
  const typesHTML = PROMO_TYPES.map(t => `<option value="${t.value}" ${(p?.type || 'featured') === t.value ? 'selected' : ''}>${t.label}</option>`).join('');

  showModal(`
  <div class="modal-h2">${isEdit ? '✏️ Edit Promotion' : '📣 Create Promotion'}</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    <div class="form-group" style="grid-column:1/-1"><label class="form-label">Promotion Title *</label><input type="text" id="prf-title" value="${_esc(p?.title || '')}" placeholder="e.g. Mystery Box Flash Sale!" style="width:100%"></div>
    <div class="form-group" style="grid-column:1/-1"><label class="form-label">Subtitle / Description</label><input type="text" id="prf-sub" value="${_esc(p?.subtitle || '')}" placeholder="Short call-to-action text..." style="width:100%"></div>
    <div class="form-group"><label class="form-label">Promotion Type</label><select id="prf-type" style="width:100%" onchange="promoFormTypeChange()">${typesHTML}</select></div>
    <div class="form-group"><label class="form-label">Display Emoji / Image</label><input type="text" id="prf-image" value="${_esc(p?.image || '')}" placeholder="🎁 (emoji for banner)" style="width:100%"></div>
    <div class="form-group" style="grid-column:1/-1" id="prf-custom-label-wrap" style="display:${p?.type === 'custom' ? 'block' : 'none'}"><label class="form-label">Custom Tag Label</label><input type="text" id="prf-custom-label" value="${_esc(p?.customTypeLabel || '')}" placeholder="e.g. BUNDLE DEAL" style="width:100%"></div>
    <div class="form-group" style="grid-column:1/-1"><label class="form-label">Admin Override Label</label><input type="text" id="prf-admin-label" value="${_esc(p?.adminLabel || '')}" placeholder="Leave blank to use type default" style="width:100%"></div>
    <div class="form-group" style="grid-column:1/-1"><label class="form-label">Link to Store Item (optional)</label><select id="prf-item" style="width:100%"><option value="">— No linked item —</option>${storeOpts}</select></div>
    <div class="form-group"><label class="form-label">Start Date</label><input type="date" id="prf-start" value="${p?.startDate ? p.startDate.slice(0, 10) : ''}" style="width:100%"></div>
    <div class="form-group"><label class="form-label">End Date</label><input type="date" id="prf-end" value="${p?.endDate ? p.endDate.slice(0, 10) : ''}" style="width:100%"></div>
    <div class="form-group"><label class="form-label">Priority (higher = first)</label><input type="number" id="prf-priority" value="${p?.priority || 0}" min="0" max="100" style="width:100%"></div>
    <div class="form-group"><label class="form-label">Rotation Interval (seconds)</label><input type="number" id="prf-interval" value="${p?.rotationInterval || 6}" min="2" max="60" style="width:100%"></div>
    <div class="form-group" style="grid-column:1/-1;display:flex;align-items:center;gap:10px"><input type="checkbox" id="prf-active" ${p?.active !== false ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--primary-dark)"><label for="prf-active" style="font-size:13px;font-weight:600;color:var(--on-surface);cursor:pointer">Active (show in store)</label></div>
  </div>
  <div style="display:flex;gap:10px;margin-top:16px">
    <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
    ${isEdit ? `<button class="btn btn-ghost btn-sm" onclick="promoAdminSaveForm('${p.id}',true)" style="flex:0 0 auto">👁 Save & Preview</button>` : ''}
    <button class="btn btn-primary" style="flex:1" onclick="promoAdminSaveForm('${editId || ''}')">${isEdit ? '💾 Save Changes' : '📣 Create Promotion'}</button>
  </div>`, 'lg');
};

window.promoFormTypeChange = function () {
  const type = document.getElementById('prf-type')?.value;
  const wrap = document.getElementById('prf-custom-label-wrap');
  if (wrap) wrap.style.display = type === 'custom' ? 'block' : 'none';
};

window.promoAdminSaveForm = function (editId = '', andPreview = false) {
  const title = (document.getElementById('prf-title')?.value || '').trim();
  if (!title) { toast('❌ Title is required', '#ffb4ab'); return; }
  const now = new Date().toISOString();
  const obj = {
    id: editId || uid(), title,
    subtitle:         (document.getElementById('prf-sub')?.value          || '').trim(),
    type:              document.getElementById('prf-type')?.value          || 'featured',
    image:            (document.getElementById('prf-image')?.value         || '').trim(),
    adminLabel:       (document.getElementById('prf-admin-label')?.value  || '').trim(),
    customTypeLabel:  (document.getElementById('prf-custom-label')?.value || '').trim(),
    linkedItemId:      document.getElementById('prf-item')?.value          || '',
    startDate:         document.getElementById('prf-start')?.value         || '',
    endDate:           document.getElementById('prf-end')?.value           || '',
    priority:    parseInt(document.getElementById('prf-priority')?.value)  || 0,
    rotationInterval: parseInt(document.getElementById('prf-interval')?.value) || 6,
    active:            document.getElementById('prf-active')?.checked !== false,
    createdAt: editId ? (DB.promotions || []).find(p => p.id === editId)?.createdAt || now : now,
  };
  DB = loadDB();
  if (!DB.promotions) DB.promotions = [];
  if (editId) {
    const idx = DB.promotions.findIndex(p => p.id === editId);
    if (idx >= 0) DB.promotions[idx] = obj; else DB.promotions.push(obj);
    toast('✅ Promotion updated!');
  } else {
    DB.promotions.push(obj);
    toast('📣 Promotion created!');
  }
  saveDB();
  closeModalForce();
  renderAdminPromotions();
  if (andPreview) promoAdminPreview(obj.id);
};

window.promoAdminToggle = function (id) {
  DB = loadDB();
  const idx = (DB.promotions || []).findIndex(p => p.id === id);
  if (idx < 0) return;
  DB.promotions[idx].active = !DB.promotions[idx].active;
  saveDB();
  toast(DB.promotions[idx].active ? '✅ Promotion activated!' : '⏸ Promotion disabled.');
  renderAdminPromotions();
};

window.promoAdminDelete = function (id) {
  DB = loadDB();
  const p = (DB.promotions || []).find(x => x.id === id);
  if (!p) return;
  showModal(`<div style="text-align:center;padding:10px">
    <div style="font-size:40px;margin-bottom:12px">🗑️</div>
    <div class="modal-h2" style="text-align:center">Delete Promotion?</div>
    <div style="color:var(--text-muted);margin-bottom:20px;font-size:13px">Remove "${_esc(p.title)}"? Analytics data will also be removed.</div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-danger" style="flex:1" onclick="promoAdminConfirmDelete('${id}')">Delete</button>
    </div>
  </div>`, 'sm');
};

window.promoAdminConfirmDelete = function (id) {
  DB = loadDB();
  DB.promotions = (DB.promotions || []).filter(p => p.id !== id);
  if (DB.promoAnalytics) delete DB.promoAnalytics[id];
  saveDB();
  closeModalForce();
  toast('🗑 Promotion deleted.', '#ff8080');
  renderAdminPromotions();
};

window.promoAdminPreview = function (id) {
  DB = loadDB();
  const p = (DB.promotions || []).find(x => x.id === id);
  if (!p) return;
  const cfg       = promoTypeConfig(p.type);
  const item      = p.linkedItemId ? (DB.store || []).find(i => i.id === p.linkedItemId) : null;
  const emoji     = p.image || item?.emoji || '📣';
  const countdown = p.endDate ? promoCountdownStr(p.endDate) : null;
  const tagLabel  = p.adminLabel || (p.type === 'custom' && p.customTypeLabel ? p.customTypeLabel : cfg.tagLabel);
  const price     = item ? item.cost : null;
  const isLive    = promoIsActive(p);
  showModal(`<div>
    <div class="modal-h2">👁 Banner Preview — "${_esc(p.title)}"</div>
    <div class="promo-preview-wrap">
      <div class="promo-preview-banner promo-slide type-${p.type}" style="opacity:1;transform:none;position:relative;pointer-events:none">
        <div class="promo-slide-bg"></div>
        <div class="promo-slide-content" style="cursor:default">
          <div class="promo-slide-inner">
            ${countdown ? `<div class="promo-countdown">${countdown}</div>` : ''}
            <span class="promo-tag type-${p.type}">${tagLabel}</span>
            <div class="promo-title">${_esc(p.title)}</div>
            <div class="promo-sub">${_esc(p.subtitle || '')}</div>
            <div class="promo-cta">${price !== null ? `<div class="promo-price"><span class="material-symbols-outlined" style="font-size:16px;font-variation-settings:'FILL' 1">monetization_on</span>${price}</div>` : ''}<button class="promo-btn">${item ? 'Redeem' : 'View →'}</button></div>
          </div>
          <div class="promo-slide-emoji">${emoji}</div>
        </div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px;margin-bottom:16px">
      <div><span style="color:var(--text-muted)">Type:</span> <strong>${cfg.label}</strong></div>
      <div><span style="color:var(--text-muted)">Status:</span> <strong style="color:${isLive ? '#4edea3' : '#ffb4ab'}">${isLive ? '● Live' : '○ Inactive'}</strong></div>
      <div><span style="color:var(--text-muted)">Priority:</span> <strong>${p.priority || 0}</strong></div>
      <div><span style="color:var(--text-muted)">Rotation:</span> <strong>${p.rotationInterval || 6}s</strong></div>
      ${item ? `<div style="grid-column:1/-1"><span style="color:var(--text-muted)">Linked Item:</span> <strong>${item.emoji} ${_esc(item.name)} — 🪙${item.cost}</strong></div>` : ''}
      ${p.startDate || p.endDate ? `<div style="grid-column:1/-1"><span style="color:var(--text-muted)">Schedule:</span> <strong>${p.startDate || 'Now'} → ${p.endDate || 'No end'}</strong></div>` : ''}
    </div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Close</button>
      <button class="btn btn-primary" style="flex:1" onclick="closeModalForce();promoAdminOpenForm('${id}')">✏️ Edit</button>
    </div>
  </div>`, 'md');
};

window.promoAdminPreviewStore = function () {
  DB = loadDB();
  const active = promoGetActive();
  if (!active.length) { toast('No active promotions to preview yet.', '#ffb95f'); return; }
  const slidesHTML = active.map(p => promoBuildSlideHTML(p)).join('');
  showModal(`<div>
    <div class="modal-h2">🎠 Carousel Preview (${active.length} active promo${active.length !== 1 ? 's' : ''})</div>
    <div style="position:relative;overflow:hidden;border-radius:14px;height:180px;margin-bottom:16px;border:1px solid var(--border)">
      ${active[0] ? promoBuildSlideHTML(active[0]) : ''}
    </div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px;text-align:center">${active.length > 1 ? `Showing first of ${active.length} slides` : 'Single slide'} · Students see this in the Armory</div>
    <button class="btn btn-ghost btn-block" onclick="closeModalForce()">Close</button>
  </div>`, 'md');
};

console.log('[EduQuest] shop/promotions.js loaded — PROMO_TYPES, promo* helpers, carousel, renderAdminPromotions registered.');
