// ─────────────────────────────────────────────────────────────────────────────
// QUEST BOARD — quest chains + weekly top-questers leaderboard
//
// Phase 6 (Decompose God Files, this engineering refactor) extraction from
// modules/quest-engine.js. Owns the chain-metadata normalizer, the
// grouped-and-ordered chain list builder, per-chain completion status, and
// the "this week's top academic performers" query used by the weekly
// leaderboard widget. No behavior change — every line below is moved
// verbatim.
//
// WHY THIS WAS SAFE TO EXTRACT (checked before moving anything, not
// assumed): grepped this whole block for dependencies beyond its own
// exports. Everything it touches was already an established cross-file
// dependency before this extraction, not a new one: DB.quizzes/DB.students/
// DB.leaderboardConfig (globals every module in this app already reads
// directly), eqlComputeAcademic (from modules/leaderboard/eql-engine.js,
// loaded well before this file either way), and three functions that stay
// in quest-engine.js (eqGetWeeklyQuizId(), eqQuizCadence(), eqQuizRarity())
// — ordinary cross-file calls, the same pattern every split in this phase
// relies on.
//
// Exports: eqQuizChain(), eqGetQuestChains(), eqChainStatus(),
//   eqWeekStartISO(), eqGetTopQuestersThisWeek()
//
// DEPENDENCIES: DB, eqlComputeAcademic() (modules/leaderboard/eql-engine.js),
// eqGetWeeklyQuizId()/eqQuizCadence()/eqQuizRarity() (still in
// modules/quest-engine.js) — all globals already available wherever this
// file loads.
// ─────────────────────────────────────────────────────────────────────────────

// eqQuizChain(q) → { chainId, chainOrder, chainLabel } — normalizes the
// three chain fields with safe defaults, same defensive-fallback style as
// eqQuizRarity()/eqQuizCadence() above. A quiz with no chainId is simply
// not part of any chain (the pre-Phase-4 default — nothing old breaks).
function eqQuizChain(q){
  return {
    chainId:    (q && q.chainId) || null,
    chainOrder: (q && Number.isFinite(q.chainOrder)) ? q.chainOrder : 1,
    chainLabel: (q && q.chainLabel) || '',
  };
}
window.eqQuizChain = eqQuizChain;

// eqGetQuestChains() → [{ chainId, chainLabel, quizzes:[q,...] }, ...]
// Groups every chained quiz (chainId set) by chain, sorted by chainOrder.
// Unchained (standing/daily/weekly, no chainId) quizzes never appear here —
// renderStudentQuizzes() in index.html filters them out of the chain
// section and leaves them in the normal grid untouched.
function eqGetQuestChains(){
  const groups = {};
  (DB.quizzes || []).forEach(q => {
    const c = eqQuizChain(q);
    if (!c.chainId) return;
    if (!groups[c.chainId]) groups[c.chainId] = { chainId: c.chainId, chainLabel: c.chainLabel || c.chainId, quizzes: [] };
    if (c.chainLabel && !groups[c.chainId].chainLabel) groups[c.chainId].chainLabel = c.chainLabel;
    groups[c.chainId].quizzes.push(q);
  });
  return Object.values(groups).map(g => {
    g.quizzes.sort((a, b) => eqQuizChain(a).chainOrder - eqQuizChain(b).chainOrder);
    return g;
  });
}
window.eqGetQuestChains = eqGetQuestChains;

// eqChainStatus(chainQuizzes, qid, completedIds) → 'done' | 'unlocked' | 'locked'
// The next unlocked quest in a chain is the first one (in chainOrder) not
// yet in completedIds; everything before it is 'done', everything after
// stays 'locked' until the ones ahead of it clear.
function eqChainStatus(chainQuizzes, qid, completedIds){
  const idx = chainQuizzes.findIndex(q => q.id === qid);
  if (idx === -1) return 'locked';
  if (completedIds.includes(qid)) return 'done';
  const firstIncompleteIdx = chainQuizzes.findIndex(q => !completedIds.includes(q.id));
  return idx === firstIncompleteIdx ? 'unlocked' : 'locked';
}
window.eqChainStatus = eqChainStatus;

// eqWeekStartISO(dateStr?) → 'YYYY-MM-DD' of the Monday starting this
// (Manila-calendar) week. Same week-boundary math eqGetWeeklyQuizId() uses,
// pulled out standalone since eqGetTopQuestersThisWeek() below needs the
// boundary itself (as a resetAt cutoff), not a seeded pick from it.
function eqWeekStartISO(dateStr){
  dateStr = dateStr || isoDate();
  const d = new Date(dateStr + 'T00:00:00');
  const dayIdx = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dayIdx);
  return d.toISOString().slice(0, 10);
}
window.eqWeekStartISO = eqWeekStartISO;

// eqGetTopQuestersThisWeek(classId, limit?) → [{ student, quizCount,
// academicXP, bestScore, rank }, ...]
// quest_board_report.md §3.12 — "pulled from your existing leaderboard
// engine ... without needing a whole new leaderboard system": this reuses
// eqlComputeAcademic() (modules/leaderboard/eql-engine.js) with a rolling
// Monday-boundary resetAt, completely independent of the admin-controlled
// DB.leaderboardConfig.academic.resetAt the Hall of Fame page uses — "this
// week" here always means the current calendar week, not whenever an admin
// last hit reset. Ranked by academicXP (already time-filtered inside
// eqlComputeAcademic), same tiebreaker order the engine itself uses.
function eqGetTopQuestersThisWeek(classId, limit){
  limit = limit || 5;
  if (typeof eqlComputeAcademic !== 'function') return [];
  const resetAt = eqWeekStartISO() + 'T00:00:00.000Z';
  const pool = classId ? (DB.students || []).filter(s => s.classId === classId) : (DB.students || []);
  const entries = pool.map(s => {
    const stats = eqlComputeAcademic(s.id, resetAt);
    return { student: s, quizCount: stats.quizCount, academicXP: stats.academicXP, bestScore: stats.bestScore };
  }).filter(e => e.quizCount > 0);
  entries.sort((a, b) => b.academicXP - a.academicXP || b.quizCount - a.quizCount);
  entries.forEach((e, i) => { e.rank = i + 1; });
  return entries.slice(0, limit);
}
window.eqGetTopQuestersThisWeek = eqGetTopQuestersThisWeek;

