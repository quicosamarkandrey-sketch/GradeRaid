// ══════════════════════════════════════════════════════
//  modules/admin/content-oversight.js
//  Content Oversight — admin-only screen (Chunk C).
//  (ISOLATION_ROLES_PLAN.md Chunk C — see content-oversight-service.js and
//   supabase/phase41_content_oversight.sql.)
//
//  Two modes on the same screen:
//    - READ-ONLY (default): pick a teacher, browse their achievements/
//      titles/quizzes/campaign world/shop content. No Add/Edit/Delete
//      controls render at all in this mode — this isn't just buttons
//      hidden by CSS, _coRenderXxx() below never emits them.
//    - EDIT AS (opt-in, confirmed, logged): same 5 tabs, now with Add/
//      Edit/Delete, backed by the oversight_upsert_*()/delete_*() RPCs.
//      Every write is logged via ContentOversightService (which pairs each
//      RPC call with log_edit_as_action() — see its header).
//
//  Field depth mirrors the Starter Pack Editor (Phase 38) exactly, per the
//  scope decided before building this — see starter-pack-editor.js for the
//  same "small screen" reasoning (quiz questions as a repeatable list, not
//  the full Quest Builder; campaign stages as raw JSON).
//
//  REPOSITORY PATTERN: this file never calls DBService.rpc() or
//  AuditLogService directly — only ContentOversightService and
//  TeacherDirectoryService (for the picker/header label).
//
//  Exports: renderContentOversight, openContentOversightFor
// ══════════════════════════════════════════════════════

let _coTeacherId = null;
let _coTeacherLabel = '';
let _coEditMode = false;
let _coLoading = false;
let _coError = null;
let _coContent = { achievements: [], titles: [], quizzes: [], campaignWorlds: [], shopProducts: [] };
let _coTab = 'achievements';

let _coPickerLoading = false;
let _coPickerError = null;
let _coPickerRows = null;

const _CO_TABS = [
  { id: 'achievements',   label: 'Achievements',    icon: '🏅' },
  { id: 'titles',         label: 'Titles',          icon: '🎖️' },
  { id: 'quizzes',        label: 'Quiz',            icon: '📝' },
  { id: 'campaignWorlds', label: 'Campaign World',  icon: '🗺️' },
  { id: 'shopProducts',   label: 'Shop Items',      icon: '🏪' },
];

// ── Entry points ─────────────────────────────────────────────────────────

// Called from Teacher Directory's "View Content" action — jumps straight
// to a specific teacher's drill-in, skipping the picker.
window.openContentOversightFor = function (teacherId, label) {
  _coTeacherId = teacherId;
  _coTeacherLabel = label || '';
  _coEditMode = false;
  navTo('a-content-oversight');
};

window.renderContentOversight = async function () {
  const el = document.getElementById('a-content-oversight');
  if (!el) return;

  // Defense in depth: nav.js already hides this tab and bounces direct
  // navTo() calls for a non-admin — same guard as every other
  // ADMIN_ONLY_NAV_IDS screen (see teacher-directory.js).
  if (currentRole !== 'admin') {
    el.innerHTML = `
    <div class="glass-card" style="padding:32px;text-align:center">
      <span class="material-symbols-outlined" style="font-size:40px;color:var(--text-muted)">lock</span>
      <h2 style="font-family:var(--fh);font-size:18px;margin:12px 0 4px">Admin only</h2>
      <p style="font-size:13px;color:var(--text-muted)">This screen is only available to oversight admin accounts.</p>
    </div>`;
    return;
  }

  if (!_coTeacherId) return _coRenderPicker(el);

  _coLoading = true;
  _coError = null;
  _coRenderShell(el);

  const res = await ContentOversightService.fetchTeacherContent(_coTeacherId);
  _coLoading = false;
  if (!res.ok) {
    _coError = res.error;
  } else {
    _coContent = res.content;
  }

  if (document.getElementById('a-content-oversight')) _coRenderShell(document.getElementById('a-content-oversight'));
};

window.unmountContentOversight = function () {
  // Leaving the screen entirely (not just switching tabs) always drops back
  // to read-only — an admin should never return to this tab later and find
  // themselves silently still in Edit-as mode from a previous visit.
  _coEditMode = false;
};

// ── Teacher picker ──────────────────────────────────────────────────────

async function _coRenderPicker(el) {
  el.innerHTML = `
  <div style="margin-bottom:20px">
    <div style="font-family:var(--fh);font-size:26px;font-weight:900">🔎 Content Oversight</div>
    <div style="font-size:13px;color:var(--text-muted);margin-top:4px">Pick a teacher to browse their content read-only, or make a rare direct fix via "Edit as".</div>
  </div>
  <div id="co-picker-body">${_coPickerLoading ? `<div style="padding:40px;text-align:center;color:var(--text-muted)">Loading teachers…</div>` : ''}</div>`;

  if (_coPickerRows === null || _coPickerLoading) {
    _coPickerLoading = true;
    const res = await TeacherDirectoryService.getDirectory();
    _coPickerLoading = false;
    if (!res.ok) { _coPickerError = res.error; _coPickerRows = null; }
    else { _coPickerRows = res.teachers; _coPickerError = null; }
  }
  const body = document.getElementById('co-picker-body');
  if (!body) return;

  if (_coPickerError) {
    body.innerHTML = `<div class="glass-card" style="padding:16px;color:#ff6b6b">⚠️ ${_coEsc(_coPickerError)}</div>`;
    return;
  }
  const rows = _coPickerRows || [];
  body.innerHTML = `
  <div class="glass-card" style="padding:0;overflow:hidden">
    <table class="admin-table">
      <thead><tr><th>Teacher</th><th>Role</th><th style="text-align:center">Content Items</th><th style="width:140px"></th></tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>
              <strong>${_coEsc(r.displayName || '(no name)')}</strong>
              <div style="font-size:11px;color:var(--text-muted)">${_coEsc(r.email || '')}</div>
            </td>
            <td><span class="btn btn-xs ${r.role === 'admin' ? 'btn-primary' : 'btn-ghost'}" style="pointer-events:none">${r.role === 'admin' ? 'Admin' : 'Teacher'}</span></td>
            <td style="text-align:center">${(r.achievementCount||0)+(r.titleCount||0)+(r.quizCount||0)+(r.campaignWorldCount||0)+(r.shopProductCount||0)}</td>
            <td><button class="btn btn-primary btn-sm" onclick="openContentOversightFor('${r.id}','${_coEsc(r.displayName || r.email || '')}')" style="width:100%">View Content</button></td>
          </tr>`).join('') || `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px">No teacher accounts yet.</td></tr>`}
      </tbody>
    </table>
  </div>`;
}

// ── Drill-in shell ──────────────────────────────────────────────────────

function _coRenderShell(el) {
  el.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:10px">
    <div>
      <button class="btn btn-ghost btn-sm" onclick="_coBackToPicker()" style="margin-bottom:6px">← All Teachers</button>
      <div style="font-family:var(--fh);font-size:24px;font-weight:900">${_coEsc(_coTeacherLabel || 'Teacher')}'s Content</div>
    </div>
    <div>
      ${_coEditMode
        ? `<button class="btn btn-danger btn-sm" onclick="_coToggleEditMode()">✓ Done Editing</button>`
        : `<button class="btn btn-primary btn-sm" onclick="_coToggleEditMode()">✏️ Edit as ${_coEsc(_coTeacherLabel || 'this teacher')}</button>`}
    </div>
  </div>

  ${_coEditMode ? `
  <div class="glass-card" style="padding:12px 16px;margin-bottom:16px;background:rgba(255,185,95,.1);border-color:rgba(255,185,95,.35)">
    <strong style="color:#ffb95f">✏️ Editing as ${_coEsc(_coTeacherLabel || 'this teacher')}</strong>
    <span style="font-size:12px;color:var(--text-muted);margin-left:6px">Every change here is logged and attributed to your admin account.</span>
  </div>` : `
  <div class="glass-card" style="padding:12px 16px;margin-bottom:16px">
    <span style="font-size:12px;color:var(--text-muted)">👁️ Read-only. Use "Edit as" above for the rare direct-fix case.</span>
  </div>`}

  ${_coLoading ? `<div style="padding:40px;text-align:center;color:var(--text-muted)">Loading…</div>` : ''}
  ${_coError ? `<div class="glass-card" style="padding:16px;color:#ff6b6b;margin-bottom:16px">⚠️ ${_coEsc(_coError)}</div>` : ''}

  ${!_coLoading && !_coError ? `
  <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">
    ${_CO_TABS.map(t => `
      <button class="btn ${_coTab === t.id ? 'btn-primary' : 'btn-ghost'}" onclick="_coSwitchTab('${t.id}')">
        ${t.icon} ${t.label} <span style="opacity:.6;font-size:11px">(${(_coContent[t.id] || []).length})</span>
      </button>
    `).join('')}
  </div>
  <div id="co-tab-body"></div>` : ''}
  `;
  if (!_coLoading && !_coError) _coRenderTabBody();
}

window._coBackToPicker = function () {
  _coTeacherId = null;
  _coTeacherLabel = '';
  _coEditMode = false;
  _coContent = { achievements: [], titles: [], quizzes: [], campaignWorlds: [], shopProducts: [] };
  renderContentOversight();
};

window._coToggleEditMode = function () {
  if (!_coEditMode) {
    if (!confirm(`You're about to make direct edits to ${_coTeacherLabel || 'this teacher'}'s account content. Every change is logged. Continue?`)) return;
    _coEditMode = true;
  } else {
    _coEditMode = false;
  }
  _coRenderShell(document.getElementById('a-content-oversight'));
};

window._coSwitchTab = function (id) {
  _coTab = id;
  _coRenderTabBody();
};

function _coRenderTabBody() {
  const body = document.getElementById('co-tab-body');
  if (!body) return;
  if (_coTab === 'achievements') return _coRenderAchievements(body);
  if (_coTab === 'titles') return _coRenderTitles(body);
  if (_coTab === 'quizzes') return _coRenderQuizzes(body);
  if (_coTab === 'campaignWorlds') return _coRenderCampaignWorlds(body);
  if (_coTab === 'shopProducts') return _coRenderShopProducts(body);
}

async function _coRefreshAndRender() {
  const res = await ContentOversightService.fetchTeacherContent(_coTeacherId);
  if (res.ok) _coContent = res.content;
  _coRenderShell(document.getElementById('a-content-oversight'));
}

// ── Achievements ─────────────────────────────────────────────────────────

function _coRenderAchievements(body) {
  const rows = _coContent.achievements || [];
  body.innerHTML = `
  ${_coEditMode ? `<div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button class="btn btn-primary" onclick="_coOpenAchievementForm(-1)">＋ Add Achievement</button></div>` : ''}
  <div class="glass-card" style="padding:0;overflow:hidden">
    <table class="admin-table">
      <thead><tr><th></th><th>Name</th><th>Category</th><th>Rarity</th><th>Trigger</th><th style="text-align:right">Reward</th>${_coEditMode ? '<th style="width:120px"></th>' : ''}</tr></thead>
      <tbody>
        ${rows.map((a, i) => `
          <tr>
            <td style="font-size:20px">${a.icon || '🏅'}</td>
            <td><strong>${_coEsc(a.name)}</strong><div style="font-size:11px;color:var(--text-muted)">${_coEsc(a.description || '')}</div></td>
            <td>${_coEsc(a.category || '—')}</td>
            <td>${_coEsc(a.rarity)}</td>
            <td style="font-size:12px;color:var(--text-muted)">${_coEsc(a.triggerType)} ≥ ${a.triggerValue}</td>
            <td style="text-align:right;font-size:12px">${a.xpReward} XP / ${a.coinReward} 🪙</td>
            ${_coEditMode ? `<td>
              <button class="btn btn-ghost btn-sm" onclick="_coOpenAchievementForm(${i})">Edit</button>
              <button class="btn btn-ghost btn-sm" onclick="_coDeleteAchievement(${i})">🗑️</button>
            </td>` : ''}
          </tr>`).join('') || `<tr><td colspan="${_coEditMode ? 7 : 6}" style="text-align:center;color:var(--text-muted);padding:20px">No achievements yet.</td></tr>`}
      </tbody>
    </table>
  </div>`;
}

window._coOpenAchievementForm = function (idx) {
  if (!_coEditMode) return;
  const d = idx >= 0 ? _coContent.achievements[idx] : { id: 'oversight-ach-' + uid(), name: '', description: '', icon: '🏅', category: 'General', rarity: 'Common', xpReward: 30, coinReward: 15, triggerType: 'manual', triggerValue: 1, active: true };
  window._coEditIdx = idx;
  window._coEditBaseId = d.id;
  showModal(`
    <div style="font-family:var(--fh);font-size:18px;font-weight:800;margin-bottom:16px">${idx >= 0 ? 'Edit' : 'Add'} Achievement</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div><label class="form-label">Name</label><input id="co-a-name" class="form-control" value="${_coEscAttr(d.name)}"></div>
      <div><label class="form-label">Icon (emoji)</label><input id="co-a-icon" class="form-control" value="${_coEscAttr(d.icon)}"></div>
      <div style="grid-column:1/-1"><label class="form-label">Description</label><input id="co-a-desc" class="form-control" value="${_coEscAttr(d.description)}"></div>
      <div><label class="form-label">Category</label><input id="co-a-cat" class="form-control" value="${_coEscAttr(d.category)}"></div>
      <div><label class="form-label">Rarity</label>
        <select id="co-a-rarity" class="form-control">${(window.ACH_RARITIES || ['Common','Uncommon','Rare','Epic','Legendary','Mythic']).map(r => `<option value="${r}"${d.rarity === r ? ' selected' : ''}>${r}</option>`).join('')}</select>
      </div>
      <div><label class="form-label">Trigger Type</label>
        <select id="co-a-trigger">${(window.ACH_TRIGGER_TYPES || [{value:'manual',label:'Manual'}]).map(t => `<option value="${t.value}"${d.triggerType === t.value ? ' selected' : ''}>${t.label}</option>`).join('')}</select>
      </div>
      <div><label class="form-label">Trigger Value</label><input id="co-a-tval" class="form-control" type="number" min="0" value="${d.triggerValue || 1}"></div>
      <div><label class="form-label">XP Reward</label><input id="co-a-xp" class="form-control" type="number" min="0" value="${d.xpReward || 0}"></div>
      <div><label class="form-label">Coin Reward</label><input id="co-a-coin" class="form-control" type="number" min="0" value="${d.coinReward || 0}"></div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px">
      <button class="btn btn-ghost" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" onclick="_coSaveAchievement()">Save</button>
    </div>
  `, 'md');
};

window._coSaveAchievement = async function () {
  const isNew = window._coEditIdx < 0;
  const row = {
    id: window._coEditBaseId,
    name: document.getElementById('co-a-name').value.trim(),
    description: document.getElementById('co-a-desc').value.trim(),
    icon: document.getElementById('co-a-icon').value.trim() || '🏅',
    category: document.getElementById('co-a-cat').value.trim() || 'General',
    rarity: document.getElementById('co-a-rarity').value,
    triggerType: document.getElementById('co-a-trigger').value,
    triggerValue: parseInt(document.getElementById('co-a-tval').value) || 0,
    xpReward: parseInt(document.getElementById('co-a-xp').value) || 0,
    coinReward: parseInt(document.getElementById('co-a-coin').value) || 0,
    active: true,
  };
  if (!row.name) { toast('⚠️ Name is required', '#ff6b6b'); return; }
  const res = await ContentOversightService.saveAchievement(_coTeacherId, row, isNew);
  if (!res.ok) { toast('⚠️ ' + res.error, '#ff6b6b'); return; }
  closeModalForce();
  toast('✅ Saved');
  _coRefreshAndRender();
};

window._coDeleteAchievement = async function (idx) {
  const row = _coContent.achievements[idx];
  if (!row) return;
  if (!confirm(`Delete "${row.name}" from ${_coTeacherLabel}'s achievements? This is logged.`)) return;
  const res = await ContentOversightService.deleteAchievement(_coTeacherId, row.id);
  if (!res.ok) { toast('⚠️ ' + res.error, '#ff6b6b'); return; }
  toast('🗑️ Deleted');
  _coRefreshAndRender();
};

// ── Titles ────────────────────────────────────────────────────────────────

function _coRenderTitles(body) {
  const rows = _coContent.titles || [];
  body.innerHTML = `
  ${_coEditMode ? `<div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button class="btn btn-primary" onclick="_coOpenTitleForm(-1)">＋ Add Title</button></div>` : ''}
  <div class="glass-card" style="padding:0;overflow:hidden">
    <table class="admin-table">
      <thead><tr><th></th><th>Name</th><th>Rarity</th>${_coEditMode ? '<th style="width:120px"></th>' : ''}</tr></thead>
      <tbody>
        ${rows.map((t, i) => `
          <tr>
            <td style="font-size:20px">${t.icon || '🎖️'}</td>
            <td><strong>${_coEsc(t.name)}</strong><div style="font-size:11px;color:var(--text-muted)">${_coEsc(t.description || '')}</div></td>
            <td>${_coEsc(t.rarity)}</td>
            ${_coEditMode ? `<td>
              <button class="btn btn-ghost btn-sm" onclick="_coOpenTitleForm(${i})">Edit</button>
              <button class="btn btn-ghost btn-sm" onclick="_coDeleteTitle(${i})">🗑️</button>
            </td>` : ''}
          </tr>`).join('') || `<tr><td colspan="${_coEditMode ? 4 : 3}" style="text-align:center;color:var(--text-muted);padding:20px">No titles yet.</td></tr>`}
      </tbody>
    </table>
  </div>`;
}

window._coOpenTitleForm = function (idx) {
  if (!_coEditMode) return;
  const d = idx >= 0 ? _coContent.titles[idx] : { id: 'oversight-title-' + uid(), name: '', description: '', icon: '🎖️', rarity: 'Common', textColor: '#d0bcff', borderColor: '#8b5cf6', glowColor: 'rgba(139,92,246,0.3)', bgColor: 'rgba(139,92,246,0.08)', active: true };
  window._coEditIdx = idx;
  window._coEditBaseId = d.id;
  showModal(`
    <div style="font-family:var(--fh);font-size:18px;font-weight:800;margin-bottom:16px">${idx >= 0 ? 'Edit' : 'Add'} Title</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div><label class="form-label">Name</label><input id="co-t-name" class="form-control" value="${_coEscAttr(d.name)}"></div>
      <div><label class="form-label">Icon (emoji)</label><input id="co-t-icon" class="form-control" value="${_coEscAttr(d.icon)}"></div>
      <div style="grid-column:1/-1"><label class="form-label">Description</label><input id="co-t-desc" class="form-control" value="${_coEscAttr(d.description)}"></div>
      <div><label class="form-label">Rarity</label>
        <select id="co-t-rarity" class="form-control">${(window.TITLE_RARITIES || window.ACH_RARITIES || ['Common','Uncommon','Rare','Epic','Legendary','Mythic']).map(r => `<option value="${r}"${d.rarity === r ? ' selected' : ''}>${r}</option>`).join('')}</select>
      </div>
      <div><label class="form-label">Text Color</label><input id="co-t-text" class="form-control" type="color" value="${_coToHex(d.textColor)}"></div>
      <div><label class="form-label">Border Color</label><input id="co-t-border" class="form-control" type="color" value="${_coToHex(d.borderColor)}"></div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px">
      <button class="btn btn-ghost" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" onclick="_coSaveTitle()">Save</button>
    </div>
  `, 'md');
};

window._coSaveTitle = async function () {
  const isNew = window._coEditIdx < 0;
  const prev = isNew ? {} : _coContent.titles[window._coEditIdx];
  const row = {
    id: window._coEditBaseId,
    name: document.getElementById('co-t-name').value.trim(),
    description: document.getElementById('co-t-desc').value.trim(),
    icon: document.getElementById('co-t-icon').value.trim() || '🎖️',
    rarity: document.getElementById('co-t-rarity').value,
    textColor: document.getElementById('co-t-text').value,
    borderColor: document.getElementById('co-t-border').value,
    glowColor: prev.glowColor || 'rgba(139,92,246,0.3)',
    bgColor: prev.bgColor || 'rgba(139,92,246,0.08)',
    active: true,
  };
  if (!row.name) { toast('⚠️ Name is required', '#ff6b6b'); return; }
  const res = await ContentOversightService.saveTitle(_coTeacherId, row, isNew);
  if (!res.ok) { toast('⚠️ ' + res.error, '#ff6b6b'); return; }
  closeModalForce();
  toast('✅ Saved');
  _coRefreshAndRender();
};

window._coDeleteTitle = async function (idx) {
  const row = _coContent.titles[idx];
  if (!row) return;
  if (!confirm(`Delete "${row.name}" from ${_coTeacherLabel}'s titles? This is logged.`)) return;
  const res = await ContentOversightService.deleteTitle(_coTeacherId, row.id);
  if (!res.ok) { toast('⚠️ ' + res.error, '#ff6b6b'); return; }
  toast('🗑️ Deleted');
  _coRefreshAndRender();
};

// ── Quiz ──────────────────────────────────────────────────────────────────
// Same "small screen" depth as the Starter Pack Editor: questions edited as
// a repeatable list here, not the full Quest Builder.

// Read-only visibility for chain/schedule state — same rationale and same
// badge styling as _spQuizChainScheduleBadges() in starter-pack-editor.js
// and the live version in quiz-builder.js. This screen still has no form
// fields to edit chain/schedule (Edit-as pass-through only, see Phase 60
// note in content-oversight-service.js), so this is purely a heads-up
// before an admin edits or deletes a row that turns out to be chained
// and/or time-boxed.
function _coQuizChainScheduleBadges(q) {
  const parts = [];
  if (q.chainId) {
    parts.push(`<span class="badge-pill" style="background:rgba(244,114,182,0.15);color:#f472b6">🔗 ${_coEsc(q.chainLabel || q.chainId)} · Part ${q.chainOrder || 1}</span>`);
  }
  const status = (typeof eqQuizScheduleStatus === 'function') ? eqQuizScheduleStatus(q) : null;
  if (status === 'upcoming') parts.push(`<span class="badge-pill bp-gray">📅 Starts ${_coEsc(q.startDate)}</span>`);
  else if (status === 'expired') parts.push(`<span class="badge-pill" style="background:rgba(255,180,171,.15);color:#ffb4ab">⌛ Expired ${_coEsc(q.endDate)}</span>`);
  else if (status === 'active' && q.endDate) parts.push(`<span class="badge-pill" style="background:rgba(255,185,95,.15);color:#ffb95f">⏳ Ends ${_coEsc(q.endDate)}</span>`);
  return parts.join(' ') || `<span style="color:var(--text-muted);font-size:11px">—</span>`;
}

function _coRenderQuizzes(body) {
  const rows = _coContent.quizzes || [];
  body.innerHTML = `
  ${_coEditMode ? `<div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button class="btn btn-primary" onclick="_coOpenQuizForm(-1)">＋ Add Quiz</button></div>` : ''}
  <div class="glass-card" style="padding:0;overflow:hidden">
    <table class="admin-table">
      <thead><tr><th>Title</th><th>Questions</th><th>Chain / Schedule</th><th style="text-align:right">Reward</th>${_coEditMode ? '<th style="width:120px"></th>' : ''}</tr></thead>
      <tbody>
        ${rows.map((q, i) => `
          <tr>
            <td><strong>${_coEsc(q.title)}</strong><div style="font-size:11px;color:var(--text-muted)">${_coEsc(q.description || '')}</div></td>
            <td>${(q.questions || []).length}</td>
            <td>${_coQuizChainScheduleBadges(q)}</td>
            <td style="text-align:right;font-size:12px">${q.xpReward} XP / ${q.coinReward} 🪙</td>
            ${_coEditMode ? `<td>
              <button class="btn btn-ghost btn-sm" onclick="_coOpenQuizForm(${i})">Edit</button>
              <button class="btn btn-ghost btn-sm" onclick="_coDeleteQuiz(${i})">🗑️</button>
            </td>` : ''}
          </tr>`).join('') || `<tr><td colspan="${_coEditMode ? 5 : 4}" style="text-align:center;color:var(--text-muted);padding:20px">No quizzes yet.</td></tr>`}
      </tbody>
    </table>
  </div>`;
}

window._coOpenQuizForm = function (idx) {
  if (!_coEditMode) return;
  const d = idx >= 0 ? _coContent.quizzes[idx] : { id: 'oversight-quiz-' + uid(), title: '', description: '', xpReward: 20, coinReward: 10, timeLimit: 5, rarity: 'Common', cadence: 'standing', questions: [], active: true };
  window._coEditIdx = idx;
  window._coQuizDraft = JSON.parse(JSON.stringify(d));
  _coRenderQuizModal();
};

function _coRenderQuizModal() {
  const d = window._coQuizDraft;
  showModal(`
    <div style="font-family:var(--fh);font-size:18px;font-weight:800;margin-bottom:16px">${window._coEditIdx >= 0 ? 'Edit' : 'Add'} Quiz</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div style="grid-column:1/-1"><label class="form-label">Title</label><input id="co-q-title" class="form-control" value="${_coEscAttr(d.title)}"></div>
      <div style="grid-column:1/-1"><label class="form-label">Description</label><input id="co-q-desc" class="form-control" value="${_coEscAttr(d.description)}"></div>
      <div><label class="form-label">XP Reward</label><input id="co-q-xp" class="form-control" type="number" min="0" value="${d.xpReward || 0}"></div>
      <div><label class="form-label">Coin Reward</label><input id="co-q-coin" class="form-control" type="number" min="0" value="${d.coinReward || 0}"></div>
      <div><label class="form-label">Time Limit (min)</label><input id="co-q-time" class="form-control" type="number" min="0" value="${d.timeLimit || 0}"></div>
      <div><label class="form-label">Rarity</label><select id="co-q-rarity" class="form-control">${ACH_RARITIES.map(r => `<option value="${r}"${(d.rarity||'Common') === r ? ' selected' : ''}>${r}</option>`).join('')}</select></div>
      <div><label class="form-label">Cadence</label><select id="co-q-cadence" class="form-control">
        <option value="standing"${(d.cadence||'standing') === 'standing' ? ' selected' : ''}>Standing</option>
        <option value="daily"${d.cadence === 'daily' ? ' selected' : ''}>Daily pool</option>
        <option value="weekly"${d.cadence === 'weekly' ? ' selected' : ''}>Weekly pool</option>
      </select></div>
    </div>
    <div class="form-label" style="margin-bottom:6px">Questions</div>
    <div id="co-q-questions">${_coQuizQuestionsHTML(d.questions)}</div>
    <button class="btn btn-ghost btn-sm" onclick="_coAddQuizQuestion()" style="margin-top:6px">＋ Question</button>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px">
      <button class="btn btn-ghost" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" onclick="_coSaveQuiz()">Save</button>
    </div>
  `, 'lg');
}

function _coQuizQuestionsHTML(questions) {
  return (questions || []).map((qq, qi) => `
    <div style="border:1px solid var(--border2);border-radius:8px;padding:10px;margin-bottom:8px">
      <input class="form-control" placeholder="Question text..." value="${_coEscAttr(qq.q)}" oninput="_coQuizDraft.questions[${qi}].q=this.value" style="margin-bottom:8px">
      ${(qq.opts || ['', '', '', '']).map((opt, oi) => `
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
          <div onclick="_coQuizDraft.questions[${qi}].answer=${oi};_coRenderQuizModal()" style="width:20px;height:20px;border-radius:50%;border:2px solid ${qq.answer === oi ? '#4edea3' : 'var(--border2)'};background:${qq.answer === oi ? 'rgba(78,222,163,.2)' : ''};cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:9px">${qq.answer === oi ? '✓' : ''}</div>
          <input class="form-control" placeholder="Option ${String.fromCharCode(65 + oi)}" value="${_coEscAttr(opt)}" oninput="_coQuizDraft.questions[${qi}].opts[${oi}]=this.value" style="flex:1">
        </div>`).join('')}
      <button class="btn btn-ghost btn-sm" onclick="_coQuizDraft.questions.splice(${qi},1);_coRenderQuizModal()" style="margin-top:4px">Remove question</button>
    </div>`).join('') || `<div style="color:var(--text-muted);font-size:12px">No questions yet.</div>`;
}

window._coAddQuizQuestion = function () {
  window._coQuizDraft.questions.push({ q: '', opts: ['', '', '', ''], answer: 0 });
  _coRenderQuizModal();
};

window._coSaveQuiz = async function () {
  const isNew = window._coEditIdx < 0;
  const d = window._coQuizDraft;
  d.title = document.getElementById('co-q-title').value.trim();
  d.description = document.getElementById('co-q-desc').value.trim();
  d.xpReward = parseInt(document.getElementById('co-q-xp').value) || 0;
  d.coinReward = parseInt(document.getElementById('co-q-coin').value) || 0;
  d.timeLimit = parseInt(document.getElementById('co-q-time').value) || null;
  d.rarity = document.getElementById('co-q-rarity').value;
  d.cadence = document.getElementById('co-q-cadence').value;
  if (!d.title) { toast('⚠️ Title is required', '#ff6b6b'); return; }
  const res = await ContentOversightService.saveQuiz(_coTeacherId, d, isNew);
  if (!res.ok) { toast('⚠️ ' + res.error, '#ff6b6b'); return; }
  closeModalForce();
  toast('✅ Saved');
  _coRefreshAndRender();
};

window._coDeleteQuiz = async function (idx) {
  const row = _coContent.quizzes[idx];
  if (!row) return;
  const chainNote = row.chainId ? ` This is Part ${row.chainOrder || 1} of the "${row.chainLabel || row.chainId}" chain — the other steps aren't deleted, but this step's slot will disappear from that chain.` : '';
  if (!confirm(`Delete "${row.title}" from ${_coTeacherLabel}'s quizzes? This is logged.${chainNote}`)) return;
  const res = await ContentOversightService.deleteQuiz(_coTeacherId, row.id);
  if (!res.ok) { toast('⚠️ ' + res.error, '#ff6b6b'); return; }
  toast('🗑️ Deleted');
  _coRefreshAndRender();
};

// ── Campaign World ───────────────────────────────────────────────────────
// Same "small screen" depth as the Starter Pack Editor: stages stay a raw
// JSON textarea rather than reusing the full Stage Map Editor.

function _coRenderCampaignWorlds(body) {
  const rows = _coContent.campaignWorlds || [];
  body.innerHTML = `
  ${_coEditMode ? `<div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button class="btn btn-primary" onclick="_coOpenWorldForm(-1)">＋ Add World</button></div>` : ''}
  <div class="glass-card" style="padding:0;overflow:hidden">
    <table class="admin-table">
      <thead><tr><th></th><th>Label</th><th>Stages</th>${_coEditMode ? '<th style="width:120px"></th>' : ''}</tr></thead>
      <tbody>
        ${rows.map((w, i) => `
          <tr>
            <td style="font-size:20px">${w.icon || '🗺️'}</td>
            <td><strong>${_coEsc(w.label)}</strong><div style="font-size:11px;color:var(--text-muted)">${_coEsc(w.description || '')}</div></td>
            <td>${(w.stages || []).length}</td>
            ${_coEditMode ? `<td>
              <button class="btn btn-ghost btn-sm" onclick="_coOpenWorldForm(${i})">Edit</button>
              <button class="btn btn-ghost btn-sm" onclick="_coDeleteWorld(${i})">🗑️</button>
            </td>` : ''}
          </tr>`).join('') || `<tr><td colspan="${_coEditMode ? 4 : 3}" style="text-align:center;color:var(--text-muted);padding:20px">No campaign worlds yet.</td></tr>`}
      </tbody>
    </table>
  </div>`;
}

window._coOpenWorldForm = function (idx) {
  if (!_coEditMode) return;
  const d = idx >= 0 ? _coContent.campaignWorlds[idx] : { id: 'oversight-world-' + uid(), label: '', icon: '🗺️', color: '#8b5cf6', description: '', stages: [], active: true };
  window._coEditIdx = idx;
  window._coEditBaseId = d.id;
  showModal(`
    <div style="font-family:var(--fh);font-size:18px;font-weight:800;margin-bottom:16px">${idx >= 0 ? 'Edit' : 'Add'} Campaign World</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div><label class="form-label">Label</label><input id="co-w-label" class="form-control" value="${_coEscAttr(d.label)}"></div>
      <div><label class="form-label">Icon (emoji)</label><input id="co-w-icon" class="form-control" value="${_coEscAttr(d.icon)}"></div>
      <div style="grid-column:1/-1"><label class="form-label">Description</label><input id="co-w-desc" class="form-control" value="${_coEscAttr(d.description)}"></div>
      <div><label class="form-label">Color</label><input id="co-w-color" class="form-control" type="color" value="${_coToHex(d.color)}"></div>
    </div>
    <div style="margin-top:12px">
      <label class="form-label">Stages (raw JSON — scenes/enemies/questions/outro)</label>
      <textarea id="co-w-stages" class="form-control" rows="10" style="font-family:monospace;font-size:11px">${_coEsc(JSON.stringify(d.stages || [], null, 2))}</textarea>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
      <button class="btn btn-ghost" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" onclick="_coSaveWorld()">Save</button>
    </div>
  `, 'lg');
};

window._coSaveWorld = async function () {
  const isNew = window._coEditIdx < 0;
  let stages;
  try {
    stages = JSON.parse(document.getElementById('co-w-stages').value || '[]');
  } catch (e) {
    toast('⚠️ Stages must be valid JSON: ' + e.message, '#ff6b6b');
    return;
  }
  const row = {
    id: window._coEditBaseId,
    label: document.getElementById('co-w-label').value.trim(),
    icon: document.getElementById('co-w-icon').value.trim() || '🗺️',
    color: document.getElementById('co-w-color').value,
    description: document.getElementById('co-w-desc').value.trim(),
    stages,
    active: true,
  };
  if (!row.label) { toast('⚠️ Label is required', '#ff6b6b'); return; }
  const res = await ContentOversightService.saveCampaignWorld(_coTeacherId, row, isNew);
  if (!res.ok) { toast('⚠️ ' + res.error, '#ff6b6b'); return; }
  closeModalForce();
  toast('✅ Saved');
  _coRefreshAndRender();
};

window._coDeleteWorld = async function (idx) {
  const row = _coContent.campaignWorlds[idx];
  if (!row) return;
  if (!confirm(`Delete "${row.label}" from ${_coTeacherLabel}'s campaign worlds? This is logged.`)) return;
  const res = await ContentOversightService.deleteCampaignWorld(_coTeacherId, row.id);
  if (!res.ok) { toast('⚠️ ' + res.error, '#ff6b6b'); return; }
  toast('🗑️ Deleted');
  _coRefreshAndRender();
};

// ── Shop Items ────────────────────────────────────────────────────────────

function _coRenderShopProducts(body) {
  const rows = _coContent.shopProducts || [];
  body.innerHTML = `
  ${_coEditMode ? `<div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button class="btn btn-primary" onclick="_coOpenShopForm(-1)">＋ Add Shop Item</button></div>` : ''}
  <div class="glass-card" style="padding:0;overflow:hidden">
    <table class="admin-table">
      <thead><tr><th></th><th>Name</th><th>Category</th><th style="text-align:right">Cost</th>${_coEditMode ? '<th style="width:120px"></th>' : ''}</tr></thead>
      <tbody>
        ${rows.map((p, i) => `
          <tr>
            <td style="font-size:20px">${p.emoji || '🎁'}</td>
            <td><strong>${_coEsc(p.name)}</strong><div style="font-size:11px;color:var(--text-muted)">${_coEsc(p.description || '')}</div></td>
            <td>${_coEsc(p.category || '—')}</td>
            <td style="text-align:right">${p.cost} 🪙</td>
            ${_coEditMode ? `<td>
              <button class="btn btn-ghost btn-sm" onclick="_coOpenShopForm(${i})">Edit</button>
              <button class="btn btn-ghost btn-sm" onclick="_coDeleteShopItem(${i})">🗑️</button>
            </td>` : ''}
          </tr>`).join('') || `<tr><td colspan="${_coEditMode ? 5 : 4}" style="text-align:center;color:var(--text-muted);padding:20px">No shop items yet.</td></tr>`}
      </tbody>
    </table>
  </div>`;
}

window._coOpenShopForm = function (idx) {
  if (!_coEditMode) return;
  const d = idx >= 0 ? _coContent.shopProducts[idx] : { id: 'oversight-shop-' + uid(), name: '', emoji: '🎁', description: '', category: 'General', cost: 50, active: true };
  window._coEditIdx = idx;
  window._coEditBaseId = d.id;
  showModal(`
    <div style="font-family:var(--fh);font-size:18px;font-weight:800;margin-bottom:16px">${idx >= 0 ? 'Edit' : 'Add'} Shop Item</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div><label class="form-label">Name</label><input id="co-p-name" class="form-control" value="${_coEscAttr(d.name)}"></div>
      <div><label class="form-label">Emoji</label><input id="co-p-emoji" class="form-control" value="${_coEscAttr(d.emoji)}"></div>
      <div style="grid-column:1/-1"><label class="form-label">Description</label><input id="co-p-desc" class="form-control" value="${_coEscAttr(d.description)}"></div>
      <div><label class="form-label">Category</label><input id="co-p-cat" class="form-control" value="${_coEscAttr(d.category)}"></div>
      <div><label class="form-label">Cost (coins)</label><input id="co-p-cost" class="form-control" type="number" min="0" value="${d.cost || 0}"></div>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:10px">Stock isn't editable here — head to this teacher's own Manage Store screen for stock changes.</div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
      <button class="btn btn-ghost" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" onclick="_coSaveShopItem()">Save</button>
    </div>
  `, 'md');
};

window._coSaveShopItem = async function () {
  const isNew = window._coEditIdx < 0;
  const row = {
    id: window._coEditBaseId,
    name: document.getElementById('co-p-name').value.trim(),
    emoji: document.getElementById('co-p-emoji').value.trim() || '🎁',
    description: document.getElementById('co-p-desc').value.trim(),
    category: document.getElementById('co-p-cat').value.trim() || 'General',
    cost: parseInt(document.getElementById('co-p-cost').value) || 0,
    active: true,
  };
  if (!row.name) { toast('⚠️ Name is required', '#ff6b6b'); return; }
  const res = await ContentOversightService.saveShopItem(_coTeacherId, row, isNew);
  if (!res.ok) { toast('⚠️ ' + res.error, '#ff6b6b'); return; }
  closeModalForce();
  toast('✅ Saved');
  _coRefreshAndRender();
};

window._coDeleteShopItem = async function (idx) {
  const row = _coContent.shopProducts[idx];
  if (!row) return;
  if (!confirm(`Delete "${row.name}" from ${_coTeacherLabel}'s shop? This is logged.`)) return;
  const res = await ContentOversightService.deleteShopItem(_coTeacherId, row.id);
  if (!res.ok) { toast('⚠️ ' + res.error, '#ff6b6b'); return; }
  toast('🗑️ Deleted');
  _coRefreshAndRender();
};

// ── Small local helpers (prefixed _co to avoid colliding with similarly-
//    named helpers in other admin pages, e.g. starter-pack-editor.js's _sp) ──

function _coEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function _coEscAttr(s) { return _coEsc(s); }
function _coToHex(c) {
  if (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) return c;
  return '#8b5cf6';
}
