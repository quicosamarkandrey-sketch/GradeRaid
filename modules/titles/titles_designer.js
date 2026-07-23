// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/titles/designer.js
//  MMORPG Title Designer v3 modal: tsAdminOpenDesigner, all ts3* interaction
//  handlers, tsAdminSave, tsApplyRarityDefaults.
//  LOAD AFTER: badge-renderer.js, sidebar-refresh.js, student-page.js, admin-page.js
// ═══════════════════════════════════════════════════════════════════════════════

// ── Template category definitions ────────────────────────────────────────────
window.TS_TEMPLATE_CATS = [
  { id: 'all',         icon: '⚔️',  label: 'All'          },
  { id: 'nameplate',   icon: '📛',  label: 'Nameplates'   },
  { id: 'achievement', icon: '🏆',  label: 'Achievements' },
  { id: 'guild',       icon: '⚜️',  label: 'Guild Ranks'  },
  { id: 'item',        icon: '💎',  label: 'Item Frames'  },
];

// ── Rarity colour palette (designer-local) ────────────────────────────────────
const _TS3_RARITY_COLORS = {
  Common: '#cbc3d7', Uncommon: '#4ade80', Rare: '#60a5fa',
  Epic: '#a78bfa', Legendary: '#fbbf24', Mythic: '#f472b6',
};

// ── Designer modal entry point ────────────────────────────────────────────────

/**
 * tsAdminOpenDesigner(titleId) → void  [window.tsAdminOpenDesigner]
 *
 * Opens the 'lg' MMORPG Title Designer modal.
 * titleId: null → create, string → edit existing.
 *
 * Sets window._tsDraft = { ...titleData }  (live draft updated by all ts3* handlers)
 * Sets window._ts3ActiveTemplate = null (tracks which template card is highlighted)
 *
 * Calls ts3Preview() after 80ms to populate live preview targets.
 */
window.tsAdminOpenDesigner = function (titleId) {
  const isEdit   = !!titleId;
  const existing = isEdit ? (AppStore.getSlice(s => s.titles) || []).find(t => t.id === titleId) : null;
  const d        = existing ? JSON.parse(JSON.stringify(existing)) : tsDefaultTitle();
  window._tsDraft              = d;
  window._ts3ActiveTemplate    = null;

  // Phase 21: "assign to section(s)" picker — mirrors ach_admin_page.js's
  // draftAchSections exactly. tsDefaultTitle() already stamps a stable id
  // on brand-new drafts (unlike quiz-builder/achievements which generate
  // the id inline here), so d.id is always safe to key against, whether
  // this is a create or an edit. Only meaningful for standalone
  // (non-achievement-linked) titles — see phase21_title_sections_rpc.sql.
  window._tsDraftSections = ((AppStore.getSlice(s => s.titleSectionAssignments) || {})[d.id] || []).slice();

  const achOpts = (AppStore.getSlice(s => s.achievements) || []).filter(a => a.active)
    .map(a => `<option value="${a.id}"${d.achievementId === a.id ? ' selected' : ''}>${_esc(a.name)} (${a.rarity})</option>`)
    .join('');

  // Phase 21: same sections source as quiz-builder.js/ach_admin_page.js's
  // pickers (getActiveClassIds/getClassLabel from sections-service.js).
  const activeClassIds = (typeof getActiveClassIds === 'function') ? getActiveClassIds() : [];
  const sectionOpts = activeClassIds.map(cid =>
    `<option value="${cid}" ${window._tsDraftSections.includes(cid) ? 'selected' : ''}>${_esc(typeof getClassLabel === 'function' ? getClassLabel(cid) : cid)}</option>`
  ).join('');

  // ── Internal helpers (modal-scoped) ─────────────────────────────────────────
  function shapeMinSVG(shape, color) {
    const c = color || '#8b5cf6';
    const shapes = {
      classic:    `<rect x="2" y="5" width="50" height="14" rx="5" fill="${c}" fill-opacity=".25" stroke="${c}" stroke-width="1.5"/>`,
      rectangle:  `<rect x="2" y="5" width="50" height="14" rx="1" fill="${c}" fill-opacity=".25" stroke="${c}" stroke-width="1.5"/>`,
      capsule:    `<rect x="2" y="5" width="50" height="14" rx="8" fill="${c}" fill-opacity=".25" stroke="${c}" stroke-width="1.5"/>`,
      ribbon:     `<path d="M4 7 H50 Q53 7 53 10 V14 Q53 17 50 17 H4 Q1 17 1 14 V10 Q1 7 4 7 Z" fill="${c}" fill-opacity=".25" stroke="${c}" stroke-width="1.5"/><path d="M4 7 L0 12 L4 17" fill="${c}" fill-opacity=".4" stroke="${c}" stroke-width="1"/><path d="M50 7 L54 12 L50 17" fill="${c}" fill-opacity=".4" stroke="${c}" stroke-width="1"/>`,
      banner:     `<path d="M4 8 H50 Q53 8 53 11 V13 Q53 16 50 16 H4 Q1 16 1 13 V11 Q1 8 4 8 Z" fill="${c}" fill-opacity=".25" stroke="${c}" stroke-width="1.5"/><path d="M4 8 L0 12 L4 16" fill="${c}" fill-opacity=".4" stroke="${c}" stroke-width="1.2"/><path d="M50 8 L54 12 L50 16" fill="${c}" fill-opacity=".4" stroke="${c}" stroke-width="1.2"/>`,
      shield:     `<path d="M4 4 H50 L50 17 C50 24 40 29 28 31 C16 29 4 24 4 17 Z" fill="${c}" fill-opacity=".25" stroke="${c}" stroke-width="1.5"/>`,
      hexagon:    `<polygon points="12,6 42,6 52,12 42,20 12,20 2,12" fill="${c}" fill-opacity=".25" stroke="${c}" stroke-width="1.5"/>`,
      diamond:    `<polygon points="27,4 50,12 27,22 4,12" fill="${c}" fill-opacity=".25" stroke="${c}" stroke-width="1.5"/>`,
      dragon:     `<path d="M2 22 C6 10 12 8 20 10 L22 4 L25 10 C32 6 38 6 44 10 L46 4 L49 10 C54 8 58 12 52 22 L52 26 Q52 28 50 28 H4 Q2 28 2 26 Z" fill="${c}" fill-opacity=".25" stroke="${c}" stroke-width="1.5"/>`,
      flame:      `<path d="M2 26 C3 18 6 12 12 14 C14 6 18 2 22 8 C24 2 28 0 30 6 C32 0 36 2 38 10 C40 2 44 4 46 14 C50 8 52 14 52 22 L52 26 Z" fill="${c}" fill-opacity=".35" stroke="${c}" stroke-width="1.5"/>`,
      ghost:      `<ellipse cx="27" cy="13" rx="24" ry="9" fill="${c}" fill-opacity=".25" stroke="${c}" stroke-width="1.5"/>`,
      crystal:    `<path d="M4 10 L14 4 L40 4 L50 10 L50 22 L4 22 Z" fill="${c}" fill-opacity=".25" stroke="${c}" stroke-width="1.5"/>`,
      poison:     `<path d="M2 14 Q2 6 8 6 C10 2 14 2 16 6 C18 0 22 0 24 6 C26 0 30 2 32 6 C34 0 38 2 40 6 C42 2 48 4 50 10 Q52 14 50 18 L50 22 L4 22 Z" fill="${c}" fill-opacity=".3" stroke="${c}" stroke-width="1.4"/>`,
      royal:      `<path d="M4 10 L10 4 L44 4 L50 10 L50 22 Q50 26 46 26 H8 Q4 26 4 22 Z" fill="${c}" fill-opacity=".25" stroke="${c}" stroke-width="1.5"/>`,
      arcane:     `<path d="M8 6 L46 6 L52 14 L46 22 L8 22 L2 14 Z" fill="${c}" fill-opacity=".25" stroke="${c}" stroke-width="1.5"/>`,
      shadow:     `<path d="M4 10 L10 4 L44 4 L50 10 L50 22 L4 22 Z" fill="${c}" fill-opacity=".25" stroke="${c}" stroke-width="1.5"/>`,
      celestial:  `<path d="M4 10 L27 4 L50 10 L50 22 L4 22 Z" fill="${c}" fill-opacity=".25" stroke="${c}" stroke-width="1.5"/><circle cx="27" cy="4" r="3" fill="${c}" fill-opacity=".6"/>`,
    };
    return `<svg class="ts3-shape-mini" viewBox="0 0 54 28" xmlns="http://www.w3.org/2000/svg">${shapes[shape] || shapes.classic}</svg>`;
  }

  function buildTemplateGallery(filterCat) {
    const templates = filterCat === 'all' ? TS_MMORPG_TEMPLATES : TS_MMORPG_TEMPLATES.filter(t => t.cat === filterCat);
    return templates.map(tmpl => {
      const isSelected = window._ts3ActiveTemplate === tmpl.id;
      return `<div class="ts3-template-card${isSelected ? ' selected' : ''}" onclick="ts3ApplyTemplate('${tmpl.id}')" title="${tmpl.label}">
        <div class="ts3-template-preview">${tsBuildBadgeHTML({ ...tmpl, name: tmpl.label }, { noParticles: true })}</div>
        <div class="ts3-template-label">${tmpl.icon} ${tmpl.label}</div>
      </div>`;
    }).join('');
  }

  function buildShapePicker() {
    return TS_FRAME_SHAPES_REGISTRY.map(s =>
      `<div class="ts3-pick-item${d.frameShape === s.id ? ' selected' : ''}" id="ts3-shape-${s.id}" onclick="ts3PickShape('${s.id}')">
        <div class="ts3-pick-preview">${shapeMinSVG(s.id, d.borderColor || '#8b5cf6')}</div>
        <div class="ts3-pick-label">${s.label}</div>
      </div>`
    ).join('');
  }

  function buildStylePicker() {
    const icons = { none: '□', metal: '🔩', stone: '🪨', crystal: '💎', shadow: '🌑', fire: '🔥', poison: '☠️', arcane: '🔮', royal: '👑', celestial: '⭐' };
    return TS_FRAME_STYLES_REGISTRY.map(s =>
      `<div class="ts3-pick-item${d.frameStyle === s.id ? ' selected' : ''}" id="ts3-style-${s.id}" onclick="ts3PickStyle('${s.id}')">
        <div class="ts3-pick-preview" style="font-size:18px">${icons[s.id] || '·'}</div>
        <div class="ts3-pick-label">${s.label}</div>
      </div>`
    ).join('');
  }

  function buildEffectPicker() {
    return TS_EFFECTS_REGISTRY.map(e =>
      `<div class="ts3-pick-item${d.effect === e.id ? ' selected' : ''}" id="ts3-effect-${e.id}" onclick="ts3PickEffect('${e.id}')">
        <div class="ts3-pick-preview" style="font-size:18px">${({ none:'—', glow:'✨', pulse:'💫', embers:'🔥', smoke:'💨', runes:'ᚦ', lightning:'⚡', stars:'⭐', drips:'💧', particles:'✦' })[e.id] || '?'}</div>
        <div class="ts3-pick-label">${e.label}</div>
      </div>`
    ).join('');
  }

  function buildAnimPicker() {
    const labels = { none: '—', pulse: '💓', 'glow-pulse': '✨', float: '🌊', wave: '〰', 'fire-flicker': '🔥', 'ghost-drift': '👻', shake: '📳', flicker: '💡', burn: '🔥', orbit: '🌀', 'spectral-drift': '🌫', 'rune-rotation': '🔮' };
    return TS_ANIMATIONS_REGISTRY.map(a =>
      `<div class="ts3-pick-item${d.animation === a.id ? ' selected' : ''}" id="ts3-anim-${a.id}" onclick="ts3PickAnim('${a.id}')">
        <div class="ts3-pick-preview" style="font-size:18px">${labels[a.id] || '·'}</div>
        <div class="ts3-pick-label">${a.label}</div>
      </div>`
    ).join('');
  }

  function buildColorSection() {
    const cols = [
      ['Primary Color', 'ts3-c-primary', d.primaryColor || '#d0bcff', 'primaryColor'],
      ['Secondary',     'ts3-c-secondary', d.secondaryColor || '#8b5cf6', 'secondaryColor'],
      ['Accent',        'ts3-c-accent', d.accentColor || '#a78bfa', 'accentColor'],
      ['Border',        'ts3-c-border', d.borderColor || '#8b5cf6', 'borderColor'],
      ['Glow',          'ts3-c-glow', d.glowColor || '#8b5cf6', 'glowColor'],
      ['Text',          'ts3-c-text', d.textColor || '#ffffff', 'textColor'],
      ['Background',    'ts3-c-bg', d.bgColor || '#1a1438', 'bgColor'],
    ];
    return `<div class="ts3-color-grid">${cols.map(([lbl, id, val, prop]) =>
      `<div class="ts3-color-item">
        <label>${lbl}</label>
        <div class="ts3-color-swatch-wrap">
          <div id="${id}-dot" style="width:28px;height:28px;border-radius:7px;background:${val};border:1px solid rgba(255,255,255,.15);flex-shrink:0;cursor:pointer;position:relative;overflow:hidden">
            <input type="color" value="${val}" style="opacity:0;position:absolute;inset:0;cursor:pointer;width:100%;height:100%" oninput="ts3SetColor('${prop}','${id}',this.value)">
          </div>
          <input id="${id}-input" type="text" value="${val}" style="flex:1;font-family:monospace;font-size:11px;padding:4px 8px;background:rgba(255,255,255,.05);border:1px solid var(--border2);border-radius:7px;color:var(--on-surface)" oninput="ts3SetColor('${prop}','${id}',this.value)">
        </div>
      </div>`).join('')}</div>`;
  }

  const rarityBar = Object.keys(_TS3_RARITY_COLORS).map(r => {
    const col    = _TS3_RARITY_COLORS[r];
    const active = d.rarity === r;
    return `<button id="ts3-rarity-${r}" class="ts3-rarity-btn${active ? ' active' : ''}"
      style="border:1px solid ${active ? col + '55' : 'rgba(255,255,255,.1)'};background:${active ? col + '22' : 'rgba(255,255,255,.04)'};color:${active ? col : 'var(--text-muted)'}"
      onclick="ts3SetRarity('${r}')">${r}</button>`;
  }).join('');

  showModal(`
  <div class="ts3-modal">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,rgba(208,188,255,.2),rgba(255,185,95,.15));border:1px solid rgba(208,188,255,.25);display:flex;align-items:center;justify-content:center;font-size:24px">🎨</div>
      <div>
        <div class="modal-h2" style="margin-bottom:2px">${isEdit ? 'Edit Title Plate' : 'MMORPG Title Designer'}</div>
        <div style="font-size:11px;color:var(--text-muted)">Nameplates · Achievements · Guild Ranks · Item Frames</div>
      </div>
    </div>

    <div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:14px;margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--on-surface)">⚔️ Template Library</div>
        <div style="font-size:10px;color:var(--text-muted)">Pick a starting point, then customize</div>
      </div>
      <div class="ts3-gallery-tabs" id="ts3-gallery-tabs">
        ${TS_TEMPLATE_CATS.map((cat, i) => `<button class="ts3-gallery-tab${i === 0 ? ' active' : ''}" id="ts3-cat-${cat.id}" onclick="ts3FilterGallery('${cat.id}')">${cat.icon} ${cat.label}</button>`).join('')}
      </div>
      <div class="ts3-template-grid" id="ts3-template-grid">${buildTemplateGallery('all')}</div>
    </div>

    <div class="ts3-layout">
      <div>
        <div class="ts3-tabs" id="ts3-tabs">
          <button class="ts3-tab active" onclick="ts3Tab(this,'ts3-p-basic')">📝 Basic</button>
          <button class="ts3-tab" onclick="ts3Tab(this,'ts3-p-shape')">⬡ Frame</button>
          <button class="ts3-tab" onclick="ts3Tab(this,'ts3-p-colors')">🎨 Colors</button>
          <button class="ts3-tab" onclick="ts3Tab(this,'ts3-p-fx')">✨ FX</button>
        </div>

        <div id="ts3-p-basic" class="ts3-tab-panel active">
          <div style="margin-bottom:12px"><label class="form-label">Title Name *</label>
            <input type="text" id="ts3-name" placeholder="e.g. Dragon Emperor" value="${_esc(d.name || '')}" style="width:100%" oninput="window._tsDraft.name=this.value;ts3Preview()">
          </div>
          <div style="display:grid;grid-template-columns:80px 1fr;gap:10px;margin-bottom:12px">
            <div><label class="form-label">Icon</label><input type="text" id="ts3-icon" value="${_esc(d.icon || '🏆')}" style="width:100%;font-size:20px;text-align:center" oninput="window._tsDraft.icon=this.value;ts3Preview()"></div>
            <div><label class="form-label">Description</label><input type="text" id="ts3-desc" placeholder="How it's earned" value="${_esc(d.description || '')}" style="width:100%" oninput="window._tsDraft.description=this.value"></div>
          </div>
          <div style="margin-bottom:12px"><label class="form-label">Rarity</label><div class="ts3-rarity-bar" id="ts3-rarity-bar">${rarityBar}</div></div>
          <div class="form-group">
            <label class="form-label">Unlock via Achievement</label>
            <select id="ts3-ach" style="width:100%" onchange="window._tsDraft.achievementId=this.value||null">
              <option value="">— Manual grant only —</option>${achOpts}
            </select>
            <div style="font-size:10px;color:var(--text-muted);margin-top:4px">Auto-unlocks when achievement is earned</div>
          </div>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;padding:8px">
            <input type="checkbox" id="ts3-active" ${d.active !== false ? 'checked' : ''} onchange="window._tsDraft.active=this.checked" style="width:16px;height:16px"> Active
          </label>
          <div class="form-group">
            <label class="form-label">Assign to Section(s)</label>
            ${activeClassIds.length ? `
            <select id="ts3-sections" multiple style="width:100%;height:96px" onchange="ts3UpdateDraftSections(this)">${sectionOpts}</select>
            <div style="font-size:10px;color:var(--text-muted);margin-top:4px">Hold Ctrl/Cmd to select multiple. Leave empty to leave unassigned (visible to all). Only applies to standalone titles — a title unlocked via a linked achievement already follows that achievement's own section scoping.</div>
            ` : `
            <div style="font-size:12px;color:var(--text-muted);background:rgba(35,31,56,.5);border-radius:8px;padding:10px 12px">No sections created yet — create one in Section Maker first.</div>
            `}
          </div>
        </div>

        <div id="ts3-p-shape" class="ts3-tab-panel">
          <div style="margin-bottom:14px"><label class="form-label">Frame Shape</label>
            <div class="ts3-pick-grid" id="ts3-shape-grid">${buildShapePicker()}</div>
          </div>
          <div><label class="form-label">Frame Style</label>
            <div class="ts3-pick-grid" id="ts3-style-grid">${buildStylePicker()}</div>
          </div>
        </div>

        <div id="ts3-p-colors" class="ts3-tab-panel">
          <div style="margin-bottom:12px">${buildColorSection()}</div>
          <button class="btn btn-ghost btn-sm" onclick="tsApplyRarityDefaults()">↺ Reset to Rarity Defaults</button>
        </div>

        <div id="ts3-p-fx" class="ts3-tab-panel">
          <div style="margin-bottom:14px"><label class="form-label">Visual Effect</label>
            <div class="ts3-pick-grid ts3-pick-grid-sm" id="ts3-effect-grid">${buildEffectPicker()}</div>
          </div>
          <div><label class="form-label">Animation</label>
            <div class="ts3-pick-grid ts3-pick-grid-sm" id="ts3-anim-grid">${buildAnimPicker()}</div>
          </div>
        </div>
      </div>

      <div class="ts3-preview-pane">
        <div class="ts3-preview-label">⚡ Live Preview</div>
        <div class="ts3-preview-stage" id="ts3-preview-stage">
          <div class="ts3-preview-player">PlayerName</div>
          <div id="ts3-preview-badge"></div>
        </div>
        <div style="margin-top:10px"><div style="font-size:9px;color:rgba(255,255,255,.3);margin-bottom:6px;text-align:center;letter-spacing:.08em;text-transform:uppercase">Leaderboard context</div>
          <div style="background:rgba(35,31,56,.9);border:1px solid var(--border);border-radius:10px;padding:10px 12px;display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <div style="font-family:var(--fm);font-size:11px;font-weight:900;color:var(--tertiary);width:20px">1</div>
            <div style="width:26px;height:26px;border-radius:7px;background:rgba(139,92,246,.3);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:var(--primary)">A</div>
            <div style="flex:1"><div style="font-size:12px;font-weight:800;color:var(--on-surface);margin-bottom:2px">StudentName</div><div id="ts3-preview-sm"></div></div>
            <div style="font-family:var(--fh);font-size:13px;font-weight:900;color:var(--primary)">12,400 XP</div>
          </div>
          <div style="font-size:9px;color:rgba(255,255,255,.3);margin-bottom:6px;text-align:center;letter-spacing:.08em;text-transform:uppercase">Profile context</div>
          <div style="background:rgba(35,31,56,.9);border:1px solid var(--border);border-radius:10px;padding:10px 12px;display:flex;align-items:center;gap:10px">
            <div style="width:30px;height:30px;border-radius:8px;background:rgba(139,92,246,.3);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;color:var(--primary)">A</div>
            <div><div style="font-size:11px;font-weight:800;color:var(--on-surface);margin-bottom:2px">PlayerName</div><div style="transform:scale(.48);transform-origin:left center"><div id="ts3-preview-xs"></div></div></div>
          </div>
        </div>
        <div style="margin-top:10px"><div style="font-size:9px;color:rgba(255,255,255,.3);margin-bottom:6px;text-align:center;letter-spacing:.08em;text-transform:uppercase">Quick Rarity</div>
          <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center">
            ${Object.entries(_TS3_RARITY_COLORS).map(([r, col]) =>
              `<button style="padding:4px 8px;border-radius:7px;font-size:9px;font-weight:800;cursor:pointer;border:1px solid ${col}44;background:${col}18;color:${col}" onclick="ts3SetRarity('${r}')">${r}</button>`
            ).join('')}
          </div>
        </div>
      </div>
    </div>

    <div id="ts3-form-err" style="color:#ff8080;font-size:12px;margin-top:12px;display:none"></div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" style="flex:1" onclick="tsAdminSave('${titleId || ''}')">${isEdit ? '💾 Save Changes' : '✦ Create Title'}</button>
    </div>
  </div>`, 'lg');

  setTimeout(() => ts3Preview(), 80);
};

// ── Designer interaction handlers ─────────────────────────────────────────────

window.ts3UpdateDraftSections = function (selectEl) {
  window._tsDraftSections = [...selectEl.selectedOptions].map(o => o.value);
};

window.ts3Tab = function (btn, panelId) {
  const tabs = btn.closest('.ts3-tabs');
  if (!tabs) return;
  tabs.querySelectorAll('.ts3-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const container = document.getElementById('modal-content') || document.querySelector('.modal-body') || document;
  container.querySelectorAll('.ts3-tab-panel').forEach(p => p.classList.remove('active'));
  const panel = container.querySelector('#' + panelId);
  if (panel) panel.classList.add('active');
};

window.ts3FilterGallery = function (catId) {
  document.querySelectorAll('.ts3-gallery-tab').forEach(b => b.classList.toggle('active', b.id === 'ts3-cat-' + catId));
  const grid = document.getElementById('ts3-template-grid');
  if (!grid) return;
  const templates = catId === 'all' ? TS_MMORPG_TEMPLATES : TS_MMORPG_TEMPLATES.filter(t => t.cat === catId);
  grid.innerHTML = templates.map(tmpl => {
    const isSelected = window._ts3ActiveTemplate === tmpl.id;
    return `<div class="ts3-template-card${isSelected ? ' selected' : ''}" onclick="ts3ApplyTemplate('${tmpl.id}')" title="${tmpl.label}">
      <div class="ts3-template-preview">${tsBuildBadgeHTML({ ...tmpl, name: tmpl.label }, { noParticles: true })}</div>
      <div class="ts3-template-label">${tmpl.icon} ${tmpl.label}</div>
    </div>`;
  }).join('');
};

window.ts3ApplyTemplate = function (templateId) {
  const tmpl = TS_MMORPG_TEMPLATES.find(t => t.id === templateId);
  if (!tmpl || !window._tsDraft) return;
  window._ts3ActiveTemplate = templateId;
  const keep = {
    name: window._tsDraft.name, description: window._tsDraft.description,
    achievementId: window._tsDraft.achievementId, active: window._tsDraft.active,
    id: window._tsDraft.id, createdAt: window._tsDraft.createdAt,
  };
  Object.assign(window._tsDraft, tmpl, keep);
  ts3RefreshAllPickers();
  ts3Preview();
  document.querySelectorAll('.ts3-template-card').forEach(c => {
    c.classList.toggle('selected', c.getAttribute('onclick') === `ts3ApplyTemplate('${templateId}')`);
  });
  toast(`🎨 Template "${tmpl.label}" applied!`, '#a78bfa');
};

window.ts3RefreshAllPickers = function () {
  const d = window._tsDraft;
  if (!d) return;
  document.querySelectorAll('[id^="ts3-shape-"]').forEach(el => el.classList.toggle('selected', d.frameShape === el.id.replace('ts3-shape-', '')));
  document.querySelectorAll('[id^="ts3-style-"]').forEach(el => el.classList.toggle('selected', d.frameStyle === el.id.replace('ts3-style-', '')));
  document.querySelectorAll('[id^="ts3-effect-"]').forEach(el => el.classList.toggle('selected', d.effect === el.id.replace('ts3-effect-', '')));
  document.querySelectorAll('[id^="ts3-anim-"]').forEach(el => el.classList.toggle('selected', d.animation === el.id.replace('ts3-anim-', '')));
  document.querySelectorAll('[id^="ts3-rarity-"]').forEach(btn => {
    const r = btn.id.replace('ts3-rarity-', '');
    const col = _TS3_RARITY_COLORS[r] || '#ccc';
    const active = d.rarity === r;
    btn.style.background   = active ? col + '22' : '';
    btn.style.color        = active ? col : '';
    btn.style.borderColor  = active ? col + '55' : '';
  });
  ['primary','secondary','accent','border','glow','text'].forEach(f => {
    const val = d[f + 'Color'] || '#8b5cf6';
    const dot = document.getElementById(`ts3-c-${f}-dot`);
    const inp = document.getElementById(`ts3-c-${f}-input`);
    if (dot) dot.style.background = val;
    if (inp) inp.value = val;
  });
};

window.ts3PickShape  = function (id) { if (!window._tsDraft) return; window._tsDraft.frameShape = id; document.querySelectorAll('[id^="ts3-shape-"]').forEach(el => el.classList.toggle('selected', el.id === 'ts3-shape-' + id)); ts3Preview(); };
window.ts3PickStyle  = function (id) { if (!window._tsDraft) return; window._tsDraft.frameStyle = id; document.querySelectorAll('[id^="ts3-style-"]').forEach(el => el.classList.toggle('selected', el.id === 'ts3-style-' + id)); ts3Preview(); };
window.ts3PickEffect = function (id) { if (!window._tsDraft) return; window._tsDraft.effect = id; document.querySelectorAll('[id^="ts3-effect-"]').forEach(el => el.classList.toggle('selected', el.id === 'ts3-effect-' + id)); ts3Preview(); };
window.ts3PickAnim   = function (id) { if (!window._tsDraft) return; window._tsDraft.animation = id; document.querySelectorAll('[id^="ts3-anim-"]').forEach(el => el.classList.toggle('selected', el.id === 'ts3-anim-' + id)); ts3Preview(); };

window.ts3SetColor = function (field, pickerId, value) {
  if (!window._tsDraft) return;
  window._tsDraft[field] = value;
  const dot = document.getElementById(pickerId + '-dot');
  if (dot) dot.style.background = value;
  if (field === 'primaryColor')   window._tsDraft.gradientFrom = value;
  if (field === 'secondaryColor') window._tsDraft.gradientTo   = value;
  ts3Preview();
};

window.ts3SetRarity = function (rarity) {
  if (!window._tsDraft) return;
  window._tsDraft.rarity = rarity;
  document.querySelectorAll('[id^="ts3-rarity-"]').forEach(btn => {
    const r    = btn.id.replace('ts3-rarity-', '');
    const col  = _TS3_RARITY_COLORS[r] || '#ccc';
    const active = r === rarity;
    btn.style.background  = active ? col + '22' : '';
    btn.style.color       = active ? col : '';
    btn.style.borderColor = active ? col + '55' : '';
  });
  ts3Preview();
};

window.ts3Preview = function () {
  const d = window._tsDraft;
  if (!d) return;
  const pv = document.getElementById('ts3-preview-badge');
  if (pv) pv.innerHTML = tsBuildBadgeHTML(d);
  const pvSm = document.getElementById('ts3-preview-sm');
  if (pvSm) pvSm.innerHTML = tsBuildBadgeHTML(d, { small: true, noParticles: true });
  const pvXs = document.getElementById('ts3-preview-xs');
  if (pvXs) pvXs.innerHTML = tsBuildBadgeHTML(d, { xs: true, noParticles: true });
  const stage = document.getElementById('ts3-preview-stage');
  if (stage) stage.style.background = d.previewBg || 'linear-gradient(135deg,#0d0a1f,#1a1038)';
};

// Backwards-compat shims
window.tsLivePreview      = function () { ts3Preview(); };
window.tsUpdateRarityInfo = function () {};

window.tsApplyRarityDefaults = function () {
  const d = window._tsDraft;
  if (!d) return;
  const presets = {
    Common:    { glowColor: '#cbc3d7', borderColor: '#cbc3d7', textColor: '#e5e2ea' },
    Uncommon:  { glowColor: '#4ade80', borderColor: '#22c55e', textColor: '#d1fae5' },
    Rare:      { glowColor: '#93c5fd', borderColor: '#60a5fa', textColor: '#bfdbfe' },
    Epic:      { glowColor: '#d0bcff', borderColor: '#a78bfa', textColor: '#ede9fe' },
    Legendary: { glowColor: '#ffb95f', borderColor: '#f59e0b', textColor: '#fde68a' },
    Mythic:    { glowColor: '#f472b6', borderColor: '#ec4899', textColor: '#fbcfe8' },
  };
  const p = presets[d.rarity] || presets.Common;
  Object.assign(d, p);
  Object.entries(p).forEach(([k, v]) => {
    const key = k.replace('Color', '').toLowerCase();
    const inp = document.getElementById(`ts3-c-${key}-input`);
    const dot = document.getElementById(`ts3-c-${key}-dot`);
    if (inp) inp.value = v;
    if (dot) dot.style.background = v;
  });
  ts3Preview();
  toast('↺ Rarity defaults applied.', '#d0bcff');
};

window.tsPreset = function (rarity) {
  if (!window._tsDraft) return;
  window._tsDraft.rarity = rarity;
  const s = document.getElementById('ts-f-rarity');
  if (s) s.value = rarity;
  tsApplyRarityDefaults();
};

// ── Save ──────────────────────────────────────────────────────────────────────

window.tsAdminSave = async function (titleId) {
  const d = window._tsDraft;
  if (!d) { toast('❌ Draft lost.', '#ff8080'); return; }
  const name  = (d.name || '').trim();
  const errEl = document.getElementById('ts3-form-err') || document.getElementById('ts-form-err');
  if (!name) {
    if (errEl) { errEl.textContent = 'Title name is required.'; errEl.style.display = 'block'; }
    else toast('❌ Title name is required.', '#ff8080');
    return;
  }
  if (errEl) errEl.style.display = 'none';

  // Sanitize achievementId
  if (d.achievementId && !(AppStore.getSlice(s => s.achievements) || []).some(a => a.id === d.achievementId)) d.achievementId = null;

  AppStore.updateState(draft => {
    if (!Array.isArray(draft.titles)) draft.titles = [];
    if (titleId) {
      const idx = draft.titles.findIndex(t => t.id === titleId);
      if (idx >= 0) draft.titles[idx] = { ...draft.titles[idx], ...d, id: titleId };
      else { d.id = titleId; draft.titles.push(d); }
    } else {
      // Phase 21: d.id was already stamped by tsDefaultTitle() when the
      // designer opened — kept stable here (not regenerated) so the section
      // picker's assignment below persists against the same id the title
      // itself is saved under. Previously this line called uid() again,
      // silently discarding the id the section picker had been keying
      // against the whole time it was open.
      // Phase 32: stamp the owner here too — tsDefaultTitle() doesn't know
      // who's creating it, this is the first point currentUser is in scope
      // for a genuinely new title.
      d.createdAt = new Date().toISOString();
      d.ownerTeacherId = d.ownerTeacherId || currentUser.id;
      draft.titles.push(d);
    }
  }, { type: titleId ? 'titles:title-updated' : 'titles:title-created', payload: { id: d.id } });

  toast(titleId ? `✅ Title "${name}" updated!` : `👑 Title "${name}" created!`);
  closeModalForce();
  const savedId     = d.id;
  const sectionIds  = (window._tsDraftSections || []).slice();
  renderAdminTitles();

  // Phase 21: persist the section assignment — set_title_sections() only
  // ever touches title_sections rows for THIS title_id, and only ones the
  // caller could have created themselves, so two teachers assigning the
  // same shared title to their own different sections can never stomp on
  // each other (see phase21_title_sections_rpc.sql). Fire-and-forget like
  // the quiz/achievement section-assignment calls — the title itself
  // already saved locally, this just syncs who can see it.
  if (typeof DBService !== 'undefined' && typeof DBService.rpc === 'function') {
    const { error } = await DBService.rpc('set_title_sections', { p_title_id: savedId, p_class_ids: sectionIds });
    if (error) {
      toast('⚠️ Title saved, but section assignment may not have synced: ' + error.message, '#ffb95f');
    } else {
      // [Phase 3 migration bugfix] The pre-migration version mutated
      // DB.titleSectionAssignments directly here with no follow-up
      // saveDB() call — memory-only, so the next time anything reloaded
      // from persisted storage (a fresh page load, or any other module
      // calling loadDB()), this specific assignment would silently vanish.
      // Same bug shape as campaign_admin_map_editor.js's
      // adminSaveEditWorld() and mail's admin-compose.js — see those
      // entries in this log. AppStore.updateState() always persists.
      AppStore.updateState(draft => {
        if (!draft.titleSectionAssignments) draft.titleSectionAssignments = {};
        draft.titleSectionAssignments[savedId] = sectionIds; // optimistic — next realtime pull confirms it
      }, { type: 'titles:sections-set', payload: { id: savedId, sectionIds } });
    }
  }
};

console.log('[EduQuest] titles/designer.js loaded — tsAdminOpenDesigner, ts3* handlers, tsAdminSave registered.');
