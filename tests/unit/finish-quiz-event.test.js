'use strict';
// Event-Driven Communication phase (roadmap Phase 4) — finishQuiz was the
// 2nd of the 5 target functions converted. Unlike logRecitation, this one
// needed real care rather than pure deletion: the original monkey-patch
// called achCheckAndAward(currentUser.id) with NO second argument, which
// means the achievement-unlock popup was shown (a quiz is the student's own
// foreground action). Folding 'quiz:finished' into the existing shared
// 'ach-engine-state-sync' subscriber would have silently suppressed that
// popup, since that subscriber hardcodes suppressPopup=true for every event
// it watches. These tests guard that distinction directly.
const { test, before, mock } = require('node:test');
const assert = require('node:assert/strict');
const { loadAchEngineWindow } = require('./helpers/load-globals.js');

let win;
before(() => { win = loadAchEngineWindow(); });

test('both ach-engine subscribers are registered', () => {
  assert.equal(typeof win.subscribers['ach-engine-state-sync'], 'function');
  assert.equal(typeof win.subscribers['ach-engine-quiz-finished'], 'function');
});

test('quiz:finished is ignored by the shared state-sync subscriber (would suppress the popup if it weren\'t)', () => {
  const calls = [];
  win.achCheckAndAward = (...args) => calls.push(args);
  win.subscribers['ach-engine-state-sync'](null, { type: 'quiz:finished', payload: { studentId: 's1' } });
  assert.equal(calls.length, 0);
});

test('quiz:finished IS handled by the dedicated quiz-finished subscriber, after a 500ms delay', () => {
  const calls = [];
  win.achCheckAndAward = (...args) => calls.push(args);
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    win.subscribers['ach-engine-quiz-finished'](null, { type: 'quiz:finished', payload: { studentId: 's1' } });
    assert.equal(calls.length, 0, 'should not fire before the delay elapses');
    mock.timers.tick(499);
    assert.equal(calls.length, 0, 'should not fire 1ms early');
    mock.timers.tick(1);
    assert.equal(calls.length, 1);
  } finally {
    mock.timers.reset();
  }
});

test('the dedicated subscriber calls achCheckAndAward WITHOUT suppressPopup — preserves the popup, matching the original patch', () => {
  const calls = [];
  win.achCheckAndAward = (...args) => calls.push(args);
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    win.subscribers['ach-engine-quiz-finished'](null, { type: 'quiz:finished', payload: { studentId: 's1' } });
    mock.timers.tick(500);
    assert.deepEqual(calls[0], ['s1']); // only 1 arg — no truthy suppressPopup
  } finally {
    mock.timers.reset();
  }
});

test('other event types are ignored by the quiz-finished subscriber', () => {
  const calls = [];
  win.achCheckAndAward = (...args) => calls.push(args);
  win.subscribers['ach-engine-quiz-finished'](null, { type: 'recitation:logged', payload: { studentId: 's1' } });
  assert.equal(calls.length, 0);
});

test('a quiz:finished event with no studentId does not throw', () => {
  assert.doesNotThrow(() => {
    win.subscribers['ach-engine-quiz-finished'](null, { type: 'quiz:finished', payload: {} });
  });
});

test('window.logAttendance is not defined — the dead monkey-patch was removed, not left dormant', () => {
  // This patch never had anything to wrap (nothing in the codebase ever
  // called logAttendance() or emitted 'attendance:logged') — confirming it
  // stays gone rather than silently reappearing in a future edit.
  assert.equal(typeof win.logAttendance, 'undefined');
});

test('attendance:logged is no longer in the shared subscriber\'s watched events (was dead, correspondingly removed)', () => {
  const calls = [];
  win.achCheckAndAward = (...args) => calls.push(args);
  win.subscribers['ach-engine-state-sync'](null, { type: 'attendance:logged', payload: { studentId: 's1' } });
  assert.equal(calls.length, 0);
});

test('attendance:scan-recorded triggers an achievement check (closes the dormant gap left by the dead logAttendance patch)', () => {
  const calls = [];
  win.achCheckAndAward = (...args) => calls.push(args);
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    win.subscribers['ach-engine-state-sync'](null, { type: 'attendance:scan-recorded', payload: { studentId: 's1', status: 'On Time', alreadyRecorded: false } });
    mock.timers.tick(400);
    assert.deepEqual(calls[0], ['s1', true]);
  } finally {
    mock.timers.reset();
  }
});

test('attendance:scan-recorded does NOT trigger a check when alreadyRecorded is true (duplicate scan, nothing new happened)', () => {
  const calls = [];
  win.achCheckAndAward = (...args) => calls.push(args);
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    win.subscribers['ach-engine-state-sync'](null, { type: 'attendance:scan-recorded', payload: { studentId: 's1', status: 'On Time', alreadyRecorded: true } });
    mock.timers.tick(400);
    assert.equal(calls.length, 0);
  } finally {
    mock.timers.reset();
  }
});

test('attendance:override triggers an achievement check', () => {
  const calls = [];
  win.achCheckAndAward = (...args) => calls.push(args);
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    win.subscribers['ach-engine-state-sync'](null, { type: 'attendance:override', payload: { studentId: 's1', classId: 'c1', status: 'Present' } });
    mock.timers.tick(400);
    assert.deepEqual(calls[0], ['s1', true]);
  } finally {
    mock.timers.reset();
  }
});

test('attendance:session-closed does NOT trigger a check — bulk absence-sweep, can only decrease presence stats', () => {
  const calls = [];
  win.achCheckAndAward = (...args) => calls.push(args);
  win.subscribers['ach-engine-state-sync'](null, { type: 'attendance:session-closed', payload: { classId: 'c1', logDate: '2026-07-31', absencesRecorded: 3 } });
  assert.equal(calls.length, 0);
});

// bootApp conversion (roadmap Phase 4) — ach_engine.js's bootApp patch had
// its own distinct semantics (no suppressPopup, 400ms), same reasoning as
// finishQuiz above, so it got its own dedicated subscriber rather than being
// folded into the shared one.
test('ach-engine-session-booted subscriber is registered', () => {
  assert.equal(typeof win.subscribers['ach-engine-session-booted'], 'function');
});

test('session:booted triggers achCheckAndAward for a logged-in student, after 400ms, without suppressPopup', () => {
  const calls = [];
  win.achCheckAndAward = (...args) => calls.push(args);
  win.getCurrentRole = () => 'student';
  win.getCurrentUser = () => ({ id: 's1' });
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    win.subscribers['ach-engine-session-booted'](null, { type: 'session:booted', payload: { role: 'student', userId: 's1' } });
    assert.equal(calls.length, 0, 'should not fire before the delay elapses');
    mock.timers.tick(400);
    assert.deepEqual(calls[0], ['s1']); // only 1 arg — no truthy suppressPopup, popup shows
  } finally {
    mock.timers.reset();
  }
});

test('session:booted does nothing for a non-student role', () => {
  const calls = [];
  win.achCheckAndAward = (...args) => calls.push(args);
  win.getCurrentRole = () => 'teacher';
  win.getCurrentUser = () => ({ id: 't1' });
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    win.subscribers['ach-engine-session-booted'](null, { type: 'session:booted', payload: { role: 'teacher', userId: 't1' } });
    mock.timers.tick(400);
    assert.equal(calls.length, 0);
  } finally {
    mock.timers.reset();
  }
});

test('other event types are ignored by the session-booted subscriber', () => {
  const calls = [];
  win.achCheckAndAward = (...args) => calls.push(args);
  win.getCurrentRole = () => 'student';
  win.getCurrentUser = () => ({ id: 's1' });
  win.subscribers['ach-engine-session-booted'](null, { type: 'quiz:finished', payload: { studentId: 's1' } });
  assert.equal(calls.length, 0);
});
