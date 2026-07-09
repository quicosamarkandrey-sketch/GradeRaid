// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/titles/student-page.js
//  Student "Achievements & Titles" page: wraps renderBadges output in a
//  tab system that adds the Titles grid alongside.
//  LOAD AFTER: badge-renderer.js, sidebar-refresh.js
// ═══════════════════════════════════════════════════════════════════════════════

// ── Private helpers ───────────────────────────────────────────────────────────

function _getTitleReqText(t) {
  if (!t.achievementId) return 'Granted by teacher';
  const a = (DB.achievements || []).find(x => x.id === t.achievementId);
  return a ? `Earn: ${a.name}` : 'Complete a special achievement';
}

// Phase 21: shared section-visibility check, used by both renderTitlesPage
// and _tsRefreshStudentTitlesPanel so the two render paths can't drift out
// of sync with each other. See renderTitlesPage's inline comment for the
// full reasoning (mirrors ach_student_page.js's inMySection).
function _tsTitleVisibleToStudent(t, st, unlockedIds) {
  if (t.achievementId) return true; // inherits the linked achievement's own scoping
  if (unlockedIds.has(t.id)) return true; // already-earned titles never disappear
  const assigned = (DB.titleSectionAssignments || {})[t.id];
  const myClassId = st.classId || 'default-class';
  return !assigned || assigned.length === 0 || assigned.includes(myClassId);
}

function _buildStudentTitlesHTML(st, allTitles, unlocked, equippedId) {
  const us = new Set(unlocked.map(t => t.id));

  if (!allTitles.length) {
    return `<div style="text-align:center;padding:80px 20px;border:2px dashed rgba(255,255,255,.07);border-radius:16px">
      <div style="font-size:48px;margin-bottom:14px">👑</div>
      <div style="font-family:var(--fh);font-size:18px;font-weight:900;color:var(--on-surface);margin-bottom:6px">No Titles Yet</div>
      <div style="color:var(--text-muted);font-size:13px">Titles haven't been created yet. Check back soon!</div>
    </div>`;
  }

  let banner = '';
  if (equippedId) {
    const et = allTitles.find(t => t.id === equippedId);
    if (et) banner = `<div style="background:rgba(78,222,163,.07);border:1px solid rgba(78,222,163,.25);border-radius:14px;padding:16px 20px;margin-bottom:20px;display:flex;align-items:center;gap:16px">
      <div style="flex:1">
        <div style="font-size:10px;color:var(--secondary);font-weight:800;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px">Currently Equipped</div>
        ${tsBuildBadgeHTML(et)}
      </div>
      <button class="btn btn-ghost btn-sm" onclick="tsStudentUnequip()">Unequip</button>
    </div>`;
  }

  const cards = allTitles.map(title => {
    const isU   = us.has(title.id);
    const isE   = title.id === equippedId;
    const reqText = _getTitleReqText(title);
    return `<div class="ts-title-card${isE ? ' ts-equipped' : ''}">
      <div class="ts-title-card-header">
        ${tsBuildBadgeHTML(title)}
        <span class="rarity-pill rarity-${(title.rarity || 'Common').toLowerCase()}" style="font-size:9px">${title.rarity}</span>
      </div>
      <div style="font-size:12px;color:var(--text-muted);line-height:1.5">${_esc(title.description || '')}</div>
      ${isU
        ? `<div style="font-size:10px;color:var(--secondary);display:flex;align-items:center;gap:4px"><span class="material-symbols-outlined" style="font-size:13px;font-variation-settings:'FILL' 1">check_circle</span> Unlocked</div>`
        : `<div style="font-size:10px;color:var(--text-muted)">🔒 ${_esc(reqText)}</div>`}
      <div class="ts-title-card-actions">
        ${isU
          ? (isE
            ? `<button class="ts-equip-btn ts-unequip" onclick="tsStudentUnequip()">✓ Equipped — Unequip</button>`
            : `<button class="ts-equip-btn" onclick="tsStudentEquip('${title.id}')">Equip Title</button>`)
          : `<button class="btn btn-ghost btn-xs" style="flex:1;opacity:.45;cursor:not-allowed" disabled>🔒 Locked</button>`}
      </div>
    </div>`;
  }).join('');

  return `${banner}<div class="ts-title-grid">${cards}</div>`;
}

// ── Main renderer ─────────────────────────────────────────────────────────────

/**
 * renderTitlesPage() → void  [window.renderTitlesPage]
 *
 * Wraps the existing #s-badges content (from renderBadges) inside a two-tab
 * layout: "Badges" | "Titles". The badges panel preserves the existing HTML;
 * the titles panel is built fresh.
 *
 * Called by the renderBadges patch (below) and by tsUnlockTitleForStudent
 * when the unlock belongs to the current user.
 */
window.renderTitlesPage = function () {
  if (!currentUser) return;
  DB = loadDB();
  const st          = currentUser;
  const unlocked    = tsGetUnlockedTitles(st.id);
  // Phase 21 (closing the deferred gap noted in ach_admin_page.js/
  // SYNC_AUDIT_REPORT.md): same "opt-in scoping" semantics as
  // achievements' inMySection filter in ach_student_page.js — see
  // _tsTitleVisibleToStudent above for the full reasoning.
  const unlockedIds = new Set(unlocked.map(t => t.id));
  const allTitles   = (DB.titles || []).filter(t => t.active && _tsTitleVisibleToStudent(t, st, unlockedIds));
  const equippedId  = (DB.equippedTitles || {})[st.id];
  const el          = document.getElementById('s-badges');
  if (!el) return;

  // Capture the existing badges content already rendered by renderBadges.
  // If the wrapper already exists unwrap it to avoid double-nesting.
  const existingBadgesPanel = document.getElementById('ts-tab-badges');
  const rawBadgesHTML       = existingBadgesPanel ? existingBadgesPanel.innerHTML : el.innerHTML;
  const badgesContent       = rawBadgesHTML && rawBadgesHTML.trim()
    ? rawBadgesHTML
    : `<div style="padding:32px 20px;border:1px dashed rgba(255,255,255,.08);border-radius:16px;color:var(--text-muted);font-size:13px;text-align:center">No badges available yet. Complete some activities to unlock rewards.</div>`;

  const unlockCount = ((DB.achievementUnlocks || {})[st.id] || []).length;

  el.innerHTML = `
  <div class="page-hero" style="margin-bottom:24px"><div class="page-hero-bg"></div>
    <div style="position:relative;z-index:1">
      <div class="page-hero-label">🏅 Rewards &amp; Recognition</div>
      <h1 style="font-family:var(--fh);font-size:28px;font-weight:900;color:var(--on-surface);margin-bottom:6px">Achievements &amp; Titles</h1>
      <p style="font-size:13px;color:var(--text-muted)">Earn achievements to unlock unique titles. Equip your favourite to display it across EduQuest.</p>
    </div>
  </div>
  <div class="ts-form-tabs">
    <button class="ts-form-tab active" id="tab-badges-btn" onclick="tsTabSwitch('badges')">🏅 Badges <span style="background:rgba(208,188,255,.12);border:1px solid rgba(208,188,255,.2);padding:2px 7px;border-radius:10px;font-size:10px;margin-left:4px">${unlockCount}</span></button>
    <button class="ts-form-tab" id="tab-titles-btn" onclick="tsTabSwitch('titles')">👑 Titles <span style="background:rgba(255,185,95,.12);border:1px solid rgba(255,185,95,.2);padding:2px 7px;border-radius:10px;font-size:10px;margin-left:4px">${unlocked.length}</span></button>
  </div>
  <div id="ts-tab-badges" class="ts-form-panel active">${badgesContent}</div>
  <div id="ts-tab-titles" class="ts-form-panel">${_buildStudentTitlesHTML(st, allTitles, unlocked, equippedId)}</div>`;
};

// ── Tab switcher ──────────────────────────────────────────────────────────────

window.tsTabSwitch = function (tab) {
  ['badges', 'titles'].forEach(t => {
    const p = document.getElementById('ts-tab-' + t);
    const b = document.getElementById('tab-' + t + '-btn');
    if (p) p.classList.toggle('active', t === tab);
    if (b) b.classList.toggle('active', t === tab);
  });
};

// ── Student equip / unequip ───────────────────────────────────────────────────

window.tsStudentEquip = function (tid) {
  if (!currentUser) return;
  tsEquipTitle(currentUser.id, tid);
  _tsRefreshStudentTitlesPanel();
  tsRefreshProfileOverlay();
};

window.tsStudentUnequip = function () {
  if (!currentUser) return;
  tsEquipTitle(currentUser.id, null);
  _tsRefreshStudentTitlesPanel();
  tsRefreshProfileOverlay();
};

/**
 * _tsRefreshStudentTitlesPanel() → void  [window._tsRefreshStudentTitlesPanel]
 * Refreshes only the Titles panel HTML without destroying the full badges page.
 * Updates count on the tab button and re-renders sidebar/profile/leaderboard.
 */
window._tsRefreshStudentTitlesPanel = function () {
  DB = loadDB();
  if (!currentUser) return;
  const st         = currentUser;
  const unlocked   = tsGetUnlockedTitles(st.id);
  // Phase 21 — keep this in sync with renderTitlesPage's filter above.
  const unlockedIds = new Set(unlocked.map(t => t.id));
  const allTitles  = (DB.titles || []).filter(t => t.active && _tsTitleVisibleToStudent(t, st, unlockedIds));
  const equippedId = (DB.equippedTitles || {})[st.id];

  const tabBtn = document.getElementById('tab-titles-btn');
  if (tabBtn) {
    tabBtn.innerHTML = tabBtn.innerHTML.replace(
      /<span[^>]*>\d+<\/span>/,
      `<span style="background:rgba(255,185,95,.12);border:1px solid rgba(255,185,95,.2);padding:2px 7px;border-radius:10px;font-size:10px;margin-left:4px">${unlocked.length}</span>`
    );
  }

  const panel = document.getElementById('ts-tab-titles');
  if (panel) panel.innerHTML = _buildStudentTitlesHTML(st, allTitles, unlocked, equippedId);

  tsRefreshSidebarTitle();
  tsRefreshProfileTitle();

  const lbPage = document.getElementById('s-leaderboard');
  if (lbPage && lbPage.classList.contains('active') && typeof renderLeaderboard === 'function')
    renderLeaderboard(window._eqlActiveTab || 'hall', window._eqlActivePeriod || 'all');
};

// ── renderBadges patch ────────────────────────────────────────────────────────
// Wraps renderBadges to inject the Titles tab after badges render.
;(function () {
  const _orig = window.renderBadges;
  window.renderBadges = function () {
    if (typeof _orig === 'function') _orig();
    DB = loadDB();
    renderTitlesPage();
    if (window._tsOpenTitlesTab) { tsTabSwitch('titles'); window._tsOpenTitlesTab = false; }
    setTimeout(() => { tsRefreshSidebarTitle(); tsRefreshProfileTitle(); }, 80);
  };
})();

console.log('[EduQuest] titles/student-page.js loaded — renderTitlesPage, tsTabSwitch, tsStudentEquip/Unequip, _tsRefreshStudentTitlesPanel registered. renderBadges patched.');
