// ══════════════════════════════════════════════════════
//  modules/admin/school-settings.js
//  School Settings — admin-only screen (Chunk E "Governance").
//  (ISOLATION_ROLES_PLAN.md Chunk E — see school-settings-service.js and
//   supabase/phase40_governance_audit_and_settings.sql.)
//
//  v1 scope (confirmed before building): school name + a single free-text
//  school-year label. No logo/branding, no dates. See the service file's
//  header before adding fields here.
//
//  REPOSITORY PATTERN: this file never calls DBService.rpc() directly —
//  only SchoolSettingsService.
//
//  Exports: renderSchoolSettings, saveSchoolSettings
// ══════════════════════════════════════════════════════

let _schoolSettings = { schoolName: '', schoolYearLabel: '', updatedAt: null, updatedBy: null };
let _schoolSettingsLoading = false;
let _schoolSettingsError = null;
let _schoolSettingsSaving = false;

window.renderSchoolSettings = async function () {
  const el = document.getElementById('a-settings');
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

  _schoolSettingsLoading = true;
  _schoolSettingsError = null;
  _ssRenderShell(el);

  const res = await SchoolSettingsService.get();
  _schoolSettingsLoading = false;
  if (!res.ok) {
    _schoolSettingsError = res.error;
  } else {
    _schoolSettings = res.settings;
  }

  if (document.getElementById('a-settings')) _ssRenderShell(document.getElementById('a-settings'));
};

function _ssRenderShell(el) {
  const s = _schoolSettings;
  const updatedLine = s.updatedAt
    ? `<div style="font-size:11px;color:var(--text-muted);margin-top:6px">Last saved ${_ssEsc(new Date(s.updatedAt).toLocaleString())}</div>`
    : '';

  el.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
    <div>
      <div style="font-family:var(--fh);font-size:26px;font-weight:900">⚙️ School Settings</div>
      <div style="font-size:13px;color:var(--text-muted);margin-top:2px">Global settings shared across the whole app.</div>
    </div>
  </div>

  ${_schoolSettingsLoading ? `<div style="padding:40px;text-align:center;color:var(--text-muted)">Loading…</div>` : ''}
  ${_schoolSettingsError ? `<div class="glass-card" style="padding:16px;color:#ff6b6b;margin-bottom:16px">⚠️ ${_ssEsc(_schoolSettingsError)}</div>` : ''}

  ${!_schoolSettingsLoading ? `
  <div class="glass-card" style="padding:24px;max-width:520px">
    <div style="display:flex;flex-direction:column;gap:16px">
      <div>
        <label class="form-label">School Name</label>
        <input id="ss-school-name" class="form-control" value="${_ssEscAttr(s.schoolName)}" placeholder="e.g. Rizal Integrated School">
      </div>
      <div>
        <label class="form-label">School Year Label</label>
        <input id="ss-school-year" class="form-control" value="${_ssEscAttr(s.schoolYearLabel)}" placeholder="e.g. SY 2026-2027">
      </div>
      ${updatedLine}
      <div>
        <button class="btn-primary" onclick="saveSchoolSettings()" ${_schoolSettingsSaving ? 'disabled' : ''} style="padding:10px 20px;border-radius:10px;font-weight:700">
          ${_schoolSettingsSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  </div>` : ''}
  `;
}

window.saveSchoolSettings = async function () {
  const nameEl = document.getElementById('ss-school-name');
  const yearEl = document.getElementById('ss-school-year');
  const schoolName = nameEl ? nameEl.value.trim() : '';
  const schoolYearLabel = yearEl ? yearEl.value.trim() : '';

  _schoolSettingsSaving = true;
  _ssRenderShell(document.getElementById('a-settings'));

  const res = await SchoolSettingsService.save({ schoolName, schoolYearLabel });

  _schoolSettingsSaving = false;
  if (!res.ok) {
    toast('⚠️ ' + res.error, '#ff6b6b');
    _ssRenderShell(document.getElementById('a-settings'));
    return;
  }
  _schoolSettings = res.settings;
  toast('✅ Saved');
  _ssRenderShell(document.getElementById('a-settings'));
};

function _ssEsc(s) {
  const d = document.createElement('div');
  d.textContent = (s === null || s === undefined) ? '' : String(s);
  return d.innerHTML;
}
function _ssEscAttr(s) { return _ssEsc(s); }
