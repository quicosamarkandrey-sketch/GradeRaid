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
];
// ISOLATION_ROLES_PLAN.md §10/§11 — items only the real oversight `admin`
// role should ever see, never a `teacher` account, regardless of what DSM's
// persisted visibility flags say. This is checked in ADDITION to (not
// instead of) DSM's own visible/locked/etc. filtering, and again defensively
// inside navTo() below — hiding a button from the sidebar is not access
// control by itself, see save_dsm_settings()/promote_to_admin() etc. on the
// SQL side for the actual enforcement.
const ADMIN_ONLY_NAV_IDS = ['a-nav-manager', 'a-teachers', 'a-starter-pack', 'a-settings', 'a-content-oversight', 'a-mascot-lines', 'a-audit-log'];
function setupSidebar(){
  // Use dynamic nav config if available, else fall back to hardcoded arrays
  // AUTH FIX (post-Phase 33): teacher is staff too — only real students get
  // the student nav. See auth.js's currentRole assignment comment.
  // ROLE SPLIT (ISOLATION_ROLES_PLAN.md §10/§11): admin and teacher no
  // longer see an identical sidebar — pass currentRole through so
  // dsmGetAdminNav() can drop ADMIN_ONLY_NAV_IDS items for a teacher caller.
  const tabs = (currentRole==='admin'||currentRole==='teacher')
    ? dsmGetAdminNav(currentRole)
    : dsmGetStudentNav();

  document.getElementById('sidebar-nav').innerHTML = tabs.map(t => {
    const cfg = t._cfg || {};
    const isGroup = t._group;
    if (isGroup) {
      return `<div style="padding:8px 14px 4px;font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:rgba(240,238,255,.3);margin-top:6px">${t.label}</div>`;
    }
    // Status badge logic
    let badge = '';
    if (cfg.status === 'coming_soon') badge = `<span style="margin-left:auto;font-size:8px;padding:2px 6px;background:rgba(255,185,95,.15);border:1px solid rgba(255,185,95,.3);color:#ffb95f;border-radius:6px;font-weight:800;letter-spacing:.04em">SOON</span>`;
    else if (cfg.status === 'event_only') badge = `<span style="margin-left:auto;font-size:8px;padding:2px 6px;background:rgba(236,72,153,.15);border:1px solid rgba(236,72,153,.3);color:#EC4899;border-radius:6px;font-weight:800;letter-spacing:.04em">EVENT</span>`;
    else if (cfg.locked) badge = `<span class="material-symbols-outlined" style="margin-left:auto;font-size:14px;color:rgba(240,238,255,.3)">lock</span>`;
    return `<button class="nav-btn" id="nav-${t.id}" onclick="navTo('${t.id}')" ${(cfg.locked||cfg.status==='coming_soon'||cfg.disabled)?'disabled':''} style="${(cfg.locked||cfg.status==='coming_soon'||cfg.disabled)?'opacity:0.5;cursor:not-allowed;pointer-events:none':''}">${
      t.icon ? `<span class="material-symbols-outlined">${t.icon}</span>` : ''
    }${t.label}${badge}</button>`;
  }).join('');

  document.querySelectorAll('.nav-btn').forEach(b=>{
    b.style.cssText='display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:12px;font-size:13px;font-weight:600;color:var(--text-muted);cursor:pointer;background:none;border:none;width:100%;text-align:left;transition:all .2s;letter-spacing:.02em;margin-bottom:2px;font-family:var(--fb)';
    b.onmouseover=function(){if(!this.classList.contains('active')){this.style.background='rgba(255,255,255,0.06)';this.style.color='var(--on-surface)';this.style.transform='translateX(3px)';}};
    b.onmouseout=function(){if(!this.classList.contains('active')){this.style.background='none';this.style.color='var(--text-muted)';this.style.transform='none';}};
  });
}
// DSM helpers — defined later in the DSM script block; stubs so setupSidebar doesn't crash before DSM loads
function dsmGetStudentNav(){return NAV_STUDENT;}
function dsmGetAdminNav(role){
  return (role==='admin') ? NAV_ADMIN : NAV_ADMIN.filter(t=>ADMIN_ONLY_NAV_IDS.indexOf(t.id)===-1);
}
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
  // Stop RFID capture (focus-stealing interval + AppStore subscription) when leaving the scanner
  if(id!=='a-scanner'&&typeof unmountRfidScanner==='function'){ unmountRfidScanner(); }
  if(id!=='a-pos'&&typeof unmountPosPayCapture==='function'){ unmountPosPayCapture(); }
  if(id!=='a-classroom'&&typeof unmountClassroomBuilder==='function'){ unmountClassroomBuilder(); }
  if(id!=='a-classroom-monitor'&&typeof unmountClassroomMonitor==='function'){ unmountClassroomMonitor(); }
  if(id!=='a-sections'&&typeof unmountSectionMaker==='function'){ unmountSectionMaker(); }
  if(id!=='a-enrollment'&&typeof unmountEnrollmentHub==='function'){ unmountEnrollmentHub(); }
  if(id!=='a-content-oversight'&&typeof unmountContentOversight==='function'){ unmountContentOversight(); }
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
  showPage(id);
  // close sidebar on mobile
  if(window.innerWidth<=1024)document.getElementById('sidebar').classList.remove('open');
}
function showPage(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const el=document.getElementById(id);
  if(el){el.classList.add('active');el.classList.add('fade-in');el.scrollTop=0;}
}

