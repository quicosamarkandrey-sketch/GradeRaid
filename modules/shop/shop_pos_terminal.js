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
  ['scanner', 'queue', 'history', 'analytics'].forEach(t => {
    const btn   = document.getElementById('postab-' + t);
    const panel = document.getElementById('pos-panel-' + t);
    if (btn)   btn.classList.toggle('active', t === tab);
    if (panel) panel.style.display = t === tab ? 'block' : 'none';
  });
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

window.posFilterHistory = function () {
  DB = loadDB();
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

  list.innerHTML = `<table class="admin-table" style="width:100%">
    <thead><tr><th>Item</th><th>Student</th><th>Claim Code</th><th>Coins</th><th>Ordered</th><th>Status</th><th>Resolved</th></tr></thead>
    <tbody>${orders.map(o => `<tr>
      <td><span style="font-size:16px;margin-right:6px">${o.emoji || '🎁'}</span>${_esc(o.itemName)}</td>
      <td><div style="display:flex;align-items:center;gap:7px"><span style="width:24px;height:24px;border-radius:50%;background:${o.studentColor || '#8b5cf6'}22;border:1px solid ${o.studentColor || '#8b5cf6'}44;color:${o.studentColor || '#8b5cf6'};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;font-family:var(--fh)">${_esc(o.studentInit || '?')}</span>${_esc(o.studentName)}</div></td>
      <td><span style="font-family:var(--fm);font-size:11px;color:${o.status === 'claimed' ? 'var(--secondary)' : 'var(--text-muted)'}">${_esc(o.claimCode)}</span></td>
      <td><span style="color:var(--tertiary);font-weight:700">${(o.cost || 0).toLocaleString()}</span></td>
      <td style="color:var(--text-muted);font-size:12px">${_esc(o.createdDateStr || '')}</td>
      <td>${ordStatusPill(o.status)}</td>
      <td style="color:var(--text-muted);font-size:11px">${o.claimedAt ? new Date(o.claimedAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : o.cancelledAt ? new Date(o.cancelledAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
    </tr>`).join('')}</tbody>
  </table>`;
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
