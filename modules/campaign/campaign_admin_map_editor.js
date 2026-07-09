// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/campaign/admin-map-editor.js
//  Admin Stage Map Editor: renderAdminStageMap and all world/stage CRUD helpers.
//  LOAD AFTER: engine.js, stage-map.js
// ═══════════════════════════════════════════════════════════════════════════════

// ── Main renderer ─────────────────────────────────────────────────────────────

window.renderAdminStageMap = function () {
  DB = loadDB();
  const worlds = DB.stageMap || [];
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
    ${worlds.map((w, wi) => `
    <div class="smap-admin-card">
      <div class="smap-admin-world-header" onclick="adminToggleWorld('aw-${wi}')">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <div style="font-size:28px">${w.icon}</div>
          <div>
            <div style="font-family:var(--fh);font-size:16px;font-weight:800;color:var(--on-surface)">${_esc(w.label)}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${_esc(w.desc)}</div>
          </div>
          <span style="font-family:var(--fm);font-size:9px;color:${w.color};background:${w.color}18;border:1px solid ${w.color}44;padding:2px 10px;border-radius:4px;letter-spacing:.06em">${w.stages.length} STAGES</span>
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
            <div style="font-size:11px;color:var(--text-muted);margin-top:3px">❤️ ${s.lives || 3} lives · ⚡ +${s.xp} XP · 🪙 ${s.coins} · ${(s.scenes || []).length} scenes · ${(s.enemies || []).length} enemies · ${(s.enemies || []).reduce((a, e) => a + (e.questions || []).length, 0)} questions</div>
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
    </div>`).join('')}
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
  // automatically via the JSON clone of DB.stageMap[wi], which already has
  // it from the Supabase pull mapping in db-service.js.
  window._worldDraft = { id: 'w_' + uid(), ownerTeacherId: currentUser.id, label: 'New World', icon: '🌍', color: '#8b5cf6', desc: 'A new world awaits.', stages: [] };
  showModal(_worldModalHTML(true), 'md');
};

window.adminEditWorld = function (wi) {
  window._worldDraft = JSON.parse(JSON.stringify(DB.stageMap[wi]));
  showModal(_worldModalHTML(false, wi), 'md');
};

function _worldModalHTML(isNew, wi) {
  const d      = window._worldDraft;
  const colors = ['#8b5cf6', '#4edea3', '#93c5fd', '#ffb95f', '#f87171', '#a78bfa', '#34d399', '#fb923c'];
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
  DB = loadDB();
  if (!DB.stageMap) DB.stageMap = [];
  DB.stageMap.push(d); saveDB(); closeModalForce(); renderAdminStageMap();
  toast('✅ World "' + d.label + '" created!');
};

window.adminSaveEditWorld = function (wi) {
  const d = window._worldDraft; if (!d) return;
  d.label = document.getElementById('wf-label').value.trim() || d.label;
  d.icon  = document.getElementById('wf-icon').value.trim()  || d.icon;
  d.color = document.getElementById('wf-col').value.trim()   || d.color;
  d.desc  = document.getElementById('wf-desc').value.trim();
  DB = loadDB();
  DB.stageMap[wi] = { ...DB.stageMap[wi], ...d };
  saveDB(); closeModalForce(); renderAdminStageMap(); toast('✅ World updated!');
};

window.adminDeleteWorld = async function (wi) {
  DB = loadDB();
  if (!confirm('Delete world "' + DB.stageMap[wi].label + '" and ALL its stages?')) return;
  const world = DB.stageMap[wi];
  DB.stageMap.splice(wi, 1); saveDB(); renderAdminStageMap(); toast('🗑️ World deleted');
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
  window._stageDraft = {
    id: 's_' + uid(), title: 'New Stage', icon: '⭐', type: 'normal', xp: 100, coins: 50, lives: 3,
    scenes:  [{ type: 'story', speaker: 'NARRATOR', text: 'Your story begins here...', bg: '#1a0a2e' }],
    enemies: [{ sprite: '👹', name: 'Enemy', title: 'ENEMY ENCOUNTER', questions: [{ q: '', opts: ['', '', '', ''], answer: 0 }] }],
    outro:   [{ type: 'story', speaker: 'NARRATOR', text: 'Victory!', bg: '#0e1a0e' }],
  };
  window._stageDraftWi = wi; window._stageDraftSi = null;
  showModal(_stageModalHTML(), 'lg');
};

window.adminEditStage = function (wi, si) {
  DB = loadDB();
  window._stageDraft   = JSON.parse(JSON.stringify(DB.stageMap[wi].stages[si]));
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
  return `
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
  </div>
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
  DB = loadDB();
  const wi = window._stageDraftWi; const si = window._stageDraftSi;
  if (!DB.stageMap[wi]) return;
  if (si === null) DB.stageMap[wi].stages.push(d);
  else             DB.stageMap[wi].stages[si] = d;
  saveDB(); closeModalForce(); renderAdminStageMap();
  toast('✅ Stage "' + d.title + '" ' + (si === null ? 'added' : 'updated') + '!');
};

window.adminDeleteStage = function (wi, si) {
  DB = loadDB();
  if (!confirm('Delete "' + DB.stageMap[wi].stages[si].title + '"?')) return;
  DB.stageMap[wi].stages.splice(si, 1); saveDB(); renderAdminStageMap(); toast('🗑️ Stage deleted');
};

window.adminMoveStage = function (wi, si, dir) {
  DB = loadDB();
  const arr = DB.stageMap[wi].stages; const ni = si + dir;
  if (ni < 0 || ni >= arr.length) return;
  [arr[si], arr[ni]] = [arr[ni], arr[si]]; saveDB(); renderAdminStageMap();
};

// Inline editor helpers
window.adminAddScene      = function (key)     { const d = window._stageDraft; if (!d) return; if (!d[key]) d[key] = []; d[key].push({ type: 'story', speaker: 'NARRATOR', text: '', bg: '#1a0a2e' }); _reloadStageEditor(); };
window.adminRemoveScene   = function (key, i)  { const d = window._stageDraft; if (!d || !d[key]) return; d[key].splice(i, 1); _reloadStageEditor(); };
window.adminAddEnemy      = function ()         { const d = window._stageDraft; if (!d) return; if (!d.enemies) d.enemies = []; d.enemies.push({ sprite: '👹', name: 'Enemy', title: 'ENEMY ENCOUNTER', questions: [{ q: '', opts: ['', '', '', ''], answer: 0 }] }); _reloadStageEditor(); };
window.adminRemoveEnemy   = function (ei)       { const d = window._stageDraft; if (!d) return; d.enemies.splice(ei, 1); _reloadStageEditor(); };
window.adminAddQuestion   = function (ei)       { const d = window._stageDraft; if (!d) return; d.enemies[ei].questions.push({ q: '', opts: ['', '', '', ''], answer: 0 }); _reloadStageEditor(); };
window.adminRemoveQuestion = function (ei, qi) { const d = window._stageDraft; if (!d) return; d.enemies[ei].questions.splice(qi, 1); _reloadStageEditor(); };
window.adminSetAnswer     = function (ei, qi, oi) { const d = window._stageDraft; if (!d) return; d.enemies[ei].questions[qi].answer = oi; _reloadStageEditor(); };

console.log('[EduQuest] campaign/admin-map-editor.js loaded — renderAdminStageMap, world/stage CRUD registered.');
