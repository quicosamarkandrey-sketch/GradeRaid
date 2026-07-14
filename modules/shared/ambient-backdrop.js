// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/shared/ambient-backdrop.js
//  Ambient Backdrop Drift: window.startAmbientBackdrop(canvas, opts)
//
//  A small, low-count decorative canvas loop for hero-band backgrounds
//  (Student Dashboard, World Boss). Purely decorative — never intercepts
//  input, never carries information (see redesign proposal §7.4/§8.2: this
//  is Ambient-tier motion, not a data-driven element; use stat-bars.js for
//  anything that needs to communicate real state).
//
//  Also the mechanism seasonal hero skins hang off (redesign proposal §13.2):
//  a lookup table keyed by season feeds different {color, count} into the
//  same function — no new system per season.
//
//  Respects prefers-reduced-motion.
//
//  LOAD: after modules/shared/particles.js. No dependencies.
// ═══════════════════════════════════════════════════════════════════════════════

(function (window, document) {
  'use strict';

  /**
   * Start a slow-drifting dot backdrop inside the given canvas element.
   * @param {HTMLCanvasElement} canvas
   * @param {Object}  [opts]
   * @param {number}  [opts.count=30]
   * @param {string}  [opts.color='#d0bcff']
   * @param {number}  [opts.speed=1] — drift-velocity multiplier. Added for
   *   Improvement Plan §3 (Environmental Intensity System), which needs the
   *   SAME backdrop to visibly speed up per quiz stage rather than standing
   *   up a second particle system. Default of 1 reproduces the exact
   *   original velocity, so every existing caller (dashboard hero, world
   *   boss) is unaffected by this addition.
   * @returns {Function} stop — cancels the animation frame and resize listener
   */
  function startAmbientBackdrop(canvas, opts) {
    if (!canvas) return function () {};
    opts = opts || {};
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return function () {};
    }

    var count = opts.count || 30;
    var color = opts.color || '#d0bcff';
    var baseAlpha = opts.alpha || 0.15;
    var dotSize = opts.dotSize || 1.5;
    var speed = opts.speed || 1;
    var ctx = canvas.getContext('2d');
    var w, h;

    function resize() {
      w = canvas.width = canvas.offsetWidth;
      h = canvas.height = canvas.offsetHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    var dots = [];
    for (var i = 0; i < count; i++) {
      dots.push({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.15 * speed, vy: (Math.random() - 0.5) * 0.15 * speed,
      });
    }

    var frame;
    function tick() {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      ctx.globalAlpha = baseAlpha;
      dots.forEach(function (d) {
        d.x += d.vx; d.y += d.vy;
        if (d.x < 0 || d.x > w) d.vx *= -1;
        if (d.y < 0 || d.y > h) d.vy *= -1;
        ctx.fillRect(d.x, d.y, dotSize, dotSize);
      });
      frame = requestAnimationFrame(tick);
    }
    tick();

    return function stop() {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }

  window.startAmbientBackdrop = startAmbientBackdrop;
})(window, document);
