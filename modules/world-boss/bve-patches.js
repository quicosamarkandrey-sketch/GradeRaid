// ─────────────────────────────────────────────────────────────────────────────
// §6  BVE CSS INJECTION
// Moved from index.html Block D (monolith) — injects all BVE/BFLP CSS at load time.
// ─────────────────────────────────────────────────────────────────────────────
(function _bveInjectCSS(){
  const style = document.createElement('style');
  style.textContent = `
/* ── BVE: Boss Library Picker Modal ── */
.bflp-overlay{
  position:fixed;inset:0;z-index:3500;
  background:rgba(0,0,0,0.82);backdrop-filter:blur(16px);
  display:flex;align-items:center;justify-content:center;padding:20px;
  animation:fadeIn .25s ease;
}
.bflp-panel{
  width:100%;max-width:900px;max-height:90vh;
  background:rgba(14,12,28,0.98);border:1px solid rgba(236,72,153,0.25);
  border-radius:22px;box-shadow:0 0 80px rgba(236,72,153,0.15),0 40px 80px rgba(0,0,0,.7);
  display:flex;flex-direction:column;overflow:hidden;
}
.bflp-header{
  padding:20px 24px 16px;border-bottom:1px solid rgba(255,255,255,0.07);
  display:flex;align-items:center;gap:14px;flex-shrink:0;
}
.bflp-header-icon{
  width:44px;height:44px;border-radius:12px;
  background:linear-gradient(135deg,rgba(236,72,153,0.3),rgba(139,92,246,0.2));
  border:1px solid rgba(236,72,153,0.4);
  display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;
}
.bflp-header-info{flex:1;min-width:0;}
.bflp-header-title{font-family:var(--fh);font-size:18px;font-weight:900;color:var(--on-surface);margin-bottom:2px;}
.bflp-header-sub{font-size:12px;color:var(--text-muted);}
.bflp-search{
  padding:12px 24px;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;
}
.bflp-search-inner{
  display:flex;align-items:center;gap:10px;
  background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
  border-radius:11px;padding:9px 14px;
}
.bflp-search-inner input{
  flex:1;background:none;border:none;color:var(--text);font-family:var(--fb);font-size:13px;outline:none;
}
.bflp-grid{
  flex:1;overflow-y:auto;padding:16px 20px;
  display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;
}
.bflp-grid::-webkit-scrollbar{width:4px;}
.bflp-grid::-webkit-scrollbar-thumb{background:rgba(208,188,255,.15);border-radius:2px;}

/* Boss pick card */
.bflp-card{
  border-radius:16px;border:1.5px solid rgba(255,255,255,0.08);
  background:rgba(35,31,56,0.85);cursor:pointer;
  transition:all .22s cubic-bezier(.4,0,.2,1);overflow:hidden;
  position:relative;
}
.bflp-card:hover{
  border-color:rgba(236,72,153,0.55);transform:translateY(-3px);
  box-shadow:0 12px 40px rgba(0,0,0,0.4),0 0 24px rgba(236,72,153,0.15);
}
.bflp-card.selected{
  border-color:rgba(236,72,153,0.85);
  box-shadow:0 0 0 2px rgba(236,72,153,0.35),0 12px 40px rgba(236,72,153,0.2);
}
.bflp-card-art{
  height:140px;width:100%;position:relative;overflow:hidden;
  display:flex;align-items:center;justify-content:center;
  border-bottom:1px solid rgba(255,255,255,0.07);
}
.bflp-card-art-emoji{font-size:64px;line-height:1;z-index:2;position:relative;
  filter:drop-shadow(0 4px 16px rgba(0,0,0,0.5));}
.bflp-card-art-img{width:100%;height:100%;object-fit:contain;z-index:2;position:relative;
  padding:10px;}
.bflp-card-art-aura{position:absolute;inset:0;border-radius:0;pointer-events:none;}
.bflp-card-art-placeholder{
  display:flex;flex-direction:column;align-items:center;gap:6px;color:var(--text-muted);
}
.bflp-card-art-placeholder .material-symbols-outlined{font-size:36px;opacity:.3;}
.bflp-card-body{padding:12px 14px;}
.bflp-card-name{font-family:var(--fh);font-size:14px;font-weight:800;color:var(--on-surface);
  margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bflp-card-tags{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;min-height:18px;}
.bflp-card-tag{font-size:9px;padding:2px 7px;border-radius:5px;font-weight:700;
  background:rgba(208,188,255,0.1);color:var(--primary);border:1px solid rgba(208,188,255,0.2);}
.bflp-card-meta{display:flex;align-items:center;justify-content:space-between;}
.bflp-card-theme{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--text-muted);}
.bflp-card-swatch{width:10px;height:10px;border-radius:50%;flex-shrink:0;}
.bflp-card-pips{display:flex;gap:3px;}
.bflp-card-pip{width:8px;height:8px;border-radius:2px;background:rgba(255,255,255,0.08);}
.bflp-card-pip.filled{background:var(--secondary);box-shadow:0 0 5px var(--secondary);}
.bflp-card-pip.rage.filled{background:#EC4899;}
.bflp-card-check{
  position:absolute;top:10px;right:10px;width:26px;height:26px;border-radius:50%;
  background:#EC4899;border:2px solid #fff;z-index:10;
  display:flex;align-items:center;justify-content:center;
  opacity:0;transition:opacity .2s;
}
.bflp-card.selected .bflp-card-check{opacity:1;}
.bflp-card-check .material-symbols-outlined{font-size:14px;color:#fff;font-variation-settings:'FILL' 1;}
.bflp-footer{
  padding:14px 24px;border-top:1px solid rgba(255,255,255,0.07);
  display:flex;align-items:center;gap:12px;flex-shrink:0;
  background:rgba(10,8,20,0.6);
}
.bflp-selected-name{flex:1;font-size:13px;font-weight:700;color:var(--on-surface);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bflp-empty{
  grid-column:1/-1;text-align:center;padding:60px 20px;color:var(--text-muted);
}
.bflp-empty-icon{font-size:48px;margin-bottom:12px;}
.bflp-empty-title{font-family:var(--fh);font-size:16px;font-weight:800;color:var(--on-surface);margin-bottom:6px;}
.bflp-empty-sub{font-size:13px;line-height:1.5;margin-bottom:16px;}

/* ── BVE: Responsive Boss Artwork in World Boss areas ── */
.bve-boss-wrap{
  position:relative;display:flex;align-items:center;justify-content:center;
  width:100%;height:100%;
}
.bve-boss-art{
  /* Intelligent scaling: fills available space without overflow */
  max-width:100%;max-height:100%;width:auto;height:auto;
  object-fit:contain;
  filter:drop-shadow(0 8px 32px var(--bve-aura,rgba(236,72,153,0.4)));
  transition:filter .4s;
  display:block;
  /* Responsive sizing via container queries emulation */
  --bve-max-size:min(85%, 85vmin, 420px);
  max-width:var(--bve-max-size);
  max-height:var(--bve-max-size);
}
.bve-boss-art.is-emoji{
  font-size:clamp(56px, 10vw, 160px);
  line-height:1;text-align:center;
  max-width:unset;max-height:unset;
}
/* Boss sprite animations — all class-driven, no JS timers needed */
/* BVE fallback animations: only fire when NO Boss Studio animation class is present.
   The :not() selectors ensure Boss Studio cssClass always wins over BVE defaults. */
.bve-boss-art.state-idle:not([class*="bs-anim-play-"]){
  animation:bveIdle 4s ease-in-out infinite;
}
.bve-boss-art.state-hit:not([class*="bs-anim-play-"]){
  animation:bveHit 0.38s cubic-bezier(.36,.07,.19,.97) forwards;
}
.bve-boss-art.state-cast:not([class*="bs-anim-play-"]){
  animation:bveCast 0.7s ease-in-out forwards;
}
.bve-boss-art.state-rage:not([class*="bs-anim-play-"]){
  animation:bveRageLoop 1.2s ease-in-out infinite;
}
/* When a Boss Studio animation class IS present, the bs-anim-play-* class
   (defined earlier in the stylesheet) provides the animation.
   We still need the rage entry flash for the first 0.5s — handled via state-rage alone. */
.bve-boss-art.state-rage[class*="bs-anim-play-"]{
  /* Boss Studio rage animation is already looping from the bs-anim-play-* rule.
     Add the rage visual enhancements without overriding the animation itself. */
  filter:saturate(1.8) brightness(1.15) drop-shadow(0 0 22px var(--bve-aura,#EC4899));
}
@keyframes bveIdle{
  0%,100%{transform:translateY(0) scale(1) rotate(-1deg);filter:drop-shadow(0 8px 28px var(--bve-aura,rgba(236,72,153,0.4)));}
  50%{transform:translateY(-8px) scale(1.03) rotate(1deg);filter:drop-shadow(0 12px 38px var(--bve-aura,rgba(236,72,153,0.6)));}
}
@keyframes bveHit{
  0%{transform:scale(1) translateX(0);filter:brightness(2.5) saturate(0);}
  25%{transform:scale(0.93) translateX(-10px);}
  50%{transform:scale(0.97) translateX(8px);}
  75%{transform:scale(0.95) translateX(-5px);}
  100%{transform:scale(1) translateX(0);filter:brightness(1) saturate(1);}
}
@keyframes bveCast{
  0%{transform:scale(1);}
  30%{transform:scale(1.12) translateY(-6px);filter:drop-shadow(0 0 24px var(--bve-theme,#8b5cf6)) brightness(1.3);}
  60%{transform:scale(1.08) translateY(-4px);}
  100%{transform:scale(1);}
}
@keyframes bveRage{
  0%{transform:scale(1);filter:saturate(1);}
  20%{transform:scale(1.15);filter:saturate(2.2) brightness(1.4) hue-rotate(-20deg);}
  50%{transform:scale(1.1) translateY(-8px);}
  80%{transform:scale(1.13) translateY(-4px);filter:saturate(1.8);}
  100%{transform:scale(1.05);}
}
@keyframes bveRageLoop{
  0%,100%{transform:scale(1.05) rotate(-1.5deg);filter:saturate(2) brightness(1.2) drop-shadow(0 0 18px var(--bve-aura,#EC4899)) hue-rotate(0deg);}
  25%{transform:scale(1.12) rotate(1.5deg) translateY(-4px);filter:saturate(2.5) brightness(1.4) drop-shadow(0 0 32px var(--bve-aura,#EC4899)) hue-rotate(-15deg);}
  50%{transform:scale(1.08) rotate(-0.5deg) translateY(-8px);filter:saturate(2.2) brightness(1.3) drop-shadow(0 0 24px var(--bve-aura,#EC4899));}
  75%{transform:scale(1.11) rotate(0.8deg) translateY(-3px);}
}
/* Rage-active hero banner: pulsing danger border */
.wb-hero[data-rage-active="1"]{
  animation:wbRageBorder 1.8s ease-in-out infinite !important;
}
@keyframes wbRageBorder{
  0%,100%{box-shadow:0 0 60px color-mix(in srgb, var(--bve-aura,#EC4899) 12%, transparent), 0 24px 64px rgba(0,0,0,.5), inset 0 0 0 1.5px rgba(239,68,68,0.2);}
  50%{box-shadow:0 0 80px color-mix(in srgb, var(--bve-aura,#EC4899) 30%, transparent), 0 24px 64px rgba(0,0,0,.6), inset 0 0 0 1.5px rgba(239,68,68,0.55);}
}

/* Glow ring around boss in World Boss hero */
.bve-boss-ring{
  position:absolute;inset:-12px;border-radius:50%;pointer-events:none;
  border:1.5px solid var(--bve-aura, rgba(236,72,153,0.3));
  animation:bveRingPulse 2.2s ease-in-out infinite;z-index:0;
}
.bve-boss-ring2{
  position:absolute;inset:-24px;border-radius:50%;pointer-events:none;
  border:1px solid var(--bve-theme, rgba(139,92,246,0.15));
  animation:bveRingPulse 2.2s ease-in-out infinite .6s;z-index:0;
}
@keyframes bveRingPulse{
  0%,100%{opacity:.4;transform:scale(1);}
  50%{opacity:1;transform:scale(1.04);}
}

/* ── BVE: Hit flash overlay on boss sprite container ── */
.bve-hit-flash{
  position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:10;
  background:radial-gradient(circle at 50% 40%, rgba(255,255,255,0.55) 0%, transparent 70%);
  opacity:0;
  transition:opacity 0.08s;
}
.bve-hit-flash.flash{opacity:1;}

/* ── BVE: Batch damage number (multiplayer-safe) ── */
.bhs-batch-float{
  position:fixed;pointer-events:none;z-index:2500;
  font-family:var(--fh);font-weight:900;letter-spacing:-.5px;
  text-shadow:0 2px 8px rgba(0,0,0,0.8);
  animation:bhsFloatUp 1.4s cubic-bezier(.25,.46,.45,.94) forwards;
  white-space:nowrap;
}
@keyframes bhsFloatUp{
  0%{transform:translateY(0) scale(0.7);opacity:0;}
  15%{transform:translateY(-10px) scale(1.05);opacity:1;}
  80%{transform:translateY(-60px) scale(1);opacity:1;}
  100%{transform:translateY(-80px) scale(0.9);opacity:0;}
}
.bhs-crit-burst{
  position:fixed;pointer-events:none;z-index:2500;
  width:80px;height:80px;
  background:radial-gradient(circle, rgba(255,185,95,0.8) 0%, transparent 70%);
  border-radius:50%;
  animation:bhsCritBurst 0.6s ease-out forwards;
  transform:translate(-50%,-50%);
}
@keyframes bhsCritBurst{
  0%{opacity:1;transform:translate(-50%,-50%) scale(0);}
  50%{opacity:0.8;transform:translate(-50%,-50%) scale(1.5);}
  100%{opacity:0;transform:translate(-50%,-50%) scale(3);}
}

/* ── BVE: World Boss hero - linked profile themed ── */
.wb-hero.bve-themed{
  background:linear-gradient(135deg,
    color-mix(in srgb, var(--bve-theme,#0d0520) 20%, #0d0520),
    color-mix(in srgb, var(--bve-aura,#1a0830) 15%, #1a0830),
    #12021f
  ) !important;
}

/* Boss name gradient in hero — driven by linked theme */
.wb-boss-name.bve-gradient{
  background:linear-gradient(135deg,#fff 0%, var(--bve-aura,#EC4899) 50%, var(--bve-accent,#d0bcff) 100%);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
}

/* ── BVE: Boss card in admin list — themed border ── */
.boss-event-card.bve-linked{
  border-left:3px solid var(--bve-aura,#EC4899);
}
.bve-profile-chip{
  display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:6px;
  font-size:10px;font-weight:700;letter-spacing:.04em;
  background:rgba(236,72,153,0.1);border:1px solid rgba(236,72,153,0.28);
  color:#EC4899;
}

/* ── BVE: Boss Library Picker CSS adjustments for form ── */
.bflp-card-art-img-wrap{
  width:100%;height:100%;
  display:flex;align-items:center;justify-content:center;
  padding:12px;
}
`;
  document.head.appendChild(style);
})();

// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/world-boss/bve-patches.js
//  Boss Visual Engine integration patches for World Boss:
//   §7  Patch _bossEventCardHTML + wbcUpdateTopbarWidget to use BVE art
//   §8  Route damage floats through BHS, wrap wbcAnswer, HP rage-phase,
//       re-init BVS/BHS after every full DOM rebuild
//   §9  MutationObserver sprite upgrade for #wb-boss-sprite
//  Also injects the BVE-specific CSS rules for the world-boss UI.
//
//  LOAD AFTER: raid-flow.js (all world-boss globals must exist)
//  LOAD AFTER: boss-studio/index.js  (BVS, BHS, bveRenderBossArt, etc.)
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// §7  Patch admin card + topbar widget to use BVE artwork
// ─────────────────────────────────────────────────────────────────────────────
;(function _bvePatchWorldBoss() {

  // Patch _bossEventCardHTML — add bve-linked class and themed sprite
  if (typeof _bossEventCardHTML === 'function') {
    const _origCard = _bossEventCardHTML;
    window._bossEventCardHTML = function (boss, bi) {
      let html    = _origCard(boss, bi);
      const profile = bveGetLinkedProfile(boss);
      if (profile) {
        html = html.replace('class="boss-event-card fade-in"',
          'class="boss-event-card fade-in bve-linked"');
        const compactArt = bveRenderCompactArt(boss, 48);
        html = html.replace(/<div class="boss-event-sprite-sm">[\s\S]*?<\/div>/,
          `<div class="boss-event-sprite-sm" style="font-size:28px;display:flex;align-items:center;justify-content:center">${compactArt}</div>`);
      }
      return html;
    };
  }

  // Patch wbcUpdateTopbarWidget — inject BVE compact art + theme vars
  if (typeof wbcUpdateTopbarWidget === 'function') {
    const _origWidget = wbcUpdateTopbarWidget;
    window.wbcUpdateTopbarWidget = function () {
      _origWidget();
      const found = (typeof wbcGetActiveBoss === 'function') && wbcGetActiveBoss();
      if (!found) return;
      const boss   = found.boss;
      const iconEl = document.querySelector('#wb-topbar-widget .wb-widget-icon');
      if (iconEl && boss) iconEl.innerHTML = bveRenderCompactArt(boss, 20);
      const widget = document.getElementById('wb-topbar-widget');
      if (widget && boss) bveApplyThemeVars(widget, boss);
    };
  }

})();

// ─────────────────────────────────────────────────────────────────────────────
// §8  Patch world-boss student encounter to use BVE
// ─────────────────────────────────────────────────────────────────────────────
;(function _bvePatchEncounter() {

  // §8a  Route damage floats through the Batched Hit System
  if (typeof _wbcFloatDamage === 'function' && !_wbcFloatDamage._bhsPatched) {
    const _origFloat = _wbcFloatDamage;
    window._wbcFloatDamage = function (dmg, isCrit) {
      const isOwn = !!window._bveMyHitInFlight;
      BHS.queueHit(dmg, isCrit, isOwn);
    };
    window._wbcFloatDamage._bhsPatched = true;
  }

  // §8b  Wrap wbcAnswer to set the "my hit" flag before the original call
  if (typeof wbcAnswer === 'function' && !wbcAnswer._bvePatched) {
    const _origAnswer = wbcAnswer;
    window.wbcAnswer = function (bossIdx, qIdx, chosenOpt) {
      window._bveMyHitInFlight = true;
      try {
        _origAnswer(bossIdx, qIdx, chosenOpt);
      } finally {
        window._bveMyHitInFlight = false;
      }
      _bveCheckRagePhase(bossIdx);
    };
    window.wbcAnswer._bvePatched = true;
  }

  // §8c  HP-based rage-phase detection (purely cosmetic)
  function _bveCheckRagePhase(bossIdx) {
    if (typeof DB === 'undefined') return;
    const boss = (DB.bossEvents || [])[bossIdx];
    if (!boss) return;
    const pct = (boss.currentHP != null && boss.maxHP)
      ? boss.currentHP / boss.maxHP : 1;
    if (pct <= 0.30) {
      BVS.enterRage();
      const hero = document.querySelector('.wb-hero');
      if (hero && !hero.dataset.rageActive) {
        hero.dataset.rageActive = '1';
        hero.style.setProperty('--wb-rage-flash', '1');
      }
    }
  }

  // §8d  Re-initialise BVS + BVE art after every full DOM rebuild
  if (typeof renderStudentWorldBoss === 'function' && !renderStudentWorldBoss._bvePatched) {
    const _origRenderSWB = renderStudentWorldBoss;
    window.renderStudentWorldBoss = function () {
      // Clear upgrade flag so §9 observer re-upgrades the fresh sprite
      const oldSprite = document.getElementById('wb-boss-sprite');
      if (oldSprite) delete oldSprite.dataset.bveUpgraded;

      _origRenderSWB.apply(this, arguments);

      // Give the browser one tick to paint the new DOM, then re-init
      setTimeout(() => {
        const artEl  = document.getElementById('wb-boss-sprite-art');
        const initId = artEl ? 'wb-boss-sprite-art' : 'wb-boss-sprite';
        BVS.init(initId);
        BHS.reset();

        const found = (typeof wbcGetActiveBoss === 'function') && wbcGetActiveBoss();
        if (found && found.boss) {
          const hero = document.querySelector('.wb-hero');
          if (hero) {
            bveApplyThemeVars(hero, found.boss);
            const pct = (found.boss.currentHP != null && found.boss.maxHP)
              ? found.boss.currentHP / found.boss.maxHP : 1;
            if (pct <= 0.30) BVS.enterRage();
          }
        }
      }, 60);
    };
    window.renderStudentWorldBoss._bvePatched = true;
  }

})();

// ─────────────────────────────────────────────────────────────────────────────
// §9  MutationObserver sprite upgrade for #wb-boss-sprite
// ─────────────────────────────────────────────────────────────────────────────
;(function _bvePatchHeroSprite() {

  function _upgradeSprite(force) {
    const found = (typeof wbcGetActiveBoss === 'function') && wbcGetActiveBoss();
    if (!found) return;
    const bossEvent = found.boss;
    const profile   = bveGetLinkedProfile(bossEvent);
    const spriteEl  = document.getElementById('wb-boss-sprite');
    if (!spriteEl) return;
    if (spriteEl.dataset.bveUpgraded && !force) return;

    if (profile) {
      const artHtml = bveRenderBossArt(bossEvent, {
        id: 'wb-boss-sprite-art', stateClass: 'state-idle',
      });
      spriteEl.innerHTML = artHtml;
      spriteEl.dataset.bveUpgraded = '1';
      bveApplyThemeVars(spriteEl, bossEvent);
      const hero = spriteEl.closest('.wb-hero') || document.querySelector('.wb-hero');
      if (hero) bveApplyThemeVars(hero, bossEvent);
      BVS.init('wb-boss-sprite-art');
      const artEl = document.getElementById('wb-boss-sprite-art');
      if (artEl) artEl.classList.add('state-idle');
      BVS._applyState('idle');
      // Re-enter rage if boss is already low HP
      try {
        const hp    = bossEvent.currentHP !== undefined ? bossEvent.currentHP : bossEvent.hp;
        const maxHp = bossEvent.maxHP     !== undefined ? bossEvent.maxHP     : bossEvent.hp;
        if (maxHp > 0 && hp / maxHp <= 0.30) BVS.enterRage();
      } catch (e) { /* silent */ }
    } else {
      // Legacy emoji/image mode
      spriteEl.dataset.bveUpgraded = 'legacy';
      bveApplyThemeVars(spriteEl, bossEvent);
      BVS.init('wb-boss-sprite');
    }
  }

  let _upgradeDebounce = null;
  const _observer = new MutationObserver(mutations => {
    const relevant = mutations.some(m =>
      Array.from(m.addedNodes).some(n =>
        n.nodeType === 1 && (n.id === 'wb-boss-sprite' || (n.querySelector && n.querySelector('#wb-boss-sprite')))
      )
    );
    if (!relevant) return;
    clearTimeout(_upgradeDebounce);
    _upgradeDebounce = setTimeout(() => {
      const spriteEl = document.getElementById('wb-boss-sprite');
      if (spriteEl) {
        delete spriteEl.dataset.bveUpgraded;
        _upgradeSprite(true);
        const _found = (typeof wbcGetActiveBoss === 'function') && wbcGetActiveBoss();
        if (_found && typeof bvePreloadBossArt === 'function') {
          bvePreloadBossArt(_found.boss).then(() => {
            const el = document.getElementById('wb-boss-sprite');
            if (el) { delete el.dataset.bveUpgraded; _upgradeSprite(true); }
          }).catch(() => {});
        }
      }
    }, 30);
  });
  _observer.observe(document.body, { childList: true, subtree: true });

  // Try once DB is ready in case battle DOM is already present.
  // Wrapped in AppStore.ready.then() so DB is guaranteed to be populated
  // before wbcGetActiveBoss() (which reads DB.bossEvents) is called.
  AppStore.ready.then(() => {
    setTimeout(() => {
      _upgradeSprite(false);
      const _found = (typeof wbcGetActiveBoss === 'function') && wbcGetActiveBoss();
      if (_found && typeof bvePreloadBossArt === 'function') {
        bvePreloadBossArt(_found.boss).then(() => {
          const el = document.getElementById('wb-boss-sprite');
          if (el) { delete el.dataset.bveUpgraded; _upgradeSprite(true); }
        }).catch(() => {});
      }
    }, 120);
  });

})();

// ─────────────────────────────────────────────────────────────────────────────
// BVE CSS — world-boss UI theming rules
// ─────────────────────────────────────────────────────────────────────────────
;(function () {
  const id = 'wb-bve-styles';
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id;
  s.textContent = `
/* Linked boss indicator in boss admin card header */
.boss-event-card.bve-linked .boss-event-sprite-sm { position:relative; }
.boss-event-card.bve-linked .boss-event-sprite-sm::after {
  content:'';position:absolute;bottom:-2px;right:-2px;
  width:10px;height:10px;border-radius:50%;
  background:#EC4899;border:2px solid var(--bg);
  box-shadow:0 0 6px rgba(236,72,153,0.7);
}
/* Theme the HP bar when a profile is linked */
.boss-event-card.bve-linked .hp-preview-bar {
  background:linear-gradient(90deg,var(--bve-aura,#EC4899),var(--bve-theme,#8b5cf6)) !important;
}
/* Boss Library Picker — selected card aura outline */
.bflp-card.selected {
  outline:2px solid var(--bve-aura,#EC4899);
  outline-offset:2px;
}
/* BVE: wbe-boss-stage art sizing */
.wbe-boss-stage .bve-boss-wrap { width:100%;height:100%;align-items:center;justify-content:center; }
.wbe-boss-stage .bve-boss-art  { max-width:min(85%,160px);max-height:min(85%,160px); }
.wbe-boss-stage .bve-boss-art.is-emoji { font-size:clamp(52px,10vmin,120px); }
/* Hero banner — themed via CSS vars set by bveApplyThemeVars */
.wb-hero {
  border-color:color-mix(in srgb,var(--bve-aura,#EC4899) 40%,transparent) !important;
  box-shadow:0 0 60px color-mix(in srgb,var(--bve-aura,#EC4899) 12%,transparent),
             0 24px 64px rgba(0,0,0,0.5) !important;
}
.wb-hp-bar-fill {
  background:linear-gradient(90deg,var(--bve-hp1,#EC4899),var(--bve-hp2,#9333ea)) !important;
  box-shadow:0 0 16px color-mix(in srgb,var(--bve-hp1,#EC4899) 40%,transparent) !important;
}
/* Boss form visual section title */
#bf-visual-section .boss-form-section-title { display:flex;align-items:center;gap:8px; }
/* Smooth state transitions for BVE art elements */
.bve-boss-art { transition:filter .35s,transform .35s; }
`;
  document.head.appendChild(s);
})();
