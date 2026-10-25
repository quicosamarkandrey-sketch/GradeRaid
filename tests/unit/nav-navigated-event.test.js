'use strict';
// Continuation Plan §3, Category A — navTo. The plan's own table listed 2
// sites (reward-presenter.js, titles/titles_sidebar_refresh.js); grepping
// every `window.navTo =` assignment before converting (methodology §2 step
// 1) surfaced a 3rd, unlisted site — modules/enrollment/enrollment-hub.js's
// kiosk-lock guard — same undercounted-inventory pattern already found on
// renderAnalytics/renderStudentMail. That 3rd site is deliberately NOT
// converted here: it can block navigation outright (Category C — "full
// replacement", not "post-hook"), which a reactive AppStore.subscribe()
// handler structurally can't express. See its own comment in
// enrollment-hub.js for the full reasoning; this suite only covers the two
// real Category A conversions.
const { test, before, mock } = require('node:test');
const assert = require('node:assert/strict');
const { loadNavAndBadgeRefreshWindow } = require('./helpers/load-globals.js');

let win;
before(() => { win = loadNavAndBadgeRefreshWindow(); });

test('both nav-refresh subscribers are registered (monkey-patches removed)', () => {
  assert.equal(typeof win.subscribers['reward-presenter-nav-badges'], 'function');
  assert.equal(typeof win.subscribers['titles-sidebar-nav-refresh'], 'function');
});

test('calling the real navTo() emits nav:navigated with the id', () => {
  win.navTo('x-test-id');
  const last = win.emitCalls[win.emitCalls.length - 1];
  assert.equal(last.type, 'nav:navigated');
  assert.equal(last.payload.id, 'x-test-id');
});

test('nav:navigated schedules both sidebar badge refreshes after 150ms for a student', () => {
  win.currentRole = 'student';
  win.mailUpdateSidebarBadgeCalls.length = 0;
  win.achUpdateSidebarBadgeCalls.length = 0;
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    win.subscribers['reward-presenter-nav-badges'](null, { type: 'nav:navigated', payload: { id: 'x-test-id' } });
    assert.equal(win.mailUpdateSidebarBadgeCalls.length, 0, 'should not fire before the delay elapses');
    mock.timers.tick(149);
    assert.equal(win.mailUpdateSidebarBadgeCalls.length, 0);
    mock.timers.tick(1);
    assert.equal(win.mailUpdateSidebarBadgeCalls.length, 1);
    assert.equal(win.achUpdateSidebarBadgeCalls.length, 1);
  } finally {
    mock.timers.reset();
  }
});

test('nav:navigated does nothing for the badge-refresh subscriber when not a student', () => {
  win.currentRole = 'admin';
  win.mailUpdateSidebarBadgeCalls.length = 0;
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    win.subscribers['reward-presenter-nav-badges'](null, { type: 'nav:navigated', payload: { id: 'x-test-id' } });
    mock.timers.tick(150);
    assert.equal(win.mailUpdateSidebarBadgeCalls.length, 0);
  } finally {
    mock.timers.reset();
    win.currentRole = 'student';
  }
});

test('nav:navigated to a non-dashboard page refreshes the sidebar title but not the profile title', () => {
  const sidebarCalls = []; const profileCalls = [];
  win.tsRefreshSidebarTitle = () => sidebarCalls.push('called');
  win.tsRefreshProfileTitle = () => profileCalls.push('called');
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    win.subscribers['titles-sidebar-nav-refresh'](null, { type: 'nav:navigated', payload: { id: 's-quizzes' } });
    mock.timers.tick(100);
  } finally {
    mock.timers.reset();
  }
  assert.deepEqual(sidebarCalls, ['called']);
  assert.deepEqual(profileCalls, []);
});

test('nav:navigated to s-dashboard refreshes both the sidebar title and the profile title', () => {
  const sidebarCalls = []; const profileCalls = [];
  win.tsRefreshSidebarTitle = () => sidebarCalls.push('called');
  win.tsRefreshProfileTitle = () => profileCalls.push('called');
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    win.subscribers['titles-sidebar-nav-refresh'](null, { type: 'nav:navigated', payload: { id: 's-dashboard' } });
    mock.timers.tick(100);
  } finally {
    mock.timers.reset();
  }
  assert.deepEqual(sidebarCalls, ['called']);
  assert.deepEqual(profileCalls, ['called']);
});

test('the activeQuiz-abort early return still emits nav:navigated — matches the old monkey-patch\'s "always runs after, regardless of internal branch" behavior', () => {
  win.activeQuiz = { id: 'q1' };
  win.quizFinishing = false;
  const abortCalls = [];
  win.abortQuiz = () => abortCalls.push('aborted');
  win.renderStudentDashboardCalls.length = 0;
  win.emitCalls.length = 0;
  win.navTo('s-dashboard');
  assert.deepEqual(abortCalls, ['aborted'], 'abortQuiz() should run instead of the real navigation');
  assert.equal(win.renderStudentDashboardCalls.length, 0, 'the s-dashboard render branch should never be reached on the abort path');
  const last = win.emitCalls[win.emitCalls.length - 1];
  assert.equal(last.type, 'nav:navigated', 'the event should still fire even though _navToCore returned early');
  assert.equal(last.payload.id, 's-dashboard', 'payload carries the originally-attempted id, same as the old patch received');
  win.activeQuiz = undefined;
  win.quizFinishing = undefined;
});

test('other event types are ignored by both subscribers', () => {
  const sidebarCalls = []; win.tsRefreshSidebarTitle = () => sidebarCalls.push('called');
  win.mailUpdateSidebarBadgeCalls.length = 0;
  win.subscribers['reward-presenter-nav-badges'](null, { type: 'session:booted', payload: {} });
  win.subscribers['titles-sidebar-nav-refresh'](null, { type: 'session:booted', payload: {} });
  assert.equal(win.mailUpdateSidebarBadgeCalls.length, 0);
  assert.equal(sidebarCalls.length, 0);
});

test('window.navTo is still a single function (no lingering _orig-capturing wrapper)', () => {
  assert.equal(typeof win.navTo, 'function');
  assert.equal(win.navTo.toString().indexOf('_orig'), -1);
});

test('reward-presenter.js and titles_sidebar_refresh.js no longer assign window.navTo', () => {
  const fs = require('fs');
  const path = require('path');
  ['shared/reward-presenter.js', 'titles/titles_sidebar_refresh.js'].forEach((rel) => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'modules', rel), 'utf8');
    assert.equal(src.indexOf('window.navTo ='), -1, `${rel} should no longer monkey-patch navTo`);
  });
});
