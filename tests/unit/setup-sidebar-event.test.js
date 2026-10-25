'use strict';
// Continuation Plan §3, Category A — setupSidebar was the recommended
// first site (single confirmed patch, lowest blast radius; also used here
// to confirm the jsdom-standalone-load approach still works before the
// bigger sites). Load-order traced: nav.js (index.html:642) defines
// setupSidebar() before shop_inventory.js (index.html:799) loads, and no
// other file re-assigns window.setupSidebar afterward — so this was a
// straightforward post-hook/void-return conversion, no dead-patch finding.
const { test, before, mock } = require('node:test');
const assert = require('node:assert/strict');
const { loadNavAndInventoryWindow } = require('./helpers/load-globals.js');

let win;
before(() => { win = loadNavAndInventoryWindow(); });

test('the shop-inventory-sidebar-badge subscriber is registered (monkey-patch removed)', () => {
  assert.equal(typeof win.subscribers['shop-inventory-sidebar-badge'], 'function');
});

test('calling the real setupSidebar() emits nav:sidebar-rendered with the current role', () => {
  win.currentRole = 'student';
  win.setupSidebar();
  const last = win.emitCalls[win.emitCalls.length - 1];
  assert.equal(last.type, 'nav:sidebar-rendered');
  assert.equal(last.payload.role, 'student');
});

test('setupSidebar() still renders the sidebar itself (emit is additive, not a replacement of the base behavior)', () => {
  win.currentRole = 'student';
  win.setupSidebar();
  assert.ok(win.document.querySelectorAll('.nav-btn').length > 0);
});

test('a student session:booted schedules invUpdateSidebarBadge after 50ms (bootApp path, unchanged by this conversion)', () => {
  const calls = [];
  win.invUpdateSidebarBadge = () => calls.push('called');
  win.currentRole = 'student';
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    win.subscribers['shop-inventory-boot-badge'](null, { type: 'session:booted', payload: { role: 'student' } });
    mock.timers.tick(50);
    assert.equal(calls.length, 1);
  } finally {
    mock.timers.reset();
  }
});

test('nav:sidebar-rendered schedules invUpdateSidebarBadge after 20ms for a student (replaces the old setTimeout-in-monkey-patch behavior)', () => {
  const calls = [];
  win.invUpdateSidebarBadge = () => calls.push('called');
  win.currentRole = 'student';
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    win.subscribers['shop-inventory-sidebar-badge'](null, { type: 'nav:sidebar-rendered', payload: { role: 'student' } });
    assert.equal(calls.length, 0, 'should not fire before the delay elapses');
    mock.timers.tick(19);
    assert.equal(calls.length, 0);
    mock.timers.tick(1);
    assert.equal(calls.length, 1);
  } finally {
    mock.timers.reset();
  }
});

test('nav:sidebar-rendered does nothing for a non-student role', () => {
  const calls = [];
  win.invUpdateSidebarBadge = () => calls.push('called');
  win.currentRole = 'admin';
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    win.subscribers['shop-inventory-sidebar-badge'](null, { type: 'nav:sidebar-rendered', payload: { role: 'admin' } });
    mock.timers.tick(20);
    assert.equal(calls.length, 0);
  } finally {
    mock.timers.reset();
  }
});

test('other event types are ignored by the sidebar-badge subscriber', () => {
  const calls = [];
  win.invUpdateSidebarBadge = () => calls.push('called');
  win.currentRole = 'student';
  win.subscribers['shop-inventory-sidebar-badge'](null, { type: 'quiz:finished', payload: {} });
  assert.equal(calls.length, 0);
});

test('window.setupSidebar is still a single function (no lingering _orig-capturing wrapper)', () => {
  assert.equal(typeof win.setupSidebar, 'function');
  assert.equal(win.setupSidebar.toString().indexOf('_orig'), -1);
});
