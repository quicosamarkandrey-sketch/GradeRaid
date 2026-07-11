// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/world-boss/admin-page.js
//  Admin Boss Event Manager: list/card render, create/edit form, boss actions
//  (activate/end/delete), combat settings modal, question editor, boss library
//  picker (bfOpenLibraryPicker / bfUnlinkProfile / bfSkipLibraryLink).
//
//  LOAD AFTER: combat-settings.js, loot-rain.js, minions.js, leaderboard.js
// ═══════════════════════════════════════════════════════════════════════════════

// ── Helpers ───────────────────────────────────────────────────────────────────

function bossStatusLabel(boss) {
  if (boss.status === 'active') return '<span class="ba-status active">● LIVE</span>';
  if (boss.status === 'loot')   return '<span class="ba-status active" style="background:rgba(255,185,95,.14);border-color:rgba(255,185,95,.38);color:#ffb95f">● LOOT</span>';
  if (boss.status === 'ended')  return '<span class="ba-status ended">■ ENDED</span>';
  const now = Date.now();
  const start = new Date(boss.startDate).getTime();
  const end   = new Date(boss.endDate).getTime();
  if (now < start) return '<span class="ba-status upcoming">◆ UPCOMING</span>';
  if (now > end)   return '<span class="ba-status ended">■ ENDED</span>';
  return '<span class="ba-status draft">● DRAFT</span>';
}

function diffColor(d) {
  return d === 'Easy' ? '#4edea3' : d === 'Hard' ? '#f87171' : d === 'Legendary' ? '#EC4899' : 'var(--tertiary)';
}

function diffClass(d) {
  return d === 'Easy' ? 'active-easy' : d === 'Hard' ? 'active-hard' : d === 'Legendary' ? 'active-legendary' : 'active-normal';
}

function bossHpPct(boss) {
  if (!boss.maxHp || boss.maxHp <= 0) return 100;
  const cur = boss.currentHp !== undefined ? boss.currentHp : boss.maxHp;
  return Math.max(0, Math.min(100, Math.round(cur / boss.maxHp * 100)));
}

// _esc() is defined in utils.js (loaded before this file) — no local copy needed.

// ── Main admin render ─────────────────────────────────────────────────────────

window.renderAdminBossEvents = function () {
  const bosses = DB.bossEvents || [];
  const stats  = {
    total:  bosses.length,
    active: bosses.filter(b => b.status === 'active').length,
    ended:  bosses.filter(b => b.status === 'ended').length,
    draft:  bosses.filter(b => b.status === 'draft').length,
  };

  document.getElementById('a-bossevents').innerHTML = `
  <div style="padding:32px;max-width:1200px;margin:0 auto">
    <div class="boss-admin-hero">
      <div class="boss-admin-hero-inner">
        <div class="boss-admin-hero-icon">💀</div>
        <div class="boss-admin-hero-info">
          <div class="boss-admin-hero-title">Boss Event Manager</div>
          <div class="boss-admin-hero-sub">Create and manage World Boss raid events. Set HP, rewards, dates, and difficulty for class-wide battles.</div>
        </div>
        <button class="btn btn-primary" onclick="openBossForm(null)" style="background:linear-gradient(135deg,#EC4899,#9333ea);box-shadow:0 4px 20px rgba(236,72,153,.35);flex-shrink:0">
          <span class="material-symbols-outlined" style="font-size:18px">add</span> Create Boss
        </button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:28px">
      <div class="glass-card" style="padding:16px;text-align:center;border-color:rgba(236,72,153,0.15)"><div style="font-family:var(--fh);font-size:28px;font-weight:900;color:var(--on-surface)">${stats.total}</div><div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-top:4px">Total Bosses</div></div>
      <div class="glass-card" style="padding:16px;text-align:center;border-color:rgba(236,72,153,0.25)"><div style="font-family:var(--fh);font-size:28px;font-weight:900;color:#EC4899">${stats.active}</div><div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-top:4px">Live Now</div></div>
      <div class="glass-card" style="padding:16px;text-align:center;border-color:rgba(255,185,95,0.15)"><div style="font-family:var(--fh);font-size:28px;font-weight:900;color:var(--tertiary)">${stats.draft}</div><div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-top:4px">Draft</div></div>
      <div class="glass-card" style="padding:16px;text-align:center"><div style="font-family:var(--fh);font-size:28px;font-weight:900;color:var(--text-muted)">${stats.ended}</div><div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-top:4px">Ended</div></div>
    </div>
    <div class="section-header" style="margin-bottom:16px">
      <span class="material-symbols-outlined" style="color:#EC4899">local_fire_department</span>
      <h2 style="color:var(--on-surface)">Boss Events</h2>
      <span class="badge-pill" style="background:rgba(236,72,153,0.12);color:#EC4899;border:1px solid rgba(236,72,153,0.25)">${bosses.length} events</span>
    </div>
    ${bosses.length === 0 ? `
    <div class="boss-empty-state">
      <div class="boss-empty-icon">💀</div>
      <div class="boss-empty-title">No Boss Events Yet</div>
      <div class="boss-empty-sub">Create your first World Boss event to challenge all students in a class-wide raid battle.</div>
      <button class="btn btn-primary" onclick="openBossForm(null)" style="background:linear-gradient(135deg,#EC4899,#9333ea)">＋ Create First Boss</button>
    </div>` : `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px">
      ${bosses.map((boss, bi) => _bossEventCardHTML(boss, bi)).join('')}
    </div>`}
  </div>`;
};

// ── Boss event card HTML ───────────────────────────────────────────────────────

window._bossEventCardHTML = function (boss, bi) {
  const hpPct  = bossHpPct(boss);
  const diffC  = diffColor(boss.difficulty);
  const _ms    = wbmSettings(boss);
  const badge  = _ms.enabled
    ? '<span style="font-family:var(--fm);font-size:8px;color:#f97316;background:rgba(249,115,22,.12);border:1px solid rgba(249,115,22,.3);padding:2px 7px;border-radius:4px;letter-spacing:.04em">👿 MINIONS ON</span>'
    : '<span style="font-family:var(--fm);font-size:8px;color:var(--text-muted);background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);padding:2px 7px;border-radius:4px;letter-spacing:.04em">👿 OFF</span>';
  const _spawn = boss.status === 'active'
    ? `<button class="btn btn-ghost btn-xs" style="border-color:rgba(249,115,22,.4);color:#f97316" onclick="wbmAdminForceSpawn(${bi})">⚡ Force Spawn</button>` +
      `<button class="btn btn-ghost btn-xs" style="border-color:rgba(78,222,163,.25);color:#4edea3" onclick="wbmOpenRevivePanel(${bi})">✨ Revive</button>` : '';

  return `
  <div class="boss-event-card fade-in">
    <div class="boss-event-card-inner">
      <div class="boss-event-card-header">
        <div class="boss-event-sprite-sm">${(typeof bveRenderCompactArt === 'function') ? bveRenderCompactArt(boss, 48) : (boss.image || '💀')}</div>
        <div class="boss-event-meta">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            ${bossStatusLabel(boss)}
            <span style="font-size:10px;font-weight:700;color:${diffC};background:${diffC}18;border:1px solid ${diffC}33;padding:2px 8px;border-radius:6px">${boss.difficulty || 'Normal'}</span>
          </div>
          <div class="boss-event-name" title="${boss.name}">${boss.name || 'Unnamed Boss'}</div>
          <div class="boss-event-dates">
            <span class="material-symbols-outlined" style="font-size:12px">calendar_month</span>
            ${boss.startDate || '—'} → ${boss.endDate || '—'}
          </div>
        </div>
      </div>
      ${boss.description ? `<div style="font-size:12px;color:var(--text-muted);line-height:1.5;margin-bottom:12px;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${boss.description}</div>` : ''}
      <div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div style="font-family:var(--fm);font-size:9px;color:#EC4899;letter-spacing:.1em">BOSS HP</div>
          <div style="font-family:var(--fh);font-size:12px;font-weight:900;color:var(--on-surface)">${(boss.currentHp !== undefined ? boss.currentHp : boss.maxHp || 0).toLocaleString()} <span style="color:rgba(240,238,255,.35);font-weight:600;font-size:11px">/ ${(boss.maxHp || 0).toLocaleString()}</span></div>
        </div>
        <div style="background:rgba(255,255,255,0.06);border-radius:8px;height:6px;overflow:hidden;border:1px solid rgba(255,255,255,0.04)">
          <div class="hp-preview-bar" style="width:${hpPct}%"></div>
        </div>
      </div>
      <div class="boss-event-stats">
        <div class="boss-ev-stat"><div class="v" style="color:#d0bcff">⚡${(boss.xpReward || 0).toLocaleString()}</div><div class="l">XP Reward</div></div>
        <div class="boss-ev-stat"><div class="v" style="color:var(--tertiary)">🪙${(boss.coinReward || 0).toLocaleString()}</div><div class="l">Coin Reward</div></div>
        <div class="boss-ev-stat"><div class="v" style="color:#4edea3">⚔️${Object.keys((DB.bossParticipants || {})[bi] || {}).length}</div><div class="l">Raiders</div></div>
        <div class="boss-ev-stat"><div class="v" style="color:#EC4899">💥${Object.values((DB.bossParticipants || {})[bi] || {}).reduce((a, p) => a + p.totalDamage, 0).toLocaleString()}</div><div class="l">Total Dmg</div></div>
      </div>
      <div class="boss-event-actions">
        <button class="btn btn-ghost btn-sm" onclick="openBossForm(${bi})" title="Edit Boss"><span class="material-symbols-outlined" style="font-size:15px">edit</span> Edit</button>
        <button class="btn btn-sm" onclick="wbcOpenQuestionEditor(${bi})" style="background:rgba(208,188,255,0.1);border:1px solid rgba(208,188,255,0.3);color:var(--primary)" title="Edit Questions"><span class="material-symbols-outlined" style="font-size:15px">quiz</span> Questions (${(boss.bossQuestions || []).length})</button>
        <button class="btn btn-sm" onclick="wblrOpenLootSettings(${bi})" style="background:rgba(255,185,95,0.08);border:1px solid rgba(255,185,95,0.3);color:#ffb95f" title="Configure Loot Drop Rush"><span class="material-symbols-outlined" style="font-size:15px">redeem</span> Loot</button>
        <button class="btn btn-sm" onclick="wbmOpenMinionSettings(${bi})" style="background:rgba(249,115,22,0.08);border:1px solid rgba(249,115,22,0.3);color:#f97316"><span class="material-symbols-outlined" style="font-size:15px">pest_control</span> ${_ms.enabled ? 'Minions On' : 'Minions'}</button>
        ${boss.status === 'active' && _ms.enabled ? `<button class="btn btn-sm" onclick="wbmAdminForceSpawn(${bi})" style="background:rgba(249,115,22,0.12);border:1px solid rgba(249,115,22,0.36);color:#f97316"><span class="material-symbols-outlined" style="font-size:15px">bolt</span> Spawn</button>` : ''}
        ${boss.status === 'active' ? `<button class="btn btn-sm" onclick="wbmOpenRevivePanel(${bi})" style="background:rgba(78,222,163,0.08);border:1px solid rgba(78,222,163,0.26);color:#4edea3"><span class="material-symbols-outlined" style="font-size:15px">favorite</span> Revive</button>` : ''}
        ${boss.status !== 'ended' && boss.status !== 'loot' ? `<button class="btn btn-sm" onclick="wbcOpenCombatSettings(${bi})" style="background:rgba(236,72,153,0.08);border:1px solid rgba(236,72,153,0.28);color:#EC4899"><span class="material-symbols-outlined" style="font-size:15px">tune</span> Combat</button>` : ''}
        ${boss.status === 'loot' ? `<button class="btn btn-sm" onclick="wblrAdminFinalizeLoot(${bi})" style="background:linear-gradient(135deg,rgba(255,185,95,0.22),rgba(236,72,153,0.12));border:1px solid rgba(255,185,95,0.42);color:#ffb95f"><span class="material-symbols-outlined" style="font-size:15px">flag</span> Finish Loot</button>` : ''}
        ${boss.status === 'ended' && boss.defeatedAt ? `<button class="btn btn-sm" onclick="wblrOpenFinalSummary(${bi})" style="background:rgba(78,222,163,0.08);border:1px solid rgba(78,222,163,0.28);color:#4edea3"><span class="material-symbols-outlined" style="font-size:15px">analytics</span> Summary</button>` : ''}
        ${boss.status !== 'active' && boss.status !== 'loot' ? `<button class="btn btn-sm" onclick="bossActivate(${bi})" style="background:linear-gradient(135deg,rgba(236,72,153,0.2),rgba(139,92,246,0.15));border:1px solid rgba(236,72,153,0.4);color:#EC4899"><span class="material-symbols-outlined" style="font-size:15px">play_arrow</span> ${boss.status === 'ended' ? 'Reactivate' : 'Activate'}</button>` : ''}
        ${boss.status === 'active' ? `<button class="btn btn-sm" onclick="bossEnd(${bi})" style="background:rgba(255,185,95,0.1);border:1px solid rgba(255,185,95,0.3);color:var(--tertiary)"><span class="material-symbols-outlined" style="font-size:15px">stop</span> End Event</button>` : ''}
        ${(boss.status === 'ended' || boss.status === 'active') ? `<button class="btn btn-ghost btn-sm" onclick="wblOpenAdminLeaderboard(${bi},'event')" style="border-color:rgba(255,185,95,0.35);color:#ffb95f"><span class="material-symbols-outlined" style="font-size:15px">leaderboard</span> Leaderboard</button>` : ''}
        <button class="btn btn-danger btn-sm" onclick="bossDelete(${bi})" style="margin-left:auto"><span class="material-symbols-outlined" style="font-size:15px">delete</span></button>
      </div>
      <div style="border-top:1px solid rgba(249,115,22,0.12);padding-top:10px;margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        ${badge}
        <button class="btn btn-ghost btn-xs" style="border-color:rgba(249,115,22,.25);color:#f97316" onclick="wbmOpenMinionSettings(${bi})">👿 Minions</button>
        ${_spawn}
      </div>
    </div>
  </div>`;
};

// ── Boss actions ───────────────────────────────────────────────────────────────

window.bossActivate = async function (bi) {
  if (!DB.bossEvents[bi]) return;
  const boss       = DB.bossEvents[bi];
  const restarting = boss.status === 'ended' || boss.status === 'loot' || (boss.currentHp !== undefined && boss.currentHp <= 0);
  if (!confirm(`Activate "${boss.name}"?\n\nThis will make the boss LIVE and visible to all students.${restarting ? '\n\nPrevious raid, loot, and claim progress will reset for a fresh run.' : ''}`)) return;
  // Phase 14: only end other bosses in THIS boss's own section — a global
  // sweep here was ending every other teacher's live boss the moment any
  // one section's boss was activated (see phase14_section_isolation.sql).
  DB.bossEvents.forEach((b, i) => {
    if (i !== bi && b.classId === boss.classId && (b.status === 'active' || b.status === 'loot')) {
      b.status = 'ended';
    }
  });
  boss.status = 'active'; boss.activatedAt = Date.now(); boss.currentHp = boss.maxHp;
  if (!boss.lootRewards || !boss.lootRewards.length) boss.lootRewards = wblrDefaultRewards();
  boss.lootRewards = wblrNormalizeRewards(boss.lootRewards);
  boss.lootClaims  = [];
  delete boss.defeatedAt; delete boss.endedAt; delete boss.lootStartedAt; delete boss.lootFinalizedAt; delete boss._lootRainShown;
  if (!DB.bossParticipants) DB.bossParticipants = {};
  DB.bossParticipants[bi] = {};
  boss.activeMinions = [];
  const parts = wbcGetParticipants(bi);
  Object.values(parts).forEach(p => { p.hp = 3; p.maxHp = 3; p.isKO = false; p.koTime = 0; p.reviveAt = 0; p.minionLog = []; });
  saveDB();
  renderAdminBossEvents();
  toast('💀 Boss "' + boss.name + '" is now LIVE!', '#EC4899');
  // Phase 24: start_boss_event() atomically ends siblings + resets
  // current_hp/status/timestamps + clears participant/loot rows
  // server-side, instead of leaving all of that to whatever the next
  // bulk boss_events push happens to carry.
  if (typeof DBService !== 'undefined' && typeof DBService.rpc === 'function' && boss._id) {
    const { error } = await DBService.rpc('start_boss_event', { p_boss_id: boss._id, p_class_id: boss.classId || 'default-class' });
    if (error) toast('⚠️ Activated locally, but may not have synced: ' + error.message, '#ffb95f');
  }
};

window.bossEnd = async function (bi) {
  if (!DB.bossEvents[bi]) return;
  const boss = DB.bossEvents[bi];
  if (!confirm(`End the event for "${boss.name}"?\n\nThe boss will be marked as ended and hidden from students.`)) return;
  boss.status = 'ended'; boss.endedAt = Date.now();
  saveDB(); renderAdminBossEvents();
  toast('⏹️ Boss event "' + boss.name + '" ended.', '#ffb95f');
  // Phase 24: end_boss_event() atomically writes status/ended_at
  // server-side instead of leaving it to whatever the next bulk
  // boss_events push happens to carry.
  if (typeof DBService !== 'undefined' && typeof DBService.rpc === 'function' && boss._id) {
    const { error } = await DBService.rpc('end_boss_event', { p_boss_id: boss._id, p_class_id: boss.classId || 'default-class' });
    if (error) toast('⚠️ Ended locally, but may not have synced: ' + error.message, '#ffb95f');
  }
};

window.bossDelete = async function (bi) {
  if (!DB.bossEvents[bi]) return;
  const boss = DB.bossEvents[bi];
  if (!confirm(`Permanently delete "${boss.name}"?\n\nThis cannot be undone.`)) return;
  wbmStopSpawnLoop();
  if (WBC.refreshInterval)  { clearInterval(WBC.refreshInterval);  WBC.refreshInterval  = null; }
  if (WBC.cooldownTimeout)  { clearTimeout(WBC.cooldownTimeout);   WBC.cooldownTimeout  = null; }
  DB.bossEvents.splice(bi, 1);
  saveDB(); renderAdminBossEvents();
  toast('🗑️ Boss "' + boss.name + '" deleted.');
  // Phase 23: the bulk push is upsert-only and never deletes server rows —
  // without this, the boss (and its participants/loot claims) would
  // silently reappear for everyone on the next pull. delete_boss_event()
  // is section-scope-checked the same as boss_events' own RLS write policy.
  if (typeof DBService !== 'undefined' && typeof DBService.rpc === 'function' && boss._id) {
    const { error } = await DBService.rpc('delete_boss_event', { p_boss_id: boss._id });
    if (error) toast('⚠️ Removed locally, but may not have synced: ' + error.message, '#ffb95f');
  }
};

// ── Combat settings modal ──────────────────────────────────────────────────────

window.wbcOpenCombatSettings = function (bossIdx) {
  const boss = DB.bossEvents[bossIdx];
  if (!boss) return;
  const s = boss.combatSettings || wbcDefaultSettings();
  showModal(`
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
    <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,rgba(236,72,153,.25),rgba(139,92,246,.2));border:1px solid rgba(236,72,153,.4);display:flex;align-items:center;justify-content:center;font-size:22px">⚔️</div>
    <div><div class="modal-h2" style="margin-bottom:2px">Combat Settings — ${boss.name}</div><div style="font-size:12px;color:var(--text-muted)">Configure damage, crit chance, and question flow</div></div>
  </div>
  <div class="boss-form-section">
    <div class="boss-form-section-title">💥 Damage Settings</div>
    <div style="margin-bottom:12px"><label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="cs-use-random" ${s.useRandomDamage ? 'checked' : ''} style="width:auto;accent-color:#EC4899"> Use random damage range instead of fixed value</label></div>
    <div class="combat-settings-grid">
      <div class="form-group" style="margin:0"><label class="form-label">Fixed Damage per Correct Answer</label><input type="number" id="cs-dmg-fixed" value="${s.damagePerAnswer || 150}" min="1" style="width:100%" placeholder="150"><div style="font-size:10px;color:var(--text-muted);margin-top:4px">Used when random damage is OFF</div></div>
      <div style="display:flex;flex-direction:column;gap:8px"><div class="form-group" style="margin:0"><label class="form-label">Min Random Damage</label><input type="number" id="cs-dmg-min" value="${s.damageMinRandom || 80}" min="1" style="width:100%"></div><div class="form-group" style="margin:0"><label class="form-label">Max Random Damage</label><input type="number" id="cs-dmg-max" value="${s.damageMaxRandom || 200}" min="1" style="width:100%"></div></div>
    </div>
  </div>
  <div class="boss-form-section">
    <div class="boss-form-section-title">⚡ Critical Hit</div>
    <div class="combat-settings-grid">
      <div class="form-group" style="margin:0"><label class="form-label">Crit Chance (%)</label><input type="number" id="cs-crit-chance" value="${s.critChance || 20}" min="0" max="100" style="width:100%"><div style="font-size:10px;color:var(--text-muted);margin-top:4px">0 = no crits, 100 = always crit</div></div>
      <div class="form-group" style="margin:0"><label class="form-label">Crit Multiplier</label><input type="number" id="cs-crit-mult" value="${s.critMultiplier || 2.5}" min="1" step="0.1" style="width:100%"><div style="font-size:10px;color:var(--text-muted);margin-top:4px">e.g. 2.5 = 2.5× damage on crit</div></div>
    </div>
  </div>
  <div class="boss-form-section">
    <div class="boss-form-section-title">⏱️ Question Flow</div>
    <div class="form-group" style="margin:0"><label class="form-label">Cooldown between questions (seconds)</label><input type="number" id="cs-cooldown" value="${s.questionCooldown || 0}" min="0" max="300" style="width:100%"><div style="font-size:10px;color:var(--text-muted);margin-top:4px">0 = instant. Applied after each answer.</div></div>
  </div>
  <div style="display:flex;gap:10px;padding-top:4px">
    <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
    <button class="btn btn-primary" style="flex:1;background:linear-gradient(135deg,#EC4899,#9333ea)" onclick="wbcSaveCombatSettings(${bossIdx})">⚔️ Save Settings</button>
  </div>`, 'md');
};

window.wbcSaveCombatSettings = function (bossIdx) {
  const boss = DB.bossEvents[bossIdx];
  if (!boss) return;
  boss.combatSettings = {
    damagePerAnswer: parseInt(document.getElementById('cs-dmg-fixed')?.value) || 150,
    damageMinRandom: parseInt(document.getElementById('cs-dmg-min')?.value)   || 80,
    damageMaxRandom: parseInt(document.getElementById('cs-dmg-max')?.value)   || 200,
    useRandomDamage: document.getElementById('cs-use-random')?.checked        || false,
    critChance:      parseFloat(document.getElementById('cs-crit-chance')?.value) || 20,
    critMultiplier:  parseFloat(document.getElementById('cs-crit-mult')?.value)   || 2.5,
    questionCooldown: parseInt(document.getElementById('cs-cooldown')?.value) || 0,
  };
  saveDB(); closeModalForce();
  toast('✅ Combat settings saved!', '#EC4899');
  renderAdminBossEvents();
};

// ── Question editor ───────────────────────────────────────────────────────────

window.wbcOpenQuestionEditor = function (bossIdx) {
  DB = loadDB();
  const boss = DB.bossEvents[bossIdx];
  if (!boss) return;
  const qs = boss.bossQuestions || [];
  const allQuizzes = DB.quizzes || [];
  window._wbcEditingBossIdx   = bossIdx;
  window._wbcDraftQuestions   = JSON.parse(JSON.stringify(qs));
  showModal(`
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
    <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,rgba(236,72,153,.25),rgba(139,92,246,.2));border:1px solid rgba(236,72,153,.4);display:flex;align-items:center;justify-content:center;font-size:22px">📝</div>
    <div><div class="modal-h2" style="margin-bottom:2px">Boss Questions — ${boss.name}</div><div style="font-size:12px;color:var(--text-muted)">Add questions students will answer to deal damage</div></div>
  </div>
  ${allQuizzes.length > 0 ? `
  <div class="boss-form-section" style="margin-bottom:16px">
    <div class="boss-form-section-title">📋 Import from Quest</div>
    <div style="display:flex;gap:8px;align-items:flex-end">
      <div class="form-group" style="flex:1;margin:0"><label class="form-label">Select Quest</label><select id="wbq-import-quiz" style="width:100%"><option value="">— Choose —</option>${allQuizzes.map(q => `<option value="${q.id}">${q.title} (${q.questions.length} Qs)</option>`).join('')}</select></div>
      <button class="btn btn-ghost btn-sm" onclick="wbcImportFromQuiz(${bossIdx})">Import</button>
    </div>
  </div>` : ''}
  <div id="wbq-list">${_wbcRenderQuestionList(qs)}</div>
  <button class="btn btn-ghost btn-block" style="margin-top:10px;border-style:dashed" onclick="wbcAddQuestion(${bossIdx})">＋ Add Question</button>
  <div style="display:flex;gap:10px;margin-top:14px;padding-top:4px;border-top:1px solid var(--border)">
    <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Close</button>
    <button class="btn btn-primary" style="flex:1;background:linear-gradient(135deg,#EC4899,#9333ea)" onclick="wbcSaveQuestions(${bossIdx})">💾 Save Questions</button>
  </div>`, 'lg');
};

function _wbcRenderQuestionList(qs) {
  if (!qs || qs.length === 0) return '<div style="text-align:center;padding:28px;color:var(--text-muted);font-size:13px;background:rgba(35,31,56,.5);border-radius:10px;border:1px dashed rgba(255,255,255,.08)">No questions yet. Import from a quest or add manually.</div>';
  return qs.map((q, qi) => `
  <div class="qb-block" id="wbqb-${qi}" style="margin-bottom:10px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div style="font-size:12px;font-weight:700;color:#EC4899">Question ${qi + 1}</div>
      <button class="btn btn-danger btn-xs" onclick="wbcRemoveQuestion(${qi})">✕ Remove</button>
    </div>
    <input type="text" value="${q.q || ''}" placeholder="Type your question..." style="width:100%;margin-bottom:10px" oninput="window._wbcDraftQuestions[${qi}].q=this.value">
    <div style="font-size:10px;color:var(--text-muted);margin-bottom:8px">Click ● to mark correct</div>
    ${(q.opts || ['', '', '', '']).map((opt, oi) => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <div onclick="window._wbcDraftQuestions[${qi}].answer=${oi};document.getElementById('wbq-list').innerHTML=_wbcRenderQuestionList(window._wbcDraftQuestions)"
        style="width:22px;height:22px;border-radius:50%;border:2px solid ${q.answer === oi ? '#4edea3' : 'rgba(255,255,255,.15)'};background:${q.answer === oi ? 'rgba(78,222,163,.2)' : ''};cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:10px">${q.answer === oi ? '✓' : ''}</div>
      <input type="text" value="${opt || ''}" placeholder="Option ${String.fromCharCode(65 + oi)}" style="flex:1" oninput="window._wbcDraftQuestions[${qi}].opts[${oi}]=this.value">
    </div>`).join('')}
  </div>`).join('');
}

window.wbcAddQuestion = function (bossIdx) {
  if (!window._wbcDraftQuestions) window._wbcDraftQuestions = [];
  window._wbcDraftQuestions.push({ q: '', opts: ['', '', '', ''], answer: 0 });
  document.getElementById('wbq-list').innerHTML = _wbcRenderQuestionList(window._wbcDraftQuestions);
};

window.wbcRemoveQuestion = function (qi) {
  if (!window._wbcDraftQuestions) return;
  window._wbcDraftQuestions.splice(qi, 1);
  document.getElementById('wbq-list').innerHTML = _wbcRenderQuestionList(window._wbcDraftQuestions);
};

window.wbcImportFromQuiz = function (bossIdx) {
  const quizId = document.getElementById('wbq-import-quiz')?.value;
  if (!quizId) { toast('Select a quest first', '#ffb4ab'); return; }
  const quiz = (DB.quizzes || []).find(q => q.id === quizId);
  if (!quiz) return;
  window._wbcDraftQuestions = JSON.parse(JSON.stringify(quiz.questions));
  document.getElementById('wbq-list').innerHTML = _wbcRenderQuestionList(window._wbcDraftQuestions);
  toast(`✅ Imported ${quiz.questions.length} questions from "${quiz.title}"`, '#4edea3');
};

window.wbcSaveQuestions = function (bossIdx) {
  DB = loadDB();
  const boss = DB.bossEvents[bossIdx];
  if (!boss) return;
  const qs = window._wbcDraftQuestions || [];
  const emptyQIdx = qs.findIndex(q => !q.q.trim());
  if (emptyQIdx !== -1) { toast(`❌ Question ${emptyQIdx + 1} has no text`, '#ffb4ab'); const el = document.getElementById('wbqb-' + emptyQIdx); if (el) { el.style.border = '1.5px solid #ef4444'; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } return; }
  for (let qi = 0; qi < qs.length; qi++) {
    const emptyOptIdx = (qs[qi].opts || []).findIndex(o => !o.trim());
    if (emptyOptIdx !== -1) { toast(`❌ Q${qi + 1} Option ${String.fromCharCode(65 + emptyOptIdx)} is empty`, '#ffb4ab'); const el = document.getElementById('wbqb-' + qi); if (el) { el.style.border = '1.5px solid #ef4444'; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } return; }
  }
  boss.bossQuestions = qs;
  saveDB(); closeModalForce();
  toast(`✅ ${qs.length} questions saved to "${boss.name}"!`, '#EC4899');
  renderAdminBossEvents();
};

// ── Boss form helpers ──────────────────────────────────────────────────────────

window.bossFormSetDiff = function (d) {
  window._bossDraft.difficulty = d;
  const wrap = document.getElementById('bf-diff-wrap');
  if (!wrap) return;
  wrap.querySelectorAll('.diff-btn').forEach(btn => {
    btn.className = 'diff-btn';
    if (btn.textContent.trim() === d) btn.classList.add(diffClass(d));
  });
};

window.clearFieldErr = function (input, errId) {
  input.classList.remove('input-error');
  const el = document.getElementById(errId);
  if (el) el.classList.remove('show');
};

window.showFieldErr = function (fieldId, errId) {
  const inp = document.getElementById(fieldId);
  const err = document.getElementById(errId);
  if (inp) inp.classList.add('input-error');
  if (err) err.classList.add('show');
};

// ── Boss form save ────────────────────────────────────────────────────────────

// ── Spawn section (BUGFIX: bosses used to silently inherit whichever
// section the teacher's deck happened to have "active" — window.ActiveSection
// — with no way to see or choose it up front. That could land a boss in a
// section this teacher doesn't even advise, which boss_events' own RLS write
// policy (is_staff_for_section) then correctly rejects at save time as a
// "new row violates row-level security policy" error. This lists only
// sections the current account is actually allowed to write to, so the
// dropdown and the RLS check always agree. ──────────────────────────────────
function _wbSpawnableSections() {
  const state = (typeof AppStore !== 'undefined') ? AppStore.getState() : {};
  const uid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
  const isAdmin = (typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin');
  const sections = (state.classSections || []).filter(s => !s.archived);

  if (!sections.length) {
    // Section Maker hasn't been used yet — same derive-from-students
    // fallback every other class dropdown in the app uses.
    const ids = window.getActiveClassIds ? window.getActiveClassIds(state) : ['default-class'];
    return ids.map(id => ({ id, label: id }));
  }

  const mine = isAdmin ? sections : sections.filter(s => s.adviserId === uid);
  return mine.map(s => ({ id: s.id, label: 'Grade ' + s.gradeLevel + ' – ' + s.sectionName }));
}

window.saveBossForm = function () {
  const d = window._bossDraft;
  if (!d) return;
  // BUGFIX (double-submit race): this button has no disable/loading guard
  // (unlike login/logout, which use eqButtonLoading), so a fast double-click
  // could run this function twice before closeModalForce() removes the
  // modal — pushing the SAME boss into DB.bossEvents twice in quick
  // succession. Whichever copy's autosave cycle fires first can race the
  // debounced persist layer and reach Supabase before every field (notably
  // currentHp, set further down) is guaranteed settled, occasionally
  // tripping the current_hp NOT NULL constraint before a later cycle with
  // the complete object corrects it. A simple reentrancy guard, cleared
  // once this run finishes, makes a second click within the same tick a
  // no-op instead of a race.
  if (window._bossFormSaving) return;
  window._bossFormSaving = true;
  try {
  d.name        = (document.getElementById('bf-name')?.value || '').trim();
  d.description = (document.getElementById('bf-desc')?.value || '').trim();
  d.classId     = document.getElementById('bf-section')?.value || d.classId || 'default-class';
  const libId   = (document.getElementById('bf-library-id')?.value || '').trim();
  d._bossLibraryId = libId || null;
  if (libId) {
    const linked = typeof bsGet === 'function' ? bsGet(libId) : null;
    if (linked) {
      const artSrc = bveGetArtSrc(linked);
      // Pending Fixes Report §2b: prefer the Storage-backed public URL over
      // an embedded base64 blob. `linked.artwork` is the RAW (unresolved)
      // library entry — bsGet() only resolves idb: refs back into data-URLs
      // for on-screen preview when the local IndexedDB has a cached hit
      // (bveGetArtSrc()'s "art.value" here can already be a large data-URL
      // via that resolve path), so we check the raw artwork record's own
      // `remoteUrl` field directly rather than artSrc.value. Falls back to
      // the old resolved-value behavior when the Storage upload hasn't
      // completed yet (just-uploaded offline, or still in flight) — no
      // regression, same result as before this fix in that case.
      const remoteArtUrl = linked.artwork && linked.artwork.type === 'upload' ? linked.artwork.remoteUrl : null;
      d.image = remoteArtUrl
        ? remoteArtUrl
        : (artSrc.type === 'emoji' ? artSrc.value : (artSrc.type === 'img' ? artSrc.value : '💀'));
      const vis    = linked.visual || {};
      d._themeColor = vis.themeColor || '#8b5cf6';
      d._auraColor  = vis.auraColor  || '#EC4899';
      d._cardAccent = vis.cardAccent || '#d0bcff';
    }
  } else {
    d.image = (document.getElementById('bf-img')?.value || '').trim();
  }
  d.maxHp               = parseInt(document.getElementById('bf-maxhp')?.value) || 0;
  d.startDate           = document.getElementById('bf-start')?.value || '';
  d.endDate             = document.getElementById('bf-end')?.value   || '';
  d.xpReward            = parseInt(document.getElementById('bf-xp')?.value)       || 0;
  d.coinReward          = parseInt(document.getElementById('bf-coins')?.value)     || 0;
  d.participationReward = parseInt(document.getElementById('bf-part')?.value)      || 0;
  d.victoryReward       = parseInt(document.getElementById('bf-victory')?.value)   || 0;
  d.defeatNarrTitle     = (document.getElementById('bf-narr-title')?.value || '').trim();
  d.defeatNarrText      = (document.getElementById('bf-narr-text')?.value  || '').trim();
  d.victoryTitle        = (document.getElementById('bf-vic-title')?.value  || '').trim();
  d.victoryMessage      = (document.getElementById('bf-vic-msg')?.value    || '').trim();

  let valid = true;
  if (!d.classId)                              { toast('⚠️ You need an active section to spawn a boss into — create one in Section Maker first.', '#ffb4ab'); valid = false; }
  if (!d.name)                                 { showFieldErr('bf-name',  'bf-name-err');  valid = false; }
  if (!d.image && !d._bossLibraryId)           { toast('⚠️ Please link a Boss Studio profile or add an emoji/image', '#ffb4ab'); valid = false; }
  if (!d.maxHp || d.maxHp < 1)                { showFieldErr('bf-maxhp', 'bf-hp-err');   valid = false; }
  if (!d.startDate)                            { showFieldErr('bf-start', 'bf-start-err'); valid = false; }
  if (!d.endDate)                              { showFieldErr('bf-end',   'bf-end-err');   valid = false; }
  if (d.startDate && d.endDate && d.endDate <= d.startDate) { showFieldErr('bf-end', 'bf-end-err'); valid = false; }
  if (d.xpReward < 0)                         { showFieldErr('bf-xp',    'bf-xp-err');    valid = false; }
  if (d.coinReward < 0)                        { showFieldErr('bf-coins', 'bf-coins-err'); valid = false; }
  if (d.participationReward < 0)               { showFieldErr('bf-part',  'bf-part-err');  valid = false; }
  if (d.victoryReward < 0)                     { showFieldErr('bf-victory','bf-victory-err'); valid = false; }
  if (!valid) { toast('⚠️ Please fix the highlighted fields', '#ffb4ab'); return; }

  // BUGFIX: was `d.currentHp === undefined` only — didn't cover null/0/NaN,
  // any of which would still reach the upsert as an invalid current_hp.
  // maxHp is guaranteed >= 1 here (validated above), so this is always safe.
  if (d._index === null || !d.currentHp || d.currentHp < 1) d.currentHp = d.maxHp;

  const isEdit  = d._index !== null;
  const saveObj = { ...d };
  delete saveObj._index;
  if (!DB.bossEvents) DB.bossEvents = [];
  if (isEdit) { DB.bossEvents[d._index] = saveObj; toast('✅ Boss "' + saveObj.name + '" updated!'); }
  else        {
    // Uses whatever the "Spawn Section" dropdown had selected (see
    // _wbSpawnableSections() / the #bf-section field above) — falls back to
    // ActiveSection only in the unlikely case the field wasn't rendered.
    saveObj.classId   = d.classId || (window.ActiveSection ? window.ActiveSection.get() : (DB.admin?.classId || 'default-class'));
    saveObj.status    = 'draft';
    saveObj.createdAt = Date.now();
    DB.bossEvents.push(saveObj);
    toast('💀 Boss "' + saveObj.name + '" created!');
  }
  saveDB(); closeModalForce(); renderAdminBossEvents();
  } finally {
    window._bossFormSaving = false;
  }
};

// ── Boss form open ────────────────────────────────────────────────────────────

window.openBossForm = function (bossIndex) {
  const isEdit     = bossIndex !== null && bossIndex !== undefined;
  const boss       = isEdit ? { ...DB.bossEvents[bossIndex] } : {
    name: '', description: '', image: '💀', maxHp: 10000, currentHp: 10000,
    startDate: '', endDate: '', difficulty: 'Normal',
    xpReward: 500, coinReward: 250, participationReward: 100, victoryReward: 300,
    lootRewards: wblrDefaultRewards(), status: 'draft', createdAt: Date.now(),
  };
  window._bossDraft = { ...boss, _index: isEdit ? bossIndex : null };
  const diffOptions  = ['Easy', 'Normal', 'Hard', 'Legendary'];
  const emojiPresets = ['💀','👾','🐉','👹','🧙','🦹','🤖','👺','🦄','🌋','⚡','🌑','🔱','🧿','👁️'];
  const linked = boss._bossLibraryId ? (typeof bsGet === 'function' ? bsGet(boss._bossLibraryId) : null) : null;

  let visualSection;
  if (linked) {
    const artSrc = bveGetArtSrc(linked);
    const artThumb = artSrc.type === 'img'
      ? `<img src="${_esc(artSrc.value)}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;" onerror="this.parentElement.textContent='💀'">`
      : (artSrc.type === 'emoji' ? artSrc.value : '💀');
    visualSection = `
    <div id="bf-linked-profile-card" style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:linear-gradient(135deg,rgba(236,72,153,0.08),rgba(139,92,246,0.06));border:1.5px solid rgba(236,72,153,0.35);border-radius:14px;margin-bottom:12px">
      <div style="width:64px;height:64px;border-radius:12px;border:1.5px solid rgba(236,72,153,0.4);background:rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;font-size:32px">${artThumb}</div>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--fh);font-size:14px;font-weight:900;color:var(--on-surface)">${_esc(linked.name || 'Unnamed Boss')}</div>
        <div style="font-size:11px;color:rgba(236,72,153,0.8);font-weight:700;margin-top:2px"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:middle">link</span> Boss Studio Profile Linked</div>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" onclick="bfUnlinkProfile()"><span class="material-symbols-outlined" style="font-size:14px">link_off</span> Change</button>
    </div>
    <input type="hidden" id="bf-library-id" value="${_esc(boss._bossLibraryId || '')}">
    <input type="hidden" id="bf-img" value="${_esc(boss.image || '💀')}">
    <div style="font-size:11px;color:var(--text-muted);line-height:1.6;background:rgba(78,222,163,0.05);border:1px solid rgba(78,222,163,0.15);border-radius:8px;padding:8px 12px">✅ Visual identity is sourced from this Boss Studio profile.</div>`;
  } else {
    visualSection = `
    <div id="bf-linked-profile-card" style="display:none"></div>
    <input type="hidden" id="bf-library-id" value="">
    <input type="hidden" id="bf-img" value="${_esc(boss.image || '💀')}">
    <div id="bf-no-profile-state">
      <div style="font-size:12px;color:var(--text-muted);line-height:1.6;margin-bottom:14px">Select a Boss Studio profile to link this event to a full visual identity.</div>
      <button type="button" class="btn btn-primary" onclick="bfOpenLibraryPicker()" style="background:linear-gradient(135deg,rgba(236,72,153,0.8),rgba(139,92,246,0.8));width:100%;padding:12px;font-family:var(--fh);font-weight:800;font-size:13px;gap:8px">
        <span class="material-symbols-outlined" style="font-size:16px">library_books</span> Browse Boss Library
      </button>
      ${(DB.bossLibrary || []).length === 0 ? `<div style="margin-top:10px;font-size:11px;color:var(--text-muted);text-align:center">No boss profiles yet. <button type="button" class="btn btn-ghost btn-xs" onclick="closeModalForce();navTo('a-boss-studio')" style="margin-left:4px">Open Boss Studio →</button></div>` : ''}
    </div>
    <div style="margin-top:10px;text-align:center"><button type="button" style="background:none;border:none;font-size:11px;color:var(--text-muted);cursor:pointer;text-decoration:underline" onclick="bfSkipLibraryLink()">Or use a simple emoji/image instead (legacy)</button></div>
    <div id="bf-legacy-visual" style="display:none;margin-top:12px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div id="bf-img-preview" style="width:52px;height:52px;border-radius:12px;background:linear-gradient(135deg,rgba(236,72,153,0.2),rgba(139,92,246,0.15));border:1.5px solid rgba(236,72,153,0.3);display:flex;align-items:center;justify-content:center;font-size:28px">${(boss.image && (boss.image.startsWith('http') || boss.image.startsWith('data:'))) ? `<img src="${boss.image}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;">` : (boss.image || '💀')}</div>
        <input type="text" id="bf-img-text" value="${boss.image || '💀'}" placeholder="Emoji or image URL" style="flex:1" oninput="document.getElementById('bf-img').value=this.value;window._bossDraft.image=this.value;const p=document.getElementById('bf-img-preview');if(p)p.textContent=this.value||'💀'">
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${emojiPresets.map(e => `<div onclick="(function(e){document.getElementById('bf-img').value=e;if(document.getElementById('bf-img-text'))document.getElementById('bf-img-text').value=e;const p=document.getElementById('bf-img-preview');if(p)p.textContent=e;window._bossDraft.image=e;})('${e}')" style="width:34px;height:34px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer">${e}</div>`).join('')}</div>
      <button type="button" class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="document.getElementById('bf-legacy-visual').style.display='none';document.getElementById('bf-no-profile-state')&&(document.getElementById('bf-no-profile-state').style.display='block')">← Back to Library Picker</button>
    </div>`;
  }

  const spawnSections = _wbSpawnableSections();
  const lockSection    = isEdit && boss.status && boss.status !== 'draft';
  const currentSectionId = boss.classId || (window.ActiveSection ? window.ActiveSection.get() : 'default-class');

  showModal(`
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
    <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,rgba(236,72,153,0.25),rgba(139,92,246,0.2));border:1px solid rgba(236,72,153,0.4);display:flex;align-items:center;justify-content:center;font-size:20px">${isEdit ? '✏️' : '＋'}</div>
    <div><div class="modal-h2" style="margin-bottom:2px">${isEdit ? 'Edit Boss' : 'Create Boss'}</div><div style="font-size:12px;color:var(--text-muted)">Configure the World Boss raid event settings</div></div>
  </div>
  <div class="boss-form-section">
    <div class="boss-form-section-title">💀 Basic Info</div>
    <div class="form-group" style="margin-bottom:12px"><label class="form-label">Boss Name <span style="color:#EC4899">*</span></label><input type="text" id="bf-name" value="${boss.name || ''}" placeholder="e.g. The Void Tyrant" style="width:100%" oninput="window._bossDraft.name=this.value;clearFieldErr(this,'bf-name-err')"><div class="field-err" id="bf-name-err">Boss name is required</div></div>
    <div class="form-group" style="margin-bottom:12px"><label class="form-label">Boss Description</label><textarea id="bf-desc" rows="3" placeholder="Describe the boss lore and threat…" style="width:100%;resize:vertical" oninput="window._bossDraft.description=this.value">${boss.description || ''}</textarea></div>
    <div class="form-group" style="margin-bottom:0">
      <label class="form-label">Spawn Section <span style="color:#EC4899">*</span></label>
      <select id="bf-section" style="width:100%" ${lockSection ? 'disabled' : ''} onchange="window._bossDraft.classId=this.value">
        ${spawnSections.map(s => `<option value="${_esc(s.id)}" ${currentSectionId === s.id ? 'selected' : ''}>${_esc(s.label)}</option>`).join('')}
      </select>
      ${!spawnSections.length ? `<div style="font-size:11px;color:#ffb4ab;margin-top:6px">You don't advise any active sections yet — create one in Section Maker first.</div>` : ''}
      ${lockSection ? `<div style="font-size:11px;color:var(--text-muted);margin-top:6px">🔒 Section is locked once a boss has left Draft — this boss shouldn't jump sections mid-event.</div>` : `<div style="font-size:11px;color:var(--text-muted);margin-top:6px">This boss will only be visible to students in the section you pick — no cross-section spawns.</div>`}
    </div>
  </div>
  <div class="boss-form-section" id="bf-visual-section"><div class="boss-form-section-title">🎨 Boss Visual Identity</div>${visualSection}</div>
  <div class="boss-form-section">
    <div class="boss-form-section-title">⚔️ Combat Stats</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group" style="margin:0"><label class="form-label">Max HP <span style="color:#EC4899">*</span></label><input type="number" id="bf-maxhp" value="${boss.maxHp || 10000}" min="1" max="9999999" style="width:100%" oninput="window._bossDraft.maxHp=parseInt(this.value)||1;window._bossDraft.currentHp=window._bossDraft.maxHp;clearFieldErr(this,'bf-hp-err')"><div class="field-err" id="bf-hp-err">Max HP must be at least 1</div></div>
      <div class="form-group" style="margin:0"><label class="form-label">Difficulty <span style="color:#EC4899">*</span></label><div class="diff-selector" id="bf-diff-wrap">${diffOptions.map(d => `<div class="diff-btn${(boss.difficulty || 'Normal') === d ? ' ' + diffClass(d) : ''}" onclick="bossFormSetDiff('${d}')">${d}</div>`).join('')}</div></div>
    </div>
  </div>
  <div class="boss-form-section">
    <div class="boss-form-section-title">📅 Event Schedule</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group" style="margin:0"><label class="form-label">Start Date <span style="color:#EC4899">*</span></label><input type="date" id="bf-start" value="${boss.startDate || ''}" style="width:100%" onchange="window._bossDraft.startDate=this.value;clearFieldErr(this,'bf-start-err')"><div class="field-err" id="bf-start-err">Start date is required</div></div>
      <div class="form-group" style="margin:0"><label class="form-label">End Date <span style="color:#EC4899">*</span></label><input type="date" id="bf-end" value="${boss.endDate || ''}" style="width:100%" onchange="window._bossDraft.endDate=this.value;clearFieldErr(this,'bf-end-err')"><div class="field-err" id="bf-end-err">End date is required (and must be after start)</div></div>
    </div>
  </div>
  <div class="boss-form-section">
    <div class="boss-form-section-title">🏆 Rewards</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div class="form-group" style="margin:0"><label class="form-label">⚡ XP Reward *</label><input type="number" id="bf-xp" value="${boss.xpReward || 500}" min="0" style="width:100%" oninput="window._bossDraft.xpReward=parseInt(this.value)||0;clearFieldErr(this,'bf-xp-err')"><div class="field-err" id="bf-xp-err">XP reward must be 0 or more</div></div>
      <div class="form-group" style="margin:0"><label class="form-label">🪙 Coin Reward *</label><input type="number" id="bf-coins" value="${boss.coinReward || 250}" min="0" style="width:100%" oninput="window._bossDraft.coinReward=parseInt(this.value)||0;clearFieldErr(this,'bf-coins-err')"><div class="field-err" id="bf-coins-err">Coin reward must be 0 or more</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group" style="margin:0"><label class="form-label">🎖️ Participation *</label><input type="number" id="bf-part" value="${boss.participationReward || 100}" min="0" style="width:100%" oninput="window._bossDraft.participationReward=parseInt(this.value)||0;clearFieldErr(this,'bf-part-err')"><div class="field-err" id="bf-part-err">Must be 0 or more</div><div style="font-size:10px;color:var(--text-muted);margin-top:5px">Given to all who dealt damage</div></div>
      <div class="form-group" style="margin:0"><label class="form-label">🏆 Victory Reward *</label><input type="number" id="bf-victory" value="${boss.victoryReward || 300}" min="0" style="width:100%" oninput="window._bossDraft.victoryReward=parseInt(this.value)||0;clearFieldErr(this,'bf-victory-err')"><div class="field-err" id="bf-victory-err">Must be 0 or more</div><div style="font-size:10px;color:var(--text-muted);margin-top:5px">Given when boss is defeated</div></div>
    </div>
  </div>
  <div class="boss-form-section">
    <div class="boss-form-section-title">🏆 Victory Screen Content</div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:14px;line-height:1.6;background:rgba(255,185,95,0.05);border:1px solid rgba(255,185,95,0.15);border-radius:8px;padding:10px 12px"><span style="color:#ffb95f;font-weight:700">Optional.</span> Customize what appears in the overlay when the boss is defeated.</div>
    <div style="background:rgba(236,72,153,0.05);border:1px solid rgba(236,72,153,0.18);border-radius:12px;padding:14px 16px;margin-bottom:14px">
      <div style="font-family:var(--fm);font-size:9px;color:#EC4899;letter-spacing:.14em;margin-bottom:12px">DEFEAT NARRATION</div>
      <div class="form-group" style="margin-bottom:10px"><label class="form-label">Narration Title</label><input type="text" id="bf-narr-title" value="${boss.defeatNarrTitle || ''}" placeholder="e.g. ANCIENT DRAGON FALLS" style="width:100%" oninput="window._bossDraft.defeatNarrTitle=this.value"></div>
      <div class="form-group" style="margin-bottom:0"><label class="form-label">Narration Text (use \\n for line breaks)</label><textarea id="bf-narr-text" rows="3" style="width:100%;resize:vertical" oninput="window._bossDraft.defeatNarrText=this.value">${boss.defeatNarrText || ''}</textarea></div>
    </div>
    <div style="background:rgba(139,92,246,0.05);border:1px solid rgba(139,92,246,0.18);border-radius:12px;padding:14px 16px">
      <div style="font-family:var(--fm);font-size:9px;color:var(--primary);letter-spacing:.14em;margin-bottom:12px">VICTORY SCREEN</div>
      <div class="form-group" style="margin-bottom:10px"><label class="form-label">Victory Title</label><input type="text" id="bf-vic-title" value="${boss.victoryTitle || ''}" placeholder="e.g. BOSS DEFEATED!" style="width:100%" oninput="window._bossDraft.victoryTitle=this.value"></div>
      <div class="form-group" style="margin-bottom:0"><label class="form-label">Victory Message</label><textarea id="bf-vic-msg" rows="2" style="width:100%;resize:vertical" oninput="window._bossDraft.victoryMessage=this.value">${boss.victoryMessage || ''}</textarea></div>
    </div>
  </div>
  <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:4px">
    <button class="btn btn-ghost" onclick="closeModalForce()">Cancel</button>
    <button class="btn btn-primary" onclick="saveBossForm()" style="background:linear-gradient(135deg,#EC4899,#9333ea);box-shadow:0 4px 16px rgba(236,72,153,.3)">${isEdit ? '✅ Save Changes' : '＋ Create Boss'}</button>
  </div>`, 'lg');
};

// ── Boss Library Picker ───────────────────────────────────────────────────────

var _bflpSelected = null;

window.bfOpenLibraryPicker = function () {
  if (typeof _bveBsLoad === 'function') _bveBsLoad();
  _bflpSelected = window._bossDraft && window._bossDraft._bossLibraryId || null;
  _bflpRenderModal();
};

function _bflpRenderModal() {
  const library  = DB.bossLibrary || [];
  const existing = document.getElementById('bflp-overlay');
  if (existing) existing.remove();
  const overlay  = document.createElement('div');
  overlay.id     = 'bflp-overlay';
  overlay.className = 'bflp-overlay';
  overlay.innerHTML = `
  <div class="bflp-panel" onclick="event.stopPropagation()">
    <div class="bflp-header">
      <div class="bflp-header-icon">🏰</div>
      <div class="bflp-header-info"><div class="bflp-header-title">Boss Library</div><div class="bflp-header-sub">Select a Boss Studio profile to power this World Boss event</div></div>
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('bflp-overlay').remove()"><span class="material-symbols-outlined" style="font-size:16px">close</span></button>
    </div>
    <div class="bflp-search"><div class="bflp-search-inner"><span class="material-symbols-outlined" style="font-size:16px;color:var(--text-muted)">search</span><input type="text" id="bflp-search-inp" placeholder="Search by name, theme, or tag…" oninput="_bflpRefreshGrid(this.value)" autocomplete="off"></div></div>
    <div class="bflp-grid" id="bflp-grid">${_bflpBuildCards(library, _bflpSelected, '')}</div>
    <div class="bflp-footer">
      <div class="bflp-selected-name" id="bflp-sel-label">${_bflpSelected ? ('✅ ' + _esc((DB.bossLibrary || []).find(b => b.id === _bflpSelected)?.name || 'Selected')) : 'No boss selected'}</div>
      <button class="btn btn-ghost" onclick="document.getElementById('bflp-overlay').remove()">Cancel</button>
      <button class="btn btn-primary" id="bflp-confirm-btn" style="background:linear-gradient(135deg,#EC4899,#9333ea)" ${_bflpSelected ? '' : 'disabled'} onclick="_bflpConfirmSelection()"><span class="material-symbols-outlined" style="font-size:16px">check</span> Use This Boss</button>
    </div>
  </div>`;
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

function _bflpBuildCards(library, selectedId, query) {
  let filtered = library;
  if (query.trim()) {
    const q = query.trim().toLowerCase();
    filtered = library.filter(b => (b.name || '').toLowerCase().includes(q) || (b.description || '').toLowerCase().includes(q) || (b.tags || []).some(t => t.toLowerCase().includes(q)));
  }
  if (!filtered.length) {
    return `<div class="bflp-empty"><div class="bflp-empty-icon">${query ? '🔍' : '🏰'}</div><div class="bflp-empty-title">${query ? 'No Results' : 'No Boss Profiles'}</div><div class="bflp-empty-sub">${query ? 'Try a different search term.' : 'Create boss profiles in Boss Studio first.'}</div>${!query ? `<button class="btn btn-primary btn-sm" onclick="document.getElementById('bflp-overlay').remove();closeModalForce();navTo('a-boss-studio')">Open Boss Studio</button>` : ''}</div>`;
  }
  return filtered.map(boss => {
    const sel    = boss.id === selectedId;
    const artSrc = bveGetArtSrc(boss);
    const theme  = (boss.visual && boss.visual.themeColor) || '#8b5cf6';
    const aura   = (boss.visual && boss.visual.auraColor)  || '#EC4899';
    const accent = (boss.visual && boss.visual.cardAccent)  || '#d0bcff';
    let artHTML  = '';
    if (artSrc.type === 'emoji') artHTML = `<div class="bflp-card-art-emoji">${artSrc.value}</div>`;
    else if (artSrc.type === 'img') artHTML = `<div class="bflp-card-art-img-wrap"><img class="bflp-card-art-img" src="${_esc(artSrc.value)}" alt="${_esc(boss.name)}" onerror="this.style.display='none'"></div>`;
    else artHTML = `<div class="bflp-card-art-placeholder"><span class="material-symbols-outlined">image_not_supported</span></div>`;
    return `
    <div class="bflp-card ${sel ? 'selected' : ''}" onclick="_bflpSelectCard('${_esc(boss.id)}',this)" style="--bve-theme:${theme};--bve-aura:${aura};--bve-accent:${accent}">
      <div class="bflp-card-check"><span class="material-symbols-outlined">check</span></div>
      <div class="bflp-card-art" style="background:radial-gradient(circle at 50% 60%,${aura}22,transparent 72%),#08071a"><div class="bflp-card-art-aura" style="background:radial-gradient(ellipse at center,${aura}44 0%,${theme}18 60%,transparent 100%)"></div>${artHTML}</div>
      <div class="bflp-card-body">
        <div class="bflp-card-name" style="color:${accent}">${_esc(boss.name || 'Unnamed Boss')}</div>
        <div class="bflp-card-tags">${(boss.tags || []).slice(0, 3).map(t => `<span class="bflp-card-tag" style="color:${accent};border-color:${theme}44">${_esc(t)}</span>`).join('')}</div>
      </div>
    </div>`;
  }).join('');
}

window._bflpRefreshGrid = function (query) {
  const grid = document.getElementById('bflp-grid');
  if (!grid) return;
  if (typeof _bveBsLoad === 'function') _bveBsLoad();
  grid.innerHTML = _bflpBuildCards(DB.bossLibrary || [], _bflpSelected, query);
};

window._bflpSelectCard = function (id, el) {
  _bflpSelected = id;
  document.querySelectorAll('.bflp-card').forEach(c => c.classList.remove('selected'));
  if (el) el.classList.add('selected');
  const lbl  = document.getElementById('bflp-sel-label');
  const btn  = document.getElementById('bflp-confirm-btn');
  const boss = (DB.bossLibrary || []).find(b => b.id === id);
  if (lbl) lbl.textContent = boss ? ('✅ ' + boss.name) : 'No boss selected';
  if (btn) btn.disabled = !id;
};

window._bflpConfirmSelection = function () {
  if (!_bflpSelected) return;
  const boss = typeof _bveBsGet === 'function' ? _bveBsGet(_bflpSelected) : null;
  if (!boss) { toast('❌ Profile not found', '#ffb4ab'); return; }
  if (window._bossDraft) {
    window._bossDraft._bossLibraryId = _bflpSelected;
    const artSrc = bveGetArtSrc(boss);
    window._bossDraft.image = artSrc.type === 'emoji' ? artSrc.value : (artSrc.type === 'img' ? artSrc.value : '💀');
    const vis = boss.visual || {};
    window._bossDraft._themeColor = vis.themeColor || '#8b5cf6';
    window._bossDraft._auraColor  = vis.auraColor  || '#EC4899';
    window._bossDraft._cardAccent = vis.cardAccent  || '#d0bcff';
  }
  document.getElementById('bflp-overlay')?.remove();
  _bflpUpdateFormAfterSelect(boss);
  toast(`✅ Linked "${boss.name}"`, '#4edea3');
};

function _bflpUpdateFormAfterSelect(boss) {
  const section = document.getElementById('bf-visual-section');
  if (!section) return;
  const artSrc = bveGetArtSrc(boss);
  const vis    = boss.visual || {};
  const theme  = vis.themeColor || '#8b5cf6';
  const aura   = vis.auraColor  || '#EC4899';
  const accent = vis.cardAccent  || '#d0bcff';
  let artThumb = artSrc.type === 'emoji' ? `<span style="font-size:32px;line-height:1">${artSrc.value}</span>`
    : artSrc.type === 'img' ? `<img src="${_esc(artSrc.value)}" style="width:100%;height:100%;object-fit:contain" alt="">`
    : '<span style="font-size:32px">💀</span>';
  section.querySelector('#bf-library-id').value = boss.id;
  section.querySelector('#bf-img').value = artSrc.type === 'emoji' ? artSrc.value : (artSrc.type === 'img' ? artSrc.value : '💀');
  const card = document.getElementById('bf-linked-profile-card');
  if (card) {
    card.style.display = 'flex';
    card.innerHTML = `
    <div style="width:64px;height:64px;border-radius:12px;border:1.5px solid rgba(236,72,153,0.4);background:${aura}18;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0">${artThumb}</div>
    <div style="flex:1;min-width:0">
      <div style="font-family:var(--fh);font-size:14px;font-weight:900;color:${accent}">${_esc(boss.name || 'Unnamed Boss')}</div>
      <div style="font-size:11px;color:rgba(236,72,153,0.8);font-weight:700;margin-top:2px"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:middle">link</span> Boss Studio Profile Linked</div>
      ${boss.tags && boss.tags.length ? `<div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap">${boss.tags.slice(0, 3).map(t => `<span style="font-size:9px;padding:2px 7px;border-radius:6px;background:${theme}18;border:1px solid ${theme}33;color:${accent}">${_esc(t)}</span>`).join('')}</div>` : ''}
    </div>
    <button type="button" class="btn btn-ghost btn-sm" onclick="bfUnlinkProfile()"><span class="material-symbols-outlined" style="font-size:14px">link_off</span> Change</button>`;
  }
  const noState = document.getElementById('bf-no-profile-state');
  if (noState) noState.style.display = 'none';
  const legacy = document.getElementById('bf-legacy-visual');
  if (legacy) legacy.style.display = 'none';
}

window.bfUnlinkProfile = function () {
  if (window._bossDraft) window._bossDraft._bossLibraryId = null;
  const card    = document.getElementById('bf-linked-profile-card');
  if (card)     card.style.display = 'none';
  const noState = document.getElementById('bf-no-profile-state');
  if (noState)  noState.style.display = 'block';
  const libId   = document.getElementById('bf-library-id');
  if (libId)    libId.value = '';
};

window.bfSkipLibraryLink = function () {
  const noState = document.getElementById('bf-no-profile-state');
  if (noState) noState.style.display = 'none';
  const legacy  = document.getElementById('bf-legacy-visual');
  if (legacy)   legacy.style.display = 'block';
};
