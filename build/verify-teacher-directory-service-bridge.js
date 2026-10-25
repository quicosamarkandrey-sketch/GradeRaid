// Phase 7, Stream B — equivalence check for modules/admin/teacher-directory-service.js.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html></html>', { runScripts: 'dangerously', url: 'https://example.com/app/index.html?x=1' });
  const win = dom.window;
  const calls = [];
  win.__dbCalls = calls;
  win.DBService = {
    async rpc(name, params) {
      calls.push({ name, params: JSON.parse(JSON.stringify(params || {})) });
      if (name === 'get_teacher_directory') return { data: [{ id: 't1' }, { id: 't2' }], error: null };
      if (name === 'promote_to_admin') {
        if (params.p_teacher_id === 'FAIL') return { data: null, error: { message: 'boom: promote failed' } };
        return { data: null, error: null };
      }
      if (name === 'demote_to_teacher') {
        if (params.p_admin_id === 'last-admin') return { data: null, error: { message: 'Cannot demote the last remaining admin.' } };
        return { data: null, error: null };
      }
      if (name === 'deactivate_teacher_account') {
        if (params.p_target_id === 'self') return { data: null, error: { message: 'Cannot deactivate your own account.' } };
        return { data: null, error: null };
      }
      if (name === 'reactivate_teacher_account') return { data: null, error: null };
      if (name === 'create_teacher_invite') return { data: { token: 'tok-1', created_at: 'c', expires_at: 'e', status: 'pending' }, error: null };
      if (name === 'get_teacher_invites') return { data: [{ token: 'tok-1' }], error: null };
      if (name === 'revoke_teacher_invite') {
        if (params.p_token === 'missing') return { data: null, error: { message: 'boom: revoke failed' } };
        return { data: null, error: null };
      }
      throw new Error('unexpected rpc: ' + name);
    },
    async sendPasswordResetEmail(email, redirectTo) {
      calls.push({ name: 'sendPasswordResetEmail', params: { email, redirectTo } });
      if (email === 'fail@example.com') return { ok: false, error: 'boom: reset failed' };
      return { ok: true };
    },
  };
  return win;
}

async function runSequence(win) {
  const results = {};
  results.getDirectory = await win.TeacherDirectoryService.getDirectory();
  results.promoteOk = await win.TeacherDirectoryService.promoteToAdmin('t1');
  results.promoteMissing = await win.TeacherDirectoryService.promoteToAdmin(null);
  results.promoteFail = await win.TeacherDirectoryService.promoteToAdmin('FAIL');
  results.demoteOk = await win.TeacherDirectoryService.demoteToTeacher('a1');
  results.demoteMissing = await win.TeacherDirectoryService.demoteToTeacher(null);
  results.demoteLastAdmin = await win.TeacherDirectoryService.demoteToTeacher('last-admin');
  results.deactivateOk = await win.TeacherDirectoryService.deactivateAccount('t1');
  results.deactivateMissing = await win.TeacherDirectoryService.deactivateAccount(null);
  results.deactivateSelf = await win.TeacherDirectoryService.deactivateAccount('self');
  results.reactivateOk = await win.TeacherDirectoryService.reactivateAccount('t1');
  results.reactivateMissing = await win.TeacherDirectoryService.reactivateAccount(null);
  results.resetNoEmail = await win.TeacherDirectoryService.sendPasswordReset(null);
  results.resetOk = await win.TeacherDirectoryService.sendPasswordReset('ok@example.com');
  results.resetFail = await win.TeacherDirectoryService.sendPasswordReset('fail@example.com');
  results.createInvite = await win.TeacherDirectoryService.createInvite();
  results.getInvites = await win.TeacherDirectoryService.getInvites();
  results.revokeOk = await win.TeacherDirectoryService.revokeInvite('tok-1');
  results.revokeMissingToken = await win.TeacherDirectoryService.revokeInvite(null);
  results.revokeNotFound = await win.TeacherDirectoryService.revokeInvite('missing');
  results.dbCalls = win.__dbCalls;
  return results;
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'teacher-directory-service.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'teacher-directory-service.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.TeacherDirectoryService, 'object');
  const resultOriginal = await runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.TeacherDirectoryService, 'object');
  const resultBridge = await runSequence(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original output');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('teacher-directory-service.js: all 9 methods match across happy/validation/RPC-error paths.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
