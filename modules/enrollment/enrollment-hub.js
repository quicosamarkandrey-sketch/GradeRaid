// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/enrollment/enrollment-hub.js
//  Owns renderEnrollmentHub() / unmountEnrollmentHub() — the Phase 4 Smart
//  Card Enrollment Hub.
//
//  NOTE ON FILE TYPE — this project is vanilla JS (IIFE modules + template
//  strings + AppStore), not React. This file follows the exact page-module
//  shape att_scanner_rfid.js and modules/admin/sections.js already use, so
//  it drops into nav.js the same way every other admin page does.
//
//  INTEGRATION (the only edits needed outside this file):
//    nav.js, NAV_ITEMS array — add a link wherever you want it to show up:
//      {id:'a-enrollment',label:'Card Enrollment',icon:'badge'},
//    nav.js, navTo():
//      else if(id==='a-enrollment')renderEnrollmentHub();
//      (and, next to the other unmount lines near the top of navTo():)
//      if(id!=='a-enrollment'&&typeof unmountEnrollmentHub==='function'){ unmountEnrollmentHub(); }
//    index.html: add
//      <link rel="stylesheet" href="styles/modules/enrollment.css">
//      <script src="modules/enrollment/enrollment-service.js"></script>
//      <script src="modules/enrollment/enrollment-hub.js"></script>
//    — loaded AFTER state-manager.js, db-service.js, and sections-service.js
//    (needs draft.classSections and draft.rfidCards already hydrated), same
//    position att_scanner_rfid.js occupies today.
//
//  HARDWARE MODEL — same as att_scanner_rfid.js: the RFID/NFC reader is a
//  USB-HID keyboard emulator. A single visually-hidden, continuously
//  refocused <input> captures the scan; we never attach a document-wide
//  keydown listener, so the search bar and section dropdown on this same
//  screen keep working normally while a scan is "armed".
//
//  REPOSITORY PATTERN — this file never calls Supabase or AppStore.updateState
//  directly for card writes. All writes go through EnrollmentService.
// ═══════════════════════════════════════════════════════════════════════════════

let _enrollHubMounted = false;
let _enrollMode = 'teacher';          // 'teacher' | 'kiosk'
let _enrollSearchQuery = '';
let _enrollSectionFilter = 'all';
let _enrollCardFilter = 'all';       // 'all' | 'unassigned' | 'assigned'
let _enrollActiveTarget = null;       // studentId currently "awaiting hardware input" (teacher mode)
let _enrollFocusInterval = null;
let _enrollInactivityTimer = null;

// Kiosk (Student Self-Service) mode state
let _kioskStep = 'search';            // 'search' | 'password' | 'tap' | 'success'
let _kioskQuery = '';
let _kioskSelectedStudent = null;
let _kioskIdleTimer = null;           // setInterval — 1s tick, drives the 30s countdown
let _kioskCountdown = 30;
let _kioskSuccessTimeout = null;

// Kiosk password-confirm step (Pending Fixes Report §4)
let _kioskPasswordError = null;
let _kioskPasswordAttempts = 0;
let _kioskPasswordBusy = false;

// Kiosk Lock Mode (Pending Fixes Report §4) — fullscreen + navigation-locked
// self-service, unlockable only with the admin/teacher's own password.
let _enrollKioskLocked = false;
let _enrollNavToPatched = false;
let _enrollOrigNavTo = null;

// SECURITY FIX: _enrollKioskLocked above only ever lived in memory, so a
// browser refresh (or crash/close) reset it to false on the very next
// page load — and since bootApp() always rendered the dashboard on boot
// (see nav.js/auth.js), reloading was a one-tap way out of Lock Mode and
// straight onto the full admin/teacher shell. This localStorage flag is
// the persisted twin of _enrollKioskLocked: set the instant the lock
// engages, cleared only by a verified admin-password unlock, and checked
// by bootApp() BEFORE it ever renders the dashboard — see
// _enrollHasPersistedLock() / _enrollRestoreLockedKioskOnBoot() below.
const ENROLL_KIOSK_LOCK_KEY = 'eq_kiosk_locked';
function _enrollPersistLock(locked) {
  try {
    if (locked) localStorage.setItem(ENROLL_KIOSK_LOCK_KEY, '1');
    else localStorage.removeItem(ENROLL_KIOSK_LOCK_KEY);
  } catch (e) { /* storage unavailable — lock still works this tab-session, just won't survive a reload */ }
}

/**
 * renderEnrollmentHub() → void  [window.renderEnrollmentHub]
 * Mounts the Hub into #a-enrollment.
 */
window.renderEnrollmentHub = function () {
  _enrollHubMounted = true;
  _enrollActiveTarget = null;
  _kioskStep = 'search';
  _kioskQuery = '';
  _kioskSelectedStudent = null;

  const host = document.getElementById('a-enrollment');
  if (!host) {
    console.error('[EnrollmentHub] #a-enrollment container not found — check index.html.');
    return;
  }

  host.innerHTML = `
    <div class="page-hero">
      <h6>Phase 4 · Hardware</h6>
      <h2>Smart Card Enrollment Hub</h2>
      <p>Bind physical RFID/NFC cards to student profiles — teacher-guided, or hands-off self-service at a kiosk.</p>
    </div>
    <input id="enroll-capture-input" autocomplete="off" inputmode="none"
           style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px" />
    <div id="enroll-hub-body"></div>`;

  _enrollStartCapture();
  _enrollRenderAll();

  AppStore.subscribe('enrollment-hub', function (state, event) {
    if (!_enrollHubMounted) return;
    // Cheap targeted re-render — card-assignment events and generic state
    // updates are the only things that change what's on screen here.
    if (!event || event.type === 'state:updated' || event.type.indexOf('enrollment:') === 0 ||
        event.type.indexOf('attendance:card') === 0 || event.type === 'state:remote-sync') {
      _enrollRenderAll();
    }
  });
};

/**
 * unmountEnrollmentHub() → void  [window.unmountEnrollmentHub]
 */
window.unmountEnrollmentHub = function () {
  _enrollHubMounted = false;
  if (_enrollFocusInterval) { clearInterval(_enrollFocusInterval); _enrollFocusInterval = null; }
  if (_enrollInactivityTimer) { clearTimeout(_enrollInactivityTimer); _enrollInactivityTimer = null; }
  _kioskClearIdleTimer();
  if (_kioskSuccessTimeout) { clearTimeout(_kioskSuccessTimeout); _kioskSuccessTimeout = null; }
  // Safety net: this only runs when navTo() actually reaches its teardown
  // lines, which the Lock Mode nav guard prevents for any id other than
  // 'a-enrollment' while locked (see _enrollPatchNavGuard()) — so in the
  // normal case this never fires while still locked. It's a second line of
  // defense for anything that can bypass navTo entirely, so the app shell
  // never gets left hidden for whatever loads next. Same posture as
  // live_monitor.js's unmountClassroomMonitor().
  //
  // Deliberately does NOT clear the PERSISTED lock (_enrollPersistLock) —
  // a browser refresh is no longer one of the things this guards against
  // (bootApp() checks _enrollHasPersistedLock() before this file's normal
  // mount/unmount cycle ever runs — see auth.js), and if this in-memory-only
  // reset ever does fire some other way, the safest behavior is for the
  // NEXT reload to still come back locked, not to quietly stay unlocked.
  // Only a verified admin password (_enrollUnlockKiosk()) clears the
  // persisted flag.
  if (_enrollKioskLocked) {
    _enrollKioskLocked = false;
    document.body.classList.remove('enroll-kiosk-lock-mode');
    window.onbeforeunload = null;
  }
  AppStore.unsubscribe('enrollment-hub');
};

// ── Capture plumbing (mirrors att_scanner_rfid.js's _rfidStartCapture) ──────

function _enrollStartCapture() {
  const input = document.getElementById('enroll-capture-input');
  if (!input) return;

  input.value = '';
  input.focus({ preventScroll: true });

  if (_enrollFocusInterval) clearInterval(_enrollFocusInterval);
  _enrollFocusInterval = setInterval(function () {
    if (!_enrollHubMounted) return;
    const active = document.activeElement;
    const isRealInput = active && active !== input &&
      (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA');
    if (!isRealInput && document.getElementById('enroll-capture-input')) {
      // BUGFIX (scroll-jump report): this hidden input is position:absolute
      // near the top of the page's normal flow, so a plain .focus() call
      // makes the browser scroll it into view — every 600ms, forever,
      // yanking a teacher back to the top mid-scroll while assigning cards
      // to students further down the roster. preventScroll keeps the focus
      // (still needed to capture the next scan) without moving the viewport.
      document.getElementById('enroll-capture-input').focus({ preventScroll: true });
    }
  }, 600);

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      _enrollFinalizeScan(input.value);
      return;
    }
    if (_enrollInactivityTimer) clearTimeout(_enrollInactivityTimer);
    _enrollInactivityTimer = setTimeout(function () {
      if (input.value) _enrollFinalizeScan(input.value);
    }, 120);
  });
}

function _enrollFinalizeScan(rawValue) {
  const input = document.getElementById('enroll-capture-input');
  const tagId = String(rawValue || '').trim();
  if (input) input.value = '';
  if (_enrollInactivityTimer) { clearTimeout(_enrollInactivityTimer); _enrollInactivityTimer = null; }
  if (!tagId) return;

  if (_enrollMode === 'teacher' && _enrollActiveTarget) {
    _enrollAssign(_enrollActiveTarget, tagId, { onDone: function () { _enrollActiveTarget = null; _enrollRenderAll(); } });
  } else if (_enrollMode === 'kiosk' && _kioskStep === 'tap' && _kioskSelectedStudent) {
    _enrollAssign(_kioskSelectedStudent.id, tagId, { onDone: _kioskShowSuccess, kiosk: true });
  }
  // No armed target — a stray scan with nothing selected is a no-op, same
  // as the kiosk's own idle state when in 'attendance' mode.
}

/**
 * _enrollAssign() — the single place both modes call to write a card.
 * Shows a confirm dialog on conflict; retries with force:true only after
 * the operator explicitly agrees.
 */
async function _enrollAssign(studentId, tagId, opts) {
  opts = opts || {};
  const result = await EnrollmentService.assignCardToStudent(studentId, tagId);

  if (result.ok) {
    toast(`🪪 Card linked${opts.kiosk ? '' : ' — ' + (AppStore.getStudent(studentId) || {}).name}.`, '#4edea3');
    if (opts.onDone) opts.onDone();
    return;
  }

  if (result.conflict) {
    const studentName = (AppStore.getStudent(studentId) || {}).name || 'this student';
    showModal(`
      <h3 style="margin-bottom:10px">Card already linked</h3>
      <p style="color:var(--text-muted);font-size:13px;line-height:1.6;margin-bottom:18px">
        This card is currently linked to <strong>${_esc(result.conflictName)}</strong>.
        Reassigning it to <strong>${_esc(studentName)}</strong> will unlink it from them.
      </p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn" onclick="closeModalForce()">Cancel</button>
        <button class="btn btn-primary" onclick="_enrollConfirmForce('${studentId}','${_esc(tagId)}', ${!!opts.kiosk})">Reassign anyway</button>
      </div>`, 'sm');
    return;
  }

  toast(`❌ ${result.error || 'Could not link this card.'}`, '#ffb4ab');
  if (opts.onDone) opts.onDone();
}

/** Called from the conflict modal's "Reassign anyway" button. */
window._enrollConfirmForce = async function (studentId, tagId, isKiosk) {
  closeModalForce();
  const result = await EnrollmentService.assignCardToStudent(studentId, tagId, { force: true });
  if (result.ok) {
    toast('🪪 Card reassigned.', '#4edea3');
    if (isKiosk) { _kioskShowSuccess(); } else { _enrollActiveTarget = null; _enrollRenderAll(); }
  } else {
    toast(`❌ ${result.error || 'Could not reassign this card.'}`, '#ffb4ab');
    if (!isKiosk) { _enrollActiveTarget = null; _enrollRenderAll(); }
  }
};

// ── Master render ───────────────────────────────────────────────────────────

function _enrollRenderAll() {
  const body = document.getElementById('enroll-hub-body');
  if (!body) return;
  const state = AppStore.getState();

  // BUGFIX: every text input on this page (kiosk search, kiosk password,
  // teacher-mode roster search) calls _enrollRenderAll() on its own
  // `oninput` — i.e. on every keystroke. The rebuild below always creates
  // a brand-new <input> node (innerHTML replace), so simply calling
  // .focus() on the new node (as this used to do for the kiosk fields)
  // puts the caret back at position 0, not at the end of what's already
  // typed. The NEXT keystroke then inserts BEFORE the existing text
  // instead of after it — typing "maria" one letter at a time renders as
  // "airam". Capturing which field had focus (by id) and exactly where
  // its caret was *before* the rebuild, then restoring both afterward,
  // fixes this for every input here, not just one field.
  const active = document.activeElement;
  const focusedId = (active && body.contains(active) && active.id) ? active.id : null;
  const caretPos = (focusedId && typeof active.selectionStart === 'number') ? active.selectionStart : null;

  body.innerHTML = `
    ${_enrollKioskLocked ? _enrollRenderLockedBanner() : _enrollRenderToolbar(state)}
    ${_enrollMode === 'teacher' ? _enrollRenderTeacherGrid(state) : _enrollRenderKiosk(state)}
    ${_enrollKioskLocked ? _enrollRenderUnlockFab() : ''}
  `;

  if (focusedId) {
    // Something on this page was mid-edit — put it back exactly as it was.
    const el = document.getElementById(focusedId);
    if (el) {
      el.focus();
      if (caretPos !== null && typeof el.setSelectionRange === 'function') {
        const pos = Math.min(caretPos, el.value.length);
        try { el.setSelectionRange(pos, pos); } catch (e) {}
      }
    }
  } else if (_enrollMode === 'kiosk' && _kioskStep === 'search') {
    // Nothing was focused (e.g. just switched into kiosk mode) — same
    // "focus the search box automatically" behavior as before.
    const el = document.getElementById('enroll-kiosk-search-input');
    if (el) el.focus();
  } else if (_enrollMode === 'kiosk' && _kioskStep === 'password') {
    const el = document.getElementById('enroll-kiosk-password-input');
    if (el) el.focus();
  }
}

/**
 * _enrollRenderLockedBanner() — replaces the normal toolbar (search bar,
 * section filter, and — importantly — the Teacher-Guided/Self-Service mode
 * switch) while Lock Mode is active, so there's no clickable path back to
 * admin screens on-page. The only way off this screen is the floating
 * unlock fab (_enrollRenderUnlockFab()), which demands the admin password.
 */
function _enrollRenderLockedBanner() {
  return `<div class="enroll-kiosk-locked-banner">🔒 Kiosk Locked — Student Self-Service Only</div>`;
}

/**
 * _enrollRenderUnlockFab() — small, deliberately understated floating
 * button (not a big "EXIT" button a student would be tempted to press) that
 * opens the admin-password prompt. Always present while locked, regardless
 * of which kiosk step (search/password/tap/success) is on screen.
 */
function _enrollRenderUnlockFab() {
  return `<button class="enroll-unlock-fab" title="Admin unlock" onclick="_enrollShowUnlockPrompt()">🔒</button>`;
}

function _enrollRenderToolbar(state) {
  const sections = Array.isArray(state.classSections) ? state.classSections.filter(function (s) { return !s.archived; }) : [];
  const kioskHidesSearch = _enrollMode === 'kiosk'; // Privacy Lock: no roster search/filter while kiosk mode is live
  return `
    <div class="enroll-hub-toolbar">
      ${kioskHidesSearch ? '' : `
        <input id="enroll-hub-search-input" class="enroll-hub-search" placeholder="Search students…" value="${_esc(_enrollSearchQuery)}"
               oninput="_enrollOnSearchInput(this.value)" />
        <select class="enroll-hub-section-select" onchange="_enrollOnSectionChange(this.value)">
          <option value="all" ${_enrollSectionFilter === 'all' ? 'selected' : ''}>All sections</option>
          ${sections.map(function (s) {
            return `<option value="${_esc(s.id)}" ${s.id === _enrollSectionFilter ? 'selected' : ''}>${_esc(s.gradeLevel)} - ${_esc(s.sectionName)}</option>`;
          }).join('')}
        </select>
        <select class="enroll-hub-section-select" onchange="_enrollOnCardFilterChange(this.value)">
          <option value="all" ${_enrollCardFilter === 'all' ? 'selected' : ''}>All cards</option>
          <option value="unassigned" ${_enrollCardFilter === 'unassigned' ? 'selected' : ''}>Unassigned</option>
          <option value="assigned" ${_enrollCardFilter === 'assigned' ? 'selected' : ''}>Assigned</option>
        </select>`}
      <div class="enroll-hub-mode-switch">
        <button class="enroll-hub-mode-btn ${_enrollMode === 'teacher' ? 'active' : ''}" onclick="_enrollSetMode('teacher')">👩‍🏫 Teacher-Guided</button>
        <button class="enroll-hub-mode-btn ${_enrollMode === 'kiosk' ? 'active' : ''}" onclick="_enrollSetMode('kiosk')">🖥️ Self-Service Kiosk</button>
      </div>
      ${_enrollMode === 'kiosk' ? `<button class="enroll-lock-btn" onclick="_enrollLockKiosk()">🔒 Lock for Self-Service</button>` : ''}
    </div>`;
}

window._enrollOnSearchInput = function (val) { _enrollSearchQuery = val; _enrollRenderAll(); };
window._enrollOnSectionChange = function (val) { _enrollSectionFilter = val; _enrollRenderAll(); };
window._enrollOnCardFilterChange = function (val) { _enrollCardFilter = val; _enrollRenderAll(); };

// ── Kiosk Lock Mode (Pending Fixes Report §4) ───────────────────────────────
//
// Card Enrollment Hub is an admin-only nav item, so the browser tab running
// the kiosk stays signed in as the teacher/admin throughout — a student at
// a shared classroom device never gets their own session. Lock Mode is the
// "hand the device to a student and walk away" step: it fullscreens the
// Self-Service Kiosk (hides #topbar/#sidebar, same shell-hiding mechanism
// att_scanner_rfid.js's body.rfid-kiosk-mode and live_monitor.js's
// body.lm-kiosk-mode already use — see styles/modules/enrollment.css) AND,
// unlike those two, additionally blocks in-app navigation away from
// #a-enrollment while active, so a curious student can't tap back to a
// sidebar link that isn't even visible but could still be reached some
// other way. Only the admin's own password (verified via
// _enrollVerifyAdminPassword(), NOT a new RPC — see that function) lifts it.

window._enrollLockKiosk = function () {
  if (_enrollMode !== 'kiosk' || _enrollKioskLocked) return;
  _enrollKioskLocked = true;
  _enrollPersistLock(true);
  document.body.classList.add('enroll-kiosk-lock-mode');
  _enrollPatchNavGuard();
  // Native "are you sure you want to leave" prompt on refresh/close/back —
  // can't be suppressed by the page (by design, browsers don't allow that),
  // but it's the closest a web app gets to blocking those too, alongside
  // the navTo() guard below which covers every in-app link.
  window.onbeforeunload = function (e) {
    e.preventDefault();
    e.returnValue = '';
    return '';
  };
  toast('🔒 Kiosk locked — student self-service only.', '#ff9f5f');
  _enrollRenderAll();
};

/**
 * _enrollPatchNavGuard() — wraps the global navTo() exactly once so that,
 * while _enrollKioskLocked is true, any navigation to a page other than
 * 'a-enrollment' is intercepted and redirected to the unlock prompt instead
 * of running. Patched (not replaced-and-forgotten) so the original navTo()
 * is always reachable again after unlock — same "monkey-patch and keep a
 * reference to the original" shape nav.js's own header comment already
 * documents other modules using (Leaderboard, Titles, Inventory, DSM).
 */
function _enrollPatchNavGuard() {
  if (_enrollNavToPatched || typeof window.navTo !== 'function') return;
  _enrollNavToPatched = true;
  _enrollOrigNavTo = window.navTo;
  window.navTo = function (id) {
    if (_enrollKioskLocked && id !== 'a-enrollment') {
      _enrollShowUnlockPrompt();
      return;
    }
    return _enrollOrigNavTo(id);
  };
}

window._enrollShowUnlockPrompt = function () {
  showModal(`
    <h3 style="margin-bottom:10px">🔒 Kiosk Locked</h3>
    <p style="color:var(--text-muted);font-size:13px;line-height:1.6;margin-bottom:14px">
      This device is in Student Self-Service mode. Enter the teacher/admin password to unlock it.
    </p>
    <input id="enroll-admin-unlock-input" type="password" class="enroll-kiosk-password-input"
           style="max-width:100%;margin-bottom:8px" placeholder="Admin password" autocomplete="off"
           onkeydown="if(event.key==='Enter'){event.preventDefault();_enrollSubmitUnlock();}" />
    <div id="enroll-unlock-error" style="color:#ffb4ab;font-size:12px;font-weight:700;min-height:16px;margin-bottom:10px"></div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" onclick="_enrollSubmitUnlock()">Unlock</button>
    </div>`, 'sm');
  setTimeout(function () {
    const el = document.getElementById('enroll-admin-unlock-input');
    if (el) el.focus();
  }, 50);
};

window._enrollSubmitUnlock = async function () {
  const input = document.getElementById('enroll-admin-unlock-input');
  const errEl = document.getElementById('enroll-unlock-error');
  const pwd = input ? input.value : '';
  if (!pwd) { if (errEl) errEl.textContent = 'Enter the admin password.'; return; }
  if (errEl) errEl.textContent = 'Checking…';

  const result = await _enrollVerifyAdminPassword(pwd);
  if (result.ok) {
    closeModalForce();
    _enrollUnlockKiosk();
    toast('🔓 Kiosk unlocked.', '#4edea3');
    return;
  }
  if (errEl) errEl.textContent = result.error || 'Incorrect password.';
  if (input) { input.value = ''; input.focus(); }
};

/**
 * _enrollVerifyAdminPassword(password) → Promise<{ok, error?}>
 * Re-authenticates the CURRENTLY signed-in admin account against its own
 * email — the standard Supabase "confirm your password" pattern (the same
 * call auth.js's doLogin() makes for the initial sign-in). Safe here in a
 * way it would NOT be for a student: because it's the same account that's
 * already signed in, a successful call just refreshes this tab's existing
 * session rather than swapping it out for a different one, so the kiosk
 * tab never stops being the admin's session. Verifying a STUDENT's
 * password (the identity-check step earlier in this file) can't use this
 * same approach for exactly that reason — see EnrollmentService's
 * verifyStudentPassword() and supabase/phase12_kiosk_identity_lock.sql for
 * why that one is a session-safe RPC instead.
 */
async function _enrollVerifyAdminPassword(password) {
  if (typeof currentUser === 'undefined' || !currentUser || !currentUser.email) {
    return { ok: false, error: 'No admin session found — reload and log in again.' };
  }
  if (typeof DBService === 'undefined' || typeof DBService.getAuthClient !== 'function') {
    return { ok: false, error: 'Still connecting, try again in a moment.' };
  }
  const client = DBService.getAuthClient();
  if (!client) return { ok: false, error: 'Still connecting, try again in a moment.' };

  const { error } = await client.auth.signInWithPassword({
    email: currentUser.email, password: password,
  });
  if (error) return { ok: false, error: 'Incorrect password.' };
  return { ok: true };
}

function _enrollUnlockKiosk() {
  _enrollKioskLocked = false;
  _enrollPersistLock(false);
  document.body.classList.remove('enroll-kiosk-lock-mode');
  window.onbeforeunload = null;
  _enrollRenderAll();
}

/**
 * _enrollHasPersistedLock() → boolean  [window._enrollHasPersistedLock]
 * Read-only check of the persisted flag — called from bootApp() (auth.js)
 * on every boot/refresh, before anything else renders.
 */
window._enrollHasPersistedLock = function () {
  try { return localStorage.getItem(ENROLL_KIOSK_LOCK_KEY) === '1'; } catch (e) { return false; }
};

/**
 * _enrollRestoreLockedKioskOnBoot() → void  [window._enrollRestoreLockedKioskOnBoot]
 * SECURITY FIX — called by bootApp() INSTEAD OF the normal dashboard render
 * when _enrollHasPersistedLock() is true. Re-enters #a-enrollment in kiosk
 * mode and re-applies every part of the lock (the fullscreen shell-hiding
 * body class, the navTo() guard, and the beforeunload prompt) before the
 * first frame ever paints — so a refresh while locked lands right back on
 * the same locked kiosk screen instead of the admin/teacher dashboard.
 * Mirrors _enrollLockKiosk() exactly, minus the toast (a silent restore,
 * not a new lock action) and minus re-persisting (it's already persisted —
 * that's how we got here).
 */
window._enrollRestoreLockedKioskOnBoot = function () {
  _enrollMode = 'kiosk';
  if (typeof navTo === 'function') navTo('a-enrollment');
  else if (typeof renderEnrollmentHub === 'function') renderEnrollmentHub();

  _enrollKioskLocked = true;
  document.body.classList.add('enroll-kiosk-lock-mode');
  _enrollPatchNavGuard();
  window.onbeforeunload = function (e) {
    e.preventDefault();
    e.returnValue = '';
    return '';
  };
  _enrollRenderAll();
};

window._enrollSetMode = function (mode) {
  if (mode === _enrollMode) return;
  if (_enrollKioskLocked) {
    // Defense-in-depth: the mode-switch buttons are already hidden from the
    // DOM while locked (see _enrollRenderLockedBanner()), so this can only
    // be reached by something calling the function directly rather than
    // through a click — refuse it too rather than trusting the UI alone.
    toast('🔒 Unlock the kiosk first.', '#ffb4ab');
    return;
  }
  _enrollMode = mode;
  _enrollActiveTarget = null;
  _kioskStep = 'search';
  _kioskQuery = '';
  _kioskSelectedStudent = null;
  _kioskPasswordError = null;
  _kioskPasswordAttempts = 0;
  _kioskPasswordBusy = false;
  _kioskClearIdleTimer();
  _enrollRenderAll();
};

// ── State 1: Teacher-Guided Directory ───────────────────────────────────────

function _enrollFilterStudents(state) {
  const q = _enrollSearchQuery.trim().toLowerCase();
  return (state.students || []).filter(function (s) {
    if (_enrollSectionFilter !== 'all' && s.classId !== _enrollSectionFilter) return false;
    if (q && (s.name || '').toLowerCase().indexOf(q) === -1) return false;
    if (_enrollCardFilter !== 'all') {
      const hasCard = !!EnrollmentService.getActiveCardForStudent(s.id, state);
      if (_enrollCardFilter === 'unassigned' && hasCard) return false;
      if (_enrollCardFilter === 'assigned' && !hasCard) return false;
    }
    return true;
  });
}

function _enrollAvatarHtml(student) {
  if (student.profilePic) {
    return `<div class="enroll-avatar" style="background-image:url('${_esc(student.profilePic)}')"></div>`;
  }
  const init = student.init || (student.name || '?').charAt(0).toUpperCase();
  return `<div class="enroll-avatar" style="background:${_esc(student.color || '#7fd8ff')}">${_esc(init)}</div>`;
}

function _enrollRenderTeacherGrid(state) {
  const students = _enrollFilterStudents(state);
  if (!students.length) {
    return `<div style="text-align:center;color:var(--text-muted);padding:40px 0">No students match this search / section.</div>`;
  }

  return `<div class="enroll-hub-grid">
    ${students.map(function (s) {
      const card = EnrollmentService.getActiveCardForStudent(s.id, state);
      const isTarget = _enrollActiveTarget === s.id;
      return `
        <div class="enroll-student-card ${isTarget ? 'awaiting' : ''}">
          ${_enrollAvatarHtml(s)}
          <div class="enroll-student-name">${_esc(s.name || s.displayName || s.id)}</div>
          ${card
            ? `<span class="enroll-badge bound">Bound: ${_esc(card.tagId)}</span>`
            : `<span class="enroll-badge unassigned">Unassigned</span>`}
          ${isTarget
            ? `<div class="enroll-awaiting-flash">Awaiting Hardware Input…</div>
               <button class="enroll-link-btn" onclick="_enrollCancelTarget()">Cancel</button>`
            : `<button class="enroll-link-btn" onclick="_enrollStartTarget('${s.id}')">${card ? 'Reissue Card' : 'Link New Card'}</button>`}
        </div>`;
    }).join('')}
  </div>`;
}

window._enrollStartTarget = function (studentId) {
  _enrollActiveTarget = studentId;
  _enrollRenderAll();
  const input = document.getElementById('enroll-capture-input');
  if (input) input.focus({ preventScroll: true });
};

window._enrollCancelTarget = function () {
  _enrollActiveTarget = null;
  _enrollRenderAll();
};

// ── State 2: Student Self-Service Kiosk Mode ────────────────────────────────

function _enrollRenderKiosk(state) {
  if (_kioskStep === 'password' && _kioskSelectedStudent) return _enrollRenderKioskPassword();
  if (_kioskStep === 'tap' && _kioskSelectedStudent) return _enrollRenderKioskTap();
  if (_kioskStep === 'success') return _enrollRenderKioskSuccess();
  return _enrollRenderKioskSearch(state);
}

function _enrollRenderKioskSearch(state) {
  const q = _kioskQuery.trim().toLowerCase();
  const matches = q
    ? (state.students || []).filter(function (s) { return (s.name || '').toLowerCase().indexOf(q) !== -1; }).slice(0, 5)
    : [];

  return `
    <div class="enroll-kiosk-wrap">
      <div style="font-size:18px;font-weight:700">Type your name to link your smart card</div>
      <input id="enroll-kiosk-search-input" class="enroll-kiosk-search" placeholder="Start typing your name…"
             value="${_esc(_kioskQuery)}" oninput="_kioskOnSearchInput(this.value)" />
      ${matches.length ? `
        <div class="enroll-kiosk-results">
          ${matches.map(function (s) {
            return `<div class="enroll-kiosk-result-row" onclick="_kioskSelectStudent('${s.id}')">
                      ${_enrollAvatarHtml(s)}
                      <span style="font-weight:600">${_esc(s.name || s.displayName)}</span>
                    </div>`;
          }).join('')}
        </div>` : (q ? `<div style="color:var(--text-muted);font-size:13px">No matches yet — keep typing.</div>` : '')}
    </div>`;
}

window._kioskOnSearchInput = function (val) {
  _kioskQuery = val;
  _enrollRenderAll();
};

window._kioskSelectStudent = function (studentId) {
  const student = AppStore.getStudent(studentId);
  if (!student) return;
  _kioskSelectedStudent = student;
  // Pending Fixes Report §4: identity check gate — a student must confirm
  // their own password before a card can be bound to their profile. Goes to
  // 'password', not straight to 'tap' the way this used to work.
  _kioskStep = 'password';
  _kioskPasswordError = null;
  _kioskPasswordAttempts = 0;
  _kioskPasswordBusy = false;
  _kioskStartIdleTimer();
  _enrollRenderAll();
};

/**
 * _enrollRenderKioskPassword() — Pending Fixes Report §4 identity check.
 * Sits between picking a name off the search screen and arming the tap
 * scanner: the student must type their own account password before a card
 * can be bound to them. Verified server-side via EnrollmentService.
 * verifyStudentPassword() (supabase/phase12_kiosk_identity_lock.sql) —
 * never a client-side sign-in, so the kiosk's admin session is untouched
 * whether the password is right or wrong.
 */
function _enrollRenderKioskPassword() {
  const s = _kioskSelectedStudent;
  return `
    <div class="enroll-kiosk-wrap">
      ${_enrollAvatarHtml(s).replace('enroll-avatar', 'enroll-avatar enroll-kiosk-tap-avatar')}
      <div class="enroll-kiosk-tap-name">${_esc(s.name || s.displayName)}</div>
      <div class="enroll-kiosk-tap-instruction">Confirm it's you — enter your password to continue.</div>
      <input id="enroll-kiosk-password-input" type="password" class="enroll-kiosk-password-input"
             placeholder="Your password" autocomplete="off"
             onkeydown="if(event.key==='Enter'){event.preventDefault();_kioskSubmitPassword();}" />
      ${_kioskPasswordError ? `<div class="enroll-kiosk-password-error">${_esc(_kioskPasswordError)}</div>` : ''}
      <div class="enroll-kiosk-password-actions">
        <button class="enroll-kiosk-confirm-btn" onclick="_kioskSubmitPassword()" ${_kioskPasswordBusy ? 'disabled' : ''}>${_kioskPasswordBusy ? 'Checking…' : 'Confirm'}</button>
        <button class="enroll-kiosk-cancel" onclick="_kioskResetToSearch()">Cancel</button>
      </div>
      <div class="enroll-kiosk-countdown">Returning to search in ${_kioskCountdown}s if not confirmed…</div>
    </div>`;
}

window._kioskSubmitPassword = async function () {
  const input = document.getElementById('enroll-kiosk-password-input');
  const pwd = input ? input.value : '';
  if (!pwd) {
    _kioskPasswordError = 'Please enter your password.';
    _enrollRenderAll();
    return;
  }
  if (!_kioskSelectedStudent) { _kioskResetToSearch(); return; }

  _kioskPasswordBusy = true;
  _kioskPasswordError = null;
  _enrollRenderAll();

  const result = await EnrollmentService.verifyStudentPassword(_kioskSelectedStudent.id, pwd);
  _kioskPasswordBusy = false;

  // Guard against the idle timer bouncing us back to search (or a Cancel
  // click) while the RPC round-trip was in flight.
  if (_kioskStep !== 'password' || !_kioskSelectedStudent) return;

  if (result.ok && result.verified) {
    _kioskStep = 'tap';
    _kioskStartIdleTimer();
    _enrollRenderAll();
    const capInput = document.getElementById('enroll-capture-input');
    if (capInput) capInput.focus({ preventScroll: true });
    return;
  }

  _kioskPasswordAttempts += 1;
  _kioskPasswordError = result.ok ? 'Incorrect password — try again.' : (result.error || 'Could not verify right now — try again.');

  if (_kioskPasswordAttempts >= 3) {
    toast('❌ Too many attempts — returning to search.', '#ffb4ab');
    _kioskResetToSearch();
    return;
  }
  _enrollRenderAll();
};

function _enrollRenderKioskTap() {
  const s = _kioskSelectedStudent;
  return `
    <div class="enroll-kiosk-wrap">
      ${_enrollAvatarHtml(s).replace('enroll-avatar', 'enroll-avatar enroll-kiosk-tap-avatar')}
      <div class="enroll-kiosk-tap-name">${_esc(s.name || s.displayName)}</div>
      <div class="enroll-kiosk-tap-instruction">Mabuhay! Please tap your new card on the scanner unit now.</div>
      <div class="enroll-kiosk-countdown">Returning to search in ${_kioskCountdown}s if no card is tapped…</div>
      <button class="enroll-kiosk-cancel" onclick="_kioskResetToSearch()">Cancel</button>
    </div>`;
}

function _enrollRenderKioskSuccess() {
  const s = _kioskSelectedStudent;
  return `
    <div class="enroll-kiosk-wrap">
      <div class="enroll-kiosk-success">
        <div class="enroll-kiosk-success-check">✅</div>
        <div class="enroll-kiosk-tap-name">Card linked, ${_esc(s ? (s.name || s.displayName) : '')}!</div>
        <div style="color:var(--text-muted);font-size:13px">Next student can start typing their name below.</div>
      </div>
    </div>`;
}

function _kioskShowSuccess() {
  _kioskClearIdleTimer();
  _kioskStep = 'success';
  _enrollRenderAll();
  if (_kioskSuccessTimeout) clearTimeout(_kioskSuccessTimeout);
  _kioskSuccessTimeout = setTimeout(_kioskResetToSearch, 2200);
}

/** Safety Idle Timeout — 30s countdown while in the Tap Phase. */
function _kioskStartIdleTimer() {
  _kioskClearIdleTimer();
  _kioskCountdown = 30;
  _kioskIdleTimer = setInterval(function () {
    _kioskCountdown -= 1;
    if (_kioskCountdown <= 0) {
      _kioskResetToSearch();
      return;
    }
    // Lightweight: only patch the countdown text, no full re-render, so an
    // in-progress tap isn't visually interrupted every second.
    const el = document.querySelector('.enroll-kiosk-countdown');
    if (el) el.textContent = `Returning to search in ${_kioskCountdown}s if no card is tapped…`;
  }, 1000);
}

function _kioskClearIdleTimer() {
  if (_kioskIdleTimer) { clearInterval(_kioskIdleTimer); _kioskIdleTimer = null; }
}

window._kioskResetToSearch = function () {
  _kioskClearIdleTimer();
  if (_kioskSuccessTimeout) { clearTimeout(_kioskSuccessTimeout); _kioskSuccessTimeout = null; }
  _kioskStep = 'search';
  _kioskQuery = '';
  _kioskSelectedStudent = null;
  _kioskPasswordError = null;
  _kioskPasswordAttempts = 0;
  _kioskPasswordBusy = false;
  _enrollRenderAll();
};

console.log('[EduQuest] enrollment/enrollment-hub.js loaded — renderEnrollmentHub registered.');
