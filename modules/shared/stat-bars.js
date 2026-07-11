// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/shared/stat-bars.js
//  Universal Stat Bar Renderer: window.renderStatBar(el, { percent, tier, justChanged })
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
//  LOAD: after modules/shared/reward-presenter.js, before any page module
//  that renders a bar (world-boss, boss-studio, dashboard, quizzes). No
//  dependencies — safe to load anywhere in the shared block.
// ═══════════════════════════════════════════════════════════════════════════════

(function (window) {
  'use strict';

  /**
   * Render a stat bar's fill width, tier color, and optional "just changed" pulse.
   * @param {Element} el         — the .stat-bar container (NOT the fill itself)
   * @param {Object}  state
   * @param {number}  state.percent      — 0-100, clamped
   * @param {string}  [state.tier]       — "normal" | "critical" (exposed as data-tier for CSS)
   * @param {boolean} [state.justChanged] — if true, restarts the brightness pulse animation
   */
  function renderStatBar(el, state) {
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

  window.renderStatBar = renderStatBar;
})(window);
