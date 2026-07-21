// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/world-boss/rage.js
//  World Boss Rage Mode: visual effects, HP monitoring, spawn/skill acceleration,
//  admin config, and patch IIFEs (renderStudentWorldBoss, bossActivate, wbsStopSkillLoop).
//  LOAD AFTER: combat-settings.js, loot-rain.js, skills.js, phases.js
// ═══════════════════════════════════════════════════════════════════════════════

// ── Runtime state ─────────────────────────────────────────────────────────────

window.WBRAGE = {
  activated:       {},
  auraEl:          null,
  rageSkillTimer:  null,
  _rageSpawnMult:  null,
  _rageSpawnBossIdx: null,
};

// ── Settings ──────────────────────────────────────────────────────────────────

window.wbrageDefaults = function () {
  return {
    enabled:          true,
    thresholdPct:     25,
    dialogue:         'You dare bring me this low?! NOW I SHOW YOU TRUE POWER!! RAAAARGH!!!',
    spawnMultiplier:  2.0,
    skillMultiplier:  2.5,
    showAura:         true,
    showBanner:       true,
    showToast:        true,
  };
};

window.wbrageSettings = function (boss) {
  return Object.assign({}, wbrageDefaults(), (boss && boss.rageSettings) || {});
};

window.wbrageIsActive = function (boss) {
  if (!boss || boss.status !== 'active') return false;
  const cfg = wbrageSettings(boss);
  if (!cfg.enabled) return false;
  const pct = Math.max(0, boss.currentHp || 0) / Math.max(1, boss.maxHp || 1) * 100;
  return pct <= cfg.thresholdPct && pct > 0;
};

// ── Visual effects ────────────────────────────────────────────────────────────

function _wbrageShowAura() {
  if (document.getElementById('wbrage-aura')) return;
  const el = document.createElement('div');
  el.id = 'wbrage-aura';
  el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9960;background:radial-gradient(ellipse at center,transparent 40%,rgba(239,68,68,0.18) 100%);animation:wbrage-aura-pulse 1.6s ease-in-out infinite';
  document.body.appendChild(el);
  WBRAGE.auraEl = el;
}

function _wbrageRemoveAura() {
  const el = document.getElementById('wbrage-aura');
  if (el) { el.remove(); WBRAGE.auraEl = null; }
}

function _wbrageScreenFlash() {
  const flash = document.createElement('div');
  flash.style.cssText = 'position:fixed;inset:0;background:rgba(239,68,68,0.35);pointer-events:none;z-index:9995;animation:wbrage-flash .5s ease-out forwards';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 550);
}

function _wbrageShowBanner(bossIdx) {
  document.getElementById('wbrage-banner')?.remove();
  const DB2  = loadDB();
  const boss = DB2.bossEvents[bossIdx];
  const cfg  = wbrageSettings(boss);
  const art  = typeof bveRenderCompactArt === 'function' ? bveRenderCompactArt(boss, 44) : '';
  const el   = document.createElement('div');
  el.id      = 'wbrage-banner';
  el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9992;padding:16px 24px;background:linear-gradient(135deg,rgba(127,29,29,0.97),rgba(154,52,18,0.95));border-bottom:2px solid rgba(239,68,68,0.6);display:flex;align-items:center;gap:16px;animation:wbrage-banner-in .5s cubic-bezier(.34,1.56,.64,1) forwards;box-shadow:0 4px 40px rgba(239,68,68,0.5)';
  el.innerHTML = `
    <div style="width:48px;height:48px;display:flex;align-items:center;justify-content:center;animation:achBadgePulse 1.4s ease-in-out infinite;font-size:28px">${art || '🔥'}</div>
    <div style="flex:1">
      <div style="font-family:var(--fm);font-size:9px;color:#fca5a5;letter-spacing:.22em;margin-bottom:3px">⚠️ RAGE MODE ACTIVATED</div>
      <div style="font-family:var(--fh);font-size:16px;font-weight:900;color:#fff;margin-bottom:3px">${_esc(boss.name)} has entered RAGE!</div>
      ${cfg.dialogue ? `<div style="font-size:11px;color:rgba(255,255,255,.7);font-style:italic">"${_esc(cfg.dialogue)}"</div>` : ''}
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0">
      <div style="font-family:var(--fm);font-size:8px;color:#fca5a5;letter-spacing:.1em">ATTACKS ×${parseFloat(cfg.skillMultiplier||2.5).toFixed(1)}</div>
      <div style="font-family:var(--fm);font-size:8px;color:#fed7aa;letter-spacing:.1em">SPAWNS ×${parseFloat(cfg.spawnMultiplier||2.0).toFixed(1)}</div>
    </div>
    <button onclick="document.getElementById('wbrage-banner')?.remove()" style="background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;font-family:var(--fb);font-size:11px">×</button>`;
  document.body.appendChild(el);
  setTimeout(() => {
    const b = document.getElementById('wbrage-banner');
    if (b) { b.style.animation = 'wbrage-banner-out .4s ease forwards'; setTimeout(() => b?.remove(), 420); }
  }, 5000);
}

function _wbrageShowPersistentToast(bossName) {
  if (document.getElementById('wbrage-toast')) return;
  const t = document.createElement('div');
  t.id    = 'wbrage-toast';
  t.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9991;background:rgba(127,29,29,0.96);border:1.5px solid rgba(239,68,68,0.6);border-radius:12px;padding:8px 14px;display:flex;align-items:center;gap:8px;box-shadow:0 4px 24px rgba(239,68,68,0.4);animation:wbs-toast-in .3s ease forwards;backdrop-filter:blur(12px)';
  t.innerHTML = `<div style="font-size:18px;animation:achBadgePulse 1.4s ease-in-out infinite">🔥</div><div><div style="font-family:var(--fh);font-size:11px;font-weight:900;color:#fca5a5;letter-spacing:.06em">RAGE MODE ACTIVE</div><div style="font-size:10px;color:rgba(255,255,255,.6)">${_esc(bossName)}</div></div>`;
  document.body.appendChild(t);
}

function _wbrageRemovePersistentToast() {
  const t = document.getElementById('wbrage-toast');
  if (t) { t.style.animation = 'wbs-toast-out .3s ease forwards'; setTimeout(() => t.remove(), 350); }
}

function _wbrageStartSkillLoop(bossIdx) {
  _wbrageStopSkillLoop();
  const DB2  = loadDB();
  const boss = DB2.bossEvents[bossIdx]; if (!boss) return;
  const cfg  = wbrageSettings(boss);
  const mul  = Math.max(1.1, parseFloat(cfg.skillMultiplier) || 2.5);
  const base = Math.max(5, (parseInt(boss.skillIntervalMin) || 15) / mul);
  const max2 = Math.max(base + 2, (parseInt(boss.skillIntervalMax) || 35) / mul);
  function _tick() {
    if (!WBRAGE.activated[bossIdx]) return;
    DB = loadDB();
    const b2 = DB.bossEvents[bossIdx];
    if (!b2 || b2.status !== 'active' || !wbrageIsActive(b2)) { _wbrageStopSkillLoop(); return; }
    const skill = wbsPickSkill(bossIdx);
    if (skill) wbsFireSkill(bossIdx, skill.id);
    WBRAGE.rageSkillTimer = setTimeout(_tick, (base + Math.random() * (max2 - base)) * 1000);
  }
  WBRAGE.rageSkillTimer = setTimeout(_tick, base * 1000);
}

function _wbrageStopSkillLoop() {
  if (WBRAGE.rageSkillTimer) { clearTimeout(WBRAGE.rageSkillTimer); WBRAGE.rageSkillTimer = null; }
}

function _wbrageAccelerateSpawns(bossIdx) {
  const DB2  = loadDB();
  const boss = DB2.bossEvents[bossIdx]; if (!boss) return;
  const cfg  = wbrageSettings(boss);
  WBRAGE._rageSpawnMult     = parseFloat(cfg.spawnMultiplier) || 2.0;
  WBRAGE._rageSpawnBossIdx  = bossIdx;
  if (typeof wbmStopSpawnLoop === 'function') {
    wbmStopSpawnLoop();
    setTimeout(() => { if (typeof wbmStartSpawnLoop === 'function') wbmStartSpawnLoop(bossIdx); }, 100);
  }
}

function _wbrageCleanupVisuals() {
  _wbrageRemoveAura();
  _wbrageRemovePersistentToast();
  _wbrageStopSkillLoop();
  WBRAGE._rageSpawnMult     = null;
  WBRAGE._rageSpawnBossIdx  = null;
  const hpFill = document.getElementById('wb-hp-fill') || document.getElementById('camp-enemy-hp');
  if (hpFill) hpFill.classList.remove('wbrage-hp');
}

// ── Main check-and-activate ───────────────────────────────────────────────────

window.wbrageCheckAndActivate = function (bossIdx) {
  DB = loadDB();
  const boss = DB.bossEvents[bossIdx]; if (!boss) return;
  const isActive = wbrageIsActive(boss);
  if (!isActive) {
    if (WBRAGE.activated[bossIdx]) { delete WBRAGE.activated[bossIdx]; _wbrageCleanupVisuals(); }
    return;
  }
  if (WBRAGE.activated[bossIdx]) {
    const cfg = wbrageSettings(boss);
    if (cfg.showAura  && !document.getElementById('wbrage-aura'))  _wbrageShowAura();
    if (cfg.showToast && !document.getElementById('wbrage-toast')) _wbrageShowPersistentToast(boss.name);
    const hpFill = document.getElementById('wb-hp-fill') || document.getElementById('camp-enemy-hp');
    if (hpFill) hpFill.classList.add('wbrage-hp');
    return;
  }
  WBRAGE.activated[bossIdx] = true;
  const cfg = wbrageSettings(boss);
  _wbrageScreenFlash();
  if (cfg.showAura)   _wbrageShowAura();
  if (cfg.showBanner) _wbrageShowBanner(bossIdx);
  if (cfg.showToast)  _wbrageShowPersistentToast(boss.name);
  const sprite = document.getElementById('wb-boss-sprite') || document.getElementById('camp-enemy-sprite');
  if (sprite) { sprite.style.animation = 'wbrage-boss-shake .2s linear 8'; setTimeout(() => { if (sprite) sprite.style.animation = ''; }, 1700); }
  const hpFill = document.getElementById('wb-hp-fill') || document.getElementById('camp-enemy-hp');
  if (hpFill) { hpFill.style.setProperty('--rage-glow','1'); hpFill.classList.add('wbrage-hp'); }
  _wbrageAccelerateSpawns(bossIdx);
  _wbrageStartSkillLoop(bossIdx);
  toast(`🔥 <b>${boss.name}</b> has entered <b>RAGE MODE!</b>`, '#ef4444');
};

window.wbrageReset = function (bossIdx) {
  delete WBRAGE.activated[bossIdx];
  _wbrageCleanupVisuals();
};

// ── Patch IIFEs ───────────────────────────────────────────────────────────────

// renderStudentWorldBoss → rage check after every render
;(function () {
  const _orig = window.renderStudentWorldBoss;
  window.renderStudentWorldBoss = function () {
    if (typeof _orig === 'function') _orig();
    if (currentRole !== 'student') return;
    const found = typeof wbcGetActiveBoss === 'function' ? wbcGetActiveBoss() : null;
    if (found && found.boss && found.boss.status === 'active') {
      wbrageCheckAndActivate(found.idx);
    } else {
      const keys = Object.keys(WBRAGE.activated);
      if (keys.length) { keys.forEach(idx => { delete WBRAGE.activated[idx]; }); _wbrageCleanupVisuals(); }
    }
  };
})();

// bossActivate → reset rage state before reactivation
;(function () {
  const _orig = window.bossActivate;
  window.bossActivate = function (bi) {
    wbrageReset(bi);
    if (typeof _orig === 'function') _orig(bi);
  };
})();

// wbsStopSkillLoop → also stop rage skill loop + reset spawn multiplier
;(function () {
  const _orig = window.wbsStopSkillLoop;
  window.wbsStopSkillLoop = function () {
    if (typeof _orig === 'function') _orig();
    _wbrageStopSkillLoop();
    WBRAGE._rageSpawnMult    = null;
    WBRAGE._rageSpawnBossIdx = null;
  };
})();

// ── Admin config modal ────────────────────────────────────────────────────────

window.wbrageOpenConfig = function (bossIdx) {
  DB = loadDB();
  const boss = DB.bossEvents[bossIdx]; if (!boss) return;
  const cfg  = wbrageSettings(boss);
  showModal(`<div>
    <div class="modal-h2" style="margin-bottom:14px">🔥 Rage Mode — ${_esc(boss.name)}</div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
        <input type="checkbox" id="wbr-enabled" ${cfg.enabled?'checked':''} style="width:16px;height:16px"> Enable Rage Mode
      </label>
    </div>
    <div class="form-group"><label class="form-label">HP Threshold % (triggers below this)</label>
      <input type="range" id="wbr-threshold" min="1" max="49" value="${cfg.thresholdPct||25}" style="width:100%" oninput="document.getElementById('wbr-thresh-val').textContent=this.value+'%'">
      <div style="text-align:center;font-family:var(--fh);font-size:18px;font-weight:900;color:#ef4444;margin-top:4px" id="wbr-thresh-val">${cfg.thresholdPct||25}%</div>
    </div>
    <div class="form-group"><label class="form-label">Boss Dialogue (on rage activation)</label>
      <textarea id="wbr-dialogue" style="width:100%;min-height:60px;resize:vertical">${_esc(cfg.dialogue||'')}</textarea>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div><label class="form-label">Spawn Speed ×</label><input type="number" id="wbr-spawn-mul" value="${cfg.spawnMultiplier||2.0}" min="1" max="10" step="0.1" style="width:100%"></div>
      <div><label class="form-label">Skill Speed ×</label><input type="number" id="wbr-skill-mul" value="${cfg.skillMultiplier||2.5}" min="1" max="10" step="0.1" style="width:100%"></div>
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px">
      ${[['wbr-aura','showAura','Red Aura Overlay',cfg.showAura],['wbr-banner','showBanner','Rage Banner',cfg.showBanner],['wbr-toast','showToast','Persistent Toast',cfg.showToast]].map(([id,k,lbl,val])=>`<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px"><input type="checkbox" id="${id}" ${val?'checked':''} style="width:14px;height:14px"> ${lbl}</label>`).join('')}
    </div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" style="flex:1" onclick="wbrageAdminSave(${bossIdx})">Save Rage Config</button>
    </div>
  </div>`, 'md');
};

window.wbrageAdminSave = function (bossIdx) {
  DB = loadDB();
  const boss = DB.bossEvents[bossIdx]; if (!boss) return;
  boss.rageSettings = {
    enabled:         document.getElementById('wbr-enabled')?.checked ?? true,
    thresholdPct:    parseInt(document.getElementById('wbr-threshold')?.value) || 25,
    dialogue:        (document.getElementById('wbr-dialogue')?.value || '').trim(),
    spawnMultiplier: parseFloat(document.getElementById('wbr-spawn-mul')?.value) || 2.0,
    skillMultiplier: parseFloat(document.getElementById('wbr-skill-mul')?.value) || 2.5,
    showAura:        document.getElementById('wbr-aura')?.checked    ?? true,
    showBanner:      document.getElementById('wbr-banner')?.checked  ?? true,
    showToast:       document.getElementById('wbr-toast')?.checked   ?? true,
  };
  saveDB(); closeModalForce();
  toast('✅ Rage config saved!', '#ef4444');
  renderAdminBossEvents();
};

// ── Inject "🔥 Rage Mode" button into admin boss card ─────────────────────────
// RESTORED: wbrageOpenConfig() was defined but never called from anywhere —
// there was no button anywhere in the admin UI to open the Rage Mode config.

;(function () {
  if (typeof _bossEventCardHTML !== 'function') return;
  const _orig = _bossEventCardHTML;
  window._bossEventCardHTML = function (boss, bi) {
    const base = _orig(boss, bi);
    if (boss.status !== 'active' && boss.status !== 'draft') return base;

    const cfg = wbrageSettings(boss);
    const statusLabel = cfg.enabled
      ? `<span style="color:#ef4444;font-size:10px;font-weight:800">ON · ≤${cfg.thresholdPct}%</span>`
      : `<span style="color:var(--text-muted);font-size:10px">Off</span>`;

    const rageStrip = `
      <div style="border-top:1px solid rgba(239,68,68,0.12);padding-top:10px;margin-top:6px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-family:var(--fm);font-size:8px;color:var(--text-muted);letter-spacing:.1em">RAGE</span>
            <span style="font-size:14px;opacity:${cfg.enabled?'1':'0.3'}">🔥</span>
            ${statusLabel}
          </div>
          <button class="btn btn-ghost btn-xs" style="border-color:rgba(239,68,68,.3);color:#ef4444;font-size:10px" onclick="wbrageOpenConfig(${bi})">🔥 Rage Mode</button>
        </div>
      </div>`;

    return base.replace(/(<\/div>\s*<\/div>\s*)$/, rageStrip + '$1');
  };
})();

// ── Surface the rage button inside the boss edit form too ────────────────────
;(function () {
  if (typeof openBossForm !== 'function') return;
  const _orig = openBossForm;
  window.openBossForm = function (bossIndex) {
    _orig(bossIndex);
    if (bossIndex === null || bossIndex === undefined) return;
    setTimeout(() => {
      if (document.getElementById('wbrage-form-btn')) return;
      const anchor = document.getElementById('wbs-form-btn') || document.querySelector('#modal-content .btn-primary');
      if (!anchor) return;
      const btn = document.createElement('button');
      btn.id = 'wbrage-form-btn';
      btn.className = 'btn btn-ghost';
      btn.style.cssText = 'border-color:rgba(239,68,68,.3);color:#ef4444';
      btn.innerHTML = '🔥 Rage';
      btn.onclick = () => { closeModalForce(); wbrageOpenConfig(bossIndex); };
      anchor.parentNode.insertBefore(btn, anchor);
    }, 100);
  };
})();

// ── Runtime CSS injection ──────────────────────────────────────────────────────
// RESTORED: _wbrageShowAura/_wbrageScreenFlash/_wbrageShowBanner/
// wbrageCheckAndActivate above all reference @keyframes and a .wbrage-hp class
// that were never defined anywhere in the extracted codebase or stylesheet —
// the aura pulse, screen flash, banner slide, boss shake, and HP bar glow
// would all silently fail to animate. Ported verbatim from the original.

;(function () {
  const style = document.createElement('style');
  style.textContent = `
@keyframes wbrage-aura-pulse { 0%,100% { opacity:.55; } 50% { opacity:1; } }
@keyframes wbrage-flash { 0% { opacity:1; } 60% { opacity:.5; } 100% { opacity:0; } }
@keyframes wbrage-boss-shake {
  0%,100% { transform:translate(0,0); }
  25%     { transform:translate(-4px, 2px); }
  50%     { transform:translate(4px,-2px); }
  75%     { transform:translate(-2px, 3px); }
}
@keyframes wbrage-banner-in { from { transform:translateY(-110%); opacity:0; } to { transform:translateY(0); opacity:1; } }
@keyframes wbrage-banner-out { from { transform:translateY(0); opacity:1; } to { transform:translateY(-110%); opacity:0; } }
@keyframes wbrage-scanline { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
@keyframes wbrage-toast-in { from { opacity:0; transform:translateX(30px) scale(.95); } to { opacity:1; transform:translateX(0) scale(1); } }
@keyframes wbrage-toast-out { from { opacity:1; transform:translateX(0) scale(1); } to { opacity:0; transform:translateX(30px) scale(.95); } }
.wbrage-hp {
  box-shadow: 0 0 16px rgba(239,68,68,.7), 0 0 4px rgba(239,68,68,.9) !important;
  background: linear-gradient(90deg,#dc2626,#ef4444,#fca5a5) !important;
}
  `;
  document.head.appendChild(style);
})();
