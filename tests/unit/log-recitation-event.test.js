'use strict';
// Event-Driven Communication phase (roadmap Phase 4) — logRecitation was the
// first of the 5 target functions converted off monkey-patching. Before this
// conversion, achCheckAndAward(sid, true) fired from THREE places on every
// single recitation log: (1) logger.js's own inline typeof-guarded call, (2)
// ach_engine.js's monkey-patch of window.logRecitation, and (3) ach_engine.js's
// pre-existing AppStore.subscribe('ach-engine-state-sync', ...) handler, which
// already watched 'recitation:logged'. (1) and (2) were deleted; (3) is the
// sole remaining path. These tests guard the two things that conversion had
// to get right: the event fires (so (3) still works), and it fires exactly
// once (so the triple-fire bug doesn't come back).
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadLoggerWindow } = require('./helpers/load-globals.js');

let win;
before(() => { win = loadLoggerWindow(); });
beforeEach(() => {
  win.updateStateCalls.length = 0;
  win.toastCalls.length = 0;
  win.renderScannerCalls = 0;
  win._fakeStudent = { id: 's1', name: 'Test Student', xp: 100 };
  win.document.body.innerHTML = `
    <select id="rec-student"><option value="s1" selected>Test Student</option></select>
    <input id="rec-pts" value="10">
    <textarea id="rec-note"></textarea>
  `;
});

test('logRecitation() calls AppStore.updateState() exactly once (not the old triple-fire)', () => {
  win.logRecitation();
  assert.equal(win.updateStateCalls.length, 1);
});

test('logRecitation() emits the recitation:logged event with the right payload shape', () => {
  win.logRecitation();
  const { event } = win.updateStateCalls[0];
  assert.equal(event.type, 'recitation:logged');
  assert.equal(event.payload.studentId, 's1');
  assert.equal(event.payload.pts, 10);
});

test('logRecitation()\'s draft mutation actually bumps xp and logs the entry', () => {
  win.logRecitation();
  const { mutationFn } = win.updateStateCalls[0];
  const draft = { students: [{ id: 's1', xp: 100 }] };
  mutationFn(draft);
  assert.equal(draft.students[0].xp, 110);
  assert.equal(draft.recitationLog.length, 1);
  assert.equal(draft.recitationLog[0].studentId, 's1');
  assert.equal(draft.pointLog.length, 1);
});

test('logRecitation() has no direct dependency on achCheckAndAward — runs fine with it undefined', () => {
  assert.equal(typeof win.achCheckAndAward, 'undefined');
  assert.doesNotThrow(() => win.logRecitation());
});

test('logRecitation() still calls toast() and renderScanner() as before', () => {
  win.logRecitation();
  assert.equal(win.toastCalls.length, 1);
  assert.equal(win.renderScannerCalls, 1);
});
