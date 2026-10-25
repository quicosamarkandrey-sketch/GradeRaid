// Phase 7 (2026-08-10, session 13) — equivalence check for
// quest-mascot-lines.js. eqMascotLine() uses Math.random(), so it's
// stubbed to a fixed sequence here for reproducible comparison — testing
// "picks the right pool" and "index math is correct" for real, not just
// "returns a string of the right shape."
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow(customLines) {
  const dom = new JSDOM('<!doctype html></html>', { runScripts: 'dangerously' });
  const win = dom.window;
  win._eqMascotCustomLines = customLines || {};
  return win;
}

function runChecks(win) {
  const results = {};

  // Constants — exact shape.
  results.emotionsCount = win.MASCOT_EMOTIONS.length;
  results.emojiForHyped = win.MASCOT_EMOJI.hyped;
  results.defaultCorrectTier2 = win.MASCOT_DEFAULT_LINES.correct[2];

  // eqMascotLinePool — deterministic, no randomness.
  results.startPool = win.eqMascotLinePool('start');
  results.correctTier1Pool = win.eqMascotLinePool('correct', 1);
  results.unknownEventPool = win.eqMascotLinePool('nonexistent-event'); // must be [] not throw
  results.missingStageKeyPool = win.eqMascotLinePool('correct', 99); // out-of-range stage key -> []

  // custom-lines layering — admin lines appended AFTER defaults, blanks filtered
  win._eqMascotCustomLines = { start: ['Custom line!', '', '   ', 'Another custom'] };
  results.startPoolWithCustom = win.eqMascotLinePool('start');

  // eqMascotEmotionFor — deterministic, exhaustive over every real event.
  results.emotions = {
    start: win.eqMascotEmotionFor('start'),
    retry: win.eqMascotEmotionFor('retry'),
    correctLowStage: win.eqMascotEmotionFor('correct', { stageIdx: 0 }),
    correctHighStage: win.eqMascotEmotionFor('correct', { stageIdx: 2 }),
    milestone: win.eqMascotEmotionFor('milestone'),
    wrongLowStage: win.eqMascotEmotionFor('wrong', { stageIdx: 0 }),
    wrongHighStage: win.eqMascotEmotionFor('wrong', { stageIdx: 2 }),
    stageTransition: win.eqMascotEmotionFor('stageTransition'),
    lowTime: win.eqMascotEmotionFor('lowTime', { stageIdx: 2 }),
    pass: win.eqMascotEmotionFor('pass'),
    fail: win.eqMascotEmotionFor('fail'),
    unknownDefault: win.eqMascotEmotionFor('totally-made-up-event'),
    noOptsAtAll: win.eqMascotEmotionFor('correct'), // opts undefined -> must not throw
  };

  // eqMascotLine — stub Math.random to a fixed sequence for reproducible picks.
  const sequence = [0, 0.5, 0.99];
  let i = 0;
  win.Math.random = () => sequence[i++ % sequence.length];
  results.pickedLines = [
    win.eqMascotLine('pass'),
    win.eqMascotLine('pass'),
    win.eqMascotLine('pass'),
  ];
  results.emptyPoolLine = win.eqMascotLine('nonexistent-event'); // must be '' not throw

  return results;
}

function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'quest-mascot-lines.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'quest-mascot-lines.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(originalSrc);
  const resultOriginal = runChecks(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  const resultBridge = runChecks(winBridge);

  assert.deepStrictEqual(JSON.parse(JSON.stringify(resultBridge)), JSON.parse(JSON.stringify(resultOriginal)), 'bridge output must exactly match original at every step');
  assert.strictEqual(resultOriginal.emotionsCount, 9, 'sanity: 9 emotions per the §6 trigger table');
  assert.strictEqual(JSON.stringify(resultOriginal.unknownEventPool), '[]', 'sanity: unknown event must yield empty pool, not throw');
  assert.strictEqual(JSON.stringify(resultOriginal.startPoolWithCustom.slice(-1)), JSON.stringify(['Another custom']), 'sanity: custom lines append after defaults, blanks filtered');
  assert.strictEqual(resultOriginal.emptyPoolLine, '', 'sanity: empty pool must yield empty string, not throw');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log(JSON.stringify(resultOriginal, null, 2));
}

main();
