'use strict';
// Event-Driven Communication phase (roadmap Phase 4) — the last of the 5
// target functions. This was the one the roadmap specifically called out
// for real ordering risk: the original patch awaited wbcApplyDamage's
// return value and branched on `result !== 'defeated'` to decide whether to
// run the phase-change check (skipped on a kill — no point checking for a
// phase transition on a boss that's already dead). Converting to events
// resolves that risk rather than just preserving it: event.type IS that
// same distinction now, so there's no return-value plumbing left at all.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadPhasesWindow } = require('./helpers/load-globals.js');

let win;
before(() => { win = loadPhasesWindow(); });

test('wbp-boss-damage-phase-check subscriber is registered', () => {
  assert.equal(typeof win.subscribers['wbp-boss-damage-phase-check'], 'function');
});

test('world-boss:damage-applied (a normal hit) runs BOTH phase-change and rage checks', () => {
  const phaseCalls = []; const rageCalls = [];
  win.wbpCheckPhaseChange = (idx) => phaseCalls.push(idx);
  win.wbrageCheckAndActivate = (idx) => rageCalls.push(idx);
  win.subscribers['wbp-boss-damage-phase-check'](null, { type: 'world-boss:damage-applied', payload: { bossIdx: 2, studentId: 's1', damage: 10 } });
  assert.deepEqual(phaseCalls, [2]);
  assert.deepEqual(rageCalls, [2]);
});

test('world-boss:defeated (the killing blow) runs ONLY the rage check, skips phase-change — matches the original result !== \'defeated\' guard', () => {
  const phaseCalls = []; const rageCalls = [];
  win.wbpCheckPhaseChange = (idx) => phaseCalls.push(idx);
  win.wbrageCheckAndActivate = (idx) => rageCalls.push(idx);
  win.subscribers['wbp-boss-damage-phase-check'](null, { type: 'world-boss:defeated', payload: { bossIdx: 2, studentId: 's1', damage: 999 } });
  assert.deepEqual(phaseCalls, [], 'no point checking for a phase transition on an already-dead boss');
  assert.deepEqual(rageCalls, [2], 'rage check ran unconditionally in the original — preserved even on the kill');
});

test('other event types are ignored', () => {
  const phaseCalls = []; const rageCalls = [];
  win.wbpCheckPhaseChange = (idx) => phaseCalls.push(idx);
  win.wbrageCheckAndActivate = (idx) => rageCalls.push(idx);
  win.subscribers['wbp-boss-damage-phase-check'](null, { type: 'recitation:logged', payload: { studentId: 's1' } });
  assert.equal(phaseCalls.length, 0);
  assert.equal(rageCalls.length, 0);
});

test('an event with no bossIdx does not throw and does not fire either check', () => {
  const phaseCalls = []; const rageCalls = [];
  win.wbpCheckPhaseChange = (idx) => phaseCalls.push(idx);
  win.wbrageCheckAndActivate = (idx) => rageCalls.push(idx);
  assert.doesNotThrow(() => {
    win.subscribers['wbp-boss-damage-phase-check'](null, { type: 'world-boss:damage-applied', payload: {} });
  });
  assert.equal(phaseCalls.length, 0);
  assert.equal(rageCalls.length, 0);
});

test('bossIdx of 0 (falsy but valid) still fires both checks — guards against an == 0 truthiness bug', () => {
  const phaseCalls = []; const rageCalls = [];
  win.wbpCheckPhaseChange = (idx) => phaseCalls.push(idx);
  win.wbrageCheckAndActivate = (idx) => rageCalls.push(idx);
  win.subscribers['wbp-boss-damage-phase-check'](null, { type: 'world-boss:damage-applied', payload: { bossIdx: 0, studentId: 's1', damage: 5 } });
  assert.deepEqual(phaseCalls, [0]);
  assert.deepEqual(rageCalls, [0]);
});
