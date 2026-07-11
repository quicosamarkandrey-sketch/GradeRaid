// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/shared/particles.js
//  Celebration Particle Burst: window.burstParticles(anchorEl, count, colors)
//
//  NOT a replacement for modules/perceived-speed.js's eqFireClaimBurst() — that
//  one is a small CSS ring for high-frequency Feedback-tier taps (claiming a
//  single reward). This is the bigger canvas-based confetti burst for rare
//  Event-tier Wow Moments (§12 of the redesign proposal — level-up, boss
//  defeated, achievement unlock). Use eqFireClaimBurst for anything that can
//  happen many times a session; use burstParticles for anything that should
//  feel earned and occasional.
//
//  Respects prefers-reduced-motion (no-ops entirely, same convention already
//  used in modules/leaderboard/hall-of-fame.js).
//
//  LOAD: after modules/shared/sequence.js. No dependencies.
// ═══════════════════════════════════════════════════════════════════════════════

(function (window, document) {
  'use strict';

  /**
   * Fire a canvas particle burst centered on anchorEl.
   * @param {Element} anchorEl     — element the burst originates from
   * @param {number}  [count=40]   — particle count
   * @param {string[]} [colors]    — CSS colors to sample from; defaults to the
   *                                 app's own --primary/--secondary/--tertiary tokens
   */
  function burstParticles(anchorEl, count, colors) {
    if (!anchorEl) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    count = count || 40;
    var rect = anchorEl.getBoundingClientRect();

    var canvas = document.createElement('canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.className = 'particle-burst-canvas';
    document.body.appendChild(canvas);
    var ctx = canvas.getContext('2d');

    if (!colors || !colors.length) {
      var styles = getComputedStyle(document.documentElement);
      colors = [
        styles.getPropertyValue('--primary').trim() || '#d0bcff',
        styles.getPropertyValue('--secondary').trim() || '#4edea3',
        styles.getPropertyValue('--tertiary').trim() || '#ffb95f',
      ];
    }

    var particles = [];
    for (var i = 0; i < count; i++) {
      particles.push({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 1.2) * 8,
        size: 2 + Math.random() * 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 1,
      });
    }

    function tick() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var alive = false;
      particles.forEach(function (p) {
        p.vy += 0.15; // gravity
        p.x += p.vx; p.y += p.vy; p.life -= 0.015;
        if (p.life > 0) {
          alive = true;
          ctx.globalAlpha = p.life;
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x, p.y, p.size, p.size);
        }
      });
      if (alive) requestAnimationFrame(tick);
      else canvas.remove();
    }
    requestAnimationFrame(tick);
  }

  window.burstParticles = burstParticles;
})(window, document);
