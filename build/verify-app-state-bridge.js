// Phase 7 (Stream A) — equivalence check for app-state.js.
//
// ZERO real imports (see this file's own src header for the full
// reasoning on DB/currentUser/currentRole/selectedLoginRole/saveDB/
// getLevel all staying window-fallback) — a plain two-window eval
// (original classic script vs. bundled bridge) is sufficient, same
// shape as verify-button-loading-bridge.js.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html></html>', { runScripts: 'dangerously' });
  const win = dom.window;
  win.__saveDBCalls = 0;
  win.saveDB = () => { win.__saveDBCalls++; };
  win.getLevel = (xp) => Math.floor(xp / 1000);
  return win;
}

function runScenarios(win) {
  const results = {};

  // --- DB getter/setter ---
  win.DB = { existing: true };
  results.getDBInitial = win.getDB();
  win.setDB({ replaced: true });
  results.getDBAfterSet = win.getDB();
  results.dbWindowPropertyAfterSet = win.DB;
  results.saveDBCallsAfterSet = win.__saveDBCalls;

  // --- currentUser getter/setter ---
  win.currentUser = null;
  results.getCurrentUserInitial = win.getCurrentUser();
  win.setCurrentUser({ id: 's1', name: 'Ana' });
  results.getCurrentUserAfterSet = win.getCurrentUser();
  win.setCurrentUser(null);
  results.getCurrentUserAfterClear = win.getCurrentUser();

  // --- currentRole getter/setter ---
  win.currentRole = null;
  results.getCurrentRoleInitial = win.getCurrentRole();
  win.setCurrentRole('teacher');
  results.getCurrentRoleAfterSet = win.getCurrentRole();

  // --- selectedLoginRole getter/setter ---
  win.selectedLoginRole = 'student';
  results.getSelectedLoginRoleInitial = win.getSelectedLoginRole();
  win.setSelectedLoginRole('admin');
  results.getSelectedLoginRoleAfterSet = win.getSelectedLoginRole();

  // --- checkLevelUp: level-up case ---
  const studentLevelUp = { name: 'Ana Cruz', xp: 1500, level: 0 };
  results.checkLevelUpTrue = win.checkLevelUp(studentLevelUp);
  results.studentAfterLevelUp = studentLevelUp;

  // --- checkLevelUp: no level-up case ---
  const studentNoLevelUp = { name: 'Solo', xp: 1500, level: 1 };
  results.checkLevelUpFalse = win.checkLevelUp(studentNoLevelUp);
  results.studentAfterNoLevelUp = studentNoLevelUp;

  // --- checkLevelUp: exact boundary (xp puts level equal, not greater) ---
  const studentBoundary = { name: 'Boundary', xp: 2000, level: 2 };
  results.checkLevelUpBoundary = win.checkLevelUp(studentBoundary);
  results.studentAfterBoundary = studentBoundary;

  return results;
}

function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'app-state.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'app-state.bridge.js'), 'utf8');

  const winO = makeWindow();
  winO.eval(originalSrc);
  const resultOriginal = runScenarios(winO);

  const winB = makeWindow();
  winB.eval(bridgeSrc);
  const resultBridge = runScenarios(winB);

  assert.deepStrictEqual(resultBridge, resultOriginal, 'bridge output must exactly match original at every step');

  // Sanity checks against the original's real values.
  assert.deepStrictEqual(resultOriginal.getDBInitial, { existing: true }, 'sanity: getDB reads the current DB');
  assert.deepStrictEqual(resultOriginal.getDBAfterSet, { replaced: true }, 'sanity: setDB replaces the DB object');
  assert.deepStrictEqual(resultOriginal.dbWindowPropertyAfterSet, { replaced: true }, 'sanity: setDB actually mutates window.DB, not just an internal copy');
  assert.strictEqual(resultOriginal.saveDBCallsAfterSet, 1, 'sanity: setDB calls saveDB() exactly once');
  assert.strictEqual(resultOriginal.getCurrentUserInitial, null, 'sanity: getCurrentUser initial null');
  assert.deepStrictEqual(resultOriginal.getCurrentUserAfterSet, { id: 's1', name: 'Ana' }, 'sanity: setCurrentUser sets the user');
  assert.strictEqual(resultOriginal.getCurrentUserAfterClear, null, 'sanity: setCurrentUser(null) clears the user');
  assert.strictEqual(resultOriginal.getCurrentRoleAfterSet, 'teacher', 'sanity: setCurrentRole sets the role');
  assert.strictEqual(resultOriginal.getSelectedLoginRoleAfterSet, 'admin', 'sanity: setSelectedLoginRole sets the role');

  assert.strictEqual(resultOriginal.checkLevelUpTrue, true, 'sanity: checkLevelUp returns true on level-up');
  assert.strictEqual(resultOriginal.studentAfterLevelUp.level, 1, 'sanity: checkLevelUp mutates student.level in place');
  assert.strictEqual(resultOriginal.checkLevelUpFalse, false, 'sanity: checkLevelUp returns false when already at/above the computed level');
  assert.strictEqual(resultOriginal.studentAfterNoLevelUp.level, 1, 'sanity: checkLevelUp does not decrease level when newLevel is not greater');
  assert.strictEqual(resultOriginal.checkLevelUpBoundary, false, 'sanity: checkLevelUp returns false when newLevel equals (not exceeds) current level');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('app-state.js: all 4 getter/setter pairs (DB, currentUser, currentRole, selectedLoginRole),');
  console.log('setDB\'s saveDB() call, and checkLevelUp (level-up, no-level-up, and exact-boundary cases,');
  console.log('including its in-place mutation) all match.');
}

main();
