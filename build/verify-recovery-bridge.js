// Phase 7 (Stream A) — equivalence check for recovery.js.
// Covers: showRecoveryScreen's full render (screen toggling, one-time
// style injection, deferred focus), recCheckValidation (empty/invalid/
// valid password, matching/mismatched confirm), doSetNewPassword
// (validation errors, no-client "still connecting" state, updateUser
// failure with and without a message, success incl. the signOut call
// and its own failure being swallowed), and the bottom-of-file IIFE:
// no DBService at load (no-op), DBService present but no event fired
// yet (no auto-render), and a real PASSWORD_RECOVERY event firing
// showRecoveryScreen().
const { JSDOM } = require('jsdom');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const STARTER_HTML = `<!doctype html><html><head></head><body>
  <div id="login-screen" style="display:flex"></div>
  <div id="reg-screen" class="open"></div>
  <div id="recovery-screen"><div id="recovery-card-content"></div></div>
</body></html>`;

function makeWindow(opts) {
  opts = opts || {};
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.org/app/index.html' });
  const win = dom.window;
  const calls = [];
  win.__calls = calls;

  win.regPasswordToggleBtn = function (id) { calls.push({ name: 'regPasswordToggleBtn', id }); return `<button data-toggle="${id}"></button>`; };
  win.regValidatePassword = function (pw) {
    calls.push({ name: 'regValidatePassword', pw });
    if (pw.length < 8) return { ok: false, msg: 'Password must be at least 8 characters.' };
    if (!/\d/.test(pw)) return { ok: false, msg: 'Password must include a number.' };
    return { ok: true };
  };
  win.toast = function (msg, color) { calls.push({ name: 'toast', msg, color }); };
  win.HTMLElement.prototype.focus = function () { calls.push({ name: 'focus', id: this.id }); };

  let authStateCb = null;
  win.__fireAuthEvent = function (event) { if (authStateCb) authStateCb(event); };

  if (!opts.noDBService) {
    win.DBService = {
      getAuthClient() {
        if (opts.noClient) return null;
        return {
          auth: {
            onAuthStateChange(cb) { calls.push({ name: 'onAuthStateChange registered' }); authStateCb = cb; },
            async updateUser({ password }) {
              calls.push({ name: 'updateUser', password });
              if (opts.updateUserFailsWithMessage) return { error: { message: 'Recovery link expired.' } };
              if (opts.updateUserFailsNoMessage) return { error: {} };
              return { error: null };
            },
            async signOut() {
              calls.push({ name: 'signOut' });
              if (opts.signOutThrows) throw new Error('signOut boom');
            },
          },
        };
      },
    };
  }

  return win;
}

function snapshot(win) {
  return {
    cardHtml: win.document.getElementById('recovery-card-content').innerHTML,
    screenOpen: win.document.getElementById('recovery-screen').classList.contains('open'),
    loginDisplay: win.document.getElementById('login-screen').style.display,
    regHasOpen: win.document.getElementById('reg-screen').classList.contains('open'),
    hasStyleTag: !!win.document.getElementById('recovery-screen-styles'),
    calls: win.__calls,
  };
}

async function runMainSequence(win) {
  const results = {};

  win.showRecoveryScreen();
  await new Promise(r => setTimeout(r, 60)); // let the 50ms deferred focus() fire
  results.afterShowScreen = snapshot(win);
  win.__calls.length = 0;

  // Calling it again should NOT re-inject the style tag.
  win.showRecoveryScreen();
  await new Promise(r => setTimeout(r, 60));
  results.afterShowScreenAgain = snapshot(win);
  win.__calls.length = 0;

  // Validation: empty fields -> no message.
  win.recCheckValidation();
  results.validationEmptyFields = snapshot(win);
  win.__calls.length = 0;

  // Weak password.
  win.document.getElementById('rec-pass').value = 'short';
  win.recCheckValidation();
  results.validationWeakPassword = snapshot(win);
  win.__calls.length = 0;

  // Valid password, no confirm yet.
  win.document.getElementById('rec-pass').value = 'goodpass1';
  win.recCheckValidation();
  results.validationGoodPasswordNoConfirm = snapshot(win);
  win.__calls.length = 0;

  // Mismatched confirm.
  win.document.getElementById('rec-pass-confirm').value = 'different1';
  win.recCheckValidation();
  results.validationMismatch = snapshot(win);
  win.__calls.length = 0;

  // Matching confirm.
  win.document.getElementById('rec-pass-confirm').value = 'goodpass1';
  win.recCheckValidation();
  results.validationMatch = snapshot(win);
  win.__calls.length = 0;

  // Submit: invalid password.
  win.document.getElementById('rec-pass').value = 'short';
  win.document.getElementById('rec-pass-confirm').value = 'short';
  await win.doSetNewPassword();
  results.submitInvalidPassword = snapshot(win);
  win.__calls.length = 0;

  // Submit: valid password but mismatched confirm.
  win.document.getElementById('rec-pass').value = 'goodpass1';
  win.document.getElementById('rec-pass-confirm').value = 'goodpass2';
  await win.doSetNewPassword();
  results.submitMismatch = snapshot(win);
  win.__calls.length = 0;

  // Submit: success.
  win.document.getElementById('rec-pass-confirm').value = 'goodpass1';
  await win.doSetNewPassword();
  results.submitSuccess = snapshot(win);
  win.__calls.length = 0;

  return results;
}

async function runNoClientCase(win) {
  win.showRecoveryScreen();
  await new Promise(r => setTimeout(r, 10));
  win.document.getElementById('rec-pass').value = 'goodpass1';
  win.document.getElementById('rec-pass-confirm').value = 'goodpass1';
  await win.doSetNewPassword();
  return snapshot(win);
}

async function runUpdateFailCase(win, withMessage) {
  win.showRecoveryScreen();
  await new Promise(r => setTimeout(r, 10));
  win.document.getElementById('rec-pass').value = 'goodpass1';
  win.document.getElementById('rec-pass-confirm').value = 'goodpass1';
  await win.doSetNewPassword();
  return snapshot(win);
}

async function runSignOutThrowsCase(win) {
  win.showRecoveryScreen();
  await new Promise(r => setTimeout(r, 10));
  win.document.getElementById('rec-pass').value = 'goodpass1';
  win.document.getElementById('rec-pass-confirm').value = 'goodpass1';
  await win.doSetNewPassword();
  return snapshot(win);
}

async function runIIFECase(win, opts) {
  const results = {};
  results.callsAtLoad = win.__calls.slice();
  if (!opts.noDBService && !opts.noClient) {
    win.__fireAuthEvent('SOME_OTHER_EVENT');
    await new Promise(r => setTimeout(r, 10));
    results.afterOtherEvent = snapshot(win);
    win.__calls.length = 0;

    win.__fireAuthEvent('PASSWORD_RECOVERY');
    await new Promise(r => setTimeout(r, 60));
    results.afterRecoveryEvent = snapshot(win);
  }
  return results;
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'recovery.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'recovery.bridge.js'), 'utf8');

  // 1. Main sequence (DBService available throughout).
  {
    const winO = makeWindow();
    winO.eval(originalSrc);
    assert.strictEqual(typeof winO.showRecoveryScreen, 'function');
    const rO = await runMainSequence(winO);

    const winB = makeWindow();
    winB.eval(bridgeSrc);
    assert.strictEqual(typeof winB.showRecoveryScreen, 'function');
    const rB = await runMainSequence(winB);

    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'main sequence mismatch');
  }

  // 2. No DBService at all.
  {
    const winO = makeWindow({ noDBService: true });
    winO.eval(originalSrc);
    const rO = await runNoClientCase(winO);
    const winB = makeWindow({ noDBService: true });
    winB.eval(bridgeSrc);
    const rB = await runNoClientCase(winB);
    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'no-DBService mismatch');
  }

  // 3. DBService present but getAuthClient() returns null.
  {
    const winO = makeWindow({ noClient: true });
    winO.eval(originalSrc);
    const rO = await runNoClientCase(winO);
    const winB = makeWindow({ noClient: true });
    winB.eval(bridgeSrc);
    const rB = await runNoClientCase(winB);
    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'no-client mismatch');
  }

  // 4. updateUser fails with a message.
  {
    const winO = makeWindow({ updateUserFailsWithMessage: true });
    winO.eval(originalSrc);
    const rO = await runUpdateFailCase(winO);
    const winB = makeWindow({ updateUserFailsWithMessage: true });
    winB.eval(bridgeSrc);
    const rB = await runUpdateFailCase(winB);
    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'update-fail-with-message mismatch');
  }

  // 5. updateUser fails with no message (default fallback text).
  {
    const winO = makeWindow({ updateUserFailsNoMessage: true });
    winO.eval(originalSrc);
    const rO = await runUpdateFailCase(winO);
    const winB = makeWindow({ updateUserFailsNoMessage: true });
    winB.eval(bridgeSrc);
    const rB = await runUpdateFailCase(winB);
    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'update-fail-no-message mismatch');
  }

  // 6. signOut throws after a successful updateUser — swallowed, still proceeds.
  {
    const winO = makeWindow({ signOutThrows: true });
    winO.eval(originalSrc);
    const rO = await runSignOutThrowsCase(winO);
    const winB = makeWindow({ signOutThrows: true });
    winB.eval(bridgeSrc);
    const rB = await runSignOutThrowsCase(winB);
    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'signOut-throws mismatch');
  }

  // 7. The bottom-of-file IIFE: no DBService (no-op), and a real
  // PASSWORD_RECOVERY event firing showRecoveryScreen().
  {
    const winO = makeWindow({ noDBService: true });
    winO.eval(originalSrc);
    const rO = await runIIFECase(winO, { noDBService: true });
    const winB = makeWindow({ noDBService: true });
    winB.eval(bridgeSrc);
    const rB = await runIIFECase(winB, { noDBService: true });
    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'IIFE no-DBService mismatch');
  }
  {
    const winO = makeWindow();
    winO.eval(originalSrc);
    const rO = await runIIFECase(winO, {});
    const winB = makeWindow();
    winB.eval(bridgeSrc);
    const rB = await runIIFECase(winB, {});
    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'IIFE with-event mismatch');
  }

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('recovery.js: showRecoveryScreen (incl. one-time style injection + deferred focus),');
  console.log('recCheckValidation (empty/weak/good password, mismatch/match confirm), doSetNewPassword');
  console.log('(validation errors, no-DBService, no-client, updateUser failure with/without a message,');
  console.log('success incl. signOut + signOut-throws-but-swallowed), and the bottom IIFE (no-op with no');
  console.log('DBService, registers without firing, and a real PASSWORD_RECOVERY event triggering the');
  console.log('screen) all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
