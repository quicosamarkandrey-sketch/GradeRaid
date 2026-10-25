// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — src/ambient-backdrop.js
//  Ambient Backdrop Drift: startAmbientBackdrop(canvas, opts)
//
//  A small, low-count decorative canvas loop for hero-band backgrounds
//  (Student Dashboard, World Boss). Purely decorative — never intercepts
//  input, never carries information. Respects prefers-reduced-motion.
//
// Phase 7 (2026-08-10, session 14) — step 5.3, eighth real conversion. This
// is the real-ESM twin of the original ../modules/shared/ambient-
// backdrop.js, which stays completely untouched. Function body copied
// byte-for-byte (verbatim move).
//
// KNOWN, DISCLOSED VERIFICATION LIMITATION (same class as particles.js in
// session 12): jsdom in this sandbox has no real 2D canvas backend. Here
// it's even more immediate than particles.js — `tick()` runs SYNCHRONOUSLY
// on the very first call (`tick();`, not deferred behind
// requestAnimationFrame like particles.js's initial call), so calling
// startAmbientBackdrop() at all with motion allowed would throw
// synchronously in this sandbox, in EITHER build. What could be and was
// verified: the null-canvas guard, the prefers-reduced-motion guard (both
// return a no-op stop function immediately, before any canvas/rendering
// code runs), and — since both are pure guard-clause early returns — that
// covers everything reachable before the untestable canvas path. See
// build/verify-ambient-backdrop-bridge.js.
// ═══════════════════════════════════════════════════════════════════════════════

export function startAmbientBackdrop(canvas, opts) {
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
