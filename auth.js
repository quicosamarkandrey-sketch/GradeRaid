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

function selectRole(role){
  selectedLoginRole=role;
  document.getElementById('role-student').classList.toggle('active',role==='student');
  document.getElementById('role-admin').classList.toggle('active',role==='admin');
  // AUTH MIGRATION: this used to show hardcoded demo username/password pairs
  // (e.g. admin/admin123, jose/pass123). Those accounts no longer exist as
  // such — login is now real email+password via Supabase Auth — so this
  // just shows a role-appropriate hint instead of fake credentials.
  const demo=document.getElementById('demo-text');
  if(role==='admin'){demo.innerHTML='<b style="color:#ffb4ab">Teacher login</b><br><span style="font-size:12px;color:var(--text-muted)">Use your teacher email and password.</span>';}
  else{demo.innerHTML='<b style="color:#d0bcff">Student login</b><br><span style="font-size:12px;color:var(--text-muted)">Use the email and password from your registration.</span>';}
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
  err.style.display='none';
  pendingErr.style.display='none';

  if (!email || !p) {
    err.innerHTML='❌ Please enter your email and password.';
    err.style.display='block';
    return;
  }

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

  bootApp();
}
// doLogout() is now ASYNC for the same reason doLogin() is: ending a real
// Supabase Auth session is a network call (client.auth.signOut()). Without
// this, the Supabase client would keep its access token in localStorage and
// silently re-authenticate the same user on next page load, even after
// clicking "Logout" — signOut() explicitly revokes/clears that session.
async function doLogout(){
  // Cleanup 5: closeProfile absorbed from index.html monkey patch (doLogout → closeProfile → _origLogout)
  if(typeof closeProfile==='function')closeProfile();
  const client = (typeof DBService !== 'undefined') ? DBService.getAuthClient() : null;
  if (client) { try { await client.auth.signOut(); } catch (e) { console.warn('[auth] signOut failed:', e); } }
  currentUser=null;currentRole=null;
  // Reset combat state
  WBC.joined=false;WBC.bossIdx=-1;WBC.qIdx=0;WBC.answered=[];WBC.comboCount=0;
  WBC.battleStartTime=0;WBC.cooldownActive=false;
  if(WBC.refreshInterval){clearInterval(WBC.refreshInterval);WBC.refreshInterval=null;}
  if(WBC.cooldownTimeout){clearTimeout(WBC.cooldownTimeout);WBC.cooldownTimeout=null;}
  // Stop minion timers
  wbmStopSpawnLoop();
  document.getElementById('main-app').style.display='none';
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('login-user').value='';document.getElementById('login-pass').value='';
  document.getElementById('login-err').style.display='none';
  if(quizTimer)clearInterval(quizTimer);
  document.getElementById('stage-map-btn').style.display='none';
  activeWorld=0;
}
function bootApp(){
  // Cleanup 5: profInitAll absorbed from index.html monkey patch (bootApp → profInitAll → _origBoot → refreshAllAvatars)
  if(typeof profInitAll==='function')profInitAll();
  document.getElementById('login-screen').style.display='none';
  document.getElementById('main-app').style.display='block';
  updateTopbar();setupSidebar();
  if(typeof restoreSidebarState==='function')restoreSidebarState();
  if(currentRole==='admin'||currentRole==='teacher'){renderAdminDashboard();showPage('a-dashboard');}
  else{renderStudentDashboard();showPage('s-dashboard');}
  // Show stage map button for students
  const btn = document.getElementById('stage-map-btn');
  if(btn) btn.style.display = currentRole==='student' ? 'flex' : 'none';
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
