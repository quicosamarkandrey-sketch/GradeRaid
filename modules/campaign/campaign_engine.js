// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/campaign/engine.js
//  Campaign Stage Engine: launch, story scenes, encounter/combat loop,
//  victory, defeat, retry/next/exit navigation.
//  LOAD ORDER: First in the campaign module.
// ═══════════════════════════════════════════════════════════════════════════════

// Phase 8 — shared cross-fade duration (ms) applied uniformly to every beat
// swap by `_campShowBeat()`'s dispatcher hook. Roadmap calls for 150–250ms;
// 180ms is the value actually wired into both this constant and the
// matching `transition` duration on `.camp-scene.camp-beat-fade` in
// campaign.css — keep the two in sync if this is ever retuned.
const CAMP_BEAT_FADE_MS = 180;

// ── Campaign runtime state ─────────────────────────────────────────────────────
// (module-scoped; not on window — only exported helpers are on window)
let camp = {
  worldId: null, stageId: null, stage: null, world: null,
  lives: 3, maxLives: 3,
  sceneIdx: 0, scenePhase: 'story',
  enemyIdx: 0, qIdx: 0, answered: false,
  totalQ: 0, correctQ: 0, bossHp: 100,
  typeTimer: null, fullText: '', charIdx: 0,
  // Phase 1 — beat-list routing (Decision #13). 'legacy' walks the existing
  // scenes/enemies/outro arrays via camp.sceneIdx/camp.scenePhase, untouched.
  // 'beats' walks the new single ordered beats[] list via camp.beatIdx.
  // Phase 2 ports story/encounter playback onto the beats path.
  mode: 'legacy', beatIdx: 0,
  // Phase 2 — whether the current beat-mode stage contains any boss
  // encounter beat (`type:'encounter', boss:true`); drives victory-screen
  // framing the same way legacy stage.type === 'boss' does.
  hasBoss: false,
  // Phase 4 — hotspot-viewed tracker for the currently displayed
  // `interaction`/`reveal` beat (Decision #1: required-to-continue). Reset
  // to a fresh Set every time `_campShowRevealBeat` runs; holds the indices
  // (into `beat.hotspots`) the student has clicked so far.
  revealViewed: null,
  // Phase 6 — placement tracker for the currently displayed
  // `interaction`/`dragdrop` beat (Decision #1/#11: required-to-continue,
  // both match and sequence modes). Reset to a fresh object every time
  // `_campShowDragDropBeat` runs — see `_campShowDragDropBeat` for shape.
  dragState: null,
  // Phase 7 — local mirror of DB.studentSkills[currentUser.id] (Decision
  // #5), refreshed at stage launch and after every grant/spend so the
  // skill bar can render synchronously without re-reading DB on every
  // frame. Shape: { hint, heal, shield } (counts, never negative).
  skillCounts: null,
  // Phase 7 — which wrong-option indices a Hint has eliminated on the
  // *currently displayed* encounter question. Fresh Set every time
  // `_campShowEncounterBeat` shows a new question (Decision #6 — Hint's
  // effect is scoped to "the current question").
  hintEliminated: null,
  // Phase 7 — Shield charge armed for this stage attempt (Decision #6):
  // true between the moment a student spends a Shield and the next wrong
  // answer it blocks. Reset at beat-stage launch; consumed in
  // `_campAnswerBeat`'s wrong-answer branch.
  shieldActive: false,
};

// Phase 53 — campaign per-section visibility. Mirrors the "opt-in scoping"
// pattern renderBadges() (ach_student_page.js) and renderStudentQuizzes()/
// dashInMySection (index.html) already use: a world with no rows in
// campaignSectionAssignments is unassigned → visible to every section this
// teacher advises (same "global by default" semantics used everywhere else
// content is section-gated). A world assigned to one or more sections is
// only shown to a student in one of those sections. A world the student has
// already cleared at least one stage of stays reachable regardless — the
// same "don't yank progress away" carve-out achievements/quizzes use for
// already-earned/already-completed content.
window.getVisibleCampaignWorlds = function () {
  if (currentRole !== 'student' || !currentUser) return DB.stageMap || [];
  const assignments = DB.campaignSectionAssignments || {};
  const myClassId   = currentUser.classId || 'default-class';
  return (DB.stageMap || []).filter(w => {
    const assigned = assignments[w.id];
    if (!assigned || assigned.length === 0 || assigned.includes(myClassId)) return true;
    return (w.stages || []).some(s => isStageCleared(s.id));
  });
};

// ── Progress helpers ──────────────────────────────────────────────────────────

window.isStageCleared = function (stageId) {
  if (!currentUser) return false;
  if (!DB.stageProgress) DB.stageProgress = {};
  return !!((DB.stageProgress[currentUser.id] || {})[stageId]);
};

window.markStageCleared = function (stageId) {
  if (!currentUser) return;
  DB = loadDB();
  if (!DB.stageProgress) DB.stageProgress = {};
  if (!DB.stageProgress[currentUser.id]) DB.stageProgress[currentUser.id] = {};
  DB.stageProgress[currentUser.id][stageId] = true;
  saveDB();
};

window.getMapProgress = function () {
  const allStages = [];
  getVisibleCampaignWorlds().forEach(w => w.stages.forEach(s => allStages.push(s)));
  const cleared  = allStages.filter(s => isStageCleared(s.id)).length;
  let activeId   = null;
  for (const s of allStages) { if (!isStageCleared(s.id)) { activeId = s.id; break; } }
  return { cleared, total: allStages.length, activeId };
};

window.getStageProgress = function (st) {
  if (!st) return { completedStageIds: new Set(), activeStageId: null, totalClear: 0 };
  const allStages        = [];
  getVisibleCampaignWorlds().forEach(w => w.stages.forEach(s => allStages.push(s)));
  const completedStageIds = new Set();
  let activeStageId       = null;
  let totalClear          = 0;
  for (const stage of allStages) {
    if (isStageCleared(stage.id)) { completedStageIds.add(stage.id); totalClear++; }
    else if (!activeStageId) { activeStageId = stage.id; }
  }
  return { completedStageIds, activeStageId, totalClear };
};

// ── Launch ────────────────────────────────────────────────────────────────────

window.launchCampaignStage = function (worldId, stageId) {
  closeStageMap();
  const world = getVisibleCampaignWorlds().find(w => w.id === worldId);
  if (!world) return;
  const stage = world.stages.find(s => s.id === stageId);
  if (!stage) return toast('Stage not found!');

  // Phase 1 — beat-list routing (Decision #13). Presence-based, no explicit
  // flag: a `beats` array on the stage routes to the new beat-player path.
  // Its absence falls through to the legacy scene/encounter/outro renderer
  // below, completely untouched.
  if (Array.isArray(stage.beats)) {
    return _campLaunchBeatStage(worldId, stageId, world, stage);
  }

  if (!stage.scenes || !stage.enemies) return toast('This stage has no content yet. Ask your instructor to add scenes and questions.', '#ffb95f');

  camp.worldId = worldId; camp.stageId = stageId; camp.stage = stage; camp.world = world;
  camp.mode = 'legacy';
  camp.lives = stage.lives || 3; camp.maxLives = stage.lives || 3;
  camp.sceneIdx = 0; camp.scenePhase = 'story'; camp.enemyIdx = 0; camp.qIdx = 0;
  camp.answered = false; camp.totalQ = 0; camp.correctQ = 0; camp.bossHp = 100;
  (stage.enemies || []).forEach(e => { camp.totalQ += (e.questions || []).length; });

  document.getElementById('campaign-overlay').classList.add('open');
  _campUpdateHUD();
  _campShowScene();
  document.getElementById('camp-scene').onclick = _campSceneClick;
  document.addEventListener('keydown', _campKeyHandler);
};

window._campKeyHandler = function (e) {
  if (e.key === ' ' || e.key === 'Enter') _campSceneClick();
};

// ── Beat-list playback (Phase 1 routing + Phase 2 story/encounter port) ────────
// `_campLaunchBeatStage`/`_campShowBeat`/`_campBeatAdvance` are the beat-mode
// counterparts of `launchCampaignStage`'s legacy body / `_campAdvance` below —
// same behavior, ported onto a single ordered `beats[]` list walked by
// `camp.beatIdx` instead of the legacy two-phase `sceneIdx`/`scenePhase`
// state. The legacy functions are not modified by this port.

function _campLaunchBeatStage(worldId, stageId, world, stage) {
  camp.worldId = worldId; camp.stageId = stageId; camp.stage = stage; camp.world = world;
  camp.mode = 'beats';
  camp.beatIdx = 0; camp.qIdx = 0; camp.answered = false;
  camp.lives = stage.lives || 3; camp.maxLives = stage.lives || 3;
  camp.totalQ = 0; camp.correctQ = 0; camp.bossHp = 100;
  // Mirrors legacy's totalQ sum (all enemies' questions) — here, all
  // `encounter` beats' questions, since an encounter beat is one beat's
  // worth of what used to be one `enemy` entry.
  (stage.beats || []).forEach(b => { if (b.type === 'encounter') camp.totalQ += (b.questions || []).length; });
  camp.hasBoss = (stage.beats || []).some(b => b.type === 'encounter' && b.boss === true);
  // Phase 7 — fresh per stage attempt: pull the student's current skill
  // counts into the local mirror, and clear any Shield charge/Hint state
  // left over from a previous attempt (Decision #4 — retries are unlimited
  // and start clean, same as lives/bossHp above).
  camp.skillCounts    = _campGetSkillCounts();
  camp.shieldActive   = false;
  camp.hintEliminated = new Set();

  document.getElementById('campaign-overlay').classList.add('open');
  _campUpdateHUD();
  _campShowBeat();
  document.getElementById('camp-scene').onclick = _campSceneClick;
  document.addEventListener('keydown', _campKeyHandler);
}

function _campShowBeat() {
  const beats = camp.stage.beats || [];
  const beat  = beats[camp.beatIdx];
  if (!beat) { _campVictory(); return; }

  // Phase 8 — single dispatcher hook for the whole polish pass (Reference
  // Facts UX finding: the instant display:none/flex swap between beats read
  // as an abrupt screen-snap; everything within a panel — typewriter, panel
  // swaps, screen shake — was already fine). Two things happen here, both
  // scoped to this one function per the phase's allowlist:
  //
  // 1) A shared cross-fade class (`camp-beat-fade`, see campaign.css) is
  //    applied to `#camp-scene` immediately, and removed once the next
  //    beat's render call below has run. Each per-type render function
  //    (`_campShowEncounterBeat` / `_campShowRevealBeat` /
  //    `_campShowDragDropBeat` / `_campShowDialogueBeat` /
  //    `_campShowStoryBeat`) still does its own internal display:none/flex
  //    toggling exactly as every prior phase left it — untouched — this
  //    wrapper just fades the shared container out and back in around that
  //    swap instead of each panel independently snapping.
  // 2) Mini-monster vs. boss re-skin (Decision #2 — cosmetic only, no
  //    mechanic change): `beat.boss` is only ever meaningful for an
  //    `encounter` beat, and this dispatcher is the one place that already
  //    inspects `beat` before deciding what to render, so it's the natural
  //    single hook for toggling a `camp-mini-mode`/`camp-boss-mode` class on
  //    `#camp-encounter` too (styled in campaign.css) — cleared on every
  //    beat so it can never leak onto a later non-encounter beat.
  const sceneEl  = document.getElementById('camp-scene');
  const encPanel = document.getElementById('camp-encounter');
  if (encPanel) {
    encPanel.classList.remove('camp-mini-mode', 'camp-boss-mode');
    if (beat.type === 'encounter') encPanel.classList.add(beat.boss ? 'camp-boss-mode' : 'camp-mini-mode');
  }

  if (!sceneEl) { _campRenderBeatByType(beat); return; } // defensive — test/harness environments without full DOM
  sceneEl.classList.add('camp-beat-fade');
  setTimeout(() => {
    _campRenderBeatByType(beat);
    // rAF so the browser paints the new panel's initial (hidden) state
    // before the fade-back-in transition starts, avoiding a flash of the
    // old panel's content mid-fade.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => sceneEl.classList.remove('camp-beat-fade'));
    else sceneEl.classList.remove('camp-beat-fade');
  }, CAMP_BEAT_FADE_MS);
}

// Extracted, byte-for-byte identical type-dispatch body that `_campShowBeat`
// used to run inline — see the Phase 8 note above for why it's now called
// from inside the fade wrapper instead of directly.
function _campRenderBeatByType(beat) {
  if (beat.type === 'encounter') { _campShowEncounterBeat(beat); return; }
  // Phase 4 — new `interaction`/`reveal` beat type (click-to-reveal
  // hotspots, Decisions #1/#8/#9). Every other beat type still falls
  // through to the story renderer, same as before this phase.
  if (beat.type === 'interaction' && beat.subtype === 'reveal') { _campShowRevealBeat(beat); return; }
  // Phase 6 — new `interaction`/`dragdrop` beat type (Decision #11: both
  // drag-onto-target/matching and drag-into-sequence/ordering modes,
  // teacher picks per beat). Every other beat type still falls through to
  // the story renderer, same as before this phase.
  if (beat.type === 'interaction' && beat.subtype === 'dragdrop') { _campShowDragDropBeat(beat); return; }
  // Phase 5 — new `dialogue` beat type (Decision #10: flavor/narrative only,
  // no branching/reward/state effect). Every other beat type still falls
  // through to the story renderer, same as before this phase.
  if (beat.type === 'dialogue') { _campShowDialogueBeat(beat); return; }
  _campShowStoryBeat(beat); // 'story' is the only other type this phase builds
}

// Click-to-continue advance for the currently displayed story beat (guarded
// by _campSceneClick's story-panel-visible check, same as legacy) — moves to
// whatever the next beat is, story or encounter.
function _campBeatAdvance() {
  camp.beatIdx++;
  camp.qIdx = 0;
  _campShowBeat();
}

// Port of `_campShowScene`, reading straight off the beat object instead of
// `stage.scenes[camp.sceneIdx]`. Typewriter/click-to-reveal/continue
// behavior (`_campTypewrite`, `_campSceneClick`) is shared, unchanged.
function _campShowStoryBeat(beat) {
  document.getElementById('camp-story-panel').style.display   = 'block';
  document.getElementById('camp-encounter').style.display     = 'none';
  document.getElementById('camp-result').style.display        = 'none';
  document.getElementById('camp-continue-hint').style.display = 'none';
  _campHideRevealUI(); // Phase 4 — leaving a reveal beat, hide its panel/popup
  _campHideDialogueUI(); // Phase 5 — leaving a dialogue beat, hide its panel
  _campHideDragDropUI(); // Phase 6 — leaving a drag-drop beat, hide its panel
  _campHideSkillBar(); // Phase 7 — leaving an encounter beat, hide the skill bar
  _campSetBg(beat.bg);
  document.getElementById('camp-speaker').textContent = beat.speaker || 'NARRATOR';
  _campTypewrite(beat.text || '');
}

// Port of `_campShowEncounter`. An encounter beat is the equivalent of one
// legacy `enemy` entry (sprite/name/title/questions), plus a `boss:true/false`
// flag (Decision #2) — mechanically identical either way; the flag only
// drives HUD framing (see `_campUpdateHUD`), and full visual differentiation
// (smaller sprite, lower-key framing for minis) is Phase 8's polish pass, not
// this phase's. Exhausting the beat's questions advances to the next beat
// (there is no enemyIdx here — a beat only ever holds one encounter).
function _campShowEncounterBeat(beat) {
  const questions = beat.questions || [];
  if (camp.qIdx >= questions.length) { _campBeatAdvance(); return; }

  document.getElementById('camp-story-panel').style.display = 'none';
  document.getElementById('camp-encounter').style.display   = 'flex';
  document.getElementById('camp-result').style.display      = 'none';
  _campHideRevealUI(); // Phase 4 — leaving a reveal beat, hide its panel/popup
  _campHideDialogueUI(); // Phase 5 — leaving a dialogue beat, hide its panel
  _campHideDragDropUI(); // Phase 6 — leaving a drag-drop beat, hide its panel
  _campSetBg('#150a2e');

  const sprite = beat.sprite || '👹';
  const sprEl  = document.getElementById('camp-enemy-sprite');
  if (sprEl) {
    if (sprite && sprite.indexOf('<') !== -1) sprEl.innerHTML = sprite;
    else sprEl.textContent = sprite;
  }
  document.getElementById('camp-enemy-title').textContent = beat.title || (beat.boss ? '⚠️ BOSS BATTLE' : 'ENEMY ENCOUNTER');

  const q = questions[camp.qIdx];
  document.getElementById('camp-q-text').textContent    = q.q;
  document.getElementById('camp-q-progress').textContent = `QUESTION ${camp.qIdx + 1} OF ${questions.length}  ·  ❤️ ${camp.lives}/${camp.maxLives}`;
  document.getElementById('camp-options').innerHTML = q.opts.map((opt, i) =>
    `<button class="camp-opt" id="camp-opt-${i}" onclick="campAnswer(${i})">
      <span class="camp-opt-letter">${String.fromCharCode(65 + i)}</span>${_esc(opt)}
    </button>`
  ).join('');
  camp.answered = false;
  camp.hintEliminated = new Set(); // Phase 7 — fresh per question (Decision #6 scopes Hint to "current question")
  _campUpdateHUD();
  _campRenderSkillBar(); // Phase 7 — encounter-only skill-use buttons
}

// Port of the body of `window.campAnswer`, dispatched to from the shared
// `window.campAnswer` below. Identical heart-loss/scoring/shake/retry timing
// to the legacy version; only the "what's next" step differs (advance to the
// next beat instead of the next question-within-enemy-or-next-enemy).
function _campAnswerBeat(idx) {
  if (camp.answered) return;
  camp.answered = true;
  const beat    = (camp.stage.beats || [])[camp.beatIdx];
  const q       = beat.questions[camp.qIdx];
  const correct = idx === q.answer;

  q.opts.forEach((_, i) => {
    const el = document.getElementById('camp-opt-' + i); if (!el) return;
    el.onclick = null;
    if (i === q.answer)          el.classList.add('correct');
    else if (i === idx && !correct) el.classList.add('wrong');
  });
  _campRenderSkillBar(); // Phase 7 — buttons disable the instant an answer locks in

  if (correct) {
    camp.correctQ++;
    camp.bossHp = Math.max(0, camp.bossHp - Math.round(100 / Math.max(1, camp.totalQ)));
    _campUpdateHUD();
    setTimeout(() => { camp.qIdx++; _campShowEncounterBeat(beat); }, 1200);
  } else {
    // Phase 7 — Decision #6: a spent Shield blocks this specific wrong
    // answer from costing a heart, then is consumed. Everything else about
    // a wrong answer (shake, option marking, retry timing) is unchanged.
    if (camp.shieldActive) {
      camp.shieldActive = false;
      if (typeof toast === 'function') toast('🛡️ Shield blocked the damage!', '#60a5fa');
    } else {
      camp.lives--;
    }
    _campUpdateHUD();
    const scene = document.getElementById('camp-scene');
    scene.classList.add('shake');
    setTimeout(() => scene.classList.remove('shake'), 400);
    if (camp.lives <= 0) { setTimeout(() => _campDefeat(), 1000); }
    else                 { setTimeout(() => { camp.qIdx++; _campShowEncounterBeat(beat); }, 1400); }
  }
}

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

// ── Drag-and-drop beats (Phase 6) ───────────────────────────────────────────────
// New beat type `interaction` (subtype `dragdrop`, Decision #11): two modes,
// teacher-picked per beat — `match` (drag items onto labeled targets) and
// `sequence` (drag items into the correct order). Required-to-continue like
// Phase 4's reveal beat (Decision #1) — Continue stays disabled until every
// item is placed correctly.
//
// Dragging is implemented with Pointer Events (pointerdown/move/up), not the
// HTML5 Drag-and-Drop API `classroom_builder.js` uses for its own drag-drop
// (checked directly per the roadmap's named precedent) — HTML5 DnD has no
// native touch support, so it can't satisfy this phase's "works on desktop
// and touch" requirement on its own. Pointer Events cover mouse, touch, and
// pen through one code path instead. `classroom_builder.js`'s
// occupied-slot-swap *logic* is still the reused pattern here, just wired
// through pointer events rather than `dragstart`/`dragover`/`drop`.
//
// No DOM for this exists in index.html (out of the Phase 6 allowlist), so
// the panel is built and appended to `#camp-scene` at runtime, same pattern
// Phase 4's reveal panel and Phase 5's dialogue panel use.

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

// ── Random skill drops & skill usage (Phase 7) ──────────────────────────────────
// Decision #5: Hint / Heal / Shield are earned randomly through EVERY
// completed learning interaction. Dialogue is flavor-only per Decision #10
// and does not count as a graded interaction, so its completion does not
// roll a drop — only reveal and drag-drop completions call
// `_campRollSkillDrop()` (see their Continue handlers above). Decision #6
// confirms the three effects: Hint eliminates one wrong choice on the
// current question, Heal restores 1 heart, Shield blocks the next wrong
// answer from costing a heart.
//
// DROP_RATE is a starting, deliberately conservative value per the roadmap's
// own suggestion ("10–15% as a starting point... confirmed with you before
// or during this phase") — flagged here as tunable, not final; the roadmap
// explicitly defers rate *tuning* beyond this initial number to a future
// phase (see CAMPAIGN_REDESIGN_CHANGELOG.md's Deferred/Out of Scope list).
const CAMP_SKILL_DROP_RATE = 0.12; // TUNABLE — 12%, mid-point of the roadmap's suggested 10–15% range.
const CAMP_SKILL_TYPES = ['hint', 'heal', 'shield'];
const CAMP_SKILL_META = {
  hint:   { emoji: '💡', label: 'Hint',   color: '#fcd34d' },
  heal:   { emoji: '💗', label: 'Heal',   color: '#4edea3' },
  shield: { emoji: '🛡️', label: 'Shield', color: '#60a5fa' },
};

// Reads the student's current skill counts out of DB.studentSkills[id]
// (the Phase 7 cache slot — see db-schema.js), defaulting every skill to 0
// for a student with no rows yet (never granted anything).
function _campGetSkillCounts() {
  if (!currentUser || !DB || !DB.studentSkills) return { hint: 0, heal: 0, shield: 0 };
  const row = DB.studentSkills[currentUser.id] || {};
  return { hint: row.hint || 0, heal: row.heal || 0, shield: row.shield || 0 };
}

// Applies a local optimistic delta to DB.studentSkills[studentId][skill],
// clamped at 0 (never negative — mirrors adjust_student_stats()'s
// `greatest(0, ...)` clamp server-side). Same "mutate cache, saveDB()"
// shape every other local-first write in this file already uses (see
// markStageCleared() above).
function _campAdjustSkillLocal(studentId, skill, delta) {
  if (!studentId) return;
  DB = loadDB();
  if (!DB.studentSkills) DB.studentSkills = {};
  if (!DB.studentSkills[studentId]) DB.studentSkills[studentId] = { hint: 0, heal: 0, shield: 0 };
  const current = DB.studentSkills[studentId][skill] || 0;
  DB.studentSkills[studentId][skill] = Math.max(0, current + delta);
  saveDB();
  if (currentUser && currentUser.id === studentId) camp.skillCounts = _campGetSkillCounts();
}

// Fire-and-forget RPC sync for a skill-count delta — same posture as
// utils.js's syncStudentStatsToServer() (local optimistic mutation already
// applied by the caller above; this just reconciles Supabase in the
// background and folds the authoritative row back in on success). Written
// locally in this file rather than added to utils.js/db-service.js's RPC
// helpers, since neither is in this phase's allowlist. Calls
// adjust_student_skill_count() — see
// supabase/phase68_campaign_student_skills.sql.
function _campSyncSkillDeltaToServer(studentId, skill, delta) {
  if (!studentId || !delta) return;
  if (typeof DBService === 'undefined' || typeof DBService.rpc !== 'function') return;
  DBService.rpc('adjust_student_skill_count', {
    p_student_id: studentId, p_skill: skill, p_delta: delta,
  }).then(function (result) {
    const error = result && result.error;
    const data  = result && result.data;
    if (error) {
      // Network/RLS failure: local cache already has the optimistic value —
      // same "stay on local cache, retry next mutation" posture as every
      // other fire-and-forget sync helper in this app. No further action.
      console.warn('[EduQuest] campaign skill sync: RPC failed for', studentId, skill, error);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return;
    try {
      if (!DB.studentSkills) DB.studentSkills = {};
      DB.studentSkills[studentId] = {
        hint: row.hint_count || 0, heal: row.heal_count || 0, shield: row.shield_count || 0,
      };
      if (currentUser && currentUser.id === studentId) camp.skillCounts = _campGetSkillCounts();
    } catch (e) { /* best-effort only */ }
  }).catch(function (e) {
    console.warn('[EduQuest] campaign skill sync: RPC threw for', studentId, skill, e);
  });
}

// Called from the Continue handler of every beat type that counts as a
// "completed learning interaction" per Decision #5 (currently: reveal and
// drag-drop — dialogue is excluded, see this section's header comment).
// Rolls once per completion; a miss is a silent no-op (no toast, no
// inventory change) so most completions pass through unnoticed, same
// "occasional, not guaranteed" feel the roadmap describes.
function _campRollSkillDrop() {
  if (camp.mode !== 'beats' || currentRole !== 'student' || !currentUser) return;
  if (Math.random() >= CAMP_SKILL_DROP_RATE) return;
  const skill = CAMP_SKILL_TYPES[Math.floor(Math.random() * CAMP_SKILL_TYPES.length)];
  _campAdjustSkillLocal(currentUser.id, skill, 1);
  _campSyncSkillDeltaToServer(currentUser.id, skill, 1);
  const meta = CAMP_SKILL_META[skill];
  if (typeof toast === 'function') toast(`${meta.emoji} Skill found: ${meta.label}!`, meta.color);
}

// ── Skill bar (encounter beat only, Phase 7) ────────────────────────────────────
// Built and appended into `#camp-encounter` at runtime (out of the Phase 7
// allowlist, same "no DOM in index.html for this yet" reasoning Phases
// 4–6 used for their own panels) — a child of `#camp-encounter` rather than
// `#camp-scene`, since it only ever needs to be visible while an encounter
// beat is showing and `#camp-encounter` itself already toggles display:none
// for every other beat type, hiding this along with it for free. The
// explicit `_campHideSkillBar()` calls alongside every other beat's
// existing hide-calls below are defensive symmetry, not strictly required.
//
// Legacy (non-beat) encounters never call `_campShowEncounterBeat` — only
// `_campShowEncounter` (a separate, untouched function) — so the skill bar
// never appears on a legacy stage, matching this phase's "beat-mode only"
// scope (Phase 7 depends on Phase 2's *beat* encounter specifically).

function _campEnsureSkillBar() {
  let bar = document.getElementById('camp-skill-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'camp-skill-bar';
    // No campaign.css entry exists for this yet (styles/modules/campaign.css
    // is outside this phase's allowlist) — styled inline so it's usable
    // without one; a future polish phase can move this to a real class.
    bar.style.cssText = 'display:flex;gap:10px;justify-content:center;margin-top:14px;flex-wrap:wrap;';
    document.getElementById('camp-encounter').appendChild(bar);
  }
  return bar;
}

function _campHideSkillBar() {
  const bar = document.getElementById('camp-skill-bar');
  if (bar) bar.style.display = 'none';
}

function _campSkillBtnHTML(skill, count, disabled) {
  const meta = CAMP_SKILL_META[skill];
  const bg = disabled ? 'rgba(255,255,255,.04)' : 'rgba(255,255,255,.08)';
  const border = disabled ? 'rgba(255,255,255,.08)' : meta.color;
  const opacity = disabled ? '.45' : '1';
  return `<button type="button" onclick="_campUseSkill('${skill}')" ${disabled ? 'disabled' : ''}
    style="display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:10px;cursor:${disabled ? 'default' : 'pointer'};
    background:${bg};border:1.5px solid ${border};opacity:${opacity};font-family:var(--fb,inherit);font-weight:700;
    font-size:12px;color:#fff;">
    <span style="font-size:15px">${meta.emoji}</span>${meta.label}
    <span style="font-family:var(--fm,monospace);font-size:11px;color:${meta.color}">×${count}</span>
  </button>`;
}

// Re-rendered after every render of the question options (so it always
// reflects the current question's Hint availability) and after every
// grant/spend (so counts stay current). Only shown for a student session
// in beat mode — a teacher previewing a stage, or an offline/local session
// with no currentUser, sees no skill bar (nothing to spend).
function _campRenderSkillBar() {
  if (camp.mode !== 'beats' || currentRole !== 'student' || !currentUser) { _campHideSkillBar(); return; }
  const beat = (camp.stage.beats || [])[camp.beatIdx];
  if (!beat || beat.type !== 'encounter') { _campHideSkillBar(); return; }

  const bar    = _campEnsureSkillBar();
  bar.style.display = 'flex';
  const counts = camp.skillCounts || _campGetSkillCounts();
  const hintExhausted = (() => {
    const q = (beat.questions || [])[camp.qIdx];
    if (!q) return true;
    const wrongCount = (q.opts || []).length - 1;
    return (camp.hintEliminated ? camp.hintEliminated.size : 0) >= wrongCount;
  })();

  bar.innerHTML =
    _campSkillBtnHTML('hint',   counts.hint,   camp.answered || counts.hint   <= 0 || hintExhausted) +
    _campSkillBtnHTML('heal',   counts.heal,   camp.answered || counts.heal   <= 0 || camp.lives >= camp.maxLives) +
    _campSkillBtnHTML('shield', counts.shield, camp.answered || counts.shield <= 0 || camp.shieldActive);
}

// Spends one unit of `skill` and applies its effect (Decision #6). Guards
// mirror the button's own `disabled` state as a defensive second check,
// same "button disabled + function also checks" pattern Phase 4's
// `_campRevealContinue` uses for its required-to-continue gate.
window._campUseSkill = function (skill) {
  if (camp.mode !== 'beats' || currentRole !== 'student' || !currentUser) return;
  if (camp.answered) return;
  const beat = (camp.stage.beats || [])[camp.beatIdx];
  if (!beat || beat.type !== 'encounter') return;
  const counts = camp.skillCounts || _campGetSkillCounts();
  if ((counts[skill] || 0) <= 0) return;

  if (skill === 'hint') {
    const q = (beat.questions || [])[camp.qIdx]; if (!q) return;
    if (!camp.hintEliminated) camp.hintEliminated = new Set();
    const remaining = (q.opts || []).map((_, i) => i).filter(i => i !== q.answer && !camp.hintEliminated.has(i));
    if (!remaining.length) return; // every wrong choice already eliminated
    const pick = remaining[Math.floor(Math.random() * remaining.length)];
    camp.hintEliminated.add(pick);
    const el = document.getElementById('camp-opt-' + pick);
    if (el) {
      el.onclick = null;
      el.disabled = true;
      el.style.opacity = '.35';
      el.style.textDecoration = 'line-through';
    }
  } else if (skill === 'heal') {
    if (camp.lives >= camp.maxLives) return;
    camp.lives = Math.min(camp.maxLives, camp.lives + 1);
    _campUpdateHUD();
  } else if (skill === 'shield') {
    if (camp.shieldActive) return;
    camp.shieldActive = true;
  }

  _campAdjustSkillLocal(currentUser.id, skill, -1);
  _campSyncSkillDeltaToServer(currentUser.id, skill, -1);
  _campRenderSkillBar();
};

// ── Story scenes ──────────────────────────────────────────────────────────────

function _campSceneClick() {
  if (document.getElementById('camp-story-panel').style.display === 'none') return;
  if (camp.charIdx < camp.fullText.length) {
    clearInterval(camp.typeTimer);
    document.getElementById('camp-narr-text').textContent = camp.fullText;
    camp.charIdx = camp.fullText.length;
    document.getElementById('camp-continue-hint').style.display = 'block';
    return;
  }
  // Phase 1 — beat-list routing (Decision #13): beat-mode stages advance
  // through the new beats[] list; legacy stages fall through to the
  // existing scene/encounter/outro advance logic, untouched below.
  if (camp.mode === 'beats') { _campBeatAdvance(); return; }
  _campAdvance();
}

function _campAdvance() {
  if (camp.scenePhase === 'story') {
    camp.sceneIdx++;
    const scenes = camp.stage.scenes || [];
    if (camp.sceneIdx < scenes.length) _campShowScene();
    else { camp.scenePhase = 'encounter'; camp.enemyIdx = 0; camp.qIdx = 0; _campShowEncounter(); }
  } else if (camp.scenePhase === 'outro') {
    camp.sceneIdx++;
    const outro = camp.stage.outro || [];
    if (camp.sceneIdx < outro.length) _campShowOutroScene();
    else _campVictory();
  }
}

function _campUpdateHUD() {
  document.getElementById('camp-stage-label').textContent = camp.world.icon + ' ' + camp.world.label;
  document.getElementById('camp-title-hud').textContent   = camp.stage.title;
  document.getElementById('camp-lives').innerHTML = Array(camp.maxLives).fill(0).map((_, i) =>
    `<span class="camp-heart${i >= camp.lives ? ' lost' : ''}">❤️</span>`
  ).join('');

  if (camp.mode === 'beats') {
    // Phase 2 — beat mode: the enemy bar tracks whichever encounter beat is
    // currently active (mini or boss, Decision #2 — mechanically identical,
    // cosmetic differentiation is Phase 8's polish pass).
    const beat        = (camp.stage.beats || [])[camp.beatIdx];
    const inEncounter = !!beat && beat.type === 'encounter';
    const bar         = document.getElementById('camp-enemy-bar');
    bar.style.display = inEncounter ? 'block' : 'none';
    if (inEncounter) {
      document.getElementById('camp-enemy-name').textContent = beat.name || (beat.boss ? 'BOSS' : 'ENEMY');
      document.getElementById('camp-enemy-hp').style.width   = camp.bossHp + '%';
    }
    return;
  }

  const isBoss = camp.stage.type === 'boss';
  const bar    = document.getElementById('camp-enemy-bar');
  bar.style.display = isBoss ? 'block' : 'none';
  if (isBoss) {
    const en = (camp.stage.enemies || [])[camp.enemyIdx];
    document.getElementById('camp-enemy-name').textContent = en ? en.name : 'BOSS';
    document.getElementById('camp-enemy-hp').style.width   = camp.bossHp + '%';
  }
}

function _campSetBg(color) {
  document.getElementById('camp-bg').style.background = `radial-gradient(ellipse at 30% 40%,${color || '#1a0a2e'} 0%,#0a0914 100%)`;
}

function _campShowScene() {
  const sc = (camp.stage.scenes || [])[camp.sceneIdx]; if (!sc) return;
  document.getElementById('camp-story-panel').style.display  = 'block';
  document.getElementById('camp-encounter').style.display    = 'none';
  document.getElementById('camp-result').style.display       = 'none';
  document.getElementById('camp-continue-hint').style.display = 'none';
  _campSetBg(sc.bg);
  document.getElementById('camp-speaker').textContent = sc.speaker || 'NARRATOR';
  _campTypewrite(sc.text || '');
}

function _campTypewrite(text) {
  camp.fullText = text; camp.charIdx = 0;
  const el = document.getElementById('camp-narr-text'); el.textContent = '';
  clearInterval(camp.typeTimer);
  camp.typeTimer = setInterval(() => {
    if (camp.charIdx < camp.fullText.length) { el.textContent += camp.fullText[camp.charIdx]; camp.charIdx++; }
    else { clearInterval(camp.typeTimer); document.getElementById('camp-continue-hint').style.display = 'block'; }
  }, 22);
}

// ── Encounter / combat loop ───────────────────────────────────────────────────

function _campShowEncounter() {
  const enemies = camp.stage.enemies || [];
  if (camp.enemyIdx >= enemies.length) {
    camp.scenePhase = 'outro'; camp.sceneIdx = 0;
    const o = camp.stage.outro || [];
    o.length ? _campShowOutroScene() : _campVictory();
    return;
  }
  const enemy     = enemies[camp.enemyIdx];
  const questions = enemy.questions || [];
  if (camp.qIdx >= questions.length) { camp.enemyIdx++; camp.qIdx = 0; _campShowEncounter(); return; }

  document.getElementById('camp-story-panel').style.display = 'none';
  document.getElementById('camp-encounter').style.display   = 'flex';
  document.getElementById('camp-result').style.display      = 'none';
  _campSetBg('#150a2e');

  const sprite = enemy.sprite || '👹';
  const sprEl  = document.getElementById('camp-enemy-sprite');
  if (sprEl) {
    if (sprite && sprite.indexOf('<') !== -1) sprEl.innerHTML = sprite;
    else sprEl.textContent = sprite;
  }
  document.getElementById('camp-enemy-title').textContent = enemy.title || 'ENEMY ENCOUNTER';

  const q = questions[camp.qIdx];
  document.getElementById('camp-q-text').textContent    = q.q;
  document.getElementById('camp-q-progress').textContent = `QUESTION ${camp.qIdx + 1} OF ${questions.length}  ·  ❤️ ${camp.lives}/${camp.maxLives}`;
  document.getElementById('camp-options').innerHTML = q.opts.map((opt, i) =>
    `<button class="camp-opt" id="camp-opt-${i}" onclick="campAnswer(${i})">
      <span class="camp-opt-letter">${String.fromCharCode(65 + i)}</span>${_esc(opt)}
    </button>`
  ).join('');
  camp.answered = false;
  _campUpdateHUD();
}

window.campAnswer = function (idx) {
  // Phase 2 — same dispatch principle as _campSceneClick: beat-mode stages
  // use the ported _campAnswerBeat; legacy stages use the untouched
  // original body below (now _campAnswerLegacy).
  if (camp.mode === 'beats') { _campAnswerBeat(idx); return; }
  _campAnswerLegacy(idx);
};

function _campAnswerLegacy(idx) {
  if (camp.answered) return;
  camp.answered = true;
  const enemy   = camp.stage.enemies[camp.enemyIdx];
  const q       = enemy.questions[camp.qIdx];
  const correct = idx === q.answer;

  q.opts.forEach((_, i) => {
    const el = document.getElementById('camp-opt-' + i); if (!el) return;
    el.onclick = null;
    if (i === q.answer)          el.classList.add('correct');
    else if (i === idx && !correct) el.classList.add('wrong');
  });

  if (correct) {
    camp.correctQ++;
    camp.bossHp = Math.max(0, camp.bossHp - Math.round(100 / Math.max(1, camp.totalQ)));
    _campUpdateHUD();
    setTimeout(() => { camp.qIdx++; _campShowEncounter(); }, 1200);
  } else {
    camp.lives--;
    _campUpdateHUD();
    const scene = document.getElementById('camp-scene');
    scene.classList.add('shake');
    setTimeout(() => scene.classList.remove('shake'), 400);
    if (camp.lives <= 0) { setTimeout(() => _campDefeat(), 1000); }
    else                 { setTimeout(() => { camp.qIdx++; _campShowEncounter(); }, 1400); }
  }
}

function _campShowOutroScene() {
  const sc = (camp.stage.outro || [])[camp.sceneIdx]; if (!sc) return;
  document.getElementById('camp-story-panel').style.display   = 'block';
  document.getElementById('camp-encounter').style.display     = 'none';
  document.getElementById('camp-continue-hint').style.display = 'none';
  _campSetBg(sc.bg || '#0e1a0e');
  document.getElementById('camp-speaker').textContent = sc.speaker || 'NARRATOR';
  _campTypewrite(sc.text || '');
}

// ── Victory / defeat ──────────────────────────────────────────────────────────

function _campVictory() {
  clearInterval(camp.typeTimer);
  document.getElementById('camp-story-panel').style.display  = 'none';
  document.getElementById('camp-encounter').style.display    = 'none';
  document.getElementById('camp-result').style.display       = 'flex';
  document.getElementById('camp-enemy-bar').style.display    = 'none';
  _campHideRevealUI(); // Phase 4 — a stage can end right after a reveal beat
  _campHideDialogueUI(); // Phase 5 — a stage can end right after a dialogue beat
  _campHideDragDropUI(); // Phase 6 — a stage can end right after a drag-drop beat
  _campHideSkillBar(); // Phase 7 — a stage can end right after an encounter beat

  const accuracy    = Math.round(camp.correctQ / Math.max(1, camp.totalQ) * 100);
  const xpEarned    = Math.round(camp.stage.xp    * (accuracy / 100));
  const coinsEarned = Math.round(camp.stage.coins  * (accuracy / 100));

  // Phase 2 — beat-mode stages don't have a single stage.type; "boss" status
  // is whether any encounter beat in the stage was flagged boss:true
  // (computed once at launch, see camp.hasBoss). Legacy stages keep using
  // stage.type exactly as before.
  const isBoss = camp.mode === 'beats' ? camp.hasBoss : camp.stage.type === 'boss';
  document.getElementById('camp-res-emoji').textContent  = isBoss ? '🏆' : '✨';
  document.getElementById('camp-res-title').textContent  = isBoss ? 'BOSS DEFEATED!' : 'STAGE CLEARED!';
  document.getElementById('camp-res-title').style.color  = isBoss ? '#fcd34d' : '#4edea3';
  document.getElementById('camp-res-sub').textContent    = `${camp.correctQ}/${camp.totalQ} correct · ${accuracy}% accuracy · ${camp.lives}/${camp.maxLives} lives remaining`;
  document.getElementById('camp-rewards-row').innerHTML  = `
    <div class="camp-reward-badge" style="border-color:rgba(208,188,255,.25)"><div class="camp-reward-val" style="color:#c4b5fd">+${xpEarned}</div><div class="camp-reward-lbl">XP EARNED</div></div>
    <div class="camp-reward-badge" style="border-color:rgba(255,185,95,.25)"><div class="camp-reward-val" style="color:#ffb95f">+${coinsEarned} 🪙</div><div class="camp-reward-lbl">COINS</div></div>
    <div class="camp-reward-badge" style="border-color:rgba(78,222,163,.25)"><div class="camp-reward-val" style="color:#4edea3">${accuracy}%</div><div class="camp-reward-lbl">ACCURACY</div></div>`;

  if (currentRole === 'student' && currentUser) {
    DB = loadDB();
    const idx = DB.students.findIndex(s => s.id === currentUser.id);
    if (idx >= 0) {
      DB.students[idx].xp    += xpEarned;
      DB.students[idx].coins += coinsEarned;
      currentUser.xp    += xpEarned;
      currentUser.coins += coinsEarned;
      syncStudentStatsToServer(currentUser.id, xpEarned, coinsEarned);
      DB.pointLog.unshift({ id: 'pl_' + uid(), studentId: currentUser.id, what: 'Stage: ' + camp.stage.title, pts: xpEarned, when: 'Just now', createdAt: new Date().toISOString() });
    }
    markStageCleared(camp.stage.id);
    saveDB();
    updateTopbar();
    if (typeof achCheckAndAward === 'function') setTimeout(() => achCheckAndAward(currentUser.id), 400);
  }

  const worlds = getVisibleCampaignWorlds();
  const wIdx   = worlds.findIndex(w => w.id === camp.worldId);
  const sIdx   = (worlds[wIdx]?.stages || []).findIndex(s => s.id === camp.stageId);
  const hasNext = worlds[wIdx]?.stages[sIdx + 1] || worlds[wIdx + 1]?.stages[0];
  document.getElementById('camp-res-retry').style.display = 'none';
  document.getElementById('camp-res-next').style.display  = hasNext ? 'inline-flex' : 'none';
}

function _campDefeat() {
  clearInterval(camp.typeTimer);
  document.getElementById('camp-story-panel').style.display = 'none';
  document.getElementById('camp-encounter').style.display   = 'none';
  document.getElementById('camp-result').style.display      = 'flex';
  _campHideRevealUI(); // Phase 4 — defensive, reveal beats never cause defeat but keep UI clean
  _campHideDialogueUI(); // Phase 5 — defensive, dialogue beats never cause defeat but keep UI clean
  _campHideDragDropUI(); // Phase 6 — defensive, drag-drop beats never cause defeat but keep UI clean
  _campHideSkillBar(); // Phase 7 — defeat can only happen mid-encounter, so this always applies
  document.getElementById('camp-res-emoji').textContent     = '💀';
  document.getElementById('camp-res-title').textContent     = 'DEFEATED!';
  document.getElementById('camp-res-title').style.color     = '#ef4444';
  document.getElementById('camp-res-sub').textContent       = 'You ran out of lives. Review the material and try again!';
  document.getElementById('camp-rewards-row').innerHTML     = '';
  document.getElementById('camp-res-retry').style.display   = 'inline-flex';
  document.getElementById('camp-res-next').style.display    = 'none';
}

// ── Navigation controls ───────────────────────────────────────────────────────

window.retryCampaign = function () {
  document.getElementById('campaign-overlay').classList.remove('open');
  document.removeEventListener('keydown', _campKeyHandler);
  setTimeout(() => launchCampaignStage(camp.worldId, camp.stageId), 200);
};

window.nextStageCampaign = function () {
  const worlds = getVisibleCampaignWorlds();
  const wIdx   = worlds.findIndex(w => w.id === camp.worldId);
  const sIdx   = (worlds[wIdx]?.stages || []).findIndex(s => s.id === camp.stageId);
  let nw = worlds[wIdx], ns = worlds[wIdx]?.stages[sIdx + 1];
  if (!ns && worlds[wIdx + 1]) { nw = worlds[wIdx + 1]; ns = nw.stages[0]; }
  document.getElementById('campaign-overlay').classList.remove('open');
  document.removeEventListener('keydown', _campKeyHandler);
  if (ns) setTimeout(() => launchCampaignStage(nw.id, ns.id), 200);
  else    setTimeout(() => openStageMap(), 200);
};

window.exitCampaign = function () {
  clearInterval(camp.typeTimer);
  document.getElementById('campaign-overlay').classList.remove('open');
  document.removeEventListener('keydown', _campKeyHandler);
  setTimeout(() => openStageMap(), 200);
};

window.confirmExitCampaign = function () {
  if (confirm('Exit this stage? Your progress will not be saved.')) exitCampaign();
};

console.log('[EduQuest] campaign/engine.js loaded — launchCampaignStage, campAnswer, victory/defeat, navigation registered.');
