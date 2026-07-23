// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/boss-studio/animation-library.js
//  Animation Library: 13 built-in presets + full custom CRUD.
//  Provides _alGet and _alOptionsForTarget consumed by editor.js slot pickers.
//  LOAD AFTER: storage.js, library.js
// ═══════════════════════════════════════════════════════════════════════════════

// ── Built-in presets ──────────────────────────────────────────────────────────

const AL_BUILTINS = [
  { id:'al_idle_float',   name:'Idle Float',     description:'Gentle up-and-down floating loop.',      cssClass:'bs-anim-play-idle-float',   targets:['idle'],  tags:['idle','float','loop'],      builtin:true },
  { id:'al_idle_bob',     name:'Idle Bob',        description:'Short rhythmic bobbing motion.',         cssClass:'bs-anim-play-idle-bob',     targets:['idle'],  tags:['idle','bob','loop'],        builtin:true },
  { id:'al_idle_sway',    name:'Idle Sway',       description:'Slow pendulum sway left and right.',    cssClass:'bs-anim-play-idle-sway',    targets:['idle'],  tags:['idle','sway','loop'],       builtin:true },
  { id:'al_idle_glow',    name:'Idle Pulse Glow', description:'Subtle scale pulse with aura glow.',    cssClass:'bs-anim-play-idle-glow',    targets:['idle'],  tags:['idle','glow','pulse'],      builtin:true },
  { id:'al_cast_charge',  name:'Cast Charge-Up',  description:'Boss swells and brightens before attack.',cssClass:'bs-anim-play-cast-charge', targets:['cast'],  tags:['cast','charge','skill'],    builtin:true },
  { id:'al_cast_spin',    name:'Cast Spin',        description:'Full rotation during skill execution.', cssClass:'bs-anim-play-cast-spin',    targets:['cast'],  tags:['cast','spin','skill'],      builtin:true },
  { id:'al_cast_flash',   name:'Cast Flash',       description:'Rapid brightness burst on skill use.',  cssClass:'bs-anim-play-cast-flash',   targets:['cast'],  tags:['cast','flash','skill'],     builtin:true },
  { id:'al_hit_flinch',   name:'Hit Flinch',       description:'Recoil with slight rotation on impact.',cssClass:'bs-anim-play-hit-flinch',   targets:['hit'],   tags:['hit','flinch','damage'],    builtin:true },
  { id:'al_hit_shake',    name:'Hit Shake',         description:'Full-body jitter on taking damage.',   cssClass:'bs-anim-play-hit-shake',    targets:['hit'],   tags:['hit','shake','damage'],     builtin:true },
  { id:'al_hit_flashred', name:'Hit Flash Red',    description:'Red tint flash when struck.',           cssClass:'bs-anim-play-hit-flashred', targets:['hit'],   tags:['hit','flash','damage'],     builtin:true },
  { id:'al_rage_burst',   name:'Rage Burst',       description:'Explosive entry into rage state.',      cssClass:'bs-anim-play-rage-burst',   targets:['rage'],  tags:['rage','burst','intense'],   builtin:true },
  { id:'al_rage_pulse',   name:'Rage Pulse',       description:'Intense pulsing glow in rage mode.',    cssClass:'bs-anim-play-rage-pulse',   targets:['rage'],  tags:['rage','pulse','glow'],      builtin:true },
  { id:'al_rage_vibrate', name:'Rage Vibrate',     description:'High-frequency vibration during rage.', cssClass:'bs-anim-play-rage-vibrate', targets:['rage'],  tags:['rage','vibrate','intense'], builtin:true },
];

// ── Module state ──────────────────────────────────────────────────────────────
let _alSearch = '';
let _alFilter = 'all';
let _alDraft  = null;

const AL_TARGET_OPTIONS = [
  { key:'idle', icon:'play_circle',           label:'Idle' },
  { key:'cast', icon:'bolt',                  label:'Cast' },
  { key:'hit',  icon:'gpp_bad',               label:'Hit'  },
  { key:'rage', icon:'local_fire_department', label:'Rage' },
];

// ── Storage helpers ───────────────────────────────────────────────────────────

function _alLoad() { return AppStore.getSlice(s => s.animationLibrary) || []; }

function _alUpsert(preset) {
  AppStore.updateState(draft => {
    if (!Array.isArray(draft.animationLibrary)) draft.animationLibrary = [];
    const idx = draft.animationLibrary.findIndex(a => a.id === preset.id);
    if (idx >= 0) draft.animationLibrary[idx] = preset;
    else          draft.animationLibrary.push(preset);
  }, { type: 'boss-studio:animation-preset-saved', payload: { id: preset.id } });
}

function _alDeleteRecord(id) {
  AppStore.updateState(draft => {
    draft.animationLibrary = (draft.animationLibrary || []).filter(a => a.id !== id);
  }, { type: 'boss-studio:animation-preset-deleted', payload: { id } });
}

// ── Core public API ───────────────────────────────────────────────────────────

function _alAll() {
  const animationLibrary = _alLoad();
  const customIds = new Set(animationLibrary.map(a => a.id));
  return [...AL_BUILTINS.filter(b => !customIds.has(b.id)), ...animationLibrary];
}

function alGet(id) {
  if (!id) return null;
  const custom = _alLoad().find(a => a.id === id);
  return custom || AL_BUILTINS.find(b => b.id === id) || null;
}

function alOptionsForTarget(target) {
  return _alAll().filter(a => !a.targets || a.targets.length === 0 || a.targets.includes(target));
}

// ── Refresh helper ────────────────────────────────────────────────────────────

function _alRefreshGrid() {
  const root = document.getElementById('al-library-root');
  if (root) root.innerHTML = _alRenderGrid();
}

// ── Tab body renderer ─────────────────────────────────────────────────────────

function _alRenderTabBody() {
  const all         = _alAll();
  const customCount = _alLoad().length;
  return `
  <div class="al-hero"><div class="al-hero-inner">
    <div class="al-hero-icon">🎬</div>
    <div class="al-hero-info">
      <div class="al-hero-label">Asset Management</div>
      <div class="al-hero-title">Animation Library</div>
      <div class="al-hero-sub">Manage reusable CSS animation presets. Assign them to Boss Visual Profile slots to define how bosses move during gameplay.</div>
    </div>
    <div class="al-hero-actions">
      <button class="btn btn-primary" onclick="window._alOpenCreate()" style="display:flex;align-items:center;gap:7px;padding:11px 20px;font-family:var(--fh);font-weight:800">
        <span class="material-symbols-outlined" style="font-size:18px">add</span>New Preset
      </button>
    </div>
  </div></div>
  <div class="section-header" style="margin-bottom:0">
    <span class="material-symbols-outlined">animation</span>
    <h2>Animation Presets</h2>
    <span class="badge-pill">${all.length} Preset${all.length !== 1 ? 's' : ''}</span>
    ${customCount > 0 ? `<span class="badge-pill" style="background:rgba(78,222,163,0.1);color:var(--secondary);border:1px solid rgba(78,222,163,0.2)">${customCount} Custom</span>` : ''}
  </div>
  <div class="bs-library-toolbar" style="margin-top:16px">
    <div class="bs-search-wrap">
      <span class="material-symbols-outlined">search</span>
      <input type="text" placeholder="Search by name, tag, or CSS class…" value="${_esc(_alSearch)}" oninput="window._alSearchUpdate(this.value)" id="al-search-input">
    </div>
    <div class="bs-filter-row">
      ${['all','idle','cast','hit','rage','custom'].map(f =>
        `<button class="bs-filter-btn ${_alFilter===f?'active':''}" onclick="window._alSetFilter('${f}')">${f.charAt(0).toUpperCase()+f.slice(1)}</button>`
      ).join('')}
    </div>
  </div>
  <div id="al-library-root" style="margin-top:20px">${_alRenderGrid()}</div>`;
}

// ── Grid renderer ─────────────────────────────────────────────────────────────

function _alRenderGrid() {
  let list = _alAll();
  if (_alFilter === 'custom')    list = list.filter(a => !a.builtin);
  else if (_alFilter !== 'all')  list = list.filter(a => a.targets && a.targets.includes(_alFilter));
  if (_alSearch.trim()) {
    const q = _alSearch.trim().toLowerCase();
    list = list.filter(a => (a.name||'').toLowerCase().includes(q) || (a.description||'').toLowerCase().includes(q) || (a.cssClass||'').toLowerCase().includes(q) || (a.tags||[]).some(t => t.toLowerCase().includes(q)));
  }
  if (!list.length) return `<div class="al-empty"><div class="al-empty-icon">🎭</div><div class="al-empty-title">No Presets Found</div><div class="al-empty-sub">Try clearing the search or filter, or create a new custom preset.</div><button class="btn btn-ghost" onclick="window._alSearchUpdate('');window._alSetFilter('all')" style="font-family:var(--fh)">Clear Filters</button></div>`;
  const TARGET_ICONS = { idle:'play_circle', cast:'bolt', hit:'gpp_bad', rage:'local_fire_department' };
  return `<div class="al-library-grid">${list.map(a => {
    const targetsHtml = (a.targets||[]).map(t => `<span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--secondary)"><span class="material-symbols-outlined" style="font-size:11px">${TARGET_ICONS[t]||'animation'}</span>${t}</span>`).join('<span style="color:var(--border);margin:0 2px">·</span>');
    return `<div class="al-card">
      <div class="al-card-stage bs-anim-stage" id="al-stage-${_esc(a.id)}" onclick="window._alTogglePreview('${_esc(a.id)}')" style="cursor:pointer" title="Click to preview">
        <div class="bs-anim-stage-art" id="al-art-${_esc(a.id)}">💀</div>
        <div class="bs-anim-label">${_esc(a.name)}</div>
      </div>
      <div class="al-card-body">
        <div class="al-card-name">${_esc(a.name)}</div>
        <div class="al-card-type">${targetsHtml||'<span style="color:var(--text-muted)">Universal</span>'}</div>
        <div class="al-card-desc">${_esc(a.description||'—')}</div>
        <div class="al-card-tags">${a.builtin ? '<span class="al-card-tag builtin">Built-in</span>' : ''}${(a.tags||[]).filter(t => !['idle','cast','hit','rage'].includes(t)).slice(0,4).map(t=>`<span class="al-card-tag">${_esc(t)}</span>`).join('')}</div>
        <div class="al-card-footer">
          <div style="font-size:10px;color:var(--text-muted);font-family:monospace">${_esc(a.cssClass||'—')}</div>
          <div class="al-card-actions">
            <button class="al-card-act-btn" onclick="window._alOpenPreviewModal('${_esc(a.id)}')" title="Preview"><span class="material-symbols-outlined">play_circle</span></button>
            <button class="al-card-act-btn" onclick="window._alOpenEdit('${_esc(a.id)}')" title="${a.builtin?'Duplicate & Edit':'Edit'}"><span class="material-symbols-outlined">${a.builtin?'content_copy':'edit'}</span></button>
            ${!a.builtin ? `<button class="al-card-act-btn danger" onclick="window._alConfirmDelete('${_esc(a.id)}')" title="Delete"><span class="material-symbols-outlined">delete</span></button>` : ''}
          </div>
        </div>
      </div>
    </div>`;
  }).join('')}</div>`;
}

// ── Card stage preview toggle ─────────────────────────────────────────────────

window._alTogglePreview = function (id) {
  const art = document.getElementById(`al-art-${id}`); if (!art) return;
  const preset = alGet(id); if (!preset) return;
  const playing = art.dataset.playing === '1';
  art.className    = 'bs-anim-stage-art' + (playing ? '' : ' ' + (preset.cssClass || ''));
  art.dataset.playing = playing ? '' : '1';
};

// ── Preview modal ─────────────────────────────────────────────────────────────

window._alOpenPreviewModal = function (id) {
  const preset = alGet(id); if (!preset) { toast('❌ Preset not found', '#ffb4ab'); return; }
  const TARGET_ICONS = { idle:'play_circle', cast:'bolt', hit:'gpp_bad', rage:'local_fire_department' };
  showModal(`<div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,rgba(78,222,163,0.25),rgba(139,92,246,0.15));border:1px solid rgba(78,222,163,0.35);display:flex;align-items:center;justify-content:center;font-size:20px">🎬</div>
      <div><div class="modal-h2" style="margin-bottom:2px">${_esc(preset.name)}</div><div style="font-size:12px;color:var(--text-muted)">Animation Preview</div></div>
    </div>
    <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start">
      <div style="flex:0 0 180px;display:flex;flex-direction:column;gap:10px;align-items:center">
        <div class="al-preview-stage bs-anim-stage" style="display:flex;align-items:center;justify-content:center">
          <div class="bs-anim-stage-art ${_esc(preset.cssClass||'')}" id="alpm-art" style="font-size:64px">💀</div>
        </div>
        <button class="al-preview-replay" onclick="window._alPreviewModalReplay()"><span class="material-symbols-outlined">replay</span> Replay</button>
      </div>
      <div style="flex:1;min-width:200px">
        <div style="margin-bottom:12px"><div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:5px">CSS Class</div>
          <code style="font-family:monospace;font-size:12px;color:var(--secondary);background:rgba(78,222,163,0.08);padding:5px 9px;border-radius:7px;border:1px solid rgba(78,222,163,0.18);display:block">${_esc(preset.cssClass||'(none)')}</code></div>
        <div style="margin-bottom:12px"><div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:5px">Target Slots</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${(preset.targets&&preset.targets.length ? preset.targets : ['universal']).map(t=>`<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 9px;border-radius:7px;background:rgba(78,222,163,0.1);border:1px solid rgba(78,222,163,0.2);font-size:11px;font-weight:700;color:var(--secondary)"><span class="material-symbols-outlined" style="font-size:12px">${TARGET_ICONS[t]||'animation'}</span>${t}</span>`).join('')}
          </div></div>
        ${preset.description ? `<div style="font-size:12px;color:var(--text-muted);line-height:1.6">${_esc(preset.description)}</div>` : ''}
        ${preset.tags&&preset.tags.length ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:10px">${preset.tags.map(t=>`<span class="al-card-tag">${_esc(t)}</span>`).join('')}</div>` : ''}
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-top:20px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Close</button>
      <button class="btn btn-primary" style="flex:1;font-family:var(--fh);font-weight:800" onclick="closeModalForce();window._alOpenEdit('${_esc(id)}')">${preset.builtin?'Duplicate & Customize':'Edit Preset'}</button>
    </div>
  </div>`, 'sm');
};

window._alPreviewModalReplay = function () {
  const art = document.getElementById('alpm-art'); if (!art) return;
  const cls = art.className; art.className = 'bs-anim-stage-art'; void art.offsetWidth; art.className = cls;
};

// ── Create / Edit form ────────────────────────────────────────────────────────

function _alRenderFormModal(isEdit) {
  const d = _alDraft;
  showModal(`<div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,rgba(78,222,163,0.25),rgba(139,92,246,0.15));border:1px solid rgba(78,222,163,0.35);display:flex;align-items:center;justify-content:center;font-size:20px">${isEdit?'✏️':'➕'}</div>
      <div><div class="modal-h2" style="margin-bottom:2px">${isEdit?'Edit Animation Preset':'New Animation Preset'}</div><div style="font-size:12px;color:var(--text-muted)">Define a reusable CSS animation preset for boss states.</div></div>
    </div>
    <div class="al-form-layout">
      <div class="al-form-col">
        <div class="form-group" style="margin-bottom:12px"><label class="form-label">Preset Name *</label>
          <input type="text" id="al-f-name" value="${_esc(d.name||'')}" placeholder="e.g. Inferno Pulse" style="width:100%" oninput="window._alDraft.name=this.value;document.getElementById('al-f-name-err').style.display='none'">
          <div class="field-err" id="al-f-name-err" style="display:none">Name is required.</div></div>
        <div class="form-group" style="margin-bottom:12px"><label class="form-label">Description</label>
          <input type="text" id="al-f-desc" value="${_esc(d.description||'')}" placeholder="Short description" style="width:100%" oninput="window._alDraft.description=this.value"></div>
        <div class="form-group" style="margin-bottom:12px"><label class="form-label">CSS Class *</label>
          <input type="text" id="al-f-css" value="${_esc(d.cssClass||'')}" placeholder="e.g. bs-anim-play-idle-float" style="width:100%;font-family:monospace;font-size:12px" oninput="window._alDraft.cssClass=this.value.trim();document.getElementById('al-f-css-err').style.display='none';window._alFormPreviewRefresh()">
          <div class="field-err" id="al-f-css-err" style="display:none">CSS class is required.</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:4px">Applied to the artwork element. Built-in classes: <code>bs-anim-play-*</code></div></div>
        <div class="form-group" style="margin-bottom:12px"><label class="form-label">Tags (comma-separated)</label>
          <input type="text" id="al-f-tags" value="${_esc((d.tags||[]).join(', '))}" placeholder="e.g. fire, loop" style="width:100%" oninput="window._alDraft.tags=this.value.split(',').map(t=>t.trim()).filter(Boolean)"></div>
        <div class="form-group" style="margin-bottom:0"><label class="form-label">Target Slots</label>
          <div class="al-target-grid" id="al-f-targets">
            ${AL_TARGET_OPTIONS.map(t=>`<button type="button" class="al-target-btn ${(d.targets||[]).includes(t.key)?'sel':''}" onclick="window._alToggleTarget('${t.key}')"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:middle">${t.icon}</span> ${t.label}</button>`).join('')}
          </div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:4px">Leave all unselected to allow any slot.</div></div>
      </div>
      <div class="al-preview-col">
        <div class="al-preview-stage bs-anim-stage" style="display:flex;align-items:center;justify-content:center">
          <div class="bs-anim-stage-art ${_esc(d.cssClass||'')}" id="al-f-preview-art" style="font-size:64px">💀</div>
        </div>
        <button type="button" class="al-preview-replay" onclick="window._alFormPreviewRefresh()"><span class="material-symbols-outlined">replay</span> Replay</button>
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-top:20px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" style="flex:2;font-family:var(--fh);font-weight:800" onclick="window._alSaveForm()">${isEdit?'Save Changes':'Create Preset'}</button>
    </div>
  </div>`, 'md');
}

window._alOpenCreate = function () {
  _alDraft = { id:'al_'+Date.now()+'_'+Math.random().toString(36).slice(2,6), name:'', description:'', cssClass:'', targets:[], tags:[], builtin:false, createdAt:Date.now(), updatedAt:Date.now() };
  _alRenderFormModal(false);
};

window._alOpenEdit = function (id) {
  const preset = alGet(id); if (!preset) { toast('❌ Preset not found', '#ffb4ab'); return; }
  _alDraft = preset.builtin
    ? Object.assign({}, preset, { id:'al_'+Date.now()+'_'+Math.random().toString(36).slice(2,6), name:preset.name+' (Custom)', builtin:false, createdAt:Date.now(), updatedAt:Date.now() })
    : JSON.parse(JSON.stringify(preset));
  _alRenderFormModal(!preset.builtin);
};

window._alToggleTarget = function (key) {
  if (!_alDraft) return;
  _alDraft.targets = _alDraft.targets || [];
  const idx = _alDraft.targets.indexOf(key);
  if (idx >= 0) _alDraft.targets.splice(idx, 1); else _alDraft.targets.push(key);
  const grid = document.getElementById('al-f-targets');
  if (grid) grid.innerHTML = AL_TARGET_OPTIONS.map(t=>`<button type="button" class="al-target-btn ${(_alDraft.targets||[]).includes(t.key)?'sel':''}" onclick="window._alToggleTarget('${t.key}')"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:middle">${t.icon}</span> ${t.label}</button>`).join('');
};

window._alFormPreviewRefresh = function () {
  const art = document.getElementById('al-f-preview-art'); if (!art) return;
  const cls = (_alDraft && _alDraft.cssClass) || '';
  art.className = 'bs-anim-stage-art'; void art.offsetWidth; art.className = 'bs-anim-stage-art ' + cls;
};

window._alSaveForm = function () {
  if (!_alDraft) { toast('❌ No draft', '#ffb4ab'); return; }
  const name = (document.getElementById('al-f-name')?.value || '').trim();
  const css  = (document.getElementById('al-f-css')?.value  || '').trim();
  if (!name) { const e = document.getElementById('al-f-name-err'); if (e) e.style.display = 'block'; return; }
  if (!css)  { const e = document.getElementById('al-f-css-err');  if (e) e.style.display = 'block'; return; }
  _alDraft.name        = name;
  _alDraft.description = (document.getElementById('al-f-desc')?.value || '').trim();
  _alDraft.cssClass    = css;
  _alDraft.tags        = (document.getElementById('al-f-tags')?.value || '').split(',').map(t => t.trim()).filter(Boolean);
  _alDraft.updatedAt   = Date.now();
  _alUpsert(_alDraft);
  closeModalForce();
  toast(`✅ Preset "${_alDraft.name}" saved`, '#4edea3');
  _alDraft = null;
  _alRefreshGrid();
};

// ── Delete ────────────────────────────────────────────────────────────────────

window._alConfirmDelete = function (id) {
  const preset = alGet(id); if (!preset) { toast('❌ Not found', '#ffb4ab'); return; }
  showModal(`<div style="text-align:center;padding:8px 0">
    <div style="font-size:48px;margin-bottom:12px">⚠️</div>
    <div class="modal-h2" style="margin-bottom:8px">Delete Preset?</div>
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:24px"><strong style="color:var(--on-surface)">${_esc(preset.name)}</strong> will be permanently removed. Any boss profiles referencing this preset will show the slot as unassigned.</div>
    <div style="display:flex;gap:10px"><button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button><button class="btn btn-danger" style="flex:1;font-family:var(--fh);font-weight:800" onclick="window._alDeleteConfirmed('${_esc(id)}')">Delete</button></div>
  </div>`, 'sm');
};

window._alDeleteConfirmed = function (id) {
  const preset = alGet(id);
  _alDeleteRecord(id);
  closeModalForce();
  toast(`🗑 "${preset?.name||'Preset'}" deleted`, '#ffb4ab');
  _alRefreshGrid();
};

// ── Search / filter ───────────────────────────────────────────────────────────

window._alSearchUpdate = function (val) {
  _alSearch = val;
  _alRefreshGrid();
  setTimeout(() => { const inp = document.getElementById('al-search-input'); if (inp) { inp.focus(); const l = inp.value.length; inp.setSelectionRange(l, l); } }, 0);
};

window._alSetFilter = function (filter) { _alFilter = filter; _alRefreshGrid(); };

// ── Public exports ────────────────────────────────────────────────────────────

window._alGet              = alGet;
window._alOptionsForTarget = alOptionsForTarget;
window._alRenderTabBody    = _alRenderTabBody;

Object.defineProperty(window, '_alDraft', {
  get () { return _alDraft; },
  set (v) { _alDraft = v; },
  configurable: true,
});

console.log('[EduQuest] boss-studio/animation-library.js loaded — 13 built-in presets, alGet, alOptionsForTarget, full CRUD registered.');
