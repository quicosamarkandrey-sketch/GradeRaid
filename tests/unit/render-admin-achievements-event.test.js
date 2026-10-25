'use strict';
// Continuation Plan §3, Category A — renderAdminAchievements was the
// second recommended site (single confirmed patch, DOM-injection
// post-hook, void return). Load-order traced: ach_admin_page.js
// (index.html:809) defines and now emits the event; titles_admin_page.js
// (index.html:816) loads after and subscribes — nothing re-assigns
// window.renderAdminAchievements afterward.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadAchAdminAndTitlesWindow } = require('./helpers/load-globals.js');

let win;
before(() => { win = loadAchAdminAndTitlesWindow(); });

test('the titles-admin-achievements-link subscriber is registered (monkey-patch removed)', () => {
  assert.equal(typeof win.subscribers['titles-admin-achievements-link'], 'function');
});

test('calling the real renderAdminAchievements() emits admin:achievements-rendered', () => {
  win.renderAdminAchievements();
  const last = win.emitCalls[win.emitCalls.length - 1];
  assert.equal(last.type, 'admin:achievements-rendered');
});

test('the subscriber injects the "Manage Titles" button into #a-achievements after the event fires', () => {
  const dest = win.document.getElementById('a-achievements');
  assert.ok(dest.querySelector('.ts-ach-titles-link'));
});

test('a second render does not duplicate the button (idempotency check preserved from the original patch)', () => {
  win.renderAdminAchievements();
  const dest = win.document.getElementById('a-achievements');
  assert.equal(dest.querySelectorAll('.ts-ach-titles-link').length, 1);
});

test('other event types are ignored by the achievements-link subscriber', () => {
  const dest = win.document.getElementById('a-achievements');
  dest.innerHTML = '<div class="page-hero"><div><div>hero-bar</div></div></div>';
  win.subscribers['titles-admin-achievements-link'](null, { type: 'quiz:finished', payload: {} });
  assert.equal(dest.querySelectorAll('.ts-ach-titles-link').length, 0);
});

test('window.renderAdminAchievements is still a single function (no lingering _orig-capturing wrapper)', () => {
  assert.equal(typeof win.renderAdminAchievements, 'function');
  assert.equal(win.renderAdminAchievements.toString().indexOf('_orig'), -1);
});
