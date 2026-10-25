// Phase 7 (Stream A) — equivalence check for modules/recitation/logger.js.
//
// Real-imports AppStore (state-manager.js) and syncStudentStatsToServer
// (student-stats.js), both this stream's own already-converted files,
// both confirmed via repo-wide grep to never be reassigned at runtime
// (see MEMORY.md's critical rule from the db-migrations.js near-miss).
// ORIGINAL side evals the full real chain; BRIDGE side evals the
// combined test bundle sharing one real AppStore instance.
//
// syncStudentStatsToServer is real-imported but not specially handled
// here: it self-guards on `typeof DBService.rpc !== 'function'`. Note
// this guard does NOT actually block the RPC attempt in this test —
// db-service.js's REAL DBService object (evaled as part of the full
// chain / bundled into the combined test bundle) DOES have a working
// `.rpc()` method, so the guard passes and it calls through to a fake
// `supabase.createClient()` that returns `{}` (no `.rpc` of its own).
// That throws, but student-stats.js already wraps the whole RPC chain
// in a `.catch()` (best-effort only, by design) — expect noisy but
// harmless `console.warn`/stack-trace stderr output from this, on both
// sides identically. Not a bug, not something to quiet down at the
// source; this is the exact same fire-and-forget failure path real
// production code takes when the network is unreachable.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow() {
  const html = '<!doctype html><html><body>' +
    '<select id="rec-student"><option value="s1" selected>Ana</option></select>' +
    '<input id="rec-pts" value="10">' +
    '<textarea id="rec-note"></textarea>' +
    '</body></html>';
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.org/app/index.html' });
  const win = dom.window;
  win.__EDUQUEST_SUPABASE_URL__ = '';
  win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };
  win.DBService = { initRemote: async () => {}, read: () => null, write: () => {} };
  // state-manager.js's init() falls back to cloning the bare global
  // DEFAULT_DB when DBService.read() returns empty — neither the
  // ORIGINAL chain here nor the BRIDGE's combined bundle includes
  // db-schema.js (logger.js doesn't need it), so window.DEFAULT_DB
  // would otherwise never exist. A minimal stub satisfies init() on
  // both sides identically; this file never reads DEFAULT_DB itself.
  win.DEFAULT_DB = { students: [], pointLog: [], recitationLog: [] };
  let uidCounter = 0;
  win.uid = () => 'UID' + (++uidCounter);
  win.nowStr = () => '2026-08-30T12:00:00.000Z';
  win.__toastCalls = [];
  win.toast = (msg) => { win.__toastCalls.push(msg); };
  win.__renderCalls = 0;
  win.renderRfidScanner = () => { win.__renderCalls++; };
  win._esc = function (s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  return win;
}

async function evalFullOriginalChain(win) {
  const files = ['supabase-client.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'repository/table-sync.js', 'db-service.js', 'modules/core/state-manager.js', 'student-stats.js', 'modules/recitation/logger.js'];
  for (const f of files) win.eval(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
  await win.AppStore.ready;
}

async function evalBridge(win) {
  const supabaseClientSrc = fs.readFileSync(path.join(__dirname, '..', 'supabase-client.js'), 'utf8');
  win.eval(supabaseClientSrc);
  const bridgeSrc = fs.readFileSync(path.join(__dirname, 'test-helpers', 'logger-combined-bundle.js'), 'utf8');
  win.eval(bridgeSrc);
  await win.AppStore.ready;
}

async function seedStudent(win, overrides) {
  await win.AppStore.ready;
  win.AppStore.updateState(draft => {
    draft.students = [Object.assign({ id: 's1', name: 'Ana "Cruz" <3>', xp: 100, coins: 20 }, overrides || {})];
    draft.recitationLog = [];
    draft.pointLog = [];
  }, { type: 'test:seed' });
}

function setInputs(win, { studentId, pts, note }) {
  const sel = win.document.getElementById('rec-student');
  if (!sel.querySelector(`option[value="${studentId}"]`)) {
    const opt = win.document.createElement('option');
    opt.value = studentId;
    sel.appendChild(opt);
  }
  sel.value = studentId;
  win.document.getElementById('rec-pts').value = pts;
  win.document.getElementById('rec-note').value = note || '';
}

async function runScenarios(win) {
  const results = {};

  // --- Scenario 1: basic log with a note ---
  await seedStudent(win, { xp: 100 });
  setInputs(win, { studentId: 's1', pts: '15', note: '  Great answer  ' });
  win.logRecitation();
  results.basic = {
    xp: win.AppStore.getStudent('s1').xp,
    recitationLog: win.AppStore.getSlice(s => s.recitationLog),
    pointLog: win.AppStore.getSlice(s => s.pointLog),
    toastCalls: win.__toastCalls.slice(),
    renderCalls: win.__renderCalls,
  };

  // --- Scenario 2: no note -> pointLog "what" has no trailing colon ---
  await seedStudent(win, { xp: 50 });
  win.__toastCalls.length = 0; win.__renderCalls = 0;
  setInputs(win, { studentId: 's1', pts: '8', note: '' });
  win.logRecitation();
  results.noNote = {
    pointLogWhat: win.AppStore.getSlice(s => s.pointLog)[0].what,
    recitationNote: win.AppStore.getSlice(s => s.recitationLog)[0].note,
  };

  // --- Scenario 3: invalid/empty pts input -> defaults to 10 ---
  await seedStudent(win, { xp: 0 });
  win.__toastCalls.length = 0; win.__renderCalls = 0;
  setInputs(win, { studentId: 's1', pts: 'not-a-number', note: '' });
  win.logRecitation();
  results.invalidPts = {
    xp: win.AppStore.getStudent('s1').xp,
    pointLogPts: win.AppStore.getSlice(s => s.pointLog)[0].pts,
  };

  // --- Scenario 4: unknown student id -> early return, nothing happens ---
  await seedStudent(win, { xp: 100 });
  win.__toastCalls.length = 0; win.__renderCalls = 0;
  setInputs(win, { studentId: 'does-not-exist', pts: '10', note: '' });
  let threw = false;
  try { win.logRecitation(); } catch (e) { threw = true; }
  results.unknownStudent = {
    threw,
    xpUnchanged: win.AppStore.getStudent('s1').xp === 100,
    recitationLogUnchanged: win.AppStore.getSlice(s => s.recitationLog).length === 0,
    toastCalls: win.__toastCalls.length,
    renderCalls: win.__renderCalls,
  };

  // --- Scenario 5: two consecutive logs both unshift (newest first) ---
  await seedStudent(win, { xp: 0 });
  win.__toastCalls.length = 0; win.__renderCalls = 0;
  setInputs(win, { studentId: 's1', pts: '5', note: 'first' });
  win.logRecitation();
  setInputs(win, { studentId: 's1', pts: '3', note: 'second' });
  win.logRecitation();
  const log = win.AppStore.getSlice(s => s.recitationLog);
  results.unshiftOrder = { firstEntryNote: log[0].note, secondEntryNote: log[1].note, count: log.length, finalXp: win.AppStore.getStudent('s1').xp };

  return results;
}

function normalizeTimestamps(results) {
  // `createdAt: new Date().toISOString()` in the source uses a real
  // wall-clock Date, not the nowStr() window-fallback — inherently
  // non-deterministic across two separate runs a few ms apart. Not a
  // real correctness signal; normalize before comparing.
  const clone = JSON.parse(JSON.stringify(results));
  if (clone.basic && clone.basic.pointLog) {
    clone.basic.pointLog.forEach(p => { p.createdAt = 'NORMALIZED'; });
  }
  return clone;
}

async function main() {
  const winO = makeWindow();
  await evalFullOriginalChain(winO);
  const resultOriginal = normalizeTimestamps(await runScenarios(winO));

  const winB = makeWindow();
  await evalBridge(winB);
  const resultBridge = normalizeTimestamps(await runScenarios(winB));

  // jsdom cross-realm gotcha (documented in MEMORY.md): compare via
  // JSON.stringify rather than assert.deepStrictEqual.
  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original at every step');

  // Sanity checks against the original's real values.
  assert.strictEqual(resultOriginal.basic.xp, 115, 'sanity: xp increases by pts');
  assert.strictEqual(resultOriginal.basic.recitationLog[0].pts, 15, 'sanity: recitationLog entry has the right pts');
  assert.strictEqual(resultOriginal.basic.recitationLog[0].note, 'Great answer', 'sanity: note is trimmed');
  assert.ok(resultOriginal.basic.recitationLog[0].id.startsWith('rec_'), 'sanity: recitationLog id prefix');
  assert.ok(resultOriginal.basic.pointLog[0].id.startsWith('pl_'), 'sanity: pointLog id prefix');
  assert.strictEqual(resultOriginal.basic.pointLog[0].what, 'Recitation: Great answer', 'sanity: pointLog "what" includes the note');
  assert.strictEqual(resultOriginal.basic.pointLog[0].when, 'Just now', 'sanity: pointLog uses the literal "Just now"');
  assert.strictEqual(resultOriginal.basic.toastCalls.length, 1, 'sanity: exactly one toast fired');
  assert.ok(resultOriginal.basic.toastCalls[0].includes('+15 pts'), 'sanity: toast includes the points awarded');
  assert.ok(resultOriginal.basic.toastCalls[0].includes('Ana &quot;Cruz&quot; &lt;3&gt;'), 'sanity: toast escapes the student name via _esc');
  assert.strictEqual(resultOriginal.basic.renderCalls, 1, 'sanity: renderRfidScanner called once');

  assert.strictEqual(resultOriginal.noNote.pointLogWhat, 'Recitation', 'sanity: no note -> plain "Recitation" with no trailing colon');
  assert.strictEqual(resultOriginal.noNote.recitationNote, '', 'sanity: empty note stored as empty string');

  assert.strictEqual(resultOriginal.invalidPts.xp, 10, 'sanity: invalid pts input defaults to 10');
  assert.strictEqual(resultOriginal.invalidPts.pointLogPts, 10, 'sanity: default pts value is used consistently');

  assert.strictEqual(resultOriginal.unknownStudent.threw, false, 'sanity: unknown student id does not throw');
  assert.strictEqual(resultOriginal.unknownStudent.xpUnchanged, true, 'sanity: unknown student id -> no xp mutation');
  assert.strictEqual(resultOriginal.unknownStudent.recitationLogUnchanged, true, 'sanity: unknown student id -> no log entry created');
  assert.strictEqual(resultOriginal.unknownStudent.toastCalls, 0, 'sanity: unknown student id -> no toast');
  assert.strictEqual(resultOriginal.unknownStudent.renderCalls, 0, 'sanity: unknown student id -> no render call');

  assert.strictEqual(resultOriginal.unshiftOrder.firstEntryNote, 'second', 'sanity: newest entry unshifted to the front');
  assert.strictEqual(resultOriginal.unshiftOrder.secondEntryNote, 'first', 'sanity: older entry pushed back');
  assert.strictEqual(resultOriginal.unshiftOrder.count, 2, 'sanity: both entries present');
  assert.strictEqual(resultOriginal.unshiftOrder.finalXp, 8, 'sanity: xp accumulates across consecutive calls');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('logger.js: xp mutation, recitationLog/pointLog shape (id prefixes, note trimming, "what"');
  console.log('formatting with/without a note), default-pts fallback, the unknown-student early return,');
  console.log('unshift ordering across consecutive calls, toast wording/escaping, and the render-refresh');
  console.log('call all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
