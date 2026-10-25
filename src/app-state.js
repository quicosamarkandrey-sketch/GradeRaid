// src/app-state.js — real-ESM twin of ../app-state.js.
// Phase 7 (Stream A), file 22/29. Original stays untouched.
//
// All 9 top-level declared symbols exported (getDB, setDB,
// getCurrentUser, setCurrentUser, getCurrentRole, setCurrentRole,
// getSelectedLoginRole, setSelectedLoginRole, checkLevelUp), matching
// declaresCount 9 exactly (dist/dependency-map.json). Only 4 of the 9
// had a pre-existing explicit `window.X = X;` trailing line in the
// original (setCurrentUser, getCurrentRole, getCurrentUser, getDB) —
// the other 5 (including checkLevelUp, confirmed via grep to have a
// real external consumer: modules/admin/student-manager.js and
// modules/mail/mail-engine.js both call `window.checkLevelUp(s)`) relied
// on the standard classic-script "top-level function declarations
// auto-attach to window" behavior instead. The bridge re-attaches all 9
// regardless, which is the correct, equivalent behavior either way.
//
// ZERO real imports — genuinely everything here is window-fallback,
// including symbols from files this stream has already converted:
//   - DB, currentUser, currentRole, selectedLoginRole (index.html's
//     inline1, i.e. src/inline1.js) — per the standing rule from that
//     file's own conversion: these are reassigned by many still-
//     classic-script files (this file among them!) and by other
//     streams' files, so their true "live" value is whichever script
//     last wrote to window, never any one module's internal binding.
//     Never a real-import target.
//   - saveDB (db-schema.js) — per the standing "named export ≠ safe
//     real-import" rule (MEMORY.md): state-manager.js reassigns
//     `window.saveDB` at runtime once AppStore boots. Window-fallback,
//     same as db-migrations.js's identical reasoning.
//   - getLevel — NOT actually unambiguous! Genuinely multi-declared:
//     src/inline1.js exports one `getLevel`, but student-stats.js's
//     recalcStudentStats() ALSO does `window.getLevel = function(xp){...}`
//     (identical logic, different function object) EVERY TIME IT RUNS,
//     re-overwriting whichever `getLevel` was on window before. Since
//     which one is "current" at any given moment is genuinely runtime-
//     order-dependent, real-importing EITHER one would be wrong — this
//     must stay a bare window-fallback lookup, always.

// ─────────────────────────────────────────────────────────────────────────────
// APP STATE  — Centralized mutable globals: DB, currentUser, currentRole
//
// STATUS: INTERFACE-ONLY — not wired to any call sites yet.
//   All 754 references to DB and 216 to currentUser/currentRole in the
//   codebase still use the raw globals directly. This file defines the
//   getter/setter contract for Phase 3+ modularisation but is NOT currently
//   imported or called by any module.
//
//   Do NOT wire individual modules to these getters piecemeal — that creates
//   a mixed access pattern harder to debug than the current uniform global use.
//   The correct path is Phase 3: migrate ALL call sites in one pass.
//
// PURPOSE
//   This module wraps the three core mutable globals in typed getters/setters
//   so that modules never directly mutate them. This is the key step that
//   makes every other module independently testable and prepares the codebase
//   for async Supabase migration.
//
// CURRENT STATE (Phase 1)
//   The raw globals (DB, currentUser, currentRole, selectedLoginRole) still
//   exist in the global scope in the monolith for backward compatibility.
//   This module provides getter/setter wrappers that read from and write to
//   those same globals, ensuring no behavioral change while establishing the
//   module contract for Phase 2+.
//
// PHASE 1 EXTRACTION STRATEGY
//   All application code continues to reference DB, currentUser, currentRole
//   directly (754 + 216 references). The getters/setters here will be used
//   by newly extracted modules. Existing code is untouched.
//
// FUTURE (Phase 2+)
//   Once all modules import from app-state, remove the raw globals and make
//   setDB() the sole mutation point. Then getDB() becomes async-ready for
//   Supabase.
//
// DEPENDENCY
//   DBService must be loaded before this module.
//   DEFAULT_DB (from core/db-schema.js) must be available for loadDB().
// ─────────────────────────────────────────────────────────────────────────────

// ── Raw globals (backward-compatible — still referenced directly by monolith) ──
// These are declared in the monolith's main script block.
// This module reads from and writes to those same variables.
// During modularization, modules that are extracted will import these
// getters/setters instead of accessing the raw globals.

/**
 * getDB() → Object
 * Returns the current in-memory DB object.
 * All modules should use this instead of accessing `DB` directly.
 *
 * [BLOCKER-SYNC] Will become async getDB() when Supabase is integrated.
 */
export function getDB() {
  return DB; // eslint-disable-line no-undef
}

/**
 * setDB(newDB) → void
 * Replaces the in-memory DB and persists it.
 * Modules should call this instead of directly assigning to `DB`.
 */
export function setDB(newDB) {
  DB = newDB; // eslint-disable-line no-undef
  saveDB();   // eslint-disable-line no-undef
}

/**
 * getCurrentUser() → Object|null
 * Returns the currently logged-in user object, or null if not logged in.
 */
export function getCurrentUser() {
  return currentUser; // eslint-disable-line no-undef
}

/**
 * setCurrentUser(user) → void
 * Sets the currently logged-in user. Pass null to clear.
 */
export function setCurrentUser(user) {
  currentUser = user; // eslint-disable-line no-undef
}

/**
 * getCurrentRole() → 'student'|'teacher'|'admin'|null
 * Returns the current user's role, or null if not logged in.
 */
export function getCurrentRole() {
  return currentRole; // eslint-disable-line no-undef
}

/**
 * setCurrentRole(role) → void
 * Sets the current user's role. Pass null to clear.
 */
export function setCurrentRole(role) {
  currentRole = role; // eslint-disable-line no-undef
}

/**
 * getSelectedLoginRole() → 'student'|'admin'
 * Returns the role selected on the login screen tab.
 */
export function getSelectedLoginRole() {
  return selectedLoginRole; // eslint-disable-line no-undef
}

/**
 * setSelectedLoginRole(role) → void
 * Sets the role selected on the login screen tab.
 */
export function setSelectedLoginRole(role) {
  selectedLoginRole = role; // eslint-disable-line no-undef
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 NOTE: Safe Extraction Assessment
//
// The 754 references to `DB`, 216 references to `currentUser`/`currentRole`,
// 119 `saveDB()` callsites, and 175 `loadDB()` callsites are NOT touched in
// Phase 1. The monolith continues to use raw globals directly.
//
// This file establishes the module contract. Feature modules extracted in
// Phase 3 will import these functions and use them exclusively, making
// Phase 3 modules cleanly decoupled from the global scope.
//
// Extraction blocker: Cannot safely remove raw globals until all 754 DB
// references have been migrated to getDB()/setDB(). This is Phase 3 work.
// ─────────────────────────────────────────────────────────────────────────────
export function checkLevelUp(student) {
  const newLevel = getLevel(student.xp);
  if (newLevel > student.level) {
    student.level = newLevel;
    // Trigger any level-up animations or rewards here
    console.log(`[LevelUp] ${student.name} reached level ${newLevel}`);
    return true; 
  }
  return false;
}

// ── Phase 7 (2026-08-10, session 7): explicit window exports ──
// These were previously implicit globals (bare top-level declarations,
// reachable to other files only via classic-script auto-attach-to-window
// behavior). Made explicit ahead of any real bundle/module scoping change
// — found by build/audit-window-exports.js, which checks every symbol with
// a real cross-file consumer, not just ones reachable from onclick markup.
// See PHASE7_WINDOW_EXPORT_AUDIT.md.
window.setCurrentUser = setCurrentUser;
window.getCurrentRole = getCurrentRole;
window.getCurrentUser = getCurrentUser;
window.getDB = getDB;
