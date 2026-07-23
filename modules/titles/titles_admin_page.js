// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/titles/admin-page.js
//  Admin "Titles" page: list, management CRUD, grant/revoke, stats.
//  LOAD AFTER: badge-renderer.js, sidebar-refresh.js, student-page.js
// ═══════════════════════════════════════════════════════════════════════════════

// ── Main renderer ─────────────────────────────────────────────────────────────

/**
 * renderAdminTitles() → void  [window.renderAdminTitles]
 * Renders the admin Titles management page into #a-titles (or #a-achievements
 * if #a-titles does not exist — legacy mode).
 * Contains two tabs: Titles Library | Statistics.
 */
window.renderAdminTitles = function () {
  const titles = AppStore.getSlice(s => s.titles) || [];
  const dest   = document.getElementById('a-titles') || document.getElementById('a-achievements');
  if (!dest) return;

  const totalUnlocks = Object.values(AppStore.getSlice(s => s.titleUnlocks) || {}).reduce((s, arr) => s + arr.length, 0);
  const equippedTitles = AppStore.getSlice(s => s.equippedTitles) || {};
  const equipped     = Object.keys(equippedTitles).filter(sid => equippedTitles[sid]).length;

  dest.innerHTML = `
  <div class="page-hero"><div class="page-hero-bg"></div>
    <div style="position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
      <div>
        <div class="page-hero-label">👑 Title Designer</div>
        <h1 style="font-family:var(--fh);font-size:28px;font-weight:900;color:var(--on-surface);margin-bottom:6px">Titles &amp; Nameplates</h1>
        <p style="font-size:13px;color:var(--text-muted)">${titles.length} titles · ${totalUnlocks} total unlocks · ${equipped} currently equipped</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="tsAdminGrantModal()">🎁 Grant/Revoke</button>
        <button class="btn btn-primary" onclick="tsAdminOpenDesigner(null)">+ Create Title</button>
      </div>
    </div>
  </div>

  <div class="ts-form-tabs" style="margin-bottom:24px">
    <button class="ts-form-tab active" id="tsadmtab-library" onclick="tsAdminTabSwitch('library')">📚 Title Library</button>
    <button class="ts-form-tab" id="tsadmtab-stats"   onclick="tsAdminTabSwitch('stats')">📊 Statistics</button>
  </div>

  <div id="tsadm-panel-library" class="ts-form-panel active">
    ${_buildAdminTitlesList(titles)}
  </div>

  <div id="tsadm-panel-stats" class="ts-form-panel">
    ${_buildAdminTitleStats(titles)}
  </div>`;
};

// ── Private panel builders ────────────────────────────────────────────────────

function _buildAdminTitlesList(titles) {
  if (!titles.length) {
    return `<div style="text-align:center;padding:72px 20px;border:2px dashed rgba(255,255,255,.07);border-radius:16px">
      <div style="font-size:56px;margin-bottom:14px">👑</div>
      <div style="font-family:var(--fh);font-size:20px;font-weight:900;color:var(--on-surface);margin-bottom:8px">No Titles Created</div>
      <div style="color:var(--text-muted);font-size:13px;margin-bottom:20px">Create your first custom title using the Visual Designer.</div>
      <button class="btn btn-primary" onclick="tsAdminOpenDesigner(null)">+ Create First Title</button>
    </div>`;
  }

  const titleUnlocks = AppStore.getSlice(s => s.titleUnlocks) || {};
  const equippedTitles = AppStore.getSlice(s => s.equippedTitles) || {};
  const achievements = AppStore.getSlice(s => s.achievements) || [];
  const titleSectionAssignments = AppStore.getSlice(s => s.titleSectionAssignments) || {};

  return `<div class="ts-admin-cards-grid">
    ${titles.map(t => {
      const unlockCount  = Object.values(titleUnlocks).filter(arr => arr.includes(t.id)).length;
      const equippedBy   = Object.entries(equippedTitles).filter(([, tid]) => tid === t.id).length;
      const linkedAch    = t.achievementId ? achievements.find(a => a.id === t.achievementId) : null;
      // Phase 21: surface section-scoping the same way ach_admin_page.js's
      // list rows do. Not shown for achievement-linked titles — those
      // inherit the linked achievement's own section scoping instead.
      const assignedIds   = titleSectionAssignments[t.id] || [];
      const sectionsLabel = assignedIds.length
        ? assignedIds.map(cid => (typeof getClassLabel === 'function' ? getClassLabel(cid) : cid)).join(', ')
        : 'All sections';
      return `<div class="ts-admin-card${!t.active ? ' ts-admin-card-inactive' : ''}">
        <div class="ts-admin-card-preview">
          ${tsBuildBadgeHTML(t, { noParticles: true })}
          ${!t.active ? '<span style="position:absolute;top:6px;right:6px;background:rgba(255,180,171,.18);color:#ffb4ab;border:1px solid rgba(255,180,171,.3);border-radius:6px;padding:2px 7px;font-size:9px;font-weight:800;letter-spacing:.06em">DISABLED</span>' : ''}
        </div>
        <div class="ts-admin-card-body">
          <div style="font-family:var(--fh);font-size:14px;font-weight:900;color:var(--on-surface);margin-bottom:4px">${_esc(t.name)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;line-height:1.4">${_esc(t.description || '')}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
            <span class="rarity-pill rarity-${(t.rarity || 'Common').toLowerCase()}" style="font-size:9px">${t.rarity}</span>
            <span style="font-size:9px;color:var(--text-muted);border:1px solid var(--border2);border-radius:6px;padding:2px 7px">${t.frameShape || 'classic'}</span>
            ${linkedAch ? `<span class="badge-pill bp-primary" style="font-size:9px">🔗 ${_esc(linkedAch.name)}</span>` : `<span class="badge-pill ${assignedIds.length ? 'bp-primary' : 'bp-gray'}" style="font-size:9px" title="${_esc(sectionsLabel)}">🏫 ${assignedIds.length ? sectionsLabel : 'All sections'}</span>`}
          </div>
          <div style="display:flex;gap:10px;font-size:11px;margin-bottom:10px">
            <span style="color:var(--text-muted)">Unlocks: <strong style="color:var(--primary)">${unlockCount}</strong></span>
            <span style="color:var(--text-muted)">Equipped: <strong style="color:var(--secondary)">${equippedBy}</strong></span>
          </div>
          <div class="ts-admin-card-actions">
            <button class="btn btn-ghost btn-xs" onclick="tsAdminOpenDesigner('${t.id}')" title="Edit">✏️ Edit</button>
            <button class="btn btn-ghost btn-xs" onclick="tsAdminDuplicate('${t.id}')" title="Duplicate">⧉</button>
            <button class="ach-toggle-btn" style="border-color:${t.active ? 'rgba(255,128,128,0.3)' : 'rgba(78,222,163,0.3)'};color:${t.active ? '#ff8080' : '#4edea3'}" onclick="tsAdminToggle('${t.id}')">${t.active ? 'Disable' : 'Enable'}</button>
            <button class="btn btn-ghost btn-xs" style="color:#ff8080" onclick="tsAdminDelete('${t.id}')">🗑</button>
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function _buildAdminTitleStats(titles) {
  const rarityBuckets = {};
  titles.forEach(t => { rarityBuckets[t.rarity] = (rarityBuckets[t.rarity] || 0) + 1; });
  const shapeBuckets  = {};
  titles.forEach(t => { const s = t.frameShape || 'classic'; shapeBuckets[s] = (shapeBuckets[s] || 0) + 1; });

  const titleUnlocks = AppStore.getSlice(s => s.titleUnlocks) || {};
  const equippedTitles = AppStore.getSlice(s => s.equippedTitles) || {};
  const topUnlocked = titles
    .map(t => ({ t, count: Object.values(titleUnlocks).filter(arr => arr.includes(t.id)).length }))
    .sort((a, b) => b.count - a.count).slice(0, 6);
  const topEquipped = titles
    .map(t => ({ t, count: Object.entries(equippedTitles).filter(([, tid]) => tid === t.id).length }))
    .sort((a, b) => b.count - a.count).slice(0, 6);

  return `
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px">
    <div class="glass-card">
      <h3 style="margin-bottom:14px">Top Unlocked Titles</h3>
      ${topUnlocked.map(({ t, count }) => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04)">
        ${tsBuildBadgeHTML(t, { xs: true, noParticles: true })}
        <div style="flex:1;font-size:12px;font-weight:700;color:var(--on-surface)">${_esc(t.name)}</div>
        <div style="font-family:var(--fh);font-size:16px;font-weight:900;color:var(--primary)">${count}</div>
      </div>`).join('')}
      ${!topUnlocked.length ? '<div style="color:var(--text-muted);font-size:12px;padding:12px 0">No unlocks yet</div>' : ''}
    </div>
    <div class="glass-card">
      <h3 style="margin-bottom:14px">Most Equipped</h3>
      ${topEquipped.map(({ t, count }) => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04)">
        ${tsBuildBadgeHTML(t, { xs: true, noParticles: true })}
        <div style="flex:1;font-size:12px;font-weight:700;color:var(--on-surface)">${_esc(t.name)}</div>
        <div style="font-family:var(--fh);font-size:16px;font-weight:900;color:var(--secondary)">${count}</div>
      </div>`).join('')}
      ${!topEquipped.length ? '<div style="color:var(--text-muted);font-size:12px;padding:12px 0">No equipped titles yet</div>' : ''}
    </div>
    <div class="glass-card">
      <h3 style="margin-bottom:14px">By Rarity</h3>
      ${['Common','Uncommon','Rare','Epic','Legendary','Mythic'].map(r => {
        const cnt = rarityBuckets[r] || 0;
        const pct = titles.length ? Math.round(cnt / titles.length * 100) : 0;
        const rCol = { Common:'#9ca3af', Uncommon:'#4ade80', Rare:'#60a5fa', Epic:'#c084fc', Legendary:'#fbbf24', Mythic:'#f472b6' }[r] || '#9ca3af';
        return `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><span style="color:${rCol};font-weight:700">${r}</span><span style="color:var(--text-muted)">${cnt} (${pct}%)</span></div><div style="background:rgba(255,255,255,.05);border-radius:4px;height:6px;overflow:hidden"><div style="height:100%;border-radius:4px;background:${rCol};width:${pct}%;transition:width .4s"></div></div></div>`;
      }).join('')}
    </div>
  </div>`;
}

// ── Tab switcher ──────────────────────────────────────────────────────────────

window.tsAdminTabSwitch = function (tab) {
  ['library', 'stats'].forEach(t => {
    const btn = document.getElementById('tsadmtab-' + t);
    const pnl = document.getElementById('tsadm-panel-' + t);
    if (btn) btn.classList.toggle('active', t === tab);
    if (pnl) pnl.classList.toggle('active', t === tab);
  });
};

// ── Refresh helper ────────────────────────────────────────────────────────────

/**
 * _tsRefreshAdminTitlesPanel() → void  [window._tsRefreshAdminTitlesPanel]
 * Partial re-render — replaces just #tsadm-panel-library content.
 */
window._tsRefreshAdminTitlesPanel = function () {
  const panel = document.getElementById('tsadm-panel-library');
  if (panel) panel.innerHTML = _buildAdminTitlesList(AppStore.getSlice(s => s.titles) || []);
};

// ── Delete / Toggle / Duplicate ───────────────────────────────────────────────

window.tsAdminDelete = async function (titleId) {
  const t = (AppStore.getSlice(s => s.titles) || []).find(x => x.id === titleId);
  if (!t || !confirm(`Delete title "${t.name}"? This will remove all unlocks and unequip from all students.`)) return;

  AppStore.updateState(draft => {
    draft.titles = (draft.titles || []).filter(x => x.id !== titleId);
    // Remove unlocks
    if (draft.titleUnlocks) {
      Object.keys(draft.titleUnlocks).forEach(sid => {
        if ((draft.titleUnlocks[sid] || []).includes(titleId)) {
          draft.titleUnlocks[sid] = draft.titleUnlocks[sid].filter(id => id !== titleId);
        }
      });
    }
    // Unequip
    if (draft.equippedTitles) {
      Object.keys(draft.equippedTitles).forEach(sid => {
        if (draft.equippedTitles[sid] === titleId) draft.equippedTitles[sid] = null;
      });
    }
  }, { type: 'titles:title-deleted', payload: { id: titleId } });

  toast('🗑 Title deleted.', '#ff8080');
  renderAdminTitles();
  // Phase 23: the `titles` row itself is now actually deleted server-side
  // (not just its unlock rows) — delete_title() cascades title_unlocks +
  // title_sections and clears equipped_title_id wherever it pointed here,
  // so this replaces the old per-student syncTitleRevokeToServer() calls
  // (revoke_title_from_student would now just no-op against an already-
  // gone row anyway). is_staff()-checked the same as titles' own RLS
  // write policy.
  if (typeof DBService !== 'undefined' && typeof DBService.rpc === 'function') {
    const { error } = await DBService.rpc('delete_title', { p_title_id: titleId });
    if (error) toast('⚠️ Removed locally, but may not have synced: ' + error.message, '#ffb95f');
  }
};

window.tsAdminToggle = function (tid) {
  const existing = (AppStore.getSlice(s => s.titles) || []).find(t => t.id === tid);
  if (!existing) return;
  let newActive = null;
  AppStore.updateState(draft => {
    const idx = (draft.titles || []).findIndex(t => t.id === tid);
    if (idx < 0) return;
    draft.titles[idx].active = !draft.titles[idx].active;
    newActive = draft.titles[idx].active;
  }, { type: 'titles:toggled', payload: { id: tid } });
  toast(newActive ? '✅ Title enabled.' : '⏸ Title disabled.');
  _tsRefreshAdminTitlesPanel();
};

window.tsAdminDuplicate = function (tid) {
  const orig = (AppStore.getSlice(s => s.titles) || []).find(t => t.id === tid);
  if (!orig) return;
  // Phase 32: carry the original's owner forward (falls back to the
  // current caller for any pre-migration row that somehow lacks one yet).
  AppStore.updateState(draft => {
    if (!Array.isArray(draft.titles)) draft.titles = [];
    draft.titles.push({ ...orig, id: uid(), ownerTeacherId: orig.ownerTeacherId || currentUser.id, name: orig.name + ' (Copy)', createdAt: new Date().toISOString() });
  }, { type: 'titles:duplicated', payload: { sourceId: tid } });
  toast('⧉ Title duplicated!');
  _tsRefreshAdminTitlesPanel();
};

// ── Grant / Revoke modal ──────────────────────────────────────────────────────

window.tsAdminGrantModal = function () {
  const titles = AppStore.getSlice(s => s.titles) || [];
  if (!titles.length) { toast('❌ Create titles first.', '#ffb4ab'); return; }

  const students = AppStore.getSlice(s => s.students) || [];
  const studentOpts = students.map(s => `<option value="${s.id}">${_esc(s.name)}</option>`).join('');
  const titleOpts   = titles.map(t => `<option value="${t.id}">${t.icon || '👑'} ${_esc(t.name)}</option>`).join('');

  showModal(`
  <div style="max-width:480px">
    <h2 style="font-family:var(--fh);font-size:18px;font-weight:900;margin-bottom:18px">🎁 Grant / Revoke Titles</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">
      <div><label class="form-label">Student *</label><select id="tsg-student" class="form-control" style="width:100%" onchange="tsAdminGrantRefreshStudentTitles()"><option value="">Select...</option>${studentOpts}</select></div>
      <div><label class="form-label">Title *</label><select id="tsg-title" class="form-control" style="width:100%"><option value="">Select...</option>${titleOpts}</select></div>
    </div>
    <div id="tsg-student-titles" style="background:rgba(255,255,255,.04);border-radius:10px;padding:12px;margin-bottom:14px;display:none">
      <div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">Student's Current Titles</div>
      <div id="tsg-student-titles-list"></div>
    </div>
    <div style="background:rgba(255,255,255,.04);border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <input type="radio" name="tsg-action" value="grant" id="tsg-act-grant" checked style="width:16px;height:16px;cursor:pointer">
        <label for="tsg-act-grant" style="cursor:pointer;flex:1"><span style="font-weight:700;color:#4edea3">Grant Title</span><div style="font-size:11px;color:var(--text-muted);margin-top:2px">Unlock this title for the student (they can equip it)</div></label>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <input type="radio" name="tsg-action" value="revoke" id="tsg-act-revoke" style="width:16px;height:16px;cursor:pointer">
        <label for="tsg-act-revoke" style="cursor:pointer;flex:1"><span style="font-weight:700;color:#ff8080">Revoke Title</span><div style="font-size:11px;color:var(--text-muted);margin-top:2px">Remove title unlock and unequip if active</div></label>
      </div>
    </div>
    <div id="tsg-err" style="color:#ff8080;font-size:12px;display:none;margin-bottom:10px"></div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" style="flex:1" onclick="tsAdminGrantConfirm()">Execute</button>
    </div>
  </div>`, 'md');
};

window.tsAdminGrantRefreshStudentTitles = function () {
  const sid = document.getElementById('tsg-student')?.value;
  const box = document.getElementById('tsg-student-titles');
  const lst = document.getElementById('tsg-student-titles-list');
  if (!sid || !box || !lst) return;
  const unlocked   = tsGetUnlockedTitles(sid);
  const equippedId = (AppStore.getSlice(s => s.equippedTitles) || {})[sid];
  box.style.display = 'block';
  if (!unlocked.length) {
    lst.innerHTML = '<span style="color:var(--text-muted);font-size:12px">No titles unlocked yet</span>';
    return;
  }
  lst.innerHTML = unlocked.map(t => {
    const isE = t.id === equippedId;
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04)">
      ${tsBuildBadgeHTML(t, { xs: true, noParticles: true })}
      <span style="flex:1;font-size:12px;font-weight:700">${_esc(t.name)}</span>
      ${isE ? '<span style="font-size:9px;color:var(--secondary);font-weight:800;background:rgba(78,222,163,.1);border:1px solid rgba(78,222,163,.25);padding:1px 6px;border-radius:6px">EQUIPPED</span>' : ''}
      <button onclick="tsAdminRevokeTitle('${sid}','${t.id}')" style="background:none;border:none;color:rgba(255,128,128,.5);cursor:pointer;font-size:12px;padding:0">✕</button>
    </div>`;
  }).join('');
};

window.tsAdminGrantConfirm = function () {
  const sid    = document.getElementById('tsg-student')?.value;
  const tid    = document.getElementById('tsg-title')?.value;
  const action = document.querySelector('input[name="tsg-action"]:checked')?.value || 'grant';
  const errEl  = document.getElementById('tsg-err');
  if (!sid) { if (errEl) { errEl.textContent = 'Please select a student.'; errEl.style.display = 'block'; } return; }
  if (!tid) { if (errEl) { errEl.textContent = 'Please select a title.';   errEl.style.display = 'block'; } return; }
  if (errEl) errEl.style.display = 'none';

  const student = (AppStore.getSlice(s => s.students) || []).find(s => s.id === sid);
  const title   = (AppStore.getSlice(s => s.titles) || []).find(t => t.id === tid);
  if (!student || !title) return;

  if (action === 'grant') {
    if (tsIsUnlocked(sid, tid)) { if (errEl) { errEl.textContent = '❌ Student already has this title.'; errEl.style.display = 'block'; } return; }
    tsUnlockTitleForStudent(sid, tid, true);
    closeModalForce();
    toast(`✅ Granted "${_esc(title.name)}" to ${_esc(student.name)}!`);
  } else {
    if (!tsIsUnlocked(sid, tid)) { if (errEl) { errEl.textContent = '❌ Student does not have this title.'; errEl.style.display = 'block'; } return; }
    tsAdminRevokeTitle(sid, tid);
    closeModalForce();
    toast(`🗑 Revoked "${_esc(title.name)}" from ${_esc(student.name)}.`, '#ff8080');
  }
  renderAdminTitles();
};

window.tsAdminRevokeTitle = function (sid, tid) {
  AppStore.updateState(draft => {
    if (!draft.titleUnlocks) draft.titleUnlocks = {};
    draft.titleUnlocks[sid] = (draft.titleUnlocks[sid] || []).filter(id => id !== tid);
    if (draft.equippedTitles && draft.equippedTitles[sid] === tid) draft.equippedTitles[sid] = null;
  }, { type: 'titles:revoked', payload: { sid, tid } });
  // Phase 18: revoke_title_from_student() also clears equipped_title_id
  // server-side if it matched, mirroring the local unequip line above.
  syncTitleRevokeToServer(sid, tid);
  tsAdminGrantRefreshStudentTitles();
};

// ── renderAdminAchievements patch ─────────────────────────────────────────────
// Adds a "👑 Manage Titles" shortcut button to the admin achievements page.
;(function () {
  const _orig = window.renderAdminAchievements;
  window.renderAdminAchievements = function () {
    if (typeof _orig === 'function') _orig();
    const dest = document.getElementById('a-achievements');
    if (!dest) return;
    const existing = dest.querySelector('.ts-ach-titles-link');
    if (existing) return;
    const bar = dest.querySelector('.page-hero > div > div:last-child') || dest.querySelector('.page-hero-stats') || dest.querySelector('div[style*="justify-content:space-between"]');
    if (bar) {
      const btn          = document.createElement('button');
      btn.className      = 'btn btn-ghost btn-sm ts-ach-titles-link';
      btn.innerHTML      = '👑 Manage Titles';
      btn.style.cssText  = 'margin-top:8px';
      btn.addEventListener('click', () => {
        if (typeof navTo === 'function') navTo('a-titles');
        else if (typeof renderAdminTitles === 'function') { renderAdminTitles(); }
      });
      bar.appendChild(btn);
    }
  };
})();

console.log('[EduQuest] titles/admin-page.js loaded — renderAdminTitles, tsAdmin* CRUD, grant/revoke modal, renderAdminAchievements patched.');
