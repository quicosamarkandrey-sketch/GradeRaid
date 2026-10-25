// Phase 7, Stream B — equivalence check for modules/admin/teacher-directory.js.
// TeacherDirectoryService and OwnershipService are already independently
// equivalence-checked, so both windows share an identical fake
// DBService.rpc (covering both services' RPC names) and fake
// navigator.clipboard, with the ORIGINAL window evaling both real,
// untouched service files first.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const STARTER_HTML = `<!doctype html><html><body>
  <div id="a-teachers"></div>
  <div id="modal-root"></div>
</body></html>`;

function makeTeachers() {
  const rows = [];
  for (let i = 1; i <= 3; i++) {
    rows.push({
      id: 'admin' + i, display_name: 'Admin ' + i, email: 'admin' + i + '@x.com', role: 'admin',
      is_active: true, student_count: 0, achievement_count: 1, title_count: 0, quiz_count: 2,
      campaign_world_count: 0, shop_product_count: 1, sections: [], last_active_at: '2026-01-01T00:00:00Z', created_at: '2025-01-01T00:00:00Z',
    });
  }
  for (let i = 1; i <= 22; i++) {
    rows.push({
      id: 't' + i, display_name: 'Teacher ' + i, email: 't' + i + '@x.com', role: 'teacher',
      is_active: i !== 5, student_count: 10, achievement_count: 2, title_count: 1, quiz_count: 3,
      campaign_world_count: 1, shop_product_count: 2, sections: [{ id: 'sec' + i, label: 'Grade 10 - Sec' + i, archived: false }],
      last_active_at: i % 3 === 0 ? null : '2026-01-0' + (i % 9 + 1) + 'T00:00:00Z', created_at: '2025-06-01T00:00:00Z',
    });
  }
  return rows;
}

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.com/app/index.html' });
  const win = dom.window;
  const calls = [];
  win.__calls = calls;

  win.currentRole = 'admin';
  win.currentUser = { id: 'admin1' };
  win._esc = s => String(s == null ? '' : s);
  win.toast = function (msg, color) { calls.push({ name: 'toast', msg, color }); };
  win.showModal = function (html, size) {
    calls.push({ name: 'showModal', size });
    win.document.getElementById('modal-root').innerHTML = html;
  };
  win.closeModalForce = function () { calls.push({ name: 'closeModalForce' }); win.document.getElementById('modal-root').innerHTML = ''; };
  win.__confirmAnswer = true;
  win.confirm = function (msg) { calls.push({ name: 'confirm', msg }); return win.__confirmAnswer; };
  win.openContentOversightFor = function (id, label) { calls.push({ name: 'openContentOversightFor', id, label }); };

  win.__clipboardFails = false;
  win.navigator.clipboard = {
    writeText: async (text) => {
      calls.push({ name: 'clipboard.writeText', text });
      if (win.__clipboardFails) throw new Error('clipboard denied');
    },
  };

  const teachers = makeTeachers();
  const invites = [
    { token: 'tok-pending-1234567890', status: 'pending', created_at: '2026-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z', used_by_name: null },
    { token: 'tok-expired-1234567890', status: 'pending', created_at: '2025-01-01T00:00:00Z', expires_at: '2025-01-08T00:00:00Z', used_by_name: null },
    { token: 'tok-used-12345678901234', status: 'used', created_at: '2025-06-01T00:00:00Z', expires_at: '2025-06-08T00:00:00Z', used_by_name: 'Someone' },
    { token: 'tok-revoked-1234567890', status: 'revoked', created_at: '2025-07-01T00:00:00Z', expires_at: '2025-07-08T00:00:00Z', used_by_name: null },
  ];

  win.DBService = {
    async rpc(name, params) {
      calls.push({ name, params: JSON.parse(JSON.stringify(params || {})) });
      if (name === 'get_teacher_directory') {
        if (win.__dirFail) return { data: null, error: { message: 'boom: directory failed' } };
        return { data: teachers, error: null };
      }
      if (name === 'get_teacher_invites') {
        if (win.__invitesFail) return { data: null, error: { message: 'boom: invites failed' } };
        return { data: invites, error: null };
      }
      if (name === 'promote_to_admin') {
        return { data: null, error: null };
      }
      if (name === 'demote_to_teacher') {
        if (params.p_admin_id === 'last-admin') return { data: null, error: { message: 'Cannot demote the last remaining admin.' } };
        return { data: null, error: null };
      }
      if (name === 'deactivate_teacher_account') return { data: null, error: null };
      if (name === 'reactivate_teacher_account') return { data: null, error: null };
      if (name === 'create_teacher_invite') return { data: { token: 'new-tok-abcdefghij', created_at: 'c', expires_at: 'e', status: 'pending' }, error: null };
      if (name === 'revoke_teacher_invite') return { data: null, error: null };
      if (name === 'transfer_teacher_ownership') {
        if (params.p_from_teacher_id === 'FAIL') return { data: null, error: { message: 'boom: transfer failed' } };
        return {
          data: {
            fromTeacherId: params.p_from_teacher_id, toTeacherId: params.p_to_teacher_id,
            sectionsReassigned: 2, sectionsArchived: 1, achievements: 2, titles: 1,
            quizzes: 3, campaignWorlds: 1, shopProducts: 2, bossLibrary: 0,
          },
          error: null,
        };
      }
      throw new Error('unexpected rpc: ' + name);
    },
    async sendPasswordResetEmail(email) {
      calls.push({ name: 'sendPasswordResetEmail', email });
      if (email === 'fail@example.com') return { ok: false, error: 'boom: reset failed' };
      return { ok: true };
    },
    getAuthClient() {
      return { auth: {} }; // not used by promote/demote/deactivate/reactivate/invite paths
    },
  };
  win.refreshSectionData = undefined; // OwnershipService's typeof-guarded fire-and-forget call
  win.HTMLElement.prototype.scrollIntoView = function () {};

  return win;
}

function snapshot(win) {
  return { mainHtml: win.document.getElementById('a-teachers').innerHTML, modalHtml: win.document.getElementById('modal-root').innerHTML, calls: win.__calls };
}

async function runSequence(win) {
  const results = {};

  // Non-admin gate.
  win.currentRole = 'teacher';
  await win.renderTeacherDirectory();
  results.nonAdminGate = snapshot(win);
  win.__calls.length = 0;
  win.currentRole = 'admin';

  // Both fetches fail.
  win.__dirFail = true; win.__invitesFail = true;
  await win.renderTeacherDirectory();
  results.bothFetchFail = snapshot(win);
  win.__calls.length = 0;
  win.__dirFail = false; win.__invitesFail = false;

  // Normal load.
  await win.renderTeacherDirectory();
  results.normalLoad = snapshot(win);
  win.__calls.length = 0;

  // Search + pagination.
  win.tdSetSearch('Teacher 1');
  results.afterSearch = snapshot(win);
  win.tdSetSearch('');
  win.tdGoToPage(2);
  results.afterGoToPage2 = snapshot(win);
  win.tdNextPage();
  results.afterNextPage = snapshot(win);
  win.tdPrevPage();
  win.tdPrevPage();
  win.tdPrevPage(); // clamps at page 1
  results.afterPrevPageClamped = snapshot(win);
  win.__calls.length = 0;

  // Promote a teacher (accept confirm).
  await win.doPromoteTeacher('t1', 'Teacher 1');
  results.promoteOk = snapshot(win);
  win.__calls.length = 0;

  // Demote declined via confirm.
  win.__confirmAnswer = false;
  await win.doDemoteAdmin('admin2', 'Admin 2');
  results.demoteDeclined = snapshot(win);
  win.__calls.length = 0;
  win.__confirmAnswer = true;

  // Demote accepted.
  await win.doDemoteAdmin('admin2', 'Admin 2');
  results.demoteOk = snapshot(win);
  win.__calls.length = 0;

  // Deactivate / reactivate.
  await win.doDeactivateAccount('t2', 'Teacher 2');
  results.deactivateOk = snapshot(win);
  win.__calls.length = 0;
  await win.doReactivateAccount('t5', 'Teacher 5');
  results.reactivateOk = snapshot(win);
  win.__calls.length = 0;

  // Send password reset: no email, then success.
  await win.doSendPasswordReset('t3', '', 'Teacher 3');
  results.resetNoEmail = snapshot(win);
  win.__calls.length = 0;
  await win.doSendPasswordReset('t3', 't3@x.com', 'Teacher 3');
  results.resetOk = snapshot(win);
  win.__calls.length = 0;

  // Generate invite (clipboard succeeds).
  await win.doGenerateTeacherInvite();
  results.generateInviteOk = snapshot(win);
  win.__calls.length = 0;

  // Generate invite (clipboard fails -> fallback toast).
  win.__clipboardFails = true;
  await win.doGenerateTeacherInvite();
  results.generateInviteClipboardFail = snapshot(win);
  win.__calls.length = 0;
  win.__clipboardFails = false;

  // Copy an existing link.
  await win.doCopyTeacherInviteLink('tok-pending-1234567890');
  results.copyLinkOk = snapshot(win);
  win.__calls.length = 0;

  // Revoke: declined then accepted.
  win.__confirmAnswer = false;
  await win.doRevokeTeacherInvite('tok-pending-1234567890');
  results.revokeDeclined = snapshot(win);
  win.__calls.length = 0;
  win.__confirmAnswer = true;
  await win.doRevokeTeacherInvite('tok-pending-1234567890');
  results.revokeOk = snapshot(win);
  win.__calls.length = 0;

  // Transfer ownership: account not found.
  win._tdOpenTransferModal('nonexistent-id');
  results.transferAccountNotFound = snapshot(win);
  win.__calls.length = 0;

  // Transfer ownership: open modal for a real teacher.
  win._tdOpenTransferModal('t6');
  results.transferModalOpen = snapshot(win);
  win.__calls.length = 0;

  // Submit without picking a destination -> validation error.
  await win._tdSubmitTransfer('t6', 'Teacher 6');
  results.transferSubmitNoDest = snapshot(win);
  win.__calls.length = 0;

  // Pick a destination, decline the confirm.
  win.document.getElementById('td-transfer-dest').value = 't7';
  win.__confirmAnswer = false;
  await win._tdSubmitTransfer('t6', 'Teacher 6');
  results.transferSubmitDeclined = snapshot(win);
  win.__calls.length = 0;
  win.__confirmAnswer = true;

  // Accept — successful transfer.
  win._tdOpenTransferModal('t6');
  win.document.getElementById('td-transfer-dest').value = 't7';
  const cb = win.document.querySelector('.td-transfer-archive-cb');
  if (cb) cb.checked = true;
  await win._tdSubmitTransfer('t6', 'Teacher 6');
  results.transferSubmitOk = snapshot(win);
  win.__calls.length = 0;

  // Transfer RPC failure.
  win._tdOpenTransferModal('t8');
  win.document.getElementById('td-transfer-dest').value = 't9';
  await win._tdSubmitTransfer('FAIL', 'Teacher 8');
  results.transferSubmitRpcFail = snapshot(win);

  return results;
}

async function main() {
  const teacherDirServiceSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'teacher-directory-service.js'), 'utf8');
  const ownershipServiceSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'ownership-service.js'), 'utf8');
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'teacher-directory.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'teacher-directory.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(teacherDirServiceSrc);
  winOriginal.eval(ownershipServiceSrc);
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.renderTeacherDirectory, 'function');
  const resultOriginal = await runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.renderTeacherDirectory, 'function');
  const resultBridge = await runSequence(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original output at every step');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('teacher-directory.js: non-admin gate, both-fetch-fail, normal load, search + pagination');
  console.log('(incl. next/prev + clamp), promote/demote (incl. confirm decline), deactivate/reactivate,');
  console.log('send-reset (no-email + success), generate-invite (clipboard success + failure fallback),');
  console.log('copy-link, revoke (decline/accept), and the transfer-ownership flow (account-not-found,');
  console.log('validation error, confirm decline, success with an archived section, and RPC failure) all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
