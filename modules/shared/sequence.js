// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/shared/sequence.js
//  Timeline Sequencer: window.runSequence(steps) — chains timed steps for
//  Wow Moments (level-up, boss defeat, promotion) without any animation engine.
//
//  Usage:
//    runSequence([
//      { delay: 0,   run: () => document.body.classList.add('screen-dim') },
//      { delay: 200, run: () => overlay.classList.add('show') },
//      { delay: 1600, run: () => overlay.classList.remove('show') },
//    ]);
//  `delay` is milliseconds after the PREVIOUS step starts (not absolute), so
//  step timings can be reordered/tuned independently without recalculating
//  offsets by hand.
//
//  Every Wow Moment built on this must stay skippable (§12.1 of the redesign
//  proposal — a teacher mid-class can never be trapped in a celebration).
//  runSequence() itself has no skip affordance baked in — that's a per-moment
//  UI decision (e.g. a dismiss button that clears the pending timeouts) — but
//  it returns its own cancel handle so callers can implement one.
//
//  LOAD: after modules/shared/stat-bars.js. No dependencies.
// ═══════════════════════════════════════════════════════════════════════════════

(function (window) {
  'use strict';

  /**
   * Run a sequence of timed steps.
   * @param {Array<{delay:number, run:Function}>} steps
   * @returns {Function} cancel — clears all remaining scheduled steps
   */
  function runSequence(steps) {
    var cumulative = 0;
    var timers = (steps || []).map(function (step) {
      cumulative += step.delay || 0;
      return setTimeout(step.run, cumulative);
    });
    return function cancel() {
      timers.forEach(function (t) { clearTimeout(t); });
    };
  }

  window.runSequence = runSequence;
})(window);
