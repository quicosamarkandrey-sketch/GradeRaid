// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/world-boss/skills.js
//  World Boss Skills: 6 built-in skill effects, random fire loop, admin config.
//  LOAD AFTER: combat-settings.js, loot-rain.js
// ═══════════════════════════════════════════════════════════════════════════════

// ── Runtime state ─────────────────────────────────────────────────────────────

window.WBS = {
  activeSkills:   {},
  skillCooldowns: {},
  loopTimer:      null,
  lastPhase:      null,
  currentBossIdx: null,
};

// ── Skill defaults ────────────────────────────────────────────────────────────

window.WBS_SKILL_DEFAULTS = {
  earthquake:   { id:'earthquake',   name:'Earthquake',    emoji:'🌋', desc:'Screen shakes violently.',                  enabled:true, durationSec:4, cooldownSec:45, triggerPhase:'any' },
  chaos_wind:   { id:'chaos_wind',   name:'Chaos Wind',    emoji:'🌪️', desc:'Answer choices drift horizontally.',        enabled:true, durationSec:8, cooldownSec:50, triggerPhase:'any', windSpeed:'medium' },
  darkness:     { id:'darkness',     name:'Darkness',      emoji:'🌑', desc:'Background dims. Question area stays lit.', enabled:true, durationSec:7, cooldownSec:40, triggerPhase:'any' },
  mirror_trick: { id:'mirror_trick', name:'Mirror Trick',  emoji:'🪞', desc:'Answer choices are randomly reordered.',    enabled:true, durationSec:0, cooldownSec:60, triggerPhase:'any' },
  berserk_roar: { id:'berserk_roar', name:'Berserk Roar',  emoji:'😤', desc:'Answer buttons vibrate briefly.',           enabled:true, durationSec:3, cooldownSec:35, triggerPhase:'any' },
  meteor_shower:{ id:'meteor_shower',name:'Meteor Shower', emoji:'☄️', desc:'Cosmetic meteor animation.',                enabled:true, durationSec:6, cooldownSec:55, triggerPhase:'any' },
};

// ── Core helpers ──────────────────────────────────────────────────────────────

window.wbsGetSkills = function (boss) {
  const stored = (boss && boss.skills) || {};
  const result = {};
  for (const [id, def] of Object.entries(WBS_SKILL_DEFAULTS)) {
    result[id] = Object.assign({}, def, stored[id] || {});
  }
  return result;
};

window.wbsOnCooldown = function (bossIdx, skillId) {
  return (WBS.skillCooldowns[bossIdx + '_' + skillId] || 0) > Date.now();
};

window.wbsStartCooldown = function (bossIdx, skillId, cooldownSec) {
  WBS.skillCooldowns[bossIdx + '_' + skillId] = Date.now() + cooldownSec * 1000;
};

window.wbsPickSkill = function (bossIdx) {
  DB = loadDB();
  const boss   = DB.bossEvents[bossIdx]; if (!boss) return null;
  const skills = wbsGetSkills(boss);
  const phase  = typeof wbpGetPhaseNumber === 'function' ? wbpGetPhaseNumber(boss) : 1;
  const candidates = Object.values(skills).filter(sk =>
    sk.enabled && !wbsOnCooldown(bossIdx, sk.id) &&
    (sk.triggerPhase === 'any' || parseInt(sk.triggerPhase) === phase)
  );
  return candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : null;
};

// ── Skill toast ───────────────────────────────────────────────────────────────

function _wbsSkillToast(emoji, label, color, dur) {
  const old = document.getElementById('wbs-skill-toast'); if (old) old.remove();
  const el  = document.createElement('div');
  el.id     = 'wbs-skill-toast';
  el.innerHTML = `<span style="font-size:20px">${emoji}</span><div><div style="font-family:var(--fh);font-size:11px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:${color}">BOSS SKILL</div><div style="font-family:var(--fh);font-size:15px;font-weight:900;color:#fff">${label}</div></div>`;
  el.style.cssText = `position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:9995;display:flex;align-items:center;gap:10px;background:rgba(10,8,25,.96);border:1.5px solid ${color};border-radius:14px;padding:10px 20px;box-shadow:0 0 24px ${color}55,0 8px 32px rgba(0,0,0,.6);animation:wbs-toast-in .35s cubic-bezier(.34,1.56,.64,1) forwards`;
  document.body.appendChild(el);
  setTimeout(() => { el.style.animation = 'wbs-toast-out .3s ease forwards'; setTimeout(() => el.remove(), 350); }, Math.min(dur, 3000));
}

// ── Effect implementations ────────────────────────────────────────────────────

function wbsEffect_earthquake(skill) {
  const dur   = (skill.durationSec || 4) * 1000;
  const shell = document.querySelector('.wbe-shell, #s-world-boss, body');
  if (shell) { shell.style.animation = `wbs-shake ${Math.min(dur, 600)}ms ease infinite`; }
  _wbsSkillToast('🌋', 'Earthquake!', '#f97316', dur);
  setTimeout(() => { if (shell) shell.style.animation = ''; }, dur);
}

function wbsEffect_chaos_wind(skill) {
  const dur   = (skill.durationSec || 8) * 1000;
  const speed = { slow:'4s', medium:'2s', fast:'1s' }[skill.windSpeed] || '2s';
  const opts  = document.querySelectorAll('.wbc-opt,.wbr-opt,.camp-opt');
  opts.forEach((el, i) => { el.style.animation = `wbs-wind ${speed} ease-in-out ${i * 0.15}s infinite alternate`; el.style.position = 'relative'; });
  _wbsSkillToast('🌪️', 'Chaos Wind!', '#a78bfa', dur);
  setTimeout(() => { opts.forEach(el => { el.style.animation = ''; el.style.position = ''; }); }, dur);
}

function wbsEffect_darkness(skill) {
  const dur     = (skill.durationSec || 7) * 1000;
  const overlay = document.createElement('div');
  overlay.id    = 'wbs-darkness-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9980;pointer-events:none;background:rgba(0,0,0,.75);animation:wbs-fade-in .6s ease forwards';
  document.body.appendChild(overlay);
  const qCard = document.querySelector('.wbc-panel.wbe-question,#wbc-combat-area,.camp-encounter-inner');
  const prevZ = qCard ? qCard.style.zIndex : '';
  if (qCard) { qCard.style.zIndex = '9985'; qCard.style.position = 'relative'; }
  _wbsSkillToast('🌑', 'Darkness Falls!', '#6366f1', dur);
  setTimeout(() => {
    overlay.style.animation = 'wbs-fade-out .6s ease forwards';
    setTimeout(() => overlay.remove(), 650);
    if (qCard) { qCard.style.zIndex = prevZ; qCard.style.position = ''; }
  }, dur);
}

function wbsEffect_mirror_trick(skill) {
  const list = document.getElementById('wbc-opts-list'); if (!list) return;
  const opts = Array.from(list.children); if (opts.length < 2) return;
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    list.insertBefore(opts[j], opts[i]);
    opts.splice(i, 0, opts.splice(j, 1)[0]);
  }
  _wbsSkillToast('🪞', 'Mirror Trick! Choices shuffled.', '#EC4899', 2500);
}

function wbsEffect_berserk_roar(skill) {
  const dur  = Math.max(1000, (skill.durationSec || 3) * 1000);
  const opts = document.querySelectorAll('.wbc-opt,.wbr-opt,.camp-opt');
  opts.forEach((el, i) => { el.style.animation = `wbs-vibrate 0.08s linear ${i * 0.04}s infinite`; });
  _wbsSkillToast('😤', 'Berserk Roar!', '#ef4444', dur);
  setTimeout(() => { opts.forEach(el => { el.style.animation = ''; }); }, dur);
}

function wbsEffect_meteor_shower(skill) {
  const dur  = (skill.durationSec || 6) * 1000;
  const cont = document.createElement('div');
  cont.id    = 'wbs-meteor-container';
  cont.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9970;overflow:hidden';
  document.body.appendChild(cont);
  for (let i = 0; i < 18; i++) {
    const m = document.createElement('div');
    const sz = 2 + Math.random() * 4, sx = Math.random() * 120, d = Math.random() * (dur * .7 / 1000), fd = .8 + Math.random() * 1.2;
    m.style.cssText = `position:absolute;left:${sx}%;top:-10%;width:${sz}px;height:${sz * 8}px;background:linear-gradient(180deg,#fff 0%,rgba(255,185,95,.8) 40%,transparent 100%);border-radius:50%;transform:rotate(${15 + Math.random() * 20}deg);animation:wbs-meteor ${fd}s ease-in ${d}s both;opacity:.85`;
    cont.appendChild(m);
  }
  _wbsSkillToast('☄️', 'Meteor Shower!', '#ffb95f', dur);
  setTimeout(() => cont.remove(), dur + 2000);
}

// ── Fire / loop / stop ────────────────────────────────────────────────────────

window.wbsFireSkill = function (bossIdx, skillId) {
  if (currentRole !== 'student') return;
  DB = loadDB();
  const boss   = DB.bossEvents[bossIdx]; if (!boss) return;
  const skills = wbsGetSkills(boss);
  const skill  = skills[skillId]; if (!skill || !skill.enabled) return;
  wbsStartCooldown(bossIdx, skillId, skill.cooldownSec || 40);
  switch (skillId) {
    case 'earthquake':    wbsEffect_earthquake(skill);    break;
    case 'chaos_wind':    wbsEffect_chaos_wind(skill);    break;
    case 'darkness':      wbsEffect_darkness(skill);      break;
    case 'mirror_trick':  wbsEffect_mirror_trick(skill);  break;
    case 'berserk_roar':  wbsEffect_berserk_roar(skill);  break;
    case 'meteor_shower': wbsEffect_meteor_shower(skill); break;
  }
};

window.wbsAdminFireSkill = function (bossIdx, skillId) {
  DB = loadDB();
  const boss   = DB.bossEvents[bossIdx]; if (!boss) return;
  const skills = wbsGetSkills(boss);
  const skill  = skills[skillId];
  if (!skill || !skill.enabled) { toast('⚠️ Skill is disabled — enable it first.', '#ffb95f'); return; }
  WBS.skillCooldowns[bossIdx + '_' + skillId] = 0;
  wbsStartCooldown(bossIdx, skillId, skill.cooldownSec || 40);
  // ⚠️ pendingSkill is a cross-tab signal — DO NOT rename this key [BLOCKER-SIGNAL]
  DB.pendingSkill = { bossIdx, skillId, firedAt: Date.now() };
  saveDB();
  toast(`✅ Fired ${skill.emoji} ${skill.name} on student screens!`, '#4edea3');
};

window.wbsStartSkillLoop = function (bossIdx) {
  wbsStopSkillLoop();
  WBS.currentBossIdx = bossIdx;
  function _tick() {
    if (currentRole !== 'student') return;
    DB = loadDB();
    const boss = DB.bossEvents[bossIdx];
    if (!boss || boss.status !== 'active') return;
    if ((boss.skillFireMode || 'auto') === 'manual') { WBS.loopTimer = setTimeout(_tick, 5000); return; }
    const skill = wbsPickSkill(bossIdx);
    if (skill) wbsFireSkill(bossIdx, skill.id);
    const minSec = Math.max(5,  parseInt(boss.skillIntervalMin) || 15);
    const maxSec = Math.max(minSec + 5, parseInt(boss.skillIntervalMax) || 35);
    WBS.loopTimer = setTimeout(_tick, (minSec + Math.random() * (maxSec - minSec)) * 1000);
  }
  WBS.loopTimer = setTimeout(_tick, (8 + Math.random() * 10) * 1000);
};

window.wbsStopSkillLoop = function () {
  if (WBS.loopTimer) { clearTimeout(WBS.loopTimer); WBS.loopTimer = null; }
  ['wbs-darkness-overlay', 'wbs-meteor-container', 'wbs-skill-toast'].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });
  document.querySelectorAll('.wbc-opt,.wbr-opt,.camp-opt').forEach(el => { el.style.animation = ''; });
  const shell = document.querySelector('.wbe-shell,#s-world-boss');
  if (shell) shell.style.animation = '';
};

// ── Admin skill config modal ──────────────────────────────────────────────────

window.wbsOpenSkillConfig = function (bossIdx) {
  DB = loadDB();
  const boss   = DB.bossEvents[bossIdx]; if (!boss) return;
  const skills = wbsGetSkills(boss);
  const PHASES = ['any', '1', '2', '3'];
  const rows   = Object.values(skills).map(sk => {
    const phaseOpts = PHASES.map(p => `<option value="${p}" ${String(sk.triggerPhase||'any')===p?'selected':''}>${p === 'any' ? 'Any Phase' : 'Phase ' + p}</option>`).join('');
    const windRow   = sk.id === 'chaos_wind' ? `<select id="wbs-wind-${sk.id}" style="font-size:10px"><option value="slow" ${sk.windSpeed==='slow'?'selected':''}>Slow</option><option value="medium" ${(sk.windSpeed||'medium')==='medium'?'selected':''}>Medium</option><option value="fast" ${sk.windSpeed==='fast'?'selected':''}>Fast</option></select>` : '';
    return `<div style="display:grid;grid-template-columns:auto 1fr auto auto auto ${sk.id==='chaos_wind'?'auto':'0px'};gap:8px;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.05)">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="wbs-en-${sk.id}" ${sk.enabled?'checked':''} style="width:15px;height:15px"><span style="font-size:16px">${sk.emoji}</span></label>
      <div><div style="font-size:12px;font-weight:700;color:var(--on-surface)">${_esc(sk.name)}</div><div style="font-size:10px;color:var(--text-muted)">${_esc(sk.desc)}</div></div>
      <div><div style="font-size:9px;color:var(--text-muted);margin-bottom:2px">Duration(s)</div><input type="number" id="wbs-dur-${sk.id}" value="${sk.durationSec||4}" min="0" max="60" style="width:52px;font-size:12px;text-align:center"></div>
      <div><div style="font-size:9px;color:var(--text-muted);margin-bottom:2px">Cooldown(s)</div><input type="number" id="wbs-cd-${sk.id}" value="${sk.cooldownSec||40}" min="5" max="300" style="width:52px;font-size:12px;text-align:center"></div>
      <div><div style="font-size:9px;color:var(--text-muted);margin-bottom:2px">Trigger</div><select id="wbs-ph-${sk.id}" style="font-size:10px">${phaseOpts}</select></div>
      ${windRow ? `<div><div style="font-size:9px;color:var(--text-muted);margin-bottom:2px">Wind</div>${windRow}</div>` : ''}
      <button class="btn btn-ghost btn-xs" onclick="wbsAdminFireSkill(${bossIdx},'${sk.id}')" title="Fire now on student screens">⚡ Fire</button>
    </div>`;
  }).join('');

  const fireMode = boss.skillFireMode || 'auto';
  showModal(`<div>
    <div class="modal-h2" style="margin-bottom:16px">⚡ Boss Skills — ${_esc(boss.name)}</div>
    <div class="form-group"><label class="form-label">Fire Mode</label>
      <div style="display:flex;gap:10px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="wbs-mode" value="auto" ${fireMode==='auto'?'checked':''} style="width:15px;height:15px"> Auto (random)</label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="wbs-mode" value="manual" ${fireMode==='manual'?'checked':''} style="width:15px;height:15px"> Manual only</label>
      </div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div><label class="form-label">Min interval (s)</label><input type="number" id="wbs-imin" value="${boss.skillIntervalMin||15}" min="5" style="width:100%"></div>
      <div><label class="form-label">Max interval (s)</label><input type="number" id="wbs-imax" value="${boss.skillIntervalMax||35}" min="10" style="width:100%"></div>
    </div>
    <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">Skills</div>
    <div>${rows}</div>
    <div style="display:flex;gap:10px;margin-top:14px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" style="flex:1" onclick="wbsSaveSkillConfig(${bossIdx})">Save</button>
    </div>
  </div>`, 'lg');
};

window.wbsSaveSkillConfig = function (bossIdx) {
  DB = loadDB();
  const boss = DB.bossEvents[bossIdx]; if (!boss) return;
  boss.skillFireMode    = document.querySelector('input[name="wbs-mode"]:checked')?.value || 'auto';
  boss.skillIntervalMin = parseInt(document.getElementById('wbs-imin')?.value) || 15;
  boss.skillIntervalMax = parseInt(document.getElementById('wbs-imax')?.value) || 35;
  if (!boss.skills) boss.skills = {};
  Object.keys(WBS_SKILL_DEFAULTS).forEach(id => {
    if (!boss.skills[id]) boss.skills[id] = {};
    boss.skills[id].enabled     = document.getElementById(`wbs-en-${id}`)?.checked  ?? true;
    boss.skills[id].durationSec = parseInt(document.getElementById(`wbs-dur-${id}`)?.value) || 4;
    boss.skills[id].cooldownSec = parseInt(document.getElementById(`wbs-cd-${id}`)?.value)  || 40;
    boss.skills[id].triggerPhase = document.getElementById(`wbs-ph-${id}`)?.value   || 'any';
    if (id === 'chaos_wind') boss.skills[id].windSpeed = document.getElementById(`wbs-wind-${id}`)?.value || 'medium';
  });
  saveDB();
  closeModalForce();
  toast('✅ Skill config saved!');
  renderAdminBossEvents();
};

// Track crit hits for stats
window.wblTrackCrit = function (bossIdx, studentId) {
  const parts = wbcGetParticipants(bossIdx);
  if (parts[studentId]) parts[studentId].critHits = (parts[studentId].critHits || 0) + 1;
};

// ── Wire the skill loop into the battle lifecycle ─────────────────────────────
// RESTORED: wbsStartSkillLoop/wbsStopSkillLoop and wbsOpenSkillConfig were
// defined but never called from anywhere in the extracted codebase. Skills
// would never fire automatically during a battle, and there was no button
// anywhere in the admin UI to configure or manually fire them. Ported the
// original's monkey-patches verbatim.

;(function () {
  if (typeof renderStudentWorldBoss !== 'function') return;
  const _origRender = renderStudentWorldBoss;
  window.renderStudentWorldBoss = function () {
    _origRender();
    const found = (typeof wbcGetActiveBoss === 'function') ? wbcGetActiveBoss() : null;
    if (found && found.boss && found.boss.status === 'active') {
      wbsStartSkillLoop(found.idx);
    } else {
      wbsStopSkillLoop();
    }
  };
})();

;(function () {
  if (typeof wbrShowEncounter === 'undefined' || typeof wbrShowEncounter !== 'function') return;
  const _orig = wbrShowEncounter;
  window.wbrShowEncounter = function () {
    _orig();
    const found = (typeof wbcGetActiveBoss === 'function') ? wbcGetActiveBoss() : null;
    if (found) wbsStartSkillLoop(found.idx);
  };
})();

;(function () {
  if (typeof wbmStopSpawnLoop !== 'function') return;
  const _orig = wbmStopSpawnLoop;
  window.wbmStopSpawnLoop = function () {
    _orig();
    wbsStopSkillLoop();
  };
})();

// ── Inject "⚡ Boss Skills" button into the admin boss card ──────────────────
;(function () {
  if (typeof _bossEventCardHTML !== 'function') return;
  const _orig = _bossEventCardHTML;
  window._bossEventCardHTML = function (boss, bi) {
    const base = _orig(boss, bi);
    if (boss.status !== 'active' && boss.status !== 'draft') return base;

    const skills = wbsGetSkills(boss);
    const enabledCount = Object.values(skills).filter(s => s.enabled).length;
    const total = Object.keys(skills).length;
    const fireMode = boss.skillFireMode || 'auto';
    const modeLabel = fireMode === 'manual'
      ? `<span style="font-size:9px;padding:2px 7px;border-radius:10px;border:1px solid rgba(236,72,153,.4);background:rgba(236,72,153,.08);color:#EC4899;font-weight:700;letter-spacing:.06em">🎯 MANUAL</span>`
      : `<span style="font-size:9px;padding:2px 7px;border-radius:10px;border:1px solid rgba(78,222,163,.3);background:rgba(78,222,163,.06);color:#4edea3;font-weight:700;letter-spacing:.06em">🤖 AUTO ${boss.skillIntervalMin||15}–${boss.skillIntervalMax||35}s</span>`;

    const skillStrip = `
      <div style="border-top:1px solid rgba(139,92,246,0.12);padding-top:10px;margin-top:6px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span style="font-family:var(--fm);font-size:8px;color:var(--text-muted);letter-spacing:.1em">SKILLS</span>
            ${Object.values(skills).map(sk => `<span title="${_esc(sk.name)}: ${sk.enabled?'ON':'OFF'}" style="font-size:14px;opacity:${sk.enabled?'1':'0.3'}">${sk.emoji}</span>`).join('')}
            <span style="font-size:10px;color:var(--text-muted)">${enabledCount}/${total} active</span>
            ${modeLabel}
          </div>
          <button class="btn btn-ghost btn-xs" style="border-color:rgba(139,92,246,.3);color:#a78bfa;font-size:10px" onclick="wbsOpenSkillConfig(${bi})">⚡ Boss Skills</button>
        </div>
      </div>`;

    return base.replace(/(<\/div>\s*<\/div>\s*)$/, skillStrip + '$1');
  };
})();

// ── Also surface the skills button inside the boss edit form ─────────────────
;(function () {
  if (typeof openBossForm !== 'function') return;
  const _orig = openBossForm;
  window.openBossForm = function (bossIndex) {
    _orig(bossIndex);
    if (bossIndex === null || bossIndex === undefined) return;
    setTimeout(() => {
      const actions = document.querySelector('#modal-content .btn-primary');
      if (!actions) return;
      if (document.getElementById('wbs-form-btn')) return;
      const btn = document.createElement('button');
      btn.id = 'wbs-form-btn';
      btn.className = 'btn btn-ghost';
      btn.style.cssText = 'border-color:rgba(139,92,246,.3);color:#a78bfa';
      btn.innerHTML = '✨ Skills';
      btn.onclick = () => { closeModalForce(); wbsOpenSkillConfig(bossIndex); };
      actions.parentNode.insertBefore(btn, actions);
    }, 90);
  };
})();

// ── Runtime CSS injection ──────────────────────────────────────────────────────
// RESTORED: every effect function above references a @keyframes animation
// (wbs-shake, wbs-wind, wbs-vibrate, wbs-meteor, wbs-fade-in/out, wbs-toast-in/out)
// but none of them were defined anywhere in the extracted codebase or
// stylesheet, so every skill effect would silently no-op visually even once
// correctly triggered. Ported verbatim from the original.

;(function () {
  const style = document.createElement('style');
  style.textContent = `
@keyframes wbs-shake {
  0%,100% { transform: translate(0,0) rotate(0deg); }
  10%  { transform: translate(-3px, 2px) rotate(-.4deg); }
  20%  { transform: translate(3px,-3px) rotate(.4deg);  }
  30%  { transform: translate(-4px, 1px) rotate(-.3deg); }
  40%  { transform: translate(4px, 2px) rotate(.3deg);   }
  50%  { transform: translate(-2px,-2px) rotate(-.2deg); }
  60%  { transform: translate(3px, 3px) rotate(.2deg);   }
  70%  { transform: translate(-3px, 0px) rotate(-.3deg); }
  80%  { transform: translate(2px,-2px) rotate(.2deg);   }
  90%  { transform: translate(-1px, 2px) rotate(0deg);   }
}
@keyframes wbs-wind {
  0%   { transform: translateX(0px); }
  100% { transform: translateX(18px); }
}
@keyframes wbs-vibrate {
  0%  { transform: translate(0,0); }
  25% { transform: translate(-2px, 1px); }
  50% { transform: translate(2px,-1px); }
  75% { transform: translate(-1px, 2px); }
  100%{ transform: translate(1px, -1px); }
}
@keyframes wbs-meteor {
  0%   { transform: translate(0,0) rotate(20deg); opacity:.85; }
  80%  { opacity:.7; }
  100% { transform: translate(30vw, 110vh) rotate(20deg); opacity:0; }
}
@keyframes wbs-fade-in { from { opacity:0; } to { opacity:1; } }
@keyframes wbs-fade-out { from { opacity:1; } to { opacity:0; } }
@keyframes wbs-toast-in {
  from { opacity:0; transform:translateX(-50%) translateY(-12px) scale(.95); }
  to   { opacity:1; transform:translateX(-50%) translateY(0) scale(1); }
}
@keyframes wbs-toast-out {
  from { opacity:1; transform:translateX(-50%) translateY(0) scale(1); }
  to   { opacity:0; transform:translateX(-50%) translateY(-8px) scale(.97); }
}
  `;
  document.head.appendChild(style);
})();

console.log('[EduQuest] world-boss/skills.js loaded — WBS, WBS_SKILL_DEFAULTS, 6 skill effects, fire loop, admin config registered.');

// ── Cross-tab signal consumer (student-side) ──────────────────────────────────
// RESTORED: wbsAdminFireSkill() writes a `pendingSkill` signal into the shared
// DB blob so student tabs can run the effect locally, but nothing in the
// extracted codebase ever read that signal back out — admin-triggered
// "Fire Now" / "Quick Fire" skills never actually appeared on student screens.
// ⚠️ pendingSkill is a cross-tab signal key — DO NOT rename it [BLOCKER-SIGNAL]

;(function () {
  if (window._wbsStorageHandlerAttached) return;
  window._wbsStorageHandlerAttached = true;

  function _consumePendingSkill(freshDB) {
    if (currentRole !== 'student') return;
    const ps = freshDB.pendingSkill;
    if (!ps) return;
    // Only act if the signal is recent (< 8s old) to avoid replaying stale signals
    if (Date.now() - (ps.firedAt || 0) >= 8000) { delete freshDB.pendingSkill; return; }
    const boss = freshDB.bossEvents && freshDB.bossEvents[ps.bossIdx];
    if (boss && boss.status === 'active') {
      const skills = wbsGetSkills(boss);
      const skill  = skills[ps.skillId];
      if (skill && skill.enabled) {
        if (typeof BVS !== 'undefined') BVS.request('cast', 900);
        switch (ps.skillId) {
          case 'earthquake':    wbsEffect_earthquake(skill);    break;
          case 'chaos_wind':    wbsEffect_chaos_wind(skill);    break;
          case 'darkness':      wbsEffect_darkness(skill);      break;
          case 'mirror_trick':  wbsEffect_mirror_trick(skill);  break;
          case 'berserk_roar':  wbsEffect_berserk_roar(skill);  break;
          case 'meteor_shower': wbsEffect_meteor_shower(skill); break;
        }
      }
    }
    // Clear the signal so it only fires once per student tab
    delete freshDB.pendingSkill;
    try { DB = freshDB; saveDB(); } catch (ex) {}
  }

  window.addEventListener('storage', function () {
    _consumePendingSkill(loadDB());
  });

  // Same-tab fallback poll (storage events don't fire in the tab that wrote them)
  setInterval(() => {
    if (currentRole !== 'student') return;
    _consumePendingSkill(loadDB());
  }, 2000);
})();
