// ─────────────────────────────────────────────────────────────────────────────
// SHARED NAV — Navigation structure and page routing
//
// Exports: NAV_STUDENT, NAV_ADMIN, setupSidebar(), navTo(), showPage()
//          dsmGetStudentNav(), dsmGetAdminNav() (stub fallbacks; DSM overrides later)
//
// DEPENDENCIES:
//   - currentRole (global / core/app-state)
//   - dsmGetAdminNav(), dsmGetStudentNav() (overridden by DSM module at runtime)
//   - _adminStoreInterval (shop module global)
//   - All page render functions: renderStudentDashboard, renderStudentQuizzes,
//     renderStudentWorldBoss, renderStudentStore, renderInventory, renderStudentOrders,
//     renderLeaderboard, renderBadges, renderStudentMail, renderStudentProgress,
//     renderAdminDashboard, renderScanner, renderAdminStore, renderPOS,
//     renderAdminQuizzes, renderAnalytics, renderAdminStageMap, renderAdminBossEvents,
//     renderAdminAchievements, renderAdminPromotions, renderAdminRegistrations,
//     renderAdminMail, renderNavManager, renderBossStudio (all globals)
//
// PHASE 1 EXTRACTION NOTE:
//   navTo() is monkey-patched by 4 modules in the monolith:
//   Leaderboard (HOL init), Titles (sidebar refresh), Inventory, DSM.
//   All patches are preserved in the monolith. This extracted version contains
//   the base navTo() only. Patches will be replaced in Phase 5.
// ─────────────────────────────────────────────────────────────────────────────

// ── SIDEBAR NAV ──
const NAV_STUDENT=[
  {id:'s-dashboard',label:'Dashboard',icon:'home'},
  {id:'s-my-section',label:'My Section',icon:'groups'},
  {id:'s-quizzes',label:'Quest Board',icon:'swords'},
  {id:'s-world-boss',label:'World Boss',icon:'local_fire_department'},
  {id:'s-store',label:'The Armory',icon:'storefront'},
  {id:'s-inventory',label:'My Inventory',icon:'backpack'},
  {id:'s-orders',label:'My Orders',icon:'receipt_long'},
  {id:'s-leaderboard',label:'Hall of Fame',icon:'military_tech'},
  {id:'s-badges',label:'Achievements',icon:'workspace_premium'},
  {id:'s-mail',label:'Mail',icon:'mail'},
  {id:'s-attendance',label:'My Progress',icon:'calendar_month'},
];
const NAV_ADMIN=[
  {id:'a-dashboard',label:'Command Center',icon:'home'},
  {id:'a-scanner',label:'Scanner & Records',icon:'qr_code_scanner'},
  {id:'a-store',label:'Manage Store',icon:'inventory_2'},
  {id:'a-pos',label:'Reward POS',icon:'point_of_sale'},
  {id:'a-quizzes',label:'Quest Builder',icon:'edit_note'},
  {id:'a-stagemap',label:'Stage Map Editor',icon:'map'},
  {id:'a-bossevents',label:'Boss Events',icon:'local_fire_department'},
  {id:'a-boss-studio',label:'Boss Studio',icon:'smart_toy'},
  {id:'a-achievements',label:'Achievement Mgmt',icon:'emoji_events'},
  {id:'a-titles',label:'Titles & Badges',icon:'workspace_premium'},
  {id:'a-promotions',label:'Store Promotions',icon:'campaign'},
  {id:'a-sections',label:'Sections',icon:'meeting_room'},
  {id:'a-enrollment',label:'Card Enrollment',icon:'badge'},
  {id:'a-registrations',label:'Student Registrations',icon:'person_add'},
  {id:'a-mail',label:'Mail System',icon:'mail'},
  {id:'a-analytics',label:'Analytics',icon:'insights'},
  {id:'a-class-logs',label:'Recitation & Attendance',icon:'history_edu'},
  {id:'a-nav-manager',label:'Navigation Manager',icon:'tune'},
  {id:'a-classroom',  label:'Seating Layout',    icon:'chair'},
  {id:'a-classroom-monitor', label:'Live Monitor', icon:'monitoring'},
  {id:'a-hall-of-fame', label:'Hall of Fame', icon:'military_tech'},
  {id:'a-leaderboard', label:'Leaderboard Admin', icon:'leaderboard'},
  {id:'a-teachers', label:'Teacher Directory', icon:'groups'},
  {id:'a-starter-pack', label:'Starter Pack', icon:'redeem'},
  {id:'a-settings', label:'School Settings', icon:'settings'},
  {id:'a-content-oversight', label:'Content Oversight', icon:'travel_explore'},
  {id:'a-mascot-lines', label:'Mascot Lines', icon:'theater_comedy'},
  {id:'a-audit-log', label:'Audit Log', icon:'fact_check'},
  {id:'a-system-health', label:'System Health', icon:'monitor_heart'},
];
// ISOLATION_ROLES_PLAN.md §10/§11 — items only the real oversight `admin`
// role should ever see, never a `teacher` account, regardless of what DSM's
// persisted visibility flags say. This is checked in ADDITION to (not
// instead of) DSM's own visible/locked/etc. filtering, and again defensively
// inside navTo() below — hiding a button from the sidebar is not access
// control by itself, see save_dsm_settings()/promote_to_admin() etc. on the
// SQL side for the actual enforcement.
const ADMIN_ONLY_NAV_IDS = ['a-nav-manager', 'a-teachers', 'a-starter-pack', 'a-settings', 'a-content-oversight', 'a-mascot-lines', 'a-audit-log', 'a-system-health'];
function setupSidebar(){
  // Use dynamic nav config if available, else fall back to hardcoded arrays
  // AUTH FIX (post-Phase 33): teacher is staff too — only real students get
  // the student nav. See auth.js's currentRole assignment comment.
  // ROLE SPLIT (ISOLATION_ROLES_PLAN.md §10/§11, Phase 70): admin and
  // teacher no longer share one sidebar config at all — each role now reads
  // its own DSM scope (dsmGetAdminNav() / dsmGetTeacherNav()), so an admin
  // can hide/reorder/lock a page for teachers without it also changing for
  // the admin account, and vice versa. ADMIN_ONLY_NAV_IDS items (Nav
  // Manager, Teacher Directory, Settings, etc.) are additionally stripped
  // from the teacher list inside dsmGetTeacherNav() itself as a defensive
  // floor, regardless of what's saved in the 'teacher' scope.
  const tabs =
    currentRole === 'admin'   ? dsmGetAdminNav() :
    currentRole === 'teacher' ? dsmGetTeacherNav() :
    dsmGetStudentNav();

  document.getElementById('sidebar-nav').innerHTML = tabs.map(t => {
    const cfg = t._cfg || {};
    const isGroup = t._group;
    if (isGroup) {
      return `<div class="nav-group-label" style="padding:8px 14px 4px;font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:rgba(240,238,255,.3);margin-top:6px">${t.label}</div>`;
    }
    // Status badge logic
    let badge = '';
    if (cfg.status === 'coming_soon') badge = `<span class="nav-badge" style="margin-left:auto;font-size:8px;padding:2px 6px;background:rgba(255,185,95,.15);border:1px solid rgba(255,185,95,.3);color:#ffb95f;border-radius:6px;font-weight:800;letter-spacing:.04em">SOON</span>`;
    else if (cfg.status === 'event_only') badge = `<span class="nav-badge" style="margin-left:auto;font-size:8px;padding:2px 6px;background:rgba(236,72,153,.15);border:1px solid rgba(236,72,153,.3);color:#EC4899;border-radius:6px;font-weight:800;letter-spacing:.04em">EVENT</span>`;
    else if (cfg.locked) badge = `<span class="material-symbols-outlined nav-badge" style="margin-left:auto;font-size:14px;color:rgba(240,238,255,.3)">lock</span>`;
    // title attr gives a native hover tooltip with the page name — needed once
    // the collapsed icon-only rail (see #main-app.sidebar-collapsed in base.css)
    // hides the .nav-label text.
    return `<button class="nav-btn" id="nav-${t.id}" onclick="navTo('${t.id}')" title="${t.label}" ${(cfg.locked||cfg.status==='coming_soon'||cfg.disabled)?'disabled':''} style="${(cfg.locked||cfg.status==='coming_soon'||cfg.disabled)?'opacity:0.5;cursor:not-allowed;pointer-events:none':''}">${
      t.icon ? `<span class="material-symbols-outlined">${t.icon}</span>` : ''
    }<span class="nav-label">${t.label}</span>${badge}</button>`;
  }).join('');

  document.querySelectorAll('.nav-btn').forEach(b=>{
    b.style.cssText='display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:12px;font-size:13px;font-weight:600;color:var(--text-muted);cursor:pointer;background:none;border:none;width:100%;text-align:left;transition:all .2s;letter-spacing:.02em;margin-bottom:2px;font-family:var(--fb)';
    b.onmouseover=function(){if(!this.classList.contains('active')){this.style.background='rgba(255,255,255,0.06)';this.style.color='var(--on-surface)';this.style.transform='translateX(3px)';}};
    b.onmouseout=function(){if(!this.classList.contains('active')){this.style.background='none';this.style.color='var(--text-muted)';this.style.transform='none';}};
  });
}
// DSM helpers — defined later in the DSM script block; stubs so setupSidebar doesn't crash before DSM loads
// Phase 70: teacher now reads its OWN dsmGetTeacherNav() (backed by a
// separate 'teacher' dsm_settings scope) instead of sharing dsmGetAdminNav()
// with the real admin account — see dsm-manager.js's DSM_TEACHER_DEFAULTS.
function dsmGetStudentNav(){return NAV_STUDENT;}
function dsmGetAdminNav(){return NAV_ADMIN;}
function dsmGetTeacherNav(){return NAV_ADMIN.filter(t=>ADMIN_ONLY_NAV_IDS.indexOf(t.id)===-1);}
function navTo(id){
  // Phase 60 (exploit fix) — authoritative completion state, independent of
  // navigation (Improvement Plan §7). Without this, a student could dodge
  // the Abort-as-loss penalty entirely just by clicking a sidebar link (or
  // hitting refresh) mid-quiz instead of tapping the Abort button — leaving
  // NO history row at all, which is worse than an explicit abort, not
  // better. abortQuiz()/finishQuiz() both null out activeQuiz BEFORE they
  // call navTo() themselves, so this only fires for the "walked away
  // without finishing" path, never for their own legitimate exit.
  if (typeof activeQuiz !== 'undefined' && activeQuiz && typeof quizFinishing !== 'undefined' && !quizFinishing) {
    abortQuiz();
    return;
  }
  // ROLE SPLIT defensive guard (ISOLATION_ROLES_PLAN.md §10/§11): even
  // though a teacher never sees an ADMIN_ONLY_NAV_IDS button rendered, a
  // stale bookmark/console call/back-button could still try to route here
  // directly. The real enforcement lives in the RPCs those pages call
  // (save_dsm_settings(), promote_to_admin(), etc. now check is_admin()),
  // but bounce the page too so a teacher never even sees the shell render.
  if(ADMIN_ONLY_NAV_IDS.indexOf(id)!==-1 && currentRole!=='admin'){
    console.warn('[EduQuest] blocked non-admin navigation to admin-only page:', id);
    id = (currentRole==='teacher') ? 'a-dashboard' : 's-dashboard';
  }
  // Remove cart FAB when leaving the store
  if(id!=='s-store'){ const f=document.getElementById('cart-fab'); if(f) f.remove(); }
  // Stop admin store live refresh when leaving
  if(id!=='a-store'&&_adminStoreInterval){ clearInterval(_adminStoreInterval); _adminStoreInterval=null; }
  // Stop system-health stat-card auto-refresh (Phase 4) when leaving
  if(id!=='a-system-health'&&typeof shStopCountsRefresh==='function'){ shStopCountsRefresh(); }
  // Stop RFID capture (focus-stealing interval + AppStore subscription) when leaving the scanner
  if(id!=='a-scanner'&&typeof unmountRfidScanner==='function'){ unmountRfidScanner(); }
  if(id!=='a-pos'&&typeof unmountPosPayCapture==='function'){ unmountPosPayCapture(); }
  if(id!=='a-classroom'&&typeof unmountClassroomBuilder==='function'){ unmountClassroomBuilder(); }
  if(id!=='a-classroom-monitor'&&typeof unmountClassroomMonitor==='function'){ unmountClassroomMonitor(); }
  if(id!=='a-sections'&&typeof unmountSectionMaker==='function'){ unmountSectionMaker(); }
  if(id!=='a-enrollment'&&typeof unmountEnrollmentHub==='function'){ unmountEnrollmentHub(); }
  if(id!=='a-content-oversight'&&typeof unmountContentOversight==='function'){ unmountContentOversight(); }
  if(id!=='a-class-logs'&&typeof unmountRecitationAttendanceLog==='function'){ unmountRecitationAttendanceLog(); }
  // Stop the Command Center's 1s clock/countdown interval when leaving the dashboard
  if(id!=='a-dashboard'&&typeof unmountCommandCenter==='function'){ unmountCommandCenter(); }
  document.querySelectorAll('.nav-btn').forEach(b=>{
    b.classList.remove('active');
    b.style.background='none';b.style.color='var(--text-muted)';b.style.transform='none';
    b.style.borderRight='none';b.style.borderRadius='12px';
  });
  const btn=document.getElementById('nav-'+id);
  if(btn){
    btn.classList.add('active');
    btn.style.background='rgba(208,188,255,0.12)';btn.style.color='var(--primary)';btn.style.transform='none';
    btn.style.borderRight='3px solid #8b5cf6';btn.style.borderRadius='12px 0 0 12px';
  }
  if(id==='s-dashboard')renderStudentDashboard();
  else if(id==='s-my-section')renderMySection();
  else if(id==='s-quizzes')renderStudentQuizzes();
  else if(id==='s-world-boss')renderStudentWorldBoss();
  else if(id==='s-store')renderStudentStore();
  else if(id==='s-inventory')renderInventory();
  else if(id==='s-orders')renderStudentOrders();
  else if(id==='s-leaderboard')renderLeaderboard();
  else if(id==='s-badges')renderBadges();
  else if(id==='s-mail')renderStudentMail();
  else if(id==='s-attendance')renderStudentProgress();
  else if(id==='a-dashboard')renderAdminDashboard();
  else if(id==='a-scanner')renderRfidScanner();
  else if(id==='a-store')renderAdminStore();
  else if(id==='a-pos')renderPOS();
  else if(id==='a-quizzes')renderAdminQuizzes();
  else if(id==='a-analytics')renderAnalytics();
  else if(id==='a-class-logs')renderRecitationAttendanceLog();
  else if(id==='a-stagemap')renderAdminStageMap();
  else if(id==='a-bossevents')renderAdminBossEvents();
  else if(id==='a-achievements')renderAdminAchievements();
  else if(id==='a-titles')renderAdminTitles();
  else if(id==='a-promotions')renderAdminPromotions();
  else if(id==='a-sections')renderSectionMaker();
  else if(id==='a-enrollment')renderEnrollmentHub();
  else if(id==='a-registrations')renderAdminRegistrations();
  else if(id==='a-mail')renderAdminMail();
  else if(id==='a-nav-manager')renderNavManager();
  else if(id==='a-boss-studio')renderBossStudio();
  else if(id==='a-classroom'){
    if(typeof unmountClassroomBuilder==='function') unmountClassroomBuilder();
    renderClassroomBuilder();
  }
  else if(id==='a-classroom-monitor'){
    if(typeof unmountClassroomMonitor==='function') unmountClassroomMonitor();
    renderClassroomMonitor();
  }
  else if(id==='a-hall-of-fame') renderLeaderboard();
  else if(id==='a-leaderboard') renderAdminLeaderboards();
  else if(id==='a-teachers') renderTeacherDirectory();
  else if(id==='a-starter-pack') renderStarterPackEditor();
  else if(id==='a-settings') renderSchoolSettings();
  else if(id==='a-content-oversight') renderContentOversight();
  else if(id==='a-mascot-lines') renderMascotLines();
  else if(id==='a-audit-log') renderAuditLog();
  else if(id==='a-system-health') renderSystemHealth();
  showPage(id);
  saveLastVisitedPage(id);
  // close sidebar on mobile
  if(window.innerWidth<=1024)document.getElementById('sidebar').classList.remove('open');
}
function showPage(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const el=document.getElementById(id);
  if(el){el.classList.add('active');el.classList.add('fade-in');el.scrollTop=0;}
}

// ── "Resume where I left off" (reload persistence) ──────────────────────────
// BUGFIX: a page reload used to always land back on the dashboard,
// discarding whatever page the person was actually on — bootApp() (auth.js)
// unconditionally called renderAdminDashboard()/showPage('a-dashboard') (or
// the student equivalent) on every boot, with nothing recording where you
// actually were. This persists the id every successful navTo() call lands
// on, so bootApp() can send you back there instead. Scoped by role prefix
// ('a-' vs 's-') in getLastVisitedPage() so a stale save from a different
// account/role on the same browser is never blindly reused — navTo()'s own
// ADMIN_ONLY_NAV_IDS guard above still applies on top of this regardless.
//
// NOTE: this is the *general* half of the reload fix. The more serious
// half — a reload silently escaping Card Enrollment's Self-Service kiosk
// Lock Mode onto the full admin/teacher dashboard — is handled separately
// and with higher priority in bootApp(), via enrollment-hub.js's own
// dedicated persisted flag (see _enrollHasPersistedLock()/
// _enrollRestoreLockedKioskOnBoot()); that check runs BEFORE this one.
const LAST_PAGE_KEY = 'eq_last_page';
function saveLastVisitedPage(id) {
  try { localStorage.setItem(LAST_PAGE_KEY, id); } catch (e) { /* storage unavailable — non-fatal, just won't persist */ }
}
function getLastVisitedPage(role) {
  let id = null;
  try { id = localStorage.getItem(LAST_PAGE_KEY); } catch (e) { return null; }
  if (!id) return null;
  const wantsAdminPrefix = (role === 'admin' || role === 'teacher');
  if (wantsAdminPrefix && id.indexOf('a-') !== 0) return null;
  if (!wantsAdminPrefix && id.indexOf('s-') !== 0) return null;
  return id;
}

