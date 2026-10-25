// ─────────────────────────────────────────────────────────────────────────────
// CAMPAIGN — drag-and-drop interaction beat type (Phase 6 of the campaign
// feature roadmap; unrelated numbering to this engineering refactor's own
// Phase 6)
//
// Phase 6 (Decompose God Files, this refactor) extraction from
// campaign_engine.js. Owns exactly one beat type — `interaction`/`dragdrop`
// — end to end: panel creation, pointer-driven drag (works for mouse/touch/
// pen via Pointer Events), drop resolution (match mode: item→target;
// sequence mode: item→ordered slot), and the required-to-continue solved
// check. No behavior change — every function below is moved verbatim.
//
// WHY THIS WAS SAFE TO EXTRACT: this beat type is architecturally
// self-contained already — every other beat-type handler in
// campaign_engine.js (story/encounter/reveal/dialogue) only ever calls
// _campHideDragDropUI() when switching away from this beat type, never
// reaches into its internals. The reverse call — _campRollSkillDrop() from
// _campDragDropContinue() below — is a normal cross-file call to another
// Phase 6 extraction (campaign-skills.js), the same "shared top-level scope,
// call by name" pattern already used for every split in this refactor.
//
// Exports: _campShowDragDropBeat(), _campHideDragDropUI()
//
// DEPENDENCIES: camp (shared module state, declared in campaign_engine.js),
// _campSetBg(), _campHideRevealUI(), _campHideDialogueUI(), _campHideSkillBar(),
// _campRollSkillDrop(), _campBeatAdvance() — all globals already available
// wherever this file loads, same as when this code lived inside
// campaign_engine.js. Must load after campaign_engine.js (see index.html) so
// `camp` exists before this file's top-level code would ever need it (it
// doesn't run anything at load time beyond declarations, so load order
// relative to campaign_engine.js doesn't actually matter for correctness —
// kept after it in index.html purely for reading order).
// ─────────────────────────────────────────────────────────────────────────────

function _campEnsureDragDropPanel() {
  let panel = document.getElementById('camp-dragdrop-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'camp-dragdrop-panel';
    panel.className = 'camp-dragdrop-panel';
    document.getElementById('camp-scene').appendChild(panel);
  }
  return panel;
}

// Called whenever a non-dragdrop beat (or victory/defeat) is shown, so a
// leftover drag-drop panel from a prior beat never bleeds into the next —
// same purpose as Phase 4's `_campHideRevealUI` / Phase 5's `_campHideDialogueUI`.
function _campHideDragDropUI() {
  const panel = document.getElementById('camp-dragdrop-panel'); if (panel) panel.style.display = 'none';
}

function _campShuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function _campShowDragDropBeat(beat) {
  document.getElementById('camp-story-panel').style.display   = 'none';
  document.getElementById('camp-encounter').style.display     = 'none';
  document.getElementById('camp-result').style.display        = 'none';
  document.getElementById('camp-continue-hint').style.display = 'none';
  _campHideRevealUI(); // Phase 6 — leaving a reveal beat, hide its panel/popup
  _campHideDialogueUI(); // Phase 6 — leaving a dialogue beat, hide its panel
  _campHideSkillBar(); // Phase 7 — leaving an encounter beat, hide the skill bar
  _campSetBg(beat.bg);
  const items = beat.items || [];
  // Fresh per beat — nothing placed yet, pool order shuffled so `sequence`
  // mode never starts already-solved. `placements` maps target id (match
  // mode) or slot index (sequence mode) to the item id currently sitting
  // there. `locked` flips true once `_campDragDropCheckSolved` passes and
  // disables further dragging, mirroring the reveal beat's post-complete state.
  camp.dragState = {
    placements: {},
    poolOrder: _campShuffleArray(items.map(it => it.id)),
    locked: false,
  };
  _campRenderDragDropPanel(beat);
}

function _campDragChipHTML(item, locked) {
  if (!item) return '';
  return `<div class="camp-dd-chip${locked ? ' locked' : ''}" data-item-id="${_esc(item.id)}">
    ${item.image ? `<img class="camp-dd-chip-img" src="${_esc(item.image)}">` : ''}
    <div class="camp-dd-chip-label">${_esc(item.label || '')}</div>
  </div>`;
}

function _campRenderDragDropPanel(beat) {
  const panel = _campEnsureDragDropPanel();
  panel.style.display = 'flex';
  const st = camp.dragState;
  const itemsById = {};
  (beat.items || []).forEach(it => { itemsById[it.id] = it; });

  const poolHTML = st.poolOrder.map(id => _campDragChipHTML(itemsById[id], st.locked)).join('');

  let targetsHTML;
  if (beat.mode === 'sequence') {
    const n = (beat.items || []).length;
    targetsHTML = Array.from({ length: n }).map((_, i) => {
      const placedItem = itemsById[st.placements[i]];
      return `<div class="camp-dd-slot${placedItem ? ' filled' : ''}" data-slot-index="${i}">
        <div class="camp-dd-slot-num">${i + 1}</div>
        ${placedItem ? _campDragChipHTML(placedItem, st.locked) : '<div class="camp-dd-slot-empty">Drop here</div>'}
      </div>`;
    }).join('');
  } else {
    targetsHTML = (beat.targets || []).map(t => {
      const placedItem = itemsById[st.placements[t.id]];
      return `<div class="camp-dd-target${placedItem ? ' filled' : ''}" data-target-id="${_esc(t.id)}">
        <div class="camp-dd-target-label">${_esc(t.label || '')}</div>
        ${placedItem ? _campDragChipHTML(placedItem, st.locked) : '<div class="camp-dd-slot-empty">Drop here</div>'}
      </div>`;
    }).join('');
  }

  const allFilled  = st.poolOrder.length === 0;
  const statusHTML = st.locked
    ? `<div class="camp-dd-status ok">✅ Correct! Great work.</div>`
    : (allFilled ? `<div class="camp-dd-status bad">❌ Not quite — drag items to fix, then try again.</div>` : '');

  panel.innerHTML = `
    <div class="camp-dd-prompt">${_esc(beat.prompt || (beat.mode === 'sequence' ? 'Drag the items into the correct order.' : 'Drag each item to its match.'))}</div>
    <div class="camp-dd-board">
      <div class="camp-dd-pool" data-pool="1">${poolHTML || '<div class="camp-dd-pool-empty">All items placed</div>'}</div>
      <div class="camp-dd-targets">${targetsHTML}</div>
    </div>
    ${statusHTML}
    <button type="button" class="btn btn-primary camp-dd-continue-btn" id="camp-dd-continue" ${st.locked ? '' : 'disabled'} onclick="_campDragDropContinue()">Continue →</button>`;

  _campWireDragDropPointerEvents(panel);
}

// Single delegated pointerdown listener re-attached on every render (the
// panel's innerHTML is fully replaced each time, same as the reveal/dialogue
// panels) rather than one listener per chip.
function _campWireDragDropPointerEvents(panel) {
  panel.onpointerdown = function (e) {
    if (!camp.dragState || camp.dragState.locked) return;
    const chip = e.target.closest ? e.target.closest('.camp-dd-chip') : null;
    if (!chip) return;
    _campDragPointerStart(e, chip);
  };
}

// Pointer-driven drag: a fixed-position ghost clone follows the pointer;
// on release, `elementFromPoint` finds whatever's underneath (a target, a
// slot, the pool, or nothing) and `_campDragDrop` resolves the placement.
// Works identically for mouse, touch, and pen since it's all Pointer Events.
function _campDragPointerStart(e, chipEl) {
  const itemId = chipEl.dataset.itemId;
  e.preventDefault();
  const ghost = chipEl.cloneNode(true);
  ghost.classList.add('camp-dd-ghost');
  ghost.style.position = 'fixed';
  ghost.style.left = e.clientX + 'px';
  ghost.style.top  = e.clientY + 'px';
  document.body.appendChild(ghost);
  chipEl.classList.add('dragging-source');

  function move(ev) {
    ghost.style.left = ev.clientX + 'px';
    ghost.style.top  = ev.clientY + 'px';
  }
  function up(ev) {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', up);
    ghost.remove();
    const dropEl = document.elementFromPoint(ev.clientX, ev.clientY);
    _campDragDrop(itemId, dropEl);
  }
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', up);
}

// Resolves one drop: pulls `itemId` out of wherever it currently sits (pool
// or an existing placement), then places it at the drop location — swapping
// with whatever was already there, same occupied-slot-swap behavior
// `classroom_builder.js`'s seat drag uses. Dropping outside any valid target/
// slot/pool zone (e.g. released mid-panel) returns the item to the pool.
function _campDragDrop(itemId, dropEl) {
  const beat = (camp.stage.beats || [])[camp.beatIdx]; if (!beat) return;
  const st = camp.dragState; if (!st || st.locked) return;

  const slotEl   = dropEl && dropEl.closest ? dropEl.closest('.camp-dd-slot')   : null;
  const targetEl = dropEl && dropEl.closest ? dropEl.closest('.camp-dd-target') : null;

  st.poolOrder = st.poolOrder.filter(id => id !== itemId);
  Object.keys(st.placements).forEach(k => { if (st.placements[k] === itemId) delete st.placements[k]; });

  if (beat.mode === 'sequence' && slotEl) {
    const idx = parseInt(slotEl.dataset.slotIndex, 10);
    const displaced = st.placements[idx];
    st.placements[idx] = itemId;
    if (displaced) st.poolOrder.push(displaced);
  } else if (beat.mode === 'match' && targetEl) {
    const tid = targetEl.dataset.targetId;
    const displaced = st.placements[tid];
    st.placements[tid] = itemId;
    if (displaced) st.poolOrder.push(displaced);
  } else {
    st.poolOrder.push(itemId); // pool, or released outside any valid zone
  }

  st.locked = _campDragDropCheckSolved(beat, st);
  _campRenderDragDropPanel(beat);
}

// Decision #1 — required-to-continue: every item must be placed, and every
// placement must be correct, before this returns true.
function _campDragDropCheckSolved(beat, st) {
  const items = beat.items || [];
  if (!items.length) return false;
  if (st.poolOrder.length !== 0) return false;
  if (beat.mode === 'sequence') {
    for (let i = 0; i < items.length; i++) { if (st.placements[i] !== items[i].id) return false; }
    return true;
  }
  const itemsById = {}; items.forEach(it => { itemsById[it.id] = it; });
  const targets = beat.targets || [];
  if (!targets.length) return false;
  for (const t of targets) {
    const placed = itemsById[st.placements[t.id]];
    if (!placed || placed.targetId !== t.id) return false;
  }
  return true;
}

window._campDragDropContinue = function () {
  const st = camp.dragState; if (!st || !st.locked) return;
  _campHideDragDropUI();
  _campRollSkillDrop(); // Phase 7 — drag-drop beats count as a graded learning interaction (Decision #5)
  _campBeatAdvance();
};

// ── Phase 7 (2026-08-10, session 7): explicit window exports ──
// These were previously implicit globals (bare top-level declarations,
// reachable to other files only via classic-script auto-attach-to-window
// behavior). Made explicit ahead of any real bundle/module scoping change
// — found by build/audit-window-exports.js, which checks every symbol with
// a real cross-file consumer, not just ones reachable from onclick markup.
// See PHASE7_WINDOW_EXPORT_AUDIT.md.
window._campHideDragDropUI = _campHideDragDropUI;
window._campShowDragDropBeat = _campShowDragDropBeat;
