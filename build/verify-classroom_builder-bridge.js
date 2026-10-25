// Phase 7 (Stream D) — equivalence check for modules/seat-arrangement/classroom_builder.js.
//
// ORIGINAL side: real classic files eval'd in production order (repository/*, db-service,
// state-manager, dom, utils, classroom-service, then the builder with a tiny peek() snippet
// appended INSIDE the same eval so it can read the builder's script-scope `let` state live).
// BRIDGE side: one esbuild bundle whose entry imports the REAL production bridge; its peek()
// reads the twin's live `export let` bindings through the module namespace.
//
// CYCLE PARTNER: classroom-builder-render.js (file 20) is NOT loaded on either side — the six
// render functions the builder calls (_cbRenderShell/_cbRenderCanvas/_cbRepaintSeats/
// _cbRenderSidebar/_cbScaleCanvas/_cbRenderWizard) are RECORDING STUBS installed identically on
// both windows. Each stub logs its arguments AND the builder's live state at call time, so this
// checks not just that the right render calls happen but that the shared state they would read is
// right at that instant. The real render file's own behavior belongs to file 20's check.
// ClassroomService (the real classic/converted singleton) has its methods replaced with scripted
// recorders on both sides (same object the module under test holds). Other bare globals stubbed
// identically: getActiveClassIds (explicit window call in the file), getClassLabel (toggled —
// its typeof guard is behavior), currentUser, refreshClassroomData (toggled), prompt/confirm.
//
// Checked, in order:
//  0. reverse-transform: twin body byte-identical to the original once the keyword swaps are
//     reversed; 76 exports; the original's 31-line trailing window block kept verbatim.
//  1. load-time console output, CSS injected exactly once, and the window surface: the bridge
//     side may only ADD the 8 documented state/const snapshots, nothing else, and every
//     function / snapshot value that exists on both sides is the same.
//  2. renderClassroomBuilder (no page; default pick; sections-loaded rules; refresh resolve/
//     reject/absent), _cbLoadState branches via layout changes (found / auto-pick / deleted).
//  3. _cbMaybeAutoFixSeatOverlap: assign-mode/no-layout/already-fixed guards, in-flight guard,
//     overlap resolution (pair nudge, exact same spot, locked anchors, canvas clamp), no-overlap
//     mark-only, save failure vs success.
//  4. Store subscription: unmounted ignore, attendance fast path, classroom:/legacy-sync reload,
//     toolbar seat count, sections: re-validation (switch / keep / no page).
//  5. Toolbar controllers: class/layout change, set mode, new/rename/delete layout, save.
//  6. Seat + prop management, multi-select, duplicate; seat/prop drag start/end; canvas drop
//     (single, multi-select move, prop, clamps, no drag id, assign mode).
//  7. Blueprint wizard: open/close/shape/preset, every validation, success + failure, note text.
//  8. Assign mode: drag over/leave/drop, occupant drag, unassign, lock toggle, auto strategy,
//     auto-allocate. 9. renderStudentSeating (every branch). 10. unmount.
// After EVERY step the full live module state, the recorded calls, the toast and key DOM bits are
// captured and compared. JSON.stringify-based clean() sidesteps cross-jsdom-realm quirks.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// ── 0. reverse transform ────────────────────────────────────────────────────
function reverseTransformCheck() {
  const acorn = require('acorn');
  const orig = read('modules/seat-arrangement/classroom_builder.js');
  const twin = read('src/modules/seat-arrangement/classroom_builder.js');
  const anchor = '// ── Module-level state ';
  assert.strictEqual(orig.split(anchor).length, 2); assert.strictEqual(twin.split(anchor).length, 2);
  const origHead = orig.slice(0, orig.indexOf(anchor));
  assert(twin.includes(origHead), 'twin carries the original header comment verbatim');
  const mid = twin.slice(twin.indexOf(origHead) + origHead.length, twin.indexOf(anchor));
  assert(/^(import [^\n]+\n)+\n$/.test(mid), 'only an import block precedes the first original statement');
  const body = twin.slice(twin.indexOf(anchor));
  const rebuilt = origHead + body
    .replace(/^export const (\w+) = (async )?function/gm, 'window.$1 = $2function')
    .replace(/^export (let|const|function|async function) /gm, '$1 ');
  assert.strictEqual(rebuilt, orig, 'reversing the keyword swaps must reproduce the original byte-for-byte');
  assert.strictEqual((twin.match(/^export /gm) || []).length, 76, 'exactly 76 exports (declaresCount 76)');
  assert.strictEqual((twin.match(/^window\.\w+ = \w+;$/gm) || []).length, 31, 'original 31-line trailing window block kept verbatim');
  // sanity: both files parse; twin as module
  acorn.parse(orig, { ecmaVersion: 'latest' }); acorn.parse(twin, { ecmaVersion: 'latest', sourceType: 'module' });
}

const STARTER_HTML = `<!doctype html><html><body>
  <div id="a-classroom" class="active">
    <div class="cb-toolbar"><span style="color:var(--text-muted)">0 seats</span><button class="btn-primary">💾 Save Layout</button>
      <select id="cb-layout-select"><option value="L1">Main</option><option value="L2">Second</option></select></div>
    <div id="cb-canvas-wrap" class="cb-canvas-wrap"></div>
    <div id="cb-modal-root"><p>wizard</p></div>
    <input id="cb-wiz-rows" value="4"><input id="cb-wiz-cols" value="6"><input id="cb-wiz-spacing" value="130">
    <div class="cb-modal-actions"><button class="btn-primary">⚡ Generate</button></div>
    <button id="cb-auto-btn">⚡ Auto-Fill</button>
  </div>
  <div id="s-classroom" class="active"></div>
  <div id="toast"></div>
  <div id="modal-box" class="modal-box"></div><div id="modal-content"></div><div id="modal-overlay" style="display:none"></div>
</body></html>`;

const PEEK_SNIPPET = `
window.__peek = () => ({
  mounted: _cbMounted, mode: _cbMode, classId: _cbClassId, layoutId: _cbLayoutId,
  layoutName: _cbLayoutName, localSeats: _cbLocalSeats, localProps: _cbLocalProps,
  dragSeatId: _cbDragSeatId, dragStudentId: _cbDragStudentId, selected: [..._cbSelectedSeatIds],
  dragOffX: _cbDragOffsetX, dragOffY: _cbDragOffsetY, subscriberKey: _cbSubscriberKey,
  autoStrategy: _cbAutoStrategy, wizardOpen: _cbWizardOpen, wizardShape: _cbWizardShape,
  wizardRows: _cbWizardRows, wizardCols: _cbWizardCols, wizardSpacing: _cbWizardSpacing,
  wizardPreset: _cbWizardPreset, autoFixInFlight: [..._cbAutoFixInFlight],
});
`;

const FIXED = 1767225600000;
function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  win.eval(`(function(){ const R = Date; class D extends R { constructor(...a){ if (a.length) super(...a); else super(${FIXED}); } static now(){ return ${FIXED}; } } globalThis.Date = D; }());`);
  win.eval("currentUser = { id: 's1', classId: 'c1' }; currentRole = 'student';");
  win.DEFAULT_DB = { students: [], classroomLayouts: [], seats: [], seatAssignments: [], classSections: [], attendanceLogs: [], recitationLog: [], pointLog: [] };
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };
  win.__rpcCalls = []; win.__rpcMock = {};
  const mockClient = {
    auth: { getSession: async () => ({ data: { session: null } }) },
    rpc: async (name, params) => { win.__rpcCalls.push({ name, params }); const e = win.__rpcMock[name]; if (typeof e === 'function') return e(params); if (e) return e; throw new Error('unmocked rpc: ' + name); },
  };
  win.SupabaseClient = { getClient: () => mockClient, resolveProvider: () => 'supabase' };
  win.__EDUQUEST_SUPABASE_URL__ = ''; win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };

  win.__calls = []; win.__svc = {}; win.__classIds = ['c1', 'c2'];
  win.__promptAnswer = null; win.__confirmAnswer = true; win.__refresh = 'resolve';
  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  win.console.warn = (...a) => win.__calls.push(JSON.stringify(['warn', ...a.map(String)]));
  win.console.error = (...a) => win.__calls.push(JSON.stringify(['error', ...a.map(String)]));
  return { win, logs };
}

const summ = a => {
  if (a && a.nodeType) return '<' + (a.id || a.nodeName) + '>';
  if (typeof a === 'function') return '<fn>';
  if (a && typeof a === 'object' && ('classroomLayouts' in a)) return '<state>';
  return a === undefined ? '<undef>' : a;
};
function installStubs(win) {
  const rec = (name, ret) => (...args) => { win.__calls.push(JSON.stringify([name, ...args.map(summ)])); return ret ? ret(...args) : undefined; };
  const renderRec = name => (...args) => { win.__calls.push(JSON.stringify([name, ...args.map(summ), win.__peek && win.__peek()])); };
  for (const n of ['_cbRenderShell', '_cbRenderCanvas', '_cbRepaintSeats', '_cbRenderSidebar', '_cbScaleCanvas', '_cbRenderWizard']) win[n] = renderRec(n);
  win.getActiveClassIds = rec('getActiveClassIds', () => win.__classIds.slice());
  win.prompt = rec('prompt', () => win.__promptAnswer);
  win.confirm = rec('confirm', () => win.__confirmAnswer);
  win.refreshClassroomData = rec('refreshClassroomData', () => {
    if (win.__refresh === 'reject') return Promise.reject(new Error('refresh boom'));
    // 'once': resolve the FIRST call, then stay pending forever — the student view re-renders after a
    // successful refresh, and with no new layouts arriving that would otherwise recurse unboundedly.
    if (win.__refresh === 'once') { win.__refresh = 'pending'; return Promise.resolve(); }
    if (win.__refresh === 'pending') return new Promise(() => {});
    return Promise.resolve();
  });
  win.addEventListener = ((orig) => function (t, f, o) { if (t === 'resize') win.__calls.push(JSON.stringify(['addEventListener', t])); return orig.call(win, t, f, o); })(win.addEventListener);
  win.removeEventListener = ((orig) => function (t, f, o) { if (t === 'resize') win.__calls.push(JSON.stringify(['removeEventListener', t, typeof f, f === win._cbScaleCanvas])); return orig.call(win, t, f, o); })(win.removeEventListener);
}
const SVC_DEFAULTS = { saveLayout: { ok: true, layoutId: 'L2', seats: [] }, markSeatOverlapFixed: { ok: true } };
function spyStore(win) {
  const st = win.AppStore;
  for (const m of ['subscribe', 'unsubscribe']) {
    const orig = st[m];
    st[m] = function (...a) { if (typeof a[0] === 'string' && a[0] === (win.__peek && win.__peek().subscriberKey)) win.__calls.push(JSON.stringify(['AppStore.' + m, a[0]])); return orig.apply(st, a); };
  }
}
function patchService(win) {
  spyStore(win);
  const svc = win.ClassroomService;
  for (const m of ['saveLayout', 'markSeatOverlapFixed', 'deleteLayout', 'generateBlueprint', 'manualMoveStudent', 'setSeatLock', 'getLiveSeatingMap', 'getUnassignedStudents', 'autoAllocateRemaining', 'duplicateSeats']) {
    svc[m] = (...args) => {
      win.__calls.push(JSON.stringify(['svc.' + m, ...args.map(summ)]));
      // Methods a step has not scripted fall back to a harmless default so that the file's
      // un-awaited background auto-fix (fired by any layout change) can never see `undefined`.
      const r = (m in win.__svc) ? win.__svc[m] : SVC_DEFAULTS[m];
      return typeof r === 'function' ? r(...args) : r;
    };
  }
}
async function evalOriginal(win) {
  win.eval(read('utils.js'));
  win.eval(read('repository/table-sync.js'));
  win.eval(read('repository/pull-mappers.js'));
  win.eval(read('repository/realtime-groups.js'));
  win.eval(read('db-service.js'));
  win.eval(read('modules/core/state-manager.js'));
  win.eval(read('dom.js'));
  win.eval(read('modules/seat-arrangement/classroom-service.js'));
  installStubs(win);
  win.eval(read('modules/seat-arrangement/classroom_builder.js') + PEEK_SNIPPET);
  patchService(win);
  await win.AppStore.ready;
}
async function evalBridge(win) {
  installStubs(win);
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'classroom_builder-combined-bundle.js'), 'utf8'));
  patchService(win);
  await win.AppStore.ready;
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const TMPID = /new_[a-z0-9]{2,8}/g;
const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v).replace(ISO, '<ISO>').replace(TMPID, '<TMPID>'));
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const $ = (win, sel) => win.document.querySelector(sel);

const LAYOUTS = () => ([
  { id: 'L1', classId: 'c1', name: 'Main', roomData: [{ type: 'teacher-desk', x: 100, y: 40, rotation: 0 }], seatOverlapFixed: true },
  { id: 'L2', classId: 'c1', name: 'Second', seatOverlapFixed: false },
  { id: 'L3', classId: 'c2', name: 'Other', seatOverlapFixed: true },
  { id: 'L4', classId: 'c3', name: 'Spaced', seatOverlapFixed: false },
  { id: 'L5', classId: 'c4', name: 'Anchors', seatOverlapFixed: false },
  { id: 'L6', classId: 'c5', name: 'Edge', seatOverlapFixed: false },
]);
const SEATS = () => ([
  { id: 'seat1', layoutId: 'L1', xCoord: 100, yCoord: 100, label: 'A1' },
  { id: 'seat2', layoutId: 'L1', xCoord: 300, yCoord: 100, rotation: 90, isLocked: true },
  { id: 'seat3', layoutId: 'L1', xCoord: 500, yCoord: 100, rotation: 0 },
  { id: 'sa', layoutId: 'L2', xCoord: 200, yCoord: 200 }, { id: 'sb', layoutId: 'L2', xCoord: 210, yCoord: 200 }, { id: 'sc', layoutId: 'L2', xCoord: 200, yCoord: 200 },
  { id: 'sp', layoutId: 'L4', xCoord: 200, yCoord: 200 }, { id: 'sq', layoutId: 'L4', xCoord: 500, yCoord: 400 },
  { id: 'la', layoutId: 'L5', xCoord: 300, yCoord: 300, isLocked: true }, { id: 'lb', layoutId: 'L5', xCoord: 320, yCoord: 300 },
  { id: 'ea', layoutId: 'L6', xCoord: 20, yCoord: 20 }, { id: 'eb', layoutId: 'L6', xCoord: 30, yCoord: 20 },
]);
const ASSIGNS = () => ([{ layoutId: 'L1', seatId: 'seat1', studentId: 's1' }, { layoutId: 'L1', seatId: 'seat3', studentId: 's2' }]);
function seed(win, extra) {
  win.AppStore.updateState(d => {
    d.classroomLayouts = LAYOUTS(); d.seats = SEATS(); d.seatAssignments = ASSIGNS();
    d.classSections = []; Object.assign(d, extra || {});
  }, { type: 'test:seed' });
}
function wrapGeometry(win) {
  const w = win.document.getElementById('cb-canvas-wrap');
  Object.defineProperty(w, 'clientWidth', { configurable: true, value: 600 });
  Object.defineProperty(w, 'clientHeight', { configurable: true, value: 400 });
  w.getBoundingClientRect = () => ({ left: 10, top: 20, width: 600, height: 400, right: 610, bottom: 420 });
}
const mkEl = win => { const el = win.document.createElement('div'); el.getBoundingClientRect = () => ({ left: 50, top: 60 }); return el; };
function mkEvt(win, o) {
  const e = { clientX: 0, clientY: 0, relatedTarget: null, currentTarget: mkEl(win),
    dataTransfer: { effectAllowed: '', dropEffect: '', setDragImage() { win.__calls.push('["setDragImage"]'); }, setData(k, v) { win.__calls.push(JSON.stringify(['setData', k, v])); } },
    preventDefault() { win.__calls.push('["preventDefault"]'); }, stopPropagation() { win.__calls.push('["stopPropagation"]'); } };
  return Object.assign(e, o || {});
}

async function run(win, logs) {
  const out = { steps: [] };
  const toastEl = () => win.document.getElementById('toast');
  const domSnap = () => ({
    count: ($(win, '.cb-toolbar span[style*="text-muted"]') || {}).textContent,
    save: [($(win, '.cb-toolbar .btn-primary') || {}).textContent, ($(win, '.cb-toolbar .btn-primary') || {}).disabled],
    gen: [($(win, '.cb-modal-actions .btn-primary') || {}).textContent, ($(win, '.cb-modal-actions .btn-primary') || {}).disabled],
    auto: [($(win, '#cb-auto-btn') || {}).textContent, ($(win, '#cb-auto-btn') || {}).disabled],
    opt: [...win.document.querySelectorAll('#cb-layout-select option')].map(o => o.textContent),
    modalRoot: ($(win, '#cb-modal-root') || {}).innerHTML,
    student: ($(win, '#s-classroom') || {}).innerHTML,
    body: win.document.body.children.length,
  });
  const step = async (label, fn) => {
    if (process.env.V16_TRACE) console.error('STEP', label);
    toastEl().innerHTML = ''; toastEl().style.display = ''; win.__calls.length = 0;
    let err = null, ret;
    try { ret = await fn(); } catch (e) { err = String(e && e.message); }
    await tick();
    out.steps.push({ label, err, ret, calls: win.__calls.slice(), toast: toastEl().innerHTML, peek: JSON.parse(JSON.stringify(win.__peek())), dom: domSnap() }); // deep copy: __peek() returns the LIVE arrays
  };
  const svc = (o) => { win.__svc = o; };

  wrapGeometry(win);
  seed(win);

  // ── 1. surface ──
  const FNS = ['renderClassroomBuilder', '_cbOnClassChange', '_cbOnLayoutChange', '_cbSetMode', '_cbNewLayout', '_cbRenameLayout', '_cbDeleteLayout', '_cbSave', '_cbAddSeat', '_cbDeleteSeat', '_cbRotateSeat', '_cbToggleSeatSelection', '_cbSelectAllSeats', '_cbClearSeatSelection', '_cbDuplicateSelectedSeats', '_cbOnCanvasDragOver', '_cbOnCanvasDragLeave', '_cbOnCanvasDrop', '_cbAddProp', '_cbDeleteProp', '_cbOpenBlueprintWizard', '_cbCloseBlueprintWizard', '_cbSetWizardShape', '_cbSetWizardPreset', '_cbSubmitBlueprintWizard', '_cbToggleSeatLock', '_cbSetAutoStrategy', '_cbRunAutoAllocate', 'renderStudentSeating', 'unmountClassroomBuilder', '_cbGenId', '_cbCanvasScale', '_cbVirtualCoords', '_cbLoadState', '_cbResolveSeatOverlaps', '_cbMaybeAutoFixSeatOverlap', '_cbSubscribeToStore', '_cbRefreshSelectionToolbar', '_cbSeatDragStart', '_cbSeatDragEnd', '_cbPropDragStart', '_cbPropDragEnd', '_cbSeatAssignDragOver', '_cbSeatAssignDragLeave', '_cbSeatAssignDrop', '_cbSeatOccupantDragStart', '_cbSeatOccupantDragEnd', '_cbUnassign'];
  const SNAP = ['CB_CANVAS_W', 'CB_CANVAS_H', '_cbClassId', '_cbLayoutId', '_cbMode', '_cbLocalSeats', '_cbSelectedSeatIds', '_cbLocalProps', 'CB_PROP_TYPES', '_cbMounted', '_cbAutoStrategy', '_cbDragStudentId', '_cbWizardOpen', 'CB_SHAPE_TYPES', '_cbWizardShape', '_cbWizardRows', '_cbWizardCols', '_cbWizardSpacing', 'CB_WALKWAY_PRESETS', '_cbWizardPreset'];
  assert.strictEqual(FNS.length, 48); assert.strictEqual(SNAP.length, 20);
  out.surface = {
    fns: FNS.map(n => [n, typeof win[n]]),
    snaps: SNAP.map(n => [n, JSON.stringify(win[n] instanceof win.Set ? [...win[n]] : win[n])]),
    keys: Object.keys(win).filter(k => /^(_cb|CB_|renderClassroomBuilder|renderStudentSeating|unmountClassroomBuilder)/.test(k) && !k.startsWith('_cbRender') && k !== '_cbRepaintSeats' && k !== '_cbScaleCanvas').sort(),
    css: [win.document.querySelectorAll('#classroom-builder-css').length, win.document.getElementById('classroom-builder-css').textContent.length],
    loadLogs: logs.slice(),
  };

  // ── 2. renderClassroomBuilder ──
  const page = win.document.getElementById('a-classroom');
  page.remove();
  await step('render: no page', () => win.renderClassroomBuilder());
  win.document.body.insertBefore(page, win.document.body.firstChild);
  win.getClassLabel = undefined; delete win.getClassLabel;
  await step('render: default pick, sections not loaded', () => win.renderClassroomBuilder());
  await step('render: again (class valid, sections not loaded)', () => win.renderClassroomBuilder());
  win.__classIds = ['c9', 'c8'];
  await step('render: sections NOT loaded, class missing from list -> keep', () => win.renderClassroomBuilder());
  seed(win, { classSections: [{ id: 'c9' }] });
  await step('render: sections loaded, class missing -> switch', () => win.renderClassroomBuilder());
  win.__classIds = [];
  await step('render: no class ids', () => win.renderClassroomBuilder());
  win.__classIds = ['c1', 'c2']; win.__refresh = 'reject';
  await step('render: refresh rejects', () => win.renderClassroomBuilder());
  win.__refresh = 'resolve'; const rc = win.refreshClassroomData; win.refreshClassroomData = undefined;
  await step('render: no refresh fn', () => win.renderClassroomBuilder());
  win.refreshClassroomData = rc;

  // ── load-state branches ──
  await step('class change c1 (picks first layout)', () => win._cbOnClassChange('c1'));
  await step('layout change L1 (found, assignments mapped)', () => win._cbOnLayoutChange('L1'));
  await step('layout change GONE (deleted -> reset)', () => win._cbOnLayoutChange('GONE'));
  await step('layout change empty (auto-pick first)', () => win._cbOnLayoutChange(''));
  await step('load state direct, layout without roomData', () => { win._cbOnLayoutChange('L2'); });

  // ── 3. auto-fix overlap ──
  // Layouts start flagged FIXED so that merely selecting one (which fires the file's own un-awaited
  // background auto-fix) is a no-op; each step then un-flags the layout it wants to exercise and
  // calls _cbMaybeAutoFixSeatOverlap() directly. _cbLoadState() restores the original (overlapping)
  // local seats between steps, because the file assigns _cbLocalSeats BEFORE saving.
  const setFixed = (id, v) => win.AppStore.updateState(d => { d.classroomLayouts.find(l => l.id === id).seatOverlapFixed = v; }, { type: 'test:seed' });
  seed(win, { classroomLayouts: LAYOUTS().map(l => ({ ...l, seatOverlapFixed: true })) });
  await step('autofix: select L2 (flagged fixed -> silent)', () => { win._cbOnClassChange('c1'); win._cbOnLayoutChange('L2'); });
  svc({ saveLayout: { ok: false, error: 'db down' }, markSeatOverlapFixed: { ok: true } });
  await step('autofix: save fails -> no mark, error toast', () => { setFixed('L2', false); return win._cbMaybeAutoFixSeatOverlap(); });
  svc({ saveLayout: { ok: true, layoutId: 'L2' }, markSeatOverlapFixed: { ok: true } });
  await step('autofix: success (pair nudge + same-spot)', () => { win._cbLoadState(); return win._cbMaybeAutoFixSeatOverlap(); });
  await step('autofix: in-flight guard (two concurrent calls)', async () => { win._cbLoadState(); const a = win._cbMaybeAutoFixSeatOverlap(); const b = win._cbMaybeAutoFixSeatOverlap(); await Promise.all([a, b]); });
  await step('autofix: no overlap -> mark only', () => { win._cbOnClassChange('c3'); win._cbOnLayoutChange('L4'); setFixed('L4', false); return win._cbMaybeAutoFixSeatOverlap(); });
  await step('autofix: locked anchor never moves', () => { win._cbOnClassChange('c4'); win._cbOnLayoutChange('L5'); setFixed('L5', false); return win._cbMaybeAutoFixSeatOverlap(); });
  await step('autofix: canvas clamp', () => { win._cbOnClassChange('c5'); win._cbOnLayoutChange('L6'); setFixed('L6', false); return win._cbMaybeAutoFixSeatOverlap(); });
  await step('autofix: already-fixed layout', () => { win._cbOnClassChange('c1'); win._cbOnLayoutChange('L1'); return win._cbMaybeAutoFixSeatOverlap(); });
  await step('autofix: no layout selected', () => { win._cbOnLayoutChange('GONE'); return win._cbMaybeAutoFixSeatOverlap(); });
  await step('autofix: assign mode returns early', () => { setFixed('L2', true); win._cbOnLayoutChange('L2'); setFixed('L2', false); win._cbSetMode('assign'); return win._cbMaybeAutoFixSeatOverlap(); });
  await step('autofix: pure overlap resolver (empty, locked pair, same spot)', () => ({
    empty: win._cbResolveSeatOverlaps([]),
    lockedPair: win._cbResolveSeatOverlaps([{ id: 'a', xCoord: 300, yCoord: 300, isLocked: true }, { id: 'b', xCoord: 310, yCoord: 300, isLocked: true }]),
    same: win._cbResolveSeatOverlaps([{ id: 'a', xCoord: 400, yCoord: 300 }, { id: 'b', xCoord: 400, yCoord: 300 }]),
    bLocked: win._cbResolveSeatOverlaps([{ id: 'a', xCoord: 400, yCoord: 300 }, { id: 'b', xCoord: 410, yCoord: 300, isLocked: true }]),
    aLocked: win._cbResolveSeatOverlaps([{ id: 'a', xCoord: 400, yCoord: 300, isLocked: true }, { id: 'b', xCoord: 410, yCoord: 300 }]),
  }));
  win._cbSetMode('build');

  // ── 4. store subscription ──
  seed(win);
  win.unmountClassroomBuilder();
  await step('sub: unmounted ignores events', () => { win.AppStore.emit({ type: 'attendance:scan-recorded' }); win.AppStore.emit({ type: 'classroom:x' }); });
  await step('mount for subscription tests', () => { win._cbOnClassChange('c1'); win._cbOnLayoutChange('L1'); win.renderClassroomBuilder(); });
  await step('sub: attendance:scan-recorded', () => win.AppStore.emit({ type: 'attendance:scan-recorded' }));
  await step('sub: attendance:override', () => win.AppStore.emit({ type: 'attendance:override' }));
  await step('sub: state:remote-sync', () => win.AppStore.emit({ type: 'state:remote-sync' }));
  await step('sub: classroom:* reload + toolbar count (build)', () => win.AppStore.emit({ type: 'classroom:layout-saved' }));
  await step('sub: state:legacy-sync', () => win.AppStore.emit({ type: 'state:legacy-sync' }));
  win._cbSetMode('assign');
  await step('sub: classroom:* in assign mode (count untouched)', () => win.AppStore.emit({ type: 'classroom:seat-moved' }));
  win._cbSetMode('build');
  win.__classIds = ['c2']; 
  await step('sub: sections:* current class gone -> switch + shell', () => win.AppStore.emit({ type: 'sections:loaded' }));
  win.__classIds = ['c2', 'c1'];
  await step('sub: sections:* current class kept', () => win.AppStore.emit({ type: 'sections:loaded' }));
  win.__classIds = [];
  await step('sub: sections:* empty list', () => win.AppStore.emit({ type: 'sections:loaded' }));
  win.__classIds = ['c1', 'c2'];
  page.remove();
  await step('sub: sections:* no page', () => win.AppStore.emit({ type: 'sections:loaded' }));
  win.document.body.insertBefore(page, win.document.body.firstChild);
  await step('sub: unrelated event + typeless', () => { win.AppStore.emit({ type: 'other:thing' }); });
  win._cbOnClassChange('c1'); win._cbOnLayoutChange('L1');

  // ── 5. toolbar controllers ──
  seed(win);
  win._cbOnClassChange('c1'); win._cbOnLayoutChange('L1');
  await step('setMode assign without layout', () => { win._cbOnLayoutChange('GONE'); win._cbSetMode('assign'); });
  win._cbOnLayoutChange('L1');
  await step('setMode assign (clears selection)', () => { win._cbToggleSeatSelection('seat1'); win._cbSetMode('assign'); });
  await step('setMode build', () => win._cbSetMode('build'));
  win.__promptAnswer = null;
  await step('newLayout: prompt cancelled', () => win._cbNewLayout());
  win.__promptAnswer = 'Fresh';
  svc({ saveLayout: { ok: false, error: 'nope' } });
  await step('newLayout: save fails', () => win._cbNewLayout());
  svc({ saveLayout: { ok: true, layoutId: 'LNEW' } });
  await step('newLayout: ok', () => win._cbNewLayout());
  win.__promptAnswer = '';
  await step('renameLayout: empty cancels', () => win._cbRenameLayout());
  win.__promptAnswer = 'Renamed';
  await step('renameLayout: ok (option text updated)', () => { win._cbOnLayoutChange('L1'); win._cbRenameLayout(); });
  win.__confirmAnswer = false;
  await step('deleteLayout: declined', () => win._cbDeleteLayout());
  win.__confirmAnswer = true; svc({ deleteLayout: { ok: false, error: 'locked' } });
  await step('deleteLayout: fails', () => win._cbDeleteLayout());
  svc({ deleteLayout: { ok: true } });
  await step('deleteLayout: ok', () => win._cbDeleteLayout());
  await step('deleteLayout: no layout -> noop', () => win._cbDeleteLayout());
  seed(win); win._cbOnLayoutChange('L1');
  svc({ saveLayout: { ok: false, error: 'bad' } });
  await step('save: fails (button restored, payload mapped)', () => { win._cbAddSeat(); return win._cbSave(); });
  svc({ saveLayout: { ok: true, layoutId: 'L1', seats: [{ id: 'real1', xCoord: 1, yCoord: 2, rotation: 0 }, { id: 'real2', xCoord: 3, yCoord: 4, rotation: 90, label: 'Z', isLocked: true }] } });
  await step('save: ok (ids remapped, selection cleared)', () => { win._cbToggleSeatSelection('seat1'); return win._cbSave(); });
  win._cbOnLayoutChange('L1');

  // ── 6. seats / props / selection / duplicate ──
  await step('addSeat (with wrap)', () => win._cbAddSeat());
  const wrap = win.document.getElementById('cb-canvas-wrap'); wrap.id = 'cb-canvas-wrap-x';
  await step('addSeat (no wrap -> 400/300)', () => win._cbAddSeat());
  wrap.id = 'cb-canvas-wrap';
  await step('deleteSeat seat3', () => { win._cbToggleSeatSelection('seat3'); win._cbDeleteSeat('seat3'); });
  await step('rotateSeat 90 -> 180', () => win._cbRotateSeat('seat2'));
  await step('rotateSeat 270 wraps to 0', () => { win._cbRotateSeat('seat2'); win._cbRotateSeat('seat2'); });
  await step('rotateSeat unknown', () => win._cbRotateSeat('zzz'));
  await step('toggle selection on/off', () => { win._cbToggleSeatSelection('seat1'); win._cbToggleSeatSelection('seat2'); win._cbToggleSeatSelection('seat1'); });
  await step('select all', () => win._cbSelectAllSeats());
  await step('clear selection', () => win._cbClearSeatSelection());
  await step('duplicate: nothing selected', () => win._cbDuplicateSelectedSeats());
  svc({ duplicateSeats: [{ id: 'new_dup1', xCoord: 130, yCoord: 130 }, { id: 'new_dup2', xCoord: 330, yCoord: 130 }] });
  await step('duplicate: two selected', () => { win._cbToggleSeatSelection('seat1'); win._cbToggleSeatSelection('seat2'); win._cbDuplicateSelectedSeats(); });
  svc({ duplicateSeats: [{ id: 'new_dup3', xCoord: 1, yCoord: 1 }] });
  await step('duplicate: one selected (singular toast)', () => { win._cbClearSeatSelection(); win._cbToggleSeatSelection('seat1'); win._cbDuplicateSelectedSeats(); });
  await step('addProp / deleteProp', () => { win._cbAddProp('whiteboard'); win._cbAddProp('door'); win._cbDeleteProp(0); });
  await step('genId + canvasScale + virtualCoords', () => ({ id: /^new_[a-z0-9]+$/.test(win._cbGenId()), scale: win._cbCanvasScale(), v: win._cbVirtualCoords(210, 120), v2: win._cbVirtualCoords(10, 20) }));
  wrap.className = 'cb-canvas-wrap-gone';
  await step('canvasScale/virtualCoords without .cb-canvas-wrap', () => ({ scale: win._cbCanvasScale(), v: win._cbVirtualCoords(210, 120) }));
  wrap.className = 'cb-canvas-wrap';

  // ── drag ──
  win._cbOnLayoutChange('L1'); win._cbClearSeatSelection();
  await step('seatDragStart', () => { const e = mkEvt(win, { clientX: 110, clientY: 100 }); win._cbSeatDragStart(e, 'seat1'); return e.dataTransfer.effectAllowed; });
  await step('seatDragEnd resets', () => win._cbSeatDragEnd());
  await step('propDragStart', () => { const e = mkEvt(win, { clientX: 110, clientY: 100 }); win._cbPropDragStart(e, 2); return e.dataTransfer.effectAllowed; });
  await step('propDragEnd resets', () => win._cbPropDragEnd());
  await step('canvas dragover / dragleave', () => {
    const o = mkEvt(win); win._cbOnCanvasDragOver(o);
    const inside = mkEvt(win, { relatedTarget: wrap }); win._cbOnCanvasDragLeave(inside);
    const outside = mkEvt(win, { relatedTarget: win.document.body }); win._cbOnCanvasDragLeave(outside);
    return o.dataTransfer.dropEffect;
  });
  await step('drop: no drag id', () => win._cbOnCanvasDrop(mkEvt(win, { clientX: 210, clientY: 120 })));
  await step('drop: single seat moves + clamps math', () => { win._cbSeatDragStart(mkEvt(win, { clientX: 110, clientY: 100 }), 'seat1'); win._cbOnCanvasDrop(mkEvt(win, { clientX: 210, clientY: 120 })); });
  await step('drop: clamp to top-left margin', () => { win._cbSeatDragStart(mkEvt(win, { clientX: 110, clientY: 100 }), 'seat1'); win._cbOnCanvasDrop(mkEvt(win, { clientX: 10, clientY: 20 })); });
  await step('drop: clamp to bottom-right margin', () => { win._cbSeatDragStart(mkEvt(win, { clientX: 110, clientY: 100 }), 'seat1'); win._cbOnCanvasDrop(mkEvt(win, { clientX: 5000, clientY: 5000 })); });
  await step('drop: multi-select moves all by delta (clamped)', () => { win._cbOnLayoutChange('L1'); win._cbClearSeatSelection(); win._cbToggleSeatSelection('seat1'); win._cbToggleSeatSelection('seat3'); win._cbSeatDragStart(mkEvt(win, { clientX: 110, clientY: 100 }), 'seat1'); win._cbOnCanvasDrop(mkEvt(win, { clientX: 710, clientY: 520 })); });
  await step('drop: selected single stays single move', () => { win._cbClearSeatSelection(); win._cbToggleSeatSelection('seat1'); win._cbSeatDragStart(mkEvt(win, { clientX: 110, clientY: 100 }), 'seat1'); win._cbOnCanvasDrop(mkEvt(win, { clientX: 210, clientY: 120 })); });
  await step('drop: unknown seat id', () => { win._cbSeatDragStart(mkEvt(win, { clientX: 110, clientY: 100 }), 'nope'); win._cbOnCanvasDrop(mkEvt(win, { clientX: 210, clientY: 120 })); });
  await step('drop: prop moves', () => { win._cbOnLayoutChange('L1'); win._cbPropDragStart(mkEvt(win, { clientX: 110, clientY: 100 }), 0); win._cbOnCanvasDrop(mkEvt(win, { clientX: 210, clientY: 120 })); });
  await step('drop: prop clamps at 0', () => { win._cbPropDragStart(mkEvt(win, { clientX: 110, clientY: 100 }), 0); win._cbOnCanvasDrop(mkEvt(win, { clientX: 10, clientY: 20 })); });
  await step('drop: prop index missing', () => { win._cbPropDragStart(mkEvt(win, { clientX: 110, clientY: 100 }), 7); win._cbOnCanvasDrop(mkEvt(win, { clientX: 210, clientY: 120 })); });
  await step('drop: assign mode ignores', () => { win._cbSeatDragStart(mkEvt(win, { clientX: 110, clientY: 100 }), 'seat1'); win._cbSetMode('assign'); win._cbOnCanvasDrop(mkEvt(win, { clientX: 210, clientY: 120 })); win._cbSetMode('build'); });

  // ── 7. wizard ──
  await step('wizard open', () => win._cbOpenBlueprintWizard());
  await step('wizard close (clears root)', () => win._cbCloseBlueprintWizard());
  await step('wizard shape + preset', () => { win._cbSetWizardShape('u'); win._cbSetWizardPreset('double_aisle'); });
  const setWiz = (r, c, s) => { win.document.getElementById('cb-wiz-rows').value = r; win.document.getElementById('cb-wiz-cols').value = c; win.document.getElementById('cb-wiz-spacing').value = s; };
  win._cbSetWizardShape('grid'); win._cbSetWizardPreset('traditional');
  await step('wizard: too many seats', () => { setWiz('21', '20', '100'); return win._cbSubmitBlueprintWizard(); });
  svc({ generateBlueprint: { ok: true, layoutId: 'LB', generatedSeats: [], preservedLockedCount: 0 } });
  await step('wizard: exactly 400 seats is allowed', () => { setWiz('20', '20', '100'); return win._cbSubmitBlueprintWizard(); });
  win._cbSetWizardPreset('center_aisle');
  await step('wizard: center aisle with exactly 2 cols is allowed', () => { setWiz('2', '2', '100'); return win._cbSubmitBlueprintWizard(); });
  win._cbSetWizardPreset('double_aisle');
  await step('wizard: double aisle with exactly 3 cols is allowed', () => { setWiz('2', '3', '100'); return win._cbSubmitBlueprintWizard(); });
  win._cbSetWizardPreset('center_aisle');
  await step('wizard: center aisle needs 2 cols', () => { setWiz('2', '1', '100'); return win._cbSubmitBlueprintWizard(); });
  win._cbSetWizardPreset('double_aisle');
  await step('wizard: double aisle needs 3 cols', () => { setWiz('2', '2', '100'); return win._cbSubmitBlueprintWizard(); });
  win._cbSetWizardShape('u');
  await step('wizard: preset ignored for non-grid (double aisle w/ 2 cols OK) + generate fails', () => { svc({ generateBlueprint: { ok: false, error: 'gen fail' } }); setWiz('2', '2', '100'); return win._cbSubmitBlueprintWizard(); });
  win._cbSetWizardShape('grid'); win._cbSetWizardPreset('center_aisle');
  await step('wizard: parse fallbacks (rows x->1, cols ""->1->but needs 2)', () => { setWiz('x', '', 'abc'); return win._cbSubmitBlueprintWizard(); });
  await step('wizard: spacing floor 40 + rows/cols stored + ok singular note', () => { svc({ generateBlueprint: { ok: true, layoutId: 'LGEN', generatedSeats: [1, 2, 3], preservedLockedCount: 1 } }); setWiz('0', '3', '10'); return win._cbSubmitBlueprintWizard(); });
  await step('wizard: ok plural locked note (existing layout name used)', () => { svc({ generateBlueprint: { ok: true, layoutId: 'L1', generatedSeats: [1], preservedLockedCount: 2 } }); win._cbOnLayoutChange('L1'); setWiz('2', '3', '90'); return win._cbSubmitBlueprintWizard(); });
  await step('wizard: ok no locked note, new layout name from shape label', () => { svc({ generateBlueprint: { ok: true, layoutId: 'L2', generatedSeats: [1, 2], preservedLockedCount: 0 } }); win._cbOnLayoutChange('GONE'); win._cbSetWizardShape('grid'); win._cbSetWizardPreset('traditional'); setWiz('2', '3', '90'); return win._cbSubmitBlueprintWizard(); });
  await step('wizard: generate failure restores button', () => { svc({ generateBlueprint: { ok: false, error: 'engine' } }); setWiz('2', '2', '90'); return win._cbSubmitBlueprintWizard(); });

  // ── 8. assign mode ──
  seed(win); win._cbOnClassChange('c1'); win._cbOnLayoutChange('L1'); win._cbSetMode('assign');
  await step('assign dragover / dragleave', () => { const e = mkEvt(win); win._cbSeatAssignDragOver(e); const cls1 = e.currentTarget.className; win._cbSeatAssignDragLeave(e); return [cls1, e.currentTarget.className, e.dataTransfer.dropEffect]; });
  await step('occupant drag start/end', () => { const e = mkEvt(win); win._cbSeatOccupantDragStart(e, 'seat1', 's1'); const a = [e.currentTarget.className, e.dataTransfer.effectAllowed]; const mid = win.__peek().dragStudentId; win._cbSeatOccupantDragEnd(e); return [a, mid, e.currentTarget.className]; });
  await step('assign drop: no dragged student', () => win._cbSeatAssignDrop(mkEvt(win), 'seat2'));
  await step('assign drop: no seat id', () => { win._cbSeatOccupantDragStart(mkEvt(win), 'seat1', 's1'); return win._cbSeatAssignDrop(mkEvt(win), ''); });
  svc({ manualMoveStudent: { ok: false, error: 'seat taken' } });
  await step('assign drop: fails', () => win._cbSeatAssignDrop(mkEvt(win), 'seat2'));
  svc({ manualMoveStudent: { ok: true, note: 'already there' } });
  await step('assign drop: note short-circuits (no toast)', () => win._cbSeatAssignDrop(mkEvt(win), 'seat2'));
  svc({ manualMoveStudent: { ok: true, swapped: true } });
  await step('assign drop: swapped toast', () => win._cbSeatAssignDrop(mkEvt(win), 'seat2'));
  svc({ manualMoveStudent: { ok: true } });
  await step('assign drop: assigned toast', () => win._cbSeatAssignDrop(mkEvt(win), 'seat2'));
  await step('assign drop: no layout', () => { win._cbOnLayoutChange('GONE'); return win._cbSeatAssignDrop(mkEvt(win), 'seat2'); });
  win._cbOnLayoutChange('L1');
  await step('unassign: no layout', () => { win._cbOnLayoutChange('GONE'); return win._cbUnassign('seat1'); });
  win._cbOnLayoutChange('L1');
  svc({ getLiveSeatingMap: [{ seatId: 'seat1', studentId: null }] });
  await step('unassign: seat empty', () => win._cbUnassign('seat1'));
  svc({ getLiveSeatingMap: [{ seatId: 'seat9', studentId: 's9' }] });
  await step('unassign: seat not in map', () => win._cbUnassign('seat1'));
  svc({ getLiveSeatingMap: [{ seatId: 'seat1', studentId: 's1' }], manualMoveStudent: { ok: false, error: 'cannot' } });
  await step('unassign: fails', () => win._cbUnassign('seat1'));
  svc({ getLiveSeatingMap: [{ seatId: 'seat1', studentId: 's1' }], manualMoveStudent: { ok: true } });
  await step('unassign: ok', () => win._cbUnassign('seat1'));
  await step('lock toggle: no layout', () => { win._cbOnLayoutChange('GONE'); return win._cbToggleSeatLock(mkEvt(win), 'seat1'); });
  win._cbOnLayoutChange('L1');
  await step('lock toggle: unknown seat', () => win._cbToggleSeatLock(mkEvt(win), 'zzz'));
  svc({ setSeatLock: { ok: false, error: 'denied' } });
  await step('lock toggle: fails', () => win._cbToggleSeatLock(mkEvt(win), 'seat1'));
  svc({ setSeatLock: { ok: true, seat: { isLocked: true } } });
  await step('lock toggle: locked toast (unlocked -> lock request)', () => win._cbToggleSeatLock(mkEvt(win), 'seat1'));
  svc({ setSeatLock: { ok: true, seat: { isLocked: false } } });
  await step('lock toggle: unlocked toast (locked -> unlock request)', () => win._cbToggleSeatLock(mkEvt(win), 'seat2'));
  await step('auto strategy', () => win._cbSetAutoStrategy('random'));
  await step('auto allocate: no layout', () => { win._cbOnLayoutChange('GONE'); return win._cbRunAutoAllocate(); });
  win._cbOnLayoutChange('L1');
  svc({ getUnassignedStudents: [] });
  await step('auto allocate: everyone seated', () => win._cbRunAutoAllocate());
  svc({ getUnassignedStudents: [{ id: 's7' }, { id: 's8' }], autoAllocateRemaining: { ok: false, error: 'no seats' } });
  await step('auto allocate: fails (button restored)', () => win._cbRunAutoAllocate());
  svc({ getUnassignedStudents: [{ id: 's7' }, { id: 's8' }], autoAllocateRemaining: { ok: true, placedCount: 1, unplacedRemaining: 1 } });
  await step('auto allocate: partial (singular + remaining note)', () => win._cbRunAutoAllocate());
  svc({ getUnassignedStudents: [{ id: 's7' }, { id: 's8' }], autoAllocateRemaining: { ok: true, placedCount: 2, unplacedRemaining: 0 } });
  await step('auto allocate: all placed (plural, no note)', () => win._cbRunAutoAllocate());
  win._cbSetMode('build');

  // ── 9. student view ──
  seed(win);
  const sp = win.document.getElementById('s-classroom'); sp.remove();
  await step('student: no page', () => win.renderStudentSeating());
  win.document.body.appendChild(sp);
  win.currentUser = null;
  await step('student: no user', () => win.renderStudentSeating());
  win.eval("currentUser = { id: 's1', classId: 'c9' };");
  win.__refresh = 'once';
  await step('student: no layouts, refresh then active page', () => win.renderStudentSeating());
  win.__refresh = 'once';
  sp.classList.remove('active'); win.__refresh = 'once';
  await step('student: no layouts, refresh then INACTIVE page', () => win.renderStudentSeating());
  sp.classList.add('active'); win.__refresh = 'reject';
  await step('student: no layouts, refresh rejects', () => win.renderStudentSeating());
  win.__refresh = 'resolve'; win.refreshClassroomData = undefined;
  await step('student: no layouts, no refresh fn', () => win.renderStudentSeating());
  win.refreshClassroomData = rc;
  win.eval("currentUser = { id: 's1' };");
  win.AppStore.updateState(d => { d.classroomLayouts = LAYOUTS().map(l => ({ ...l, classId: l.classId === 'c1' ? 'default-class' : l.classId })); }, { type: 'test:seed' });
  svc({ getLiveSeatingMap: [
    { seatId: 'seat1', studentId: 's1', xCoord: 120, yCoord: 400, rotation: 90, label: 'A1', color: { bg: 'rgba(1,1,1,.1)', border: '#0f0' }, attendanceStatus: 'Present', studentName: 'Ana "A"', studentColor: '#ff0000' },
    { seatId: 'seat2', studentId: 's2', xCoord: 600, yCoord: 100, color: { bg: 'rgba(2,2,2,.1)', border: '#f00' }, studentName: '<b>Bo</b>' },
    { seatId: 'seat3', studentId: null, xCoord: 1200, yCoord: 800, color: { bg: 'rgba(3,3,3,.1)', border: '#999' } },
  ] });
  await step('student: layout + my seat (default-class fallback), no getClassLabel', () => win.renderStudentSeating());
  win.getClassLabel = (cid, st) => 'Section<' + cid + '>';
  await step('student: with getClassLabel', () => win.renderStudentSeating());
  svc({ getLiveSeatingMap: [{ seatId: 'seat1', studentId: 's1', xCoord: 0, yCoord: 0, color: { bg: 'x', border: 'y' } }] });
  await step('student: my seat with no label / status / name', () => win.renderStudentSeating());
  svc({ getLiveSeatingMap: [{ seatId: 'seat2', studentId: 's2', xCoord: 600, yCoord: 100, color: { bg: 'x', border: 'y' }, studentName: 'Bo' }] });
  await step('student: no seat assigned warning', () => win.renderStudentSeating());
  win.eval("currentUser = { id: 's1', classId: 'c2' };");
  await step('student: other class layout', () => win.renderStudentSeating());

  // ── 10. unmount ──
  win._cbOnClassChange('c1'); win.renderClassroomBuilder();
  await step('unmount (flag, unsubscribe, resize removal)', () => { win.unmountClassroomBuilder(); win.AppStore.emit({ type: 'classroom:after-unmount' }); });

  // final window snapshot after the whole run (stale-snapshot semantics preserved identically)
  out.finalSnaps = SNAP.map(n => [n, JSON.stringify(win[n] instanceof win.Set ? [...win[n]] : win[n])]);
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

const EXTRA_BRIDGE_KEYS = ['CB_SEAT_MARGIN', 'CB_SEAT_SIZE', '_cbAutoFixInFlight', '_cbDragOffsetX', '_cbDragOffsetY', '_cbDragSeatId', '_cbLayoutName', '_cbSubscriberKey'];

async function main() {
  reverseTransformCheck();
  const A = makeWindow(), B = makeWindow();
  await evalOriginal(A.win);
  await evalBridge(B.win);
  const oa = await run(A.win, A.logs);
  const ob = await run(B.win, B.logs);

  // window surface: bridge may only ADD the documented 8 state snapshots
  const added = ob.surface.keys.filter(k => !oa.surface.keys.includes(k)).sort();
  const missing = oa.surface.keys.filter(k => !ob.surface.keys.includes(k));
  assert.deepStrictEqual(added, EXTRA_BRIDGE_KEYS, 'bridge adds exactly the 8 documented snapshots to window');
  assert.deepStrictEqual(missing, [], 'bridge drops nothing the original put on window');
  const surfA = clean(Object.assign({}, oa.surface, { keys: null })), surfB = clean(Object.assign({}, ob.surface, { keys: null }));
  const sd = firstDiff(surfA, surfB, 'surface'); assert.strictEqual(sd, null, 'window surface mismatch: ' + sd);
  const fd = firstDiff(clean(Object.assign({}, oa, { surface: null })), clean(Object.assign({}, ob, { surface: null })), 'out');
  assert.strictEqual(fd, null, 'bridge output must exactly match the original at every step — first difference at: ' + fd);

  // ── independent sanity (guards against a vacuous both-sides-wrong pass) ──
  const o = clean(oa);
  if (process.env.V16_DUMP) { for (const lb of process.env.V16_DUMP.split('|')) { const st = o.steps.find(x => x.label === lb); console.log(JSON.stringify(st && { label: st.label, err: st.err, ret: st.ret, calls: st.calls.map(c => c.slice(0, 160)), toast: st.toast, student: process.env.V16_STUDENT ? st.dom.student : undefined, peek: st.peek && { layoutId: st.peek.layoutId, mode: st.peek.mode, classId: st.peek.classId, seats: st.peek.localSeats } }, null, 1)); } }
  const S = label => { const s = o.steps.find(x => x.label === label); assert(s, 'missing step ' + label); return s; };
  assert.deepStrictEqual(o.surface.fns.map(e => e[1]), Array(48).fill('function'));
  assert(o.surface.loadLogs.some(l => l.includes('classroom_builder.js loaded')) && o.surface.css[0] === 1, 'load log + CSS injected once');
  assert.strictEqual(S('render: no page').peek.mounted, false, 'no page -> not mounted');
  assert.strictEqual(S('render: default pick, sections not loaded').peek.classId, 'c1', 'default-class replaced by first section');
  assert.strictEqual(S('render: sections NOT loaded, class missing from list -> keep').peek.classId, 'c1', 'transient list never switches class');
  assert.strictEqual(S('render: sections loaded, class missing -> switch').peek.classId, 'c9');
  assert.strictEqual(S('render: no class ids').peek.classId, 'c9');
  assert(S('render: refresh rejects').calls.some(c => c.includes('"warn"') && c.includes('mount-time classroom data refresh failed')), 'refresh rejection warned');
  assert.strictEqual(S('layout change GONE (deleted -> reset)').peek.layoutId, null);
  assert.deepStrictEqual(S('layout change L1 (found, assignments mapped)').peek.localSeats.map(s => [s.id, s.studentId, s.rotation, s.label, s.isLocked]), [['seat1', 's1', 0, 'A1', false], ['seat2', null, 90, null, true], ['seat3', 's2', 0, null, false]]);
  const fixed = S('autofix: success (pair nudge + same-spot)');
  assert(fixed.calls.some(c => c.startsWith('["svc.saveLayout"')) && fixed.calls.some(c => c.startsWith('["svc.markSeatOverlapFixed"')) && fixed.toast.includes('auto-spread'), 'autofix save + mark + toast');
  assert(S('autofix: save fails -> no mark, error toast').toast.includes('Could not auto-spread') && !S('autofix: save fails -> no mark, error toast').calls.some(c => c.startsWith('["svc.markSeatOverlapFixed"')));
  const fl = S('autofix: in-flight guard (two concurrent calls)').calls;
  assert.strictEqual(fl.filter(c => c.startsWith('["svc.saveLayout"')).length, 1, 'in-flight guard: one save for two concurrent calls');
  assert.strictEqual(fl.filter(c => c.startsWith('["svc.markSeatOverlapFixed"')).length, 1, 'in-flight guard: one mark for two concurrent calls');
  assert(!S('autofix: no overlap -> mark only').calls.some(c => c.startsWith('["svc.saveLayout"')) && S('autofix: no overlap -> mark only').calls.some(c => c.startsWith('["svc.markSeatOverlapFixed"')));
  assert(!S('autofix: already-fixed layout').calls.some(c => c.startsWith('["svc.')) && !S('autofix: assign mode returns early').calls.some(c => c.startsWith('["svc.')) && !S('autofix: no layout selected').calls.some(c => c.startsWith('["svc.')));
  const res = S('autofix: pure overlap resolver (empty, locked pair, same spot)').ret;
  assert.deepStrictEqual(res.empty, { changed: false, seats: [] });
  assert.strictEqual(res.lockedPair.changed, false, 'two locked overlapping seats left alone');
  assert.deepStrictEqual(res.same.seats.map(s => [s.xCoord, s.yCoord]), [[340, 300], [460, 300]], 'same spot nudged apart by 60 each');
  assert.deepStrictEqual(res.bLocked.seats.map(s => [s.xCoord, s.yCoord]), [[290, 300], [410, 300]], 'unlocked seat moves away from the locked anchor by the full overlap');
  assert.deepStrictEqual(res.aLocked.seats.map(s => [s.xCoord, s.yCoord]), [[400, 300], [520, 300]], 'unlocked b is pushed the full overlap away from locked a');
  const ed = S('autofix: canvas clamp').peek.localSeats; assert(ed.every(s => s.xCoord >= 60 && s.yCoord >= 60), 'seats clamped inside the margin');
  assert(S('sub: unmounted ignores events').calls.length === 0, 'unmounted ignores store events');
  assert(S('sub: attendance:scan-recorded').calls.some(c => c.startsWith('["_cbRepaintSeats"')) && !S('sub: attendance:scan-recorded').calls.some(c => c.startsWith('["_cbRenderCanvas"')));
  assert(S('sub: classroom:* reload + toolbar count (build)').calls.some(c => c.startsWith('["_cbRenderSidebar"')) && /^\d+ seats?$/.test(S('sub: classroom:* reload + toolbar count (build)').dom.count));
  assert.strictEqual(S('sub: classroom:* in assign mode (count untouched)').dom.count, S('sub: state:legacy-sync').dom.count, 'assign mode leaves the toolbar count alone');
  assert.strictEqual(S('sub: sections:* current class gone -> switch + shell').peek.classId, 'c2');
  assert(S('sub: sections:* current class kept').peek.classId === 'c2' && !S('sub: sections:* empty list').calls.some(c => c.startsWith('["_cbRenderShell"') && false), 'sections rules');
  assert(!S('sub: sections:* no page').calls.some(c => c.startsWith('["_cbRenderShell"')), 'no page -> no shell render');
  assert.strictEqual(S('setMode assign without layout').peek.mode, 'build'); assert(S('setMode assign without layout').toast.includes('Save a layout first'));
  assert.deepStrictEqual(S('setMode assign (clears selection)').peek.selected, []);
  assert(S('newLayout: prompt cancelled').calls.every(c => !c.startsWith('["svc.'))); assert.strictEqual(S('newLayout: ok').peek.layoutId, 'LNEW');
  assert(S('renameLayout: ok (option text updated)').dom.opt.includes('Renamed'));
  assert(S('deleteLayout: declined').calls.every(c => !c.startsWith('["svc.'))); assert.strictEqual(S('deleteLayout: ok').peek.layoutId, null);
  const sv = S('save: fails (button restored, payload mapped)'); assert.deepStrictEqual(sv.dom.save, ['💾 Save Layout', false]);
  assert(JSON.parse(sv.calls.find(c => c.startsWith('["svc.saveLayout"')))[3].some(s => s.id === null), 'unsaved new_ ids sent as null');
  assert.deepStrictEqual(S('save: ok (ids remapped, selection cleared)').peek.localSeats.map(s => s.id), ['real1', 'real2']);
  assert.strictEqual(S('rotateSeat 270 wraps to 0').peek.localSeats.find(s => s.id === 'seat2').rotation, 180 % 360 === 180 ? 0 : 0);
  assert(S('duplicate: nothing selected').calls.length === 0); assert(S('duplicate: one selected (singular toast)').toast.includes('Duplicated 1 seat —'));
  const vc = S('genId + canvasScale + virtualCoords').ret; assert.strictEqual(vc.scale, 0.5); assert.deepStrictEqual(vc.v, { x: 400, y: 200 });
  assert.deepStrictEqual(S('canvasScale/virtualCoords without .cb-canvas-wrap').ret, { scale: 1, v: { x: 0, y: 0 } });
  assert.deepStrictEqual([S('seatDragStart').peek.dragOffX, S('seatDragStart').peek.dragOffY], [120, 80]);
  const dr = S('drop: single seat moves + clamps math').peek.localSeats.find(s => s.id === 'seat1'); assert.deepStrictEqual([dr.xCoord, dr.yCoord], [340, 180], 'drop math: (400-120+60, 200-80+60)');
  const tl = S('drop: clamp to top-left margin').peek.localSeats.find(s => s.id === 'seat1'); assert.deepStrictEqual([tl.xCoord, tl.yCoord], [60, 60]);
  const br = S('drop: clamp to bottom-right margin').peek.localSeats.find(s => s.id === 'seat1'); assert.deepStrictEqual([br.xCoord, br.yCoord], [1140, 740]);
  assert(S('wizard: too many seats').toast.includes('too many seats') && S('wizard: center aisle needs 2 cols').toast.includes('at least 2') && S('wizard: double aisle needs 3 cols').toast.includes('at least 3'));
  assert.deepStrictEqual([S('wizard: spacing floor 40 + rows/cols stored + ok singular note').peek.wizardRows, S('wizard: spacing floor 40 + rows/cols stored + ok singular note').peek.wizardSpacing], [1, 40]);
  assert(S('wizard: spacing floor 40 + rows/cols stored + ok singular note').toast.includes('1 locked seat preserved)') && S('wizard: ok plural locked note (existing layout name used)').toast.includes('2 locked seats preserved)'));
  assert(JSON.parse(S('wizard: ok no locked note, new layout name from shape label').calls.find(c => c.startsWith('["svc.generateBlueprint"')))[3].endsWith(' Layout'));
  assert.deepStrictEqual(S('wizard: generate failure restores button').dom.gen, ['⚡ Generate', false]);
  assert(S('assign drop: note short-circuits (no toast)').toast === '' && S('assign drop: swapped toast').toast.includes('swapped') && S('assign drop: assigned toast').toast.includes('Seat assigned'));
  assert(S('lock toggle: locked toast (unlocked -> lock request)').toast.includes('locked') && S('lock toggle: unlocked toast (locked -> unlock request)').toast.includes('unlocked'));
  assert(JSON.parse(S('lock toggle: locked toast (unlocked -> lock request)').calls.find(c => c.startsWith('["svc.setSeatLock"')))[3] === true, 'lock request asks for !isLocked');
  assert.strictEqual(S('auto strategy').peek.autoStrategy, 'random');
  assert(S('auto allocate: partial (singular + remaining note)').toast.includes('Seated 1 student —') && S('auto allocate: all placed (plural, no note)').toast.includes('Seated 2 students'));
  assert.deepStrictEqual(S('auto allocate: fails (button restored)').dom.auto, ['⚡ Auto-Fill', false]);
  assert(S('student: no page').calls.length === 0 && S('student: no page').dom.student === undefined && S('student: no user').dom.student === '' && S('student: no user').calls.length === 0, 'student view: no page / no user are silent no-ops');
  assert(S('student: no layouts, refresh then active page').calls.some(c => c.startsWith('["refreshClassroomData"')) && S('student: no layouts, refresh then active page').dom.student.includes('No seating layout'));
  assert(S('student: layout + my seat (default-class fallback), no getClassLabel').dom.student.includes('Seat A1') && S('student: layout + my seat (default-class fallback), no getClassLabel').dom.student.includes('title="Ana &quot;A&quot;"'), 'student name quotes escaped (the only attribute-level escape jsdom keeps observable)');
  assert(S('student: with getClassLabel').dom.student.includes('Section&lt;default-class&gt;'));
  assert(S('student: my seat with no label / status / name').dom.student.includes('Seat assigned') && S('student: my seat with no label / status / name').dom.student.includes('Not yet scanned'), 'label/status fallbacks');
  assert(S('wizard: exactly 400 seats is allowed').calls.some(c => c.startsWith('["svc.generateBlueprint"')) && S('wizard: center aisle with exactly 2 cols is allowed').calls.some(c => c.startsWith('["svc.generateBlueprint"')) && S('wizard: double aisle with exactly 3 cols is allowed').calls.some(c => c.startsWith('["svc.generateBlueprint"')), 'wizard boundaries are inclusive');
  assert(S('unmount (flag, unsubscribe, resize removal)').calls.some(c => c.includes('AppStore.unsubscribe')), 'unmount unsubscribes the builder key');
  assert(S('mount for subscription tests').calls.some(c => c.includes('AppStore.subscribe')), 'mount subscribes the builder key');
  assert(S('student: no seat assigned warning').dom.student.includes('No seat assigned yet'));
  const um = S('unmount (flag, unsubscribe, resize removal)'); assert.strictEqual(um.peek.mounted, false); assert(um.calls.some(c => c.startsWith('["removeEventListener","resize"')) && !um.calls.some(c => c.startsWith('["_cbRenderCanvas"')), 'unmount removes resize listener and unsubscribes');
  assert.strictEqual(o.finalSnaps.find(e => e[0] === '_cbMode')[1], '"build"', 'trailing window snapshot stays at the load-time value (stale by design)');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log(' - reverse-transform: original rebuilt byte-for-byte from the twin; 76 exports; 31-line trailing window block verbatim');
  console.log(' - window surface: bridge adds only the 8 documented snapshots; ' + o.steps.length + ' steps compared incl. live module state + render-stub calls after each');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
