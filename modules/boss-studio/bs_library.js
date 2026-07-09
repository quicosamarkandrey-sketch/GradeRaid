// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/boss-studio/library.js
//  Boss Studio Phase 1: library tab, boss cards, encounter preview overlay,
//  search/filter/sort/view controls, import/export, delete confirm, duplicate.
//  LOAD AFTER: storage.js
// ═══════════════════════════════════════════════════════════════════════════════

// ── Constants ─────────────────────────────────────────────────────────────────

window.BS_PALETTES = [
  { label: 'Void',    theme: '#8b5cf6', aura: '#EC4899', accent: '#d0bcff' },
  { label: 'Inferno', theme: '#ef4444', aura: '#f97316', accent: '#ffb95f' },
  { label: 'Abyssal', theme: '#1d4ed8', aura: '#06b6d4', accent: '#93c5fd' },
  { label: 'Poison',  theme: '#16a34a', aura: '#4ade80', accent: '#86efac' },
  { label: 'Shadow',  theme: '#374151', aura: '#6b7280', accent: '#d1d5db' },
  { label: 'Cursed',  theme: '#7c3aed', aura: '#db2777', accent: '#f472b6' },
  { label: 'Gilded',  theme: '#d97706', aura: '#fbbf24', accent: '#fef08a' },
  { label: 'Blood',   theme: '#9f1239', aura: '#be123c', accent: '#fda4af' },
];

window.bsvpBlank = function () {
  return {
    id: 'bvp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    name: '', description: '', lore: '', tags: [],
    artwork:      { type: 'emoji', value: '💀' },
    rageArtwork:  { type: null, value: null },
    visual:       { themeColor: BS_DEFAULT_THEME, auraColor: BS_DEFAULT_AURA, cardAccent: BS_DEFAULT_ACCENT },
    animations:   { idle: null, cast: null, hit: null, rage: null },
    effects:      { aura: null, particle: null },
    schemaVersion: BS_SCHEMA_VERSION,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
};

// ── Module state ──────────────────────────────────────────────────────────────
let _bsSearch  = '';
let _bsFilter  = 'all';
let _bsSort    = 'newest';
let _bsView    = 'grid';
let _bsPreview = null;
let _bsDirty   = false;
let _bsSearchDebounceTimer = null;
let _bsTab     = 'bosses'; // 'bosses' | 'animations'
// Guards _bsInitRemoteLibrary() (Pending Fixes Report §2a) to a single pull
// per page load — renderBossStudio() re-runs on every tab switch
// (_bsSetTab), and re-fetching on each of those would be wasteful.
let _bsLibraryRemoteFetchStarted = false;

Object.defineProperty(window, '_bsDraft', {
  get () { return window.__bsDraftValue; },
  set (v) { window.__bsDraftValue = v; },
  configurable: true,
});
window.__bsDraftValue = null;

// ── Private card helpers ──────────────────────────────────────────────────────

function _bsBossCardArtwork(boss) {
  const art   = boss.artwork;
  const theme = boss.visual?.themeColor || '#8b5cf6';
  const aura  = boss.visual?.auraColor  || '#EC4899';
  const auraStyle = `background:radial-gradient(ellipse at center,${aura}55 0%,${theme}22 60%,transparent 100%)`;
  if (!art || !art.value) return `<div class="bs-card-artwork"><div class="bs-card-artwork-placeholder"><span class="material-symbols-outlined">image_not_supported</span><span>No Artwork</span></div></div>`;
  if (art.type === 'emoji') return `<div class="bs-card-artwork"><div class="bs-card-aura" style="${auraStyle}"></div><div class="bs-card-artwork-emoji">${_esc(art.value)}</div></div>`;
  return `<div class="bs-card-artwork"><div class="bs-card-aura" style="${auraStyle}"></div><img class="bs-card-artwork-img" src="${_esc(art.value)}" alt="${_esc(boss.name)}" onerror="this.style.display='none'"></div>`;
}

function _bsCardSlotPips(boss) {
  const anim  = boss.animations || {};
  const slots = [
    { key: 'idle', label: 'Idle', val: anim.idle, rage: false },
    { key: 'cast', label: 'Cast', val: anim.cast, rage: false },
    { key: 'hit',  label: 'Hit',  val: anim.hit,  rage: false },
    { key: 'rage', label: 'Rage', val: anim.rage, rage: true  },
  ];
  const pips = slots.map(s => {
    const animName = s.val && typeof window._alGet === 'function' ? (window._alGet(s.val) || {}).name : null;
    const title    = animName ? `${s.label}: ${animName}` : `${s.label}: unassigned`;
    return `<div class="bs-card-slot-pip ${s.val ? 'filled' : ''} ${s.rage ? 'rage-pip' : ''}" title="${_esc(title)}"></div>`;
  }).join('');
  return `<div class="bs-card-slot-pips" title="Animation slots: Idle / Cast / Hit / Rage">${pips}</div>`;
}

window._bsDateLabel = function (ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date(), diff = now - d;
  if (diff < 60000)   return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// ── Library body renderer (refreshable) ───────────────────────────────────────

function _bsRenderLibraryBody() {
  const library = DB.bossLibrary || [];
  const total   = library.length;

  let filtered = library.filter(b => {
    if (_bsFilter === 'artwork')    return b.artwork?.value;
    if (_bsFilter === 'no-artwork') return !b.artwork?.value;
    if (_bsFilter === 'rage')       return b.rageArtwork?.value;
    if (_bsFilter === 'themed')     return b.visual && (b.visual.themeColor !== '#8b5cf6' || b.visual.auraColor !== '#EC4899');
    return true;
  });
  if (_bsSearch.trim()) {
    const q = _bsSearch.trim().toLowerCase();
    filtered = filtered.filter(b =>
      (b.name || '').toLowerCase().includes(q) ||
      (b.description || '').toLowerCase().includes(q) ||
      (b.lore || '').toLowerCase().includes(q) ||
      (b.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }
  filtered = [...filtered].sort((a, b) => {
    if (_bsSort === 'newest') return (b.updatedAt || 0) - (a.updatedAt || 0);
    if (_bsSort === 'oldest') return (a.updatedAt || 0) - (b.updatedAt || 0);
    if (_bsSort === 'az')     return (a.name || '').localeCompare(b.name || '');
    if (_bsSort === 'za')     return (b.name || '').localeCompare(a.name || '');
    return 0;
  });

  const sectionHeader = `<div class="section-header" style="margin-bottom:0"><span class="material-symbols-outlined">library_books</span><h2>Boss Library</h2><span class="badge-pill">${total} Boss${total !== 1 ? 'es' : ''}</span></div>`;
  const toolbar = `<div class="bs-library-toolbar" style="margin-top:16px">
    <div class="bs-search-wrap"><span class="material-symbols-outlined">search</span>
      <input type="text" placeholder="Search by name, lore, or tag…" value="${_esc(_bsSearch)}" oninput="window._bsSearchUpdate(this.value)" id="bs-search-input"></div>
    <div class="bs-filter-row">
      <button class="bs-filter-btn ${_bsFilter==='all'?'active':''}" onclick="window._bsSetFilter('all')">All</button>
      <button class="bs-filter-btn ${_bsFilter==='artwork'?'active':''}" onclick="window._bsSetFilter('artwork')">Has Artwork</button>
      <button class="bs-filter-btn ${_bsFilter==='no-artwork'?'active':''}" onclick="window._bsSetFilter('no-artwork')">No Artwork</button>
      <button class="bs-filter-btn ${_bsFilter==='rage'?'active':''}" onclick="window._bsSetFilter('rage')">Has Rage Art</button>
      <button class="bs-filter-btn ${_bsFilter==='themed'?'active':''}" onclick="window._bsSetFilter('themed')">Themed</button>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
      <select class="bs-sort-select" onchange="window._bsSetSort(this.value)">
        <option value="newest" ${_bsSort==='newest'?'selected':''}>Newest</option>
        <option value="oldest" ${_bsSort==='oldest'?'selected':''}>Oldest</option>
        <option value="az"     ${_bsSort==='az'?'selected':''}>A → Z</option>
        <option value="za"     ${_bsSort==='za'?'selected':''}>Z → A</option>
      </select>
      <button class="bs-view-btn ${_bsView==='grid'?'active':''}" onclick="window._bsSetView('grid')" title="Grid view"><span class="material-symbols-outlined" style="font-size:16px">grid_view</span></button>
      <button class="bs-view-btn ${_bsView==='list'?'active':''}" onclick="window._bsSetView('list')" title="List view"><span class="material-symbols-outlined" style="font-size:16px">view_list</span></button>
    </div>
  </div>`;

  if (total === 0) return sectionHeader + toolbar + `<div class="bs-empty" style="margin-top:20px"><div class="bs-empty-icon">🏰</div><div class="bs-empty-title">No Boss Profiles Yet</div><div class="bs-empty-sub">Create your first boss profile to begin building your visual library.</div><button class="btn btn-primary" onclick="bsOpenCreate()" style="font-family:var(--fh);font-weight:800"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:middle">add</span> Create First Boss</button></div>`;
  if (filtered.length === 0) return sectionHeader + toolbar + `<div class="bs-empty" style="margin-top:20px"><div class="bs-empty-icon">🔍</div><div class="bs-empty-title">No Results</div><div class="bs-empty-sub">No boss profiles match your search or filter.</div><button class="btn btn-ghost" onclick="window._bsSearchUpdate('');window._bsSetFilter('all')" style="font-family:var(--fh)">Clear Filters</button></div>`;

  const cards = filtered.map(boss => {
    const cardAccent = boss.visual?.cardAccent || '#d0bcff';
    const cardTheme  = boss.visual?.themeColor  || '#8b5cf6';
    const hasRage    = boss.rageArtwork?.value;
    return `<div class="bs-boss-card ${_bsView==='list'?'list-card':''}" onclick="bsOpenPreview('${_esc(boss.id)}')" style="border-color:${cardTheme}55;--bs-card-accent:${cardAccent};--bs-card-glow:${boss.visual?.auraColor||'#EC4899'}55">
      ${_bsBossCardArtwork(boss)}
      ${hasRage ? `<div class="bs-card-rage-badge" title="Rage artwork configured">🔥</div>` : ''}
      <button class="bs-card-preview-btn" onclick="event.stopPropagation();bsOpenPreview('${_esc(boss.id)}')" title="Full encounter preview"><span class="material-symbols-outlined">visibility</span>Preview</button>
      <div class="bs-card-body">
        ${boss.tags?.length ? `<div class="bs-card-tags">${boss.tags.slice(0,3).map(t=>`<span class="bs-card-tag" style="color:${cardAccent};border-color:${cardTheme}44">${_esc(t)}</span>`).join('')}</div>` : ''}
        <div class="bs-card-name" style="color:${cardAccent}">${_esc(boss.name || 'Unnamed Boss')}</div>
        <div class="bs-card-desc">${_esc(boss.description || 'No description provided.')}</div>
        ${_bsCardSlotPips(boss)}
        <div class="bs-card-footer">
          <div class="bs-card-meta">${window._bsDateLabel(boss.updatedAt)}</div>
          <div class="bs-card-actions" onclick="event.stopPropagation()">
            <button class="bs-card-act-btn clone" onclick="bsDuplicate('${_esc(boss.id)}')" title="Duplicate"><span class="material-symbols-outlined">content_copy</span></button>
            <button class="bs-card-act-btn" onclick="bsOpenEdit('${_esc(boss.id)}')" title="Edit"><span class="material-symbols-outlined">edit</span></button>
            <button class="bs-card-act-btn danger" onclick="bsConfirmDelete('${_esc(boss.id)}')" title="Delete"><span class="material-symbols-outlined">delete</span></button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  return sectionHeader + toolbar + `<div class="bs-library-grid ${_bsView === 'list' ? 'list-view' : ''}" style="margin-top:20px">${cards}</div>`;
}

function _bsRefreshLibrary() {
  bsLoad();
  const root = document.getElementById('bs-library-root');
  if (root) root.innerHTML = _bsRenderLibraryBody();
}

// ── Boss Studio tab renderer ───────────────────────────────────────────────────

function _bsRenderBossTab() {
  bsLoad();
  const all = DB.bossLibrary || [];
  const themed = all.filter(b => b.visual?.themeColor && b.visual.themeColor !== BS_DEFAULT_THEME).length;
  const hasArt = all.filter(b => b.artwork?.value).length;
  const hasRage = all.filter(b => b.rageArtwork?.value).length;
  const fullySlotted = all.filter(b => { const a = b.animations || {}; return a.idle && a.cast && a.hit && a.rage; }).length;
  return `
  <div class="bs-hero"><div class="bs-hero-inner">
    <div class="bs-hero-icon">🎭</div>
    <div class="bs-hero-info">
      <div class="bs-hero-label">Asset Management</div>
      <div class="bs-hero-title">Boss Studio</div>
      <div class="bs-hero-sub">Create and manage reusable Boss Visual Profiles. Each profile defines a boss's identity, artwork, lore, and animation slot assignments.</div>
      <div class="bs-hero-stats-bar">
        <div class="bs-stat-pill"><span class="material-symbols-outlined">smart_toy</span><strong>${all.length}</strong> Profile${all.length !== 1 ? 's' : ''}</div>
        ${hasArt ? `<div class="bs-stat-pill"><span class="material-symbols-outlined">palette</span><strong>${hasArt}</strong> With Artwork</div>` : ''}
        ${themed ? `<div class="bs-stat-pill"><span class="material-symbols-outlined">auto_awesome</span><strong>${themed}</strong> Themed</div>` : ''}
        ${hasRage ? `<div class="bs-stat-pill"><span class="material-symbols-outlined">local_fire_department</span><strong>${hasRage}</strong> Rage Art</div>` : ''}
        ${fullySlotted ? `<div class="bs-stat-pill"><span class="material-symbols-outlined">animation</span><strong>${fullySlotted}</strong> Fully Slotted</div>` : ''}
      </div>
      <div class="bs-io-row">
        <span class="bs-io-label">Library:</span>
        <button class="bs-io-btn" onclick="window._bsExportAll()"><span class="material-symbols-outlined">download</span>Export All</button>
        <button class="bs-io-btn" onclick="window._bsImportJSON()"><span class="material-symbols-outlined">upload</span>Import JSON</button>
      </div>
    </div>
    <div class="bs-hero-actions">
      <button class="btn btn-primary" onclick="bsOpenCreate()" style="display:flex;align-items:center;gap:7px;padding:11px 20px;font-family:var(--fh);font-weight:800">
        <span class="material-symbols-outlined" style="font-size:18px">add</span>New Boss Profile
      </button>
    </div>
  </div></div>
  <div id="bs-library-root">${_bsRenderLibraryBody()}</div>`;
}

// ── Main render ────────────────────────────────────────────────────────────────

window.renderBossStudio = function () {
  bsLoad();
  const page = document.getElementById('a-boss-studio');
  if (!page) return;
  window._bsMigrateLegacyInlineImages();
  // Cross-device library sync (Pending Fixes Report §2a) — deliberately NOT
  // kicked off at app boot (see bs_storage.js's _bsInitRemoteLibrary comment
  // for why: no Supabase Auth session exists yet at that point, and
  // get_boss_library() is staff-only). This page only ever mounts post-login
  // for an admin/teacher, so it's the right place. Runs once per page load;
  // re-renders the library view when the pull resolves so remote-only
  // designs appear without the admin needing to do anything.
  if (!_bsLibraryRemoteFetchStarted && typeof window._bsInitRemoteLibrary === 'function') {
    _bsLibraryRemoteFetchStarted = true;
    window._bsInitRemoteLibrary().then(function () {
      if (document.getElementById('a-boss-studio')) renderBossStudio();
    });
  }
  const alTab = typeof window._alRenderTabBody === 'function' ? window._alRenderTabBody() : '<div style="color:var(--text-muted);padding:40px">Animation library loading...</div>';
  page.innerHTML = `<div class="page" style="padding:32px;max-width:1200px;margin:0 auto;display:block">
    <div class="bs-tabs">
      <button class="bs-tab ${_bsTab==='bosses'?'active':''}" onclick="window._bsSetTab('bosses')"><span class="material-symbols-outlined">library_books</span>Boss Library<span class="badge-pill">${(DB.bossLibrary||[]).length}</span></button>
      <button class="bs-tab ${_bsTab==='animations'?'active':''}" onclick="window._bsSetTab('animations')"><span class="material-symbols-outlined">animation</span>Animation Library<span class="badge-pill">${(DB.animationLibrary||[]).length}</span></button>
    </div>
    <div id="bs-tab-root">${_bsTab === 'animations' ? alTab : _bsRenderBossTab()}</div>
  </div>`;
};

window._bsSetTab = function (tab) { _bsTab = tab; renderBossStudio(); };

// ── Preview overlay ────────────────────────────────────────────────────────────

window.bsOpenPreview = function (id) {
  bsLoad();
  const boss = bsGet(id);
  if (!boss) return;
  _bsPreview = boss;
  const theme = boss.visual?.themeColor || BS_DEFAULT_THEME;
  const aura  = boss.visual?.auraColor  || BS_DEFAULT_AURA;
  const accent = boss.visual?.cardAccent || BS_DEFAULT_ACCENT;
  const animSlots = boss.animations || {};
  const slotRows = ['idle', 'cast', 'hit', 'rage'].map(s => {
    const preset = animSlots[s] && typeof window._alGet === 'function' ? window._alGet(animSlots[s]) : null;
    return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.04)"><span style="font-size:11px;color:var(--text-muted);width:32px;text-transform:uppercase;font-weight:700">${s}</span><span style="font-size:12px;font-weight:700;color:${preset ? accent : 'var(--text-muted)'}">${preset ? _esc(preset.name) : 'Unassigned'}</span></div>`;
  }).join('');

  showModal(`<div>
    <div style="display:flex;align-items:flex-start;gap:18px;margin-bottom:16px">
      <div class="bs-anim-stage" style="width:110px;height:110px;flex-shrink:0;background:radial-gradient(circle,${aura}44,${theme}22);border:1.5px solid ${theme}55;border-radius:16px;display:flex;align-items:center;justify-content:center">
        ${boss.artwork?.type === 'emoji' ? `<span class="bs-anim-stage-art ${animSlots.idle ? window._alGet?.(animSlots.idle)?.cssClass||'' : ''}" style="font-size:52px">${_esc(boss.artwork.value)}</span>` : boss.artwork?.value ? `<img src="${_esc(boss.artwork.value)}" style="width:88px;height:88px;object-fit:contain">` : `<span style="font-size:48px">💀</span>`}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--fh);font-size:20px;font-weight:900;color:${accent};margin-bottom:4px">${_esc(boss.name || 'Unnamed Boss')}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;line-height:1.5">${_esc(boss.description || '')}</div>
        ${boss.tags?.length ? `<div style="display:flex;gap:5px;flex-wrap:wrap">${boss.tags.map(t=>`<span style="background:${theme}22;border:1px solid ${theme}44;color:${accent};border-radius:5px;padding:2px 8px;font-size:10px;font-weight:700">${_esc(t)}</span>`).join('')}</div>` : ''}
      </div>
    </div>
    ${boss.lore ? `<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:12px;margin-bottom:14px;font-size:12px;color:var(--text-muted);line-height:1.6;font-style:italic">"${_esc(boss.lore)}"</div>` : ''}
    <div style="font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">Animation Slots</div>
    ${slotRows}
    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Close</button>
      <button class="btn btn-primary" style="flex:1" onclick="closeModalForce();bsOpenEdit('${_esc(id)}')">Edit Profile</button>
    </div>
  </div>`, 'md');
};

// ── Encounter preview ──────────────────────────────────────────────────────────

window._bsCloseEncounter = function () {
  const ov = document.getElementById('bs-encounter-overlay');
  if (ov) ov.remove();
};

window._bsEncPlayState = function (bossId, stateKey) {
  bsLoad();
  const boss = bsGet(bossId); if (!boss) return;
  const animSlots = boss.animations || {};
  const slotId    = animSlots[stateKey];
  const preset    = slotId && typeof window._alGet === 'function' ? window._alGet(slotId) : null;
  const artEl = document.getElementById('bs-enc-art');
  if (!artEl) return;
  artEl.className = 'bs-anim-stage-art' + (preset ? ' ' + preset.cssClass : '');
};

// ── Search / filter / sort / view controls ─────────────────────────────────────

window._bsSearchUpdate = function (val) {
  clearTimeout(_bsSearchDebounceTimer);
  _bsSearchDebounceTimer = setTimeout(() => {
    _bsSearch = val;
    _bsRefreshLibrary();
    setTimeout(() => {
      const inp = document.getElementById('bs-search-input');
      if (inp) { inp.focus(); const l = inp.value.length; inp.setSelectionRange(l, l); }
    }, 0);
  }, 120);
};
window._bsSetFilter = function (f)    { _bsFilter = f; _bsRefreshLibrary(); };
window._bsSetSort   = function (s)    { _bsSort   = s; _bsRefreshLibrary(); };
window._bsSetView   = function (v)    { _bsView   = v; _bsRefreshLibrary(); };

// ── Duplicate / delete ─────────────────────────────────────────────────────────

window.bsDuplicate = function (id) {
  bsLoad();
  const orig = bsGet(id); if (!orig) return;
  const clone = JSON.parse(JSON.stringify(orig));
  clone.id        = 'bvp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  clone.name      = (orig.name || 'Boss') + ' (Copy)';
  clone.createdAt = Date.now();
  clone.updatedAt = Date.now();
  // Clear IDB references — clone doesn't own them; artwork remains as-is in memory for this session
  bsUpsert(clone); bsLoad();
  toast(`⧉ "${clone.name}" duplicated!`);
  _bsRefreshLibrary();
};

window.bsConfirmDelete = function (id) {
  bsLoad();
  const boss = bsGet(id); if (!boss) return;
  showModal(`<div style="text-align:center;padding:8px 0">
    <div style="font-size:48px;margin-bottom:12px">⚠️</div>
    <div class="modal-h2" style="margin-bottom:8px">Delete Boss Profile?</div>
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:24px">
      <strong style="color:var(--on-surface)">${_esc(boss.name || 'This boss')}</strong> will be permanently removed. Any boss events using this profile will revert to defaults.
    </div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-danger" style="flex:1;font-family:var(--fh);font-weight:800" onclick="window._bsDeleteConfirmed('${_esc(id)}')">Delete</button>
    </div>
  </div>`, 'sm');
};

window._bsDeleteConfirmed = function (id) {
  bsLoad();
  const boss = bsGet(id);
  const name = boss ? boss.name : 'Boss';
  bsDelete(id);
  closeModalForce();
  toast(`🗑 "${name}" deleted`, '#ffb4ab');
  _bsRefreshLibrary();
};

// ── Export / Import ────────────────────────────────────────────────────────────

window._bsExportSingle = function (id) {
  bsLoad();
  const boss = bsGet(id); if (!boss) return;
  const json = JSON.stringify({ bossStudioExport: true, version: BS_SCHEMA_VERSION, profiles: [boss] }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = (boss.name || 'boss').replace(/[^a-z0-9]/gi, '_') + '.bvp.json';
  a.click(); URL.revokeObjectURL(a.href);
};

window._bsExportAll = function () {
  bsLoad();
  const json = JSON.stringify({ bossStudioExport: true, version: BS_SCHEMA_VERSION, profiles: DB.bossLibrary || [] }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'eduquest_boss_library_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click(); URL.revokeObjectURL(a.href);
};

window._bsImportJSON = function () {
  const input = document.createElement('input');
  input.type  = 'file'; input.accept = 'application/json';
  input.onchange = function (e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function (ev) {
      try {
        const parsed = JSON.parse(ev.target.result);
        const profiles = parsed.profiles || (Array.isArray(parsed) ? parsed : [parsed]);
        bsLoad();
        let imported = 0;
        profiles.forEach(p => {
          if (!p || !p.id) return;
          // Avoid overwriting existing; give clone a new id
          if (bsGet(p.id)) p.id = 'bvp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
          _bsResolveProfileArtwork(p);
          bsUpsert(p);
          imported++;
        });
        bsLoad();
        toast(`✅ Imported ${imported} profile${imported !== 1 ? 's' : ''}!`, '#4edea3');
        _bsRefreshLibrary();
      } catch (err) {
        toast('❌ Invalid JSON file', '#ffb4ab');
      }
    };
    reader.readAsText(file);
  };
  input.click();
};

// Expose _bsRefreshLibrary and other needed symbols for editor.js
window._bsRefreshLibrary   = _bsRefreshLibrary;
window._bsBossCardArtwork  = _bsBossCardArtwork;
window._bsRenderLibraryBody = _bsRenderLibraryBody;
window._BS_PALETTES        = BS_PALETTES;
window._bsRenderFormModal  = null; // set by editor.js after it loads

console.log('[EduQuest] boss-studio/library.js loaded — renderBossStudio, boss library, preview, search/filter/export/import registered.');
