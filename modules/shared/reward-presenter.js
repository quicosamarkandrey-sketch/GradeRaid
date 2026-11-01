// Shared reward summary for quests, mail, achievements and other reward sources.
// Presentation only: callers grant rewards; Continue closes the summary.
// Preserves the public API, rarity/source registries and badge subscribers.
// Uses theme tokens, restrained motion, a visible footer and accessible focus.
// _eqrRunParticles remains available for older callers; the summary does not run it.

// ── Shared reward receipt: theme tokens, quiet motion and readable amounts. ──
;(function () {
 const style=document.createElement('style');
 style.setAttribute('data-preserve-theme','');
 style.textContent=`
#eq-reward-overlay{position:fixed;inset:0;z-index:8000;display:flex;align-items:center;justify-content:center;padding:20px;background:#0009;backdrop-filter:blur(6px);animation:eqr-enter .18s ease-out;overscroll-behavior:contain}
.eqr-panel{width:100%;max-width:500px;max-height:calc(100dvh - 40px);display:flex;flex-direction:column;position:relative;background:var(--surface,#151515);color:var(--text,#f4f4f4);border:1px solid var(--border2,#444);border-radius:16px;box-shadow:0 24px 80px #0004;overflow:hidden;overscroll-behavior:contain;animation:eqr-panel-enter .2s ease-out;scrollbar-width:thin;font-family:var(--fb,system-ui)}
.eqr-body{padding:28px;min-height:0;overflow-y:auto;overscroll-behavior:contain}
.eqr-topline{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:24px}
.eqr-source-label{font:600 10px/1.5 var(--fb,system-ui);letter-spacing:.07em;text-transform:uppercase;color:var(--text-muted,#aaa)}
.eqr-close{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;background:none;border:1px solid var(--border,#333);border-radius:8px;color:var(--text-muted,#aaa);cursor:pointer}
.eqr-close:hover{background:var(--surface-high,#222);color:var(--text,#fff)}
.eqr-close svg{width:17px;height:17px}
.eqr-heading-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px}
.eqr-icon-wrap{display:flex;align-items:center;justify-content:center;width:54px;height:54px;background:var(--surface-high,#222);border:1px solid var(--border,#333);border-radius:12px;font-size:27px;flex-shrink:0}
.eqr-icon-wrap svg{width:26px;height:26px}
.eqr-rarity-badge{display:flex;align-items:center;gap:7px;border:1px solid var(--border,#333);border-radius:5px;padding:5px 8px;color:var(--text-muted,#aaa);font:500 10px/1.5 var(--fb,system-ui)}
.eqr-rarity-dot{width:5px;height:5px;border-radius:50%;background:var(--eqr-rarity);flex-shrink:0}
.eqr-title{font:650 27px/1.25 var(--fh,system-ui);letter-spacing:-.03em;color:var(--text,#fff);margin:0 0 10px;overflow-wrap:anywhere}
.eqr-subtitle{font:400 13px/1.75 var(--fb,system-ui);color:var(--text-muted,#aaa);margin:0 0 24px;white-space:pre-wrap;overflow-wrap:anywhere}
.eqr-rewards-label{font:600 10px/1.5 var(--fb,system-ui);letter-spacing:.04em;color:var(--text-muted,#aaa);border-top:1px solid var(--border,#333);padding-top:20px;margin:24px 0 12px}
.eqr-rewards-grid{display:flex;flex-direction:column;border:1px solid var(--border,#333);border-radius:10px;background:var(--surface-high,#202020);overflow:hidden}
.eqr-reward-card{display:flex;align-items:center;gap:13px;padding:16px;min-width:0}
.eqr-reward-card+.eqr-reward-card{border-top:1px solid var(--border,#333)}
.eqr-reward-icon{display:flex;align-items:center;justify-content:center;width:36px;height:36px;font-size:23px;flex-shrink:0}
.eqr-reward-icon svg{width:22px;height:22px}
.eqr-reward-info{flex:1;min-width:0}
.eqr-reward-label{display:block;font:500 12px/1.5 var(--fb,system-ui);color:var(--text,#fff);overflow-wrap:anywhere}
.eqr-reward-caption{display:block;font:400 10px/1.6 var(--fb,system-ui);color:var(--text-muted,#aaa);margin-top:2px}
.eqr-reward-amount{font:600 25px/1.25 var(--fh,system-ui);letter-spacing:-.03em;color:var(--text,#fff);font-variant-numeric:tabular-nums;overflow-wrap:anywhere;max-width:55%;text-align:right}
.eqr-reward-title .eqr-reward-amount{display:block;font-size:16px;line-height:1.5;max-width:none;text-align:left;margin-top:4px;letter-spacing:0}
.eqr-no-rewards{font:400 13px/1.7 var(--fb,system-ui);color:var(--text-muted,#aaa);padding:20px 0;border-block:1px solid var(--border,#333);margin:24px 0}
.eqr-footer{padding:20px 28px 28px;flex-shrink:0;border-top:1px solid var(--border,#333)}
.eqr-claim-btn{width:100%;min-height:48px;display:flex;align-items:center;justify-content:space-between;gap:14px;border:1px solid var(--text,#fff);border-radius:8px;padding:12px 16px;background:var(--text,#fff);color:var(--bg,#111);cursor:pointer;font:600 13px/1.5 var(--fb,system-ui);box-shadow:none}
.eqr-claim-btn:hover{opacity:.87}
.eqr-claim-btn svg{width:17px;height:17px}
#eq-reward-overlay button:focus-visible{outline:2px solid var(--text,#fff);outline-offset:4px}
#eq-reward-overlay.eqr-leaving{opacity:0;transition:opacity .12s ease-out}
@keyframes eqr-enter{from{opacity:0}to{opacity:1}}
@keyframes eqr-panel-enter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:480px){#eq-reward-overlay{padding:14px}.eqr-panel{max-height:calc(100dvh - 28px);border-radius:13px}.eqr-body{padding:22px}.eqr-footer{padding:16px 22px 22px}.eqr-topline{margin-bottom:20px}.eqr-title{font-size:25px}.eqr-subtitle{font-size:12px}.eqr-reward-card{padding:14px 12px;gap:10px}.eqr-reward-amount{font-size:23px}.eqr-reward-label{font-size:12px}}
@media(prefers-reduced-motion:reduce){#eq-reward-overlay,.eqr-panel{animation:none!important;transition:none!important}}
`;
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

window.eqRewardPresent = function(opts = {}){
 const existing=document.getElementById('eq-reward-overlay');
 const returnTo=existing?.eqrReturnFocus || document.activeElement;
 if(existing?.eqrDismiss)existing.eqrDismiss(false);else existing?.remove();
 const {title='Rewards received',subtitle='',icon='🎁',rarity='Rare',source='system',rewards=[],onClose}=opts;
 const rarityKey=String(rarity).charAt(0).toUpperCase()+String(rarity).slice(1).toLowerCase();
 const validRarity=Object.hasOwn(EQR_RARITY_COLORS,rarityKey)?rarityKey:'Rare';
 const rCol=EQR_RARITY_COLORS[validRarity];
 const sourceLabel=Object.hasOwn(EQR_SOURCE_LABELS,source)?EQR_SOURCE_LABELS[source]:'Reward';
 const svg=path=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
 const gift=svg('M3 8h18v4H3z M5 12v9h14v-9 M12 8v13 M12 8H8a3 3 0 1 1 3-3l1 3z M12 8h4a3 3 0 1 0-3-3l-1 3z');
 const safeIcon=value=>typeof value==='string'&&value.length<=16&&!/[<>]/.test(value)?_esc(value):gift;
 const entries=Array.isArray(rewards)?rewards.filter(r=>r&&typeof r==='object'):[];
 const overlay=document.createElement('div');overlay.id='eq-reward-overlay';overlay.eqrReturnFocus=returnTo;
 overlay.innerHTML=`<section class="eqr-panel" role="dialog" aria-modal="true" aria-labelledby="eqr-heading" ${subtitle?'aria-describedby="eqr-description"':''} tabindex="-1" style="--eqr-rarity:${rCol.strip}"><div class="eqr-body">
  <div class="eqr-topline"><span class="eqr-source-label">${_esc(sourceLabel)}</span><button class="eqr-close" type="button" aria-label="Close reward summary">${svg('m6 6 12 12 M18 6 6 18')}</button></div>
  <div class="eqr-heading-row"><span class="eqr-icon-wrap" aria-hidden="true">${safeIcon(icon)}</span><span class="eqr-rarity-badge"><i class="eqr-rarity-dot" aria-hidden="true"></i>${_esc(validRarity)}</span></div>
  <h2 class="eqr-title" id="eqr-heading">${_esc(title)}</h2>${subtitle?`<p class="eqr-subtitle" id="eqr-description">${_esc(subtitle)}</p>`:''}
  ${entries.length?`<p class="eqr-rewards-label">Your rewards</p><div class="eqr-rewards-grid">${entries.map(r=>{
   const isTitle=r.type==='title',numeric=typeof r.amount==='number'&&Number.isFinite(r.amount);
   const amount=numeric?(r.amount>=0?'+':'')+r.amount.toLocaleString():String(r.amount??'');
   const label=isTitle?'Title unlocked':r.label||({xp:'Experience',coins:'Coins',item:'Item'}[r.type]||'Reward');
   return `<div class="eqr-reward-card${isTitle?' eqr-reward-title':''}"><span class="eqr-reward-icon" aria-hidden="true">${safeIcon(r.icon)}</span><div class="eqr-reward-info"><span class="eqr-reward-label">${_esc(label)}</span>${isTitle?`<strong class="eqr-reward-amount">${_esc(r.label||'New title')}</strong>`:r.type==='xp'?'<span class="eqr-reward-caption">Learning progress</span>':r.type==='coins'?'<span class="eqr-reward-caption">For your Armory rewards</span>':''}</div>${isTitle?'':`<strong class="eqr-reward-amount">${_esc(amount)}</strong>`}</div>`;
  }).join('')}</div>`:'<p class="eqr-no-rewards">No additional rewards for this update.</p>'}
 </div><div class="eqr-footer"><button class="eqr-claim-btn" type="button" id="eqr-btn">Continue ${svg('M4 12h16 M14 6l6 6-6 6')}</button></div>
 </section>`;
 const root=document.getElementById('app'),wasInert=root?.inert,previousOverflow=document.body.style.overflow;
 if(root)root.inert=true;document.body.style.overflow='hidden';document.body.appendChild(overlay);
 const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 let closing=false,finished=false;
 function finish(restoreFocus){
  if(finished)return;finished=true;overlay.remove();document.removeEventListener('keydown',keys,true);
  if(root)root.inert=wasInert;document.body.style.overflow=previousOverflow;
  try{if(typeof onClose==='function')onClose();}finally{
   if(restoreFocus&&!document.getElementById('eq-reward-overlay')){
    const target=returnTo?.isConnected&&returnTo.getClientRects().length?returnTo:document.querySelector('.page.active h1,.page.active h2,.page.active button');
    if(target){if(!target.matches('button,a,input,select,textarea,[tabindex]'))target.tabIndex=-1;target.focus({preventScroll:true});}
   }
  }
 }
 function dismiss(restoreFocus=true,animate=false){
  if(closing)return;closing=true;
  if(animate&&!reduce){overlay.classList.add('eqr-leaving');setTimeout(()=>finish(restoreFocus),130);}else finish(restoreFocus);
 }
 overlay.eqrDismiss=restoreFocus=>{closing=true;finish(restoreFocus);};
 function keys(event){
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();dismiss(true,true);}
  if(event.key==='Tab'){
   event.stopImmediatePropagation();const buttons=[...overlay.querySelectorAll('button:not(:disabled)')],first=buttons[0],last=buttons.at(-1);
   if(!overlay.contains(document.activeElement)){event.preventDefault();first.focus();}
   else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
 }
 document.addEventListener('keydown',keys,true);
 overlay.querySelector('#eqr-btn').addEventListener('click',()=>dismiss(true,true));
 overlay.querySelector('.eqr-close').addEventListener('click',()=>dismiss(true,true));
 overlay.addEventListener('click',event=>{if(event.target===overlay)dismiss(true,true);});
 requestAnimationFrame(()=>{if(overlay.isConnected&&!closing)overlay.querySelector('#eqr-btn').focus({preventScroll:true});});
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

// ── session:booted subscriber — refresh mail + achievement sidebar badges on login ────────
AppStore.subscribe('reward-presenter-boot-badges', function (state, event) {
  if (event.type !== 'session:booted') return;
  if (currentRole === 'student' && currentUser) {
    setTimeout(() => {
      mailUpdateSidebarBadge();
      achUpdateSidebarBadge();
    }, 400);
  }
});

// ── nav:navigated subscriber — refresh mail + achievement sidebar badges on
// navigation ─────────────────────────────────────────────────────────────
// Continuation Plan §3, Category A — replaces the old monkey-patch of
// window.navTo. Confirmed post-hook/void-return shape, load-order traced
// (nav.js now emits this after _navToCore() runs — including on its early
// activeQuiz-abort return, matching the old patch's "always runs after,
// regardless of internal branch" behavior exactly; see nav.js's emit() call
// site for the full reasoning).
AppStore.subscribe('reward-presenter-nav-badges', function (state, event) {
  if (event.type !== 'nav:navigated') return;
  if (currentRole === 'student') {
    setTimeout(() => { mailUpdateSidebarBadge(); achUpdateSidebarBadge(); }, 150);
  }
});

console.log('[EduQuest] shared/reward-presenter.js loaded — eqRewardPresent, _eqrRunParticles, EQR_RARITY_COLORS, EQR_SOURCE_LABELS registered. Subscribers: session:booted, nav:navigated (badge refresh).');
