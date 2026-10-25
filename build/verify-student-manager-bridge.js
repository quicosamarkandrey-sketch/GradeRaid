// Phase 7, Stream B — equivalence check for modules/admin/student-manager.js.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const STARTER_HTML = `<!doctype html><html><body>
  <div id="modal-root"></div>
</body></html>`;

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously' });
  const win = dom.window;
  const calls = [];
  win.__calls = calls;

  win._esc = s => String(s == null ? '' : s);
  win.DB = { students: [{ id: 's1', name: 'Alice' }, { id: 's2', name: 'Bob' }] };
  win.showModal = function (html, size) {
    calls.push({ name: 'showModal', size });
    win.document.getElementById('modal-root').innerHTML = html;
  };
  win.closeModalForce = function () { calls.push({ name: 'closeModalForce' }); };
  win.toast = function (msg, color) { calls.push({ name: 'toast', msg, color }); };
  win.uid = (() => { let n = 0; return () => 'uid' + (++n); })();
  win.checkLevelUp = function (s) { calls.push({ name: 'checkLevelUp', id: s.id }); if (s.xp >= 100) s.tier = 'silver'; };
  win.syncStudentStatsToServer = function (id, xp, coins) { calls.push({ name: 'syncStudentStatsToServer', id, xp, coins }); };
  win.renderAdminDashboard = function () { calls.push({ name: 'renderAdminDashboard' }); };
  win.currentRole = 'admin';
  win.currentUser = { id: 'admin1' };

  let state = { students: [{ id: 's1', name: 'Alice', xp: 40, tier: 'bronze' }, { id: 's2', name: 'Bob', xp: 90, tier: 'bronze' }], pointLog: [] };
  win.AppStore = {
    getSlice(fn) { return fn(JSON.parse(JSON.stringify(state))); },
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
  };
  win.__getFakeState = () => JSON.parse(JSON.stringify(state));

  return win;
}

function snapshot(win) {
  const state = win.__getFakeState();
  if (Array.isArray(state.pointLog)) {
    state.pointLog.forEach(p => { p.createdAt = 'NORMALIZED'; p.when = 'NORMALIZED'; });
  }
  return {
    modalHtml: win.document.getElementById('modal-root').innerHTML,
    calls: win.__calls,
    state,
    currentUser: win.currentUser,
  };
}

function runSequence(win) {
  const results = {};

  win.openAwardPoints();
  results.afterOpen = snapshot(win);
  win.__calls.length = 0;

  // Zero-points validation error.
  win.document.getElementById('aw-student').value = 's1';
  win.document.getElementById('aw-cat').value = 'Recitation';
  win.document.getElementById('aw-pts').value = '0';
  win.document.getElementById('aw-note').value = '';
  win.doAwardPoints();
  results.zeroPointsError = snapshot(win);
  win.__calls.length = 0;

  // Award to a single student.
  win.openAwardPoints();
  win.document.getElementById('aw-student').value = 's1';
  win.document.getElementById('aw-cat').value = 'Attendance';
  win.document.getElementById('aw-pts').value = '15';
  win.document.getElementById('aw-note').value = 'on time';
  win.doAwardPoints();
  results.awardSingle = snapshot(win);
  win.__calls.length = 0;

  // Award negative points, floored at 0.
  win.openAwardPoints();
  win.document.getElementById('aw-student').value = 's1';
  win.document.getElementById('aw-cat').value = 'Custom';
  win.document.getElementById('aw-pts').value = '-999';
  win.document.getElementById('aw-note').value = '';
  win.doAwardPoints();
  results.awardNegativeFloor = snapshot(win);
  win.__calls.length = 0;

  // Award to entire class.
  win.openAwardPoints();
  win.document.getElementById('aw-student').value = 'all';
  win.document.getElementById('aw-cat').value = 'Quiz Performance';
  win.document.getElementById('aw-pts').value = '5';
  win.document.getElementById('aw-note').value = '';
  win.doAwardPoints();
  results.awardEntireClass = snapshot(win);
  win.__calls.length = 0;

  // currentRole === 'student' path — refreshes currentUser from AppStore.
  win.currentRole = 'student';
  win.currentUser = { id: 's1' };
  win.openAwardPoints();
  win.document.getElementById('aw-student').value = 's1';
  win.document.getElementById('aw-cat').value = 'Homework';
  win.document.getElementById('aw-pts').value = '3';
  win.document.getElementById('aw-note').value = '';
  win.doAwardPoints();
  results.awardAsStudentRole = snapshot(win);

  return results;
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'student-manager.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'student-manager.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.openAwardPoints, 'function');
  assert.strictEqual(typeof winOriginal.doAwardPoints, 'function');
  const resultOriginal = runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.openAwardPoints, 'function');
  assert.strictEqual(typeof winBridge.doAwardPoints, 'function');
  const resultBridge = runSequence(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original output');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('student-manager.js: openAwardPoints/doAwardPoints match across zero-points validation,');
  console.log('single-student award, negative-award floor-at-0, entire-class award, and the');
  console.log('currentRole==="student" currentUser-refresh branch.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
