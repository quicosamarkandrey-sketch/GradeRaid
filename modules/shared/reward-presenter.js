// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/shared/reward-presenter.js
//  Universal Reward Presentation System: window.eqRewardPresent({ title, subtitle,
//  icon, rarity, source, rewards: [...], onClose }) — the shared, fullscreen
//  "you got rewards!" popup (rarity-themed panel, confetti burst, reward-card
//  grid, claim button) used by BOTH the Mail module and the Achievements module.
//
//  RESTORED (Phase 3 fix session): this function was referenced correctly by
//  modules/mail/student-inbox.js and modules/achievements/ach_student_page.js
//  (both guard with `typeof eqRewardPresent === 'function'`), but the function
//  itself was never extracted into any module file, so every claim silently
//  fell back to a plain toast(). This file restores the original's actual
//  implementation, verbatim, from the inline UNIVERSAL REWARD PRESENTATION
//  SYSTEM block in the original index.html.
//
//  Ported from this file: window.eqRewardPresent, _eqrRunParticles,
//  EQR_RARITY_COLORS, EQR_SOURCE_LABELS, and the #eq-reward-overlay / .eqr-*
//  runtime CSS injection. The .ach-* and .mail-* CSS that lived alongside
//  these in the original's single combined <style> block are NOT duplicated
//  here — they already exist in styles/modules/achievements.css and
//  styles/modules/mail.css respectively.
//
//  Also restores two small monkey-patches from the same original section
//  that were missing from the extracted codebase entirely (verified — no
//  other module performs this specific combined badge refresh):
//    - bootApp patch: refreshes the mail + achievement sidebar badges
//      400ms after a student logs in.
//    - navTo patch: refreshes the same two badges 150ms after navigation.
//  (A DIFFERENT bootApp patch already exists in
//  modules/world-boss/summon-notify.js for the boss-spawn notification —
//  that one is unrelated and is left untouched.)
//
//  LOAD: before modules/mail/* and modules/achievements/* (organizational —
//  both call sites are inside function bodies, so strict load-before
//  ordering isn't required for correctness, just sensible structure).
// ═══════════════════════════════════════════════════════════════════════════════

// ── INJECT STYLES ─────────────────────────────────────────────────────────────
;(function () {
  const style = document.createElement('style');
  style.textContent = `

/* ═══════════════════════════════════
   UNIVERSAL REWARD PRESENTATION OVERLAY
   ═══════════════════════════════════ */
#eq-reward-overlay {
  position:fixed;inset:0;z-index:8000;
  display:flex;align-items:center;justify-content:center;
  background:rgba(4,3,14,0.92);
  backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
  animation:eqrFadeIn .3s ease forwards;
  padding:20px;
}
@keyframes eqrFadeIn{from{opacity:0}to{opacity:1}}
@keyframes eqrFadeOut{from{opacity:1}to{opacity:0}}

.eqr-panel {
  background:rgba(22,18,40,0.98);
  border-radius:24px;
  border:1px solid rgba(255,255,255,0.1);
  width:100%;max-width:480px;
  max-height:92vh;
  position:relative;overflow:hidden;
  animation:eqrPanelIn .45s cubic-bezier(.17,.67,.34,1.3) forwards;
  box-shadow:0 0 60px rgba(139,92,246,0.2),0 40px 80px rgba(0,0,0,0.6);
}
.eqr-panel-scroll {
  max-height:88vh;overflow-y:auto;
  scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.08) transparent;
}
@keyframes eqrPanelIn{from{transform:scale(.8) translateY(30px);opacity:0}to{transform:scale(1) translateY(0);opacity:1}}

/* Animated top strip */
.eqr-strip {
  height:4px;width:100%;
  background:linear-gradient(90deg,#8b5cf6,#EC4899,#ffb95f,#4edea3,#8b5cf6);
  background-size:200% 100%;
  animation:eqrStrip 2s linear infinite;
}
@keyframes eqrStrip{0%{background-position:0% 0}100%{background-position:200% 0}}

/* Canvas for particle effects */
.eqr-canvas {
  position:absolute;inset:0;width:100%;height:100%;
  pointer-events:none;z-index:0;border-radius:24px;overflow:hidden;
}

.eqr-body { position:relative;z-index:1;padding:32px; }

/* Source label */
.eqr-source-label {
  font-family:var(--fm);font-size:9px;letter-spacing:.18em;
  color:rgba(208,188,255,.5);text-transform:uppercase;
  text-align:center;margin-bottom:16px;
}

/* Icon area */
.eqr-icon-wrap {
  width:80px;height:80px;border-radius:20px;
  display:flex;align-items:center;justify-content:center;
  font-size:44px;margin:0 auto 18px;
  position:relative;
  animation:eqrIconBounce .6s cubic-bezier(.17,.67,.34,1.4) .2s both;
}
@keyframes eqrIconBounce{from{transform:scale(0) rotate(-15deg)}to{transform:scale(1) rotate(0)}}

.eqr-icon-ring {
  position:absolute;inset:-6px;border-radius:26px;
  border:2px solid;
  animation:eqrRingPulse 2s ease-in-out infinite;
}
@keyframes eqrRingPulse{0%,100%{opacity:.4;transform:scale(1)}50%{opacity:.8;transform:scale(1.04)}}
.eqr-icon-ring2 {
  position:absolute;inset:-14px;border-radius:34px;
  border:1px solid;
  opacity:.3;
  animation:eqrRingPulse 2s ease-in-out .4s infinite;
}

/* Rarity badge */
.eqr-rarity-badge {
  display:inline-flex;align-items:center;gap:5px;
  padding:3px 12px;border-radius:20px;
  font-family:var(--fm);font-size:9px;font-weight:700;letter-spacing:.1em;
  margin:0 auto 12px;
}

/* Title & subtitle */
.eqr-title {
  font-family:var(--fh);font-size:26px;font-weight:900;
  color:var(--on-surface);text-align:center;
  line-height:1.2;margin-bottom:6px;letter-spacing:-.5px;
}
.eqr-subtitle {
  font-size:13px;color:var(--text-muted);
  text-align:center;margin-bottom:24px;line-height:1.5;
}

/* Divider */
.eqr-divider {
  height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.1),transparent);
  margin-bottom:20px;
}

/* Rewards section */
.eqr-rewards-label {
  font-family:var(--fm);font-size:9px;letter-spacing:.14em;
  color:rgba(208,188,255,.5);text-align:center;margin-bottom:14px;
}
.eqr-rewards-grid {
  display:flex;gap:10px;justify-content:center;flex-wrap:wrap;
  margin-bottom:24px;
  padding:4px 2px;
}
.eqr-reward-card {
  background:rgba(255,255,255,.04);
  border:1px solid rgba(255,255,255,.1);
  border-radius:14px;padding:14px 16px;
  text-align:center;min-width:90px;flex:1;max-width:130px;
  animation:eqrCardIn .5s cubic-bezier(.17,.67,.34,1.3) both;
  position:relative;overflow:hidden;
}
.eqr-reward-card.eqr-reward-title {
  min-width:180px;max-width:280px;flex:0 0 auto;
  background:rgba(236,72,153,.08);
  border-color:rgba(236,72,153,.3);
}
.eqr-reward-card::after {
  content:'';position:absolute;inset:0;
  background:linear-gradient(180deg,rgba(255,255,255,.03),transparent);
  pointer-events:none;
}
@keyframes eqrCardIn{from{transform:translateY(20px) scale(.8);opacity:0}to{transform:none;opacity:1}}
.eqr-reward-card:nth-child(1){animation-delay:.2s}
.eqr-reward-card:nth-child(2){animation-delay:.3s}
.eqr-reward-card:nth-child(3){animation-delay:.4s}
.eqr-reward-card:nth-child(4){animation-delay:.5s}
.eqr-reward-card:nth-child(5){animation-delay:.6s}

.eqr-reward-icon {font-size:28px;line-height:1;margin-bottom:8px;display:block}
.eqr-reward-amount {
  font-family:var(--fh);font-size:20px;font-weight:900;
  display:block;margin-bottom:3px;
}
.eqr-reward-label {
  font-size:9px;color:var(--text-muted);font-weight:700;
  letter-spacing:.08em;text-transform:uppercase;
}

/* "Nothing to claim" state */
.eqr-no-rewards {
  text-align:center;padding:8px 0 16px;
  font-size:13px;color:var(--text-muted);
  animation:eqrCardIn .5s ease .2s both;
}

/* Claim button */
.eqr-claim-btn {
  width:100%;padding:14px;border-radius:14px;
  border:none;cursor:pointer;
  font-family:var(--fh);font-size:15px;font-weight:900;
  letter-spacing:.04em;color:#fff;
  transition:all .18s;position:relative;overflow:hidden;
  animation:eqrCardIn .4s ease .6s both;
}
.eqr-claim-btn::after {
  content:'';position:absolute;inset:0;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.15),transparent);
  transform:translateX(-100%);transition:transform .5s;
}
.eqr-claim-btn:hover::after{transform:translateX(100%)}
.eqr-claim-btn:hover{transform:translateY(-2px);box-shadow:var(--eqr-btn-glow)}
.eqr-claim-btn:active{transform:translateY(0)}

/* Confetti particle */
.eqr-confetti {
  position:absolute;width:8px;height:8px;border-radius:2px;
  pointer-events:none;z-index:2;
  animation:eqrConfettiFall linear both;
}
@keyframes eqrConfettiFall {
  0%{transform:translateY(-10px) rotate(0deg);opacity:1}
  100%{transform:translateY(600px) rotate(720deg);opacity:0}
}

/* Shine streak on panel */
.eqr-shine {
  position:absolute;top:0;left:-60%;width:40%;height:100%;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.04),transparent);
  transform:skewX(-20deg);pointer-events:none;z-index:2;
  animation:eqrShine 2.5s ease-in-out 0.8s both;
}
@keyframes eqrShine{0%{left:-60%}50%{left:130%}100%{left:130%}}`;
document.head.appendChild(style);
})();

// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL REWARD PRESENTATION SYSTEM
// eqRewardPresent({ title, subtitle, icon, rarity, source, rewards[], onClose })
// rewards = [{type, amount, icon, label, color, titleId?}]
// ─────────────────────────────────────────────────────────────────────────────
const EQR_RARITY_COLORS = {
  Common:   {bg:'rgba(156,163,175,.12)',border:'rgba(156,163,175,.3)',strip:'#6b7280',glow:'rgba(156,163,175,.3)'},
  Uncommon: {bg:'rgba(74,222,128,.1)', border:'rgba(74,222,128,.3)', strip:'#22c55e',glow:'rgba(74,222,128,.35)'},
  Rare:     {bg:'rgba(96,165,250,.1)', border:'rgba(96,165,250,.3)', strip:'#3b82f6',glow:'rgba(96,165,250,.4)'},
  Epic:     {bg:'rgba(192,132,252,.1)',border:'rgba(192,132,252,.3)',strip:'#9333ea',glow:'rgba(192,132,252,.45)'},
  Legendary:{bg:'rgba(251,191,36,.1)', border:'rgba(251,191,36,.3)', strip:'#f59e0b',glow:'rgba(251,191,36,.5)'},
  Mythic:   {bg:'rgba(244,114,182,.1)',border:'rgba(244,114,182,.3)',strip:'#ec4899',glow:'rgba(244,114,182,.5)'},
};
const EQR_SOURCE_LABELS = {
  achievement:'ACHIEVEMENT REWARD',
  mail:'ADMIN GIFT',
  quest:'QUEST REWARD',
  boss:'BOSS REWARD',
  attendance:'ATTENDANCE REWARD',
  recitation:'RECITATION REWARD',
  event:'EVENT REWARD',
  store:'STORE REWARD',
  title:'TITLE UNLOCKED',
  system:'SYSTEM GRANT',
};

window.eqRewardPresent = function(opts){
  // Remove any existing overlay
  const existing = document.getElementById('eq-reward-overlay');
  if(existing) existing.remove();

  const {title='Rewards Acquired!', subtitle='', icon='🎁', rarity='Rare', source='system', rewards=[], onClose} = opts;
  const rarityKey = rarity.charAt(0).toUpperCase() + rarity.slice(1).toLowerCase();
  const rCol = EQR_RARITY_COLORS[rarityKey] || EQR_RARITY_COLORS.Rare;
  const sourceLabel = EQR_SOURCE_LABELS[source] || 'REWARD';

  const overlay = document.createElement('div');
  overlay.id = 'eq-reward-overlay';

  // Build reward cards HTML - enhanced with title display
  const _buildRewardCard = (r, i) => {
    const isTitleReward = r.type === 'title';
    let amtDisplay;
    if(isTitleReward){
      amtDisplay = `<span class="eqr-reward-amount" style="color:${r.color||'#EC4899'};font-size:14px;letter-spacing:.02em">${r.label||'Title'}</span>`;
    } else {
      amtDisplay = `<span class="eqr-reward-amount" style="color:${r.color||'var(--on-surface)'}">${typeof r.amount==='number'?'+'+r.amount.toLocaleString():r.amount}</span>`;
    }
    return `<div class="eqr-reward-card${isTitleReward?' eqr-reward-title':''}" style="border-color:${r.color||'rgba(255,255,255,.1)'};animation-delay:${(i*0.1+0.2)}s">
      <span class="eqr-reward-icon">${r.icon||'🎁'}</span>
      ${amtDisplay}
      <span class="eqr-reward-label">${isTitleReward?'Title Unlocked':r.label||'Reward'}</span>
    </div>`;
  };
  const rewardCardsHTML = rewards.length > 0
    ? rewards.map((r,i) => _buildRewardCard(r, i)).join('')
    : '<div class="eqr-no-rewards">🏅 Achievement Recorded</div>';

  overlay.innerHTML = `
    <div class="eqr-panel" style="box-shadow:0 0 80px ${rCol.glow},0 40px 80px rgba(0,0,0,.7)">
      <canvas class="eqr-canvas" id="eqr-canvas"></canvas>
      <div class="eqr-shine"></div>
      <div class="eqr-strip"></div>
      <div class="eqr-panel-scroll">
      <div class="eqr-body">
        <div class="eqr-source-label">${sourceLabel}</div>
        <div style="text-align:center">
          <div class="eqr-icon-wrap" style="background:${rCol.bg}">
            ${icon}
            <div class="eqr-icon-ring" style="border-color:${rCol.border}"></div>
            <div class="eqr-icon-ring2" style="border-color:${rCol.border}"></div>
          </div>
          <div class="eqr-rarity-badge" style="background:${rCol.bg};border:1px solid ${rCol.border};color:${rCol.strip}">
            <span style="width:6px;height:6px;border-radius:50%;background:${rCol.strip};display:inline-block"></span>
            ${rarityKey}
          </div>
        </div>
        <div class="eqr-title">${title}</div>
        ${subtitle?`<div class="eqr-subtitle">${subtitle}</div>`:''}
        <div class="eqr-divider"></div>
        ${rewards.length>0?'<div class="eqr-rewards-label">REWARDS ACQUIRED</div>':''}
        <div class="eqr-rewards-grid">${rewardCardsHTML}</div>
        <button class="eqr-claim-btn" id="eqr-btn"
          style="background:linear-gradient(135deg,${rCol.strip},${rCol.strip}cc);
          --eqr-btn-glow:0 8px 32px ${rCol.glow}">
          ${rewards.length > 0 ? '✨ Awesome!' : '✓ Continue'}
        </button>
      </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  // Particle confetti effect
  _eqrRunParticles('eqr-canvas', rCol);

  // Close handler
  document.getElementById('eqr-btn').addEventListener('click', _eqrClose);
  overlay.addEventListener('click', function(e){ if(e.target===overlay) _eqrClose(); });

  function _eqrClose(){
    overlay.style.animation = 'eqrFadeOut .25s ease forwards';
    setTimeout(()=>{ overlay.remove(); if(typeof onClose==='function') onClose(); }, 260);
  }
};

function _eqrRunParticles(canvasId, rCol){
  const canvas = document.getElementById(canvasId);
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const parent = canvas.parentElement;
  canvas.width = parent.offsetWidth || 480;
  canvas.height = parent.offsetHeight || 400;

  const colors = [rCol.strip, '#d0bcff','#ffb95f','#4edea3','#EC4899','#fff'];
  const particles = [];
  // Burst from top-center
  for(let i = 0; i < 60; i++){
    const angle = (Math.random() * Math.PI * 2);
    const speed = 2 + Math.random() * 5;
    particles.push({
      x: canvas.width/2, y: canvas.height * 0.3,
      vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed - 3,
      life: 1, decay: 0.015 + Math.random() * 0.025,
      color: colors[Math.floor(Math.random()*colors.length)],
      w: 4 + Math.random()*4, h: 4 + Math.random()*4,
      rot: Math.random()*Math.PI, rotV: (Math.random()-.5)*.2
    });
  }
  let frame;
  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    let alive = false;
    particles.forEach(p=>{
      if(p.life<=0) return;
      alive = true;
      p.x += p.vx; p.y += p.vy; p.vy += 0.12;
      p.life -= p.decay; p.rot += p.rotV;
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
      ctx.restore();
    });
    if(alive) frame = requestAnimationFrame(draw);
  }
  draw();
  // Stop after 3s
  setTimeout(()=>{ cancelAnimationFrame(frame); }, 3000);
}

// ── bootApp patch — refresh mail + achievement sidebar badges on login ────────
// RESTORED: this patch was missing entirely from the extracted codebase (the
// mail and achievements modules each only update their OWN badge from their
// own triggers; this combined refresh on login is what the original had).
;(function () {
  const _origBoot = window.bootApp;
  window.bootApp = function () {
    if (typeof _origBoot === 'function') _origBoot();
    if (currentRole === 'student' && currentUser) {
      setTimeout(() => {
        mailUpdateSidebarBadge();
        achUpdateSidebarBadge();
      }, 400);
    }
  };
})();

// ── navTo patch — refresh mail + achievement sidebar badges on navigation ─────
;(function () {
  const _origNav = window.navTo;
  window.navTo = function (id) {
    if (typeof _origNav === 'function') _origNav(id);
    if (currentRole === 'student') {
      setTimeout(() => { mailUpdateSidebarBadge(); achUpdateSidebarBadge(); }, 150);
    }
  };
})();

console.log('[EduQuest] shared/reward-presenter.js loaded — eqRewardPresent, _eqrRunParticles, EQR_RARITY_COLORS, EQR_SOURCE_LABELS registered. bootApp/navTo badge-refresh patched.');
