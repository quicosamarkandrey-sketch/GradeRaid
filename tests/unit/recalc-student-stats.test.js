'use strict';
// recalcStudentStats is the single source of truth for tier/quizAvg/attendance
// display — the audit's §1-3 fixes all live here. Note: this function derives
// `tier` from the student's EXISTING `.level` field; it does not itself
// recompute `.level` from `.xp` (that happens elsewhere). These tests cover
// current, real behavior — not the behavior implied by the file's own
// header comment, which is worth reconciling in a later phase but is out of
// scope for Phase 0 (no behavior changes here, only test coverage of what
// exists today).

const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadUtilsWindow } = require('./helpers/load-globals.js');

let win;
before(() => { win = loadUtilsWindow(); });
beforeEach(() => {
  win.DB = { quizHistory: {}, attendanceLogs: [], attendanceSessions: [] };
});

test('does nothing (does not throw) when called with no student', () => {
  assert.doesNotThrow(() => win.recalcStudentStats(null));
});

test('assigns tier from level via the documented thresholds', () => {
  const cases = [
    [0, 'Novice'], [4, 'Novice'],
    [5, 'Achiever'], [9, 'Achiever'],
    [10, 'Scholar'], [14, 'Scholar'],
    [15, 'Master'], [19, 'Master'],
    [20, 'Legend'], [99, 'Legend'],
  ];
  for (const [level, expectedTier] of cases) {
    const student = { id: 's1', level };
    win.recalcStudentStats(student);
    assert.equal(student.tier, expectedTier, `level ${level} should be ${expectedTier}`);
  }
});

test('quizAvg is the mean score across DB.quizHistory for that student', () => {
  win.DB.quizHistory = { s1: [{ score: 80 }, { score: 100 }, { score: 90 }] };
  const student = { id: 's1', level: 0, quizAvg: 0 };
  win.recalcStudentStats(student);
  assert.equal(student.quizAvg, 90);
});

test('quizAvg is left unchanged when the student has no history yet (preserves seed value)', () => {
  const student = { id: 's1', level: 0, quizAvg: 42 };
  win.recalcStudentStats(student);
  assert.equal(student.quizAvg, 42);
});

test('attendance %: Early/On Time/Late count as present, Excused counts toward neither side', () => {
  win.DB.attendanceLogs = [
    { studentId: 's1', status: 'On Time' },
    { studentId: 's1', status: 'Late' },
    { studentId: 's1', status: 'Absent' },
    { studentId: 's1', status: 'Excused' }, // must not shrink the denominator's "present" credit nor count against it beyond removal
  ];
  const student = { id: 's1', level: 0 };
  win.recalcStudentStats(student);
  // 2 present out of 3 non-excused logs = 67%
  assert.equal(student.attendance, 67);
});

test('attendance %: opts.attendanceLogs override takes precedence over global DB (draft-callback race fix)', () => {
  win.DB.attendanceLogs = [{ studentId: 's1', status: 'Absent' }]; // stale global — 0%
  const freshDraftLogs = [
    { studentId: 's1', status: 'On Time' },
    { studentId: 's1', status: 'On Time' },
  ]; // 100%, not yet in global DB
  const student = { id: 's1', level: 0 };
  win.recalcStudentStats(student, { attendanceLogs: freshDraftLogs });
  assert.equal(student.attendance, 100);
});

test('attendance %: falls back to legacy DB.attendanceSessions when no Phase-1 logs exist', () => {
  win.DB.attendanceLogs = [];
  win.DB.attendanceSessions = [
    { studentId: 's1', status: 'present' },
    { studentId: 's1', status: 'absent' },
  ];
  const student = { id: 's1', level: 0 };
  win.recalcStudentStats(student);
  assert.equal(student.attendance, 50);
});
