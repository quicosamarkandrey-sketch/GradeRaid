// ─────────────────────────────────────────────────────────────────────────────
// ACTIVE SECTION — src/active-section.js
// Shared, cross-tab-synced "which section am I looking at" state for the
// Teacher Command Deck and the Kiosk Terminal.
//
// WHAT THIS IS NOT: a security boundary. Every write path re-validates the
// section server-side regardless of what this module reports — treat
// ActiveSection.get() as "what the UI should show/send," never as "what
// the server should trust."
//
// USAGE
//   ActiveSection.get()                 -> string | null
//   ActiveSection.set('sec_abc123')      -> void, syncs other tabs
//   ActiveSection.onChange(fn)           -> fn(newClassId) on any change,
//                                           this tab or another
//   ActiveSection.initFromURL('section') -> reads ?section=... once, kiosk-only
//
// Phase 7 (2026-08-10, session 14) — step 5.3, ninth real conversion. This
// is the real-ESM twin of the original ../modules/core/active-section.js,
// which stays completely untouched. Function bodies copied byte-for-byte.
// The `window.addEventListener('storage', ...)` registration is preserved
// as real module-top-level code, which ES modules run exactly once per
// module instance — same as the original IIFE ran once per page load.
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'eduquest_active_section';
const listeners = [];

function get() {
  try { return localStorage.getItem(STORAGE_KEY) || null; }
  catch (e) { return null; }
}

function set(classId) {
  if (!classId) return;
  const prev = get();
  try { localStorage.setItem(STORAGE_KEY, classId); }
  catch (e) { console.warn('[ActiveSection] localStorage write failed:', e); }
  if (prev !== classId) {
    listeners.forEach(fn => { try { fn(classId); } catch (err) { console.error(err); } });
  }
}

function onChange(fn) {
  if (typeof fn === 'function') listeners.push(fn);
}

// Fires in every OTHER open tab when a tab changes the key — this is what
// makes the 3-tab deck stay in sync without any polling.
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY && e.newValue) {
    listeners.forEach(fn => { try { fn(e.newValue); } catch (err) { console.error(err); } });
  }
});

function initFromURL(paramName) {
  paramName = paramName || 'section';
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get(paramName);
  if (fromUrl && !get()) set(fromUrl);
  return get();
}

export const ActiveSection = { get, set, onChange, initFromURL };
