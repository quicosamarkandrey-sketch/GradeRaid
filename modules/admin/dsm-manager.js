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
  // Not a sidebar page — the floating "Quest Map" button pinned to the
  // bottom-right of the student shell (index.html #stage-map-btn, shown/
  // hidden in auth.js bootApp()). Flagged `widget:true` so _dsmBuildNav()
  // skips it when building the actual sidebar list (it has no page to
  // navTo() into), while it still gets a normal row + Visible/Hidden
  // toggle in Nav Manager > Student Nav like any other entry, and still
  // participates in load/save/merge/reconcile exactly like the rest of
  // DSM_STUDENT_DEFAULTS. See dsmIsWidgetVisible() below.
  {id:'s-stagemap-btn', label:'Quest Map (Floating Button)', icon:'map', order:12, visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'', widget:true},
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
  {id:'a-class-logs',    label:'Recitation & Attendance', icon:'history_edu',          order:16.5, visible:true, locked:false, disabled:false, status:'active', lockMsg:'', unlockReq:'', group:'Reporting'},
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

// PHASE 70 — teacher gets its OWN persisted list, no longer a filtered view
// of DSM_ADMIN_DEFAULTS at read time. Before this, teacher and admin sessions
// shared the exact same 'admin' dsm_settings row — the only thing that ever
// separated them was the hardcoded ADMIN_ONLY_NAV_IDS/adminOnly check, so any
// OTHER admin-facing page (Analytics, Boss Studio, Store Promotions, etc.)
// showed up in a teacher's sidebar too, and an admin had no lever in Nav
// Manager to hide/reorder/lock it for teachers without also changing it for
// the real admin account. Seeding the defaults as "everything admin has,
// minus the adminOnly rows" preserves today's actual behavior on first
// load — nothing new appears or disappears for existing teachers the
// moment this ships — while giving admins a genuinely separate "Teacher
// Nav" tab to diverge from there.
const DSM_TEACHER_DEFAULTS = DSM_ADMIN_DEFAULTS
  .filter(x => !x.adminOnly)
  .map(x => ({ ...x }));

// ── STATE ──────────────────────────────────────────────
// _dsmState holds the *working* (in-memory) copy the Nav Manager
// UI edits. Nothing touches localStorage until dsmApplyAndRefresh()
// or dsmResetToDefaults() is called.

let _dsmState = null;          // { student: [...], teacher: [...], admin: [...] }
let _dsmActiveTab = 'admin';   // 'student' | 'teacher' | 'admin' — which tab the UI shows
let _dsmExpanded = {};         // { [itemId]: true } — expanded advanced-fields rows
let _dsmDirty = false;         // true when there are unsaved edits
let _dsmSearch = '';           // filters the current tab's rows by label/id/group

function _dsmCloneDefaults() {
  return {
    student: DSM_STUDENT_DEFAULTS.map(x => ({ ...x })),
    teacher: DSM_TEACHER_DEFAULTS.map(x => ({ ...x })),
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
      // Phase 70: fall back to the teacher defaults (admin minus adminOnly
      // rows) when nothing's been saved to the 'teacher' scope yet — e.g.
      // right after this migration ships, before any admin has hit "Apply &
      // Refresh" on the new Teacher Nav tab.
      teacher: _dsmMergeList(DSM_TEACHER_DEFAULTS, (raw.teacher && raw.teacher.length) ? raw.teacher : null),
      admin:   _dsmMergeList(DSM_ADMIN_DEFAULTS, raw.admin),
    };
  }
  _dsmState.student = _dsmReconcileWithNav(_dsmState.student, typeof NAV_STUDENT !== 'undefined' ? NAV_STUDENT : null);
  _dsmState.admin   = _dsmReconcileWithNav(_dsmState.admin, typeof NAV_ADMIN !== 'undefined' ? NAV_ADMIN : null);
  // Teacher reconciles against NAV_ADMIN too (its only source of truth for
  // new nav ids), but with ADMIN_ONLY_NAV_IDS items excluded — a brand-new
  // admin-only page added to NAV_ADMIN later should never silently leak
  // into the teacher sidebar just because it's missing from the teacher list.
  const _teacherNavSource = (typeof NAV_ADMIN !== 'undefined' && typeof ADMIN_ONLY_NAV_IDS !== 'undefined')
    ? NAV_ADMIN.filter(t => ADMIN_ONLY_NAV_IDS.indexOf(t.id) === -1)
    : null;
  _dsmState.teacher = _dsmReconcileWithNav(_dsmState.teacher, _teacherNavSource);
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

// Groups a nav list into ordered blocks: named-group blocks (one per
// distinct `group` value, all members together) and ungrouped items as
// their own singleton blocks — shared by _dsmBuildNav() (sidebar render)
// and the "Manage Groups" panel (dsmMoveGroup/_dsmGroupManagerHTML) so
// both agree on exactly the same block order. Operates on whatever list
// you pass in — pass the full unfiltered tab list for management (so a
// temporarily-hidden group can still be reordered/renamed), or a
// visibility-filtered list for the actual sidebar.
//
// A group's block position is anchored to the LOWEST `order` value among
// its own members — editing one member's `order` only reshuffles it
// within the block (or moves the anchor if it becomes the new lowest),
// it can never split the block or bleed into a neighboring group's range.
// Group names are admin-typed free text (unlike the slug-like `id`s used
// in every other onclick call in this file), so a name containing an
// apostrophe would otherwise break out of the single-quoted JS string
// literal inside onclick="...". _esc() only handles HTML-attribute
// escaping (", <, >) — this handles the JS-string-literal escaping on top
// of it for the handful of spots that embed a group name in onclick.
function _dsmJsAttr(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function _dsmComputeBlocks(list) {
  const groupAnchor = new Map(); // group name -> lowest order among its members
  list.forEach(it => {
    const g = it.group || '';
    if (!g) return;
    const cur = groupAnchor.has(g) ? groupAnchor.get(g) : Infinity;
    groupAnchor.set(g, Math.min(cur, it.order ?? 0));
  });

  const blocksByKey = new Map(); // group name ('' key = per-item singleton) -> block
  list.forEach(it => {
    const g = it.group || '';
    const key = g || ('__single__' + it.id);
    if (!blocksByKey.has(key)) {
      blocksByKey.set(key, { name: g, order: g ? groupAnchor.get(g) : (it.order ?? 0), items: [] });
    }
    blocksByKey.get(key).items.push(it);
  });

  const blocks = [...blocksByKey.values()];
  blocks.forEach(b => b.items.sort((a, b2) => (a.order ?? 0) - (b2.order ?? 0)));
  blocks.sort((a, b) => a.order - b.order);
  return blocks; // [{ name: '' | groupName, order, items: [...] }]
}

function _dsmBuildNav(list, isRealAdmin) {
  // ISOLATION_ROLES_PLAN.md §10/§11: adminOnly rows never reach anything
  // but the real admin's own sidebar, no matter what a saved DSM row says
  // for `visible`. Phase 70: teacher now reads a completely separate
  // 'teacher' scope that has no adminOnly rows in it to begin with (see
  // DSM_TEACHER_DEFAULTS / _dsmReconcileWithNav's teacher-specific source),
  // so this filter is now just a defensive floor on the admin list itself —
  // it's not what separates teacher from admin anymore.
  const visible = [...list]
    .filter(it => it.visible !== false)
    .filter(it => !it.adminOnly || isRealAdmin)
    // widget rows (e.g. s-stagemap-btn) aren't sidebar pages — they have no
    // showPage()/navTo() target, so they never belong in the rendered nav
    // list. Their `visible` flag is read separately via
    // dsmIsWidgetVisible() by whatever renders that widget.
    .filter(it => !it.widget);

  const out = [];
  _dsmComputeBlocks(visible).forEach(block => {
    if (block.name) out.push({ id: '_grp_' + block.name, label: block.name, _group: true });
    block.items.forEach(it => {
      out.push({
        id: it.id,
        label: it.label,
        icon: it.icon,
        _cfg: { status: it.status, locked: !!it.locked, disabled: !!it.disabled },
      });
    });
  });
  return out;
}

window.dsmGetStudentNav = function () {
  _dsmEnsureLoaded();
  return _dsmBuildNav(_dsmState.student);
};

window.dsmGetAdminNav = function () {
  _dsmEnsureLoaded();
  return _dsmBuildNav(_dsmState.admin, /* isRealAdmin */ true);
};

// PHASE 70 — teacher's own nav, built from its own persisted 'teacher'
// scope rather than a role-filtered view of the admin list. isRealAdmin is
// always false here: a teacher's saved list should never contain an
// adminOnly row in the first place (DSM_TEACHER_DEFAULTS excludes them and
// reconciliation only ever adds NON-adminOnly NAV_ADMIN items), but this
// keeps the same defensive floor in case of stale/hand-edited data.
window.dsmGetTeacherNav = function () {
  _dsmEnsureLoaded();
  return _dsmBuildNav(_dsmState.teacher, /* isRealAdmin */ false);
};

// Visibility check for non-sidebar "widget" rows (currently just
// s-stagemap-btn, the floating Quest Map button). Falls back to visible=true
// if DSM hasn't loaded yet or the row doesn't exist, so a missing/older
// persisted list never accidentally hides the widget for everyone.
window.dsmIsWidgetVisible = function (id, scope) {
  _dsmEnsureLoaded();
  const list = _dsmState[scope || 'student'] || [];
  const it = list.find(x => x.id === id);
  return it ? it.visible !== false : true;
};

// Full config for a non-sidebar "widget" row — used by callers that need
// more than just the visible flag (e.g. the floating Quest Map button also
// respecting Locked/Coming Soon/Disabled from Nav Manager, same as a normal
// sidebar tab does). Returns a safe all-open default if DSM hasn't loaded
// or the row doesn't exist, so a missing/older persisted list never
// accidentally locks the widget out for everyone.
window.dsmGetWidgetConfig = function (id, scope) {
  _dsmEnsureLoaded();
  const list = _dsmState[scope || 'student'] || [];
  const it = list.find(x => x.id === id);
  if (!it) return { visible: true, locked: false, disabled: false, status: 'active', lockMsg: '' };
  return {
    visible: it.visible !== false,
    locked: !!it.locked,
    disabled: !!it.disabled,
    status: it.status || 'active',
    lockMsg: it.lockMsg || '',
  };
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
      <p style="font-size:14px;color:var(--text-muted)">Show, hide, lock, relabel, or reorder the sidebar tabs students, teachers, and admins see.${_dsmDirty ? ' <span style="color:#ffb95f;font-weight:700">● Unsaved changes</span>' : ''}</p>
    </div>
  </div>

  <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;align-items:center">
    <button class="btn ${_dsmActiveTab === 'student' ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="dsmSwitchTab('student')">🎓 Student Nav</button>
    <button class="btn ${_dsmActiveTab === 'teacher' ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="dsmSwitchTab('teacher')">🍎 Teacher Nav</button>
    <button class="btn ${_dsmActiveTab === 'admin' ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="dsmSwitchTab('admin')">🛠️ Admin Nav</button>
    <div style="flex:1"></div>
    <button class="btn btn-ghost btn-sm" onclick="dsmShowAll('${_dsmActiveTab}')">👁️ Show All</button>
    <button class="btn btn-ghost btn-sm" onclick="dsmHideAll('${_dsmActiveTab}')">🙈 Hide All</button>
    <button class="btn btn-ghost btn-sm" onclick="dsmUnlockAll('${_dsmActiveTab}')">🔓 Unlock All</button>
    <button class="btn btn-danger btn-sm" onclick="dsmResetToDefaults('${_dsmActiveTab}')">↺ Reset to Defaults</button>
    <button class="btn btn-success btn-sm" onclick="dsmApplyAndRefresh()">✅ Apply &amp; Refresh</button>
  </div>

  <div class="glass-card" style="padding:16px;margin-bottom:16px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <span class="material-symbols-outlined" style="font-size:18px;color:var(--text-muted)">folder_managed</span>
      <h3 style="font-family:var(--fh);font-size:14px;font-weight:800;margin:0">Manage Groups</h3>
      <span style="font-size:11px;color:var(--text-muted)">— rename a group or move it earlier/later; assign a tab to a group from its row below</span>
    </div>
    ${_dsmGroupManagerHTML(_dsmActiveTab)}
  </div>

  <div style="margin-bottom:12px;max-width:280px">
    <input type="text" placeholder="Search tabs by name, id, or group…" value="${_esc(_dsmSearch)}" oninput="dsmSetSearch(this.value)">
  </div>

  <div class="glass-card" style="padding:0;overflow:hidden">
    <div style="display:grid;grid-template-columns:56px 34px 1fr 132px 96px 96px 96px 34px;gap:10px;align-items:center;padding:10px 16px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);border-bottom:1px solid var(--border2)">
      <span>Order</span><span></span><span>Tab</span><span>Status</span><span>Visible</span><span>Locked</span><span>Enabled</span><span></span>
    </div>
    <div id="dsm-rows">${_dsmRenderRows()}</div>
  </div>
  `;
};

// Renders the group list for the current tab in display order (same
// ordering _dsmBuildNav() uses for the real sidebar), each with a member
// count, a rename button, and up/down controls to move the whole block.
function _dsmGroupManagerHTML(tab) {
  const list = _dsmState[tab] || [];
  const groupBlocks = _dsmComputeBlocks(list).filter(b => b.name);
  if (!groupBlocks.length) {
    return `<div style="font-size:12px;color:var(--text-muted)">No groups yet — open a tab's row below and assign it to a group.</div>`;
  }
  return `<div style="display:flex;flex-direction:column;gap:6px">
    ${groupBlocks.map((b, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(255,255,255,.03);border-radius:8px">
      <div style="display:flex;flex-direction:column;gap:2px">
        <button class="btn btn-ghost btn-xs" style="padding:2px 6px" title="Move up" ${i === 0 ? 'disabled' : ''} onclick="dsmMoveGroup('${tab}','${_dsmJsAttr(b.name)}',-1)">
          <span class="material-symbols-outlined" style="font-size:14px">keyboard_arrow_up</span>
        </button>
        <button class="btn btn-ghost btn-xs" style="padding:2px 6px" title="Move down" ${i === groupBlocks.length - 1 ? 'disabled' : ''} onclick="dsmMoveGroup('${tab}','${_dsmJsAttr(b.name)}',1)">
          <span class="material-symbols-outlined" style="font-size:14px">keyboard_arrow_down</span>
        </button>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700">${_esc(b.name)}</div>
        <div style="font-size:11px;color:var(--text-muted)">${b.items.length} tab${b.items.length === 1 ? '' : 's'} · ${b.items.map(it => _esc(it.label)).join(', ')}</div>
      </div>
      <button class="btn btn-ghost btn-xs" onclick="dsmRenameGroup('${tab}','${_dsmJsAttr(b.name)}')">✏️ Rename</button>
    </div>`).join('')}
  </div>`;
}

function _dsmRenderRows() {
  const tab = _dsmActiveTab;
  let list = [...(_dsmState[tab] || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const q = _dsmSearch.trim().toLowerCase();
  if (q) {
    list = list.filter(it =>
      (it.label || '').toLowerCase().includes(q) ||
      (it.id || '').toLowerCase().includes(q) ||
      (it.group || '').toLowerCase().includes(q)
    );
  }
  if (list.length === 0) {
    return `<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px">${q ? 'No tabs match your search.' : 'No nav items configured for this tab.'}</div>`;
  }
  const statusOptions = [
    { v: 'active', l: 'Active' },
    { v: 'coming_soon', l: 'Coming Soon' },
    { v: 'event_only', l: 'Event Only' },
  ];
  const allGroupNames = [...new Set((_dsmState[tab] || []).map(x => x.group || '').filter(Boolean))].sort();

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
          <label class="form-label">Sidebar Group</label>
          <select style="width:100%" onchange="dsmAssignGroup('${tab}','${it.id}',this.value)">
            <option value="" ${!it.group ? 'selected' : ''}>— No group —</option>
            ${allGroupNames.map(g => `<option value="${_esc(g)}" ${it.group === g ? 'selected' : ''}>${_esc(g)}</option>`).join('')}
            <option value="__new__">+ New group…</option>
          </select>
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
  if (tab !== 'student' && tab !== 'teacher' && tab !== 'admin') return;
  _dsmActiveTab = tab;
  _dsmSearch = '';
  renderNavManager();
};

window.dsmSetSearch = function (value) {
  _dsmSearch = String(value || '');
  const rows = document.getElementById('dsm-rows');
  if (rows) rows.innerHTML = _dsmRenderRows();
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

// ── GROUP MANAGEMENT ────────────────────────────────────
// Lets an admin decide which named group each tab belongs to (via a
// dropdown of the groups already in use, instead of freeform typing that
// invited typos like "Tool" vs "Tools"), rename a group everywhere it's
// used in one go, or move a whole group block earlier/later relative to
// its neighbors — separate from a single item's own position within its
// group (still set via the Order column).

window.dsmAssignGroup = function (tab, id, value) {
  const item = _dsmFindItem(tab, id);
  if (!item) return;
  if (value === '__new__') {
    const name = prompt('New group name:', '');
    if (!name || !name.trim()) { renderNavManager(); return; } // cancelled/empty — reset the select back to its current value
    item.group = name.trim();
  } else {
    item.group = value; // '' = no group
  }
  _dsmDirty = true;
  renderNavManager();
};

window.dsmRenameGroup = function (tab, oldName) {
  const newName = prompt('Rename group "' + oldName + '" to:', oldName);
  if (newName === null) return; // cancelled
  const trimmed = newName.trim();
  if (!trimmed || trimmed === oldName) return;
  _dsmEnsureLoaded();
  (_dsmState[tab] || []).forEach(it => {
    if ((it.group || '') === oldName) it.group = trimmed;
  });
  _dsmDirty = true;
  renderNavManager();
};

// Swaps the whole named-group block with its immediate neighbor (dir: -1
// up, +1 down) in the tab's current display order, then renumbers every
// item's `order` sequentially block-by-block so the new arrangement holds
// regardless of whatever numbers were in play before — no manual
// order-juggling needed to move a whole group.
window.dsmMoveGroup = function (tab, groupName, dir) {
  _dsmEnsureLoaded();
  const list = _dsmState[tab] || [];
  const blocks = _dsmComputeBlocks(list);
  const idx = blocks.findIndex(b => b.name === groupName);
  if (idx === -1) return;
  const target = idx + dir;
  if (target < 0 || target >= blocks.length) return;
  const tmp = blocks[idx];
  blocks[idx] = blocks[target];
  blocks[target] = tmp;
  let n = 1;
  blocks.forEach(b => { b.items.forEach(it => { it.order = n++; }); });
  _dsmDirty = true;
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
  else if (tab === 'teacher') _dsmState.teacher = DSM_TEACHER_DEFAULTS.map(x => ({ ...x }));
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
