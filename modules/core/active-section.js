// ─────────────────────────────────────────────────────────────────────────────
// ACTIVE SECTION — shared, cross-tab-synced "which section am I looking at"
// state for the Teacher Command Deck and the Kiosk Terminal.
//
// WHY THIS EXISTS (Phase 14)
//   A teacher opens 3 tabs (Boss HUD, Seating Grid, Leaderboard) from the same
//   browser. Per the section-isolation plan, all 3 should track ONE active
//   section rather than each tab picking independently — switching the
//   section dropdown in any one tab should move all three. localStorage is
//   shared across tabs of the same origin; the 'storage' event fires in
//   every OTHER tab (not the one that made the change), which is exactly the
//   sync mechanism this needs, with no server round-trip.
//
// WHAT THIS IS NOT
//   This is a UI convenience, not a security boundary. Every write path
//   (apply_boss_damage, process_attendance_scan, etc.) re-validates the
//   section server-side regardless of what this module reports — see
//   phase14_section_isolation.sql. Treat ActiveSection.get() as "what the
//   UI should show/send," never as "what the server should trust."
//
// USAGE
//   window.ActiveSection.get()                 -> string | null
//   window.ActiveSection.set('sec_abc123')      -> void, syncs other tabs
//   window.ActiveSection.onChange(fn)           -> fn(newClassId) on any
//                                                  change, this tab or another
//   window.ActiveSection.initFromURL('section') -> reads ?section=... once,
//                                                  for kiosk auto-config on
//                                                  load (see file header note
//                                                  in phase14 plan, §2.7) —
//                                                  optional, only call this
//                                                  on the kiosk terminal.
// ─────────────────────────────────────────────────────────────────────────────

(function () {
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

  // Kiosk convenience only — pre-fills the active section from a URL param
  // on first load so an unattended terminal doesn't need a human to pick
  // from the dropdown. Not a trust boundary; see file header.
  function initFromURL(paramName) {
    paramName = paramName || 'section';
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get(paramName);
    if (fromUrl && !get()) set(fromUrl);
    return get();
  }

  window.ActiveSection = { get, set, onChange, initFromURL };
})();
