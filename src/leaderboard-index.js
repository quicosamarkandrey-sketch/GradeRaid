/* ============================================================
   src/leaderboard-index.js
   EduQuest — Leaderboard Module Barrel (real-ESM twin)

   Load order (enforced by <script> tags in index.html):
     1. eql-engine.js        — pure score computation + EQL API
     2. hall-of-fame.js      — student HOL UI + renderLeaderboard patch
     3. admin-leaderboard.js — admin panel + nav injection + toggle/reset
     4. index.js (original)  — sanity checks + console banner

   Phase 7 (2026-08-10, session 16) — step 5.3, fourteenth real conversion.
   Real-ESM twin of the original ../modules/leaderboard/index.js, which
   stays completely untouched. Same aggregator-sink shape as
   recitation-index.js/attendance-index.js (session 15): declares count
   matched exactly (2 — MODULE_VERSION and the Leaderboard alias), rest of
   the verification logic kept inline. `window.Leaderboard = window.EQL`
   preserved exactly as a real `window.` property read (not a bare
   identifier reference) — safe under real module scoping regardless of
   whether eql-engine.js has its own src/ conversion yet, since `window`
   is always the real global object no matter how a file is scoped.
   ============================================================ */

export const MODULE_VERSION = '3.2.0'; // Phase 3 Day 2

const REQUIRED = [
  ['window.EQL',                    typeof window.EQL === 'object'],
  ['window.eqlComputeRecitation',   typeof window.eqlComputeRecitation === 'function'],
  ['window.eqlComputeBoss',         typeof window.eqlComputeBoss === 'function'],
  ['window.eqlComputeAcademic',     typeof window.eqlComputeAcademic === 'function'],
  ['window.eqlComputeOverall',      typeof window.eqlComputeOverall === 'function'],
  ['window.eqlBuildCategory',       typeof window.eqlBuildCategory === 'function'],
  ['window.renderLeaderboard',      typeof window.renderLeaderboard === 'function'],
  ['window.renderAdminLeaderboards',typeof window.renderAdminLeaderboards === 'function'],
  ['window.eqlToggle',              typeof window.eqlToggle === 'function'],
  ['window.eqlAdminPreview',        typeof window.eqlAdminPreview === 'function'],
  ['window.eqlAdminResetConfirm',   typeof window.eqlAdminResetConfirm === 'function'],
  ['window.eqlDoReset',             typeof window.eqlDoReset === 'function'],
  ['window.eqlDoClearReset',        typeof window.eqlDoClearReset === 'function'],
];

const missing = REQUIRED.filter(([, ok]) => !ok).map(([name]) => name);

if (missing.length > 0) {
  console.error(
    '[EQL index.js] ⚠️  Missing exports — check script load order:\n  ' +
    missing.join('\n  ')
  );
} else {
  console.log(
    '%c[EQL] modules/leaderboard/ fully loaded%c\n' +
    '  Engine  : EQL.getLeaderboard(), EQL.getConfig(), EQL.getStats()\n' +
    '  Student : renderLeaderboard(tab?, period?)\n' +
    '  Admin   : renderAdminLeaderboards(), eqlToggle(key),\n' +
    '            eqlAdminPreview(key), eqlAdminResetConfirm(key),\n' +
    '            eqlDoReset(key), eqlDoClearReset(key)\n' +
    '  Categories: recitation | boss | academic | overall | hall',
    'color:#ffb95f;font-weight:bold',
    'color:inherit'
  );
}

window.__EQL_MODULE_VERSION__ = MODULE_VERSION;

if (!window.Leaderboard) {
  window.Leaderboard = window.EQL;
}
// Exported for structural consistency with this file's real declared
// count (2: __EQL_MODULE_VERSION__ and Leaderboard) — even though nothing
// else in the codebase currently references window.Leaderboard (checked
// directly), matching the "declared count = exported count" discipline
// held throughout this phase rather than quietly dropping one because it
// looks unused today.
export const Leaderboard = window.Leaderboard;
