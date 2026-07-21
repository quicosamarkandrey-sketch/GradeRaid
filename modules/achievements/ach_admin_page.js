// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/achievements/admin-page.js
//  Admin Achievement Management: list, create/edit, toggle, duplicate, delete,
//  preview, grant/revoke, and category management.
// ═══════════════════════════════════════════════════════════════════════════════

// Phase 16 — selected class_ids for the create/edit form's "assign to
// section(s)" picker. Kept separate from the form fields read directly off
// the DOM in achAdminSave(), since a <select multiple>'s value isn't read
// via a single .value the way every other field here is; set on open,
// updated via onchange, read back in achAdminSave().
let draftAchSections = [];

/**
 * renderAdminAchievements() → void  [window.renderAdminAchievements]
 * Renders the admin "Badge & Achievement Engine" page into #a-achievements.
 * Shows stats bar, full achievement table with unlock counts, action buttons.
 */
window.renderAdminAchievements = function () {
  DB = loadDB();
  const achs          = DB.achievements || [];
  const cats          = DB.achievementCategories || [];
  const totalStudents = DB.students.length;
  const unlockCounts  = {};
  Object.values(DB.achievementUnlocks || {}).forEach(list => {
    list.forEach(u => { unlockCounts[u.achId] = (unlockCounts[u.achId] || 0) + 1; });
  });

  document.getElementById('a-achievements').innerHTML = `
  <div class="page-hero"><div class="page-hero-bg"></div>
    <div style="position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
      <div>
        <div class="page-hero-label">🏅 Achievement Management</div>
        <h1 style="font-family:var(--fh);font-size:28px;font-weight:900;color:var(--on-surface);margin-bottom:6px">Badge &amp; Achievement Engine</h1>
        <p style="font-size:13px;color:var(--text-muted)">${achs.length} total badges · ${achs.filter(a => a.active).length} active</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="achAdminManageCategories()">🗂 Categories</button>
        <button class="btn btn-ghost btn-sm" onclick="achAdminGrantAchievement()">🎁 Grant/Revoke</button>
        <button class="btn btn-primary" onclick="achAdminOpenForm(null)">+ Create Badge</button>
      </div>
    </div>
  </div>

  <div class="ach-stats-bar" style="margin-bottom:20px">
    <div class="ach-stat-card"><div class="ach-stat-val" style="color:var(--primary)">${achs.length}</div><div class="ach-stat-lbl">Total Badges</div></div>
    <div class="ach-stat-card"><div class="ach-stat-val" style="color:var(--secondary)">${achs.filter(a => a.active).length}</div><div class="ach-stat-lbl">Active</div></div>
    <div class="ach-stat-card"><div class="ach-stat-val" style="color:#ffb95f">${achs.filter(a => a.isHidden).length}</div><div class="ach-stat-lbl">Hidden</div></div>
    <div class="ach-stat-card"><div class="ach-stat-val" style="color:#f472b6">${Object.values(DB.achievementUnlocks || {}).reduce((a, l) => a + l.length, 0)}</div><div class="ach-stat-lbl">Total Unlocks</div></div>
  </div>

  ${achs.length === 0 ? `
  <div style="text-align:center;padding:60px 20px;color:var(--text-muted)">
    <div style="font-size:48px;margin-bottom:12px">🏅</div>
    <div style="font-size:16px;font-weight:700;color:var(--on-surface);margin-bottom:8px">No achievements yet</div>
    <div style="font-size:13px;margin-bottom:20px">Create your first badge to start the achievement engine.</div>
    <button class="btn btn-primary" onclick="achAdminOpenForm(null)">+ Create First Badge</button>
  </div>` : `
  <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:16px;overflow:hidden">
    <table class="ach-admin-table">
      <thead><tr><th>Badge</th><th>Category</th><th>Rarity</th><th>Trigger</th><th>Rewards</th><th>Unlocks</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead>
      <tbody>${achs.map(ach => {
        const rarity       = ACH_RARITY[ach.rarity] || ACH_RARITY.Common;
        const triggerDef   = ACH_TRIGGER_TYPES.find(t => t.value === ach.triggerType) || { label: ach.triggerType || '—' };
        const unlockCount  = unlockCounts[ach.id] || 0;
        const pct          = totalStudents ? Math.round(unlockCount / totalStudents * 100) : 0;
        // Phase 16: section scoping is now live (see achAdminOpenForm's NOTE
        // and student-page.js/engine.js), so surface it here the same way
        // quiz-builder.js's list rows surface quiz section assignment.
        const assignedIds   = (DB.achievementSectionAssignments && DB.achievementSectionAssignments[ach.id]) || [];
        const sectionsLabel = assignedIds.length
          ? assignedIds.map(cid => (typeof getClassLabel === 'function' ? getClassLabel(cid) : cid)).join(', ')
          : 'All sections';
        return `<tr>
          <td><div style="display:flex;align-items:center;gap:10px"><span style="font-size:24px">${ach.icon || '🏅'}</span><div><div style="font-weight:700;color:var(--on-surface);font-size:13px">${_esc(ach.name)}${ach.isHidden ? ' <span style="font-size:9px;opacity:.6">🔒 HIDDEN</span>' : ''}</div><div style="font-size:10px;color:var(--text-muted);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(ach.description || '')}</div><span class="badge-pill ${assignedIds.length ? 'bp-primary' : 'bp-gray'}" style="font-size:9px;margin-top:4px;display:inline-block" title="${_esc(sectionsLabel)}">🏫 ${assignedIds.length ? sectionsLabel : 'All sections'}</span></div></div></td>
          <td><span style="font-size:11px;color:var(--text-muted)">${_esc(ach.category || '—')}</span></td>
          <td><span class="ach-rarity-tag ${achRarityClass(ach.rarity)}" style="font-size:9px">${ach.rarity}</span></td>
          <td><span style="font-size:11px;color:var(--text-muted)">${_esc(triggerDef.label)}${ach.triggerType !== 'manual' && ach.triggerType !== 'all_quests' ? ' ≥ ' + (ach.triggerValue || 0) : ''}</span></td>
          <td><div style="font-size:11px">${(ach.xpReward || 0) > 0 ? `<span style="color:#c4b5fd">+${ach.xpReward} XP</span> ` : ''}${(ach.coinReward || 0) > 0 ? `<span style="color:#ffb95f">+${ach.coinReward}🪙</span>` : ''}${!ach.xpReward && !ach.coinReward ? '<span style="color:var(--text-muted)">None</span>' : ''}</div></td>
          <td><div style="font-size:12px;font-weight:700;color:${rarity.color}">${unlockCount}<span style="color:var(--text-muted);font-weight:400">/${totalStudents}</span></div><div style="font-size:9px;color:var(--text-muted)">${pct}%</div></td>
          <td><span class="${ach.active ? 'badge-pill bp-green' : 'badge-pill bp-red'}" style="font-size:9px">${ach.active ? 'Active' : 'Disabled'}</span></td>
          <td style="text-align:right"><div style="display:flex;gap:5px;justify-content:flex-end;flex-wrap:wrap">
            <button class="btn btn-ghost btn-xs" onclick="achAdminPreview('${ach.id}')" title="Preview">👁</button>
            <button class="btn btn-ghost btn-xs" onclick="achAdminOpenForm('${ach.id}')" title="Edit">✏️</button>
            <button class="btn btn-ghost btn-xs" onclick="achAdminDuplicate('${ach.id}')" title="Duplicate">⧉</button>
            <button class="ach-toggle-btn" style="border-color:${ach.active ? 'rgba(255,128,128,0.3)' : 'rgba(78,222,163,0.3)'};color:${ach.active ? '#ff8080' : '#4edea3'}" onclick="achAdminToggle('${ach.id}')">${ach.active ? 'Disable' : 'Enable'}</button>
            <button class="btn btn-ghost btn-xs" style="color:#ff8080" onclick="achAdminDelete('${ach.id}')" title="Delete">🗑</button>
          </div></td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  </div>`}`;
};

// ── Create / Edit form ────────────────────────────────────────────────────────

window.achAdminOpenForm = function (achId) {
  DB = loadDB();
  const isEdit   = !!achId;
  const existing = isEdit ? (DB.achievements || []).find(a => a.id === achId) : null;
  const cats     = DB.achievementCategories || [];
  const d        = existing || {
    name: '', description: '', icon: '🏅', category: cats[0] || 'Quests',
    rarity: 'Common', xpReward: 50, coinReward: 25,
    isHidden: false, active: true, triggerType: 'quests_completed', triggerValue: 1,
  };

  // Phase 16: pre-generate the id for brand-new badges (same trick
  // quiz-builder.js's draftQuiz.id uses) so the "assign to section(s)"
  // picker below has a stable achievement_id to persist against via
  // set_achievement_sections() the moment the badge is first saved,
  // instead of needing a second round-trip after creation.
  const formAchId = achId || uid();
  draftAchSections = ((DB.achievementSectionAssignments && DB.achievementSectionAssignments[formAchId]) || []).slice();

  // Phase 16: "assign to section(s)" picker — set_achievement_sections()
  // RPC and the achievement_sections junction table have existed since
  // this phase's SQL shipped, but nothing in the admin UI called it yet.
  // Mirrors quiz-builder.js's picker exactly, same sections source
  // (getActiveClassIds/getClassLabel from sections-service.js).
  //
  // NOTE on visibility: this wires the WRITE side (persisting which
  // section(s) a badge is assigned to, synced cross-device via Supabase).
  // The READ side is now wired too — renderBadges() (student-page.js) and
  // achCheckAndAward() (engine.js) both filter/gate on
  // DB.achievementSectionAssignments, so assigning sections here does
  // actually scope who can see and auto-unlock the badge. An achievement
  // with no assigned sections stays global (visible/unlockable by
  // everyone) — assigning it here is what opts it into section scoping.
  // quiz-builder.js's equivalent picker still has its matching read-side
  // gap open for renderStudentQuizzes(); that's a separate, not-yet-done
  // piece of work.
  const activeClassIds = (typeof getActiveClassIds === 'function') ? getActiveClassIds() : [];
  const sectionOpts = activeClassIds.map(cid =>
    `<option value="${cid}" ${draftAchSections.includes(cid) ? 'selected' : ''}>${_esc(typeof getClassLabel === 'function' ? getClassLabel(cid) : cid)}</option>`
  ).join('');

  showModal(`
  <div style="max-width:520px">
    <h2 style="font-family:var(--fh);font-size:20px;font-weight:900;margin-bottom:20px">${isEdit ? 'Edit' : 'Create'} Badge</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div style="grid-column:1/-1"><label class="form-label">Badge Name *</label><input id="ach-f-name" class="form-control" type="text" placeholder="e.g. Quest Warrior" value="${_esc(d.name || '')}" style="width:100%"></div>
      <div style="grid-column:1/-1"><label class="form-label">Description *</label><input id="ach-f-desc" class="form-control" type="text" placeholder="Describe how to earn this badge" value="${_esc(d.description || '')}" style="width:100%"></div>
      <div><label class="form-label">Icon (Emoji)</label><input id="ach-f-icon" class="form-control" type="text" placeholder="🏅" value="${_esc(d.icon || '🏅')}" style="width:100%;font-size:18px"></div>
      <div><label class="form-label">Rarity</label><select id="ach-f-rarity" class="form-control" style="width:100%">${ACH_RARITIES.map(r => `<option value="${r}"${d.rarity === r ? ' selected' : ''}>${r}</option>`).join('')}</select></div>
      <div><label class="form-label">Category</label><select id="ach-f-cat" class="form-control" style="width:100%">${cats.map(c => `<option value="${_esc(c)}"${d.category === c ? ' selected' : ''}>${_esc(c)}</option>`).join('')}</select></div>
      <div><label class="form-label">XP Reward</label><input id="ach-f-xp" class="form-control" type="number" min="0" value="${d.xpReward || 0}" style="width:100%"></div>
      <div><label class="form-label">Coin Reward 🪙</label><input id="ach-f-coins" class="form-control" type="number" min="0" value="${d.coinReward || 0}" style="width:100%"></div>
      <div><label class="form-label">Trigger Type</label><select id="ach-f-trigger" class="form-control" style="width:100%" onchange="achAdminUpdateTriggerHint()">${ACH_TRIGGER_TYPES.map(t => `<option value="${t.value}"${d.triggerType === t.value ? ' selected' : ''}>${t.label}</option>`).join('')}</select></div>
      <div><label class="form-label">Trigger Value</label><input id="ach-f-tval" class="form-control" type="number" min="0" value="${d.triggerValue || 1}" style="width:100%"><div id="ach-trigger-hint" style="font-size:10px;color:var(--text-muted);margin-top:3px">${ACH_TRIGGER_TYPES.find(t => t.value === d.triggerType)?.hint || ''}</div></div>
      <div style="grid-column:1/-1;display:flex;gap:20px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px"><input type="checkbox" id="ach-f-hidden" ${d.isHidden ? 'checked' : ''} style="width:16px;height:16px"> Hidden Achievement <span style="font-size:11px;color:var(--text-muted)">(Students can't see until unlocked)</span></label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px"><input type="checkbox" id="ach-f-active" ${d.active !== false ? 'checked' : ''} style="width:16px;height:16px"> Active</label>
      </div>
      <div style="grid-column:1/-1">
        <label class="form-label">Assign to Section(s)</label>
        ${activeClassIds.length ? `
        <select id="ach-f-sections" multiple style="width:100%;height:96px" onchange="updateDraftAchSections(this)">${sectionOpts}</select>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Hold Ctrl/Cmd to select multiple. Leave empty to leave unassigned (visible to all).</div>
        ` : `
        <div style="font-size:12px;color:var(--text-muted);background:rgba(35,31,56,.5);border-radius:8px;padding:10px 12px">No sections created yet — create one in Section Maker first.</div>
        `}
      </div>
    </div>
    <div id="ach-form-err" style="color:#ff8080;font-size:12px;margin-top:8px;display:none"></div>
    <div style="display:flex;gap:10px;margin-top:20px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" style="flex:1" onclick="achAdminSave('${formAchId}')">${isEdit ? 'Save Changes' : 'Create Badge'}</button>
    </div>
  </div>`, 'md');
};

window.updateDraftAchSections = function (selectEl) {
  draftAchSections = [...selectEl.selectedOptions].map(o => o.value);
};

window.achAdminUpdateTriggerHint = function () {
  const sel  = document.getElementById('ach-f-trigger');
  const hint = document.getElementById('ach-trigger-hint');
  if (sel && hint) { const t = ACH_TRIGGER_TYPES.find(tt => tt.value === sel.value); hint.textContent = t?.hint || ''; }
};

window.achAdminSave = async function (achId) {
  const name        = (document.getElementById('ach-f-name')?.value    || '').trim();
  const desc        = (document.getElementById('ach-f-desc')?.value    || '').trim();
  const icon        = (document.getElementById('ach-f-icon')?.value    || '🏅').trim();
  const cat         = document.getElementById('ach-f-cat')?.value      || 'Quests';
  const rarity      = document.getElementById('ach-f-rarity')?.value   || 'Common';
  const xpReward    = parseInt(document.getElementById('ach-f-xp')?.value)     || 0;
  const coinReward  = parseInt(document.getElementById('ach-f-coins')?.value)  || 0;
  const triggerType = document.getElementById('ach-f-trigger')?.value  || 'quests_completed';
  const triggerValue = parseFloat(document.getElementById('ach-f-tval')?.value) || 1;
  const isHidden    = document.getElementById('ach-f-hidden')?.checked  || false;
  const active      = document.getElementById('ach-f-active')?.checked !== false;
  const errEl       = document.getElementById('ach-form-err');

  if (!name) { if (errEl) { errEl.textContent = 'Badge name is required.'; errEl.style.display = 'block'; } return; }
  if (!desc) { if (errEl) { errEl.textContent = 'Description is required.'; errEl.style.display = 'block'; } return; }
  if (errEl) errEl.style.display = 'none';

  DB = loadDB();
  if (!DB.achievements) DB.achievements = [];
  const idx = DB.achievements.findIndex(a => a.id === achId);
  if (idx >= 0) {
    DB.achievements[idx] = { ...DB.achievements[idx], name, description: desc, icon, category: cat, rarity, xpReward, coinReward, isHidden, active, triggerType, triggerValue };
    toast(`✅ Badge "${name}" updated!`);
  } else {
    // achId was pre-generated by achAdminOpenForm (Phase 16) so the section
    // picker has a stable id to save against on first creation too.
    // Phase 32: stamp the owner so the catalog isolation RLS/RPC checks
    // have something to key against — mirrors shop_admin_store.js's
    // doAddProduct() stamping ownerTeacherId at creation time.
    DB.achievements.push({ id: achId, ownerTeacherId: currentUser.id, name, description: desc, icon, category: cat, rarity, xpReward, coinReward, isHidden, active, triggerType, triggerValue, createdAt: new Date().toISOString() });
    toast(`🏅 Badge "${name}" created!`);
  }
  saveDB(); closeModalForce();
  const sectionIds = draftAchSections.slice();
  renderAdminAchievements();

  // Phase 16: persist the section assignment — set_achievement_sections()
  // only ever touches achievement_sections rows for THIS achievement_id,
  // and only ones the caller could have created themselves, so two
  // teachers assigning the same shared badge to their own different
  // sections can never stomp on each other (see
  // phase16_achievement_sections_rpc.sql). Fire-and-forget like the
  // quiz/shop/mail RPC calls — the badge itself already saved locally,
  // this just syncs who can see it assigned to.
  if (typeof DBService !== 'undefined' && typeof DBService.rpc === 'function') {
    const { error } = await DBService.rpc('set_achievement_sections', { p_achievement_id: achId, p_class_ids: sectionIds });
    if (error) {
      toast('⚠️ Badge saved, but section assignment may not have synced: ' + error.message, '#ffb95f');
    } else {
      if (!DB.achievementSectionAssignments) DB.achievementSectionAssignments = {};
      DB.achievementSectionAssignments[achId] = sectionIds; // optimistic — next realtime pull confirms it
    }
  }
};

// ── Toggle / Delete / Duplicate ───────────────────────────────────────────────

window.achAdminToggle = function (achId) {
  DB = loadDB();
  const idx = (DB.achievements || []).findIndex(a => a.id === achId);
  if (idx < 0) return;
  DB.achievements[idx].active = !DB.achievements[idx].active;
  saveDB();
  toast(DB.achievements[idx].active ? '✅ Badge enabled.' : '⏸ Badge disabled.');
  renderAdminAchievements();
};

window.achAdminDelete = async function (achId) {
  DB = loadDB();
  const ach = (DB.achievements || []).find(a => a.id === achId);
  if (!ach || !confirm(`Delete badge "${ach.name}"? This will also remove all unlock records.`)) return;
  DB.achievements = (DB.achievements || []).filter(a => a.id !== achId);
  Object.keys(DB.achievementUnlocks || {}).forEach(sid => {
    DB.achievementUnlocks[sid] = (DB.achievementUnlocks[sid] || []).filter(u => u.achId !== achId);
  });
  saveDB(); toast('🗑 Badge deleted.', '#ff8080'); renderAdminAchievements();
  // Phase 23: the bulk push is upsert-only and never deletes server rows —
  // without this, the badge (and its section assignments/unlock records)
  // would silently reappear for everyone on the next pull.
  // delete_achievement() is staff-checked the same as achievements' own
  // RLS write policy.
  if (typeof DBService !== 'undefined' && typeof DBService.rpc === 'function') {
    const { error } = await DBService.rpc('delete_achievement', { p_achievement_id: achId });
    if (error) toast('⚠️ Removed locally, but may not have synced: ' + error.message, '#ffb95f');
  }
};

window.achAdminDuplicate = function (achId) {
  DB = loadDB();
  const ach = (DB.achievements || []).find(a => a.id === achId);
  if (!ach) return;
  // Phase 32: carry the original's owner forward (falls back to the
  // current caller for any pre-migration row that somehow lacks one yet).
  DB.achievements.push({ ...ach, id: uid(), ownerTeacherId: ach.ownerTeacherId || currentUser.id, name: ach.name + ' (Copy)', createdAt: new Date().toISOString() });
  saveDB(); toast('⧉ Badge duplicated!'); renderAdminAchievements();
};

// ── Preview ───────────────────────────────────────────────────────────────────

window.achAdminPreview = function (achId) {
  DB = loadDB();
  const ach        = (DB.achievements || []).find(a => a.id === achId); if (!ach) return;
  const rarity     = ACH_RARITY[ach.rarity] || ACH_RARITY.Common;
  const triggerDef = ACH_TRIGGER_TYPES.find(t => t.value === ach.triggerType) || { label: ach.triggerType };
  showModal(`
  <div style="text-align:center;max-width:280px;margin:0 auto;padding:10px 0">
    <h3 style="font-family:var(--fh);font-size:16px;font-weight:900;margin-bottom:16px">Badge Preview</h3>
    <div class="ach-badge-card" style="max-width:200px;margin:0 auto 20px;box-shadow:0 0 30px ${rarity.glow};border-color:${rarity.color}55">
      <div class="ach-rarity-strip" style="background:${rarity.strip}"></div>
      <div class="ach-badge-icon-wrap">${ach.icon || '🏅'}</div>
      <div class="ach-badge-title ${achRarityClass(ach.rarity)}">${_esc(ach.name)}</div>
      <span class="ach-rarity-tag ${achRarityClass(ach.rarity)}">${ach.rarity}</span>
      <div class="ach-badge-desc">${_esc(ach.description || '')}</div>
      <div class="ach-unlocked-stamp">✓ UNLOCKED</div>
      <div class="ach-reward-chips">
        ${(ach.xpReward   || 0) > 0 ? `<span class="ach-reward-chip" style="color:#c4b5fd;border-color:rgba(196,181,253,0.3)">+${ach.xpReward} XP</span>` : ''}
        ${(ach.coinReward || 0) > 0 ? `<span class="ach-reward-chip" style="color:#ffb95f;border-color:rgba(255,185,95,0.3)">+${ach.coinReward} 🪙</span>` : ''}
      </div>
    </div>
    <div style="text-align:left;background:rgba(255,255,255,0.04);border-radius:10px;padding:12px;font-size:12px">
      <div style="margin-bottom:6px"><span style="color:var(--text-muted)">Category:</span> <strong>${_esc(ach.category)}</strong></div>
      <div style="margin-bottom:6px"><span style="color:var(--text-muted)">Trigger:</span> <strong>${_esc(triggerDef.label)}${ach.triggerType !== 'manual' && ach.triggerType !== 'all_quests' ? ' ≥ ' + ach.triggerValue : ''}</strong></div>
      <div style="margin-bottom:6px"><span style="color:var(--text-muted)">Hidden:</span> <strong>${ach.isHidden ? 'Yes — hidden until unlocked' : 'No'}</strong></div>
      <div><span style="color:var(--text-muted)">Status:</span> <strong style="color:${ach.active ? '#4edea3' : '#ff8080'}">${ach.active ? 'Active' : 'Disabled'}</strong></div>
    </div>
    <button class="btn btn-ghost btn-block" style="margin-top:14px" onclick="closeModalForce()">Close</button>
  </div>`, 'sm');
};

// ── Grant / Revoke ────────────────────────────────────────────────────────────

window.achAdminGrantAchievement = function () {
  DB = loadDB();
  const achs = DB.achievements || [];
  if (!achs.length) { toast('❌ Create achievements first', '#ffb4ab'); return; }
  const achOpts     = achs.map(a => `<option value="${a.id}">${a.icon} ${_esc(a.name)}</option>`).join('');
  const studentOpts = DB.students.map(s => `<option value="${s.id}">${_esc(s.name)}</option>`).join('');
  showModal(`
  <div style="max-width:480px">
    <h2 style="font-family:var(--fh);font-size:20px;font-weight:900;margin-bottom:20px">🎁 Grant/Revoke Achievements</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
      <div><label class="form-label">Student *</label><select id="ach-grant-student" class="form-control" style="width:100%"><option value="">Select student...</option>${studentOpts}</select></div>
      <div><label class="form-label">Achievement *</label><select id="ach-grant-ach" class="form-control" style="width:100%" onchange="achAdminUpdateGrantPreview()"><option value="">Select achievement...</option>${achOpts}</select></div>
    </div>
    <div id="ach-grant-preview" style="background:rgba(255,255,255,0.04);border-radius:10px;padding:14px;margin-bottom:14px;display:none">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px">
        <div><span style="color:var(--text-muted)">Achievement:</span><br><strong id="ach-grant-preview-name">—</strong></div>
        <div><span style="color:var(--text-muted)">Rarity:</span><br><strong id="ach-grant-preview-rarity">—</strong></div>
        <div><span style="color:var(--text-muted)">XP Reward:</span><br><strong style="color:#c4b5fd">+<span id="ach-grant-preview-xp">0</span> XP</strong></div>
        <div><span style="color:var(--text-muted)">Coin Reward:</span><br><strong style="color:#ffb95f">+<span id="ach-grant-preview-coin">0</span> 🪙</strong></div>
      </div>
    </div>
    <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <input type="radio" name="ach-grant-action" value="grant" id="ach-action-grant" checked style="width:16px;height:16px;cursor:pointer">
        <label for="ach-action-grant" style="cursor:pointer;flex:1"><span style="font-weight:700;color:#4edea3">Grant Achievement</span><div style="font-size:11px;color:var(--text-muted);margin-top:2px">Award this badge &amp; reward XP/coins</div></label>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <input type="radio" name="ach-grant-action" value="revoke" id="ach-action-revoke" style="width:16px;height:16px;cursor:pointer">
        <label for="ach-action-revoke" style="cursor:pointer;flex:1"><span style="font-weight:700;color:#ff8080">Revoke Achievement</span><div style="font-size:11px;color:var(--text-muted);margin-top:2px">Remove badge &amp; rewards</div></label>
      </div>
    </div>
    <div id="ach-grant-err" style="color:#ff8080;font-size:12px;margin-bottom:10px;display:none"></div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" style="flex:1" onclick="achAdminDoGrant()">Execute</button>
    </div>
  </div>`, 'md');
};

window.achAdminUpdateGrantPreview = function () {
  const achId   = document.getElementById('ach-grant-ach').value;
  DB = loadDB();
  const ach     = achId ? (DB.achievements || []).find(a => a.id === achId) : null;
  const preview = document.getElementById('ach-grant-preview');
  if (ach && preview) {
    document.getElementById('ach-grant-preview-name').textContent  = ach.name;
    document.getElementById('ach-grant-preview-rarity').textContent = ach.rarity;
    document.getElementById('ach-grant-preview-xp').textContent    = ach.xpReward    || 0;
    document.getElementById('ach-grant-preview-coin').textContent  = ach.coinReward  || 0;
    preview.style.display = 'block';
  } else if (preview) {
    preview.style.display = 'none';
  }
};

window.achAdminDoGrant = function () {
  const sid     = document.getElementById('ach-grant-student').value;
  const achId   = document.getElementById('ach-grant-ach').value;
  const action  = document.querySelector('input[name="ach-grant-action"]:checked').value;
  const errEl   = document.getElementById('ach-grant-err');
  if (!sid)   { if (errEl) { errEl.textContent = 'Please select a student.';     errEl.style.display = 'block'; } return; }
  if (!achId) { if (errEl) { errEl.textContent = 'Please select an achievement.'; errEl.style.display = 'block'; } return; }
  if (errEl) errEl.style.display = 'none';

  DB = loadDB();
  const ach     = (DB.achievements || []).find(a => a.id === achId);
  const student = DB.students.find(s => s.id === sid);
  if (!ach || !student) return;

  if (!DB.achievementUnlocks)      DB.achievementUnlocks = {};
  if (!DB.achievementUnlocks[sid]) DB.achievementUnlocks[sid] = [];
  const alreadyUnlocked = DB.achievementUnlocks[sid].some(u => u.achId === achId);
  const sIdx            = DB.students.indexOf(student);

  if (action === 'grant') {
    if (alreadyUnlocked) { if (errEl) { errEl.textContent = '❌ Student already has this achievement.'; errEl.style.display = 'block'; } return; }
    const xpGrant   = parseInt(ach.xpReward)   || 0;
    const coinGrant = parseInt(ach.coinReward) || 0;
    if (sIdx >= 0) { DB.students[sIdx].xp += xpGrant; DB.students[sIdx].coins += coinGrant; }
    syncStudentStatsToServer(sid, xpGrant, coinGrant);
    DB.achievementUnlocks[sid].push({ achId, unlockedAt: new Date().toISOString(), xpGranted: xpGrant, coinsGranted: coinGrant, claimed: true, claimedAt: new Date().toISOString() });
    // Phase 17: admin grants unlock+claim in one step, unlike auto-unlock.
    syncAchievementUnlockToServer(sid, achId, xpGrant, coinGrant, true, student.classId || 'default-class');
    saveDB(); closeModalForce();
    toast(`✅ Granted "${_esc(ach.name)}" to ${_esc(student.name)}! +${xpGrant} XP, +${coinGrant} 🪙`);
  } else {
    if (!alreadyUnlocked) { if (errEl) { errEl.textContent = '❌ Student does not have this achievement.'; errEl.style.display = 'block'; } return; }
    const unlock = DB.achievementUnlocks[sid].find(u => u.achId === achId);
    if (unlock && sIdx >= 0) {
      DB.students[sIdx].xp     = Math.max(0, DB.students[sIdx].xp     - (unlock.xpGranted     || 0));
      DB.students[sIdx].coins  = Math.max(0, DB.students[sIdx].coins  - (unlock.coinsGranted  || 0));
      syncStudentStatsToServer(sid, -(unlock.xpGranted || 0), -(unlock.coinsGranted || 0));
    }
    DB.achievementUnlocks[sid] = (DB.achievementUnlocks[sid] || []).filter(u => u.achId !== achId);
    syncAchievementRevokeToServer(sid, achId);
    saveDB(); closeModalForce();
    toast(`🗑 Revoked "${_esc(ach.name)}" from ${_esc(student.name)}.`, '#ff8080');
  }
  renderAdminAchievements();
};

// ── Category management ───────────────────────────────────────────────────────

window.achAdminManageCategories = function () {
  DB = loadDB();
  const cats = DB.achievementCategories || [];
  showModal(`
  <div style="max-width:400px">
    <h2 style="font-family:var(--fh);font-size:18px;font-weight:900;margin-bottom:16px">Manage Categories</h2>
    <div id="ach-cats-list" style="margin-bottom:14px">
      ${cats.map((c, i) => `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)"><span style="flex:1;font-size:13px">${_esc(c)}</span><button class="btn btn-ghost btn-xs" style="color:#ff8080" onclick="achAdminDeleteCat(${i})">✕</button></div>`).join('')}
    </div>
    <div style="display:flex;gap:8px">
      <input id="ach-new-cat-input" class="form-control" type="text" placeholder="New category name..." style="flex:1">
      <button class="btn btn-primary" onclick="achAdminAddCat()">Add</button>
    </div>
    <button class="btn btn-ghost btn-block" style="margin-top:14px" onclick="closeModalForce();renderAdminAchievements()">Done</button>
  </div>`, 'sm');
};

window.achAdminAddCat = function () {
  const input = document.getElementById('ach-new-cat-input');
  const val   = (input?.value || '').trim();
  if (!val) return;
  DB = loadDB();
  if (!DB.achievementCategories)           DB.achievementCategories = [];
  if (!DB.achievementCategories.includes(val)) {
    DB.achievementCategories.push(val);
    saveDB(); toast(`✅ Category "${val}" added!`); achAdminManageCategories();
  }
};

window.achAdminDeleteCat = function (idx) {
  DB = loadDB();
  const cat = (DB.achievementCategories || [])[idx];
  if (confirm(`Remove category "${cat}"?`)) {
    DB.achievementCategories.splice(idx, 1);
    saveDB(); toast('🗑 Category removed.', '#ff8080'); achAdminManageCategories();
  }
};

console.log('[EduQuest] achievements/admin-page.js loaded — renderAdminAchievements, achAdmin* registered.');
