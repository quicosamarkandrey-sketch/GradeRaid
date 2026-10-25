// Phase 7 (Stream D) — equivalence check for modules/achievements/ach_admin_page.js.
//
// ORIGINAL side: real classic files eval'd in production order (repository/*,
// db-service, state-manager, dom, utils, ach_engine, ach_admin_page). BRIDGE
// side: one esbuild bundle whose entry imports the REAL production bridges
// (ach_engine, then ach_admin_page), so it exercises the real src twin plus real
// imports of AppStore / DBService / dom.js / utils.js / ach_engine.js.
// Same starter DOM, fixtures, and calls on both sides.
//
// Bare globals stubbed identically on both sides (bare assignment — jsdom's
// win.eval gives each call its own lexical scope, see shop_admin_store check):
// currentUser, getActiveClassIds/getClassLabel (toggled per scenario — their
// `typeof === 'function'` guards are behavior), the 3 student-stats sync fns
// (recorders), confirm (recorder + scripted answer), plus the few bare helpers
// ach_engine's load-time code references. DBService.rpc goes through a mock
// Supabase client, same table as shop_admin_store/classroom-service.
//
// Checked, in order:
//  0. reverse-transform: twin body is byte-identical to the original once the
//     `export const X =`/`export let` keyword swaps are reversed; 16 exports.
//  1. load-time console output; 15 window functions exist on both sides.
//  2. renderAdminAchievements: no page element (TypeError), empty list, full
//     table (hidden/inactive/unknown rarity/unknown trigger/manual/all_quests/
//     no icon/no category/zero rewards, XSS names, unlock counts + pct, section
//     labels with and without getClassLabel), zero students (pct guard), emitted
//     'admin:achievements-rendered' event.
//  3. achAdminOpenForm: new / edit / edit-missing-id, with and without
//     getActiveClassIds, preselected sections, empty categories default.
//  4. updateDraftAchSections + achAdminUpdateTriggerHint (known/unknown/no form).
//  5. achAdminSave: both validation errors, create, edit, parse fallbacks,
//     edit-of-vanished-id (push), rpc success (assignments set) and rpc error
//     (warning toast, assignments untouched), draft sections reach the rpc.
//  6. Toggle / Delete (confirm no/yes, rpc ok/error, missing) / Duplicate.
//  7. Preview: known/unknown rarity + trigger, chips on/off, hidden, missing.
//  8. Grant/Revoke modal, preview panel on/off, achAdminDoGrant: every
//     validation, unknown ids, grant, already-has, revoke, revoke-not-had; sync
//     recorder args.
//  9. Categories: modal, add (empty/duplicate/new), delete (confirm yes/no, bad idx).
// JSON.stringify-based clean() sidesteps the cross-jsdom-realm deepStrictEqual quirk.
// Disclosed: console.error output is compared only from the first scenario onward (see run()).
// Disclosed: window.draftAchSections exists only on the bridge side (a one-time
// snapshot; nothing reads it) so it is not compared.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function reverseTransformCheck() {
  const orig = read('modules/achievements/ach_admin_page.js');
  const twin = read('src/modules/achievements/ach_admin_page.js');
  const marker = '// Phase 16 — selected class_ids for the create/edit';
  assert.strictEqual(orig.split(marker).length, 2);
  assert.strictEqual(twin.split(marker).length, 2);
  const origHead = orig.slice(0, orig.indexOf(marker));
  assert(twin.includes(origHead), 'twin carries the original header comment verbatim');
  const body = twin.slice(twin.indexOf(marker));
  const rebuilt = origHead + body
    .replace(/^export let /m, 'let ')
    .replace(/^export const (\w+) = /gm, 'window.$1 = ');
  assert.strictEqual(rebuilt, orig, 'reversing the keyword swaps must reproduce the original byte-for-byte');
  assert.strictEqual((twin.match(/^export /gm) || []).length, 16, 'exactly 16 exports (declaresCount 16)');
  // everything between the original header and the marker is exactly the import block
  const mid = twin.slice(twin.indexOf(origHead) + origHead.length, twin.indexOf(marker));
  assert(/^(import [^\n]+\n)+\n$/.test(mid), 'only an import block precedes the first original statement');
}

const STARTER_HTML = `<!doctype html><html><body>
  <div id="a-achievements"></div>
  <div id="toast"></div>
  <div id="modal-box" class="modal-box"></div>
  <div id="modal-content"></div>
  <div id="modal-overlay" style="display:none"></div>
</body></html>`;
const FIXED = 1767225600000;

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  win.eval(`(function(){ const R = Date; class D extends R { constructor(...a){ if (a.length) super(...a); else super(${FIXED}); } static now(){ return ${FIXED}; } } globalThis.Date = D; }());`);
  win.eval("currentUser = { id: 't1' }; currentRole = 'teacher';");
  win.DEFAULT_DB = { achievements: [], achievementCategories: [], students: [], achievementUnlocks: {}, achievementSectionAssignments: {} };
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };

  win.__rpcCalls = []; win.__rpcMock = {};
  const mockClient = {
    auth: { getSession: async () => ({ data: { session: null } }) },
    rpc: async (name, params) => {
      win.__rpcCalls.push({ name, params });
      const entry = win.__rpcMock[name];
      if (typeof entry === 'function') return entry(params);
      if (entry) return entry;
      throw new Error('unmocked rpc: ' + name);
    },
  };
  win.SupabaseClient = { getClient: () => mockClient, resolveProvider: () => 'supabase' };
  win.__EDUQUEST_SUPABASE_URL__ = ''; win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };

  // bare stubs used by the file under test and by ach_engine's code
  win.__sync = [];
  win.syncStudentStatsToServer = (...a) => win.__sync.push(['stats', ...a]);
  win.syncAchievementUnlockToServer = (...a) => win.__sync.push(['unlock', ...a]);
  win.syncAchievementRevokeToServer = (...a) => win.__sync.push(['revoke', ...a]);
  win.__confirms = []; win.__confirmAnswer = true;
  win.confirm = msg => { win.__confirms.push(msg); return win.__confirmAnswer; };
  win.getCurrentRole = () => 'teacher'; win.getCurrentUser = () => ({ id: 't1' });
  win.navTo = () => {}; win.updateTopbar = () => {};

  const logs = [], errors = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  win.console.warn = () => {};
  win.console.error = (...a) => errors.push(a.join(' '));
  return { win, logs, errors };
}
async function evalOriginal(win) {
  win.eval(read('repository/table-sync.js'));
  win.eval(read('repository/pull-mappers.js'));
  win.eval(read('repository/realtime-groups.js'));
  win.eval(read('db-service.js'));
  win.eval(read('modules/core/state-manager.js'));
  win.eval(read('dom.js'));
  win.eval(read('utils.js'));
  win.eval(read('modules/achievements/ach_engine.js'));
  win.eval(read('modules/achievements/ach_admin_page.js'));
  await win.AppStore.ready;
}
async function evalBridge(win) {
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'ach_admin_page-combined-bundle.js'), 'utf8'));
  await win.AppStore.ready;
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const IDRE = /id_[a-z0-9]+/g;
const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v).replace(ISO, '<ISO>').replace(IDRE, '<TMPID>'));
const tick = () => new Promise(r => setTimeout(r, 5));

const $ = (win, id) => win.document.getElementById(id);
const modalSnap = win => ({ visible: $(win, 'modal-overlay').style.display, className: $(win, 'modal-box').className, content: $(win, 'modal-content').innerHTML });
const toastSnap = win => ({ visible: $(win, 'toast').style.display, html: $(win, 'toast').innerHTML });
const pageHtml = win => $(win, 'a-achievements').innerHTML;
function resetUi(win) {
  $(win, 'modal-overlay').style.display = 'none'; $(win, 'modal-content').innerHTML = ''; $(win, 'modal-box').className = 'modal-box';
  $(win, 'toast').innerHTML = ''; $(win, 'toast').style.display = '';
  win.__rpcCalls.length = 0; win.__sync.length = 0; win.__confirms.length = 0;
}
function seed(win, slices) { win.AppStore.updateState(d => { for (const k of Object.keys(slices)) d[k] = slices[k]; }, { type: 'test:seed' }); }
const stateSnap = win => win.AppStore.getSlice(s => ({ a: s.achievements, c: s.achievementCategories, u: s.achievementUnlocks, as: s.achievementSectionAssignments, st: s.students }));
const setForm = (win, f) => { for (const [id, v] of Object.entries(f)) { const el = $(win, id); if (!el) continue; if (el.type === 'checkbox') el.checked = v; else el.value = v; } };
const rpcOk = (win, name, res) => { win.__rpcMock[name] = res || { data: null, error: null }; };

const ACHS = () => [
  { id: 'a1', ownerTeacherId: 't1', name: 'First Steps', description: 'Do a quest', icon: '🏅', category: 'Quests', rarity: 'Common', xpReward: 50, coinReward: 25, isHidden: false, active: true, triggerType: 'quests_completed', triggerValue: 3 },
  { id: 'a2', name: '<b>Sneaky</b> "x"', description: 'Hidden one', icon: '', category: '', rarity: 'Legendary', xpReward: 0, coinReward: 0, isHidden: true, active: false, triggerType: 'manual', triggerValue: 0 },
  { id: 'a3', ownerTeacherId: 't2', name: 'Weird', description: 'unknown stuff', icon: '🧪', category: 'Social', rarity: 'Bogus', xpReward: 10, coinReward: 0, isHidden: false, active: true, triggerType: 'weird', triggerValue: 7 },
  { id: 'a4', name: 'Done', description: 'all quests', icon: '🏆', category: 'Quests', rarity: 'Mythic', xpReward: 0, coinReward: 5, isHidden: false, active: true, triggerType: 'all_quests', triggerValue: 1 },
  { id: 'a5', name: 'Lvl', description: 'level', icon: '⭐', category: 'Social', rarity: 'Epic', xpReward: 100, coinReward: 100, isHidden: false, active: true, triggerType: 'level', triggerValue: 0 },
];
const STUDENTS = () => [
  { id: 's1', name: 'Ana', xp: 100, coins: 50, classId: 'c1' },
  { id: 's2', name: '<i>Ben</i>', xp: 5, coins: 2 },
  { id: 's3', name: 'Cy', xp: 0, coins: 0, classId: 'c2' },
];
const UNLOCKS = () => ({
  s1: [{ achId: 'a1', unlockedAt: '2026-01-02T00:00:00.000Z', xpGranted: 50, coinsGranted: 25, claimed: true }, { achId: 'a4', unlockedAt: '2026-01-02T00:00:00.000Z', xpGranted: 0, coinsGranted: 5, claimed: false }],
  s2: [{ achId: 'a1', unlockedAt: '2026-01-02T00:00:00.000Z', xpGranted: 50, coinsGranted: 25, claimed: true }],
});
const ASSIGN = () => ({ a1: ['c1', 'c2'], a3: ['c9'] });
const fullSeed = (win, extra) => seed(win, Object.assign({ achievements: ACHS(), achievementCategories: ['Quests', 'Social'], students: STUDENTS(), achievementUnlocks: UNLOCKS(), achievementSectionAssignments: ASSIGN() }, extra || {}));
const withSections = win => { win.getActiveClassIds = () => ['c1', 'c2', 'c<3']; win.getClassLabel = cid => 'Sec ' + cid.toUpperCase(); };
const noSections = win => { delete win.getActiveClassIds; delete win.getClassLabel; };

async function run(win, errors) {
  const out = {};
  const events = [];
  // Load-time DBService/state-manager chatter (e.g. the initial Supabase pull failing against
  // the channel-less mock client, original side only) predates every scenario and is not this
  // file's behavior — scope the error comparison to the scenarios themselves.
  errors.length = 0;
  win.AppStore.subscribe('verify-recorder', (s, e) => { events.push(e.type); });
  const call = async (label, fn) => { try { const r = await fn(); return r; } catch (e) { out[label + '__threw'] = String(e && e.message); } };

  out.exports = ['renderAdminAchievements', 'achAdminOpenForm', 'updateDraftAchSections', 'achAdminUpdateTriggerHint', 'achAdminSave', 'achAdminToggle', 'achAdminDelete', 'achAdminDuplicate', 'achAdminPreview', 'achAdminGrantAchievement', 'achAdminUpdateGrantPreview', 'achAdminDoGrant', 'achAdminManageCategories', 'achAdminAddCat', 'achAdminDeleteCat'].map(n => [n, typeof win[n]]);

  // ── 2. render ──
  out.render = {};
  noSections(win);
  const holder = $(win, 'a-achievements'); holder.remove();
  await call('render.noPage', () => win.renderAdminAchievements());
  win.document.body.insertBefore(holder, win.document.body.firstChild);
  seed(win, { achievements: [], achievementCategories: [], students: [], achievementUnlocks: {}, achievementSectionAssignments: {} });
  win.renderAdminAchievements(); out.render.empty = pageHtml(win);
  fullSeed(win);
  events.length = 0;
  win.renderAdminAchievements(); out.render.fullNoLabels = pageHtml(win); out.render.eventsAfterRender = events.slice();
  withSections(win);
  win.renderAdminAchievements(); out.render.fullWithLabels = pageHtml(win);
  fullSeed(win, { students: [] });
  win.renderAdminAchievements(); out.render.zeroStudents = pageHtml(win);

  // ── 3. open form ──
  out.form = {};
  fullSeed(win); noSections(win);
  const open = async (label, id) => { resetUi(win); win.achAdminOpenForm(id); out.form[label] = modalSnap(win); };
  await open('newNoSections', null);
  withSections(win);
  await open('newWithSections', null);
  await open('editA1Preselected', 'a1');
  await open('editA2HiddenInactive', 'a2');
  await open('editMissingId', 'nope');
  seed(win, { achievementCategories: [] });
  await open('newNoCategories', undefined);
  seed(win, { achievementCategories: ['Quests', 'Social'] });

  // ── 4. draft sections + trigger hint ──
  out.hint = {};
  resetUi(win); win.achAdminOpenForm('a1');
  setForm(win, { 'ach-f-trigger': 'level' }); win.achAdminUpdateTriggerHint(); out.hint.level = $(win, 'ach-trigger-hint').textContent;
  setForm(win, { 'ach-f-trigger': 'manual' }); win.achAdminUpdateTriggerHint(); out.hint.manual = $(win, 'ach-trigger-hint').textContent;
  $(win, 'ach-f-trigger').innerHTML += '<option value="zzz">zzz</option>';
  setForm(win, { 'ach-f-trigger': 'zzz' }); win.achAdminUpdateTriggerHint(); out.hint.unknown = $(win, 'ach-trigger-hint').textContent;
  resetUi(win); $(win, 'modal-content').innerHTML = '';
  await call('hint.noForm', () => win.achAdminUpdateTriggerHint()); out.hint.noFormOk = true;

  // ── 5. save ──
  out.save = {};
  fullSeed(win); withSections(win);
  const fresh = (id) => { resetUi(win); win.achAdminOpenForm(id); };
  fresh(null);
  setForm(win, { 'ach-f-name': '   ', 'ach-f-desc': 'd' }); await win.achAdminSave('idNEW1');
  out.save.emptyName = { err: $(win, 'ach-form-err').textContent, disp: $(win, 'ach-form-err').style.display, rpc: win.__rpcCalls.length, count: stateSnap(win).a.length, toast: toastSnap(win) };
  setForm(win, { 'ach-f-name': 'N', 'ach-f-desc': '  ' }); await win.achAdminSave('idNEW1');
  out.save.emptyDesc = { err: $(win, 'ach-form-err').textContent, disp: $(win, 'ach-form-err').style.display, rpc: win.__rpcCalls.length, count: stateSnap(win).a.length };
  // valid create, picking sections through the real onchange handler, rpc ok
  fresh(null); rpcOk(win, 'set_achievement_sections');
  win.updateDraftAchSections({ selectedOptions: [{ value: 'c1' }, { value: 'c<3' }] });
  setForm(win, { 'ach-f-name': '  Brand "New" <b>  ', 'ach-f-desc': ' desc ', 'ach-f-icon': ' 🔥 ', 'ach-f-cat': 'Social', 'ach-f-rarity': 'Epic', 'ach-f-xp': '120', 'ach-f-coins': '30', 'ach-f-trigger': 'level', 'ach-f-tval': '12.5', 'ach-f-hidden': true, 'ach-f-active': true });
  $(win, 'ach-form-err').style.display = 'block';
  await win.achAdminSave('idNEW2'); await tick();
  out.save.create = { state: stateSnap(win), toast: toastSnap(win), modal: modalSnap(win), page: pageHtml(win), rpc: win.__rpcCalls.slice() };
  // parse fallbacks + unchecked active, rpc error
  fresh(null); rpcOk(win, 'set_achievement_sections', { data: null, error: { message: 'boom <x>' } });
  setForm(win, { 'ach-f-name': 'Fallbacks', 'ach-f-desc': 'x', 'ach-f-icon': '', 'ach-f-xp': 'abc', 'ach-f-coins': '', 'ach-f-tval': '0', 'ach-f-hidden': false, 'ach-f-active': false });
  $(win, 'ach-f-trigger').innerHTML += '<option value="">(none)</option>'; setForm(win, { 'ach-f-trigger': '' });
  $(win, 'ach-f-cat').innerHTML += '<option value="">(none)</option>'; setForm(win, { 'ach-f-cat': '' });
  await win.achAdminSave('idNEW3'); await tick();
  out.save.fallbacksRpcError = { state: stateSnap(win), toast: toastSnap(win), rpc: win.__rpcCalls.slice() };
  // edit existing keeps id + owner
  fresh('a1'); rpcOk(win, 'set_achievement_sections');
  win.updateDraftAchSections({ selectedOptions: [] });
  setForm(win, { 'ach-f-name': 'First Steps 2', 'ach-f-xp': '75' });
  await win.achAdminSave('a1'); await tick();
  out.save.edit = { state: stateSnap(win), toast: toastSnap(win), rpc: win.__rpcCalls.slice() };
  // edit of an id that vanished -> falls to push
  fresh('a2'); rpcOk(win, 'set_achievement_sections');
  seed(win, { achievements: ACHS().filter(a => a.id !== 'a2') });
  await win.achAdminSave('a2'); await tick();
  out.save.vanished = { state: stateSnap(win), toast: toastSnap(win) };
  // achievements slice not an array
  fresh(null); rpcOk(win, 'set_achievement_sections'); seed(win, { achievements: null });
  setForm(win, { 'ach-f-name': 'OnEmpty', 'ach-f-desc': 'x' }); await win.achAdminSave('idNEW4'); await tick();
  out.save.fromNull = { state: stateSnap(win) };
  // assignments slice missing on rpc success
  fresh(null); rpcOk(win, 'set_achievement_sections'); seed(win, { achievementSectionAssignments: undefined });
  setForm(win, { 'ach-f-name': 'NoAssign', 'ach-f-desc': 'x' }); await win.achAdminSave('idNEW5'); await tick();
  out.save.noAssignSlice = { as: stateSnap(win).as };

  // ── 6. toggle / delete / duplicate ──
  out.misc = {};
  fullSeed(win); withSections(win);
  resetUi(win); win.achAdminToggle('a1'); out.misc.toggleOff = { toast: toastSnap(win), a1: stateSnap(win).a[0].active, page: pageHtml(win).length };
  resetUi(win); win.achAdminToggle('a1'); out.misc.toggleOn = { toast: toastSnap(win), a1: stateSnap(win).a[0].active };
  resetUi(win); events.length = 0; win.achAdminToggle('missing'); out.misc.toggleMissing = { toast: toastSnap(win), events: events.slice() };
  resetUi(win); win.__confirmAnswer = false; rpcOk(win, 'delete_achievement');
  await win.achAdminDelete('a1'); out.misc.deleteNo = { confirms: win.__confirms.slice(), n: stateSnap(win).a.length, rpc: win.__rpcCalls.length, toast: toastSnap(win) };
  resetUi(win); win.__confirmAnswer = true;
  await win.achAdminDelete('a1'); await tick(); out.misc.deleteYes = { confirms: win.__confirms.slice(), state: stateSnap(win), rpc: win.__rpcCalls.slice(), toast: toastSnap(win) };
  resetUi(win); rpcOk(win, 'delete_achievement', { data: null, error: { message: 'nope' } });
  await win.achAdminDelete('a3'); await tick(); out.misc.deleteRpcError = { toast: toastSnap(win), rpc: win.__rpcCalls.slice() };
  resetUi(win); await win.achAdminDelete('ghost'); out.misc.deleteMissing = { confirms: win.__confirms.length, rpc: win.__rpcCalls.length };
  seed(win, { achievementUnlocks: undefined }); resetUi(win); rpcOk(win, 'delete_achievement'); await win.achAdminDelete('a4'); out.misc.deleteNoUnlocksSlice = { n: stateSnap(win).a.length };
  fullSeed(win);
  resetUi(win); win.achAdminDuplicate('a1'); out.misc.dupOwned = { a: stateSnap(win).a.slice(-1)[0], toast: toastSnap(win), n: stateSnap(win).a.length };
  resetUi(win); win.achAdminDuplicate('a2'); out.misc.dupNoOwner = stateSnap(win).a.slice(-1)[0];
  resetUi(win); events.length = 0; win.achAdminDuplicate('ghost'); out.misc.dupMissing = { n: stateSnap(win).a.length, events: events.slice() };
  seed(win, { achievements: null }); fullSeed(win);

  // ── 7. preview ──
  out.preview = {};
  fullSeed(win);
  for (const id of ['a1', 'a2', 'a3', 'a4', 'a5']) { resetUi(win); win.achAdminPreview(id); out.preview[id] = modalSnap(win); }
  resetUi(win); win.achAdminPreview('ghost'); out.preview.ghost = modalSnap(win);

  // ── 8. grant / revoke ──
  out.grant = {};
  seed(win, { achievements: [] }); resetUi(win); win.achAdminGrantAchievement(); out.grant.noAchs = { toast: toastSnap(win), modal: modalSnap(win) };
  fullSeed(win);
  resetUi(win); win.achAdminGrantAchievement(); out.grant.modal = modalSnap(win);
  setForm(win, { 'ach-grant-ach': 'a1' }); win.achAdminUpdateGrantPreview();
  out.grant.previewOn = { name: $(win, 'ach-grant-preview-name').textContent, r: $(win, 'ach-grant-preview-rarity').textContent, xp: $(win, 'ach-grant-preview-xp').textContent, coin: $(win, 'ach-grant-preview-coin').textContent, disp: $(win, 'ach-grant-preview').style.display };
  setForm(win, { 'ach-grant-ach': 'a2' }); win.achAdminUpdateGrantPreview();
  out.grant.previewZeroRewards = { xp: $(win, 'ach-grant-preview-xp').textContent, coin: $(win, 'ach-grant-preview-coin').textContent };
  setForm(win, { 'ach-grant-ach': '' }); win.achAdminUpdateGrantPreview(); out.grant.previewOff = $(win, 'ach-grant-preview').style.display;
  const doGrant = async (label, sid, aid, action) => {
    resetUi(win); win.achAdminGrantAchievement();
    setForm(win, { 'ach-grant-student': sid, 'ach-grant-ach': aid }); $(win, action === 'revoke' ? 'ach-action-revoke' : 'ach-action-grant').checked = true;
    win.achAdminDoGrant();
    out.grant[label] = { err: { t: $(win, 'ach-grant-err') ? $(win, 'ach-grant-err').textContent : null, d: $(win, 'ach-grant-err') ? $(win, 'ach-grant-err').style.display : null }, state: stateSnap(win), sync: win.__sync.slice(), toast: toastSnap(win), modal: modalSnap(win).visible };
  };
  await doGrant('noStudent', '', 'a1', 'grant');
  await doGrant('noAch', 's1', '', 'grant');
  await doGrant('unknownIds', 'sX', 'aX', 'grant');
  await doGrant('grantNew', 's3', 'a1', 'grant');
  await doGrant('grantAlready', 's1', 'a1', 'grant');
  await doGrant('grantNoClassId', 's2', 'a5', 'grant');
  await doGrant('grantEscapes', 's2', 'a2', 'grant');
  await doGrant('revokeNotHad', 's3', 'a4', 'revoke');
  await doGrant('revokeHad', 's1', 'a1', 'revoke');
  await doGrant('revokeClampsToZero', 's2', 'a1', 'revoke');

  // ── 9. categories ──
  out.cats = {};
  fullSeed(win);
  resetUi(win); win.achAdminManageCategories(); out.cats.modal = modalSnap(win);
  const addCat = (label, v) => { resetUi(win); win.achAdminManageCategories(); setForm(win, { 'ach-new-cat-input': v }); win.achAdminAddCat(); out.cats[label] = { state: stateSnap(win).c, toast: toastSnap(win), modal: modalSnap(win).content }; };
  addCat('addEmpty', '   '); addCat('addDup', 'Quests'); addCat('addNew', '  Events <3  ');
  seed(win, { achievementCategories: undefined }); addCat('addFromUndefined', 'First');
  seed(win, { achievementCategories: ['Quests', 'Social', 'Events <3'] });
  resetUi(win); win.__confirmAnswer = false; win.achAdminDeleteCat(1); out.cats.delNo = { confirms: win.__confirms.slice(), state: stateSnap(win).c };
  resetUi(win); win.__confirmAnswer = true; win.achAdminDeleteCat(1); out.cats.delYes = { confirms: win.__confirms.slice(), state: stateSnap(win).c, toast: toastSnap(win), modal: modalSnap(win).content };
  resetUi(win); win.achAdminDeleteCat(99); out.cats.delBadIdx = { confirms: win.__confirms.length, state: stateSnap(win).c };

  out.errors = errors.slice();
  out.events = events.slice();
  return out;
}

function firstDiff(a, b, p) {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDiff(a[k], b[k], p + '.' + k);
      if (d) return d;
    }
  }
  const t = v => { const j = JSON.stringify(v); return j === undefined ? 'undefined' : j; };
  let i = 0; const sa = t(a), sb = t(b); while (i < sa.length && sa[i] === sb[i]) i++;
  return p + '\n  original: ...' + sa.slice(Math.max(0, i - 80), i + 160) + '\n  bridge:   ...' + sb.slice(Math.max(0, i - 80), i + 160);
}

async function main() {
  reverseTransformCheck();
  const A = makeWindow(), B = makeWindow();
  await evalOriginal(A.win);
  await evalBridge(B.win);
  assert.deepStrictEqual(clean(B.logs), clean(A.logs), 'load-time console output must match');
  assert(A.logs.some(l => l.includes('achievements/admin-page.js loaded')), 'original load log present');

  const oa = await run(A.win, A.errors);
  const ob = await run(B.win, B.errors);
  const fd = firstDiff(clean(oa), clean(ob), 'out');
  assert.strictEqual(fd, null, 'bridge output must exactly match the original at every step — first difference at: ' + fd);

  // ── independent sanity (guards against a vacuous both-sides-wrong pass) ──
  const o = clean(oa);
  assert.deepStrictEqual(o.exports.map(e => e[1]), Array(15).fill('function'));
  assert(o['render.noPage__threw'], 'render with no page throws');
  assert(o.render.empty.includes('No achievements yet'), 'empty state');
  assert(o.render.fullNoLabels.includes('c1, c2') && o.render.fullWithLabels.includes('Sec C1, Sec C2'), 'section labels with/without getClassLabel');
  assert(o.render.fullNoLabels.includes('All sections'), 'unassigned -> All sections');
  assert(o.render.fullNoLabels.includes('&lt;b&gt;Sneaky&lt;/b&gt;'), 'name escaped');
  assert(o.render.fullNoLabels.includes('>2<span') && o.render.fullNoLabels.includes('67%'), 'a1 unlocked by 2 of 3 = 67%');
  assert(o.render.zeroStudents.includes('0%') && !o.render.zeroStudents.includes('NaN'), 'zero-students pct guard');
  assert(o.render.eventsAfterRender.includes('admin:achievements-rendered'), 'render emits its event');
  assert(o.form.newWithSections.content.includes('Sec C1') && o.form.editA1Preselected.content.includes('selected'), 'form sections + preselect');
  assert(!o.form.newNoSections.content.includes('Sec C1'), 'no sections picker without getActiveClassIds');
  assert.strictEqual(o.hint.level, 'Min level (e.g. 10)'); assert.strictEqual(o.hint.unknown, '');
  assert.strictEqual(o.save.emptyName.err, 'Badge name is required.'); assert.strictEqual(o.save.emptyDesc.err, 'Description is required.');
  assert.strictEqual(o.save.emptyName.rpc, 0);
  const created = o.save.create.state.a.find(a => a.id === 'idNEW2');
  assert(created && created.ownerTeacherId === 't1' && created.xpReward === 120 && created.triggerValue === 12.5 && created.isHidden === true && created.name === 'Brand "New" <b>', 'create stamps owner + parses fields');
  assert.deepStrictEqual(o.save.create.rpc[0].params, { p_achievement_id: 'idNEW2', p_class_ids: ['c1', 'c<3'] }, 'draft sections reach the rpc');
  assert.deepStrictEqual(o.save.create.state.as.idNEW2, ['c1', 'c<3'], 'assignments set after rpc ok');
  assert(o.save.fallbacksRpcError.toast.html.includes('boom'), 'rpc error warning toast');
  const fb = o.save.fallbacksRpcError.state.a.find(a => a.id === 'idNEW3');
  assert(fb.xpReward === 0 && fb.coinReward === 0 && fb.triggerValue === 1 && fb.active === false && fb.triggerType === 'quests_completed' && fb.category === 'Quests' && fb.icon === '🏅', 'parse fallbacks');
  assert(!('idNEW3' in o.save.fallbacksRpcError.state.as), 'assignments untouched on rpc error');
  assert.strictEqual(o.save.edit.state.a[0].name, 'First Steps 2'); assert.strictEqual(o.save.edit.state.a[0].ownerTeacherId, 't1');
  assert.deepStrictEqual(o.save.edit.state.as.a1, [], 'empty selection clears assignment');
  assert(o.save.vanished.state.a.some(a => a.id === 'a2'), 'vanished id re-created via push');
  assert(o.misc.toggleOff.toast.html.includes('disabled') && o.misc.toggleOn.toast.html.includes('enabled'), 'toggle toasts');
  assert.deepStrictEqual(o.misc.toggleMissing.events, [], 'toggle missing emits nothing');
  assert.strictEqual(o.misc.deleteNo.n, 5); assert.strictEqual(o.misc.deleteNo.rpc, 0);
  assert(o.misc.deleteYes.confirms[0].includes('First Steps'), 'delete confirm text');
  assert(!o.misc.deleteYes.state.u.s1.some(u => u.achId === 'a1') && o.misc.deleteYes.state.a.length === 4, 'delete removes badge + unlock records');
  assert(o.misc.deleteRpcError.toast.html.includes('may not have synced'), 'delete rpc error toast');
  assert.strictEqual(o.misc.deleteMissing.confirms, 0);
  assert.strictEqual(o.misc.dupOwned.a.name, 'First Steps (Copy)'); assert.strictEqual(o.misc.dupNoOwner.ownerTeacherId, 't1');
  assert.deepStrictEqual(o.misc.dupMissing.events, []);
  assert(o.preview.a3.content.includes('weird'), 'unknown trigger falls back to its raw value as label');
  assert.strictEqual(o.preview.ghost.visible, 'none');
  assert(o.grant.noAchs.toast.html.includes('Create achievements first'));
  assert.strictEqual(o.grant.noStudent.err.t, 'Please select a student.'); assert.strictEqual(o.grant.noAch.err.t, 'Please select an achievement.');
  assert.deepStrictEqual(o.grant.unknownIds.sync, [], 'unknown ids -> silent no-op');
  assert.deepStrictEqual(o.grant.grantNew.sync, [['stats', 's3', 50, 25], ['unlock', 's3', 'a1', 50, 25, true, 'c2']], 'grant sync calls');
  assert.strictEqual(o.grant.grantNoClassId.sync[1][6], 'default-class');
  assert.strictEqual(o.grant.grantAlready.err.t, '❌ Student already has this achievement.');
  assert.strictEqual(o.grant.revokeNotHad.err.t, '❌ Student does not have this achievement.');
  assert.deepStrictEqual(o.grant.revokeHad.sync, [['stats', 's1', -50, -25], ['revoke', 's1', 'a1']], 'revoke sync calls');
  assert(o.grant.grantEscapes.toast.html.includes('&amp;lt;') || o.grant.grantEscapes.toast.html.includes('&lt;'), 'toast names escaped');
  assert(o.cats.addEmpty.state.length === 2 && o.cats.addDup.state.length === 2 && o.cats.addNew.state.includes('Events <3'), 'add category rules');
  assert.deepStrictEqual(o.cats.addFromUndefined.state, ['First']);
  assert(o.cats.delNo.state.length === 3 && o.cats.delYes.state.length === 2 && o.cats.delBadIdx.confirms === 0, 'delete category rules');
  assert.deepStrictEqual(o.errors, [], 'no console.error on either path');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log(' - reverse-transform: original rebuilt byte-for-byte from the twin; 16 exports');
  console.log(' - render x5, form x6, hint, save x9, toggle/delete/duplicate, preview x6, grant/revoke x13, categories x9');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
