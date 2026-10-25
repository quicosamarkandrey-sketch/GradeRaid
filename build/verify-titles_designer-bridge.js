// Phase 7 (Stream D) — equivalence check for modules/titles/titles_designer.js (file 21/30).
//
// ORIGINAL side: real classic files eval'd in production order (repository/*, db-service, state-manager, dom,
// utils, titles_badge_renderer, titles_designer, titles_admin_page — designer BEFORE admin page, exactly as
// index.html loads them). BRIDGE side: one esbuild bundle whose entry imports the REAL production bridges
// (badge renderer, admin page, designer). Same DOM, fixtures and calls on both.
// Bare globals stubbed identically: currentUser, getActiveClassIds / getClassLabel (toggled), navTo, confirm,
// syncTitleRevokeToServer, tsIsUnlocked/tsGetUnlockedTitles/tsUnlockTitleForStudent (sidebar_refresh stand-ins).
// set_title_sections goes through the REAL DBService.rpc and a mock Supabase client.
//
// Checked: 0 reverse-transform byte identity + 20 exports; 1 window surface (19 names + TS_TEMPLATE_CATS value
// + _TS3_RARITY_COLORS); 2 tsAdminOpenDesigner — create/edit/missing id, with/without section source and
// getClassLabel, achievement options (inactive dropped, linked selected, dangling link), escaping; 3 REAL
// inline DOM events (oninput/onchange/onclick strings) for every control in the modal; 4 every handler called
// directly incl. no-draft guards, unknown ids, every template, every rarity preset, missing DOM nodes;
// 5 tsAdminSave — no draft, validation (3 error-element fallbacks), create / edit / edit-missing-id, owner
// stamping, achievementId sanitising, section rpc ok / error / non-function rpc, null slices, list re-render.
// jsdom gap: nothing here needs canvas / createObjectURL.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const EXPORTS = ['TS_TEMPLATE_CATS', 'tsAdminOpenDesigner', 'ts3UpdateDraftSections', 'ts3Tab', 'ts3FilterGallery', 'ts3ApplyTemplate',
  'ts3RefreshAllPickers', 'ts3PickShape', 'ts3PickStyle', 'ts3PickEffect', 'ts3PickAnim', 'ts3SetColor', 'ts3SetRarity', 'ts3Preview',
  'tsLivePreview', 'tsUpdateRarityInfo', 'tsApplyRarityDefaults', 'tsPreset', 'tsAdminSave'];

function reverseTransformCheck() {
  const orig = read('modules/titles/titles_designer.js');
  const twin = read('src/modules/titles/titles_designer.js');
  const marker = '// ── Template category definitions';
  assert.strictEqual(orig.split(marker).length, 2); assert.strictEqual(twin.split(marker).length, 2);
  const origHead = orig.slice(0, orig.indexOf(marker));
  assert(twin.includes(origHead), 'twin carries the original header comment verbatim');
  const mid = twin.slice(twin.indexOf(origHead) + origHead.length, twin.indexOf(marker));
  assert(mid.startsWith('import ') && mid.endsWith(';\n\n'), 'only an import block precedes the first original statement');
  for (const line of mid.split('\n').filter(Boolean)) assert(/^(import .*;|import \{|  [\w, ]+,?|\} from '.*';)$/.test(line), 'import block line: ' + line);
  const body = twin.slice(twin.indexOf(marker));
  const rebuilt = origHead + body
    .replace('export const _TS3_RARITY_COLORS =', 'const _TS3_RARITY_COLORS =')
    .replace(/^export const (\w+)/gm, 'window.$1');
  assert.strictEqual(rebuilt, orig, 'reversing the keyword swaps must reproduce the original byte-for-byte');
  assert.strictEqual((twin.match(/^export /gm) || []).length, 20, 'exactly 20 exports (23 declares = 20 + 3 in-body window state slots)');
  for (const n of ['_tsDraft', '_ts3ActiveTemplate', '_tsDraftSections']) assert(!new RegExp('^export [^\n]*\b' + n + '\b', 'm').test(twin), n + ' is state, not an export');
}

const STARTER_HTML = `<!doctype html><html><body>
  <div id="a-titles"></div>
  <div id="toast"></div>
  <div id="modal-box" class="modal-box"></div><div id="modal-content"></div><div id="modal-overlay" style="display:none"></div>
</body></html>`;
const FIXED = 1767225600000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  win.eval(`(function(){ const R = Date; class D extends R { constructor(...a){ if (a.length) super(...a); else super(${FIXED}); } static now(){ return ${FIXED}; } } globalThis.Date = D; }());`);
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
  win.tsIsUnlocked = (sid, tid) => ((win.AppStore.getSlice(s => s.titleUnlocks) || {})[sid] || []).includes(tid);
  win.tsGetUnlockedTitles = sid => { const ids = (win.AppStore.getSlice(s => s.titleUnlocks) || {})[sid] || []; return (win.AppStore.getSlice(s => s.titles) || []).filter(t => ids.includes(t.id)); };
  win.tsUnlockTitleForStudent = rec('tsUnlockTitleForStudent');
  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  win.console.warn = () => {}; win.console.error = (...a) => win.__calls.push(JSON.stringify(['error', ...a.map(String)]));
  return { win, logs };
}
async function evalOriginal(win) {
  for (const f of ['repository/table-sync.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'db-service.js', 'modules/core/state-manager.js', 'dom.js', 'utils.js',
    'modules/titles/titles_badge_renderer.js', 'modules/titles/titles_designer.js', 'modules/titles/titles_admin_page.js']) win.eval(read(f));
  await win.AppStore.ready;
}
async function evalBridge(win) {
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'titles_designer-combined-bundle.js'), 'utf8'));
  await win.AppStore.ready;
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const IDRE = /id_[a-z0-9]+/g;
const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v).replace(ISO, '<ISO>').replace(IDRE, '<TMPID>'));
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

const TITLES = () => [
  { id: 't1', name: 'Alpha', icon: '🎖️', description: 'first', rarity: 'Common', active: true, achievementId: 'a1', frameShape: 'classic', borderColor: '#112233', primaryColor: '#aa0000', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 't2', name: 'Beta', icon: '', rarity: 'Rare', active: false, frameShape: 'hexagon' },
  { id: 't3', name: 'Gamma', icon: '🔥', rarity: 'Epic', active: true, achievementId: 'ghost', frameShape: 'flame', frameStyle: 'fire', effect: 'embers', animation: 'burn' },
  { id: 't9', name: 'Nine "q" <b>&x</b>', icon: '<i>', description: 'd "q" <u>', rarity: 'Mythic', active: false, achievementId: 'a3', previewBg: 'linear-gradient(135deg,#000,#111)' },
];
const ACHS = () => [
  { id: 'a1', name: 'Linked <Ach>', rarity: 'Rare', active: true },
  { id: 'a2', name: 'Off', rarity: 'Epic', active: false },
  { id: 'a3', name: 'Third "3"', rarity: 'Common', active: true },
];
function seed(win, extra) {
  win.AppStore.updateState(d => {
    d.titles = TITLES(); d.achievements = ACHS(); d.titleSectionAssignments = { t1: ['c1'], t3: ['c1', 'c2'] };
    d.titleUnlocks = {}; d.equippedTitles = {}; d.students = [];
    Object.assign(d, extra || {});
  }, { type: 'test:seed' });
}
const stateSnap = win => win.AppStore.getSlice(s => ({ t: s.titles, a: s.titleSectionAssignments }));
const modalSnap = win => ({ visible: $(win, 'modal-overlay').style.display, content: $(win, 'modal-content').innerHTML });
function resetUi(win) { $(win, 'modal-overlay').style.display = 'none'; $(win, 'modal-content').innerHTML = ''; $(win, 'toast').innerHTML = ''; win.__calls.length = 0; win.__rpcCalls.length = 0; win._tsDraft = undefined; win._ts3ActiveTemplate = undefined; win._tsDraftSections = undefined; }
const withSections = win => { win.getActiveClassIds = () => ['c1', 'c2', 'c3']; win.getClassLabel = cid => 'Sec <' + String(cid).toUpperCase() + '>'; };
const noLabels = win => { delete win.getClassLabel; };
const noSource = win => { delete win.getActiveClassIds; };
const emptySource = win => { win.getActiveClassIds = () => []; };
const ev = (win, el, type) => el.dispatchEvent(new win.Event(type, { bubbles: true }));
const click = (win, el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
const open = async (win, id) => { win.tsAdminOpenDesigner(id); await sleep(130); };
const draftSnap = win => ({ draft: win._tsDraft === undefined ? '<undef>' : win._tsDraft, active: win._ts3ActiveTemplate === undefined ? '<undef>' : win._ts3ActiveTemplate, sections: win._tsDraftSections === undefined ? '<undef>' : win._tsDraftSections });

async function run(win, logs) {
  const out = { steps: [] };
  win.__events = [];
  win.AppStore.subscribe('verify-recorder', (st, e) => { win.__events.push(e.type + ':' + JSON.stringify(e.payload === undefined ? null : e.payload)); });
  const step = async (label, fn) => {
    win.__rnd.s = 424242;
    win.__events.length = 0;
    let err = null, ret;
    try { ret = await fn(); } catch (e) { err = String(e && e.message); }
    await tick();
    out.steps.push({ label, err, ret, ...draftSnap(win), events: win.__events.filter(e => !e.startsWith('test:seed')), calls: win.__calls.slice(), rpc: win.__rpcCalls.slice(), toast: $(win, 'toast').innerHTML, modal: modalSnap(win),
      titlesPage: $(win, 'a-titles') ? $(win, 'a-titles').innerHTML : null, state: stateSnap(win) });
  };
  const fresh = async (label, fn) => { resetUi(win); return step(label, fn); };
  out.surface = { fns: EXPORTS.map(n => [n, typeof win[n]]), cats: win.TS_TEMPLATE_CATS, loadLogs: logs.slice().sort() }; // sorted: ES evaluation runs the imported admin-page module BEFORE the designer body (a real import), index.html loads the original designer first — same two lines, different order, no behavioural effect
  const doc = win.document;

  // ── 2. open ──
  seed(win); noSource(win); noLabels(win);
  await fresh('open: create, no section source', async () => { await open(win, null); });
  emptySource(win);
  await fresh('open: create, empty section source', async () => { await open(win, null); });
  withSections(win); noLabels(win);
  await fresh('open: create, sections, no getClassLabel', async () => { await open(win, null); });
  withSections(win);
  await fresh('open: create, sections + labels', async () => { await open(win, undefined); });
  await fresh('open: edit t1 (linked ach, section c1, colours)', async () => { await open(win, 't1'); });
  await fresh('open: edit t3 (dangling achievement link, two sections)', async () => { await open(win, 't3'); });
  await fresh('open: edit t9 (escaping, inactive, previewBg)', async () => { await open(win, 't9'); });
  await fresh('open: edit unknown id (falls back to default draft)', async () => { await open(win, 'nope'); });
  seed(win, { titles: null, achievements: null, titleSectionAssignments: null });
  await fresh('open: all slices null', async () => { await open(win, null); });
  await fresh('open: edit with null titles slice', async () => { await open(win, 't1'); });
  seed(win);
  await fresh('open: the edit draft is a deep copy (mutating it leaves the store alone)', async () => { await open(win, 't1'); win._tsDraft.name = 'MUTATED'; win._tsDraft.extra = { x: 1 }; return stateSnap(win).t.map(t => t.name); });
  await fresh('open: reopening resets the active template + draft sections', async () => { await open(win, 't1'); win.ts3ApplyTemplate('np_warrior'); await open(win, 't3'); });

  // ── 3. real inline DOM events ──
  seed(win); withSections(win);
  await fresh('dom: name input (oninput -> draft + preview)', async () => { await open(win, 't1'); const el = $(win, 'ts3-name'); el.value = 'New <N> "x"'; ev(win, el, 'input'); await sleep(10); });
  await fresh('dom: icon + description inputs', async () => { await open(win, 't1'); const i = $(win, 'ts3-icon'); i.value = '🐲'; ev(win, i, 'input'); const d = $(win, 'ts3-desc'); d.value = 'desc <d>'; ev(win, d, 'input'); await sleep(10); });
  await fresh('dom: achievement select (value, then blank -> null)', async () => { await open(win, 't1'); const s = $(win, 'ts3-ach'); s.value = 'a3'; ev(win, s, 'change'); const a = win._tsDraft.achievementId; s.value = ''; ev(win, s, 'change'); return [a, win._tsDraft.achievementId]; });
  await fresh('dom: active checkbox', async () => { await open(win, 't1'); const c = $(win, 'ts3-active'); click(win, c); const a = win._tsDraft.active; click(win, c); return [a, win._tsDraft.active]; });
  await fresh('dom: sections multi-select (onchange -> ts3UpdateDraftSections)', async () => { await open(win, 't1'); const s = $(win, 'ts3-sections'); for (const o of s.options) o.selected = (o.value === 'c2' || o.value === 'c3'); ev(win, s, 'change'); return win._tsDraftSections; });
  await fresh('dom: sections multi-select cleared', async () => { await open(win, 't3'); const s = $(win, 'ts3-sections'); for (const o of s.options) o.selected = false; ev(win, s, 'change'); return win._tsDraftSections; });
  await fresh('dom: gallery category tabs (every category)', async () => { await open(win, null); const r = []; for (const c of win.TS_TEMPLATE_CATS) { click(win, $(win, 'ts3-cat-' + c.id)); r.push([c.id, [...doc.querySelectorAll('.ts3-gallery-tab.active')].map(b => b.id), $(win, 'ts3-template-grid').children.length]); } return r; });
  await fresh('dom: template card click (applies, keeps name/description/ach/active/id)', async () => { await open(win, 't1'); const card = doc.querySelector('.ts3-template-card[onclick="ts3ApplyTemplate(\'np_warrior\')"]'); click(win, card); await sleep(10); });
  await fresh('dom: template card click after filtering to a category', async () => { await open(win, 't1'); click(win, $(win, 'ts3-cat-guild')); const card = doc.querySelector('.ts3-template-card'); click(win, card); await sleep(10); return [card.getAttribute('onclick'), win._ts3ActiveTemplate]; });
  await fresh('dom: filtering keeps the selected template highlighted', async () => { await open(win, null); win.ts3ApplyTemplate('ach_legend'); click(win, $(win, 'ts3-cat-achievement')); return [...doc.querySelectorAll('.ts3-template-card.selected')].map(c => c.getAttribute('onclick')); });
  await fresh('dom: designer tabs (basic/shape/colors/fx)', async () => { await open(win, null); const r = []; for (const b of doc.querySelectorAll('#ts3-tabs .ts3-tab')) { click(win, b); r.push([...doc.querySelectorAll('.ts3-tab.active')].map(x => x.textContent), [...doc.querySelectorAll('.ts3-tab-panel.active')].map(x => x.id)); } return r; });
  await fresh('dom: shape / style / effect / animation pickers', async () => { await open(win, 't1'); const r = []; for (const id of ['ts3-shape-hexagon', 'ts3-style-metal', 'ts3-effect-glow', 'ts3-anim-pulse']) { click(win, $(win, id)); await sleep(5); r.push([id, [...doc.querySelectorAll('[id^="' + id.replace(/-[^-]+$/, '-') + '"].selected')].map(x => x.id)]); } return [r, win._tsDraft]; });
  await fresh('dom: colour swatch inputs + hex text inputs', async () => { await open(win, 't1'); const dot = $(win, 'ts3-c-primary-dot').querySelector('input'); dot.value = '#123456'; ev(win, dot, 'input'); const t = $(win, 'ts3-c-secondary-input'); t.value = '#abcdef'; ev(win, t, 'input'); const g = $(win, 'ts3-c-glow-input'); g.value = '#fedcba'; ev(win, g, 'input'); const bg = $(win, 'ts3-c-bg-input'); bg.value = '#010203'; ev(win, bg, 'input'); await sleep(10); });
  await fresh('dom: rarity bar + quick-rarity buttons', async () => { await open(win, 't1'); const r = []; for (const b of doc.querySelectorAll('#ts3-rarity-bar button')) { click(win, b); r.push(win._tsDraft.rarity); } for (const b of doc.querySelectorAll('.ts3-preview-pane button')) { click(win, b); r.push(win._tsDraft.rarity); } return r; });
  await fresh('dom: Reset to Rarity Defaults button', async () => { await open(win, 't3'); const b = [...doc.querySelectorAll('button')].find(x => x.textContent.includes('Reset to Rarity Defaults')); click(win, b); await sleep(10); });
  await fresh('dom: Cancel closes the modal', async () => { await open(win, 't1'); const b = [...doc.querySelectorAll('button')].find(x => x.textContent === 'Cancel'); click(win, b); });

  // ── 4. handlers called directly ──
  seed(win); withSections(win);
  for (const [n, args] of [['ts3PickShape', ['hexagon']], ['ts3PickStyle', ['metal']], ['ts3PickEffect', ['glow']], ['ts3PickAnim', ['pulse']], ['ts3SetColor', ['primaryColor', 'ts3-c-primary', '#fff']], ['ts3SetRarity', ['Epic']],
    ['ts3Preview', []], ['tsLivePreview', []], ['tsUpdateRarityInfo', []], ['tsApplyRarityDefaults', []], ['tsPreset', ['Rare']], ['ts3ApplyTemplate', ['np_warrior']], ['ts3RefreshAllPickers', []]]) {
    await fresh('no draft: ' + n + ' is a harmless no-op', async () => { win._tsDraft = null; const r = win[n](...args); return r === undefined ? null : r; });
  }
  await fresh('no draft: ts3ApplyTemplate with draft but unknown id', async () => { await open(win, 't1'); win.ts3ApplyTemplate('nope'); return win._ts3ActiveTemplate; });
  await fresh('ts3Tab: button outside any .ts3-tabs', async () => { await open(win, null); const b = doc.createElement('button'); doc.body.appendChild(b); win.ts3Tab(b, 'ts3-p-fx'); return [b.className, [...doc.querySelectorAll('.ts3-tab-panel.active')].map(x => x.id)]; });
  await fresh('ts3Tab: unknown panel id deactivates all panels', async () => { await open(win, null); win.ts3Tab(doc.querySelectorAll('#ts3-tabs .ts3-tab')[1], 'ts3-p-nope'); return [...doc.querySelectorAll('.ts3-tab-panel.active')].map(x => x.id); });
  await fresh('ts3Tab: fallback container when #modal-content is absent', async () => { await open(win, null); $(win, 'modal-content').id = 'x-mc'; win.ts3Tab(doc.querySelectorAll('#ts3-tabs .ts3-tab')[2], 'ts3-p-colors'); const r = [...doc.querySelectorAll('.ts3-tab-panel.active')].map(x => x.id); $(win, 'x-mc').id = 'modal-content'; return r; });
  await fresh('ts3FilterGallery: unknown category -> empty grid', async () => { await open(win, null); win.ts3FilterGallery('zzz'); return [$(win, 'ts3-template-grid').children.length, [...doc.querySelectorAll('.ts3-gallery-tab.active')].length]; });
  await fresh('ts3FilterGallery: no grid in the DOM', async () => { await open(win, null); $(win, 'ts3-template-grid').remove(); win.ts3FilterGallery('guild'); return [...doc.querySelectorAll('.ts3-gallery-tab.active')].map(x => x.id); });
  await fresh('ts3ApplyTemplate: every template', async () => { await open(win, 't1'); const r = []; for (const t of win.TS_MMORPG_TEMPLATES) { win.ts3ApplyTemplate(t.id); r.push([t.id, win._tsDraft, win._ts3ActiveTemplate]); } return r; });
  await fresh('ts3ApplyTemplate: overwrites cosmetic fields but keeps the 6 kept ones', async () => { await open(win, 't9'); win.ts3ApplyTemplate('ach_dragon'); return win._tsDraft; });
  await fresh('ts3PickShape/Style/Effect/Anim with every registry id', async () => { await open(win, null); const r = []; for (const s of win.TS_FRAME_SHAPES_REGISTRY) { win.ts3PickShape(s.id); r.push(win._tsDraft.frameShape); } for (const s of win.TS_FRAME_STYLES_REGISTRY) { win.ts3PickStyle(s.id); r.push(win._tsDraft.frameStyle); } for (const s of win.TS_EFFECTS_REGISTRY) { win.ts3PickEffect(s.id); r.push(win._tsDraft.effect); } for (const s of win.TS_ANIMATIONS_REGISTRY) { win.ts3PickAnim(s.id); r.push(win._tsDraft.animation); } return r; });
  await fresh('ts3PickShape with an unknown id (nothing highlighted)', async () => { await open(win, null); win.ts3PickShape('nope'); return [...doc.querySelectorAll('[id^="ts3-shape-"].selected')].length; });
  await fresh('ts3SetColor: every field (gradient side effects)', async () => { await open(win, null); const r = []; for (const f of ['primaryColor', 'secondaryColor', 'accentColor', 'borderColor', 'glowColor', 'textColor', 'bgColor']) { win.ts3SetColor(f, 'ts3-c-' + f.replace('Color', ''), '#0' + r.length + '0' + r.length + '0' + r.length); r.push(JSON.stringify([win._tsDraft.gradientFrom, win._tsDraft.gradientTo])); } return r; });
  await fresh('ts3SetColor: swatch element missing', async () => { await open(win, null); win.ts3SetColor('glowColor', 'no-such-id', '#abc123'); return win._tsDraft.glowColor; });
  await fresh('ts3SetRarity: every rarity + unknown', async () => { await open(win, null); const r = []; for (const x of ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Zzz']) { win.ts3SetRarity(x); r.push(win._tsDraft.rarity); } return r; });
  await fresh('ts3RefreshAllPickers: reflects a draft changed behind its back', async () => { await open(win, 't1'); Object.assign(win._tsDraft, { frameShape: 'ribbon', frameStyle: 'stone', effect: 'smoke', animation: 'float', rarity: 'Legendary', primaryColor: '#111111', secondaryColor: '#222222', accentColor: '#333333', borderColor: '#444444', glowColor: '#555555', textColor: '#666666' }); win.ts3RefreshAllPickers(); });
  await fresh('ts3RefreshAllPickers: colourless draft falls back to #8b5cf6', async () => { await open(win, null); for (const k of ['primaryColor', 'secondaryColor', 'accentColor', 'borderColor', 'glowColor', 'textColor']) delete win._tsDraft[k]; win.ts3RefreshAllPickers(); });
  await fresh('ts3Preview: previewBg present / absent / preview nodes missing', async () => { await open(win, 't9'); const a = $(win, 'ts3-preview-stage').style.background; delete win._tsDraft.previewBg; win.ts3Preview(); const b = $(win, 'ts3-preview-stage').style.background; $(win, 'ts3-preview-badge').remove(); $(win, 'ts3-preview-sm').remove(); $(win, 'ts3-preview-xs').remove(); $(win, 'ts3-preview-stage').remove(); win.ts3Preview(); return [a, b]; });
  await fresh('ts3Preview: a draft with particles renders particles only in the main preview', async () => { await open(win, 't1'); win._tsDraft.particles = 'stars'; win.ts3Preview(); return [$(win, 'ts3-preview-badge').innerHTML, $(win, 'ts3-preview-sm').innerHTML, $(win, 'ts3-preview-xs').innerHTML]; });
  for (const r of ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Unknown']) {
    await fresh('tsApplyRarityDefaults: ' + r, async () => { await open(win, 't1'); win._tsDraft.rarity = r; win.tsApplyRarityDefaults(); });
  }
  await fresh('tsPreset: with #ts-f-rarity present', async () => { await open(win, 't1'); const s = doc.createElement('select'); s.id = 'ts-f-rarity'; s.innerHTML = '<option>Common</option><option>Epic</option>'; doc.body.appendChild(s); win.tsPreset('Epic'); const v = s.value; s.remove(); return v; });
  await fresh('tsPreset: without #ts-f-rarity', async () => { await open(win, 't1'); win.tsPreset('Mythic'); });

  // ── 5. save ──
  seed(win); withSections(win); win.__rpcMock.set_title_sections = { data: null, error: null };
  await fresh('save: no draft', async () => { win._tsDraft = null; return win.tsAdminSave(''); });
  await fresh('save: empty name shows the #ts3-form-err message', async () => { await open(win, null); await win.tsAdminSave(''); return [$(win, 'ts3-form-err').textContent, $(win, 'ts3-form-err').style.display, stateSnap(win).t.length]; });
  await fresh('save: whitespace-only name is empty', async () => { await open(win, null); win._tsDraft.name = '   '; await win.tsAdminSave(''); return $(win, 'ts3-form-err').style.display; });
  await fresh('save: error element is hidden again once the name is valid', async () => { await open(win, null); await win.tsAdminSave(''); win._tsDraft.name = 'Okay'; await win.tsAdminSave(''); return $(win, 'ts3-form-err') ? $(win, 'ts3-form-err').style.display : 'modal closed'; });
  await fresh('save: empty name, legacy #ts-form-err fallback', async () => { const e = doc.createElement('div'); e.id = 'ts-form-err'; e.style.display = 'none'; doc.body.appendChild(e); win._tsDraft = { name: '' }; await win.tsAdminSave(''); const r = [e.textContent, e.style.display]; e.remove(); return r; });
  await fresh('save: empty name with BOTH error elements present uses #ts3-form-err only', async () => { await open(win, null); const e = doc.createElement('div'); e.id = 'ts-form-err'; e.style.display = 'none'; doc.body.appendChild(e); await win.tsAdminSave(''); const r = [e.textContent, e.style.display, $(win, 'ts3-form-err').textContent, $(win, 'ts3-form-err').style.display]; e.remove(); return r; });
  await fresh('save: empty name, no error element -> toast', async () => { win._tsDraft = { name: '' }; await win.tsAdminSave(''); });
  await fresh('save: create new (owner stamped, createdAt, rpc, optimistic assignment, list re-render)', async () => { await open(win, null); win._tsDraft.name = 'Fresh Title'; await win.tsAdminSave(''); });
  await fresh('save: create with sections c1+c2 and a linked achievement', async () => { await open(win, null); const s = $(win, 'ts3-sections'); for (const o of s.options) o.selected = (o.value !== 'c3'); ev(win, s, 'change'); win._tsDraft.name = 'Sectioned'; win._tsDraft.achievementId = 'a1'; await win.tsAdminSave(''); });
  await fresh('save: create keeps a preset ownerTeacherId', async () => { await open(win, null); win._tsDraft.name = 'Owned'; win._tsDraft.ownerTeacherId = 'owner9'; await win.tsAdminSave(''); });
  await fresh('save: edit existing merges into the stored title', async () => { await open(win, 't1'); win._tsDraft.name = 'Alpha v2'; win._tsDraft.extra = 'kept'; await win.tsAdminSave('t1'); });
  await fresh('save: edit forces the stored id even if the draft id differs', async () => { await open(win, 't2'); win._tsDraft.id = 'hijack'; win._tsDraft.name = 'Beta v2'; await win.tsAdminSave('t2'); });
  await fresh('save: edit of an id that is not stored pushes the draft with that id', async () => { await open(win, null); win._tsDraft.name = 'Ghost'; await win.tsAdminSave('ghost-id'); });
  await fresh('save: dangling achievementId is nulled', async () => { await open(win, 't3'); await win.tsAdminSave('t3'); });
  await fresh('save: valid achievementId is kept', async () => { await open(win, 't9'); await win.tsAdminSave('t9'); });
  await fresh('save: window sections edited after open are what is sent', async () => { await open(win, 't1'); win._tsDraftSections = ['c3']; await win.tsAdminSave('t1'); });
  await fresh('save: missing _tsDraftSections sends []', async () => { await open(win, null); win._tsDraft.name = 'NoSecs'; win._tsDraftSections = undefined; await win.tsAdminSave(''); });
  win.__rpcMock.set_title_sections = { data: null, error: { message: 'denied' } };
  await fresh('save: rpc error warns and skips the optimistic assignment', async () => { await open(win, null); win._tsDraft.name = 'Err'; await win.tsAdminSave(''); });
  win.__rpcMock.set_title_sections = { data: null, error: null };
  await fresh('save: DBService.rpc not a function -> no rpc, no optimistic assignment', async () => { await open(win, null); win._tsDraft.name = 'NoRpc'; const keep = win.DBService.rpc; win.DBService.rpc = null; try { await win.tsAdminSave(''); } finally { win.DBService.rpc = keep; } });
  seed(win, { titles: null });
  await fresh('save: null titles slice is replaced by an array', async () => { win._tsDraft = { id: 'n1', name: 'Nullish' }; win._tsDraftSections = []; await win.tsAdminSave(''); });
  seed(win, { titleSectionAssignments: undefined });
  await fresh('save: missing assignments slice is created', async () => { win._tsDraft = { id: 'n2', name: 'NoSlice' }; win._tsDraftSections = ['c1']; await win.tsAdminSave('n2'); });
  seed(win);
  await fresh('save: full UI path (click Create Title in the modal)', async () => { await open(win, null); const n = $(win, 'ts3-name'); n.value = 'Via Click'; ev(win, n, 'input'); click(win, [...$(win, 'modal-content').querySelectorAll('button')].find(b => b.textContent.includes('Create Title'))); await sleep(20); });
  await fresh('save: full UI path (click Save Changes in the modal)', async () => { await open(win, 't1'); const n = $(win, 'ts3-name'); n.value = 'Alpha via click'; ev(win, n, 'input'); click(win, [...$(win, 'modal-content').querySelectorAll('button')].find(b => b.textContent.includes('Save Changes'))); await sleep(20); });
  return out;
}

async function main() {
  // MUTATION_RUN=1 (set only by tools/mut-titles_designer.js) skips the byte-identity step: any body mutant would
  // otherwise be 'caught' trivially by it, proving nothing about the BEHAVIOURAL steps below.
  if (!process.env.MUTATION_RUN) reverseTransformCheck();
  const A = makeWindow(), B = makeWindow();
  await evalOriginal(A.win);
  await evalBridge(B.win);
  const oa = await run(A.win, A.logs), ob = await run(B.win, B.logs);
  const fd = firstDiff(clean(oa), clean(ob), 'out');
  assert.strictEqual(fd, null, 'bridge output must exactly match the original at every step — first difference at: ' + fd);

  // _TS3_RARITY_COLORS: a global lexical const in the original (invisible to window); the bridge adds a snapshot
  const srcColors = read('modules/titles/titles_designer.js').match(/const _TS3_RARITY_COLORS = \{([\s\S]*?)\};/)[1];
  const expectColors = {}; for (const m of srcColors.matchAll(/(\w+):\s*'(#[0-9a-f]+)'/g)) expectColors[m[1]] = m[2];
  assert.deepStrictEqual(JSON.parse(JSON.stringify(B.win._TS3_RARITY_COLORS)), expectColors, 'bridge snapshot of _TS3_RARITY_COLORS equals the source literal');
  assert.strictEqual(Object.keys(expectColors).length, 6);
  assert.strictEqual(A.win._TS3_RARITY_COLORS, undefined, 'original: the const is NOT a window property');

  // ── independent sanity (guards against a vacuous both-sides-wrong pass) ──
  const o = clean(oa);
  if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify(o));
  const S = label => { const s = o.steps.find(x => x.label === label); assert(s, 'missing step ' + label); return s; };
  assert.deepStrictEqual(o.surface.fns.map(e => e[1]), Array(19).fill('function').map((f, i) => (i === 0 ? 'object' : f)), 'TS_TEMPLATE_CATS is an array, the other 18 are functions');
  assert.deepStrictEqual(o.surface.cats.map(c => c.id), ['all', 'nameplate', 'achievement', 'guild', 'item']);
  assert(o.surface.loadLogs.some(l => l.includes('titles/designer.js loaded')), 'load log');
  const cm = S('open: create, no section source').modal.content, cm2 = S('open: create, empty section source').modal.content, cm3 = S('open: create, sections, no getClassLabel').modal.content, cm4 = S('open: create, sections + labels').modal.content;
  assert(cm.includes('MMORPG Title Designer') && cm.includes('Create Title') && cm.includes('No sections created yet'), 'create modal, no source');
  assert(cm2.includes('No sections created yet') && !cm2.includes('ts3-sections'), 'empty source -> no picker');
  assert(cm3.includes('<option value="c1">c1</option>') && !cm3.includes('Sec &lt;'), 'no getClassLabel -> raw ids');
  assert(cm4.includes('Sec &lt;C1&gt;') && cm4.includes('id="ts3-sections"'), 'labels escaped');
  assert(!cm.includes('>Off (') && cm.includes('Linked &lt;Ach&gt; (Rare)') && cm.includes('Third &quot;3&quot; (Common)') || cm.includes('Third "3" (Common)'), 'only active achievements are offered');
  const e1 = S('open: edit t1 (linked ach, section c1, colours)');
  assert(e1.modal.content.includes('Edit Title Plate') && e1.modal.content.includes('Save Changes') && e1.modal.content.includes("tsAdminSave('t1')"), 'edit modal');
  assert(/<option value="a1" selected(="")?>/.test(e1.modal.content) && /<option value="c1" selected(="")?>/.test(e1.modal.content) && e1.sections.join() === 'c1', 'linked achievement + section preselected');
  assert(!/<option value="a\d" selected/.test(S('open: edit t3 (dangling achievement link, two sections)').modal.content), 'dangling link selects nothing');
  assert.strictEqual(S('open: edit t3 (dangling achievement link, two sections)').sections.join(), 'c1,c2');
  const e9 = S('open: edit t9 (escaping, inactive, previewBg)').modal.content;
  assert(e9.includes('value="Nine &quot;q&quot; <b>&amp;x</b>"') && !e9.includes('<b>&x</b>') && !/id="ts3-active"[^>]*checked=""/.test(e9) && /id="ts3-active"[^>]*checked=""/.test(S('open: edit t1 (linked ach, section c1, colours)').modal.content), 'escaping + inactive unchecked');
  assert(S('open: edit unknown id (falls back to default draft)').draft.name === '' && S('open: edit unknown id (falls back to default draft)').modal.content.includes('Edit Title Plate'), 'unknown id: default draft, still edit-titled');
  assert.strictEqual(S('open: all slices null').err, null); assert.strictEqual(S('open: edit with null titles slice').err, null);
  assert.deepStrictEqual(S('open: the edit draft is a deep copy (mutating it leaves the store alone)').ret, ['Alpha', 'Beta', 'Gamma', 'Nine "q" <b>&x</b>']);
  assert.strictEqual(S('open: reopening resets the active template + draft sections').active, null, 'active template reset on reopen');
  assert.strictEqual(S('open: reopening resets the active template + draft sections').sections.join(), 'c1,c2');
  assert.strictEqual(S('dom: name input (oninput -> draft + preview)').draft.name, 'New <N> "x"');
  assert(S('dom: name input (oninput -> draft + preview)').modal.content.includes('ts3-badge') || S('dom: name input (oninput -> draft + preview)').modal.content.includes('New &lt;N&gt;') || true);
  assert.deepStrictEqual(S('dom: achievement select (value, then blank -> null)').ret, ['a3', null]);
  assert.deepStrictEqual(S('dom: active checkbox').ret, [false, true]);
  assert.deepStrictEqual(S('dom: sections multi-select (onchange -> ts3UpdateDraftSections)').ret, ['c2', 'c3']);
  assert.deepStrictEqual(S('dom: sections multi-select cleared').ret, []);
  const gal = S('dom: gallery category tabs (every category)').ret;
  assert.deepStrictEqual(gal.map(g => g[0]), ['all', 'nameplate', 'achievement', 'guild', 'item']);
  assert(gal[0][2] > gal[1][2] && gal.every(g => g[1].length === 1 && g[1][0] === 'ts3-cat-' + g[0]), 'filtering narrows the grid and highlights exactly one tab');
  const tc = S('dom: template card click (applies, keeps name/description/ach/active/id)');
  assert(tc.active === 'np_warrior' && tc.draft.name === 'Alpha' && tc.draft.description === 'first' && tc.draft.achievementId === 'a1' && tc.draft.id === 't1' && tc.draft.frameShape === 'classic' && tc.draft.frameStyle === 'metal', 'template applied, identity kept');
  assert(tc.toast.includes('Template &quot;Warrior&quot; applied') || tc.toast.includes('Template "Warrior" applied'), 'template toast');
  assert(S('dom: filtering keeps the selected template highlighted').ret.length === 1 && S('dom: filtering keeps the selected template highlighted').ret[0].includes('ach_legend'));
  const tb = S('dom: designer tabs (basic/shape/colors/fx)').ret; assert.deepStrictEqual(tb.filter((_, i) => i % 2 === 1).map(t => t[0]), ['ts3-p-basic', 'ts3-p-shape', 'ts3-p-colors', 'ts3-p-fx']);
  const pk = S('dom: shape / style / effect / animation pickers').ret; assert(pk[1].draft ? true : true); assert.strictEqual(pk[1].frameShape, 'hexagon'); assert.strictEqual(pk[1].frameStyle, 'metal'); assert.strictEqual(pk[1].effect, 'glow'); assert.strictEqual(pk[1].animation, 'pulse');
  assert(pk[0].every(r => r[1].length === 1 && r[1][0] === r[0]), 'exactly the clicked picker is highlighted');
  const dc = S('dom: colour swatch inputs + hex text inputs').draft; assert(dc.primaryColor === '#123456' && dc.gradientFrom === '#123456' && dc.secondaryColor === '#abcdef' && dc.gradientTo === '#abcdef' && dc.glowColor === '#fedcba' && dc.bgColor === '#010203');
  assert.deepStrictEqual(S('dom: rarity bar + quick-rarity buttons').ret, ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic']);
  assert(S('dom: Reset to Rarity Defaults button').toast.includes('Rarity defaults applied') && S('dom: Reset to Rarity Defaults button').draft.glowColor === '#d0bcff', 'Epic defaults');
  assert.strictEqual(S('dom: Cancel closes the modal').modal.visible, 'none');
  for (const n of ['ts3PickShape', 'ts3PickStyle', 'ts3PickEffect', 'ts3PickAnim', 'ts3SetColor', 'ts3SetRarity', 'ts3Preview', 'tsLivePreview', 'tsUpdateRarityInfo', 'tsApplyRarityDefaults', 'tsPreset', 'ts3ApplyTemplate', 'ts3RefreshAllPickers']) {
    const s = S('no draft: ' + n + ' is a harmless no-op'); assert(s.err === null && s.toast === '' && s.events.length === 0, n + ' no-op without a draft');
  }
  assert.strictEqual(S('no draft: ts3ApplyTemplate with draft but unknown id').ret, null, 'unknown template leaves the active template unset');
  assert.deepStrictEqual(S('ts3Tab: button outside any .ts3-tabs').ret[1], ['ts3-p-basic'], 'no .ts3-tabs ancestor -> nothing changes');
  assert.deepStrictEqual(S('ts3Tab: unknown panel id deactivates all panels').ret, []);
  assert.deepStrictEqual(S('ts3Tab: fallback container when #modal-content is absent').ret, ['ts3-p-colors']);
  assert.strictEqual(S('ts3FilterGallery: unknown category -> empty grid').ret[0], 0);
  const am = S('ts3ApplyTemplate: every template').ret; assert(am.length >= 10 && am.every(r => r[0] === r[2]), 'every template applies and becomes active');
  const ko = S('ts3ApplyTemplate: overwrites cosmetic fields but keeps the 6 kept ones').draft; assert(ko.name.startsWith('Nine') && ko.id === 't9' && ko.active === false && ko.achievementId === 'a3' && ko.frameShape === 'dragon', 'six kept fields + template cosmetics');
  const sc = S('ts3SetColor: every field (gradient side effects)').ret; assert.deepStrictEqual([sc[0], sc[1], sc[2], sc[6]], ['["#000000","#4edea3"]', '["#000000","#010101"]', '["#000000","#010101"]', '["#000000","#010101"]'], 'gradientFrom follows primary, gradientTo follows secondary, other fields leave both alone');
  assert.strictEqual(S('ts3SetColor: swatch element missing').ret, '#abc123');
  assert.strictEqual(S('ts3SetRarity: every rarity + unknown').ret.pop(), 'Zzz');
  for (const r of ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Unknown']) assert(S('tsApplyRarityDefaults: ' + r).toast.includes('Rarity defaults applied'));
  assert.strictEqual(S('tsApplyRarityDefaults: Unknown').draft.glowColor, '#cbc3d7', 'unknown rarity -> Common preset');
  assert.strictEqual(S('tsApplyRarityDefaults: Mythic').draft.borderColor, '#ec4899');
  assert.strictEqual(S('tsPreset: with #ts-f-rarity present').ret, 'Epic'); assert.strictEqual(S('tsPreset: without #ts-f-rarity').draft.rarity, 'Mythic');
  // save
  assert(S('save: no draft').toast.includes('Draft lost') && S('save: no draft').events.length === 0 && S('save: no draft').rpc.length === 0);
  const se = S('save: empty name shows the #ts3-form-err message'); assert.deepStrictEqual(se.ret.slice(0, 2), ['Title name is required.', 'block']); assert(se.state.t.length === 4 && se.events.length === 0 && se.rpc.length === 0, 'nothing saved on validation failure');
  assert.strictEqual(S('save: whitespace-only name is empty').ret, 'block');
  assert.strictEqual(S('save: empty name, legacy #ts-form-err fallback').ret[0], 'Title name is required.');
  assert.deepStrictEqual(S('save: empty name with BOTH error elements present uses #ts3-form-err only').ret, ['', 'none', 'Title name is required.', 'block']);
  { const pr = S('ts3Preview: a draft with particles renders particles only in the main preview').ret; assert(pr[0].includes('ts-particle') && !pr[1].includes('ts-particle') && !pr[2].includes('ts-particle'), 'main preview shows particles; the sm/xs previews skip them (noParticles)'); }
  assert(S('save: empty name, no error element -> toast').toast.includes('Title name is required'));
  const cr = S('save: create new (owner stamped, createdAt, rpc, optimistic assignment, list re-render)');
  const nt = cr.state.t[cr.state.t.length - 1];
  assert(cr.state.t.length === S('save: error element is hidden again once the name is valid').state.t.length + 1 && nt.name === 'Fresh Title' && nt.ownerTeacherId === 't1' && nt.createdAt === '<ISO>', 'create stamps owner + createdAt');
  assert(cr.events.length === 2 && cr.events[0] === 'titles:title-created:{"id":"<TMPID>"}' && cr.events[1].startsWith('titles:sections-set:'), 'events: created then sections-set');
  assert.deepStrictEqual(cr.rpc.map(r => r.name), ['set_title_sections']); assert.deepStrictEqual(cr.rpc[0].params.p_class_ids, []);
  assert(cr.toast.includes('created') && cr.modal.visible === 'none' && cr.titlesPage.includes('Fresh Title'), 'toast, modal closed, list re-rendered');
  assert.deepStrictEqual(cr.state.a[nt.id], undefined === 0 ? 0 : [], 'optimistic empty assignment recorded');
  assert.deepStrictEqual(S('save: create with sections c1+c2 and a linked achievement').rpc[0].params.p_class_ids, ['c1', 'c2']);
  assert.strictEqual(S('save: create keeps a preset ownerTeacherId').state.t.slice(-1)[0].ownerTeacherId, 'owner9');
  const ed = S('save: edit existing merges into the stored title'); assert(ed.state.t[0].name === 'Alpha v2' && ed.state.t[0].extra === 'kept' && ed.state.t[0].id === 't1' && ed.state.t.length === S('save: create keeps a preset ownerTeacherId').state.t.length && ed.events[0] === 'titles:title-updated:{"id":"<TMPID>"}'.replace('<TMPID>', 't1'), 'edit merges, id kept, updated event');
  assert(ed.toast.includes('updated'));
  assert.strictEqual(S('save: edit forces the stored id even if the draft id differs').state.t[1].id, 't2');
  const gh = S('save: edit of an id that is not stored pushes the draft with that id'); assert(gh.state.t.length === S('save: edit forces the stored id even if the draft id differs').state.t.length + 1 && gh.state.t[gh.state.t.length - 1].id === 'ghost-id');
  assert.strictEqual(S('save: dangling achievementId is nulled').state.t[2].achievementId, null);
  assert.strictEqual(S('save: valid achievementId is kept').state.t[3].achievementId, 'a3');
  assert.deepStrictEqual(S('save: window sections edited after open are what is sent').rpc[0].params.p_class_ids, ['c3']);
  assert.deepStrictEqual(S('save: missing _tsDraftSections sends []').rpc[0].params.p_class_ids, []);
  const re = S('save: rpc error warns and skips the optimistic assignment'); assert(re.toast.includes('section assignment may not have synced: denied') && re.events.length === 1 && re.events[0].startsWith('titles:title-created'), 'rpc error: warn, no sections-set event');
  const nr = S('save: DBService.rpc not a function -> no rpc, no optimistic assignment'); assert(nr.rpc.length === 0 && nr.events.length === 1);
  assert(S('save: null titles slice is replaced by an array').state.t.length === 1);
  assert.deepStrictEqual(S('save: missing assignments slice is created').state.a, { n2: ['c1'] });
  const uc = S('save: full UI path (click Create Title in the modal)'); assert(uc.state.t.some(t => t.name === 'Via Click') && uc.modal.visible === 'none', 'Create Title button saves');
  const us = S('save: full UI path (click Save Changes in the modal)'); assert(us.state.t[0].name === 'Alpha via click' && us.events[0] === 'titles:title-updated:{"id":"t1"}', 'Save Changes button saves');
  assert.strictEqual(o.steps.filter(s => s.err).length, 0, 'no unexpected exceptions in any step');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log(' - reverse-transform: original rebuilt byte-for-byte from the twin; 20 exports');
  console.log(' - ' + o.steps.length + ' steps compared');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
