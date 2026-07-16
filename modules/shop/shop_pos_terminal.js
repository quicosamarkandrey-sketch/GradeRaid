// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/shop/pos-terminal.js
//  Teacher Reward POS system: claim code scanner, pending queue,
//  redemption history, analytics, cancel/claim flows.
//  Also owns the renderAnalytics patch (injects POS summary at top).
//
//  CSS injected on load (id='pos-terminal-css', idempotent).
// ═══════════════════════════════════════════════════════════════════════════════

// ── CSS injection ─────────────────────────────────────────────────────────────
;(function injectPosCSS() {
  if (document.getElementById('pos-terminal-css')) return;
  const style = document.createElement('style');
  style.id = 'pos-terminal-css';
  style.textContent = `
.ord-status-pending{background:rgba(255,185,95,.14);color:#ffb95f;border:1px solid rgba(255,185,95,.3)}
.ord-status-ready{background:rgba(78,222,163,.12);color:#4edea3;border:1px solid rgba(78,222,163,.28)}
.ord-status-claimed{background:rgba(208,188,255,.12);color:#d0bcff;border:1px solid rgba(208,188,255,.25)}
.ord-status-cancelled{background:rgba(255,180,171,.1);color:#ffb4ab;border:1px solid rgba(255,180,171,.22)}
.ord-row{display:flex;align-items:center;gap:14px;padding:14px 16px;background:rgba(35,31,56,.8);border:1px solid var(--border);border-radius:14px;transition:all .2s;margin-bottom:8px}
.ord-row:hover{border-color:rgba(208,188,255,.25);background:rgba(35,31,56,.95)}
.ord-emoji{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;background:rgba(255,255,255,.04);border:1px solid var(--border)}
.ord-info{flex:1;min-width:0}
.ord-name{font-family:var(--fh);font-size:14px;font-weight:800;color:var(--on-surface);margin-bottom:3px}
.ord-meta{font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ord-code{font-family:var(--fm);font-size:13px;font-weight:900;color:var(--secondary);letter-spacing:.12em;margin-top:5px}
.ord-actions{display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;align-items:center}
.pos-terminal{background:rgba(26,20,56,.95);border:1px solid rgba(78,222,163,.2);border-radius:20px;padding:24px;margin-bottom:20px}
.pos-search-bar{display:flex;gap:10px;margin-bottom:20px}
.pos-search-input{flex:1;background:rgba(35,31,56,.9);border:2px solid rgba(78,222,163,.3);border-radius:12px;padding:12px 16px;color:var(--text);font-family:var(--fm);font-size:18px;font-weight:900;letter-spacing:.18em;outline:none;text-transform:uppercase;transition:border-color .2s}
.pos-search-input:focus{border-color:rgba(78,222,163,.7);box-shadow:0 0 0 4px rgba(78,222,163,.1)}
.pos-search-input::placeholder{font-size:13px;letter-spacing:.04em;text-transform:none;font-family:var(--fb);font-weight:400;color:var(--text-muted)}
.pos-result-card{background:rgba(35,31,56,.9);border:2px solid rgba(78,222,163,.35);border-radius:16px;padding:20px;animation:fadeIn .25s ease}
.pos-result-found{border-color:rgba(78,222,163,.5);box-shadow:0 0 24px rgba(78,222,163,.12)}
.pos-result-error{border-color:rgba(255,180,171,.4);box-shadow:0 0 24px rgba(255,180,171,.1)}
.pos-result-claimed{border-color:rgba(208,188,255,.35);box-shadow:0 0 16px rgba(208,188,255,.1)}
.pos-order-main{display:flex;align-items:center;gap:16px;margin-bottom:16px}
.pos-order-emoji{font-size:48px;line-height:1;flex-shrink:0}
.pos-student-chip{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;background:rgba(255,255,255,.05);border:1px solid var(--border2);border-radius:10px;font-family:var(--fh);font-size:13px;font-weight:700;color:var(--on-surface)}
.pos-av{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;flex-shrink:0}
.pos-stat-card{background:rgba(35,31,56,.8);border:1px solid var(--border);border-radius:14px;padding:18px;text-align:center}
.pos-stat-val{font-family:var(--fh);font-size:26px;font-weight:900;margin-bottom:4px;line-height:1}
.pos-stat-lbl{font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.pos-queue-row{display:grid;grid-template-columns:auto 1fr auto auto auto;gap:12px;align-items:center;padding:12px 14px;background:rgba(35,31,56,.75);border:1px solid var(--border);border-radius:12px;margin-bottom:7px;transition:all .2s}
.pos-queue-row:hover{border-color:rgba(78,222,163,.25);background:rgba(35,31,56,.95)}
.pos-tab{display:flex;align-items:center;gap:8px;padding:10px 18px;font-size:12px;font-weight:700;letter-spacing:.04em;color:var(--text-muted);background:none;border:none;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap;transition:all .2s;font-family:var(--fb)}
.pos-tab:hover{color:var(--on-surface)}
.pos-tab.active{color:var(--secondary);border-bottom-color:var(--secondary-dark)}
.sord-tab{display:flex;align-items:center;gap:8px;padding:11px 20px;font-size:13px;font-weight:700;letter-spacing:.04em;color:var(--text-muted);background:none;border:none;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap;transition:all .2s;font-family:var(--fb)}
.sord-tab:hover{color:var(--on-surface)}
.sord-tab.active{color:var(--primary);border-bottom-color:var(--primary-dark)}
.item-rank-chip{display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(35,31,56,.8);border:1px solid var(--border);border-radius:12px;margin-bottom:7px;transition:all .2s}
.item-rank-chip:hover{border-color:rgba(208,188,255,.25)}
.item-rank-num{font-family:var(--fm);font-size:11px;font-weight:900;color:var(--text-muted);width:20px;text-align:right;flex-shrink:0}
.aord-filter-row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;align-items:center}
.pos-pay-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;max-height:520px;overflow-y:auto;padding-right:4px}
.pos-pay-tile{background:rgba(35,31,56,.85);border:1px solid var(--border);border-radius:14px;padding:12px 10px;text-align:center;cursor:pointer;transition:all .15s;position:relative}
.pos-pay-tile:hover{border-color:rgba(78,222,163,.35);transform:translateY(-2px)}
.pos-pay-tile.out{opacity:.4;cursor:not-allowed;pointer-events:none}
.pos-pay-tile-emoji{font-size:26px;margin-bottom:6px}
.pos-pay-tile-name{font-family:var(--fh);font-size:11px;font-weight:800;color:var(--on-surface);line-height:1.25;margin-bottom:4px;min-height:28px;display:flex;align-items:center;justify-content:center}
.pos-pay-tile-cost{font-family:var(--fh);font-size:13px;font-weight:900;color:var(--tertiary)}
.pos-pay-tile-stock{font-size:9px;color:var(--text-muted);margin-top:2px}
.pos-pay-cart-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.pos-pay-waiting{text-align:center;padding:20px 10px;background:rgba(78,222,163,.06);border:1px solid rgba(78,222,163,.22);border-radius:14px}
.pos-pay-waiting-pulse{font-size:38px;animation:posPayPulse 1.3s ease-in-out infinite}
@keyframes posPayPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.15);opacity:.7}}
.pos-pay-identified{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:12px;padding:10px 12px;margin-bottom:4px}
.pos-pay-declined{background:rgba(255,180,171,.06);border:1px solid rgba(255,180,171,.25);border-radius:14px;padding:16px}
.pos-pay-declined-row{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:var(--on-surface)}
.pos-pay-success{background:rgba(78,222,163,.07);border:1px solid rgba(78,222,163,.25);border-radius:14px;padding:18px;text-align:center}
.pos-pay-manual-row{display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(35,31,56,.85);border:1px solid var(--border);border-radius:10px;margin-bottom:6px;cursor:pointer;transition:all .15s}
.pos-pay-manual-row:hover{border-color:rgba(78,222,163,.3);background:rgba(35,31,56,1)}
`;
  document.head.appendChild(style);
})();

// ── DB migration guard ────────────────────────────────────────────────────────
// [SUPABASE MIGRATION] Deferred until AppStore.ready resolves — this used to
// run synchronously at parse time, which relied on loadDB() always being
// instantly available. That's no longer guaranteed during the brief window
// before DBService.initRemote() finishes hydrating from Supabase.
AppStore.ready.then(function () {
  if (!DB.orders) { DB.orders = []; saveDB(); }
});

// ── Main renderer ─────────────────────────────────────────────────────────────

/**
 * renderPOS() → void  [window.renderPOS]
 * Renders full "Reward POS" admin page into #a-pos.
 * Tabs: Claim Code Scanner | Pending Queue | Redemption Log | Analytics.
 * After render: posFilterQueue(), posFilterHistory(), auto-focuses #pos-code-input.
 */
window.renderPOS = function () {
  DB = loadDB();
  _posPayCart = {};
  _posPayManualStudentId = null;
  if (typeof window.unmountPosPayCapture === 'function') window.unmountPosPayCapture();
  const orders    = DB.orders || [];
  const pending   = orders.filter(o => o.status === 'pending');
  const claimed   = orders.filter(o => o.status === 'claimed');
  const cancelled = orders.filter(o => o.status === 'cancelled');

  document.getElementById('a-pos').innerHTML = `
  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
    <div>
      <div style="font-family:var(--fm);font-size:10px;color:var(--secondary);letter-spacing:.16em;margin-bottom:6px">TEACHER // REWARD_POS</div>
      <div style="font-family:var(--fh);font-size:26px;font-weight:900;color:var(--on-surface)">🏪 Reward POS</div>
      <div style="color:var(--text-muted);font-size:13px;margin-top:4px">Verify and distribute physical classroom rewards</div>
    </div>
    <div style="display:flex;gap:10px">
      <div class="pos-stat-card" style="min-width:90px"><div class="pos-stat-val" style="color:var(--tertiary)">${pending.length}</div><div class="pos-stat-lbl">Pending</div></div>
      <div class="pos-stat-card" style="min-width:90px"><div class="pos-stat-val" style="color:var(--secondary)">${claimed.length}</div><div class="pos-stat-lbl">Claimed</div></div>
      <div class="pos-stat-card" style="min-width:90px"><div class="pos-stat-val" style="color:var(--primary)">${orders.length}</div><div class="pos-stat-lbl">Total</div></div>
    </div>
  </div>

  <div style="display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:24px">
    <button class="pos-tab active" id="postab-scanner"   onclick="posSwitchTab('scanner')"><span class="material-symbols-outlined" style="font-size:16px">qr_code_scanner</span> Claim Code Scanner</button>
    <button class="pos-tab"        id="postab-pay"       onclick="posSwitchTab('pay')"><span class="material-symbols-outlined" style="font-size:16px">contactless</span> Scan &amp; Pay</button>
    <button class="pos-tab"        id="postab-queue"     onclick="posSwitchTab('queue')"><span class="material-symbols-outlined" style="font-size:16px">pending_actions</span> Pending Queue ${pending.length > 0 ? `<span style="background:rgba(255,185,95,.2);border:1px solid rgba(255,185,95,.3);border-radius:10px;padding:1px 7px;font-size:10px;font-weight:900;color:var(--tertiary);font-family:var(--fh)">${pending.length}</span>` : ''}</button>
    <button class="pos-tab"        id="postab-history"   onclick="posSwitchTab('history')"><span class="material-symbols-outlined" style="font-size:16px">history</span> Redemption Log</button>
    <button class="pos-tab"        id="postab-analytics" onclick="posSwitchTab('analytics')"><span class="material-symbols-outlined" style="font-size:16px">bar_chart</span> Analytics</button>
  </div>

  <div id="pos-panel-scanner">
    <div class="pos-terminal">
      <div style="font-family:var(--fm);font-size:9px;color:var(--secondary);letter-spacing:.18em;text-transform:uppercase;margin-bottom:14px;display:flex;align-items:center;gap:8px">
        <span style="width:8px;height:8px;border-radius:50%;background:var(--secondary);display:inline-block;box-shadow:0 0 8px rgba(78,222,163,.7);animation:wbLiveDot 1.5s ease-in-out infinite"></span>
        POS TERMINAL — ENTER CLAIM CODE
      </div>
      <div class="pos-search-bar">
        <input type="text" id="pos-code-input" class="pos-search-input" placeholder="Enter claim code (e.g. ABC-123-XYZ)"
          maxlength="13"
          oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9-]/g,'')"
          onkeydown="if(event.key==='Enter')posLookupCode()"
          autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false">
        <button class="btn btn-success" style="padding:12px 20px;font-size:14px" onclick="posLookupCode()">
          <span class="material-symbols-outlined" style="font-size:18px">search</span> Lookup
        </button>
      </div>
      <div id="pos-lookup-result"></div>
    </div>
    <div style="font-size:11px;color:var(--text-muted);text-align:center;margin-top:-12px;margin-bottom:12px">
      Press <kbd style="background:rgba(255,255,255,.08);border:1px solid var(--border2);border-radius:4px;padding:1px 5px;font-family:var(--fm);font-size:10px">Enter</kbd> to lookup · Format: <span style="font-family:var(--fm);color:var(--secondary)">XXX-NNN-XXX</span>
    </div>
  </div>

  <div id="pos-panel-pay" style="display:none">
    <input type="text" id="pos-pay-capture-input" autocomplete="off" inputmode="none"
      style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px"
      oninput="_posPayOnCaptureInput()"
      onkeydown="if(event.key==='Enter'){event.preventDefault();_posPayFinalizeCapture();}">
    <div style="display:grid;grid-template-columns:1.3fr .9fr;gap:20px;align-items:start" id="pos-pay-layout">
      <div class="pos-terminal" style="margin-bottom:0">
        <div style="font-family:var(--fm);font-size:9px;color:var(--secondary);letter-spacing:.18em;text-transform:uppercase;margin-bottom:14px">🏪 RING UP SALE — TAP ITEMS TO ADD</div>
        <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
          <input type="text" id="pos-pay-search" placeholder="Search items…" oninput="_posPayRenderGrid()"
            style="flex:1;min-width:160px;background:rgba(35,31,56,.9);border:1px solid var(--border2);border-radius:10px;padding:9px 12px;font-size:12px;color:var(--text);outline:none">
          <select id="pos-pay-cat" onchange="_posPayRenderGrid()" style="background:rgba(35,31,56,.9);border:1px solid var(--border2);border-radius:10px;padding:9px 10px;font-size:12px;color:var(--text);cursor:pointer">
            <option value="all">All Categories</option>
            <option value="food">🍔 Food</option><option value="supplies">📦 Supplies</option>
            <option value="privilege">⭐ Privilege</option><option value="mystery">❓ Mystery</option>
          </select>
        </div>
        <div id="pos-pay-grid" class="pos-pay-grid"></div>
      </div>
      <div class="pos-terminal" style="margin-bottom:0">
        <div id="pos-pay-cart-box"></div>
      </div>
    </div>
  </div>

  <div id="pos-panel-queue" style="display:none">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="section-header" style="margin-bottom:0">
          <span class="material-symbols-outlined" style="color:var(--tertiary)">pending_actions</span>
          <h2>Pending Orders</h2>
          <span class="badge-pill bp-gold">${pending.length} orders</span>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="text" id="pos-queue-search" placeholder="Filter by student or item…" oninput="posFilterQueue()"
          style="background:rgba(35,31,56,.9);border:1px solid var(--border2);border-radius:10px;padding:8px 14px;font-size:12px;color:var(--text);font-family:var(--fb);outline:none;min-width:220px">
        <select id="pos-queue-cat" onchange="posFilterQueue()" style="background:rgba(35,31,56,.9);border:1px solid var(--border2);border-radius:10px;padding:8px 12px;font-size:12px;font-family:var(--fb);color:var(--text);cursor:pointer">
          <option value="all">All Categories</option>
          <option value="food">🍔 Food</option><option value="supplies">📦 Supplies</option>
          <option value="privilege">⭐ Privilege</option><option value="mystery">❓ Mystery</option>
        </select>
        <button class="btn btn-ghost btn-sm" onclick="renderPOS();posSwitchTab('queue')">
          <span class="material-symbols-outlined" style="font-size:14px">refresh</span>
        </button>
      </div>
    </div>
    <div id="pos-queue-list"></div>
  </div>

  <div id="pos-panel-history" style="display:none">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div class="section-header" style="margin-bottom:0">
        <span class="material-symbols-outlined" style="color:var(--secondary)">receipt_long</span>
        <h2>Redemption History</h2>
        <span class="badge-pill bp-green">${claimed.length} claimed</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="text" id="pos-hist-search" placeholder="Filter by student or item…" oninput="posFilterHistory()"
          style="background:rgba(35,31,56,.9);border:1px solid var(--border2);border-radius:10px;padding:8px 14px;font-size:12px;color:var(--text);font-family:var(--fb);outline:none;min-width:220px">
        <select id="pos-hist-filter" onchange="posFilterHistory()" style="background:rgba(35,31,56,.9);border:1px solid var(--border2);border-radius:10px;padding:8px 12px;font-size:12px;font-family:var(--fb);color:var(--text);cursor:pointer">
          <option value="claimed">Claimed</option><option value="cancelled">Cancelled</option><option value="all">All Completed</option>
        </select>
      </div>
    </div>
    <div id="pos-hist-list"></div>
  </div>

  <div id="pos-panel-analytics" style="display:none">${_posAnalyticsHTML()}</div>`;

  posFilterQueue();
  posFilterHistory();
  setTimeout(() => document.getElementById('pos-code-input')?.focus(), 120);
};

window.posSwitchTab = function (tab) {
  ['scanner', 'pay', 'queue', 'history', 'analytics'].forEach(t => {
    const btn   = document.getElementById('postab-' + t);
    const panel = document.getElementById('pos-panel-' + t);
    if (btn)   btn.classList.toggle('active', t === tab);
    if (panel) panel.style.display = t === tab ? 'block' : 'none';
  });
  // Leaving the Scan & Pay tab always disarms the card reader capture —
  // a lingering armed scanner listening in the background while the
  // teacher is on another tab would let a stray card tap silently charge
  // whatever sale was last in the cart.
  if (tab !== 'pay' && typeof window.unmountPosPayCapture === 'function') window.unmountPosPayCapture();
  if (tab === 'pay')       _posPayRenderPanel();
  if (tab === 'queue')     posFilterQueue();
  if (tab === 'history')   posFilterHistory();
  if (tab === 'analytics') { const ap = document.getElementById('pos-panel-analytics'); if (ap) ap.innerHTML = _posAnalyticsHTML(); }
  if (tab === 'scanner')   setTimeout(() => document.getElementById('pos-code-input')?.focus(), 80);
};

// ── Claim code lookup ─────────────────────────────────────────────────────────

window.posLookupCode = function () {
  DB = loadDB();
  const raw    = (document.getElementById('pos-code-input')?.value || '').trim().toUpperCase();
  const result = document.getElementById('pos-lookup-result');
  if (!result) return;
  if (!raw) { result.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:20px;font-size:13px">Enter a claim code above to look up an order.</div>'; return; }

  const order = (DB.orders || []).find(o => o.claimCode === raw);
  if (!order) {
    result.innerHTML = `<div class="pos-result-card pos-result-error"><div style="display:flex;align-items:center;gap:14px"><div style="font-size:36px">❌</div><div><div style="font-family:var(--fh);font-size:16px;font-weight:900;color:#ffb4ab;margin-bottom:4px">Code Not Found</div><div style="font-size:13px;color:var(--text-muted)">No order matches <span style="font-family:var(--fm);color:#ffb4ab">${_esc(raw)}</span>. Check the code and try again.</div></div></div></div>`;
    return;
  }
  if (order.status === 'claimed') {
    result.innerHTML = `<div class="pos-result-card pos-result-claimed"><div style="display:flex;align-items:flex-start;gap:16px"><div style="font-size:44px;flex-shrink:0">${order.emoji || '🎁'}</div><div style="flex:1"><div style="font-family:var(--fh);font-size:18px;font-weight:900;color:#d0bcff;margin-bottom:6px">${_esc(order.itemName)}</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">${ordStatusPill('claimed')}<span class="pos-student-chip"><span class="pos-av" style="background:${order.studentColor || '#8b5cf6'}22;border:1px solid ${order.studentColor || '#8b5cf6'}44;color:${order.studentColor || '#8b5cf6'}">${_esc(order.studentInit || '?')}</span>${_esc(order.studentName)}</span></div><div style="font-size:12px;color:var(--text-muted)">Already claimed on ${order.claimedAt ? new Date(order.claimedAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown'} by ${_esc(order.claimedBy || 'Teacher')}</div></div></div><div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)"><div style="font-size:12px;color:var(--text-muted);text-align:center">⚠️ This reward has already been distributed. Duplicate claims are blocked.</div></div></div>`;
    return;
  }
  if (order.status === 'cancelled') {
    result.innerHTML = `<div class="pos-result-card pos-result-error"><div style="display:flex;align-items:center;gap:14px"><div style="font-size:36px;filter:grayscale(1)">${order.emoji || '🎁'}</div><div><div style="font-family:var(--fh);font-size:16px;font-weight:900;color:#ffb4ab;margin-bottom:4px">${_esc(order.itemName)}</div><div style="font-size:13px;color:var(--text-muted)">This order was cancelled.${order.cancelReason ? ' Reason: ' + _esc(order.cancelReason) : ''}</div></div></div></div>`;
    return;
  }
  // Pending / ready — show claim UI
  result.innerHTML = `<div class="pos-result-card pos-result-found">
    <div class="pos-order-main">
      <div class="pos-order-emoji">${order.emoji || '🎁'}</div>
      <div style="flex:1">
        <div style="font-family:var(--fh);font-size:20px;font-weight:900;color:var(--on-surface);margin-bottom:6px">${_esc(order.itemName)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">${ordStatusPill(order.status)}<span class="pos-student-chip"><span class="pos-av" style="background:${order.studentColor || '#8b5cf6'}22;border:1px solid ${order.studentColor || '#8b5cf6'}44;color:${order.studentColor || '#8b5cf6'}">${_esc(order.studentInit || '?')}</span>${_esc(order.studentName)}</span></div>
        <div style="display:flex;gap:16px;font-size:12px;color:var(--text-muted);flex-wrap:wrap">
          <span><span class="material-symbols-outlined" style="font-size:12px;vertical-align:middle">monetization_on</span> ${(order.cost || 0).toLocaleString()} coins</span>
          <span><span class="material-symbols-outlined" style="font-size:12px;vertical-align:middle">calendar_today</span> ${_esc(order.createdDateStr || '')}</span>
          <span><span class="material-symbols-outlined" style="font-size:12px;vertical-align:middle">tag</span> ${_esc(order.orderId)}</span>
        </div>
      </div>
    </div>
    <div style="background:rgba(78,222,163,.06);border:1px solid rgba(78,222,163,.2);border-radius:12px;padding:14px;margin-bottom:16px">
      <div style="font-family:var(--fm);font-size:9px;color:var(--text-muted);letter-spacing:.16em;text-transform:uppercase;margin-bottom:8px">CLAIM CODE VERIFIED</div>
      <div style="font-family:var(--fm);font-size:28px;font-weight:900;color:var(--secondary);letter-spacing:.2em;text-shadow:0 0 16px rgba(78,222,163,.4)">${_esc(order.claimCode)}</div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-success" style="flex:1" onclick="posConfirmClaim('${order.orderId}')"><span class="material-symbols-outlined" style="font-size:16px">check_circle</span> Mark as Claimed</button>
      <button class="btn btn-danger" onclick="posCancelOrderPrompt('${order.orderId}')"><span class="material-symbols-outlined" style="font-size:16px">cancel</span> Cancel</button>
    </div>
  </div>`;
};

// ── Claim flow ────────────────────────────────────────────────────────────────

window.posConfirmClaim = function (orderId) {
  DB = loadDB();
  const order = (DB.orders || []).find(o => o.orderId === orderId);
  if (!order) { toast('Order not found.', '#ffb4ab'); return; }
  if (order.status === 'claimed')   { toast('⚠️ Already claimed!', '#ffb4ab'); return; }
  if (order.status === 'cancelled') { toast('⚠️ Order was cancelled.', '#ffb4ab'); return; }
  showModal(`<div style="text-align:center">
    <div style="font-size:52px;margin-bottom:12px">${order.emoji || '🎁'}</div>
    <div class="modal-h2" style="text-align:center">Confirm Distribution</div>
    <div style="color:var(--text-muted);font-size:13px;margin-bottom:16px">You are about to mark this reward as physically given to the student.</div>
    <div style="background:rgba(78,222,163,.07);border:1px solid rgba(78,222,163,.22);border-radius:12px;padding:16px;margin-bottom:20px">
      <div style="font-family:var(--fh);font-size:18px;font-weight:900;color:var(--on-surface);margin-bottom:8px">${_esc(order.itemName)}</div>
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><span style="color:var(--text-muted)">Student</span><span style="font-weight:700">${_esc(order.studentName)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><span style="color:var(--text-muted)">Claim Code</span><span style="font-family:var(--fm);color:var(--secondary)">${_esc(order.claimCode)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--text-muted)">Cost</span><span style="color:var(--tertiary);font-weight:700">${(order.cost || 0).toLocaleString()} 🪙</span></div>
    </div>
    <div style="background:rgba(255,185,95,.06);border:1px solid rgba(255,185,95,.18);border-radius:10px;padding:10px;margin-bottom:20px;font-size:12px;color:var(--text-muted)">⚠️ This cannot be undone. The code will be invalidated after claiming.</div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-success" style="flex:1" onclick="posExecuteClaim('${orderId}')"><span class="material-symbols-outlined" style="font-size:15px">check_circle</span> Confirm & Give Reward</button>
    </div>
  </div>`, 'sm');
};

window.posExecuteClaim = function (orderId) {
  DB = loadDB();
  const order = (DB.orders || []).find(o => o.orderId === orderId);
  if (!order || order.status === 'claimed') { closeModalForce(); toast('⚠️ Already claimed.', '#ffb4ab'); return; }
  order.status    = 'claimed';
  order.claimedAt = Date.now();
  order.claimedBy = DB.admin?.name || 'Teacher';
  saveDB();
  closeModalForce();
  toast(`✅ ${order.emoji} "${order.itemName}" claimed by ${order.studentName}!`, '#4edea3');
  const input = document.getElementById('pos-code-input');
  if (input) input.value = '';
  const resultEl = document.getElementById('pos-lookup-result');
  if (resultEl) resultEl.innerHTML = `<div style="text-align:center;padding:20px;background:rgba(78,222,163,.07);border:1px solid rgba(78,222,163,.2);border-radius:14px;animation:fadeIn .3s ease"><div style="font-size:40px;margin-bottom:8px">✅</div><div style="font-family:var(--fh);font-size:16px;font-weight:900;color:var(--secondary);margin-bottom:4px">Reward Distributed!</div><div style="font-size:13px;color:var(--text-muted)">${_esc(order.emoji)} ${_esc(order.itemName)} → ${_esc(order.studentName)}</div></div>`;
  const tab = document.getElementById('postab-queue');
  if (tab) { DB = loadDB(); const pCount = (DB.orders || []).filter(o => o.status === 'pending').length; tab.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px">pending_actions</span> Pending Queue${pCount > 0 ? `<span style="background:rgba(255,185,95,.2);border:1px solid rgba(255,185,95,.3);border-radius:10px;padding:1px 7px;font-size:10px;font-weight:900;color:var(--tertiary);font-family:var(--fh)">${pCount}</span>` : ''}`; }
};

// ── Cancel flow ───────────────────────────────────────────────────────────────

window.posCancelOrderPrompt = function (orderId) {
  DB = loadDB();
  const order = (DB.orders || []).find(o => o.orderId === orderId);
  if (!order) return;
  showModal(`<div>
    <div class="modal-h2">Cancel Order?</div>
    <div style="color:var(--text-muted);font-size:13px;margin-bottom:16px">Cancel <b style="color:var(--on-surface)">${_esc(order.itemName)}</b> for <b style="color:var(--on-surface)">${_esc(order.studentName)}</b>?</div>
    <div style="background:rgba(255,180,171,.06);border:1px solid rgba(255,180,171,.2);border-radius:12px;padding:14px;margin-bottom:16px">
      <div style="font-size:12px;color:#ffb4ab;margin-bottom:10px">⚠️ The student's coins will NOT be automatically refunded. Refund manually if needed.</div>
      <div class="form-group" style="margin-bottom:0"><label class="form-label">Reason (optional)</label><input type="text" id="pos-cancel-reason" placeholder="e.g. Out of stock, item unavailable" style="width:100%"></div>
    </div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Keep Order</button>
      <button class="btn btn-danger" style="flex:1" onclick="posExecuteCancel('${orderId}')"><span class="material-symbols-outlined" style="font-size:14px">cancel</span> Cancel Order</button>
    </div>
  </div>`, 'sm');
};

window.posExecuteCancel = function (orderId) {
  DB = loadDB();
  const order = (DB.orders || []).find(o => o.orderId === orderId);
  if (!order) { closeModalForce(); return; }
  const reason = (document.getElementById('pos-cancel-reason')?.value || '').trim();
  order.status      = 'cancelled';
  order.cancelledAt = Date.now();
  order.cancelReason = reason || 'Cancelled by teacher';
  order.cancelledBy  = DB.admin?.name || 'Teacher';
  saveDB();
  closeModalForce();
  toast(`🚫 Order for "${order.itemName}" cancelled.`, '#ffb4ab');
  renderPOS();
  posSwitchTab('queue');
};

// ── Scan & Pay — live cashier checkout ──────────────────────────────────────
//
//  A proper point-of-sale flow that runs entirely on the teacher's own
//  device: the teacher (cashier) builds the sale by tapping items from the
//  store catalog, then the student taps their RFID card on the reader to
//  pay — same "ring it up, customer taps to pay" motion as a real POS.
//  This is what lets a student without their own internet access still buy
//  from the Armory: they never need to be online themselves, since the
//  whole transaction is submitted from the teacher's connected terminal.
//
//  Payment resolves the tapped card to a student via the same rfidCards
//  slice AttendanceService/RecitationService already use (read-only here),
//  then reuses the exact same purchase_shop_product RPC + coin-delta sync
//  cartCheckout() uses for the student-initiated Armory checkout — so
//  stock reservation stays race-safe and coins are never a locally-guessed
//  absolute value. Orders created here land as ALREADY claimed (no claim
//  code needed — the "claim" already happened in person at the register).
//
//  A manual student-search fallback exists for a lost/unregistered card —
//  the cashier still has to positively identify who's paying and click a
//  final "Confirm & Charge" button, so a scan and a manual pick require the
//  same level of deliberate confirmation before money moves.
// ─────────────────────────────────────────────────────────────────────────────

let _posPayCart = {};              // itemId -> { item, qty }
let _posPayManualStudentId = null; // set once a manual search result is picked
let _posPayScanArmed = false;
let _posPayCaptureFocusInterval = null;
let _posPayCaptureTimer = null;
let _posPayLastChargedTag = null;
let _posPayLastChargeAt = 0;
let _posPayBusy = false;           // guards against a double-charge while an RPC round-trip is in flight

function _posPayTotal() { return Object.values(_posPayCart).reduce((s, e) => s + e.item.cost * e.qty, 0); }

// ── Panel bootstrap ─────────────────────────────────────────────────────────

function _posPayRenderPanel() {
  _posPayRenderGrid();
  _posPayRenderCart();
}

function _posPayRenderGrid() {
  DB = loadDB();
  const grid = document.getElementById('pos-pay-grid');
  if (!grid) return;
  const q   = (document.getElementById('pos-pay-search')?.value || '').toLowerCase().trim();
  const cat = document.getElementById('pos-pay-cat')?.value || 'all';
  let items = DB.store || [];
  if (cat !== 'all') items = items.filter(i => i.cat === cat);
  if (q)             items = items.filter(i => (i.name || '').toLowerCase().includes(q));

  if (!items.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px 10px;color:var(--text-muted);font-size:12px">No items match.</div>`;
    return;
  }
  grid.innerHTML = items.map(item => {
    const out = item.stock === 0;
    const inCart = _posPayCart[item.id] ? _posPayCart[item.id].qty : 0;
    return `<div class="pos-pay-tile ${out ? 'out' : ''}" onclick="posPayAddItem('${item.id}')" title="${out ? 'Out of stock' : 'Add to sale'}">
      <div class="pos-pay-tile-emoji">${item.emoji}</div>
      <div class="pos-pay-tile-name">${_esc(item.name)}</div>
      <div class="pos-pay-tile-cost">${item.cost.toLocaleString()} 🪙</div>
      <div class="pos-pay-tile-stock">${out ? 'Out of stock' : `${item.stock} in stock`}${inCart ? ` · ${inCart} in sale` : ''}</div>
    </div>`;
  }).join('');
}

// ── Cart mutation ────────────────────────────────────────────────────────────

window.posPayAddItem = function (id) {
  DB = loadDB();
  const item = DB.store.find(i => i.id === id);
  if (!item) return;
  if (item.stock === 0) { toast('❌ Out of stock!', '#ffb4ab'); return; }
  const cartQty = _posPayCart[id] ? _posPayCart[id].qty : 0;
  if (cartQty >= item.stock) { toast(`❌ Only ${item.stock} in stock!`, '#ffb4ab'); return; }
  if (!_posPayCart[id]) _posPayCart[id] = { item, qty: 0 };
  _posPayCart[id].qty++;
  _posPayCart[id].item = item;
  _posPayRenderGrid();
  _posPayRenderCart();
};

window.posPayIncQty = function (id) { window.posPayAddItem(id); };

window.posPayDecQty = function (id) {
  if (!_posPayCart[id]) return;
  _posPayCart[id].qty--;
  if (_posPayCart[id].qty <= 0) delete _posPayCart[id];
  _posPayRenderGrid();
  _posPayRenderCart();
};

window.posPayClearCart = function () {
  _posPayCart = {};
  _posPayManualStudentId = null;
  window.unmountPosPayCapture();
  _posPayRenderGrid();
  _posPayRenderCart();
};

// ── Cart + payment box render ────────────────────────────────────────────────

function _posPayRenderCart() {
  const box = document.getElementById('pos-pay-cart-box');
  if (!box) return;
  const entries = Object.values(_posPayCart);
  const total   = _posPayTotal();
  box.innerHTML = `
    <div class="section-header" style="margin-bottom:12px">
      <span class="material-symbols-outlined" style="color:var(--secondary)">shopping_cart</span>
      <h2>Current Sale</h2>
      ${entries.length ? `<button class="btn btn-ghost btn-xs" style="margin-left:auto" onclick="posPayClearCart()">Clear</button>` : ''}
    </div>
    ${!entries.length
      ? `<div style="text-align:center;padding:30px 10px;color:var(--text-muted);font-size:12px;border:2px dashed rgba(255,255,255,.07);border-radius:14px">🛍️ Tap items on the left to ring them up.</div>`
      : `<div style="max-height:230px;overflow-y:auto;margin-bottom:14px">
          ${entries.map(e => `
          <div class="pos-pay-cart-row">
            <div style="font-size:20px">${e.item.emoji}</div>
            <div style="flex:1;min-width:0">
              <div style="font-family:var(--fh);font-size:12px;font-weight:800;color:var(--on-surface);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(e.item.name)}</div>
              <div style="font-size:11px;color:var(--tertiary)">${e.item.cost.toLocaleString()} × ${e.qty} = ${(e.item.cost * e.qty).toLocaleString()} 🪙</div>
            </div>
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
              <button class="btn btn-ghost btn-xs" onclick="posPayDecQty('${e.item.id}')">−</button>
              <span style="min-width:16px;text-align:center;font-size:12px;font-weight:700">${e.qty}</span>
              <button class="btn btn-ghost btn-xs" onclick="posPayIncQty('${e.item.id}')">+</button>
            </div>
          </div>`).join('')}
        </div>`}
    <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 0;border-top:1px solid var(--border);margin-bottom:4px">
      <span style="font-size:12px;color:var(--text-muted);font-weight:700;letter-spacing:.05em;text-transform:uppercase">Total Due</span>
      <span style="font-family:var(--fh);font-size:24px;font-weight:900;color:var(--tertiary)">${total.toLocaleString()} 🪙</span>
    </div>
    <div id="pos-pay-status">${_posPayIdleStatusHTML(entries.length)}</div>
  `;
}

function _posPayIdleStatusHTML(count) {
  return `
  <button class="btn btn-success btn-block" style="padding:14px;font-size:14px" ${count ? '' : 'disabled'} onclick="posPayArmScan()">
    <span class="material-symbols-outlined">contactless</span> Tap Card to Pay
  </button>
  <div style="text-align:center;margin:10px 0;font-size:11px;color:var(--text-muted)">or, if the card is lost/unregistered</div>
  <input type="text" id="pos-pay-manual-search" placeholder="Search student by name…" oninput="posPaySearchStudent()" ${count ? '' : 'disabled'}
    style="width:100%;background:rgba(35,31,56,.9);border:1px solid var(--border2);border-radius:10px;padding:9px 12px;font-size:12px;color:var(--text);outline:none">
  <div id="pos-pay-manual-results" style="margin-top:6px"></div>`;
}

// ── Card-tap capture (keyboard-wedge RFID reader) ────────────────────────────
// Same hardware model as the attendance kiosk (see att_scanner_rfid.js
// file header): the reader "types" the tag into a focused input, then
// sends Enter. Scoped to a single hidden input on this panel only — no
// document-wide keydown listener, so it never steals keystrokes from any
// other field on the page.

function _posPayStartCapture() {
  if (_posPayCaptureFocusInterval) { clearInterval(_posPayCaptureFocusInterval); _posPayCaptureFocusInterval = null; }
  if (_posPayCaptureTimer)         { clearTimeout(_posPayCaptureTimer); _posPayCaptureTimer = null; }
  const input = document.getElementById('pos-pay-capture-input');
  if (!input) return;
  input.value = '';
  input.focus();
  _posPayCaptureFocusInterval = setInterval(() => {
    const el = document.getElementById('pos-pay-capture-input');
    if (el && _posPayScanArmed && document.activeElement !== el) el.focus();
  }, 300);
}

window.unmountPosPayCapture = function () {
  if (_posPayCaptureFocusInterval) { clearInterval(_posPayCaptureFocusInterval); _posPayCaptureFocusInterval = null; }
  if (_posPayCaptureTimer)         { clearTimeout(_posPayCaptureTimer); _posPayCaptureTimer = null; }
  _posPayScanArmed = false;
};

window._posPayOnCaptureInput = function () {
  if (_posPayCaptureTimer) clearTimeout(_posPayCaptureTimer);
  // 120ms inactivity fallback, for reader models that don't emit Enter.
  _posPayCaptureTimer = setTimeout(window._posPayFinalizeCapture, 120);
};

window._posPayFinalizeCapture = function () {
  const input = document.getElementById('pos-pay-capture-input');
  if (!input) return;
  const tag = (input.value || '').trim();
  input.value = '';
  if (!tag || !_posPayScanArmed) return;
  _posPayHandleTag(tag);
};

window.posPayArmScan = function () {
  if (!Object.keys(_posPayCart).length) { toast('Add items to the sale first.', '#ffb95f'); return; }
  _posPayScanArmed = true;
  const status = document.getElementById('pos-pay-status');
  if (status) status.innerHTML = `
    <div class="pos-pay-waiting">
      <div class="pos-pay-waiting-pulse">💳</div>
      <div style="font-family:var(--fh);font-size:14px;font-weight:800;color:var(--secondary);margin-top:10px">Waiting for card tap…</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Have the student tap their card on the reader</div>
      <button class="btn btn-ghost btn-sm" style="margin-top:14px" onclick="posPayCancelScan()">Cancel</button>
    </div>`;
  _posPayStartCapture();
};

window.posPayCancelScan = function () {
  window.unmountPosPayCapture();
  _posPayRenderCart();
};

window.posPayEditSale = function () {
  window.unmountPosPayCapture();
  _posPayRenderCart();
};

function _posPayHandleTag(tag) {
  DB = loadDB();
  const card = (DB.rfidCards || []).find(c => c.tagId === tag && c.isActive);
  if (!card) {
    _posPayRenderScanError('Card not recognized — it isn\'t registered to any student.');
    return;
  }
  // Debounce: a card left sitting on the reader (or a bounce) must not
  // fire two charges for the same tap.
  const now = Date.now();
  if (_posPayLastChargedTag === tag && (now - _posPayLastChargeAt) < 5000) return;
  _posPayLastChargedTag = tag;
  _posPayLastChargeAt   = now;
  window.unmountPosPayCapture();
  _posPayAttemptCharge(card.studentId, 'scan');
}

function _posPayRenderScanError(msg) {
  const status = document.getElementById('pos-pay-status');
  if (!status) return;
  status.innerHTML = `
    <div style="text-align:center;padding:16px;background:rgba(255,180,171,.06);border:1px solid rgba(255,180,171,.22);border-radius:14px">
      <div style="font-size:28px;margin-bottom:6px">🚫</div>
      <div style="font-size:12px;color:#ffb4ab;margin-bottom:12px">${_esc(msg)}</div>
      <button class="btn btn-ghost btn-sm" onclick="posPayArmScan()">Try Again</button>
    </div>`;
}

// ── Manual student search (lost/unregistered card fallback) ─────────────────

window.posPaySearchStudent = function () {
  DB = loadDB();
  const q   = (document.getElementById('pos-pay-manual-search')?.value || '').toLowerCase().trim();
  const box = document.getElementById('pos-pay-manual-results');
  if (!box) return;
  if (!q) { box.innerHTML = ''; return; }
  const matches = (DB.students || []).filter(s => (s.name || '').toLowerCase().includes(q)).slice(0, 6);
  if (!matches.length) { box.innerHTML = `<div style="font-size:11px;color:var(--text-muted);padding:6px 2px">No students match "${_esc(q)}".</div>`; return; }
  box.innerHTML = matches.map(s => `
    <div class="pos-pay-manual-row" onclick="posPaySelectStudent('${s.id}')">
      <span class="pos-av" style="background:${s.color || '#8b5cf6'}22;border:1px solid ${s.color || '#8b5cf6'}44;color:${s.color || '#8b5cf6'}">${_esc(s.init || '?')}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700;color:var(--on-surface)">${_esc(s.name)}</div>
        <div style="font-size:10px;color:var(--text-muted)">${(s.coins || 0).toLocaleString()} 🪙 balance</div>
      </div>
    </div>`).join('');
};

window.posPaySelectStudent = function (id) {
  DB = loadDB();
  const student = (DB.students || []).find(s => s.id === id);
  if (!student) return;
  _posPayManualStudentId = id;
  const total  = _posPayTotal();
  const status = document.getElementById('pos-pay-status');
  if (!status) return;
  status.innerHTML = `
    <div class="pos-pay-identified">
      <span class="pos-av" style="width:34px;height:34px;font-size:13px;background:${student.color || '#8b5cf6'}22;border:1px solid ${student.color || '#8b5cf6'}44;color:${student.color || '#8b5cf6'}">${_esc(student.init || '?')}</span>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--fh);font-size:13px;font-weight:800;color:var(--on-surface)">${_esc(student.name)}</div>
        <div style="font-size:11px;color:var(--text-muted)">Balance: ${(student.coins || 0).toLocaleString()} 🪙</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn btn-ghost" style="flex:1" onclick="posPayEditSale()">Cancel</button>
      <button class="btn btn-success" style="flex:1" onclick="posPayManualCharge()">Confirm &amp; Charge ${total.toLocaleString()} 🪙</button>
    </div>`;
};

window.posPayManualCharge = function () {
  if (!_posPayManualStudentId) return;
  _posPayAttemptCharge(_posPayManualStudentId, 'manual');
};

// ── Charge core — reuses the same atomic RPCs cartCheckout() uses ───────────

function _posPayRenderProcessing(student) {
  const status = document.getElementById('pos-pay-status');
  if (!status) return;
  status.innerHTML = `
    <div class="pos-pay-identified">
      <span class="pos-av" style="width:34px;height:34px;font-size:13px;background:${student.color || '#8b5cf6'}22;border:1px solid ${student.color || '#8b5cf6'}44;color:${student.color || '#8b5cf6'}">${_esc(student.init || '?')}</span>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--fh);font-size:13px;font-weight:800;color:var(--on-surface)">${_esc(student.name)}</div>
        <div style="font-size:11px;color:var(--text-muted)">Balance: ${(student.coins || 0).toLocaleString()} 🪙</div>
      </div>
    </div>
    <div style="text-align:center;padding:14px 0;color:var(--text-muted);font-size:12px">⏳ Processing payment…</div>`;
}

function _posPayRenderDeclined(student, total) {
  const status = document.getElementById('pos-pay-status');
  if (!status) return;
  const shortBy = Math.max(0, total - (student.coins || 0));
  status.innerHTML = `
    <div class="pos-pay-declined">
      <div style="font-size:34px;text-align:center">❌</div>
      <div style="font-family:var(--fh);font-size:15px;font-weight:900;color:#ffb4ab;text-align:center;margin:6px 0 2px">DECLINED</div>
      <div style="font-size:12px;color:var(--text-muted);text-align:center;margin-bottom:12px">Insufficient balance</div>
      <div class="pos-pay-declined-row">
        <span class="pos-av" style="background:${student.color || '#8b5cf6'}22;border:1px solid ${student.color || '#8b5cf6'}44;color:${student.color || '#8b5cf6'}">${_esc(student.init || '?')}</span>
        ${_esc(student.name)}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:10px"><span style="color:var(--text-muted)">Sale Total</span><span style="font-weight:700">${total.toLocaleString()} 🪙</span></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px"><span style="color:var(--text-muted)">Student Balance</span><span style="font-weight:700">${(student.coins || 0).toLocaleString()} 🪙</span></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px;padding-top:6px;border-top:1px solid rgba(255,180,171,.2)"><span style="color:#ffb4ab;font-weight:700">Short By</span><span style="color:#ffb4ab;font-weight:900">${shortBy.toLocaleString()} 🪙</span></div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn btn-ghost" style="flex:1" onclick="posPayEditSale()">✏️ Edit Sale</button>
        <button class="btn btn-danger" style="flex:1" onclick="posPayEditSale()">Try Different Card</button>
      </div>
    </div>`;
}

function _posPayRenderStockFail(failed) {
  const status = document.getElementById('pos-pay-status');
  if (!status) return;
  status.innerHTML = `
    <div class="pos-pay-declined">
      <div style="font-size:30px;text-align:center">📦</div>
      <div style="font-family:var(--fh);font-size:14px;font-weight:900;color:#ffb4ab;text-align:center;margin:6px 0 10px">Stock Ran Out Mid-Sale</div>
      ${failed.map(f => `<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">${_esc(f.e.item.name)} — ${_esc(f.reason)}</div>`).join('')}
      <button class="btn btn-ghost btn-block" style="margin-top:10px" onclick="posPayEditSale()">Back to Sale</button>
    </div>`;
}

function _posPayRenderReceipt(student, receiptItems, chargeable, failed) {
  const status = document.getElementById('pos-pay-status');
  if (!status) return;
  status.innerHTML = `
    <div class="pos-pay-success">
      <div style="font-size:38px;margin-bottom:6px">✅</div>
      <div style="font-family:var(--fh);font-size:16px;font-weight:900;color:var(--secondary);margin-bottom:2px">Payment Approved</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">${_esc(student.name)} · new balance ${(student.coins || 0).toLocaleString()} 🪙</div>
      <div style="text-align:left;background:rgba(0,0,0,.15);border-radius:10px;padding:10px 12px;margin-bottom:10px">
        ${receiptItems.map(r => `<div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 0"><span>${r.item.emoji} ${_esc(r.item.name)} ×${r.qty}</span><span style="color:var(--tertiary)">${(r.item.cost * r.qty).toLocaleString()}</span></div>`).join('')}
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:800;padding-top:6px;margin-top:4px;border-top:1px solid rgba(255,255,255,.08)"><span>Total Charged</span><span style="color:var(--tertiary)">${chargeable.toLocaleString()} 🪙</span></div>
      </div>
      ${failed && failed.length ? `<div style="font-size:11px;color:#ffb95f;margin-bottom:10px">⚠️ ${failed.length} item(s) couldn't be added — ${failed.map(f => _esc(f.e.item.name)).join(', ')}</div>` : ''}
      <button class="btn btn-success btn-block" onclick="posPayNewTransaction()">🧾 New Sale</button>
    </div>`;
}

window.posPayNewTransaction = function () {
  _posPayCart = {};
  _posPayManualStudentId = null;
  _posPayLastChargedTag = null;
  window.unmountPosPayCapture();
  _posPayRenderGrid();
  _posPayRenderCart();
  document.getElementById('pos-pay-search') && (document.getElementById('pos-pay-search').value = '');
};

async function _posPayAttemptCharge(studentId, method) {
  if (_posPayBusy) return;
  DB = loadDB();
  const student = (DB.students || []).find(s => s.id === studentId);
  const entries = Object.values(_posPayCart);
  if (!student)      { _posPayRenderScanError('Student not found.'); return; }
  if (!entries.length) { toast('Cart is empty.', '#ffb95f'); return; }

  const total = entries.reduce((s, e) => s + e.item.cost * e.qty, 0);
  _posPayRenderProcessing(student);

  // Same affordability check cartCheckout() does before reserving any
  // stock — this is the "fails like a proper POS" declined path.
  if ((student.coins || 0) < total) {
    _posPayRenderDeclined(student, total);
    return;
  }

  _posPayBusy = true;
  const succeeded = [];
  const failed    = [];
  for (const e of entries) {
    const item = DB.store.find(i => i.id === e.item.id);
    if (!item) { failed.push({ e, reason: 'no longer available' }); continue; }
    const { data, error } = await DBService.rpc('purchase_shop_product', {
      p_product_id: item.id, p_student_id: studentId, p_quantity: e.qty,
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
    _posPayBusy = false;
    _posPayRenderStockFail(failed);
    return;
  }

  const chargeable = succeeded.reduce((s, { e }) => s + e.item.cost * e.qty, 0);
  const stIdx = DB.students.findIndex(s => s.id === studentId);
  DB.students[stIdx].coins -= chargeable;
  // Same atomic-delta persistence path every other spend site in the app
  // uses — see utils.js's syncStudentStatsToServer() header for why a
  // local-only mutation here would silently "refund" the student on the
  // next reload.
  syncStudentStatsToServer(studentId, 0, -chargeable);

  if (!DB.orders)                    DB.orders = [];
  if (!DB.redemptions)                DB.redemptions = [];
  if (!DB.inventory)                  DB.inventory = {};
  if (!DB.inventory[studentId])       DB.inventory[studentId] = [];

  const cashier = (DB.admin && DB.admin.name) || (typeof currentUser !== 'undefined' && currentUser && currentUser.name) || 'Teacher';
  const receiptItems = [];
  succeeded.forEach(({ e, item }) => {
    for (let q = 0; q < e.qty; q++) {
      const claimCode = posGenCode();
      const orderId   = 'POS-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(100 + Math.random() * 900);
      // Created already-claimed: unlike a self-checkout Armory order, this
      // reward was handed over in person at the moment of payment — there
      // is no separate claim step for the teacher to do later.
      DB.orders.unshift({
        orderId, claimCode,
        studentId, studentName: student.name, studentInit: student.init, studentColor: student.color,
        itemId: item.id, itemName: item.name, emoji: item.emoji,
        cost: item.cost, category: item.cat,
        status: 'claimed',
        createdAt: new Date().toISOString(), createdDateStr: todayStr() + ' at ' + nowStr(),
        claimedAt: Date.now(), claimedBy: cashier, cancelledAt: null, cancelReason: null,
        entryMethod: method === 'scan' ? 'POS Card Tap' : 'POS Manual',
      });
      DB.redemptions.unshift({
        studentId, itemId: item.id, itemName: item.name, emoji: item.emoji,
        item: `${item.emoji} ${item.name}`, pts: item.cost, date: todayStr(), time: nowStr(), orderId, claimCode,
      });
    }
    const inv      = DB.inventory[studentId];
    const existing = inv.find(i => i.itemId === item.id);
    if (existing) {
      existing.quantity      = (existing.quantity || 1) + e.qty;
      existing.lastPurchased = todayStr() + ' ' + nowStr();
    } else {
      inv.unshift({
        itemId: item.id, itemName: item.name, emoji: item.emoji,
        category: item.cat, quantity: e.qty,
        datePurchased: todayStr() + ' at ' + nowStr(), source: 'Teacher POS', status: 'active',
      });
    }
    receiptItems.push({ item, qty: e.qty });
    if (typeof promoRecordPurchase === 'function') promoRecordPurchase(item.id);
  });

  if (typeof currentUser !== 'undefined' && currentUser && currentUser.id === studentId) currentUser = DB.students[stIdx];
  saveDB();
  _posPayBusy = false;

  toast(`✅ ${chargeable.toLocaleString()} 🪙 charged to ${student.name}`, '#4edea3');
  succeeded.forEach(({ e }) => delete _posPayCart[e.item.id]);
  _posPayManualStudentId = null;
  _posPayRenderGrid();
  _posPayRenderCart();
  _posPayRenderReceipt(DB.students[stIdx], receiptItems, chargeable, failed);
  if (typeof invUpdateSidebarBadge === 'function' && typeof currentUser !== 'undefined' && currentUser && currentUser.id === studentId) invUpdateSidebarBadge();
  if (typeof achCheckAndAward === 'function') setTimeout(() => achCheckAndAward(studentId), 400);
}

// ── Queue filter & render ─────────────────────────────────────────────────────

window.posFilterQueue = function () {
  DB = loadDB();
  const q   = (document.getElementById('pos-queue-search')?.value || '').toLowerCase().trim();
  const cat = document.getElementById('pos-queue-cat')?.value || 'all';
  let orders = (DB.orders || []).filter(o => o.status === 'pending' || o.status === 'ready');
  if (q)          orders = orders.filter(o => (o.studentName || '').toLowerCase().includes(q) || (o.itemName || '').toLowerCase().includes(q) || (o.claimCode || '').toLowerCase().includes(q));
  if (cat !== 'all') orders = orders.filter(o => o.category === cat);

  const list = document.getElementById('pos-queue-list');
  if (!list) return;
  if (!orders.length) {
    list.innerHTML = `<div style="text-align:center;padding:60px;border:2px dashed rgba(255,255,255,.07);border-radius:16px"><div style="font-size:48px;margin-bottom:16px">🎉</div><div style="font-family:var(--fh);font-size:18px;font-weight:800;color:var(--on-surface);margin-bottom:8px">${q || cat !== 'all' ? 'No matching orders' : 'No Pending Orders'}</div><div style="color:var(--text-muted);font-size:13px">${q || cat !== 'all' ? 'Try adjusting your filters.' : 'All rewards have been distributed!'}</div></div>`;
    return;
  }
  list.innerHTML = orders.map(o => `
  <div class="pos-queue-row">
    <div style="font-size:22px">${o.emoji || '🎁'}</div>
    <div style="min-width:0">
      <div style="font-family:var(--fh);font-size:13px;font-weight:800;color:var(--on-surface)">${_esc(o.itemName)}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:2px;display:flex;gap:8px;flex-wrap:wrap"><span style="color:${o.studentColor || 'var(--primary)'}">👤 ${_esc(o.studentName)}</span><span>${(o.cost || 0).toLocaleString()} coins</span><span>${_esc(o.createdDateStr || '')}</span></div>
    </div>
    <div style="font-family:var(--fm);font-size:12px;color:var(--secondary);letter-spacing:.1em;flex-shrink:0">${_esc(o.claimCode)}</div>
    <div style="flex-shrink:0">${ordStatusPill(o.status)}</div>
    <div style="display:flex;gap:6px;flex-shrink:0">
      <button class="btn btn-success btn-xs" onclick="posConfirmClaim('${o.orderId}')"><span class="material-symbols-outlined" style="font-size:12px">check</span> Claim</button>
      <button class="btn btn-danger btn-xs" onclick="posCancelOrderPrompt('${o.orderId}')"><span class="material-symbols-outlined" style="font-size:12px">close</span></button>
    </div>
  </div>`).join('');
};

// ── History filter & render ───────────────────────────────────────────────────

let _posHistPage = 1;
const _POS_HIST_PAGE_SIZE = 20;

window.posGoToHistPage = function (page) {
  _posHistPage = Math.max(1, page | 0);
  window.posFilterHistory(false);
  const list = document.getElementById('pos-hist-list');
  if (list) list.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};
window.posPrevHistPage = function () { window.posGoToHistPage(_posHistPage - 1); };
window.posNextHistPage = function () { window.posGoToHistPage(_posHistPage + 1); };

function _posHistPagination(page, totalPages, totalCount, rangeStart, rangeEnd) {
  if (totalPages <= 1) {
    return `<div style="text-align:center;margin-top:10px;font-size:11px;color:var(--text-muted)">Showing all ${totalCount}</div>`;
  }
  const nums = new Set([1, totalPages, page, page - 1, page + 1, page - 2, page + 2]);
  const pages = Array.from(nums).filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  let btns = '';
  let prevN = 0;
  pages.forEach(n => {
    if (n - prevN > 1) btns += `<span style="padding:0 6px;color:var(--text-muted);font-size:11px">…</span>`;
    btns += `<button class="btn btn-ghost btn-sm" style="${n === page ? 'background:var(--primary);color:#fff;font-weight:800' : ''}" onclick="posGoToHistPage(${n})">${n}</button>`;
    prevN = n;
  });
  return `
  <div style="display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;margin-top:14px">
    <button class="btn btn-ghost btn-sm" ${page <= 1 ? 'disabled' : ''} onclick="posPrevHistPage()">← Prev</button>
    ${btns}
    <button class="btn btn-ghost btn-sm" ${page >= totalPages ? 'disabled' : ''} onclick="posNextHistPage()">Next →</button>
  </div>
  <div style="text-align:center;margin-top:8px;font-size:11px;color:var(--text-muted)">Showing ${rangeStart}–${rangeEnd} of ${totalCount}</div>`;
}

window.posFilterHistory = function (resetPage) {
  DB = loadDB();
  if (resetPage !== false) _posHistPage = 1;
  const q      = (document.getElementById('pos-hist-search')?.value || '').toLowerCase().trim();
  const filter = document.getElementById('pos-hist-filter')?.value || 'claimed';
  let orders   = DB.orders || [];
  if (filter === 'claimed')   orders = orders.filter(o => o.status === 'claimed');
  else if (filter === 'cancelled') orders = orders.filter(o => o.status === 'cancelled');
  else orders = orders.filter(o => o.status === 'claimed' || o.status === 'cancelled');
  if (q) orders = orders.filter(o => (o.studentName || '').toLowerCase().includes(q) || (o.itemName || '').toLowerCase().includes(q));

  const list = document.getElementById('pos-hist-list');
  if (!list) return;
  if (!orders.length) { list.innerHTML = `<div style="text-align:center;padding:48px;color:var(--text-muted);font-size:13px"><div style="font-size:40px;margin-bottom:12px">📋</div>No history found.</div>`; return; }

  const totalPages = Math.max(1, Math.ceil(orders.length / _POS_HIST_PAGE_SIZE));
  if (_posHistPage > totalPages) _posHistPage = totalPages;
  const start = (_posHistPage - 1) * _POS_HIST_PAGE_SIZE;
  const shown = orders.slice(start, start + _POS_HIST_PAGE_SIZE);

  list.innerHTML = `<table class="admin-table" style="width:100%">
    <thead><tr><th>Item</th><th>Student</th><th>Claim Code</th><th>Coins</th><th>Ordered</th><th>Status</th><th>Resolved</th></tr></thead>
    <tbody>${shown.map(o => `<tr>
      <td><span style="font-size:16px;margin-right:6px">${o.emoji || '🎁'}</span>${_esc(o.itemName)}</td>
      <td><div style="display:flex;align-items:center;gap:7px"><span style="width:24px;height:24px;border-radius:50%;background:${o.studentColor || '#8b5cf6'}22;border:1px solid ${o.studentColor || '#8b5cf6'}44;color:${o.studentColor || '#8b5cf6'};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;font-family:var(--fh)">${_esc(o.studentInit || '?')}</span>${_esc(o.studentName)}</div></td>
      <td><span style="font-family:var(--fm);font-size:11px;color:${o.status === 'claimed' ? 'var(--secondary)' : 'var(--text-muted)'}">${_esc(o.claimCode)}</span></td>
      <td><span style="color:var(--tertiary);font-weight:700">${(o.cost || 0).toLocaleString()}</span></td>
      <td style="color:var(--text-muted);font-size:12px">${_esc(o.createdDateStr || '')}</td>
      <td>${ordStatusPill(o.status)}</td>
      <td style="color:var(--text-muted);font-size:11px">${o.claimedAt ? new Date(o.claimedAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : o.cancelledAt ? new Date(o.cancelledAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
    </tr>`).join('')}</tbody>
  </table>
  ${_posHistPagination(_posHistPage, totalPages, orders.length, start + 1, start + shown.length)}`;
};

// ── Analytics ─────────────────────────────────────────────────────────────────

function _posAnalyticsHTML() {
  DB = loadDB();
  const orders    = DB.orders || [];
  const today     = isoDate ? isoDate() : new Date().toISOString().slice(0, 10);
  const todayOrds = orders.filter(o => o.status === 'claimed' && o.claimedAt && new Date(o.claimedAt).toISOString().slice(0, 10) === today);
  const weekAgo   = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const weekOrds  = orders.filter(o => o.status === 'claimed' && o.claimedAt && new Date(o.claimedAt) >= weekAgo);
  const totalCoinsSpent = orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + (o.cost || 0), 0);

  const itemCounts = {};
  orders.filter(o => o.status === 'claimed').forEach(o => {
    if (!itemCounts[o.itemId]) itemCounts[o.itemId] = { name: o.itemName, emoji: o.emoji, count: 0, coins: 0 };
    itemCounts[o.itemId].count++;
    itemCounts[o.itemId].coins += (o.cost || 0);
  });
  const topItems = Object.values(itemCounts).sort((a, b) => b.count - a.count).slice(0, 8);

  const dailyCounts = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dailyCounts[key] = { label: d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }), count: 0 };
  }
  weekOrds.forEach(o => { const k = new Date(o.claimedAt).toISOString().slice(0, 10); if (dailyCounts[k]) dailyCounts[k].count++; });
  const maxDay = Math.max(1, ...Object.values(dailyCounts).map(d => d.count));

  const catCounts  = { food: 0, supplies: 0, privilege: 0, mystery: 0 };
  orders.filter(o => o.status === 'claimed').forEach(o => { catCounts[o.category] = (catCounts[o.category] || 0) + 1; });
  const catTotal   = Object.values(catCounts).reduce((s, c) => s + c, 0) || 1;
  const catColors  = { food: 'var(--secondary)', supplies: 'var(--primary)', privilege: 'var(--tertiary)', mystery: '#fb923c' };
  const catIcons   = { food: '🍔', supplies: '📦', privilege: '⭐', mystery: '❓' };
  const catLabels  = { food: 'Food', supplies: 'Supplies', privilege: 'Privilege', mystery: 'Mystery' };

  return `
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:28px">
    <div class="pos-stat-card"><div class="pos-stat-val" style="color:var(--secondary)">${todayOrds.length}</div><div class="pos-stat-lbl">Today's Redemptions</div></div>
    <div class="pos-stat-card"><div class="pos-stat-val" style="color:var(--primary)">${weekOrds.length}</div><div class="pos-stat-lbl">This Week</div></div>
    <div class="pos-stat-card"><div class="pos-stat-val" style="color:var(--tertiary)">${totalCoinsSpent.toLocaleString()}</div><div class="pos-stat-lbl">Total Coins Spent</div></div>
    <div class="pos-stat-card"><div class="pos-stat-val" style="color:#4edea3">${orders.filter(o => o.status === 'claimed').length}</div><div class="pos-stat-lbl">All-Time Claimed</div></div>
    <div class="pos-stat-card"><div class="pos-stat-val" style="color:var(--error)">${orders.filter(o => o.status === 'cancelled').length}</div><div class="pos-stat-lbl">Cancelled</div></div>
    <div class="pos-stat-card"><div class="pos-stat-val" style="color:#fb923c">${orders.filter(o => o.status === 'pending').length}</div><div class="pos-stat-lbl">Still Pending</div></div>
  </div>
  <div style="display:grid;grid-template-columns:1.2fr .8fr;gap:20px;margin-bottom:24px">
    <div class="glass-card">
      <h3 style="margin-bottom:16px">📅 Daily Redemptions (Last 7 Days)</h3>
      <div style="display:flex;align-items:flex-end;gap:8px;height:100px;padding-bottom:4px">
        ${Object.values(dailyCounts).map(d => { const pct = Math.round(d.count / maxDay * 100) || 0; return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px"><div style="font-size:10px;color:var(--secondary);font-weight:700">${d.count > 0 ? d.count : ''}</div><div style="width:100%;background:${d.count > 0 ? 'rgba(78,222,163,.7)' : 'rgba(255,255,255,.05)'};border-radius:4px 4px 0 0;height:${Math.max(4, pct)}px;min-height:4px;transition:height .3s"></div><div style="font-size:9px;color:var(--text-muted);text-align:center;white-space:nowrap;overflow:hidden;max-width:40px">${d.label.split(',')[0]}</div></div>`; }).join('')}
      </div>
    </div>
    <div class="glass-card">
      <h3 style="margin-bottom:14px">📦 By Category</h3>
      ${Object.entries(catCounts).map(([cat, count]) => { const pct = Math.round(count / catTotal * 100); return `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><span style="color:var(--text-muted)">${catIcons[cat] || ''} ${catLabels[cat] || cat}</span><span style="color:${catColors[cat] || 'var(--text-muted)'};font-weight:700">${count} <span style="color:var(--text-muted);font-weight:400">(${pct}%)</span></span></div><div style="background:rgba(255,255,255,.05);border-radius:4px;height:6px;overflow:hidden"><div style="height:100%;border-radius:4px;background:${catColors[cat] || 'var(--primary)'};width:${pct}%;transition:width .4s"></div></div></div>`; }).join('')}
    </div>
  </div>
  <div class="glass-card">
    <h3 style="margin-bottom:16px">🏆 Most Redeemed Items</h3>
    ${!topItems.length ? `<div style="text-align:center;padding:28px;color:var(--text-muted);font-size:13px">No redemptions yet.</div>`
    : topItems.map((item, i) => `<div class="item-rank-chip"><div class="item-rank-num">#${i + 1}</div><div style="font-size:22px;flex-shrink:0">${item.emoji || '🎁'}</div><div style="flex:1;min-width:0"><div style="font-family:var(--fh);font-size:13px;font-weight:800;color:var(--on-surface)">${_esc(item.name)}</div><div style="font-size:11px;color:var(--text-muted)"><span style="color:var(--tertiary)">${item.coins.toLocaleString()} coins</span> total spent</div></div><div style="text-align:right;flex-shrink:0"><div style="font-family:var(--fh);font-size:20px;font-weight:900;color:var(--secondary)">${item.count}</div><div style="font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.05em;text-transform:uppercase">claimed</div></div></div>`).join('')}
  </div>`;
}

// ── renderAnalytics patch ─────────────────────────────────────────────────────
// Injects POS & Orders summary block at the top of the admin analytics page.
;(function () {
  const _orig = window.renderAnalytics;
  window.renderAnalytics = function () {
    if (typeof _orig === 'function') _orig();
    DB = loadDB();
    const orders  = DB.orders || [];
    const pending = orders.filter(o => o.status === 'pending').length;
    const claimed = orders.filter(o => o.status === 'claimed').length;
    const sect    = document.getElementById('a-analytics');
    if (!sect) return;
    const block = `
    <div style="background:rgba(26,20,56,.8);border:1px solid rgba(78,222,163,.2);border-radius:16px;padding:20px;margin-bottom:24px">
      <div style="font-family:var(--fm);font-size:9px;color:var(--secondary);letter-spacing:.16em;margin-bottom:14px;text-transform:uppercase">🏪 POS & Orders Overview</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px">
        <div class="pos-stat-card"><div class="pos-stat-val" style="color:var(--tertiary)">${pending}</div><div class="pos-stat-lbl">Pending Orders</div></div>
        <div class="pos-stat-card"><div class="pos-stat-val" style="color:var(--secondary)">${claimed}</div><div class="pos-stat-lbl">Claimed Rewards</div></div>
        <div class="pos-stat-card"><div class="pos-stat-val" style="color:var(--primary)">${orders.length}</div><div class="pos-stat-lbl">Total Orders</div></div>
        <div class="pos-stat-card"><div class="pos-stat-val" style="color:#ffb95f">${orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + (o.cost || 0), 0).toLocaleString()}</div><div class="pos-stat-lbl">Coins Spent</div></div>
      </div>
      <div style="margin-top:14px"><button class="btn btn-ghost btn-sm" onclick="navTo('a-pos')"><span class="material-symbols-outlined" style="font-size:14px">point_of_sale</span> Open POS Terminal</button></div>
    </div>`;
    sect.innerHTML = block + (sect.innerHTML || '');
  };
})();

console.log('[EduQuest] shop/pos-terminal.js loaded — renderPOS, pos* functions, renderAnalytics patched.');
