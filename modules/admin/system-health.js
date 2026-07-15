// ══════════════════════════════════════════════════════
//  modules/admin/system-health.js
//  Admin System Health page (a-system-health) — ADMIN_SYSTEM_HEALTH.md
//  Phase 3 (render layer). Phase 1 (data) and Phase 2 (service layer +
//  heartbeat + error capture) already shipped — see
//  modules/admin/system-health-service.js and error-capture.js.
//
//  WHAT'S HERE
//    Stat cards: online now / total users / total teachers / total
//    students, from SystemHealthService.getUserCounts().
//    Error log table: filterable (resolved status, role) and paginated
//    (same "load more" pattern as audit-log.js — get_client_error_logs()
//    has no offset, so "load more" widens the same server-side limit and
//    refetches), with a resolve/un-resolve toggle per row.
//
//  REPOSITORY PATTERN: this file never calls DBService.rpc() directly —
//  only SystemHealthService.
//
//  PHASE 4 (polish) — auto-refresh interval for the live counts only, added
//  here. Same self-clearing "stop if the page isn't active anymore" pattern
//  as _adminStoreInterval in shop_admin_store.js, plus the matching explicit
//  clear in nav.js's navTo() when leaving a-system-health. Deliberately
//  scoped to the stat cards ONLY (re-fetches getUserCounts() and patches
//  just the #sh-stat-cards node) — the error log table is left alone so an
//  admin mid-filter, mid-"load more", or with a stack trace expanded never
//  gets their state clobbered by a background tick.
//
//  STILL NOT DECIDED/BUILT (see ADMIN_SYSTEM_HEALTH.md "Open items"):
//    - Tuning the "online now" 2-minute window — needs real heartbeat
//      traffic to observe, not something to guess at in code.
//    - Bulk/retention cleanup for client_error_logs — doc explicitly flags
//      this as "not decided which" approach; not folded in here.
//  Empty/loading states for the error log table are left matching the same
//  plain-text convention audit-log.js already uses elsewhere in the admin
//  section — that IS the app's baseline, not a placeholder to upgrade.
//
//  Exports: renderSystemHealth, shSetResolvedFilter, shSetRoleFilter,
//           shLoadMoreLogs, shToggleResolved, shToggleStack
// ══════════════════════════════════════════════════════

const SH_LOG_DEFAULT_LIMIT = 200;
const SH_LOG_LOAD_MORE_STEP = 200;
const SH_COUNTS_REFRESH_MS = 30000; // stat cards only — half the heartbeat interval, no reason to go faster

let _shCountsInterval = null;

let _shCountsLoading = false;
let _shCounts = null;             // { total_users, total_admins, total_teachers, total_students, online_now }
let _shCountsError = null;

let _shLogsLoading = false;
let _shLogsError = null;
let _shLogRows = null;            // raw rows from the last fetch (server-side resolved/role filters already applied)
let _shLogLimit = SH_LOG_DEFAULT_LIMIT;
let _shResolvedFilter = null;     // true | false | null (= all)
let _shRoleFilter = null;         // 'admin' | 'teacher' | 'student' | null (= all)
let _shExpandedStackIds = {};     // id -> true, which rows have their stack trace expanded
let _shBusyId = null;             // error log id currently mid resolve/un-resolve toggle

window.renderSystemHealth = async function () {
  const el = document.getElementById('a-system-health');
  if (!el) return;

  // Defense in depth: nav.js already hides this tab and bounces direct
  // navTo() calls for a non-admin — this should be unreachable, but never
  // show the counts/error log to a teacher account regardless (both
  // get_admin_user_counts() and get_client_error_logs() are admin-gated
  // server-side too, so a teacher would just see an RPC error otherwise).
  if (currentRole !== 'admin') {
    el.innerHTML = `
    <div class="glass-card" style="padding:32px;text-align:center">
      <span class="material-symbols-outlined" style="font-size:40px;color:var(--text-muted)">lock</span>
      <h2 style="font-family:var(--fh);font-size:18px;margin:12px 0 4px">Admin only</h2>
      <p style="font-size:13px;color:var(--text-muted)">This screen is only available to oversight admin accounts.</p>
    </div>`;
    return;
  }

  _shCountsLoading = true;
  _shCountsError = null;
  _shLogsLoading = true;
  _shLogsError = null;
  _shLogRows = null;
  _shRenderShell(el);

  const [countsResult, logsResult] = await Promise.all([
    SystemHealthService.getUserCounts(),
    SystemHealthService.getErrorLogs({ resolved: _shResolvedFilter, role: _shRoleFilter, limit: _shLogLimit }),
  ]);

  _shCountsLoading = false;
  if (!countsResult.ok) { _shCountsError = countsResult.error; _shCounts = null; }
  else { _shCounts = countsResult.counts; }

  _shLogsLoading = false;
  if (!logsResult.ok) { _shLogsError = logsResult.error; _shLogRows = null; }
  else { _shLogRows = logsResult.rows; }

  if (document.getElementById('a-system-health')) _shRenderShell(document.getElementById('a-system-health'));
  _shStartCountsRefresh();
};

/**
 * shStopCountsRefresh() — [window.shStopCountsRefresh] called from nav.js's
 * navTo() when leaving a-system-health, same explicit-clear pairing as
 * _adminStoreInterval for a-store. Also self-clears from inside the tick
 * itself if the page ever goes inactive without navTo() catching it first
 * (belt-and-suspenders, matching the shop_admin_store.js precedent).
 */
window.shStopCountsRefresh = function () {
  if (_shCountsInterval) { clearInterval(_shCountsInterval); _shCountsInterval = null; }
};

function _shStartCountsRefresh() {
  shStopCountsRefresh();
  _shCountsInterval = setInterval(async function () {
    const page = document.getElementById('a-system-health');
    if (!page || !page.classList.contains('active')) { shStopCountsRefresh(); return; }
    const result = await SystemHealthService.getUserCounts();
    // Re-check after the await — the admin may have navigated away while
    // this was in-flight.
    const stillHere = document.getElementById('a-system-health');
    if (!stillHere || !stillHere.classList.contains('active') || !_shCountsInterval) return;
    // A transient failure on a background tick isn't worth surfacing over
    // whatever counts are already on screen — just skip this tick and let
    // the next one try again. Only a fetch triggered by the admin (page
    // load / Retry button) shows the error state.
    if (!result.ok) return;
    _shCounts = result.counts;
    _shCountsError = null;
    const cardsEl = document.getElementById('sh-stat-cards');
    if (cardsEl) cardsEl.outerHTML = _shCountsHTML();
  }, SH_COUNTS_REFRESH_MS);
}

window.shSetResolvedFilter = function (value) {
  // value: '' (all) | 'unresolved' | 'resolved'
  _shResolvedFilter = value === 'unresolved' ? false : value === 'resolved' ? true : null;
  _shLogLimit = SH_LOG_DEFAULT_LIMIT; // fresh page size on a new server-side filter
  _shRefetchLogs();
};

window.shSetRoleFilter = function (value) {
  _shRoleFilter = value || null;
  _shLogLimit = SH_LOG_DEFAULT_LIMIT;
  _shRefetchLogs();
};

async function _shRefetchLogs() {
  _shLogsLoading = true;
  _shLogsError = null;
  _shRenderShell(document.getElementById('a-system-health'));

  const result = await SystemHealthService.getErrorLogs({ resolved: _shResolvedFilter, role: _shRoleFilter, limit: _shLogLimit });
  _shLogsLoading = false;

  if (!result.ok) { _shLogsError = result.error; _shLogRows = null; }
  else { _shLogRows = result.rows; }

  if (document.getElementById('a-system-health')) _shRenderShell(document.getElementById('a-system-health'));
}

window.shLoadMoreLogs = async function () {
  if (_shLogsLoading || !_shLogRows) return;
  _shLogLimit += SH_LOG_LOAD_MORE_STEP;
  await _shRefetchLogs();
};

window.shToggleStack = function (id) {
  _shExpandedStackIds[id] = !_shExpandedStackIds[id];
  _shRenderShell(document.getElementById('a-system-health'));
};

window.shToggleResolved = async function (id, currentlyResolved) {
  if (_shBusyId) return;
  _shBusyId = id;
  _shRenderShell(document.getElementById('a-system-health'));

  const result = await SystemHealthService.resolveErrorLog({ id, resolved: !currentlyResolved });
  _shBusyId = null;

  if (!result.ok) {
    toast('❌ ' + (result.error || 'Could not update this error log.'), '#ffb4ab');
  } else {
    toast(currentlyResolved ? '✅ Marked unresolved.' : '✅ Marked resolved.');
    // Patch the row in place rather than a full refetch — same list, one
    // field changed, and a refetch would also reset scroll position.
    if (_shLogRows) {
      const row = _shLogRows.find(r => r.id === id);
      if (row) row.resolved = !currentlyResolved;
    }
  }
  if (document.getElementById('a-system-health')) _shRenderShell(document.getElementById('a-system-health'));
};

function _shRenderShell(el) {
  if (!el) return;
  el.innerHTML = `
  <div class="page-hero">
    <div class="page-hero-bg"></div>
    <div style="position:relative;z-index:1">
      <div class="page-hero-label">🩺 Oversight</div>
      <h1 style="font-family:var(--fh);font-size:32px;font-weight:900;color:var(--on-surface);margin-bottom:8px">System Health</h1>
      <p style="font-size:14px;color:var(--text-muted)">Who's online, how many accounts exist, and what's gone wrong on the client.</p>
    </div>
  </div>
  ${_shCountsHTML()}
  ${_shFilterBarHTML()}
  ${_shLogsHTML()}
  `;
}

// ── STAT CARDS ──────────────────────────────────────────────────────────
function _shCountsHTML() {
  // Wrapped in #sh-stat-cards so _shStartCountsRefresh() can patch just this
  // node on each 30s tick without touching the filter bar / log table below
  // (which have their own loading/scroll/expanded-row state to preserve).
  if (_shCountsLoading && !_shCounts) {
    return `<div id="sh-stat-cards"><div class="stat-grid" style="margin-bottom:24px">
      ${[0, 1, 2, 3].map(() => `<div class="stat-card"><div class="val" style="color:var(--text-muted)">—</div><div class="lbl">Loading…</div></div>`).join('')}
    </div></div>`;
  }
  if (_shCountsError) {
    return `
    <div id="sh-stat-cards">
    <div class="glass-card" style="padding:20px;margin-bottom:24px;text-align:center">
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:10px">${_esc(_shCountsError)}</p>
      <button class="btn btn-primary btn-sm" onclick="renderSystemHealth()">Retry</button>
    </div>
    </div>`;
  }
  const c = _shCounts || {};
  return `
  <div id="sh-stat-cards">
  <div class="stat-grid" style="margin-bottom:24px">
    <div class="stat-card">
      <div class="val" style="color:#4edea3">${c.online_now ?? 0}</div>
      <div class="lbl">Online Now</div>
    </div>
    <div class="stat-card"><div class="val" style="color:#d0bcff">${c.total_users ?? 0}</div><div class="lbl">Total Users</div></div>
    <div class="stat-card"><div class="val" style="color:#ffb95f">${c.total_teachers ?? 0}</div><div class="lbl">Teachers</div></div>
    <div class="stat-card"><div class="val" style="color:#fb923c">${c.total_students ?? 0}</div><div class="lbl">Students</div></div>
  </div>
  <p style="font-size:11px;color:var(--text-muted);margin:-14px 0 24px">
    "Online now" = active in the last 2 minutes (heartbeat-based, not a live socket count — see ADMIN_SYSTEM_HEALTH.md).
    ${(c.total_admins || 0) > 0 ? ` ${c.total_admins} admin account${c.total_admins === 1 ? '' : 's'} not shown above.` : ''}
  </p>
  </div>`;
}

// ── FILTER BAR ───────────────────────────────────────────────────────────
function _shFilterBarHTML() {
  const resolvedValue = _shResolvedFilter === false ? 'unresolved' : _shResolvedFilter === true ? 'resolved' : '';
  return `
  <div class="glass-card sh-filter-bar">
    <div>
      <label>Status</label>
      <select id="sh-resolved-filter" style="width:auto;min-width:150px" onchange="shSetResolvedFilter(this.value)">
        <option value="" ${resolvedValue === '' ? 'selected' : ''}>All</option>
        <option value="unresolved" ${resolvedValue === 'unresolved' ? 'selected' : ''}>Unresolved</option>
        <option value="resolved" ${resolvedValue === 'resolved' ? 'selected' : ''}>Resolved</option>
      </select>
    </div>
    <div>
      <label>Role</label>
      <select id="sh-role-filter" style="width:auto;min-width:140px" onchange="shSetRoleFilter(this.value)">
        <option value="" ${!_shRoleFilter ? 'selected' : ''}>All roles</option>
        <option value="admin" ${_shRoleFilter === 'admin' ? 'selected' : ''}>Admin</option>
        <option value="teacher" ${_shRoleFilter === 'teacher' ? 'selected' : ''}>Teacher</option>
        <option value="student" ${_shRoleFilter === 'student' ? 'selected' : ''}>Student</option>
      </select>
    </div>
    ${(_shResolvedFilter !== null || _shRoleFilter) ? `
    <button class="btn btn-ghost btn-sm" style="align-self:flex-end" onclick="shSetResolvedFilter('');shSetRoleFilter('')">Clear filters</button>
    ` : ''}
  </div>`;
}

// ── ERROR LOG TABLE ────────────────────────────────────────────────────
function _shLogsHTML() {
  if (_shLogsLoading && !_shLogRows) {
    return `<div class="glass-card" style="padding:32px;text-align:center;color:var(--text-muted);font-size:13px">Loading client error logs…</div>`;
  }
  if (_shLogsError) {
    return `
    <div class="glass-card" style="padding:32px;text-align:center">
      <span class="material-symbols-outlined" style="font-size:36px;color:#ffb4ab">error</span>
      <p style="font-size:13px;color:var(--text-muted);margin:10px 0 16px">${_esc(_shLogsError)}</p>
      <button class="btn btn-primary btn-sm" onclick="renderSystemHealth()">Retry</button>
    </div>`;
  }

  const rows = _shLogRows || [];
  const hasAnyFilter = _shResolvedFilter !== null || !!_shRoleFilter;

  if (rows.length === 0) {
    return `
    <div class="glass-card" style="padding:32px;text-align:center;color:var(--text-muted);font-size:13px">
      ${hasAnyFilter ? 'No entries match the current filters.' : 'No client errors logged yet. 🎉'}
    </div>`;
  }

  // No offset on get_client_error_logs() — "load more" widens the same
  // server-side limit and refetches, same as audit-log.js. Only meaningful
  // while the fetched batch is still exactly at the current limit (there
  // could be more beyond it) and under the RPC's own 1000-row cap.
  const canLoadMore = rows.length >= _shLogLimit && _shLogLimit < 1000;

  return `
  <div class="sh-log-table">
    <div class="sh-log-head">
      <span>When</span><span>Role</span><span>Message</span><span>Source</span><span>Status</span>
    </div>
    ${rows.map(_shLogRow).join('')}
  </div>
  ${canLoadMore ? `
  <div style="text-align:center;margin-top:14px">
    <button class="btn btn-ghost btn-sm" ${_shLogsLoading ? 'disabled' : ''} onclick="shLoadMoreLogs()">
      ${_shLogsLoading ? 'Loading…' : `Load more (showing latest ${rows.length})`}
    </button>
  </div>` : `
  <div style="text-align:center;margin-top:10px;font-size:11px;color:var(--text-muted)">Showing ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}</div>
  `}`;
}

function _shLogRow(r) {
  const roleClass = r.role === 'admin' ? 'admin' : r.role === 'teacher' ? 'teacher' : r.role === 'student' ? 'student' : 'none';
  const roleLabel = r.role || 'anon';
  const stackExpanded = !!_shExpandedStackIds[r.id];
  const busy = _shBusyId === r.id;

  return `
  <div class="sh-log-row ${r.resolved ? 'resolved' : ''}">
    <div data-label="When" style="font-size:11px;color:var(--text-muted)">${_shFormatDate(r.created_at)}</div>
    <div data-label="Role"><span class="sh-role-chip ${roleClass}">${_esc(roleLabel)}</span></div>
    <div data-label="Message">
      <div class="sh-log-msg">${_esc(r.message)}</div>
      ${r.url ? `<div class="sh-log-msg-source">${_esc(r.url)}</div>` : ''}
      ${r.stack ? `
      <span class="sh-log-stack-toggle" onclick="shToggleStack('${_esc(r.id)}')">${stackExpanded ? 'Hide stack trace' : 'Show stack trace'}</span>
      ${stackExpanded ? `<div class="sh-log-stack">${_esc(r.stack)}</div>` : ''}
      ` : ''}
    </div>
    <div data-label="Source" style="font-size:11px;color:var(--text-muted)">${_esc(r.source || '—')}</div>
    <div data-label="Status">
      <button class="btn btn-xs sh-log-resolve-btn ${r.resolved ? 'btn-ghost' : 'btn-success'}" ${busy ? 'disabled' : ''}
        onclick="shToggleResolved('${_esc(r.id)}', ${!!r.resolved})">
        ${busy ? '…' : (r.resolved ? 'Un-resolve' : 'Resolve')}
      </button>
    </div>
  </div>`;
}

function _shFormatDate(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return '—'; }
}
