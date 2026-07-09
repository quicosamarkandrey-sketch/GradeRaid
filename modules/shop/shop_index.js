// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/shop/index.js
//  Load-order guard + window.* alias verification + shop CSS injection +
//  DB schema migration (ensures all shop tables exist in DB).
//
//  Required load order:
//    1. store.js        — student Armory + cart engine
//    2. inventory.js    — student Inventory + bootApp/setupSidebar patches
//    3. orders.js       — student Orders + bootApp patch
//    4. admin-store.js  — admin Manage Store + product CRUD
//    5. pos-terminal.js — teacher POS + renderAnalytics patch
//    6. promotions.js   — promo system + renderAdminPromotions
//    7. index.js        — this file (guard + CSS + migration)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Shop CSS injection ────────────────────────────────────────────────────────
;(function injectShopCSS() {
  if (document.getElementById('shop-module-css')) return;
  const style = document.createElement('style');
  style.id = 'shop-module-css';
  style.textContent = `
/* ── Store grid & cards ── */
.store-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:18px;margin-bottom:32px}
.store-card{
  position:relative;border-radius:18px;padding:22px 18px 16px;
  background:rgba(35,31,56,.85);border:1px solid var(--border);
  backdrop-filter:blur(12px);transition:all .3s;overflow:hidden;
  display:flex;flex-direction:column;
}
.store-card:hover:not(.out-of-stock){transform:translateY(-4px);box-shadow:0 14px 44px rgba(0,0,0,.5);border-color:rgba(208,188,255,.25)}
.store-card.out-of-stock{opacity:.6}
.store-emoji{font-size:44px;margin-bottom:10px;text-align:center;line-height:1;display:block;filter:drop-shadow(0 4px 12px rgba(0,0,0,.4))}
.store-rarity{text-align:center;margin-bottom:8px}
.store-name{font-family:var(--fh);font-size:15px;font-weight:900;color:var(--on-surface);text-align:center;margin-bottom:5px;line-height:1.2}
.store-desc{font-size:11px;color:var(--text-muted);text-align:center;line-height:1.5;margin-bottom:8px;flex:1}
.store-footer{display:flex;align-items:center;justify-content:space-between;margin-top:auto;gap:8px}
.store-price{display:flex;align-items:center;gap:4px;font-family:var(--fh);font-size:16px;font-weight:900;color:var(--tertiary)}
.store-price .material-symbols-outlined{font-size:18px;font-variation-settings:'FILL' 1;color:var(--tertiary)}
.store-redeem-btn{background:linear-gradient(135deg,var(--primary-dark),#7c3aed);color:#fff;border:none;border-radius:10px;padding:7px 12px;font-size:11px;font-weight:800;cursor:pointer;font-family:var(--fb);transition:all .2s;white-space:nowrap}
.store-redeem-btn:hover:not([disabled]){transform:scale(1.05);box-shadow:0 4px 16px rgba(139,92,246,.4)}
.store-redeem-btn[disabled]{background:rgba(255,255,255,.08);cursor:not-allowed}

/* ── Category tabs ── */
.cat-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px}
.cat-tab{padding:8px 18px;border-radius:30px;font-size:12px;font-weight:700;border:1px solid var(--border2);background:rgba(255,255,255,.04);color:var(--text-muted);cursor:pointer;transition:all .18s;font-family:var(--fb)}
.cat-tab:hover{border-color:rgba(208,188,255,.3);color:var(--on-surface)}
.cat-tab.active{background:rgba(139,92,246,.18);border-color:rgba(208,188,255,.4);color:var(--primary)}

/* ── Rarity pills ── */
.rarity-pill{font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;padding:2px 8px;border-radius:6px;display:inline-block}
.rarity-legendary{background:rgba(255,215,0,.16);color:#ffd700;border:1px solid rgba(255,215,0,.3)}
.rarity-epic{background:rgba(208,188,255,.14);color:#d0bcff;border:1px solid rgba(208,188,255,.3)}
.rarity-rare{background:rgba(144,180,255,.14);color:#93c5fd;border:1px solid rgba(144,180,255,.25)}
.rarity-common{background:rgba(203,195,215,.1);color:rgba(203,195,215,.7);border:1px solid rgba(203,195,215,.15)}

/* ── Cart FAB ── */
.cart-fab{
  position:fixed;bottom:28px;right:28px;z-index:900;
  background:linear-gradient(135deg,#8b5cf6,#EC4899);
  color:#fff;border:none;border-radius:30px;
  padding:14px 22px;font-size:14px;font-weight:800;
  cursor:pointer;font-family:var(--fh);
  box-shadow:0 8px 32px rgba(139,92,246,.5);
  display:flex;align-items:center;gap:10px;
  transition:all .25s;animation:fadeIn .25s ease;
}
.cart-fab:hover{transform:translateY(-3px);box-shadow:0 12px 40px rgba(139,92,246,.6)}
.cart-count{background:rgba(255,255,255,.2);border-radius:20px;padding:2px 9px;font-size:12px;font-weight:900}
.cart-item-row{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.cart-qty-ctrl{display:flex;align-items:center;gap:5px}
.cart-qty-btn{background:rgba(255,255,255,.08);border:1px solid var(--border2);border-radius:7px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:16px;cursor:pointer;color:var(--on-surface);font-weight:700;transition:all .15s}
.cart-qty-btn:hover{background:rgba(208,188,255,.15);border-color:rgba(208,188,255,.35)}

/* ── Store banner / promo carousel ── */
.store-banner,.promo-empty-banner{width:100%;height:168px;border-radius:18px;overflow:hidden;margin-bottom:24px;border:1px solid rgba(208,188,255,.15);box-shadow:0 8px 32px rgba(0,0,0,.3);position:relative;flex-shrink:0}
.promo-carousel{width:100%;height:100%;position:relative}
.promo-slide{position:absolute;inset:0;opacity:0;transition:opacity .5s ease;border-radius:inherit;overflow:hidden}
.promo-slide.active{opacity:1;z-index:1}
.promo-slide-bg{position:absolute;inset:0;pointer-events:none}
.promo-slide.type-new .promo-slide-bg{background:linear-gradient(135deg,#0f0a2e 0%,#1e1060 50%,#0a1a3e 100%)}
.promo-slide.type-hot .promo-slide-bg{background:linear-gradient(135deg,#1a0a00 0%,#3d1500 50%,#1a0800 100%)}
.promo-slide.type-sale .promo-slide-bg{background:linear-gradient(135deg,#1a0008 0%,#3d0020 50%,#0a0018 100%)}
.promo-slide.type-limited .promo-slide-bg{background:linear-gradient(135deg,#1a1000 0%,#3d2800 50%,#0a1200 100%)}
.promo-slide.type-featured .promo-slide-bg{background:linear-gradient(135deg,#001a10 0%,#003d28 50%,#001a0a 100%)}
.promo-slide.type-event .promo-slide-bg{background:linear-gradient(135deg,#1a0020 0%,#3d0060 50%,#0a0830 100%)}
.promo-slide.type-seasonal .promo-slide-bg{background:linear-gradient(135deg,#0a1a00 0%,#1e3d00 50%,#001a0a 100%)}
.promo-slide.type-custom .promo-slide-bg{background:linear-gradient(135deg,#0a0a1a 0%,#1a1a3d 50%,#0a0a28 100%)}
.promo-slide-content{position:relative;z-index:2;display:flex;align-items:center;height:100%;padding:20px 28px;cursor:pointer}
.promo-slide-inner{flex:1;min-width:0}
.promo-slide-emoji{font-size:72px;line-height:1;flex-shrink:0;margin-left:20px;filter:drop-shadow(0 4px 20px rgba(255,255,255,.15))}
.promo-countdown{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.6);margin-bottom:5px;background:rgba(255,255,255,.08);display:inline-block;padding:3px 10px;border-radius:6px}
.promo-countdown.urgent{color:#fca5a5;background:rgba(239,68,68,.15);animation:pulse 1s infinite}
.promo-tag{font-size:9px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;padding:3px 10px;border-radius:6px;display:inline-block;margin-bottom:8px}
.promo-tag.type-new{background:rgba(139,92,246,.2);color:#d0bcff;border:1px solid rgba(139,92,246,.4)}
.promo-tag.type-hot{background:rgba(249,115,22,.2);color:#fdba74;border:1px solid rgba(249,115,22,.4)}
.promo-tag.type-sale{background:rgba(239,68,68,.2);color:#fca5a5;border:1px solid rgba(239,68,68,.4)}
.promo-tag.type-limited{background:rgba(255,185,95,.2);color:#ffb95f;border:1px solid rgba(255,185,95,.4)}
.promo-tag.type-featured{background:rgba(78,222,163,.18);color:#4edea3;border:1px solid rgba(78,222,163,.38)}
.promo-tag.type-event{background:rgba(236,72,153,.2);color:#f9a8d4;border:1px solid rgba(236,72,153,.4)}
.promo-tag.type-seasonal{background:rgba(139,92,246,.18);color:#c4b5fd;border:1px solid rgba(139,92,246,.4)}
.promo-tag.type-custom{background:rgba(96,165,250,.15);color:#93c5fd;border:1px solid rgba(96,165,250,.35)}
.promo-title{font-family:var(--fh);font-size:20px;font-weight:900;color:#fff;line-height:1.2;margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.promo-sub{font-size:12px;color:rgba(255,255,255,.65);line-height:1.4;margin-bottom:10px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.promo-cta{display:flex;align-items:center;gap:10px}
.promo-price{display:flex;align-items:center;gap:4px;font-family:var(--fh);font-size:16px;font-weight:900;color:#ffd700}
.promo-btn{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:8px;padding:6px 14px;font-size:11px;font-weight:800;cursor:pointer;font-family:var(--fb);transition:all .2s;backdrop-filter:blur(8px)}
.promo-btn:hover{background:rgba(255,255,255,.22);transform:scale(1.04)}
.promo-carousel-controls{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:6px;z-index:10}
.promo-nav-btn{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);color:#fff;border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:all .15s;backdrop-filter:blur(4px)}
.promo-nav-btn:hover{background:rgba(255,255,255,.2)}
.promo-dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.3);cursor:pointer;transition:all .25s}
.promo-dot.active{background:#fff;width:18px;border-radius:4px}
.store-banner-inner{max-width:500px}
.store-banner-tag{font-size:9px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;color:#4edea3;display:block;margin-bottom:6px}
.store-banner-title{font-family:var(--fh);font-size:22px;font-weight:900;color:#fff;margin-bottom:5px}
.store-banner-sub{font-size:12px;color:rgba(255,255,255,.65);margin-bottom:10px;line-height:1.4}
.store-banner-cta{display:flex;align-items:center;gap:10px}
.store-banner-price{display:flex;align-items:center;gap:4px;font-family:var(--fh);font-size:16px;font-weight:900;color:#ffd700}
.store-banner-btn{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:8px;padding:6px 16px;font-size:11px;font-weight:800;cursor:pointer;font-family:var(--fb)}

/* ── Inventory ── */
.inv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px;margin-bottom:24px}
.inv-card{position:relative;border-radius:16px;padding:18px;background:rgba(35,31,56,.85);border:1px solid var(--border);backdrop-filter:blur(12px);transition:all .3s;display:flex;flex-direction:column;align-items:center}
.inv-card:hover{transform:translateY(-3px);box-shadow:0 10px 36px rgba(0,0,0,.45);border-color:rgba(208,188,255,.2)}
.inv-card-used{opacity:.6}
.inv-card-top{position:absolute;top:10px;left:10px;right:10px;display:flex;justify-content:space-between;align-items:center}
.inv-qty-badge{background:rgba(139,92,246,.18);border:1px solid rgba(208,188,255,.25);border-radius:8px;padding:2px 8px;font-size:10px;font-weight:900;color:var(--primary);font-family:var(--fh)}
.inv-qty-multi{background:rgba(78,222,163,.15);border-color:rgba(78,222,163,.3);color:var(--secondary)}
.inv-pending-dot{width:10px;height:10px;border-radius:50%;background:var(--tertiary);box-shadow:0 0 8px rgba(255,185,95,.6);animation:pulse 1.5s infinite}
.inv-used-badge{font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#ffb4ab;background:rgba(255,180,171,.1);border:1px solid rgba(255,180,171,.25);border-radius:6px;padding:2px 7px}
.inv-emoji{font-size:44px;line-height:1;margin:24px 0 8px;filter:drop-shadow(0 4px 12px rgba(0,0,0,.4))}
.inv-rarity{margin-bottom:8px}
.inv-name{font-family:var(--fh);font-size:13px;font-weight:900;color:var(--on-surface);text-align:center;margin-bottom:5px;line-height:1.2}
.inv-cat-pill{font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;border:1px solid;margin-bottom:6px}
.inv-date,.inv-source{display:flex;align-items:center;gap:4px;font-size:10px;color:var(--text-muted);margin-bottom:3px}
.inv-code-btn{display:flex;align-items:center;justify-content:center;gap:5px;width:100%;padding:7px;margin:8px 0 4px;background:rgba(78,222,163,.08);border:1px solid rgba(78,222,163,.22);border-radius:9px;color:var(--secondary);font-size:11px;font-weight:700;cursor:pointer;font-family:var(--fb);transition:all .18s}
.inv-code-btn:hover{background:rgba(78,222,163,.15);border-color:rgba(78,222,163,.4)}
.inv-card-actions{display:flex;gap:6px;margin-top:auto;padding-top:10px;width:100%}
.inv-use-btn{flex:1;padding:7px 10px;background:linear-gradient(135deg,var(--primary-dark),#7c3aed);color:#fff;border:none;border-radius:9px;font-size:11px;font-weight:800;cursor:pointer;font-family:var(--fb);transition:all .18s}
.inv-use-btn:hover{transform:scale(1.04)}
.inv-detail-btn{flex:1;padding:7px 10px;background:rgba(255,255,255,.06);border:1px solid var(--border2);color:var(--text-muted);border-radius:9px;font-size:11px;font-weight:700;cursor:pointer;font-family:var(--fb);transition:all .18s}
.inv-detail-btn:hover{background:rgba(255,255,255,.1);color:var(--on-surface)}
.inv-empty{text-align:center;padding:80px 20px;background:rgba(35,31,56,.7);border:1px dashed var(--border);border-radius:16px}
.inv-toolbar{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;align-items:flex-start}
.inv-search-wrap{flex:1;min-width:200px;display:flex;align-items:center;gap:8px;background:rgba(35,31,56,.9);border:1px solid var(--border2);border-radius:12px;padding:9px 14px}
.inv-filter-row{display:flex;gap:8px;flex-wrap:wrap}
.inv-hist-list{display:flex;flex-direction:column;gap:8px}
.inv-hist-row{display:flex;align-items:center;gap:12px;padding:12px 14px;background:rgba(35,31,56,.75);border:1px solid var(--border);border-radius:12px;transition:all .2s}
.inv-hist-row:hover{border-color:rgba(208,188,255,.2)}
.inv-hist-emoji{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;background:rgba(255,255,255,.04);border:1px solid var(--border);flex-shrink:0}
.inv-hist-info{flex:1;min-width:0}
.inv-hist-name{font-family:var(--fh);font-size:13px;font-weight:800;color:var(--on-surface);margin-bottom:3px}
.inv-hist-meta{font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.inv-hist-cost{display:flex;align-items:center;gap:4px;flex-shrink:0}
.inv-tab-row{display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:24px}
.inv-tab{display:flex;align-items:center;gap:7px;padding:11px 20px;font-size:13px;font-weight:700;color:var(--text-muted);background:none;border:none;cursor:pointer;border-bottom:2px solid transparent;transition:all .2s;font-family:var(--fb)}
.inv-tab:hover{color:var(--on-surface)}
.inv-tab.active{color:var(--primary);border-bottom-color:var(--primary-dark)}
.inv-tab .material-symbols-outlined{font-size:16px}

/* ── Promotions admin ── */
.promo-analytics-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.promo-stat-card{background:rgba(35,31,56,.85);border:1px solid var(--border);border-radius:12px;padding:16px;text-align:center}
.promo-stat-val{font-family:var(--fh);font-size:24px;font-weight:900;line-height:1;margin-bottom:4px}
.promo-stat-lbl{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);font-weight:700}
.promo-admin-card{background:rgba(35,31,56,.85);border:1px solid var(--border);border-radius:14px;margin-bottom:10px;overflow:hidden;transition:all .2s}
.promo-admin-card:hover{border-color:rgba(208,188,255,.25)}
.promo-admin-header{display:flex;align-items:flex-start;gap:14px;padding:16px}
.promo-admin-preview{width:56px;height:56px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.promo-admin-info{flex:1;min-width:0}
.promo-admin-title{font-family:var(--fh);font-size:14px;font-weight:800;color:var(--on-surface);margin-bottom:6px}
.promo-admin-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.promo-admin-actions{display:flex;gap:5px;flex-shrink:0;flex-wrap:wrap}
.promo-type-pill{font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px}
.promo-preview-wrap{border-radius:12px;overflow:hidden;height:168px;margin-bottom:16px;position:relative;border:1px solid var(--border)}
.promo-preview-banner{position:absolute;inset:0}

/* ── Stock edit ── */
.stock-cell{display:flex;align-items:center;justify-content:flex-end}
.stock-val{cursor:pointer;font-family:var(--fh);font-weight:800;padding:4px 10px;border-radius:8px;border:1px solid transparent;transition:all .15s}
.stock-val:hover{background:rgba(208,188,255,.1);border-color:rgba(208,188,255,.25)}
.stock-edit-wrap{display:flex;align-items:center;gap:6px}
.stock-edit-input{width:64px;background:rgba(35,31,56,.9);border:1px solid rgba(208,188,255,.4);border-radius:8px;padding:5px 10px;font-family:var(--fh);font-weight:800;font-size:14px;color:var(--on-surface);text-align:center;outline:none}
.stock-edit-input:focus{border-color:rgba(208,188,255,.7);box-shadow:0 0 0 3px rgba(208,188,255,.1)}
.stock-save-btn{background:rgba(78,222,163,.15);border:1px solid rgba(78,222,163,.35);border-radius:8px;color:var(--secondary);padding:5px 10px;cursor:pointer;font-weight:800;font-size:14px;transition:all .15s}
.stock-save-btn:hover{background:rgba(78,222,163,.25)}
`;
  document.head.appendChild(style);
})();

// ── DB migration guard ────────────────────────────────────────────────────────
// Ensures all shop-related tables exist; runs once AppStore is hydrated.
// [SUPABASE MIGRATION] Deferred until AppStore.ready resolves — see the
// matching note in modules/shop/shop_pos_terminal.js for why this can no
// longer run synchronously at parse time.
AppStore.ready.then(function shopMigrateDB() {
  DB = loadDB();
  let dirty = false;
  if (!DB.store)          { DB.store          = []; dirty = true; }
  if (!DB.orders)         { DB.orders         = []; dirty = true; }
  if (!DB.redemptions)    { DB.redemptions    = []; dirty = true; }
  if (!DB.inventory)      { DB.inventory      = {}; dirty = true; }
  if (!DB.promotions)     { DB.promotions     = []; dirty = true; }
  if (!DB.promoAnalytics) { DB.promoAnalytics = {}; dirty = true; }
  if (dirty) saveDB();
});

// ── Load-order verification ───────────────────────────────────────────────────
;(function shopVerifyExports() {
  const EXPECTED = [
    // store.js
    'getItemRarity', 'renderStudentStore',
    'cartAdd', 'cartRemove', 'cartSetQty', 'cartClear', 'cartOpenModal', 'cartCheckout',
    'posGenCode', 'posShowClaimCode',
    'buyItem', 'confirmBuy',
    // inventory.js
    'INV_CAT_LABELS', 'INV_CAT_ICONS', 'INV_CAT_COLORS',
    'renderInventory', 'invSwitchTab', 'invFilter', 'invHistFilter',
    'invUseItem', 'invConfirmUse', 'invViewDetail', 'invShowCodes',
    'invUpdateSidebarBadge',
    // orders.js
    'ordStatusPill', 'ordLabel',
    'renderStudentOrders', 'ordSwitchTab',
    'ordCancelPrompt', 'ordExecuteCancel', 'ordUpdateSidebarBadge',
    // admin-store.js
    'renderAdminStore', 'renderProductRows',
    'stockStartEdit', 'stockSave',
    'openAddProduct', 'openEditProduct', 'doAddProduct', 'doEditProduct',
    'deleteProduct', 'confirmDeleteProduct',
    // pos-terminal.js
    'renderPOS', 'posSwitchTab',
    'posLookupCode', 'posConfirmClaim', 'posExecuteClaim',
    'posCancelOrderPrompt', 'posExecuteCancel',
    'posFilterQueue', 'posFilterHistory',
    // promotions.js
    'PROMO_TYPES', 'promoTypeConfig', 'promoIsActive', 'promoGetActive',
    'promoRecordView', 'promoRecordClick', 'promoRecordPurchase',
    'promoGetAutoLabel', 'promoCountdownStr',
    'promoRenderCarousel', 'promoNav', 'promoGoTo',
    'promoClickBanner', 'promoGetCardBadge', 'promoBuildSlideHTML',
    'promoStartCountdownTick',
    'renderAdminPromotions', 'promoAdminOpenForm', 'promoAdminSaveForm',
    'promoAdminToggle', 'promoAdminDelete', 'promoAdminConfirmDelete',
    'promoAdminPreview', 'promoAdminPreviewStore', 'promoFormTypeChange',
  ];

  const missing = EXPECTED.filter(name => typeof window[name] !== 'function' && typeof window[name] !== 'object');
  if (missing.length) {
    console.error('[EduQuest] shop/index.js — MISSING exports:', missing);
  } else {
    console.log('[EduQuest] shop/index.js — All exports verified ✅');
  }

  window.__SHOP_MODULE_VERSION__ = '1.0.0';
})();
