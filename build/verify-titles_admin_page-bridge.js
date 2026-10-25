// Phase 7 (Stream D) — equivalence check for modules/titles/titles_admin_page.js.
//
// ORIGINAL side: real classic files eval'd in production order (repository/*, db-service, state-manager,
// dom, utils, titles_badge_renderer, titles_admin_page). BRIDGE side: one esbuild bundle whose entry imports
// the REAL production bridges (titles_badge_renderer, titles_admin_page), exercising the real twin plus real
// imports of AppStore / DBService / dom / utils / tsBuildBadgeHTML. Same DOM, fixtures and calls on both.
// Bare globals stubbed identically (bare assignment): currentUser, navTo (toggled), getClassLabel (toggled),
// syncTitleRevokeToServer (recorder), confirm (scripted), and tsGetUnlockedTitles / tsIsUnlocked /
// tsUnlockTitleForStudent (the not-yet-converted titles_sidebar_refresh.js: state-driven stand-ins).
// delete_title goes through the REAL DBService.rpc and a mock Supabase client.
//
// Checked: 0 reverse-transform byte identity (only the export keyword swaps + one import block) + 12 exports
// + the load-time subscriber/log; 1 window surface; 2 renderAdminTitles — no dest, legacy dest, empty state,
// full library (active/inactive, linked/missing achievement, section scoping with/without getClassLabel,
// unlock/equipped counts, escaping) + stats (rarity buckets/pct, top-6 slicing + stable ties, empty top lists,
// zero-title pct guard); 3 tab switch + partial refresh; 4 delete (not found / declined / accepted with and
// without the optional slices / rpc ok / rpc error); 5 toggle, duplicate (owner kept / fallback / non-array slice);
// 6 grant modal + student-titles panel + confirm (every validation, grant, already-has, revoke, not-had) + revoke;
// 7 the admin:achievements-rendered subscriber (all 3 selector fallbacks, idempotency, ignored event, no dest,
// no bar, click -> navTo or renderAdminTitles fallback).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function reverseTransformCheck() {
  const orig = read('modules/titles/titles_admin_page.js');
  const twin = read('src/modules/titles/titles_admin_page.js');
  const marker = '// ── Main renderer ──';
  assert.strictEqual(orig.split(marker).length, 2); assert.strictEqual(twin.split(marker).length, 2);
  const origHead = orig.slice(0, orig.indexOf(marker));
  assert(twin.includes(origHead), 'twin carries the original header comment verbatim');
  const mid = twin.slice(twin.indexOf(origHead) + origHead.length, twin.indexOf(marker));
  assert(/^(import [^\n]+\n)+\n$/.test(mid), 'only an import block precedes the first original statement');
  const body = twin.slice(twin.indexOf(marker));
  const rebuilt = origHead + body
    .replace(/^export const (\w+) = (async )?function/gm, 'window.$1 = $2function')
    .replace(/^export function /gm, 'function ');
  assert.strictEqual(rebuilt, orig, 'reversing the keyword swaps must reproduce the original byte-for-byte');
  assert.strictEqual((twin.match(/^export /gm) || []).length, 12, 'exactly 12 exports (declaresCount 12)');
}

const STARTER_HTML = `<!doctype html><html><body>
  <div id="a-titles"></div>
  <div id="a-achievements"></div>
  <div id="toast"></div>
  <div id="modal-box" class="modal-box"></div><div id="modal-content"></div><div id="modal-overlay" style="display:none"></div>
</body></html>`;
const FIXED = 1767225600000;

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  win.eval(`(function(){ const R = Date; class D extends R { constructor(...a){ if (a.length) super(...a); else super(${FIXED}); } static now(){ return ${FIXED}; } } globalThis.Date = D; }());`);
  // Deterministic Math.random on BOTH sides, reseeded at the start of every step (tsBuildBadgeHTML mints random SVG ids
  // and uid() is random): identical call sequences -> identical output, and a difference in HOW MANY random values a
  // side consumes would now surface as a mismatch instead of being normalised away.
  win.eval("globalThis.__rnd = { s: 424242 }; Math.random = function () { __rnd.s = (__rnd.s * 1103515245 + 12345) & 0x7fffffff; return __rnd.s / 0x7fffffff; };");
  win.eval("currentUser = { id: 't1', name: 'Teacher' }; currentRole = 'teacher';");
  win.DEFAULT_DB = { titles: [], titleUnlocks: {}, equippedTitles: {}, titleSectionAssignments: {}, achievements: [], students: [] };
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };
  win.__rpcCalls = []; win.__rpcMock = {};
  const mockClient = {
    auth: { getSession: async () => ({ data: { session: null } }) },
    rpc: async (name, params) => { win.__rpcCalls.push({ name, params }); const e = win.__rpcMock[name]; if (typeof e === 'function') return e(params); if (e) return e; throw new Error('unmocked rpc: ' + name); },
  };
  win.SupabaseClient = { getClient: () => mockClient, resolveProvider: () => 'supabase' };
  win.__EDUQUEST_SUPABASE_URL__ = ''; win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };

  win.__calls = []; win.__confirmAnswer = true;
  const rec = (name) => (...a) => win.__calls.push(JSON.stringify([name, ...a.map(x => (typeof x === 'function' ? '<fn>' : x))]));
  win.syncTitleRevokeToServer = rec('syncTitleRevokeToServer');
  win.navTo = rec('navTo');
  win.confirm = msg => { win.__calls.push(JSON.stringify(['confirm', msg])); return win.__confirmAnswer; };
  // state-driven stand-ins for titles_sidebar_refresh.js (file 26, not converted yet)
  win.tsIsUnlocked = (sid, tid) => ((win.AppStore.getSlice(s => s.titleUnlocks) || {})[sid] || []).includes(tid);
  win.tsGetUnlockedTitles = sid => { const ids = (win.AppStore.getSlice(s => s.titleUnlocks) || {})[sid] || []; return (win.AppStore.getSlice(s => s.titles) || []).filter(t => ids.includes(t.id)); };
  win.tsUnlockTitleForStudent = rec('tsUnlockTitleForStudent');
  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  win.console.warn = () => {}; win.console.error = (...a) => win.__calls.push(JSON.stringify(['error', ...a.map(String)]));
  return { win, logs };
}
async function evalOriginal(win) {
  for (const f of ['repository/table-sync.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'db-service.js', 'modules/core/state-manager.js', 'dom.js', 'utils.js', 'modules/titles/titles_badge_renderer.js', 'modules/titles/titles_admin_page.js']) win.eval(read(f));
  await win.AppStore.ready;
}
async function evalBridge(win) {
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'titles_admin_page-combined-bundle.js'), 'utf8'));
  await win.AppStore.ready;
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const IDRE = /id_[a-z0-9]+/g;
const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v).replace(ISO, '<ISO>').replace(IDRE, '<TMPID>'));
const tick = () => new Promise(r => setTimeout(r, 5));
const $ = (win, id) => win.document.getElementById(id);

const TITLES = () => [
  { id: 't1', name: 'Alpha <b>', icon: '🎖️', rarity: 'Common', active: true, achievementId: 'a1', frameShape: 'classic', borderColor: '#112233' },
  { id: 't2', name: 'Beta', icon: '', rarity: 'Rare', active: false, frameShape: 'hexagon' },
  { id: 't3', name: 'Gamma "3"', icon: '🔥', rarity: 'Epic', active: true, achievementId: 'ghost', frameShape: 'flame' },
  { id: 't4', name: 'T4Name', icon: '🌟', rarity: 'Legendary', active: true },
  { id: 't5', name: 'T5Name', icon: '🐉', rarity: 'Mythic', active: true, frameShape: 'dragon' },
  { id: 't6', name: 'T6Name', icon: '🍃', rarity: 'Uncommon', active: true },
  { id: 't7', name: 'T7Name', icon: '🧪', rarity: 'Common', active: true },
  { id: 't8', name: 'T8Name', icon: '🎭', rarity: 'Rare', active: true, frameShape: 'ghost' },
];
const UNLOCKS = () => ({ s1: ['t1', 't2', 't3', 't4', 't5', 't6', 't7'], s2: ['t1', 't2', 't3'], s3: ['t1', 't2'], s4: ['t1'] });
const EQUIPPED = () => ({ s1: 't1', s2: 't1', s3: 't2', s4: null });
const STUDENTS = () => [{ id: 's1', name: 'Ana <i>' }, { id: 's2', name: 'Ben' }, { id: 's3', name: 'Cy' }, { id: 's4', name: 'Di' }];
const ASSIGN = () => ({ t3: ['c1', 'c2'], t4: [] });
function seed(win, extra) {
  win.AppStore.updateState(d => {
    d.titles = TITLES(); d.titleUnlocks = UNLOCKS(); d.equippedTitles = EQUIPPED(); d.students = STUDENTS();
    d.achievements = [{ id: 'a1', name: 'Linked <Ach>' }]; d.titleSectionAssignments = ASSIGN();
    Object.assign(d, extra || {});
  }, { type: 'test:seed' });
}
const stateSnap = win => win.AppStore.getSlice(s => ({ t: (s.titles || []).map(x => [x.id, x.name, x.active, x.ownerTeacherId, x.createdAt]), u: s.titleUnlocks, e: s.equippedTitles }));
const modalSnap = win => ({ visible: $(win, 'modal-overlay').style.display, content: $(win, 'modal-content').innerHTML });
function resetUi(win) { $(win, 'modal-overlay').style.display = 'none'; $(win, 'modal-content').innerHTML = ''; $(win, 'toast').innerHTML = ''; win.__calls.length = 0; win.__rpcCalls.length = 0; }
const withLabels = win => { win.getClassLabel = cid => 'Sec ' + String(cid).toUpperCase(); };
const noLabels = win => { delete win.getClassLabel; };

async function run(win, logs) {
  const out = { steps: [] };
  win.__events = [];
  win.AppStore.subscribe('verify-recorder', (st, e) => { win.__events.push(e.type + ':' + JSON.stringify(e.payload === undefined ? null : e.payload)); });
  const step = async (label, fn) => {
    win.__rnd.s = 424242;
    win.__events.length = 0;
    resetUi(win);
    let err = null, ret;
    try { ret = await fn(); } catch (e) { err = String(e && e.message); }
    await tick();
    out.steps.push({ label, err, ret, events: win.__events.filter(e => !e.startsWith('test:seed')), calls: win.__calls.slice(), rpc: win.__rpcCalls.slice(), toast: $(win, 'toast').innerHTML, modal: modalSnap(win),
      titlesPage: $(win, 'a-titles') ? $(win, 'a-titles').innerHTML : null, achPage: $(win, 'a-achievements') ? $(win, 'a-achievements').innerHTML : null, state: stateSnap(win) });
  };
  const NAMES = ['renderAdminTitles', 'tsAdminTabSwitch', '_tsRefreshAdminTitlesPanel', 'tsAdminDelete', 'tsAdminToggle', 'tsAdminDuplicate', 'tsAdminGrantModal', 'tsAdminGrantRefreshStudentTitles', 'tsAdminGrantConfirm', 'tsAdminRevokeTitle', '_buildAdminTitlesList', '_buildAdminTitleStats'];
  out.surface = { fns: NAMES.map(n => [n, typeof win[n]]), loadLogs: logs.slice() };

  // ── 2. render ──
  const a = $(win, 'a-titles'), ach = $(win, 'a-achievements');
  a.remove(); ach.remove();
  await step('render: no destination', () => win.renderAdminTitles());
  win.document.body.insertBefore(ach, win.document.body.firstChild);
  seed(win); noLabels(win);
  await step('render: legacy destination #a-achievements', () => win.renderAdminTitles());
  ach.innerHTML = '';
  win.document.body.insertBefore(a, win.document.body.firstChild);
  await step('render: full page, no getClassLabel', () => win.renderAdminTitles());
  withLabels(win);
  await step('render: full page, with getClassLabel', () => win.renderAdminTitles());
  seed(win, { titles: [] });
  await step('render: empty state', () => win.renderAdminTitles());
  seed(win, { titles: null, titleUnlocks: null, equippedTitles: null, titleSectionAssignments: null, achievements: null });
  await step('render: all slices null', () => win.renderAdminTitles());
  seed(win);
  await step('stats: direct builder (top-6 slice, stable ties, rarity pct)', () => win._buildAdminTitleStats(TITLES()));
  await step('stats: direct builder, zero titles', () => win._buildAdminTitleStats([]));
  await step('stats: no unlocks / no equipped lists', () => { seed(win, { titleUnlocks: {}, equippedTitles: {} }); return win._buildAdminTitleStats(TITLES()); });
  await step('library: direct builder', () => { seed(win); return win._buildAdminTitlesList(TITLES()); });
  await step('library: direct builder, empty', () => win._buildAdminTitlesList([]));

  // ── 3. tab switch + partial refresh ──
  seed(win); win.renderAdminTitles();
  await step('tab switch to stats', () => { win.tsAdminTabSwitch('stats'); return ['tsadmtab-library', 'tsadmtab-stats', 'tsadm-panel-library', 'tsadm-panel-stats'].map(id => $(win, id).className); });
  await step('tab switch to library', () => { win.tsAdminTabSwitch('library'); return ['tsadmtab-library', 'tsadmtab-stats', 'tsadm-panel-library', 'tsadm-panel-stats'].map(id => $(win, id).className); });
  await step('tab switch without panels', () => { a.innerHTML = ''; win.tsAdminTabSwitch('stats'); });
  await step('partial refresh: no panel', () => win._tsRefreshAdminTitlesPanel());
  await step('partial refresh: panel replaced', () => { win.renderAdminTitles(); $(win, 'tsadm-panel-library').innerHTML = 'stale'; win._tsRefreshAdminTitlesPanel(); return $(win, 'tsadm-panel-library').innerHTML.length > 100; });
  await step('partial refresh: null titles slice', () => { seed(win, { titles: null }); win._tsRefreshAdminTitlesPanel(); return $(win, 'tsadm-panel-library').innerHTML.includes('ts-admin-cards-grid'); });

  // ── 4. delete ──
  seed(win); win.__rpcMock.delete_title = { data: null, error: null };
  await step('delete: not found', () => win.tsAdminDelete('nope'));
  win.__confirmAnswer = false;
  await step('delete: confirm declined', () => win.tsAdminDelete('t1'));
  win.__confirmAnswer = true;
  await step('delete: accepted (cascade unlock + equipped, rpc ok)', () => win.tsAdminDelete('t1'));
  seed(win, { titleUnlocks: undefined, equippedTitles: undefined });
  await step('delete: accepted without optional slices', () => win.tsAdminDelete('t2'));
  seed(win); win.__rpcMock.delete_title = { data: null, error: { message: 'denied' } };
  await step('delete: rpc error warns', () => win.tsAdminDelete('t3'));
  seed(win); win.__rpcMock.delete_title = { data: null, error: null };
  await step('delete: unlock lists that do not include the title are untouched', () => win.tsAdminDelete('t8'));

  // ── 5. toggle / duplicate ──
  seed(win);
  await step('toggle: missing', () => win.tsAdminToggle('nope'));
  await step('toggle: active -> disabled', () => win.tsAdminToggle('t1'));
  await step('toggle: inactive -> enabled', () => win.tsAdminToggle('t2'));
  await step('toggle refreshes the panel when present', () => { win.renderAdminTitles(); win.tsAdminToggle('t4'); return $(win, 'tsadm-panel-library').innerHTML.includes('ts-admin-card-inactive'); });
  seed(win);
  await step('duplicate: missing', () => win.tsAdminDuplicate('nope'));
  await step('duplicate: owner carried forward', () => { seed(win, { titles: TITLES().map(t => (t.id === 't1' ? { ...t, ownerTeacherId: 'owner9' } : t)) }); win.tsAdminDuplicate('t1'); });
  await step('duplicate: no owner -> current user', () => { seed(win); win.tsAdminDuplicate('t2'); });
  await step('duplicate into a non-array titles slice is impossible (source must exist)', () => { seed(win); win.tsAdminDuplicate('t8'); win.tsAdminDuplicate('t8'); });

  // ── 6. grant / revoke ──
  seed(win, { titles: [] });
  await step('grant modal: no titles', () => win.tsAdminGrantModal());
  seed(win);
  await step('grant modal: options escaped + icon fallback', () => win.tsAdminGrantModal());
  const setSel = (id, v) => { $(win, id).value = v; };
  await step('student titles panel: missing elements', () => { resetUi(win); return win.tsAdminGrantRefreshStudentTitles(); });
  await step('student titles panel: no student selected', () => { win.tsAdminGrantModal(); setSel('tsg-student', ''); win.tsAdminGrantRefreshStudentTitles(); return $(win, 'tsg-student-titles').style.display; });
  await step('student titles panel: nothing unlocked', () => { win.tsAdminGrantModal(); seed(win, { titleUnlocks: {} }); setSel('tsg-student', 's1'); win.tsAdminGrantRefreshStudentTitles(); return [$(win, 'tsg-student-titles').style.display, $(win, 'tsg-student-titles-list').innerHTML]; });
  await step('student titles panel: unlocked + equipped marker', () => { seed(win); win.tsAdminGrantModal(); setSel('tsg-student', 's2'); win.tsAdminGrantRefreshStudentTitles(); return $(win, 'tsg-student-titles-list').innerHTML; });
  await step('student titles panel: null equipped slice', () => { seed(win, { equippedTitles: null }); win.tsAdminGrantModal(); setSel('tsg-student', 's2'); win.tsAdminGrantRefreshStudentTitles(); return $(win, 'tsg-student-titles-list').innerHTML; });
  const open = () => { seed(win); win.tsAdminGrantModal(); };
  const err = () => { const e = $(win, 'tsg-err'); return e && [e.textContent, e.style.display]; };
  await step('confirm: no student', () => { open(); setSel('tsg-student', ''); setSel('tsg-title', 't1'); win.tsAdminGrantConfirm(); return err(); });
  await step('confirm: no title', () => { open(); setSel('tsg-student', 's1'); setSel('tsg-title', ''); win.tsAdminGrantConfirm(); return err(); });
  await step('confirm: no student, no error element', () => { open(); $(win, 'tsg-err').remove(); setSel('tsg-student', ''); win.tsAdminGrantConfirm(); });
  await step('confirm: no title, no error element', () => { open(); $(win, 'tsg-err').remove(); setSel('tsg-student', 's1'); setSel('tsg-title', ''); win.tsAdminGrantConfirm(); });
  await step('confirm: vanished student/title', () => { open(); setSel('tsg-student', 's1'); setSel('tsg-title', 't1'); seed(win, { students: [] }); win.tsAdminGrantConfirm(); return err(); });
  await step('confirm grant: already has it', () => { open(); setSel('tsg-student', 's1'); setSel('tsg-title', 't1'); win.tsAdminGrantConfirm(); return err(); });
  await step('confirm grant: success', () => { open(); setSel('tsg-student', 's4'); setSel('tsg-title', 't6'); $(win, 'tsg-act-grant').checked = true; win.tsAdminGrantConfirm(); return modalSnap(win).visible; });
  await step('confirm revoke: not owned', () => { open(); setSel('tsg-student', 's4'); setSel('tsg-title', 't6'); $(win, 'tsg-act-revoke').checked = true; win.tsAdminGrantConfirm(); return err(); });
  await step('confirm revoke: success (unequips + syncs)', () => { open(); win.renderAdminTitles(); setSel('tsg-student', 's1'); setSel('tsg-title', 't1'); $(win, 'tsg-act-revoke').checked = true; win.tsAdminGrantConfirm(); return modalSnap(win).visible; });
  await step('confirm revoke: error element hidden on valid input', () => { open(); $(win, 'tsg-err').style.display = 'block'; setSel('tsg-student', 's2'); setSel('tsg-title', 't3'); $(win, 'tsg-act-revoke').checked = true; win.tsAdminGrantConfirm(); });
  await step('revoke: direct, equipped title cleared', () => { seed(win); win.tsAdminRevokeTitle('s3', 't2'); });
  await step('revoke: direct, other equipped title kept', () => { seed(win); win.tsAdminRevokeTitle('s3', 't1'); });
  await step('revoke: direct, no slices', () => { seed(win, { titleUnlocks: undefined, equippedTitles: undefined }); win.tsAdminRevokeTitle('s9', 't1'); });

  // ── 7. subscriber ──
  const emit = () => win.AppStore.emit({ type: 'admin:achievements-rendered' });
  const setAch = html => { ach.innerHTML = html; };
  seed(win);
  win.AppStore.emit({ type: 'admin:other' });
  await step('sub: other event ignored', () => { setAch('<div class="page-hero"><div><div>x</div><div id="bar1">bar</div></div></div>'); win.AppStore.emit({ type: 'admin:other' }); return ach.querySelectorAll('.ts-ach-titles-link').length; });
  await step('sub: bar = .page-hero > div > div:last-child', () => { emit(); return [ach.querySelectorAll('.ts-ach-titles-link').length, ach.querySelector('#bar1').querySelectorAll('button').length, ach.querySelector('.ts-ach-titles-link').textContent, ach.querySelector('.ts-ach-titles-link').style.cssText, ach.querySelector('.ts-ach-titles-link').className]; });
  await step('sub: idempotent (second emit adds nothing)', () => { emit(); emit(); return ach.querySelectorAll('.ts-ach-titles-link').length; });
  await step('sub: click -> navTo', () => { ach.querySelector('.ts-ach-titles-link').click(); });
  await step('sub: fallback .page-hero-stats', () => { setAch('<div class="page-hero-stats" id="bar2"></div>'); emit(); return ach.querySelectorAll('#bar2 .ts-ach-titles-link').length; });
  await step('sub: fallback justify-content:space-between div', () => { setAch('<div style="display:flex;justify-content:space-between" id="bar3"></div>'); emit(); return ach.querySelectorAll('#bar3 .ts-ach-titles-link').length; });
  await step('sub: no bar found', () => { setAch('<p>nothing</p>'); emit(); return ach.querySelectorAll('.ts-ach-titles-link').length; });
  await step('sub: no destination element', () => { ach.remove(); emit(); win.document.body.insertBefore(ach, win.document.body.firstChild); });
  await step('sub: click without navTo falls back to renderAdminTitles', () => {
    setAch('<div class="page-hero"><div><div>x</div><div>bar</div></div></div>'); emit(); const nt = win.navTo; win.navTo = undefined;
    a.innerHTML = ''; ach.querySelector('.ts-ach-titles-link').click(); win.navTo = nt; return a.innerHTML.length > 100;
  });
  return out;
}

function firstDiff(a, b, p) {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], p + '.' + k); if (d) return d; }
  }
  const t = v => { const j = JSON.stringify(v); return j === undefined ? 'undefined' : j; };
  let i = 0; const sa = t(a), sb = t(b); while (i < sa.length && sa[i] === sb[i]) i++;
  return p + '\n  original: ...' + sa.slice(Math.max(0, i - 80), i + 200) + '\n  bridge:   ...' + sb.slice(Math.max(0, i - 80), i + 200);
}

async function main() {
  reverseTransformCheck();
  const A = makeWindow(), B = makeWindow();
  await evalOriginal(A.win);
  await evalBridge(B.win);
  const oa = await run(A.win, A.logs), ob = await run(B.win, B.logs);
  const fd = firstDiff(clean(oa), clean(ob), 'out');
  assert.strictEqual(fd, null, 'bridge output must exactly match the original at every step — first difference at: ' + fd);

  // ── independent sanity (guards against a vacuous both-sides-wrong pass) ──
  const o = clean(oa);
  const S = label => { const s = o.steps.find(x => x.label === label); assert(s, 'missing step ' + label); return s; };
  assert.deepStrictEqual(o.surface.fns.map(e => e[1]), Array(12).fill('function'));
  assert(o.surface.loadLogs.some(l => l.includes('titles/admin-page.js loaded')), 'load log');
  assert.strictEqual(S('render: no destination').titlesPage, null);
  assert(S('render: legacy destination #a-achievements').achPage.includes('ts-admin-cards-grid') && S('render: legacy destination #a-achievements').titlesPage === null, 'legacy dest used when #a-titles is missing (it is detached in this step)');
  const full = S('render: full page, no getClassLabel').titlesPage, fullL = S('render: full page, with getClassLabel').titlesPage;
  assert(full.includes('c1, c2') && fullL.includes('Sec C1, Sec C2'), 'section labels with / without getClassLabel');
  assert(full.includes('All sections'), 'unassigned -> All sections');
  assert(full.includes('Alpha &lt;b&gt;') && full.includes('Linked &lt;Ach&gt;'), 'title + linked achievement names escaped');
  assert(full.includes('ts-admin-card-inactive'), 'inactive card class');
  assert(S('render: empty state').titlesPage.includes('dashed'), 'empty state');
  assert.strictEqual(S('render: all slices null').err, null, 'null slices tolerated');
  const stats = S('stats: direct builder (top-6 slice, stable ties, rarity pct)').ret;
  assert(stats.includes('T6Name') && !stats.includes('T7Name') && !stats.includes('T8Name'), 'top-6 slice keeps ties in stable order and drops the 7th/8th');
  assert(stats.includes('25%') && stats.includes('13%'), 'rarity pct (2/8=25%, 1/8 rounds to 13%)');
  assert(S('stats: direct builder, zero titles').ret.includes('0%') && !S('stats: direct builder, zero titles').ret.includes('NaN'), 'zero-title pct guard');
  assert(S('stats: direct builder, zero titles').ret.includes('No unlocks yet') && S('stats: direct builder, zero titles').ret.includes('No equipped titles yet'), 'empty-list messages only appear with zero titles (titles with zero counts are still listed)');
  assert(!S('stats: no unlocks / no equipped lists').ret.includes('No unlocks yet'), 'zero-count titles are still listed, so no empty message');
  const hasAct = c => c.split(/\s+/).includes('active');
  const ts1 = S('tab switch to stats').ret, ts2 = S('tab switch to library').ret;
  assert(!hasAct(ts1[0]) && hasAct(ts1[1]) && !hasAct(ts1[2]) && hasAct(ts1[3]), 'switch to stats activates the stats tab+panel only');
  assert(hasAct(ts2[0]) && !hasAct(ts2[1]) && hasAct(ts2[2]) && !hasAct(ts2[3]), 'switch back to library activates the library tab+panel only');
  assert.strictEqual(S('partial refresh: panel replaced').ret, true);
  const d1 = S('delete: accepted (cascade unlock + equipped, rpc ok)');
  assert(!d1.state.t.some(x => x[0] === 't1') && Object.values(d1.state.u).every(l => !l.includes('t1')) && d1.state.e.s1 === null && d1.state.e.s2 === null && d1.state.e.s3 === 't2', 'delete cascades unlocks and unequips only the deleted title');
  assert.deepStrictEqual(d1.events, ['titles:title-deleted:{"id":"t1"}'], 'delete emits titles:title-deleted');
  assert.deepStrictEqual(d1.rpc, [{ name: 'delete_title', params: { p_title_id: 't1' } }]); assert(d1.toast.includes('Title deleted'));
  assert(S('delete: confirm declined').state.t.length === 8 && S('delete: confirm declined').rpc.length === 0);
  assert(S('delete: not found').calls.length === 0 && S('delete: not found').rpc.length === 0);
  assert(S('delete: rpc error warns').toast.includes('may not have synced: denied'));
  assert(S('delete: accepted without optional slices').err === null);
  assert.deepStrictEqual(S('toggle: active -> disabled').events, ['titles:toggled:{"id":"t1"}']);
  assert.deepStrictEqual(S('duplicate: no owner -> current user').events, ['titles:duplicated:{"sourceId":"t2"}']);
  assert(S('toggle: active -> disabled').toast.includes('Title disabled') && S('toggle: inactive -> enabled').toast.includes('Title enabled'));
  assert.strictEqual(S('toggle refreshes the panel when present').ret, true);
  const du = S('duplicate: owner carried forward').state.t.slice(-1)[0]; assert(du[1] === 'Alpha <b> (Copy)' && du[3] === 'owner9');
  assert.strictEqual(S('duplicate: no owner -> current user').state.t.slice(-1)[0][3], 't1');
  assert(S('grant modal: no titles').toast.includes('Create titles first'));
  assert(S('grant modal: options escaped + icon fallback').modal.content.includes('Ana &lt;i&gt;') && S('grant modal: options escaped + icon fallback').modal.content.includes('👑 Beta'), 'options escaped; empty icon -> crown');
  assert(S('student titles panel: nothing unlocked').ret[1].includes('No titles unlocked yet'));
  assert(S('student titles panel: unlocked + equipped marker').ret.includes('>EQUIPPED<') && !S('student titles panel: null equipped slice').ret.includes('>EQUIPPED<'), 'equipped marker');
  assert.strictEqual(S('confirm: no student').ret[0], 'Please select a student.'); assert.strictEqual(S('confirm: no title').ret[0], 'Please select a title.');
  assert(S('confirm grant: already has it').ret[0].includes('already has this title'));
  const g = S('confirm grant: success'); assert(g.calls.includes(JSON.stringify(['tsUnlockTitleForStudent', 's4', 't6', true])) && g.ret === 'none' && g.toast.includes('Granted'));
  assert(S('confirm revoke: not owned').ret[0].includes('does not have this title'));
  const rv = S('confirm revoke: success (unequips + syncs)'); assert(rv.calls.includes(JSON.stringify(['syncTitleRevokeToServer', 's1', 't1'])) && rv.state.e.s1 === null && rv.toast.includes('Revoked'), 'revoke syncs + unequips');
  assert.deepStrictEqual(S('revoke: direct, equipped title cleared').events, ['titles:revoked:{"sid":"s3","tid":"t2"}']);
  assert(S('revoke: direct, equipped title cleared').state.e.s3 === null && S('revoke: direct, other equipped title kept').state.e.s3 === 't2');
  assert.strictEqual(S('sub: other event ignored').ret, 0);
  const sb = S('sub: bar = .page-hero > div > div:last-child').ret; assert.deepStrictEqual([sb[0], sb[1], sb[2], sb[3], sb[4]], [1, 1, '👑 Manage Titles', 'margin-top: 8px;', 'btn btn-ghost btn-sm ts-ach-titles-link']);
  assert.strictEqual(S('sub: idempotent (second emit adds nothing)').ret, 1);
  assert(S('sub: click -> navTo').calls.includes(JSON.stringify(['navTo', 'a-titles'])));
  assert.strictEqual(S('sub: fallback .page-hero-stats').ret, 1); assert.strictEqual(S('sub: fallback justify-content:space-between div').ret, 1); assert.strictEqual(S('sub: no bar found').ret, 0);
  assert.strictEqual(S('sub: click without navTo falls back to renderAdminTitles').ret, true);
  assert.strictEqual(o.steps.filter(s => s.err).length, 0, 'no unexpected exceptions in any step');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log(' - reverse-transform: original rebuilt byte-for-byte from the twin; 12 exports');
  console.log(' - ' + o.steps.length + ' steps compared');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
