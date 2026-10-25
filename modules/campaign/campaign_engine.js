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
  // Phase 7 — local mirror of the AppStore studentSkills slice for
  // currentUser.id (Decision #5), refreshed at stage launch and after every
  // grant/spend so the skill bar can render synchronously without
  // re-reading AppStore on every frame. Shape: { hint, heal, shield }
  // (counts, never negative).
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
  const stageMap = AppStore.getSlice(s => s.stageMap) || [];
  if (currentRole !== 'student' || !currentUser) return stageMap;
  const assignments = AppStore.getSlice(s => s.campaignSectionAssignments) || {};
  const myClassId   = currentUser.classId || 'default-class';
  return stageMap.filter(w => {
    const assigned = assignments[w.id];
    if (!assigned || assigned.length === 0 || assigned.includes(myClassId)) return true;
    return (w.stages || []).some(s => isStageCleared(s.id));
  });
};

// ── Progress helpers ──────────────────────────────────────────────────────────

window.isStageCleared = function (stageId) {
  if (!currentUser) return false;
  const stageProgress = AppStore.getSlice(s => s.stageProgress) || {};
  return !!((stageProgress[currentUser.id] || {})[stageId]);
};

window.markStageCleared = function (stageId) {
  if (!currentUser) return;
  AppStore.updateState(draft => {
    if (!draft.stageProgress) draft.stageProgress = {};
    if (!draft.stageProgress[currentUser.id]) draft.stageProgress[currentUser.id] = {};
    draft.stageProgress[currentUser.id][stageId] = true;
  }, { type: 'campaign:stage-cleared', payload: { studentId: currentUser.id, stageId } });
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


// ── Reveal + dialogue beat types — owned by campaign-reveal-dialogue-beats.js
// (Phase 6) ────────────────────────────────────────────────────────────────
// _campEnsureRevealPanel/_campEnsureRevealPopup/_campHideRevealUI/
// _campShowRevealBeat/_campRenderRevealPanel/window._campRevealHotspotClick/
// _campShowRevealPopup/window._campRevealPopupClose/window._campRevealContinue,
// and _campEnsureDialoguePanel/_campHideDialogueUI/_campShowDialogueBeat/
// _campRenderDialogueChoices/window._campDialogueChoiceClick/
// window._campDialogueContinue used to live here (~180 lines) — moved to
// their own file since both beat types are already self-contained (see that
// file's header for why they're one file, not two). Every call site below
// (the beat-type dispatcher, and every other beat's "hide reveal/dialogue UI"
// cleanup call) is unchanged.

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


// ── Drag-and-drop beat type — owned by campaign-dragdrop-beat.js (Phase 6) ──
// _campEnsureDragDropPanel/_campHideDragDropUI/_campShuffleArray/
// _campShowDragDropBeat/_campDragChipHTML/_campRenderDragDropPanel/
// _campWireDragDropPointerEvents/_campDragPointerStart/_campDragDrop/
// _campDragDropCheckSolved/window._campDragDropContinue used to live here
// (~210 lines) — moved to their own file since this beat type is already a
// self-contained subsystem (see that file's header). Every call site below
// (the beat-type dispatcher, and every other beat's "hide drag-drop UI when
// switching away" cleanup call) is unchanged.

// ── Skill system — owned by campaign-skills.js (Phase 6) ─────────────────────
// CAMP_SKILL_DROP_RATE/_TYPES/_META, _campGetSkillCounts/
// _campAdjustSkillLocal/_campSyncSkillDeltaToServer/_campRollSkillDrop/
// _campEnsureSkillBar/_campHideSkillBar/_campSkillBtnHTML/
// _campRenderSkillBar/window._campUseSkill used to live here (~220 lines) —
// moved to their own file for the same reason. Every call site below is
// unchanged.

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
    const found = (AppStore.getSlice(s => s.students) || []).some(x => x.id === currentUser.id);
    if (found) {
      AppStore.updateState(draft => {
        const s = (draft.students || []).find(x => x.id === currentUser.id);
        if (!s) return;
        s.xp    = (s.xp || 0) + xpEarned;
        s.coins = (s.coins || 0) + coinsEarned;
        if (!Array.isArray(draft.pointLog)) draft.pointLog = [];
        draft.pointLog.unshift({ id: 'pl_' + uid(), studentId: currentUser.id, what: 'Stage: ' + camp.stage.title, pts: xpEarned, when: 'Just now', createdAt: new Date().toISOString() });
      }, { type: 'campaign:stage-rewards-granted', payload: { studentId: currentUser.id, xpEarned, coinsEarned } });

      currentUser.xp    += xpEarned;
      currentUser.coins += coinsEarned;
      syncStudentStatsToServer(currentUser.id, xpEarned, coinsEarned);
    }
    markStageCleared(camp.stage.id);
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

// ── Phase 7 (2026-08-10, session 7): explicit window exports ──
// These were previously implicit globals (bare top-level declarations,
// reachable to other files only via classic-script auto-attach-to-window
// behavior). Made explicit ahead of any real bundle/module scoping change
// — found by build/audit-window-exports.js, which checks every symbol with
// a real cross-file consumer, not just ones reachable from onclick markup.
// See PHASE7_WINDOW_EXPORT_AUDIT.md.
window.camp = camp;
window._campSetBg = _campSetBg;
window._campBeatAdvance = _campBeatAdvance;
window._campUpdateHUD = _campUpdateHUD;
