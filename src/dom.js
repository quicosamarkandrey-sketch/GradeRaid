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
