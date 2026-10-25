// ─────────────────────────────────────────────────────────────────────────────
// QUEST BOARD — Mascot / Narrator (src/quest-mascot-lines.js)
//
// Pure data/logic only — the actual DOM wiring (fireMascotEvent,
// updateMascotAmbientMood) lives in index.html next to renderQuizQuestion().
//
// Exports: MASCOT_EMOTIONS, MASCOT_EMOJI, MASCOT_DEFAULT_LINES,
//   eqMascotLinePool(), eqMascotLine(), eqMascotEmotionFor()
//
// DEPENDENCIES: window._eqMascotCustomLines (set elsewhere, guarded with a
// safe fallback wherever it's read here, exactly as in the original file).
//
// Phase 7 (2026-08-10, session 13) — step 5.3, seventh real conversion.
// This is the real-ESM twin of the original ../modules/quest-mascot-
// lines.js, which stays completely untouched. All 6 declarations copied
// byte-for-byte; internal cross-references (eqMascotLine calls
// eqMascotLinePool, both now real exports of this same module) resolve
// via normal module-internal scope, same as button-loading.js's
// same-file dependency did in session 12.
// ─────────────────────────────────────────────────────────────────────────────

export const MASCOT_EMOTIONS = ['idle','confident','hyped','nervous','scared','hiding','relieved','sad','determined'];

export const MASCOT_EMOJI = {
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

export const MASCOT_DEFAULT_LINES = {
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

export function eqMascotLinePool(event, stageKey){
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

export function eqMascotLine(event, stageKey){
  const pool = eqMascotLinePool(event, stageKey);
  if (!pool.length) return '';
  return pool[Math.floor(Math.random() * pool.length)];
}

export function eqMascotEmotionFor(event, opts){
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
