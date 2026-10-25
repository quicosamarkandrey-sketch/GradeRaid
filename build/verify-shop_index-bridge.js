// Phase 7 (Stream D) — equivalence check for modules/shop/shop_index.js.
//
// This file is almost entirely LOAD-TIME behavior, so every scenario builds a
// fresh pair of jsdom windows (original vs bridge) and compares what loading
// left behind:
//   * the shop CSS <style id="shop-module-css"> (count, id, full textContent),
//     including the pre-existing-id idempotence guard;
//   * the load-order guard's console output (MISSING list vs "All exports
//     verified") across scenarios where every expected name is absent, all are
//     present, and a mixed set exercising the guard's exact predicate
//     (`typeof !== 'function' && typeof !== 'object'`): a string counts as
//     missing, `null` (typeof 'object') counts as PRESENT, `undefined` missing;
//   * window.__SHOP_MODULE_VERSION__ (the REAL production bridge is imported by
//     the test bundle, so the MODULE_VERSION -> window-name mapping is under test);
//   * the deferred AppStore.ready.then(shopMigrateDB) migration: which slices
//     get created, that pre-existing slice data is preserved, the exact event
//     emitted (type + payload.keys order), and that NO event fires when all six
//     slices already exist (early return).
//
// Real import: AppStore (state-manager.js, zero imports of its own). state-
// manager's own init() needs a bare DBService stand-in, pre-stubbed before any
// eval (see MEMORY.md). currentUser is not referenced by this file.
//
// The ~80-name EXPECTED list is PARSED from the original source, not retyped,
// so the test can't drift from the file it verifies.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const ORIG_PATH = path.join(__dirname, '..', 'modules', 'shop', 'shop_index.js');
const origSrc = fs.readFileSync(ORIG_PATH, 'utf8');
const EXPECTED = (() => {
  const m = /const EXPECTED = \[([\s\S]*?)\n  \];/.exec(origSrc);
  assert.ok(m, 'could not find the EXPECTED array in the original');
  return [...m[1].matchAll(/'([A-Za-z_][\w]*)'/g)].map(x => x[1]);
})();
assert.ok(EXPECTED.length > 70 && new Set(EXPECTED).size === EXPECTED.length, 'sanity: parsed a plausible, duplicate-free EXPECTED list, got ' + EXPECTED.length);

const SLICES = ['store', 'orders', 'redemptions', 'inventory', 'promotions', 'promoAnalytics'];

function makeWindow(scn) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  win.DEFAULT_DB = Object.assign({ students: [] }, scn.db || {});
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };
  // window[name] values for the load-order guard
  for (const [name, val] of Object.entries(scn.defs || {})) win[name] = val();
  if (scn.preexistingStyle) {
    const st = win.document.createElement('style');
    st.id = 'shop-module-css';
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
  win.eval(read('modules/shop/shop_index.js'));
}
async function evalBridge(win) {
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'shop_index-combined-bundle.js'), 'utf8'));
}

const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
const isShop = e => e.a.some(x => typeof x === 'string' && x.includes('shop/index.js'));

async function runScenario(scn, load) {
  const { win, rec } = makeWindow(scn);
  await load(win);
  const events = [];
  win.AppStore.subscribe('verify-shop-index', (state, ev) => { if (ev && ev.type && ev.type.startsWith('shop:')) events.push({ type: ev.type, payload: ev.payload }); });
  await win.AppStore.ready;
  await new Promise(r => setTimeout(r, 30)); // let the .then(shopMigrateDB) microtask + any emit settle
  const styles = [...win.document.querySelectorAll('style#shop-module-css')];
  const slices = win.AppStore.getSlice(s => Object.fromEntries(SLICES.map(k => [k, s[k]])));
  return clean({
    styleCount: styles.length,
    styleText: styles.map(s => s.textContent),
    headStyleCount: win.document.head.querySelectorAll('style').length,
    ownLogs: rec.filter(isShop),
    version: win.__SHOP_MODULE_VERSION__,
    events,
    slices,
  });
}

const fnDef = () => function () {};
const objDef = () => ({});
const allDefs = () => Object.fromEntries(EXPECTED.map(n => [n, /^[A-Z_]+$/.test(n) || n === 'PROMO_TYPES' ? objDef : fnDef]));

const SCENARIOS = {
  everythingMissing: { defs: {}, db: {} },
  allPresentAllSlicesPresent: {
    defs: allDefs(),
    db: { store: [], orders: [], redemptions: [], inventory: {}, promotions: [], promoAnalytics: {} },
  },
  mixedGuardAndPartialSlices: {
    defs: (() => {
      const d = allDefs();
      d[EXPECTED[0]] = () => 'a string';         // typeof string  -> counted MISSING
      d[EXPECTED[1]] = () => null;                // typeof object  -> counted PRESENT (quirk)
      delete d[EXPECTED[2]];                      // undefined      -> MISSING
      d[EXPECTED[3]] = () => 42;                  // typeof number  -> MISSING
      return d;
    })(),
    // store+orders exist with real data; the other four are absent
    db: { store: [{ id: 'p1', name: 'Kept' }], orders: [{ orderId: 'o1' }] },
  },
  falsyButPresentSlices: {
    // `!current[k]` treats ANY falsy value as missing — including an existing
    // empty-string/0/null — but an empty array/object is truthy and is kept.
    defs: allDefs(),
    db: { store: [], orders: null, redemptions: 0, inventory: {}, promotions: '', promoAnalytics: {} },
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

  // ── hand-computed sanity on the ORIGINAL's results ──
  const R = results;
  const cssOnce = r => { assert.strictEqual(r.styleCount, 1); assert.strictEqual(r.headStyleCount, 1); };

  // everything missing
  const m = R.everythingMissing;
  cssOnce(m);
  assert.ok(m.styleText[0].includes('.store-grid{display:grid') && m.styleText[0].includes('.stock-save-btn:hover'), 'CSS block injected in full (first and last rules)');
  assert.strictEqual(m.ownLogs.length, 1);
  assert.strictEqual(m.ownLogs[0].m, 'error');
  assert.deepStrictEqual(m.ownLogs[0].a[1], EXPECTED, 'MISSING list is every expected name, in the original order');
  assert.strictEqual(m.version, '1.0.0', 'version is set even when the guard reports missing exports');
  assert.deepStrictEqual(m.events, [{ type: 'shop:libraries-initialized', payload: { keys: SLICES } }], 'all six slices missing -> one event listing them in fixed order');
  assert.deepStrictEqual([m.slices.store, m.slices.orders, m.slices.redemptions, m.slices.inventory, m.slices.promotions, m.slices.promoAnalytics], [[], [], [], {}, [], {}], 'array/object defaults per slice');

  // all present
  const p = R.allPresentAllSlicesPresent;
  cssOnce(p);
  assert.deepStrictEqual(p.ownLogs, [{ m: 'log', a: ['[EduQuest] shop/index.js — All exports verified ✅'] }]);
  assert.strictEqual(p.version, '1.0.0');
  assert.deepStrictEqual(p.events, [], 'all six slices already exist -> early return, NO event emitted');

  // mixed guard + partial slices
  const x = R.mixedGuardAndPartialSlices;
  assert.deepStrictEqual(x.ownLogs[0].a[1], [EXPECTED[0], EXPECTED[2], EXPECTED[3]], 'string/undefined/number are MISSING; null (typeof object) is NOT');
  assert.ok(!x.ownLogs[0].a[1].includes(EXPECTED[1]), 'null counts as present — the guard\'s typeof-object quirk');
  assert.deepStrictEqual(x.events, [{ type: 'shop:libraries-initialized', payload: { keys: ['redemptions', 'inventory', 'promotions', 'promoAnalytics'] } }], 'only the four absent slices, in fixed order');
  assert.deepStrictEqual(x.slices.store, [{ id: 'p1', name: 'Kept' }], 'pre-existing slice data preserved');
  assert.deepStrictEqual(x.slices.orders, [{ orderId: 'o1' }]);
  assert.deepStrictEqual(x.slices.inventory, {});

  // falsy values are treated as missing (and reset), truthy empties are kept
  const f = R.falsyButPresentSlices;
  assert.deepStrictEqual(f.events, [{ type: 'shop:libraries-initialized', payload: { keys: ['orders', 'redemptions', 'promotions'] } }], 'null, 0 and "" are falsy -> missing; [] and {} are truthy -> kept');
  assert.deepStrictEqual([f.slices.orders, f.slices.redemptions, f.slices.promotions], [[], [], []]);

  // pre-existing CSS id: guard returns early, original element untouched, no second one
  const c = R.preexistingCssId;
  cssOnce(c);
  assert.deepStrictEqual(c.styleText, ['/* pre-existing */'], 'the pre-existing #shop-module-css is left exactly as it was');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('Original shop_index.js (via the real state-manager chain) and the bundled src/ twin,');
  console.log('loaded through the REAL production bridge, agree across ' + Object.keys(SCENARIOS).length + ' fresh-load scenarios on:');
  console.log(' - CSS injection (full text) and the #shop-module-css idempotence guard');
  console.log(' - the load-order guard over all ' + EXPECTED.length + ' expected names, incl. its typeof quirks');
  console.log(' - window.__SHOP_MODULE_VERSION__ via the bridge\'s MODULE_VERSION mapping');
  console.log(' - the deferred shop-slice migration: created slices, preserved data, exact event, early return');
}

main().catch(e => { console.error(e); process.exit(1); });
