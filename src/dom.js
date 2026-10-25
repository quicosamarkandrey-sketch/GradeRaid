// ─────────────────────────────────────────────────────────────────────────────
// SHARED DOM — DOM manipulation utilities used across all modules
//
// Exports: toast(), showModal(), closeModal(), closeModalForce()
//
// DEPENDENCIES: None
//   Requires DOM elements: #toast, #modal-box, #modal-content, #modal-overlay
//   These elements are defined in the HTML shell (index.html).
//
// Phase 7 (2026-08-10, session 5) — step 5.3, first real conversion.
// This is the real-ESM twin of the original ../dom.js, which stays
// completely untouched (still a classic <script src> in index.html, still
// what production and the legacy concat build actually load). This file
// exists only in the parallel build universe until enough of src/ exists
// for the single cutover event described in the Phase 7 session memory
// doc, principle 8 — see PHASE7_SRC_CONVERSION_TRACKER.md for what's
// converted so far and PHASE7_DEPENDENCY_MAP.md for why dom.js was picked
// first (fan-out 0, highest fan-in of any true leaf: 59).
//
// No `window.X = X` shim needed here — nothing consumes THIS file via
// `import` yet (it's not wired into any entry point that ships), so there
// are no "unconverted consumers of this specific copy" to shim for. The
// original ../dom.js's own window.toast/closeModal/closeModalForce
// exports (added in session 2) remain exactly as they were, still serving
// all 59 real consumers via the unconverted, still-live file.
// ─────────────────────────────────────────────────────────────────────────────

export function toast(msg, color = '#4edea3') {
  const el = document.getElementById('toast');
  el.style.display = 'block'; el.style.borderColor = color + '55'; el.style.boxShadow = `0 0 20px ${color}33`;
  el.innerHTML = msg; clearTimeout(el._t); el._t = setTimeout(() => el.style.display = 'none', 2800);
}

export function showModal(content, size = 'md') {
  document.getElementById('modal-box').className = 'modal-box ' + size;
  document.getElementById('modal-content').innerHTML = content;
  document.getElementById('modal-overlay').style.display = 'flex';
}

export function closeModal(e) { if (!e || e.target === document.getElementById('modal-overlay')) document.getElementById('modal-overlay').style.display = 'none'; }
export function closeModalForce() { document.getElementById('modal-overlay').style.display = 'none'; }

// Decorative UI icons: closed names and paths; no user-provided SVG markup.
export function uiIcon(name) {
  const paths = {
    "users": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-4",
    "book": "M4 4h7l1 2 1-2h7v15h-7l-1 2-1-2H4V4Z M12 6v15",
    "bag": "M6 7h12l1 14H5L6 7Z M9 7V5a3 3 0 0 1 6 0v2",
    "box": "M3 7l9-4 9 4v10l-9 4-9-4V7Z M3 7l9 4 9-4 M12 11v10 M7 5l10 4",
    "award": "M12 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z M8 14l-2 7 6-3 6 3-2-7",
    "calendar": "M3 5h18v16H3V5Z M7 3v4 M17 3v4 M3 10h18 M7 14h2 M13 14h4",
    "mic": "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5Z M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8",
    "chart": "M4 20V10h4v10 M10 20V4h4v16 M16 20v-7h4v7",
    "flame": "M12 3c1 5 7 7 7 12a7 7 0 0 1-14 0c0-3 2-5 4-7 0 3 1 4 3 5 2-3 2-6 0-10Z",
    "check": "M5 12l4 4L19 6",
    "food": "M4 3v6a3 3 0 0 0 6 0V3 M7 3v18 M19 3c-4 2-4 8 0 8v10 M19 3v8",
    "privilege": "M12 3l8 4v6c0 4-8 8-8 8s-8-4-8-8V7l8-4Z M8 12l3 3 5-6",
    "mystery": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M9 9a3 3 0 1 1 4 3c-1 0-1 1-1 2 M12 17h.01",
    "close": "M6 6l12 12 M6 18L18 6"
};
  const aliases = { supplies: 'box', unknown: 'box' };
  const key = Object.prototype.hasOwnProperty.call(aliases, name) ? aliases[name] : name;
  const path = Object.prototype.hasOwnProperty.call(paths, key) ? paths[key] : paths.box;
  return '<svg class="eq-line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + path + '"/></svg>';
}
window.uiIcon = uiIcon;
