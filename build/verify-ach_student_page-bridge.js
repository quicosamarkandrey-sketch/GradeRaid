// Phase 7 (Stream D) — equivalence check for modules/achievements/ach_student_page.js.
//
// ORIGINAL side: real classic files eval'd in production order (repository/*, db-service,
// state-manager, dom, utils, ach_engine, ach_student_page). BRIDGE side: one esbuild bundle whose entry
// imports the REAL production bridges (ach_engine, then ach_student_page), exercising the real twin plus
// real imports of AppStore / dom / utils / ach_engine. Same DOM, fixtures and calls on both sides.
//
// Bare globals stubbed identically on both sides (bare assignment): currentUser/currentRole, the
// student-stats sync recorders ach_engine's claim path calls, updateTopbar/navTo, and the three optional
// collaborators the file reaches through `typeof` guards (eqRewardPresent, tsUnlockTitleForStudent,
// renderStudentDashboard) — toggled present/absent per scenario.
//
// THE KEY TEST: after load, a `window.renderBadges` WRAPPER is installed (exactly what
// perceived-speed.js / titles_student_page.js do). The original's bare `renderBadges()` calls inside
// achClaimReward resolve through window and hit the wrapper; the twin's deliberate `window.renderBadges()`
// edit must do the same — a lexical call would skip it and this check would fail.
//
// Checked: 0 reverse-transform byte identity (undoing the 3 edit kinds) + 2 exports; 1 load log, exports;
// 2 renderBadges — no user, empty, full page (claimed/unclaimed/locked/hidden/inactive/unknown rarity/
// section scoping incl. unlocked-but-out-of-section), every filter/tab/search combo, empty-result
// message, banner singular/plural, rarest badge priority, completion %, sidebar badge via
// achUpdateSidebarBadge; 3 achClaimReward — role/user guards, unknown id, no/claimed record, fallback path
// (grant + toast + wrapped re-render), presenter path (reward list xp/coins/title, inactive title, title
// unlock guard, grant-false vanished student, onClose -> wrapped re-render + dashboard guard).
// JSON-based clean() sidesteps the cross-jsdom-realm deepStrictEqual quirk.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function reverseTransformCheck() {
  const orig = read('modules/achievements/ach_student_page.js');
  const twin = read('src/modules/achievements/ach_student_page.js');
  const marker = '// Module-level filter/search state (mirrors window.* used by onclick handlers)';
  assert.strictEqual(orig.split(marker).length, 2); assert.strictEqual(twin.split(marker).length, 2);
  const origHead = orig.slice(0, orig.indexOf(marker));
  assert(twin.includes(origHead), 'twin carries the original header comment verbatim');
  const mid = twin.slice(twin.indexOf(origHead) + origHead.length, twin.indexOf(marker));
  assert(/^(import [^\n]+\n)+\n$/.test(mid), 'only an import block precedes the first original statement');
  const body = twin.slice(twin.indexOf(marker));
  const rebuilt = origHead + body
    .replace(/^export const (\w+) = function/gm, 'window.$1 = function')
    .replace(/^(\s+)window\.renderBadges\(\);$/gm, '$1renderBadges();');
  assert.strictEqual(rebuilt, orig, 'reversing the edits must reproduce the original byte-for-byte');
  assert.strictEqual((twin.match(/^export /gm) || []).length, 2, 'exactly 2 exports (declaresCount 2)');
  assert.strictEqual((twin.match(/^\s+window\.renderBadges\(\);$/gm) || []).length, 2, 'exactly the 2 documented call-site edits');
}

const STARTER_HTML = `<!doctype html><html><body>
  <div id="s-badges"></div>
  <button id="nav-s-badges">Badges</button>
  <div id="toast"></div>
</body></html>`;
const FIXED = 1767225600000;

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  win.eval(`(function(){ const R = Date; class D extends R { constructor(...a){ if (a.length) super(...a); else super(${FIXED}); } static now(){ return ${FIXED}; } } globalThis.Date = D; }());`);
  win.eval("currentUser = { id: 's1', name: 'Ana', xp: 100, coins: 50, classId: 'c1' }; currentRole = 'student';");
  win.DEFAULT_DB = { achievements: [], achievementUnlocks: {}, achievementSectionAssignments: {}, students: [], titles: [], pointLog: [] };
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };
  win.__rpcCalls = []; win.__rpcMock = {};
  const mockClient = {
    auth: { getSession: async () => ({ data: { session: null } }) },
    rpc: async (name, params) => { win.__rpcCalls.push({ name, params }); const e = win.__rpcMock[name]; if (typeof e === 'function') return e(params); if (e) return e; throw new Error('unmocked rpc: ' + name); },
  };
  win.SupabaseClient = { getClient: () => mockClient, resolveProvider: () => 'supabase' };
  win.__EDUQUEST_SUPABASE_URL__ = ''; win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };
  win.__calls = [];
  const rec = (name) => (...a) => win.__calls.push(JSON.stringify([name, ...a.map(x => (typeof x === 'function' ? '<fn>' : x))]));
  win.syncStudentStatsToServer = rec('syncStudentStatsToServer');
  win.syncAchievementUnlockToServer = rec('syncAchievementUnlockToServer');
  win.syncAchievementRevokeToServer = rec('syncAchievementRevokeToServer');
  win.syncAchievementClaimToServer = rec('syncAchievementClaimToServer');
  win.updateTopbar = rec('updateTopbar'); win.navTo = rec('navTo');
  win.getCurrentRole = () => 'student'; win.getCurrentUser = () => win.currentUser;
  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  win.console.warn = () => {}; win.console.error = (...a) => win.__calls.push(JSON.stringify(['error', ...a.map(String)]));
  return { win, logs };
}
async function evalOriginal(win) {
  for (const f of ['repository/table-sync.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'db-service.js', 'modules/core/state-manager.js', 'dom.js', 'utils.js', 'modules/achievements/ach_engine.js', 'modules/achievements/ach_student_page.js']) win.eval(read(f));
  await win.AppStore.ready;
}
async function evalBridge(win) {
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'ach_student_page-combined-bundle.js'), 'utf8'));
  await win.AppStore.ready;
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const IDRE = /pl_[a-z0-9_]+/g;
const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v).replace(ISO, '<ISO>').replace(IDRE, '<PLID>'));
const tick = () => new Promise(r => setTimeout(r, 5));
const $ = (win, id) => win.document.getElementById(id);

const ACHS = () => [
  { id: 'a1', name: 'First <Steps>', description: 'Do "a" quest', icon: '🏅', category: 'Quests', rarity: 'Common', xpReward: 50, coinReward: 25, isHidden: false, active: true },
  { id: 'a2', name: 'Social Star', description: 'Be social', icon: '⭐', category: 'Social', rarity: 'Rare', xpReward: 100, coinReward: 0, isHidden: false, active: true },
  { id: 'a3', name: 'Quest Master', description: '', icon: '', category: 'Quests', rarity: 'Epic', xpReward: 0, coinReward: 30, isHidden: false, active: true },
  { id: 'a4', name: 'Secret One', description: 'secret', icon: '🕵️', category: 'Mystery', rarity: 'Legendary', xpReward: 0, coinReward: 0, isHidden: true, active: true },
  { id: 'a5', name: 'Locked Goal', description: null, icon: '🔒', category: 'Social', rarity: 'Common', xpReward: 10, coinReward: 5, isHidden: false, active: true },
  { id: 'a6', name: 'Retired', description: 'gone', icon: '💀', category: 'Old', rarity: 'Mythic', xpReward: 1, coinReward: 1, isHidden: false, active: false },
  { id: 'a7', name: 'Odd Rarity', description: 'weird', icon: '🧪', category: '', rarity: 'Bogus', xpReward: 0, coinReward: 0, isHidden: false, active: true },
  { id: 'a8', name: 'Other Section', description: 'elsewhere', icon: '🏫', category: 'Class', rarity: 'Uncommon', xpReward: 5, coinReward: 5, isHidden: false, active: true },
  { id: 'a9', name: 'Earned Elsewhere', description: 'kept', icon: '🏆', category: 'Class', rarity: 'Mythic', xpReward: 0, coinReward: 0, isHidden: false, active: true },
  { id: 'a10', name: 'Hidden Earned', description: 'revealed', icon: '🎭', category: 'Mystery', rarity: 'Rare', xpReward: 20, coinReward: 0, isHidden: true, active: true },
  { id: 'a11', name: 'In My Section', description: 'mine', icon: '📚', category: 'Class', rarity: 'Uncommon', xpReward: 0, coinReward: 0, isHidden: false, active: true },
];
const UNLOCKS = () => ({ s1: [
  { achId: 'a1', claimed: true, claimedAt: '2026-01-05T00:00:00.000Z', unlockedAt: '2026-01-04T00:00:00.000Z', xpGranted: 50, coinsGranted: 25 },
  { achId: 'a2', claimed: false, unlockedAt: '2026-01-06T00:00:00.000Z', xpGranted: 100, coinsGranted: 0 },
  { achId: 'a3', claimed: false, unlockedAt: '2026-01-06T00:00:00.000Z', xpGranted: 0, coinsGranted: 30 },
  { achId: 'a9', claimed: true, unlockedAt: '2026-01-07T00:00:00.000Z', xpGranted: 0, coinsGranted: 0 },
  { achId: 'a10', claimed: false, unlockedAt: '2026-01-08T00:00:00.000Z', xpGranted: 20, coinsGranted: 0 },
] });
const ASSIGN = () => ({ a8: ['c9'], a9: ['c9'], a11: ['c1', 'c2'], a5: [] });
const TITLES = () => [
  { id: 'tA', achievementId: 'a3', active: true, name: 'Title <A>', icon: '' },
  { id: 'tB', achievementId: 'a2', active: false, name: 'Inactive', icon: '🎖️' },
];
const STUDENTS = () => [{ id: 's1', name: 'Ana', xp: 100, coins: 50, classId: 'c1' }, { id: 's2', name: 'Ben', xp: 0, coins: 0 }];
function seed(win, extra) {
  win.AppStore.updateState(d => {
    d.achievements = ACHS(); d.achievementUnlocks = UNLOCKS(); d.achievementSectionAssignments = ASSIGN();
    d.titles = TITLES(); d.students = STUDENTS(); d.pointLog = [];
    Object.assign(d, extra || {});
  }, { type: 'test:seed' });
}
const stateSnap = win => win.AppStore.getSlice(s => ({ u: s.achievementUnlocks, st: s.students, pl: s.pointLog }));
const setUser = (win, u, role) => win.eval('currentUser = ' + JSON.stringify(u) + '; currentRole = ' + JSON.stringify(role || 'student') + ';');
const filters = (win, f) => { for (const k of ['_achTab', '_achFilter', '_achRarityFilter', '_achSearch']) win[k] = (f || {})[k]; };

async function run(win) {
  const out = { steps: [] };
  const step = async (label, fn) => {
    $(win, 'toast').innerHTML = ''; win.__calls.length = 0;
    let err = null, ret;
    try { ret = await fn(); } catch (e) { err = String(e && e.message); }
    await tick();
    out.steps.push({ label, err, ret, calls: win.__calls.slice(), toast: $(win, 'toast').innerHTML, page: $(win, 's-badges').innerHTML, nav: $(win, 'nav-s-badges').innerHTML, state: stateSnap(win) });
  };
  out.exports = ['renderBadges', 'achClaimReward'].map(n => [n, typeof win[n]]);

  // wrapper installed AFTER load, as perceived-speed.js / titles_student_page.js do
  const _orig = win.renderBadges;
  win.renderBadges = function () { win.__calls.push('wrapper:renderBadges'); return _orig.apply(this, arguments); };

  // ── renderBadges ──
  seed(win); filters(win);
  await step('render: no user', () => { setUser(win, null); win.eval('currentUser = null;'); return win.renderBadges(); });
  setUser(win, { id: 's1', name: 'Ana', xp: 100, coins: 50, classId: 'c1' });
  await step('render: full page', () => win.renderBadges());
  await step('render: student without classId (default-class fallback)', () => { setUser(win, { id: 's1', name: 'Ana' }); return win.renderBadges(); });
  setUser(win, { id: 's1', name: 'Ana', xp: 100, coins: 50, classId: 'c9' });
  await step('render: student in the other section', () => win.renderBadges());
  setUser(win, { id: 's1', name: 'Ana', xp: 100, coins: 50, classId: 'c1' });
  for (const [label, f] of [
    ['category filter', { _achFilter: 'Quests' }], ['rarity filter', { _achRarityFilter: 'Rare' }], ['search by name', { _achSearch: 'STAR' }],
    ['search by description', { _achSearch: 'be soc' }], ['tab unclaimed', { _achTab: 'unclaimed' }], ['tab claimed', { _achTab: 'claimed' }],
    ['tab locked', { _achTab: 'locked' }], ['combo category+tab', { _achFilter: 'Quests', _achTab: 'unclaimed' }], ['no results', { _achSearch: 'zzzz' }],
    ['search escaping', { _achSearch: '"><b>' }],
  ]) await step('render: ' + label, () => { filters(win, f); return win.renderBadges(); });
  filters(win);
  await step('render: no achievements at all', () => { seed(win, { achievements: [], achievementUnlocks: {} }); return win.renderBadges(); });
  await step('render: unclaimed banner singular + no rarest', () => { seed(win, { achievementUnlocks: { s1: [{ achId: 'a2', claimed: false, unlockedAt: '2026-01-06T00:00:00.000Z', xpGranted: 100, coinsGranted: 0 }] } }); return win.renderBadges(); });
  await step('render: rarest badge priority (Epic beats Rare)', () => { seed(win, { achievements: ACHS().map(a => (a.id === 'a3' ? { ...a, icon: '🥇' } : a)), achievementUnlocks: { s1: [{ achId: 'a2', claimed: true, unlockedAt: '2026-01-06T00:00:00.000Z' }, { achId: 'a3', claimed: true, unlockedAt: '2026-01-06T00:00:00.000Z' }] } }); return win.renderBadges(); });
  await step('render: null slices', () => { seed(win, { achievements: null, achievementUnlocks: null, achievementSectionAssignments: null }); return win.renderBadges(); });
  await step('render: null achievementSectionAssignments, normal otherwise', () => { seed(win, { achievementSectionAssignments: null }); return win.renderBadges(); });
  await step('render: sidebar badge shows unclaimed count', () => { seed(win); win.achUpdateSidebarBadge(); return win.renderBadges(); });

  // ── achClaimReward ──
  seed(win); setUser(win, { id: 's1', name: 'Ana', xp: 100, coins: 50, classId: 'c1' });
  win.__presented = [];
  const present = win.eqRewardPresent = opts => { win.__presented.push(opts); win.__calls.push(JSON.stringify(['eqRewardPresent', Object.assign({}, opts, { onClose: '<fn>' })])); };
  win.tsUnlockTitleForStudent = (...a) => win.__calls.push(JSON.stringify(['tsUnlockTitleForStudent', ...a]));
  win.renderStudentDashboard = () => win.__calls.push('renderStudentDashboard');
  await step('claim: not a student', () => { setUser(win, { id: 's1' }, 'teacher'); return win.achClaimReward('a2'); });
  await step('claim: no user', () => { win.eval('currentUser = null; currentRole = "student";'); return win.achClaimReward('a2'); });
  setUser(win, { id: 's1', name: 'Ana', xp: 100, coins: 50, classId: 'c1' });
  await step('claim: unknown achievement', () => win.achClaimReward('nope'));
  await step('claim: no unlock record', () => win.achClaimReward('a5'));
  await step('claim: already claimed', () => win.achClaimReward('a1'));
  await step('claim: presenter, xp only, inactive title ignored', () => win.achClaimReward('a2'));
  setUser(win, { id: 's1', name: 'Ana', xp: 200, coins: 50, classId: 'c1' });
  await step('claim: presenter onClose -> wrapped re-render + dashboard', () => { win.__presented[0].onClose(); });
  await step('claim: presenter, coins only + linked active title', () => win.achClaimReward('a3'));
  await step('claim: onClose without renderStudentDashboard', () => { win.renderStudentDashboard = undefined; win.__presented[1].onClose(); win.renderStudentDashboard = () => win.__calls.push('renderStudentDashboard'); });
  await step('claim: title unlock skipped when tsUnlockTitleForStudent is not a function', () => {
    seed(win); setUser(win, { id: 's1', name: 'Ana', classId: 'c1' }); win.tsUnlockTitleForStudent = undefined; return win.achClaimReward('a3');
  });
  win.tsUnlockTitleForStudent = (...a) => win.__calls.push(JSON.stringify(['tsUnlockTitleForStudent', ...a]));
  await step('claim: grant returns false (student vanished) -> silent', () => { seed(win, { students: [] }); setUser(win, { id: 's1', classId: 'c1' }); return win.achClaimReward('a10'); });
  await step('claim: fallback path (no presenter) grants, toasts, re-renders through the wrapper', () => {
    seed(win); setUser(win, { id: 's1', name: 'Ana', xp: 100, coins: 50, classId: 'c1' }); win.eqRewardPresent = undefined; return win.achClaimReward('a2');
  });
  await step('claim: fallback path escapes the name', () => { seed(win, { achievements: ACHS().map(a => (a.id === 'a10' ? { ...a, name: '<i>x</i>' } : a)) }); setUser(win, { id: 's1', name: 'Ana', xp: 100, coins: 50, classId: 'c1' }); return win.achClaimReward('a10'); });
  win.eqRewardPresent = present;
  await step('claim: both xp and coins rewards in one claim', () => {
    seed(win, { achievementUnlocks: { s1: [{ achId: 'a1', claimed: false, unlockedAt: '2026-01-04T00:00:00.000Z', xpGranted: 50, coinsGranted: 25 }] } });
    setUser(win, { id: 's1', name: 'Ana', xp: 100, coins: 50, classId: 'c1' }); return win.achClaimReward('a1');
  });
  await step('claim: zero rewards, no title, presenter gets empty list + defaults', () => {
    seed(win, { achievements: [{ id: 'z1', name: 'Zero', active: true }], achievementUnlocks: { s1: [{ achId: 'z1', claimed: false, unlockedAt: '2026-01-04T00:00:00.000Z' }] }, titles: null });
    setUser(win, { id: 's1', name: 'Ana', xp: 100, coins: 50, classId: 'c1' }); return win.achClaimReward('z1');
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
  assert.deepStrictEqual(clean(B.logs), clean(A.logs), 'load-time console output must match');
  assert(A.logs.some(l => l.includes('achievements/student-page.js loaded')), 'original load log present');
  const oa = await run(A.win), ob = await run(B.win);
  const fd = firstDiff(clean(oa), clean(ob), 'out');
  assert.strictEqual(fd, null, 'bridge output must exactly match the original at every step — first difference at: ' + fd);

  // ── independent sanity (guards against a vacuous both-sides-wrong pass) ──
  const o = clean(oa);
  const S = label => { const s = o.steps.find(x => x.label === label); assert(s, 'missing step ' + label); return s; };
  assert.deepStrictEqual(o.exports.map(e => e[1]), ['function', 'function']);
  assert.strictEqual(S('render: no user').page, '', 'no user -> page untouched');
  const full = S('render: full page').page;
  assert(full.includes('First &lt;Steps&gt;') && !full.includes('First <Steps>'), 'name escaped');
  assert(!full.includes('Retired') && !full.includes('Other Section'), 'inactive + out-of-section badges excluded');
  assert(full.includes('Earned Elsewhere') && full.includes('Hidden Earned'), 'unlocked-but-out-of-section and hidden-but-earned stay visible');
  assert(!full.includes('Secret One') && !full.includes('Hidden Achievement') && !full.includes('❓'), 'hidden+locked badges are filtered out of the grid entirely (the isHiddenLocked mask branch is unreachable dead code in the original — disclosed, not exercised)');
  assert(full.includes('/ 9 badges unlocked'), 'hidden+locked still counted in the total (9 active in-scope badges)');
  assert(full.includes('In My Section') && full.includes('Locked Goal'), 'section-scoped + empty-assignment badges visible');
  assert(full.includes('3</span> Reward') || full.includes('3 Reward'), 'three unclaimed -> plural banner');
  assert(full.includes('READY TO CLAIM') && full.includes('✓ CLAIMED'), 'claim states rendered');
  assert(S('render: student in the other section').page.includes('Other Section'), 'other-section student sees their section badge');
  assert(S('render: student without classId (default-class fallback)').page.includes('Locked Goal'), 'default-class fallback');
  assert(S('render: tab locked').page.includes('Locked Goal') && !S('render: tab locked').page.includes('Social Star'), 'locked tab filter');
  assert(S('render: no results').page.includes('No badges found for these filters.'), 'empty result message');
  assert(S('render: search escaping').page.includes('value="&quot;&gt;&lt;b&gt;"') || S('render: search escaping').page.includes('value="&quot;><b>"'), 'search value escaped');
  assert(S('render: unclaimed banner singular + no rarest').page.includes('1 Reward Ready') && !S('render: unclaimed banner singular + no rarest').page.includes('1 Rewards'), 'banner singular');
  assert(S('render: no achievements at all').page.includes('0%'), 'completion 0% without achievements');
  assert(S('render: rarest badge priority (Epic beats Rare)').page.includes('<span style="font-size:18px">🥇</span>') && !S('render: rarest badge priority (Epic beats Rare)').page.includes('<span style="font-size:18px">⭐</span>'), 'rarest earned badge (Epic) is the one summarized, not the Rare one');
  assert(S('render: sidebar badge shows unclaimed count').nav.includes('ach-nav-badge'), 'sidebar nav badge');
  assert.deepStrictEqual(S('claim: not a student').calls, []); assert.deepStrictEqual(S('claim: no user').calls, []); assert.deepStrictEqual(S('claim: unknown achievement').calls, []);
  assert(S('claim: no unlock record').toast.includes('already been claimed') && S('claim: already claimed').toast.includes('already been claimed'));
  const px = S('claim: presenter, xp only, inactive title ignored');
  const pres = JSON.parse(px.calls.find(c => c.startsWith('["eqRewardPresent"')))[1];
  assert.deepStrictEqual(pres.rewards, [{ type: 'xp', amount: 100, icon: '⚡', label: 'XP', color: 'var(--primary)' }], 'xp-only reward list; inactive linked title ignored');
  assert.deepStrictEqual([pres.title, pres.subtitle, pres.icon, pres.rarity, pres.source], ['Achievement Claimed!', 'Social Star', '⭐', 'Rare', 'achievement']);
  assert(!px.calls.some(c => c.startsWith('["tsUnlockTitleForStudent"')), 'no title unlock without an active linked title');
  assert(px.state.u.s1.find(u => u.achId === 'a2').claimed === true && px.state.st.find(s => s.id === 's1').xp === 200, 'xp granted + unlock claimed');
  const oc = S('claim: presenter onClose -> wrapped re-render + dashboard').calls;
  assert(oc.includes('wrapper:renderBadges') && oc.includes('renderStudentDashboard'), 'onClose re-renders THROUGH the window wrapper and refreshes the dashboard');
  const pt = S('claim: presenter, coins only + linked active title');
  const ptr = JSON.parse(pt.calls.find(c => c.startsWith('["eqRewardPresent"')))[1].rewards;
  assert.deepStrictEqual(ptr.map(r => r.type), ['coins', 'title']); assert.strictEqual(ptr[1].titleId, 'tA'); assert.strictEqual(ptr[1].icon, '🎖️', 'title icon fallback'); assert.strictEqual(ptr[1].label, 'Title <A>');
  assert(pt.calls.includes(JSON.stringify(['tsUnlockTitleForStudent', 's1', 'tA', false])), 'linked title unlocked (silent=false)');
  assert(!S('claim: onClose without renderStudentDashboard').calls.includes('renderStudentDashboard') && S('claim: onClose without renderStudentDashboard').calls.includes('wrapper:renderBadges'));
  assert(!S('claim: title unlock skipped when tsUnlockTitleForStudent is not a function').calls.some(c => c.startsWith('["tsUnlockTitleForStudent"')), 'title unlock guard');
  const gf = S('claim: grant returns false (student vanished) -> silent'); assert(!gf.calls.some(c => c.startsWith('["eqRewardPresent"')) && gf.toast === '', 'grant false -> no presenter, no toast');
  const fb = S('claim: fallback path (no presenter) grants, toasts, re-renders through the wrapper');
  assert(fb.toast.includes('Social Star') && fb.toast.includes('claimed!') && fb.calls.includes('wrapper:renderBadges'), 'fallback: toast + wrapped re-render');
  assert(S('claim: fallback path escapes the name').toast.includes('&lt;i&gt;x&lt;/i&gt;'), 'fallback toast escapes the name');
  const both = JSON.parse(S('claim: both xp and coins rewards in one claim').calls.find(c => c.startsWith('["eqRewardPresent"')))[1].rewards;
  assert.deepStrictEqual(both.map(r => [r.type, r.amount]), [['xp', 50], ['coins', 25]]);
  const zero = JSON.parse(S('claim: zero rewards, no title, presenter gets empty list + defaults').calls.find(c => c.startsWith('["eqRewardPresent"')))[1];
  assert.deepStrictEqual([zero.rewards, zero.icon, zero.rarity], [[], '🏅', 'Common']);
  assert.strictEqual(o.steps.filter(s => s.err).length, 0, 'no unexpected exceptions in any step');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log(' - reverse-transform: original rebuilt byte-for-byte from the twin; 2 exports; exactly the 2 documented call-site edits');
  console.log(' - ' + o.steps.length + ' steps compared incl. the window.renderBadges WRAPPER dispatch');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
