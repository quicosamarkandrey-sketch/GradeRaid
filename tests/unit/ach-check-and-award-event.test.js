'use strict';
// Continuation Plan §3, Category A — achCheckAndAward-as-title-hook. Flagged
// in the plan as the highest-blast-radius conversion on the list, since
// achCheckAndAward is called directly from ~8 places across the app
// (campaign_engine.js, combat-settings.js, shop_store.js,
// shop_pos_terminal.js, plus ach_engine.js's own subscribers), not funneled
// through one dispatch point the way navTo/openBossForm were. None of those
// call sites needed to change: they all call the single global
// achCheckAndAward, and ach_engine.js's own wrapper is now the only thing
// that name resolves to — this suite exercises the real, un-monkey-patched
// achCheckAndAward() directly, the same way any of those 8 real call sites
// would, and asserts on the title-unlock subscriber's reaction.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadAchAndTitlesRoundTripWindow } = require('./helpers/load-globals.js');

let win, state;
before(() => {
  win = loadAchAndTitlesRoundTripWindow();
  state = win._eqTestState;
});

test('the titles-ach-check-and-award subscriber is registered (monkey-patch removed)', () => {
  assert.equal(typeof win.subscribers['titles-ach-check-and-award'], 'function');
});

test('achCheckAndAward emits achievements:check-and-award-ran unconditionally, even when nothing unlocks', () => {
  state.students = [{ id: 'nobody-unlocks', classId: 'c1', level: 0 }];
  state.achievements = [{ id: 'a-unreachable', active: true, triggerType: 'level', triggerValue: 99 }];
  win.emitCalls.length = 0;
  win.achCheckAndAward('nobody-unlocks', true);
  assert.equal(win.emitCalls.length, 1);
  assert.equal(win.emitCalls[0].type, 'achievements:check-and-award-ran');
  assert.equal(win.emitCalls[0].payload.studentId, 'nobody-unlocks');
  assert.equal(win.emitCalls[0].payload.suppressPopup, true);
});

test('achCheckAndAward with no studentId does not throw and emits nothing usable to the subscriber (which itself guards on studentId)', () => {
  win.emitCalls.length = 0;
  win.achCheckAndAward(null, true);
  // _achCheckAndAwardCore returns immediately (no studentId) but the outer
  // wrapper still emits, matching the old patch calling _orig unconditionally —
  // the subscriber's own `if (!studentId) return` is what makes this a no-op,
  // not the emit being skipped.
  assert.equal(win.emitCalls.length, 1);
  assert.equal(win.emitCalls[0].payload.studentId, null);
});

test('unlocking an achievement linked to an active title unlocks that title too', () => {
  state.students = [{ id: 's1', classId: 'c1', level: 5 }];
  state.achievements = [{ id: 'a1', active: true, triggerType: 'level', triggerValue: 1 }];
  state.titles = [{ id: 't1', active: true, achievementId: 'a1', name: 'Achiever' }];
  state.achievementUnlocks = {};
  state.titleUnlocks = {};
  win.achCheckAndAward('s1', true);
  assert.equal(state.achievementUnlocks.s1.length, 1);
  assert.equal(state.achievementUnlocks.s1[0].achId, 'a1');
  assert.equal(JSON.stringify(Array.from(state.titleUnlocks.s1)), JSON.stringify(['t1']));
});

test('a title with no linked achievement, or an inactive title, is never auto-unlocked', () => {
  state.students = [{ id: 's2', classId: 'c1', level: 5 }];
  state.achievements = [{ id: 'a2', active: true, triggerType: 'level', triggerValue: 1 }];
  state.titles = [
    { id: 't-no-link', active: true, achievementId: null, name: 'Manual Only' },
    { id: 't-inactive', active: false, achievementId: 'a2', name: 'Retired' },
  ];
  state.achievementUnlocks = {};
  state.titleUnlocks = {};
  win.achCheckAndAward('s2', true);
  assert.equal(state.titleUnlocks.s2, undefined);
});

test('catch-up case: a title linked to an already-unlocked achievement AFTER the fact still gets backfilled on the next call, even though nothing NEW unlocks that call', () => {
  state.students = [{ id: 's3', classId: 'c1', level: 5 }];
  state.achievements = [{ id: 'a3', active: true, triggerType: 'level', triggerValue: 1 }];
  state.titles = [{ id: 't3a', active: true, achievementId: 'a3', name: 'First' }];
  state.achievementUnlocks = {};
  state.titleUnlocks = {};
  win.achCheckAndAward('s3', true);
  assert.equal(JSON.stringify(Array.from(state.titleUnlocks.s3)), JSON.stringify(['t3a']));
  // Admin links a second title to the same (already-unlocked) achievement.
  state.titles.push({ id: 't3b', active: true, achievementId: 'a3', name: 'Late Add' });
  win.achCheckAndAward('s3', true);
  assert.equal(
    JSON.stringify(Array.from(state.titleUnlocks.s3)),
    JSON.stringify(['t3a', 't3b']),
    'the newly-linked title should backfill even though a3 was not newly unlocked this call'
  );
});

test('an already-title-unlocked student is not re-unlocked (tsIsUnlocked guard)', () => {
  state.students = [{ id: 's4', classId: 'c1', level: 5 }];
  state.achievements = [{ id: 'a4', active: true, triggerType: 'level', triggerValue: 1 }];
  state.titles = [{ id: 't4', active: true, achievementId: 'a4', name: 'Repeatable' }];
  state.achievementUnlocks = {};
  state.titleUnlocks = {};
  win.achCheckAndAward('s4', true);
  win.achCheckAndAward('s4', true);
  assert.equal(JSON.stringify(Array.from(state.titleUnlocks.s4)), JSON.stringify(['t4']));
});

test('suppressPopup is threaded through to tsUnlockTitleForStudent (silent unlock, no popup)', () => {
  state.students = [{ id: 's5', classId: 'c1', level: 5 }];
  state.achievements = [{ id: 'a5', active: true, triggerType: 'level', triggerValue: 1 }];
  state.titles = [{ id: 't5', active: true, achievementId: 'a5', name: 'Quiet' }];
  state.achievementUnlocks = {};
  state.titleUnlocks = {};
  win.tsShowTitleUnlockPopupCalls.length = 0;
  win.achCheckAndAward('s5', true);
  assert.equal(win.tsShowTitleUnlockPopupCalls.length, 0);
});

test('achievements:check-and-award-ran with an unrelated event type is ignored', () => {
  const before = JSON.stringify(state.titleUnlocks);
  win.subscribers['titles-ach-check-and-award'](state, { type: 'session:booted', payload: {} });
  assert.equal(JSON.stringify(state.titleUnlocks), before);
});

test('window.achCheckAndAward is still a single function (no lingering _orig-capturing wrapper) and calls the renamed core', () => {
  const src = win.achCheckAndAward.toString();
  assert.equal(typeof win.achCheckAndAward, 'function');
  assert.equal(src.indexOf('const _orig ='), -1, 'should not contain the old monkey-patch capture pattern (comments referencing the old pattern by name are fine)');
  assert.notEqual(src.indexOf('_achCheckAndAwardCore'), -1);
});

test('titles_sidebar_refresh.js no longer assigns window.achCheckAndAward', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'modules', 'titles', 'titles_sidebar_refresh.js'), 'utf8');
  assert.equal(src.indexOf('window.achCheckAndAward ='), -1);
});
