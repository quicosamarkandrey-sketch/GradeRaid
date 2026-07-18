// ─────────────────────────────────────────────────────────────────────────────
// SHARED AUTH — Login, logout, session initialization
//
// Exports: selectRole(), doLogin(), doLogout(), bootApp()
//
// DEPENDENCIES:
//   - DB, currentUser, currentRole, selectedLoginRole (globals / core/app-state)
//   - loadDB(), saveDB() (core/db-service via legacy bridge)
//   - updateTopbar(), setupSidebar() (ui/topbar, shared/nav)
//   - renderAdminDashboard(), renderStudentDashboard() (ui/dashboard)
//   - showPage() (shared/nav)
//   - WBC, wbmStopSpawnLoop(), wbcUpdateTopbarWidget() (world-boss — global)
//   - getStageProgress() (campaign — global)
//   - quizTimer (quiz — global)
//
// PHASE 1 EXTRACTION NOTE:
//   bootApp() is monkey-patched by at least 4 other modules in the monolith:
//   WBSN (summon notify), title cleanup, DSM, and achievement system.
//   All patches are preserved in the monolith. This extracted version contains
//   the base bootApp() only. Patches will be replaced with explicit init() calls
//   in Phase 5 (Replace Monkey-Patches).
// ─────────────────────────────────────────────────────────────────────────────

// selectRole() is kept as a harmless no-op for backward compatibility — the
// login screen no longer has separate Student/Teacher buttons (removed per
// design update: login is now a single normal form, role is resolved from
// profiles.role after auth, same as it already was under the hood).
function selectRole(role){
  selectedLoginRole=role;
}
// doLogin() is now ASYNC — it calls Supabase Auth over the network instead of
// checking DB.students/DB.admin locally. Callers (the login button's onclick)
// don't need to change: an onclick handler is allowed to fire an async
// function and not await it. Nothing downstream reads currentUser/currentRole
// until bootApp() runs, and bootApp() is only ever called from inside here,
// after the real session + profile are both confirmed — so there's no race.
//
// AUTH MIGRATION NOTE: students/admins now log in with EMAIL + password via
// real Supabase Auth (supabase.auth.signInWithPassword), not a local DB
// lookup. profiles.id is the Supabase Auth UUID (auth.uid()), so once signed
// in we fetch the caller's own profiles row (allowed by
// profiles_select_all_authenticated) to populate currentUser/currentRole —
// role comes from profiles.role, not from which login button was clicked.
// selectedLoginRole is kept only as a cosmetic hint for the demo-text box;
// it no longer gates which account type can log in.
async function doLogin(){
  const email=document.getElementById('login-user').value.trim().toLowerCase();
  const p=document.getElementById('login-pass').value.trim();
  const err=document.getElementById('login-err');
  const pendingErr=document.getElementById('login-pending-err');
  const btn=document.getElementById('login-submit-btn');
  err.style.display='none';
  pendingErr.style.display='none';

  if (!email || !p) {
    err.innerHTML='❌ Please enter your email and password.';
    err.style.display='block';
    return;
  }

  // BUGFIX (confusing "dead" login button): signInWithPassword() + the
  // profile fetch below are a real network round-trip with nothing else on
  // screen changing in the meantime, which read as the button doing
  // nothing and invited people to click it repeatedly. eqButtonLoading()
  // (modules/shared/button-loading.js) swaps the button to a disabled
  // spinner+label immediately and restores it via the `finally` below on
  // EVERY exit path — success, invalid credentials, pending registration,
  // deactivated account, or an unexpected error — so a fast double-click
  // can't fire two concurrent sign-in attempts either.
  if (typeof eqButtonLoading === 'function') eqButtonLoading(btn, true, { label: 'Signing in…' });
  try {

  const client = (typeof DBService !== 'undefined') ? DBService.getAuthClient() : null;
  if (!client) {
    err.innerHTML='⏳ Still connecting, please try again in a moment.';
    err.style.display='block';
    return;
  }

  const { data: authData, error: authError } = await client.auth.signInWithPassword({
    email: email, password: p,
  });

  if (authError) {
    // Supabase returns a generic "Invalid login credentials" for both
    // wrong-password and unknown-email, by design (so a login form can't be
    // used to discover which emails are registered). We surface that as-is,
    // then separately check registration status for a more specific
    // pending/rejected message, same as before — but via the
    // check_registration_status() RPC now rather than the local
    // DB.registrations cache, since that cache is only ever populated with
    // an unauthenticated visitor's OWN row under the tightened RLS policy
    // added in wave2_registration_security_fixes.sql, not everyone's.
    if (typeof RegistrationService !== 'undefined') {
      const statusResult = await RegistrationService.checkStatus(email);
      if (statusResult.ok && statusResult.found) {
        if (statusResult.status === 'pending') { pendingErr.style.display='block'; document.getElementById('login-pass').value=''; return; }
        if (statusResult.status === 'rejected') { err.innerHTML='❌ Your registration was not approved. Contact your teacher.'; err.style.display='block'; document.getElementById('login-pass').value=''; return; }
      }
    }
    err.innerHTML='❌ Incorrect email or password.';
    err.style.display='block';
    document.getElementById('login-pass').value='';
    return;
  }

  // Auth succeeded — fetch this user's own profile row to determine role.
  const uid = authData.user.id;
  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('*')
    .eq('id', uid)
    .single();

  if (profileError || !profile) {
    // AUTH MIGRATION NOTE: registration now creates the real Auth account
    // up front (see registrations.js doRegister() / RegistrationService),
    // so signInWithPassword() above can succeed for a still-pending student
    // — there's a real, working account, just no `profiles` row yet because
    // an admin hasn't approved it. That's expected, not an error state, so
    // check registration status before falling back to the generic message
    // (which now only fires for the genuinely unexpected case: a Supabase
    // Auth account with no matching registration record at all).
    let handled = false;
    if (typeof RegistrationService !== 'undefined') {
      const statusResult = await RegistrationService.checkStatus(email);
      if (statusResult.ok && statusResult.found) {
        if (statusResult.status === 'pending') { pendingErr.style.display='block'; handled = true; }
        else if (statusResult.status === 'rejected') { err.innerHTML='❌ Your registration was not approved. Contact your teacher.'; err.style.display='block'; handled = true; }
      }
    }
    if (!handled) {
      err.innerHTML='❌ Signed in, but no profile was found for this account. Contact your teacher.';
      err.style.display='block';
    }
    document.getElementById('login-pass').value='';
    await client.auth.signOut();
    return;
  }

  // ROLE SPLIT (ISOLATION_ROLES_PLAN.md §11/§12 step 5, chunk A3): a
  // deactivated admin/teacher account (profile.is_active === false) already
  // loses every RLS-gated read/write and RPC the moment
  // phase36_deactivate_reactivate.sql's helper-function update lands
  // server-side — this is belt-and-suspenders client-side UX so a
  // deactivated teacher sees a clear message instead of a session that
  // silently can't do anything. Students have no is_active column semantics
  // defined yet (only admin/teacher accounts can be deactivated via
  // deactivate_teacher_account()), so this only ever fires for staff.
  if (profile.is_active === false) {
    err.innerHTML='❌ This account has been deactivated. Contact your school\'s admin.';
    err.style.display='block';
    document.getElementById('login-pass').value='';
    await client.auth.signOut();
    return;
  }

  // AUTH MIGRATION — SHAPE BRIDGE: every other module in the app (topbar.js,
  // dashboard.js, etc.) was written against the OLD DB.students[i]/DB.admin
  // shape: { name, init, color, xp, coins, level, tier, attendance, quizAvg,
  // firstName, lastName, displayName, email, profilePic, ... }. The real
  // `profiles` table uses different column names (display_name, first_name,
  // attendance_pct, profile_pic_url, snake_case throughout). Rather than
  // hunt down and edit every downstream read of currentUser.* across the
  // codebase, we normalize ONCE here, right after fetching the profile, so
  // currentUser keeps the exact shape every other file already expects.
  // If you add new profiles columns that other modules need, map them here
  // too rather than reading profile.* directly elsewhere.
  currentUser = {
    id: profile.id,
    name: profile.display_name,
    displayName: profile.display_name,
    firstName: profile.first_name,
    lastName: profile.last_name,
    init: profile.init,
    color: profile.color,
    xp: profile.xp,
    coins: profile.coins,
    level: profile.level,
    tier: profile.tier,
    attendance: profile.attendance_pct,
    quizAvg: profile.quiz_avg,
    profilePic: profile.profile_pic_url,
    classId: profile.class_id,
    role: profile.role,
    email: authData.user.email,
    joinDate: profile.join_date,
    // BUGFIX (renderStudentQuizzes crash — "Cannot read properties of
    // undefined (reading 'length')" at index.html renderStudentQuizzes):
    // this shape-bridge object was missing completedQuizzes entirely, unlike
    // the DB.students[] shape (db-service.js's refreshFromRemote()) which
    // always defaults it to []. Every render function that reads
    // currentUser.completedQuizzes (Quest Board's streak stat, the profile
    // stats strip, the dashboard's pending-quiz filter) assumes it's always
    // at least an array, so a real-Supabase-login currentUser without this
    // field threw the instant a student opened the Quest Board. DB.students
    // is already hydrated (AppStore.ready resolves before the login screen
    // even shows), so reuse that row's completedQuizzes if present instead
    // of just defaulting to [] here, so an in-progress session's quiz
    // history isn't dropped.
    completedQuizzes: (typeof DB !== 'undefined' && DB.students
      ? (DB.students.find(s => s.id === profile.id) || {}).completedQuizzes
      : null) || [],
  };
  // AUTH FIX (post-Phase 33 — ISOLATION_ROLES_PLAN.md §12 step 4 follow-up):
  // this used to collapse anything that wasn't 'admin' straight to 'student',
  // which meant a real teacher account (role='teacher', once the relabel in
  // §1 lands) would be logged in AS a student — wrong dashboard, wrong nav,
  // wrong topbar. profiles.role only ever has three values ('admin',
  // 'teacher', 'student'); pass the first two through as-is and only default
  // to 'student' for anything else. Every existing `currentRole==='student'`/
  // `!== 'student'` check elsewhere in the app (world-boss, mail, shop,
  // titles, achievements, etc.) already works unchanged either way, since
  // 'teacher' is just as not-student as 'admin' was. The only call sites that
  // ever singled out 'admin' specifically were auth.js's own bootApp() and
  // nav.js's setupSidebar() (both updated alongside this) plus
  // world-boss/loot-rain.js's admin-panel check — see those files' comments.
  currentRole = (profile.role === 'admin' || profile.role === 'teacher') ? profile.role : 'student';

  // BUGFIX (see REPORT_cross_account_data_and_template_row.md, Part 5, and
  // REPORT_empty_data_until_admin_login.md): DB (the in-memory cache
  // everything else in the app reads) was still whatever initRemote()
  // pulled at PAGE LOAD time — under whatever session existed then (a
  // previous account's, or no session at all). signInWithPassword() above
  // only changes which account can write / which rows RLS allows on the
  // NEXT query; it does nothing to a cache that was already populated
  // before this login happened. That's what let a teacher account render a
  // previous session's (e.g. admin's, or another teacher's) full roster
  // after switching accounts without a full page reload in between. Await
  // a fresh, correctly-scoped pull under THIS session before bootApp()
  // renders anything.
  // refreshAfterAuthChange() calls AppStore.syncFromLegacy() internally,
  // which already re-clones into window.DB and notifies subscribers — no
  // separate DB reassignment needed here.
  if (typeof DBService !== 'undefined' && typeof DBService.refreshAfterAuthChange === 'function') {
    await DBService.refreshAfterAuthChange();
  }

  // Now that a real Supabase Auth session exists, kick off a fresh,
  // authenticated fetch of classroom_layouts/seats/seat_assignments right
  // away rather than waiting for whichever classroom page happens to mount
  // first. See classroom_index.js's _bootstrapClassroomData() — this is the
  // "auth.js doLogin()" call site its own comments already refer to.
  if (typeof window.refreshClassroomData === 'function') {
    window.refreshClassroomData().catch(function (e) {
      console.warn('[auth] post-login classroom data refresh failed:', e);
    });
  }

  // BUGFIX (section names showing as raw IDs): class_sections is fetched
  // once by sections_index.js's _bootstrapSectionData(), triggered by
  // AppStore.ready — which normally fires before the user has logged in.
  // That unauthenticated fetch comes back empty under RLS, so
  // state.classSections stayed [] for the rest of the session unless the
  // user happened to visit Section Maker/Registrations (the only other
  // callers of window.refreshSectionData()) first. Every screen that
  // renders a section's display name (Live Monitor, Quiz Builder,
  // Achievements, Titles, Campaign Map, Classroom Builder, My Section,
  // Analytics, the kiosk) goes through getClassLabel(), which silently
  // falls back to the raw id when classSections has no match — hence
  // teachers/students sometimes seeing "Grade 10 – Rizal" and sometimes
  // just seeing the section's UUID. Same fix as refreshClassroomData
  // above: force a fresh, authenticated re-fetch right after login.
  if (typeof window.refreshSectionData === 'function') {
    window.refreshSectionData().catch(function (e) {
      console.warn('[auth] post-login section data refresh failed:', e);
    });
  }

  bootApp();

  } finally {
    if (typeof eqButtonLoading === 'function') eqButtonLoading(btn, false);
  }
}
// restoreSession() — BUGFIX (refresh logs the user out): Supabase Auth
// already persists its access/refresh token in localStorage
// (persistSession:true in DBService's client config, see db-service.js),
// and DBService.initRemote() already checks client.auth.getSession() to
// decide whether to pull fresh data on page load. But NOTHING previously
// used that saved session to actually restore the LOGGED-IN UI: currentUser
// and currentRole are plain in-memory variables (see app-state.js), so a
// hard refresh reset them to null every time and the login screen showed
// again — even though the Supabase session itself was still valid and
// initRemote() had already pulled this user's data.
//
// This mirrors doLogin()'s post-auth steps (fetch own profile row, map it
// to the currentUser shape bridge, resolve currentRole, then bootApp())
// but starting from an existing session instead of a fresh
// signInWithPassword() call. Called once from index.html inside the
// AppStore.ready.then(...) bootstrap, after DB/AppStore hydration — by the
// time getSession()'s network round trip resolves, every later <script>
// tag (campaign, world-boss, etc.) has already executed, so functions like
// getStageProgress()/wbcUpdateTopbarWidget() that bootApp() depends on are
// safely defined.
// showLoginScreen() — pairs with #boot-loading in index.html (BUGFIX: login
// screen flash on refresh). Hides the boot spinner and reveals the login
// form. login-screen's CSS rule (#login-screen{display:flex;...} in
// base.css) is normally what shows it — it now starts with an inline
// display:none in the HTML that outranks that, so this restores 'flex'
// explicitly rather than just clearing the inline style, to avoid depending
// on CSS cascade order.
function showLoginScreen(){
  const boot = document.getElementById('boot-loading');
  if (boot) boot.style.display = 'none';
  const login = document.getElementById('login-screen');
  if (login) login.style.display = 'flex';
}
async function restoreSession(){
  const client = (typeof DBService !== 'undefined') ? DBService.getAuthClient() : null;
  if (!client) { showLoginScreen(); return; }

  try {
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData || !sessionData.session) { showLoginScreen(); return; } // no saved session — normal logged-out state

    const authUser = sessionData.session.user;
    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .single();

    // Same edge cases doLogin() guards against: a still-pending registration
    // (real Auth account, no profiles row yet) or a deactivated staff
    // account. On refresh there's no login form to show an error in, so we
    // just sign out quietly and leave the person on the login screen —
    // they'll get the normal doLogin() error messaging if they try again.
    if (profileError || !profile || profile.is_active === false) {
      console.warn('[auth] restoreSession: session present but profile missing/inactive; signing out.', profileError);
      await client.auth.signOut();
      showLoginScreen();
      return;
    }

    currentUser = {
      id: profile.id,
      name: profile.display_name,
      displayName: profile.display_name,
      firstName: profile.first_name,
      lastName: profile.last_name,
      init: profile.init,
      color: profile.color,
      xp: profile.xp,
      coins: profile.coins,
      level: profile.level,
      tier: profile.tier,
      attendance: profile.attendance_pct,
      quizAvg: profile.quiz_avg,
      profilePic: profile.profile_pic_url,
      classId: profile.class_id,
      role: profile.role,
      email: authUser.email,
      joinDate: profile.join_date,
      completedQuizzes: (typeof DB !== 'undefined' && DB.students
        ? (DB.students.find(s => s.id === profile.id) || {}).completedQuizzes
        : null) || [],
    };
    currentRole = (profile.role === 'admin' || profile.role === 'teacher') ? profile.role : 'student';

    // DB was already hydrated correctly-scoped by initRemote() (it only
    // pulls when a saved session exists), so no extra refreshAfterAuthChange()
    // pull is needed here — just render. bootApp() hides #boot-loading itself.
    //
    // BUGFIX (section names showing as raw IDs on refresh): unlike DB,
    // class_sections is NOT part of initRemote()'s pull — it's fetched
    // separately by sections_index.js's _bootstrapSectionData(), fired once
    // from AppStore.ready. On a hard refresh that fetch can race the
    // Supabase client's own session restore and lose, leaving
    // state.classSections empty and every getClassLabel() call falling back
    // to the raw id. Force a fresh, now-authenticated re-fetch here too —
    // same fix as doLogin() above.
    if (typeof window.refreshSectionData === 'function') {
      window.refreshSectionData().catch(function (e) {
        console.warn('[auth] restoreSession section data refresh failed:', e);
      });
    }

    bootApp();
  } catch (e) {
    console.warn('[auth] restoreSession failed; leaving user on login screen:', e);
    showLoginScreen();
  }
}
// doLogout() is now ASYNC for the same reason doLogin() is: ending a real
// Supabase Auth session is a network call (client.auth.signOut()). Without
// this, the Supabase client would keep its access token in localStorage and
// silently re-authenticate the same user on next page load, even after
// clicking "Logout" — signOut() explicitly revokes/clears that session.
async function doLogout(){
  // Cleanup 5: closeProfile absorbed from index.html monkey patch (doLogout → closeProfile → _origLogout)
  if(typeof closeProfile==='function')closeProfile();
  const logoutBtn=document.getElementById('sidebar-logout-btn');
  // Same "button looks dead" problem as doLogin() — client.auth.signOut()
  // is a network call. finally-reset at the end (not left for bootApp() to
  // clean up, since logging out doesn't go through bootApp()) so the
  // sidebar button is back to normal the next time this account — or the
  // next one signed into this browser — logs in and out again.
  if (typeof eqButtonLoading === 'function') eqButtonLoading(logoutBtn, true, { label: 'Signing out…' });
  try {
  const client = (typeof DBService !== 'undefined') ? DBService.getAuthClient() : null;
  if (client) { try { await client.auth.signOut(); } catch (e) { console.warn('[auth] signOut failed:', e); } }
  // BUGFIX: without this, switching accounts on the same browser (e.g.
  // testing as Teacher A then Teacher B, or after an ownership transfer
  // moves a teacher's content elsewhere) left the PREVIOUS account's cached
  // shop_products/boss_events/etc. sitting in localStorage. The next login's
  // first bulk push would then try to upsert rows still stamped with the
  // old owner_teacher_id/class_id, which correctly fails RLS server-side —
  // seen as "[DBService] remote sync failed" for shop_products/boss_events.
  // Clearing here forces the next login to hydrate fresh from Supabase
  // instead of trusting a stale local mirror.
  if (typeof DBService !== 'undefined' && typeof DBService.remove === 'function') {
    try { DBService.remove(); } catch (e) { console.warn('[auth] local cache clear failed:', e); }
  }
  // Same "don't leak the previous account's state into the next login on
  // this browser" reasoning as DBService.remove() above — a stale "resume
  // last page" or (far more importantly) a stale kiosk-lock flag has no
  // business surviving past an explicit, authenticated logout.
  try { localStorage.removeItem('eq_last_page'); } catch (e) {}
  if (typeof _enrollPersistLock === 'function') { try { _enrollPersistLock(false); } catch (e) {} }
  currentUser=null;currentRole=null;
  // Reset combat state
  WBC.joined=false;WBC.bossIdx=-1;WBC.qIdx=0;WBC.answered=[];WBC.comboCount=0;
  WBC.battleStartTime=0;WBC.cooldownActive=false;
  if(WBC.refreshInterval){clearInterval(WBC.refreshInterval);WBC.refreshInterval=null;}
  if(WBC.cooldownTimeout){clearTimeout(WBC.cooldownTimeout);WBC.cooldownTimeout=null;}
  // Stop minion timers
  wbmStopSpawnLoop();
  // System Health presence heartbeat (ADMIN_SYSTEM_HEALTH.md Phase 2):
  // paired with the startPresenceHeartbeat() call in bootApp() below, same
  // start/stop lifecycle pairing as WBC.refreshInterval just above.
  if (typeof SystemHealthService !== 'undefined') SystemHealthService.stopPresenceHeartbeat();
  if (typeof shStopCountsRefresh === 'function') shStopCountsRefresh();
  document.getElementById('main-app').style.display='none';
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('login-user').value='';document.getElementById('login-pass').value='';
  document.getElementById('login-err').style.display='none';
  if(quizTimer)clearInterval(quizTimer);
  document.getElementById('stage-map-btn').style.display='none';
  activeWorld=0;
  } finally {
    if (typeof eqButtonLoading === 'function') eqButtonLoading(logoutBtn, false);
  }
}
function bootApp(){
  // Cleanup 5: profInitAll absorbed from index.html monkey patch (bootApp → profInitAll → _origBoot → refreshAllAvatars)
  if(typeof profInitAll==='function')profInitAll();
  // BUGFIX (login screen flash on refresh): #boot-loading is the true
  // default state now (see index.html), covering both a fresh doLogin()
  // and a restoreSession() on page refresh — harmless no-op if it's
  // already hidden (e.g. manual login, where it was hidden by
  // showLoginScreen() back when restoreSession() found no session).
  const boot = document.getElementById('boot-loading');
  if(boot) boot.style.display='none';
  document.getElementById('login-screen').style.display='none';
  document.getElementById('main-app').style.display='block';
  updateTopbar();setupSidebar();
  // System Health presence heartbeat (ADMIN_SYSTEM_HEALTH.md Phase 2): starts
  // on every bootApp() call — both a fresh doLogin() and a restoreSession()
  // on refresh — and is idempotent (no-ops if already running), since
  // bootApp() itself runs from both call sites. Stopped in doLogout() above.
  if (typeof SystemHealthService !== 'undefined') SystemHealthService.startPresenceHeartbeat();
  if(typeof restoreSidebarState==='function')restoreSidebarState();

  // SECURITY FIX: a browser refresh used to always fall through to the
  // dashboard branch below — which, for a device left in Card Enrollment's
  // Self-Service kiosk Lock Mode, meant reloading was a one-tap escape
  // hatch onto the full admin/teacher shell (sidebar, every other page,
  // all reachable again). This persisted flag takes priority over
  // everything else in this function: if it's set, re-enter the locked
  // kiosk screen directly and skip the dashboard/last-page logic below
  // entirely. See enrollment-hub.js's _enrollRestoreLockedKioskOnBoot().
  const kioskLockedOnDisk = (currentRole==='admin'||currentRole==='teacher') &&
    typeof _enrollHasPersistedLock==='function' && _enrollHasPersistedLock();

  if (kioskLockedOnDisk && typeof _enrollRestoreLockedKioskOnBoot==='function') {
    _enrollRestoreLockedKioskOnBoot();
  } else {
    // BUGFIX: a reload otherwise always discarded whatever page you were
    // actually on and bounced you back to the dashboard. Resume the last
    // page visited (persisted by navTo() — see nav.js) when there's a
    // usable one for this session's role; fall back to the dashboard
    // exactly as before when there isn't (fresh login, nothing saved yet,
    // or the saved id belonged to a different role).
    const lastPage = (typeof getLastVisitedPage === 'function') ? getLastVisitedPage(currentRole) : null;
    const dashId = (currentRole==='admin'||currentRole==='teacher') ? 'a-dashboard' : 's-dashboard';
    if (lastPage && lastPage !== dashId && typeof navTo === 'function') {
      navTo(lastPage);
    } else if(currentRole==='admin'||currentRole==='teacher'){renderAdminDashboard();showPage('a-dashboard');}
    else{renderStudentDashboard();showPage('s-dashboard');}
  }
  // Show stage map button for students — unless an admin has hidden,
  // locked, disabled, or "coming soon"-ed it via Navigation Manager >
  // Student Nav (DSM_STUDENT_DEFAULTS' s-stagemap-btn widget row; see
  // dsm-manager.js's dsmGetWidgetConfig()).
  const btn = document.getElementById('stage-map-btn');
  if(btn){
    const cfg = (typeof dsmGetWidgetConfig==='function')
      ? dsmGetWidgetConfig('s-stagemap-btn')
      : { visible:true, locked:false, disabled:false, status:'active', lockMsg:'' };
    const gated = cfg.locked || cfg.disabled || cfg.status==='coming_soon';
    if(currentRole==='student' && cfg.visible){
      btn.style.display = 'flex';
      btn.disabled = gated;
      btn.style.opacity = gated ? '0.5' : '';
      btn.style.pointerEvents = gated ? 'none' : '';
      btn.style.cursor = gated ? 'not-allowed' : '';
      btn.title = gated ? (cfg.lockMsg || (cfg.status==='coming_soon' ? 'Coming Soon' : 'Locked')) : 'Quest Map';
    } else {
      btn.style.display = 'none';
    }
  }
  // Show notif dot if student has active stage
  if(currentRole==='student'){
    const prog = getStageProgress(currentUser);
    const dot = document.getElementById('stage-notif');
    if(dot) dot.style.display = prog.activeStageId ? 'flex' : 'none';
  }
  // Show boss topbar widget if active boss
  wbcUpdateTopbarWidget();
  // Reset WBC join state on new login
  WBC.joined=false; WBC.bossIdx=-1; WBC.qIdx=0; WBC.comboCount=0; WBC.cooldownActive=false;
  if(WBC.refreshInterval){clearInterval(WBC.refreshInterval);WBC.refreshInterval=null;}
  if(typeof refreshAllAvatars==='function')refreshAllAvatars();
}
