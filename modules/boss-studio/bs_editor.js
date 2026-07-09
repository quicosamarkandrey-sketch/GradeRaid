// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/boss-studio/editor.js
//  Full-screen Boss Profile Editor overlay — open/close, form rendering,
//  live preview sync, tool tabs, artwork upload/drag-drop, palette, save.
//  LOAD AFTER: storage.js, library.js
// ═══════════════════════════════════════════════════════════════════════════════

// ── Module state ──────────────────────────────────────────────────────────────
let _bsDirtyFlag = false;
let _bsToolTab   = 'identity'; // 'identity' | 'artwork' | 'animations' | 'theme'

// expose via closure bridge (library.js sets _bsDirty via window._bsDraft proxy)
Object.defineProperty(window, '_bsDirty', {
  get () { return _bsDirtyFlag; },
  set (v) { _bsDirtyFlag = v; },
  configurable: true,
});

// ── Colour utility ────────────────────────────────────────────────────────────

function _hexToRgba(hex, alpha) {
  const h = (hex || '#8b5cf6').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
window._hexToRgba = _hexToRgba;

// ── Open / close overlay ──────────────────────────────────────────────────────

window.bsOpenCreate = function () {
  window._bsDraft = bsvpBlank();
  _bsDirtyFlag    = false;
  _bsOpenEditorOverlay(false);
};

window.bsOpenEdit = function (id) {
  const boss = bsGet(id);
  if (!boss) { toast('❌ Boss not found', '#ffb4ab'); return; }
  window._bsDraft = JSON.parse(JSON.stringify(boss));
  _bsDirtyFlag    = false;
  _bsOpenEditorOverlay(true);
};

function _bsOpenEditorOverlay(isEdit) {
  const overlay = document.getElementById('bs-editor-overlay');
  if (!overlay) return;
  _bsUpdateEditorTitle(isEdit);
  _bsRenderFormModal(isEdit);
  window._bsSyncEditorPreview();
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function _bsUpdateEditorTitle(isEdit) {
  const titleEl  = document.getElementById('bs-eo-title');
  const dirtyDot = document.getElementById('bs-dirty-dot');
  const d        = window._bsDraft;
  if (!titleEl || !d) return;
  if (isEdit === undefined) isEdit = !!bsGet(d.id);
  const base = isEdit ? `Editing: ${d.name || 'Boss Profile'}` : 'New Boss Profile';
  titleEl.textContent = _bsDirtyFlag ? `${base} •` : base;
  titleEl.title       = _bsDirtyFlag ? 'Unsaved changes' : '';
  if (dirtyDot) dirtyDot.classList.toggle('visible', !!_bsDirtyFlag);
}

window._bsMarkDirty = function () {
  if (_bsDirtyFlag) return;
  _bsDirtyFlag = true;
  _bsUpdateEditorTitle();
};

window._bsCloseEditor = function () {
  if (_bsDirtyFlag) {
    showModal(`<div style="text-align:center;padding:8px 0">
      <div style="font-size:48px;margin-bottom:12px">⚠️</div>
      <div class="modal-h2" style="margin-bottom:8px">Discard Unsaved Changes?</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:24px">You have unsaved changes. Closing now will discard them.</div>
      <div style="display:flex;gap:10px">
        <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Keep Editing</button>
        <button class="btn btn-danger" style="flex:1;font-family:var(--fh);font-weight:800" onclick="closeModalForce();window._bsForceCloseEditor()">Discard Changes</button>
      </div>
    </div>`, 'sm');
    return;
  }
  window._bsForceCloseEditor();
};

window._bsForceCloseEditor = function () {
  const overlay = document.getElementById('bs-editor-overlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
  window._bsDraft = null;
  _bsDirtyFlag    = false;
};

// ── Live preview sync ─────────────────────────────────────────────────────────

window._bsSyncEditorPreview = function () {
  const d = window._bsDraft; if (!d) return;
  const stageArt = document.getElementById('bsed-stage-art');
  if (stageArt) {
    if (d.artwork?.value) {
      stageArt.innerHTML = d.artwork.type === 'emoji'
        ? `<span style="font-size:88px">${_esc(d.artwork.value)}</span>`
        : `<img src="${_esc(d.artwork.value)}" style="max-width:80%;max-height:80%;object-fit:contain" onerror="this.outerHTML='<span style=\\'font-size:40px\\'>💀</span>'">`;
    } else {
      stageArt.innerHTML = `<span style="font-size:88px">💀</span>`;
    }
  }
  const theme  = d.visual?.themeColor || BS_DEFAULT_THEME;
  const aura   = d.visual?.auraColor  || BS_DEFAULT_AURA;
  const accent = d.visual?.cardAccent || BS_DEFAULT_ACCENT;
  const stage  = document.getElementById('bsed-main-stage');
  if (stage)  stage.style.setProperty('--bs-stage-glow', _hexToRgba(theme, 0.3));
  const hpFill = document.getElementById('bsed-hp-fill');
  if (hpFill) { hpFill.style.setProperty('--bs-hp-color', aura); hpFill.style.setProperty('--bs-hp-color2', theme); }
  const np = document.getElementById('bsed-nameplate');
  if (np) np.textContent = d.name || 'New Boss';
  ['idle', 'cast', 'hit', 'rage'].forEach(k => {
    const pip = document.getElementById(`bsed-pip-${k}`);
    if (pip) pip.classList.toggle('filled', !!(d.animations?.[k]));
    const btn = document.getElementById(`bsed-btn-${k}`);
    if (btn) { const assigned = d.animations?.[k] && typeof window._alGet === 'function' && window._alGet(d.animations[k]); btn.disabled = !assigned; btn.style.opacity = assigned ? '1' : '0.5'; if (!assigned) btn.classList.remove('active'); }
  });
  const tagDiv = document.getElementById('bsed-tag-preview');
  if (tagDiv) tagDiv.innerHTML = (d.tags || []).slice(0, 5).map(t => `<span class="bs-card-tag" style="border-color:${theme}55;color:${theme}">${_esc(t)}</span>`).join('');
  const setTS = (id, valId, val) => { const s = document.getElementById(id); if (s) s.style.background = val; const v = document.getElementById(valId); if (v) v.textContent = val; };
  setTS('bsed-ts-theme', 'bsed-ts-theme-val', theme);
  setTS('bsed-ts-aura',  'bsed-ts-aura-val',  aura);
  setTS('bsed-ts-accent','bsed-ts-accent-val', accent);
  _bsUpdateEditorTitle();
  _bsUpdateReadiness();
};

window._bsEditorPlayState = function (stateKey) {
  const d = window._bsDraft; if (!d) return;
  const animId = d.animations?.[stateKey];
  const preset = animId && typeof window._alGet === 'function' ? window._alGet(animId) : null;
  if (!preset) { const btn = document.getElementById(`bsed-btn-${stateKey}`); if (btn) { btn.style.transform = 'scale(0.9)'; setTimeout(() => btn.style.transform = '', 150); } return; }
  const art = document.getElementById('bsed-stage-art'); if (!art) return;
  const useArt = (stateKey === 'rage' && d.rageArtwork?.value) ? d.rageArtwork : d.artwork;
  if (useArt?.value) art.innerHTML = useArt.type === 'emoji' ? `<span style="font-size:88px">${_esc(useArt.value)}</span>` : `<img src="${_esc(useArt.value)}" style="max-width:80%;max-height:80%;object-fit:contain">`;
  const stageWrap = document.getElementById('bsed-main-stage');
  if (stageWrap) stageWrap.style.setProperty('--bs-stage-glow', stateKey === 'rage' ? 'rgba(236,72,153,0.4)' : _hexToRgba(d.visual?.themeColor || BS_DEFAULT_THEME, 0.3));
  art.className = 'bsed-stage-art ' + (preset.cssClass || '');
  setTimeout(() => { if (art) art.className = 'bsed-stage-art'; }, 2000);
  ['idle', 'cast', 'hit', 'rage'].forEach(k => { const btn = document.getElementById(`bsed-btn-${k}`); if (btn) btn.classList.toggle('active', k === stateKey); });
};

// ── Tool tab switching ────────────────────────────────────────────────────────

window._bsSetToolTab = function (tab) {
  _bsToolTab = tab;
  document.querySelectorAll('.bs-tool-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  document.querySelectorAll('.bsf-tool-panel').forEach(panel => { panel.style.display = panel.dataset.panel === tab ? '' : 'none'; });
};

// ── Slot stage renderers ──────────────────────────────────────────────────────
// RESTORED: _bsSlotStageArt was missing entirely (its only job is rendering the
// small static glyph inside each animation slot's mini preview stage).

/** Render the small static glyph used inside a slot preview stage, using the
 *  boss's currently-configured primary artwork (or rage artwork for the rage slot). */
function _bsSlotStageArt(key){
  const d = window._bsDraft || {};
  const art = (key==='rage' && d.rageArtwork && d.rageArtwork.value) ? d.rageArtwork : d.artwork;
  if(!art || !art.value){
    return `<span class="material-symbols-outlined" style="font-size:20px;color:rgba(255,255,255,0.2)">image_not_supported</span>`;
  }
  if(art.type==='emoji'){
    return _esc(art.value);
  }
  return `<img src="${_esc(art.value)}" onerror="this.style.display='none'">`;
}
window._bsSlotStageArt = _bsSlotStageArt;

/** Refresh all four animation-slot mini stages (used when boss artwork changes). */
window._bsRefreshAllSlotStages = function(){
  ['idle','cast','hit','rage'].forEach(key=>window._bsRefreshSlotStage(key));
};

/** Refresh a single animation slot's mini preview stage. If `forceStatic` is
 *  true (used on initial form render), the animation is not played — the
 *  stage simply shows the artwork at rest. */
window._bsRefreshSlotStage = function(key, forceStatic){
  const d = window._bsDraft; if(!d) return;
  const stage = document.getElementById(`bsf-anim-stage-${key}`);
  const btn   = document.getElementById(`bsf-anim-preview-${key}`);
  if(!stage) return;
  const animId = d.animations ? d.animations[key] : null;
  const anim    = animId && typeof window._alGet === 'function' ? window._alGet(animId) : null;
  const cls     = (!forceStatic && anim) ? (anim.cssClass||'') : '';
  stage.innerHTML = `<div class="bs-anim-stage-art ${cls}">${_bsSlotStageArt(key)}</div>`;
  if(btn){
    btn.disabled = !animId;
    if(forceStatic || !btn.dataset.playing) btn.dataset.playing = '';
    btn.innerHTML = `<span class="material-symbols-outlined">play_arrow</span>Preview`;
  }
};

/** Toggle play/pause of a slot's assigned animation preview. */
window._bsToggleSlotPreview = function(key){
  const d = window._bsDraft; if(!d) return;
  const stage = document.getElementById(`bsf-anim-stage-${key}`);
  const btn   = document.getElementById(`bsf-anim-preview-${key}`);
  if(!stage || !btn) return;
  const animId = d.animations ? d.animations[key] : null;
  if(!animId) return;
  const anim = typeof window._alGet === 'function' ? window._alGet(animId) : null;
  const art  = stage.querySelector('.bs-anim-stage-art');
  if(!art) return;
  const playing = btn.dataset.playing === '1';
  if(playing){
    art.className = 'bs-anim-stage-art';
    btn.dataset.playing = '';
    btn.innerHTML = `<span class="material-symbols-outlined">play_arrow</span>Preview`;
  } else {
    art.className = 'bs-anim-stage-art ' + ((anim&&anim.cssClass)||'');
    btn.dataset.playing = '1';
    btn.innerHTML = `<span class="material-symbols-outlined">pause</span>Pause`;
  }
};

// ── Artwork tab ───────────────────────────────────────────────────────────────
// RESTORED: the original toggles persistent show/hide wrapper divs
// (#bsf-${which}-emoji-wrap / -url-wrap / -upload-wrap) that are rendered once
// by _bsRenderFormModal, rather than rebuilding innerHTML from scratch on every
// tab switch. This preserves user-entered values across tab switches without
// re-render flicker, and is required for the CSS in boss-studio.css (.bsf-*
// classes already present in the stylesheet) to apply correctly.

const BS_EMOJI_PRESETS = ['💀','👾','🐉','👹','🧙','🦹','🤖','👺','🧿','🌑','🔱','👁️','🌋','⚡','🦴','🧨','🔥','💜','🫀','🧠'];
window.BS_EMOJI_PRESETS = BS_EMOJI_PRESETS;

window._bsArtTab = function(which, type){
  const d = window._bsDraft; if(!d) return;
  const emojiWrap  = document.getElementById(`bsf-${which}-emoji-wrap`);
  const urlWrap    = document.getElementById(`bsf-${which}-url-wrap`);
  const uploadWrap = document.getElementById(`bsf-${which}-upload-wrap`);
  const btnEmoji   = document.getElementById(`bsf-${which}-tab-emoji`);
  const btnUrl     = document.getElementById(`bsf-${which}-tab-url`);
  const btnUpload  = document.getElementById(`bsf-${which}-tab-upload`);
  if(!emojiWrap||!urlWrap) return;

  if(emojiWrap)  emojiWrap.style.display  = type==='emoji'  ?'block':'none';
  if(urlWrap)    urlWrap.style.display    = type==='url'    ?'block':'none';
  if(uploadWrap) uploadWrap.style.display = type==='upload' ?'block':'none';

  btnEmoji &&(btnEmoji.className ='bs-filter-btn'+(type==='emoji' ?' active':''));
  btnUrl   &&(btnUrl.className   ='bs-filter-btn'+(type==='url'   ?' active':''));
  btnUpload&&(btnUpload.className='bs-filter-btn'+(type==='upload'?' active':''));

  // Update preview bg for transparent support
  const prevId = which==='primary'?'bsf-art-preview':'bsf-rage-preview';
  const prev = document.getElementById(prevId);
  if(prev){
    if(type==='upload') prev.classList.add('transparent-bg');
    else prev.classList.remove('transparent-bg');
  }

  // sync draft — keep existing value when switching tabs so user doesn't lose data
  if(which==='primary'){
    const curVal = type==='emoji'
      ? (document.getElementById('bsf-art-emoji')?.value||'💀')
      : type==='url'
        ? (document.getElementById('bsf-art-url')?.value||'')
        : (d.artwork&&d.artwork.type==='upload'?d.artwork.value:'');
    d.artwork = { type, value: curVal };
    if(type==='emoji'){
      const emoji = document.getElementById('bsf-art-emoji')?.value||'💀';
      if(prev) prev.innerHTML=`<span id="bsf-art-preview-emoji">${emoji}</span>`;
    } else if(type==='url'){
      const url = document.getElementById('bsf-art-url')?.value||'';
      window._bsUpdatePreviewImg('primary', url);
    } else {
      window._bsRefreshAllSlotStages();
      window._bsSyncEditorPreview();
    }
  } else {
    const curVal = type==='emoji'
      ? (document.getElementById('bsf-rage-emoji')?.value||null)
      : type==='url'
        ? (document.getElementById('bsf-rage-url')?.value||null)
        : (d.rageArtwork&&d.rageArtwork.type==='upload'?d.rageArtwork.value:null);
    d.rageArtwork = { type, value: curVal };
    if(type==='emoji'){
      const emoji = document.getElementById('bsf-rage-emoji')?.value||'';
      if(prev) prev.innerHTML = emoji
        ? `<span>${emoji}</span>`
        : `<span class="material-symbols-outlined" style="font-size:24px;color:rgba(255,255,255,0.15)">add_photo_alternate</span>`;
    } else if(type==='url'){
      const url = document.getElementById('bsf-rage-url')?.value||'';
      window._bsUpdatePreviewImg('rage', url);
    } else {
      window._bsRefreshAllSlotStages();
      window._bsSyncEditorPreview();
    }
  }
  window._bsMarkDirty();
  window._bsSyncEditorPreview();
};

window._bsPickEmoji = function(which, emoji){
  const d = window._bsDraft; if(!d) return;
  if(which==='primary'){
    d.artwork = { type:'emoji', value:emoji };
    const inp = document.getElementById('bsf-art-emoji');
    if(inp) inp.value = emoji;
    const prev = document.getElementById('bsf-art-preview');
    if(prev) prev.innerHTML = `<span id="bsf-art-preview-emoji">${emoji}</span>`;
    // update selected state on emoji buttons
    document.querySelectorAll('#bsf-primary-emoji-wrap .bsf-emoji-btn').forEach(b=>{
      b.classList.toggle('sel', b.textContent===emoji);
    });
  } else {
    d.rageArtwork = { type:'emoji', value:emoji };
    const inp = document.getElementById('bsf-rage-emoji');
    if(inp) inp.value = emoji;
    const prev = document.getElementById('bsf-rage-preview');
    if(prev) prev.innerHTML = `<span>${emoji}</span>`;
    document.querySelectorAll('#bsf-rage-emoji-wrap .bsf-emoji-btn').forEach(b=>{
      b.classList.toggle('sel', b.textContent===emoji);
    });
  }
  window._bsRefreshAllSlotStages();
  window._bsMarkDirty();
  window._bsSyncEditorPreview();
};

window._bsUpdatePreviewImg = function(which, url){
  const d = window._bsDraft; if(!d) return;
  const prevId = which==='primary'?'bsf-art-preview':'bsf-rage-preview';
  const prev = document.getElementById(prevId);
  if(!prev) return;
  if(!url){
    if(which==='primary'){
      d.artwork = { type:'url', value:'' };
    } else {
      d.rageArtwork = { type:'url', value:'' };
    }
    prev.innerHTML = '<span class="material-symbols-outlined" style="font-size:24px;color:rgba(255,255,255,0.15)">add_photo_alternate</span>';
    window._bsRefreshAllSlotStages();
    window._bsMarkDirty();
    window._bsSyncEditorPreview();
    return;
  }
  if(which==='primary'){
    d.artwork = { type:'url', value:url };
  } else {
    d.rageArtwork = { type:'url', value:url };
  }
  prev.innerHTML=`<img src="${_esc(url)}" style="width:100%;height:100%;object-fit:contain" onerror="this.outerHTML='<span class=\\'material-symbols-outlined\\'style=\\'font-size:24px;color:rgba(255,255,255,0.15)\\'>broken_image</span>'">`;
  window._bsRefreshAllSlotStages();
  window._bsMarkDirty();
  window._bsSyncEditorPreview();
};

// ── File upload handlers ───────────────────────────────────────────────────────

window._bsHandleFileUpload = function(which, inputEl){
  const file = inputEl && inputEl.files && inputEl.files[0];
  if(!file) return;
  const MAX = 3 * 1024 * 1024; // 3 MB
  if(file.size > MAX){
    toast('❌ File is too large (max 3 MB)', '#ffb4ab');
    if(inputEl && inputEl.value !== undefined) inputEl.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = function(e){
    const dataUrl = e.target.result;
    const d = window._bsDraft; if(!d) return;
    if(which === 'primary'){
      d.artwork = { type:'upload', value: dataUrl };
      const prev = document.getElementById('bsf-art-preview');
      if(prev){
        prev.classList.add('transparent-bg');
        prev.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:contain">`;
      }
      const chosen     = document.getElementById('bsf-art-chosen');
      const chosenName = document.getElementById('bsf-art-chosen-name');
      if(chosen)     chosen.style.display = 'flex';
      if(chosenName) chosenName.textContent = file.name;
    } else {
      d.rageArtwork = { type:'upload', value: dataUrl };
      const prev = document.getElementById('bsf-rage-preview');
      if(prev){
        prev.classList.add('transparent-bg');
        prev.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:contain">`;
      }
      const chosen     = document.getElementById('bsf-rage-chosen');
      const chosenName = document.getElementById('bsf-rage-chosen-name');
      if(chosen)     chosen.style.display = 'flex';
      if(chosenName) chosenName.textContent = file.name;
    }
    window._bsRefreshAllSlotStages();
    window._bsMarkDirty();
    window._bsSyncEditorPreview();
  };
  reader.onerror = function(){
    toast('❌ Could not read file', '#ffb4ab');
  };
  reader.readAsDataURL(file);
};

window._bsDragOver = function(event, zoneId){
  event.preventDefault();
  event.stopPropagation();
  const zone = document.getElementById(zoneId);
  if(zone) zone.classList.add('drag-over');
};

window._bsDragLeave = function(zoneId){
  const zone = document.getElementById(zoneId);
  if(zone) zone.classList.remove('drag-over');
};

window._bsDropFile = function(event, which, zoneId){
  event.preventDefault();
  event.stopPropagation();
  const zone = document.getElementById(zoneId);
  if(zone) zone.classList.remove('drag-over');
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if(!file) return;
  window._bsHandleFileUpload(which, { files: [file] });
};

window._bsClearUpload = function(which){
  const d = window._bsDraft; if(!d) return;
  if(which === 'primary'){
    d.artwork = { type:'emoji', value:'💀' };
    const fileEl = document.getElementById('bsf-art-file');
    if(fileEl) fileEl.value = '';
    const chosen = document.getElementById('bsf-art-chosen');
    if(chosen) chosen.style.display = 'none';
    const prev = document.getElementById('bsf-art-preview');
    if(prev){
      prev.classList.remove('transparent-bg');
      prev.innerHTML = `<span id="bsf-art-preview-emoji">💀</span>`;
    }
    const emojiInp = document.getElementById('bsf-art-emoji');
    if(emojiInp) emojiInp.value = '💀';
    window._bsArtTab('primary', 'emoji');
  } else {
    d.rageArtwork = { type:null, value:null };
    const fileEl = document.getElementById('bsf-rage-file');
    if(fileEl) fileEl.value = '';
    const chosen = document.getElementById('bsf-rage-chosen');
    if(chosen) chosen.style.display = 'none';
    const prev = document.getElementById('bsf-rage-preview');
    if(prev){
      prev.classList.remove('transparent-bg');
      prev.innerHTML = `<span class="material-symbols-outlined" style="font-size:24px;color:rgba(255,255,255,0.15)">add_photo_alternate</span>`;
    }
    window._bsArtTab('rage', 'emoji');
  }
  window._bsRefreshAllSlotStages();
  window._bsMarkDirty();
  window._bsSyncEditorPreview();
};

// ── Palette ───────────────────────────────────────────────────────────────────

window._bsApplyPaletteIdx = function (idx) {
  const palette = (BS_PALETTES || window.BS_PALETTES || [])[idx]; if (!palette) return;
  window._bsApplyPalette(palette);
};

window._bsApplyPalette = function (palette) {
  const d = window._bsDraft; if (!d || !palette) return;
  if (!d.visual) d.visual = {};
  d.visual.themeColor = palette.theme;
  d.visual.auraColor  = palette.aura;
  d.visual.cardAccent = palette.accent;
  window._bsMarkDirty();
  window._bsSyncEditorPreview();
  window._bsDeactivatePaletteSwatches();
  // Sync colour pickers, swatch dots, and hex labels
  [['theme', palette.theme], ['aura', palette.aura], ['accent', palette.accent]].forEach(([key, val]) => {
    const input = document.getElementById(`bsf-color-${key}`);
    const dot   = document.getElementById(`bsf-swatch-${key}`);
    const hex   = document.getElementById(`bsf-color-${key}-hex`);
    if (input) input.value = val;
    if (dot)   dot.style.background = val;
    if (hex)   hex.textContent = val;
  });
};

window._bsDeactivatePaletteSwatches = function () {
  document.querySelectorAll('.bsf-palette-swatch').forEach(s => s.classList.remove('active'));
};

// ── Readiness score ────────────────────────────────────────────────────────────
// FIXED: this previously targeted #bsed-readiness-bar / #bsed-readiness-text,
// neither of which exist in the overlay HTML (the real elements are
// #bs-readiness-pill / #bs-readiness-label) — so the readiness indicator was
// silently doing nothing. Restored the original's 7-factor scoring formula
// and pill/icon/label update logic.

/** Compute and display a readiness score for the current boss draft. */
function _bsUpdateReadiness(){
  const d = window._bsDraft; if(!d) return;
  const pill = document.getElementById('bs-readiness-pill');
  const label = document.getElementById('bs-readiness-label');
  if(!pill||!label) return;

  let score = 0;
  if(d.name && d.name.trim()) score += 25;                          // has name
  if(d.artwork && d.artwork.value) score += 25;                     // has artwork
  if(d.lore && d.lore.trim()) score += 10;                         // has lore
  if(d.visual && d.visual.themeColor && d.visual.themeColor !== BS_DEFAULT_THEME) score += 10; // custom theme
  const animCount = ['idle','cast','hit','rage'].filter(k => d.animations && d.animations[k]).length;
  score += animCount * 7;                                            // up to 28 for all 4 slots
  if(d.tags && d.tags.length > 0) score += 5;                      // has tags

  score = Math.min(100, score);
  let cls, icon, text;
  if(score >= 70){ cls='high'; icon='check_circle'; text=`Ready · ${score}%`; }
  else if(score >= 35){ cls='mid'; icon='pending'; text=`In Progress · ${score}%`; }
  else { cls='low'; icon='radio_button_unchecked'; text=`Not Ready · ${score}%`; }

  pill.className = `bs-bar-readiness ${cls}`;
  const iconEl = pill.querySelector('.material-symbols-outlined');
  if(iconEl) iconEl.textContent = icon;
  label.textContent = text;
}

// ── Save form ─────────────────────────────────────────────────────────────────

window.bsSaveForm = async function () {
  const d = window._bsDraft; if (!d) return;
  // Read all form fields into draft
  const getName    = id => (document.getElementById(id)?.value || '').trim();
  d.name           = getName('bsf-name')  || d.name;
  d.description    = getName('bsf-desc')  || d.description || '';
  d.lore           = getName('bsf-lore')  || d.lore        || '';
  d.tags           = (getName('bsf-tags') || (d.tags || []).join(', ')).split(',').map(t => t.trim()).filter(Boolean);
  if (!d.name) {
    toast('❌ Boss name is required', '#ffb4ab');
    const errEl = document.getElementById('bsf-name-err'); if (errEl) errEl.style.display = '';
    window._bsSetToolTab('identity');
    return;
  }
  if (!d.visual) d.visual = {};
  const tc = document.getElementById('bsf-color-theme');  if (tc) d.visual.themeColor = tc.value;
  const ac = document.getElementById('bsf-color-aura');   if (ac) d.visual.auraColor  = ac.value;
  const cc = document.getElementById('bsf-color-accent'); if (cc) d.visual.cardAccent = cc.value;

  const savingToast = toast('💾 Saving...', '#d0bcff', 30000);
  try {
    await bsUpsertAsync(d);
    if (savingToast && typeof savingToast.dismiss === 'function') savingToast.dismiss();
    toast(`✅ "${d.name}" saved!`, '#4edea3');
    _bsDirtyFlag = false;
    window._bsForceCloseEditor();
    bsLoad();
    window._bsRefreshLibrary();
  } catch (err) {
    console.error('[BossStudio] Save failed:', err);
    toast('❌ Save failed — check console', '#ffb4ab');
  }
};

// ── Form modal builder ─────────────────────────────────────────────────────────
// RESTORED: this previously rendered a drastically condensed form (~80 lines)
// missing the Lore & Flavour / Tags & Classification section structure, the
// persistent-wrap artwork tabs, the Visual Effect Slots section, the full
// palette-swatch + custom color-picker pattern, and per-slot preview buttons.
// Ported verbatim from the original Boss Studio IIFE so boss-studio.css's
// existing .bsf-section / .bsf-artwork-row / .bsf-slot-row-anim / etc. rules
// (already present in the stylesheet, just unused) apply again.

function _bsRenderFormModal(isEdit){
  const d = window._bsDraft; if(!d) return;
  const formCol = document.getElementById('bs-eo-form-col'); if(!formCol) return;

  const artVal   = d.artwork&&d.artwork.value  ? d.artwork.value   : '💀';
  const artType  = d.artwork&&d.artwork.type   ? d.artwork.type    : 'emoji';
  const rageVal  = d.rageArtwork&&d.rageArtwork.value  ? d.rageArtwork.value  : '';
  const rageType = d.rageArtwork&&d.rageArtwork.type   ? d.rageArtwork.type   : 'emoji';
  const alOptsFn = (typeof window._alOptionsForTarget === 'function') ? window._alOptionsForTarget : function(){ return []; };

  const formHtml = `
  <!-- TAB NAV -->
  <div class="bs-tool-tabs">
    <button class="bs-tool-tab active" data-tab="identity" onclick="window._bsSetToolTab('identity')">
      <span class="material-symbols-outlined">badge</span>Identity
    </button>
    <button class="bs-tool-tab" data-tab="artwork" onclick="window._bsSetToolTab('artwork')">
      <span class="material-symbols-outlined">palette</span>Artwork
    </button>
    <button class="bs-tool-tab" data-tab="animations" onclick="window._bsSetToolTab('animations')">
      <span class="material-symbols-outlined">animation</span>Animations
    </button>
    <button class="bs-tool-tab" data-tab="theme" onclick="window._bsSetToolTab('theme')">
      <span class="material-symbols-outlined">auto_awesome</span>Theme
    </button>
  </div>

  <!-- TAB BODIES -->
  <div class="bs-tool-body">

    <!-- ══ IDENTITY PANEL ══ -->
    <div class="bsf-tool-panel" data-panel="identity">

      <div class="bsf-section">
        <div class="bsf-section-title">
          <span class="material-symbols-outlined">badge</span>Boss Identity
        </div>
        <div class="form-group">
          <label class="form-label">Boss Name <span style="color:#EC4899">*</span></label>
          <input type="text" id="bsf-name" value="${_esc(d.name||'')}"
            placeholder="e.g. The Obsidian Tyrant"
            style="width:100%;font-size:15px;font-family:var(--fh);font-weight:800"
            oninput="window._bsDraft.name=this.value;document.getElementById('bsf-name-err').style.display='none';window._bsSyncEditorPreview()">
          <div class="field-err" id="bsf-name-err" style="display:none">Boss name is required.</div>
        </div>
        <div class="form-group">
          <label class="form-label">Admin Description</label>
          <input type="text" id="bsf-desc" value="${_esc(d.description||'')}"
            placeholder="Short note visible only to you"
            style="width:100%"
            oninput="window._bsDraft.description=this.value">
        </div>
      </div>

      <div class="bsf-section">
        <div class="bsf-section-title">
          <span class="material-symbols-outlined">menu_book</span>Lore & Flavour
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Boss Lore <span style="font-size:10px;color:var(--text-muted);text-transform:none">(shown in encounter preview)</span></label>
          <textarea id="bsf-lore" rows="4"
            placeholder="In-world flavour text — a dark origin, a menacing proclamation, or a riddle the boss poses to challengers…"
            style="width:100%;resize:vertical;line-height:1.6"
            oninput="window._bsDraft.lore=this.value">${_esc(d.lore||'')}</textarea>
        </div>
      </div>

      <div class="bsf-section">
        <div class="bsf-section-title">
          <span class="material-symbols-outlined">sell</span>Tags & Classification
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Tags <span style="font-size:10px;color:var(--text-muted);text-transform:none">(comma-separated, shown on card)</span></label>
          <input type="text" id="bsf-tags" value="${_esc((d.tags||[]).join(', '))}"
            placeholder="e.g. fire, undead, mythic, chapter-3"
            style="width:100%"
            oninput="window._bsDraft.tags=this.value.split(',').map(t=>t.trim()).filter(Boolean);window._bsSyncEditorPreview()">
          <div style="font-size:10px;color:var(--text-muted);margin-top:5px;line-height:1.5">Tags appear on the boss card and can be used to filter the library. Separate with commas.</div>
        </div>
      </div>

    </div><!-- /identity -->

    <!-- ══ ARTWORK PANEL ══ -->
    <div class="bsf-tool-panel" data-panel="artwork" style="display:none">

      <div class="bsf-section">
        <div class="bsf-section-title">
          <span class="material-symbols-outlined">image</span>Primary Artwork
          <span class="bsf-slot-badge" style="background:rgba(78,222,163,0.08);border-color:rgba(78,222,163,0.2);color:var(--secondary)">Live Preview ↗</span>
        </div>
        <div class="bsf-artwork-row">
          <div class="bsf-artwork-preview ${artType==='upload'?'transparent-bg':''}" id="bsf-art-preview">
            ${artType==='emoji'?`<span id="bsf-art-preview-emoji">${_esc(artVal)}</span>`:
              artType==='upload'?`<img id="bsf-art-preview-img" src="${_esc(artVal)}" style="width:100%;height:100%;object-fit:contain">`:
              `<img id="bsf-art-preview-img" src="${_esc(artVal)}" style="width:100%;height:100%;object-fit:contain" onerror="this.style.display='none'">`}
          </div>
          <div style="flex:1">
            <div style="display:flex;gap:5px;margin-bottom:8px">
              <button class="bs-filter-btn ${artType==='emoji'?'active':''}" id="bsf-primary-tab-emoji"
                onclick="window._bsArtTab('primary','emoji')" style="flex:1;font-size:11px;padding:5px 4px">Emoji</button>
              <button class="bs-filter-btn ${artType==='url'?'active':''}" id="bsf-primary-tab-url"
                onclick="window._bsArtTab('primary','url')" style="flex:1;font-size:11px;padding:5px 4px">URL</button>
              <button class="bs-filter-btn ${artType==='upload'?'active':''}" id="bsf-primary-tab-upload"
                onclick="window._bsArtTab('primary','upload')" style="flex:1;font-size:11px;padding:5px 4px">📁 Upload</button>
            </div>
            <div id="bsf-primary-emoji-wrap" style="display:${artType==='emoji'?'block':'none'}">
              <input type="text" id="bsf-art-emoji" value="${artType==='emoji'?_esc(artVal):''}"
                placeholder="Paste or type emoji"
                style="width:100%;margin-bottom:7px;font-size:18px;text-align:center"
                oninput="window._bsDraft.artwork={type:'emoji',value:this.value};document.getElementById('bsf-art-preview').innerHTML='<span id=\\'bsf-art-preview-emoji\\'>' + (this.value||'💀') + '</span>';window._bsRefreshAllSlotStages();window._bsSyncEditorPreview()">
              <div class="bsf-emoji-grid">
                ${BS_EMOJI_PRESETS.map(e=>`<div class="bsf-emoji-btn ${artType==='emoji'&&artVal===e?'sel':''}"
                  onclick="window._bsPickEmoji('primary','${e}')">${e}</div>`).join('')}
              </div>
            </div>
            <div id="bsf-primary-url-wrap" style="display:${artType==='url'?'block':'none'}">
              <input type="text" id="bsf-art-url" value="${artType==='url'?_esc(artVal):''}"
                placeholder="https://example.com/boss.png"
                style="width:100%"
                oninput="window._bsDraft.artwork={type:'url',value:this.value};window._bsUpdatePreviewImg('primary',this.value);window._bsRefreshAllSlotStages();window._bsSyncEditorPreview()">
              <div style="font-size:10px;color:var(--text-muted);margin-top:5px">PNG, WEBP, SVG · transparent background recommended</div>
            </div>
            <div id="bsf-primary-upload-wrap" style="display:${artType==='upload'?'block':'none'}">
              <input type="file" id="bsf-art-file" class="bsf-upload-file-input" accept="image/png,image/webp,image/svg+xml,image/jpeg,image/gif"
                onchange="window._bsHandleFileUpload('primary', this)">
              <div class="bsf-upload-zone" id="bsf-art-dropzone"
                onclick="document.getElementById('bsf-art-file').click()"
                ondragover="window._bsDragOver(event,'bsf-art-dropzone')"
                ondragleave="window._bsDragLeave('bsf-art-dropzone')"
                ondrop="window._bsDropFile(event,'primary','bsf-art-dropzone')">
                <span class="material-symbols-outlined upload-icon">upload_file</span>
                <span class="upload-label">Click to upload or drag & drop</span>
                <span class="upload-sub">PNG (transparent), WEBP, SVG, JPG · Max 3MB</span>
              </div>
              <div id="bsf-art-chosen" style="display:${artType==='upload'&&artVal?'flex':'none'}" class="bsf-upload-chosen">
                <span class="material-symbols-outlined" style="font-size:14px;color:var(--secondary);flex-shrink:0">check_circle</span>
                <span class="bsf-upload-chosen-name" id="bsf-art-chosen-name">${artType==='upload'&&artVal?'Photo loaded':'—'}</span>
                <button class="bsf-upload-clear-btn" onclick="window._bsClearUpload('primary')">✕ Remove</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="bsf-section">
        <div class="bsf-section-title">
          <span class="material-symbols-outlined" style="color:#EC4899">local_fire_department</span>Rage Artwork
          <span class="bsf-slot-badge">Optional</span>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;line-height:1.5">
          Alternate art shown when the boss enters rage mode. Leave empty to keep the same artwork.
        </div>
        <div class="bsf-artwork-row">
          <div class="bsf-artwork-preview ${rageType==='upload'?'transparent-bg':''}" id="bsf-rage-preview" style="border-color:rgba(236,72,153,0.25)">
            ${rageType==='emoji'&&rageVal?`<span>${_esc(rageVal)}</span>`:
              rageType==='url'&&rageVal?`<img src="${_esc(rageVal)}" style="width:100%;height:100%;object-fit:contain">`:
              rageType==='upload'&&rageVal?`<img src="${_esc(rageVal)}" style="width:100%;height:100%;object-fit:contain">`:
              `<span class="material-symbols-outlined" style="font-size:24px;color:rgba(236,72,153,0.2)">add_photo_alternate</span>`}
          </div>
          <div style="flex:1">
            <div style="display:flex;gap:5px;margin-bottom:8px">
              <button class="bs-filter-btn ${rageType==='emoji'?'active':''}" id="bsf-rage-tab-emoji"
                onclick="window._bsArtTab('rage','emoji')" style="flex:1;font-size:11px;padding:5px 4px">Emoji</button>
              <button class="bs-filter-btn ${rageType==='url'?'active':''}" id="bsf-rage-tab-url"
                onclick="window._bsArtTab('rage','url')" style="flex:1;font-size:11px;padding:5px 4px">URL</button>
              <button class="bs-filter-btn ${rageType==='upload'?'active':''}" id="bsf-rage-tab-upload"
                onclick="window._bsArtTab('rage','upload')" style="flex:1;font-size:11px;padding:5px 4px">📁 Upload</button>
            </div>
            <div id="bsf-rage-emoji-wrap" style="display:${rageType==='emoji'?'block':'none'}">
              <input type="text" id="bsf-rage-emoji" value="${rageType==='emoji'?_esc(rageVal):''}"
                placeholder="Optional rage-state emoji"
                style="width:100%;margin-bottom:7px;font-size:18px;text-align:center"
                oninput="window._bsDraft.rageArtwork={type:'emoji',value:this.value||null};document.getElementById('bsf-rage-preview').innerHTML=this.value?'<span>'+this.value+'</span>':'<span class=\\'material-symbols-outlined\\'style=\\'font-size:24px;color:rgba(236,72,153,0.2)\\'>add_photo_alternate</span>';window._bsRefreshAllSlotStages()">
              <div class="bsf-emoji-grid">
                ${['🔥','💢','😡','😤','⚡','🌋','💥','👿','🔴','🩸'].map(e=>`<div class="bsf-emoji-btn ${rageType==='emoji'&&rageVal===e?'sel':''}"
                  onclick="window._bsPickEmoji('rage','${e}')">${e}</div>`).join('')}
              </div>
            </div>
            <div id="bsf-rage-url-wrap" style="display:${rageType==='url'?'block':'none'}">
              <input type="text" id="bsf-rage-url" value="${rageType==='url'?_esc(rageVal):''}"
                placeholder="https://example.com/boss-rage.png"
                style="width:100%"
                oninput="window._bsDraft.rageArtwork={type:'url',value:this.value||null};window._bsUpdatePreviewImg('rage',this.value);window._bsRefreshAllSlotStages()">
            </div>
            <div id="bsf-rage-upload-wrap" style="display:${rageType==='upload'?'block':'none'}">
              <input type="file" id="bsf-rage-file" class="bsf-upload-file-input" accept="image/png,image/webp,image/svg+xml,image/jpeg,image/gif"
                onchange="window._bsHandleFileUpload('rage', this)">
              <div class="bsf-upload-zone" id="bsf-rage-dropzone"
                onclick="document.getElementById('bsf-rage-file').click()"
                ondragover="window._bsDragOver(event,'bsf-rage-dropzone')"
                ondragleave="window._bsDragLeave('bsf-rage-dropzone')"
                ondrop="window._bsDropFile(event,'rage','bsf-rage-dropzone')">
                <span class="material-symbols-outlined upload-icon">upload_file</span>
                <span class="upload-label">Click to upload or drag & drop</span>
                <span class="upload-sub">PNG (transparent), WEBP, SVG, JPG · Max 3MB</span>
              </div>
              <div id="bsf-rage-chosen" style="display:${rageType==='upload'&&rageVal?'flex':'none'}" class="bsf-upload-chosen">
                <span class="material-symbols-outlined" style="font-size:14px;color:var(--secondary);flex-shrink:0">check_circle</span>
                <span class="bsf-upload-chosen-name" id="bsf-rage-chosen-name">${rageType==='upload'&&rageVal?'Photo loaded':'—'}</span>
                <button class="bsf-upload-clear-btn" onclick="window._bsClearUpload('rage')">✕ Remove</button>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div><!-- /artwork -->

    <!-- ══ ANIMATIONS PANEL ══ -->
    <div class="bsf-tool-panel" data-panel="animations" style="display:none">

      <div class="bsf-section">
        <div class="bsf-section-title">
          <span class="material-symbols-outlined">animation</span>Animation Slots
          <span class="bsf-slot-badge" style="background:rgba(78,222,163,0.08);border-color:rgba(78,222,163,0.2);color:var(--secondary)">Animation Library</span>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px;line-height:1.5;background:rgba(139,92,246,0.06);border:1px solid rgba(139,92,246,0.15);border-radius:8px;padding:9px 12px">
          <span class="material-symbols-outlined" style="font-size:13px;vertical-align:middle;margin-right:4px;color:#a78bfa">tips_and_updates</span>
          Assign a preset from the Animation Library to each state slot. Click Preview (▶) to play the animation on your boss art before saving. The cinema stage on the left also lets you test each state.
        </div>
        <div class="bsf-slot-grid">
          ${[
            {key:'idle', target:'idle', icon:'play_circle',           label:'Idle',  sub:'Looping animation when boss is at rest'},
            {key:'cast', target:'cast', icon:'bolt',                  label:'Skill Cast',  sub:'Plays on special ability execution'},
            {key:'hit',  target:'hit',  icon:'gpp_bad',               label:'Hit Reaction',   sub:'Triggered when boss takes damage'},
            {key:'rage', target:'rage', icon:'local_fire_department', label:'Rage',  sub:'Activates on low-HP rage state'},
          ].map(s=>{
            const opts = alOptsFn(s.target);
            const cur  = (d.animations&&d.animations[s.key]) || '';
            return `
          <div class="bsf-slot-row bsf-slot-row-anim">
            <div class="bsf-slot-icon"><span class="material-symbols-outlined">${s.icon}</span></div>
            <div class="bsf-slot-info">
              <div class="bsf-slot-label">${s.label}</div>
              <div class="bsf-slot-sub">${s.sub}</div>
            </div>
            <div class="bsf-slot-anim-stage" id="bsf-anim-stage-${s.key}"></div>
            <div class="bsf-slot-select-wrap">
              <select class="bsf-slot-select" id="bsf-anim-select-${s.key}"
                onchange="window._bsDraft.animations=window._bsDraft.animations||{};window._bsDraft.animations['${s.key}']=this.value||null;window._bsRefreshSlotStage('${s.key}');window._bsSyncEditorPreview()">
                <option value="">— Unassigned —</option>
                ${opts.map(a=>`<option value="${_esc(a.id)}" ${cur===a.id?'selected':''}>${_esc(a.name)}</option>`).join('')}
              </select>
              <button type="button" class="bsf-slot-preview-btn" id="bsf-anim-preview-${s.key}" onclick="window._bsToggleSlotPreview('${s.key}')" ${cur?'':'disabled'}>
                <span class="material-symbols-outlined">play_arrow</span>Preview
              </button>
            </div>
          </div>`}).join('')}
        </div>
      </div>

      <div class="bsf-section">
        <div class="bsf-section-title">
          <span class="material-symbols-outlined">grain</span>Visual Effect Slots
          <span class="bsf-slot-badge">Future</span>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">
          Aura and particle effect library slots — reserved for the next phase.
        </div>
        <div class="bsf-slot-grid">
          ${[
            {key:'aura',     icon:'auto_awesome', label:'Aura Effect',     sub:'Persistent ambient glow or aura around the boss'},
            {key:'particle', icon:'grain',        label:'Particle Effect', sub:'Particle system emitted during gameplay'},
          ].map(s=>`
          <div class="bsf-slot-row">
            <div class="bsf-slot-icon"><span class="material-symbols-outlined">${s.icon}</span></div>
            <div class="bsf-slot-info">
              <div class="bsf-slot-label">${s.label}</div>
              <div class="bsf-slot-sub">${s.sub}</div>
            </div>
            <input type="text" placeholder="Effect ID…"
              value="${_esc((d.effects&&d.effects[s.key])||'')}"
              style="width:120px;font-size:11px;opacity:0.6"
              oninput="if(!window._bsDraft.effects)window._bsDraft.effects={};window._bsDraft.effects['${s.key}']=this.value.trim()||null">
          </div>`).join('')}
        </div>
      </div>

    </div><!-- /animations -->

    <!-- ══ THEME PANEL ══ -->
    <div class="bsf-tool-panel" data-panel="theme" style="display:none">

      <div class="bsf-section">
        <div class="bsf-section-title">
          <span class="material-symbols-outlined">palette</span>Color Theme
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px;line-height:1.5">
          Pick a palette preset or customize colors individually. Theme colors drive the boss card accent, HP bar, stage glow, and encounter atmosphere.
        </div>
        <!-- Palette presets -->
        <div style="font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">Palette Presets</div>
        <div class="bsf-palette-row" style="margin-bottom:16px">
          ${(BS_PALETTES||window.BS_PALETTES||[]).map((p,i)=>{
            const active = d.visual && d.visual.themeColor===p.theme && d.visual.auraColor===p.aura;
            return `<div class="bsf-palette-swatch ${active?'active':''}"
              title="${_esc(p.label)}"
              data-palette-idx="${i}"
              onclick="window._bsApplyPaletteIdx(this.dataset.paletteIdx)"
              style="background:linear-gradient(135deg,${_esc(p.theme)},${_esc(p.aura)})">
            </div>`;
          }).join('')}
        </div>
        <!-- Custom pickers -->
        <div style="font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">Custom Colors</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:9px 12px;border-radius:9px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07)">
            <div class="bsf-theme-dot" id="bsf-swatch-theme"
              style="background:${_esc((d.visual&&d.visual.themeColor)||BS_DEFAULT_THEME)};width:24px;height:24px;border-radius:6px">
            </div>
            <div style="flex:1">
              <div style="font-size:12px;font-weight:700;color:var(--on-surface)">Theme Color</div>
              <div style="font-size:10px;color:var(--text-muted)">Stage glow, HP bar, card border</div>
            </div>
            <input type="color" id="bsf-color-theme"
              value="${_esc((d.visual&&d.visual.themeColor)||BS_DEFAULT_THEME)}"
              style="opacity:0;position:absolute;pointer-events:none;width:0;height:0"
              oninput="window._bsDraft.visual=window._bsDraft.visual||{};window._bsDraft.visual.themeColor=this.value;document.getElementById('bsf-swatch-theme').style.background=this.value;document.getElementById('bsf-color-theme-hex').textContent=this.value;window._bsDeactivatePaletteSwatches();window._bsSyncEditorPreview()">
            <span style="font-family:var(--fb);font-size:11px;color:var(--text-muted)" id="bsf-color-theme-hex">${_esc((d.visual&&d.visual.themeColor)||BS_DEFAULT_THEME)}</span>
            <button type="button" class="bsf-color-open-btn" onclick="document.getElementById('bsf-color-theme').click()">Pick</button>
          </label>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:9px 12px;border-radius:9px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07)">
            <div class="bsf-theme-dot" id="bsf-swatch-aura"
              style="background:${_esc((d.visual&&d.visual.auraColor)||BS_DEFAULT_AURA)};width:24px;height:24px;border-radius:6px">
            </div>
            <div style="flex:1">
              <div style="font-size:12px;font-weight:700;color:var(--on-surface)">Aura Color</div>
              <div style="font-size:10px;color:var(--text-muted)">HP bar gradient, encounter atmosphere</div>
            </div>
            <input type="color" id="bsf-color-aura"
              value="${_esc((d.visual&&d.visual.auraColor)||BS_DEFAULT_AURA)}"
              style="opacity:0;position:absolute;pointer-events:none;width:0;height:0"
              oninput="window._bsDraft.visual=window._bsDraft.visual||{};window._bsDraft.visual.auraColor=this.value;document.getElementById('bsf-swatch-aura').style.background=this.value;document.getElementById('bsf-color-aura-hex').textContent=this.value;window._bsDeactivatePaletteSwatches();window._bsSyncEditorPreview()">
            <span style="font-family:var(--fb);font-size:11px;color:var(--text-muted)" id="bsf-color-aura-hex">${_esc((d.visual&&d.visual.auraColor)||BS_DEFAULT_AURA)}</span>
            <button type="button" class="bsf-color-open-btn" onclick="document.getElementById('bsf-color-aura').click()">Pick</button>
          </label>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:9px 12px;border-radius:9px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07)">
            <div class="bsf-theme-dot" id="bsf-swatch-accent"
              style="background:${_esc((d.visual&&d.visual.cardAccent)||BS_DEFAULT_ACCENT)};width:24px;height:24px;border-radius:6px">
            </div>
            <div style="flex:1">
              <div style="font-size:12px;font-weight:700;color:var(--on-surface)">Accent Color</div>
              <div style="font-size:10px;color:var(--text-muted)">Card tag chips, badge colors</div>
            </div>
            <input type="color" id="bsf-color-accent"
              value="${_esc((d.visual&&d.visual.cardAccent)||BS_DEFAULT_ACCENT)}"
              style="opacity:0;position:absolute;pointer-events:none;width:0;height:0"
              oninput="window._bsDraft.visual=window._bsDraft.visual||{};window._bsDraft.visual.cardAccent=this.value;document.getElementById('bsf-swatch-accent').style.background=this.value;document.getElementById('bsf-color-accent-hex').textContent=this.value;window._bsDeactivatePaletteSwatches();window._bsSyncEditorPreview()">
            <span style="font-family:var(--fb);font-size:11px;color:var(--text-muted)" id="bsf-color-accent-hex">${_esc((d.visual&&d.visual.cardAccent)||BS_DEFAULT_ACCENT)}</span>
            <button type="button" class="bsf-color-open-btn" onclick="document.getElementById('bsf-color-accent').click()">Pick</button>
          </label>
        </div>
      </div>

      <!-- Live Preview reminder -->
      <div style="background:rgba(78,222,163,0.06);border:1px solid rgba(78,222,163,0.18);border-radius:10px;padding:12px 14px;font-size:12px;color:rgba(78,222,163,.85);display:flex;gap:8px;align-items:flex-start">
        <span class="material-symbols-outlined" style="font-size:14px;margin-top:1px;flex-shrink:0">visibility</span>
        <span>Color changes update the boss stage on the left in real time. Click a state button (Idle / Cast / Hit / Rage) to preview different animation states.</span>
      </div>

    </div><!-- /theme -->

  </div><!-- /body -->
  `;

  formCol.innerHTML = formHtml;
  // Restore to previously active tab (defaults to 'identity' on first render)
  window._bsSetToolTab(_bsToolTab || 'identity');
  // Delegated dirty-tracking
  if(!formCol._bsDirtyBound){
    formCol._bsDirtyBound = true;
    formCol.addEventListener('input',  ()=>window._bsMarkDirty());
    formCol.addEventListener('change', ()=>window._bsMarkDirty());
    formCol.addEventListener('click', (e)=>{
      if(e.target.closest('button, .bsf-palette-swatch, .bsf-emoji-btn')) window._bsMarkDirty();
    });
  }

  // Populate each animation slot's mini preview stage with this boss's artwork (static)
  ['idle','cast','hit','rage'].forEach(key=>window._bsRefreshSlotStage(key, true));

  // Update readiness indicator
  _bsUpdateReadiness();
}

window._bsRenderFormModal = _bsRenderFormModal;

console.log('[EduQuest] boss-studio/editor.js loaded — bsOpenCreate, bsOpenEdit, full editor overlay registered.');
