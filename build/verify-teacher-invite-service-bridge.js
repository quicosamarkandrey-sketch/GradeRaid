// Phase 7, Stream B — equivalence check for modules/admin/teacher-invite-service.js.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeAuthClient(calls) {
  return {
    auth: {
      async signUp({ email: e, password }) {
        calls.push({ name: 'signUp', email: e });
        if (e === 'signupfail@example.com') return { data: null, error: { message: 'boom: signup failed' } };
        if (e === 'nouser@example.com') return { data: { user: null, session: null }, error: null };
        if (e === 'noconfirm@example.com') return { data: { user: { id: 'uid-1' }, session: null }, error: null };
        return { data: { user: { id: 'uid-1' }, session: { token: 'sess' } }, error: null };
      },
      async signInWithPassword({ email: e }) {
        calls.push({ name: 'signInWithPassword', email: e });
        if (e === 'noconfirm-blocked@example.com') return { data: null, error: { message: 'confirm email blocked' } };
        return { data: { session: { token: 'sess-2' } }, error: null };
      },
      async signOut() {
        calls.push({ name: 'signOut' });
        if (calls.__throwOnSignOut) throw new Error('signOut boom');
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
      if (name === 'check_teacher_invite') {
        if (params.p_token === 'nonerow') return { data: [], error: null };
        if (params.p_token === 'checkfail') return { data: null, error: { message: 'boom: check failed' } };
        return { data: [{ valid: params.p_token !== 'expired', reason: params.p_token === 'expired' ? 'expired' : null }], error: null };
      }
      if (name === 'redeem_teacher_invite') {
        if (params.p_token === 'redeemfail') return { data: null, error: { message: 'boom: redeem failed' } };
        return { data: { id: 'p1', display_name: 'Ms. Doe', first_name: params.p_first_name, last_name: params.p_last_name }, error: null };
      }
      throw new Error('unexpected rpc: ' + name);
    },
  };
  return win;
}

async function runSequence(win) {
  const results = {};

  results.checkOk = await win.TeacherInviteService.checkInvite('valid-tok');
  results.checkExpired = await win.TeacherInviteService.checkInvite('expired');
  results.checkNoRow = await win.TeacherInviteService.checkInvite('nonerow');
  results.checkFail = await win.TeacherInviteService.checkInvite('checkfail');

  results.signupOk = await win.TeacherInviteService.completeSignup({
    token: 'tok1', email: 'ok@example.com', password: 'pw', firstName: 'A', lastName: 'B', color: '#000', init: 'A',
  });
  results.signupSignupFail = await win.TeacherInviteService.completeSignup({ token: 't', email: 'signupfail@example.com', password: 'pw' });
  results.signupNoUser = await win.TeacherInviteService.completeSignup({ token: 't', email: 'nouser@example.com', password: 'pw' });
  results.signupNoConfirmOk = await win.TeacherInviteService.completeSignup({
    token: 'tok2', email: 'noconfirm@example.com', password: 'pw', firstName: 'C', lastName: 'D',
  });
  results.signupNoConfirmBlocked = await win.TeacherInviteService.completeSignup({ token: 't', email: 'noconfirm-blocked@example.com', password: 'pw' });
  results.signupRedeemFail = await win.TeacherInviteService.completeSignup({
    token: 'redeemfail', email: 'ok2@example.com', password: 'pw', firstName: 'E', lastName: 'F',
  });

  results.dbCalls = win.__dbCalls;
  return results;
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'teacher-invite-service.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'teacher-invite-service.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.TeacherInviteService, 'object');
  const resultOriginal = await runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.TeacherInviteService, 'object');
  const resultBridge = await runSequence(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original output');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('teacher-invite-service.js: checkInvite + completeSignup match across happy/no-session/');
  console.log('no-confirm-fallback/redeem-failure (incl. the signOut-on-failure cleanup) paths.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
