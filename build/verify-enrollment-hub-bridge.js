// Phase 7, Stream B — equivalence check for modules/enrollment/enrollment-hub.js.
// EnrollmentService's own equivalence is already independently proven, so
// the ORIGINAL window evals the real, untouched enrollment-service.js
// first, driven by a shared fake DBService.rpc + fake AppStore. setInterval/
// setTimeout/clearInterval/clearTimeout are all stubbed to capture
// callbacks (keyed by id) instead of waiting real wall-clock time, so the
// focus-refocus interval, the scan-finalize debounce, the kiosk 30s idle
// countdown, and the kiosk success auto-reset can all be driven directly.
// The RFID/NFC hardware scan itself is simulated via REAL keydown events
// dispatched at the hidden capture input — that's a genuine
// addEventListener callback (not an inline HTML attribute), so it's
// unaffected by the jsdom inline-handler limitation documented in
// MEMORY.md and can be tested faithfully.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const STARTER_HTML = `<!doctype html><html><body>
  <div id="a-enrollment"></div>
  <div id="modal-root"></div>
</body></html>`;

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously' });
  const win = dom.window;
  const calls = [];
  win.__calls = calls;

  win._esc = s => String(s == null ? '' : s);
  win.toast = function (msg, color) { calls.push({ name: 'toast', msg, color }); };
  win.showModal = function (html, size) {
    calls.push({ name: 'showModal', size });
    win.document.getElementById('modal-root').innerHTML = html;
  };
  win.closeModalForce = function () { calls.push({ name: 'closeModalForce' }); win.document.getElementById('modal-root').innerHTML = ''; };
  win.currentUser = { id: 'admin1', email: 'admin@example.com' };
  win.navTo = function (id) { calls.push({ name: 'navTo', id }); };

  let cardIdCounter = 0;
  win.DBService = {
    getAuthClient() {
      return {
        auth: {
          async signInWithPassword({ email, password }) {
            calls.push({ name: 'signInWithPassword', email });
            if (password === 'correct-admin-pw') return { error: null };
            return { error: { message: 'Invalid login credentials' } };
          },
        },
      };
    },
    async rpc(name, params) {
      calls.push({ name, params: JSON.parse(JSON.stringify(params || {})) });
      if (name === 'enroll_rfid_card') {
        if (params.p_tag_id === 'TAKEN') return { data: null, error: { message: 'raised exception: CARD_TAKEN:Other Student' } };
        return { data: { id: 'card-' + (++cardIdCounter), tag_id: params.p_tag_id, student_id: params.p_student_id, is_active: true, assigned_at: 't', revoked_at: null }, error: null };
      }
      if (name === 'verify_student_password') {
        return { data: params.p_password === 'correct-student-pw', error: null };
      }
      throw new Error('unexpected rpc: ' + name);
    },
  };

  let state = {
    rfidCards: [],
    students: [
      { id: 's1', name: 'Alice', classId: 'sec-a', color: '#8b5cf6', init: 'A' },
      { id: 's2', name: 'Bob', classId: 'sec-a', color: '#4edea3', init: 'B' },
      { id: 's3', name: 'Carol', classId: 'sec-b', color: '#ff6b6b', init: 'C' },
    ],
    classSections: [
      { id: 'sec-a', gradeLevel: '10', sectionName: 'Rizal', archived: false },
      { id: 'sec-b', gradeLevel: '9', sectionName: 'Bonifacio', archived: false },
    ],
  };
  win.AppStore = {
    getState() { return JSON.parse(JSON.stringify(state)); },
    updateState(fn, event) {
      const draft = JSON.parse(JSON.stringify(state));
      fn(draft);
      state = draft;
      calls.push({ name: 'AppStore.updateState', event });
    },
    getStudent(id) {
      const s = state.students.find(x => x.id === id);
      return s ? JSON.parse(JSON.stringify(s)) : null;
    },
    subscribe(key, fn) { calls.push({ name: 'AppStore.subscribe', key }); win.__subscribed = fn; },
    unsubscribe(key) { calls.push({ name: 'AppStore.unsubscribe', key }); win.__subscribed = null; },
  };
  win.__getFakeState = () => {
    const s = JSON.parse(JSON.stringify(state));
    // revokedAt is a real `new Date().toISOString()` timestamp, not
    // derived from any RPC response — normalize it out (both windows
    // still had to actually revoke the old card, just at slightly
    // different real wall-clock instants).
    if (s.rfidCards) s.rfidCards.forEach(c => { if (c.revokedAt) c.revokedAt = 'NORMALIZED'; });
    return s;
  };

  // Timer capture: real setInterval/setTimeout are replaced so ticks can
  // be driven directly and deterministically.
  let timerCounter = 0;
  win.__timers = {};
  win.setInterval = function (fn, ms) {
    timerCounter++;
    const id = 'int' + timerCounter;
    win.__timers[id] = { fn, ms, kind: 'interval' };
    calls.push({ name: 'setInterval', ms, id });
    return id;
  };
  win.setTimeout = function (fn, ms) {
    timerCounter++;
    const id = 'to' + timerCounter;
    win.__timers[id] = { fn, ms, kind: 'timeout' };
    calls.push({ name: 'setTimeout', ms, id });
    return id;
  };
  win.clearInterval = function (id) { calls.push({ name: 'clearInterval', id }); delete win.__timers[id]; };
  win.clearTimeout = function (id) { calls.push({ name: 'clearTimeout', id }); delete win.__timers[id]; };
  win.__latestTimerOfKind = (kind) => {
    const ids = Object.keys(win.__timers).filter(id => win.__timers[id].kind === kind);
    return ids.length ? win.__timers[ids[ids.length - 1]] : null;
  };

  return win;
}

function snapshot(win) {
  return { html: win.document.getElementById('a-enrollment').innerHTML, modalHtml: win.document.getElementById('modal-root').innerHTML, calls: win.__calls };
}

function scanTag(win, tagId) {
  const input = win.document.getElementById('enroll-capture-input');
  for (const ch of tagId) {
    const ev = new win.KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
  }
  const enterEv = new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  input.dispatchEvent(enterEv);
}

async function runSequence(win) {
  const results = {};

  win.renderEnrollmentHub();
  results.afterMount = snapshot(win);
  win.__calls.length = 0;

  // Teacher grid default render, then start/cancel a target.
  win._enrollStartTarget('s1');
  results.afterStartTarget = snapshot(win);
  win.__calls.length = 0;

  win._enrollCancelTarget();
  results.afterCancelTarget = snapshot(win);
  win.__calls.length = 0;

  // Scan a card onto a targeted student — happy path.
  win._enrollStartTarget('s1');
  win.__calls.length = 0;
  scanTag(win, 'TAG001');
  await new Promise(r => setImmediate(r));
  results.afterHappyScan = { state: win.__getFakeState(), snapshot: snapshot(win) };
  win.__calls.length = 0;

  // Scan a conflicting card, decline via re-target (cancel), then force-reassign.
  win._enrollStartTarget('s2');
  win.__calls.length = 0;
  scanTag(win, 'TAKEN');
  await new Promise(r => setImmediate(r));
  results.scanConflictModal = snapshot(win);
  win.__calls.length = 0;

  await win._enrollConfirmForce('s2', 'TAKEN', false);
  results.forceReassignOk = { state: win.__getFakeState(), snapshot: snapshot(win) };
  win.__calls.length = 0;

  // Focus-refocus interval tick — should re-focus the capture input without error.
  const focusTimer = win.__latestTimerOfKind('interval');
  focusTimer.fn();
  results.afterFocusTick = { activeElementId: win.document.activeElement && win.document.activeElement.id };
  win.__calls.length = 0;

  // ── Kiosk mode ───────────────────────────────────────────────────────
  win._enrollSetMode('kiosk');
  results.kioskSearchStep = snapshot(win);
  win.__calls.length = 0;

  win._kioskOnSearchInput('ali');
  results.kioskSearchResults = snapshot(win);
  win.__calls.length = 0;

  win._kioskSelectStudent('s1');
  results.kioskPasswordStep = snapshot(win);
  win.__calls.length = 0;

  // Wrong password twice, then right password.
  win.document.getElementById('enroll-kiosk-password-input').value = 'wrong';
  await win._kioskSubmitPassword();
  results.kioskPasswordWrong1 = snapshot(win);
  win.__calls.length = 0;

  win.document.getElementById('enroll-kiosk-password-input').value = 'wrong2';
  await win._kioskSubmitPassword();
  results.kioskPasswordWrong2 = snapshot(win);
  win.__calls.length = 0;

  win.document.getElementById('enroll-kiosk-password-input').value = 'correct-student-pw';
  await win._kioskSubmitPassword();
  results.kioskPasswordCorrect = snapshot(win);
  win.__calls.length = 0;

  // Tap step: scan a card, get success, then auto-reset via the captured timeout.
  scanTag(win, 'KIOSKTAG1');
  await new Promise(r => setImmediate(r));
  results.kioskSuccessStep = { state: win.__getFakeState(), snapshot: snapshot(win) };
  win.__calls.length = 0;

  const successTimeout = win.__latestTimerOfKind('timeout');
  successTimeout.fn();
  results.kioskAfterAutoReset = snapshot(win);
  win.__calls.length = 0;

  // Idle countdown: select a student again, then run the idle tick 30 times.
  win._kioskSelectStudent('s2');
  win.__calls.length = 0;
  const idleTimer = win.__latestTimerOfKind('interval');
  for (let i = 0; i < 30; i++) idleTimer.fn();
  results.kioskAfterIdleTimeout = snapshot(win);
  win.__calls.length = 0;

  // Too-many-attempts path: select again, submit 3 wrong passwords.
  win._kioskSelectStudent('s2');
  win.__calls.length = 0;
  for (let i = 0; i < 3; i++) {
    win.document.getElementById('enroll-kiosk-password-input').value = 'still-wrong';
    await win._kioskSubmitPassword();
  }
  results.kioskTooManyAttempts = snapshot(win);
  win.__calls.length = 0;

  win._enrollSetMode('teacher');
  win.__calls.length = 0;

  // ── Lock Mode ────────────────────────────────────────────────────────
  results.hasPersistedLockBeforeLock = win._enrollHasPersistedLock();

  win._enrollSetMode('kiosk');
  win.__calls.length = 0;
  win._enrollLockKiosk();
  results.afterLock = { state: win.__getFakeState(), snapshot: snapshot(win) };
  results.hasPersistedLockAfterLock = win._enrollHasPersistedLock();
  win.__calls.length = 0;

  // Navigation while locked is intercepted.
  win.navTo('a-dashboard');
  results.navBlockedWhileLocked = snapshot(win);
  win.__calls.length = 0;

  // Navigating to a-enrollment itself while locked still goes through.
  win.navTo('a-enrollment');
  results.navToSelfAllowedWhileLocked = snapshot(win);
  win.__calls.length = 0;

  // Wrong unlock password.
  win._enrollShowUnlockPrompt();
  win.document.getElementById('enroll-admin-unlock-input').value = 'wrong-admin-pw';
  await win._enrollSubmitUnlock();
  results.unlockWrongPassword = snapshot(win);
  win.__calls.length = 0;

  // Correct unlock password.
  win.document.getElementById('enroll-admin-unlock-input').value = 'correct-admin-pw';
  await win._enrollSubmitUnlock();
  results.unlockCorrectPassword = { state: win.__getFakeState(), snapshot: snapshot(win) };
  results.hasPersistedLockAfterUnlock = win._enrollHasPersistedLock();
  win.__calls.length = 0;

  // Navigation after unlock is no longer intercepted.
  win.navTo('a-dashboard');
  results.navAllowedAfterUnlock = snapshot(win);
  win.__calls.length = 0;

  // Restore-on-boot path (simulating a refresh while locked).
  win._enrollLockKiosk();
  win.__calls.length = 0;
  win._enrollRestoreLockedKioskOnBoot();
  results.restoreOnBoot = { state: win.__getFakeState(), snapshot: snapshot(win) };
  win.__calls.length = 0;

  // Unmount.
  win.unmountEnrollmentHub();
  results.afterUnmount = { calls: win.__calls, timersRemaining: Object.keys(win.__timers).length };

  return results;
}

async function main() {
  const enrollmentServiceSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'enrollment', 'enrollment-service.js'), 'utf8');
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'enrollment', 'enrollment-hub.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'enrollment-hub.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(enrollmentServiceSrc);
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.renderEnrollmentHub, 'function');
  const resultOriginal = await runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.renderEnrollmentHub, 'function');
  const resultBridge = await runSequence(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original output at every step');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('enrollment-hub.js: mount, teacher-mode target start/cancel, a real hardware-scan happy');
  console.log('path (via real keydown events, not inline handlers), a scan conflict + force-reassign, the');
  console.log('focus-refocus interval tick, kiosk mode (search/password incl. wrong-then-right/tap/scan/');
  console.log('success/auto-reset timeout/idle-countdown-timeout/too-many-attempts), and Lock Mode (lock,');
  console.log('navTo interception + self-navigation exemption, wrong/correct unlock, persisted-lock flag,');
  console.log('restore-on-boot, and unmount cleanup) all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
