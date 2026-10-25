// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/titles/sidebar-refresh.js
//  Core unlock/equip logic, sidebar/profile refresh, and all patch IIFEs.
//  LOAD AFTER: badge-renderer.js
// ═══════════════════════════════════════════════════════════════════════════════

// ── Core helpers ──────────────────────────────────────────────────────────────

window.tsGetEquippedTitle = function (sid) {
  const tid = (AppStore.getSlice(s => s.equippedTitles) || {})[sid];
  if (!tid) return null;
  return (AppStore.getSlice(s => s.titles) || []).find(t => t.id === tid && t.active) || null;
};

window.tsGetUnlockedTitles = function (sid) {
  const ids = new Set((AppStore.getSlice(s => s.titleUnlocks) || {})[sid] || []);
  return (AppStore.getSlice(s => s.titles) || []).filter(t => ids.has(t.id));
};

window.tsIsUnlocked = function (sid, tid) {
  return ((AppStore.getSlice(s => s.titleUnlocks) || {})[sid] || []).includes(tid);
};

// ── Equip / Unlock ────────────────────────────────────────────────────────────

window.tsEquipTitle = function (sid, tid) {
  if (tid && !tsIsUnlocked(sid, tid)) { toast('❌ Title not unlocked yet.', '#ffb4ab'); return; }
  AppStore.updateState(draft => {
    if (!draft.equippedTitles) draft.equippedTitles = {};
    draft.equippedTitles[sid] = tid || null;
  }, { type: 'titles:equipped', payload: { sid, tid: tid || null } });
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
 * Adds tid to the AppStore titleUnlocks slice for sid. Returns false if already unlocked.
 * If !silent: calls tsShowTitleUnlockPopup().
 * If currentUser.id === sid: refreshes renderTitlesPage, sidebar, profile, renderBadges.
 */
window.tsUnlockTitleForStudent = function (sid, tid, silent) {
  const already = (AppStore.getSlice(s => s.titleUnlocks) || {})[sid] || [];
  if (already.includes(tid)) return false;

  AppStore.updateState(draft => {
    if (!draft.titleUnlocks)      draft.titleUnlocks = {};
    if (!draft.titleUnlocks[sid]) draft.titleUnlocks[sid] = [];
    draft.titleUnlocks[sid].push(tid);
  }, { type: 'titles:unlocked', payload: { sid, tid } });

  // Phase 18: sync the unlock server-side too, fire-and-forget. Covers all
  // three real call sites (achievement-linked auto-unlock in this file,
  // admin grant in titles_admin_page.js, mail reward claim in
  // mail-engine.js) since they all funnel through this one function.
  const _stu = (AppStore.getSlice(s => s.students) || []).find(s => String(s.id) === String(sid));
  syncTitleUnlockToServer(sid, tid, _stu ? _stu.classId : null);
  const t = (AppStore.getSlice(s => s.titles) || []).find(x => x.id === tid);
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
  // BUGFIX (stale badge across account switches): this used to bail out here
  // for any non-student role WITHOUT removing #ts-sidebar-title, so a badge
  // injected during a previous student session in the same tab stayed
  // visually stuck in the sidebar after switching to a teacher/admin account
  // (no full page reload in between). Always clear the stale element first;
  // only skip re-rendering it for non-student roles.
  if (currentRole !== 'student' || !currentUser) {
    const stale = document.getElementById('ts-sidebar-title');
    if (stale) stale.remove();
    return;
  }
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
  // BUGFIX: same stale-element issue as tsRefreshSidebarTitle above — clear
  // any leftover #ts-dash-title from a previous student session before
  // bailing out for a non-student role.
  if (!currentUser || currentRole !== 'student') {
    const stale = document.getElementById('ts-dash-title');
    if (stale) stale.remove();
    return;
  }
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

// achievements:check-and-award-ran → unlock titles linked to newly earned
// achievements
// Continuation Plan §3, Category A — achCheckAndAward-as-title-hook (the
// highest-blast-radius item on the list, since achCheckAndAward is called
// directly from ~8 places across the app, not funneled through one
// dispatch point like navTo/openBossForm were). Converting it didn't
// require touching any of those call sites, though — they all call the one
// global achCheckAndAward, and ach_engine.js's own wrapper is now the only
// thing that name resolves to, so every caller still reaches this logic
// exactly as before. Confirmed post-hook/void-return shape, load-order
// traced (ach_engine.js loads at index.html:807, this file at :817, so the
// base definition — and its emit — exists before this subscriber is even
// registered). See ach_engine.js's own emit() call site for why the event
// fires unconditionally rather than reusing the existing
// 'achievements:unlocked' event (which only fires when something new was
// actually unlocked this call — this patch's own logic needs to run even
// when nothing new unlocked, to catch titles linked to an
// already-unlocked achievement after the fact).
AppStore.subscribe('titles-ach-check-and-award', function (state, event) {
  if (event.type !== 'achievements:check-and-award-ran') return;
  const studentId = event.payload.studentId;
  const suppressPopup = event.payload.suppressPopup;
  if (!studentId) return;
  const unlockedAchIds = new Set(((AppStore.getSlice(s => s.achievementUnlocks) || {})[studentId] || []).map(u => u.achId));
  (AppStore.getSlice(s => s.titles) || []).forEach(t => {
    if (!t.active || !t.achievementId) return;
    if (tsIsUnlocked(studentId, t.id)) return;
    if (unlockedAchIds.has(t.achievementId)) tsUnlockTitleForStudent(studentId, t.id, suppressPopup);
  });
});

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

// dashboard:student-rendered → refresh profile title after dashboard renders
//
// Was a monkey-patch on window.renderStudentDashboard. Confirmed DEAD via
// script-load-order tracing: this file's <script> tag (index.html ~817)
// runs before the inline <script> block that defines the base
// renderStudentDashboard() (index.html ~900), so `_orig` captured
// `undefined` at patch time, and the later plain `function
// renderStudentDashboard(){...}` declaration silently overwrote this
// patch's wrapper the instant it ran — same recurring pattern as
// wbcApplyDamage/renderStudentWorldBoss. Effect while dead: the
// #ts-dash-title badge (inserted by tsRefreshProfileTitle, wiped by every
// renderStudentDashboard() innerHTML replacement) was only ever restored
// via navTo's own separate live patch (id === 's-dashboard') and the
// session:booted subscriber below — the two direct-call sites in
// modules/perceived-speed.js (mail reward claim onClose) and
// modules/achievements/ach_student_page.js (achievement claim onClose)
// silently lost the badge on every claim with no path to get it back.
// Converted to a real subscriber on the event the base function now emits
// — this fixes that gap rather than just relocating it, since a subscriber
// isn't sensitive to script tag order the way a captured `_orig` is.
AppStore.subscribe('titles-sidebar-dashboard-rendered', function (state, event) {
  if (event.type !== 'dashboard:student-rendered') return;
  setTimeout(tsRefreshProfileTitle, 80);
});

// nav:navigated → refresh sidebar on every navigation; refresh profile on
// s-dashboard
// Continuation Plan §3, Category A — replaces the old monkey-patch of
// window.navTo. Confirmed post-hook/void-return shape, load-order traced
// (nav.js now emits this after _navToCore() runs — including on its early
// activeQuiz-abort return, matching the old patch's "always runs after,
// regardless of internal branch" behavior exactly; see nav.js's emit() call
// site for the full reasoning). Deliberately does NOT fold in
// dashboard:student-rendered's own subscriber above — that event already
// covers every renderStudentDashboard() call site, not just navigation
// through s-dashboard (mail/achievement claim popups also trigger it), so
// keeping them separate avoids double-firing tsRefreshProfileTitle() on a
// navigation that lands on s-dashboard.
AppStore.subscribe('titles-sidebar-nav-refresh', function (state, event) {
  if (event.type !== 'nav:navigated') return;
  if (currentRole === 'student') {
    setTimeout(() => {
      tsRefreshSidebarTitle();
      if (event.payload.id === 's-dashboard') tsRefreshProfileTitle();
    }, 100);
  }
});

// session:booted → AppStore migration guard + initial sidebar/profile refresh on login
// [Phase 3 migration note] This duplicates the same titles/titleUnlocks/
// equippedTitles initialization as titles_index.js's own AppStore.ready.then()
// block — a pre-existing redundancy predating this migration (both guarded
// by an existence check, so harmless either way). Same "flagged, not fixed"
// treatment as the identical duplication found in modules/boss-studio/
// (bs_index.js vs bs_storage.js) — this is Phase 1 (dead/duplicate code)
// territory, not this phase's scope.
AppStore.subscribe('titles-sidebar-refresh-boot', function (state, event) {
  if (event.type !== 'session:booted') return;
  const current = AppStore.getSlice(s => ({ titles: s.titles, titleUnlocks: s.titleUnlocks, equippedTitles: s.equippedTitles }));
  const missing = ['titles', 'titleUnlocks', 'equippedTitles'].filter(k => !current || !current[k]);
  if (missing.length) {
    AppStore.updateState(draft => {
      if (!draft.titles)         draft.titles         = [];
      if (!draft.titleUnlocks)   draft.titleUnlocks   = {};
      if (!draft.equippedTitles) draft.equippedTitles = {};
    }, { type: 'titles:libraries-initialized', payload: { keys: missing } });
  }
  if (currentRole === 'student' && currentUser) {
    try { achCheckAndAward(currentUser.id, true); } catch (e) {}
  }
  setTimeout(() => {
    tsRefreshSidebarTitle();
    if (currentRole === 'student') tsRefreshProfileTitle();
  }, 300);
});

console.log('[EduQuest] titles/sidebar-refresh.js loaded — tsGetEquippedTitle, tsEquipTitle, tsUnlockTitleForStudent, tsRefreshSidebarTitle, tsRefreshProfileTitle registered. Patches: _holGetTitle. Subscribers: dashboard:student-rendered, session:booted, nav:navigated, achievements:check-and-award-ran.');
