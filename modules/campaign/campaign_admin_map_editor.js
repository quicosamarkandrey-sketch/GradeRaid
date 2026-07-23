// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/campaign/admin-map-editor.js
//  Admin Stage Map Editor: renderAdminStageMap and all world/stage CRUD helpers.
//  LOAD AFTER: engine.js, stage-map.js
// ═══════════════════════════════════════════════════════════════════════════════

// Phase 53 — selected class_ids for the "assign to section(s)" picker on a
// world; kept separate from _worldDraft since it isn't a stageMap field,
// it's persisted via set_campaign_world_sections() into
// campaign_stage_sections. Mirrors draftQuizSections in quiz-builder.js.
let draftWorldSections = [];

// ── Main renderer ─────────────────────────────────────────────────────────────

window.renderAdminStageMap = function () {
  const worlds = AppStore.getSlice(s => s.stageMap) || [];
  const campaignSectionAssignments = AppStore.getSlice(s => s.campaignSectionAssignments) || {};
  const total  = worlds.reduce((a, w) => a + w.stages.length, 0);

  document.getElementById('a-stagemap').innerHTML = `
  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
    <div>
      <div style="font-family:var(--fm);font-size:10px;color:var(--primary);letter-spacing:.16em;margin-bottom:6px">ADMIN // STAGE_MAP_EDITOR</div>
      <div style="font-family:var(--fh);font-size:26px;font-weight:900;color:var(--on-surface)">🗺️ Stage Map Editor</div>
      <div style="color:var(--text-muted);font-size:13px;margin-top:4px">${worlds.length} worlds · ${total} stages</div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-ghost" onclick="adminPreviewMap()">👁 Preview Map</button>
      <button class="btn btn-primary" onclick="adminAddWorld()">＋ New World</button>
    </div>
  </div>
  ${!worlds.length ? `
  <div style="text-align:center;padding:80px;border:2px dashed rgba(255,255,255,.07);border-radius:20px">
    <div style="font-size:64px;margin-bottom:16px">🗺️</div>
    <div style="font-family:var(--fh);font-size:18px;font-weight:800;color:var(--on-surface);margin-bottom:8px">No worlds yet</div>
    <div style="color:var(--text-muted);margin-bottom:20px;font-size:13px">Create your first world to start building the campaign</div>
    <button class="btn btn-primary" onclick="adminAddWorld()">＋ Create First World</button>
  </div>` : ''}
  <div style="display:flex;flex-direction:column;gap:16px">
    ${worlds.map((w, wi) => {
      // Phase 53 — "assign to section(s)" status, same opt-in-scoping
      // semantics as quiz-builder.js's sectionsLabel: empty = every section
      // this teacher advises can see it.
      const assignedIds = (campaignSectionAssignments && campaignSectionAssignments[w.id]) || [];
      const sectionsLabel = assignedIds.length
        ? assignedIds.map(cid => (typeof getClassLabel === 'function' ? getClassLabel(cid) : cid)).join(', ')
        : 'All my sections';
      return `
    <div class="smap-admin-card">
      <div class="smap-admin-world-header" onclick="adminToggleWorld('aw-${wi}')">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <div style="font-size:28px">${w.icon}</div>
          <div>
            <div style="font-family:var(--fh);font-size:16px;font-weight:800;color:var(--on-surface)">${_esc(w.label)}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${_esc(w.desc)}</div>
          </div>
          <span style="font-family:var(--fm);font-size:9px;color:${w.color};background:${w.color}18;border:1px solid ${w.color}44;padding:2px 10px;border-radius:4px;letter-spacing:.06em">${w.stages.length} STAGES</span>
          <span class="badge-pill ${assignedIds.length ? 'bp-primary' : 'bp-gray'}" title="${_esc(sectionsLabel)}">🏫 ${_esc(sectionsLabel)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();adminEditWorld(${wi})">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();adminDeleteWorld(${wi})">🗑</button>
          <span style="color:var(--text-muted);font-size:18px" id="aw-arr-${wi}">▾</span>
        </div>
      </div>
      <div id="aw-${wi}">
        ${w.stages.map((s, si) => `
        <div class="smap-stage-row">
          <div style="font-size:22px;flex-shrink:0">${s.icon}</div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-family:var(--fh);font-size:14px;font-weight:700;color:var(--on-surface)">${_esc(s.title)}</span>
              <span class="${s.type === 'boss' ? 'boss-tag' : 'normal-tag'}">${s.type === 'boss' ? '⚔️ BOSS' : 'NORMAL'}</span>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:3px">❤️ ${s.lives || 3} lives · ⚡ +${s.xp} XP · 🪙 ${s.coins} · ${Array.isArray(s.beats)
              ? `${s.beats.length} beats · ${s.beats.filter(b => b.type === 'encounter').reduce((a, b) => a + (b.questions || []).length, 0)} questions`
              : `${(s.scenes || []).length} scenes · ${(s.enemies || []).length} enemies · ${(s.enemies || []).reduce((a, e) => a + (e.questions || []).length, 0)} questions`}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn btn-ghost btn-xs" onclick="adminEditStage(${wi},${si})">✏️ Edit</button>
            <button class="btn btn-ghost btn-xs" onclick="adminMoveStage(${wi},${si},-1)" ${si === 0 ? 'disabled' : ''}>↑</button>
            <button class="btn btn-ghost btn-xs" onclick="adminMoveStage(${wi},${si},1)" ${si === w.stages.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="btn btn-danger btn-xs" onclick="adminDeleteStage(${wi},${si})">🗑</button>
          </div>
        </div>`).join('')}
        <div style="padding:12px 18px;border-top:1px dashed rgba(255,255,255,.06)">
          <button class="btn btn-ghost btn-sm" onclick="adminAddStage(${wi})">＋ Add Stage to "${_esc(w.label)}"</button>
        </div>
      </div>
    </div>`;
    }).join('')}
  </div>`;
};

// ── Collapse helper ───────────────────────────────────────────────────────────

window.adminToggleWorld = function (id) {
  const el  = document.getElementById(id); if (!el) return;
  const idx = id.replace('aw-', '');
  const arr = document.getElementById('aw-arr-' + idx);
  const hide = el.style.display !== 'none';
  el.style.display = hide ? 'none' : 'block';
  if (arr) arr.textContent = hide ? '▸' : '▾';
};

window.adminPreviewMap = function () { openStageMap(); };

// ── World CRUD ────────────────────────────────────────────────────────────────

window.adminAddWorld = function () {
  // Phase 32: new worlds get ownerTeacherId stamped here; editing an
  // existing world (adminEditWorld, just below) carries its owner forward
  // automatically via the JSON clone of the stageMap slice, which already has
  // it from the Supabase pull mapping in db-service.js.
  window._worldDraft = { id: 'w_' + uid(), ownerTeacherId: currentUser.id, label: 'New World', icon: '🌍', color: '#8b5cf6', desc: 'A new world awaits.', stages: [] };
  draftWorldSections = []; // Phase 53 — brand-new world has no stages yet, so nothing to assign until it's saved once
  showModal(_worldModalHTML(true), 'md');
};

window.adminEditWorld = function (wi) {
  const worlds = AppStore.getSlice(s => s.stageMap) || [];
  window._worldDraft = JSON.parse(JSON.stringify(worlds[wi]));
  const campaignSectionAssignments = AppStore.getSlice(s => s.campaignSectionAssignments) || {};
  draftWorldSections = ((campaignSectionAssignments && campaignSectionAssignments[window._worldDraft.id]) || []).slice(); // Phase 53
  showModal(_worldModalHTML(false, wi), 'md');
};

function _worldModalHTML(isNew, wi) {
  const d      = window._worldDraft;
  const colors = ['#8b5cf6', '#4edea3', '#93c5fd', '#ffb95f', '#f87171', '#a78bfa', '#34d399', '#fb923c'];
  // Phase 53 — "assign to section(s)" picker. Only meaningful once a world
  // has stages saved server-side (set_campaign_world_sections() resolves
  // stage ids from the world row), so it's shown on Edit only — same
  // "assign after it exists" flow quiz-builder.js's picker doesn't need to
  // worry about since a quiz has no such dependency. A world with nothing
  // selected stays visible to every section this teacher advises.
  const sectionPickerHTML = isNew ? '' : (() => {
    const activeClassIds = (typeof getActiveClassIds === 'function') ? getActiveClassIds() : [];
    const sectionOpts = activeClassIds.map(cid =>
      `<option value="${cid}" ${draftWorldSections.includes(cid) ? 'selected' : ''}>${_esc(typeof getClassLabel === 'function' ? getClassLabel(cid) : cid)}</option>`
    ).join('');
    return `<div class="form-group"><label class="form-label">Assign to Section(s)</label>
      <select id="wf-sections" multiple style="width:100%;min-height:88px" onchange="draftWorldSections=Array.from(this.selectedOptions).map(o=>o.value)">
        ${sectionOpts || '<option disabled>No sections found</option>'}
      </select>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Ctrl/Cmd-click to select multiple. Leave everything unselected to show this world to all of your sections — handy when one section shouldn't see a storyline built for another (e.g. different topics per class).</div>
    </div>`;
  })();
  return `<div class="modal-h2">${isNew ? '🌍 New World' : '✏️ Edit World'}</div>
    <div class="form-group"><label class="form-label">World Name</label>
      <input type="text" id="wf-label" value="${_esc(d.label || '')}" placeholder="e.g. Science Citadel" style="width:100%" oninput="window._worldDraft.label=this.value"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group"><label class="form-label">Icon (emoji)</label>
        <input type="text" id="wf-icon" value="${_esc(d.icon || '🌍')}" placeholder="🌍" style="width:100%" oninput="window._worldDraft.icon=this.value"></div>
      <div class="form-group"><label class="form-label">Accent Color</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;padding-top:4px">
          ${colors.map(c => `<div onclick="document.getElementById('wf-col').value='${c}';window._worldDraft.color='${c}'" class="wc-swatch" style="width:24px;height:24px;border-radius:50%;background:${c};cursor:pointer;outline:${d.color === c ? '2px solid #fff' : 'none'}"></div>`).join('')}
          <input type="text" id="wf-col" value="${_esc(d.color || '#8b5cf6')}" style="width:76px" oninput="window._worldDraft.color=this.value">
        </div></div>
    </div>
    <div class="form-group"><label class="form-label">Description</label>
      <input type="text" id="wf-desc" value="${_esc(d.desc || '')}" placeholder="Short description..." style="width:100%" oninput="window._worldDraft.desc=this.value"></div>
    ${sectionPickerHTML}
    <div style="display:flex;gap:10px;margin-top:4px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" style="flex:1" onclick="${isNew ? 'adminSaveNewWorld()' : 'adminSaveEditWorld(' + wi + ')'}">
        ${isNew ? 'Create World' : 'Save Changes'}</button>
    </div>`;
}

window.adminSaveNewWorld = function () {
  const d = window._worldDraft; if (!d) return;
  d.label = document.getElementById('wf-label').value.trim() || 'New World';
  d.icon  = document.getElementById('wf-icon').value.trim()  || '🌍';
  d.color = document.getElementById('wf-col').value.trim()   || '#8b5cf6';
  d.desc  = document.getElementById('wf-desc').value.trim();
  AppStore.updateState(draft => {
    if (!Array.isArray(draft.stageMap)) draft.stageMap = [];
    draft.stageMap.push(d);
  }, { type: 'campaign:world-created', payload: { id: d.id } });
  closeModalForce(); renderAdminStageMap();
  toast('✅ World "' + d.label + '" created!');
};

window.adminSaveEditWorld = async function (wi) {
  const d = window._worldDraft; if (!d) return;
  d.label = document.getElementById('wf-label').value.trim() || d.label;
  d.icon  = document.getElementById('wf-icon').value.trim()  || d.icon;
  d.color = document.getElementById('wf-col').value.trim()   || d.color;
  d.desc  = document.getElementById('wf-desc').value.trim();
  AppStore.updateState(draft => {
    if (!draft.stageMap || !draft.stageMap[wi]) return;
    draft.stageMap[wi] = { ...draft.stageMap[wi], ...d };
  }, { type: 'campaign:world-updated', payload: { id: d.id } });
  closeModalForce(); renderAdminStageMap(); toast('✅ World updated!');

  // Phase 53 — persist the section assignment. Fire-and-forget like every
  // other section picker in this app (quiz-builder.js/ach_admin_page.js):
  // optimistic local update already happened via renderAdminStageMap()'s
  // read of the campaignSectionAssignments slice below, the RPC just makes
  // it stick server-side and cross-device.
  if (typeof DBService !== 'undefined' && DBService.rpc) {
    const sectionIds = draftWorldSections.slice();
    const { error } = await DBService.rpc('set_campaign_world_sections', { p_world_id: d.id, p_class_ids: sectionIds });
    if (error) {
      console.warn('[CampaignMapEditor] set_campaign_world_sections failed:', error);
      toast('⚠️ World saved, but section assignment failed to sync', '#ffb95f');
    } else {
      // [Phase 3 migration bugfix] The pre-migration version mutated
      // DB.campaignSectionAssignments directly here but never called
      // saveDB() afterward — and renderAdminStageMap(), called two lines
      // down, reloads from persisted storage as its very first action. The
      // optimistic local update was silently discarded the instant this
      // RPC succeeded, even though the server-side assignment had already
      // gone through. Same bug shape as mailAdminSend()'s edit branch —
      // see the modules/mail/ entry in this log.
      AppStore.updateState(draft => {
        if (!draft.campaignSectionAssignments) draft.campaignSectionAssignments = {};
        draft.campaignSectionAssignments[d.id] = sectionIds; // optimistic — next realtime pull confirms it
      }, { type: 'campaign:world-sections-set', payload: { id: d.id, sectionIds } });
      renderAdminStageMap();
    }
  }
};

window.adminDeleteWorld = async function (wi) {
  const worlds = AppStore.getSlice(s => s.stageMap) || [];
  if (!confirm('Delete world "' + worlds[wi].label + '" and ALL its stages?')) return;
  const world = worlds[wi];
  AppStore.updateState(draft => {
    draft.stageMap.splice(wi, 1);
  }, { type: 'campaign:world-deleted', payload: { id: world.id } });
  renderAdminStageMap(); toast('🗑️ World deleted');
  // Phase 28: delete_campaign_world() closes the gap this comment used to
  // flag — the bulk push is upsert-only and never deletes server rows,
  // so without this the world would silently reappear for everyone on
  // the next pull. Same shape as delete_achievement()/delete_title()
  // (Phase 23): staff-checked, idempotent, no child table to cascade
  // since stages live in campaign_worlds' own jsonb column.
  if (typeof DBService !== 'undefined' && typeof DBService.rpc === 'function' && world.id) {
    const { error } = await DBService.rpc('delete_campaign_world', { p_world_id: world.id });
    if (error) toast('⚠️ Removed locally, but may not have synced: ' + error.message, '#ffb95f');
  }
};

// ── Stage CRUD ────────────────────────────────────────────────────────────────

window.adminAddStage = function (wi) {
  // Phase 3 — new stages are authored on the beat-list model (Decision #6):
  // an empty `beats: []` array is the same presence check the engine uses
  // (Phase 1's `Array.isArray(stage.beats)` in launchCampaignStage, Decision
  // #13), so a stage created here automatically plays through the beat
  // engine with zero extra wiring. Existing stages already saved with
  // scenes/enemies/outro are never touched or migrated — they keep loading
  // into the legacy three-section editor below via adminEditStage.
  window._stageDraft = {
    id: 's_' + uid(), title: 'New Stage', icon: '⭐', type: 'normal', xp: 100, coins: 50, lives: 3,
    beats: [],
  };
  window._stageDraftWi = wi; window._stageDraftSi = null;
  showModal(_stageModalHTML(), 'lg');
};

window.adminEditStage = function (wi, si) {
  const worlds = AppStore.getSlice(s => s.stageMap) || [];
  window._stageDraft   = JSON.parse(JSON.stringify(worlds[wi].stages[si]));
  window._stageDraftWi = wi; window._stageDraftSi = si;
  showModal(_stageModalHTML(), 'lg');
};

function _stageModalHTML() {
  const d      = window._stageDraft;
  const isEdit = window._stageDraftSi !== null;
  const icons  = ['⭐','📖','🔢','✏️','👑','🔬','☀️','⚗️','⚛️','🐉','🔌','🔄','⚡','🏟️','🔮','📜','🎨','⚔️','📰','🗿','🧪','💻','🔑','🏰','🌋','🌊'];
  return `<div class="modal-h2">${isEdit ? '✏️ Edit Stage' : '＋ New Stage'}</div>
  <div id="stage-editor-body">${_stageEditorHTML(d, icons)}</div>
  <div style="display:flex;gap:10px;margin-top:16px;position:sticky;bottom:0;background:rgba(35,31,56,.98);padding-top:12px">
    <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
    <button class="btn btn-primary" style="flex:2" onclick="adminSaveStage()">${isEdit ? '💾 Save Changes' : '✅ Add Stage'}</button>
  </div>`;
}

function _stageEditorHTML(d, icons) {
  if (!icons) icons = ['⭐','📖','🔢','✏️','👑','🔬','☀️','⚗️','⚛️','🐉'];
  const header = `
  <div style="display:grid;grid-template-columns:1fr 1fr 80px;gap:12px;margin-bottom:12px">
    <div class="form-group" style="margin:0"><label class="form-label">Title</label>
      <input type="text" id="sf-title" value="${_esc(d.title || '')}" style="width:100%" oninput="window._stageDraft.title=this.value"></div>
    <div class="form-group" style="margin:0"><label class="form-label">Type</label>
      <select id="sf-type" style="width:100%" onchange="window._stageDraft.type=this.value;_reloadStageEditor()">
        <option value="normal" ${d.type === 'normal' ? 'selected' : ''}>⚡ Normal Stage</option>
        <option value="boss"   ${d.type === 'boss'   ? 'selected' : ''}>⚔️ Boss Stage</option>
      </select></div>
    <div class="form-group" style="margin:0"><label class="form-label">❤️ Lives</label>
      <input type="number" id="sf-lives" value="${d.lives || 3}" min="1" max="10" style="width:100%" oninput="window._stageDraft.lives=parseInt(this.value)||3"></div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
    <div class="form-group" style="margin:0"><label class="form-label">⚡ XP Reward</label>
      <input type="number" id="sf-xp" value="${d.xp || 100}" min="0" style="width:100%" oninput="window._stageDraft.xp=parseInt(this.value)||0"></div>
    <div class="form-group" style="margin:0"><label class="form-label">🪙 Coin Reward</label>
      <input type="number" id="sf-coins" value="${d.coins || 50}" min="0" style="width:100%" oninput="window._stageDraft.coins=parseInt(this.value)||0"></div>
  </div>
  <div class="form-group"><label class="form-label">Stage Icon</label>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      ${icons.map(ic => `<div onclick="document.getElementById('sf-icon-val').value='${ic}';window._stageDraft.icon='${ic}'" style="width:34px;height:34px;border-radius:8px;background:rgba(255,255,255,.06);border:2px solid ${d.icon === ic ? 'var(--primary)' : 'transparent'};display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer">${ic}</div>`).join('')}
      <input type="text" id="sf-icon-val" value="${_esc(d.icon || '⭐')}" style="width:56px" oninput="window._stageDraft.icon=this.value">
    </div>
  </div>`;

  // Phase 3 — presence-based branch, same detection rule the engine uses
  // (Decision #13 / Phase 1's `Array.isArray(stage.beats)` check): a stage
  // saved with a `beats` array gets the new reorderable beat-list editor; a
  // stage still on the legacy scenes/enemies/outro shape keeps opening in
  // the original three-section editor, byte-for-byte unchanged below.
  return header + (Array.isArray(d.beats) ? _beatListEditorHTML(d) : _legacyStageEditorHTML(d));
}

// ── Legacy three-section editor (scenes / enemies / outro) ─────────────────────
// Unchanged since before Phase 3. Only stages that predate the beat-list
// model (no `beats` array) ever render through this path — see the branch
// in _stageEditorHTML above.
function _legacyStageEditorHTML(d) {
  return `
  <div style="border-top:1px solid var(--border);padding-top:14px;margin:12px 0 8px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div style="font-family:var(--fh);font-size:14px;font-weight:800">📖 Intro Story Scenes</div>
      <button class="btn btn-ghost btn-sm" onclick="adminAddScene('scenes')">＋ Scene</button>
    </div>
    <div id="sf-scenes">${(d.scenes || []).map((sc, i) => _sceneBlockHTML(sc, i, 'scenes')).join('')}</div>
  </div>
  <div style="border-top:1px solid var(--border);padding-top:14px;margin:12px 0 8px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div style="font-family:var(--fh);font-size:14px;font-weight:800">⚔️ Enemies &amp; Questions</div>
      <button class="btn btn-ghost btn-sm" onclick="adminAddEnemy()">＋ Enemy</button>
    </div>
    <div id="sf-enemies">${(d.enemies || []).map((en, ei) => _enemyBlockHTML(en, ei)).join('')}</div>
  </div>
  <div style="border-top:1px solid var(--border);padding-top:14px;margin:12px 0 8px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div style="font-family:var(--fh);font-size:14px;font-weight:800">🎉 Outro Scenes (after victory)</div>
      <button class="btn btn-ghost btn-sm" onclick="adminAddScene('outro')">＋ Scene</button>
    </div>
    <div id="sf-outro">${(d.outro || []).map((sc, i) => _sceneBlockHTML(sc, i, 'outro')).join('')}</div>
  </div>`;
}

// ── Beat-list editor (Phase 3) ──────────────────────────────────────────────────
// New stages only (see adminAddStage). One reorderable ordered list replacing
// the three-section split; `story` and `encounter` are the only beat types
// with real editor blocks so far (matches what Phase 2's engine can render).
// The `_beatBlockHTML` switch below is the deliberate extension point for
// Phases 4–6 (`interaction`/reveal, `dialogue`, `interaction`/dragdrop) —
// add a case + add-beat button there when those phases land; nothing else
// in this section should need to change.
function _beatListEditorHTML(d) {
  if (!d.beats) d.beats = [];
  return `
  <div style="border-top:1px solid var(--border);padding-top:14px;margin:12px 0 8px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <div style="font-family:var(--fh);font-size:14px;font-weight:800">🧩 Beats</div>
      <div class="beat-add-picker">
        <button class="btn btn-ghost btn-sm" onclick="adminAddBeat('story')">📖 ＋ Story</button>
        <button class="btn btn-ghost btn-sm" onclick="adminAddBeat('encounter')">⚔️ ＋ Encounter</button>
        <button class="btn btn-ghost btn-sm" onclick="adminAddBeat('interaction')">🔎 ＋ Reveal</button>
        <button class="btn btn-ghost btn-sm" onclick="adminAddBeat('dialogue')">💬 ＋ Dialogue</button>
        <button class="btn btn-ghost btn-sm" onclick="adminAddBeat('dragdrop')">🧲 ＋ Drag &amp; Drop</button>
      </div>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px">One ordered sequence — mix story and encounter beats freely and use ↑/↓ to reorder (same pattern as stage reordering on the map).</div>
    <div id="beat-list-body" class="beat-list">
      ${d.beats.length ? d.beats.map((b, i) => _beatBlockHTML(b, i)).join('') : `
      <div style="text-align:center;padding:32px;border:2px dashed rgba(255,255,255,.08);border-radius:12px;color:var(--text-muted);font-size:12px">
        No beats yet — add a Story or Encounter beat above to begin.
      </div>`}
    </div>
  </div>`;
}

function _beatBlockHTML(beat, i) {
  switch (beat.type) {
    case 'story':     return _storyBeatBlockHTML(beat, i);
    case 'encounter': return _encounterBeatBlockHTML(beat, i);
    case 'interaction':
      // Phase 4 built the 'reveal' subtype; Phase 6 adds 'dragdrop' as a
      // sibling case here.
      if (beat.subtype === 'reveal')   return _revealBeatBlockHTML(beat, i);
      if (beat.subtype === 'dragdrop') return _dragDropBeatBlockHTML(beat, i);
      return `<div class="beat-block">Unknown interaction subtype: ${_esc(beat.subtype)}</div>`;
    case 'dialogue':  return _dialogueBeatBlockHTML(beat, i);
    default:          return `<div class="beat-block">Unknown beat type: ${_esc(beat.type)}</div>`;
  }
}

function _beatBlockHeaderHTML(i, badgeClass, badgeLabel) {
  const total = (window._stageDraft.beats || []).length;
  return `<div class="beat-block-header">
    <div class="beat-drag-handle" title="Use the arrows to reorder">⠿</div>
    <div class="beat-type-badge ${badgeClass}">${badgeLabel}</div>
    <div class="beat-block-num">BEAT ${i + 1}</div>
    <div style="flex:1"></div>
    <button class="btn btn-ghost btn-xs" onclick="adminMoveBeat(${i},-1)" ${i === 0 ? 'disabled' : ''}>↑</button>
    <button class="btn btn-ghost btn-xs" onclick="adminMoveBeat(${i},1)" ${i === total - 1 ? 'disabled' : ''}>↓</button>
    <button class="btn btn-danger btn-xs" onclick="adminRemoveBeat(${i})">✕ Remove</button>
  </div>`;
}

function _storyBeatBlockHTML(beat, i) {
  return `<div class="beat-block">
    ${_beatBlockHeaderHTML(i, 'beat-type-story', '📖 STORY')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0 8px">
      <div><label class="form-label" style="font-size:9px">SPEAKER</label>
        <input type="text" value="${_esc(beat.speaker || 'NARRATOR')}" style="width:100%" oninput="window._stageDraft.beats[${i}].speaker=this.value"></div>
      <div><label class="form-label" style="font-size:9px">BG COLOR (hex)</label>
        <input type="text" value="${_esc(beat.bg || '#1a0a2e')}" placeholder="#1a0a2e" style="width:100%" oninput="window._stageDraft.beats[${i}].bg=this.value"></div>
    </div>
    <label class="form-label" style="font-size:9px">STORY TEXT (typewriter effect)</label>
    <textarea style="width:100%;min-height:72px;resize:vertical" oninput="window._stageDraft.beats[${i}].text=this.value">${_esc(beat.text || '')}</textarea>
  </div>`;
}

function _encounterBeatBlockHTML(beat, i) {
  return `<div class="beat-block">
    ${_beatBlockHeaderHTML(i, 'beat-type-encounter', '⚔️ ENCOUNTER')}
    <label style="display:flex;align-items:center;gap:8px;margin:10px 0;cursor:pointer;font-size:11px;color:var(--text-muted)">
      <input type="checkbox" ${beat.boss ? 'checked' : ''} onchange="window._stageDraft.beats[${i}].boss=this.checked;_reloadStageEditor()">
      ⚔️ Boss encounter (cosmetic framing only — mechanically identical per Decision #2)
    </label>
    <div style="display:grid;grid-template-columns:80px 1fr 1fr;gap:8px;margin-bottom:10px">
      <div><label class="form-label" style="font-size:9px">SPRITE</label>
        <input type="text" value="${_esc(beat.sprite || '👹')}" style="width:100%" oninput="window._stageDraft.beats[${i}].sprite=this.value"></div>
      <div><label class="form-label" style="font-size:9px">ENEMY NAME</label>
        <input type="text" value="${_esc(beat.name || '')}" style="width:100%" oninput="window._stageDraft.beats[${i}].name=this.value"></div>
      <div><label class="form-label" style="font-size:9px">ENCOUNTER TITLE</label>
        <input type="text" value="${_esc(beat.title || '')}" placeholder="${beat.boss ? 'BOSS BATTLE' : 'ENEMY ENCOUNTER'}" style="width:100%" oninput="window._stageDraft.beats[${i}].title=this.value"></div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-size:12px;font-weight:700;color:var(--primary)">Questions</div>
      <button class="btn btn-ghost btn-xs" onclick="adminAddBeatQuestion(${i})">＋ Add Question</button>
    </div>
    ${(beat.questions || []).map((q, qi) => _beatQuestionBlockHTML(q, i, qi)).join('')}
  </div>`;
}

function _beatQuestionBlockHTML(q, bi, qi) {
  return `<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:12px;margin-bottom:8px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-family:var(--fm);font-size:9px;color:var(--primary)">QUESTION ${qi + 1}</div>
      <button class="btn btn-danger btn-xs" onclick="adminRemoveBeatQuestion(${bi},${qi})">✕</button>
    </div>
    <input type="text" value="${_esc(q.q || '')}" placeholder="Type your question here..." style="width:100%;margin-bottom:10px" oninput="window._stageDraft.beats[${bi}].questions[${qi}].q=this.value">
    <div style="font-size:10px;color:var(--text-muted);margin-bottom:8px">Answer choices — click ● to mark correct</div>
    ${(q.opts || ['', '', '', '']).map((opt, oi) => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <div onclick="adminSetBeatAnswer(${bi},${qi},${oi})" style="width:22px;height:22px;border-radius:50%;border:2px solid ${q.answer === oi ? '#4edea3' : 'rgba(255,255,255,.15)'};background:${q.answer === oi ? 'rgba(78,222,163,.2)' : ''};cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:10px">${q.answer === oi ? '✓' : ''}</div>
      <input type="text" value="${_esc(opt || '')}" placeholder="Option ${String.fromCharCode(65 + oi)}" style="flex:1" oninput="window._stageDraft.beats[${bi}].questions[${qi}].opts[${oi}]=this.value">
    </div>`).join('')}
  </div>`;
}

// ── Interaction/reveal beat editor (Phase 4) ────────────────────────────────────
// Click-to-reveal hotspots: teacher-configurable count (Decision #9) and
// per-hotspot text/image payload (Decision #8). Rendered as a card per
// hotspot rather than positioned over a diagram — the roadmap only requires
// hotspot count and payload to be configurable, not pixel placement, and a
// card list is the simplest thing that renders correctly on both desktop and
// touch (positioned drag/place authoring is the kind of complexity Phase 6
// takes on for drag-drop, not this phase).
function _revealBeatBlockHTML(beat, i) {
  const hotspots = beat.hotspots || [];
  return `<div class="beat-block">
    ${_beatBlockHeaderHTML(i, 'beat-type-reveal', '🔎 REVEAL')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0 8px">
      <div><label class="form-label" style="font-size:9px">PROMPT / INSTRUCTIONS</label>
        <input type="text" value="${_esc(beat.prompt || '')}" placeholder="Click each item to learn more." style="width:100%" oninput="window._stageDraft.beats[${i}].prompt=this.value"></div>
      <div><label class="form-label" style="font-size:9px">BG COLOR (hex)</label>
        <input type="text" value="${_esc(beat.bg || '#1a0a2e')}" placeholder="#1a0a2e" style="width:100%" oninput="window._stageDraft.beats[${i}].bg=this.value"></div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-size:12px;font-weight:700;color:var(--primary)">Hotspots (${hotspots.length}) — student must click all to continue</div>
      <button class="btn btn-ghost btn-xs" onclick="adminAddRevealHotspot(${i})">＋ Add Hotspot</button>
    </div>
    ${hotspots.length ? hotspots.map((h, hi) => _revealHotspotBlockHTML(h, i, hi)).join('') : `
    <div style="text-align:center;padding:16px;border:2px dashed rgba(255,255,255,.08);border-radius:10px;color:var(--text-muted);font-size:12px">
      No hotspots yet — add at least one so this beat has something to reveal.
    </div>`}
  </div>`;
}

function _revealHotspotBlockHTML(h, bi, hi) {
  return `<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:12px;margin-bottom:8px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-family:var(--fm);font-size:9px;color:var(--primary)">HOTSPOT ${hi + 1}</div>
      <button class="btn btn-danger btn-xs" onclick="adminRemoveRevealHotspot(${bi},${hi})">✕</button>
    </div>
    <input type="text" value="${_esc(h.label || '')}" placeholder="Label (e.g. Mitochondria)" style="width:100%;margin-bottom:8px" oninput="window._stageDraft.beats[${bi}].hotspots[${hi}].label=this.value">
    <textarea style="width:100%;min-height:56px;resize:vertical;margin-bottom:8px" placeholder="Info shown when the student clicks this hotspot..." oninput="window._stageDraft.beats[${bi}].hotspots[${hi}].text=this.value">${_esc(h.text || '')}</textarea>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      ${h.image
        ? `<img src="${_esc(h.image)}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid rgba(255,255,255,.1)">`
        : `<div style="width:56px;height:56px;border-radius:8px;border:2px dashed rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-size:20px;color:var(--text-muted)">📁</div>`}
      <label class="btn btn-ghost btn-xs" style="cursor:pointer">
        📁 ${h.image ? 'Replace Image' : 'Add Image (optional)'}
        <input type="file" accept="image/png,image/webp,image/jpeg,image/gif" style="display:none" onchange="_revealHandleHotspotImage(${bi},${hi},this)">
      </label>
      ${h.image ? `<button class="btn btn-ghost btn-xs" onclick="_revealClearHotspotImage(${bi},${hi})">✕ Remove Image</button>` : ''}
    </div>
  </div>`;
}

window.adminAddRevealHotspot = function (bi) {
  const d = window._stageDraft; if (!d) return;
  if (!d.beats[bi].hotspots) d.beats[bi].hotspots = [];
  d.beats[bi].hotspots.push({ label: 'Item ' + (d.beats[bi].hotspots.length + 1), text: '', image: '' });
  _reloadStageEditor();
};
window.adminRemoveRevealHotspot = function (bi, hi) {
  const d = window._stageDraft; if (!d) return;
  d.beats[bi].hotspots.splice(hi, 1);
  _reloadStageEditor();
};

// Image upload for hotspot payloads — same base64-dataURL-via-FileReader
// pattern as boss-studio's `_bsHandleFileUpload` (see bs_editor.js), the
// named precedent per the roadmap's Phase 4 risk note; no new upload
// mechanism invented, same 3MB cap.
window._revealHandleHotspotImage = function (bi, hi, inputEl) {
  const file = inputEl && inputEl.files && inputEl.files[0];
  if (!file) return;
  const MAX = 3 * 1024 * 1024;
  if (file.size > MAX) {
    toast('❌ File is too large (max 3 MB)', '#ffb4ab');
    if (inputEl && inputEl.value !== undefined) inputEl.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = function (e) {
    const d = window._stageDraft; if (!d) return;
    d.beats[bi].hotspots[hi].image = e.target.result;
    _reloadStageEditor();
  };
  reader.readAsDataURL(file);
};
window._revealClearHotspotImage = function (bi, hi) {
  const d = window._stageDraft; if (!d) return;
  d.beats[bi].hotspots[hi].image = '';
  _reloadStageEditor();
};

// ── Dialogue beat editor (Phase 5) ──────────────────────────────────────────────
// 2–4 choice buttons, flavor/narrative only (Decision #10) — no scoring,
// state, or branching fields to author, just a prompt plus a label + short
// response line per option. Add/Remove Option is bounded to the 2–4 range
// the roadmap and engine expect.
function _dialogueBeatBlockHTML(beat, i) {
  const options = beat.options || [];
  return `<div class="beat-block">
    ${_beatBlockHeaderHTML(i, 'beat-type-dialogue', '💬 DIALOGUE')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0 8px">
      <div><label class="form-label" style="font-size:9px">PROMPT / QUESTION</label>
        <input type="text" value="${_esc(beat.prompt || '')}" placeholder="What do you say?" style="width:100%" oninput="window._stageDraft.beats[${i}].prompt=this.value"></div>
      <div><label class="form-label" style="font-size:9px">BG COLOR (hex)</label>
        <input type="text" value="${_esc(beat.bg || '#1a0a2e')}" placeholder="#1a0a2e" style="width:100%" oninput="window._stageDraft.beats[${i}].bg=this.value"></div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-size:12px;font-weight:700;color:var(--primary)">Choices (${options.length}) — any choice advances the same way (flavor only)</div>
      <button class="btn btn-ghost btn-xs" onclick="adminAddDialogueOption(${i})" ${options.length >= 4 ? 'disabled' : ''}>＋ Add Choice</button>
    </div>
    ${options.map((opt, oi) => _dialogueOptionBlockHTML(opt, i, oi, options.length)).join('')}
  </div>`;
}

function _dialogueOptionBlockHTML(opt, bi, oi, total) {
  return `<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:12px;margin-bottom:8px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-family:var(--fm);font-size:9px;color:var(--primary)">CHOICE ${oi + 1}</div>
      <button class="btn btn-danger btn-xs" onclick="adminRemoveDialogueOption(${bi},${oi})" ${total <= 2 ? 'disabled' : ''}>✕</button>
    </div>
    <input type="text" value="${_esc(opt.label || '')}" placeholder="Choice button text..." style="width:100%;margin-bottom:8px" oninput="window._stageDraft.beats[${bi}].options[${oi}].label=this.value">
    <textarea style="width:100%;min-height:48px;resize:vertical" placeholder="Response line shown after picking this choice..." oninput="window._stageDraft.beats[${bi}].options[${oi}].response=this.value">${_esc(opt.response || '')}</textarea>
  </div>`;
}

window.adminAddDialogueOption = function (bi) {
  const d = window._stageDraft; if (!d) return;
  if (!d.beats[bi].options) d.beats[bi].options = [];
  if (d.beats[bi].options.length >= 4) return; // Decision #10 range: 2–4 choices
  d.beats[bi].options.push({ label: '', response: '' });
  _reloadStageEditor();
};
window.adminRemoveDialogueOption = function (bi, oi) {
  const d = window._stageDraft; if (!d) return;
  if (d.beats[bi].options.length <= 2) return; // Decision #10 range: 2–4 choices
  d.beats[bi].options.splice(oi, 1);
  _reloadStageEditor();
};

// ── Drag-and-drop beat editor (Phase 6) ─────────────────────────────────────────
// Two modes, teacher picks per beat (Decision #11): `match` (drag items onto
// labeled targets) and `sequence` (drag items into the correct order — the
// authored item order *is* the correct order, reordered via the same
// ↑/↓ pattern `adminMoveStage`/`adminMoveBeat` already use). Item authoring
// (label + optional image) reuses Phase 4's reveal-hotspot pattern, same
// upload handler shape (3MB cap, base64 data URL).
function _dragDropBeatBlockHTML(beat, i) {
  if (!beat.mode)    beat.mode    = 'match';
  if (!beat.items)   beat.items   = [];
  if (!beat.targets) beat.targets = [];
  const isMatch = beat.mode === 'match';
  return `<div class="beat-block">
    ${_beatBlockHeaderHTML(i, 'beat-type-dragdrop', '🧲 DRAG & DROP')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0 8px">
      <div><label class="form-label" style="font-size:9px">PROMPT / INSTRUCTIONS</label>
        <input type="text" value="${_esc(beat.prompt || '')}" placeholder="${isMatch ? 'Drag each item to its match.' : 'Drag the items into the correct order.'}" style="width:100%" oninput="window._stageDraft.beats[${i}].prompt=this.value"></div>
      <div><label class="form-label" style="font-size:9px">BG COLOR (hex)</label>
        <input type="text" value="${_esc(beat.bg || '#1a0a2e')}" placeholder="#1a0a2e" style="width:100%" oninput="window._stageDraft.beats[${i}].bg=this.value"></div>
    </div>
    <div class="form-group" style="margin-bottom:12px">
      <label class="form-label" style="font-size:9px">MODE (Decision #11 — teacher picks per beat)</label>
      <select style="width:100%" onchange="adminSetDragDropMode(${i}, this.value)">
        <option value="match"    ${isMatch  ? 'selected' : ''}>🎯 Drag onto target (matching)</option>
        <option value="sequence" ${!isMatch ? 'selected' : ''}>🔢 Drag into sequence (ordering)</option>
      </select>
    </div>
    ${isMatch ? _dragDropMatchEditorHTML(beat, i) : _dragDropSequenceEditorHTML(beat, i)}
  </div>`;
}

function _dragDropMatchEditorHTML(beat, i) {
  const targets = beat.targets || [];
  const items   = beat.items || [];
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-size:12px;font-weight:700;color:var(--primary)">Targets (${targets.length})</div>
      <button class="btn btn-ghost btn-xs" onclick="adminAddDragTarget(${i})">＋ Add Target</button>
    </div>
    ${targets.map((t, ti) => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <input type="text" value="${_esc(t.label || '')}" placeholder="Target label (e.g. Nucleus)" style="flex:1" oninput="window._stageDraft.beats[${i}].targets[${ti}].label=this.value">
      <button class="btn btn-danger btn-xs" onclick="adminRemoveDragTarget(${i},${ti})" ${targets.length <= 1 ? 'disabled' : ''}>✕</button>
    </div>`).join('')}
    <div style="display:flex;align-items:center;justify-content:space-between;margin:14px 0 8px">
      <div style="font-size:12px;font-weight:700;color:var(--primary)">Items (${items.length}) — one per target, pick which target each belongs to</div>
      <button class="btn btn-ghost btn-xs" onclick="adminAddDragItem(${i})">＋ Add Item</button>
    </div>
    ${items.length ? items.map((it, ii) => _dragItemBlockHTML(it, i, ii, targets, 'match')).join('') : `
    <div style="text-align:center;padding:16px;border:2px dashed rgba(255,255,255,.08);border-radius:10px;color:var(--text-muted);font-size:12px">
      No items yet — add at least one item to match against a target.
    </div>`}`;
}

function _dragDropSequenceEditorHTML(beat, i) {
  const items = beat.items || [];
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-size:12px;font-weight:700;color:var(--primary)">Items in correct order (${items.length}) — use ↑/↓ to set the correct sequence</div>
      <button class="btn btn-ghost btn-xs" onclick="adminAddDragItem(${i})">＋ Add Item</button>
    </div>
    ${items.length ? items.map((it, ii) => _dragItemBlockHTML(it, i, ii, [], 'sequence')).join('') : `
    <div style="text-align:center;padding:16px;border:2px dashed rgba(255,255,255,.08);border-radius:10px;color:var(--text-muted);font-size:12px">
      No items yet — add items in the order students should end up placing them.
    </div>`}`;
}

// Shared item card for both modes: `mode==='match'` shows a target picker
// (no reorder — order is irrelevant to matching); `mode==='sequence'` shows
// ↑/↓ reorder controls instead (authored order defines the correct sequence,
// no target picker needed).
function _dragItemBlockHTML(it, bi, ii, targets, mode) {
  const total = (window._stageDraft.beats[bi].items || []).length;
  return `<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:12px;margin-bottom:8px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-family:var(--fm);font-size:9px;color:var(--primary)">ITEM ${ii + 1}</div>
      <div style="display:flex;gap:4px">
        ${mode === 'sequence' ? `
        <button class="btn btn-ghost btn-xs" onclick="adminMoveDragItem(${bi},${ii},-1)" ${ii === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn btn-ghost btn-xs" onclick="adminMoveDragItem(${bi},${ii},1)" ${ii === total - 1 ? 'disabled' : ''}>↓</button>` : ''}
        <button class="btn btn-danger btn-xs" onclick="adminRemoveDragItem(${bi},${ii})">✕</button>
      </div>
    </div>
    <input type="text" value="${_esc(it.label || '')}" placeholder="Item label" style="width:100%;margin-bottom:8px" oninput="window._stageDraft.beats[${bi}].items[${ii}].label=this.value">
    ${mode === 'match' ? `
    <select style="width:100%;margin-bottom:8px" onchange="window._stageDraft.beats[${bi}].items[${ii}].targetId=this.value">
      ${(targets || []).map(t => `<option value="${t.id}" ${it.targetId === t.id ? 'selected' : ''}>${_esc(t.label || 'Target')}</option>`).join('')}
    </select>` : ''}
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      ${it.image
        ? `<img src="${_esc(it.image)}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid rgba(255,255,255,.1)">`
        : `<div style="width:56px;height:56px;border-radius:8px;border:2px dashed rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-size:20px;color:var(--text-muted)">📁</div>`}
      <label class="btn btn-ghost btn-xs" style="cursor:pointer">
        📁 ${it.image ? 'Replace Image' : 'Add Image (optional)'}
        <input type="file" accept="image/png,image/webp,image/jpeg,image/gif" style="display:none" onchange="_dragHandleItemImage(${bi},${ii},this)">
      </label>
      ${it.image ? `<button class="btn btn-ghost btn-xs" onclick="_dragClearItemImage(${bi},${ii})">✕ Remove Image</button>` : ''}
    </div>
  </div>`;
}

window.adminSetDragDropMode = function (bi, mode) {
  const d = window._stageDraft; if (!d) return;
  const beat = d.beats[bi];
  beat.mode = mode;
  // Switching into match mode for the first time seeds one target and
  // points any target-less items at it, so the picker never renders empty.
  if (mode === 'match' && (!beat.targets || !beat.targets.length)) {
    beat.targets = [{ id: 'tg_' + uid(), label: 'Target 1' }];
    (beat.items || []).forEach(it => { if (!it.targetId) it.targetId = beat.targets[0].id; });
  }
  _reloadStageEditor();
};

window.adminAddDragTarget = function (bi) {
  const d = window._stageDraft; if (!d) return;
  if (!d.beats[bi].targets) d.beats[bi].targets = [];
  d.beats[bi].targets.push({ id: 'tg_' + uid(), label: 'Target ' + (d.beats[bi].targets.length + 1) });
  _reloadStageEditor();
};
window.adminRemoveDragTarget = function (bi, ti) {
  const d = window._stageDraft; if (!d) return;
  const targets = d.beats[bi].targets;
  if (targets.length <= 1) return;
  const removed = targets[ti];
  targets.splice(ti, 1);
  // Items pointing at the removed target fall back to the first remaining
  // one rather than being left with a dangling targetId.
  (d.beats[bi].items || []).forEach(it => { if (it.targetId === removed.id) it.targetId = targets[0].id; });
  _reloadStageEditor();
};
window.adminAddDragItem = function (bi) {
  const d = window._stageDraft; if (!d) return;
  const beat = d.beats[bi];
  if (!beat.items) beat.items = [];
  const item = { id: 'it_' + uid(), label: 'Item ' + (beat.items.length + 1), image: '' };
  if (beat.mode === 'match') item.targetId = (beat.targets && beat.targets[0]) ? beat.targets[0].id : null;
  beat.items.push(item);
  _reloadStageEditor();
};
window.adminRemoveDragItem = function (bi, ii) {
  const d = window._stageDraft; if (!d) return;
  d.beats[bi].items.splice(ii, 1);
  _reloadStageEditor();
};
window.adminMoveDragItem = function (bi, ii, dir) {
  const d = window._stageDraft; if (!d) return;
  const items = d.beats[bi].items;
  const ni = ii + dir;
  if (ni < 0 || ni >= items.length) return;
  [items[ii], items[ni]] = [items[ni], items[ii]];
  _reloadStageEditor();
};

// Image upload for item payloads — same base64-dataURL-via-FileReader
// pattern as Phase 4's `_revealHandleHotspotImage` (itself ported from
// boss-studio's `_bsHandleFileUpload`), same 3MB cap.
window._dragHandleItemImage = function (bi, ii, inputEl) {
  const file = inputEl && inputEl.files && inputEl.files[0];
  if (!file) return;
  const MAX = 3 * 1024 * 1024;
  if (file.size > MAX) {
    toast('❌ File is too large (max 3 MB)', '#ffb4ab');
    if (inputEl && inputEl.value !== undefined) inputEl.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = function (e) {
    const d = window._stageDraft; if (!d) return;
    d.beats[bi].items[ii].image = e.target.result;
    _reloadStageEditor();
  };
  reader.readAsDataURL(file);
};
window._dragClearItemImage = function (bi, ii) {
  const d = window._stageDraft; if (!d) return;
  d.beats[bi].items[ii].image = '';
  _reloadStageEditor();
};

function _sceneBlockHTML(sc, i, key) {
  return `<div class="scene-block">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div class="scene-block-num">SCENE ${i + 1}</div>
      <button class="btn btn-danger btn-xs" onclick="adminRemoveScene('${key}',${i})">✕ Remove</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
      <div><label class="form-label" style="font-size:9px">SPEAKER</label>
        <input type="text" value="${_esc(sc.speaker || 'NARRATOR')}" style="width:100%" oninput="window._stageDraft['${key}'][${i}].speaker=this.value"></div>
      <div><label class="form-label" style="font-size:9px">BG COLOR (hex)</label>
        <input type="text" value="${_esc(sc.bg || '#1a0a2e')}" placeholder="#1a0a2e" style="width:100%" oninput="window._stageDraft['${key}'][${i}].bg=this.value"></div>
    </div>
    <label class="form-label" style="font-size:9px">STORY TEXT (typewriter effect)</label>
    <textarea style="width:100%;min-height:72px;resize:vertical" oninput="window._stageDraft['${key}'][${i}].text=this.value">${_esc(sc.text || '')}</textarea>
  </div>`;
}

function _enemyBlockHTML(en, ei) {
  return `<div class="scene-block">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div class="scene-block-num">ENEMY ${ei + 1}</div>
      <button class="btn btn-danger btn-xs" onclick="adminRemoveEnemy(${ei})">✕ Remove Enemy</button>
    </div>
    <div style="display:grid;grid-template-columns:80px 1fr 1fr;gap:8px;margin-bottom:10px">
      <div><label class="form-label" style="font-size:9px">SPRITE</label>
        <input type="text" value="${_esc(en.sprite || '👹')}" style="width:100%" oninput="window._stageDraft.enemies[${ei}].sprite=this.value"></div>
      <div><label class="form-label" style="font-size:9px">ENEMY NAME</label>
        <input type="text" value="${_esc(en.name || '')}" style="width:100%" oninput="window._stageDraft.enemies[${ei}].name=this.value"></div>
      <div><label class="form-label" style="font-size:9px">ENCOUNTER TITLE</label>
        <input type="text" value="${_esc(en.title || '')}" placeholder="ENEMY ENCOUNTER" style="width:100%" oninput="window._stageDraft.enemies[${ei}].title=this.value"></div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-size:12px;font-weight:700;color:var(--primary)">Questions</div>
      <button class="btn btn-ghost btn-xs" onclick="adminAddQuestion(${ei})">＋ Add Question</button>
    </div>
    ${(en.questions || []).map((q, qi) => _questionBlockHTML(q, ei, qi)).join('')}
  </div>`;
}

function _questionBlockHTML(q, ei, qi) {
  return `<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:12px;margin-bottom:8px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-family:var(--fm);font-size:9px;color:var(--primary)">QUESTION ${qi + 1}</div>
      <button class="btn btn-danger btn-xs" onclick="adminRemoveQuestion(${ei},${qi})">✕</button>
    </div>
    <input type="text" value="${_esc(q.q || '')}" placeholder="Type your question here..." style="width:100%;margin-bottom:10px" oninput="window._stageDraft.enemies[${ei}].questions[${qi}].q=this.value">
    <div style="font-size:10px;color:var(--text-muted);margin-bottom:8px">Answer choices — click ● to mark correct</div>
    ${(q.opts || ['', '', '', '']).map((opt, oi) => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <div onclick="adminSetAnswer(${ei},${qi},${oi})" style="width:22px;height:22px;border-radius:50%;border:2px solid ${q.answer === oi ? '#4edea3' : 'rgba(255,255,255,.15)'};background:${q.answer === oi ? 'rgba(78,222,163,.2)' : ''};cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:10px">${q.answer === oi ? '✓' : ''}</div>
      <input type="text" value="${_esc(opt || '')}" placeholder="Option ${String.fromCharCode(65 + oi)}" style="flex:1" oninput="window._stageDraft.enemies[${ei}].questions[${qi}].opts[${oi}]=this.value">
    </div>`).join('')}
  </div>`;
}

window._reloadStageEditor = function () {
  const d = window._stageDraft; if (!d) return;
  document.getElementById('stage-editor-body').innerHTML = _stageEditorHTML(d);
};

window.adminSaveStage = function () {
  const d  = window._stageDraft; if (!d) return;
  d.title  = document.getElementById('sf-title')?.value.trim()      || d.title || 'Stage';
  d.type   = document.getElementById('sf-type')?.value              || d.type;
  d.lives  = parseInt(document.getElementById('sf-lives')?.value)   || 3;
  d.xp     = parseInt(document.getElementById('sf-xp')?.value)      || 100;
  d.coins  = parseInt(document.getElementById('sf-coins')?.value)   || 50;
  d.icon   = document.getElementById('sf-icon-val')?.value.trim()   || '⭐';
  const wi = window._stageDraftWi; const si = window._stageDraftSi;
  const worldExists = !!(AppStore.getSlice(s => s.stageMap) || [])[wi];
  if (!worldExists) return;
  AppStore.updateState(draft => {
    if (!draft.stageMap || !draft.stageMap[wi]) return;
    if (si === null) draft.stageMap[wi].stages.push(d);
    else             draft.stageMap[wi].stages[si] = d;
  }, { type: 'campaign:stage-saved', payload: { worldIndex: wi, stageIndex: si } });
  closeModalForce(); renderAdminStageMap();
  toast('✅ Stage "' + d.title + '" ' + (si === null ? 'added' : 'updated') + '!');
};

window.adminDeleteStage = function (wi, si) {
  const worlds = AppStore.getSlice(s => s.stageMap) || [];
  if (!confirm('Delete "' + worlds[wi].stages[si].title + '"?')) return;
  AppStore.updateState(draft => {
    draft.stageMap[wi].stages.splice(si, 1);
  }, { type: 'campaign:stage-deleted', payload: { worldIndex: wi, stageIndex: si } });
  renderAdminStageMap(); toast('🗑️ Stage deleted');
};

window.adminMoveStage = function (wi, si, dir) {
  const worlds = AppStore.getSlice(s => s.stageMap) || [];
  const arr = worlds[wi].stages; const ni = si + dir;
  if (ni < 0 || ni >= arr.length) return;
  AppStore.updateState(draft => {
    const a = draft.stageMap[wi].stages;
    [a[si], a[ni]] = [a[ni], a[si]];
  }, { type: 'campaign:stage-reordered', payload: { worldIndex: wi, from: si, to: ni } });
  renderAdminStageMap();
};

// Inline editor helpers
window.adminAddScene      = function (key)     { const d = window._stageDraft; if (!d) return; if (!d[key]) d[key] = []; d[key].push({ type: 'story', speaker: 'NARRATOR', text: '', bg: '#1a0a2e' }); _reloadStageEditor(); };
window.adminRemoveScene   = function (key, i)  { const d = window._stageDraft; if (!d || !d[key]) return; d[key].splice(i, 1); _reloadStageEditor(); };
window.adminAddEnemy      = function ()         { const d = window._stageDraft; if (!d) return; if (!d.enemies) d.enemies = []; d.enemies.push({ sprite: '👹', name: 'Enemy', title: 'ENEMY ENCOUNTER', questions: [{ q: '', opts: ['', '', '', ''], answer: 0 }] }); _reloadStageEditor(); };
window.adminRemoveEnemy   = function (ei)       { const d = window._stageDraft; if (!d) return; d.enemies.splice(ei, 1); _reloadStageEditor(); };
window.adminAddQuestion   = function (ei)       { const d = window._stageDraft; if (!d) return; d.enemies[ei].questions.push({ q: '', opts: ['', '', '', ''], answer: 0 }); _reloadStageEditor(); };
window.adminRemoveQuestion = function (ei, qi) { const d = window._stageDraft; if (!d) return; d.enemies[ei].questions.splice(qi, 1); _reloadStageEditor(); };
window.adminSetAnswer     = function (ei, qi, oi) { const d = window._stageDraft; if (!d) return; d.enemies[ei].questions[qi].answer = oi; _reloadStageEditor(); };

// Beat-list inline editor helpers (Phase 3) — parallel to the legacy scene/
// enemy/question helpers above, but operating on window._stageDraft.beats.
window.adminAddBeat = function (type) {
  const d = window._stageDraft; if (!d) return;
  if (!d.beats) d.beats = [];
  if (type === 'encounter') {
    d.beats.push({ type: 'encounter', boss: false, sprite: '👹', name: 'Enemy', title: 'ENEMY ENCOUNTER', questions: [{ q: '', opts: ['', '', '', ''], answer: 0 }] });
  } else if (type === 'interaction') {
    // Phase 4 — interaction/reveal beat: one or more click-to-reveal
    // hotspots (Decisions #1, #8, #9). Seeded with a single hotspot so the
    // editor never shows an empty required list.
    d.beats.push({ type: 'interaction', subtype: 'reveal', bg: '#1a0a2e', prompt: 'Click each item to learn more.', hotspots: [{ label: 'Item 1', text: '', image: '' }] });
  } else if (type === 'dialogue') {
    // Phase 5 — dialogue beat: 2–4 choice buttons, flavor/narrative only
    // (Decision #10: no scoring/state/branching). Seeded with the minimum
    // of 2 options so the editor never shows an under-filled choice list.
    d.beats.push({ type: 'dialogue', bg: '#1a0a2e', prompt: '', options: [{ label: '', response: '' }, { label: '', response: '' }] });
  } else if (type === 'dragdrop') {
    // Phase 6 — interaction/dragdrop beat: drag-onto-target/matching or
    // drag-into-sequence/ordering, teacher picks per beat (Decision #11).
    // Seeded in match mode with one target and one item pointing at it, so
    // the editor never opens on an empty/unpaired state.
    const tgId = 'tg_' + uid();
    d.beats.push({
      type: 'interaction', subtype: 'dragdrop', mode: 'match', bg: '#1a0a2e', prompt: '',
      targets: [{ id: tgId, label: 'Target 1' }],
      items: [{ id: 'it_' + uid(), label: 'Item 1', image: '', targetId: tgId }],
    });
  } else {
    d.beats.push({ type: 'story', speaker: 'NARRATOR', text: '', bg: '#1a0a2e' });
  }
  _reloadStageEditor();
};
window.adminRemoveBeat = function (i) { const d = window._stageDraft; if (!d || !d.beats) return; d.beats.splice(i, 1); _reloadStageEditor(); };
window.adminMoveBeat   = function (i, dir) {
  const d = window._stageDraft; if (!d || !d.beats) return;
  const ni = i + dir;
  if (ni < 0 || ni >= d.beats.length) return;
  [d.beats[i], d.beats[ni]] = [d.beats[ni], d.beats[i]];
  _reloadStageEditor();
};
window.adminAddBeatQuestion    = function (bi)      { const d = window._stageDraft; if (!d) return; d.beats[bi].questions.push({ q: '', opts: ['', '', '', ''], answer: 0 }); _reloadStageEditor(); };
window.adminRemoveBeatQuestion = function (bi, qi)  { const d = window._stageDraft; if (!d) return; d.beats[bi].questions.splice(qi, 1); _reloadStageEditor(); };
window.adminSetBeatAnswer      = function (bi, qi, oi) { const d = window._stageDraft; if (!d) return; d.beats[bi].questions[qi].answer = oi; _reloadStageEditor(); };

console.log('[EduQuest] campaign/admin-map-editor.js loaded — renderAdminStageMap, world/stage CRUD registered.');
