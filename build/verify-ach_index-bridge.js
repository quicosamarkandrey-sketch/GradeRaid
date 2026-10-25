// Phase 7 (Stream D) — equivalence check for modules/achievements/ach_index.js.
//
// Same overall shape as shop_index.js (file 9/30): almost entirely load-time
// behavior, so each scenario builds a fresh pair of jsdom windows (original
// vs bridge, the bridge side loading through the REAL production bridge) and
// compares what loading left behind. See that file's script for the general
// approach (EXPECTED list parsed from source, typeof-quirk coverage, CSS
// idempotence, migration slice/event coverage).
//
// The one behavior unique to this file: the conditional
// `window.achClaimReward` backwards-compat fallback (restructured in the
// twin into a real top-level function + a separate conditional assignment —
// see the src file's header). Scenarios cover: no pre-existing
// achClaimReward (fallback installed, and calling it warns with the achId);
// a real one already present (left untouched, fallback NOT installed even
// though the module still exports the fallback function itself).
//
// Real import: AppStore (state-manager.js). state-manager's own init() needs
// a bare DBService stand-in, pre-stubbed before any eval.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const ORIG_PATH = path.join(__dirname, '..', 'modules', 'achievements', 'ach_index.js');
const origSrc = fs.readFileSync(ORIG_PATH, 'utf8');
const EXPECTED = (() => {
  const m = /const EXPECTED = \[([\s\S]*?)\n  \];/.exec(origSrc);
  assert.ok(m, 'could not find the EXPECTED array in the original');
  return [...m[1].matchAll(/'([A-Za-z_][\w]*)'/g)].map(x => x[1]);
})();
assert.ok(EXPECTED.length > 15 && new Set(EXPECTED).size === EXPECTED.length, 'sanity: parsed a plausible, duplicate-free EXPECTED list, got ' + EXPECTED.length);

const SLICES = ['achievements', 'achievementUnlocks', 'achievementCategories'];

function makeWindow(scn) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  win.DEFAULT_DB = Object.assign({ students: [] }, scn.db || {});
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };
  for (const [name, val] of Object.entries(scn.defs || {})) win[name] = val();
  if (scn.preexistingClaimReward) {
    win.__claimCalls = [];
    win.achClaimReward = function (achId) { win.__claimCalls.push(achId); return 'real-impl'; };
  }
  if (scn.preexistingStyle) {
    const st = win.document.createElement('style');
    st.id = 'achievements-module-css';
    st.textContent = '/* pre-existing */';
    win.document.head.appendChild(st);
  }
  const rec = [];
  win.console.log = (...a) => rec.push({ m: 'log', a: a.map(String) });
  win.console.warn = (...a) => rec.push({ m: 'warn', a: a.map(String) });
  win.console.error = (...a) => rec.push({ m: 'error', a: a.map(x => (x && typeof x === 'object' && typeof x.length === 'number') ? Array.from(x) : String(x)) });
  return { win, rec };
}

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
async function evalOriginal(win) {
  win.eval(read('modules/core/state-manager.js'));
  win.eval(read('modules/achievements/ach_index.js'));
}
async function evalBridge(win) {
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'ach_index-combined-bundle.js'), 'utf8'));
}

const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
const isOwn = e => e.a.some(x => typeof x === 'string' && x.includes('achievements/index.js'));

async function runScenario(scn, load) {
  const { win, rec } = makeWindow(scn);
  await load(win);
  const events = [];
  win.AppStore.subscribe('verify-ach-index', (state, ev) => { if (ev && ev.type && ev.type.startsWith('achievements:')) events.push({ type: ev.type, payload: ev.payload }); });
  await win.AppStore.ready;
  await new Promise(r => setTimeout(r, 30));

  // exercise achClaimReward regardless of which branch installed it
  let claimResult, claimWarned = false;
  const preCallWarnCount = rec.filter(e => e.m === 'warn').length;
  try { claimResult = win.achClaimReward('ACH7'); } catch (e) { claimResult = 'THREW:' + e.message; }
  claimWarned = rec.filter(e => e.m === 'warn').length > preCallWarnCount;

  const styles = [...win.document.querySelectorAll('style#achievements-module-css')];
  const slices = win.AppStore.getSlice(s => Object.fromEntries(SLICES.map(k => [k, s[k]])));
  return clean({
    styleCount: styles.length,
    styleText: styles.map(s => s.textContent),
    ownLogs: rec.filter(isOwn),
    version: win.__ACHIEVEMENTS_MODULE_VERSION__,
    events,
    slices,
    claimResult,
    claimWarned,
    externalClaimCallsRecorded: win.__claimCalls || null,
  });
}

const fnDef = () => function () {};
const objDef = () => ({});
const allDefs = () => Object.fromEntries(EXPECTED.map(n => [n, /^[A-Z_]+$/.test(n) ? objDef : fnDef]));

const SCENARIOS = {
  everythingMissingNoClaimReward: { defs: {}, db: {} },
  allPresentAllSlicesPresent: {
    defs: allDefs(),
    db: { achievements: [], achievementUnlocks: {}, achievementCategories: ['X'] },
  },
  mixedGuardPartialSlices: {
    defs: (() => {
      const d = allDefs();
      d[EXPECTED[0]] = () => 'a string'; // typeof string -> MISSING
      d[EXPECTED[1]] = () => null;       // typeof object -> counted PRESENT
      delete d[EXPECTED[2]];             // undefined -> MISSING
      return d;
    })(),
    db: { achievements: [{ id: 'a1' }] },
  },
  claimRewardAlreadyReal: { defs: allDefs(), db: {}, preexistingClaimReward: true },
  falsyButPresentSlices: {
    // `!current[k]` treats ANY falsy value as missing (and resets it) — not
    // just `undefined`. null/0/'' must be treated the same as absent.
    defs: allDefs(),
    db: { achievements: null, achievementUnlocks: 0, achievementCategories: '' },
  },
  preexistingCssId: { defs: allDefs(), db: {}, preexistingStyle: true },
};

async function main() {
  const results = {};
  for (const [name, scn] of Object.entries(SCENARIOS)) {
    const a = await runScenario(scn, evalOriginal);
    const b = await runScenario(scn, evalBridge);
    assert.deepStrictEqual(b, a, `scenario "${name}": bridge must exactly match the original`);
    results[name] = a;
  }

  const R = results;
  const cssOnce = r => assert.strictEqual(r.styleCount, 1);

  const m = R.everythingMissingNoClaimReward;
  cssOnce(m);
  assert.ok(m.styleText[0].includes('.ach-nav-badge') && m.styleText[0].includes('.ach-toggle-btn:hover'), 'CSS injected in full');
  assert.strictEqual(m.ownLogs.length, 1); assert.strictEqual(m.ownLogs[0].m, 'error');
  // achClaimReward is itself installed by the fallback BEFORE the verify
  // block runs, so it's never actually reported missing even here.
  assert.deepStrictEqual(m.ownLogs[0].a[1], EXPECTED.filter(n => n !== 'achClaimReward'), 'MISSING list is every expected name except achClaimReward (the fallback already installed it), in order');
  assert.strictEqual(m.version, '1.0.0');
  assert.deepStrictEqual(m.events, [{ type: 'achievements:libraries-initialized', payload: { keys: SLICES } }]);
  assert.deepStrictEqual([m.slices.achievements, m.slices.achievementUnlocks, m.slices.achievementCategories],
    [[], {}, ['Quests', 'Attendance', 'Combat', 'Social', 'Milestones', 'Hidden', 'Special']]);
  assert.strictEqual(m.claimResult, undefined, 'the fallback stub itself returns nothing');
  assert.strictEqual(m.claimWarned, true, 'no achClaimReward present -> the fallback installs and warns when called');

  const p = R.allPresentAllSlicesPresent;
  cssOnce(p);
  assert.deepStrictEqual(p.ownLogs, [{ m: 'log', a: ['[EduQuest] achievements/index.js — All exports verified ✅'] }]);
  assert.deepStrictEqual(p.events, [], 'all three slices already exist -> no event');
  assert.strictEqual(p.claimWarned, false, 'allDefs() already set window.achClaimReward to a stub function before load -> the fallback never installs');

  const x = R.mixedGuardPartialSlices;
  assert.deepStrictEqual(x.ownLogs[0].a[1], [EXPECTED[0], EXPECTED[2]], 'string and undefined are MISSING; null (typeof object) is not');
  assert.deepStrictEqual(x.events, [{ type: 'achievements:libraries-initialized', payload: { keys: ['achievementUnlocks', 'achievementCategories'] } }]);
  assert.deepStrictEqual(x.slices.achievements, [{ id: 'a1' }], 'pre-existing slice data preserved');

  const c = R.claimRewardAlreadyReal;
  assert.strictEqual(c.claimWarned, false, 'a real achClaimReward already present -> the guard never installs the fallback');
  assert.strictEqual(c.claimResult, 'real-impl');
  assert.deepStrictEqual(c.externalClaimCallsRecorded, ['ACH7'], 'the pre-existing real function is the one actually invoked, untouched');

  const fs_ = R.falsyButPresentSlices;
  assert.deepStrictEqual(fs_.events, [{ type: 'achievements:libraries-initialized', payload: { keys: SLICES } }], 'null/0/\'\' are all falsy -> all three reset to defaults');
  assert.deepStrictEqual([fs_.slices.achievements, fs_.slices.achievementUnlocks], [[], {}]);

  const cs = R.preexistingCssId;
  cssOnce(cs);
  assert.deepStrictEqual(cs.styleText, ['/* pre-existing */']);

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('Original ach_index.js (via the real state-manager chain) and the bundled src/');
  console.log('twin, loaded through the REAL production bridge, agree across ' + Object.keys(SCENARIOS).length + ' fresh-load');
  console.log('scenarios on:');
  console.log(' - CSS injection (full text) and the #achievements-module-css idempotence guard');
  console.log(' - the load-order guard over all ' + EXPECTED.length + ' expected names, incl. its typeof quirks');
  console.log(' - window.__ACHIEVEMENTS_MODULE_VERSION__ via the bridge\'s MODULE_VERSION mapping');
  console.log(' - the deferred achievements-slice migration: created slices, preserved data, event');
  console.log(' - the conditional achClaimReward fallback: installs + warns when absent, never');
  console.log('   overrides a real pre-existing implementation');
}

main().catch(e => { console.error(e); process.exit(1); });
