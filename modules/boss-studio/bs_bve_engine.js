// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/boss-studio/bve-engine.js
//  Boss Visual Engine (BVE): resolves a World Boss Event → visual HTML.
//  Also owns the Boss Library Picker modal used by the World Boss event editor.
//  LOAD AFTER: storage.js, library.js, animation-library.js, editor.js
//
//  RESOLVES: campaign/engine.js typeof guard on bveRenderBossArt.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Main renderer ─────────────────────────────────────────────────────────────

/**
 * bveRenderBossArt(bossEvent, opts) → HTML string  [window.bveRenderBossArt]
 *
 * Resolves a World Boss event's visual identity from its linked Boss Studio
 * profile (bossEvent._bossLibraryId) or from legacy emoji/image fields.
 * Ported verbatim from the original Boss Studio IIFE so DOM structure
 * (.bve-boss-wrap / .bve-boss-ring / .bve-hit-flash / .bve-boss-art) matches
 * exactly what the rest of the World Boss CSS and BVS/BHS systems expect.
 *
 * opts: { size:'hero'|'card'|'battle', id:string, stateClass:string }
 *
 * Returns HTML string. Does NOT mutate bossEvent.
 */
function bveRenderBossArt(bossEvent, opts){
  opts = opts || {};
  const size = opts.size || 'hero';
  const elemId = opts.id || '';
  const stateClass = opts.stateClass || 'state-idle';
  const profile = bveGetLinkedProfile(bossEvent);
  const artSrc = profile ? bveGetArtSrc(profile) : {type:'none', value:''};
  // Fall back to legacy image field
  if(artSrc.type === 'none' && bossEvent.image){
    const img = bossEvent.image;
    // Is it a URL?
    if(img.startsWith('http') || img.startsWith('data:')){
      return `<div class="bve-boss-wrap">
        <div class="bve-boss-ring"></div><div class="bve-boss-ring2"></div>
        <div class="bve-hit-flash" id="${elemId}-flash"></div>
        <img class="bve-boss-art ${stateClass}" ${elemId?`id="${elemId}"`:''}
          src="${_esc(img)}" alt="${_esc(bossEvent.name||'Boss')}"
          style="max-width:min(85%,180px);max-height:min(85%,180px)">
      </div>`;
    }
    // Emoji
    return `<div class="bve-boss-wrap">
      <div class="bve-boss-ring"></div><div class="bve-boss-ring2"></div>
      <div class="bve-hit-flash" id="${elemId}-flash"></div>
      <div class="bve-boss-art is-emoji ${stateClass}" ${elemId?`id="${elemId}"`:''}>${img}</div>
    </div>`;
  }

  if(artSrc.type === 'emoji'){
    return `<div class="bve-boss-wrap">
      <div class="bve-boss-ring"></div><div class="bve-boss-ring2"></div>
      <div class="bve-hit-flash" id="${elemId}-flash"></div>
      <div class="bve-boss-art is-emoji ${stateClass}" ${elemId?`id="${elemId}"`:''}>${artSrc.value}</div>
    </div>`;
  }
  if(artSrc.type === 'img'){
    return `<div class="bve-boss-wrap">
      <div class="bve-boss-ring"></div><div class="bve-boss-ring2"></div>
      <div class="bve-hit-flash" id="${elemId}-flash"></div>
      <img class="bve-boss-art ${stateClass}" ${elemId?`id="${elemId}"`:''}
        src="${_esc(artSrc.value)}" alt="${_esc((profile&&profile.name)||bossEvent.name||'Boss')}"
        onerror="this.style.display='none';this.insertAdjacentHTML('afterend','<div class=\\'bve-boss-art is-emoji ${stateClass}\\'>💀</div>')">
    </div>`;
  }
  // No artwork at all
  return `<div class="bve-boss-wrap">
    <div class="bve-boss-ring"></div><div class="bve-boss-ring2"></div>
    <div class="bve-hit-flash" id="${elemId}-flash"></div>
    <div class="bve-boss-art is-emoji ${stateClass}" ${elemId?`id="${elemId}"`:''}>${bossEvent.image||'💀'}</div>
  </div>`;
}

/**
 * bveRenderCompactArt(bossEvent, sizePx) → HTML string  [window.bveRenderCompactArt]
 * Render compact boss art for topbar widget or card headers. Ported verbatim
 * from the original — sizePx default is 28, not the simplified-version's 48.
 */
function bveRenderCompactArt(bossEvent, sizePx){
  sizePx = sizePx || 28;
  const profile = bveGetLinkedProfile(bossEvent);
  const artSrc = profile ? bveGetArtSrc(profile) : {type:'none', value:''};
  const img = bossEvent.image || '💀';

  if(artSrc.type === 'emoji' || (artSrc.type === 'none' && !img.startsWith('http'))){
    const emo = artSrc.type === 'emoji' ? artSrc.value : img;
    return `<span style="font-size:${Math.round(sizePx*0.6)}px;line-height:1">${emo}</span>`;
  }
  if(artSrc.type === 'img'){
    return `<img src="${_esc(artSrc.value)}" style="width:${sizePx}px;height:${sizePx}px;object-fit:contain;border-radius:4px"
      onerror="this.style.display='none'" alt="">`;
  }
  return `<span style="font-size:${Math.round(sizePx*0.6)}px;line-height:1">${img}</span>`;
}

/**
 * bveRenderBossArtAsync(bossEvent, opts, containerEl) → HTML string
 * [window.bveRenderBossArtAsync]
 *
 * Like bveRenderBossArt but pre-loads idb: images first then injects HTML
 * into containerEl. Use when you can't await before building the initial
 * HTML (e.g. inside template literals). Renders immediately with whatever
 * is cached, then re-renders once preloading resolves.
 */
function bveRenderBossArtAsync(bossEvent, opts, containerEl){
  // Render immediately with whatever is cached (may be fallback/emoji)
  const initialHtml = bveRenderBossArt(bossEvent, opts);
  if(containerEl) containerEl.innerHTML = initialHtml;
  // Pre-load, then re-render if art was unavailable on first pass
  bvePreloadBossArt(bossEvent).then(function(){
    const freshHtml = bveRenderBossArt(bossEvent, opts);
    if(containerEl && freshHtml !== initialHtml) containerEl.innerHTML = freshHtml;
  }).catch(function(){});
  return initialHtml;
}

/**
 * bvePreloadBossArt(bossEvent) — async  [window.bvePreloadBossArt]
 * Pre-warm the IndexedDB image cache for any idb: references in the boss's
 * linked Boss Studio profile. Call this BEFORE rendering so that
 * bveGetArtSrc() can return synchronously with the data-URL already cached.
 * Returns a promise that resolves when preloading is done.
 *
 * RESTORED: this function was missing entirely from the extracted codebase,
 * even though summon-notify.js, leaderboard.js, raid-flow.js, student-page.js,
 * and bve-patches.js all call it defensively via typeof guards. Its absence
 * silently broke all boss-art preloading (incl. Loot Rush art reveal).
 */
async function bvePreloadBossArt(bossEvent){
  if(!bossEvent) return;
  const profile = bveGetLinkedProfile(bossEvent);
  if(!profile) return;
  // Use the exported helper from Boss Studio storage layer
  const preload = window._bsPreloadArt;
  if(typeof preload === 'function') await preload(profile);
}

/**
 * _bveBsLoad() / _bveBsGet(id) — [window._bveBsLoad / window._bveBsGet]
 * Resolve bsLoad/bsGet from their public window aliases. The Boss Studio
 * module may not share lexical scope with World Boss admin-page.js, so all
 * cross-module reads of the Boss Library go through these wrappers.
 *
 * RESTORED: these were missing entirely, which caused the Boss Library
 * Picker's _bflpConfirmSelection() to always receive boss === null and show
 * "❌ Profile not found" even when a profile had been created in Boss Studio.
 */
function _bveBsLoad(){ (window.bsLoad || window._bsLoad || function(){})(); }
function _bveBsGet(id){ return ((window.bsGet || window._bsGet || function(){ return null; })(id)); }

// ── VISUAL STATE MACHINE (BVS) ─────────────────────────────────────────────────
/**
 * RESTORED: BVS and BHS below were missing entirely from the extracted
 * codebase even though world-boss/bve-patches.js (§8, §9) references them
 * directly (BVS.request, BVS.init, BVS.enterRage, BHS.queueHit, BHS.reset)
 * with no typeof guard — every call would have thrown a ReferenceError,
 * breaking boss hit animations, cast animations, and rage-mode transitions.
 * Ported verbatim from the original Boss Studio IIFE.
 *
 * The Visual State Machine (BVS) prevents animation conflicts.
 * States form a priority queue: rage > cast > hit > idle.
 * A higher-priority state cannot be interrupted by a lower one.
 */
const BVS = {
  _current: 'idle',         // current state key
  _priority: {idle:0, hit:1, cast:2, rage:3},
  _returnTimer: null,       // timer to return to idle after transient state
  _hitQueue: [],            // pending hit signals while in a higher-priority state
  _artId: 'wb-boss-sprite', // default element ID to animate

  init(artId){
    this._artId = artId || 'wb-boss-sprite';
    this._current = 'idle';
    this._hitQueue = [];
    if(this._returnTimer) clearTimeout(this._returnTimer);
    this._returnTimer = null;
    this._applyState('idle');
  },

  /**
   * Request a state transition.
   * Lower-priority states will be queued or dropped if a higher state is active.
   */
  request(state, duration){
    const pNew = this._priority[state] || 0;
    const pCur = this._priority[this._current] || 0;

    if(state === 'hit'){
      // Hits are always queued (BHS handles their display separately)
      // But we only visually react to the first hit while not in cast/rage
      if(pCur >= 2) { this._hitQueue.push({duration: duration||380}); return; }
    }

    if(pNew >= pCur || state === 'idle'){
      this._transition(state, duration);
    }
  },

  _transition(state, duration){
    if(this._returnTimer) clearTimeout(this._returnTimer);
    this._current = state;
    this._applyState(state);

    if(state !== 'idle'){
      const dur = duration || (state==='hit'?400 : state==='cast'?800 : 600);
      this._returnTimer = setTimeout(()=>{
        this._current = 'idle';
        this._applyState('idle');
        // Drain hit queue
        if(this._hitQueue.length > 0 && state !== 'idle'){
          this._hitQueue.shift(); // consume without visual (already shown)
        }
      }, dur);
    }
  },

  _applyState(state){
    const el = document.getElementById(this._artId);
    if(!el) return;

    // ── Look up the Boss Studio profile's custom animation cssClass ──────────
    let profileAnimClass = '';
    let profileAnimDur = 0; // actual duration in ms for one-shot states
    try {
      const _found = (typeof wbcGetActiveBoss === 'function') && wbcGetActiveBoss();
      if(_found) {
        const profile = (typeof bveGetLinkedProfile === 'function') ? bveGetLinkedProfile(_found.boss) : null;
        if(profile && profile.animations && profile.animations[state]) {
          const _alGetFn = (typeof alGet === 'function') ? alGet
                         : (typeof window._alGet === 'function') ? window._alGet : null;
          const animPreset = _alGetFn ? _alGetFn(profile.animations[state]) : null;
          if(animPreset && animPreset.cssClass) {
            profileAnimClass = animPreset.cssClass;
            // Extract duration from Boss Studio CSS rule so we know how long to show it
            // hit/cast are transient — parse their animation duration from the stylesheet
            if(state === 'hit' || state === 'cast') {
              try {
                // Find the rule for this class and read its animation duration
                for(let i = 0; i < document.styleSheets.length; i++) {
                  try {
                    const rules = document.styleSheets[i].cssRules || [];
                    for(let j = 0; j < rules.length; j++) {
                      const r = rules[j];
                      if(r.selectorText && r.selectorText.trim() === '.' + profileAnimClass) {
                        const anim = r.style.animationDuration || r.style.animation || '';
                        const match = anim.match(/([\d.]+)s/);
                        if(match) profileAnimDur = parseFloat(match[1]) * 1000;
                        break;
                      }
                    }
                  } catch(e) {}
                  if(profileAnimDur) break;
                }
              } catch(e) {}
            }
          }
        }
      }
    } catch(e) { /* silent — fallback to default BVE animation */ }

    // Remove all state classes + any previously applied profile animation class
    el.classList.remove('state-idle','state-hit','state-cast','state-rage');
    if(el.dataset.bvsProfileClass) {
      el.dataset.bvsProfileClass.split(' ').filter(Boolean).forEach(c => el.classList.remove(c));
    }

    // Force reflow so removing + re-adding class restarts the animation
    void el.offsetWidth;

    el.classList.add('state-' + state);

    // Apply Boss Studio animation class — CSS :not([class*="bs-anim-play-"]) on the
    // state-* rules means these classes automatically win over BVE fallback animations.
    if(profileAnimClass) {
      profileAnimClass.split(' ').filter(Boolean).forEach(c => el.classList.add(c));
      el.dataset.bvsProfileClass = profileAnimClass;

      // For hit/cast: Boss Studio classes are declared as `infinite` loops in the
      // animation library CSS, but in world boss they should play once then stop.
      // Override animation-iteration-count to 1 so they play through once.
      if(state === 'hit' || state === 'cast') {
        el.style.animationIterationCount = '1';
        el.style.animationFillMode = 'forwards';
      } else {
        // idle and rage loop forever — restore defaults
        el.style.animationIterationCount = '';
        el.style.animationFillMode = '';
      }
    } else {
      el.dataset.bvsProfileClass = '';
      el.style.animationIterationCount = '';
      el.style.animationFillMode = '';
    }
  },

  /** Flash the hit overlay without changing state class */
  flashHit(){
    const flashEl = document.getElementById(this._artId + '-flash');
    if(!flashEl) return;
    flashEl.classList.remove('flash');
    // Force reflow
    void flashEl.offsetWidth;
    flashEl.classList.add('flash');
    setTimeout(()=>flashEl.classList.remove('flash'), 120);
  },

  /** Enter rage mode permanently until reset — also swaps to rageArtwork if configured */
  enterRage(){
    if(this._returnTimer) clearTimeout(this._returnTimer);
    this._current = 'rage';
    this._applyState('rage');
    // ── Swap to rageArtwork image if the Boss Studio profile has one ─────────
    try {
      const _found = (typeof wbcGetActiveBoss === 'function') && wbcGetActiveBoss();
      if(_found) {
        const profile = (typeof bveGetLinkedProfile === 'function') ? bveGetLinkedProfile(_found.boss) : null;
        if(profile && profile.rageArtwork && profile.rageArtwork.value) {
          const artEl = document.getElementById(this._artId);
          if(artEl && !artEl.dataset.bvsRageSwapped) {
            const ra = profile.rageArtwork;
            // Resolve art src (handles idb: references via bveGetArtSrc if available)
            let raSrc = ra.value;
            if(typeof bveGetArtSrc === 'function' && ra.type !== 'emoji') {
              const resolved = bveGetArtSrc(profile, 'rage');
              if(resolved && resolved.value) raSrc = resolved.value;
            }
            if(ra.type === 'emoji') {
              if(artEl.tagName === 'IMG') {
                // Replace img node with a div for emoji
                const div = document.createElement('div');
                div.id = artEl.id;
                div.className = artEl.className;
                Object.assign(div.dataset, artEl.dataset);
                div.textContent = raSrc;
                artEl.parentNode.replaceChild(div, artEl);
              } else {
                artEl.textContent = raSrc;
              }
            } else {
              // Image src
              if(artEl.tagName === 'IMG') {
                artEl.src = raSrc;
              } else {
                // It's a div (emoji boss) — inject an img inside
                artEl.textContent = '';
                const img = document.createElement('img');
                img.src = raSrc;
                img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain';
                img.onerror = function(){ this.style.display='none'; };
                artEl.appendChild(img);
              }
            }
            artEl.classList.add('rage-crossfade');
            // Mark so we don't double-swap on repeated enterRage() calls
            const finalEl = document.getElementById(this._artId);
            if(finalEl) finalEl.dataset.bvsRageSwapped = '1';
          }
        }
      }
    } catch(e) { /* silent — rage artwork swap failed, keep current art */ }
  },

  reset(){
    if(this._returnTimer) clearTimeout(this._returnTimer);
    this._returnTimer = null;
    this._current = 'idle';
    this._hitQueue = [];
    // Clear rage swap flag so that if the battle resets the swap can happen again
    const artEl = document.getElementById(this._artId);
    if(artEl) delete artEl.dataset.bvsRageSwapped;
    this._applyState('idle');
  }
};

// ── BATCHED HIT SYSTEM (BHS) ───────────────────────────────────────────────────
/**
 * The Batched Hit System aggregates simultaneous damage from many students
 * into a single polished visual event. Key properties:
 *
 * - WINDOW_MS: hits arriving within this window are merged into one event
 * - MAX_FLOATS: max simultaneous floating numbers on screen (prevents spam)
 * - Crits always get their own flash; normal hits are combined
 * - State machine is notified once per batch (not per hit)
 */
const BHS = {
  WINDOW_MS: 180,          // batch accumulation window
  MAX_FLOATS: 5,           // max simultaneous damage floats
  _batch: null,            // {total, crits, count, maxSingle, hasCrit, timer}
  _activeFloats: 0,

  /**
   * Queue a damage hit for batched display.
   * Call this instead of _wbcFloatDamage for multiplayer-safe rendering.
   */
  queueHit(damage, isCrit, isMyHit){
    if(!this._batch){
      this._batch = {total:0, crits:0, count:0, maxSingle:0, hasCrit:false, isMyHit:false,
        timer: setTimeout(()=>this._flush(), this.WINDOW_MS)};
    }
    this._batch.total += damage;
    this._batch.count++;
    this._batch.maxSingle = Math.max(this._batch.maxSingle, damage);
    if(isCrit){ this._batch.crits++; this._batch.hasCrit = true; }
    if(isMyHit) this._batch.isMyHit = true;
  },

  _flush(){
    if(!this._batch) return;
    const b = this._batch;
    this._batch = null;

    // Determine display
    const showCrit   = b.hasCrit;
    const showCombo  = b.count > 1;
    const dmgColor   = showCrit ? '#ffb95f' : (b.isMyHit ? '#EC4899' : 'rgba(240,230,255,0.85)');
    const dmgText    = (showCrit ? '💥 ' : '') +
                       (showCombo ? `${b.count}× ` : '') +
                       '-' + b.total.toLocaleString();
    const fontSize   = showCrit ? 32 : (showCombo ? 26 : 22);

    // Notify visual state machine
    BVS.request('hit', 400);
    BVS.flashHit();

    // Show screen shake only for large hits (crit or big combo)
    if(showCrit || b.count >= 3){
      const scene = document.getElementById('camp-scene') ||
                    document.querySelector('.wbe-arena') ||
                    document.querySelector('.wbe-shell');
      if(scene){
        scene.classList.add('shake');
        setTimeout(()=>scene.classList.remove('shake'), 400);
      }
    }

    // Cap floats to prevent spam
    if(this._activeFloats >= this.MAX_FLOATS) return;

    // Only show float for player's own hit or big combos
    if(!b.isMyHit && b.count < 3 && !showCrit) return;

    this._spawnFloat(dmgText, dmgColor, fontSize, showCrit);
  },

  _spawnFloat(text, color, size, burst){
    const sprite = document.getElementById('wb-boss-sprite') ||
                   document.querySelector('.bve-boss-art');
    let x = window.innerWidth * 0.5, y = window.innerHeight * 0.35;
    if(sprite){
      const r = sprite.getBoundingClientRect();
      x = r.left + r.width * (0.35 + Math.random() * 0.3);
      y = r.top  + r.height * (0.2 + Math.random() * 0.3);
    }

    if(burst){
      const b = document.createElement('div');
      b.className = 'bhs-crit-burst';
      b.style.left = x + 'px';
      b.style.top  = y + 'px';
      document.body.appendChild(b);
      setTimeout(()=>b.remove(), 700);
    }

    const el = document.createElement('div');
    el.className = 'bhs-batch-float';
    el.textContent = text;
    el.style.cssText = `left:${x}px;top:${y}px;color:${color};font-size:${size}px;`;
    document.body.appendChild(el);
    this._activeFloats++;
    setTimeout(()=>{ el.remove(); this._activeFloats = Math.max(0, this._activeFloats-1); }, 1500);
  },

  reset(){
    if(this._batch && this._batch.timer) clearTimeout(this._batch.timer);
    this._batch = null;
    this._activeFloats = 0;
  }
};

// ── Boss Library Picker modal (used by World Boss event editor) ───────────────

/**
 * bveLinkBossProfile(bossEventId) → void  [window.bveLinkBossProfile]
 * Opens the library picker overlay so a teacher can select a BVP profile
 * to link to a World Boss event. On selection, calls window._bveOnPick callback.
 *
 * bossEventId: the boss event's array index or id (passed back to _bveOnPick).
 * Operators of the world-boss module register window._bveOnPick before calling.
 */
window.bveLinkBossProfile = function (bossEventId) {
  bsLoad();
  const profiles = DB.bossLibrary || [];
  let search = '';

  function renderPicker() {
    const filtered = search.trim()
      ? profiles.filter(b => (b.name||'').toLowerCase().includes(search.toLowerCase()) || (b.tags||[]).some(t => t.toLowerCase().includes(search.toLowerCase())))
      : profiles;

    const cards = filtered.map(b => {
      const theme  = b.visual?.themeColor || '#8b5cf6';
      const aura   = b.visual?.auraColor  || '#EC4899';
      const accent = b.visual?.cardAccent || '#d0bcff';
      const artInline = b.artwork?.type === 'emoji' ? `<span style="font-size:32px">${_esc(b.artwork.value)}</span>`
        : b.artwork?.value ? `<img src="${_esc(b.artwork.value)}" style="width:44px;height:44px;object-fit:contain;border-radius:8px">` : `<span style="font-size:32px">💀</span>`;
      return `<div class="bvlp-card" onclick="window._bvePickProfile('${_esc(bossEventId)}','${_esc(b.id)}')" style="border-color:${theme}55;background:rgba(35,31,56,.9)" title="${_esc(b.name)}">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <div style="width:52px;height:52px;border-radius:10px;background:radial-gradient(circle,${aura}44,${theme}22);border:1px solid ${theme}55;display:flex;align-items:center;justify-content:center;flex-shrink:0">${artInline}</div>
          <div style="flex:1;min-width:0"><div style="font-family:var(--fh);font-size:13px;font-weight:800;color:${accent};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(b.name||'Unnamed')}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${(b.tags||[]).slice(0,3).map(t=>`<span style="background:${theme}18;border:1px solid ${theme}33;color:${accent};border-radius:4px;padding:0 5px;font-size:9px">${_esc(t)}</span>`).join(' ')}</div></div>
        </div>
        ${b.description ? `<div style="font-size:11px;color:var(--text-muted);line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${_esc(b.description)}</div>` : ''}
      </div>`;
    }).join('');

    const emptyMsg = !profiles.length
      ? `<div style="text-align:center;padding:60px;color:var(--text-muted)"><div style="font-size:48px;margin-bottom:12px">🏰</div><div style="font-size:15px;font-weight:700;margin-bottom:8px">No Boss Profiles Yet</div><div style="font-size:13px">Create profiles in Boss Studio first.</div></div>`
      : filtered.length ? '' : `<div style="text-align:center;padding:40px;color:var(--text-muted)">No profiles match "<strong>${_esc(search)}</strong>"</div>`;

    return `<div style="background:rgba(255,255,255,.04);border-radius:11px;padding:10px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px;border:1px solid rgba(255,255,255,.08)"><span class="material-symbols-outlined" style="color:var(--text-muted);font-size:18px">search</span><input type="text" placeholder="Search profiles…" value="${_esc(search)}" id="bvlp-search" autofocus style="flex:1;background:none;border:none;color:var(--text);font-family:var(--fb);font-size:13px;outline:none" oninput="window._bvlpSearch(this.value)"></div>
    ${emptyMsg || `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">${cards}</div>`}`;
  }

  const modalId = 'bvlp-modal-body';
  showModal(`<div id="${modalId}">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,rgba(236,72,153,.25),rgba(139,92,246,.2));border:1px solid rgba(236,72,153,.4);display:flex;align-items:center;justify-content:center;font-size:20px">🎭</div>
      <div><div class="modal-h2" style="margin-bottom:2px">Link Boss Profile</div><div style="font-size:12px;color:var(--text-muted)">${profiles.length} profile${profiles.length!==1?'s':''} available</div></div>
    </div>
    <div id="bvlp-grid">${renderPicker()}</div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-ghost btn-sm" onclick="closeModalForce();renderBossStudio()" style="flex:0 0 auto">Open Boss Studio</button>
    </div>
  </div>`, 'md');

  window._bvlpSearch = function (val) {
    search = val;
    const grid = document.getElementById('bvlp-grid');
    if (grid) grid.innerHTML = renderPicker();
  };
};

window._bvePickProfile = function (bossEventId, profileId) {
  closeModalForce();
  if (typeof window._bveOnPick === 'function') window._bveOnPick(bossEventId, profileId);
  else toast('✅ Profile linked: ' + profileId, '#4edea3');
};

// ── BVE Core Helpers (were in Block D of original index.html) ─────────────────

/**
 * Resolve the best displayable artwork source for a Boss Studio profile.
 * Returns {type: 'emoji'|'img'|'none', value: string}
 */
function bveGetArtSrc(profile, slot){
  if(!profile) return {type:'none', value:''};
  const art = (slot === 'rage' && profile.rageArtwork && profile.rageArtwork.value)
    ? profile.rageArtwork
    : profile.artwork;
  if(art && art.value){
    if(art.type === 'emoji') return {type:'emoji', value: art.value};
    const val = art.value;
    if(val && typeof val === 'string'){
      if(val.indexOf('idb:') === 0){
        const cached = (typeof window._bsImgCacheGet === 'function') ? window._bsImgCacheGet(val) : null;
        if(cached) return {type:'img', value: cached};
        const fetchFn = window._bsImgFetch || (typeof _bsImgFetch === 'function' ? _bsImgFetch : null);
        if(fetchFn){
          fetchFn(val).then(function(dataUrl){
            if(!dataUrl) return;
            document.querySelectorAll('img[data-idb-ref]').forEach(function(el){
              if(el.getAttribute('data-idb-ref') === val){ el.src = dataUrl; el.style.display = ''; }
            });
            document.querySelectorAll('[data-idb-portrait]').forEach(function(el){
              if(el.getAttribute('data-idb-portrait') === val){
                el.innerHTML = '<img src="'+dataUrl+'" style="width:100%;height:100%;object-fit:contain;border-radius:inherit;" alt="">';
              }
            });
          }).catch(function(){});
        }
        // Cross-device fallback (Pending Fixes Report §2a): this ref only
        // ever resolves locally on the ONE browser that uploaded it — the
        // idb: key is meaningless in a different browser's IndexedDB. If a
        // Storage upload for this same artwork already completed (see
        // bs_storage.js's _bsUploadArtworkToStorage()), `remoteUrl` is a
        // plain, cross-device-usable URL — render that immediately instead
        // of falling all the way through to a blank/emoji placeholder.
        if(art.remoteUrl) return {type:'img', value: art.remoteUrl};
        return {type:'none', value:''};
      }
      if(val.startsWith('__BSIMG__')){
        try {
          const imgStore = (typeof DB !== 'undefined' && DB.bossImages)||{};
          const resolved = imgStore[val];
          if(resolved) return {type:'img', value: resolved};
        } catch(e){}
        return {type:'none', value:''};
      }
      if(val.startsWith('http') || val.startsWith('data:') || val.startsWith('/') || val.startsWith('./')) {
        return {type:'img', value: val};
      }
      if(val.length <= 8) return {type:'emoji', value: val};
      return {type:'img', value: val};
    }
  }
  return {type:'none', value:''};
}

/**
 * Get the Boss Studio profile linked to a World Boss Event (if any).
 */
function bveGetLinkedProfile(bossEvent){
  if(!bossEvent || !bossEvent._bossLibraryId) return null;
  const _bsGetFn = (typeof bsGet === 'function') ? bsGet
                 : (typeof window.bsGet === 'function') ? window.bsGet
                 : (typeof window._bsGet === 'function') ? window._bsGet
                 : null;
  if(!_bsGetFn) return null;
  return _bsGetFn(bossEvent._bossLibraryId) || null;
}

/**
 * Build CSS custom properties for a World Boss Event theme.
 */
function bveGetThemeVars(bossEvent){
  const profile = bveGetLinkedProfile(bossEvent);
  if(profile && profile.visual){
    const vis = profile.visual;
    return {
      '--bve-theme':  vis.themeColor  || '#8b5cf6',
      '--bve-aura':   vis.auraColor   || '#EC4899',
      '--bve-accent': vis.cardAccent  || '#d0bcff',
      '--bve-hp1':    vis.auraColor   || '#EC4899',
      '--bve-hp2':    vis.themeColor  || '#8b5cf6',
    };
  }
  return {
    '--bve-theme':  bossEvent._themeColor || '#8b5cf6',
    '--bve-aura':   bossEvent._auraColor  || '#EC4899',
    '--bve-accent': bossEvent._cardAccent || '#d0bcff',
    '--bve-hp1':    '#EC4899',
    '--bve-hp2':    '#8b5cf6',
  };
}

/**
 * Apply BVE CSS vars to an element.
 */
function bveApplyThemeVars(el, bossEvent){
  if(!el) return;
  const vars = bveGetThemeVars(bossEvent);
  Object.entries(vars).forEach(([k,v]) => el.style.setProperty(k, v));
}

// ── Export ────────────────────────────────────────────────────────────────────

window.bveRenderBossArt      = bveRenderBossArt;
window.bveRenderCompactArt   = bveRenderCompactArt;
window.bveRenderBossArtAsync = bveRenderBossArtAsync;
window.bvePreloadBossArt     = bvePreloadBossArt;
window.bveGetArtSrc          = bveGetArtSrc;
window.bveGetLinkedProfile   = bveGetLinkedProfile;
window.bveGetThemeVars       = bveGetThemeVars;
window.bveApplyThemeVars     = bveApplyThemeVars;
window._bveBsLoad            = _bveBsLoad;
window._bveBsGet             = _bveBsGet;
window.BVS                   = BVS;
window.BHS                   = BHS;

console.log('[EduQuest] boss-studio/bve-engine.js loaded — bveRenderBossArt, bveRenderCompactArt, bveRenderBossArtAsync, bvePreloadBossArt, BVS, BHS, bveLinkBossProfile registered. Campaign typeof guard resolved.');
