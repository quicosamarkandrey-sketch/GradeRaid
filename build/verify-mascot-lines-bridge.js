// Phase 7, Stream B — equivalence check for modules/admin/mascot-lines.js.
// Drives the real DOM-rendering flow: the admin-only gate, the initial
// load (success and failure), add/delete-line mutation of the in-memory
// pool (including the flat-pool vs per-stage-pool branches), and the full
// save cycle (success — including the window._eqMascotCustomLines side
// effect — and failure/toast path).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const STARTER_HTML = `<!doctype html><html><body>
  <div id="a-mascot-lines"></div>
  <div id="toast"></div>
</body></html>`;

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously' });
  const win = dom.window;
  const calls = [];
  win.__calls = calls;

  win.currentRole = 'admin';

  win.toast = function (msg, color) {
    calls.push({ name: 'toast', msg, color });
  };

  let getCallCount = 0;
  win.MascotLinesService = {
    async get() {
      getCallCount++;
      calls.push({ name: 'MascotLinesService.get' });
      if (win.__getFailMode) return { ok: false, error: 'Could not load mascot lines.' };
      return {
        ok: true,
        customLines: { start: ['Custom start line'], correct: { '0': ['Nice!'], '1': [], '2': [] } },
        updatedAt: '2026-01-01T00:00:00Z',
      };
    },
    async save(customLines) {
      calls.push({ name: 'MascotLinesService.save', customLines: JSON.parse(JSON.stringify(customLines)) });
      if (win.__saveFailMode) return { ok: false, error: 'Could not save mascot lines.' };
      return { ok: true, customLines, updatedAt: '2026-02-02T00:00:00Z' };
    },
  };

  return win;
}

function snapshot(win) {
  const el = win.document.getElementById('a-mascot-lines');
  return {
    html: el ? el.innerHTML : null,
    eqMascotCustomLines: win._eqMascotCustomLines || null,
    calls: win.__calls,
  };
}

async function runSequence(win) {
  const results = {};

  // Non-admin gate.
  win.currentRole = 'teacher';
  await win.renderMascotLines();
  results.nonAdminGate = snapshot(win);
  win.__calls.length = 0;
  win.currentRole = 'admin';

  // Load failure path.
  win.__getFailMode = true;
  await win.renderMascotLines();
  results.loadFail = snapshot(win);
  win.__calls.length = 0;
  win.__getFailMode = false;

  // Normal load.
  await win.renderMascotLines();
  results.afterLoad = snapshot(win);
  win.__calls.length = 0;

  // Add a line to a flat pool (start).
  win.document.getElementById('ml-new-start-').value = 'Another start line';
  win.mlAddLine('start', '');
  results.afterAddFlat = snapshot(win);

  // Add a line to a per-stage pool (correct, stage 1).
  win.document.getElementById('ml-new-correct-1').value = 'Surge line';
  win.mlAddLine('correct', '1');
  results.afterAddStaged = snapshot(win);

  // Adding an empty line is a no-op.
  win.document.getElementById('ml-new-start-').value = '   ';
  win.mlAddLine('start', '');
  results.afterAddEmptyNoop = snapshot(win);

  // Delete a line.
  win.mlDeleteLine('start', '', 0);
  results.afterDelete = snapshot(win);

  // Save success.
  await win.saveMascotLines();
  results.afterSaveOk = snapshot(win);
  win.__calls.length = 0;

  // Save failure.
  win.document.getElementById('ml-new-fail-').value; // no-op read, just for parity
  win.__saveFailMode = true;
  await win.saveMascotLines();
  results.afterSaveFail = snapshot(win);

  return results;
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'mascot-lines.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'mascot-lines.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.renderMascotLines, 'function', 'original: window.renderMascotLines should exist');
  assert.strictEqual(typeof winOriginal.mlAddLine, 'function', 'original: window.mlAddLine should exist');
  assert.strictEqual(typeof winOriginal.mlDeleteLine, 'function', 'original: window.mlDeleteLine should exist');
  assert.strictEqual(typeof winOriginal.saveMascotLines, 'function', 'original: window.saveMascotLines should exist');
  const resultOriginal = await runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.renderMascotLines, 'function', 'bridge: window.renderMascotLines should exist');
  assert.strictEqual(typeof winBridge.mlAddLine, 'function', 'bridge: window.mlAddLine should exist');
  assert.strictEqual(typeof winBridge.mlDeleteLine, 'function', 'bridge: window.mlDeleteLine should exist');
  assert.strictEqual(typeof winBridge.saveMascotLines, 'function', 'bridge: window.saveMascotLines should exist');
  const resultBridge = await runSequence(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original output at every step');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('mascot-lines.js: non-admin gate, load success/failure, add-line (flat + per-stage pools,');
  console.log('incl. empty-input no-op), delete-line, and save success/failure (incl. the');
  console.log('window._eqMascotCustomLines side effect) all produce identical DOM + call sequences.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
