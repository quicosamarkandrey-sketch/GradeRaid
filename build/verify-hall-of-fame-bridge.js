// Phase 7 (Stream D) — equivalence check for modules/leaderboard/hall-of-fame.js (file 23/30).
//
// ORIGINAL side: real classic files eval'd in production order (repository/*, db-service, state-manager, dom, utils,
// eql-engine, titles_badge_renderer, hall-of-fame). BRIDGE side: one esbuild bundle whose entry imports the REAL
// production bridge (hall-of-fame.bridge.js; the twin imports the converted eql-engine / titles_badge_renderer itself).
// Same DOM, fixtures and calls on both. Bare globals stubbed identically: currentUser, currentRole (also deleted:
// typeof guard), tsGetEquippedTitle (also deleted: typeof guard), Element.prototype.scrollIntoView (jsdom lacks it).
//
// Checked: 0 reverse-transform byte identity (template-literal-aware dedent) + 4 exports; 1 window surface and the 2
// in-body state slots; 2 every tab x every period for student and staff viewers (page html), ties/ranks, active counts;
// 3 enabled/disabled/empty/null-slice paths; 4 title paths (equipped badge / achievement unlock / tier fallback / unknown
// tier) incl. guards deleted; 5 pagination (3 pages, clamp, prev/next/goto, tab change resets, scrollIntoView, missing
// list); 6 REAL inline DOM events (category + period + pagination buttons); 7 wrapper honoured through window.renderLeaderboard;
// 8 missing target page; 9 period-start boundaries around the pinned clock.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const EXPORTS = ['holGoToPage', 'holPrevPage', 'holNextPage', 'renderLeaderboard'];

function reverseTransformCheck() {
  const orig = read('modules/leaderboard/hall-of-fame.js');
  const twin = read('src/modules/leaderboard/hall-of-fame.js');
  const OPEN = "(function () {\n  'use strict';\n\n";
  const CLOSE = "})();\n";
  const oi = orig.indexOf(OPEN);
  const origPrefix = orig.slice(0, oi);
  const imports = twin.slice(twin.indexOf(origPrefix) + origPrefix.length);
  const m = imports.match(/^((?:import [^\n]+\n)+\n)/);
  assert(m, 'twin must have an import block directly after the original header comment');
  assert.strictEqual(twin.indexOf(origPrefix) > 0, true, 'twin must carry the original prefix after its own header');
  let inner = imports.slice(m[1].length);
  assert(inner.endsWith('\n'), 'twin ends with a single trailing newline');
  inner = inner.slice(0, -1);
  const acorn = require('acorn');
  const bodyStart = twin.indexOf(inner);
  assert(bodyStart > 0 && twin.indexOf(inner, bodyStart + 1) === -1, 'inner located exactly once in twin');
  const quasis = [];
  for (const t of acorn.tokenizer(twin, { ecmaVersion: 'latest', sourceType: 'module' })) if (t.type.label === 'template') quasis.push([t.start, t.end]);
  const inQuasi = p => quasis.some(([x, y]) => p >= x && p < y);
  let off = bodyStart;
  inner = inner.split('\n').map(l => { const start = off; off += l.length + 1; return (l === '' || inQuasi(start)) ? l : '  ' + l; }).join('\n') + '\n';
  inner = inner.replace(/export const (\w+) = function /g, 'window.$1 = function ');
  assert.strictEqual(origPrefix + OPEN + inner + CLOSE, orig, 'reversing the transform must reproduce the original byte-for-byte');
  assert.strictEqual((twin.match(/^export const /gm) || []).length, 4, 'exactly 4 exports (declaresCount 6 = 4 + 2 in-body window state slots)');
  for (const n of ['_eqlActiveTab', '_eqlActivePeriod']) assert(!new RegExp('^export [^\\n]*\\b' + n + '\\b', 'm').test(twin), n + ' is state, not an export');
}

const STARTER_HTML = `<!doctype html><html><body>
  <div id="s-leaderboard" class="page"></div><div id="a-hall-of-fame" class="page"></div>
  <div id="toast"></div>
</body></html>`;
const FIXED = 1767225600000; // 2026-01-01T00:00:00.000Z (a Thursday)
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  win.eval(`globalThis.__clock = { t: ${FIXED} }; (function(){ const R = Date; class D extends R { constructor(...a){ if (a.length) super(...a); else super(__clock.t); } static now(){ return __clock.t; } } globalThis.Date = D; }());`);
  win.eval("globalThis.__rnd = { s: 424242 }; Math.random = function () { __rnd.s = (__rnd.s * 1103515245 + 12345) & 0x7fffffff; return __rnd.s / 0x7fffffff; };");
  win.DEFAULT_DB = { students: [], recitationLog: [], bossEvents: [], bossParticipants: {}, pointLog: [], achievements: [], achievementUnlocks: {}, leaderboardConfig: {} };
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };
  win.__rpcCalls = [];
  const mockClient = { auth: { getSession: async () => ({ data: { session: null } }) }, rpc: async (name, params) => { win.__rpcCalls.push({ name, params }); return { data: null, error: null }; } };
  win.SupabaseClient = { getClient: () => mockClient, resolveProvider: () => 'supabase' };
  win.__EDUQUEST_SUPABASE_URL__ = ''; win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };
  win.__calls = [];
  win.Element.prototype.scrollIntoView = function (o) { win.__calls.push(JSON.stringify(['scrollIntoView', this.id, o])); };
  win.tsGetEquippedTitle = sid => { win.__calls.push(JSON.stringify(['tsGetEquippedTitle', sid])); return (win.__equipped || {})[sid] || null; };
  win.__stubTitle = win.tsGetEquippedTitle;
  win.__equipped = {};
  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  win.console.warn = () => {}; win.console.error = (...a) => win.__calls.push(JSON.stringify(['error', ...a.map(String)]));
  win.addEventListener('error', e => win.__calls.push(JSON.stringify(['window-error', String(e.message)])));
  return { win, logs };
}
async function evalOriginal(win) {
  for (const f of ['repository/table-sync.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'db-service.js', 'modules/core/state-manager.js', 'dom.js', 'utils.js',
    'modules/leaderboard/eql-engine.js', 'modules/titles/titles_badge_renderer.js', 'modules/leaderboard/hall-of-fame.js']) win.eval(read(f));
  await win.AppStore.ready;
}
async function evalBridge(win) {
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'hall-of-fame-combined-bundle.js'), 'utf8'));
  await win.AppStore.ready;
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v).replace(ISO, '<ISO>'));
const tick = () => new Promise(r => setTimeout(r, 5));
const $ = (win, id) => win.document.getElementById(id);
function firstDiff(a, b, p) {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], p + '.' + k); if (d) return d; }
  }
  const t = v => { const j = JSON.stringify(v); return j === undefined ? 'undefined' : j; };
  let i = 0; const sa = t(a), sb = t(b); while (i < sa.length && sa[i] === sb[i]) i++;
  return p + '\n  original: ...' + sa.slice(Math.max(0, i - 80), i + 200) + '\n  bridge:   ...' + sb.slice(Math.max(0, i - 80), i + 200);
}

const TIERS = ['Master', 'Scholar', 'Achiever', 'Novice', undefined, 'Wizard', 'Scholar'];  // 7 entries: Scholar outnumbers Master
const STUDENTS = (n = 48) => Array.from({ length: n }, (_, i) => ({
  id: 'st' + String(i + 1).padStart(2, '0'),
  name: (i === 5 || i === 2) ? 'Zed <b>Z</b> "Q"' + i : 'Student ' + (i + 1) + ' Surname',
  displayName: i % 7 === 3 ? 'Nick' + i + ' Display' : undefined,
  init: 'S' + (i % 10),
  color: i % 5 === 0 ? 'not-a-color' : '#' + ((0x3366aa + i * 4093) & 0xffffff).toString(16).padStart(6, '0'),
  profilePic: (i % 6 === 2 || i === 5) ? 'https://img.test/p' + i + '.png?x="1"&y=2' : undefined,
  xp: i === 9 || i === 20 ? 0 : 5000 - 100 * Math.floor(i / 2),   // pairs tie; two zero-xp students
  level: i % 9 === 4 ? undefined : 1 + (i % 7),
  tier: TIERS[i % TIERS.length],
  attendance: i === 12 ? undefined : 80 + (i % 20),
  completedQuizzes: Array.from({ length: i % 4 }, (_, k) => 'q' + k),
}));
const REC = () => {
  const out = [];
  const stamps = ['2025-12-20T10:00:00.000Z', '2025-12-31T23:30:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.001Z', '2025-12-28T12:00:00.000Z', '2026-01-01'];
  for (let i = 0; i < 20; i++) out.push({ studentId: 'st' + String((i % 14) + 1).padStart(2, '0'), pts: 5 + (i % 5) * 3, createdAt: stamps[i % stamps.length], note: i % 6 === 0 ? 'qr scan' : '' });
  return out;
};
const BOSS_EVENTS = () => [{ id: 'b1', status: 'ended', startedAt: '2025-11-02T00:00:00.000Z' }, { id: 'b2', status: 'loot', startedAt: '2025-12-31T01:00:00.000Z' }, { id: 'b3', status: 'active', startedAt: '2026-01-01T00:00:00.000Z' }];
const BOSS_PART = () => ({ 0: { st01: { totalDamage: 900 }, st02: { totalDamage: 400 }, st11: { totalDamage: 50 } }, 1: { st02: { totalDamage: 700 }, st03: { totalDamage: 120 } }, 2: { st01: { totalDamage: 30 }, st15: { totalDamage: 30 } } });
const POINTS = () => [
  { studentId: 'st01', what: 'Quest: Algebra (100%)', pts: 50, when: '2025-12-31T09:00:00.000Z' }, { studentId: 'st01', what: 'Quest: Geo (80%)', pts: 30, when: '2026-01-01T00:00:00.000Z' },
  { studentId: 'st02', what: 'Quest: Algebra (100%)', pts: 50, when: '2025-12-20T09:00:00.000Z' }, { studentId: 'st03', what: 'Quest: Bio (95%)', pts: 40, when: '2026-01-01T00:00:00.001Z' },
  { studentId: 'st04', what: 'Bonus', pts: 10, when: '2026-01-01T00:00:00.000Z' }, { studentId: 'st05', what: 'Quest: Art (100%)', pts: -20, when: '2025-12-28T12:00:00.000Z' },
];
const ACHS = () => [{ id: 'a1', name: 'Common One', rarity: 'Common' }, { id: 'a2', name: 'Mythic <M>', rarity: 'Mythic' }, { id: 'a3', name: 'Epic Three', rarity: 'Epic' }, { id: 'a4', name: 'Rare Four', rarity: 'Rare' }];
const UNLOCKS = () => ({ st01: [{ achId: 'a2' }], st06: [{ achId: 'a1' }, { achId: 'a3' }], st07: [{ achId: 'a2' }, { achId: 'a1' }], st08: [{ achId: 'a4' }], st09: [{ achId: 'zzz' }], st10: [] });
function seed(win, extra) {
  win.AppStore.updateState(d => {
    d.students = STUDENTS(); d.recitationLog = REC(); d.bossEvents = BOSS_EVENTS(); d.bossParticipants = BOSS_PART(); d.pointLog = POINTS();
    d.achievements = ACHS(); d.achievementUnlocks = UNLOCKS(); d.leaderboardConfig = {};
    Object.assign(d, extra || {});
  }, { type: 'test:seed' });
}
const setRole = (win, r) => { if (r === undefined) { try { delete win.currentRole; } catch (e) {} win.eval("if (typeof currentRole !== 'undefined') { try { delete globalThis.currentRole; } catch (e) {} }"); } else win.eval('currentRole = ' + JSON.stringify(r) + ';'); };
const setUser = (win, id) => { win.eval('currentUser = ' + JSON.stringify(id ? { id } : null) + ';'); };
const click = (win, el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
const TITLE_OBJ = (n) => ({ id: 'tt' + n, name: 'Dragon <x>' + n, icon: '🐉', rarity: 'Epic', active: true, frameShape: 'classic', particles: 'stars' });

async function run(win, logs) {
  const out = { steps: [] };
  const step = async (label, fn) => {
    win.__rnd.s = 424242; win.__calls.length = 0;
    let err = null, ret;
    try { ret = await fn(); } catch (e) { err = String(e && e.message); }
    await tick();
    out.steps.push({ label, err, ret, calls: win.__calls.slice(), tab: win._eqlActiveTab === undefined ? '<undef>' : win._eqlActiveTab, period: win._eqlActivePeriod === undefined ? '<undef>' : win._eqlActivePeriod,
      student: $(win, 's-leaderboard') ? $(win, 's-leaderboard').innerHTML : null, staff: $(win, 'a-hall-of-fame') ? $(win, 'a-hall-of-fame').innerHTML : null });
  };
  const fresh = async (label, fn) => { win.tsGetEquippedTitle = win.__stubTitle; win.__equipped = {}; if (!$(win, 's-leaderboard')) { const d = win.document.createElement('div'); d.id = 's-leaderboard'; win.document.body.prepend(d); } $(win, 's-leaderboard').innerHTML = ''; $(win, 'a-hall-of-fame').innerHTML = ''; win._eqlActiveTab = undefined; win._eqlActivePeriod = undefined; return step(label, fn); };
  out.surface = { fns: EXPORTS.map(n => [n, typeof win[n]]), loadLogs: logs.slice(), state: [typeof win._eqlActiveTab, typeof win._eqlActivePeriod] };
  const doc = win.document;
  const TABS = ['hall', 'overall', 'recitation', 'boss', 'academic'], PERIODS = ['all', 'monthly', 'weekly', 'daily'];

  seed(win); setUser(win, 'st03'); setRole(win, 'student');
  // ── 2. every tab x period, student viewer ──
  for (const tab of TABS) for (const per of PERIODS) await fresh('student: ' + tab + '/' + per, async () => { win.renderLeaderboard(tab, per); });
  // staff viewers
  for (const role of ['teacher', 'admin']) for (const tab of TABS) await fresh(role + ': ' + tab + '/all', async () => { setRole(win, role); win.renderLeaderboard(tab, 'all'); setRole(win, 'student'); });
  await fresh('staff: boss/weekly (period bar + staff copy)', async () => { setRole(win, 'teacher'); win.renderLeaderboard('boss', 'weekly'); setRole(win, 'student'); });
  await fresh('role undefined renders to the student page and a student hero', async () => { setRole(win, undefined); win.renderLeaderboard('hall', 'all'); setRole(win, 'student'); });
  await fresh('role is some other string -> student page', async () => { setRole(win, 'parent'); win.renderLeaderboard('overall', 'all'); setRole(win, 'student'); });
  await fresh('defaults: no args then remembered tab/period', async () => { win.renderLeaderboard(); const a = [win._eqlActiveTab, win._eqlActivePeriod]; win.renderLeaderboard('academic', 'daily'); win.renderLeaderboard(); return [a, win._eqlActiveTab, win._eqlActivePeriod]; });
  await fresh('defaults: only the tab given keeps the remembered period', async () => { win.renderLeaderboard('boss', 'monthly'); win.renderLeaderboard('overall'); return [win._eqlActiveTab, win._eqlActivePeriod]; });
  await fresh('unknown tab uses the overall meta and compute', async () => { win.renderLeaderboard('zzz', 'all'); });
  await fresh('unknown period: no reset, All Time label', async () => { win.renderLeaderboard('recitation', 'yearly'); });
  // viewer identity
  await fresh('viewer not in the roster (no "Your rank")', async () => { setUser(win, 'ghost'); win.renderLeaderboard('overall', 'all'); setUser(win, 'st03'); });
  await fresh('currentUser null', async () => { setUser(win, null); win.renderLeaderboard('overall', 'all'); setUser(win, 'st03'); });
  await fresh('viewer in the podium vs outside it (hall)', async () => { const r = []; for (const id of ['st01', 'st02', 'st11', 'st30']) { setUser(win, id); win.renderLeaderboard('hall', 'all'); r.push($(win, 's-leaderboard').innerHTML.length); } setUser(win, 'st03'); return r; });
  // ── 3. enabled / empty / null slices ──
  seed(win, { leaderboardConfig: { overall: { enabled: false }, boss: { enabled: true }, hall: {} } });
  await fresh('disabled leaderboard (student copy)', async () => { win.renderLeaderboard('overall', 'all'); });
  await fresh('disabled leaderboard (staff copy)', async () => { setRole(win, 'admin'); win.renderLeaderboard('overall', 'all'); setRole(win, 'student'); });
  await fresh('explicitly enabled / empty config object', async () => { win.renderLeaderboard('boss', 'all'); win.renderLeaderboard('hall', 'all'); });
  seed(win, { leaderboardConfig: null });
  await fresh('null leaderboardConfig slice', async () => { win.renderLeaderboard('overall', 'all'); });
  seed(win, { students: [] });
  await fresh('no students -> No Data Yet', async () => { win.renderLeaderboard('overall', 'all'); });
  await fresh('no students, hall tab', async () => { win.renderLeaderboard('hall', 'all'); });
  seed(win, { students: null });
  await fresh('null students slice', async () => { win.renderLeaderboard('hall', 'all'); });
  seed(win, { recitationLog: null, bossEvents: null, bossParticipants: null, pointLog: null });
  await fresh('null activity slices', async () => { for (const t of TABS) win.renderLeaderboard(t, 'weekly'); });
  seed(win, { students: STUDENTS(2) });
  await fresh('fewer than 3 students (empty podium slots)', async () => { win.renderLeaderboard('hall', 'all'); win.renderLeaderboard('recitation', 'all'); });
  seed(win, { students: STUDENTS(5) });
  await fresh('exactly 5 students (no pagination)', async () => { win.renderLeaderboard('overall', 'all'); });
  seed(win);

  // ── 4. titles ──
  await fresh('titles: tsGetEquippedTitle returns null for everyone', async () => { win.renderLeaderboard('hall', 'all'); });
  await fresh('titles: equipped badge (podium card + list rows) and name override', async () => { win.__equipped = { st01: TITLE_OBJ(1), st04: TITLE_OBJ(4), st30: TITLE_OBJ(30), st12: { id: 'x', name: 'Plain Name <i>', rarity: 'Common', active: true } }; win.renderLeaderboard('hall', 'all'); });
  await fresh('titles: tsGetEquippedTitle absent (typeof guard) -> unlock/tier fallbacks', async () => { delete win.tsGetEquippedTitle; win.renderLeaderboard('hall', 'all'); });
  await fresh('titles: achievement-unlock names by rarity order and tier fallbacks per category', async () => { delete win.tsGetEquippedTitle; const r = []; for (const t of ['overall', 'boss', 'recitation', 'academic']) { win.renderLeaderboard(t, 'all'); r.push($(win, 's-leaderboard').innerHTML.length); } return r; });
  seed(win, { achievements: null, achievementUnlocks: null });
  await fresh('titles: null achievement slices', async () => { delete win.tsGetEquippedTitle; win.renderLeaderboard('hall', 'all'); });
  seed(win);

  // ── 5. pagination ──
  await fresh('pagination: page 1 of 3 (rows after the podium, ties share ranks)', async () => { win.renderLeaderboard('hall', 'all'); });
  await fresh('pagination: holGoToPage(2), (3), then Next past the end clamps', async () => { win.renderLeaderboard('hall', 'all'); const r = []; win.holGoToPage(2); r.push($(win, 's-leaderboard').innerHTML.length); win.holGoToPage(3); r.push($(win, 's-leaderboard').innerHTML.length); win.holNextPage(); r.push($(win, 's-leaderboard').innerHTML.length); return r; });
  await fresh('pagination: Prev from page 1 clamps to 1; goTo(0), goTo(-5), goTo(2.9), goTo("3")', async () => { win.renderLeaderboard('hall', 'all'); const r = []; win.holPrevPage(); r.push($(win, 's-leaderboard').innerHTML.length); win.holGoToPage(0); r.push($(win, 's-leaderboard').innerHTML.length); win.holGoToPage(-5); r.push($(win, 's-leaderboard').innerHTML.length); win.holGoToPage(2.9); r.push($(win, 's-leaderboard').innerHTML.length); win.holGoToPage('3'); r.push($(win, 's-leaderboard').innerHTML.length); return r; });
  await fresh('pagination: goTo(999) renders the last page', async () => { win.renderLeaderboard('hall', 'all'); win.holGoToPage(999); });
  await fresh('pagination: changing tab or period resets to page 1; re-rendering the same keeps the page', async () => { win.renderLeaderboard('hall', 'all'); win.holGoToPage(3); const a = $(win, 's-leaderboard').innerHTML.length; win.renderLeaderboard('hall', 'all'); const b = $(win, 's-leaderboard').innerHTML.length; win.renderLeaderboard('overall', 'all'); const c = $(win, 's-leaderboard').innerHTML.length; win.holGoToPage(2); win.renderLeaderboard('overall', 'weekly'); const d = $(win, 's-leaderboard').innerHTML.length; return [a, b, c, d]; });
  await fresh('pagination: scrollIntoView is called on #hol-list-<tab>', async () => { win.renderLeaderboard('overall', 'all'); win.holGoToPage(2); });
  await fresh('pagination: missing list element (no scroll)', async () => { win.renderLeaderboard('hall', 'all'); const orig = win.renderLeaderboard; win.renderLeaderboard = function () { orig.apply(this, arguments); const l = $(win, 'hol-list-hall'); if (l) l.id = 'gone'; }; try { win.holGoToPage(2); } finally { win.renderLeaderboard = orig; } });
  await fresh('pagination: scrollIntoView missing throws the same error after the render', async () => { win.renderLeaderboard('hall', 'all'); const keep = win.Element.prototype.scrollIntoView; delete win.Element.prototype.scrollIntoView; try { win.holGoToPage(2); } finally { win.Element.prototype.scrollIntoView = keep; } });
  await fresh('pagination: staff viewer pages in the staff page', async () => { setRole(win, 'teacher'); win.renderLeaderboard('hall', 'all'); win.holGoToPage(2); setRole(win, 'student'); });
  seed(win, { students: STUDENTS(210) });
  await fresh('pagination: 7+ pages show the window, edges and ellipses (page 1, 6, last)', async () => { win.renderLeaderboard('overall', 'all'); win.renderLeaderboard('hall', 'all'); const r = [$(win, 's-leaderboard').querySelector('.hol-pagination').innerHTML]; win.holGoToPage(6); r.push($(win, 's-leaderboard').querySelector('.hol-pagination').innerHTML); win.holGoToPage(99); r.push($(win, 's-leaderboard').querySelector('.hol-pagination').innerHTML); win.holGoToPage(5); r.push($(win, 's-leaderboard').querySelector('.hol-pagination').innerHTML); return r; });
  seed(win, { students: STUDENTS(27) });
  await fresh('pagination: 24 rows -> 2 pages', async () => { win.renderLeaderboard('hall', 'all'); win.holNextPage(); });
  seed(win, { students: STUDENTS(23) });
  await fresh('pagination: exactly 20 rows -> single page "Showing all"', async () => { win.renderLeaderboard('hall', 'all'); });
  seed(win);
  await fresh('pagination: wrapper installed on window.renderLeaderboard is honoured by holGoToPage', async () => { win.renderLeaderboard('hall', 'all'); const real = win.renderLeaderboard; win.renderLeaderboard = function (t, p) { win.__calls.push(JSON.stringify(['WRAPPER', t, p])); return real.apply(this, arguments); }; try { win.holGoToPage(2); win.holNextPage(); win.holPrevPage(); } finally { win.renderLeaderboard = real; } });

  seed(win, { students: STUDENTS(1) });
  await fresh('a single student still renders the stage, not the empty state', async () => { win.renderLeaderboard('overall', 'all'); });
  seed(win);
  await fresh('period boundaries at a NON-midnight clock (daily/weekly/monthly cut-offs)', async () => {
    win.__clock.t = Date.UTC(2026, 0, 14, 15, 30, 45);
    const at = (id, iso) => ({ studentId: id, pts: 10, createdAt: iso, note: '' });
    seed(win, { recitationLog: [at('st01', '2026-01-14T08:00:00.000Z'), at('st02', '2026-01-13T23:59:00.000Z'), at('st03', '2026-01-10T23:59:00.000Z'), at('st04', '2026-01-11T00:00:00.000Z'), at('st05', '2025-12-31T10:00:00.000Z')] });
    const r = [];
    try { for (const p of ['all', 'monthly', 'weekly', 'daily']) { win.renderLeaderboard('recitation', p); r.push((($(win, 's-leaderboard').innerHTML.match(/(\d+) active/) || [])[1])); } } finally { win.__clock.t = 1767225600000; seed(win); }
    return r;
  });
  // ── 6. real DOM events ──
  await fresh('dom: category buttons', async () => { win.renderLeaderboard('hall', 'all'); const r = []; for (const b of [...doc.querySelectorAll('#s-leaderboard .hol-cat-btn')]) { const label = b.textContent.trim(); const fresh = [...doc.querySelectorAll('#s-leaderboard .hol-cat-btn')].find(x => x.textContent.trim() === label); click(win, fresh); r.push([win._eqlActiveTab, win._eqlActivePeriod, doc.querySelectorAll('#s-leaderboard .hol-cat-btn.active').length]); } return r; });
  await fresh('dom: period buttons (only on non-hall tabs)', async () => { win.renderLeaderboard('boss', 'all'); const r = []; for (let i = 0; i < 4; i++) { const b = doc.querySelectorAll('#s-leaderboard .hol-period-btn')[i]; click(win, b); r.push([win._eqlActivePeriod, [...doc.querySelectorAll('#s-leaderboard .hol-period-btn.active')].map(x => x.textContent)]); } win.renderLeaderboard('hall', 'all'); r.push(doc.querySelectorAll('#s-leaderboard .hol-period-btn').length); return r; });
  await fresh('dom: pagination buttons (numbers, Prev, Next, disabled ends)', async () => { win.renderLeaderboard('hall', 'all'); const btn = txt => [...doc.querySelectorAll('#s-leaderboard .hol-page-btn')].find(b => b.textContent.trim() === txt); const r = []; click(win, btn('2')); r.push(doc.querySelector('#s-leaderboard .hol-page-btn.active').textContent); click(win, btn('3')); r.push(doc.querySelector('#s-leaderboard .hol-page-btn.active').textContent); r.push([...doc.querySelectorAll('#s-leaderboard .hol-page-btn')].filter(b => b.disabled).map(b => b.textContent.trim())); click(win, [...doc.querySelectorAll('#s-leaderboard .hol-page-btn')].find(b => b.textContent.includes('Prev'))); r.push(doc.querySelector('#s-leaderboard .hol-page-btn.active').textContent); return r; });
  await fresh('dom: image onerror attribute and the portrait structure', async () => { win.renderLeaderboard('hall', 'all'); return [doc.querySelectorAll('#s-leaderboard img').length, doc.querySelectorAll('#s-leaderboard .hol-portrait-init').length, [...doc.querySelectorAll('#s-leaderboard img')].map(i => i.getAttribute('src')).slice(0, 2)]; });

  // ── 8/9. misc ──
  await fresh('target page missing: state still set, nothing rendered, no throw', async () => { $(win, 's-leaderboard').remove(); win.renderLeaderboard('boss', 'weekly'); const d = win.document.createElement('div'); d.id = 's-leaderboard'; win.document.body.prepend(d); });
  await fresh('hall tab ignores the period for scores (no resetAt) but keeps it in state', async () => { win.renderLeaderboard('hall', 'daily'); return [win._eqlActiveTab, win._eqlActivePeriod]; });
  await fresh('period boundaries: weekly/daily/monthly sets differ around the pinned clock', async () => { const r = []; for (const p of ['all', 'monthly', 'weekly', 'daily']) { win.renderLeaderboard('recitation', p); r.push($(win, 's-leaderboard').innerHTML.length); } return r; });
  await fresh('ties share a rank and the next rank skips correctly', async () => { win.renderLeaderboard('hall', 'all'); });
  return out;
}

async function main() {
  if (!process.env.MUTATION_RUN) reverseTransformCheck();
  const A = makeWindow(), B = makeWindow();
  await evalOriginal(A.win);
  await evalBridge(B.win);
  const oa = await run(A.win, A.logs), ob = await run(B.win, B.logs);
  const fd = firstDiff(clean(oa), clean(ob), 'out');
  assert.strictEqual(fd, null, 'bridge output must exactly match the original at every step — first difference at: ' + fd);

  // ── independent sanity ──
  const o = clean(oa);
  if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify(o));
  const S = label => { const s = o.steps.find(x => x.label === label); assert(s, 'missing step ' + label); return s; };
  assert.deepStrictEqual(o.surface.fns.map(e => e[1]), Array(4).fill('function'));
  assert.deepStrictEqual(o.surface.state, ['undefined', 'undefined'], 'state slots only come into being on the first render');
  assert(o.surface.loadLogs.some(l => l.includes('[HOL] hall-of-fame.js loaded')), 'load log');
  const hall = S('student: hall/all').student;
  assert(hall.includes('Hall of Legends') && hall.includes('Class Ranking') && hall.includes('hol-hall-summary') && hall.includes('Class Legends') && hall.includes('Your rank:'), 'hall render for a student');
  assert(!hall.includes('hol-period-bar'), 'hall tab has no period bar');
  assert(S('student: boss/weekly').student.includes('hol-period-bar') && S('student: boss/weekly').student.includes('Weekly'), 'period bar on non-hall tabs');
  assert(S('student: overall/all').student.includes('hol-list-overall') && S('student: overall/all').student.includes('Full Rankings'));
  assert(S('student: hall/all').staff === '' && S('teacher: hall/all').student === '' && S('teacher: hall/all').staff.includes('Where your class'), 'student vs staff page + staff copy');
  assert(S('admin: boss/all').staff.includes('See how your class stacks up in Boss Raider'), 'staff copy for non-hall tabs');
  assert(S('role undefined renders to the student page and a student hero').student.includes('Your rank') && S('role is some other string -> student page').student !== '');
  const df = S('defaults: no args then remembered tab/period').ret; assert.deepStrictEqual(df, [['hall', 'all'], 'academic', 'daily']);
  assert.deepStrictEqual(S('defaults: only the tab given keeps the remembered period').ret, ['overall', 'monthly']);
  assert(S('unknown tab uses the overall meta and compute').student.includes('Overall') && S('unknown period: no reset, All Time label').student.includes('All Time'));
  assert(S('viewer not in the roster (no "Your rank")').student.includes('Where legends are forged.') && !S('viewer not in the roster (no "Your rank")').student.includes('Your rank'));
  assert(S('currentUser null').student.includes('Where legends are forged.'));
  assert(S('disabled leaderboard (student copy)').student.includes('Leaderboard Disabled') && S('disabled leaderboard (student copy)').student.includes('by your teacher'));
  assert(S('disabled leaderboard (staff copy)').staff.includes('Leaderboard Disabled') && !S('disabled leaderboard (staff copy)').staff.includes('by your teacher'));
  assert(S('no students -> No Data Yet').student.includes('No Data Yet'));
  assert(S('null students slice').student.includes('No Data Yet') && S('null students slice').err === null && S('null activity slices').err === null && S('null leaderboardConfig slice').err === null);
  assert(!S('fewer than 3 students (empty podium slots)').err);
  const eq = S('titles: equipped badge (podium card + list rows) and name override').student;
  assert(eq.includes('hol-card-title') && eq.includes('Dragon') && eq.includes('Plain Name'), 'equipped titles render');
  assert(S('titles: tsGetEquippedTitle absent (typeof guard) -> unlock/tier fallbacks').calls.every(c => !c.startsWith('["tsGetEquippedTitle"')), 'guard honoured when absent');
  assert(S('titles: tsGetEquippedTitle returns null for everyone').calls.some(c => c.startsWith('["tsGetEquippedTitle"')));
  assert(S('titles: tsGetEquippedTitle absent (typeof guard) -> unlock/tier fallbacks').student.includes('Grand Master') || S('titles: tsGetEquippedTitle absent (typeof guard) -> unlock/tier fallbacks').student.includes('Scholar'), 'tier fallback titles');
  const pg = S('pagination: page 1 of 3 (rows after the podium, ties share ranks)').student; { const m = pg.match(/Showing 1.20 of (\d+)/); assert(m && Math.ceil(+m[1] / 20) === 3 && pg.includes('holGoToPage(3)') && !pg.includes('holGoToPage(4)') && !pg.includes('hol-page-ellipsis'), '3 pages, no ellipsis'); }
  { const e = S('pagination: 7+ pages show the window, edges and ellipses (page 1, 6, last)').ret; const P = +e[2].match(/hol-page-btn active" onclick="holGoToPage\((\d+)\)/)[1]; assert(P >= 10, 'many pages: ' + P); const has = (h, n) => h.includes('holGoToPage(' + n + ')'); const ell = h => (h.match(/hol-page-ellipsis/g) || []).length;
    assert(has(e[0], 1) && has(e[0], 2) && has(e[0], 3) && !has(e[0], 4) && has(e[0], P) && ell(e[0]) === 1, 'page 1: 1,2,3 .. P');
    assert(has(e[1], 1) && !has(e[1], 3) && [4, 5, 6, 7, 8].every(n => has(e[1], n)) && !has(e[1], 9) && has(e[1], P) && ell(e[1]) === 2, 'page 6: 1 .. 4-8 .. P (two ellipses)');
    assert(has(e[3], 1) && has(e[3], 3) && !has(e[3], 2) && ell(e[3]) === 2, 'page 5: a gap of exactly one page still shows an ellipsis (1 .. 3)');
    assert(/disabled="" onclick="holNextPage/.test(e[2]) && has(e[2], P - 2) && !has(e[2], P - 3) && ell(e[2]) === 1, 'clamped to the last page, Next disabled'); }
  const gp = S('pagination: holGoToPage(2), (3), then Next past the end clamps').ret; assert(gp.length === 3 && gp[1] !== gp[0], 'page changes the html'); assert.strictEqual(gp[2], gp[1], 'Next past the last page clamps');
  assert(S('pagination: scrollIntoView is called on #hol-list-<tab>').calls.includes('["scrollIntoView","hol-list-overall",{"behavior":"smooth","block":"nearest"}]'), 'scroll call');
  assert(!S('pagination: missing list element (no scroll)').calls.some(c => c.startsWith('["scrollIntoView"')));
  assert(S('pagination: scrollIntoView missing throws the same error after the render').err, 'scrollIntoView missing throws');
  assert(S('pagination: 24 rows -> 2 pages').student.includes('holPrevPage()'));
  assert(S('pagination: exactly 20 rows -> single page "Showing all"').student.includes('Showing all'));
  const wr = S('pagination: wrapper installed on window.renderLeaderboard is honoured by holGoToPage').calls.filter(c => c.startsWith('["WRAPPER"')); assert.strictEqual(wr.length, 3, 'window.renderLeaderboard wrapper is hit by goTo/next/prev');
  const cb = S('dom: category buttons').ret; assert.deepStrictEqual(cb.map(r => r[0]), ['hall', 'overall', 'recitation', 'boss', 'academic']); assert(cb.every(r => r[2] === 1));
  assert.deepStrictEqual(S('dom: period buttons (only on non-hall tabs)').ret.map(r => (Array.isArray(r) ? r[0] : r)), ['all', 'monthly', 'weekly', 'daily', 0]);
  const pb = S('dom: pagination buttons (numbers, Prev, Next, disabled ends)').ret; assert.deepStrictEqual([pb[0], pb[1], pb[3]], ['2', '3', '2']);
  assert(S('dom: image onerror attribute and the portrait structure').ret[0] > 0);
  const mp = S('target page missing: state still set, nothing rendered, no throw'); assert(mp.err === null && mp.tab === 'boss' && mp.period === 'weekly');
  const pbd = S('period boundaries: weekly/daily/monthly sets differ around the pinned clock').ret; assert(new Set(pbd).size >= 2, 'period filters change the render');
  assert(S('a single student still renders the stage, not the empty state').student.includes('hol-stage') && !S('a single student still renders the stage, not the empty state').student.includes('No Data Yet'));
  { const r = S('period boundaries at a NON-midnight clock (daily/weekly/monthly cut-offs)').ret; assert.deepStrictEqual(r.map(Number).length, 4); if (new Date(2026, 0, 1).getTimezoneOffset() === 0) assert.deepStrictEqual(r, ['5', '4', '3', '1'], 'all 5 / monthly 4 / weekly 3 (Sunday 00:00 inclusive) / daily 1'); }
  assert(S('titles: achievement-unlock names by rarity order and tier fallbacks per category').student !== '' && S('student: hall/all').student.includes('&quot;Q&quot;2'), 'quotes in names/alt text are escaped (an unescaped quote would end the attribute)');
  assert(!o.steps.some(s => s.calls.some(c => c.startsWith('["window-error"'))), 'no uncaught errors inside timers');
  assert.strictEqual(o.steps.filter(s => s.err && !/scrollIntoView missing/.test(s.label)).length, 0, 'no unexpected exceptions in any step');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log(' - reverse-transform: original rebuilt byte-for-byte from the twin; 4 exports');
  console.log(' - ' + o.steps.length + ' steps compared');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
