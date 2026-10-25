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
    "close": "M6 6l12 12 M6 18L18 6",
    "mail": "M3 5h18v14H3V5Z M3 5l9 8 9-8",
    "coin": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M9 9h4a2 2 0 0 1 0 4h-2a2 2 0 0 0 0 4h4 M12 7v12",
    "lock": "M6 10h12v11H6V10Z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3",
    "warning": "M12 3l10 18H2L12 3Z M12 9v5 M12 17h.01",
    "chair": "M6 3h12v9H6V3Z M4 12h16v5H4v-5Z M6 17v5 M18 17v5",
    "door": "M5 22V3l13-2v21 M3 22h18 M14 12h.01",
    "settings": "M4 7h16 M4 17h16 M8 4v6 M16 14v6",
    "home": "M3 10l9-7 9 7 M5 9v12h5v-7h4v7h5V9",
    "scan": "M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M6 12h12 M8 8v8 M12 8v8 M16 8v8",
    "search": "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z M15 15l6 6",
    "menu": "M3 6h18 M3 12h18 M3 18h18",
    "bell": "M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3Z M10 21h4",
    "arrow": "M4 12h16 M14 6l6 6-6 6",
    "back": "M20 12H4 M10 6l-6 6 6 6",
    "plus": "M12 4v16 M4 12h16",
    "minus": "M4 12h16",
    "edit": "M4 16L16 4l4 4L8 20H4v-4Z M14 6l4 4",
    "delete": "M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7",
    "save": "M4 3h13l4 4v14H3V3h1Z M7 3v6h10V3 M7 21v-8h10v8",
    "eye": "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
    "logout": "M9 3H3v18h6 M8 12h13 M16 7l5 5-5 5",
    "clock": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 7v5l4 2",
    "link": "M10 14l4-4 M8 16l-2 2a4 4 0 0 1-5-5l5-5a4 4 0 0 1 6 0 M16 8l2-2a4 4 0 0 1 5 5l-5 5a4 4 0 0 1-6 0",
    "upload": "M12 16V3 M7 8l5-5 5 5 M4 16v5h16v-5",
    "chevron": "M8 4l8 8-8 8",
    "chevron-down": "M4 8l8 8 8-8",
    "chevron-up": "M4 16l8-8 8 8",
    "refresh": "M20 7a9 9 0 1 0 1 9 M20 3v5h-5",
    "info": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 11v6 M12 7h.01",
    "image": "M3 3h18v18H3V3Z M3 17l5-5 4 4 3-3 6 6 M16 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
    "camera": "M3 7h4l2-3h6l2 3h4v14H3V7Z M12 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
    "palette": "M12 3a9 9 0 1 0 0 18h1c3 0 2-4 5-4 4 0 5-14-6-14Z M7 9h.01 M11 6h.01 M16 8h.01 M6 14h.01",
    "flag": "M5 22V3h14l-3 5 3 5H5",
    "circle": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
    "stop": "M5 5h14v14H5V5Z"
};
  const aliases = { supplies: 'box', unknown: 'box' };
  const key = Object.prototype.hasOwnProperty.call(aliases, name) ? aliases[name] : name;
  const path = Object.prototype.hasOwnProperty.call(paths, key) ? paths[key] : paths.box;
  return '<svg class="eq-line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + path + '"/></svg>';
}
window.uiIcon = uiIcon;
