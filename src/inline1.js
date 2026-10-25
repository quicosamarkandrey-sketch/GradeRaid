// src/inline1.js — real-ESM twin of index.html's SECOND inline <script>
// block (index.html#inline1 in dist/dependency-map.json; the FIRST inline
// block is pure Supabase config, already converted as src/config.js by
// an earlier session — see that file's own header. THIRD inline block is
// index.html#inline2, this stream's file 29, not yet converted).
// Phase 7 (Stream A), file 20/29. The original <script> block in
// index.html stays completely untouched — extracted reference text for
// diffing lives at build/inline/inline1.js (regenerate via
// `node build/generate-full-entry.js` if index.html ever changes).
//
// All 7 top-level declared symbols exported (XP_PER_LEVEL, getLevel,
// getNowLabel, DB, currentUser, currentRole, selectedLoginRole),
// matching declaresCount 7 exactly (dist/dependency-map.json).
//
// TWO deliberate, justified deviations from "just add export, the
// bridge handles window re-attachment" — both explained inline at their
// exact location, summarized here:
//   1. `window.XP_PER_LEVEL = XP_PER_LEVEL;` right after its export —
//      getLevel()'s own body reads `window.XP_PER_LEVEL` explicitly
//      (not the bare identifier), a genuine same-file dependency on the
//      window value being live immediately.
//   2. `DB` was `var DB;` in the original specifically (per that
//      comment, kept verbatim) so `window.DB` and the lexical variable
//      would always be the SAME storage slot — real classic-script `var`
//      aliasing that a real ES module has no equivalent for. Converted
//      to `export let DB;` plus an explicit `window.DB = DB;` dual-write
//      at BOTH the initial declaration and the one place DB is
//      reassigned (inside the AppStore.ready.then() callback) — the
//      dual-write there is not optional: `runMigrations()` is called on
//      the very next line, and db-migrations.js (already converted,
//      real-imports DEFAULT_DB but deliberately keeps DB itself
//      window-fallback) reads DB via `window.DB` — without this,
//      runMigrations() would silently operate on stale/undefined data.
//      `DB` is also reassigned by app-state.js (this stream's own file,
//      NOT yet converted) via a bare `DB = newDB;` — once this file
//      moves out of the classic-script shared lexical scope, that
//      write, and every other classic script's read/write of bare `DB`,
//      naturally converges on `window.DB` instead (the universal
//      fallback), which is exactly the intended, correct behavior for
//      this migration strategy — no special handling needed for that
//      side, only for the specific ordering problem above.
//
// currentUser/currentRole/selectedLoginRole do NOT need the dual-write
// treatment: nothing in this file's OWN body depends on their window
// values being live (unlike XP_PER_LEVEL/DB above) — they're plain
// `export let` with the original's own pre-existing trailing
// `window.X = X;` lines kept verbatim (not new self-wiring). They are
// reassigned by MANY other files (auth.js, app-state.js — this stream's
// own, not yet converted; modules/achievements/ach_engine.js,
// modules/shop/shop_store.js — other streams) via bare identifiers;
// once this file is no longer a classic script, all of those
// reassignments/reads naturally converge on `window.currentUser`/etc.
// instead, same reasoning as DB's app-state.js case. None of these
// three should ever become a real-import target for any future file —
// their true "live" value is whichever classic script last wrote to
// window, not this module's own internal binding.
//
// ONE real import: AppStore (modules/core/state-manager.js) — .ready,
// .getState(), .syncFromLegacy(). Also runMigrations() (db-migrations.js)
// — both this stream's own already-converted files, both confirmed via
// repo-wide grep against the "no runtime reassignment anywhere" rule
// (MEMORY.md) before finalizing. Checked both for a reverse dependency
// back onto this file's own declared symbols — AppStore/db-migrations.js
// reference DB/currentUser/etc. only as window-fallback consumers
// (expected, that's the fanOut relationship, not a cycle back to this
// file's load-time code).
//
// Everything else (DSMService — dsm-service.js, this stream's own file,
// but typeof-guarded in the original, left exactly as-is per the
// "guarded access means the original author intentionally deferred"
// rule; restoreSession — auth.js, part of the known nav.js/auth.js/
// inline1/inline2/state-manager.js 5-way cycle, not yet converted)
// stays bare-identifier window fallback.

import { AppStore } from './modules/core/state-manager.js';
import { runMigrations } from './db-migrations.js';

// ═══════════════════════════════════════════
//  STATE & STORAGE
// ═══════════════════════════════════════════
// ── FIXED: Core Leveling Math declared first to prevent boot errors ──
export const XP_PER_LEVEL = 1000; 
// Explicit window dual-write here (deviates from this stream's usual "don't add
// new self-wiring, the bridge handles it" convention) because getLevel()'s OWN
// body, below, explicitly reads `window.XP_PER_LEVEL` rather than the bare
// identifier — a genuine same-file internal dependency on the window value being
// live immediately, not just "eventually, once the bridge runs."
window.XP_PER_LEVEL = XP_PER_LEVEL;
export const getLevel = function(xp) { 
  return Math.floor(xp / window.XP_PER_LEVEL); 
};
export const getNowLabel = function() {
  return new Date().toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};
// Use `var` (not `let`) so DB is also window.DB — this keeps the lexical variable
// and window.DB as the same storage slot, fixing the syncFromLegacy() stale-read bug.
// [Phase 7 ESM conversion]: `var`'s automatic window-aliasing doesn't exist in a
// real ES module, so this file now does the same job with an explicit dual-write
// wherever DB is reassigned (see the .then() callback below) instead of relying on
// `var` semantics. See this file's own top-of-file header comment for the full
// explanation of why this matters here specifically (unlike currentUser/currentRole/
// selectedLoginRole below, which don't need this).
export let DB;
window.DB = DB;
export let currentUser = null, currentRole = null, selectedLoginRole = 'student';

AppStore.ready.then(function () {
  DB = AppStore.getState();
  window.DB = DB; // explicit dual-write — see top-of-file header; `runMigrations()`
                  // on the next line reads DB via window (it's real-imported from
                  // db-migrations.js, where DB itself stays window-fallback), so this
                  // MUST happen before that call, not just at the end of this callback.
  runMigrations();
  // Push the post-migration DB explicitly into AppStore so _state is always current.
  AppStore.syncFromLegacy(DB);

  // DSM (Navigation Manager) hydration — see EduQuest_Pending_Fixes_Report.md
  // §1 / dsm-service.js. Runs alongside (not blocking) the DB hydration
  // above: dsm-manager.js's dsmLoad() is only ever first called from
  // bootApp() → setupSidebar() after a successful login, which is always
  // well after this script tag finishes running, so there is no ordering
  // requirement between this and the DB/AppStore hydration above — it just
  // needs to have started.
  if (typeof DSMService !== 'undefined' && typeof DSMService.initRemote === 'function') {
    DSMService.initRemote().catch(function (e) {
      console.warn('[DSMService] initRemote() rejected; Navigation Manager will fall back to local cache:', e);
    });
  }

  // BUGFIX (refresh logs the user out): restore an already-valid Supabase
  // session on page load instead of always showing the login screen. See
  // restoreSession() in auth.js for the full explanation. Fire-and-forget,
  // same as the DSMService.initRemote() call above — if there's no saved
  // session it resolves immediately and the login screen (already the
  // default display state in the HTML) just stays put.
  if (typeof restoreSession === 'function') {
    restoreSession().catch(function (e) {
      console.warn('[auth] restoreSession() rejected; staying on login screen:', e);
    });
  }
});

// Phase 7 (2026-08-10, session 7): explicit window exports — previously
// implicit globals (bare top-level let/var in this inline block), found
// by build/audit-window-exports.js. currentUser/currentRole have 51 and
// 39 real cross-file consumers respectively — the highest of any symbol
// in the entire codebase. See PHASE7_WINDOW_EXPORT_AUDIT.md.
window.currentUser = currentUser;
window.currentRole = currentRole;
window.selectedLoginRole = selectedLoginRole;
