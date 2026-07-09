// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/titles/sidebar-refresh.js
//  Core unlock/equip logic, sidebar/profile refresh, and all patch IIFEs.
//  LOAD AFTER: badge-renderer.js
// ═══════════════════════════════════════════════════════════════════════════════

// ── Core helpers ──────────────────────────────────────────────────────────────

window.tsGetEquippedTitle = function (sid) {
  const tid = (DB.equippedTitles || {})[sid];
  if (!tid) return null;
  return (DB.titles || []).find(t => t.id === tid && t.active) || null;
};

window.tsGetUnlockedTitles = function (sid) {
  const ids = new Set((DB.titleUnlocks || {})[sid] || []);
  return (DB.titles || []).filter(t => ids.has(t.id));
};

window.tsIsUnlocked = function (sid, tid) {
  return ((DB.titleUnlocks || {})[sid] || []).includes(tid);
};

// ── Equip / Unlock ────────────────────────────────────────────────────────────

window.tsEquipTitle = function (sid, tid) {
  DB = loadDB();
  if (!DB.equippedTitles) DB.equippedTitles = {};
  if (tid && !tsIsUnlocked(sid, tid)) { toast('❌ Title not unlocked yet.', '#ffb4ab'); return; }
  DB.equippedTitles[sid] = tid || null;
  saveDB();
  // Phase 18: sync the equipped title server-side too, fire-and-forget.
  syncEquippedTitleToServer(sid, tid || null);
  if (currentUser && currentUser.id === sid) {
    tsRefreshSidebarTitle();
    tsRefreshProfileTitle();
    const lbPage = document.getElementById('s-leaderboard');
    if (lbPage && lbPage.classList.contains('active') && typeof renderLeaderboard === 'function')
      renderLeaderboard(window._eqlActiveTab || 'hall', window._eqlActivePeriod || 'all');
  }
  toast(tid ? '✅ Title equipped!' : '✅ Title unequipped.', '#4edea3');
};

/**
 * tsUnlockTitleForStudent(sid, tid, silent) → boolean
 * Adds tid to DB.titleUnlocks[sid]. Returns false if already unlocked.
 * If !silent: calls tsShowTitleUnlockPopup().
 * If currentUser.id === sid: refreshes renderTitlesPage, sidebar, profile, renderBadges.
 */
window.tsUnlockTitleForStudent = function (sid, tid, silent) {
  DB = loadDB();
  if (!DB.titleUnlocks)      DB.titleUnlocks = {};
  if (!DB.titleUnlocks[sid]) DB.titleUnlocks[sid] = [];
  if (DB.titleUnlocks[sid].includes(tid)) return false;
  DB.titleUnlocks[sid].push(tid);
  saveDB();
  // Phase 18: sync the unlock server-side too, fire-and-forget. Covers all
  // three real call sites (achievement-linked auto-unlock in this file,
  // admin grant in titles_admin_page.js, mail reward claim in
  // mail-engine.js) since they all funnel through this one function.
  const _stu = (DB.students || []).find(s => String(s.id) === String(sid));
  syncTitleUnlockToServer(sid, tid, _stu ? _stu.classId : null);
  const t = (DB.titles || []).find(x => x.id === tid);
  if (!silent && t) tsShowTitleUnlockPopup(t);
  if (currentUser && String(currentUser.id) === String(sid)) {
    if (typeof renderTitlesPage === 'function') renderTitlesPage();
    tsRefreshSidebarTitle();
    tsRefreshProfileTitle();
    if (typeof window.renderBadges === 'function') renderBadges();
  }
  return true;
};

/**
 * tsShowTitleUnlockPopup(title) → void
 * Shows #ts-unlock-popup for 4s. Click navigates to s-badges.
 */
window.tsShowTitleUnlockPopup = function (title) {
  const ex = document.getElementById('ts-unlock-popup');
  if (ex) ex.remove();
  const d = document.createElement('div');
  d.id        = 'ts-unlock-popup';
  d.className = 'ts-unlock-popup';
  d.innerHTML = `<div style="font-size:36px;flex-shrink:0">${title.icon || '🏆'}</div>` +
    `<div><div style="font-size:10px;font-weight:800;color:#ffb95f;letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px">Title Unlocked!</div>` +
    `<div style="font-family:var(--fh);font-size:15px;font-weight:900;color:#fff;margin-bottom:6px">${_esc(title.name)}</div>` +
    `<div>${tsBuildBadgeHTML(title, { small: true, noParticles: true })}</div></div>`;
  d.style.cursor = 'pointer';
  d.addEventListener('click', () => navTo('s-badges'));
  document.body.appendChild(d);
  setTimeout(() => {
    d.style.animation = 'achPopOut .4s ease forwards';
    setTimeout(() => d.remove(), 400);
  }, 4000);
};

// ── Sidebar display ───────────────────────────────────────────────────────────

/**
 * tsRefreshSidebarTitle() → void  [window.tsRefreshSidebarTitle]
 * Injects/removes #ts-sidebar-title div inside .sidebar-player.
 */
window.tsRefreshSidebarTitle = function () {
  if (currentRole !== 'student' || !currentUser) return;
  DB = loadDB();
  const eq   = tsGetEquippedTitle(currentUser.id);
  let el     = document.getElementById('ts-sidebar-title');
  const cont = document.querySelector('.sidebar-player');
  if (!cont) return;
  if (!eq) { if (el) el.remove(); return; }
  if (!el) {
    el             = document.createElement('div');
    el.id          = 'ts-sidebar-title';
    el.className   = 'ts-sidebar-equipped';
    cont.appendChild(el);
  }
  el.innerHTML = tsBuildBadgeHTML(eq, { small: true, noParticles: true });
};

/**
 * tsRefreshProfileTitle() → void  [window.tsRefreshProfileTitle]
 * Inserts #ts-dash-title below .dash-hero-name if student has an equipped title.
 */
window.tsRefreshProfileTitle = function () {
  if (!currentUser || currentRole !== 'student') return;
  DB = loadDB();
  const existing = document.getElementById('ts-dash-title');
  if (existing) existing.remove();
  const eq = tsGetEquippedTitle(currentUser.id);
  if (!eq) return;
  const heroName = document.querySelector('.dash-hero-name');
  if (!heroName) return;
  if (heroName.nextSibling && heroName.nextSibling.id === 'ts-dash-title') return;
  const d        = document.createElement('div');
  d.id           = 'ts-dash-title';
  d.style.cssText = 'margin-top:6px;margin-bottom:2px;';
  d.innerHTML     = tsBuildBadgeHTML(eq);
  heroName.parentNode.insertBefore(d, heroName.nextSibling);
};

/**
 * tsRefreshProfileOverlay() → void  [window.tsRefreshProfileOverlay]
 * Re-renders profile overlay hero/stats sections if open.
 */
window.tsRefreshProfileOverlay = function () {
  const overlay = document.getElementById('profile-overlay');
  if (!overlay || !overlay.classList.contains('open')) return;
  if (currentRole !== 'student') return;
  const user = typeof profGetCurrent === 'function' ? profGetCurrent() : null;
  if (!user) return;
  if (typeof _profRenderHero  === 'function') _profRenderHero(user);
  if (typeof _profRenderStats === 'function') _profRenderStats(user);
};

window.tsOpenTitlesFromProfile = function () {
  window._tsOpenTitlesTab = true;
  navTo('s-badges');
};

// ── Patches ───────────────────────────────────────────────────────────────────

// achCheckAndAward → unlock titles linked to newly earned achievements
;(function () {
  const _orig = window.achCheckAndAward;
  window.achCheckAndAward = function (studentId, suppressPopup) {
    if (typeof _orig === 'function') _orig(studentId, suppressPopup);
    if (!studentId) return;
    const unlockedAchIds = new Set(((DB.achievementUnlocks || {})[studentId] || []).map(u => u.achId));
    (DB.titles || []).forEach(t => {
      if (!t.active || !t.achievementId) return;
      if (tsIsUnlocked(studentId, t.id)) return;
      if (unlockedAchIds.has(t.achievementId)) tsUnlockTitleForStudent(studentId, t.id, suppressPopup);
    });
  };
})();

// _holGetTitle → show equipped title name in leaderboard
;(function () {
  const _orig = window._holGetTitle;
  window._holGetTitle = function (student, categoryKey) {
    const eq = tsGetEquippedTitle(student.id);
    if (eq) return eq.name;
    if (typeof _orig === 'function') return _orig(student, categoryKey);
    return student.tier || '';
  };
})();

// renderStudentDashboard → refresh profile title after dashboard renders
;(function () {
  const _orig = window.renderStudentDashboard;
  window.renderStudentDashboard = function () {
    if (typeof _orig === 'function') _orig();
    setTimeout(tsRefreshProfileTitle, 80);
  };
})();

// navTo → refresh sidebar on every navigation; refresh profile on s-dashboard
;(function () {
  const _orig = window.navTo;
  window.navTo = function (id) {
    if (typeof _orig === 'function') _orig(id);
    if (currentRole === 'student') {
      setTimeout(() => {
        tsRefreshSidebarTitle();
        if (id === 's-dashboard') tsRefreshProfileTitle();
      }, 100);
    }
  };
})();

// bootApp → DB migration + initial sidebar/profile refresh on login
;(function () {
  const _orig = window.bootApp;
  window.bootApp = function () {
    if (typeof _orig === 'function') _orig();
    DB = loadDB();
    if (!DB.titles)         DB.titles         = [];
    if (!DB.titleUnlocks)   DB.titleUnlocks   = {};
    if (!DB.equippedTitles) DB.equippedTitles = {};
    if (currentRole === 'student' && currentUser) {
      try { achCheckAndAward(currentUser.id, true); } catch (e) {}
    }
    setTimeout(() => {
      tsRefreshSidebarTitle();
      if (currentRole === 'student') tsRefreshProfileTitle();
    }, 300);
  };
})();

console.log('[EduQuest] titles/sidebar-refresh.js loaded — tsGetEquippedTitle, tsEquipTitle, tsUnlockTitleForStudent, tsRefreshSidebarTitle, tsRefreshProfileTitle registered. Patches: achCheckAndAward, _holGetTitle, renderStudentDashboard, navTo, bootApp.');
