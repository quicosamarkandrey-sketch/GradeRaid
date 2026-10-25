// Phase 7, Stream B — equivalence check for modules/admin/registrations-service.js.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeAuthClient(calls, email) {
  return {
    auth: {
      async signUp({ email: e, password }) {
        calls.push({ name: 'signUp', email: e });
        if (e === 'signupfail@example.com') return { data: null, error: { message: 'boom: signup failed' } };
        if (e === 'nouser@example.com') return { data: { user: null, session: null }, error: null };
        if (e === 'noconfirm@example.com') return { data: { user: { id: 'uid-1' }, session: null }, error: null };
        return { data: { user: { id: 'uid-1' }, session: { token: 'sess' } }, error: null };
      },
      async signInWithPassword({ email: e, password }) {
        calls.push({ name: 'signInWithPassword', email: e });
        if (e === 'noconfirm-blocked@example.com') return { data: null, error: { message: 'confirm email blocked' } };
        return { data: { session: { token: 'sess-2' } }, error: null };
      },
    },
  };
}

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html></html>', { runScripts: 'dangerously' });
  const win = dom.window;
  const calls = [];
  win.__dbCalls = calls;
  win.DBService = {
    getAuthClient() {
      return makeAuthClient(calls);
    },
    async rpc(name, params) {
      calls.push({ name, params: JSON.parse(JSON.stringify(params || {})) });
      if (name === 'submit_registration') {
        if (params.p_email === 'rpcfail@example.com') return { data: null, error: { message: 'boom: submit failed' } };
        return {
          data: {
            id: 'reg-1', first_name: params.p_first_name, last_name: params.p_last_name,
            username: params.p_username, email: params.p_email, student_id_text: params.p_student_id_text,
            grade_level: params.p_grade_level, section: params.p_section, status: 'pending', submitted_at: 't',
          },
          error: null,
        };
      }
      if (name === 'check_registration_status') {
        if (params.p_email === 'unknown@example.com') return { data: [], error: null };
        if (params.p_email === 'checkfail@example.com') return { data: null, error: { message: 'boom: check failed' } };
        return { data: [{ status: 'approved', rejection_reason: null, submitted_at: 't' }], error: null };
      }
      if (name === 'approve_registration') {
        if (params.p_reg_id === 'FAIL') return { data: null, error: { message: 'boom: approve failed' } };
        return {
          data: {
            id: params.p_reg_id, display_name: 'Jay', init: 'J', color: '#fff', xp: 0, coins: 0, level: 1, tier: 'bronze',
            attendance_pct: '99.5', quiz_avg: '80', first_name: 'Jay', last_name: 'Doe', class_id: 'c1', join_date: 'd',
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
        return { data: { id: params.p_reg_id, grade_level: '10', section: 'A', class_id: params.p_new_class_id }, error: null };
      }
      throw new Error('unexpected rpc: ' + name);
    },
  };
  return win;
}

async function runSequence(win) {
  const results = {};

  results.registerOk = await win.RegistrationService.registerStudent({
    email: 'ok@example.com', password: 'pw', firstName: 'A', lastName: 'B', username: 'ab', studentId: 's1', gradeLevel: '10', section: 'A',
  });
  results.registerSignupFail = await win.RegistrationService.registerStudent({ email: 'signupfail@example.com', password: 'pw' });
  results.registerNoUser = await win.RegistrationService.registerStudent({ email: 'nouser@example.com', password: 'pw' });
  results.registerNoConfirmOk = await win.RegistrationService.registerStudent({
    email: 'noconfirm@example.com', password: 'pw', firstName: 'C', lastName: 'D', username: 'cd', studentId: 's2', gradeLevel: '9', section: 'B',
  });
  results.registerNoConfirmBlocked = await win.RegistrationService.registerStudent({ email: 'noconfirm-blocked@example.com', password: 'pw' });
  results.registerRpcFail = await win.RegistrationService.registerStudent({ email: 'rpcfail@example.com', password: 'pw' });

  results.checkFound = await win.RegistrationService.checkStatus('found@example.com');
  results.checkNotFound = await win.RegistrationService.checkStatus('unknown@example.com');
  results.checkFail = await win.RegistrationService.checkStatus('checkfail@example.com');

  results.approveOk = await win.RegistrationService.approve('reg-1', { color: '#000', init: 'J' });
  results.approveNoOpts = await win.RegistrationService.approve('reg-2');
  results.approveFail = await win.RegistrationService.approve('FAIL', {});

  results.rejectOk = await win.RegistrationService.reject('reg-1', 'bad info');
  results.rejectNoReason = await win.RegistrationService.reject('reg-2');
  results.rejectFail = await win.RegistrationService.reject('FAIL', 'x');

  results.reassignOk = await win.RegistrationService.reassign('reg-1', 'class-2');
  results.reassignFail = await win.RegistrationService.reassign('FAIL', 'class-2');

  results.dbCalls = win.__dbCalls;
  return results;
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'registrations-service.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'registrations-service.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.RegistrationService, 'object');
  const resultOriginal = await runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.RegistrationService, 'object');
  const resultBridge = await runSequence(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original output');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('registrations-service.js: registerStudent (incl. no-session/no-confirm fallback), checkStatus,');
  console.log('approve, reject, reassign all match across happy/error paths.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
