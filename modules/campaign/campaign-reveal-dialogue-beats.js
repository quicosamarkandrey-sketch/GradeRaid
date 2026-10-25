// ─────────────────────────────────────────────────────────────────────────────
// CAMPAIGN — reveal (click-to-reveal hotspot) and dialogue (branching choice)
// interaction beat types (Phase 4/5 of the campaign feature roadmap;
// unrelated numbering to this engineering refactor's own Phase 6)
//
// Phase 6 (Decompose God Files, this refactor) extraction from
// campaign_engine.js. Owns two beat types together, not separately, because
// they call directly into each other's cleanup (_campShowRevealBeat calls
// _campHideDialogueUI and vice versa, defensively, since either beat type
// could follow the other) — splitting them into two files would just add a
// cross-file hop in both directions for no real gain in cohesion. No
// behavior change — every function below is moved verbatim.
//
// WHY THIS WAS SAFE TO EXTRACT: same as the drag-drop beat type and skill
// system extracted earlier this phase — every other beat-type handler in
// campaign_engine.js only ever calls each cluster's small set of entry
// points (_campShowRevealBeat/_campHideRevealUI,
// _campShowDialogueBeat/_campHideDialogueUI) when switching beats or ending
// a stage, never reaches into either one's internals.
//
// Exports: _campShowRevealBeat(), _campHideRevealUI(),
//   _campShowDialogueBeat(), _campHideDialogueUI()
//
// DEPENDENCIES: camp (shared module state, declared in campaign_engine.js),
// _campBeatAdvance() — all globals already available wherever this file
// loads, same as when this code lived inside campaign_engine.js. Must load
// after campaign_engine.js (see index.html) — see campaign-dragdrop-beat.js's
// header for why load order doesn't actually affect correctness here.
// ─────────────────────────────────────────────────────────────────────────────

// ── Interaction beats: click-to-reveal (Phase 4) ────────────────────────────────
// New beat type `interaction` (subtype `reveal`, Decisions #1/#8/#9): one or
// more clickable hotspots, each opening a short info popup; the beat blocks
// advancing until every hotspot has been viewed at least once. No DOM for
// this exists in index.html (out of the Phase 4 allowlist), so the panel and
// popup are built and appended to `#camp-scene` at runtime, same way the rest
// of this file only ever touches elements it owns.

function _campEnsureRevealPanel() {
  let panel = document.getElementById('camp-reveal-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'camp-reveal-panel';
    panel.className = 'camp-reveal-panel';
    document.getElementById('camp-scene').appendChild(panel);
  }
  return panel;
}

function _campEnsureRevealPopup() {
  let popup = document.getElementById('camp-reveal-popup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'camp-reveal-popup';
    popup.className = 'camp-reveal-popup-overlay';
    document.getElementById('camp-scene').appendChild(popup);
  }
  return popup;
}

// Called whenever a non-reveal beat (or victory/defeat) is shown, so a
// leftover reveal panel/popup from a prior beat never bleeds into the next.
function _campHideRevealUI() {
  const panel = document.getElementById('camp-reveal-panel'); if (panel) panel.style.display = 'none';
  const popup = document.getElementById('camp-reveal-popup'); if (popup) popup.style.display = 'none';
}

function _campShowRevealBeat(beat) {
  document.getElementById('camp-story-panel').style.display   = 'none';
  document.getElementById('camp-encounter').style.display     = 'none';
  document.getElementById('camp-result').style.display        = 'none';
  document.getElementById('camp-continue-hint').style.display = 'none';
  _campHideDialogueUI(); // Phase 5 — leaving a dialogue beat, hide its panel
  _campHideDragDropUI(); // Phase 6 — leaving a drag-drop beat, hide its panel
  _campHideSkillBar(); // Phase 7 — leaving an encounter beat, hide the skill bar
  _campSetBg(beat.bg);
  camp.revealViewed = new Set(); // fresh per beat — nothing viewed yet
  const popup = document.getElementById('camp-reveal-popup'); if (popup) popup.style.display = 'none';
  _campRenderRevealPanel(beat);
}

function _campRenderRevealPanel(beat) {
  const panel     = _campEnsureRevealPanel();
  panel.style.display = 'flex';
  const hotspots  = beat.hotspots || [];
  const viewed    = camp.revealViewed || new Set();
  const allViewed = hotspots.length > 0 && viewed.size >= hotspots.length;
  panel.innerHTML = `
    <div class="camp-reveal-prompt">${_esc(beat.prompt || 'Click each item to learn more.')}</div>
    <div class="camp-reveal-grid">
      ${hotspots.map((h, hi) => `
        <button type="button" class="camp-reveal-hotspot${viewed.has(hi) ? ' viewed' : ''}" onclick="_campRevealHotspotClick(${hi})">
          ${h.image ? `<img class="camp-reveal-hotspot-thumb" src="${_esc(h.image)}">` : `<div class="camp-reveal-hotspot-icon">🔍</div>`}
          <div class="camp-reveal-hotspot-label">${_esc(h.label || ('Item ' + (hi + 1)))}</div>
          ${viewed.has(hi) ? '<div class="camp-reveal-hotspot-check">✓</div>' : ''}
        </button>`).join('')}
    </div>
    <div class="camp-reveal-progress">${viewed.size}/${hotspots.length} viewed</div>
    <button type="button" class="btn btn-primary camp-reveal-continue-btn" id="camp-reveal-continue" ${allViewed ? '' : 'disabled'} onclick="_campRevealContinue()">Continue →</button>`;
}

window._campRevealHotspotClick = function (hi) {
  const beat = (camp.stage.beats || [])[camp.beatIdx]; if (!beat) return;
  const h    = (beat.hotspots || [])[hi]; if (!h) return;
  if (!camp.revealViewed) camp.revealViewed = new Set();
  camp.revealViewed.add(hi);
  _campShowRevealPopup(h, () => _campRenderRevealPanel(beat));
};

function _campShowRevealPopup(h, onClose) {
  const popup = _campEnsureRevealPopup();
  popup.style.display = 'flex';
  popup.innerHTML = `
    <div class="camp-reveal-popup-card">
      ${h.image ? `<img class="camp-reveal-popup-img" src="${_esc(h.image)}">` : ''}
      <div class="camp-reveal-popup-label">${_esc(h.label || '')}</div>
      <div class="camp-reveal-popup-text">${_esc(h.text || '')}</div>
      <button type="button" class="btn btn-primary" onclick="_campRevealPopupClose()">Got it</button>
    </div>`;
  window._campRevealPopupCloseCb = onClose;
}

window._campRevealPopupClose = function () {
  const popup = document.getElementById('camp-reveal-popup');
  if (popup) popup.style.display = 'none';
  const cb = window._campRevealPopupCloseCb;
  window._campRevealPopupCloseCb = null;
  if (typeof cb === 'function') cb();
};

// Required-to-continue gate (Decision #1) — the button itself stays
// `disabled` until every hotspot is viewed, this is a defensive second check.
window._campRevealContinue = function () {
  const beat     = (camp.stage.beats || [])[camp.beatIdx]; if (!beat) return;
  const hotspots = beat.hotspots || [];
  const viewed   = camp.revealViewed || new Set();
  if (viewed.size < hotspots.length) return;
  const panel = document.getElementById('camp-reveal-panel'); if (panel) panel.style.display = 'none';
  _campRollSkillDrop(); // Phase 7 — reveal beats count as a graded learning interaction (Decision #5)
  _campBeatAdvance();
};

// ── Dialogue choice beats (Phase 5) ─────────────────────────────────────────────
// New beat type `dialogue` (Decision #10: flavor/narrative only — no scoring,
// no state, no branching to a different next beat). N (2–4) choice buttons;
// selecting any one shows its associated short response line, then a single
// "Continue →" advances to the next beat — every choice leads to the same
// next beat. No DOM for this exists in index.html (out of the Phase 5
// allowlist), so the panel is built and appended to `#camp-scene` at
// runtime, same pattern Phase 4's reveal panel uses.

function _campEnsureDialoguePanel() {
  let panel = document.getElementById('camp-dialogue-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'camp-dialogue-panel';
    panel.className = 'camp-dialogue-panel';
    document.getElementById('camp-scene').appendChild(panel);
  }
  return panel;
}

// Called whenever a non-dialogue beat (or victory/defeat) is shown, so a
// leftover dialogue panel from a prior beat never bleeds into the next —
// same purpose as Phase 4's `_campHideRevealUI`.
function _campHideDialogueUI() {
  const panel = document.getElementById('camp-dialogue-panel'); if (panel) panel.style.display = 'none';
}

function _campShowDialogueBeat(beat) {
  document.getElementById('camp-story-panel').style.display   = 'none';
  document.getElementById('camp-encounter').style.display     = 'none';
  document.getElementById('camp-result').style.display        = 'none';
  document.getElementById('camp-continue-hint').style.display = 'none';
  _campHideRevealUI(); // Phase 5 — leaving a reveal beat, hide its panel/popup
  _campHideDragDropUI(); // Phase 6 — leaving a drag-drop beat, hide its panel
  _campHideSkillBar(); // Phase 7 — leaving an encounter beat, hide the skill bar
  _campSetBg(beat.bg);
  _campRenderDialogueChoices(beat);
}

function _campRenderDialogueChoices(beat) {
  const panel   = _campEnsureDialoguePanel();
  panel.style.display = 'flex';
  const options = beat.options || [];
  panel.innerHTML = `
    <div class="camp-dialogue-prompt">${_esc(beat.prompt || '')}</div>
    <div class="camp-dialogue-choices">
      ${options.map((opt, oi) => `
        <button type="button" class="camp-dialogue-choice" onclick="_campDialogueChoiceClick(${oi})">${_esc(opt.label || ('Option ' + (oi + 1)))}</button>`).join('')}
    </div>`;
}

// Selecting any choice shows its response line — no scoring, no state, no
// branching (Decision #10): every option leads to the exact same next beat.
window._campDialogueChoiceClick = function (oi) {
  const beat = (camp.stage.beats || [])[camp.beatIdx]; if (!beat) return;
  const opt  = (beat.options || [])[oi]; if (!opt) return;
  const panel = _campEnsureDialoguePanel();
  panel.innerHTML = `
    <div class="camp-dialogue-prompt">${_esc(beat.prompt || '')}</div>
    <div class="camp-dialogue-response">${_esc(opt.response || '')}</div>
    <button type="button" class="btn btn-primary camp-dialogue-continue-btn" onclick="_campDialogueContinue()">Continue →</button>`;
};

window._campDialogueContinue = function () {
  const panel = document.getElementById('camp-dialogue-panel'); if (panel) panel.style.display = 'none';
  _campBeatAdvance();
};

// ── Phase 7 (2026-08-10, session 7): explicit window exports ──
// These were previously implicit globals (bare top-level declarations,
// reachable to other files only via classic-script auto-attach-to-window
// behavior). Made explicit ahead of any real bundle/module scoping change
// — found by build/audit-window-exports.js, which checks every symbol with
// a real cross-file consumer, not just ones reachable from onclick markup.
// See PHASE7_WINDOW_EXPORT_AUDIT.md.
window._campHideRevealUI = _campHideRevealUI;
window._campHideDialogueUI = _campHideDialogueUI;
window._campShowRevealBeat = _campShowRevealBeat;
window._campShowDialogueBeat = _campShowDialogueBeat;
