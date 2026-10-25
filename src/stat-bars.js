// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — src/stat-bars.js
//  Universal Stat Bar Renderer: renderStatBar(el, { percent, tier, justChanged })
//
//  Every fill/HP/XP bar in the app currently sets `style.width` by hand at its
//  own call site (modules/world-boss/student-page.js #wb-hp-fill,
//  modules/boss-studio/bs_editor.js #bsed-hp-fill, the sidebar XP sliver, quiz
//  progress, etc.) — each with slightly different color/critical-state logic.
//  This is the single shared renderer those call sites should converge on.
//
//  MARKUP CONTRACT — the container element passed to renderStatBar() must have
//  a single child with class "stat-bar-fill":
//    <div class="stat-bar" data-tier="normal">
//      <div class="stat-bar-fill"></div>
//    </div>
//
//  Tiers: "normal" | "critical" (drive color via CSS — see
//  styles/modules/motion-foundation.css). Callers decide the threshold
//  (e.g. World Boss HP passes tier:"critical" under 20%); this renderer does
//  not hardcode any domain-specific cutoff.
//
// Phase 7 (2026-08-10, session 11) — step 5.3, second real conversion.
// This is the real-ESM twin of the original ../modules/shared/stat-bars.js,
// which stays completely untouched (still a classic <script src> in
// index.html, still what production and the legacy concat build actually
// load). Picked as the next leaf per PHASE7_DEPENDENCY_MAP.md: fan-out 0,
// highest fan-in (3) of any remaining unconverted leaf. See
// PHASE7_SRC_CONVERSION_TRACKER.md for the conversion pattern.
//
// No `window.X = X` shim needed here, same reasoning as src/dom.js —
// nothing consumes this file via `import` in any shipping entry point yet.
// ═══════════════════════════════════════════════════════════════════════════════

export function renderStatBar(el, state) {
  if (!el) return;
  state = state || {};
  var percent = Math.max(0, Math.min(100, Number(state.percent) || 0));
  var tier = state.tier || 'normal';

  var fill = el.querySelector('.stat-bar-fill');
  if (!fill) return;

  fill.style.width = percent + '%';
  el.dataset.tier = tier;

  if (state.justChanged) {
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) {
      el.classList.remove('stat-bar-pulse');
      void el.offsetWidth; // force reflow so the class re-triggers
      el.classList.add('stat-bar-pulse');
    }
  }
}
