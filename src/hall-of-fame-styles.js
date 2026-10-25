// Phase 7 (2026-08-10, session 17) — step 5.3, eighteenth real
// conversion. Real-ESM twin of the original
// ../modules/leaderboard/hall-of-fame-styles.js, which stays completely
// untouched. Generated programmatically (not hand-retyped) to guarantee
// byte-exact preservation of the 640+ line inline CSS string. Zero
// declared symbols in the original (confirmed via the dependency map) —
// this file has no callable/exported surface at all, just a static
// stylesheet injected once on load. No export statements needed; the
// bridge is a pure side-effect import.
// ─────────────────────────────────────────────────────────────────────────────
// HALL OF FAME — CSS injection
//
// Phase 6 (Decompose God Files) extraction from hall-of-fame.js. This was
// the single largest chunk of that 1,263-line file (642 lines, half the
// total) and also the safest possible kind of extraction in this whole
// phase: injectHolStyles() was ALREADY its own fully self-invoking IIFE
// with zero reference to hall-of-fame.js's other internals — no _hol*
// state, no template interpolation (checked: zero `${` in the whole CSS
// string), nothing but a static stylesheet appended to document.head once.
// Unlike every other closure-IIFE file touched this phase, this didn't
// require unwrapping hall-of-fame.js's own wrapper at all — this function
// runs standalone the moment its script tag loads, exactly as it did
// nested inside the original file. No behavior change whatsoever.
//
// Exports: (none — runs immediately on load, has no callable surface)
//
// DEPENDENCIES: none beyond the DOM (document.createElement,
// document.head.appendChild).
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

  // ─────────────────────────────────────────────────────────────────────────────
  // CSS — Hall of Legends styles
  // ─────────────────────────────────────────────────────────────────────────────
  (function injectHolStyles() {
    const s = document.createElement('style');
    s.id = 'hol-styles';
    s.textContent = `

/* ════════════════════════════════════════════════════════
   HOL: Category + Period selector bar
   ════════════════════════════════════════════════════════ */
.hol-nav{display:flex;align-items:center;gap:0;flex-wrap:wrap;margin-bottom:0}
.hol-cat-bar{display:flex;gap:0;border-bottom:1px solid var(--border);flex:1;overflow-x:auto;min-width:0}
.hol-cat-btn{display:flex;align-items:center;gap:7px;padding:12px 18px;font-size:13px;font-weight:700;
  letter-spacing:.03em;color:var(--text-muted);background:none;border:none;cursor:pointer;
  border-bottom:2px solid transparent;white-space:nowrap;transition:color .18s,border-color .18s;
  font-family:var(--fb)}
.hol-cat-btn:hover{color:var(--on-surface)}
.hol-cat-btn.active{color:var(--primary);border-bottom-color:var(--primary-dark)}
.hol-cat-btn .hol-cat-icon{font-size:16px;line-height:1}

/* Hall of Fame tab gets its own look */
.hol-cat-btn.hall-tab{border-right:1px solid var(--border);margin-right:4px}

/* Period pills */
.hol-period-bar{display:flex;gap:6px;padding:12px 0 10px;flex-shrink:0}
.hol-period-btn{padding:5px 13px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.04em;
  border:1px solid var(--border);background:rgba(255,255,255,.04);color:var(--text-muted);
  cursor:pointer;transition:all .18s;font-family:var(--fb)}
.hol-period-btn:hover{border-color:rgba(208,188,255,.3);color:var(--on-surface)}
.hol-period-btn.active{background:rgba(208,188,255,.12);border-color:rgba(208,188,255,.3);color:var(--primary)}

/* ════════════════════════════════════════════════════════
   HOL: Stage — the full podium scene container
   ════════════════════════════════════════════════════════ */
.hol-stage{
  position:relative;overflow:hidden;
  border-radius:20px;
  margin-bottom:28px;
  background:linear-gradient(180deg,rgba(20,14,38,.95) 0%,rgba(13,12,22,.98) 100%);
  border:1px solid rgba(255,255,255,.06);
  padding:0 0 0;
}
/* Grid texture overlay */
.hol-stage::before{
  content:'';position:absolute;inset:0;pointer-events:none;
  background-image:linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),
                   linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px);
  background-size:30px 30px;
  mask-image:linear-gradient(to bottom,rgba(0,0,0,.6),transparent 75%);
  z-index:0;
}

/* ════════════════════════════════════════════════════════
   HOL: Spotlight beams (SVG — category-coloured)
   ════════════════════════════════════════════════════════ */
.hol-beams{
  position:absolute;top:0;left:0;right:0;height:260px;
  pointer-events:none;z-index:1;overflow:hidden;
}

/* ════════════════════════════════════════════════════════
   HOL: Scene crown row (title + period label)
   ════════════════════════════════════════════════════════ */
.hol-scene-header{
  position:relative;z-index:2;
  text-align:center;padding:28px 20px 6px;
}
.hol-scene-kicker{
  font-family:var(--fm);font-size:9px;letter-spacing:.22em;text-transform:uppercase;
  color:rgba(240,238,255,.38);margin-bottom:6px;
}
.hol-scene-title{
  font-family:var(--fm);font-size:22px;font-weight:900;letter-spacing:.06em;
  background:var(--hol-grad,linear-gradient(135deg,#ffb95f,#f97316));
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
  margin-bottom:4px;
  filter:drop-shadow(0 0 12px var(--hol-glow,rgba(255,185,95,.3)));
}
.hol-scene-period{
  font-size:11px;color:rgba(240,238,255,.35);font-weight:600;letter-spacing:.05em;
}

/* ════════════════════════════════════════════════════════
   HOL: The three podium cards (2nd | 1st | 3rd)
   ════════════════════════════════════════════════════════ */
.hol-podium-row{
  position:relative;z-index:2;
  display:flex;align-items:flex-end;justify-content:center;
  gap:12px;padding:0 24px 0;
}

/* Shared card shell */
.hol-card{
  display:flex;flex-direction:column;align-items:center;
  background:rgba(35,31,56,.65);backdrop-filter:blur(14px);
  border:1px solid rgba(255,255,255,.07);
  border-radius:20px;padding-bottom:20px;
  transition:transform .25s cubic-bezier(.4,0,.2,1),box-shadow .25s,border-color .25s;
  position:relative;overflow:hidden;cursor:default;
}
/* Accent strip top */
.hol-card::before{
  content:'';position:absolute;top:0;left:0;right:0;height:3px;
  background:var(--hol-card-accent,rgba(255,255,255,.1));border-radius:20px 20px 0 0;
}
.hol-card:hover{transform:translateY(-4px);}

/* 1st place — a card that looks like it's genuinely on fire: flickering
   ember-orange glow (not a slow gold "breathe"), rising embers inside it. */
.hol-card.rank1{
  width:280px;
  background:linear-gradient(165deg,rgba(124,45,18,.42) 0%,rgba(69,26,14,.6) 45%,rgba(23,12,10,.82) 100%);
  box-shadow:0 0 0 1px rgba(249,115,22,.35),0 20px 60px rgba(0,0,0,.55),0 0 30px rgba(249,115,22,.3);
  --hol-card-accent:linear-gradient(90deg,#7c2d12,#f97316,#fbbf24,#f97316,#7c2d12);
  z-index:3;
  animation:holFireFlicker 1.6s ease-in-out infinite;
}
.hol-card.rank1::before{
  background-size:200% 100%;
  animation:holAccentShimmer 2.4s linear infinite;
}
/* Irregular multi-stop flicker — reads as fire, not a metronome pulse */
@keyframes holFireFlicker{
  0%  {box-shadow:0 0 0 1px rgba(249,115,22,.35),0 20px 60px rgba(0,0,0,.55),0 0 28px rgba(249,115,22,.32),0 0 55px rgba(234,88,12,.14);}
  22% {box-shadow:0 0 0 1px rgba(251,146,60,.5), 0 20px 60px rgba(0,0,0,.55),0 0 44px rgba(249,115,22,.5), 0 0 78px rgba(234,88,12,.22);}
  41% {box-shadow:0 0 0 1px rgba(234,88,12,.3), 0 20px 60px rgba(0,0,0,.55),0 0 32px rgba(249,115,22,.38),0 0 58px rgba(234,88,12,.16);}
  63% {box-shadow:0 0 0 1px rgba(251,191,36,.5),0 20px 60px rgba(0,0,0,.55),0 0 50px rgba(251,146,60,.55),0 0 86px rgba(234,88,12,.24);}
  85% {box-shadow:0 0 0 1px rgba(249,115,22,.4),0 20px 60px rgba(0,0,0,.55),0 0 36px rgba(249,115,22,.4), 0 0 62px rgba(234,88,12,.18);}
  100%{box-shadow:0 0 0 1px rgba(249,115,22,.35),0 20px 60px rgba(0,0,0,.55),0 0 28px rgba(249,115,22,.32),0 0 55px rgba(234,88,12,.14);}
}
@keyframes holAccentShimmer{
  0%{background-position:0% 0}
  100%{background-position:200% 0}
}
.hol-card.rank1:hover{
  box-shadow:0 0 0 1px rgba(251,146,60,.55),0 28px 70px rgba(0,0,0,.6),0 0 60px rgba(249,115,22,.4);
}
/* Embers rising inside the card — clipped by the card's own rounded
   corners (overflow:hidden), so they stay contained and never bleed
   into the layout around it */
.hol-embers{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0;border-radius:20px;}
.hol-ember{
  position:absolute;bottom:-6px;width:4px;height:4px;border-radius:50%;
  background:radial-gradient(circle,#fff7ed 0%,#fde68a 35%,#f97316 70%,transparent 100%);
  opacity:0;
  animation:holEmberRise 3.2s ease-in infinite;
}
@keyframes holEmberRise{
  0%{transform:translate(0,0) scale(1);opacity:0;}
  10%{opacity:.9;}
  70%{opacity:.5;}
  100%{transform:translate(6px,-300px) scale(.25);opacity:0;}
}
/* Recolor the rising particles for 2nd (icy) and 3rd (bronze) so each
   podium spot gets its own themed "aura" instead of reusing fire-orange */
.hol-embers-icy .hol-ember{
  background:radial-gradient(circle,#ffffff 0%,#e0f2fe 35%,#7dd3fc 70%,transparent 100%);
}
.hol-embers-bronze .hol-ember{
  background:radial-gradient(circle,#fde9c8 0%,#e3a35c 35%,#92400e 70%,transparent 100%);
}
/* 2nd place — cool icy/silver theme (frosted steel, not fire) */
.hol-card.rank2{
  width:230px;
  background:linear-gradient(165deg,rgba(100,116,139,.28) 0%,rgba(51,65,85,.5) 45%,rgba(15,23,42,.78) 100%);
  --hol-card-accent:linear-gradient(90deg,#94a3b8,#e2e8f0,#94a3b8);
  transition:transform .25s cubic-bezier(.4,0,.2,1),box-shadow .3s,border-color .25s;
  animation:holIcyShimmer 2.6s ease-in-out infinite;
}
.hol-card.rank2::before{
  background-size:200% 100%;
  animation:holAccentShimmer 3s linear infinite;
}
@keyframes holIcyShimmer{
  0%,100%{box-shadow:0 0 0 1px rgba(203,213,225,.22),0 14px 40px rgba(0,0,0,.4),0 0 20px rgba(148,163,184,.16);}
  50%{box-shadow:0 0 0 1px rgba(226,232,240,.4),0 14px 40px rgba(0,0,0,.4),0 0 34px rgba(203,213,225,.32);}
}
.hol-card.rank2:hover{
  box-shadow:0 0 0 1px rgba(226,232,240,.4),0 18px 50px rgba(0,0,0,.45),0 0 32px rgba(203,213,225,.3);
}
.hol-card.rank2 .hol-portrait{
  border-color:#cbd5e1 !important;
  box-shadow:0 0 0 3px rgba(203,213,225,.18),0 0 14px rgba(203,213,225,.35);
}

/* 3rd place — warm bronze/copper theme */
.hol-card.rank3{
  width:210px;
  background:linear-gradient(165deg,rgba(146,64,14,.24) 0%,rgba(87,49,20,.48) 45%,rgba(28,17,10,.78) 100%);
  --hol-card-accent:linear-gradient(90deg,#92400e,#cd7f32,#92400e);
  transition:transform .25s cubic-bezier(.4,0,.2,1),box-shadow .3s,border-color .25s;
  animation:holBronzeGlow 2.8s ease-in-out infinite;
}
.hol-card.rank3::before{
  background-size:200% 100%;
  animation:holAccentShimmer 3.4s linear infinite;
}
@keyframes holBronzeGlow{
  0%,100%{box-shadow:0 0 0 1px rgba(205,127,50,.22),0 12px 35px rgba(0,0,0,.4),0 0 18px rgba(205,127,50,.14);}
  50%{box-shadow:0 0 0 1px rgba(224,150,80,.4),0 12px 35px rgba(0,0,0,.4),0 0 30px rgba(205,127,50,.3);}
}
.hol-card.rank3:hover{
  box-shadow:0 0 0 1px rgba(205,127,50,.35),0 16px 45px rgba(0,0,0,.45),0 0 28px rgba(205,127,50,.28);
}
.hol-card.rank3 .hol-portrait{
  border-color:#cd7f32 !important;
  box-shadow:0 0 0 3px rgba(205,127,50,.18),0 0 14px rgba(205,127,50,.35);
}

/* ════════════════════════════════════════════════════════
   HOL: Crown (only 1st) — lives INSIDE .hol-portrait-wrap
   (not .hol-card) and sits low, right on the head, slightly
   overlapping the photo. The card has overflow:hidden, so
   anything positioned above the card's own top edge gets
   clipped invisible — this is why the old crown "disappeared".
   ════════════════════════════════════════════════════════ */
.hol-crown-wrap{
  position:absolute;top:-16px;left:50%;transform:translateX(-50%);
  width:50px;height:36px;z-index:6;pointer-events:none;
  animation:holCrownFloat 2.6s ease-in-out infinite;
}
.hol-crown-wrap svg{filter:drop-shadow(0 3px 8px rgba(0,0,0,.55)) drop-shadow(0 0 10px var(--hol-crown-glow,rgba(249,115,22,.7)));
  overflow:visible;}
/* Silver (2nd) and bronze (3rd) crowns sit a touch smaller than gold */
.hol-crown-wrap.hol-crown-wrap-sm{
  top:-12px;width:40px;height:28px;
  animation:holCrownFloat 2.9s ease-in-out infinite;
}
@keyframes holCrownFloat{
  0%,100%{transform:translateX(-50%) translateY(0);}
  50%{transform:translateX(-50%) translateY(-3px);}
}

/* ════════════════════════════════════════════════════════
   HOL: Card portrait — kept simple on purpose. The dominant
   effect lives on the card (embers + flicker), not stacked
   ornamentation around the photo.
   ════════════════════════════════════════════════════════ */
.hol-portrait-wrap{
  position:relative;
  margin-top:18px;margin-bottom:12px;
}
.hol-card.rank1 .hol-portrait-wrap{margin-top:20px;}
.hol-portrait{
  border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-family:var(--fh);font-weight:900;position:relative;overflow:hidden;
  transition:box-shadow .25s;
  border:3px solid transparent;
  z-index:1;
}
/* Sizes by rank */
.hol-card.rank1 .hol-portrait{width:120px;height:120px;font-size:40px;}
.hol-card.rank2 .hol-portrait{width:100px;height:100px;font-size:32px;}
.hol-card.rank3 .hol-portrait{width:90px;height:90px;font-size:28px;}
/* Warm ember ring instead of the student's usual colour, so the
   champion's photo visually belongs to the fire theme */
.hol-card.rank1 .hol-portrait{
  border-color:#f97316 !important;
  box-shadow:0 0 0 3px rgba(249,115,22,.25),0 0 20px rgba(249,115,22,.5);
}

/* Rank badge overlaid on bottom-center of portrait */
.hol-rank-badge{
  position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);
  width:22px;height:22px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  font-size:13px;line-height:1;
  border:2px solid rgba(13,12,22,.9);
  background:rgba(13,12,22,.8);
  z-index:2;
}
.hol-rank-badge.hol-rank-badge-fire{
  width:30px;height:30px;font-size:15px;
  background:radial-gradient(circle,#fde68a,#f97316 60%,#c2410c 100%);
  border:2px solid rgba(13,12,22,.9);
  bottom:-8px;
  animation:holBadgeFireFlicker 1.4s ease-in-out infinite;
}
@keyframes holBadgeFireFlicker{
  0%,100%{box-shadow:0 0 8px rgba(249,115,22,.55);}
  50%{box-shadow:0 0 18px rgba(251,146,60,.95);}
}
.hol-card.rank2 .hol-rank-badge{
  background:radial-gradient(circle,#f1f5f9,#94a3b8 65%,#64748b 100%);
  animation:holBadgeIcyShimmer 2.2s ease-in-out infinite;
}
@keyframes holBadgeIcyShimmer{
  0%,100%{box-shadow:0 0 6px rgba(203,213,225,.45);}
  50%{box-shadow:0 0 14px rgba(226,232,240,.85);}
}
.hol-card.rank3 .hol-rank-badge{
  background:radial-gradient(circle,#fbcf9d,#cd7f32 65%,#92400e 100%);
  animation:holBadgeBronzeGlow 2.4s ease-in-out infinite;
}
@keyframes holBadgeBronzeGlow{
  0%,100%{box-shadow:0 0 6px rgba(205,127,50,.45);}
  50%{box-shadow:0 0 14px rgba(224,150,80,.85);}
}

/* Portrait image */
.hol-portrait img{
  position:absolute;inset:0;width:100%;height:100%;
  object-fit:cover;border-radius:50%;
}
.hol-portrait-init{position:relative;z-index:1}

/* ════════════════════════════════════════════════════════
   HOL: Card text
   ════════════════════════════════════════════════════════ */
.hol-card-name{
  font-family:var(--fh);font-weight:900;text-align:center;
  color:var(--on-surface);line-height:1.2;
  padding:0 10px;
}
.hol-card.rank1 .hol-card-name{font-size:30px;margin-bottom:3px;}
.hol-card.rank2 .hol-card-name{font-size:24px;margin-bottom:3px;}
.hol-card.rank3 .hol-card-name{font-size:24px;margin-bottom:3px;}

.hol-card-score{
  font-family:var(--fh);font-weight:900;text-align:center;
  color:var(--hol-accent-color,#ffb95f);
  letter-spacing:-.02em;
}
.hol-card.rank1 .hol-card-score{font-size:30px;}
.hol-card.rank2 .hol-card-score{font-size:24px;}
.hol-card.rank3 .hol-card-score{font-size:24px;}

.hol-card-score-lbl{
  font-size:9px;color:rgba(240,238,255,.3);font-weight:700;
  letter-spacing:.07em;text-transform:uppercase;text-align:center;margin-top:1px;
}

/* ════════════════════════════════════════════════════════
   HOL: Card title / equipped-title badge — now lives where the
   plinth used to be (bottom of the card) and rendered at full
   size instead of shrunk down.
   NOTE: this container previously set line-height:0, which is
   an inherited property — it was cascading into the equipped
   title badge's .ts-badge-text span. That span sits inside
   .ts-badge-wrap, which clips with overflow:hidden, so a
   zero-height inherited line box was clipping the label text
   completely invisible (only the badge's SVG frame showed).
   Reset to line-height:normal fixes it.
   ════════════════════════════════════════════════════════ */
.hol-card-title{
  font-family:var(--fm);font-size:12px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--hol-title-color,rgba(240,238,255,.55));
  text-align:center;padding:0 8px;min-height:36px;
  margin-top:12px;
  line-height:normal;
  display:flex;align-items:center;justify-content:center;
}
.hol-card-title .ts-badge-wrap{
  transform:scale(1);
  transform-origin:center center;
  line-height:normal;
}

/* ════════════════════════════════════════════════════════
   HOL: "My rank" ribbon at bottom of podium section
   ════════════════════════════════════════════════════════ */
.hol-my-rank-bar{
  position:relative;z-index:2;
  margin:0 20px 20px;padding:10px 20px;
  background:rgba(208,188,255,.06);
  border:1px solid rgba(208,188,255,.14);
  border-radius:12px;
  display:flex;align-items:center;justify-content:space-between;
  font-size:12px;font-weight:600;color:var(--text-muted);
}
.hol-my-rank-bar .hol-my-rank-num{
  font-family:var(--fh);font-size:18px;font-weight:900;color:var(--primary);
}
.hol-my-rank-bar .hol-my-rank-score{
  font-family:var(--fh);font-size:13px;font-weight:800;
}

/* ════════════════════════════════════════════════════════
   HOL: Rankings list (#4 onward) — clean rows
   ════════════════════════════════════════════════════════ */
.hol-list-header{
  display:flex;align-items:center;justify-content:space-between;
  margin-bottom:12px;
}
.hol-list-title{
  font-family:var(--fh);font-size:15px;font-weight:800;color:var(--on-surface);
  display:flex;align-items:center;gap:8px;
}
.hol-active-pill{
  font-size:10px;font-weight:700;padding:2px 9px;border-radius:10px;
  background:rgba(208,188,255,.1);color:var(--primary);border:1px solid rgba(208,188,255,.2);
}

.hol-pagination{
  display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;margin-top:16px;
}
.hol-page-btn{
  padding:6px 12px;border-radius:8px;font-size:12px;font-weight:700;font-family:var(--fb);
  border:1px solid var(--border);background:rgba(255,255,255,.04);color:var(--text-muted);cursor:pointer;
  transition:all .15s;
}
.hol-page-btn:hover:not(:disabled){border-color:rgba(208,188,255,.3);color:var(--on-surface)}
.hol-page-btn:disabled{opacity:.4;cursor:default}
.hol-page-btn.active{background:rgba(208,188,255,.14);border-color:rgba(208,188,255,.35);color:var(--primary)}
.hol-page-ellipsis{padding:0 4px;color:var(--text-muted);font-size:12px}
.hol-page-range{text-align:center;margin-top:8px;font-size:11px;color:var(--text-muted)}

.hol-row{
  display:flex;align-items:center;gap:12px;
  padding:11px 14px;border-radius:12px;
  border:1px solid var(--border);
  background:rgba(35,31,56,.65);
  transition:border-color .18s,background .18s,transform .15s;
  margin-bottom:5px;
  position:relative;overflow:hidden;
}
.hol-row:hover{
  border-color:rgba(208,188,255,.18);background:rgba(35,31,56,.9);
  transform:translateX(2px);
}
/* "You" highlight */
.hol-row.hol-me{
  border-color:rgba(208,188,255,.32);
  background:rgba(208,188,255,.05);
}
.hol-row.hol-me::before{
  content:'';position:absolute;left:0;top:0;bottom:0;width:3px;
  background:var(--primary-dark);border-radius:12px 0 0 12px;
}

/* Rank number cell */
.hol-row-rank{
  width:32px;text-align:center;flex-shrink:0;
  font-family:var(--fm);font-size:12px;font-weight:900;color:var(--text-muted);
}

/* Small avatar */
.hol-row-av{
  width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-family:var(--fh);font-weight:900;font-size:13px;flex-shrink:0;
  position:relative;overflow:hidden;border:2px solid transparent;
  transition:border-color .18s;
}
.hol-row:hover .hol-row-av{border-color:rgba(255,255,255,.15);}

/* Info block */
.hol-row-info{flex:1;min-width:0;}
.hol-row-name{
  font-family:var(--fh);font-size:13px;font-weight:800;
  color:var(--on-surface);display:flex;align-items:center;gap:6px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.hol-row-badge-you{
  font-size:8px;color:var(--primary);font-family:var(--fm);
  background:rgba(208,188,255,.12);padding:1px 6px;border-radius:5px;
  border:1px solid rgba(208,188,255,.2);flex-shrink:0;
}
.hol-row-title{
  font-family:var(--fm);font-size:9px;letter-spacing:.07em;text-transform:uppercase;
  color:rgba(240,238,255,.38);margin-top:2px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  line-height:normal;
}
/* Scale the badge wrap down when it's inside a leaderboard row */
.hol-row-title .ts-badge-wrap{
  transform:scale(0.52);
  transform-origin:left center;
  vertical-align:middle;
  line-height:normal;
}
.hol-row-sub{
  font-size:11px;color:var(--text-muted);margin-top:1px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}

/* Score cell */
.hol-row-score{text-align:right;flex-shrink:0;min-width:72px;}
.hol-row-score-main{font-family:var(--fh);font-size:14px;font-weight:900;}
.hol-row-score-lbl{font-size:9px;color:var(--text-muted);font-weight:700;
  letter-spacing:.06em;text-transform:uppercase;margin-top:1px;}

/* ════════════════════════════════════════════════════════
   HOL: Top 3 in full list get a subtle medal tint
   ════════════════════════════════════════════════════════ */
.hol-row.top3-gold{
  border-color:rgba(255,185,95,.4);
  background:linear-gradient(100deg,rgba(255,185,95,.1) 0%,rgba(255,185,95,.02) 30%,rgba(255,185,95,.1) 60%,rgba(255,185,95,.02) 100%);
  box-shadow:0 0 0 1px rgba(255,185,95,.25),0 0 16px rgba(255,185,95,.18);
  padding:14px 14px;
}
.hol-row.top3-gold .hol-row-rank{
  font-size:20px;width:36px;
  filter:drop-shadow(0 0 6px rgba(255,185,95,.7));
}
.hol-row.top3-gold .hol-row-av{
  border-color:#f59e0b88 !important;
  box-shadow:0 0 0 2px rgba(255,185,95,.35),0 0 14px rgba(255,185,95,.4);
}
.hol-row.top3-gold .hol-row-score-main{font-size:15px;text-shadow:0 0 12px rgba(255,185,95,.5);}
.hol-row.top3-silver{border-color:rgba(203,213,225,.12);}
.hol-row.top3-bronze{border-color:rgba(205,127,50,.12);}

/* ════════════════════════════════════════════════════════
   HOL: "No data" empty state
   ════════════════════════════════════════════════════════ */
.hol-empty{
  text-align:center;padding:64px 20px;
  background:rgba(255,255,255,.015);
  border:1px dashed rgba(255,255,255,.07);
  border-radius:16px;
}
.hol-empty-icon{font-size:52px;margin-bottom:14px;filter:grayscale(.3);}
.hol-empty-title{font-family:var(--fh);font-size:17px;font-weight:900;
  color:var(--on-surface);margin-bottom:6px;}
.hol-empty-sub{font-size:13px;color:var(--text-muted);line-height:1.6;max-width:300px;margin:0 auto;}

/* ════════════════════════════════════════════════════════
   HOL: Disabled state
   ════════════════════════════════════════════════════════ */
.hol-disabled{
  text-align:center;padding:56px 20px;
  background:rgba(255,255,255,.015);
  border:1px dashed rgba(255,255,255,.07);
  border-radius:16px;
}

/* ════════════════════════════════════════════════════════
   HOL: Subtle entrance animation
   ════════════════════════════════════════════════════════ */
@keyframes hol-rise{
  from{opacity:0;transform:translateY(14px);}
  to{opacity:1;transform:translateY(0);}
}
.hol-stage{animation:hol-rise .38s ease both;}
.hol-row{animation:hol-rise .28s ease both;}

/* ════════════════════════════════════════════════════════
   HOL: Responsive
   ════════════════════════════════════════════════════════ */
@media(max-width:680px){
  .hol-card.rank1{width:160px;}
  .hol-card.rank2{width:130px;}
  .hol-card.rank3{width:118px;}
  .hol-card.rank1 .hol-portrait{width:72px;height:72px;font-size:22px;}
  .hol-card.rank2 .hol-portrait{width:58px;height:58px;font-size:18px;}
  .hol-card.rank3 .hol-portrait{width:52px;height:52px;font-size:16px;}
  .hol-scene-title{font-size:17px;}
  .hol-podium-row{padding:0 8px;}
  .hol-crown-wrap{width:36px;height:26px;top:-20px;}
  .hol-portrait-ring{inset:-6px;}
  .hol-rank-wreath{width:64px;height:38px;bottom:-16px;}
  .hol-card.rank1 .hol-portrait-wrap::before{width:150px;height:150px;}
  .hol-card.rank1 .hol-card-name,.hol-card.rank1 .hol-card-score{font-size:20px;}
  .hol-card.rank2 .hol-card-name,.hol-card.rank2 .hol-card-score,
  .hol-card.rank3 .hol-card-name,.hol-card.rank3 .hol-card-score{font-size:16px;}
  .hol-card-title{min-height:26px;margin-top:8px;}
  .hol-card-title .ts-badge-wrap{transform:scale(0.7);}
}
@media(prefers-reduced-motion:reduce){
  .hol-stage,.hol-row{animation:none!important;}
  .hol-card{transition:none!important;}
  .hol-card.rank1,.hol-card.rank1::before,.hol-card.rank1 .hol-portrait-wrap::before,
  .hol-card.rank1 .hol-portrait-wrap::after,.hol-crown-wrap,
  .hol-rank-wreath,.hol-row.top3-gold,.hol-row.top3-gold .hol-row-rank,
  .hol-card.rank2,.hol-card.rank2::before,.hol-card.rank3,.hol-card.rank3::before,
  .hol-rank-badge,.hol-ember{
    animation:none!important;
  }
  .hol-embers{display:none;}
}

/* ════════════════════════════════════════════════════════
   HOL: "Legendary" flourishes — exclusive to the hall tab,
   since it's the flagship class-wide rankings page and
   should read as a tier above the individual category boards.
   ════════════════════════════════════════════════════════ */
/* Slim shimmering rim across the very top of the stage, cycling
   through every category's color so it reads as "the sum of all
   boards" rather than any one activity's palette. */
.hol-legend-bar{
  position:absolute;top:0;left:0;right:0;height:3px;z-index:3;
  background:linear-gradient(90deg,#ffb95f,#d0bcff,#4edea3,#EC4899,#ffb95f);
  background-size:250% 100%;
  animation:holLegendShimmer 5s linear infinite;
  border-radius:20px 20px 0 0;
}
@keyframes holLegendShimmer{
  0%{background-position:0% 0}
  100%{background-position:250% 0}
}
.hol-stage-legendary{
  box-shadow:0 0 0 1px rgba(255,255,255,.08),0 24px 70px rgba(0,0,0,.5),0 0 50px rgba(208,188,255,.1);
}
/* Slow-drifting gold dust across the whole stage (not just the podium
   cards) — a much bigger, lazier field than the per-card embers, to
   signal "the whole room is celebrating", not just the champion. */
.hol-sparkle-field{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:1;}
.hol-sparkle{
  position:absolute;border-radius:50%;
  background:radial-gradient(circle,#fff7ed 0%,#fde68a 45%,transparent 100%);
  opacity:0;
  animation:holSparkleDrift ease-in-out infinite;
}
@keyframes holSparkleDrift{
  0%{transform:translateY(0) scale(.6);opacity:0;}
  15%{opacity:.65;}
  50%{opacity:.85;}
  85%{opacity:.2;}
  100%{transform:translateY(-40px) scale(1);opacity:0;}
}
@media(prefers-reduced-motion:reduce){
  .hol-legend-bar,.hol-sparkle{animation:none!important;}
  .hol-sparkle-field{display:none;}
}

/* Class-wide summary strip beneath the podium — gives the hall tab
   a "hub overview" feel none of the single-category boards have. */
.hol-hall-summary{
  display:grid;grid-template-columns:repeat(4,1fr);gap:10px;
  margin:0 0 24px;
}
.hol-summary-card{
  background:rgba(35,31,56,.55);backdrop-filter:blur(10px);
  border:1px solid rgba(255,255,255,.07);border-radius:14px;
  padding:14px 12px;text-align:center;
}
.hol-summary-icon{font-size:18px;margin-bottom:6px;}
.hol-summary-val{
  font-family:var(--fh);font-size:20px;font-weight:900;color:var(--on-surface);
  letter-spacing:-.02em;line-height:1.1;
}
.hol-summary-lbl{
  font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
  color:var(--text-muted);margin-top:4px;
}
@media(max-width:680px){
  .hol-hall-summary{grid-template-columns:repeat(2,1fr);}
}
    `;
    document.head.appendChild(s);
  })();
