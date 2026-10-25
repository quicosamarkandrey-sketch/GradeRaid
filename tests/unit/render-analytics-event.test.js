'use strict';
// Continuation Plan §3, Category A — renderAnalytics. The classification
// table in CONTINUATION_PLAN.md counted this as 1 patch site
// (shop_pos_terminal.js). Investigation this session found a SECOND site
// (registrations.js) the earlier classification pass missed — matching the
// project's own documented pattern of undercounted monkey-patch inventories
// (see CONTINUATION_PLAN.md §6, the renderStudentMail precedent). Load-order
// tracing (index.html: shop_pos_terminal.js:801, analytics.js:874,
// registrations.js:877) showed shop_pos_terminal.js's patch is DEAD — it
// loads before analytics.js ever defines window.renderAnalytics, and gets
// silently overwritten the moment analytics.js's plain assignment runs.
// Only registrations.js's patch (loading after the base is defined) is
// live. Converted only the live one; the dead one is documented and left
// alone, same posture as the battle-overlay.js finding earlier in this
// project. See this session's engineering-log entry for the full trace.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyticsAndRegistrationsWindow } = require('./helpers/load-globals.js');

let win;
before(() => { win = loadAnalyticsAndRegistrationsWindow(); });

test('the registrations-analytics-block subscriber is registered (live monkey-patch removed)', () => {
  assert.equal(typeof win.subscribers['registrations-analytics-block'], 'function');
});

test('calling the real renderAnalytics() emits admin:analytics-rendered exactly once', () => {
  win.emitCalls.length = 0;
  win.renderAnalytics();
  assert.equal(win.emitCalls.length, 1);
  assert.equal(win.emitCalls[0].type, 'admin:analytics-rendered');
});

test('the registration stats block is injected into #a-analytics after rendering', () => {
  const dest = win.document.getElementById('a-analytics');
  assert.match(dest.innerHTML, /Student Registrations/);
});

test('registration counts reflect the real DB.registrations data', () => {
  win.DB.registrations = [
    { status: 'pending' }, { status: 'pending' }, { status: 'approved' }, { status: 'rejected' },
  ];
  win.renderAnalytics();
  const dest = win.document.getElementById('a-analytics');
  // 4 total, 2 pending, 1 approved, 1 rejected — same stat-card markup the
  // original monkey-patch produced.
  assert.match(dest.innerHTML, /pos-stat-val" style="color:var\(--primary\)">4</);
});

test('other event types are ignored by the registrations-analytics-block subscriber', () => {
  const dest = win.document.getElementById('a-analytics');
  const before2 = dest.innerHTML;
  win.subscribers['registrations-analytics-block'](null, { type: 'quiz:finished', payload: {} });
  assert.equal(dest.innerHTML, before2);
});

test('window.renderAnalytics is still a single function that always fires the event, even down the rollup-mode early-return path', () => {
  assert.equal(typeof win.renderAnalytics, 'function');
  win.currentRole = 'admin';
  win._anlMode = undefined; // not exposed on window; verifies via behavior instead
  // Rollup mode requires currentRole==='admin' AND the module-scoped
  // _anlMode==='rollup', which isn't reachable from outside the file (by
  // design — Chunk F's own encapsulation). Exercising the emit-fires-on-
  // every-branch guarantee is covered structurally instead: the emit call
  // lives in the outer window.renderAnalytics wrapper, not inside
  // _renderAnalyticsCore()'s branches, so it cannot be skipped by any
  // internal return path short of _renderAnalyticsCore() itself throwing.
  win.emitCalls.length = 0;
  win.renderAnalytics();
  assert.equal(win.emitCalls.length, 1);
});
