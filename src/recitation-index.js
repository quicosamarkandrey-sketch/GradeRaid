// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — src/recitation-index.js
//  Load-order guard + window.* alias verification for the recitation module.
//  Load AFTER logger.js and progress.js.
//
//  Phase 7 (2026-08-10, session 15) — step 5.3, twelfth real conversion.
//  This is the real-ESM twin of the original
//  ../modules/recitation/recitation_index.js, which stays completely
//  untouched. Unlike every prior conversion, the original has no real
//  function exports at all — it's a pure verification/side-effect file
//  (a graph "sink," confirmed in sessions 9-10's role-split work: nothing
//  calls INTO it, it only reads other files' window exports to confirm
//  they loaded correctly). The verification check itself runs as real
//  module-top-level code below, which ES modules execute exactly once per
//  module instance — same guarantee the original IIFE relied on.
//
//  MODULE_VERSION is exported for structural consistency with every other
//  conversion in this phase, even though nothing currently reads it
//  (checked: no file references __RECITATION_MODULE_VERSION__ anywhere).
// ═══════════════════════════════════════════════════════════════════════════════

export const MODULE_VERSION = '1.0.0';

// Verification logic kept inline (not a separate export) — the original
// wraps this in an anonymous IIFE with no reusable exported function, and
// every other conversion in this phase has matched the original's real
// declared/exported symbol count exactly (1 here: MODULE_VERSION only).
// Extracting this into a second export was considered and deliberately
// reverted in favor of that consistency, rather than silently drifting
// the pattern for one file's convenience.
const EXPECTED = [
  'logRecitation',
  'renderStudentProgress',
  'progSwitchTab',
  'progCalNav',
  'progShowCalDay',
];
const missing = EXPECTED.filter((name) => typeof window[name] !== 'function');
if (missing.length) {
  console.error('[EduQuest] recitation/index.js — MISSING exports:', missing);
} else {
  console.log('[EduQuest] recitation/index.js — All exports verified ✅');
}

window.__RECITATION_MODULE_VERSION__ = MODULE_VERSION;
