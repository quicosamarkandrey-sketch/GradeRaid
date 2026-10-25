// Phase 7, Stream B — equivalence check for modules/admin/registrations.js.
// RegistrationService and TeacherDirectoryService are already
// independently equivalence-checked, so the ORIGINAL window evals both
// real, untouched service files first, driven by a shared fake
// DBService (rpc + getAuthClient) and fake AppStore. Covers the full
// student-facing registration form (validation, password toggle,
// grade→section cascade, submit success/error), the status-check modal,
// and the full admin management surface (stats, filter/search/pagination
// shell, view/approve/reject/reassign — incl. role-gating the reassign
// button to admin-only), plus the AppStore.subscribe
// registrations-analytics-block wiring.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const STARTER_HTML = `<!doctype html><html><body>
  <div id="reg-card-content"></div>
  <div id="reg-screen"></div>
  <div id="login-screen" style="display:flex"></div>
  <div id="login-user"></div>
  <div id="login-pass"></div>
  <div id="login-err" style="display:none"></div>
  <div id="login-pending-err" style="display:none"></div>
  <div id="a-registrations"></div>
  <div id="a-analytics"></div>
  <div id="modal-root"></div>
</body></html>`;

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.com/app/index.html' });
  const win = dom.window;
  const calls = [];
  win.__calls = calls;

  win.currentRole = 'admin';
  win.currentUser = { name: 'Admin One' };
  win._esc = s => String(s == null ? '' : s);
  win.toast = function (msg, color) { calls.push({ name: 'toast', msg, color }); };
  win.showModal = function (html, size) {
    calls.push({ name: 'showModal', size });
    win.document.getElementById('modal-root').innerHTML = html;
  };
  win.closeModalForce = function () { calls.push({ name: 'closeModalForce' }); win.document.getElementById('modal-root').innerHTML = ''; };
  win.HTMLElement.prototype.scrollIntoView = function () {};
  win.HTMLElement.prototype.focus = function () {}; // jsdom's real .focus() is fine, but keep deterministic/no-op for setTimeout-deferred focus calls

  const sections = [
    { id: 'sec-a', gradeLevel: '10', sectionName: 'Rizal', archived: false },
    { id: 'sec-b', gradeLevel: '10', sectionName: 'Aguinaldo', archived: false },
    { id: 'sec-c', gradeLevel: '9', sectionName: 'Bonifacio', archived: false },
    { id: 'sec-old', gradeLevel: '8', sectionName: 'Archived Section', archived: true },
  ];

  const regs = [];
  for (let i = 1; i <= 25; i++) {
    regs.push({
      id: 'reg' + i, firstName: 'First' + i, lastName: 'Last' + i, username: 'user' + i, email: 'user' + i + '@x.com',
      studentId: 'SID' + i, gradeLevel: '10', section: 'Rizal', classId: 'sec-a',
      status: i <= 15 ? 'pending' : (i <= 20 ? 'approved' : 'rejected'),
      submittedAt: '2026-01-0' + (i % 9 + 1) + 'T00:00:00Z', reviewedAt: i > 15 ? '2026-02-01T00:00:00Z' : null,
      reviewedBy: i > 15 ? 'Admin One' : null, approvedStudentId: (i > 15 && i <= 20) ? 's-approved-' + i : null,
      rejectionReason: i > 20 ? 'Duplicate' : null,
    });
  }

  let state = { registrations: regs, students: [], classSections: sections };
  win.AppStore = {
    getSlice(fn) { return fn(JSON.parse(JSON.stringify(state))); },
    getState() { return JSON.parse(JSON.stringify(state)); },
    updateState(fn, event) {
      const draft = JSON.parse(JSON.stringify(state));
      fn(draft);
      state = draft;
      calls.push({ name: 'AppStore.updateState', event });
    },
    subscribe(key, fn) { calls.push({ name: 'AppStore.subscribe', key }); win.__subscribed = win.__subscribed || {}; win.__subscribed[key] = fn; },
  };
  win.DB = { get registrations() { return state.registrations; }, get students() { return state.students; } };
  win.__getFakeState = () => {
    const s = JSON.parse(JSON.stringify(state));
    // reviewedAt and addedAt are both real `new Date().toISOString()`
    // timestamps, not derived from any RPC response — normalize them out
    // (both windows still had to actually record the same events, just
    // at slightly different real wall-clock instants).
    if (s.registrations) s.registrations.forEach(r => { if (r.reviewedAt) r.reviewedAt = 'NORMALIZED'; });
    if (s.students) s.students.forEach(st => { if (st.addedAt) st.addedAt = 'NORMALIZED'; });
    return s;
  };

  win.DBService = {
    getAuthClient() {
      return {
        auth: {
          async signUp({ email }) {
            calls.push({ name: 'signUp', email });
            if (email === 'signupfail@example.com') return { data: null, error: { message: 'boom: signup failed' } };
            return { data: { user: { id: 'uid-1' }, session: { token: 'sess' } }, error: null };
          },
        },
      };
    },
    async rpc(name, params) {
      calls.push({ name, params: JSON.parse(JSON.stringify(params || {})) });
      if (name === 'get_teacher_directory') {
        return { data: [
          { id: 'admin1', display_name: 'Admin One', email: 'admin@x.com', role: 'admin', sections: [{ id: 'sec-a', label: 'Grade 10 - Rizal' }] },
          { id: 't2', display_name: 'Ms. Beta', email: 'beta@x.com', role: 'teacher', sections: [{ id: 'sec-b', label: 'Grade 10 - Aguinaldo' }] },
        ], error: null };
      }
      if (name === 'submit_registration') {
        if (params.p_email === 'rpcfail@example.com') return { data: null, error: { message: 'boom: submit failed' } };
        return {
          data: {
            id: 'reg-new', first_name: params.p_first_name, last_name: params.p_last_name,
            username: params.p_username, email: params.p_email, student_id_text: params.p_student_id_text,
            grade_level: params.p_grade_level, section: params.p_section, status: 'pending', submitted_at: 't',
          },
          error: null,
        };
      }
      if (name === 'check_registration_status') {
        if (params.p_email === 'unknown@example.com') return { data: [], error: null };
        return { data: [{ status: 'pending', rejection_reason: null, submitted_at: 't' }], error: null };
      }
      if (name === 'approve_registration') {
        if (params.p_reg_id === 'FAIL') return { data: null, error: { message: 'boom: approve failed' } };
        return {
          data: {
            id: params.p_reg_id, display_name: 'New Student', init: 'NS', color: '#fff', xp: 0, coins: 0, level: 1, tier: 'bronze',
            attendance_pct: '0', quiz_avg: '0', first_name: 'New', last_name: 'Student', class_id: 'sec-a', join_date: 'd',
          },
          error: null,
        };
      }
      if (name === 'reject_registration') {
        if (params.p_reg_id === 'FAIL') return { data: null, error: { message: 'boom: reject failed' } };
        return { data: { id: params.p_reg_id, status: 'rejected', rejection_reason: params.p_reason }, error: null };
      }
      if (name === 'reassign_registration') {
        if (params.p_reg_id === 'FAIL') return { data: null, error: { message: 'boom: reassign failed' } };
        return { data: { id: params.p_reg_id, grade_level: '9', section: 'Bonifacio', class_id: params.p_new_class_id }, error: null };
      }
      throw new Error('unexpected rpc: ' + name);
    },
  };

  return win;
}

function snapshot(win) {
  return {
    regCardHtml: win.document.getElementById('reg-card-content').innerHTML,
    adminHtml: win.document.getElementById('a-registrations').innerHTML,
    modalHtml: win.document.getElementById('modal-root').innerHTML,
    calls: win.__calls,
  };
}

async function runSequence(win) {
  const results = {};

  // ── Student-facing registration form ─────────────────────────────────
  win.showRegScreen();
  results.regScreenShown = snapshot(win);
  win.__calls.length = 0;

  // Grade -> section cascade.
  win.document.getElementById('rf-grade').value = '10';
  win.regOnGradeChange();
  results.afterGradeChange10 = snapshot(win);
  win.__calls.length = 0;

  win.document.getElementById('rf-grade').value = '';
  win.regOnGradeChange();
  results.afterGradeChangeCleared = snapshot(win);
  win.__calls.length = 0;

  win.document.getElementById('rf-grade').value = '10';
  win.regOnGradeChange();
  win.__calls.length = 0;

  // Field-level validation.
  win.document.getElementById('rf-first').value = 'Juan1'; // has a digit -> invalid
  win.regCheckValidation('first');
  results.firstNameInvalid = snapshot(win);

  win.document.getElementById('rf-first').value = 'Juan';
  win.regCheckValidation('first');
  results.firstNameValid = snapshot(win);

  win.document.getElementById('rf-username').value = 'ab'; // too short
  win.regCheckField('username');
  results.usernameInvalid = snapshot(win);

  win.document.getElementById('rf-username').value = 'juandelacruz';
  win.regCheckField('username');
  results.usernameValid = snapshot(win);

  win.document.getElementById('rf-email').value = 'not-an-email';
  win.regCheckField('email');
  results.emailInvalid = snapshot(win);

  win.document.getElementById('rf-email').value = 'juan@example.com';
  win.regCheckField('email');
  results.emailValid = snapshot(win);

  win.document.getElementById('rf-pass').value = 'short';
  win.regCheckValidation('password');
  results.passwordInvalid = snapshot(win);

  win.document.getElementById('rf-pass').value = 'goodpass1';
  win.regCheckValidation('password');
  win.document.getElementById('rf-pass2').value = 'mismatch1';
  win.regCheckPasswordMatch();
  results.passwordMismatch = snapshot(win);

  win.document.getElementById('rf-pass2').value = 'goodpass1';
  win.regCheckPasswordMatch();
  results.passwordMatch = snapshot(win);
  win.__calls.length = 0;

  // Password toggle button markup (via the real regPasswordToggleBtn used
  // inside showRegScreen()'s own template — already exercised above, but
  // also call it directly to confirm the exported bare-global function
  // itself matches).
  results.passwordToggleBtnHtml = win.regPasswordToggleBtn('rf-pass');

  // Submit with everything missing — aggregated errors.
  ['rf-first', 'rf-last', 'rf-username', 'rf-email', 'rf-sid', 'rf-pass', 'rf-pass2'].forEach(id => { win.document.getElementById(id).value = ''; });
  win.document.getElementById('rf-grade').value = '';
  win.document.getElementById('rf-section').innerHTML = '<option value="">— Select a grade first —</option>';
  await win.doRegister();
  results.submitAllMissing = snapshot(win);
  win.__calls.length = 0;

  // Fill everything in, submit successfully.
  win.document.getElementById('rf-first').value = 'Juan';
  win.document.getElementById('rf-last').value = 'DelaCruz';
  win.document.getElementById('rf-username').value = 'juandelacruz';
  win.document.getElementById('rf-email').value = 'juan@example.com';
  win.document.getElementById('rf-sid').value = '2024-001';
  win.document.getElementById('rf-grade').value = '10';
  win.regOnGradeChange();
  win.document.getElementById('rf-section').value = 'Rizal';
  win.document.getElementById('rf-pass').value = 'goodpass1';
  win.document.getElementById('rf-pass2').value = 'goodpass1';
  await win.doRegister();
  results.submitSuccess = snapshot(win);
  win.__calls.length = 0;

  // Submit with an RPC failure.
  win.showRegScreen();
  win.__calls.length = 0;
  win.document.getElementById('rf-first').value = 'Juan';
  win.document.getElementById('rf-last').value = 'DelaCruz';
  win.document.getElementById('rf-username').value = 'juandelacruz2';
  win.document.getElementById('rf-email').value = 'rpcfail@example.com';
  win.document.getElementById('rf-sid').value = '2024-002';
  win.document.getElementById('rf-grade').value = '10';
  win.regOnGradeChange();
  win.document.getElementById('rf-section').value = 'Rizal';
  win.document.getElementById('rf-pass').value = 'goodpass1';
  win.document.getElementById('rf-pass2').value = 'goodpass1';
  await win.doRegister();
  results.submitRpcFail = snapshot(win);
  win.__calls.length = 0;

  win.hideRegScreen();
  results.afterHideRegScreen = snapshot(win);
  win.__calls.length = 0;

  // ── Status check ────────────────────────────────────────────────────
  win.showRegStatusScreen();
  results.statusModalShown = snapshot(win);
  win.__calls.length = 0;

  win.document.getElementById('regstat-email').value = 'not-an-email';
  await win.regCheckStatusSubmit();
  results.statusInvalidEmail = snapshot(win);
  win.__calls.length = 0;

  win.document.getElementById('regstat-email').value = 'unknown@example.com';
  await win.regCheckStatusSubmit();
  results.statusNotFound = snapshot(win);
  win.__calls.length = 0;

  win.document.getElementById('regstat-email').value = 'known@example.com';
  await win.regCheckStatusSubmit();
  results.statusFoundPending = snapshot(win);
  win.__calls.length = 0;

  // ── Admin management ────────────────────────────────────────────────
  win.renderAdminRegistrations();
  await new Promise(r => setTimeout(r, 20)); // let the async teacher-map fetch settle + re-render
  results.adminInitialRender = snapshot(win);
  win.__calls.length = 0;

  win.regSetFilter('approved');
  results.adminFilterApproved = snapshot(win);
  win.regSetFilter('pending');
  results.adminFilterPending = snapshot(win);
  win.__calls.length = 0;

  win.regGoToPage(1);
  results.adminPage1 = snapshot(win);
  win.regNextPage();
  results.adminPageNext = snapshot(win);
  win.regPrevPage();
  win.regPrevPage(); // clamps at 1
  results.adminPagePrevClamped = snapshot(win);
  win.__calls.length = 0;

  win.regAdminViewDetails('reg1');
  results.viewDetailsPending = snapshot(win);
  win.__calls.length = 0;

  win.regAdminViewDetails('reg16'); // approved
  results.viewDetailsApproved = snapshot(win);
  win.__calls.length = 0;

  win.regAdminViewDetails('reg21'); // rejected
  results.viewDetailsRejected = snapshot(win);
  win.__calls.length = 0;

  // Approve: success, then already-approved no-op, then RPC failure on a fresh row.
  await win.regAdminApprove('reg1');
  results.approveSuccess = { state: win.__getFakeState(), snapshot: snapshot(win) };
  win.__calls.length = 0;

  await win.regAdminApprove('reg16'); // already approved
  results.approveAlreadyApproved = snapshot(win);
  win.__calls.length = 0;

  win.AppStore.updateState(d => { d.registrations.push({ id: 'FAIL', firstName: 'F', lastName: 'L', username: 'fu', email: 'f@x.com', studentId: 'x', gradeLevel: '10', section: 'Rizal', classId: 'sec-a', status: 'pending', submittedAt: 't' }); }, { type: 'test:seed' });
  win.__calls.length = 0;
  await win.regAdminApprove('FAIL');
  results.approveRpcFail = snapshot(win);
  win.__calls.length = 0;

  // Reject: modal, confirm success, confirm RPC failure.
  win.regAdminRejectModal('reg2');
  results.rejectModalOpen = snapshot(win);
  win.__calls.length = 0;

  win.document.getElementById('reg-reject-reason').value = 'Incomplete info';
  await win.regAdminConfirmReject('reg2');
  results.rejectConfirmOk = { state: win.__getFakeState(), snapshot: snapshot(win) };
  win.__calls.length = 0;

  win.regAdminRejectModal('FAIL');
  win.document.getElementById('reg-reject-reason').value = '';
  await win.regAdminConfirmReject('FAIL');
  results.rejectConfirmRpcFail = snapshot(win);
  win.__calls.length = 0;

  // Reassign: modal (admin), validation error, success, RPC failure. Also
  // confirm the reassign button/modal path is admin-gated.
  win.regAdminReassignModal('reg3');
  results.reassignModalOpenAdmin = snapshot(win);
  win.__calls.length = 0;

  win.currentRole = 'teacher';
  win.regAdminReassignModal('reg3'); // defense-in-depth guard — should no-op
  results.reassignModalBlockedForTeacher = snapshot(win);
  win.__calls.length = 0;
  win.currentRole = 'admin';

  win.regAdminReassignModal('reg3');
  win.document.getElementById('reg-reassign-section').value = '';
  await win.regAdminConfirmReassign('reg3');
  results.reassignNoSectionError = snapshot(win);
  win.__calls.length = 0;

  win.document.getElementById('reg-reassign-section').value = 'sec-b';
  await win.regAdminConfirmReassign('reg3');
  results.reassignSuccess = { state: win.__getFakeState(), snapshot: snapshot(win) };
  win.__calls.length = 0;

  win.AppStore.updateState(d => { d.registrations.push({ id: 'FAIL', firstName: 'F2', lastName: 'L2', username: 'fu2', email: 'f2@x.com', studentId: 'x2', gradeLevel: '10', section: 'Rizal', classId: 'sec-a', status: 'pending', submittedAt: 't' }); }, { type: 'test:seed2' });
  win.__calls.length = 0;
  win.regAdminReassignModal('FAIL');
  win.document.getElementById('reg-reassign-section').value = 'sec-b';
  await win.regAdminConfirmReassign('FAIL');
  results.reassignRpcFail = snapshot(win);
  win.__calls.length = 0;

  // ── AppStore.subscribe analytics block — deferred callback, not fired
  // synchronously by subscribe() itself. ──
  results.subscribeCallsAtLoad = win.__calls.filter(c => c.name === 'renderAdminRegistrations' || c.name === 'admin:analytics-rendered').length === 0;
  const cb = win.__subscribed && win.__subscribed['registrations-analytics-block'];
  win.document.getElementById('a-analytics').innerHTML = '<div id="existing">existing content</div>';
  cb({}, { type: 'admin:analytics-rendered' });
  results.analyticsBlockInjected = win.document.getElementById('a-analytics').innerHTML;

  win.document.getElementById('a-analytics').innerHTML = '<div id="marker">unchanged</div>';
  cb({}, { type: 'some:other:event' });
  results.analyticsBlockNonMatchingNoop = win.document.getElementById('a-analytics').innerHTML;

  return results;
}

async function main() {
  const registrationsServiceSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'registrations-service.js'), 'utf8');
  const teacherDirServiceSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'teacher-directory-service.js'), 'utf8');
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'registrations.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'registrations.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(registrationsServiceSrc);
  winOriginal.eval(teacherDirServiceSrc);
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.renderAdminRegistrations, 'function');
  const resultOriginal = await runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.renderAdminRegistrations, 'function');
  const resultBridge = await runSequence(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original output at every step');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('registrations.js: the full student-facing registration form (grade/section cascade, every');
  console.log('field validator, password match, aggregated submit errors, success, RPC failure), the');
  console.log('status-check modal, and the full admin surface (filter/pagination, view details, approve');
  console.log('incl. already-approved + RPC-fail, reject incl. RPC-fail, reassign incl. the admin-only gate,');
  console.log('validation error, and RPC-fail), plus the AppStore.subscribe analytics-block wiring, all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
