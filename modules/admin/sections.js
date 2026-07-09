// ══════════════════════════════════════════════════════
//  modules/admin/sections.js
//  Section Maker — admin page for creating/editing/archiving class_sections.
//  Implements Section_Maker_Feature_Spec.md §3, §5, §8 (build order steps 3 & 8).
//
//  DB table: public.class_sections (via SectionService, never called directly)
//  AppStore slice: draft.classSections
//    [{ id, gradeLevel, sectionName, adviserId, archived, createdAt, updatedAt }]
//
//  This page is the canonical place sections are created — before this
//  page existed, a "class" only appeared once a student happened to have
//  that classId string on their profile (see spec §1). Every other screen
//  that lists classes (kiosk, Live Monitor, seating builder, the
//  registration form) reads from the same classSections slice via
//  window.getActiveClassIds() / window.getClassLabel() (sections-service.js).
//
//  CHUNK D — adviser picker + standalone reassignment (ISOLATION_ROLES_PLAN.md
//  Chunk D, see supabase/phase42_ownership_lifecycle.sql):
//    - The create/edit modal's adviser <select> used to offer only
//      state.admin or "Unassigned" (this app had exactly one account when
//      it was written). Now that a real multi-teacher roster exists
//      (Chunk A), it's sourced from TeacherDirectoryService.getDirectory()
//      instead — admin-only, since that RPC is is_admin()-gated. A teacher
//      editing their own section still sees the field, but as read-only
//      text, not a picker.
//    - "🔁 Reassign" is a new quick action, separate from "✏️ Edit" — a
//      mid-year coverage change ("who covers this section starting
//      today") shouldn't require opening the full edit form and touching
//      grade/name. Backed by SectionService.reassignAdviser(), which logs
//      its own audit_log entry (see phase42). Admin-only, same reasoning
//      as the picker above.
// ══════════════════════════════════════════════════════

const GRADE_LEVELS = ['7', '8', '9', '10', '11', '12'];

let _secMounted = false;
let _secGradeFilter = 'all';
let _secShowArchived = false;
let _secSearch = '';

// Lazy-loaded, admin-only teacher roster for the adviser picker/reassign
// modal — fetched once per Section Maker mount, not on every render.
let _secTeacherDir = null;
let _secTeacherDirLoading = false;

async function _secEnsureTeacherDir() {
  if (currentRole !== 'admin') return [];
  if (_secTeacherDir || _secTeacherDirLoading) return _secTeacherDir || [];
  _secTeacherDirLoading = true;
  try {
    const res = await TeacherDirectoryService.getDirectory();
    _secTeacherDir = res.ok ? res.teachers.filter(t => t.isActive !== false) : [];
  } catch (e) {
    console.warn('[SectionMaker] Could not load teacher directory for adviser picker:', e);
    _secTeacherDir = [];
  } finally {
    _secTeacherDirLoading = false;
  }
  return _secTeacherDir;
}

// ── MAIN RENDER ─────────────────────────────────────────

window.renderSectionMaker = function () {
  _secMounted = true;
  _secTeacherDir = null; // re-fetch on every mount — roster may have changed

  document.getElementById('a-sections').innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
    <div>
      <div style="font-family:var(--fh);font-size:26px;font-weight:900">🏫 Section Maker</div>
      <div style="color:var(--text-muted);font-size:13px;margin-top:4px" id="sec-header-sub"></div>
    </div>
    <button class="btn btn-primary" onclick="_secOpenCreateModal()">＋ New Section</button>
  </div>

  <div id="sec-stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:20px"></div>

  <div class="sec-filter-bar">
    <select id="sec-grade-filter" onchange="_secGradeFilter=this.value;_secRenderList()">
      <option value="all">All Grades</option>
      ${GRADE_LEVELS.map(g => `<option value="${g}">Grade ${g}</option>`).join('')}
    </select>
    <label class="sec-archived-toggle">
      <input type="checkbox" id="sec-show-archived" onchange="_secShowArchived=this.checked;_secRenderList()">
      Show archived
    </label>
    <input class="reg-search-input" type="text" placeholder="Search section name…" value="${_secSearch}"
           oninput="_secSearch=this.value;_secRenderList()">
  </div>

  <div id="sec-list"></div>`;

  _secRenderList();

  AppStore.subscribe('section-maker', function (state, event) {
    if (!_secMounted) return;
    if (!event || event.type === 'state:updated' || event.type.indexOf('sections:') === 0 || event.type === 'state:remote-sync') {
      _secRenderList();
    }
  });

  if (typeof window.refreshSectionData === 'function') {
    window.refreshSectionData().catch(function (e) {
      console.warn('[SectionMaker] mount-time section data refresh failed:', e);
    });
  }
};

window.unmountSectionMaker = function () {
  _secMounted = false;
  AppStore.unsubscribe('section-maker');
};

// ── LIST RENDER ─────────────────────────────────────────

window._secRenderList = function () {
  if (!_secMounted) return;
  const state = AppStore.getState();
  const all = state.classSections || [];
  const active = all.filter(s => !s.archived);
  const archived = all.filter(s => s.archived);
  const gradesCovered = new Set(active.map(s => s.gradeLevel)).size;

  const subEl = document.getElementById('sec-header-sub');
  if (subEl) subEl.textContent = `${active.length} active section${active.length === 1 ? '' : 's'} · ${archived.length} archived`;

  const statsEl = document.getElementById('sec-stats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="glass-card" style="padding:14px;text-align:center;margin-bottom:0">
        <div style="font-family:var(--fh);font-size:26px;font-weight:900;color:var(--primary)">${active.length}</div>
        <div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase">Active</div>
      </div>
      <div class="glass-card" style="padding:14px;text-align:center;margin-bottom:0">
        <div style="font-family:var(--fh);font-size:26px;font-weight:900;color:var(--secondary)">${gradesCovered}</div>
        <div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase">Grades Covered</div>
      </div>
      <div class="glass-card" style="padding:14px;text-align:center;margin-bottom:0">
        <div style="font-family:var(--fh);font-size:26px;font-weight:900;color:#ffb95f">${archived.length}</div>
        <div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase">Archived</div>
      </div>`;
  }

  const listEl = document.getElementById('sec-list');
  if (listEl) listEl.innerHTML = _secRenderListHTML(all);
};

function _secStudentCount(state, sectionId) {
  return (state.students || []).filter(s => (s.classId || 'default-class') === sectionId).length;
}

function _secRenderListHTML(all) {
  const state = AppStore.getState();
  let list = _secShowArchived ? all : all.filter(s => !s.archived);
  if (_secGradeFilter !== 'all') list = list.filter(s => s.gradeLevel === _secGradeFilter);
  const q = (_secSearch || '').trim().toLowerCase();
  if (q) list = list.filter(s => s.sectionName.toLowerCase().includes(q));

  if (!list.length) {
    return `<div style="text-align:center;padding:64px;background:rgba(35,31,56,.7);border:1px solid var(--border);border-radius:16px">
      <div style="font-size:48px;margin-bottom:12px">🏫</div>
      <div style="font-family:var(--fh);font-size:17px;font-weight:800;margin-bottom:6px">No sections found</div>
      <div style="color:var(--text-muted);font-size:13px">${all.length === 0 ? 'Create your first section to get started — the kiosk, Live Monitor, and seating builder will pick it up automatically.' : 'Try a different filter or search term.'}</div>
    </div>`;
  }

  // Group by grade level for readability.
  const byGrade = {};
  list.forEach(s => {
    if (!byGrade[s.gradeLevel]) byGrade[s.gradeLevel] = [];
    byGrade[s.gradeLevel].push(s);
  });
  const grades = Object.keys(byGrade).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return grades.map(g => `
    <div style="margin-bottom:20px">
      <div style="font-family:var(--fh);font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">Grade ${_esc(g)}</div>
      <div class="sec-grid">
        ${byGrade[g]
          .sort((a, b) => a.sectionName.localeCompare(b.sectionName))
          .map(s => _secCardHTML(s, state))
          .join('')}
      </div>
    </div>`).join('');
}

function _secCardHTML(s, state) {
  const count = _secStudentCount(state, s.id);
  const adviserName = _secAdviserName(s.adviserId, state);
  return `<div class="sec-card ${s.archived ? 'sec-card-archived' : ''}">
    <div class="sec-card-top">
      <div class="sec-card-name">${_esc(s.sectionName)}</div>
      ${s.archived ? `<span class="badge-pill bp-muted">Archived</span>` : `<span class="badge-pill bp-primary">Active</span>`}
    </div>
    <div class="sec-card-meta">
      <span>👥 ${count} student${count === 1 ? '' : 's'}</span>
      <span>👤 ${adviserName ? _esc(adviserName) : 'No adviser assigned'}</span>
    </div>
    <div class="sec-card-id" title="This is the classId value stored on students, schedules, seating layouts, and attendance logs.">id: ${_esc(s.id)}</div>
    <div class="sec-card-actions">
      <button class="btn btn-ghost btn-xs" onclick="_secOpenEditModal('${s.id}')">✏️ Edit</button>
      ${(!s.archived && currentRole === 'admin')
        ? `<button class="btn btn-ghost btn-xs" onclick="_secOpenReassignModal('${s.id}')">🔁 Reassign</button>` : ''}
      ${s.archived
        ? `<button class="btn btn-ghost btn-xs" onclick="_secUnarchive('${s.id}')">↩ Restore</button>`
        : `<button class="btn btn-danger btn-xs" onclick="_secConfirmArchive('${s.id}', ${count})">🗄 Archive</button>`}
    </div>
  </div>`;
}

function _secAdviserName(adviserId, state) {
  if (!adviserId) return null;
  if (state.admin && state.admin.id === adviserId) return state.admin.name;
  const s = (state.students || []).find(st => st.id === adviserId);
  return s ? s.name : adviserId;
}

// ── CREATE / EDIT MODAL ─────────────────────────────────

window._secOpenCreateModal = async function () {
  await _secEnsureTeacherDir();
  showModal(_secModalHTML(null), 'sm');
};

window._secOpenEditModal = async function (sectionId) {
  const state = AppStore.getState();
  const section = (state.classSections || []).find(s => s.id === sectionId);
  if (!section) { toast('❌ Section not found.', '#ffb4ab'); return; }
  await _secEnsureTeacherDir();
  showModal(_secModalHTML(section), 'sm');
};

function _secAdviserFieldHTML(section) {
  // Admin: real picker, sourced from the teacher directory (Chunk D — see
  // header). Teacher editing their own section: read-only, since handing a
  // section to a SPECIFIC other teacher is treated as an admin action here.
  if (currentRole !== 'admin') {
    const state = AppStore.getState();
    const label = section ? _secAdviserName(section.adviserId, state) : null;
    return `<div class="form-group">
      <label class="form-label">Adviser</label>
      <div style="font-size:13px;padding:8px 0;color:var(--text-muted)">${label ? _esc(label) : '— Unassigned —'} <span style="font-size:11px">(ask an admin to reassign)</span></div>
    </div>`;
  }

  const roster = _secTeacherDir || [];
  const adviserOptions = [
    `<option value="">— Unassigned —</option>`,
    ...roster.map(t => `<option value="${_esc(t.id)}" ${section && section.adviserId === t.id ? 'selected' : ''}>${_esc(t.displayName || t.email || t.id)}${t.role === 'admin' ? ' (Admin)' : ''}</option>`),
  ].join('');

  return `<div class="form-group">
    <label class="form-label">Adviser <span style="color:var(--text-muted);font-size:11px">(optional)</span></label>
    <select id="sec-form-adviser" style="width:100%">${adviserOptions}</select>
  </div>`;
}

function _secModalHTML(section) {
  const isEdit = !!section;

  return `
  <div style="font-family:var(--fh);font-size:18px;font-weight:900;margin-bottom:16px">${isEdit ? '✏️ Edit Section' : '＋ New Section'}</div>

  ${isEdit ? `<div style="font-size:11px;color:var(--text-muted);margin-bottom:14px">
    Renaming or changing the grade relabels this section — it does not create a new one.
    Its underlying id (<code>${_esc(section.id)}</code>) stays the same, so attendance, schedule,
    and seating history stay linked.
  </div>` : ''}

  <div class="form-group">
    <label class="form-label">Grade Level</label>
    <select id="sec-form-grade" style="width:100%">
      <option value="">— Select —</option>
      ${GRADE_LEVELS.map(g => `<option value="${g}" ${section && section.gradeLevel === g ? 'selected' : ''}>Grade ${g}</option>`).join('')}
    </select>
  </div>

  <div class="form-group">
    <label class="form-label">Section Name</label>
    <input type="text" id="sec-form-name" placeholder="e.g. Rizal" autocomplete="off" style="width:100%"
           value="${section ? _esc(section.sectionName) : ''}">
  </div>

  ${_secAdviserFieldHTML(section)}

  ${isEdit ? '' : `
  <!-- BUGFIX (report §3): schedule used to be a separate step on the RFID
       kiosk's settings screen, so a brand-new section had no schedule at
       all until someone remembered to go set one — any scan attempt in the
       meantime was rejected with "No active attendance schedule for this
       class". Folding it in here means a section is fully usable for
       attendance the instant it's created. Left optional (checkbox off by
       default) so an admin can still defer it and set it later from the
       kiosk exactly as before. -->
  <div class="form-group" style="border-top:1px solid var(--border);padding-top:14px;margin-top:4px">
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:600">
      <input type="checkbox" id="sec-form-sched-toggle" onchange="_secToggleScheduleFields(this.checked)">
      Set attendance schedule now
    </label>
    <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
      Optional — you can also set this later from the kiosk's settings screen.
    </div>
  </div>

  <div id="sec-form-sched-fields" style="display:none;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
    <div><label class="form-label">Opens</label><input type="time" id="sec-form-sched-open" value="07:00" style="width:100%"></div>
    <div><label class="form-label">Start (On Time from)</label><input type="time" id="sec-form-sched-start" value="07:30" style="width:100%"></div>
    <div><label class="form-label">Late cutoff</label><input type="time" id="sec-form-sched-late" value="07:45" style="width:100%"></div>
    <div><label class="form-label">Closes</label><input type="time" id="sec-form-sched-close" value="08:30" style="width:100%"></div>
  </div>
  `}

  <div id="sec-form-err" style="color:#ffb4ab;font-size:13px;margin-bottom:10px;display:none"></div>

  <div style="display:flex;gap:8px">
    <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
    <button class="btn btn-primary" style="flex:1" onclick="_secSubmitForm(${isEdit ? `'${section.id}'` : 'null'})">${isEdit ? 'Save Changes' : 'Create Section'}</button>
  </div>`;
}

window._secToggleScheduleFields = function (checked) {
  const el = document.getElementById('sec-form-sched-fields');
  if (el) el.style.display = checked ? 'grid' : 'none';
};

window._secSubmitForm = async function (sectionId) {
  const grade = document.getElementById('sec-form-grade')?.value || '';
  const name = document.getElementById('sec-form-name')?.value.trim() || '';
  // The adviser <select> only exists in admin mode (_secAdviserFieldHTML) —
  // a teacher editing their own section has no adviser control at all, so
  // adviserTouched stays false and the existing adviser is left alone.
  const adviserEl = document.getElementById('sec-form-adviser');
  const adviserTouched = !!adviserEl;
  const adviserId = adviserEl ? (adviserEl.value || null) : null;
  const errEl = document.getElementById('sec-form-err');

  if (!grade) { _secShowFormErr('Please select a grade level.'); return; }
  if (!name) { _secShowFormErr('Section name is required.'); return; }
  if (errEl) errEl.style.display = 'none';

  // BUGFIX (report §3): only present (and only read) on the create form —
  // editing an existing section still manages its schedule from the kiosk,
  // same as today.
  const schedToggle = document.getElementById('sec-form-sched-toggle');
  let schedule = null;
  if (!sectionId && schedToggle && schedToggle.checked) {
    const openTime = document.getElementById('sec-form-sched-open')?.value;
    const startTime = document.getElementById('sec-form-sched-start')?.value;
    const lateCutoff = document.getElementById('sec-form-sched-late')?.value;
    const closeTime = document.getElementById('sec-form-sched-close')?.value;
    if (!openTime || !startTime || !lateCutoff || !closeTime) {
      _secShowFormErr('Please fill in all four schedule times, or uncheck "Set attendance schedule now".');
      return;
    }
    if (!(openTime <= startTime && startTime <= lateCutoff && lateCutoff <= closeTime)) {
      _secShowFormErr('Schedule times must be in order: Opens ≤ Start ≤ Late cutoff ≤ Closes.');
      return;
    }
    schedule = { openTime, startTime, lateCutoff, closeTime };
  }

  const result = sectionId
    ? await SectionService.updateSection(sectionId, adviserTouched
        ? { gradeLevel: grade, sectionName: name, adviserId, clearAdviser: !adviserId }
        : { gradeLevel: grade, sectionName: name })
    : await SectionService.createSection(grade, name, { adviserId, schedule });

  if (!result.ok) { _secShowFormErr(result.error || 'Something went wrong.'); return; }

  closeModalForce();
  toast(sectionId ? `✅ Section updated.` : `✅ "${name}" created${schedule ? ' with an attendance schedule' : ''}.`);
  _secRenderList();
};

function _secShowFormErr(msg) {
  const errEl = document.getElementById('sec-form-err');
  if (errEl) { errEl.textContent = '❌ ' + msg; errEl.style.display = 'block'; }
}

// ── ARCHIVE / RESTORE ───────────────────────────────────

window._secConfirmArchive = function (sectionId, studentCount) {
  const state = AppStore.getState();
  const section = (state.classSections || []).find(s => s.id === sectionId);
  if (!section) return;

  showModal(`
    <div style="font-family:var(--fh);font-size:18px;font-weight:900;margin-bottom:12px">🗄 Archive "${_esc(section.sectionName)}"?</div>
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px;line-height:1.5">
      This hides it from the kiosk, Live Monitor, seating builder, and the registration form.
      ${studentCount > 0 ? `<strong style="color:#ffb95f">${studentCount} student${studentCount === 1 ? ' is' : 's are'} currently in this section</strong> — their records, attendance, and seating history are kept exactly as-is; they just won't appear as an option for new enrollments until this section is restored.` : 'It has no students currently assigned.'}
      Nothing is deleted — you can restore it anytime.
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-danger" style="flex:1" onclick="_secArchive('${sectionId}')">Archive Section</button>
    </div>`, 'sm');
};

window._secArchive = async function (sectionId) {
  const result = await SectionService.archiveSection(sectionId);
  closeModalForce();
  if (!result.ok) { toast('❌ ' + (result.error || 'Could not archive section.'), '#ffb4ab'); return; }
  toast('✅ Section archived.');
  _secRenderList();
};

window._secUnarchive = async function (sectionId) {
  const result = await SectionService.unarchiveSection(sectionId);
  if (!result.ok) { toast('❌ ' + (result.error || 'Could not restore section.'), '#ffb4ab'); return; }
  toast('✅ Section restored.');
  _secRenderList();
};

// ── REASSIGN ADVISER (Chunk D — standalone, mid-year coverage change) ──
// Deliberately separate from the edit modal above: a single-purpose action
// for "who covers this section starting now", with its own audit_log entry
// (reassign_section_adviser(), Phase 42) — see the file header for why this
// isn't folded into _secOpenEditModal.

window._secOpenReassignModal = async function (sectionId) {
  const state = AppStore.getState();
  const section = (state.classSections || []).find(s => s.id === sectionId);
  if (!section) { toast('❌ Section not found.', '#ffb4ab'); return; }
  await _secEnsureTeacherDir();

  const roster = (_secTeacherDir || []).filter(t => t.id !== section.adviserId);
  const currentLabel = section.adviserId ? _secAdviserName(section.adviserId, state) : '— Unassigned —';
  const options = [
    `<option value="">— Unassigned —</option>`,
    ...roster.map(t => `<option value="${_esc(t.id)}">${_esc(t.displayName || t.email || t.id)}${t.role === 'admin' ? ' (Admin)' : ''}</option>`),
  ].join('');

  showModal(`
    <div style="font-family:var(--fh);font-size:18px;font-weight:900;margin-bottom:6px">🔁 Reassign Adviser</div>
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px">
      Grade ${_esc(section.gradeLevel)} – ${_esc(section.sectionName)}<br>
      Currently: <strong>${_esc(currentLabel)}</strong>
    </div>
    <div class="form-group">
      <label class="form-label">New Adviser</label>
      <select id="sec-reassign-select" style="width:100%">${options}</select>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:14px">
      This changes only who covers this section. It does not move any of the
      previous adviser's content — see the Teacher Directory's "Transfer
      Ownership" action for that.
    </div>
    <div id="sec-reassign-err" style="color:#ffb4ab;font-size:13px;margin-bottom:10px;display:none"></div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" style="flex:1" onclick="_secSubmitReassign('${sectionId}')">Reassign</button>
    </div>`, 'sm');
};

window._secSubmitReassign = async function (sectionId) {
  const select = document.getElementById('sec-reassign-select');
  const newAdviserId = select ? (select.value || null) : null;

  const result = await SectionService.reassignAdviser(sectionId, newAdviserId, { clearAdviser: !newAdviserId });
  if (!result.ok) {
    const errEl = document.getElementById('sec-reassign-err');
    if (errEl) { errEl.textContent = '❌ ' + (result.error || 'Could not reassign this section.'); errEl.style.display = 'block'; }
    return;
  }

  closeModalForce();
  toast('✅ Adviser reassigned.');
  _secRenderList();
};
