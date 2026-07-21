'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadUtilsWindow } = require('./helpers/load-globals.js');

let win;
before(() => { win = loadUtilsWindow(); });

test('computeAttendanceStreak: no records → zero streaks, not a throw', () => {
  // Compared field-by-field rather than with a whole-object deep-equal: the
  // result object is constructed in the jsdom realm, so it has a different
  // Object.prototype than a plain object literal in this file, which trips
  // assert/strict's deepStrictEqual even though the data is identical.
  const result = win.computeAttendanceStreak([]);
  assert.equal(result.current, 0);
  assert.equal(result.longest, 0);
});

test('computeAttendanceStreak: consecutive present days build a streak', () => {
  const records = [
    { status: 'present', date: '2026-07-13' },
    { status: 'present', date: '2026-07-14' },
    { status: 'present', date: '2026-07-15' },
  ];
  const result = win.computeAttendanceStreak(records);
  assert.equal(result.longest, 3);
});

test('computeAttendanceStreak: a gap day breaks the streak', () => {
  const records = [
    { status: 'present', date: '2026-07-10' },
    { status: 'present', date: '2026-07-11' },
    // gap — 07-12 absent/missing
    { status: 'present', date: '2026-07-13' },
  ];
  const result = win.computeAttendanceStreak(records);
  assert.equal(result.longest, 2);
});

test('computeAttendanceStreak: duplicate same-day entries do not double-count', () => {
  const records = [
    { status: 'present', date: '2026-07-14' },
    { status: 'present', date: '2026-07-14' },
    { status: 'present', date: '2026-07-15' },
  ];
  const result = win.computeAttendanceStreak(records);
  assert.equal(result.longest, 2);
});

test('getStudentAttendanceRecords: Excused days are dropped, not counted absent', () => {
  win.DB = {
    attendanceLogs: [
      { studentId: 's1', logDate: '2026-07-01', status: 'On Time' },
      { studentId: 's1', logDate: '2026-07-02', status: 'Excused' },
      { studentId: 's1', logDate: '2026-07-03', status: 'Late' },
      { studentId: 's2', logDate: '2026-07-01', status: 'On Time' }, // different student
    ],
  };
  const records = win.getStudentAttendanceRecords('s1');
  assert.equal(records.length, 2);
  assert.ok(records.every(r => r.studentId === 's1'));
  assert.ok(records.every(r => r.status === 'present'));
});

test('getStudentAttendanceRecords: Early/On Time/Late all normalize to present, others to absent', () => {
  win.DB = {
    attendanceLogs: [
      { studentId: 's1', logDate: '2026-07-01', status: 'Early' },
      { studentId: 's1', logDate: '2026-07-02', status: 'Absent' },
    ],
  };
  const records = win.getStudentAttendanceRecords('s1');
  assert.equal(records.find(r => r.date === '2026-07-01').status, 'present');
  assert.equal(records.find(r => r.date === '2026-07-02').status, 'absent');
});
