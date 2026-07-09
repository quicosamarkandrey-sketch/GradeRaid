// ══════════════════════════════════════════════════════
//  modules/admin/audit-log.js
//  Audit Log — admin-only screen (Chunk E, viewer half).
//  (ISOLATION_ROLES_PLAN.md Chunk E "Governance" — see
//   supabase/phase40_governance_audit_and_settings.sql and
//   audit-log-service.js, both already shipped ahead of this file.)
//
//  audit-log-service.js and its RPCs (log_edit_as_action / get_audit_log)
//  already existed and were already wired into Chunk C's "Edit as" writes
//  (content-oversight-service.js calls AuditLogService.logEditAsAction()
//  on every write) — this file is the missing other half: an admin-facing
//  screen to actually read that log back. Nothing here changes the SQL or
//  the write path.
//
//  Filtering: get_audit_log() only takes an optional target_teacher_id
//  server-side (see its SQL). Action/table filters below are applied
//  client-side against the fetched batch rather than adding new RPC
//  params — this is a small, classroom-scale table (one row per "Edit as"
//  write), so a client-side filter over the current fetch is simpler than
//  a SQL change for what's still a light-traffic log.
//
//  REPOSITORY PATTERN: this file never calls DBService.rpc() directly —
//  only AuditLogService (for log rows) and TeacherDirectoryService (to
//  resolve actor_id/target_teacher_id into names for display, and to
//  populate the "Filter by teacher" dropdown).
//
//  Exports: renderAuditLog, auditLogSetTeacherFilter, auditLogSetActionFilter,
//           auditLogSetTableFilter, auditLogLoadMore
// ══════════════════════════════════════════════════════

const AUDIT_LOG_DEFAULT_LIMIT = 200;
const AUDIT_LOG_LOAD_MORE_STEP = 200;

let _auditLogLoading = false;
let _auditLogError = null;
let _auditLogRows = null;        // raw rows from the last fetch (server-side teacher filter already applied)
let _auditLogLimit = AUDIT_LOG_DEFAULT_LIMIT;
let _auditLogTeacherFilter = null; // target_teacher_id, or null = all teachers
let _auditLogActionFilter = null;  // 'create' | 'update' | 'delete', client-side only
let _auditLogTableFilter = null;   // table_name, client-side only
let _auditLogTeachers = null;     // TeacherDirectoryService rows, for names + the filter dropdown
let _auditLogNameById = {};       // id -> displayName lookup built from _auditLogTeachers

window.renderAuditLog = async function () {
  const el = document.getElementById('a-audit-log');
  if (!el) return;

  // Defense in depth: nav.js already hides this tab and bounces direct
  // navTo() calls for a non-admin — this should be unreachable, but never
  // show an oversight screen to a teacher account regardless.
  if (currentRole !== 'admin') {
    el.innerHTML = `
    <div class="glass-card" style="padding:32px;text-align:center">
      <span class="material-symbols-outlined" style="font-size:40px;color:var(--text-muted)">lock</span>
      <h2 style="font-family:var(--fh);font-size:18px;margin:12px 0 4px">Admin only</h2>
      <p style="font-size:13px;color:var(--text-muted)">This screen is only available to oversight admin accounts.</p>
    </div>`;
    return;
  }

  _auditLogLoading = true;
  _auditLogError = null;
  _auditLogRows = null;
  _auditLogRenderShell(el);

  const [logResult, dirResult] = await Promise.all([
    AuditLogService.getLog({ targetTeacherId: _auditLogTeacherFilter, limit: _auditLogLimit }),
    _auditLogTeachers ? Promise.resolve({ ok: true, teachers: _auditLogTeachers }) : TeacherDirectoryService.getDirectory(),
  ]);

  _auditLogLoading = false;
  if (!logResult.ok) {
    _auditLogError = logResult.error;
    _auditLogRows = null;
  } else {
    _auditLogRows = logResult.rows;
  }

  if (dirResult.ok) {
    _auditLogTeachers = dirResult.teachers;
    _auditLogNameById = {};
    _auditLogTeachers.forEach(t => { _auditLogNameById[t.id] = t.displayName || t.email || t.id; });
  }

  if (document.getElementById('a-audit-log')) _auditLogRenderShell(document.getElementById('a-audit-log'));
};

window.auditLogSetTeacherFilter = function (teacherId) {
  _auditLogTeacherFilter = teacherId || null;
  _auditLogLimit = AUDIT_LOG_DEFAULT_LIMIT; // fresh page size on a new server-side filter
  window.renderAuditLog();
};

window.auditLogSetActionFilter = function (action) {
  _auditLogActionFilter = action || null;
  _auditLogRenderShell(document.getElementById('a-audit-log'));
};

window.auditLogSetTableFilter = function (tableName) {
  _auditLogTableFilter = tableName || null;
  _auditLogRenderShell(document.getElementById('a-audit-log'));
};

window.auditLogLoadMore = async function () {
  if (_auditLogLoading || !_auditLogRows) return;
  _auditLogLimit += AUDIT_LOG_LOAD_MORE_STEP;
  _auditLogLoading = true;
  _auditLogRenderShell(document.getElementById('a-audit-log'));

  const result = await AuditLogService.getLog({ targetTeacherId: _auditLogTeacherFilter, limit: _auditLogLimit });
  _auditLogLoading = false;

  if (!result.ok) {
    toast('❌ ' + (result.error || 'Could not load more entries.'), '#ffb4ab');
  } else {
    _auditLogRows = result.rows;
  }
  if (document.getElementById('a-audit-log')) _auditLogRenderShell(document.getElementById('a-audit-log'));
};

function _auditLogRenderShell(el) {
  if (!el) return;
  el.innerHTML = `
  <div class="page-hero">
    <div class="page-hero-bg"></div>
    <div style="position:relative;z-index:1">
      <div class="page-hero-label">🛠️ Oversight</div>
      <h1 style="font-family:var(--fh);font-size:32px;font-weight:900;color:var(--on-surface);margin-bottom:8px">Audit Log</h1>
      <p style="font-size:14px;color:var(--text-muted)">Every write made while an admin was in "Edit as" mode for a teacher's content.</p>
    </div>
  </div>
  ${_auditLogFilterBar()}
  ${_auditLogBody()}
  `;
}

function _auditLogFilterBar() {
  const teachers = (_auditLogTeachers || []).slice().sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  const teacherOptions = teachers.map(t =>
    `<option value="${_esc(t.id)}" ${_auditLogTeacherFilter === t.id ? 'selected' : ''}>${_esc(t.displayName || t.email || t.id)}</option>`
  ).join('');

  const tableNames = Array.from(new Set((_auditLogRows || []).map(r => r.table_name).filter(Boolean))).sort();
  const tableOptions = tableNames.map(tn =>
    `<option value="${_esc(tn)}" ${_auditLogTableFilter === tn ? 'selected' : ''}>${_esc(tn)}</option>`
  ).join('');

  return `
  <div class="glass-card" style="padding:14px 16px;margin-bottom:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
    <div>
      <label style="display:block;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Teacher</label>
      <select id="audit-log-teacher-filter" style="width:auto;min-width:200px" onchange="auditLogSetTeacherFilter(this.value)">
        <option value="">All teachers</option>
        ${teacherOptions}
      </select>
    </div>
    <div>
      <label style="display:block;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Action</label>
      <select id="audit-log-action-filter" style="width:auto;min-width:130px" onchange="auditLogSetActionFilter(this.value)">
        <option value="">All actions</option>
        <option value="create" ${_auditLogActionFilter === 'create' ? 'selected' : ''}>Create</option>
        <option value="update" ${_auditLogActionFilter === 'update' ? 'selected' : ''}>Update</option>
        <option value="delete" ${_auditLogActionFilter === 'delete' ? 'selected' : ''}>Delete</option>
      </select>
    </div>
    <div>
      <label style="display:block;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Table</label>
      <select id="audit-log-table-filter" style="width:auto;min-width:150px" onchange="auditLogSetTableFilter(this.value)">
        <option value="">All tables</option>
        ${tableOptions}
      </select>
    </div>
    ${(_auditLogTeacherFilter || _auditLogActionFilter || _auditLogTableFilter) ? `
    <button class="btn btn-ghost btn-sm" style="align-self:flex-end" onclick="auditLogSetTeacherFilter('');auditLogSetActionFilter('');auditLogSetTableFilter('')">Clear filters</button>
    ` : ''}
  </div>`;
}

function _auditLogFilteredRows() {
  let rows = _auditLogRows || [];
  if (_auditLogActionFilter) rows = rows.filter(r => r.action === _auditLogActionFilter);
  if (_auditLogTableFilter) rows = rows.filter(r => r.table_name === _auditLogTableFilter);
  return rows;
}

function _auditLogBody() {
  if (_auditLogLoading && !_auditLogRows) {
    return `<div class="glass-card" style="padding:32px;text-align:center;color:var(--text-muted);font-size:13px">Loading audit log…</div>`;
  }
  if (_auditLogError) {
    return `
    <div class="glass-card" style="padding:32px;text-align:center">
      <span class="material-symbols-outlined" style="font-size:36px;color:#ffb4ab">error</span>
      <p style="font-size:13px;color:var(--text-muted);margin:10px 0 16px">${_esc(_auditLogError)}</p>
      <button class="btn btn-primary btn-sm" onclick="renderAuditLog()">Retry</button>
    </div>`;
  }

  const allRows = _auditLogRows || [];
  const rows = _auditLogFilteredRows();

  if (allRows.length === 0) {
    return `
    <div class="glass-card" style="padding:32px;text-align:center;color:var(--text-muted);font-size:13px">
      No "Edit as" actions logged yet.
    </div>`;
  }
  if (rows.length === 0) {
    return `
    <div class="glass-card" style="padding:32px;text-align:center;color:var(--text-muted);font-size:13px">
      No entries match the current filters.
    </div>`;
  }

  const cols = '150px 1fr 1fr 1.2fr 90px 1fr';
  // get_audit_log() has no offset — "load more" widens the same server-side
  // limit and refetches, so this is only a meaningful action while the
  // fetched batch is still exactly at the current limit (i.e. there could
  // be more rows beyond it).
  const canLoadMore = allRows.length >= _auditLogLimit && _auditLogLimit < 1000;

  return `
  <div class="glass-card" style="padding:0;overflow:hidden">
    <div style="display:grid;grid-template-columns:${cols};gap:10px;align-items:center;padding:10px 16px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);border-bottom:1px solid var(--border2)">
      <span>When</span><span>Admin</span><span>Teacher</span><span>Table · Record</span><span>Action</span><span>Details</span>
    </div>
    ${rows.map(_auditLogRow).join('')}
  </div>
  ${canLoadMore ? `
  <div style="text-align:center;margin-top:14px">
    <button class="btn btn-ghost btn-sm" ${_auditLogLoading ? 'disabled' : ''} onclick="auditLogLoadMore()">
      ${_auditLogLoading ? 'Loading…' : `Load more (showing latest ${allRows.length})`}
    </button>
  </div>` : `
  <div style="text-align:center;margin-top:10px;font-size:11px;color:var(--text-muted)">Showing ${rows.length}${rows.length !== allRows.length ? ` of ${allRows.length} loaded` : ''} entries</div>
  `}`;
}

function _auditLogRow(r) {
  const actorName = _auditLogNameById[r.actor_id] || r.actor_id;
  const targetName = _auditLogNameById[r.target_teacher_id] || r.target_teacher_id;
  const detailsStr = (r.details && Object.keys(r.details).length) ? _esc(JSON.stringify(r.details)) : '';
  const actionColor = r.action === 'delete' ? 'btn-danger' : (r.action === 'create' ? 'btn-success' : 'btn-primary');

  return `
  <div style="display:grid;grid-template-columns:150px 1fr 1fr 1.2fr 90px 1fr;gap:10px;align-items:start;padding:12px 16px;border-bottom:1px solid var(--border2)">
    <div style="font-size:11px;color:var(--text-muted)">${_auditLogFormatDate(r.created_at)}</div>
    <div style="font-size:13px;font-weight:700;color:var(--on-surface)">${_esc(actorName)}</div>
    <div style="font-size:12px;color:var(--on-surface)">${_esc(targetName)}</div>
    <div style="font-size:12px;color:var(--text-muted)">${_esc(r.table_name)}<div style="font-size:10px;opacity:.7;word-break:break-all">${_esc(r.record_id)}</div></div>
    <span class="btn btn-xs ${actionColor}" style="width:fit-content;pointer-events:none;text-transform:capitalize">${_esc(r.action)}</span>
    <div style="font-size:10px;color:var(--text-muted);word-break:break-word">${detailsStr}${r.session_id ? `<div style="opacity:.6;margin-top:2px">session: ${_esc(r.session_id)}</div>` : ''}</div>
  </div>`;
}

function _auditLogFormatDate(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return '—'; }
}
