// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/world-boss/phases.js
//  World Boss Phase System: 3-phase HP transitions with announcements.
//  LOAD AFTER: combat-settings.js, loot-rain.js, skills.js
// ═══════════════════════════════════════════════════════════════════════════════

// ── Default phases ────────────────────────────────────────────────────────────

window.WBP_DEFAULT_PHASES = [
  {
    phase: 1, name:'Phase 1', label:'AWAKENED',
    description:'The boss rises, full of power and malice.',
    dialogue:'You dare challenge me? Prepare for your doom, scholars!',
    thresholdMin:67, thresholdMax:100,
    color:'#EC4899', accentColor:'rgba(236,72,153,0.25)',
    glowColor:'rgba(236,72,153,0.4)',
    bgGradient:'linear-gradient(135deg,rgba(236,72,153,0.12),rgba(139,92,246,0.08))',
    icon:'💀', hpBarGradient:'linear-gradient(90deg,#EC4899,#8b5cf6)', enrageModifier:1.0,
  },
  {
    phase: 2, name:'Phase 2', label:'ENRAGED',
    description:'Wounded and furious — the boss unleashes its true power!',
    dialogue:'ENOUGH! You have pushed me too far. Now feel my WRATH!',
    thresholdMin:26, thresholdMax:66,
    color:'#f97316', accentColor:'rgba(249,115,22,0.25)',
    glowColor:'rgba(249,115,22,0.5)',
    bgGradient:'linear-gradient(135deg,rgba(249,115,22,0.15),rgba(220,38,38,0.08))',
    icon:'🔥', hpBarGradient:'linear-gradient(90deg,#f97316,#ef4444)', enrageModifier:1.2,
  },
  {
    phase: 3, name:'Phase 3', label:'DESPERATE',
    description:'On the brink of defeat — dangerous beyond measure!',
    dialogue:'I… will NOT… fall! My power is LIMITLESS! RAAAARGH!!',
    thresholdMin:0, thresholdMax:25,
    color:'#ef4444', accentColor:'rgba(239,68,68,0.3)',
    glowColor:'rgba(239,68,68,0.6)',
    bgGradient:'linear-gradient(135deg,rgba(239,68,68,0.2),rgba(127,29,29,0.12))',
    icon:'💢', hpBarGradient:'linear-gradient(90deg,#ef4444,#7f1d1d)', enrageModifier:1.5,
  },
];

// ── Session state ─────────────────────────────────────────────────────────────

window.WBP = {
  lastSeenPhase:       {},
  announcementTimeout: null,
};

// ── Core helpers ──────────────────────────────────────────────────────────────

window.wbpGetPhases = function (boss) {
  if (boss.phases && Array.isArray(boss.phases) && boss.phases.length >= 2) return boss.phases;
  return WBP_DEFAULT_PHASES;
};

window.wbpGetCurrentPhase = function (boss) {
  const hp     = Math.max(0, boss.currentHp || 0);
  const max    = Math.max(1, boss.maxHp || 1);
  const pct    = Math.floor(hp / max * 100);
  const phases = wbpGetPhases(boss);
  const sorted = [...phases].sort((a, b) => (a.phase || 0) - (b.phase || 0));
  for (const p of sorted) {
    const min    = Number.isFinite(parseFloat(p.thresholdMin)) ? parseFloat(p.thresholdMin) : 0;
    const maxPct = Number.isFinite(parseFloat(p.thresholdMax)) ? parseFloat(p.thresholdMax) : 100;
    if (pct >= min && pct <= maxPct) return p;
  }
  return [...phases].sort((a, b) => b.thresholdMin - a.thresholdMin)
    .find(p => pct >= (parseFloat(p.thresholdMin) || 0)) || phases[phases.length - 1];
};

window.wbpGetPhaseNumber = function (boss) {
  return wbpGetCurrentPhase(boss).phase;
};

window.wbpCheckPhaseChange = function (bossIdx) {
  const _db  = (DB && DB.bossEvents) ? DB : loadDB();
  const boss = _db.bossEvents[bossIdx];
  if (!boss || boss.status !== 'active') return;
  const newPhase  = wbpGetPhaseNumber(boss);
  const lastPhase = WBP.lastSeenPhase[bossIdx];
  if (_db.bossEvents[bossIdx]._currentPhaseNum !== newPhase) {
    _db.bossEvents[bossIdx]._currentPhaseNum = newPhase;
    if (_db === DB) saveDB(); else { DB = _db; saveDB(); }
  }
  if (lastPhase === undefined) { WBP.lastSeenPhase[bossIdx] = newPhase; return; }
  if (newPhase !== lastPhase) { WBP.lastSeenPhase[bossIdx] = newPhase; wbpTriggerPhaseAnnouncement(bossIdx, newPhase); }
};

// ── Phase announcement ────────────────────────────────────────────────────────
// RESTORED: the previous version replaced the original's screen-flash +
// boss-sprite-rage-shake + HP-bar-pulse + slide-in banner (non-blocking,
// shown above the combat panel) with a different full-screen modal takeover.
// Ported the original sequence verbatim, including _wbpScreenFlash,
// _wbpShowPhaseBanner, _wbpUpdateHPBarColor, and _wbpUpdatePhaseIndicator,
// none of which existed in the extracted codebase.

window.wbpTriggerPhaseAnnouncement = function (bossIdx, phaseNum) {
  const _db  = (DB && DB.bossEvents) ? DB : loadDB();
  const boss = _db.bossEvents[bossIdx]; if (!boss) return;
  const phases = wbpGetPhases(boss);
  const phase  = phases.find(p => p.phase === phaseNum) || phases[phaseNum - 1];
  if (!phase) return;

  // 1. Brief screen flash
  _wbpScreenFlash(phase.color);

  // 2. Boss sprite rage animation
  const sprite = document.getElementById('wb-boss-sprite') || document.getElementById('camp-enemy-sprite');
  if (sprite) {
    sprite.classList.add('wbp-rage');
    setTimeout(() => sprite.classList.remove('wbp-rage'), 1200);
  }

  // 3. HP bar pulse
  const fill = document.getElementById('wb-hp-fill') || document.getElementById('camp-enemy-hp');
  if (fill) {
    fill.classList.add('wbp-hp-pulse');
    setTimeout(() => fill.classList.remove('wbp-hp-pulse'), 800);
  }

  // 4. Show the phase banner (injected into page)
  _wbpShowPhaseBanner(bossIdx, phase);

  // 5. Toast announcement
  toast(`${phase.icon} <b>${boss.name}</b> has entered <b>${phase.name}!</b> — ${phase.label}`, phase.color);

  // 6. Update HP bar color immediately
  _wbpUpdateHPBarColor(bossIdx);

  // 7. Persist the current phase on the boss so the admin card reflects it
  if (!_db.bossEvents[bossIdx]._currentPhaseNum || _db.bossEvents[bossIdx]._currentPhaseNum < phaseNum) {
    _db.bossEvents[bossIdx]._currentPhaseNum = phaseNum;
    if (_db === DB) saveDB(); else { DB = _db; saveDB(); }
  }
};

// ── Animated banner that slides in above the combat panel ────────────────────
function _wbpShowPhaseBanner(bossIdx, phase) {
  const existing = document.getElementById('wbp-phase-banner');
  if (existing) existing.remove();

  const boss = DB.bossEvents[bossIdx];

  const banner = document.createElement('div');
  banner.id = 'wbp-phase-banner';
  banner.className = 'wbp-banner';
  banner.style.cssText = `--phase-color:${phase.color};--phase-bg:${phase.bgGradient};--phase-glow:${phase.glowColor};`;
  banner.innerHTML = `
    <div class="wbp-banner-inner">
      <div class="wbp-banner-left">
        <div class="wbp-banner-phase-label">PHASE TRANSITION</div>
        <div class="wbp-banner-phase-name">${phase.icon} ${phase.name.toUpperCase()} — ${phase.label}</div>
        <div class="wbp-banner-desc">${_esc(phase.description||'')}</div>
        <div class="wbp-banner-dialogue">"${_esc(phase.dialogue||'')}"<span class="wbp-banner-speaker"> — ${_esc(boss.name)}</span></div>
      </div>
      <div class="wbp-banner-right">
        <div class="wbp-banner-phase-num">${phase.phase}</div>
        <div class="wbp-banner-phase-sub">PHASE</div>
      </div>
      <button class="wbp-banner-close" onclick="this.closest('.wbp-banner').remove()" title="Dismiss">✕</button>
    </div>
    <div class="wbp-banner-scanline"></div>
  `;

  const activeBattle = document.getElementById('campaign-overlay')?.classList.contains('open') &&
    (typeof WBR !== 'undefined' ? WBR.bossIdx === bossIdx : false);
  const scene = document.getElementById('camp-scene');
  if (activeBattle && scene) {
    banner.classList.add('wbp-battle-banner');
    banner.style.cssText += `position:absolute;left:18px;right:18px;top:86px;max-width:720px;z-index:48;margin:0 auto;`;
    scene.appendChild(banner);
  } else {
    const combatArea = document.getElementById('wbc-combat-area');
    if (combatArea) {
      combatArea.parentNode.insertBefore(banner, combatArea);
    } else {
      const page = document.getElementById('s-world-boss');
      if (page) page.prepend(banner);
    }
  }

  clearTimeout(WBP.announcementTimeout);
  WBP.announcementTimeout = setTimeout(() => {
    if (banner.parentNode) {
      banner.style.animation = 'wbpBannerOut .5s ease forwards';
      setTimeout(() => banner.remove(), 500);
    }
  }, 12000);
}

// ── Screen flash overlay ──────────────────────────────────────────────────────
function _wbpScreenFlash(color) {
  const fl = document.createElement('div');
  fl.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:9998;background:${color};opacity:0;animation:wbpFlashAnim .6s ease forwards;`;
  document.body.appendChild(fl);
  setTimeout(() => fl.remove(), 700);
}

// ── Update HP bar gradient to match current phase ─────────────────────────────
function _wbpUpdateHPBarColor(bossIdx) {
  const _db  = (DB && DB.bossEvents) ? DB : loadDB();
  const boss = _db.bossEvents[bossIdx]; if (!boss) return;
  const phase = wbpGetCurrentPhase(boss);
  const fill = document.getElementById('wb-hp-fill') || document.getElementById('camp-enemy-hp');
  if (fill) fill.style.background = phase.hpBarGradient;
  const widgetFill = document.getElementById('wb-widget-hp-fill');
  if (widgetFill) widgetFill.style.background = phase.hpBarGradient;
  _wbpUpdatePhaseIndicator(bossIdx);
}

// ── Phase indicator strip shown below the HP bar ──────────────────────────────
function _wbpUpdatePhaseIndicator(bossIdx) {
  const _db  = (DB && DB.bossEvents) ? DB : loadDB();
  const boss = _db.bossEvents[bossIdx]; if (!boss) return;
  const phases  = wbpGetPhases(boss);
  const current = wbpGetCurrentPhase(boss);

  const el    = document.getElementById('wbp-phase-indicator');
  const badge = document.querySelector('.wbp-current-phase-badge');
  if (badge) {
    badge.style.setProperty('--pc', current.color);
    badge.innerHTML = `${current.icon} ${current.name.toUpperCase()} — ${current.label}`;
  }
  if (!el) return;

  el.innerHTML = phases.map(p => {
    const isActive = p.phase === current.phase;
    const isPast   = p.phase < current.phase;
    return `<div class="wbp-phase-pip ${isActive?'active':''} ${isPast?'past':''}" style="--pc:${p.color}"
      title="${_esc(p.name)} — ${p.thresholdMax}% to ${p.thresholdMin}% HP">
      <div class="wbp-phase-pip-icon">${p.icon}</div>
      <div class="wbp-phase-pip-label">${_esc(p.name)}</div>
      <div class="wbp-phase-pip-range">${p.thresholdMin}–${p.thresholdMax}%</div>
    </div>`;
  }).join('');
}

// ── Inject the phase indicator strip into the rendered page ──────────────────
function _wbpInjectPhaseIndicator(bossIdx) {
  if (document.getElementById('wbp-phase-indicator')) {
    _wbpUpdatePhaseIndicator(bossIdx);
    return;
  }
  const _db  = (DB && DB.bossEvents) ? DB : loadDB();
  const boss = _db.bossEvents[bossIdx]; if (!boss) return;
  const current = wbpGetCurrentPhase(boss);

  const wrap = document.createElement('div');
  wrap.id = 'wbp-phase-wrap';
  wrap.className = 'wbp-phase-wrap';
  wrap.innerHTML = `
    <div class="wbp-phase-header">
      <span class="material-symbols-outlined" style="font-size:14px;color:${current.color}">local_fire_department</span>
      <span class="wbp-phase-header-label">BATTLE PHASES</span>
      <span class="wbp-current-phase-badge" style="--pc:${current.color}">${current.icon} ${current.name.toUpperCase()} — ${current.label}</span>
    </div>
    <div class="wbp-phase-track" id="wbp-phase-indicator"></div>
  `;

  const hpSection = document.querySelector('.wb-hp-section');
  if (hpSection && hpSection.nextSibling) {
    hpSection.parentNode.insertBefore(wrap, hpSection.nextSibling);
  }
  _wbpUpdatePhaseIndicator(bossIdx);
}

// ── Wire phase checking into the combat loop ──────────────────────────────────
// RESTORED: without these patches wbpCheckPhaseChange() is defined but never
// actually called during gameplay, so phases never visually trigger.

;(function () {
  if (typeof _wbcUpdateHPDisplay === 'function') {
    const _orig = _wbcUpdateHPDisplay;
    _wbcUpdateHPDisplay = function (bossIdx) {
      _orig(bossIdx);
      _wbpUpdateHPBarColor(bossIdx);
      wbpCheckPhaseChange(bossIdx);
    };
    window._wbcUpdateHPDisplay = _wbcUpdateHPDisplay;
  }
})();

;(function () {
  const _orig = wbcApplyDamage;
  window.wbcApplyDamage = async function (bossIdx, damage, studentId, isCrit) {
    const result = await _orig(bossIdx, damage, studentId, isCrit);
    if (result !== 'defeated') {
      wbpCheckPhaseChange(bossIdx);
    }
    if (typeof wbrageCheckAndActivate === 'function') {
      wbrageCheckAndActivate(bossIdx);
    }
    return result;
  };
})();

;(function () {
  if (typeof renderStudentWorldBoss === 'function') {
    const _orig = renderStudentWorldBoss;
    window.renderStudentWorldBoss = function () {
      _orig();
      const found = (typeof wbcGetActiveBoss === 'function') && wbcGetActiveBoss();
      if (!found) return;
      const { boss, idx } = found;
      if (WBP.lastSeenPhase[idx] === undefined) WBP.lastSeenPhase[idx] = wbpGetPhaseNumber(boss);
      _wbpInjectPhaseIndicator(idx);
      _wbpUpdateHPBarColor(idx);
    };
  }
})();

;(function () {
  if (typeof _wbcStartLiveRefresh === 'function') {
    const _orig = _wbcStartLiveRefresh;
    window._wbcStartLiveRefresh = function () {
      _orig();
      const _wbpPoll = setInterval(() => {
        if (!WBC || !WBC.refreshInterval) { clearInterval(_wbpPoll); return; }
        const found = (typeof wbcGetActiveBoss === 'function') && wbcGetActiveBoss();
        if (!found) { clearInterval(_wbpPoll); return; }
        wbpCheckPhaseChange(found.idx);
        _wbpUpdatePhaseIndicator(found.idx);
      }, 3500);
    };
  }
})();

// ── Extend the boss admin card to show current phase and config button ───────
;(function () {
  if (typeof _bossEventCardHTML !== 'function') return;
  const _orig = _bossEventCardHTML;
  window._bossEventCardHTML = function (boss, bi) {
    const base = _orig(boss, bi);
    if (boss.status !== 'active' && boss.status !== 'draft') return base;

    const phases  = wbpGetPhases(boss);
    const current = wbpGetCurrentPhase(boss);
    const phasePips = phases.map(p => {
      const isActive = p.phase === current.phase;
      return `<div title="${_esc(p.name)}: ${p.thresholdMin}–${p.thresholdMax}% HP"
        style="width:24px;height:24px;border-radius:50%;border:2px solid ${p.color}${isActive?'':'66'};
          background:${isActive?p.color+'33':'transparent'};display:flex;align-items:center;justify-content:center;
          font-size:11px;transition:all .2s;${isActive?'box-shadow:0 0 8px '+p.color+'88':''}">${p.icon}</div>`;
    }).join('');

    const phaseStrip = `
      <div style="border-top:1px solid rgba(236,72,153,0.12);padding-top:10px;margin-top:6px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-family:var(--fm);font-size:8px;color:var(--text-muted);letter-spacing:.1em">PHASE</span>
            <div style="display:flex;gap:6px;align-items:center">${phasePips}</div>
          </div>
          <button class="btn btn-ghost btn-xs" style="border-color:rgba(249,115,22,.3);color:#f97316;font-size:10px" onclick="wbpOpenPhaseConfig(${bi})">⚡ Configure Phases</button>
        </div>
      </div>`;

    return base.replace(/(<\/div>\s*<\/div>\s*)$/, phaseStrip + '$1');
  };
})();

// ── Extend boss edit form to also surface phase config button ────────────────
;(function () {
  if (typeof openBossForm !== 'function') return;
  const _orig = openBossForm;
  window.openBossForm = function (bossIndex) {
    _orig(bossIndex);
    if (bossIndex === null || bossIndex === undefined) return;
    setTimeout(() => {
      const actions = document.querySelector('#modal-content .btn-primary');
      if (!actions) return;
      const btn = document.createElement('button');
      btn.className = 'btn btn-ghost';
      btn.style.cssText = 'border-color:rgba(249,115,22,.3);color:#f97316';
      btn.innerHTML = '⚡ Phase Config';
      btn.onclick = () => { closeModalForce(); wbpOpenPhaseConfig(bossIndex); };
      actions.parentNode.insertBefore(btn, actions);
    }, 80);
  };
})();

// ── Runtime CSS injection (flash/rage/pulse/banner/indicator keyframes) ──────
;(function () {
  const style = document.createElement('style');
  style.textContent = `
@keyframes wbpFlashAnim { 0%{opacity:0} 20%{opacity:.35} 60%{opacity:.18} 100%{opacity:0} }
@keyframes wbpRage {
  0%,100% { transform: scale(1) rotate(0deg) }
  10% { transform: scale(1.15) rotate(-6deg) } 20% { transform: scale(1.2) rotate(6deg) }
  30% { transform: scale(1.1) rotate(-5deg) } 40% { transform: scale(1.18) rotate(4deg) }
  50% { transform: scale(1.12) rotate(-3deg) } 60% { transform: scale(1.16) rotate(5deg) }
  70% { transform: scale(1.1) rotate(-2deg) } 80% { transform: scale(1.14) rotate(3deg) }
  90% { transform: scale(1.08) rotate(-1deg) }
}
.wbp-rage { animation: wbpRage 1.2s ease !important; }
@keyframes wbpHpPulse { 0%,100%{filter:brightness(1)} 40%{filter:brightness(2) saturate(1.8)} 70%{filter:brightness(1.4)} }
.wbp-hp-pulse { animation: wbpHpPulse .8s ease !important; }
@keyframes wbpBannerIn { 0%{opacity:0;transform:translateY(-24px) scale(.97)} 100%{opacity:1;transform:translateY(0) scale(1)} }
@keyframes wbpBannerOut { 0%{opacity:1;transform:translateY(0)} 100%{opacity:0;transform:translateY(-12px)} }
.wbp-banner {
  position:relative;overflow:hidden;border-radius:16px;margin-bottom:18px;
  border:1.5px solid var(--phase-color,#EC4899);
  background:var(--phase-bg,linear-gradient(135deg,rgba(236,72,153,.12),rgba(139,92,246,.08)));
  box-shadow:0 0 32px var(--phase-glow,rgba(236,72,153,.4)), 0 8px 32px rgba(0,0,0,.5);
  animation:wbpBannerIn .5s cubic-bezier(.34,1.56,.64,1) forwards;
}
.wbp-banner-inner { position:relative;z-index:2;display:flex;align-items:center;gap:20px;padding:20px 24px; }
.wbp-banner-left { flex:1;min-width:0; } .wbp-banner-right { flex-shrink:0;text-align:center;padding:0 4px; }
.wbp-banner-phase-label { font-family:var(--fm);font-size:9px;letter-spacing:.2em;color:var(--phase-color,#EC4899);margin-bottom:4px;text-transform:uppercase; }
.wbp-banner-phase-name { font-family:var(--fh);font-size:20px;font-weight:900;color:#fff;margin-bottom:6px;line-height:1.2;text-shadow:0 0 20px var(--phase-glow,rgba(236,72,153,.5)); }
.wbp-banner-desc { font-size:13px;color:rgba(255,255,255,.75);margin-bottom:8px;line-height:1.5; }
.wbp-banner-dialogue { font-style:italic;font-size:13px;color:rgba(255,255,255,.55);border-left:3px solid var(--phase-color,#EC4899);padding-left:10px;line-height:1.5; }
.wbp-banner-speaker { font-style:normal;font-size:11px;font-weight:700;color:var(--phase-color,#EC4899);margin-left:6px; }
.wbp-banner-phase-num { font-family:var(--fm);font-size:52px;font-weight:900;line-height:1;color:var(--phase-color,#EC4899);text-shadow:0 0 28px var(--phase-glow,rgba(236,72,153,.6)); }
.wbp-banner-phase-sub { font-family:var(--fm);font-size:8px;letter-spacing:.2em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-top:2px; }
.wbp-banner-close { position:absolute;top:10px;right:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:2px 8px;font-size:12px;color:rgba(255,255,255,.4);cursor:pointer;transition:all .15s;line-height:1.6; }
.wbp-banner-close:hover { background:rgba(255,255,255,.12);color:#fff; }
.wbp-banner-scanline { position:absolute;inset:0;pointer-events:none;z-index:1;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,.06) 2px,rgba(0,0,0,.06) 4px); }
.wbp-phase-wrap { margin-bottom:18px;background:rgba(20,8,40,.7);border:1px solid rgba(236,72,153,.15);border-radius:14px;padding:14px 18px;backdrop-filter:blur(10px); }
.wbp-phase-header { display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap; }
.wbp-phase-header-label { font-family:var(--fm);font-size:9px;letter-spacing:.14em;color:var(--text-muted);text-transform:uppercase;flex:1;min-width:0; }
.wbp-current-phase-badge {
  font-family:var(--fh);font-size:11px;font-weight:800;color:var(--pc,#EC4899);
  background:color-mix(in srgb, var(--pc,#EC4899) 12%, transparent);
  border:1px solid color-mix(in srgb, var(--pc,#EC4899) 35%, transparent);
  border-radius:20px;padding:3px 10px;white-space:nowrap;letter-spacing:.04em;
}
.wbp-phase-track { display:flex;gap:8px;flex-wrap:wrap; }
.wbp-phase-pip {
  flex:1;min-width:120px;border-radius:10px;padding:10px 12px;
  border:1.5px solid color-mix(in srgb, var(--pc,#EC4899) 30%, transparent);
  background:color-mix(in srgb, var(--pc,#EC4899) 5%, transparent);
  transition:all .3s;cursor:default;opacity:.45;
}
.wbp-phase-pip.active {
  opacity:1;border-color:var(--pc,#EC4899);
  background:color-mix(in srgb, var(--pc,#EC4899) 14%, transparent);
  box-shadow:0 0 16px color-mix(in srgb, var(--pc,#EC4899) 35%, transparent);
  transform:translateY(-2px);
}
.wbp-phase-pip.past { opacity:.3; }
.wbp-phase-pip-icon { font-size:20px;margin-bottom:4px;line-height:1; }
.wbp-phase-pip-label { font-family:var(--fh);font-size:12px;font-weight:800;color:var(--pc,#EC4899);margin-bottom:2px; }
.wbp-phase-pip-range { font-family:var(--fm);font-size:9px;letter-spacing:.08em;color:var(--text-muted);text-transform:uppercase; }
  `;
  document.head.appendChild(style);
})();

// ── Admin phase config modal ──────────────────────────────────────────────────

window.wbpOpenPhaseConfig = function (bossIdx) {
  DB = loadDB();
  const boss   = DB.bossEvents[bossIdx]; if (!boss) return;
  const phases = wbpGetPhases(boss);
  const rows   = phases.map((p, i) => `
  <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-left:3px solid ${p.color||'#8b5cf6'};border-radius:10px;padding:14px;margin-bottom:10px">
    <div style="display:grid;grid-template-columns:60px 1fr 1fr;gap:10px;margin-bottom:10px">
      <div><label class="form-label" style="font-size:9px">ICON</label><input type="text" id="wbp-icon-${i}" value="${_esc(p.icon||'⚡')}" style="width:100%;font-size:18px;text-align:center"></div>
      <div><label class="form-label" style="font-size:9px">LABEL</label><input type="text" id="wbp-label-${i}" value="${_esc(p.label||'Phase '+(i+1))}" style="width:100%"></div>
      <div><label class="form-label" style="font-size:9px">COLOR</label><div style="display:flex;gap:6px;align-items:center"><input type="color" value="${p.color||'#8b5cf6'}" id="wbp-color-${i}" style="width:36px;height:28px;border:none;border-radius:6px;cursor:pointer"><input type="text" id="wbp-colorhex-${i}" value="${p.color||'#8b5cf6'}" style="flex:1;font-family:monospace;font-size:11px" oninput="document.getElementById('wbp-color-${i}').value=this.value"></div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <div><label class="form-label" style="font-size:9px">HP% MIN (activates below)</label><input type="number" id="wbp-min-${i}" value="${p.thresholdMin??0}" min="0" max="100" style="width:100%"></div>
      <div><label class="form-label" style="font-size:9px">HP% MAX</label><input type="number" id="wbp-max-${i}" value="${p.thresholdMax??100}" min="0" max="100" style="width:100%"></div>
    </div>
    <div class="form-group" style="margin-bottom:8px"><label class="form-label" style="font-size:9px">DESCRIPTION</label><input type="text" id="wbp-desc-${i}" value="${_esc(p.description||'')}" style="width:100%"></div>
    <div class="form-group" style="margin-bottom:0"><label class="form-label" style="font-size:9px">BOSS DIALOGUE</label><input type="text" id="wbp-dlg-${i}" value="${_esc(p.dialogue||'')}" placeholder="What the boss says when this phase activates..." style="width:100%"></div>
  </div>`).join('');

  showModal(`<div>
    <div class="modal-h2" style="margin-bottom:14px">⚡ Phase Configuration — ${_esc(boss.name)}</div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">Configure ${phases.length} boss phases. Each phase activates when HP% enters its range. Announcements and visual themes apply automatically.</div>
    ${rows}
    <div style="display:flex;gap:10px;margin-top:4px">
      <button class="btn btn-ghost btn-sm" onclick="wbpResetPhasesToDefault(${bossIdx})">↺ Reset Defaults</button>
    </div>
    <div style="display:flex;gap:10px;margin-top:12px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" style="flex:1" onclick="wbpSavePhaseConfig(${bossIdx})">Save Phases</button>
    </div>
  </div>`, 'lg');
};

window.wbpSavePhaseConfig = function (bossIdx) {
  DB = loadDB();
  const boss   = DB.bossEvents[bossIdx]; if (!boss) return;
  const phases = wbpGetPhases(boss);
  boss.phases  = phases.map((p, i) => ({
    ...p,
    icon:         document.getElementById(`wbp-icon-${i}`)?.value.trim()    || p.icon,
    label:        document.getElementById(`wbp-label-${i}`)?.value.trim()   || p.label,
    color:        document.getElementById(`wbp-color-${i}`)?.value          || p.color,
    thresholdMin: parseInt(document.getElementById(`wbp-min-${i}`)?.value)  ?? p.thresholdMin,
    thresholdMax: parseInt(document.getElementById(`wbp-max-${i}`)?.value)  ?? p.thresholdMax,
    description:  document.getElementById(`wbp-desc-${i}`)?.value.trim()   || '',
    dialogue:     document.getElementById(`wbp-dlg-${i}`)?.value.trim()    || '',
  }));
  saveDB(); closeModalForce(); toast('✅ Phase config saved!'); renderAdminBossEvents();
};

window.wbpResetPhasesToDefault = function (bossIdx) {
  if (!confirm('Reset phases to defaults?')) return;
  DB = loadDB();
  DB.bossEvents[bossIdx].phases = null;
  saveDB(); closeModalForce(); toast('↺ Phases reset to defaults.'); renderAdminBossEvents();
};
