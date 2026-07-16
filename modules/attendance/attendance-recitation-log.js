// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/attendance/attendance-recitation-log.js
//  "Recitation & Attendance Log" — teacher/admin reporting screen.
//
//  WHAT THIS IS
//    A read-only merged log of every recitation_log + attendance_logs row
//    this session has visibility into, with:
//      • an "All My Sections" overview (per-section stat cards: attendance
//        breakdown + recitation totals), and
//      • a per-section drill-down showing the same entries filtered to one
//        section.
//    Every row shows date, time, student ("who"), and section — exactly the
//    Recitation Command Center (Phase 3) and RFID Attendance (Phase 1) data
//    already being written elsewhere in the app, just read back in one place.
//
//  DATA SOURCE / SCOPING — reads only, never writes
//    draft.attendanceLogs, draft.recitationLog, draft.students, and
//    draft.classSections, straight off AppStore — same slices
//    AttendanceService / RecitationService / SectionService already
//    populate. This file never calls DBService.rpc() or mutates AppStore;
//    it's a pure selector + renderer, same posture as my-section.js's
//    local-fallback path or sections-service.js's getActiveClassIds().
//
//    Section scoping falls out of RLS for free (see
//    phase14_section_isolation.sql §3/§4 — attendance_logs_select_scoped /
//    recitation_log_select_scoped): a `teacher` session's attendanceLogs,
//    recitationLog, and students slices already contain ONLY rows for
//    sections they're staff for. class_sections itself has no such RLS
//    (`class_sections_select_all` — see phase4_section_maker.sql), so the
//    section dropdown/overview cards are built by intersecting
//    draft.classSections (filtered to adviserId === currentUser.id for a
//    teacher, or every section for admin) with whatever classIds actually
//    show up in the scoped log/roster data — same "mine" pattern
//    getMySectionsLabel() already uses in sections-service.js.
//
//  LEGACY / UNSCOPED RECITATION ROWS
//    Pre-Phase-3 recitation_log rows have class_id = null (see
//    phase3_recitation_command_center.sql's migration note). Rather than
//    guess a section for them, they're bucketed under a synthetic
//    "Unassigned / Legacy" pseudo-section that only appears when such rows
//    exist.
//
//  Exports: renderRecitationAttendanceLog, unmountRecitationAttendanceLog,
//           talSetSection, talSetType, talSetRange, talSetSearch,
//           talClearFilters, talShowMore, talExportCsv
// ═══════════════════════════════════════════════════════════════════════════════

let _talSection = 'all';   // 'all' | a classId | '__unassigned__'
let _talType = 'all';      // 'all' | 'attendance' | 'recitation'
let _talRange = 'all';     // 'all' | 'today' | '7' | '30'
let _talSearch = '';       // student-name substring filter
let _talVisibleCount = 150;
let _talSearchDebounce = null;
const _TAL_SUBSCRIBER_KEY = 'recitation-attendance-log';
const _TAL_STATUS_COLORS = { 'Early': '#7fd8ff', 'On Time': '#4edea3', 'Late': '#ffd166', 'Absent': '#ffb4ab', 'Excused': '#c4b5fd' };
const _TAL_STATUS_ICONS  = { 'Early': '🌅', 'On Time': '✅', 'Late': '⏰', 'Absent': '❌', 'Excused': '📝' };

window.renderRecitationAttendanceLog = function () {
  const el = document.getElementById('a-class-logs');
  if (!el) return;

  if (typeof AppStore !== 'undefined' && AppStore.subscribe) {
    AppStore.subscribe(_TAL_SUBSCRIBER_KEY, (state, event) => {
      const type = event && event.type;
      if (
        type === 'attendance:scan-recorded' || type === 'attendance:override' ||
        type === 'attendance:session-closed' ||
        (type && type.indexOf('recitation:') === 0) ||
        (type && type.indexOf('sections:') === 0) ||
        type === 'state:remote-sync' || type === 'state:legacy-sync'
      ) {
        if (document.getElementById('a-class-logs')) _talPaint();
      }
    });
  }

  _talPaint();
};

window.unmountRecitationAttendanceLog = function () {
  if (typeof AppStore !== 'undefined' && AppStore.unsubscribe) AppStore.unsubscribe(_TAL_SUBSCRIBER_KEY);
};

window.talSetSection = function (sectionId) {
  _talSection = sectionId || 'all';
  _talVisibleCount = 150;
  _talPaint();
};

window.talSetType = function (type) {
  _talType = type || 'all';
  _talVisibleCount = 150;
  _talPaint();
};

window.talSetRange = function (range) {
  _talRange = range || 'all';
  _talVisibleCount = 150;
  _talPaint();
};

window.talSetSearch = function (value) {
  clearTimeout(_talSearchDebounce);
  _talSearchDebounce = setTimeout(() => {
    _talSearch = String(value || '').trim();
    _talVisibleCount = 150;
    _talPaint();
  }, 220);
};

window.talClearFilters = function () {
  _talSection = 'all'; _talType = 'all'; _talRange = 'all'; _talSearch = '';
  _talVisibleCount = 150;
  _talPaint();
};

window.talShowMore = function () {
  _talVisibleCount += 150;
  _talPaint();
};

window.talExportCsv = function () {
  const state = AppStore.getState();
  const rows = _talApplyNonSectionFilters(_talBuildEntries(state), state)
    .filter(e => _talMatchesSection(e));
  if (!rows.length) { if (typeof toast === 'function') toast('Nothing to export for the current filters.'); return; }

  const header = ['Date', 'Time', 'Student', 'Section', 'Type', 'Detail'];
  const lines = [header.join(',')];
  rows.forEach(e => {
    const cells = [
      e.date || '', e.dt ? _talFormatTime(e.dt) : '', e.studentName || '',
      _talSectionLabel(e.classId, state), e.type === 'attendance' ? 'Attendance' : 'Recitation',
      e.type === 'attendance' ? (e.status || '') : `+${e.pts || 0} pts${e.detail ? ' — ' + e.detail : ''}`,
    ].map(v => '"' + String(v).replace(/"/g, '""') + '"');
    lines.push(cells.join(','));
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `class-log-${(typeof isoDate === 'function') ? isoDate() : 'export'}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

// ── Paint ────────────────────────────────────────────────────────────────────

function _talPaint() {
  const el = document.getElementById('a-class-logs');
  if (!el) return;
  const state = AppStore.getState();

  const allEntries = _talBuildEntries(state);
  const scopedEntries = _talApplyNonSectionFilters(allEntries, state); // type + range + search, NOT section
  const sectionOptions = _talSectionOptions(state, allEntries);
  const visibleEntries = scopedEntries.filter(e => _talMatchesSection(e));

  el.innerHTML = `
  <div class="page-hero">
    <div class="page-hero-bg"></div>
    <div style="position:relative;z-index:1">
      <div class="page-hero-label">🗒️ Class Records</div>
      <h1 style="font-family:var(--fh);font-size:32px;font-weight:900;color:var(--on-surface);margin-bottom:8px">Recitation &amp; Attendance Log</h1>
      <p style="font-size:14px;color:var(--text-muted)">${typeof getMySectionsLabel === 'function' ? _esc(getMySectionsLabel(state)) : 'All Sections'} · every recitation point and attendance scan, in one place</p>
    </div>
  </div>

  ${_talOverviewStatGrid(scopedEntries)}
  ${_talFilterBar(sectionOptions)}
  ${_talSection === 'all' ? _talSectionOverviewGrid(state, scopedEntries, sectionOptions) : _talSectionHeader(state, sectionOptions)}
  ${_talTable(visibleEntries, state)}
  `;
}

// ── Data assembly ────────────────────────────────────────────────────────────

/**
 * _talMySectionIds(state) → string[]
 * Every classId this teacher (or admin) should see in the section
 * dropdown/overview — owned (non-archived) sections, unioned with whatever
 * classIds actually appear in the already-RLS-scoped attendance/recitation/
 * roster slices, so a section still shows up even before class_sections
 * caught up with an ad-hoc classId. See file header for the full rationale.
 */
function _talMySectionIds(state) {
  const uid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
  const isAdmin = (typeof currentRole !== 'undefined' && currentRole === 'admin');
  const ids = new Set();

  (state.classSections || []).forEach(s => {
    if (s.archived) return;
    if (isAdmin || (uid && s.adviserId === uid)) ids.add(s.id);
  });
  (state.attendanceLogs || []).forEach(a => { if (a.classId) ids.add(a.classId); });
  (state.recitationLog || []).forEach(r => { if (r.classId) ids.add(r.classId); });
  (state.students || []).forEach(s => { ids.add(s.classId || 'default-class'); });

  if (!ids.size && typeof getActiveClassIds === 'function') {
    getActiveClassIds(state).forEach(id => ids.add(id));
  }
  return Array.from(ids);
}

function _talSectionLabel(classId, state) {
  if (!classId) return 'Unassigned / Legacy';
  if (typeof getClassLabel === 'function') return getClassLabel(classId, state);
  return classId;
}

/**
 * _talBuildEntries(state) → Array of merged, newest-first log rows.
 * Each row: { type, id, studentId, studentName, classId, date, dt, sortKey,
 *             status?, entryMethod?, pts?, detail }
 */
function _talBuildEntries(state) {
  const studentsById = {};
  (state.students || []).forEach(s => { studentsById[s.id] = s; });
  const nameFor = (sid) => {
    const s = studentsById[sid];
    return s ? (s.name || s.displayName || sid) : sid;
  };

  const attendance = (state.attendanceLogs || []).map(a => {
    const dt = a.scannedAt ? new Date(a.scannedAt) : (a.logDate ? new Date(a.logDate + 'T00:00:00+08:00') : null);
    return {
      type: 'attendance',
      id: 'att_' + (a.id || (a.studentId + '_' + a.logDate)),
      studentId: a.studentId,
      studentName: nameFor(a.studentId),
      classId: a.classId || null,
      date: a.logDate || (dt ? _talDateKey(dt) : null),
      dt, sortKey: dt ? dt.getTime() : 0,
      status: a.status,
      entryMethod: a.entryMethod,
      detail: a.notes || '',
    };
  });

  const recitation = (state.recitationLog || []).map(r => {
    const dt = r.createdAt ? new Date(r.createdAt) : null;
    return {
      type: 'recitation',
      id: 'rec_' + (r.id || (r.studentId + '_' + r.when)),
      studentId: r.studentId,
      studentName: nameFor(r.studentId),
      classId: r.classId || null,
      date: dt ? _talDateKey(dt) : null,
      dt, sortKey: dt ? dt.getTime() : 0,
      pts: r.pts,
      detail: r.note || '',
    };
  });

  return attendance.concat(recitation).sort((a, b) => b.sortKey - a.sortKey);
}

/** Section dropdown options — every section-in-scope, plus "Unassigned / Legacy" iff it would be non-empty. */
function _talSectionOptions(state, allEntries) {
  const ids = _talMySectionIds(state);
  const opts = ids.map(id => ({ id, label: _talSectionLabel(id, state) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const hasUnassigned = allEntries.some(e => !e.classId);
  if (hasUnassigned) opts.push({ id: '__unassigned__', label: 'Unassigned / Legacy' });
  return opts;
}

function _talMatchesSection(e) {
  if (_talSection === 'all') return true;
  if (_talSection === '__unassigned__') return !e.classId;
  return e.classId === _talSection;
}

/** Type + date-range + search filters — everything EXCEPT the section filter (kept separate so overview cards can be computed per-section from the same base set). */
function _talApplyNonSectionFilters(entries, state) {
  const today = (typeof isoDate === 'function') ? isoDate() : null;
  const q = _talSearch.toLowerCase();
  return entries.filter(e => {
    if (_talType !== 'all' && e.type !== _talType) return false;
    if (_talRange === 'today') {
      if (!e.date || e.date !== today) return false;
    } else if (_talRange === '7' || _talRange === '30') {
      if (!e.sortKey) return false;
      const days = _talRange === '7' ? 7 : 30;
      if ((Date.now() - e.sortKey) > days * 86400000) return false;
    }
    if (q && !(e.studentName || '').toLowerCase().includes(q)) return false;
    return true;
  });
}

// ── UI pieces ────────────────────────────────────────────────────────────────

function _talOverviewStatGrid(scopedEntries) {
  const attendance = scopedEntries.filter(e => e.type === 'attendance');
  const recitation = scopedEntries.filter(e => e.type === 'recitation');
  const totalPts = recitation.reduce((a, e) => a + (e.pts || 0), 0);
  const presentCount = attendance.filter(e => e.status === 'Early' || e.status === 'On Time').length;

  return `
  <div class="stat-grid">
    <div class="stat-card"><div class="val" style="color:#d0bcff">${scopedEntries.length}</div><div class="lbl">Total Entries</div></div>
    <div class="stat-card"><div class="val" style="color:#4edea3">${attendance.length}</div><div class="lbl">Attendance Logged</div></div>
    <div class="stat-card"><div class="val" style="color:#ffb95f">${recitation.length}</div><div class="lbl">Recitation Entries</div></div>
    <div class="stat-card"><div class="val" style="color:#7fd8ff">${totalPts.toLocaleString()}</div><div class="lbl">Recitation Points</div></div>
  </div>
  <div style="font-size:11px;color:var(--text-muted);margin:-16px 0 20px">✅ ${presentCount} present-on-time entries in the current filter</div>`;
}

function _talFilterBar(sectionOptions) {
  const sectionOpts = sectionOptions.map(s =>
    `<option value="${_esc(s.id)}" ${_talSection === s.id ? 'selected' : ''}>${_esc(s.label)}</option>`
  ).join('');

  const hasFilters = (_talSection !== 'all' || _talType !== 'all' || _talRange !== 'all' || _talSearch);

  return `
  <div class="glass-card" style="padding:14px 16px;margin-bottom:14px;display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap">
    <div>
      <label style="display:block;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Section</label>
      <select id="tal-section-filter" style="width:auto;min-width:210px" onchange="talSetSection(this.value)">
        <option value="all" ${_talSection === 'all' ? 'selected' : ''}>🏫 All My Sections</option>
        ${sectionOpts}
      </select>
    </div>
    <div>
      <label style="display:block;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Type</label>
      <select id="tal-type-filter" style="width:auto;min-width:140px" onchange="talSetType(this.value)">
        <option value="all" ${_talType === 'all' ? 'selected' : ''}>All Types</option>
        <option value="attendance" ${_talType === 'attendance' ? 'selected' : ''}>📅 Attendance</option>
        <option value="recitation" ${_talType === 'recitation' ? 'selected' : ''}>🎤 Recitation</option>
      </select>
    </div>
    <div>
      <label style="display:block;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">When</label>
      <select id="tal-range-filter" style="width:auto;min-width:130px" onchange="talSetRange(this.value)">
        <option value="all" ${_talRange === 'all' ? 'selected' : ''}>All Time</option>
        <option value="today" ${_talRange === 'today' ? 'selected' : ''}>Today</option>
        <option value="7" ${_talRange === '7' ? 'selected' : ''}>Last 7 Days</option>
        <option value="30" ${_talRange === '30' ? 'selected' : ''}>Last 30 Days</option>
      </select>
    </div>
    <div style="flex:1;min-width:160px">
      <label style="display:block;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Search student</label>
      <input id="tal-search" type="text" placeholder="Search by name…" value="${_esc(_talSearch)}" oninput="talSetSearch(this.value)">
    </div>
    <button class="btn btn-ghost btn-sm" onclick="talExportCsv()">⬇️ Export CSV</button>
    ${hasFilters ? `<button class="btn btn-ghost btn-sm" onclick="talClearFilters()">Clear filters</button>` : ''}
  </div>`;
}

/** "All My Sections" mode — one card per section with quick attendance + recitation stats. Click drills into that section. */
function _talSectionOverviewGrid(state, scopedEntries, sectionOptions) {
  const ids = _talMySectionIds(state);
  const cards = ids.map(id => {
    const secEntries = scopedEntries.filter(e => (e.classId || null) === id);
    return _talSectionSummary(id, _talSectionLabel(id, state), secEntries);
  });

  // Unassigned/legacy bucket, only if it has anything in the current filter.
  const unassigned = scopedEntries.filter(e => !e.classId);
  if (unassigned.length) cards.push(_talSectionSummary('__unassigned__', 'Unassigned / Legacy', unassigned));

  if (!cards.length) {
    return `<div class="glass-card" style="padding:32px;text-align:center;color:var(--text-muted);font-size:13px">No sections found yet. Create a section under Sections to get started.</div>`;
  }

  return `
  <div class="section-header"><span class="material-symbols-outlined">grid_view</span><h2>Sections Overview</h2></div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin-bottom:24px">
    ${cards.map(c => `
    <div class="glass-card" style="padding:16px;cursor:pointer;transition:transform .15s" onclick="talSetSection('${_esc(c.id)}')" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='none'">
      <div style="font-weight:800;font-size:14px;color:var(--on-surface);margin-bottom:10px">${_esc(c.label)}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;margin-bottom:8px">
        <span style="color:${_TAL_STATUS_COLORS['On Time']}">✅ ${c.present}</span>
        <span style="color:${_TAL_STATUS_COLORS['Late']}">⏰ ${c.late}</span>
        <span style="color:${_TAL_STATUS_COLORS['Absent']}">❌ ${c.absent}</span>
      </div>
      <div style="font-size:11px;color:var(--text-muted)">🎤 ${c.recitationCount} entries · <span style="color:#ffb95f;font-weight:700">${c.totalPts} pts</span></div>
    </div>`).join('')}
  </div>`;
}

function _talSectionSummary(id, label, entries) {
  const attendance = entries.filter(e => e.type === 'attendance');
  const recitation = entries.filter(e => e.type === 'recitation');
  return {
    id, label,
    present: attendance.filter(e => e.status === 'Early' || e.status === 'On Time').length,
    late: attendance.filter(e => e.status === 'Late').length,
    absent: attendance.filter(e => e.status === 'Absent').length,
    recitationCount: recitation.length,
    totalPts: recitation.reduce((a, e) => a + (e.pts || 0), 0),
  };
}

/** Per-section drill-down header with a "back to all sections" affordance. */
function _talSectionHeader(state, sectionOptions) {
  const opt = sectionOptions.find(s => s.id === _talSection);
  const label = opt ? opt.label : _talSectionLabel(_talSection === '__unassigned__' ? null : _talSection, state);
  return `
  <div class="section-header">
    <span class="material-symbols-outlined">meeting_room</span>
    <h2>${_esc(label)}</h2>
    <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="talSetSection('all')">← All Sections</button>
  </div>`;
}

function _talTable(entries, state) {
  if (!entries.length) {
    return `<div class="glass-card" style="padding:32px;text-align:center;color:var(--text-muted);font-size:13px">No log entries match the current filters.</div>`;
  }

  const cols = '100px 80px 1.2fr 160px 110px 1.3fr';
  const shown = entries.slice(0, _talVisibleCount);

  return `
  <div class="section-header"><span class="material-symbols-outlined">receipt_long</span><h2>Log Entries</h2></div>
  <div class="glass-card" style="padding:0;overflow:hidden">
    <div style="display:grid;grid-template-columns:${cols};gap:10px;align-items:center;padding:10px 16px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);border-bottom:1px solid var(--border2)">
      <span>Date</span><span>Time</span><span>Who</span><span>Section</span><span>Type</span><span>Detail</span>
    </div>
    ${shown.map(e => _talRow(e, state)).join('')}
  </div>
  ${entries.length > shown.length ? `
  <div style="text-align:center;margin-top:14px">
    <button class="btn btn-ghost btn-sm" onclick="talShowMore()">Show more (${shown.length} of ${entries.length})</button>
  </div>` : `
  <div style="text-align:center;margin-top:10px;font-size:11px;color:var(--text-muted)">Showing all ${entries.length} entries</div>
  `}`;
}

function _talRow(e, state) {
  const dateStr = _talFormatDisplayDate(e.date);
  const timeStr = e.dt ? _talFormatTime(e.dt) : '—';
  const sectionLabel = _talSectionLabel(e.classId, state);

  let typeBadge, detail;
  if (e.type === 'attendance') {
    const color = _TAL_STATUS_COLORS[e.status] || 'var(--text-muted)';
    const icon = _TAL_STATUS_ICONS[e.status] || '📅';
    typeBadge = `<span class="btn btn-xs" style="width:fit-content;pointer-events:none;background:${color}22;color:${color};border:1px solid ${color}55">${icon} ${_esc(e.status || '—')}</span>`;
    detail = `${e.entryMethod ? `<div style="font-size:10px;color:var(--text-muted)">via ${_esc(e.entryMethod)}</div>` : ''}${e.detail ? `<div style="font-size:11px;color:var(--on-surface)">${_esc(e.detail)}</div>` : ''}`;
  } else {
    const pts = e.pts || 0;
    const color = pts >= 0 ? '#4edea3' : '#ffb4ab';
    typeBadge = `<span class="btn btn-xs" style="width:fit-content;pointer-events:none;background:${color}22;color:${color};border:1px solid ${color}55">🎤 ${pts >= 0 ? '+' : ''}${pts} pts</span>`;
    detail = e.detail ? `<div style="font-size:11px;color:var(--on-surface)">${_esc(e.detail)}</div>` : `<div style="font-size:11px;color:var(--text-muted)">—</div>`;
  }

  return `
  <div style="display:grid;grid-template-columns:100px 80px 1.2fr 160px 110px 1.3fr;gap:10px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border2)">
    <div style="font-size:11px;color:var(--text-muted)">${_esc(dateStr)}</div>
    <div style="font-size:11px;color:var(--text-muted)">${_esc(timeStr)}</div>
    <div style="font-size:13px;font-weight:700;color:var(--on-surface)">${_esc(e.studentName)}</div>
    <div style="font-size:12px;color:var(--on-surface)">${_esc(sectionLabel)}</div>
    <div>${typeBadge}</div>
    <div>${detail}</div>
  </div>`;
}

// ── Date/time helpers ──────────────────────────────────────────────────────
// Manila-timezone throughout, matching utils.js's isoDate()/nowStr() convention.

function _talDateKey(d) {
  try { return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); } catch (e) { return null; }
}

function _talFormatDisplayDate(dateKey) {
  if (!dateKey) return '—';
  try {
    const d = new Date(dateKey + 'T00:00:00+08:00');
    if (isNaN(d.getTime())) return dateKey;
    return d.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });
  } catch (e) { return dateKey; }
}

function _talFormatTime(d) {
  try { return d.toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: true }); }
  catch (e) { return '—'; }
}

console.log('[EduQuest] attendance/attendance-recitation-log.js loaded — renderRecitationAttendanceLog registered.');
