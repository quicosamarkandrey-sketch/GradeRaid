'use strict';
// Continuation Plan §3, Category A — renderStudentDashboard was the single
// real patch site left on the list before navTo/achCheckAndAward-as-
// title-hook. Load-order traced: titles/titles_sidebar_refresh.js
// (index.html ~817) loads BEFORE the inline <script> block that defines
// the base renderStudentDashboard() (index.html ~900) — so the old
// `_orig = window.renderStudentDashboard` patch captured `undefined`, and
// the base function's own (non-chaining) declaration silently discarded
// the patch the moment it ran. Same recurring load-order-discards-earlier-
// patch bug already found 3 times (wbcApplyDamage, renderStudentWorldBoss
// ×2) — this is the 4th confirmed instance. Converted to a subscriber on
// the 'dashboard:student-rendered' event the base function now emits.
//
// NOTE on coverage: this file tests the subscriber side
// (titles_sidebar_refresh.js) directly, since it loads safely standalone.
// The base renderStudentDashboard() itself lives inline in index.html
// (~2700-line shared <script> block, heavy DB/canvas/particle-FX
// dependencies including an ambient-backdrop rAF loop) — loading it
// standalone in jsdom was assessed as unsafe to do reliably (same category
// as shop_pos_terminal.js's documented case), so per the plan's own §2
// step 6 allowance, that side is verified by `node --check` on the
// extracted inline script (clean) plus direct inspection confirming the
// single `AppStore.emit({ type: 'dashboard:student-rendered', payload: {} })`
// call at the end of the function body, rather than a jsdom execution test.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadTitlesSidebarRefreshWindow } = require('./helpers/load-globals.js');

let win;
before(() => { win = loadTitlesSidebarRefreshWindow(); });

test('the titles-sidebar-dashboard-rendered subscriber is registered (monkey-patch removed)', () => {
  assert.equal(typeof win.subscribers['titles-sidebar-dashboard-rendered'], 'function');
});

test('window.renderStudentDashboard is untouched by this file (no lingering _orig-capturing wrapper)', () => {
  // This file no longer assigns window.renderStudentDashboard at all —
  // confirms the patch was fully removed, not just renamed.
  assert.equal(win.renderStudentDashboard, undefined);
});

test('a dashboard:student-rendered event triggers tsRefreshProfileTitle, which inserts the equipped-title badge', (t, done) => {
  win._eqTestState.equippedTitles = { s1: 't1' };
  win._eqTestState.titles = [{ id: 't1', name: 'Quiz Champion', active: true }];

  win.subscribers['titles-sidebar-dashboard-rendered'](null, { type: 'dashboard:student-rendered', payload: {} });

  // tsRefreshProfileTitle runs on a setTimeout(80) inside the subscriber,
  // matching the original patch's own 80ms delay exactly.
  setTimeout(() => {
    const badge = win.document.getElementById('ts-dash-title');
    assert.ok(badge, 'expected #ts-dash-title to be inserted after the event fires');
    assert.match(badge.innerHTML, /Quiz Champion/);
    done();
  }, 90);
});

test('other event types are ignored by the dashboard-rendered subscriber', (t, done) => {
  const badge = win.document.getElementById('ts-dash-title');
  if (badge) badge.remove();
  win._eqTestState.equippedTitles = { s1: 't1' };
  win._eqTestState.titles = [{ id: 't1', name: 'Quiz Champion', active: true }];

  win.subscribers['titles-sidebar-dashboard-rendered'](null, { type: 'quiz:finished', payload: {} });

  setTimeout(() => {
    assert.equal(win.document.getElementById('ts-dash-title'), null);
    done();
  }, 90);
});
