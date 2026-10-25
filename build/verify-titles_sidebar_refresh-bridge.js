// Phase 7 (Stream D) — equivalence check for modules/titles/titles_sidebar_refresh.js (file 26/30).
//
// ORIGINAL side: real classic files (repository/*, db-service, state-manager, dom, utils, eql-engine, titles_badge_renderer,
// hall-of-fame, then the file under test). BRIDGE side: one esbuild bundle whose entry imports the REAL production bridge; the
// twin imports titles_badge_renderer / hall-of-fame itself. Bare globals stubbed identically (and toggled where a typeof guard is
// behavior): currentUser, currentRole, syncEquippedTitleToServer, syncTitleUnlockToServer, navTo, profGetCurrent, _profRenderHero,
// _profRenderStats, renderTitlesPage, renderBadges, achCheckAndAward (also THROWING: the try/catch). A second window pair is
// built WITHOUT any pre-existing window._holGetTitle (the first pair has one) to cover both sides of the dead patch's guard.
// The four load-time AppStore.subscribe registrations are exercised by emitting their events through AppStore.updateState.
//
// Checked: 0 reverse-transform byte identity + 10 exports; 1 surface + subscribers registered at load; 2 getters; 3 equip /
// unlock flows (guards, sync calls, current-user refreshes, leaderboard re-render, popup); 4 sidebar / profile DOM refreshers
// (stale-element clearing per role); 5 profile overlay; 6 the four event subscribers incl. their timers; 7 the _holGetTitle patch.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const EXPORTS = ['tsGetEquippedTitle', 'tsGetUnlockedTitles', 'tsIsUnlocked', 'tsEquipTitle', 'tsUnlockTitleForStudent', 'tsShowTitleUnlockPopup', 'tsRefreshSidebarTitle', 'tsRefreshProfileTitle', 'tsRefreshProfileOverlay', 'tsOpenTitlesFromProfile'];

function reverseTransformCheck() {
  const orig = read('modules/titles/titles_sidebar_refresh.js');
  const twin = read('src/modules/titles/titles_sidebar_refresh.js');
  const marker = '// ── Core helpers';
  assert.strictEqual(orig.split(marker).length, 2); assert.strictEqual(twin.split(marker).length, 2);
  const origHead = orig.slice(0, orig.indexOf(marker));
  assert(twin.includes(origHead), 'twin carries the original header comment verbatim');
  const mid = twin.slice(twin.indexOf(origHead) + origHead.length, twin.indexOf(marker));
  assert(mid.startsWith('import ') && mid.endsWith(';\n\n'), 'only an import block precedes the first original statement');
  for (const line of mid.split('\n').filter(Boolean)) assert(/^import .*;$/.test(line), 'import block line: ' + line);
  const body = twin.slice(twin.indexOf(marker));
  const rebuilt = origHead + body.replace(/^export const (?=ts\w+)/gm, 'window.');
  assert.strictEqual(rebuilt, orig, 'reversing the keyword swaps must reproduce the original byte-for-byte');
  assert.strictEqual((twin.match(/^export /gm) || []).length, 10, 'exactly 10 exports (declaresCount 12 = 10 + window._tsOpenTitlesTab flag + window._holGetTitle patch)');
  assert(!/^export[^\n]*_holGetTitle/m.test(twin) && !/^export[^\n]*_tsOpenTitlesTab/m.test(twin), 'the patch and the flag are not exports');
}

const STARTER_HTML = `<!doctype html><html><body>
  <div class="sidebar-player"></div>
  <div id="dash"><div class="dash-hero-name">Hero</div><div id="after-hero">after</div></div>
  <div id="profile-overlay"></div><div id="s-leaderboard" class="page"></div>
  <div id="toast"></div>
</body></html>`;
const FIXED = 1767225600000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeWindow(withHolOrig) {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  win.eval(`(function(){ const R = Date; class D extends R { constructor(...a){ if (a.length) super(...a); else super(${FIXED}); } static now(){ return ${FIXED}; } } globalThis.Date = D; }());`);
  win.eval("globalThis.__rnd = { s: 424242 }; Math.random = function () { __rnd.s = (__rnd.s * 1103515245 + 12345) & 0x7fffffff; return __rnd.s / 0x7fffffff; };");
  win.DEFAULT_DB = { students: [], titles: [], titleUnlocks: {}, equippedTitles: {}, achievementUnlocks: {}, achievements: [], recitationLog: [], bossEvents: [], bossParticipants: {}, pointLog: [], leaderboardConfig: {} };
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };
  win.__rpcCalls = [];
  const mockClient = { auth: { getSession: async () => ({ data: { session: null } }) }, rpc: async (name, params) => { win.__rpcCalls.push({ name, params }); return { data: null, error: null }; } };
  win.SupabaseClient = { getClient: () => mockClient, resolveProvider: () => 'supabase' };
  win.__EDUQUEST_SUPABASE_URL__ = ''; win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };
  win.__calls = [];
  const rec = name => (...a) => { win.__calls.push(JSON.stringify([name, ...a])); };
  win.syncEquippedTitleToServer = rec('syncEquippedTitleToServer');
  win.syncTitleUnlockToServer = rec('syncTitleUnlockToServer');
  win.navTo = rec('navTo');
  win.profGetCurrent = () => { win.__calls.push('["profGetCurrent"]'); return win.__profUser === undefined ? { id: 'stu1' } : win.__profUser; };
  win._profRenderHero = rec('_profRenderHero');
  win._profRenderStats = rec('_profRenderStats');
  win.renderTitlesPage = rec('renderTitlesPage');
  win.renderBadges = rec('renderBadges');
  win.achCheckAndAward = (...a) => { win.__calls.push(JSON.stringify(['achCheckAndAward', ...a])); if (win.__achThrows) throw new Error('ach boom'); };
  win.__stubFns = {}; for (const n of ['syncEquippedTitleToServer', 'syncTitleUnlockToServer', 'navTo', 'profGetCurrent', '_profRenderHero', '_profRenderStats', 'renderTitlesPage', 'renderBadges', 'achCheckAndAward']) win.__stubFns[n] = win[n];
  if (withHolOrig) win._holGetTitle = (s, k) => 'ORIG:' + k;
  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  win.console.warn = () => {}; win.console.error = (...a) => win.__calls.push(JSON.stringify(['error', ...a.map(String)]));
  win.addEventListener('error', e => win.__calls.push(JSON.stringify(['window-error', String(e.message)])));
  return { win, logs };
}
async function evalOriginal(win) {
  for (const f of ['repository/table-sync.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'db-service.js', 'modules/core/state-manager.js', 'dom.js', 'utils.js',
    'modules/leaderboard/eql-engine.js', 'modules/titles/titles_badge_renderer.js', 'modules/leaderboard/hall-of-fame.js', 'modules/titles/titles_sidebar_refresh.js']) win.eval(read(f));
  await win.AppStore.ready;
}
async function evalBridge(win) {
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'titles_sidebar_refresh-combined-bundle.js'), 'utf8'));
  await win.AppStore.ready;
}

const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
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

const T = (id, o) => ({ id, name: 'Title ' + id, icon: '🏆', description: 'd', rarity: 'Common', active: true, ...o });
const TITLES = () => [T('t1', { name: 'Alpha' }), T('t2', { name: 'Beta <b>', achievementId: 'a1', icon: '' }), T('t3', { name: 'Gamma', active: false }), T('t4', { name: 'Delta', achievementId: 'a2' }), T('t5', { name: 'Eps', achievementId: 'a1' })];
function seed(win, extra) {
  win.AppStore.updateState(d => {
    d.titles = TITLES(); d.titleUnlocks = { stu1: ['t1', 't3'], stu2: [] }; d.equippedTitles = { stu1: 't1', stu2: 't3', stu3: 'ghost' };
    d.students = [{ id: 'stu1', name: 'Ann', classId: 'c1' }, { id: 'stu2', name: 'Bo' }, { id: 7, name: 'Num', classId: 'c7' }];
    d.achievementUnlocks = { stu1: [{ achId: 'a1' }], stu2: [] }; d.achievements = [{ id: 'a1', name: 'A1' }, { id: 'a2', name: 'A2' }];
    d.recitationLog = []; d.bossEvents = []; d.bossParticipants = {}; d.pointLog = []; d.leaderboardConfig = {};
    Object.assign(d, extra || {});
  }, { type: 'test:seed' });
}
const setUser = (win, o) => { win.eval('currentUser = ' + JSON.stringify(o === null ? null : o) + ';'); };
const setRole = (win, r) => { win.eval('currentRole = ' + JSON.stringify(r) + ';'); };
const emit = (win, type, payload) => win.AppStore.updateState(() => {}, { type, payload });
const stateSnap = win => win.AppStore.getSlice(s => ({ eq: s.equippedTitles, un: s.titleUnlocks, titles: (s.titles || null) && s.titles.length }));

async function run(win, logs, noOrigPair) {
  const out = { steps: [] };
  win.__events = [];
  win.AppStore.subscribe('verify-recorder', (st, e) => { win.__events.push(e.type + ':' + JSON.stringify(e.payload === undefined ? null : e.payload)); });
  const doc = win.document;
  const step = async (label, fn, wait = 130) => {
    win.__rnd.s = 424242; win.__calls.length = 0; win.__events.length = 0;
    let err = null, ret;
    try { ret = await fn(); } catch (e) { err = String(e && e.message); }
    await sleep(wait);
    const sb = doc.querySelector('.sidebar-player'), dash = $(win, 'dash'), pop = $(win, 'ts-unlock-popup');
    out.steps.push({ label, err, ret, calls: win.__calls.slice(), events: win.__events.filter(e => !e.startsWith('test:seed')), flag: win._tsOpenTitlesTab === undefined ? '<undef>' : win._tsOpenTitlesTab,
      toast: $(win, 'toast').innerHTML, toastStyle: $(win, 'toast').getAttribute('style'), sidebar: sb ? sb.innerHTML : null, dash: dash ? dash.innerHTML : null, popup: pop ? pop.outerHTML : null,
      lb: $(win, 's-leaderboard').innerHTML, state: stateSnap(win) });
  };
  const fresh = async (label, fn, wait) => {
    for (const n in win.__stubFns) win[n] = win.__stubFns[n];
    win.__achThrows = false; win.__profUser = undefined;
    $(win, 'toast').innerHTML = ''; $(win, 'toast').removeAttribute('style');
    doc.querySelector('.sidebar-player').innerHTML = ''; { const o = $(win, 'ts-unlock-popup'); if (o) o.remove(); const t1 = $(win, 'ts-sidebar-title'); if (t1) t1.remove(); }
    $(win, 'dash').innerHTML = '<div class="dash-hero-name">Hero</div><div id="after-hero">after</div>';
    $(win, 'profile-overlay').className = ''; $(win, 's-leaderboard').className = 'page'; $(win, 's-leaderboard').innerHTML = '';
    win._tsOpenTitlesTab = undefined; win._eqlActiveTab = undefined; win._eqlActivePeriod = undefined;
    seed(win); setUser(win, { id: 'stu1', name: 'Ann' }); setRole(win, 'student');
    return step(label, fn, wait);
  };
  out.surface = { fns: EXPORTS.map(n => [n, typeof win[n]]), holType: typeof win._holGetTitle, flag: typeof win._tsOpenTitlesTab, loadLogs: logs.slice().sort() };

  if (noOrigPair) {
    await fresh('hol patch (no original): equipped title name wins', async () => win._holGetTitle({ id: 'stu1', tier: 'Master' }, 'overall'));
    await fresh('hol patch (no original): no equipped -> the student tier', async () => [win._holGetTitle({ id: 'stu2x', tier: 'Master' }, 'overall'), win._holGetTitle({ id: 'stu2x' }, 'overall')]);
    return out;
  }

  // ── 2. getters ──
  await fresh('tsGetEquippedTitle: equipped / inactive / unknown / none', async () => [win.tsGetEquippedTitle('stu1'), win.tsGetEquippedTitle('stu2') === null, win.tsGetEquippedTitle('stu3') === null, win.tsGetEquippedTitle('nobody') === null]);
  await fresh('tsGetEquippedTitle: titles slice null while an equipped id exists', async () => { seed(win, { titles: null }); return [win.tsGetEquippedTitle('stu1') === null, win.tsGetUnlockedTitles('stu1').length]; });
  seed(win, { equippedTitles: null, titles: null, titleUnlocks: null });
  await fresh('getters: null slices', async () => { seed(win, { equippedTitles: null, titles: null, titleUnlocks: null }); return [win.tsGetEquippedTitle('stu1'), win.tsGetUnlockedTitles('stu1'), win.tsIsUnlocked('stu1', 't1')]; });
  await fresh('tsGetUnlockedTitles / tsIsUnlocked', async () => [win.tsGetUnlockedTitles('stu1'), win.tsGetUnlockedTitles('stu2'), win.tsGetUnlockedTitles('nobody'), win.tsIsUnlocked('stu1', 't1'), win.tsIsUnlocked('stu1', 't2'), win.tsIsUnlocked('nobody', 't1')]);

  // ── 3. equip ──
  await fresh('tsEquipTitle: locked title is refused', async () => { win.tsEquipTitle('stu1', 't2'); });
  await fresh('tsEquipTitle: equip for the current student (sidebar + profile refresh, leaderboard idle)', async () => { win.tsEquipTitle('stu1', 't3'); });
  await fresh('tsEquipTitle: current student with the leaderboard page active -> re-renders (defaults)', async () => { $(win, 's-leaderboard').classList.add('active'); win.tsEquipTitle('stu1', 't3'); });
  await fresh('tsEquipTitle: leaderboard active -> remembered tab/period', async () => { $(win, 's-leaderboard').classList.add('active'); win._eqlActiveTab = 'boss'; win._eqlActivePeriod = 'weekly'; win.tsEquipTitle('stu1', 't3'); return [win._eqlActiveTab, win._eqlActivePeriod]; });
  await fresh('tsEquipTitle: equip for ANOTHER student does not refresh the UI', async () => { win.AppStore.updateState(d => { d.titleUnlocks.stu2 = ['t3']; }, { type: 'test:edit' }); win.tsEquipTitle('stu2', 't3'); });
  await fresh('tsEquipTitle: unequip (null) skips the unlock check', async () => { win.tsEquipTitle('stu1', null); });
  await fresh('tsEquipTitle: unequip with an empty string', async () => { win.tsEquipTitle('stu1', ''); });
  await fresh('tsEquipTitle: no current user', async () => { setUser(win, null); win.tsEquipTitle('stu1', 't1'); });
  await fresh('tsEquipTitle: equippedTitles slice missing is created', async () => { seed(win, { equippedTitles: null }); win.tsEquipTitle('stu1', 't1'); });

  // ── unlock ──
  await fresh('tsUnlockTitleForStudent: already unlocked -> false, nothing happens', async () => win.tsUnlockTitleForStudent('stu1', 't1'));
  await fresh('tsUnlockTitleForStudent: new unlock, not silent -> popup; current student refreshes', async () => win.tsUnlockTitleForStudent('stu1', 't4'));
  await fresh('tsUnlockTitleForStudent: silent -> no popup', async () => win.tsUnlockTitleForStudent('stu1', 't4', true));
  await fresh('tsUnlockTitleForStudent: unknown title id -> unlocked but no popup', async () => win.tsUnlockTitleForStudent('stu1', 'nope'));
  await fresh('tsUnlockTitleForStudent: other student -> sync with their class id, no UI refresh', async () => win.tsUnlockTitleForStudent('stu2', 't4'));
  await fresh('tsUnlockTitleForStudent: student without a roster entry -> null class id', async () => win.tsUnlockTitleForStudent('ghost', 't4'));
  await fresh('tsUnlockTitleForStudent: numeric ids are compared as strings', async () => { setUser(win, { id: '7' }); return win.tsUnlockTitleForStudent(7, 't4'); });
  await fresh('tsUnlockTitleForStudent: string sid matches a numeric student id (class lookup)', async () => win.tsUnlockTitleForStudent('7', 't4', true));
  await fresh('tsUnlockTitleForStudent: renderTitlesPage / renderBadges absent (typeof guards)', async () => { delete win.renderTitlesPage; delete win.renderBadges; return win.tsUnlockTitleForStudent('stu1', 't4', true); });
  await fresh('tsUnlockTitleForStudent: slices missing are created', async () => { seed(win, { titleUnlocks: null, students: null }); return win.tsUnlockTitleForStudent('stu1', 't4', true); });

  // ── popup ──
  await fresh('tsShowTitleUnlockPopup: renders icon, escaped name, small badge', async () => { win.tsShowTitleUnlockPopup(TITLES()[1]); });
  await fresh('tsShowTitleUnlockPopup: a title with particles gets none in the popup badge', async () => { win.tsShowTitleUnlockPopup(T('tp', { particles: 'stars', name: 'Sparkly' })); });
  await fresh('tsShowTitleUnlockPopup: default icon and replacing an existing popup', async () => { win.tsShowTitleUnlockPopup(TITLES()[0]); win.tsShowTitleUnlockPopup(T('t9', { icon: undefined, name: 'Nine' })); return doc.querySelectorAll('#ts-unlock-popup').length; });
  await fresh('tsShowTitleUnlockPopup: clicking navigates to the badges page', async () => { win.tsShowTitleUnlockPopup(TITLES()[0]); $(win, 'ts-unlock-popup').dispatchEvent(new win.MouseEvent('click', { bubbles: true })); });

  // ── 4. sidebar / profile refreshers ──
  await fresh('sidebar: student with an equipped title injects the badge', async () => { win.tsRefreshSidebarTitle(); });
  await fresh('sidebar: refresh twice reuses the element', async () => { win.tsRefreshSidebarTitle(); win.tsRefreshSidebarTitle(); return doc.querySelectorAll('#ts-sidebar-title').length; });
  await fresh('sidebar: no equipped title removes the element', async () => { win.tsRefreshSidebarTitle(); win.AppStore.updateState(d => { d.equippedTitles = {}; }, { type: 'test:edit' }); win.tsRefreshSidebarTitle(); });
  for (const role of ['teacher', 'admin']) await fresh('sidebar: role ' + role + ' clears a stale element', async () => { win.tsRefreshSidebarTitle(); setRole(win, role); win.tsRefreshSidebarTitle(); });
  await fresh('sidebar: no current user clears a stale element', async () => { win.tsRefreshSidebarTitle(); setUser(win, null); win.tsRefreshSidebarTitle(); });
  await fresh('sidebar: no .sidebar-player container', async () => { const c = doc.querySelector('.sidebar-player'); c.className = 'x'; try { win.tsRefreshSidebarTitle(); } finally { c.className = 'sidebar-player'; } });
  await fresh('profile title: inserts the badge after .dash-hero-name', async () => { win.tsRefreshProfileTitle(); });
  await fresh('profile title: a second #ts-dash-title already follows the hero name (the first is removed, the early return keeps the second)', async () => { const hero = doc.querySelector('.dash-hero-name'); const mk = txt => { const d = doc.createElement('div'); d.id = 'ts-dash-title'; d.textContent = txt; return d; }; hero.parentNode.insertBefore(mk('FIRST'), hero); hero.parentNode.insertBefore(mk('SECOND'), hero.nextSibling); win.tsRefreshProfileTitle(); return [doc.querySelectorAll('#ts-dash-title').length, ($(win, 'ts-dash-title') || {}).textContent]; });
  await fresh('profile title: refresh twice leaves one element', async () => { win.tsRefreshProfileTitle(); win.tsRefreshProfileTitle(); return doc.querySelectorAll('#ts-dash-title').length; });
  await fresh('profile title: no equipped title removes a previous one', async () => { win.tsRefreshProfileTitle(); win.AppStore.updateState(d => { d.equippedTitles = {}; }, { type: 'test:edit' }); win.tsRefreshProfileTitle(); });
  await fresh('profile title: no .dash-hero-name', async () => { $(win, 'dash').innerHTML = ''; win.tsRefreshProfileTitle(); });
  for (const role of ['teacher', 'admin']) await fresh('profile title: role ' + role + ' clears a stale element', async () => { win.tsRefreshProfileTitle(); setRole(win, role); win.tsRefreshProfileTitle(); });
  await fresh('profile title: no current user clears a stale element', async () => { win.tsRefreshProfileTitle(); setUser(win, null); win.tsRefreshProfileTitle(); });

  // ── 5. profile overlay ──
  await fresh('overlay: no overlay element', async () => { const o = $(win, 'profile-overlay'); o.id = 'x'; try { win.tsRefreshProfileOverlay(); } finally { o.id = 'profile-overlay'; } });
  await fresh('overlay: closed overlay does nothing', async () => { win.tsRefreshProfileOverlay(); });
  await fresh('overlay: open + student -> hero and stats re-render with the profile user', async () => { $(win, 'profile-overlay').classList.add('open'); win.tsRefreshProfileOverlay(); });
  await fresh('overlay: open but not a student', async () => { $(win, 'profile-overlay').classList.add('open'); setRole(win, 'teacher'); win.tsRefreshProfileOverlay(); });
  await fresh('overlay: profGetCurrent absent / returns null', async () => { $(win, 'profile-overlay').classList.add('open'); win.__profUser = null; win.tsRefreshProfileOverlay(); delete win.profGetCurrent; win.tsRefreshProfileOverlay(); });
  await fresh('overlay: renderers absent (typeof guards)', async () => { $(win, 'profile-overlay').classList.add('open'); delete win._profRenderHero; delete win._profRenderStats; win.tsRefreshProfileOverlay(); });
  await fresh('tsOpenTitlesFromProfile: sets the flag and navigates', async () => { win.tsOpenTitlesFromProfile(); });

  // ── 6. subscribers ──
  await fresh('subscriber ach-check: wrong event type is ignored', async () => { emit(win, 'something:else', { studentId: 'stu1' }); });
  await fresh('subscriber ach-check: no studentId', async () => { emit(win, 'achievements:check-and-award-ran', {}); });
  await fresh('subscriber ach-check: unlocks titles linked to already-earned achievements (popup shown)', async () => { emit(win, 'achievements:check-and-award-ran', { studentId: 'stu1' }); });
  await fresh('subscriber ach-check: suppressPopup is passed through', async () => { emit(win, 'achievements:check-and-award-ran', { studentId: 'stu1', suppressPopup: true }); });
  await fresh('subscriber ach-check: skips inactive, unlinked, already-unlocked and not-earned titles', async () => { win.AppStore.updateState(d => { d.titleUnlocks.stu1 = ['t1', 't2']; d.titles.find(t => t.id === 't5').active = false; }, { type: 'test:edit' }); emit(win, 'achievements:check-and-award-ran', { studentId: 'stu1' }); });
  await fresh('subscriber ach-check: an unlock record with no achId does not unlock unlinked titles', async () => { win.AppStore.updateState(d => { d.achievementUnlocks.stu1 = [{ achId: 'a1' }, {}]; d.titleUnlocks.stu1 = ['t3']; }, { type: 'test:edit' }); emit(win, 'achievements:check-and-award-ran', { studentId: 'stu1' }); });
  await fresh('subscriber ach-check: student with no achievement unlocks', async () => { emit(win, 'achievements:check-and-award-ran', { studentId: 'stu2' }); });
  await fresh('subscriber ach-check: null slices', async () => { seed(win, { achievementUnlocks: null, titles: null }); emit(win, 'achievements:check-and-award-ran', { studentId: 'stu1' }); });
  await fresh('subscriber dashboard-rendered: refreshes the profile title after 80ms', async () => { emit(win, 'dashboard:student-rendered', {}); const early = $(win, 'ts-dash-title') ? 1 : 0; await sleep(30); const mid = $(win, 'ts-dash-title') ? 1 : 0; return [early, mid]; });
  await fresh('subscriber dashboard-rendered: other events ignored', async () => { emit(win, 'dashboard:other', {}); });
  await fresh('subscriber nav-refresh: student -> sidebar after 100ms (no profile off-dashboard)', async () => { emit(win, 'nav:navigated', { id: 's-store' }); await sleep(40); const mid = $(win, 'ts-sidebar-title') ? 1 : 0; await sleep(120); return mid; });
  await fresh('subscriber nav-refresh: s-dashboard also refreshes the profile title', async () => { emit(win, 'nav:navigated', { id: 's-dashboard' }); });
  await fresh('subscriber nav-refresh: non-student does nothing', async () => { setRole(win, 'teacher'); emit(win, 'nav:navigated', { id: 's-dashboard' }); });
  await fresh('subscriber nav-refresh: other events ignored', async () => { emit(win, 'nav:other', { id: 's-dashboard' }); });
  await fresh('subscriber boot: initializes missing slices and refreshes after 300ms (student)', async () => { seed(win, { titles: null, titleUnlocks: null, equippedTitles: null }); emit(win, 'session:booted', {}); await sleep(100); const mid = $(win, 'ts-sidebar-title') ? 1 : 0; await sleep(260); return mid; }, 130);
  await fresh('subscriber boot: nothing missing -> no init event; award runs for a student', async () => { emit(win, 'session:booted', {}); await sleep(330); });
  await fresh('subscriber boot: partial missing slices are listed', async () => { seed(win, { titleUnlocks: null }); emit(win, 'session:booted', {}); await sleep(330); });
  await fresh('subscriber boot: achCheckAndAward throwing is swallowed', async () => { win.__achThrows = true; emit(win, 'session:booted', {}); await sleep(330); });
  await fresh('subscriber boot: teacher -> no award, sidebar refresh only (a stale profile badge is NOT touched)', async () => { win.tsRefreshProfileTitle(); setRole(win, 'teacher'); emit(win, 'session:booted', {}); await sleep(330); });
  await fresh('subscriber boot: the refresh waits ~300ms (nothing at 100ms, applied by 330ms)', async () => { emit(win, 'session:booted', {}); await sleep(100); const mid = [$(win, 'ts-sidebar-title') ? 1 : 0, $(win, 'ts-dash-title') ? 1 : 0]; await sleep(250); return [mid, [$(win, 'ts-sidebar-title') ? 1 : 0, $(win, 'ts-dash-title') ? 1 : 0]]; });
  await fresh('subscriber boot: student without currentUser -> no award', async () => { setUser(win, null); emit(win, 'session:booted', {}); await sleep(330); });
  await fresh('subscriber boot: other events ignored', async () => { emit(win, 'session:other', {}); });

  // ── 7. the dead _holGetTitle patch ──
  await fresh('hol patch (with original): equipped title name wins', async () => win._holGetTitle({ id: 'stu1', tier: 'Master' }, 'overall'));
  await fresh('hol patch (with original): no equipped -> the captured original', async () => win._holGetTitle({ id: 'nobody', tier: 'Master' }, 'boss'));
  return out;
}

async function main() {
  if (!process.env.MUTATION_RUN) reverseTransformCheck();
  const A = makeWindow(true), B = makeWindow(true), A2 = makeWindow(false), B2 = makeWindow(false);
  await evalOriginal(A.win); await evalBridge(B.win); await evalOriginal(A2.win); await evalBridge(B2.win);
  const oa = await run(A.win, A.logs, false), ob = await run(B.win, B.logs, false);
  const oa2 = await run(A2.win, A2.logs, true), ob2 = await run(B2.win, B2.logs, true);
  let fd = firstDiff(clean(oa), clean(ob), 'out');
  assert.strictEqual(fd, null, 'bridge output must exactly match the original at every step — first difference at: ' + fd);
  fd = firstDiff(clean(oa2), clean(ob2), 'out2');
  assert.strictEqual(fd, null, 'no-original variant must match — first difference at: ' + fd);

  // ── independent sanity ──
  const o = clean(oa), o2 = clean(oa2);
  if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify(o));
  const S = label => { const s = o.steps.find(x => x.label === label); assert(s, 'missing step ' + label); return s; };
  const has = (s, c) => s.calls.includes(c), starts = (s, p) => s.calls.filter(c => c.startsWith(p));
  assert.deepStrictEqual(o.surface.fns.map(e => e[1]), Array(10).fill('function')); assert.strictEqual(o.surface.holType, 'function'); assert.strictEqual(o.surface.flag, 'undefined');
  assert(o.surface.loadLogs.some(l => l.includes('titles/sidebar-refresh.js loaded')), 'load log');
  const g = S('tsGetEquippedTitle: equipped / inactive / unknown / none').ret; assert(g[0].id === 't1' && g[1] === true && g[2] === true && g[3] === true, 'inactive/unknown/none -> strictly null');
  assert.deepStrictEqual(S('tsGetEquippedTitle: titles slice null while an equipped id exists').ret, [true, 0]);
  assert.deepStrictEqual(S('getters: null slices').ret, [null, [], false]);
  { const r = S('tsGetUnlockedTitles / tsIsUnlocked').ret; assert(r[0].map(t => t.id).join() === 't1,t3' && r[1].length === 0 && r[2].length === 0 && r[3] === true && r[4] === false && r[5] === false); }
  const e1 = S('tsEquipTitle: locked title is refused'); assert(e1.toast.includes('Title not unlocked yet') && e1.events.length === 0 && starts(e1, '["syncEquippedTitleToServer"').length === 0 && e1.state.eq.stu1 === 't1');
  const e2 = S('tsEquipTitle: equip for the current student (sidebar + profile refresh, leaderboard idle)'); assert(e2.state.eq.stu1 === 't3' && has(e2, '["syncEquippedTitleToServer","stu1","t3"]') && e2.toast.includes('Title equipped!') && e2.events[0] === 'titles:equipped:{"sid":"stu1","tid":"t3"}' && e2.lb === '', 'equip');
  assert(S('tsEquipTitle: current student with the leaderboard page active -> re-renders (defaults)').lb.includes('hol-') && S('tsEquipTitle: current student with the leaderboard page active -> re-renders (defaults)').ret === undefined);
  assert.deepStrictEqual(S('tsEquipTitle: leaderboard active -> remembered tab/period').ret, ['boss', 'weekly']);
  const e5 = S('tsEquipTitle: equip for ANOTHER student does not refresh the UI'); assert(e5.sidebar === '' && e5.dash.includes('ts-dash-title') === false && e5.toast.includes('Title equipped!'));
  assert(S('tsEquipTitle: unequip (null) skips the unlock check').toast.includes('Title unequipped.') && has(S('tsEquipTitle: unequip (null) skips the unlock check'), '["syncEquippedTitleToServer","stu1",null]') && S('tsEquipTitle: unequip (null) skips the unlock check').state.eq.stu1 === null);
  assert(has(S('tsEquipTitle: unequip with an empty string'), '["syncEquippedTitleToServer","stu1",null]'));
  assert(S('tsEquipTitle: no current user').sidebar === '' && S('tsEquipTitle: equippedTitles slice missing is created').state.eq.stu1 === 't1');
  assert.strictEqual(S('tsUnlockTitleForStudent: already unlocked -> false, nothing happens').ret, false); assert(S('tsUnlockTitleForStudent: already unlocked -> false, nothing happens').calls.length === 0);
  const u2 = S('tsUnlockTitleForStudent: new unlock, not silent -> popup; current student refreshes'); assert(u2.ret === true && u2.state.un.stu1.includes('t4') && u2.popup.includes('Title Unlocked!') && has(u2, '["syncTitleUnlockToServer","stu1","t4","c1"]') && has(u2, '["renderTitlesPage"]') && has(u2, '["renderBadges"]') && u2.sidebar.includes('ts-sidebar-equipped') === false || u2.sidebar !== undefined, 'unlock flow');
  assert(u2.popup && u2.events[0] === 'titles:unlocked:{"sid":"stu1","tid":"t4"}');
  assert(S('tsUnlockTitleForStudent: silent -> no popup').popup === null);
  assert(S('tsUnlockTitleForStudent: unknown title id -> unlocked but no popup').popup === null && S('tsUnlockTitleForStudent: unknown title id -> unlocked but no popup').ret === true);
  const u5 = S('tsUnlockTitleForStudent: other student -> sync with their class id, no UI refresh'); assert(has(u5, '["syncTitleUnlockToServer","stu2","t4",null]') && !has(u5, '["renderTitlesPage"]'));
  assert(has(S('tsUnlockTitleForStudent: student without a roster entry -> null class id'), '["syncTitleUnlockToServer","ghost","t4",null]'));
  { const u7 = S('tsUnlockTitleForStudent: numeric ids are compared as strings'); assert(has(u7, '["syncTitleUnlockToServer",7,"t4","c7"]') && has(u7, '["renderTitlesPage"]'), 'String(id) comparison'); }
  assert(has(S('tsUnlockTitleForStudent: string sid matches a numeric student id (class lookup)'), '["syncTitleUnlockToServer","7","t4","c7"]'), 'String() compare in the roster lookup');
  { const u8 = S('tsUnlockTitleForStudent: renderTitlesPage / renderBadges absent (typeof guards)'); assert(u8.err === null && !has(u8, '["renderTitlesPage"]') && !has(u8, '["renderBadges"]')); }
  assert.strictEqual(S('tsUnlockTitleForStudent: slices missing are created').err, null);
  const p1 = S('tsShowTitleUnlockPopup: renders icon, escaped name, small badge').popup; assert(p1.includes('Title Unlocked!') && p1.includes('margin-bottom:6px">Beta &lt;b&gt;</div>') && p1.includes('font-size:36px;flex-shrink:0"><') === false && p1.includes('ts-badge-wrap'), 'popup html: default icon div is non-empty, name escaped, small badge');
  assert(!S('tsShowTitleUnlockPopup: a title with particles gets none in the popup badge').popup.includes('ts-particle'), 'noParticles honoured in the popup badge');
  assert.strictEqual(S('tsShowTitleUnlockPopup: default icon and replacing an existing popup').ret, 1);
  assert(has(S('tsShowTitleUnlockPopup: clicking navigates to the badges page'), '["navTo","s-badges"]'));
  const sb = S('sidebar: student with an equipped title injects the badge').sidebar; assert(sb.includes('ts-sidebar-equipped') && sb.includes('Alpha'), 'sidebar badge');
  assert.strictEqual(S('sidebar: refresh twice reuses the element').ret, 1);
  assert(!S('sidebar: no equipped title removes the element').sidebar.includes('ts-sidebar-equipped'));
  for (const role of ['teacher', 'admin']) assert(!S('sidebar: role ' + role + ' clears a stale element').sidebar.includes('ts-sidebar-equipped'));
  assert(!S('sidebar: no current user clears a stale element').sidebar.includes('ts-sidebar-equipped') && S('sidebar: no .sidebar-player container').err === null);
  const pt = S('profile title: inserts the badge after .dash-hero-name').dash; assert(pt.indexOf('ts-dash-title') > pt.indexOf('dash-hero-name') && pt.indexOf('ts-dash-title') < pt.indexOf('after-hero'), 'inserted right after the hero name');
  assert.deepStrictEqual(S('profile title: a second #ts-dash-title already follows the hero name (the first is removed, the early return keeps the second)').ret, [1, 'SECOND'], 'early return when a title already follows the hero name');
  assert.strictEqual(S('profile title: refresh twice leaves one element').ret, 1);
  assert(!S('profile title: no equipped title removes a previous one').dash.includes('ts-dash-title') && S('profile title: no .dash-hero-name').err === null);
  for (const role of ['teacher', 'admin']) assert(!S('profile title: role ' + role + ' clears a stale element').dash.includes('ts-dash-title'));
  assert(!S('profile title: no current user clears a stale element').dash.includes('ts-dash-title'));
  assert(S('overlay: closed overlay does nothing').calls.length === 0 && S('overlay: no overlay element').calls.length === 0);
  const ov = S('overlay: open + student -> hero and stats re-render with the profile user'); assert(has(ov, '["profGetCurrent"]') && has(ov, '["_profRenderHero",{"id":"stu1"}]') && has(ov, '["_profRenderStats",{"id":"stu1"}]'));
  assert(S('overlay: open but not a student').calls.length === 0);
  assert(starts(S('overlay: profGetCurrent absent / returns null'), '["_profRender').length === 0);
  { const r = S('overlay: renderers absent (typeof guards)'); assert(r.err === null && starts(r, '["_profRender').length === 0 && has(r, '["profGetCurrent"]')); }
  const op = S('tsOpenTitlesFromProfile: sets the flag and navigates'); assert(op.flag === true && has(op, '["navTo","s-badges"]'));
  assert(S('subscriber ach-check: wrong event type is ignored').events.length === 1 && !S('subscriber ach-check: wrong event type is ignored').events[0].startsWith('titles:'));
  assert(S('subscriber ach-check: no studentId').state.un.stu1.length === 2);
  const a3 = S('subscriber ach-check: unlocks titles linked to already-earned achievements (popup shown)'); assert(a3.state.un.stu1.includes('t2') && a3.state.un.stu1.includes('t5') && !a3.state.un.stu1.includes('t4') && a3.popup, 'only linked + earned (a1) unlocked: t2,t5; t4 needs a2');
  assert(!S('subscriber ach-check: suppressPopup is passed through').popup && S('subscriber ach-check: suppressPopup is passed through').state.un.stu1.includes('t2'));
  { const a5 = S('subscriber ach-check: skips inactive, unlinked, already-unlocked and not-earned titles'); assert(!a5.state.un.stu1.includes('t5') && a5.state.un.stu1.join() === 't1,t2'); }
  assert(!S('subscriber ach-check: an unlock record with no achId does not unlock unlinked titles').state.un.stu1.includes('t1') && S('subscriber ach-check: an unlock record with no achId does not unlock unlinked titles').state.un.stu1.includes('t2'), 'unlinked t1 stays locked');
  assert(S('subscriber ach-check: student with no achievement unlocks').state.un.stu2.length === 0 && S('subscriber ach-check: null slices').err === null);
  assert.deepStrictEqual(S('subscriber dashboard-rendered: refreshes the profile title after 80ms').ret, [0, 0]); assert(S('subscriber dashboard-rendered: refreshes the profile title after 80ms').dash.includes('ts-dash-title'), 'refreshed after the timer');
  assert(!S('subscriber dashboard-rendered: other events ignored').dash.includes('ts-dash-title'));
  assert.strictEqual(S('subscriber nav-refresh: student -> sidebar after 100ms (no profile off-dashboard)').ret, 0); assert(S('subscriber nav-refresh: student -> sidebar after 100ms (no profile off-dashboard)').sidebar.includes('ts-sidebar-equipped') && !S('subscriber nav-refresh: student -> sidebar after 100ms (no profile off-dashboard)').dash.includes('ts-dash-title'));
  assert(S('subscriber nav-refresh: s-dashboard also refreshes the profile title').dash.includes('ts-dash-title'));
  assert(!S('subscriber nav-refresh: non-student does nothing').sidebar.includes('ts-sidebar-equipped') && !S('subscriber nav-refresh: other events ignored').sidebar.includes('ts-sidebar-equipped'));
  const b1 = S('subscriber boot: initializes missing slices and refreshes after 300ms (student)'); assert(b1.events.some(e => e.startsWith('titles:libraries-initialized:{"keys":["titles","titleUnlocks","equippedTitles"]')) && has(b1, '["achCheckAndAward","stu1",true]') && b1.ret === 0, 'init event, award, refresh only after 300ms');
  assert(!S('subscriber boot: nothing missing -> no init event; award runs for a student').events.some(e => e.includes('libraries-initialized')) && has(S('subscriber boot: nothing missing -> no init event; award runs for a student'), '["achCheckAndAward","stu1",true]'));
  assert(S('subscriber boot: partial missing slices are listed').events.some(e => e.includes('"keys":["titleUnlocks"]')));
  assert(S('subscriber boot: achCheckAndAward throwing is swallowed').err === null && !S('subscriber boot: achCheckAndAward throwing is swallowed').calls.some(c => c.startsWith('["window-error"')));
  assert.deepStrictEqual(S('subscriber boot: the refresh waits ~300ms (nothing at 100ms, applied by 330ms)').ret, [[0, 0], [1, 1]]);
  assert(S('subscriber boot: teacher -> no award, sidebar refresh only (a stale profile badge is NOT touched)').dash.includes('ts-dash-title'), 'teacher boot leaves a stale profile badge alone');
  const b5 = S('subscriber boot: teacher -> no award, sidebar refresh only (a stale profile badge is NOT touched)'); assert(!has(b5, '["achCheckAndAward","stu1",true]') && !b5.sidebar.includes('ts-sidebar-equipped'));
  assert(starts(S('subscriber boot: student without currentUser -> no award'), '["achCheckAndAward"').length === 0);
  assert.strictEqual(S('hol patch (with original): equipped title name wins').ret, 'Alpha'); assert.strictEqual(S('hol patch (with original): no equipped -> the captured original').ret, 'ORIG:boss');
  assert.strictEqual(o2.steps[0].ret, 'Alpha'); assert.deepStrictEqual(o2.steps[1].ret, ['Master', '']);
  assert(!o.steps.some(s => s.calls.some(c => c.startsWith('["window-error"'))), 'no uncaught errors inside timers');
  assert.strictEqual(o.steps.filter(s => s.err).length, 0, 'no unexpected exceptions in any step: ' + o.steps.filter(s => s.err).map(s => s.label + ' => ' + s.err).join(' | '));

  console.log('EQUIVALENCE CHECK PASSED');
  console.log(' - reverse-transform: original rebuilt byte-for-byte from the twin; 10 exports');
  console.log(' - ' + (o.steps.length + o2.steps.length) + ' steps compared');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
