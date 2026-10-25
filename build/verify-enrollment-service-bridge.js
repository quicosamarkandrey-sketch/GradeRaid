// Phase 7, Stream B — equivalence check for modules/enrollment/enrollment-service.js.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html></html>', { runScripts: 'dangerously' });
  const win = dom.window;
  const calls = [];
  win.__dbCalls = calls;
  if (!opts.noDBService) {
    win.DBService = {
      async rpc(name, params) {
        calls.push({ name, params: JSON.parse(JSON.stringify(params || {})) });
        if (name === 'enroll_rfid_card') {
          if (params.p_tag_id === 'TAKEN') {
            return { data: null, error: { message: 'raised exception: CARD_TAKEN:Jane Doe' } };
          }
          if (params.p_tag_id === 'TAKEN-NO-NAME') {
            return { data: null, error: { message: 'CARD_TAKEN:' } };
          }
          if (params.p_tag_id === 'HARDFAIL') {
            return { data: null, error: { message: 'boom: db exploded' } };
          }
          return {
            data: { id: 'card-1', tag_id: params.p_tag_id, student_id: params.p_student_id, is_active: true, assigned_at: 't1', revoked_at: null },
            error: null,
          };
        }
        if (name === 'verify_student_password') {
          if (params.p_student_id === 'rpcfail') return { data: null, error: { message: 'boom: verify failed' } };
          return { data: params.p_password === 'correct', error: null };
        }
        throw new Error('unexpected rpc: ' + name);
      },
    };
  }
  let state = { rfidCards: [{ id: 'card-old', tagId: 'OLDTAG', studentId: 's1', isActive: true, assignedAt: 't0', revokedAt: null }] };
  win.AppStore = {
    updateState(fn, event) {
      const draft = JSON.parse(JSON.stringify(state));
      fn(draft);
      state = draft;
      win.__lastEvent = event || null;
    },
    getState() {
      return JSON.parse(JSON.stringify(state));
    },
  };
  win.__getFakeState = () => JSON.parse(JSON.stringify(state));
  return win;
}

async function runSequence(win) {
  const results = {};

  results.assignMissingStudent = await win.EnrollmentService.assignCardToStudent('', 'TAG1');
  results.assignMissingTag = await win.EnrollmentService.assignCardToStudent('s1', '');

  results.assignOk = await win.EnrollmentService.assignCardToStudent('s1', 'NEWTAG');
  results.assignConflict = await win.EnrollmentService.assignCardToStudent('s2', 'TAKEN');
  results.assignConflictNoName = await win.EnrollmentService.assignCardToStudent('s2', 'TAKEN-NO-NAME');
  results.assignForceAfterConflict = await win.EnrollmentService.assignCardToStudent('s2', 'TAKEN', { force: true });
  results.assignHardFail = await win.EnrollmentService.assignCardToStudent('s3', 'HARDFAIL');

  results.getActiveForStudentFound = win.EnrollmentService.getActiveCardForStudent('s1');
  results.getActiveForStudentMissing = win.EnrollmentService.getActiveCardForStudent('nope');
  results.getActiveWithPassedState = win.EnrollmentService.getActiveCardForStudent('s1', win.AppStore.getState());

  results.verifyMissingPassword = await win.EnrollmentService.verifyStudentPassword('s1', '');
  results.verifyMissingStudent = await win.EnrollmentService.verifyStudentPassword('', 'pw');
  results.verifyCorrect = await win.EnrollmentService.verifyStudentPassword('s1', 'correct');
  results.verifyWrong = await win.EnrollmentService.verifyStudentPassword('s1', 'wrong');
  results.verifyRpcFail = await win.EnrollmentService.verifyStudentPassword('rpcfail', 'pw');

  // revokedAt on the deactivated old card is a real `new Date().toISOString()`
  // call, not part of the RPC response — normalize it out (both windows
  // still had to actually SET it, just at slightly different real wall-clock
  // instants), so this compares "did the revoke happen" not "at the exact
  // same millisecond".
  const finalState = win.__getFakeState();
  finalState.rfidCards.forEach(c => { if (c.revokedAt) c.revokedAt = 'NORMALIZED'; });
  results.finalState = finalState;
  results.dbCalls = win.__dbCalls;
  return results;
}

async function runNoDBServiceCase(win) {
  // typeof DBService === 'undefined' branch — must not throw a ReferenceError.
  return {
    assign: await win.EnrollmentService.assignCardToStudent('s1', 'TAG'),
    verify: await win.EnrollmentService.verifyStudentPassword('s1', 'pw'),
  };
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'enrollment', 'enrollment-service.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'enrollment-service.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.EnrollmentService, 'object');
  const resultOriginal = await runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.EnrollmentService, 'object');
  const resultBridge = await runSequence(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original output');

  // No-DBService branch, checked separately (this codebase's DBService is
  // always bound to window as a bare global — this exercises the file's own
  // `typeof DBService === 'undefined'` guard when that global is absent).
  const winOriginalNoDB = makeWindow({ noDBService: true });
  winOriginalNoDB.eval(originalSrc);
  const noDBOriginal = await runNoDBServiceCase(winOriginalNoDB);

  const winBridgeNoDB = makeWindow({ noDBService: true });
  winBridgeNoDB.eval(bridgeSrc);
  const noDBBridge = await runNoDBServiceCase(winBridgeNoDB);

  assert.strictEqual(JSON.stringify(noDBBridge), JSON.stringify(noDBOriginal), 'no-DBService branch must match too');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('enrollment-service.js: assignCardToStudent (incl. CARD_TAKEN conflict parsing, force');
  console.log('retry, hard RPC failure, and no-DBService guard), getActiveCardForStudent, and');
  console.log('verifyStudentPassword all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
