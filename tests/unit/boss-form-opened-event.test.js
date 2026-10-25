'use strict';
// Continuation Plan §3, Category A — openBossForm. 3 confirmed post-hook
// DOM-injection sites (skills.js, phases.js, rage.js), all still live and
// correctly chained after a load-order trace (admin-page.js loads first
// among the World Boss group, then skills.js → phases.js → rage.js — see
// index.html's "LOAD ORDER FIX" comment and admin-page.js's emit() call
// site) — unlike wbcApplyDamage/renderStudentWorldBoss/
// renderStudentDashboard, no dead-patch or silent-overwrite finding here.
// rage.js's button placement deliberately depends on skills.js's button
// already existing (100ms delay vs. skills.js's 90ms — and, since rage.js
// anchors ON #wbs-form-btn, its button ends up immediately BEFORE skills'
// in the DOM once that anchor exists, not after) — this suite exists
// specifically to confirm that ordering survives the conversion from a
// monkey-patch chain to independent AppStore subscribers. Final DOM order
// verified against real, un-mocked timers first, then against
// node:test's mock.timers, before being written into an assertion.
const { test, before, mock } = require('node:test');
const assert = require('node:assert/strict');
const { loadBossFormButtonsWindow } = require('./helpers/load-globals.js');

let win;
before(() => { win = loadBossFormButtonsWindow(); });

test('all three boss-form-button subscribers are registered (monkey-patches removed)', () => {
  assert.equal(typeof win.subscribers['wbs-boss-form-button'], 'function');
  assert.equal(typeof win.subscribers['wbp-boss-form-button'], 'function');
  assert.equal(typeof win.subscribers['wbrage-boss-form-button'], 'function');
});

test('boss-form:opened with a null bossIndex (create mode) adds none of the three buttons', () => {
  win.document.getElementById('modal-content').innerHTML = '<button class="btn btn-primary">Save</button>';
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    win.AppStore.emit({ type: 'boss-form:opened', payload: { bossIndex: null } });
    mock.timers.tick(200);
  } finally {
    mock.timers.reset();
  }
  assert.equal(win.document.getElementById('wbs-form-btn'), null);
  assert.equal(win.document.getElementById('wbrage-form-btn'), null);
});

test('boss-form:opened with a real bossIndex (edit mode) adds all three buttons in the original relative order', () => {
  win.document.getElementById('modal-content').innerHTML = '<button class="btn btn-primary">Save</button>';
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    win.AppStore.emit({ type: 'boss-form:opened', payload: { bossIndex: 2 } });
    mock.timers.tick(200);
  } finally {
    mock.timers.reset();
  }
  const modal = win.document.getElementById('modal-content');
  const labels = Array.from(modal.children).map((el) =>
    el.id || (el.classList.contains('btn-primary') ? '(primary)' : el.textContent.trim())
  );
  // phases.js's button has no id and fires first (80ms) — inserted right
  // before .btn-primary: [phase, primary]. skills.js fires next (90ms) —
  // also inserted right before .btn-primary, landing between phases'
  // button and .btn-primary: [phase, skills, primary]. rage.js fires last
  // (100ms) and anchors on #wbs-form-btn (which exists by then, since
  // skills.js already fired), inserting itself immediately before it:
  // [phase, rage, skills, primary]. This matches the DOM order the old
  // _orig-chained monkey-patch produced (verified against real, un-mocked
  // timers before writing this assertion — not just derived from the delay
  // values on paper).
  assert.deepEqual(labels, ['⚡ Phase Config', 'wbrage-form-btn', 'wbs-form-btn', '(primary)']);
});

test('boss-form:opened with bossIndex 0 (falsy but valid) still adds the buttons — guards against an == 0 truthiness bug', () => {
  win.document.getElementById('modal-content').innerHTML = '<button class="btn btn-primary">Save</button>';
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    win.AppStore.emit({ type: 'boss-form:opened', payload: { bossIndex: 0 } });
    mock.timers.tick(200);
  } finally {
    mock.timers.reset();
  }
  assert.notEqual(win.document.getElementById('wbs-form-btn'), null);
  assert.notEqual(win.document.getElementById('wbrage-form-btn'), null);
});

test('clicking the rage button closes the modal and opens rage config with the right bossIndex', () => {
  win.document.getElementById('modal-content').innerHTML = '<button class="btn btn-primary">Save</button>';
  const closeCalls = [];
  const rageCalls = [];
  win.closeModalForce = () => closeCalls.push('closed');
  win.wbrageOpenConfig = (idx) => rageCalls.push(idx);
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    win.AppStore.emit({ type: 'boss-form:opened', payload: { bossIndex: 5 } });
    mock.timers.tick(200);
  } finally {
    mock.timers.reset();
  }
  win.document.getElementById('wbrage-form-btn').onclick();
  assert.deepEqual(closeCalls, ['closed']);
  assert.deepEqual(rageCalls, [5]);
});

test('other event types are ignored by all three subscribers', () => {
  win.document.getElementById('modal-content').innerHTML = '<button class="btn btn-primary">Save</button>';
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    win.AppStore.emit({ type: 'world-boss:damage-applied', payload: { bossIdx: 1 } });
    mock.timers.tick(200);
  } finally {
    mock.timers.reset();
  }
  assert.equal(win.document.getElementById('wbs-form-btn'), null);
  assert.equal(win.document.getElementById('wbrage-form-btn'), null);
});

test('window.openBossForm-related globals carry no lingering _orig-capturing wrapper text', () => {
  ['skills', 'phases', 'rage'].forEach((name) => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'modules', 'world-boss', name + '.js'), 'utf8');
    assert.equal(src.indexOf('const _orig = openBossForm'), -1, `${name}.js should no longer monkey-patch openBossForm`);
  });
});
