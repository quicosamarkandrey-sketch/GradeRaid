// ─────────────────────────────────────────────────────────────────────────────
// CAMPAIGN — skill system (Hint / Heal / Shield, Phase 7 of the campaign
// feature roadmap; unrelated numbering to this engineering refactor's own
// Phase 6)
//
// Phase 6 (Decompose God Files, this refactor) extraction from
// campaign_engine.js. Owns the entire skill subsystem end to end: reading
// counts from the AppStore studentSkills slice, local-optimistic
// adjust + fire-and-forget server reconciliation (adjust_student_skill_count
// RPC), the random post-interaction drop roll, the skill bar UI (built and
// appended into #camp-encounter at runtime), and spending a skill
// (window._campUseSkill, wired to the bar's buttons). No behavior change —
// every function below is moved verbatim.
//
// WHY THIS WAS SAFE TO EXTRACT: like the drag-drop beat type
// (campaign-dragdrop-beat.js, extracted in the same session), this is
// already a self-contained subsystem — every other beat-type handler in
// campaign_engine.js only ever calls _campHideSkillBar() when switching
// away from an encounter beat, or _campRollSkillDrop()/_campRenderSkillBar()
// at specific, well-defined moments (a graded interaction completing, an
// encounter's options being drawn) — never reaches into this file's
// internals (camp.skillCounts/hintEliminated/shieldActive stay data the
// rest of the engine reads, not functions it calls).
//
// Exports: _campGetSkillCounts(), _campRollSkillDrop(), _campHideSkillBar(),
//   _campRenderSkillBar(), window._campUseSkill()
//   Also declares: CAMP_SKILL_DROP_RATE, CAMP_SKILL_TYPES, CAMP_SKILL_META
//
// DEPENDENCIES: camp (shared module state, declared in campaign_engine.js),
// currentUser, currentRole, AppStore, DBService, toast(), _campUpdateHUD()
// — all globals already available wherever this file loads, same as when
// this code lived inside campaign_engine.js. Must load after
// campaign_engine.js (see index.html) — see campaign-dragdrop-beat.js's
// header for why load order doesn't actually affect correctness here.
// ─────────────────────────────────────────────────────────────────────────────

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

// Reads the student's current skill counts out of the AppStore studentSkills
// slice (the Phase 7 cache slot — see state-manager.js), defaulting every
// skill to 0 for a student with no rows yet (never granted anything).
function _campGetSkillCounts() {
  if (!currentUser) return { hint: 0, heal: 0, shield: 0 };
  const studentSkills = AppStore.getSlice(s => s.studentSkills) || {};
  const row = studentSkills[currentUser.id] || {};
  return { hint: row.hint || 0, heal: row.heal || 0, shield: row.shield || 0 };
}

// Applies a local optimistic delta to the studentSkills slice, clamped at 0
// (never negative — mirrors adjust_student_stats()'s `greatest(0, ...)`
// clamp server-side) via one AppStore.updateState() call.
function _campAdjustSkillLocal(studentId, skill, delta) {
  if (!studentId) return;
  AppStore.updateState(draft => {
    if (!draft.studentSkills) draft.studentSkills = {};
    if (!draft.studentSkills[studentId]) draft.studentSkills[studentId] = { hint: 0, heal: 0, shield: 0 };
    const current = draft.studentSkills[studentId][skill] || 0;
    draft.studentSkills[studentId][skill] = Math.max(0, current + delta);
  }, { type: 'campaign:skill-adjusted', payload: { studentId, skill, delta } });
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
      // [Phase 3 migration bugfix] The pre-migration version mutated
      // DB.studentSkills[studentId] directly here but never called saveDB()
      // afterward. This reconciliation fires asynchronously — often well
      // after _campAdjustSkillLocal()'s own saveDB() call already ran — so
      // there was no guarantee anything would ever persist this specific
      // write; it could silently be lost on the next reload.
      // AppStore.updateState() always persists, closing that gap.
      AppStore.updateState(draft => {
        if (!draft.studentSkills) draft.studentSkills = {};
        draft.studentSkills[studentId] = {
          hint: row.hint_count || 0, heal: row.heal_count || 0, shield: row.shield_count || 0,
        };
      }, { type: 'campaign:skill-reconciled', payload: { studentId } });
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

// ── Phase 7 (2026-08-10, session 7): explicit window exports ──
// These were previously implicit globals (bare top-level declarations,
// reachable to other files only via classic-script auto-attach-to-window
// behavior). Made explicit ahead of any real bundle/module scoping change
// — found by build/audit-window-exports.js, which checks every symbol with
// a real cross-file consumer, not just ones reachable from onclick markup.
// See PHASE7_WINDOW_EXPORT_AUDIT.md.
window._campHideSkillBar = _campHideSkillBar;
window._campRollSkillDrop = _campRollSkillDrop;
window._campGetSkillCounts = _campGetSkillCounts;
window._campRenderSkillBar = _campRenderSkillBar;
