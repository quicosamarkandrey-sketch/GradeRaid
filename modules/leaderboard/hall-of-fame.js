/* ============================================================
   modules/leaderboard/hall-of-fame.js
   EduQuest — Hall of Legends student UI

   Depends on:
     eql-engine.js   (eqlComputeRecitation, eqlComputeBoss,
                      eqlComputeAcademic, eqlComputeOverall,
                      eqlBuildCategory, window.EQL)
     shared/dom.js   (showModal, closeModalForce, toast)
   Exports via window.*:
     window.renderLeaderboard(activeTab?, activePeriod?) → void
     window.renderLeaderboard()  [base XP podium + rankings — RESTORED below]
   References tsBuildBadgeHTML via typeof guard (extracted Day 8).
   ============================================================ */

// ── Base Hall of Fame renderer (XP podium + full class rankings) ──────────────
// RESTORED: this was the original, pre-HOL renderLeaderboard() — it renders
// the page hero, top-3 podium, and full sorted student rankings list. The IIFE
// below wraps "the original renderLeaderboard" expecting it to already exist
// under this exact name so it can call it for the 'hall' tab and inject the
// HOL category/period nav bar above it. That original function was never
// actually carried over during extraction (only this file's header comment
// claimed it lived in auth.js — it did not), so _origRenderLeaderboard below
// resolved to null and the 'hall' tab silently rendered nothing but the nav
// bar. Ported verbatim from the original inline script.
function renderLeaderboard(){
  const sorted = [...DB.students].sort((a,b)=>b.xp-a.xp);
  const st = currentUser;
  const myRank = sorted.findIndex(s=>s.id===st.id)+1;
  const medals = ['🥇','🥈','🥉'];
  const podiumColors = [
    {b:'rgba(255,185,95,0.35)',av:'rgba(255,185,95,0.12)',c:'#ffb95f'},
    {b:'rgba(203,195,215,0.25)',av:'rgba(203,195,215,0.1)',c:'#cbc3d7'},
    {b:'rgba(205,127,50,0.25)',av:'rgba(205,127,50,0.1)',c:'#cd7f32'},
  ];

  const pg = document.getElementById('s-leaderboard');
  if (!pg) return;
  pg.innerHTML = `
  <div class="page-hero">
    <div class="page-hero-bg"></div>
    <div style="position:relative;z-index:1">
      <div class="page-hero-label">🏆 Hall of Fame</div>
      <h1 style="font-family:var(--fh);font-size:32px;font-weight:900;color:var(--on-surface);margin-bottom:8px">Class Rankings</h1>
      <p style="font-size:14px;color:var(--text-muted)">Where legends are forged. Your rank: <span style="color:var(--primary);font-weight:700">#${myRank}</span></p>
    </div>
  </div>

  <!-- PODIUM TOP 3 -->
  <div class="lb-podium" style="margin-bottom:24px">
    ${sorted.slice(0,3).map((s,i)=>`
    <div class="podium-card p${i+1}">
      <div class="podium-medal">${medals[i]}</div>
      <div class="podium-av" style="background:${podiumColors[i].av};color:${podiumColors[i].c};border-color:${podiumColors[i].c+'66'}">${_esc(s.init)}</div>
      <div class="podium-name">${_esc(s.name.split(' ')[0])}</div>
      <div class="podium-xp">${s.xp.toLocaleString()}</div>
      <div class="podium-sub">XP · Level ${s.level}</div>
    </div>`).join('')}
  </div>

  <!-- FULL LIST -->
  <div class="section-header">
    <span class="material-symbols-outlined">format_list_numbered</span>
    <h2>Full Rankings</h2>
  </div>
  <div class="lb-list">
    ${sorted.map((s,i)=>{
      const isMe = s.id===st.id;
      return `<div class="lb-row ${isMe?'me':''}">
        <div class="lb-rank">${i<3?medals[i]:`<span>${i+1}</span>`}</div>
        <div class="lb-av" style="background:${s.color+'22'};color:${s.color};border-color:${s.color+'44'}">${_esc(s.init)}</div>
        <div style="flex:1">
          <div class="lb-name">${_esc(s.name)}${isMe?`<span class="lb-badge-me">You</span>`:''}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${_esc(s.tier)} · Level ${s.level}</div>
        </div>
        <div style="text-align:right">
          <div class="lb-xp">${s.xp.toLocaleString()} XP</div>
          <div class="lb-attendance">${s.attendance}% ✓</div>
        </div>
        <div class="lb-level">${'LV'+s.level}</div>
      </div>`;
    }).join('')}
  </div>`;
}
window.renderLeaderboard = renderLeaderboard;

(function () {
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
    `;
    document.head.appendChild(s);
  })();

  // ─────────────────────────────────────────────────────────────────────────────
  // Category metadata — colors, gradients, spotlight tints
  // ─────────────────────────────────────────────────────────────────────────────
  const HOL_CAT = {
    hall:       { label: 'Hall of Fame',   icon: '🏛️', color: '#d0bcff', grad: 'linear-gradient(135deg,#d0bcff,#8b5cf6)',      glow: 'rgba(208,188,255,.28)', beam: 'rgba(208,188,255,.18)' },
    recitation: { label: 'Recitation',     icon: '🎤', color: '#4edea3', grad: 'linear-gradient(135deg,#4edea3,#06b6d4)',      glow: 'rgba(78,222,163,.28)',  beam: 'rgba(78,222,163,.14)'  },
    boss:       { label: 'Boss Raider',    icon: '⚔️',  color: '#EC4899', grad: 'linear-gradient(135deg,#EC4899,#9333ea)',      glow: 'rgba(236,72,153,.3)',   beam: 'rgba(236,72,153,.16)'  },
    academic:   { label: 'Academic',       icon: '📚', color: '#d0bcff', grad: 'linear-gradient(135deg,#8b5cf6,#d0bcff)',      glow: 'rgba(139,92,246,.28)',  beam: 'rgba(139,92,246,.14)'  },
    overall:    { label: 'Overall',        icon: '🏆', color: '#ffb95f', grad: 'linear-gradient(135deg,#ffb95f,#f97316)',      glow: 'rgba(255,185,95,.3)',   beam: 'rgba(255,185,95,.18)'  },
  };

  // Period labels for the filter bar
  const HOL_PERIODS = [
    { key: 'all',     label: 'All Time' },
    { key: 'monthly', label: 'Monthly'  },
    { key: 'weekly',  label: 'Weekly'   },
    { key: 'daily',   label: 'Daily'    },
  ];

  // ─────────────────────────────────────────────────────────────────────────────
  // Period → resetAt conversion (client-side, for display filtering)
  // ─────────────────────────────────────────────────────────────────────────────
  function _holPeriodResetAt(period) {
    if (period === 'all') return null;
    const now = new Date();
    if (period === 'daily') {
      const d = new Date(now); d.setHours(0, 0, 0, 0); return d.toISOString();
    }
    if (period === 'weekly') {
      const d = new Date(now); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d.toISOString();
    }
    if (period === 'monthly') {
      const d = new Date(now.getFullYear(), now.getMonth(), 1); return d.toISOString();
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Get equipped title object for a student (returns title obj or null)
  // ─────────────────────────────────────────────────────────────────────────────
  function _holGetTitleObj(student) {
    return (typeof tsGetEquippedTitle === 'function') ? tsGetEquippedTitle(student.id) : null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Derive a short title for a student
  // ─────────────────────────────────────────────────────────────────────────────
  function _holGetTitle(student, categoryKey) {
    // 0. Equipped titles override all fallback labels
    const equipped = (typeof tsGetEquippedTitle === 'function') ? tsGetEquippedTitle(student.id) : null;
    if (equipped) return equipped.name;

    // 1. Check unlocked achievement names for category-appropriate titles
    const unlocks = (DB.achievementUnlocks || {})[student.id] || [];
    if (unlocks.length > 0) {
      const achList = (DB.achievements || []);
      const rarityOrder = ['Mythic', 'Legendary', 'Epic', 'Rare', 'Uncommon', 'Common'];
      for (const rarity of rarityOrder) {
        const ach = achList.find(a => a.rarity === rarity && unlocks.some(u => u.achId === a.id));
        if (ach) return ach.name;
      }
    }

    // 2. Category-specific fallback titles based on student tier/stats
    const tierTitles = {
      'Master':   { overall: 'Grand Master', boss: 'Raid Legend',   recitation: 'Voice of Wisdom', academic: 'Top Scholar'  },
      'Scholar':  { overall: 'Scholar',      boss: 'Raid Veteran',  recitation: 'Silver Tongue',   academic: 'Bright Mind'  },
      'Achiever': { overall: 'Achiever',      boss: 'Raider',        recitation: 'Eager Speaker',   academic: 'Quest Seeker' },
      'Novice':   { overall: 'Novice',        boss: 'Recruit',       recitation: 'Rising Voice',    academic: 'Apprentice'   },
    };
    const tier   = student.tier || 'Scholar';
    const catKey = categoryKey === 'hall' ? 'overall' : categoryKey;
    return (tierTitles[tier] || {})[catKey] || student.tier || '';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SVG spotlight beams for the stage — 3 beams, one per podium slot
  // ─────────────────────────────────────────────────────────────────────────────
  function _holBeamSVG(beamColor) {
    const cx       = [25, 50, 75];
    const opacities = [0.55, 0.85, 0.45];
    const widths    = [18,  26,   16];
    return `<svg viewBox="0 0 100 100" preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"
      style="position:absolute;inset:0;pointer-events:none;">
      <defs>
        <filter id="hol-blur"><feGaussianBlur stdDeviation="2.5"/></filter>
      </defs>
      ${cx.map((x, i) => `
      <polygon
        points="${x - widths[i] / 2},0 ${x + widths[i] / 2},0 ${x + widths[i]},100 ${x - widths[i]},100"
        fill="${beamColor}"
        opacity="${opacities[i]}"
        filter="url(#hol-blur)"
      />
      `).join('')}
    </svg>`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Render a single podium card
  // ─────────────────────────────────────────────────────────────────────────────
  function _holRenderCard(entry, rankNum, catKey, meta) {
    if (!entry) {
      return `<div class="hol-card rank${rankNum}" style="opacity:.3;padding-bottom:24px;">
        <div style="color:rgba(240,238,255,.25);font-family:var(--fm);font-size:11px;font-weight:800;letter-spacing:.08em;padding-top:20px;text-align:center;">#${rankNum}</div>
      </div>`;
    }
    const s      = entry.student;
    const color  = s.color || '#8b5cf6';
    const title  = _holGetTitle(s, catKey);
    const medals = ['🥇', '🥈', '🥉'];

    // BUGFIX (Investigation Report §2): the initials <span> used to be
    // rendered unconditionally alongside the <img>, so it was always in the
    // DOM and could peek out from behind/around the photo. "Has photo" is
    // now a real conditional — only one of img/initials ever exists at a
    // time, matching the pattern att_scanner_rfid.js's _rfidProfileCardHtml()
    // already uses correctly. A broken image URL swaps in the initials at
    // the moment it fails to load, rather than initials sitting underneath
    // a photo that hasn't failed yet.
    const portraitHtml = s.profilePic
      ? `<div class="hol-portrait" style="background:${color}22;border-color:${color}55;">
           <img src="${s.profilePic}" alt="${s.name}" onerror="this.parentElement.style.color='${color}';this.parentElement.innerHTML='<span class=&quot;hol-portrait-init&quot;>${s.init}</span>'">
         </div>`
      : `<div class="hol-portrait" style="background:${color}22;color:${color};border-color:${color}55;">
           <span class="hol-portrait-init">${s.init}</span>
         </div>`;

    // Rank1 gets the full 6-particle ember plume (it's the centerpiece);
    // rank2/rank3 get a lighter 4-particle plume recolored to match their
    // theme, so all three podium spots feel alive without tripling the
    // total particle count animating on screen at once.
    const emberLefts     = [10, 24, 40, 58, 74, 88];
    const secondaryLefts = [16, 38, 62, 84];
    const particleThemeClass = rankNum === 1 ? 'hol-embers-fire'
      : rankNum === 2 ? 'hol-embers-icy'
      : rankNum === 3 ? 'hol-embers-bronze' : '';
    const particleLefts = rankNum === 1 ? emberLefts : secondaryLefts;
    const embersHtml = (rankNum >= 1 && rankNum <= 3)
      ? `<div class="hol-embers ${particleThemeClass}">${particleLefts.map((left, i) =>
          `<span class="hol-ember" style="left:${left}%;animation-delay:${(i * 0.5).toFixed(1)}s;animation-duration:${(2.6 + (i % 3) * 0.4).toFixed(1)}s"></span>`
        ).join('')}</div>`
      : '';

    const rankBadgeHtml = rankNum === 1
      ? `<div class="hol-rank-badge hol-rank-badge-fire">1</div>`
      : `<div class="hol-rank-badge">${medals[rankNum - 1]}</div>`;

    // Crown lives inside .hol-portrait-wrap (not .hol-card) and sits low —
    // .hol-card has overflow:hidden, so anything above the card's own top
    // edge gets clipped invisible. Placing it here, low, guarantees it's
    // actually on screen, resting right on the portrait. Gold for 1st,
    // silver for 2nd, bronze for 3rd — same shape, recolored + slightly
    // smaller for 2nd/3rd so 1st still reads as the champion.
    const crownPalette = {
      1: { base: '#f59e0b', jewel: '#fde68a', side: '#fbbf24', band: '#d97706', glow: 'rgba(249,115,22,.7)' },
      2: { base: '#cbd5e1', jewel: '#f8fafc', side: '#e2e8f0', band: '#64748b', glow: 'rgba(203,213,225,.65)' },
      3: { base: '#cd7f32', jewel: '#fbcf9d', side: '#e3a35c', band: '#92400e', glow: 'rgba(205,127,50,.65)' },
    };
    const cp = crownPalette[rankNum];
    const crownHtml = (cp) ? `
      <div class="hol-crown-wrap${rankNum !== 1 ? ' hol-crown-wrap-sm' : ''}" style="--hol-crown-glow:${cp.glow}">
        <svg viewBox="0 0 46 34" fill="none" xmlns="http://www.w3.org/2000/svg" width="${rankNum === 1 ? 46 : 38}" height="${rankNum === 1 ? 34 : 28}" overflow="visible">
          <path d="M3 29 L10 8 L23 18 L36 8 L43 29 Z" fill="${cp.base}" stroke="${cp.side}" stroke-width="1.4" stroke-linejoin="round"/>
          <circle cx="3"  cy="29" r="2.8" fill="${cp.base}"/>
          <circle cx="43" cy="29" r="2.8" fill="${cp.base}"/>
          <circle cx="23" cy="8"  r="3" fill="${cp.jewel}"/>
          <circle cx="10" cy="8"  r="2.2" fill="${cp.side}"/>
          <circle cx="36" cy="8"  r="2.2" fill="${cp.side}"/>
          <rect x="1.5" y="28.5" width="42" height="4.2" rx="1.8" fill="${cp.band}"/>
        </svg>
      </div>` : '';

    const displayName = s.displayName || s.name;
    const firstName   = displayName.split(' ')[0];

    // tsBuildBadgeHTML typeof guard — safe until Day 8 (titles module)
    // Rendered at full size (not opts.small) now that it lives in the
    // bigger footprint left behind by the removed plinth.
    const titleObj = _holGetTitleObj(s);
    const titleDisplayHTML = (titleObj && typeof tsBuildBadgeHTML === 'function')
      ? `<div class="hol-card-title">${tsBuildBadgeHTML(titleObj, { noParticles: true })}</div>`
      : (title ? `<div class="hol-card-title" style="--hol-title-color:${color}88">${title}</div>` : '');

    return `<div class="hol-card rank${rankNum}" title="${displayName}" style="">
      ${embersHtml}
      <div class="hol-portrait-wrap">
        ${portraitHtml}
        ${crownHtml}
        ${rankBadgeHtml}
      </div>
      <div class="hol-card-name">${firstName}</div>
      <div class="hol-card-score" style="color:${meta.color}">${entry.scoreLabel}</div>
      <div class="hol-card-score-lbl">${catKey === 'boss' ? 'damage' : catKey === 'recitation' ? 'points' : 'score'}</div>
      ${titleDisplayHTML}
    </div>`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Build the complete stage scene (podium + beams + header)
  // ─────────────────────────────────────────────────────────────────────────────
  function _holRenderStage(entries, catKey, periodKey, myEntry) {
    const meta        = HOL_CAT[catKey] || HOL_CAT.overall;
    const periodLabel = (HOL_PERIODS.find(p => p.key === periodKey) || HOL_PERIODS[0]).label;

    // Slot order: index 1 (2nd), index 0 (1st), index 2 (3rd)
    const slots = [entries[1], entries[0], entries[2]];
    const ranks = [2, 1, 3];

    const myRank      = myEntry ? `#${myEntry.rank}` : '—';
    const myScore     = myEntry ? myEntry.scoreLabel  : '—';
    const myName      = myEntry ? (myEntry.student.displayName || myEntry.student.name).split(' ')[0] : 'You';
    const isInPodium  = myEntry && myEntry.rank <= 3;

    return `<div class="hol-stage">
      <div class="hol-beams">${_holBeamSVG(meta.beam)}</div>
      <div class="hol-scene-header">
        <div class="hol-scene-kicker">Hall of Legends</div>
        <div class="hol-scene-title" style="--hol-grad:${meta.grad};--hol-glow:${meta.glow}">${meta.icon} ${meta.label}</div>
        <div class="hol-scene-period">${periodLabel}</div>
      </div>

      <div class="hol-podium-row">
        ${slots.map((e, i) => _holRenderCard(e, ranks[i], catKey, meta)).join('')}
      </div>

      ${!isInPodium ? `<div class="hol-my-rank-bar">
        <div>
          <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:2px">Your Standing</div>
          <div style="font-size:13px;font-weight:700;color:var(--on-surface)">${myName}</div>
        </div>
        <div style="display:flex;align-items:center;gap:16px">
          <div style="text-align:right">
            <div class="hol-my-rank-score" style="color:${meta.color}">${myScore}</div>
            <div style="font-size:10px;color:var(--text-muted);letter-spacing:.05em">score</div>
          </div>
          <div style="text-align:center">
            <div class="hol-my-rank-num">${myRank}</div>
            <div style="font-size:10px;color:var(--text-muted);letter-spacing:.05em">rank</div>
          </div>
        </div>
      </div>` : ''}
    </div>`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Render a single row for rank #4 onward
  // ─────────────────────────────────────────────────────────────────────────────
  function _holRenderRow(entry, catKey, meta, animDelay) {
    const { rank, student: s, stats, scoreLabel } = entry;
    const isMe  = currentUser && s.id === currentUser.id;
    const color = s.color || '#8b5cf6';
    const title = _holGetTitle(s, catKey);

    let rowTint = '';
    if (rank === 1)      rowTint = 'top3-gold';
    else if (rank === 2) rowTint = 'top3-silver';
    else if (rank === 3) rowTint = 'top3-bronze';

    // BUGFIX (Investigation Report §2): the initials <span> was explicitly
    // z-index:1 — one layer above the photo — so it always painted on top
    // regardless of whether the photo loaded. Only render one or the other;
    // a broken image URL swaps in the initials at load-failure time.
    const avHtml = s.profilePic
      ? `<div class="hol-row-av" style="border-color:${color}44;background:${color}11;">
           <img src="${s.profilePic}" alt="${s.name}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.style.background='${color}22';this.parentElement.style.color='${color}';this.parentElement.textContent='${s.init}'">
         </div>`
      : `<div class="hol-row-av" style="border-color:${color}44;background:${color}22;color:${color};">${s.init}</div>`;

    let sub = '';
    switch (catKey) {
      case 'recitation': case 'hall':
        sub = `🎤 ${(stats.sessionCount || 0)} sessions · 🔥 ${(stats.streak || 0)} streak`;
        break;
      case 'boss':
        sub = `⚔️ ${(stats.participationCount || 0)} raids · 🏆 ${(stats.victories || 0)} victories`;
        break;
      case 'academic':
        sub = `📖 ${(stats.quizCount || 0)} quests · ⭐ ${(stats.perfectScores || 0)} perfect`;
        break;
      case 'overall':
        sub = `XP ${(stats.baseXP || 0).toLocaleString()} · 🎤 ${(stats.recitationPts || 0)} pts`;
        break;
    }

    const rankLabel = rank === 1 ? '👑' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;

    // tsBuildBadgeHTML typeof guard
    const titleObj = _holGetTitleObj(s);
    const titleLineHTML = (titleObj && typeof tsBuildBadgeHTML === 'function')
      ? `<div class="hol-row-title" style="margin-top:2px;display:flex;align-items:center">${tsBuildBadgeHTML(titleObj, { small: true, noParticles: true })}</div>`
      : (title ? `<div class="hol-row-title" style="color:${color}88">${title}</div>` : '');

    return `<div class="hol-row ${rowTint} ${isMe ? 'hol-me' : ''}"
      style="animation-delay:${animDelay}ms">
      <div class="hol-row-rank">${rankLabel}</div>
      ${avHtml}
      <div class="hol-row-info">
        <div class="hol-row-name">
          ${s.displayName || s.name}
          ${isMe ? '<span class="hol-row-badge-you">You</span>' : ''}
        </div>
        ${titleLineHTML}
        <div class="hol-row-sub">${sub}</div>
      </div>
      <div class="hol-row-score">
        <div class="hol-row-score-main" style="color:${meta.color}">${scoreLabel}</div>
        <div class="hol-row-score-lbl">${s.tier} · LV${s.level}</div>
      </div>
    </div>`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Build the category + period selector bars
  // ─────────────────────────────────────────────────────────────────────────────
  function _holBuildNavBars(activeTab, activePeriod) {
    const cats = [
      { key: 'hall',       label: 'Hall of Fame', icon: '🏛️' },
      { key: 'overall',    label: 'Overall',       icon: '🏆' },
      { key: 'recitation', label: 'Recitation',    icon: '🎤' },
      { key: 'boss',       label: 'Boss Raider',   icon: '⚔️'  },
      { key: 'academic',   label: 'Academic',      icon: '📚' },
    ];
    const catBar = `<div class="hol-cat-bar">
      ${cats.map(c => `<button class="hol-cat-btn ${c.key === 'hall' ? 'hall-tab' : ''} ${activeTab === c.key ? 'active' : ''}"
        onclick="renderLeaderboard('${c.key}','${activePeriod}')">
        <span class="hol-cat-icon">${c.icon}</span>${c.label}
      </button>`).join('')}
    </div>`;

    const periodBar = activeTab !== 'hall' ? `<div class="hol-period-bar">
      ${HOL_PERIODS.map(p => `<button class="hol-period-btn ${activePeriod === p.key ? 'active' : ''}"
        onclick="renderLeaderboard('${activeTab}','${p.key}')">${p.label}</button>`).join('')}
    </div>` : '';

    return `<div class="hol-nav">${catBar}</div>${periodBar}`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN PATCH: renderLeaderboard
  // Wraps the original Hall of Fame renderer (defined earlier in index.html)
  // and adds the full HOL category/period system on top.
  // ─────────────────────────────────────────────────────────────────────────────
  const _origRenderLeaderboard = (typeof renderLeaderboard === 'function') ? renderLeaderboard : null;

  window.renderLeaderboard = function (activeTab, activePeriod) {
    activeTab    = activeTab    || window._eqlActiveTab    || 'hall';
    activePeriod = activePeriod || window._eqlActivePeriod || 'all';
    window._eqlActiveTab    = activeTab;
    window._eqlActivePeriod = activePeriod;

    // ── Hall of Fame tab: delegate to original + inject HOL nav above it ──
    if (activeTab === 'hall') {
      if (_origRenderLeaderboard) _origRenderLeaderboard();
      const pg = document.getElementById('s-leaderboard');
      if (!pg) return;
      pg.insertAdjacentHTML('afterbegin', _holBuildNavBars('hall', activePeriod));
      return;
    }

    // ── Specialised leaderboard category ──
    const cfg     = (DB.leaderboardConfig || {})[activeTab] || {};
    const enabled = cfg.enabled !== false;
    const meta    = HOL_CAT[activeTab] || HOL_CAT.overall;

    // Period-aware resetAt (overrides stored config reset for display purposes)
    const periodResetAt = _holPeriodResetAt(activePeriod);

    // Build entries with period filter applied
    let entries = [];
    if (enabled) {
      entries = DB.students.map(student => {
        let stats, score, scoreLabel;
        switch (activeTab) {
          case 'recitation': {
            stats      = eqlComputeRecitation(student.id, periodResetAt);
            score      = stats.totalPts;
            scoreLabel = score.toLocaleString() + ' pts';
            break;
          }
          case 'boss': {
            stats      = eqlComputeBoss(student.id, periodResetAt);
            score      = stats.totalDamage;
            scoreLabel = score.toLocaleString() + ' DMG';
            break;
          }
          case 'academic': {
            stats      = eqlComputeAcademic(student.id, periodResetAt);
            score      = stats.academicXP + stats.perfectScores * 200 + stats.questCompletions * 50;
            scoreLabel = score.toLocaleString() + ' pts';
            break;
          }
          default: {
            stats      = eqlComputeOverall(student.id, periodResetAt);
            score      = stats.score;
            scoreLabel = score.toLocaleString() + ' pts';
            break;
          }
        }
        return { student, stats, score, scoreLabel };
      });
      entries.sort((a, b) => b.score - a.score);
      let cr = 1;
      entries.forEach((e, i) => {
        if (i > 0 && entries[i - 1].score === e.score) e.rank = entries[i - 1].rank;
        else e.rank = cr;
        cr = e.rank + 1;
      });
    }

    const myEntry = entries.find(e => currentUser && e.student.id === currentUser.id);
    const myRank  = myEntry ? myEntry.rank : '—';
    const active  = entries.filter(e => e.score > 0).length;
    const top3    = entries.slice(0, 3);

    const pg = document.getElementById('s-leaderboard');
    if (!pg) return;

    pg.innerHTML = `
    <div class="page-hero">
      <div class="page-hero-bg"></div>
      <div class="page-hero-bg2"></div>
      <div style="position:relative;z-index:1">
        <div class="page-hero-label">🏆 Hall of Legends</div>
        <h1 style="font-family:var(--fh);font-size:32px;font-weight:900;color:var(--on-surface);margin-bottom:8px">${meta.label} Rankings</h1>
        <p style="font-size:14px;color:var(--text-muted)">Your rank: <span style="color:${meta.color};font-weight:700">#${myRank}</span></p>
      </div>
    </div>

    ${_holBuildNavBars(activeTab, activePeriod)}

    ${!enabled
      ? `<div class="hol-disabled">
          <div style="font-size:44px;margin-bottom:14px">🔒</div>
          <div style="font-family:var(--fh);font-size:17px;font-weight:900;color:var(--on-surface);margin-bottom:6px">Leaderboard Disabled</div>
          <div style="font-size:13px;color:var(--text-muted)">This leaderboard is currently turned off by your teacher.</div>
         </div>`
      : entries.length < 1
        ? `<div class="hol-empty">
            <div class="hol-empty-icon">${meta.icon}</div>
            <div class="hol-empty-title">No Data Yet</div>
            <div class="hol-empty-sub">Rankings will appear here as students participate. Be the first on the board!</div>
           </div>`
        : `
    ${_holRenderStage(top3, activeTab, activePeriod, myEntry)}

    <div class="hol-list-header">
      <div class="hol-list-title">
        <span class="material-symbols-outlined" style="color:${meta.color};font-size:20px">format_list_numbered</span>
        Full Rankings
        <span class="hol-active-pill">${active} active</span>
      </div>
    </div>
    <div id="hol-list-${activeTab}">
      ${entries.filter(e => e.rank > 3).map((e, i) => _holRenderRow(e, activeTab, meta, Math.min(i * 22, 200))).join('')}
    </div>`
    }`;
  };

  // Keep old helper aliases alive so any external calls don't break
  window._eqlBuildStudentTabBar = function (activeTab) {
    return _holBuildNavBars(activeTab, window._eqlActivePeriod || 'all');
  };
  window._eqlRenderRow = function (entry, categoryKey, meta) {
    return _holRenderRow(entry, categoryKey, meta, 0);
  };

  console.log('[HOL] hall-of-fame.js loaded. renderLeaderboard patched with HOL stage.');
})();
