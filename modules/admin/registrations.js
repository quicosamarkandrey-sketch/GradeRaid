// ══════════════════════════════════════════════════════
//  modules/admin/registrations.js
//  Student Registration system — public form + admin review
//  Extracted from index.html (Phase 3 Day 18-19)
//  Wave 2 (see Registration_Fix_List.md): registration now creates a real
//  Supabase Auth account up front (via RegistrationService.registerStudent,
//  see registrations-service.js) and `id` is that account's real Auth UUID,
//  not a client-generated key — passwords are never stored in this table
//  or this app's own DB at all; GoTrue (Supabase Auth) owns them.
//
//  DB table: DB.registrations[]
//  Shape: { id, firstName, lastName, username, email,
//           studentId, gradeLevel, section,
//           status ('pending'|'approved'|'rejected'),
//           submittedAt, reviewedAt, reviewedBy,
//           rejectionReason, approvedStudentId }
// ══════════════════════════════════════════════════════

// ── HELPERS ────────────────────────────────────────────
function regPickColor(username) {
  const colors = ['#8b5cf6','#4edea3','#ffb95f','#EC4899','#60a5fa','#fb923c','#a78bfa','#34d399'];
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function regMakeInitials(first, last) {
  return ((first[0] || '') + (last[0] || '')).toUpperCase();
}

// ── SHARED PASSWORD SHOW/HIDE TOGGLE (fix list item #10) ───────────────
// One helper, reused on every type="password" field in the app (login,
// register, confirm password, and the profile "change password" fields —
// see index.html). Toggles type="password" <-> type="text" on the sibling
// input and swaps the eye icon; keeps focus + cursor position on the field.
function regPasswordToggleBtn(inputId) {
  return `<button type="button" class="reg-pw-toggle-btn" tabindex="-1"
            aria-label="Show password" onclick="regTogglePasswordVisibility('${inputId}', this)">
            <span class="material-symbols-outlined" style="font-size:18px">visibility</span>
          </button>`;
}

window.regTogglePasswordVisibility = function (inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  const icon = btn.querySelector('.material-symbols-outlined');
  if (icon) icon.textContent = showing ? 'visibility' : 'visibility_off';
  btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  input.focus();
  const len = input.value.length;
  try { input.setSelectionRange(len, len); } catch (e) {}
};

// ── VALIDATION ─────────────────────────────────────────
// NOTE (Wave 2): the DB.registrations.find(...) checks below are
// best-effort UX only now — under the tightened RLS policy in
// wave2_registration_security_fixes.sql, an unauthenticated visitor's local
// DB.registrations cache only ever contains their OWN row (if any), not
// everyone else's pending requests (that used to be the actual security
// hole, fix list item #3). submit_registration() re-checks both of these
// server-side and is the authoritative source of truth — a collision that
// slips past these client checks still gets caught there, just one round
// trip later instead of live.
function regValidateUsername(val) {
  if (!val || val.length < 3) return { ok: false, msg: 'Username must be at least 3 characters.' };
  if (!/^[a-z0-9._]+$/.test(val)) return { ok: false, msg: 'Username: only lowercase letters, numbers, dots, underscores.' };
  if (DB.students.find(s => s.id === val)) return { ok: false, msg: 'Username already taken.' };
  if ((DB.registrations || []).find(r => r.username.toLowerCase() === val && r.status !== 'rejected'))
    return { ok: false, msg: 'Username already requested.' };
  return { ok: true };
}

function regValidateEmail(val) {
  if (!val || !val.includes('@')) return { ok: false, msg: 'Enter a valid email address.' };
  if (DB.students.find(s => s.email && s.email.toLowerCase() === val)) return { ok: false, msg: 'Email already in use.' };
  if ((DB.registrations || []).find(r => r.email.toLowerCase() === val && r.status !== 'rejected'))
    return { ok: false, msg: 'Email already requested.' };
  return { ok: true };
}

function regValidatePassword(pw) {
  if (!pw || pw.length < 8) return { ok: false, msg: 'Password must be at least 8 characters.' };
  const hasLetter = /[a-zA-Z]/.test(pw);
  const hasDigit  = /[0-9]/.test(pw);
  if (!hasLetter || !hasDigit) return { ok: false, msg: 'Password must include both letters and numbers.' };
  return { ok: true };
}

function regValidateName(val, label) {
  if (!val || val.trim().length < 2) return { ok: false, msg: label + ' must be at least 2 characters.' };
  if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'\- ]*$/.test(val.trim())) return { ok: false, msg: label + ' can only contain letters, spaces, hyphens, and apostrophes.' };
  return { ok: true };
}

// ── PUBLIC REGISTRATION FORM ───────────────────────────

window.showRegScreen = function () {
  // Inject the form fresh every time so validation state is always clean
  document.getElementById('reg-card-content').innerHTML = `
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-family:var(--fh);font-size:28px;font-weight:900">EDUQUEST</div>
      <div style="color:var(--text-muted);font-size:13px;margin-top:4px">⚔️ Create your student account</div>
    </div>
 
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">First Name</label>
        <input type="text" id="rf-first" placeholder="Juan" autocomplete="off"
               style="width:100%" oninput="regCheckValidation('first')">
        <div id="rf-first-msg" class="reg-validation-msg"></div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Last Name</label>
        <input type="text" id="rf-last" placeholder="dela Cruz" autocomplete="off"
               style="width:100%" oninput="regCheckValidation('last')">
        <div id="rf-last-msg" class="reg-validation-msg"></div>
      </div>
    </div>
 
    <div class="form-group" style="margin-top:12px">
      <label class="form-label">
        Username
        <span id="rf-username-icon" style="float:right;font-weight:900"></span>
      </label>
      <input type="text" id="rf-username" placeholder="e.g. juandelacruz" autocomplete="off"
             style="width:100%;text-transform:lowercase"
             oninput="this.value=this.value.toLowerCase();regCheckField('username')">
      <div id="rf-username-msg" class="reg-validation-msg"></div>
    </div>
 
    <div class="form-group">
      <label class="form-label">
        Email Address
        <span id="rf-email-icon" style="float:right;font-weight:900"></span>
      </label>
      <input type="email" id="rf-email" placeholder="juan@example.com" autocomplete="off"
             style="width:100%" oninput="regCheckField('email')">
      <div id="rf-email-msg" class="reg-validation-msg"></div>
    </div>
 
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Student ID</label>
        <input type="text" id="rf-sid" placeholder="2024-00001" autocomplete="off"
               style="width:100%" oninput="regCheckValidation('sid')">
        <div id="rf-sid-msg" class="reg-validation-msg"></div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Grade Level</label>
        <select id="rf-grade" style="width:100%" onchange="regOnGradeChange()">
          <option value="">— Select —</option>
          <option value="7">Grade 7</option>
          <option value="8">Grade 8</option>
          <option value="9">Grade 9</option>
          <option value="10">Grade 10</option>
          <option value="11">Grade 11</option>
          <option value="12">Grade 12</option>
        </select>
        <div id="rf-grade-msg" class="reg-validation-msg"></div>
      </div>
    </div>
 
    <div class="form-group" style="margin-top:12px">
      <label class="form-label">Section</label>
      <select id="rf-section" style="width:100%" onchange="regCheckValidation('section')">
        <option value="">— Select a grade first —</option>
      </select>
      <div id="rf-section-msg" class="reg-validation-msg"></div>
    </div>
 
    <div class="form-group">
      <label class="form-label">
        Password <span style="color:var(--text-muted);font-size:11px">(min 8 characters, letters + numbers)</span>
        <span id="rf-password-icon" style="float:right;font-weight:900"></span>
      </label>
      <div style="position:relative">
        <input type="password" id="rf-pass" placeholder="••••••••" style="width:100%;padding-right:40px"
               oninput="regCheckValidation('password');regCheckPasswordMatch()">
        ${regPasswordToggleBtn('rf-pass')}
      </div>
      <div id="rf-password-msg" class="reg-validation-msg"></div>
    </div>
 
    <div class="form-group">
      <label class="form-label">
        Confirm Password
        <span id="rf-pass2-icon" style="float:right;font-weight:900"></span>
      </label>
      <div style="position:relative">
        <input type="password" id="rf-pass2" placeholder="••••••••" style="width:100%;padding-right:40px"
               oninput="regCheckPasswordMatch()"
               onkeydown="if(event.key==='Enter')doRegister()">
        ${regPasswordToggleBtn('rf-pass2')}
      </div>
      <div id="rf-pass2-msg" class="reg-validation-msg"></div>
    </div>
 
    <div id="reg-submit-err"
         style="color:#ffb4ab;font-size:13px;margin-bottom:10px;display:none"></div>
 
    <button class="btn btn-primary btn-block" id="reg-submit-btn"
            style="padding:13px;font-size:15px;margin-top:4px"
            onclick="doRegister()">
      Submit Registration →
    </button>
 
    <div style="text-align:center;margin-top:16px;font-size:13px;color:var(--text-muted)">
      Already have an account?
      <a style="color:var(--primary);font-weight:700;cursor:pointer;text-decoration:none"
         onclick="hideRegScreen()">← Back to Login</a>
      <br>
      <a style="color:var(--primary);font-weight:700;cursor:pointer;text-decoration:none;display:inline-block;margin-top:6px"
         onclick="showRegStatusScreen()">Check my registration status →</a>
    </div>
  `;
 
  // Inline styles for validation messages (no separate CSS file needed)
  if (!document.getElementById('reg-validation-styles')) {
    const style = document.createElement('style');
    style.id = 'reg-validation-styles';
    style.textContent = `
      .reg-validation-msg { font-size: 11px; min-height: 16px; margin-top: 3px; }
      .reg-validation-msg.ok  { color: #4edea3; }
      .reg-validation-msg.err { color: #ffb4ab; }
      #reg-screen {
        display: none; position: fixed; inset: 0; z-index: 999;
        background: var(--surface, #1a1a2e);
        overflow-y: auto; padding: 24px 16px;
        justify-content: center; align-items: flex-start;
      }
      #reg-screen.open { display: flex; }
      .reg-card {
        background: var(--surface-2, rgba(255,255,255,.04));
        border: 1px solid var(--border, rgba(255,255,255,.1));
        border-radius: 20px; padding: 28px 24px;
        width: 100%; max-width: 480px; margin: auto;
      }
      .reg-success-card { text-align: center; padding: 12px 0; }
      .reg-success-icon { font-size: 48px; margin-bottom: 12px; }
      .reg-success-title { font-family: var(--fh); font-size: 22px; font-weight: 900; margin-bottom: 8px; }
      .reg-success-sub { color: var(--text-muted); font-size: 13px; margin-bottom: 20px; line-height: 1.5; }
      .reg-pending-badge {
        display: inline-flex; align-items: center; gap: 6px;
        background: rgba(255,185,95,.12); border: 1px solid rgba(255,185,95,.3);
        color: #ffb95f; border-radius: 20px; padding: 6px 16px;
        font-size: 13px; font-weight: 700; margin-bottom: 20px;
      }
    `;
    document.head.appendChild(style);
  }
 
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('reg-screen').classList.add('open');
 
  // Section Maker data may be stale (or not yet fetched) at this point since
  // this screen can be the very first thing a visitor sees, pre-login. Force
  // a fresh pull so the grade→section cascade isn't working off an empty list.
  if (typeof window.refreshSectionData === 'function') {
    window.refreshSectionData().catch(() => {});
  }

  // Focus first field after render
  setTimeout(() => document.getElementById('rf-first')?.focus(), 50);
};

window.hideRegScreen = function() {
  document.getElementById('reg-screen').classList.remove('open');
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('login-err').style.display = 'none';
  document.getElementById('login-pending-err').style.display = 'none';
};

window.regCheckField = function(field) {
  DB = loadDB();
  const val = (document.getElementById('rf-' + field)?.value || '').trim().toLowerCase();
  const icon = document.getElementById('rf-' + field + '-icon');
  const msg  = document.getElementById('rf-' + field + '-msg');
  let result = { ok: true };
  if (field === 'username') result = regValidateUsername(val);
  if (field === 'email')    result = regValidateEmail(val);
  if (icon) icon.textContent = result.ok ? '✓' : '✕';
  if (icon) icon.style.color = result.ok ? '#4edea3' : '#ffb4ab';
  if (msg) { msg.textContent = result.ok ? '' : result.msg; msg.className = 'reg-validation-msg ' + (result.ok ? 'ok' : 'err'); }
};

/**
 * regOnGradeChange() — cascading grade→section dropdown (Section Maker
 * integration, spec §4). Filters classSections to the selected grade and
 * repopulates #rf-section. Sections are the only source now — there is no
 * free-text fallback, since a mistyped section is exactly the problem
 * Section Maker exists to close (see spec §1).
 */
window.regOnGradeChange = function() {
  const grade = document.getElementById('rf-grade')?.value || '';
  const sectionEl = document.getElementById('rf-section');
  if (!sectionEl) return;

  if (!grade) {
    sectionEl.innerHTML = `<option value="">— Select a grade first —</option>`;
    return;
  }

  const sections = (typeof AppStore !== 'undefined'
    ? (AppStore.getSlice(s => s.classSections) || [])
    : []).filter(s => !s.archived && s.gradeLevel === grade);

  if (!sections.length) {
    sectionEl.innerHTML = `<option value="">— No sections for Grade ${_esc(grade)} yet, ask an admin to create one —</option>`;
    return;
  }

  sectionEl.innerHTML = sections
    .slice()
    .sort((a, b) => a.sectionName.localeCompare(b.sectionName))
    .map(s => `<option value="${_esc(s.sectionName)}">${_esc(s.sectionName)}</option>`)
    .join('');
};

window.regCheckPasswordMatch = function() {
  const pw  = document.getElementById('rf-pass')?.value  || '';
  const pw2 = document.getElementById('rf-pass2')?.value || '';
  const icon = document.getElementById('rf-pass2-icon');
  const msg  = document.getElementById('rf-pass2-msg');
  const match = pw.length > 0 && pw === pw2;
  if (icon) { icon.textContent = match ? '✓' : '✕'; icon.style.color = match ? '#4edea3' : '#ffb4ab'; }
  if (msg)  { msg.textContent = match ? '' : 'Passwords do not match.'; msg.className = 'reg-validation-msg ' + (match ? 'ok' : 'err'); }
};

window.regCheckValidation = function(field) {
  const inputId = (field === 'password') ? 'rf-pass' : ('rf-' + field);
  const val = (document.getElementById(inputId)?.value || '').trim();
  const icon = document.getElementById('rf-' + field + '-icon');
  const msg  = document.getElementById('rf-' + field + '-msg');
  let result = { ok: !!val };
  if (field === 'password')  result = regValidatePassword(val);
  if (field === 'first')     result = val ? regValidateName(val, 'First name') : { ok: false, msg: 'First name is required.' };
  if (field === 'last')      result = val ? regValidateName(val, 'Last name')  : { ok: false, msg: 'Last name is required.' };
  if (field === 'sid')       result = val ? { ok: true } : { ok: false, msg: 'Student ID is required.' };
  if (field === 'grade')     result = val ? { ok: true } : { ok: false, msg: 'Please select a grade level.' };
  if (field === 'section')   result = val ? { ok: true } : { ok: false, msg: 'Section is required.' };
  if (icon) { icon.textContent = result.ok ? '✓' : '✕'; icon.style.color = result.ok ? '#4edea3' : '#ffb4ab'; }
  // BUGFIX: this used to only ever write an error message and never clear it
  // once the field became valid again, so a field that was briefly invalid
  // stayed showing a stale ✕ error forever (fix list item #8).
  if (msg) {
    msg.textContent = result.ok ? '' : (result.msg || '');
    msg.className = 'reg-validation-msg ' + (result.ok ? 'ok' : 'err');
  }
  return result.ok;
};

window.doRegister = async function() {
  DB = loadDB();
  const first    = document.getElementById('rf-first')?.value.trim()    || '';
  const last     = document.getElementById('rf-last')?.value.trim()     || '';
  const username = (document.getElementById('rf-username')?.value.trim() || '').toLowerCase();
  const email    = (document.getElementById('rf-email')?.value.trim()    || '').toLowerCase();
  const sid      = document.getElementById('rf-sid')?.value.trim()      || '';
  const grade    = document.getElementById('rf-grade')?.value           || '';
  const section  = document.getElementById('rf-section')?.value.trim()  || '';
  const pass     = document.getElementById('rf-pass')?.value            || '';
  const pass2    = document.getElementById('rf-pass2')?.value           || '';
  const errEl    = document.getElementById('reg-submit-err');
  const btn      = document.getElementById('reg-submit-btn');

  // Collect every error at once instead of stopping at the first one
  // (fix list item #7).
  const errors = [];
  const firstCheck = regValidateName(first, 'First name'); if (!first) errors.push('First name is required.'); else if (!firstCheck.ok) errors.push(firstCheck.msg);
  const lastCheck  = regValidateName(last, 'Last name');   if (!last)  errors.push('Last name is required.');  else if (!lastCheck.ok)  errors.push(lastCheck.msg);
  const unCheck = regValidateUsername(username); if (!unCheck.ok) errors.push(unCheck.msg);
  const emCheck = regValidateEmail(email);       if (!emCheck.ok) errors.push(emCheck.msg);
  if (!sid)     errors.push('Student ID is required.');
  if (!grade)   errors.push('Please select a grade level.');
  if (!section) errors.push('Section is required.');
  const pwCheck = regValidatePassword(pass);     if (!pwCheck.ok) errors.push(pwCheck.msg);
  if (pass !== pass2) errors.push('Passwords do not match.');

  if (errors.length) {
    errEl.innerHTML = '❌ ' + errors.join('<br>❌ ');
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';

  // Disable + spinner for the whole round-trip so a fast double-click can't
  // fire two signUp()/submit_registration() calls (fix list item #6).
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;vertical-align:middle;animation:spin 1s linear infinite">progress_activity</span> Submitting…'; }

  const result = await RegistrationService.registerStudent({
    firstName: first, lastName: last, username, email,
    studentId: sid, gradeLevel: grade, section, password: pass,
  });

  if (!result.ok) {
    errEl.innerHTML = '❌ ' + _esc(result.error || 'Could not submit your registration. Please try again.');
    errEl.style.display = 'block';
    if (btn) { btn.disabled = false; btn.innerHTML = 'Submit Registration →'; }
    return;
  }

  document.getElementById('reg-card-content').innerHTML = `
  <div class="reg-success-card">
    <div class="reg-success-icon">⏳</div>
    <div class="reg-success-title">Registration Submitted!</div>
    <div class="reg-success-sub">Your account request has been sent to your teacher for review. You'll be able to log in once your account is approved.</div>
    <div class="reg-pending-badge">
      <span class="material-symbols-outlined" style="font-size:18px">pending</span>
      Awaiting teacher approval
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;max-width:260px;margin:0 auto">
      <div style="background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:12px;padding:12px 16px;text-align:left;font-size:12px">
        <div style="color:var(--text-muted);margin-bottom:3px">Registered as</div>
        <div style="font-weight:800;color:var(--on-surface)">${_esc(first + ' ' + last)}</div>
        <div style="color:var(--primary);font-weight:700;margin-top:2px">@${_esc(username)}</div>
      </div>
      <button class="btn btn-primary btn-block" style="padding:12px" onclick="hideRegScreen()">← Back to Login</button>
    </div>
  </div>`;
};

// ── CHECK MY REGISTRATION STATUS (fix list item #9) ────
// A pending student previously had no way to check where their request
// stood besides trying to log in and reading a generic error. This gives
// them a direct answer, keyed by email, without needing to sign in.
window.showRegStatusScreen = function() {
  showModal(`
  <div>
    <div class="modal-h2">📋 Check Registration Status</div>
    <div style="margin-bottom:16px;font-size:13px;color:var(--text-muted)">Enter the email you registered with.</div>
    <div class="form-group">
      <label class="form-label">Email Address</label>
      <input type="email" id="regstat-email" placeholder="juan@example.com" autocomplete="off"
             style="width:100%" onkeydown="if(event.key==='Enter')regCheckStatusSubmit()">
    </div>
    <div id="regstat-result" style="font-size:13px;margin:10px 0;display:none"></div>
    <div style="display:flex;gap:10px;margin-top:4px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Close</button>
      <button class="btn btn-primary" id="regstat-btn" style="flex:1" onclick="regCheckStatusSubmit()">Check Status</button>
    </div>
  </div>
  `, 'sm');
  setTimeout(() => document.getElementById('regstat-email')?.focus(), 50);
};

window.regCheckStatusSubmit = async function() {
  const email = (document.getElementById('regstat-email')?.value.trim() || '').toLowerCase();
  const resultEl = document.getElementById('regstat-result');
  const btn = document.getElementById('regstat-btn');
  if (!email || !email.includes('@')) {
    resultEl.style.display = 'block';
    resultEl.innerHTML = '❌ Enter a valid email address.';
    resultEl.style.color = '#ffb4ab';
    return;
  }
  if (btn) btn.disabled = true;
  const result = await RegistrationService.checkStatus(email);
  if (btn) btn.disabled = false;
  resultEl.style.display = 'block';

  if (!result.ok) {
    resultEl.innerHTML = '❌ ' + _esc(result.error || 'Could not check status right now.');
    resultEl.style.color = '#ffb4ab';
    return;
  }
  if (!result.found) {
    resultEl.innerHTML = 'No registration found for that email.';
    resultEl.style.color = 'var(--text-muted)';
    return;
  }
  if (result.status === 'pending') {
    resultEl.innerHTML = '⏳ Still awaiting teacher approval.';
    resultEl.style.color = '#ffb95f';
  } else if (result.status === 'approved') {
    resultEl.innerHTML = '✅ Approved! You can log in now.';
    resultEl.style.color = '#4edea3';
  } else if (result.status === 'rejected') {
    resultEl.innerHTML = '❌ Not approved.' + (result.rejectionReason ? ' Reason: ' + _esc(result.rejectionReason) : '');
    resultEl.style.color = '#ffb4ab';
  }
};

// ── ADMIN REGISTRATIONS MANAGEMENT ─────────────────────

let _regAdminFilter = 'pending';
let _regAdminSearch = '';

// ── ADMIN-ONLY: teacher/adviser lookup for the cross-teacher queue ────────
// (ISOLATION_ROLES_PLAN.md §11 "Cross-teacher registrations queue" — Chunk
// F.) A teacher's own Registrations screen never needed this — every row
// they see is already their own section. An admin's queue spans every
// section school-wide (§1), so each row's section is annotated with its
// adviser's name here, same TeacherDirectoryService lookup pattern
// audit-log.js already established for actor/target names. Lazily loaded
// once per admin session's visit to this screen, not on every render.
let _regTeacherMap = null;      // classSectionId -> adviser displayName, or null = "Unassigned"
let _regTeacherMapLoading = false;

async function _regEnsureTeacherMap() {
  if (currentRole !== 'admin' || _regTeacherMap !== null || _regTeacherMapLoading) return;
  _regTeacherMapLoading = true;
  const res = await TeacherDirectoryService.getDirectory();
  _regTeacherMapLoading = false;
  if (!res.ok) return;
  const map = {};
  (res.teachers || []).forEach(t => {
    (t.sections || []).forEach(s => { map[s.id] = t.displayName || t.email || t.id; });
  });
  _regTeacherMap = map;
  const list = document.getElementById('reg-admin-list');
  if (list) list.innerHTML = _regRenderListHTML();
}

function _regAdviserLabel(classId) {
  if (currentRole !== 'admin' || !_regTeacherMap) return '';
  const name = _regTeacherMap[classId];
  return name ? ` · Adviser: ${_esc(name)}` : (classId ? ' · Unassigned section' : '');
}

window.renderAdminRegistrations = function() {
  DB = loadDB();
  const regs    = DB.registrations || [];
  const pending  = regs.filter(r => r.status === 'pending').length;
  const approved = regs.filter(r => r.status === 'approved').length;
  const rejected = regs.filter(r => r.status === 'rejected').length;

  const bySec = {}; const byGrade = {};
  regs.forEach(r => {
    bySec[r.section] = (bySec[r.section] || 0) + 1;
    byGrade['Grade ' + (r.gradeLevel || '?')] = (byGrade['Grade ' + (r.gradeLevel || '?')] || 0) + 1;
  });

  if (currentRole === 'admin') _regEnsureTeacherMap();

  document.getElementById('a-registrations').innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
    <div>
      <div style="font-family:var(--fh);font-size:26px;font-weight:900">👤 Student Registrations</div>
      <div style="color:var(--text-muted);font-size:13px;margin-top:4px">
        ${currentRole === 'admin' ? 'Every section, school-wide · ' : ''}${regs.length} total · ${pending} pending review
      </div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:24px">
    <div class="glass-card" style="padding:14px;text-align:center;margin-bottom:0">
      <div style="font-family:var(--fh);font-size:26px;font-weight:900;color:var(--primary)">${regs.length}</div>
      <div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase">Total</div>
    </div>
    <div class="glass-card" style="padding:14px;text-align:center;margin-bottom:0">
      <div style="font-family:var(--fh);font-size:26px;font-weight:900;color:#ffb95f">${pending}</div>
      <div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase">Pending</div>
    </div>
    <div class="glass-card" style="padding:14px;text-align:center;margin-bottom:0">
      <div style="font-family:var(--fh);font-size:26px;font-weight:900;color:#4edea3">${approved}</div>
      <div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase">Approved</div>
    </div>
    <div class="glass-card" style="padding:14px;text-align:center;margin-bottom:0">
      <div style="font-family:var(--fh);font-size:26px;font-weight:900;color:#ffb4ab">${rejected}</div>
      <div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase">Rejected</div>
    </div>
    ${Object.entries(bySec).length ? `<div class="glass-card" style="padding:14px;text-align:center;margin-bottom:0">
      <div style="font-family:var(--fh);font-size:26px;font-weight:900;color:var(--secondary)">${Object.keys(bySec).length}</div>
      <div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase">Sections</div>
    </div>` : ''}
  </div>

  ${Object.keys(byGrade).length ? `
  <div class="glass-card" style="margin-bottom:20px">
    <h3 style="margin-bottom:12px">📊 By Grade Level</h3>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      ${Object.entries(byGrade).map(([g, c]) => `<span class="badge-pill bp-primary">${g}: ${c}</span>`).join('')}
    </div>
  </div>` : ''}

  <div class="reg-filter-bar">
    <button class="reg-filter-btn ${_regAdminFilter === 'all' ? 'active' : ''}" onclick="regSetFilter('all')">All (${regs.length})</button>
    <button class="reg-filter-btn ${_regAdminFilter === 'pending' ? 'active' : ''}" onclick="regSetFilter('pending')">⏳ Pending (${pending})</button>
    <button class="reg-filter-btn ${_regAdminFilter === 'approved' ? 'active' : ''}" onclick="regSetFilter('approved')">✓ Approved (${approved})</button>
    <button class="reg-filter-btn ${_regAdminFilter === 'rejected' ? 'active' : ''}" onclick="regSetFilter('rejected')">✕ Rejected (${rejected})</button>
    <input class="reg-search-input" type="text" placeholder="Search name, username, or student ID…" value="${_regAdminSearch}" oninput="_regAdminSearch=this.value;_regRenderList()">
  </div>

  <div id="reg-admin-list">${_regRenderListHTML()}</div>`;
};

window.regSetFilter = function(f) {
  _regAdminFilter = f;
  renderAdminRegistrations();
};

window._regRenderList = function() {
  const el = document.getElementById('reg-admin-list');
  if (el) el.innerHTML = _regRenderListHTML();
};

function _regRenderListHTML() {
  DB = loadDB();
  const regs = DB.registrations || [];
  let list = regs;
  if (_regAdminFilter !== 'all') list = list.filter(r => r.status === _regAdminFilter);
  const q = (_regAdminSearch || '').trim().toLowerCase();
  if (q) {
    list = list.filter(r =>
      (r.firstName + ' ' + r.lastName).toLowerCase().includes(q) ||
      r.username.toLowerCase().includes(q) ||
      (r.studentId || '').toLowerCase().includes(q) ||
      (r.section || '').toLowerCase().includes(q)
    );
  }
  if (!list.length) {
    return `<div style="text-align:center;padding:64px;background:rgba(35,31,56,.7);border:1px solid var(--border);border-radius:16px">
      <div style="font-size:48px;margin-bottom:12px">📋</div>
      <div style="font-family:var(--fh);font-size:17px;font-weight:800;margin-bottom:6px">No registrations found</div>
      <div style="color:var(--text-muted);font-size:13px">${_regAdminFilter === 'pending' ? 'No pending requests — all caught up!' : 'Try a different filter or search term.'}</div>
    </div>`;
  }
  return list.map(r => {
    const color = regPickColor(r.username);
    const initials = regMakeInitials(r.firstName, r.lastName);
    const statusPill = r.status === 'pending'
      ? '<span class="reg-status-pill reg-status-pending">⏳ Pending</span>'
      : r.status === 'approved'
        ? '<span class="reg-status-pill reg-status-approved">✓ Approved</span>'
        : '<span class="reg-status-pill reg-status-rejected">✕ Rejected</span>';
    const approvedSt = r.approvedStudentId ? (DB.students || []).find(s => s.id === r.approvedStudentId) : null;
    return `<div class="reg-request-card">
      <div class="reg-request-header">
        <div class="reg-request-avatar" style="background:${color}22;color:${color};border-color:${color}55">${initials}</div>
        <div class="reg-request-info">
          <div class="reg-request-name">${_esc(r.firstName + ' ' + r.lastName)}</div>
          <div class="reg-request-meta">
            <span>@${_esc(r.username)}</span>
            <span>ID: ${_esc(r.studentId || '—')}</span>
            <span>Grade ${_esc(r.gradeLevel || '?')} · ${_esc(r.section || '—')}</span>
            ${statusPill}
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
            Submitted: ${new Date(r.submittedAt).toLocaleDateString('en-PH', {year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}
            ${r.reviewedAt ? ` · Reviewed: ${new Date(r.reviewedAt).toLocaleDateString('en-PH', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}` : ''}
            ${r.status === 'rejected' && r.rejectionReason ? ` · Reason: ${_esc(r.rejectionReason)}` : ''}
            ${approvedSt ? ` · Linked to: <span style="color:#4edea3;font-weight:700">${_esc(approvedSt.name)}</span>` : ''}
            ${r.status === 'pending' ? _regAdviserLabel(r.classId) : ''}
          </div>
        </div>
        <div class="reg-request-actions">
          <button class="btn btn-ghost btn-xs" onclick="regAdminViewDetails('${r.id}')">👁 View</button>
          ${r.status === 'pending' ? `
            <button class="btn btn-success btn-xs" onclick="regAdminApprove('${r.id}')">✓ Approve</button>
            <button class="btn btn-danger btn-xs" onclick="regAdminRejectModal('${r.id}')">✕ Reject</button>
            ${currentRole === 'admin' ? `<button class="btn btn-ghost btn-xs" onclick="regAdminReassignModal('${r.id}')">🔀 Reassign</button>` : ''}
          ` : ''}
          ${r.status === 'rejected' ? `<button class="btn btn-ghost btn-xs" onclick="regAdminApprove('${r.id}')">↩ Re-approve</button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

window.regAdminViewDetails = function(regId) {
  DB = loadDB();
  const r = (DB.registrations || []).find(x => x.id === regId);
  if (!r) return;
  const color = regPickColor(r.username);
  const initials = regMakeInitials(r.firstName, r.lastName);
  const approvedSt = r.approvedStudentId ? (DB.students || []).find(s => s.id === r.approvedStudentId) : null;
  const statusLabel = r.status === 'pending' ? '⏳ Pending Review' : r.status === 'approved' ? '✓ Approved' : ('✕ Rejected' + (r.rejectionReason ? ' — ' + r.rejectionReason : ''));
  showModal(`
  <div style="text-align:center;margin-bottom:20px">
    <div style="width:64px;height:64px;border-radius:16px;background:${color}22;color:${color};border:2px solid ${color}55;display:flex;align-items:center;justify-content:center;font-family:var(--fh);font-weight:900;font-size:20px;margin:0 auto 10px">${initials}</div>
    <div style="font-family:var(--fh);font-size:20px;font-weight:900;color:var(--on-surface)">${_esc(r.firstName + ' ' + r.lastName)}</div>
    <div style="font-size:13px;color:var(--primary);font-weight:700;margin-top:2px">@${_esc(r.username)}</div>
    <div style="margin-top:8px;font-size:12px;color:${r.status === 'approved' ? '#4edea3' : r.status === 'rejected' ? '#ffb4ab' : '#ffb95f'};font-weight:700">${statusLabel}</div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;margin-bottom:16px">
    <div><span style="color:var(--text-muted)">Email:</span><br><strong>${_esc(r.email)}</strong></div>
    <div><span style="color:var(--text-muted)">Student ID:</span><br><strong>${_esc(r.studentId || '—')}</strong></div>
    <div><span style="color:var(--text-muted)">Grade Level:</span><br><strong>Grade ${_esc(r.gradeLevel || '?')}</strong></div>
    <div><span style="color:var(--text-muted)">Section:</span><br><strong>${_esc(r.section || '—')}</strong></div>
    <div><span style="color:var(--text-muted)">Submitted:</span><br><strong>${new Date(r.submittedAt).toLocaleDateString('en-PH', {year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</strong></div>
    ${r.reviewedAt ? `<div><span style="color:var(--text-muted)">Reviewed:</span><br><strong>${new Date(r.reviewedAt).toLocaleDateString('en-PH', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</strong></div>` : ''}
    ${approvedSt ? `<div style="grid-column:1/-1"><span style="color:var(--text-muted)">Approved Student Account:</span><br><strong style="color:#4edea3">${_esc(approvedSt.name)} (ID: ${approvedSt.id})</strong></div>` : ''}
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Close</button>
    ${r.status === 'pending' ? `
      <button class="btn btn-success" style="flex:1" onclick="closeModalForce();regAdminApprove('${r.id}')">✓ Approve</button>
      <button class="btn btn-danger" style="flex:1" onclick="closeModalForce();regAdminRejectModal('${r.id}')">✕ Reject</button>
      ${currentRole === 'admin' ? `<button class="btn btn-ghost" style="flex:1" onclick="closeModalForce();regAdminReassignModal('${r.id}')">🔀 Reassign</button>` : ''}
    ` : ''}
    ${r.status === 'rejected' ? `<button class="btn btn-ghost" style="flex:1" onclick="closeModalForce();regAdminApprove('${r.id}')">↩ Re-approve</button>` : ''}
  </div>
  `, 'md');
};

window.regAdminApprove = async function(regId) {
  DB = loadDB();
  const r = (DB.registrations || []).find(x => x.id === regId);
  if (!r) { toast('❌ Registration not found.', '#ffb4ab'); return; }
  if (r.status === 'approved' && r.approvedStudentId) { toast('ℹ️ Already approved.', '#ffb95f'); return; }

  // Account creation + the profiles row now both happen server-side (Critical
  // Fix #1/#2 — see approve_registration() in
  // supabase/wave2_registration_security_fixes.sql). The Auth account was
  // already created at registration time (doRegister() → signUp()), so
  // approval only ever needs to add the profiles row for that same UUID —
  // r.id IS that UUID, never a locally-fabricated username-based id.
  // Cosmetic values only (color/initials) are computed client-side and
  // passed through, same as before.
  const color = regPickColor(r.username);
  const initials = regMakeInitials(r.firstName, r.lastName);

  const result = await RegistrationService.approve(regId, { color, init: initials });
  if (!result.ok) { toast('❌ ' + (result.error || 'Could not approve registration.'), '#ffb4ab'); return; }

  const p = result.profile;
  const now = new Date();
  const newStudent = {
    id: p.id, // real Supabase Auth UUID — matches profiles.id everywhere else in the app
    name: p.name, init: p.init, color: p.color,
    xp: p.xp, coins: p.coins, level: p.level, tier: p.tier,
    rank: DB.students.length + 1,
    attendance: p.attendance, quizAvg: p.quizAvg,
    completedQuizzes: [],
    firstName: p.firstName, lastName: p.lastName, displayName: p.displayName,
    // NOTE: email/studentId/section are not columns on `profiles` (same gap
    // that existed before this fix — see file header of
    // wave2_registration_security_fixes.sql) so these stay display-only,
    // sourced from the registration record, exactly as before.
    email: r.email, studentId: r.studentId, gradeLevel: r.gradeLevel, section: r.section,
    classId: p.classId,
    joinDate: p.joinDate,
    profilePic: '',
    addedAt: now.toISOString(),
  };

  DB.students.push(newStudent);

  if (!DB.inventory) DB.inventory = {};
  DB.inventory[newStudent.id] = [];

  if (!DB.achievementUnlocks) DB.achievementUnlocks = {};
  DB.achievementUnlocks[newStudent.id] = [];

  if (!DB.stageProgress) DB.stageProgress = {};
  DB.stageProgress[newStudent.id] = {};

  const idx = DB.registrations.findIndex(x => x.id === regId);
  if (idx >= 0) {
    DB.registrations[idx].status = 'approved';
    DB.registrations[idx].reviewedAt = now.toISOString();
    DB.registrations[idx].reviewedBy = currentUser?.name || 'Admin';
    DB.registrations[idx].approvedStudentId = newStudent.id;
    DB.registrations[idx].rejectionReason = null;
  }

  // Persists DB.inventory/achievementUnlocks/stageProgress (local-only
  // slices — see file header) and lets the existing isStaffSession-gated
  // profiles bulk-upsert in db-service.js redundantly confirm the same
  // profile row the RPC above already wrote. registrations itself is no
  // longer part of that bulk push (see db-service.js diff) so this can't
  // re-trigger the old plaintext-password upload.
  saveDB();

  toast(`✅ ${_esc(newStudent.name)} approved & account created!`);
  renderAdminRegistrations();
};

window.regAdminRejectModal = function(regId) {
  DB = loadDB();
  const r = (DB.registrations || []).find(x => x.id === regId);
  if (!r) return;
  showModal(`
  <div>
    <div class="modal-h2">✕ Reject Registration</div>
    <div style="margin-bottom:16px;font-size:14px;color:var(--text-muted)">Rejecting: <strong style="color:var(--on-surface)">${_esc(r.firstName + ' ' + r.lastName)}</strong> (@${_esc(r.username)})</div>
    <div class="form-group">
      <label class="form-label">Rejection Reason (optional — shown to student at login)</label>
      <textarea id="reg-reject-reason" placeholder="e.g. Duplicate registration, incomplete information…" rows="3" style="width:100%;resize:vertical"></textarea>
    </div>
    <div style="display:flex;gap:10px;margin-top:4px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-danger" style="flex:1" onclick="regAdminConfirmReject('${regId}')">✕ Confirm Rejection</button>
    </div>
  </div>
  `, 'sm');
};

window.regAdminConfirmReject = async function(regId) {
  DB = loadDB();
  const idx = (DB.registrations || []).findIndex(x => x.id === regId);
  if (idx < 0) { toast('❌ Not found.', '#ffb4ab'); return; }
  const reason = (document.getElementById('reg-reject-reason')?.value || '').trim();

  const result = await RegistrationService.reject(regId, reason);
  if (!result.ok) { toast('❌ ' + (result.error || 'Could not reject registration.'), '#ffb4ab'); return; }

  const now = new Date();
  DB.registrations[idx].status = 'rejected';
  DB.registrations[idx].reviewedAt = now.toISOString();
  DB.registrations[idx].reviewedBy = currentUser?.name || 'Admin';
  DB.registrations[idx].rejectionReason = reason || null;
  saveDB();
  closeModalForce();
  toast('Registration rejected.', '#ffb4ab');
  renderAdminRegistrations();
};

// ── ADMIN: REASSIGN A PENDING REGISTRATION TO ANOTHER SECTION ─────────────
// (ISOLATION_ROLES_PLAN.md §11 "Cross-teacher registrations queue" — Chunk
// F.) Admin-only (reassign_registration() is is_admin()-gated server-side,
// same defense-in-depth posture as every other admin-only action in this
// app — the button itself is also only ever rendered for currentRole ===
// 'admin', see _regRenderListHTML() above). Only ever offered on PENDING
// rows — an already-approved/rejected registration has nothing left to
// reassign.
window.regAdminReassignModal = function(regId) {
  DB = loadDB();
  const r = (DB.registrations || []).find(x => x.id === regId);
  if (!r) return;
  if (currentRole !== 'admin') return; // defense in depth, mirrors every other admin-only screen's guard

  const sections = (typeof AppStore !== 'undefined' ? (AppStore.getSlice(s => s.classSections) || []) : [])
    .filter(s => !s.archived)
    .slice()
    .sort((a, b) => String(a.gradeLevel).localeCompare(String(b.gradeLevel), undefined, { numeric: true })
      || String(a.sectionName).localeCompare(String(b.sectionName)));

  showModal(`
  <div>
    <div class="modal-h2">🔀 Reassign Registration</div>
    <div style="margin-bottom:16px;font-size:14px;color:var(--text-muted)">
      Moving <strong style="color:var(--on-surface)">${_esc(r.firstName + ' ' + r.lastName)}</strong> (@${_esc(r.username)}) —
      currently Grade ${_esc(r.gradeLevel || '?')} · ${_esc(r.section || '—')}${_regAdviserLabel(r.classId)}
    </div>
    <div class="form-group">
      <label class="form-label">New Section</label>
      <select id="reg-reassign-section" style="width:100%">
        ${sections.length ? sections.map(s => `<option value="${_esc(s.id)}" ${s.id === r.classId ? 'selected' : ''}>
            Grade ${_esc(s.gradeLevel)} – ${_esc(s.sectionName)}${_regTeacherMap && _regTeacherMap[s.id] ? ' (' + _esc(_regTeacherMap[s.id]) + ')' : ' (Unassigned)'}
          </option>`).join('') : `<option value="">— No sections available —</option>`}
      </select>
      <div style="font-size:11px;color:var(--text-muted);margin-top:6px">This only changes which section/teacher the request goes to — it does not approve it.</div>
    </div>
    <div style="display:flex;gap:10px;margin-top:4px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" style="flex:1" ${sections.length ? '' : 'disabled'} onclick="regAdminConfirmReassign('${regId}')">🔀 Reassign</button>
    </div>
  </div>
  `, 'sm');
};

window.regAdminConfirmReassign = async function(regId) {
  const sel = document.getElementById('reg-reassign-section');
  const newClassId = sel?.value;
  if (!newClassId) { toast('❌ Choose a section.', '#ffb4ab'); return; }

  const result = await RegistrationService.reassign(regId, newClassId);
  if (!result.ok) { toast('❌ ' + (result.error || 'Could not reassign this registration.'), '#ffb4ab'); return; }

  DB = loadDB();
  const idx = (DB.registrations || []).findIndex(x => x.id === regId);
  if (idx >= 0) {
    DB.registrations[idx].gradeLevel = result.registration.gradeLevel;
    DB.registrations[idx].section = result.registration.section;
    DB.registrations[idx].classId = result.registration.classId;
  }
  saveDB();
  closeModalForce();
  toast('✅ Registration reassigned.');
  renderAdminRegistrations();
};

// ── EXTEND ANALYTICS WITH REGISTRATION STATS ──────────
// NOTE: This patch extends the base renderAnalytics defined in analytics.js.
// In Phase 5 this becomes an explicit call in analytics.js directly.
;(function() {
  const _origAnal2 = renderAnalytics;
  renderAnalytics = function() {
    _origAnal2();
    DB = loadDB();
    const regs     = DB.registrations || [];
    const pending  = regs.filter(r => r.status === 'pending').length;
    const approved = regs.filter(r => r.status === 'approved').length;
    const rejected = regs.filter(r => r.status === 'rejected').length;
    const sect = document.getElementById('a-analytics');
    if (!sect) return;
    const regBlock = `
    <div style="background:rgba(26,20,56,.8);border:1px solid rgba(78,222,163,.2);border-radius:16px;padding:20px;margin-bottom:24px">
      <div style="font-family:var(--fm);font-size:9px;color:var(--secondary);letter-spacing:.16em;margin-bottom:14px;text-transform:uppercase">👤 Student Registrations</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px">
        <div class="pos-stat-card"><div class="pos-stat-val" style="color:var(--primary)">${regs.length}</div><div class="pos-stat-lbl">Total Registrations</div></div>
        <div class="pos-stat-card"><div class="pos-stat-val" style="color:#ffb95f">${pending}</div><div class="pos-stat-lbl">Pending</div></div>
        <div class="pos-stat-card"><div class="pos-stat-val" style="color:#4edea3">${approved}</div><div class="pos-stat-lbl">Approved</div></div>
        <div class="pos-stat-card"><div class="pos-stat-val" style="color:#ffb4ab">${rejected}</div><div class="pos-stat-lbl">Rejected</div></div>
      </div>
      <div style="margin-top:14px"><button class="btn btn-ghost btn-sm" onclick="navTo('a-registrations')"><span class="material-symbols-outlined" style="font-size:14px">person_add</span> Manage Registrations</button></div>
    </div>`;
    sect.innerHTML = regBlock + (sect.innerHTML || '');
  };
})();

console.log('[EduQuest] Admin Registrations loaded.');
