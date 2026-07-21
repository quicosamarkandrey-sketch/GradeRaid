'use strict';
// Highest-value coverage per Phase 0: this is the function that decides
// whether a student's quiz answer counts, which decides whether they get
// XP/coins. A silent regression here is a reward-integrity bug, not just a
// cosmetic one — exactly the class of thing the audit says was only ever
// caught after the fact.

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadUtilsWindow } = require('./helpers/load-globals.js');

let win;
before(() => { win = loadUtilsWindow(); });

test('mc: correct option index scores 1', () => {
  assert.equal(win.eqGradeAnswer({ type: 'mc', answer: 2 }, 2), 1);
});

test('mc: wrong option index scores 0', () => {
  assert.equal(win.eqGradeAnswer({ type: 'mc', answer: 2 }, 1), 0);
});

test('tf: falls through to the same option-index compare as mc', () => {
  assert.equal(win.eqGradeAnswer({ type: 'tf', answer: 0 }, 0), 1);
  assert.equal(win.eqGradeAnswer({ type: 'tf', answer: 0 }, 1), 0);
});

test('id: exact match scores 1', () => {
  assert.equal(win.eqGradeAnswer({ type: 'id', answer: 'Mitochondria' }, 'Mitochondria'), 1);
});

test('id: is forgiving of case, punctuation, and surrounding whitespace', () => {
  assert.equal(win.eqGradeAnswer({ type: 'id', answer: 'Mitochondria' }, '  MITOCHONDRIA.  '), 1);
});

test('id: accepts any listed altAnswers', () => {
  const q = { type: 'id', answer: 'Photosynthesis', altAnswers: ['Photo synthesis', 'photosyn'] };
  assert.equal(win.eqGradeAnswer(q, 'photosyn'), 1);
});

test('id: blank/undefined answer never matches', () => {
  const q = { type: 'id', answer: 'Mitochondria' };
  assert.equal(win.eqGradeAnswer(q, ''), 0);
  assert.equal(win.eqGradeAnswer(q, undefined), 0);
  assert.equal(win.eqGradeAnswer(q, null), 0);
});

test('enum: awards partial credit per correctly-matched item', () => {
  const q = { type: 'enum', answers: ['mercury', 'venus', 'earth', 'mars'] };
  const score = win.eqGradeAnswer(q, ['Venus', 'Earth']);
  assert.equal(score, 2 / 4);
});

test('enum: a duplicate correct guess only counts once (no score inflation)', () => {
  const q = { type: 'enum', answers: ['mercury', 'venus'] };
  const score = win.eqGradeAnswer(q, ['venus', 'venus']);
  assert.equal(score, 1 / 2);
});

test('enum: empty answer list scores 0, not NaN', () => {
  const q = { type: 'enum', answers: ['mercury', 'venus'] };
  assert.equal(win.eqGradeAnswer(q, []), 0);
});

test('match: partial credit per correctly-paired item, order-anchored to q.pairs', () => {
  const q = {
    type: 'match',
    pairs: [
      { left: 'Mitochondria', right: 'Powerhouse of the cell' },
      { left: 'Nucleus', right: 'Control center' },
    ],
  };
  // Student got pair 0 right, pair 1 wrong.
  const score = win.eqGradeAnswer(q, ['Powerhouse of the cell', 'wrong answer']);
  assert.equal(score, 1 / 2);
});

test('eqNormalizeAnswer strips punctuation, case, and collapses whitespace', () => {
  assert.equal(win.eqNormalizeAnswer('  The   Mitochondria!! '), 'the mitochondria');
});
