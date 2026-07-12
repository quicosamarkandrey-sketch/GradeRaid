// ══════════════════════════════════════════════════════
//  modules/admin/dsm-manager.js
//  Dynamic Sidebar Manager (DSM) — lets admins show/hide, lock,
//  relabel, reorder and group the Student and Admin sidebar tabs
//  at runtime, without touching nav.js.
//
//  Exports (verified by modules/admin/index.js):
//    renderNavManager, dsmGetStudentNav, dsmGetAdminNav,
//    dsmSwitchTab, dsmToggle, dsmSetStatus, dsmSetField,
//    dsmExpandRow, dsmShowAll, dsmHideAll, dsmUnlockAll,
//    dsmApplyAndRefresh, dsmResetToDefaults
//
//  Persistence: DSMService (dsm-service.js) — key 'eduquest_dsm_v2'.
//  Data shape saved: { student: [...items], admin: [...items] }
//  where each item mirrors one row of DSM_STUDENT_DEFAULTS /
//  DSM_ADMIN_DEFAULTS. Saved rows are merged onto the defaults by
//  `id`, so adding a brand-new nav item to the defaults later will
//  never be hidden by stale persisted data — and "Reset to
//  Defaults" always gives you a clean slate if something looks off.
// ══════════════════════════════════════════════════════

// ── DEFAULTS ───────────────────────────────────────────

const DSM_STUDENT_DEFAULTS = [
  {id:'s-dashboard',   label:'Dashboard',     icon:'home',                  order:1,  visible:true, locked:false, disabled:false, status:'active',     lockMsg:'',                                    unlockReq:'',                 group:''},
  {id:'s-my-section',  label:'My Section',    icon:'groups',                order:2,  visible:true, locked:false, disabled:false, status:'active',     lockMsg:'',                                    unlockReq:'',                 group:''},
  {id:'s-quizzes',     label:'Quest Board',   icon:'swords',                order:3,  visible:true, locked:false, disabled:false, status:'active',     lockMsg:'Complete first attendance to unlock', unlockReq:'First attendance', group:'Learning'},
  {id:'s-world-boss',  label:'World Boss',    icon:'local_fire_department', order:4,  visible:true, locked:false, disabled:false, status:'event_only', lockMsg:'Only available during active Boss Events', unlockReq:'Boss event must be active', group:'Events'},
  {id:'s-store',       label:'The Armory',    icon:'storefront',            order:5,  visible:true, locked:false, disabled:false, status:'active',     lockMsg:'Reach Level 3 to unlock',             unlockReq:'Reach Level 3',    group:'Economy'},
  {id:'s-inventory',   label:'My Inventory',  icon:'backpack',              order:6,  visible:true, locked:false, disabled:false, status:'active',     lockMsg:'',                                    unlockReq:'',                 group:'Economy'},
  {id:'s-orders',      label:'My Orders',     icon:'receipt_long',          order:7,  visible:true, locked:false, disabled:false, status:'active',     lockMsg:'',                                    unlockReq:'',                 group:'Economy'},
  {id:'s-leaderboard', label:'Hall of Fame',  icon:'military_tech',         order:8,  visible:true, locked:false, disabled:false, status:'active',     lockMsg:'',                                    unlockReq:'',                 group:'Community'},
  {id:'s-badges',      label:'Achievements',  icon:'workspace_premium',     order:9,  visible:true, locked:false, disabled:false, status:'active',     lockMsg:'Complete registration to unlock',     unlockReq:'Complete registration', group:'Community'},
  {id:'s-mail',        label:'Mail',          icon:'mail',                  order:10, visible:true, locked:false, disabled:false, status:'active',     lockMsg:'',                                    unlockReq:'',                 group:'Community'},
  {id:'s-attendance',  label:'My Progress',   icon:'calendar_month',        order:11, visible:true, locked:false, disabled:false, status:'active',     lockMsg:'',                                    unlockReq:'',                 group:''},
];

const DSM_ADMIN_DEFAULTS = [
  {id:'a-dashboard',     label:'Command Center',        icon:'home',                  order:1,  visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:''},
  {id:'a-scanner',       label:'Scanner & Records',     icon:'qr_code_scanner',       order:2,  visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'Tools'},
  {id:'a-classroom',     label:'Seating Layout',        icon:'chair',                 order:3,  visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'Tools'},
  {id:'a-classroom-monitor', label:'Live Monitor',      icon:'monitoring',            order:4,  visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'Tools'},
  {id:'a-store',         label:'Manage Store',          icon:'inventory_2',           order:5,  visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'Tools'},
  {id:'a-pos',           label:'Reward POS',            icon:'point_of_sale',         order:6,  visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'Tools'},
  {id:'a-quizzes',       label:'Quest Builder',         icon:'edit_note',             order:7,  visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'Content'},
  {id:'a-stagemap',      label:'Stage Map Editor',      icon:'map',                   order:8,  visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'Content'},
  {id:'a-achievements',  label:'Achievement Mgmt',      icon:'emoji_events',          order:9,  visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'Content'},
  {id:'a-titles',        label:'Titles & Badges',       icon:'workspace_premium',     order:10, visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'Content'},
  {id:'a-bossevents',    label:'Boss Events',           icon:'local_fire_department', order:11, visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'Events'},
  {id:'a-boss-studio',   label:'Boss Studio',           icon:'smart_toy',             order:12, visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'Events'},
  {id:'a-promotions',    label:'Store Promotions',      icon:'campaign',              order:13, visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'Marketing'},
  {id:'a-registrations', label:'Student Registrations', icon:'person_add',            order:14, visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'Students'},
  {id:'a-mail',          label:'Mail System',           icon:'mail',                  order:15, visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'Students'},
  {id:'a-analytics',     label:'Analytics',             icon:'insights',              order:16, visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'Reporting'},
  {id:'a-leaderboard',   label:'Leaderboard Admin',     icon:'leaderboard',           order:17, visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'Reporting'},
  {id:'a-nav-manager',   label:'Navigation Manager',    icon:'tune',                  order:18, visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'System', adminOnly:true},
  {id:'a-teachers',      label:'Teacher Directory',     icon:'groups',                order:19, visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'System', adminOnly:true},
  {id:'a-starter-pack',  label:'Starter Pack',          icon:'redeem',                order:20, visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'System', adminOnly:true},
  {id:'a-settings',      label:'School Settings',       icon:'settings',              order:21, visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'System', adminOnly:true},
  {id:'a-content-oversight', label:'Content Oversight', icon:'travel_explore',        order:22, visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'System', adminOnly:true},
  {id:'a-audit-log',     label:'Audit Log',             icon:'fact_check',            order:23, visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'System', adminOnly:true},
];
// ISOLATION_ROLES_PLAN.md §10/§11 — `adminOnly:true` rows are filtered out
// of a `teacher` caller's nav in _dsmBuildNav() below, regardless of their
// persisted `visible` flag. Nav Manager itself is one of these now: a single
// shared dsm_settings row that any teacher could previously edit for the
// whole school (see save_dsm_settings()'s is_admin() check, same phase).

// ── STATE ──────────────────────────────────────────────
// _dsmState holds the *working* (in-memory) copy the Nav Manager
// UI edits. Nothing touches localStorage until dsmApplyAndRefresh()
// or dsmResetToDefaults() is called.

let _dsmState = null;          // { student: [...], admin: [...] }
let _dsmActiveTab = 'admin';   // 'student' | 'admin' — which tab the UI shows
let _dsmExpanded = {};         // { [itemId]: true } — expanded advanced-fields rows
let _dsmDirty = false;         // true when there are unsaved edits

function _dsmCloneDefaults() {
  return {
    student: DSM_STUDENT_DEFAULTS.map(x => ({ ...x })),
    admin:   DSM_ADMIN_DEFAULTS.map(x => ({ ...x })),
  };
}

// Safety net: DSM_STUDENT_DEFAULTS / DSM_ADMIN_DEFAULTS are a hand-maintained
// list that has to be kept in sync with NAV_STUDENT / NAV_ADMIN in nav.js. If
// those two ever drift apart (a tab gets added to nav.js but the DSM defaults
// list isn't updated to match), that tab would otherwise silently vanish from
// the sidebar the moment DSM starts actively filtering by its own list — this
// is exactly what happened to "Live Monitor" (a-classroom-monitor). To make
// that class of bug impossible going forward, reconcile against the raw
// nav.js arrays: any id present there but missing from `list` gets appended,
// visible by default, using nav.js's label/icon as a fallback.
function _dsmReconcileWithNav(list, navArray) {
  if (!Array.isArray(navArray)) return list;
  const known = new Set(list.map(x => x.id));
  const maxOrder = list.reduce((m, x) => Math.max(m, x.order || 0), 0);
  let nextOrder = maxOrder;
  const extras = [];
  navArray.forEach(navItem => {
    if (known.has(navItem.id)) return;
    nextOrder += 1;
    extras.push({
      id: navItem.id, label: navItem.label, icon: navItem.icon,
      order: nextOrder, visible: true, locked: false, disabled: false,
      status: 'active', lockMsg: '', unlockReq: '', group: '',
    });
  });
  return extras.length ? list.concat(extras) : list;
}

// Merge persisted rows onto the current defaults by `id`. Anything
// present in the defaults but missing from `saved` (a newly added
// nav item) falls back to its default row untouched. Anything in
// `saved` that no longer exists in the defaults (a removed nav
// item) is silently dropped.
function _dsmMergeList(defaults, saved) {
  const savedMap = {};
  if (Array.isArray(saved)) {
    saved.forEach(s => { if (s && s.id) savedMap[s.id] = s; });
  }
  return defaults.map(def => {
    const s = savedMap[def.id];
    return s ? { ...def, ...s, id: def.id } : { ...def };
  });
}

function dsmLoad() {
  let raw = null;
  try { raw = DSMService.read(); } catch (e) {}
  if (!raw || typeof raw !== 'object') {
    _dsmState = _dsmCloneDefaults();
  } else {
    _dsmState = {
      student: _dsmMergeList(DSM_STUDENT_DEFAULTS, raw.student),
      admin:   _dsmMergeList(DSM_ADMIN_DEFAULTS, raw.admin),
    };
  }
  _dsmState.student = _dsmReconcileWithNav(_dsmState.student, typeof NAV_STUDENT !== 'undefined' ? NAV_STUDENT : null);
  _dsmState.admin   = _dsmReconcileWithNav(_dsmState.admin, typeof NAV_ADMIN !== 'undefined' ? NAV_ADMIN : null);
}

function dsmSave() {
  try { DSMService.write(_dsmState); } catch (e) {}
  _dsmDirty = false;
}

function _dsmEnsureLoaded() {
  if (!_dsmState) dsmLoad();
}

function _dsmFindItem(tab, id) {
  _dsmEnsureLoaded();
  return (_dsmState[tab] || []).find(x => x.id === id) || null;
}

// ── NAV BUILDERS (consumed by nav.js → setupSidebar()) ────────
// Produces the flat array setupSidebar() expects: visible items in
// order, with `_group` marker rows inserted whenever the group
// changes, and per-item `_cfg` (status/locked/disabled) for badges.

function _dsmBuildNav(list, role) {
  // ISOLATION_ROLES_PLAN.md §10/§11: adminOnly rows never reach a `teacher`
  // caller's sidebar, no matter what a saved DSM row says for `visible` —
  // a teacher account has no legitimate way to flip that back on for
  // itself, since save_dsm_settings() only accepts admin-only-item changes
  // from an actual admin caller in the first place (student nav has no
  // adminOnly rows, so `role` is simply unused/undefined there).
  const items = [...list]
    .filter(it => it.visible !== false)
    .filter(it => !it.adminOnly || role === 'admin')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const out = [];
  let lastGroup = null;
  items.forEach(it => {
    const group = it.group || '';
    if (group && group !== lastGroup) {
      out.push({ id: '_grp_' + group, label: group, _group: true });
    }
    lastGroup = group;
    out.push({
      id: it.id,
      label: it.label,
      icon: it.icon,
      _cfg: { status: it.status, locked: !!it.locked, disabled: !!it.disabled },
    });
  });
  return out;
}

window.dsmGetStudentNav = function () {
  _dsmEnsureLoaded();
  return _dsmBuildNav(_dsmState.student);
};

window.dsmGetAdminNav = function (role) {
  _dsmEnsureLoaded();
  return _dsmBuildNav(_dsmState.admin, role);
};

// ── UI: NAVIGATION MANAGER PAGE ────────────────────────

window.renderNavManager = function () {
  _dsmEnsureLoaded();
  const el = document.getElementById('a-nav-manager');
  if (!el) return;

  el.innerHTML = `
  <div class="page-hero">
    <div class="page-hero-bg"></div>
    <div style="position:relative;z-index:1">
      <div class="page-hero-label">🧭 System Control</div>
      <h1 style="font-family:var(--fh);font-size:32px;font-weight:900;color:var(--on-surface);margin-bottom:8px">Navigation Manager</h1>
      <p style="font-size:14px;color:var(--text-muted)">Show, hide, lock, relabel, or reorder the sidebar tabs students and admins see.${_dsmDirty ? ' <span style="color:#ffb95f;font-weight:700">● Unsaved changes</span>' : ''}</p>
    </div>
  </div>

  <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;align-items:center">
    <button class="btn ${_dsmActiveTab === 'student' ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="dsmSwitchTab('student')">🎓 Student Nav</button>
    <button class="btn ${_dsmActiveTab === 'admin' ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="dsmSwitchTab('admin')">🛠️ Admin Nav</button>
    <div style="flex:1"></div>
    <button class="btn btn-ghost btn-sm" onclick="dsmShowAll('${_dsmActiveTab}')">👁️ Show All</button>
    <button class="btn btn-ghost btn-sm" onclick="dsmHideAll('${_dsmActiveTab}')">🙈 Hide All</button>
    <button class="btn btn-ghost btn-sm" onclick="dsmUnlockAll('${_dsmActiveTab}')">🔓 Unlock All</button>
    <button class="btn btn-danger btn-sm" onclick="dsmResetToDefaults('${_dsmActiveTab}')">↺ Reset to Defaults</button>
    <button class="btn btn-success btn-sm" onclick="dsmApplyAndRefresh()">✅ Apply &amp; Refresh</button>
  </div>

  <div class="glass-card" style="padding:0;overflow:hidden">
    <div style="display:grid;grid-template-columns:56px 34px 1fr 132px 96px 96px 96px 34px;gap:10px;align-items:center;padding:10px 16px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);border-bottom:1px solid var(--border2)">
      <span>Order</span><span></span><span>Tab</span><span>Status</span><span>Visible</span><span>Locked</span><span>Enabled</span><span></span>
    </div>
    ${_dsmRenderRows()}
  </div>
  `;
};

function _dsmRenderRows() {
  const tab = _dsmActiveTab;
  const list = [...(_dsmState[tab] || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (list.length === 0) {
    return `<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px">No nav items configured for this tab.</div>`;
  }
  const statusOptions = [
    { v: 'active', l: 'Active' },
    { v: 'coming_soon', l: 'Coming Soon' },
    { v: 'event_only', l: 'Event Only' },
  ];

  return list.map(it => {
    const expanded = !!_dsmExpanded[it.id];
    const dim = it.visible === false ? 'opacity:.45' : '';
    return `
    <div style="border-bottom:1px solid var(--border2)">
      <div style="display:grid;grid-template-columns:56px 34px 1fr 132px 96px 96px 96px 34px;gap:10px;align-items:center;padding:12px 16px;${dim}">
        <input type="number" min="1" value="${it.order ?? 0}" style="width:48px;text-align:center;font-size:12px;padding:5px"
          onchange="dsmSetField('${tab}','${it.id}','order',this.value)">
        <span class="material-symbols-outlined" style="font-size:18px;color:var(--text-muted)">${_esc(it.icon || 'circle')}</span>
        <div style="min-width:0">
          <input type="text" value="${_esc(it.label)}" style="width:100%;font-size:13px;font-weight:700;padding:5px 8px"
            onchange="dsmSetField('${tab}','${it.id}','label',this.value)">
          <div style="font-size:10px;color:var(--text-muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(it.id)}${it.group ? ' · ' + _esc(it.group) : ''}${it.adminOnly ? ' · <span style="color:#ff8a80;font-weight:800">ADMIN ONLY</span>' : ''}</div>
        </div>
        <select style="font-size:11px;padding:5px" onchange="dsmSetStatus('${tab}','${it.id}',this.value)">
          ${statusOptions.map(o => `<option value="${o.v}" ${it.status === o.v ? 'selected' : ''}>${o.l}</option>`).join('')}
        </select>
        <button class="btn btn-xs ${it.visible !== false ? 'btn-success' : 'btn-ghost'}" style="width:100%" onclick="dsmToggle('${tab}','${it.id}','visible')">${it.visible !== false ? 'Visible' : 'Hidden'}</button>
        <button class="btn btn-xs ${it.locked ? 'btn-danger' : 'btn-ghost'}" style="width:100%" onclick="dsmToggle('${tab}','${it.id}','locked')">${it.locked ? 'Locked' : 'Open'}</button>
        <button class="btn btn-xs ${!it.disabled ? 'btn-success' : 'btn-ghost'}" style="width:100%" onclick="dsmToggle('${tab}','${it.id}','disabled')">${it.disabled ? 'Disabled' : 'Enabled'}</button>
        <button class="btn btn-ghost btn-xs" title="More options" onclick="dsmExpandRow('${tab}','${it.id}')">
          <span class="material-symbols-outlined" style="font-size:16px">${expanded ? 'expand_less' : 'expand_more'}</span>
        </button>
      </div>
      ${expanded ? `
      <div style="padding:0 16px 16px 90px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Icon (Material Symbol name)</label>
          <input type="text" value="${_esc(it.icon || '')}" style="width:100%"
            onchange="dsmSetField('${tab}','${it.id}','icon',this.value)">
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Sidebar Group Heading</label>
          <input type="text" value="${_esc(it.group || '')}" placeholder="e.g. Tools" style="width:100%"
            onchange="dsmSetField('${tab}','${it.id}','group',this.value)">
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Lock Message</label>
          <input type="text" value="${_esc(it.lockMsg || '')}" placeholder="Shown when locked/disabled" style="width:100%"
            onchange="dsmSetField('${tab}','${it.id}','lockMsg',this.value)">
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Unlock Requirement</label>
          <input type="text" value="${_esc(it.unlockReq || '')}" placeholder="e.g. Reach Level 3" style="width:100%"
            onchange="dsmSetField('${tab}','${it.id}','unlockReq',this.value)">
        </div>
      </div>` : ''}
    </div>`;
  }).join('');
}

// ── MUTATIONS ───────────────────────────────────────────
// All of these edit the in-memory working copy only. Nothing is
// persisted or reflected in the live sidebar until Apply & Refresh
// (or Reset to Defaults, which saves immediately).

window.dsmSwitchTab = function (tab) {
  if (tab !== 'student' && tab !== 'admin') return;
  _dsmActiveTab = tab;
  renderNavManager();
};

window.dsmToggle = function (tab, id, field) {
  const item = _dsmFindItem(tab, id);
  if (!item) return;
  item[field] = !item[field];
  _dsmDirty = true;
  renderNavManager();
};

window.dsmSetStatus = function (tab, id, status) {
  const item = _dsmFindItem(tab, id);
  if (!item) return;
  item.status = status;
  _dsmDirty = true;
  renderNavManager();
};

window.dsmSetField = function (tab, id, field, value) {
  const item = _dsmFindItem(tab, id);
  if (!item) return;
  if (field === 'order') {
    const n = parseInt(value, 10);
    item.order = isNaN(n) ? item.order : n;
  } else {
    item[field] = value;
  }
  _dsmDirty = true;
  renderNavManager();
};

window.dsmExpandRow = function (tab, id) {
  _dsmExpanded[id] = !_dsmExpanded[id];
  renderNavManager();
};

window.dsmShowAll = function (tab) {
  _dsmEnsureLoaded();
  (_dsmState[tab] || []).forEach(it => { it.visible = true; });
  _dsmDirty = true;
  renderNavManager();
};

window.dsmHideAll = function (tab) {
  _dsmEnsureLoaded();
  (_dsmState[tab] || []).forEach(it => { it.visible = false; });
  _dsmDirty = true;
  renderNavManager();
};

window.dsmUnlockAll = function (tab) {
  _dsmEnsureLoaded();
  (_dsmState[tab] || []).forEach(it => {
    it.locked = false;
    it.disabled = false;
    if (it.status === 'coming_soon' || it.status === 'event_only') it.status = 'active';
  });
  _dsmDirty = true;
  renderNavManager();
};

window.dsmResetToDefaults = function (tab) {
  _dsmEnsureLoaded();
  if (tab === 'student') _dsmState.student = DSM_STUDENT_DEFAULTS.map(x => ({ ...x }));
  else if (tab === 'admin') _dsmState.admin = DSM_ADMIN_DEFAULTS.map(x => ({ ...x }));
  else _dsmState = _dsmCloneDefaults();
  dsmSave();
  if (typeof setupSidebar === 'function') setupSidebar();
  renderNavManager();
  if (typeof toast === 'function') toast('↺ Navigation reset to defaults', '#4edea3');
};

window.dsmApplyAndRefresh = function () {
  dsmSave();
  if (typeof setupSidebar === 'function') setupSidebar();
  renderNavManager();
  if (typeof toast === 'function') toast('✅ Navigation updated', '#4edea3');
};
