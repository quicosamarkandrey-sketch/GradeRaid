// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/campaign/stage-map.js
//  Stage Map overlay: open/close, header fill, world tabs, stage grid render.
//  LOAD AFTER: engine.js
// ═══════════════════════════════════════════════════════════════════════════════

// Module-level state
let stageMapOpen = false;
let activeWorld  = 0;

// ── Overlay open / close ──────────────────────────────────────────────────────

window.openStageMap = function () {
  const overlay = document.getElementById('stage-map-overlay');
  if (!overlay) return;
  
  overlay.classList.add('open'); // The CSS transition handles the rest
  stageMapOpen = true;
  
  const dot = document.getElementById('stage-notif');
  if (dot) dot.style.display = 'none';
  
  _fillStageMapHeader();
  renderWorldTabs();
  renderStageMap(activeWorld);
};

window.closeStageMap = function () {
  const overlay = document.getElementById('stage-map-overlay');
  if (overlay) overlay.classList.remove('open');
  stageMapOpen = false;
};

// ── Header fill ───────────────────────────────────────────────────────────────

function _fillStageMapHeader() {
  const st    = currentRole === 'student' ? currentUser : null;
  const av    = document.getElementById('smap-av');
  const nameEl = document.getElementById('smap-name');
  const tierEl = document.getElementById('smap-tier');
  const doneEl = document.getElementById('smap-stages-done');
  const bar    = document.getElementById('smap-prog-bar');
  if (!av) return;
  if (st) {
    av.textContent         = st.init;
    av.style.background    = st.color + '33';
    av.style.borderColor   = st.color + '88';
    av.style.color         = st.color;
    if (nameEl) nameEl.textContent = st.name;
    if (tierEl) tierEl.textContent = 'LVL ' + st.level + ' // ' + (st.tier || 'Scholar').toUpperCase();
    const p = getMapProgress();
    if (doneEl) doneEl.textContent = p.cleared + '/' + p.total;
    if (bar)    bar.style.width    = Math.round(p.cleared / Math.max(1, p.total) * 100) + '%';
  } else {
    av.textContent = '🛡';
    if (nameEl) nameEl.textContent = currentUser?.name || 'Admin';
    if (tierEl) tierEl.textContent = 'ADMIN // OVERVIEW';
    const total = (DB.stageMap || []).reduce((a, w) => a + w.stages.length, 0);
    if (doneEl) doneEl.textContent = total + ' TOTAL';
    if (bar)    bar.style.width    = '100%';
  }
}

// ── World tabs ────────────────────────────────────────────────────────────────

window.renderWorldTabs = function () {
  DB = loadDB();
  const tabs   = document.getElementById('world-tabs-sm');
  if (!tabs) return;
  // Phase 53: section-scoped for students — see getVisibleCampaignWorlds()
  // in campaign_engine.js.
  const worlds = (typeof getVisibleCampaignWorlds === 'function') ? getVisibleCampaignWorlds() : (DB.stageMap || []);
  tabs.innerHTML = worlds.map((w, i) =>
    `<button class="world-tab ${i === activeWorld ? 'active' : ''}"
      onclick="switchWorld(${i})"
      style="${i === activeWorld ? 'color:' + w.color + ';border-bottom-color:' + w.color : ''}">
      ${w.icon} ${_esc(w.label)}
    </button>`
  ).join('');
};

window.switchWorld = function (idx) {
  activeWorld = idx;
  renderWorldTabs();
  renderStageMap(idx);
};

// ── Stage grid renderer ───────────────────────────────────────────────────────

window.renderStageMap = function (worldIdx) {
  DB = loadDB();
  // Phase 53: section-scoped for students — see getVisibleCampaignWorlds()
  // in campaign_engine.js.
  const worlds = (typeof getVisibleCampaignWorlds === 'function') ? getVisibleCampaignWorlds() : (DB.stageMap || []);
  const body   = document.getElementById('smap-body');
  if (!body) return;
  if (!worlds.length) {
    body.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-muted)">No worlds yet. Ask your instructor to create stages!</div>';
    return;
  }

  const world    = worlds[Math.min(worldIdx, worlds.length - 1)];
  const positions = ['left', 'right', 'center', 'left', 'right', 'center'];
  const allStages = [];
  worlds.forEach(w => w.stages.forEach(s => allStages.push(s)));
  const prog = getMapProgress();

  let html = `<div style="text-align:center;margin-bottom:24px">
    <div style="font-family:var(--fm);font-size:9px;color:${world.color};letter-spacing:.16em;margin-bottom:6px">[WORLD_0${worldIdx + 1}]</div>
    <div style="font-family:var(--fh);font-size:20px;font-weight:900;color:var(--on-surface);margin-bottom:4px">${world.icon} ${_esc(world.label)}</div>
    <div style="font-size:13px;color:var(--text-muted)">${_esc(world.desc)}</div>
  </div><div class="stage-path">`;

  world.stages.forEach((stage, i) => {
    const isCleared = isStageCleared(stage.id);
    const isActive  = prog.activeId === stage.id;
    const isBoss    = stage.type === 'boss';
    const isLocked  = !isCleared && !isActive;
    const pos       = isBoss ? 'center' : positions[i % positions.length];

    let nodeClass = 'stage-node' + (isCleared ? ' completed' : isActive ? ' active' : ' locked') + (isBoss ? ' boss' : '');
    let statusBadge = isCleared
      ? `<span style="font-family:var(--fm);font-size:9px;font-weight:700;color:var(--secondary);background:rgba(78,222,163,.12);border:1px solid rgba(78,222,163,.25);padding:2px 8px;border-radius:4px">✓ CLEARED</span>`
      : isActive
        ? `<span style="font-family:var(--fm);font-size:9px;font-weight:700;color:var(--primary);background:rgba(208,188,255,.12);border:1px solid rgba(208,188,255,.3);padding:2px 8px;border-radius:4px">▶ CURRENT</span>`
        : `<span style="font-family:var(--fm);font-size:9px;color:var(--text-muted);background:rgba(255,255,255,.04);border:1px solid var(--border);padding:2px 8px;border-radius:4px">🔒 ${isBoss ? 'BOSS ' : ''}LOCKED</span>`;

    let connector = '';
    if (i > 0) {
      const prevCleared = isStageCleared(world.stages[i - 1].id);
      connector = `<div class="stage-connector${isLocked ? ' locked-dots' : ''}" style="--from-color:${prevCleared ? world.color : 'rgba(255,255,255,.08)'};--to-color:${isCleared ? world.color : isActive ? '#8b5cf6' : 'rgba(255,255,255,.08)'}"></div>`;
    }

    const btn = (isActive || isCleared) ? `<button onclick="event.stopPropagation();launchCampaignStage('${world.id}','${stage.id}')"
      style="background:${isBoss ? 'linear-gradient(135deg,#f59e0b,#ef4444)' : 'linear-gradient(135deg,#8b5cf6,#6d28d9)'};border:none;color:#fff;padding:6px 14px;border-radius:8px;font-family:var(--fb);font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px ${isBoss ? 'rgba(245,158,11,.4)' : 'rgba(109,40,217,.4)'}">
      ${isCleared ? '⟳ Replay' : '▶ Play'}
    </button>` : '';

    html += `${connector}
    <div class="stage-row ${pos}">
      <div class="${nodeClass}" onclick="${isLocked ? 'lockedStageClick()' : `launchCampaignStage('${world.id}','${stage.id}')`}">
        <div class="stage-num">${i + 1}</div>
        <div style="display:flex;align-items:center;gap:12px">
          <div class="node-icon-ring">${stage.icon}</div>
          <div style="flex:1;min-width:0">
            <div style="font-family:var(--fh);font-size:14px;font-weight:800;line-height:1.2;margin-bottom:4px;color:var(--on-surface)">${_esc(stage.title)}</div>
            ${statusBadge}
            ${!isLocked ? `<div style="font-size:10px;color:var(--text-muted);margin-top:3px">${Array(stage.lives || 3).fill('❤️').join('')} ${stage.lives || 3} lives</div>` : ''}
          </div>
        </div>
        ${!isLocked ? `<div style="margin-top:10px;font-size:11px;color:var(--text-muted);line-height:1.4">${_esc(((stage.scenes || [])[0] || {}).text?.substring(0, 80) || stage.title)}</div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
          <div style="font-family:var(--fm);font-size:10px;color:${world.color}">${isLocked ? '???' : '+' + stage.xp + ' XP · 🪙' + stage.coins}</div>
          ${btn}
        </div>
      </div>
    </div>`;
  });

  html += `</div><div style="text-align:center;margin-top:28px;padding:16px;border-top:1px solid rgba(255,255,255,.05)">
    <div style="font-family:var(--fm);font-size:9px;color:var(--text-muted);letter-spacing:.1em">// CLEAR ALL STAGES TO UNLOCK THE NEXT WORLD</div>
  </div>`;
  body.innerHTML = html;
  body.scrollTo({ top: 0, behavior: 'smooth' });
};

window.lockedStageClick = function () {
  toast('🔒 Clear previous stages first to unlock this one!', '#ffb95f');
};

// ── Overlay event listeners ───────────────────────────────────────────────────
// These must be deferred until the DOM is ready.
;(function attachStageMapListeners() {
  function attach() {
    const overlay = document.getElementById('stage-map-overlay');
    if (!overlay) { setTimeout(attach, 200); return; }
    overlay.addEventListener('click', function (e) { if (e.target === this) closeStageMap(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
  else attach();
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && stageMapOpen) closeStageMap(); });
})();

console.log('[EduQuest] campaign/stage-map.js loaded — openStageMap, closeStageMap, renderStageMap, switchWorld registered.');
