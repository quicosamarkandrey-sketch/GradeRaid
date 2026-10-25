// Phase 7 (Stream D) — equivalence check for modules/leaderboard/admin-leaderboard.js.
//
// ORIGINAL side: real classic files eval'd in production order (state-manager,
// dom, utils, eql-engine, admin-leaderboard). BRIDGE side: one esbuild bundle
// (test-helpers/admin-leaderboard-combined-bundle.js) whose entry imports the
// REAL production bridge, so it exercises the real src twin + real imports of
// AppStore / dom.js / eql-engine.js. Same starter DOM, same fixtures, same calls.
//
// Bare globals stubbed identically on both sides: DBService (state-manager's
// init needs a DBService-shaped stand-in), DEFAULT_DB, and ActiveSection left
// undefined (eqlBuildCategory then falls back to the unscoped roster). `DB` is
// the real `var DB` slot that state-manager refreshes (window.DB = clone) after
// every committed updateState — so seeding via AppStore keeps DB in sync, as
// in production. Date is pinned (a deterministic subclass) because EQL.resetPeriod
// stamps new Date().toISOString().
//
// Checked, in order:
//  0. reverse-transform: rebuilding the literal original from the twin is
//     byte-identical (covers header-less prefix + whole IIFE body + tail).
//  1. load-time console output + the 6 exports exist as same-named functions.
//  2. renderAdminLeaderboards: missing page (console.error), default config,
//     disabled category, active resetAt badge, saved overrides (label/icon/
//     color), escaping (< > " in names), zero students ('—'), topScore >= 1000
//     (thousands separator), stats ordering.
//  3. eqlToggle both directions (on->off, off->on) incl. toast + re-render;
//     unknown key (EQL no-op, default label/icon).
//  4. eqlAdminPreview: >10 entries (slice boundary), ties (ranks 1,1,3,3,5),
//     rank exactly 3 vs 4 (top3 class + medal boundary), colour/initial/name
//     fallbacks, empty state, period vs all-time subtitle, 'md' modal size.
//  5. eqlAdminResetConfirm for every key + unknown key (+ `DB.leaderboardConfig`
//     undefined fallback), 'sm' modal size.
//  6. eqlDoReset / eqlDoClearReset: AppStore mutation, toast colour/text,
//     re-render, plus unknown key.
// Disclosed difference NOT compared: esbuild renames the inner named function
// expression (\`export const X = function X(){}\` -> fn.name 'X2') on the bundled side
// to avoid a binding clash; nothing in the repo reads these functions' .name.
// JSON.stringify-based clean() sidesteps the cross-jsdom-realm deepStrictEqual
// quirk. Disclosure: _fmtDate's catch branch is unreachable (Date +
// toLocaleDateString never throw for any input the callers can produce), so it
// is not exercised.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// ── 0. reverse transform ────────────────────────────────────────────────────
function reverseTransformCheck() {
  const orig = read('modules/leaderboard/admin-leaderboard.js');
  const twin = read('src/modules/leaderboard/admin-leaderboard.js');
  const OPEN = "(function () {\n  'use strict';\n\n";
  const CLOSE = "}());\n";
  const oi = orig.indexOf(OPEN);
  const origPrefix = orig.slice(0, oi);
  const imports = twin.slice(twin.indexOf(origPrefix) + origPrefix.length);
  const m = imports.match(/^((?:import [^\n]+\n)+\n)/);
  assert(m, 'twin must have an import block directly after the original header comment');
  assert.strictEqual(twin.indexOf(origPrefix) > 0, true, 'twin must carry the original prefix after its own header');
  let inner = imports.slice(m[1].length);
  assert(inner.endsWith('\n'), 'twin ends with a single trailing newline');
  inner = inner.slice(0, -1);
  // Re-indent every line EXCEPT those that start inside a template literal's raw
  // text (those were never dedented — their whitespace is runtime string content).
  const acorn = require('acorn');
  const bodyStart = twin.indexOf(inner);
  assert(bodyStart > 0 && twin.indexOf(inner, bodyStart + 1) === -1, 'inner located exactly once in twin');
  const quasis = [];
  for (const t of acorn.tokenizer(twin, { ecmaVersion: 'latest', sourceType: 'module' })) if (t.type.label === 'template') quasis.push([t.start, t.end]);
  const inQuasi = p => quasis.some(([x, y]) => p >= x && p < y);
  let off = bodyStart;
  inner = inner.split('\n').map(l => {
    const start = off; off += l.length + 1;
    return (l === '' || inQuasi(start)) ? l : '  ' + l;
  }).join('\n') + '\n';
  inner = inner.replace(/export const (\w+) = function /g, 'window.$1 = function ');
  const rebuilt = origPrefix + OPEN + inner + CLOSE;
  assert.strictEqual(rebuilt, orig, 'reversing the transform must reproduce the original byte-for-byte');
  assert.strictEqual((twin.match(/^export const /gm) || []).length, 6, 'exactly 6 exports (declaresCount 6)');
}

const STARTER_HTML = `<!doctype html><html><body>
  <div id="a-leaderboard"></div>
  <div id="toast"></div>
  <div id="modal-box" class="modal-box"></div>
  <div id="modal-content"></div>
  <div id="modal-overlay" style="display:none"></div>
</body></html>`;

const FIXED = 1767225600000; // 2026-01-01T00:00:00.000Z

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  win.eval(`(function(){ const R = Date; class D extends R { constructor(...a){ if (a.length) super(...a); else super(${FIXED}); } static now(){ return ${FIXED}; } } globalThis.Date = D; }());`);
  win.eval('var DB;');
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };
  win.DEFAULT_DB = { students: [], recitationLog: [], bossEvents: [], bossParticipants: {}, pointLog: [] };
  const logs = [], errors = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  win.console.error = (...a) => errors.push(a.join(' '));
  return { win, logs, errors };
}
async function evalOriginal(win) {
  win.eval(read('modules/core/state-manager.js'));
  win.eval(read('dom.js'));
  win.eval(read('utils.js'));
  win.eval(read('modules/leaderboard/eql-engine.js'));
  win.eval(read('modules/leaderboard/admin-leaderboard.js'));
  await win.AppStore.ready;
}
async function evalBridge(win) {
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'admin-leaderboard-combined-bundle.js'), 'utf8'));
  await win.AppStore.ready;
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v).replace(ISO, '<ISO>'));
const tick = () => new Promise(r => setTimeout(r, 5));

const modalSnap = win => ({
  visible: win.document.getElementById('modal-overlay').style.display,
  className: win.document.getElementById('modal-box').className,
  content: win.document.getElementById('modal-content').innerHTML,
});
const toastSnap = win => ({ visible: win.document.getElementById('toast').style.display, html: win.document.getElementById('toast').innerHTML });
const pageHtml = win => { const p = win.document.getElementById('a-leaderboard'); return p ? p.innerHTML : null; };
const cfgSnap = win => win.AppStore.getSlice(s => s.leaderboardConfig);
function resetUi(win) {
  win.document.getElementById('modal-overlay').style.display = 'none';
  win.document.getElementById('modal-content').innerHTML = '';
  win.document.getElementById('modal-box').className = 'modal-box';
  win.document.getElementById('toast').innerHTML = '';
  win.document.getElementById('toast').style.display = '';
}
function seed(win, { students, log, cfg }) {
  win.AppStore.updateState(d => {
    if (students) d.students = students;
    if (log) d.recitationLog = log;
    if (cfg) d.leaderboardConfig = cfg;
  }, { type: 'test:seed' });
}
const baseCfg = () => ({
  recitation: { enabled: true, resetAt: null, label: 'Recitation', icon: '🎤', color: '#4edea3' },
  boss:       { enabled: true, resetAt: null, label: 'Boss Raider', icon: '⚔️', color: '#EC4899' },
  academic:   { enabled: true, resetAt: null, label: 'Academic', icon: '📚', color: '#d0bcff' },
  overall:    { enabled: true, resetAt: null, label: 'Overall', icon: '🏆', color: '#ffb95f' },
});
const logEntry = (sid, pts, at) => ({ studentId: sid, pts, createdAt: at });

// 5 students with ties: scores 1500,1500,700,700,50 -> ranks 1,1,3,3,5
const TIED_STUDENTS = [
  { id: 's1', name: 'Ana', init: 'A', color: '#ff0000', classId: 'c1' },
  { id: 's2', name: 'Ben', classId: 'c1' },                                   // no color/init -> fallbacks
  { id: 's3', name: '<b>Cy</b>', init: 'C', color: '#00ff00', classId: 'c1' }, // escaping
  { id: 's4', name: 'Di "Q" & Co', init: 'D', color: '#0000ff', classId: 'c1' },
  { id: 's5', displayName: 'Gus', classId: 'c1' },                            // displayName only -> init '?'
];
const TIED_LOG = [
  logEntry('s1', 1500, '2026-01-05T00:00:00.000Z'), logEntry('s2', 1500, '2026-01-05T00:00:00.000Z'),
  logEntry('s3', 700, '2026-01-05T00:00:00.000Z'), logEntry('s4', 700, '2026-01-05T00:00:00.000Z'),
  logEntry('s5', 50, '2026-01-05T00:00:00.000Z'),
];
// 12 distinct students, scores 1200,1100,...,100 -> ranks 1..12 (slice(0,10) boundary, rank 3 vs 4)
const MANY_STUDENTS = Array.from({ length: 12 }, (_, i) => ({ id: 'm' + (i + 1), name: 'Stu' + (i + 1), init: 'S', color: '#8888' + (10 + i), classId: 'c1' }));
const MANY_LOG = MANY_STUDENTS.map((s, i) => logEntry(s.id, 1200 - i * 100, '2026-01-05T00:00:00.000Z'));
const NO_NAME_STUDENTS = [{ id: 'n1', classId: 'c1' }];

async function run(win, errors) {
  const out = {};
  const page = () => win.document.getElementById('a-leaderboard');
  const renderNow = async () => { win.renderAdminLeaderboards(); await win.AppStore.ready; await tick(); };

  // exports
  out.exports = ['renderAdminLeaderboards', 'eqlToggle', 'eqlAdminPreview', 'eqlAdminResetConfirm', 'eqlDoReset', 'eqlDoClearReset']
    .map(n => [n, typeof win[n]]);

  // ── renderAdminLeaderboards ──
  out.render = {};
  const holder = page(); holder.remove();
  win.renderAdminLeaderboards();
  await tick();
  out.render.missingPageErrors = errors.slice();
  win.document.body.insertBefore(holder, win.document.body.firstChild);

  seed(win, { students: [], log: [], cfg: baseCfg() });
  await renderNow();
  out.render.noStudents = pageHtml(win);

  seed(win, { students: TIED_STUDENTS, log: TIED_LOG, cfg: baseCfg() });
  await renderNow();
  out.render.tied = pageHtml(win);

  const c = baseCfg();
  c.boss.enabled = false;
  c.recitation.resetAt = '2026-01-03T00:00:00.000Z';
  c.academic.label = 'Acad <x>'; c.academic.icon = '🧪'; c.academic.color = '#123456';
  seed(win, { cfg: c });
  await renderNow();
  out.render.mixedConfig = pageHtml(win);

  // enabled: undefined must count as enabled (!== false)
  const c2 = baseCfg(); delete c2.overall.enabled; c2.boss.enabled = null;
  seed(win, { cfg: c2 });
  await renderNow();
  out.render.enabledUndefinedNull = pageHtml(win);

  seed(win, { students: MANY_STUDENTS, log: MANY_LOG, cfg: baseCfg() });
  await renderNow();
  out.render.many = pageHtml(win);

  // ── eqlToggle ──
  out.toggle = {};
  seed(win, { students: TIED_STUDENTS, log: TIED_LOG, cfg: baseCfg() });
  resetUi(win);
  win.eqlToggle('recitation');             // on -> off
  await win.AppStore.ready; await tick();
  out.toggle.off = { toast: toastSnap(win), enabled: cfgSnap(win).recitation.enabled, page: pageHtml(win) };
  resetUi(win);
  win.eqlToggle('recitation');             // off -> on
  await tick();
  out.toggle.on = { toast: toastSnap(win), enabled: cfgSnap(win).recitation.enabled, page: pageHtml(win) };
  resetUi(win);
  win.eqlToggle('nope');                   // unknown key: EQL no-ops, defaults used, toast says 'enabled' (cfg.enabled !== false)
  await tick();
  out.toggle.unknown = { toast: toastSnap(win), cfg: cfgSnap(win) };

  // ── eqlAdminPreview ──
  out.preview = {};
  const prev = async (label, key) => { resetUi(win); win.eqlAdminPreview(key); out.preview[label] = modalSnap(win); };
  seed(win, { students: TIED_STUDENTS, log: TIED_LOG, cfg: baseCfg() });
  await prev('tiedRecitation', 'recitation');
  await prev('tiedBossAllZero', 'boss');
  seed(win, { students: MANY_STUDENTS, log: MANY_LOG, cfg: baseCfg() });
  await prev('manyRecitation', 'recitation');
  const cp = baseCfg(); cp.recitation.resetAt = '2026-01-03T00:00:00.000Z'; cp.overall.color = '#abcdef';
  seed(win, { cfg: cp });
  await prev('periodRecitation', 'recitation');
  await prev('overallOverrideColor', 'overall');
  seed(win, { students: [], log: [], cfg: baseCfg() });
  await prev('empty', 'recitation');
  await prev('emptyUnknownKey', 'weird<key>');
  seed(win, { students: NO_NAME_STUDENTS, log: [], cfg: baseCfg() });
  await prev('noNameStudent', 'recitation');

  // ── eqlAdminResetConfirm ──
  out.confirm = {};
  seed(win, { students: TIED_STUDENTS, log: TIED_LOG, cfg: baseCfg() });
  for (const key of ['recitation', 'boss', 'academic', 'overall', 'x"y']) {
    resetUi(win); win.eqlAdminResetConfirm(key); out.confirm[key] = modalSnap(win);
  }
  const savedDB = win.DB;
  win.DB = {};                                  // `(DB.leaderboardConfig || {})` fallback branch
  resetUi(win); win.eqlAdminResetConfirm('recitation'); out.confirm.dbNoConfig = modalSnap(win);
  win.DB = savedDB;

  // ── eqlDoReset / eqlDoClearReset ──
  out.reset = {};
  seed(win, { students: TIED_STUDENTS, log: TIED_LOG, cfg: baseCfg() });
  resetUi(win); win.eqlDoReset('boss'); await tick();
  out.reset.doReset = { toast: toastSnap(win), cfg: cfgSnap(win).boss, page: pageHtml(win) };
  resetUi(win); win.eqlDoClearReset('boss'); await tick();
  out.reset.clearAfterReset = { toast: toastSnap(win), cfg: cfgSnap(win).boss, page: pageHtml(win) };
  resetUi(win); win.eqlDoClearReset('academic'); await tick();   // clear when nothing was set
  out.reset.clearNothing = { toast: toastSnap(win), cfg: cfgSnap(win).academic };
  resetUi(win); win.eqlDoReset('ghost'); await tick();
  out.reset.resetUnknown = { toast: toastSnap(win), cfg: cfgSnap(win) };
  resetUi(win); win.eqlDoClearReset('ghost'); await tick();
  out.reset.clearUnknown = { toast: toastSnap(win), cfg: cfgSnap(win) };
  out.finalErrors = errors.slice();
  return out;
}

async function main() {
  reverseTransformCheck();
  const A = makeWindow(), B = makeWindow();
  await evalOriginal(A.win);
  await evalBridge(B.win);
  assert.deepStrictEqual(clean(B.logs), clean(A.logs), 'load-time console output must match');
  assert(A.logs.some(l => l.includes('admin-leaderboard.js loaded')), 'original load log present');

  const oa = await run(A.win, A.errors);
  const ob = await run(B.win, B.errors);
  assert.strictEqual(JSON.stringify(clean(ob)), JSON.stringify(clean(oa)), 'bridge output must exactly match the original at every step');

  // ── independent sanity (guards against a vacuous both-sides-wrong pass) ──
  const o = oa;
  assert.deepStrictEqual(o.exports.map(e => e[1]), Array(6).fill('function'));
  assert(o.render.missingPageErrors.some(e => e.includes('#a-leaderboard page div not found')), 'missing page logs console.error');
  assert(o.render.noStudents.includes('>—') || o.render.noStudents.includes('—\n'), 'zero students shows em dash top student');
  assert(o.render.tied.includes('1,500 pts'), 'thousands separator in top score');
  assert(o.render.tied.includes('&lt;b&gt;Cy') === false, 'top student is Ana/Ben, not escaped Cy');
  assert(o.render.mixedConfig.includes('disabled'), 'disabled card class present');
  assert(o.render.mixedConfig.includes('Active period from'), 'reset badge present');
  assert(o.render.mixedConfig.includes('All-Time') , 'clear-reset button when resetAt set');
  assert(o.render.mixedConfig.includes('Acad &lt;x&gt;'), 'label escaped');
  assert(!o.render.enabledUndefinedNull.includes('disabled'), 'undefined/null enabled still counts as enabled');
  assert(o.toggle.off.enabled === false && o.toggle.on.enabled === true, 'toggle flips both directions');
  assert(o.toggle.off.toast.html.includes('disabled') && o.toggle.on.toast.html.includes('enabled'), 'toggle toast text');
  assert(o.preview.manyRecitation.content.includes('Top 10 of 12'), 'preview slices to 10 of 12');
  assert(!o.preview.manyRecitation.content.includes('Stu11'), 'rank 11 excluded');
  assert(o.preview.tiedRecitation.content.includes('🥇') && o.preview.tiedRecitation.content.includes('🥉'), 'medals');
  assert(o.preview.manyRecitation.content.includes('eql-row top3') && o.preview.manyRecitation.content.includes('eql-row "'), 'rank 3 is top3, rank 4 is not');
  assert(o.preview.manyRecitation.className.includes('md') && o.confirm.recitation.className.includes('sm'), 'modal sizes md / sm');
  assert(o.preview.empty.content.includes('No scores yet'), 'empty state');
  assert(o.preview.periodRecitation.content.includes('Period from') && o.preview.tiedRecitation.content.includes('All-time'), 'subtitle period vs all-time');
  assert(o.reset.doReset.cfg.resetAt === '<ISO>' || /^\d{4}-/.test(String(o.reset.doReset.cfg.resetAt)), 'resetAt stamped');
  assert(o.reset.clearAfterReset.cfg.resetAt === null, 'clear nulls resetAt');
  assert(o.reset.doReset.toast.html.includes('period reset') && o.reset.clearAfterReset.toast.html.includes('all-time mode'), 'reset/clear toast text');
  assert(o.finalErrors.length === 1, 'only the deliberate missing-page console.error was logged');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log(' - reverse-transform: original rebuilt byte-for-byte from the twin; 6 exports');
  console.log(' - render: missing page, no students, ties, disabled/override/reset states, escaping, thousands sep');
  console.log(' - toggle both directions + unknown key; preview slice/ranks/medals/fallbacks/empty/period; confirm x5 + DB fallback');
  console.log(' - doReset/doClearReset incl. clear-when-unset and unknown keys; toast + AppStore + re-render');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
