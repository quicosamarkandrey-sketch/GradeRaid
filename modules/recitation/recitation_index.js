// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/recitation/index.js
//  Load-order guard + window.* alias verification for the recitation module.
//  Load AFTER logger.js and progress.js.
// ═══════════════════════════════════════════════════════════════════════════════

;(function () {
  // ── Load-order verification ─────────────────────────────────────────────────
  // All expected window.* exports from this module.
  const EXPECTED = [
    'logRecitation',
    'renderStudentProgress',
    'progSwitchTab',
    'progCalNav',
    'progShowCalDay',
  ];

  const missing = EXPECTED.filter(name => typeof window[name] !== 'function');
  if (missing.length) {
    console.error('[EduQuest] recitation/index.js — MISSING exports:', missing);
  } else {
    console.log('[EduQuest] recitation/index.js — All exports verified ✅');
  }

  // ── Module version stamp ────────────────────────────────────────────────────
  window.__RECITATION_MODULE_VERSION__ = '1.0.0';

  // ── Explicit window.* aliases (safety — all already set, but belt-and-suspenders) ──
  // logRecitation         → set in logger.js
  // renderStudentProgress → set in progress.js
  // progSwitchTab         → set in progress.js
  // progCalNav            → set in progress.js
  // progShowCalDay        → set in progress.js
})();
