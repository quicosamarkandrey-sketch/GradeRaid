// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD RECOVERY — "Set new password" screen
// (ISOLATION_ROLES_PLAN.md §11 "Account & access management", §12 step 5,
//  chunk A4 — see modules/admin/teacher-directory.js's "Send Reset Email"
//  button / teacher-directory-service.js's sendPasswordReset() for the
//  admin-side trigger.)
//
// FLOW
//   1. Admin clicks "Send Reset Email" on a Teacher Directory row →
//      DBService.sendPasswordResetEmail(email, redirectTo) calls Supabase's
//      resetPasswordForEmail(), with redirectTo pointing back at THIS app's
//      own origin+path (window.location.origin + window.location.pathname —
//      no fixed production URL is configured yet, so this has to be
//      dynamic; if a fixed URL is added to Supabase's redirect allow-list
//      later, this can be hardcoded instead).
//   2. The teacher/admin opens the email and clicks the link. Supabase
//      redirects back to that URL with recovery tokens attached. The
//      Supabase client is created with its default detectSessionInUrl:true
//      (see db-service.js _getClient()), so it silently parses those tokens
//      and exchanges them for a real (recovery-scoped) session the moment
//      the client is created on this fresh page load — no manual
//      location.hash/location.search parsing needed anywhere in this file.
//   3. That exchange fires a PASSWORD_RECOVERY event via onAuthStateChange.
//      This file listens for exactly that event and swaps in the "Set new
//      password" screen below instead of whatever screen would otherwise
//      show first (normally the login screen).
//   4. Because it's a real session, client.auth.updateUser({ password })
//      works directly against it — no separate "verify OTP/token" step.
//   5. On success: sign out (so the person logs back in fresh with the new
//      password, same posture as any other credential change) and return to
//      the normal login screen with a success toast.
//
// SCOPE NOTE: this screen has no role awareness — it just completes
// whatever recovery session Supabase resolved from the URL. Chunk A4 only
// adds the ADMIN-SIDE TRIGGER button to the Teacher Directory (per the
// build-order decision: directory-triggered resets only, no self-service
// "Forgot password?" link on the login screen yet). Any Supabase Auth
// account that receives a reset email — by whatever means — completes it
// through this same screen; that's fine since resetPasswordForEmail() is
// what generates the token in the first place.
// ─────────────────────────────────────────────────────────────────────────────

window.showRecoveryScreen = function () {
  const loginScreen = document.getElementById('login-screen');
  const regScreen = document.getElementById('reg-screen');
  if (loginScreen) loginScreen.style.display = 'none';
  if (regScreen) regScreen.classList.remove('open');

  document.getElementById('recovery-card-content').innerHTML = `
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-family:var(--fh);font-size:28px;font-weight:900">EDUQUEST</div>
      <div style="color:var(--text-muted);font-size:13px;margin-top:4px">🔑 Set a new password</div>
    </div>

    <div class="form-group">
      <label class="form-label">
        New Password <span style="color:var(--text-muted);font-size:11px">(min 8 characters, letters + numbers)</span>
      </label>
      <div style="position:relative">
        <input type="password" id="rec-pass" placeholder="••••••••" autocomplete="new-password"
               style="width:100%;padding-right:40px" oninput="recCheckValidation()">
        ${regPasswordToggleBtn('rec-pass')}
      </div>
      <div id="rec-pass-msg" class="reg-validation-msg"></div>
    </div>

    <div class="form-group">
      <label class="form-label">Confirm New Password</label>
      <div style="position:relative">
        <input type="password" id="rec-pass-confirm" placeholder="••••••••" autocomplete="new-password"
               style="width:100%;padding-right:40px" oninput="recCheckValidation()"
               onkeydown="if(event.key==='Enter')doSetNewPassword()">
        ${regPasswordToggleBtn('rec-pass-confirm')}
      </div>
      <div id="rec-pass-confirm-msg" class="reg-validation-msg"></div>
    </div>

    <div id="rec-err" style="color:#ffb4ab;font-size:13px;margin-bottom:10px;display:none"></div>

    <button class="btn btn-primary btn-block" id="rec-submit-btn" style="padding:13px;font-size:15px" onclick="doSetNewPassword()">
      Set New Password →
    </button>
  `;

  // Own copy of the screen shell + validation-message styles, deliberately
  // NOT relying on registrations.js's showRegScreen() having run first (it
  // injects the same-named .reg-validation-msg classes, but only the first
  // time someone opens the registration screen — a recovery-link visit is
  // very likely the FIRST thing to happen on a fresh page load, so this
  // can't assume that's already there).
  if (!document.getElementById('recovery-screen-styles')) {
    const style = document.createElement('style');
    style.id = 'recovery-screen-styles';
    style.textContent = `
      #recovery-screen {
        display: none; position: fixed; inset: 0; z-index: 999;
        background: var(--surface, #1a1a2e);
        overflow-y: auto; padding: 24px 16px;
        justify-content: center; align-items: flex-start;
      }
      #recovery-screen.open { display: flex; }
      .reg-validation-msg { font-size: 11px; min-height: 16px; margin-top: 3px; }
      .reg-validation-msg.ok  { color: #4edea3; }
      .reg-validation-msg.err { color: #ffb4ab; }
    `;
    document.head.appendChild(style);
  }

  document.getElementById('recovery-screen').classList.add('open');
  setTimeout(function () { const f = document.getElementById('rec-pass'); if (f) f.focus(); }, 50);
};

function recCheckValidation() {
  const passEl = document.getElementById('rec-pass');
  const confirmEl = document.getElementById('rec-pass-confirm');
  if (!passEl || !confirmEl) return;
  const pass = passEl.value;
  const confirmVal = confirmEl.value;
  const passMsg = document.getElementById('rec-pass-msg');
  const confirmMsg = document.getElementById('rec-pass-confirm-msg');

  if (!pass) {
    passMsg.textContent = ''; passMsg.className = 'reg-validation-msg';
  } else {
    const v = regValidatePassword(pass);
    passMsg.textContent = v.ok ? '✓ Looks good' : v.msg;
    passMsg.className = 'reg-validation-msg ' + (v.ok ? 'ok' : 'err');
  }

  if (!confirmVal) {
    confirmMsg.textContent = ''; confirmMsg.className = 'reg-validation-msg';
  } else {
    const match = confirmVal === pass;
    confirmMsg.textContent = match ? '✓ Passwords match' : 'Passwords do not match.';
    confirmMsg.className = 'reg-validation-msg ' + (match ? 'ok' : 'err');
  }
}

window.doSetNewPassword = async function () {
  const pass = document.getElementById('rec-pass').value;
  const confirmVal = document.getElementById('rec-pass-confirm').value;
  const err = document.getElementById('rec-err');
  err.style.display = 'none';

  const v = regValidatePassword(pass);
  if (!v.ok) { err.textContent = '❌ ' + v.msg; err.style.display = 'block'; return; }
  if (pass !== confirmVal) { err.textContent = '❌ Passwords do not match.'; err.style.display = 'block'; return; }

  const client = (typeof DBService !== 'undefined') ? DBService.getAuthClient() : null;
  if (!client) {
    err.textContent = '⏳ Still connecting, please try again in a moment.';
    err.style.display = 'block';
    return;
  }

  const btn = document.getElementById('rec-submit-btn');
  const originalLabel = btn.textContent;
  btn.disabled = true; btn.textContent = 'Saving…';

  const { error } = await client.auth.updateUser({ password: pass });

  btn.disabled = false; btn.textContent = originalLabel;

  if (error) {
    // Expired/already-used links land here — updateUser() fails against a
    // session that never got established or has since gone stale.
    err.textContent = '❌ ' + (error.message || 'Could not update your password. The reset link may have expired — ask your admin to send a new one.');
    err.style.display = 'block';
    return;
  }

  // Sign out of the recovery session so the person logs back in fresh with
  // the new password, same posture as any other credential change (see
  // doLogout()'s comment in auth.js for why signOut() itself is async).
  try { await client.auth.signOut(); } catch (e) { console.warn('[recovery] post-reset signOut failed:', e); }

  document.getElementById('recovery-screen').classList.remove('open');
  const loginScreen = document.getElementById('login-screen');
  if (loginScreen) loginScreen.style.display = 'flex';
  if (typeof toast === 'function') toast('✅ Password updated. Log in with your new password.');
};

// ── LISTEN FOR THE RECOVERY REDIRECT ────────────────────────────────────────
// Registered once, at script-load time — this runs on EVERY page load, not
// just ones that came from a reset email, so it has to be a no-op the rest
// of the time (and it is: PASSWORD_RECOVERY only ever fires when the client
// actually parsed recovery tokens out of the URL). Calling getAuthClient()
// here is what triggers the Supabase client's first creation on a fresh
// page load coming straight from a recovery link — same lazy singleton
// db-service.js's _getClient() would hand back to whatever else asked for
// it a few script-tags later regardless.
(function () {
  const client = (typeof DBService !== 'undefined') ? DBService.getAuthClient() : null;
  if (!client) return;
  client.auth.onAuthStateChange(function (event) {
    if (event === 'PASSWORD_RECOVERY') {
      window.showRecoveryScreen();
    }
  });
})();
