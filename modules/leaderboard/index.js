/* ============================================================
   modules/leaderboard/index.js
   EduQuest — Leaderboard Module Barrel

   Load order (enforced by <script> tags in index.html):
     1. eql-engine.js        — pure score computation + EQL API
     2. hall-of-fame.js      — student HOL UI + renderLeaderboard patch
     3. admin-leaderboard.js — admin panel + nav injection + toggle/reset
     4. index.js (this file) — sanity checks + console banner

   All four files must be loaded AFTER:
     • core/state-manager.js (AppStore) — Phase 3 migration moved all four
       files in this barrel off the legacy DB/saveDB() globals onto AppStore
     • core/state.js       (currentUser)
     • shared/dom.js       (showModal, closeModal, toast)
     • nav.js              (NAV_ADMIN, navTo, setupSidebar)
   And BEFORE any code that calls renderLeaderboard() or EQL.*

   Phase 3 Day 2 — modules/leaderboard/
   ============================================================ */

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────────
  // Load-order guard: verify all expected globals were registered by earlier files
  // ─────────────────────────────────────────────────────────────────────────────
  const REQUIRED = [
    // eql-engine.js
    ['window.EQL',                    typeof window.EQL === 'object'],
    ['window.eqlComputeRecitation',   typeof window.eqlComputeRecitation === 'function'],
    ['window.eqlComputeBoss',         typeof window.eqlComputeBoss === 'function'],
    ['window.eqlComputeAcademic',     typeof window.eqlComputeAcademic === 'function'],
    ['window.eqlComputeOverall',      typeof window.eqlComputeOverall === 'function'],
    ['window.eqlBuildCategory',       typeof window.eqlBuildCategory === 'function'],
    // hall-of-fame.js
    ['window.renderLeaderboard',      typeof window.renderLeaderboard === 'function'],
    // admin-leaderboard.js
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Expose module version tag for diagnostics
  // ─────────────────────────────────────────────────────────────────────────────
  window.__EQL_MODULE_VERSION__ = '3.2.0'; // Phase 3 Day 2

  // ─────────────────────────────────────────────────────────────────────────────
  // Convenience namespace alias (optional — keeps call-sites clean)
  // window.Leaderboard mirrors window.EQL for external consumers that
  // prefer the longer name.
  // ─────────────────────────────────────────────────────────────────────────────
  if (!window.Leaderboard) {
    window.Leaderboard = window.EQL;
  }
})();
