
// ═══════════════════════════════════════════
//  STATE & STORAGE
// ═══════════════════════════════════════════
// ── FIXED: Core Leveling Math declared first to prevent boot errors ──
window.XP_PER_LEVEL = 1000; 
window.getLevel = function(xp) { 
  return Math.floor(xp / window.XP_PER_LEVEL); 
};
window.getNowLabel = function() {
  return new Date().toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};
// Use `var` (not `let`) so DB is also window.DB — this keeps the lexical variable
// and window.DB as the same storage slot, fixing the syncFromLegacy() stale-read bug.
var DB;
let currentUser = null, currentRole = null, selectedLoginRole = 'student';

AppStore.ready.then(function () {
  DB = AppStore.getState();
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
