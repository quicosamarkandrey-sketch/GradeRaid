// ─────────────────────────────────────────────────────────────────────────────
// QUEST ENGINE — Quest Board / quiz mechanics (grading, staging, scheduling,
// scoring, mascot lines)
//
// Phase 6 (Decompose God Files) extraction from utils.js. Owns the entire
// Quest Board domain: question-type grading (eqGradeAnswer and friends),
// 3-stage escalation + per-question timers, rarity/cadence + daily/weekly
// scheduling, combo/streak scoring, attempt-cooldown tracking, mascot
// emotion/line selection, and quest chains. This was previously the back
// two-thirds of utils.js's undifferentiated grab bag — moved out verbatim,
// no behavior change, alongside the smaller student-stats.js extraction
// (see that file's header) done in the same session.
//
// Exports: getStudentQuestRecords(), computeQuestStreak(), eqQType(),
//   eqNormalizeAnswer(), eqGradeAnswer(), eqQuizStageSeconds(),
//   eqQuestionStage(), eqStageName(), eqQuizRarity(), eqQuizCadence(),
//   eqGetDailyQuizIds(), eqGetWeeklyQuizId(), eqQuizScheduleStatus(),
//   eqDaysUntil(), eqComputeQuizAnalytics(), eqComboMultiplier(),
//   eqIsComboMilestone(), eqQuizPassed(), eqQuestStars(), eqStreakFireTier(),
//   eqRetryMultiplier(), eqQuizHasPerfected(), eqQuizAttemptStatus(),
//   eqFormatCooldown(), eqMascotLinePool(), eqMascotLine(),
//   eqMascotEmotionFor(), eqGrantQuizAttemptOverride(), eqQuizChain(),
//   eqGetQuestChains(), eqChainStatus(), eqWeekStartISO(),
//   eqGetTopQuestersThisWeek()
//   Also declares: QUIZ_STAGE_DEFAULT_SECONDS, QUIZ_STAGE_NAMES,
//   QUIZ_MAX_SCORED_ATTEMPTS, QUIZ_LOCK_COOLDOWN_MS, MASCOT_EMOTIONS,
//   MASCOT_EMOJI, MASCOT_DEFAULT_LINES
//
// DEPENDENCIES: DB (global cache), computeAttendanceStreak() (student-stats.js
// — computeQuestStreak() delegates to it) — must load after student-stats.js,
// same relative order it had inside the old single utils.js.
// ─────────────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
//  QUEST BOARD — Real Streak Tracking  (Phase 2)
//  Replaces the old fake "🔥 Streak" stat (Math.floor(completedQuizzes.length/2),
//  never resets, can't be broken — see quest_board_report.md §1). A quest
//  streak is now actual consecutive-day quest-completion tracking, built on
//  the exact same day-diff algorithm as computeAttendanceStreak() above so
//  the whole app has one consistent definition of "streak".
// ═══════════════════════════════════════════════════════════════════════════

/**
 * getStudentQuestRecords(sid) → [{status:'present', date:'YYYY-MM-DD'}, ...]
 *
 * Reads DB.quizHistory[sid] (one entry per completed quest) and normalizes
 * it into the same {status,date} shape computeAttendanceStreak() expects.
 * New entries (finishQuiz(), index.html) stamp a `date` field via isoDate()
 * at completion time — the correct Asia/Manila calendar day. Older history
 * entries only have `completedAt` (a raw ISO UTC timestamp from
 * `new Date().toISOString()`), so those fall back to slicing its UTC date;
 * good enough for legacy rows and never throws on a missing/malformed value.
 */
function getStudentQuestRecords(sid) {
  const history = (DB.quizHistory || {})[sid] || [];
  return history
    .map(h => ({ status: 'present', date: h.date || (h.completedAt ? String(h.completedAt).slice(0, 10) : null) }))
    .filter(r => r.date);
}
window.getStudentQuestRecords = getStudentQuestRecords;

/**
 * computeQuestStreak(sid) → { current, longest }
 * Real, breakable, day-based quest streak — one completed quest on a given
 * calendar day counts that day; a day with no completion breaks `current`
 * back to 0 the next time it's computed. Delegates to
 * computeAttendanceStreak() so both streak types stay in lockstep if the
 * underlying day-diff math is ever tuned.
 */
function computeQuestStreak(sid) {
  return computeAttendanceStreak(getStudentQuestRecords(sid));
}
window.computeQuestStreak = computeQuestStreak;

// ═══════════════════════════════════════════════════════════════════════════
//  QUEST BOARD — Question Type Helpers  (Phase 1: reviewer question types)
//  Every question in a quiz now carries a `type`: 'mc' (multiple choice,
//  the original/default format), 'tf' (true/false — same opts+answer-index
//  shape as mc, just 2 fixed options), or 'id' (identification / short
//  answer — free-text, fuzzy-matched). Quizzes saved before this phase have
//  no `type` field at all; eqQType() treats that as 'mc' so nothing old
//  breaks (including quizzes already imported into World Boss).
// ═══════════════════════════════════════════════════════════════════════════
function eqQType(q){ return (q && q.type) || 'mc'; }
window.eqQType = eqQType;

// Normalizes free-text answers for Identification-type grading: lowercases,
// trims, strips common punctuation, and collapses internal whitespace, so
// "Mitochondria." / " mitochondria " / "MITOCHONDRIA" all count as a match.
function eqNormalizeAnswer(s){
  return String(s ?? '')
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:'"()\[\]]/g,'')
    .replace(/\s+/g,' ');
}
window.eqNormalizeAnswer = eqNormalizeAnswer;

// Grades one question against a student's submitted answer. `studentAns` is
// an option-index (number) for mc/tf, a raw string for id, or an array of
// strings for enum. Returns a fraction 0..1 (1/0 for mc/tf/id, a matched-
// count ratio for enum — Phase 3 partial credit, quest_board_report.md
// §2.3/§3.6). Centralized here so the student quiz runner and (later)
// World Boss combat both grade the same forgiving way instead of
// duplicating the normalization logic.
function eqGradeAnswer(q, studentAns){
  const type = eqQType(q);
  if (type === 'id') {
    if (studentAns === null || studentAns === undefined) return 0;
    const given = eqNormalizeAnswer(studentAns);
    if (!given) return 0;
    const accepted = [q.answer, ...(Array.isArray(q.altAnswers) ? q.altAnswers : [])]
      .filter(a => a !== undefined && a !== null && a !== '')
      .map(eqNormalizeAnswer);
    return accepted.includes(given) ? 1 : 0;
  }
  if (type === 'enum') {
    // Order-independent partial credit: each correct item can only be
    // matched once, so guessing the same right answer twice doesn't inflate
    // the score. Empty/blank inputs never match.
    const correctList = Array.isArray(q.answers) ? q.answers.filter(a => a && String(a).trim()) : [];
    if (!correctList.length) return 0;
    const pool = correctList.map(eqNormalizeAnswer);
    const given = Array.isArray(studentAns) ? studentAns : [];
    let matched = 0;
    given.forEach(g => {
      const ng = eqNormalizeAnswer(g);
      if (!ng) return;
      const idx = pool.indexOf(ng);
      if (idx !== -1) { matched++; pool.splice(idx, 1); }
    });
    return matched / correctList.length;
  }
  if (type === 'match') {
    // Phase 5 — Matching type (quest_board_report.md §2.4): q.pairs is
    // [{left, right}, ...]; studentAns is an array of the student's chosen
    // `right` string per pair index (same order as q.pairs, NOT the
    // shuffled display order — submitMatchAnswer() in index.html already
    // maps the shuffled dropdown selection back to pair index before it
    // ever reaches quizAnswers). Partial credit per correct pair, same
    // "each blank scored independently" spirit as enum above.
    const pairs = Array.isArray(q.pairs) ? q.pairs.filter(p => p && p.left && String(p.left).trim()) : [];
    if (!pairs.length) return 0;
    const given = Array.isArray(studentAns) ? studentAns : [];
    let matched = 0;
    pairs.forEach((p, i) => {
      const g = given[i];
      if (g === undefined || g === null || g === '') return;
      if (eqNormalizeAnswer(g) === eqNormalizeAnswer(p.right)) matched++;
    });
    return matched / pairs.length;
  }
  // mc / tf — plain option-index compare (unchanged original behavior)
  return studentAns === q.answer ? 1 : 0;
}
window.eqGradeAnswer = eqGradeAnswer;

// ═══════════════════════════════════════════════════════════════════════════
//  QUEST BOARD — Phase 3 (Improvement Plan §2/§4): 3-Stage Escalation +
//  Per-Question Timer
//
//  Splits a quiz's questions into 3 stages — Warm-Up, Surge, Overdrive —
//  purely by question ORDER (first third/second third/final third), so
//  every existing quiz gets staged automatically with zero re-authoring.
//  Each stage has its own per-question countdown (resets every item, not
//  once per whole quiz). Defaults are 30/20/10 seconds; an admin can
//  override any/all of them per-quiz via quiz.stageTimers (quiz-builder.js),
//  and the system always falls back to the shipped default for any slot
//  that isn't overridden — see eqQuizStageSeconds() below.
// ═══════════════════════════════════════════════════════════════════════════
const QUIZ_STAGE_DEFAULT_SECONDS = [30, 20, 10];
const QUIZ_STAGE_NAMES = ['Warm-Up', 'Surge', 'Overdrive'];
window.QUIZ_STAGE_DEFAULT_SECONDS = QUIZ_STAGE_DEFAULT_SECONDS;
window.QUIZ_STAGE_NAMES = QUIZ_STAGE_NAMES;

// Per-stage seconds-per-question for this quiz. quiz.stageTimers (if
// present) is a 3-slot array of admin overrides; any missing/invalid slot
// (undefined, 0, non-numeric) falls back to that slot's shipped default,
// so a quiz that only overrode stage 3 doesn't lose its stage 1/2 defaults,
// and a quiz saved before this feature existed (no stageTimers at all)
// behaves identically to the shipped 30/20/10.
function eqQuizStageSeconds(quiz){
  const overrides = (quiz && Array.isArray(quiz.stageTimers)) ? quiz.stageTimers : [];
  return QUIZ_STAGE_DEFAULT_SECONDS.map((def, i) => {
    const v = parseInt(overrides[i], 10);
    return (Number.isFinite(v) && v > 0) ? v : def;
  });
}
window.eqQuizStageSeconds = eqQuizStageSeconds;

// Which stage (0=Warm-Up, 1=Surge, 2=Overdrive) a question index belongs
// to, given the quiz's total question count. Splits into 3 contiguous
// chunks as evenly as possible for n>=3. Degrades sensibly for very short
// quizzes: 1 question stays in stage 0; 2 questions go stage 0 then stage
// 2, so even a tiny quiz still feels like it escalates rather than sitting
// in Warm-Up the whole time.
function eqQuestionStage(totalQuestions, qIndex){
  const n = Math.max(1, totalQuestions | 0);
  if (n === 1) return 0;
  if (n === 2) return qIndex === 0 ? 0 : 2;
  const stage = Math.floor((qIndex / n) * 3);
  return Math.min(2, Math.max(0, stage));
}
window.eqQuestionStage = eqQuestionStage;

function eqStageName(stageIdx){ return QUIZ_STAGE_NAMES[stageIdx] || QUIZ_STAGE_NAMES[0]; }
window.eqStageName = eqStageName;

// ═══════════════════════════════════════════════════════════════════════════
//  QUEST BOARD — Rarity & Cadence Helpers  (Phase 3: content variety §3.4/§3.2)
//  A quest can carry a `rarity` (reusing the exact Common→Mythic palette
//  already built for Achievements — window.ACH_RARITY/ACH_RARITIES in
//  ach_engine.js — instead of a one-off quest-only system) and a `cadence`
//  ('daily' | 'weekly' | unset/'standing'). Quizzes saved before this phase
//  have neither field; both helpers default to the pre-Phase-3 behavior
//  (Common rarity, always-available standing quest) so nothing old breaks.
// ═══════════════════════════════════════════════════════════════════════════
function eqQuizRarity(quiz){ return (quiz && quiz.rarity) || 'Common'; }
window.eqQuizRarity = eqQuizRarity;

function eqQuizCadence(quiz){ return (quiz && quiz.cadence) || 'standing'; }
window.eqQuizCadence = eqQuizCadence;

// Deterministic seeded shuffle-and-take: every student computing this for
// the same seed string gets the exact same picks (no server round-trip
// needed to agree on "today's 3 dailies"), and it changes automatically
// the moment the date/week string changes. Simple LCG, not cryptographic —
// fairness/unpredictability-to-a-casual-glance is all this needs.
function _eqSeededPick(pool, seedStr, count){
  if (!pool.length || count <= 0) return [];
  const arr = pool.slice();
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  function rand(){ seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; }
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr.slice(0, Math.min(count, arr.length));
}

// eqGetDailyQuizIds(dateStr?) → [id, id, id] — up to 3 quests from the
// 'daily' cadence pool, refreshed at Manila midnight (isoDate() rolls over
// then). Stable for the whole day, same picks for every student.
function eqGetDailyQuizIds(dateStr){
  dateStr = dateStr || isoDate();
  const pool = (DB.quizzes || []).filter(q => eqQuizCadence(q) === 'daily').map(q => q.id).sort();
  return _eqSeededPick(pool, 'quest-daily-' + dateStr, 3);
}
window.eqGetDailyQuizIds = eqGetDailyQuizIds;

// eqGetWeeklyQuizId(dateStr?) → id | null — one quest from the 'weekly'
// cadence pool, refreshed every Monday (Manila calendar week).
function eqGetWeeklyQuizId(dateStr){
  dateStr = dateStr || isoDate();
  const pool = (DB.quizzes || []).filter(q => eqQuizCadence(q) === 'weekly').map(q => q.id).sort();
  if (!pool.length) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const dayIdx = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dayIdx);
  const weekKey = d.toISOString().slice(0, 10);
  return _eqSeededPick(pool, 'quest-weekly-' + weekKey, 1)[0] || null;
}
window.eqGetWeeklyQuizId = eqGetWeeklyQuizId;

// ═══════════════════════════════════════════════════════════════════════════
//  QUEST BOARD — Phase 5 Helpers (Admin tooling: quest_board_report.md §4)
//  Scheduling (§18): quiz.startDate / quiz.endDate are optional 'YYYY-MM-DD'
//  strings (Manila calendar day, same convention as isoDate()). Neither set
//  = the pre-Phase-5 default, always available. Purely additive — a quiz
//  saved before this phase has both fields undefined and behaves exactly
//  as before.
// ═══════════════════════════════════════════════════════════════════════════

// eqQuizScheduleStatus(quiz, dateStr?) → 'upcoming' | 'active' | 'expired' | null
// null means "no schedule set" (always available, same as pre-Phase-5).
function eqQuizScheduleStatus(quiz, dateStr){
  if (!quiz) return null;
  const today = dateStr || isoDate();
  const start = quiz.startDate || null;
  const end = quiz.endDate || null;
  if (!start && !end) return null;
  if (start && today < start) return 'upcoming';
  if (end && today > end) return 'expired';
  return 'active';
}
window.eqQuizScheduleStatus = eqQuizScheduleStatus;

// eqDaysUntil(dateStr) → integer day count from today (Manila calendar) to
// dateStr. Negative if dateStr is in the past. Used to render "Ends in N
// days" / "Starts in N days" badges without re-deriving the same date math
// in three different render functions.
function eqDaysUntil(dateStr){
  if (!dateStr) return null;
  const today = new Date(isoDate() + 'T00:00:00');
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target - today) / 86400000);
}
window.eqDaysUntil = eqDaysUntil;

// ═══════════════════════════════════════════════════════════════════════════
//  QUEST BOARD — Phase 5: Per-Quiz Analytics (quest_board_report.md §19)
//  Reads DB.quizHistory (Phase 57 — synced per-attempt log) to compute
//  completion rate, average score, and per-question miss-rate for a quiz.
//  `results` (per-question fraction array, same order as quiz.questions) is
//  a Phase 5 addition to each history entry — entries logged before this
//  phase simply have no `results`, so per-question stats silently exclude
//  them rather than throwing; completion rate / average score still include
//  every attempt regardless, since those only ever needed `score`.
// ═══════════════════════════════════════════════════════════════════════════
function eqComputeQuizAnalytics(quizId){
  const quiz = (DB.quizzes || []).find(q => q.id === quizId);
  const totalStudents = (DB.students || []).length;
  const completedCount = (DB.students || []).filter(s => (s.completedQuizzes || []).includes(quizId)).length;

  // Flatten every attempt across every student for this quiz.
  const attempts = [];
  Object.keys(DB.quizHistory || {}).forEach(sid => {
    (DB.quizHistory[sid] || []).forEach(h => { if (h.quizId === quizId) attempts.push(h); });
  });

  const avgScore = attempts.length
    ? Math.round(attempts.reduce((sum, a) => sum + (a.score || 0), 0) / attempts.length)
    : null;

  // Per-question miss-rate — only attempts carrying a `results` array
  // (Phase 5+) contribute. A question's %correct is the average of its
  // fraction across those attempts (so enum/match partial credit shows up
  // as a partial %, not forced into a binary hit/miss).
  const qCount = quiz ? quiz.questions.length : 0;
  const perQuestion = [];
  for (let i = 0; i < qCount; i++) {
    const samples = attempts
      .map(a => (Array.isArray(a.results) ? a.results[i] : undefined))
      .filter(v => typeof v === 'number');
    const pct = samples.length ? Math.round((samples.reduce((s, v) => s + v, 0) / samples.length) * 100) : null;
    perQuestion.push({
      index: i,
      text: quiz.questions[i].q,
      type: eqQType(quiz.questions[i]),
      pctCorrect: pct,
      sampleCount: samples.length,
    });
  }

  return {
    quizId,
    totalStudents,
    completedCount,
    completionRate: totalStudents ? Math.round((completedCount / totalStudents) * 100) : 0,
    attemptCount: attempts.length,
    avgScore,
    perQuestion,
  };
}
window.eqComputeQuizAnalytics = eqComputeQuizAnalytics;

// ═══════════════════════════════════════════════════════════════════════════
//  QUEST BOARD — Phase 4 Helpers (Depth & Retention)
//  quest_board_report.md §3.3 (combo), §3.7 (chains), §3.12 (leaderboard),
//  §7 (retry with escalating stakes). See index.html's quiz runner
//  (startQuiz/quizNext/finishQuiz) and modules/admin/quiz-builder.js (chain
//  fields) for where these get consumed.
// ═══════════════════════════════════════════════════════════════════════════

// eqComboMultiplier(streak) — tiered XP/coin multiplier from the peak
// consecutive-correct streak reached during a quiz attempt (mc/tf/id count
// as a "hit" only on a full 1.0 eqGradeAnswer() result; enum's partial
// credit never counts toward combo — see quizNext() in index.html).
function eqComboMultiplier(streak){
  streak = streak || 0;
  if (streak >= 5) return 2;
  if (streak >= 3) return 1.5;
  return 1;
}
window.eqComboMultiplier = eqComboMultiplier;

// eqIsComboMilestone(streak) — Phase 6 (Improvement Plan §5: "Milestone
// bursts: at streaks like x3, x5, x10 — a distinct particle/pop animation").
// x3 and x5 are one-off call-outs; from x10 on, every +5 (x10, x15, x20...)
// keeps re-celebrating a long run instead of going quiet after the first
// couple of milestones. Used by quizNext() (index.html) to decide whether
// THIS specific grow should also fire a particle burst, not just the pop.
function eqIsComboMilestone(streak){
  return streak === 3 || streak === 5 || (streak >= 10 && streak % 5 === 0);
}
window.eqIsComboMilestone = eqIsComboMilestone;

// eqQuizPassed(score) — single source of truth for the pass/fail threshold,
// used by both the quiz runner's own results screen (finishQuiz()) and the
// Quest Board's node-state treatment (renderStudentQuizzes()) so the two
// can never quietly disagree about what counts as a "pass."
function eqQuizPassed(score){ return score >= 60; }
window.eqQuizPassed = eqQuizPassed;

// eqQuestStars(score) — Phase 61 (Improvement Plan §8: "Star/medal rating
// per quest based on performance — gives a non-exploitable reason to feel
// good about a quest without re-answering it for free score"). Purely a
// display rating derived from the already-stored score; it grants nothing
// and unlocks nothing, so there's no incentive to replay a passed quiz
// just to chase a star. Thresholds sit above eqQuizPassed()'s 60% floor —
// a bare pass is 1 star, not a full sweep.
function eqQuestStars(score){
  score = score || 0;
  if (score >= 90) return 3;
  if (score >= 75) return 2;
  if (score >= 60) return 1;
  return 0;
}
window.eqQuestStars = eqQuestStars;

// eqStreakFireTier(streakCount) — Phase 61 (Improvement Plan §8: "streak-fire
// visual for consecutive quest completions"). Maps the day streak to one of
// three CSS animation tiers (renderStudentQuizzes() sets this as
// data-streak-tier on the Day Streak hero-stat-pill): 'cold' has no flicker
// at all (streak hasn't started or just broke), 'warm' is a gentle flicker
// from day 1, 'hot' kicks in at a week+ to reward sustained streaks with a
// visibly bigger, warmer flame instead of the same animation forever.
function eqStreakFireTier(streakCount){
  streakCount = streakCount || 0;
  if (streakCount >= 7) return 'hot';
  if (streakCount >= 1) return 'warm';
  return 'cold';
}
window.eqStreakFireTier = eqStreakFireTier;

// eqRetryMultiplier(attemptNumber) — Phase 60 (exploit fix — Improvement
// Plan §7). Superseded the old "unlimited retries, ever-shrinking reward"
// curve: 100% / 65% / 40% / 25% flat floor. Attempt 4 and anything that
// manages to run after it (post-cooldown or via teacher override — see
// eqQuizAttemptStatus() below) all earn the same 25% floor; there is
// still real incentive to nail it early, but nothing ever pays out 0%
// just for being a later attempt.
function eqRetryMultiplier(attemptNumber){
  attemptNumber = attemptNumber || 1;
  if (attemptNumber <= 1) return 1;
  if (attemptNumber === 2) return 0.65;
  if (attemptNumber === 3) return 0.40;
  return 0.25;
}
window.eqRetryMultiplier = eqRetryMultiplier;

// Phase 60 (exploit fix) — hard cap of 4 scored attempts per quiz. Every
// CLOSED attempt counts toward this counter, whether it finished (pass or
// fail) or was aborted — see finishQuiz()/abortQuiz() in index.html, both
// of which push a row into DB.quizHistory[studentId]. Switching between
// "answer badly on purpose" and "abort" can't dodge the cap either way.
const QUIZ_MAX_SCORED_ATTEMPTS = 4;
const QUIZ_LOCK_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h, per the plan's suggested default
window.QUIZ_MAX_SCORED_ATTEMPTS = QUIZ_MAX_SCORED_ATTEMPTS;

// eqQuizAttemptStatus(quizId, studentId) → whether a NEW attempt may start
// right now, and what attempt number it would be.
//   { allowed:true,  attemptNumber } — free to start (attempts 1-4, or the
//                                      cooldown has elapsed, or an override
//                                      is on file)
//   { allowed:false, attemptNumber, cooldownEndsAt } — locked; show the
//                                      remaining wait / ask-a-teacher copy
// Phase 63 (exploit fix — closes the gap Phase 60 left open). Phase 60's cap
// + 24h cooldown only ever slowed farming down: attempt 4 and every attempt
// after it, forever, still paid out a flat 25% of XP/coins once the
// cooldown elapsed — including on a quiz the student had already cleared
// with a perfect score. That's an infinite (if slow) source of reward.
// A genuine 100% clear is now a permanent stop, not just another cooldown
// tier — no countdown, no auto-unlock, no re-farming. Aborted attempts
// (h.aborted) never count toward this: an abandoned run that happened to
// have several correct answers locked in before quitting must not trigger
// a lock the student never actually earned. A teacher override still wins
// over the lock (same escape hatch as the cap below), for the rare case a
// teacher deliberately wants a student to redo an already-perfected quiz.
function eqQuizHasPerfected(quizId, studentId){
  const history = ((DB.quizHistory || {})[studentId] || []).filter(h => h.quizId === quizId);
  return history.some(h => !h.aborted && h.score === 100);
}
window.eqQuizHasPerfected = eqQuizHasPerfected;

function eqQuizAttemptStatus(quizId, studentId){
  const history = ((DB.quizHistory || {})[studentId] || []).filter(h => h.quizId === quizId);
  const attemptsSoFar = history.length;
  const nextAttemptNumber = attemptsSoFar + 1;
  const overrides = (DB.quizAttemptOverrides || {})[studentId] || {};

  if (eqQuizHasPerfected(quizId, studentId) && !overrides[quizId]) {
    return { allowed: false, attemptNumber: nextAttemptNumber, locked: true, perfected: true };
  }
  if (attemptsSoFar < QUIZ_MAX_SCORED_ATTEMPTS) {
    return { allowed: true, attemptNumber: nextAttemptNumber, locked: false };
  }
  if (overrides[quizId]) {
    return { allowed: true, attemptNumber: nextAttemptNumber, locked: false, viaOverride: true };
  }
  const last = history[history.length - 1];
  const lastAt = last ? new Date(last.completedAt).getTime() : 0;
  const cooldownEndsAt = lastAt + QUIZ_LOCK_COOLDOWN_MS;
  if (Date.now() >= cooldownEndsAt) {
    return { allowed: true, attemptNumber: nextAttemptNumber, locked: false };
  }
  return { allowed: false, attemptNumber: nextAttemptNumber, locked: true, cooldownEndsAt };
}
window.eqQuizAttemptStatus = eqQuizAttemptStatus;

// eqFormatCooldown(msRemaining) → "2h 14m" / "14m" — small display helper
// for the quest board's locked state and the blocked-start toast.
function eqFormatCooldown(msRemaining){
  const mins = Math.max(1, Math.ceil(msRemaining / 60000));
  const hrs = Math.floor(mins / 60), rem = mins % 60;
  return hrs > 0 ? `${hrs}h ${rem}m` : `${rem}m`;
}
window.eqFormatCooldown = eqFormatCooldown;

// ── Mascot / Narrator — owned by modules/quest-mascot-lines.js (Phase 6) ────
// MASCOT_EMOTIONS/MASCOT_EMOJI/MASCOT_DEFAULT_LINES/eqMascotLinePool/
// eqMascotLine/eqMascotEmotionFor used to live here (~135 lines) — moved to
// their own file since none of it touches this file's other internals (see
// that file's header). Every call site elsewhere (index.html's
// fireMascotEvent/updateMascotAmbientMood) is unchanged.

// eqGrantQuizAttemptOverride(studentId, quizId) — the "teacher/parent
// override to unlock early" escape hatch from the plan. One-time use: it's
// deleted the moment the student actually starts the next attempt with it
// (see startQuiz() in index.html), so it can't be granted once and quietly
// remove the cap forever.
function eqGrantQuizAttemptOverride(studentId, quizId){
  AppStore.updateState(draft => {
    if (!draft.quizAttemptOverrides) draft.quizAttemptOverrides = {};
    if (!draft.quizAttemptOverrides[studentId]) draft.quizAttemptOverrides[studentId] = {};
    draft.quizAttemptOverrides[studentId][quizId] = true;
  }, { type: 'quiz:attempt-override-granted', payload: { studentId, quizId } });
}
window.eqGrantQuizAttemptOverride = eqGrantQuizAttemptOverride;


// ── Quest chains + weekly leaderboard — owned by modules/quest-chains.js
// (Phase 6) ───────────────────────────────────────────────────────────────
// eqQuizChain/eqGetQuestChains/eqChainStatus/eqWeekStartISO/
// eqGetTopQuestersThisWeek used to live here (~85 lines) — moved to their
// own file for the same reason. Every call site elsewhere is unchanged.
