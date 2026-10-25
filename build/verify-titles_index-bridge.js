// Phase 7 (Stream D) — equivalence check for modules/titles/titles_index.js.
//
// Same shape and approach as shop_index.js/ach_index.js (files 9–10): almost
// entirely load-time behavior, so each scenario builds a fresh pair of jsdom
// windows (original vs bridge, bridge side loading through the REAL
// production bridge) and compares what loading left behind. See those
// files' scripts for the general approach (EXPECTED list parsed from
// source, typeof-quirk coverage, CSS idempotence, migration slice/event
// coverage) — reused here near-verbatim, no file-specific quirks beyond the
// slice names and the 3-slice migration payload.
//
// Real import: AppStore (state-manager.js, zero imports of its own).
// state-manager's own init() needs a bare DBService stand-in, pre-stubbed
// before any eval.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const ORIG_PATH = path.join(__dirname, '..', 'modules', 'titles', 'titles_index.js');
const origSrc = fs.readFileSync(ORIG_PATH, 'utf8');
const EXPECTED = (() => {
  const m = /const EXPECTED = \[([\s\S]*?)\n  \];/.exec(origSrc);
  assert.ok(m, 'could not find the EXPECTED array in the original');
  return [...m[1].matchAll(/'([A-Za-z_][\w]*)'/g)].map(x => x[1]);
})();
assert.ok(EXPECTED.length > 30 && new Set(EXPECTED).size === EXPECTED.length, 'sanity: parsed a plausible, duplicate-free EXPECTED list, got ' + EXPECTED.length);

const SLICES = ['titles', 'titleUnlocks', 'equippedTitles'];

function makeWindow(scn) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  win.DEFAULT_DB = Object.assign({ students: [] }, scn.db || {});
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };
  for (const [name, val] of Object.entries(scn.defs || {})) win[name] = val();
  if (scn.preexistingStyle) {
    const st = win.document.createElement('style');
    st.id = 'titles-module-css';
    st.textContent = '/* pre-existing */';
    win.document.head.appendChild(st);
  }
  const rec = [];
  win.console.log = (...a) => rec.push({ m: 'log', a: a.map(String) });
  win.console.warn = () => {};
  win.console.error = (...a) => rec.push({ m: 'error', a: a.map(x => (x && typeof x === 'object' && typeof x.length === 'number') ? Array.from(x) : String(x)) });
  return { win, rec };
}

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
async function evalOriginal(win) {
  win.eval(read('modules/core/state-manager.js'));
  win.eval(read('modules/titles/titles_index.js'));
}
async function evalBridge(win) {
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'titles_index-combined-bundle.js'), 'utf8'));
}

const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
const isOwn = e => e.a.some(x => typeof x === 'string' && x.includes('titles/index.js'));

async function runScenario(scn, load) {
  const { win, rec } = makeWindow(scn);
  await load(win);
  const events = [];
  win.AppStore.subscribe('verify-titles-index', (state, ev) => { if (ev && ev.type && ev.type.startsWith('titles:')) events.push({ type: ev.type, payload: ev.payload }); });
  await win.AppStore.ready;
  await new Promise(r => setTimeout(r, 30));
  const styles = [...win.document.querySelectorAll('style#titles-module-css')];
  const slices = win.AppStore.getSlice(s => Object.fromEntries(SLICES.map(k => [k, s[k]])));
  return clean({
    styleCount: styles.length,
    styleText: styles.map(s => s.textContent),
    ownLogs: rec.filter(isOwn),
    version: win.__TITLES_MODULE_VERSION__,
    events,
    slices,
  });
}

const fnDef = () => function () {};
const objDef = () => ({});
const allDefs = () => Object.fromEntries(EXPECTED.map(n => [n, /^[A-Z_]+$/.test(n) ? objDef : fnDef]));

const SCENARIOS = {
  everythingMissing: { defs: {}, db: {} },
  allPresentAllSlicesPresent: {
    defs: allDefs(),
    db: { titles: [], titleUnlocks: {}, equippedTitles: {} },
  },
  mixedGuardPartialSlices: {
    defs: (() => {
      const d = allDefs();
      d[EXPECTED[0]] = () => 'a string'; // typeof string -> MISSING
      d[EXPECTED[1]] = () => null;       // typeof object -> counted PRESENT
      delete d[EXPECTED[2]];             // undefined -> MISSING
      return d;
    })(),
    db: { titles: [{ id: 't1' }] },
  },
  falsyButPresentSlices: {
    // `!current[k]` treats ANY falsy value as missing (and resets it) —
    // not just `undefined`. null/0/'' must be treated the same as absent.
    defs: allDefs(),
    db: { titles: null, titleUnlocks: 0, equippedTitles: '' },
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

  const m = R.everythingMissing;
  cssOnce(m);
  assert.ok(m.styleText[0].includes('.ts-badge-wrap') && m.styleText[0].includes('z-index'), 'CSS injected in full');
  assert.strictEqual(m.ownLogs.length, 1); assert.strictEqual(m.ownLogs[0].m, 'error');
  assert.deepStrictEqual(m.ownLogs[0].a[1], EXPECTED, 'MISSING list is every expected name, in order');
  assert.strictEqual(m.version, '1.0.0');
  assert.deepStrictEqual(m.events, [{ type: 'titles:libraries-initialized', payload: { keys: SLICES } }]);
  assert.deepStrictEqual([m.slices.titles, m.slices.titleUnlocks, m.slices.equippedTitles], [[], {}, {}]);

  const p = R.allPresentAllSlicesPresent;
  cssOnce(p);
  assert.deepStrictEqual(p.ownLogs, [{ m: 'log', a: ['[EduQuest] titles/index.js — All exports verified ✅'] }]);
  assert.deepStrictEqual(p.events, [], 'all three slices already exist -> no event');

  const x = R.mixedGuardPartialSlices;
  assert.deepStrictEqual(x.ownLogs[0].a[1], [EXPECTED[0], EXPECTED[2]], 'string and undefined are MISSING; null (typeof object) is not');
  assert.deepStrictEqual(x.events, [{ type: 'titles:libraries-initialized', payload: { keys: ['titleUnlocks', 'equippedTitles'] } }]);
  assert.deepStrictEqual(x.slices.titles, [{ id: 't1' }], 'pre-existing slice data preserved');

  const f = R.falsyButPresentSlices;
  assert.deepStrictEqual(f.events, [{ type: 'titles:libraries-initialized', payload: { keys: SLICES } }], 'null/0/\'\' are all falsy -> all three reset to defaults');
  assert.deepStrictEqual([f.slices.titles, f.slices.titleUnlocks], [[], {}]);

  const c = R.preexistingCssId;
  cssOnce(c);
  assert.deepStrictEqual(c.styleText, ['/* pre-existing */']);

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('Original titles_index.js (via the real state-manager chain) and the bundled');
  console.log('src/ twin, loaded through the REAL production bridge, agree across ' + Object.keys(SCENARIOS).length + ' fresh-load');
  console.log('scenarios on:');
  console.log(' - CSS injection (full text) and the #titles-module-css idempotence guard');
  console.log(' - the load-order guard over all ' + EXPECTED.length + ' expected names, incl. its typeof quirks');
  console.log(' - window.__TITLES_MODULE_VERSION__ via the bridge\'s MODULE_VERSION mapping');
  console.log(' - the deferred titles-slice migration: created slices, preserved data, exact event');
}

main().catch(e => { console.error(e); process.exit(1); });
