// Phase 7, Stream B — equivalence check for modules/admin/teacher-invite.js.
// Covers: the load-time entry-point IIFE (both with and without
// ?teacher_invite=<token> in the URL, via separate jsdom windows
// constructed with different starting URLs), showTeacherInviteScreen
// (valid/invalid/error invite), teacherInviteCheckValidation's live
// password-match feedback, doCompleteTeacherSignup (validation errors,
// success, and RPC failure), and hideTeacherInviteScreen.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const STARTER_HTML = `<!doctype html><html><body>
  <div id="login-screen" style="display:flex"></div>
  <div id="reg-screen" class="open"></div>
  <div id="recovery-screen" class="open"></div>
  <div id="teacher-invite-screen"><div id="teacher-invite-card-content"></div></div>
</body></html>`;

function makeWindow(opts) {
  opts = opts || {};
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: opts.url || 'https://example.com/app/index.html' });
  const win = dom.window;
  const calls = [];
  win.__calls = calls;

  win._esc = s => String(s == null ? '' : s);
  win.regPasswordToggleBtn = function (id) { calls.push({ name: 'regPasswordToggleBtn', id }); return `<button data-toggle="${id}"></button>`; };
  win.regValidatePassword = function (pw) {
    calls.push({ name: 'regValidatePassword', pw });
    if (pw.length < 8) return { ok: false, msg: 'Password must be at least 8 characters.' };
    if (!/\d/.test(pw)) return { ok: false, msg: 'Password must include a number.' };
    return { ok: true };
  };
  win.regValidateName = function (name, label) {
    calls.push({ name: 'regValidateName', value: name, label });
    if (/\d/.test(name)) return { ok: false, msg: label + ' cannot contain numbers.' };
    return { ok: true };
  };
  win.regPickColor = function (email) { calls.push({ name: 'regPickColor', email }); return '#8b5cf6'; };
  win.regMakeInitials = function (first, last) { calls.push({ name: 'regMakeInitials', first, last }); return (first[0] || '') + (last[0] || ''); };

  win.DBService = {}; // not used directly by this file, but TeacherInviteService needs it defined when real-imported/evaled
  win.DBService.getAuthClient = function () {
    return {
      auth: {
        async signUp({ email }) {
          if (email === 'signupfail@example.com') return { data: null, error: { message: 'boom: signup failed' } };
          return { data: { user: { id: 'uid-1' }, session: { token: 'sess' } }, error: null };
        },
        async signInWithPassword() { return { data: { session: { token: 'sess-2' } }, error: null }; },
        async signOut() {},
      },
    };
  };
  win.DBService.rpc = async function (name, params) {
    calls.push({ name, params: JSON.parse(JSON.stringify(params || {})) });
    if (name === 'check_teacher_invite') {
      if (params.p_token === 'expired-tok') return { data: [{ valid: false, reason: 'expired' }], error: null };
      if (params.p_token === 'error-tok') return { data: null, error: { message: 'boom: check failed' } };
      return { data: [{ valid: true, reason: null }], error: null };
    }
    if (name === 'redeem_teacher_invite') {
      if (params.p_token === 'redeem-fail-tok') return { data: null, error: { message: 'boom: redeem failed' } };
      return { data: { id: 'p1', display_name: (params.p_first_name || '') + ' ' + (params.p_last_name || '') }, error: null };
    }
    throw new Error('unexpected rpc: ' + name);
  };

  return win;
}

function snapshot(win) {
  return {
    cardHtml: win.document.getElementById('teacher-invite-card-content').innerHTML,
    screenOpen: win.document.getElementById('teacher-invite-screen').classList.contains('open'),
    loginDisplay: win.document.getElementById('login-screen').style.display,
    calls: win.__calls,
  };
}

async function runMainSequence(win) {
  const results = {};

  // Invalid/expired invite.
  await win.showTeacherInviteScreen('expired-tok');
  results.expiredInvite = snapshot(win);
  win.__calls.length = 0;

  // Error checking invite.
  await win.showTeacherInviteScreen('error-tok');
  results.errorInvite = snapshot(win);
  win.__calls.length = 0;

  // Valid invite -> form renders.
  await win.showTeacherInviteScreen('good-tok');
  results.validInvite = snapshot(win);
  win.__calls.length = 0;

  // Live validation feedback: weak password, then matching passwords.
  win.document.getElementById('ti-pass').value = 'short';
  win.document.getElementById('ti-pass-confirm').value = '';
  win.teacherInviteCheckValidation();
  results.weakPasswordFeedback = snapshot(win);
  win.__calls.length = 0;

  win.document.getElementById('ti-pass').value = 'goodpass1';
  win.document.getElementById('ti-pass-confirm').value = 'goodpass1';
  win.teacherInviteCheckValidation();
  results.matchingPasswordFeedback = snapshot(win);
  win.__calls.length = 0;

  win.document.getElementById('ti-pass-confirm').value = 'mismatch1';
  win.teacherInviteCheckValidation();
  results.mismatchedPasswordFeedback = snapshot(win);
  win.__calls.length = 0;

  // Submit with validation errors (missing everything).
  win.document.getElementById('ti-first').value = '';
  win.document.getElementById('ti-last').value = '';
  win.document.getElementById('ti-email').value = '';
  win.document.getElementById('ti-pass').value = '';
  win.document.getElementById('ti-pass-confirm').value = '';
  await win.doCompleteTeacherSignup();
  results.submitValidationErrors = snapshot(win);
  win.__calls.length = 0;

  // Submit with mismatched passwords only.
  win.document.getElementById('ti-first').value = 'Juan';
  win.document.getElementById('ti-last').value = 'Cruz';
  win.document.getElementById('ti-email').value = 'juan@example.com';
  win.document.getElementById('ti-pass').value = 'goodpass1';
  win.document.getElementById('ti-pass-confirm').value = 'different1';
  await win.doCompleteTeacherSignup();
  results.submitMismatch = snapshot(win);
  win.__calls.length = 0;

  // Successful submit.
  win.document.getElementById('ti-pass-confirm').value = 'goodpass1';
  await win.doCompleteTeacherSignup();
  results.submitSuccess = snapshot(win);
  win.__calls.length = 0;

  // hideTeacherInviteScreen.
  win.hideTeacherInviteScreen();
  results.afterHide = snapshot(win);

  return results;
}

async function runRedeemFailCase(win) {
  await win.showTeacherInviteScreen('redeem-fail-tok');
  win.document.getElementById('ti-first').value = 'A';
  win.document.getElementById('ti-last').value = 'B';
  win.document.getElementById('ti-email').value = 'a@example.com';
  win.document.getElementById('ti-pass').value = 'goodpass1';
  win.document.getElementById('ti-pass-confirm').value = 'goodpass1';
  await win.doCompleteTeacherSignup();
  return snapshot(win);
}

async function main() {
  const teacherInviteServiceSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'teacher-invite-service.js'), 'utf8');
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'teacher-invite.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'teacher-invite.bridge.js'), 'utf8');

  // 1. No ?teacher_invite= in URL — entry-point IIFE is a no-op, screen stays closed.
  {
    const winO = makeWindow({ url: 'https://example.com/app/index.html' });
    winO.eval(teacherInviteServiceSrc);
    winO.eval(originalSrc);
    const rO = snapshot(winO);
    const winB = makeWindow({ url: 'https://example.com/app/index.html' });
    winB.eval(bridgeSrc);
    const rB = snapshot(winB);
    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'no-token entry-point mismatch');
  }

  // 2. ?teacher_invite=<token> present — entry-point IIFE auto-opens the screen.
  {
    const winO = makeWindow({ url: 'https://example.com/app/index.html?teacher_invite=good-tok' });
    winO.eval(teacherInviteServiceSrc);
    winO.eval(originalSrc);
    await new Promise(r => setTimeout(r, 20)); // let the IIFE's async showTeacherInviteScreen settle
    const rO = snapshot(winO);
    const winB = makeWindow({ url: 'https://example.com/app/index.html?teacher_invite=good-tok' });
    winB.eval(bridgeSrc);
    await new Promise(r => setTimeout(r, 20));
    const rB = snapshot(winB);
    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'auto-open entry-point mismatch');
  }

  // 3. Full driven sequence (invite checks, validation feedback, submit flows).
  {
    const winO = makeWindow();
    winO.eval(teacherInviteServiceSrc);
    winO.eval(originalSrc);
    const rO = await runMainSequence(winO);
    const winB = makeWindow();
    winB.eval(bridgeSrc);
    const rB = await runMainSequence(winB);
    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'main sequence mismatch');
  }

  // 4. Redeem RPC failure (auth account created but redeem fails).
  {
    const winO = makeWindow();
    winO.eval(teacherInviteServiceSrc);
    winO.eval(originalSrc);
    const rO = await runRedeemFailCase(winO);
    const winB = makeWindow();
    winB.eval(bridgeSrc);
    const rB = await runRedeemFailCase(winB);
    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'redeem-fail mismatch');
  }

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('teacher-invite.js: entry-point IIFE (no-token + auto-open-on-token), showTeacherInviteScreen');
  console.log('(expired/error/valid invite), live password-match validation feedback, doCompleteTeacherSignup');
  console.log('(validation errors, mismatch, success, and redeem RPC failure), and hideTeacherInviteScreen');
  console.log('all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
