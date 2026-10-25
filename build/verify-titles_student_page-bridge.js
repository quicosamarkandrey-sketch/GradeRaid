// Phase 7 (Stream D) — equivalence check for modules/titles/titles_student_page.js (file 24/30).
//
// ORIGINAL side: real classic files in index.html order (repository/*, db-service, state-manager, dom, utils, eql-engine,
// titles_badge_renderer, hall-of-fame, [stub renderBadges standing in for ach_student_page], titles_student_page).
// BRIDGE side: one esbuild bundle whose entry imports the REAL production bridge (titles_student_page.bridge.js); the twin
// imports titles_badge_renderer / hall-of-fame itself. The renderBadges the patch wraps is stubbed on window BEFORE the
// bundle is evaluated on both sides (and a second window pair runs with NO renderBadges at load, to cover the
// `typeof _orig === 'function'` guard). Bare globals stubbed identically: currentUser, tsGetUnlockedTitles, tsEquipTitle,
// tsRefreshProfileOverlay, tsRefreshSidebarTitle, tsRefreshProfileTitle (titles_sidebar_refresh = file 26).
//
// Checked: 0 reverse-transform byte identity + 8 exports; 1 surface + the load-time renderBadges patch; 2 _getTitleReqText;
// 3 _tsTitleVisibleToStudent matrix; 4 _buildStudentTitlesHTML; 5 renderTitlesPage (guards, wrapping, re-wrapping, filters,
// scoping, counts, null slices); 6 tsTabSwitch; 7 equip/unequip; 8 _tsRefreshStudentTitlesPanel (count swap, leaderboard
// re-render); 9 the renderBadges patch incl. the _tsOpenTitlesTab flag + 80ms refresh; 10 real DOM events; 11 no-renderBadges load.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const EXPORTS = ['renderTitlesPage', 'tsTabSwitch', 'tsStudentEquip', 'tsStudentUnequip', '_tsRefreshStudentTitlesPanel', '_getTitleReqText', '_tsTitleVisibleToStudent', '_buildStudentTitlesHTML'];

function reverseTransformCheck() {
  const orig = read('modules/titles/titles_student_page.js');
  const twin = read('src/modules/titles/titles_student_page.js');
  const marker = '// ── Private helpers';
  assert.strictEqual(orig.split(marker).length, 2); assert.strictEqual(twin.split(marker).length, 2);
  const origHead = orig.slice(0, orig.indexOf(marker));
  assert(twin.includes(origHead), 'twin carries the original header comment verbatim');
  const mid = twin.slice(twin.indexOf(origHead) + origHead.length, twin.indexOf(marker));
  assert(mid.startsWith('import ') && mid.endsWith(';\n\n'), 'only an import block precedes the first original statement');
  for (const line of mid.split('\n').filter(Boolean)) assert(/^import .*;$/.test(line), 'import block line: ' + line);
  const body = twin.slice(twin.indexOf(marker));
  const rebuilt = origHead + body
    .replace(/^export function /gm, 'function ')
    .replace(/^export const (?=(?:renderTitlesPage|tsTabSwitch|tsStudentEquip|tsStudentUnequip|_tsRefreshStudentTitlesPanel)\b)/gm, 'window.');
  assert.strictEqual(rebuilt, orig, 'reversing the keyword swaps must reproduce the original byte-for-byte');
  assert.strictEqual((twin.match(/^export /gm) || []).length, 8, 'exactly 8 exports (declaresCount 10 = 8 + window.renderBadges patch + window._tsOpenTitlesTab flag)');
  assert(!/^export[^\n]*renderBadges/m.test(twin) && !/^export[^\n]*_tsOpenTitlesTab/m.test(twin), 'the patch and the flag are not exports');
}

const STARTER_HTML = `<!doctype html><html><body>
  <div id="s-badges" class="page active"></div><div id="s-leaderboard" class="page"></div>
  <div id="toast"></div>
</body></html>`;
const FIXED = 1767225600000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeWindow(noBadges) {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  win.eval(`(function(){ const R = Date; class D extends R { constructor(...a){ if (a.length) super(...a); else super(${FIXED}); } static now(){ return ${FIXED}; } } globalThis.Date = D; }());`);
  win.eval("globalThis.__rnd = { s: 424242 }; Math.random = function () { __rnd.s = (__rnd.s * 1103515245 + 12345) & 0x7fffffff; return __rnd.s / 0x7fffffff; };");
  win.DEFAULT_DB = { students: [], titles: [], titleUnlocks: {}, equippedTitles: {}, titleSectionAssignments: {}, achievements: [], achievementUnlocks: {}, recitationLog: [], bossEvents: [], bossParticipants: {}, pointLog: [], leaderboardConfig: {} };
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };
  win.__rpcCalls = [];
  const mockClient = { auth: { getSession: async () => ({ data: { session: null } }) }, rpc: async (name, params) => { win.__rpcCalls.push({ name, params }); return { data: null, error: null }; } };
  win.SupabaseClient = { getClient: () => mockClient, resolveProvider: () => 'supabase' };
  win.__EDUQUEST_SUPABASE_URL__ = ''; win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };
  win.__calls = [];
  const rec = (name) => (...a) => { win.__calls.push(JSON.stringify([name, ...a])); };
  win.tsGetUnlockedTitles = sid => { win.__calls.push(JSON.stringify(['tsGetUnlockedTitles', sid])); const ids = (win.AppStore.getSlice(s => s.titleUnlocks) || {})[sid] || []; return (win.AppStore.getSlice(s => s.titles) || []).filter(t => ids.includes(t.id)); };
  win.tsEquipTitle = (sid, tid) => { win.__calls.push(JSON.stringify(['tsEquipTitle', sid, tid])); win.AppStore.updateState(d => { d.equippedTitles = d.equippedTitles || {}; if (tid) d.equippedTitles[sid] = tid; else delete d.equippedTitles[sid]; }, { type: 'test:equip' }); };
  win.tsRefreshProfileOverlay = rec('tsRefreshProfileOverlay');
  win.tsRefreshSidebarTitle = rec('tsRefreshSidebarTitle');
  win.tsRefreshProfileTitle = rec('tsRefreshProfileTitle');
  win.__stubFns = {}; for (const n of ['tsGetUnlockedTitles', 'tsEquipTitle', 'tsRefreshProfileOverlay', 'tsRefreshSidebarTitle', 'tsRefreshProfileTitle']) win.__stubFns[n] = win[n];
  if (!noBadges) {
    win.__stubBadges = function () { win.__calls.push('["STUB renderBadges"]'); const el = win.document.getElementById('s-badges'); if (el) el.innerHTML = win.__badgesHTML === undefined ? '<div id="stub-badges">Badges <b>grid</b></div>' : win.__badgesHTML; };
    win.renderBadges = win.__stubBadges;
  }
  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  win.console.warn = () => {}; win.console.error = (...a) => win.__calls.push(JSON.stringify(['error', ...a.map(String)]));
  win.addEventListener('error', e => win.__calls.push(JSON.stringify(['window-error', String(e.message)])));
  return { win, logs };
}
async function evalOriginal(win) {
  for (const f of ['repository/table-sync.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'db-service.js', 'modules/core/state-manager.js', 'dom.js', 'utils.js',
    'modules/leaderboard/eql-engine.js', 'modules/titles/titles_badge_renderer.js', 'modules/leaderboard/hall-of-fame.js', 'modules/titles/titles_student_page.js']) win.eval(read(f));
  await win.AppStore.ready;
}
async function evalBridge(win) {
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'titles_student_page-combined-bundle.js'), 'utf8'));
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

const T = (id, o) => ({ id, name: 'Title ' + id, icon: '🏆', description: 'desc ' + id, rarity: 'Common', active: true, ...o });
const TITLES = () => [
  T('t1', { name: 'Alpha', rarity: 'Rare', description: 'Alpha <b>"desc"</b> & more' }),
  T('t2', { name: 'Beta', rarity: 'Epic', achievementId: 'a1' }),
  T('t3', { name: 'Gamma', rarity: undefined, achievementId: 'a-missing' }),
  T('t4', { name: 'Delta', active: false }),
  T('t5', { name: 'Epsilon', rarity: 'Mythic' }),
  T('t6', { name: 'Zeta', rarity: 'Legendary', description: undefined }),
];
const ACHS = () => [{ id: 'a1', name: 'Linked <Ach> "1"' }];
const STU = (o) => ({ id: 'stu1', name: 'Ann', classId: 'c1', ...o });
function seed(win, extra) {
  win.AppStore.updateState(d => {
    d.titles = TITLES(); d.achievements = ACHS(); d.titleUnlocks = { stu1: ['t1', 't2', 't4'] }; d.equippedTitles = { stu1: 't1' };
    d.titleSectionAssignments = { t5: ['c2'], t6: [] }; d.achievementUnlocks = { stu1: [{ achId: 'a1' }, { achId: 'x' }] };
    d.students = [{ id: 'stu1', name: 'Ann', xp: 100, level: 2, tier: 'Scholar' }, { id: 'stu2', name: 'Bo', xp: 50, level: 1, tier: 'Novice' }];
    d.recitationLog = []; d.bossEvents = []; d.bossParticipants = {}; d.pointLog = []; d.leaderboardConfig = {};
    Object.assign(d, extra || {});
  }, { type: 'test:seed' });
}
const setUser = (win, o) => { win.eval('currentUser = ' + JSON.stringify(o === null ? null : STU(o)) + ';'); };
const click = (win, el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
const stateSnap = win => win.AppStore.getSlice(s => ({ equipped: s.equippedTitles }));

async function run(win, logs, noBadges) {
  const out = { steps: [] };
  const step = async (label, fn) => {
    win.__rnd.s = 424242; win.__calls.length = 0;
    let err = null, ret;
    try { ret = await fn(); } catch (e) { err = String(e && e.message); }
    await sleep(110); // let the patch's 80ms refresh timer of THIS step fire before snapshotting (else it leaks into the next step)
    out.steps.push({ label, err, ret, calls: win.__calls.slice(), flag: win._tsOpenTitlesTab === undefined ? '<undef>' : win._tsOpenTitlesTab,
      badges: $(win, 's-badges') ? $(win, 's-badges').innerHTML : null, lb: $(win, 's-leaderboard') ? $(win, 's-leaderboard').innerHTML : null, state: stateSnap(win) });
  };
  const fresh = async (label, fn) => {
    for (const n in win.__stubFns) win[n] = win.__stubFns[n];
    $(win, 's-badges').innerHTML = ''; $(win, 's-leaderboard').innerHTML = ''; $(win, 's-leaderboard').className = 'page'; $(win, 's-badges').className = 'page active';
    win.__badgesHTML = undefined; win._tsOpenTitlesTab = undefined; win._eqlActiveTab = undefined; win._eqlActivePeriod = undefined;
    return step(label, fn);
  };
  out.surface = { fns: EXPORTS.map(n => [n, typeof win[n]]), renderBadgesIsFunction: typeof win.renderBadges, patched: noBadges ? 'n/a' : win.renderBadges !== win.__stubBadges, flag: typeof win._tsOpenTitlesTab, loadLogs: logs.slice().sort() }; // sorted: ES evaluation order of the imported modules differs from index.html's script order — same four lines
  const doc = win.document;

  if (noBadges) {
    seed(win); setUser(win, {});
    await fresh('no initial renderBadges: the patched renderBadges still renders the titles page', async () => { win.renderBadges(); await sleep(120); });
    await fresh('no initial renderBadges: flag opens the Titles tab', async () => { win._tsOpenTitlesTab = true; win.renderBadges(); await sleep(120); return win._tsOpenTitlesTab; });
    return out;
  }

  seed(win); setUser(win, {});
  // ── 2. _getTitleReqText ──
  await fresh('_getTitleReqText: no achievement / found / missing', async () => [win._getTitleReqText({}), win._getTitleReqText({ achievementId: 'a1' }), win._getTitleReqText({ achievementId: 'zzz' }), win._getTitleReqText({ achievementId: '' })]);
  seed(win, { achievements: null });
  await fresh('_getTitleReqText: null achievements slice', async () => [win._getTitleReqText({ achievementId: 'a1' })]);
  seed(win);
  // ── 3. visibility ──
  await fresh('_tsTitleVisibleToStudent: full matrix', async () => {
    const un = new Set(['u1']); const r = [];
    const v = (t, st) => r.push(win._tsTitleVisibleToStudent(t, st, un));
    v({ id: 'x', achievementId: 'a' }, STU()); v({ id: 'u1' }, STU());
    v({ id: 'nothing' }, STU()); v({ id: 't5' }, STU({ classId: 'c2' })); v({ id: 't5' }, STU({ classId: 'c1' })); v({ id: 't6' }, STU());
    v({ id: 't5' }, STU({ classId: undefined })); v({ id: 't5' }, { id: 's' });
    win.AppStore.updateState(d => { d.titleSectionAssignments = { t7: ['default-class'] }; }, { type: 'test:edit' }); v({ id: 't7' }, { id: 's' }); v({ id: 't7' }, STU());
    win.AppStore.updateState(d => { d.titleSectionAssignments = null; }, { type: 'test:edit' }); v({ id: 't5' }, STU());
    return r;
  });
  seed(win);
  // ── 4. _buildStudentTitlesHTML ──
  const st = STU();
  await fresh('_buildStudentTitlesHTML: empty list', async () => win._buildStudentTitlesHTML(st, [], [], null));
  await fresh('_buildStudentTitlesHTML: equipped banner + unlocked/equipped/locked cards', async () => { const all = TITLES().filter(t => t.active); return win._buildStudentTitlesHTML(st, all, [all[0], all[1]], 't1'); });
  await fresh('_buildStudentTitlesHTML: equipped id not in the list -> no banner', async () => { const all = TITLES().filter(t => t.active); return win._buildStudentTitlesHTML(st, all, [all[0]], 'nope'); });
  await fresh('_buildStudentTitlesHTML: no equipped id; second unlocked is equipped card variant', async () => { const all = TITLES().filter(t => t.active); return [win._buildStudentTitlesHTML(st, all, all, null), win._buildStudentTitlesHTML(st, all, all, 't2')]; });
  await fresh('_buildStudentTitlesHTML: rarity fallback, markup escaping, requirement text for locked linked titles', async () => { const all = [T('m1', { rarity: undefined, description: '<img src=x onerror=1>', achievementId: 'a1' }), T('m2', { rarity: 'Rare', description: '' })]; return win._buildStudentTitlesHTML(st, all, [], null); });

  // ── 5. renderTitlesPage ──
  await fresh('renderTitlesPage: no currentUser', async () => { setUser(win, null); win.renderTitlesPage(); setUser(win, {}); });
  await fresh('renderTitlesPage: no #s-badges element', async () => { const el = $(win, 's-badges'); el.id = 'x-badges'; try { win.renderTitlesPage(); } finally { el.id = 's-badges'; } });
  await fresh('renderTitlesPage: wraps the existing badges html in tabs', async () => { win.renderBadges(); });
  await fresh('renderTitlesPage: re-render reuses #ts-tab-badges (no double nesting)', async () => { win.renderBadges(); win.renderTitlesPage(); win.renderTitlesPage(); return $(win, 's-badges').querySelectorAll('#ts-tab-badges').length; });
  await fresh('renderTitlesPage: empty badges html -> placeholder', async () => { win.__badgesHTML = ''; win.renderBadges(); });
  await fresh('renderTitlesPage: whitespace-only badges html -> placeholder', async () => { win.__badgesHTML = '   \n  '; win.renderBadges(); });
  await fresh('renderTitlesPage: filters inactive titles and hides out-of-section ones', async () => { win.renderTitlesPage(); });
  await fresh('renderTitlesPage: student in section c2 sees the scoped title', async () => { setUser(win, { classId: 'c2' }); win.renderTitlesPage(); setUser(win, {}); });
  await fresh('renderTitlesPage: already-unlocked scoped title never disappears', async () => { win.AppStore.updateState(d => { d.titleUnlocks = { stu1: ['t5'] }; }, { type: 'test:edit' }); win.renderTitlesPage(); });
  seed(win);
  await fresh('renderTitlesPage: counts on the tab buttons (badges unlocks / titles unlocked)', async () => { win.renderTitlesPage(); return [$(win, 'tab-badges-btn').textContent, $(win, 'tab-titles-btn').textContent]; });
  seed(win, { titles: null, equippedTitles: null, achievementUnlocks: null, titleSectionAssignments: null });
  await fresh('renderTitlesPage: null slices', async () => { win.renderTitlesPage(); });
  seed(win, { titles: [] });
  await fresh('renderTitlesPage: no titles at all', async () => { win.renderTitlesPage(); });
  seed(win);
  await fresh('renderTitlesPage: unlock list for another student is not counted', async () => { setUser(win, { id: 'stu2' }); win.renderTitlesPage(); setUser(win, {}); });

  // ── 6. tsTabSwitch ──
  await fresh('tsTabSwitch: badges, titles, unknown, missing nodes', async () => { win.renderTitlesPage(); const r = []; const act = () => [...doc.querySelectorAll('.ts-form-panel.active, .ts-form-tab.active')].map(x => x.id); win.tsTabSwitch('titles'); r.push(act()); win.tsTabSwitch('badges'); r.push(act()); win.tsTabSwitch('zzz'); r.push(act()); $(win, 'ts-tab-titles').remove(); win.tsTabSwitch('titles'); r.push(act()); $(win, 'tab-badges-btn').remove(); win.tsTabSwitch('badges'); r.push(act()); return r; });

  // ── 7. equip / unequip ──
  await fresh('tsStudentEquip: no user', async () => { setUser(win, null); win.tsStudentEquip('t2'); setUser(win, {}); });
  await fresh('tsStudentEquip: equips, refreshes the panel + overlay (call order)', async () => { win.renderTitlesPage(); win.tsStudentEquip('t2'); return $(win, 'ts-tab-titles').innerHTML.length; });
  await fresh('tsStudentUnequip: no user', async () => { setUser(win, null); win.tsStudentUnequip(); setUser(win, {}); });
  await fresh('tsStudentUnequip: unequips with null', async () => { win.renderTitlesPage(); win.tsStudentUnequip(); });

  // ── 8. panel refresh ──
  await fresh('_tsRefreshStudentTitlesPanel: no user', async () => { setUser(win, null); win._tsRefreshStudentTitlesPanel(); setUser(win, {}); });
  await fresh('_tsRefreshStudentTitlesPanel: page not rendered (no tab button / panel)', async () => { win._tsRefreshStudentTitlesPanel(); });
  await fresh('_tsRefreshStudentTitlesPanel: swaps the count span and the panel', async () => { win.renderTitlesPage(); win.AppStore.updateState(d => { d.titleUnlocks = { stu1: ['t1', 't2', 't4', 't5', 't6'] }; }, { type: 'test:edit' }); win._tsRefreshStudentTitlesPanel(); seed(win); return $(win, 'tab-titles-btn').innerHTML; });
  await fresh('_tsRefreshStudentTitlesPanel: tab button without a count span is left alone', async () => { win.renderTitlesPage(); $(win, 'tab-titles-btn').innerHTML = 'Titles'; win._tsRefreshStudentTitlesPanel(); return $(win, 'tab-titles-btn').innerHTML; });
  await fresh('_tsRefreshStudentTitlesPanel: leaderboard page active -> re-renders with defaults', async () => { win.renderTitlesPage(); $(win, 's-leaderboard').classList.add('active'); win._tsRefreshStudentTitlesPanel(); return [win._eqlActiveTab, win._eqlActivePeriod]; });
  await fresh('_tsRefreshStudentTitlesPanel: leaderboard page active -> re-renders with the remembered tab/period', async () => { win.renderTitlesPage(); $(win, 's-leaderboard').classList.add('active'); win._eqlActiveTab = 'boss'; win._eqlActivePeriod = 'weekly'; win._tsRefreshStudentTitlesPanel(); return [win._eqlActiveTab, win._eqlActivePeriod]; });
  await fresh('_tsRefreshStudentTitlesPanel: leaderboard page inactive / absent', async () => { win.renderTitlesPage(); win._tsRefreshStudentTitlesPanel(); const el = $(win, 's-leaderboard'); el.id = 'x-lb'; try { win._tsRefreshStudentTitlesPanel(); } finally { el.id = 's-leaderboard'; } });

  // ── 9. the renderBadges patch ──
  await fresh('renderBadges patch: calls the original, then the titles page, then refreshes after 80ms', async () => { win.renderBadges(); await sleep(30); const early = win.__calls.filter(c => c.includes('tsRefreshSidebarTitle')).length; await sleep(150); return [early, win.__calls.filter(c => c.includes('tsRefreshSidebarTitle')).length]; });
  await fresh('renderBadges patch: _tsOpenTitlesTab opens the Titles tab once and resets the flag', async () => { win._tsOpenTitlesTab = true; win.renderBadges(); const a = [win._tsOpenTitlesTab, [...doc.querySelectorAll('.ts-form-panel.active')].map(x => x.id)]; win.renderBadges(); await sleep(120); return [a, [...doc.querySelectorAll('.ts-form-panel.active')].map(x => x.id)]; });
  await fresh('renderBadges patch: no user -> original renders, titles page is skipped', async () => { setUser(win, null); win.renderBadges(); await sleep(120); setUser(win, {}); });
  await fresh('renderBadges patch: re-wrapped later patches still chain (a second wrapper around the patched fn)', async () => { const patched = win.renderBadges; win.renderBadges = function () { win.__calls.push('["OUTER"]'); return patched.apply(this, arguments); }; try { win.renderBadges(); await sleep(120); } finally { win.renderBadges = patched; } });

  // ── 10. real DOM events ──
  await fresh('dom: tab buttons switch panels', async () => { seed(win); win.renderBadges(); const r = []; click(win, $(win, 'tab-titles-btn')); r.push([...doc.querySelectorAll('.ts-form-panel.active')].map(x => x.id)); click(win, $(win, 'tab-badges-btn')); r.push([...doc.querySelectorAll('.ts-form-panel.active')].map(x => x.id)); return r; });
  await fresh('dom: Equip Title button equips and re-renders the panel', async () => { seed(win); win.renderBadges(); await sleep(100); const b = [...doc.querySelectorAll('.ts-equip-btn')].find(x => x.textContent.includes('Equip Title')); click(win, b); await sleep(100); return [stateSnap(win).equipped, doc.querySelectorAll('.ts-equipped').length]; });
  await fresh('dom: Unequip buttons (banner and card) unequip', async () => { seed(win); win.renderBadges(); await sleep(100); click(win, [...doc.querySelectorAll('button')].find(x => x.textContent.trim() === 'Unequip')); await sleep(100); return stateSnap(win).equipped; });
  await fresh('dom: card Equipped/Unequip button unequips', async () => { seed(win); win.renderBadges(); await sleep(100); click(win, doc.querySelector('.ts-equip-btn.ts-unequip')); await sleep(100); return stateSnap(win).equipped; });
  await fresh('dom: Locked buttons are disabled', async () => { seed(win); win.renderBadges(); await sleep(100); return [...doc.querySelectorAll('button')].filter(b => b.textContent.includes('Locked')).map(b => b.disabled); });
  return out;
}

async function main() {
  if (!process.env.MUTATION_RUN) reverseTransformCheck();
  const A = makeWindow(false), B = makeWindow(false), A2 = makeWindow(true), B2 = makeWindow(true);
  await evalOriginal(A.win); await evalBridge(B.win); await evalOriginal(A2.win); await evalBridge(B2.win);
  const oa = await run(A.win, A.logs, false), ob = await run(B.win, B.logs, false);
  const oa2 = await run(A2.win, A2.logs, true), ob2 = await run(B2.win, B2.logs, true);
  let fd = firstDiff(clean(oa), clean(ob), 'out');
  assert.strictEqual(fd, null, 'bridge output must exactly match the original at every step — first difference at: ' + fd);
  fd = firstDiff(clean(oa2), clean(ob2), 'out2');
  assert.strictEqual(fd, null, 'no-renderBadges variant must match — first difference at: ' + fd);

  // ── independent sanity ──
  const o = clean(oa), o2 = clean(oa2);
  const S = label => { const s = o.steps.find(x => x.label === label); assert(s, 'missing step ' + label); return s; };
  assert.deepStrictEqual(o.surface.fns.map(e => e[1]), Array(8).fill('function'));
  assert.strictEqual(o.surface.patched, true, 'window.renderBadges was replaced by the patch at load'); assert.strictEqual(o.surface.flag, 'undefined');
  assert(o.surface.loadLogs.some(l => l.includes('titles/student-page.js loaded')), 'load log');
  assert.deepStrictEqual(S('_getTitleReqText: no achievement / found / missing').ret, ['Granted by teacher', 'Earn: Linked <Ach> "1"', 'Complete a special achievement', 'Granted by teacher']);
  assert.strictEqual(S('_getTitleReqText: null achievements slice').ret[0], 'Complete a special achievement');
  assert.deepStrictEqual(S('_tsTitleVisibleToStudent: full matrix').ret, [true, true, true, true, false, true, false, false, true, false, true], 'visibility matrix (assigned/empty/none/class/default-class/null slice)');
  assert(S('_buildStudentTitlesHTML: empty list').ret.includes('No Titles Yet'));
  const bh = S('_buildStudentTitlesHTML: equipped banner + unlocked/equipped/locked cards').ret;
  assert(bh.includes('Currently Equipped') && bh.includes('tsStudentUnequip()') && bh.includes('ts-equipped') && bh.includes('Locked') && bh.includes('Equip Title') && bh.includes('Unlocked') && bh.includes('Complete a special achievement'), 'banner + three card states + requirement text');
  assert(!S('_buildStudentTitlesHTML: equipped id not in the list -> no banner').ret.includes('Currently Equipped'));
  { const r = S('_buildStudentTitlesHTML: no equipped id; second unlocked is equipped card variant').ret; assert(!r[0].includes('Currently Equipped') && !r[0].includes('ts-equipped') && r[1].includes('ts-equipped')); }
  { const r = S('_buildStudentTitlesHTML: rarity fallback, markup escaping, requirement text for locked linked titles').ret; assert(r.includes('rarity-common') && r.includes('&lt;img src=x onerror=1&gt;') && r.includes('>undefined<'), 'rarity class falls back to common, label prints undefined, description escaped'); }
  assert.strictEqual(S('renderTitlesPage: no currentUser').badges, ''); assert.strictEqual(S('renderTitlesPage: no #s-badges element').err, null);
  const w = S('renderTitlesPage: wraps the existing badges html in tabs').badges;
  assert(w.includes('Achievements &amp; Titles') && w.includes('id="ts-tab-badges"') && w.includes('stub-badges') && w.includes('id="ts-tab-titles"'), 'tab layout around the badge html');
  assert.strictEqual(S('renderTitlesPage: re-render reuses #ts-tab-badges (no double nesting)').ret, 1);
  assert(S('renderTitlesPage: empty badges html -> placeholder').badges.includes('No badges availa') && S('renderTitlesPage: whitespace-only badges html -> placeholder').badges.includes('No badges availa'));
  const f = S('renderTitlesPage: filters inactive titles and hides out-of-section ones').badges; assert(f.includes('Alpha') && !f.includes('Delta') && !f.includes('Epsilon') && f.includes('Zeta'), 'inactive hidden, c2-scoped hidden, empty assignment visible');
  assert(S('renderTitlesPage: student in section c2 sees the scoped title').badges.includes('Epsilon'));
  assert(S('renderTitlesPage: already-unlocked scoped title never disappears').badges.includes('Epsilon'));
  assert.deepStrictEqual(S('renderTitlesPage: counts on the tab buttons (badges unlocks / titles unlocked)').ret.map(s => s.replace(/\s+/g, ' ').trim()).map(s => (s.match(/\d+/) || [])[0]), ['2', '3']);
  assert(S('renderTitlesPage: null slices').badges.includes('No Titles Yet') && S('renderTitlesPage: no titles at all').badges.includes('No Titles Yet'));
  assert.strictEqual(S('renderTitlesPage: unlock list for another student is not counted').err, null);
  const ts = S('tsTabSwitch: badges, titles, unknown, missing nodes').ret; assert.deepStrictEqual(ts[0], ['tab-titles-btn', 'ts-tab-titles']); assert.deepStrictEqual(ts[1], ['tab-badges-btn', 'ts-tab-badges']); assert.deepStrictEqual(ts[2], []);
  assert(S('tsStudentEquip: no user').calls.length === 0 && S('tsStudentUnequip: no user').calls.length === 0 && S('_tsRefreshStudentTitlesPanel: no user').calls.length === 0, 'no-user guards');
  { const c = S('tsStudentEquip: equips, refreshes the panel + overlay (call order)').calls.filter(x => !x.startsWith('["tsGetUnlockedTitles"')); assert.deepStrictEqual(c, ['["tsEquipTitle","stu1","t2"]', '["tsRefreshSidebarTitle"]', '["tsRefreshProfileTitle"]', '["tsRefreshProfileOverlay"]'], 'equip, then panel refresh (sidebar, profile title), then the profile overlay'); }
  assert(S('tsStudentUnequip: unequips with null').calls.includes('["tsEquipTitle","stu1",null]') && S('tsStudentUnequip: unequips with null').state.equipped.stu1 === undefined);
  assert(S('_tsRefreshStudentTitlesPanel: swaps the count span and the panel').ret.includes('>5<'), 'count span updated');
  assert(!/<span/.test(S('_tsRefreshStudentTitlesPanel: tab button without a count span is left alone').ret), 'no span, nothing to swap');
  assert.deepStrictEqual(S('_tsRefreshStudentTitlesPanel: leaderboard page active -> re-renders with defaults').ret, ['hall', 'all']);
  assert.deepStrictEqual(S('_tsRefreshStudentTitlesPanel: leaderboard page active -> re-renders with the remembered tab/period').ret, ['boss', 'weekly']);
  assert(S('_tsRefreshStudentTitlesPanel: leaderboard page active -> re-renders with defaults').lb.includes('hol-'), 'hall of fame rendered into the leaderboard page');
  assert.strictEqual(S('_tsRefreshStudentTitlesPanel: leaderboard page inactive / absent').lb, '');
  assert.deepStrictEqual(S('renderBadges patch: calls the original, then the titles page, then refreshes after 80ms').ret, [0, 1]);
  assert(S('renderBadges patch: calls the original, then the titles page, then refreshes after 80ms').calls[0] === '["STUB renderBadges"]', 'original first');
  { const r = S('renderBadges patch: _tsOpenTitlesTab opens the Titles tab once and resets the flag').ret; assert.deepStrictEqual(r[0], [false, ['ts-tab-titles']]); assert.deepStrictEqual(r[1], ['ts-tab-badges'], 'second render goes back to the badges tab'); }
  assert(S('renderBadges patch: no user -> original renders, titles page is skipped').badges.includes('stub-badges') && !S('renderBadges patch: no user -> original renders, titles page is skipped').badges.includes('ts-form-tabs'));
  assert(S('renderBadges patch: re-wrapped later patches still chain (a second wrapper around the patched fn)').calls[0] === '["OUTER"]');
  assert.deepStrictEqual(S('dom: tab buttons switch panels').ret, [['ts-tab-titles'], ['ts-tab-badges']]);
  assert.deepStrictEqual(S('dom: Equip Title button equips and re-renders the panel').ret[0], { stu1: 't2' }); 
  assert.strictEqual((S('dom: Unequip buttons (banner and card) unequip').ret || {}).stu1, undefined);
  assert.strictEqual((S('dom: card Equipped/Unequip button unequips').ret || {}).stu1, undefined);
  assert(S('dom: Locked buttons are disabled').ret.length > 0 && S('dom: Locked buttons are disabled').ret.every(Boolean));
  assert(o2.steps.length === 2 && o2.steps[0].badges.includes('ts-form-tabs') && !o2.steps[0].badges.includes('stub-badges'), 'no original renderBadges: titles page only');
  assert.strictEqual(o2.steps[1].ret, false, 'flag reset');
  assert(!o.steps.some(s => s.calls.some(c => c.startsWith('["window-error"'))), 'no uncaught errors inside timers');
  assert.strictEqual(o.steps.filter(s => s.err).length, 0, 'no unexpected exceptions in any step: ' + o.steps.filter(s => s.err).map(s => s.label + ' => ' + s.err).join(' | '));

  console.log('EQUIVALENCE CHECK PASSED');
  console.log(' - reverse-transform: original rebuilt byte-for-byte from the twin; 8 exports');
  console.log(' - ' + (o.steps.length + o2.steps.length) + ' steps compared');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
