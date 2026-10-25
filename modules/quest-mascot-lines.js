// ─────────────────────────────────────────────────────────────────────────────
// QUEST BOARD — Mascot / Narrator (Phase 7, Improvement Plan §6, §12 item 7)
//
// Phase 6 (Decompose God Files, this engineering refactor) extraction from
// modules/quest-engine.js. Owns the mascot's emotion library, default line
// pools per event/stage, admin-authored-line layering, random line pick,
// and the event→emotion trigger table. Pure data/logic only — the actual
// DOM wiring (fireMascotEvent, updateMascotAmbientMood) lives in index.html
// next to renderQuizQuestion(), same split as the rest of the quiz-runner
// always had (per the original section header, kept below). No behavior
// change — every line below is moved verbatim.
//
// WHY THIS WAS SAFE TO EXTRACT (checked before moving anything, not
// assumed): grepped this whole block for dependencies beyond its own
// exports and found exactly one external global — window._eqMascotCustomLines
// (populated once per session by MascotLinesService.get(), see startQuiz()
// in index.html) — already an established cross-file dependency before this
// extraction, not a new one.
//
// Exports: eqMascotLinePool(), eqMascotLine(), eqMascotEmotionFor()
//   Also declares: MASCOT_EMOTIONS, MASCOT_EMOJI, MASCOT_DEFAULT_LINES
//
// DEPENDENCIES: window._eqMascotCustomLines (set elsewhere, guarded with a
// safe fallback wherever it's read here, exactly as in the original file).
// ─────────────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
//  QUEST BOARD — Phase 7: Mascot / Narrator (Improvement Plan §6, §12 item 7)
//
//  Builds on the Phase 4 mascot dock (placeholder orb) and the Phase 3
//  stage backbone (stageIdx). This section is pure data/logic — the actual
//  DOM wiring (fireMascotEvent, updateMascotAmbientMood) lives in index.html
//  next to renderQuizQuestion(), same split as every other quiz-runner
//  helper in this file.
//
//  EMOTION LIBRARY — exactly the 9 poses from §6's trigger table.
// ═══════════════════════════════════════════════════════════════════════════
const MASCOT_EMOTIONS = ['idle','confident','hyped','nervous','scared','hiding','relieved','sad','determined'];
window.MASCOT_EMOTIONS = MASCOT_EMOTIONS;

// Emoji sprite per emotion — matches the app's existing emoji-illustration
// convention (Command Center hero, Quest Board nodes, results screen 🏆/💀)
// rather than standing up a bespoke SVG art pipeline for one component.
const MASCOT_EMOJI = {
  idle:       '🐲',
  confident:  '😎',
  hyped:      '🤩',
  nervous:    '😅',
  scared:     '😱',
  hiding:     '🙈',
  relieved:   '😌',
  sad:        '🥺',
  determined: '💪',
};
window.MASCOT_EMOJI = MASCOT_EMOJI;

// Default line pools (§6: "ships with a default line pool for every event
// out of the box"). Admin-authored lines (MascotLinesService, see
// modules/shared/mascot-lines-service.js) are concatenated ON TOP of these
// in eqMascotLinePool() below — never a replacement — so a partially-
// customized set never leaves an event with nothing to say.
//
// Shape: events that escalate personality by stage (correct/wrong/lowTime)
// are keyed 0/1/2; stageTransition is keyed by the STAGE BEING ENTERED (1
// or 2 — there's no "transition into stage 0"); everything else is a flat
// array.
const MASCOT_DEFAULT_LINES = {
  start: [
    "Let's do this!", "Ready when you are!", "Deep breath — here we go!",
    "New quest, who dis?", "I believe in you!", "Let's make it count!",
  ],
  retry: [
    "Round two — let's go!", "We learn, we adapt, we conquer.",
    "Rolling up my sleeves for this one.", "This time's the one!",
    "Shake it off, here we go again!",
  ],
  correct: {
    0: ["Nice one!", "Yes! Exactly right.", "Smooth!", "You've got this rhythm.", "Clean answer!"],
    1: ["Yes! Keep it up!", "Boom! Right again!", "You're on fire!", "Nailed it — don't stop now!"],
    2: ["YES! INCREDIBLE!", "WOW — no hesitation!", "You're UNSTOPPABLE!", "That's how it's done!!"],
  },
  wrong: {
    0: ["Ah, not quite — shake it off!", "So close! Next one's yours.", "No worries, keep going!"],
    1: ["Whew, tricky one — you got this!", "It's okay! Stay focused.", "Shake it off, eyes forward!"],
    2: ["Yikes! But we push through!", "It's alright — don't panic!", "Deep breath, next one!"],
  },
  milestone: [
    "COMBO! You're on a roll!!", "Unstoppable streak!!", "Look at you go!!",
    "That's a hot streak!", "Keep the fire burning!!",
  ],
  stageTransition: {
    1: ["Ooh, things are heating up...", "Here comes Surge — stay sharp!", "Gear two, engage!"],
    2: ["Uh oh... Overdrive incoming!!", "Hang on tight — final gauntlet!", "This is it — give it everything!"],
  },
  lowTime: {
    0: ["Tick tock, almost there!", "Clock's ticking — you got this!"],
    1: ["Time's running low — hurry!", "Careful, the clock's closing in!"],
    2: ["TIME'S ALMOST UP!! GO GO GO!", "SO LITTLE TIME LEFT!!"],
  },
  pass: [
    "You did it! I'm so proud!", "Quest complete — amazing work!",
    "That's what I call a victory!", "You crushed it!",
  ],
  fail: [
    "Aw, not this time — but you'll get it!", "Every attempt makes you stronger.",
    "Don't worry, we'll get 'em next time.", "Chin up, champ — try again soon!",
  ],
};
window.MASCOT_DEFAULT_LINES = MASCOT_DEFAULT_LINES;

// eqMascotLinePool(event, stageKey) — default pool + any admin-authored
// lines layered on top. window._eqMascotCustomLines is populated once per
// session by MascotLinesService.get() (see startQuiz() in index.html);
// it's simply {} (never undefined/null) until that resolves or if it
// fails, so this always degrades gracefully to defaults-only.
function eqMascotLinePool(event, stageKey){
  const def = MASCOT_DEFAULT_LINES[event];
  const defPool = (stageKey === undefined || stageKey === null)
    ? (Array.isArray(def) ? def : [])
    : ((def && def[stageKey]) || []);
  const customRoot = (window._eqMascotCustomLines && window._eqMascotCustomLines[event]) || null;
  const customPool = (stageKey === undefined || stageKey === null)
    ? (Array.isArray(customRoot) ? customRoot : [])
    : ((customRoot && customRoot[stageKey]) || []);
  return defPool.concat(customPool.filter(l => l && String(l).trim()));
}
window.eqMascotLinePool = eqMascotLinePool;

// eqMascotLine(event, stageKey) — picks one line at random from whatever
// pool applies (§6: "picked at random... so it doesn't repeat identically
// every time"). Returns '' if somehow both default and custom pools are
// empty (never happens for shipped events, but stageTransition/lowTime
// keys are only ever 0/1/2 or 1/2 — a bad key just yields no line, not
// an error).
function eqMascotLine(event, stageKey){
  const pool = eqMascotLinePool(event, stageKey);
  if (!pool.length) return '';
  return pool[Math.floor(Math.random() * pool.length)];
}
window.eqMascotLine = eqMascotLine;

// eqMascotEmotionFor(event, opts) — §6's trigger table, condensed to one
// lookup per ACUTE event (an answer just landed, a stage just changed,
// etc). Ambient/idle body-pose (no event firing) is handled separately by
// updateMascotAmbientMood() in index.html, since that one needs live
// timer state, not just a one-shot event name.
function eqMascotEmotionFor(event, opts){
  opts = opts || {};
  switch (event) {
    case 'start':           return 'idle';
    case 'retry':           return 'determined';
    case 'correct':         return (opts.stageIdx >= 1) ? 'hyped' : 'confident';
    case 'milestone':       return 'hyped';
    case 'wrong':           return (opts.stageIdx >= 2) ? 'scared' : 'nervous';
    case 'stageTransition': return 'hiding';
    case 'lowTime':         return (opts.stageIdx >= 2) ? 'scared' : 'nervous';
    case 'pass':            return 'relieved';
    case 'fail':            return 'sad';
    default:                return 'idle';
  }
}
window.eqMascotEmotionFor = eqMascotEmotionFor;

