// Phase 7 (Stream D) — equivalence check for modules/seat-arrangement/classroom-builder-render.js.
//
// This is the INTEGRATION check for the builder <-> render pair: BOTH real files run on BOTH sides (no render
// stubs, unlike file 16's builder check). ORIGINAL side: infrastructure eval'd (repository/*, db-service,
// state-manager, dom, utils, classroom-service), then the classic render and builder loaded as <script>
// ELEMENTS in index.html order (render, then builder) so their top-level `let`s live in the real shared global
// lexical scope — exactly what the render file relies on to read the builder's state. BRIDGE side: one esbuild
// bundle of the REAL builder bridge + render bridge (the render twin imports the builder's live bindings);
// __peek() reads the builder twin's live state through the module namespace.
// Stubbed identically (bare/window): getActiveClassIds, getClassLabel (toggled), refreshClassroomData,
// prompt/confirm, requestAnimationFrame (recorder), ClassroomService methods (scripted; STATUS_COLORS stays
// real), geometry of .cb-canvas-wrap (prototype patch; flag for the zero-size self-heal path), a seeded
// Math.random reseeded per step, a pinned Date.
// Checked: 0 reverse-transform (keyword swaps + import block + the ONE documented chip-handler edit) + 7
// exports + 6-line trailing window block verbatim; 1 window surface (bridge may only ADD the builder's 8
// documented snapshots); 2 full render through renderClassroomBuilder (build mode: toolbar, count, selection
// block, seats, props, locked, empty state, legend, layouts/classes with and without getClassLabel; no layouts);
// 3 assign mode: roster (unassigned/assigned, log statuses, all-seated message, disabled auto button), seat
// view-models, lock buttons, occupant titles; 4 REAL DOM EVENTS on the generated elements — chip dragstart/
// dragend (the edited handlers: class, dataTransfer, live _cbDragStudentId), pool-zone dragover/leave/drop,
// seat/prop drag, shift-click selection, assign-mode dragover/leave/drop, occupant drag, click-unassign incl.
// the lock-button guard; 5 _cbRepaintSeats guards + updates; 6 _cbStudentChip; 7 wizard render (closed, grid
// presets, other shapes, locked-seat note singular/plural); 8 scale canvas incl. the zero-size rAF self-heal,
// missing canvas/wrap, resize listener wiring. After EVERY step the whole #a-classroom DOM, toast, recorded
// calls and the builder's live state are captured and compared.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function reverseTransformCheck() {
  const orig = read('modules/seat-arrangement/classroom-builder-render.js');
  const twin = read('src/modules/seat-arrangement/classroom-builder-render.js');
  const anchor = 'function _cbRenderShell(page, classIds, state) {';
  assert.strictEqual(orig.split(anchor).length, 2);
  const origHead = orig.slice(0, orig.indexOf(anchor));
  assert(twin.includes(origHead), 'twin carries the original header comment verbatim');
  const mid = twin.slice(twin.indexOf(origHead) + origHead.length, twin.indexOf('export ' + anchor));
  assert(/^import \{ AppStore \}[\s\S]*\} from '\.\/classroom_builder\.js';\n\n$/.test(mid), 'only the import block precedes the first original statement');
  const NEW_CHIP = `    chip.addEventListener('dragstart', e => {
      // TWIN EDIT (see header): an importer can't assign the builder's _cbDragStudentId, so delegate to the
      // builder's exported handler, which performs exactly the four original statements.
      _cbSeatOccupantDragStart(e, null, chip.dataset.studentId);
    });
    chip.addEventListener('dragend', e => {
      // TWIN EDIT (see header): same, for the two original dragend statements.
      _cbSeatOccupantDragEnd(e);
    });`;
  const ORIG_CHIP = `    chip.addEventListener('dragstart', e => {
      _cbDragStudentId = chip.dataset.studentId;
      chip.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', chip.dataset.studentId);
    });
    chip.addEventListener('dragend', () => {
      _cbDragStudentId = null;
      chip.classList.remove('dragging');
    });`;
  const body = twin.slice(twin.indexOf('export ' + anchor));
  assert.strictEqual(body.split(NEW_CHIP).length, 2, 'the documented chip-handler edit appears exactly once');
  const rebuilt = origHead + body.replace(NEW_CHIP, ORIG_CHIP).replace(/^export function /gm, 'function ');
  assert.strictEqual(rebuilt, orig, 'reversing the edits must reproduce the original byte-for-byte');
  assert.strictEqual((twin.match(/^export /gm) || []).length, 7, 'exactly 7 exports (declaresCount 7)');
  assert.strictEqual((twin.match(/^window\._cb\w+ = \w+;$/gm) || []).length, 6, 'original 6-line trailing window block kept verbatim');
}

const STARTER_HTML = `<!doctype html><html><body>
  <div id="a-classroom" class="active"></div>
  <div id="toast"></div>
</body></html>`;
const FIXED = 1767225600000;
const PEEK_SCRIPT = `
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
function runScript(win, code) {
  const s = win.document.createElement('script');
  s.textContent = code;
  win.document.body.appendChild(s);
  if (win.__scriptErrors.length) throw new Error('script error: ' + win.__scriptErrors.splice(0).join(' | '));
}
function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  win.__scriptErrors = [];
  win.addEventListener('error', e => win.__scriptErrors.push(e.message));
  win.eval(`(function(){ const R = Date; class D extends R { constructor(...a){ if (a.length) super(...a); else super(${FIXED}); } static now(){ return ${FIXED}; } } globalThis.Date = D; }());`);
  win.eval("globalThis.__rnd = { s: 424242 }; Math.random = function () { __rnd.s = (__rnd.s * 1103515245 + 12345) & 0x7fffffff; return __rnd.s / 0x7fffffff; };");
  win.eval("currentUser = { id: 't1' }; currentRole = 'teacher';");
  win.DEFAULT_DB = { classroomLayouts: [], seats: [], seatAssignments: [], classSections: [], students: [], attendanceLogs: [], recitationLog: [], pointLog: [] };
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };
  win.__rpcCalls = []; win.__rpcMock = {};
  const mockClient = { auth: { getSession: async () => ({ data: { session: null } }) }, rpc: async (name, params) => { win.__rpcCalls.push({ name, params }); const e = win.__rpcMock[name]; if (typeof e === 'function') return e(params); if (e) return e; throw new Error('unmocked rpc: ' + name); } };
  win.SupabaseClient = { getClient: () => mockClient, resolveProvider: () => 'supabase' };
  win.__EDUQUEST_SUPABASE_URL__ = ''; win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };

  // geometry of the (real, generated) canvas wrapper — a prototype patch because the real shell creates the element
  win.__zeroWrap = false;
  const isWrap = el => el && el.classList && el.classList.contains('cb-canvas-wrap');
  Object.defineProperty(win.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return isWrap(this) && !win.__zeroWrap ? 600 : 0; } });
  Object.defineProperty(win.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return isWrap(this) && !win.__zeroWrap ? 400 : 0; } });
  win.Element.prototype.getBoundingClientRect = function () { return isWrap(this) ? { left: 10, top: 20, width: 600, height: 400, right: 610, bottom: 420 } : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; };

  win.__calls = []; win.__rafs = []; win.__classIds = ['c1', 'c2']; win.__confirmAnswer = true; win.__promptAnswer = null; win.__svc = {};
  const jsonArg = a => (a && a.nodeType ? '<' + (a.id || a.nodeName) + '>' : typeof a === 'function' ? '<fn>' : a === undefined ? '<undef>' : a);
  const rec = (name, ret) => (...args) => { win.__calls.push(JSON.stringify([name, ...args.map(jsonArg)])); return ret ? ret(...args) : undefined; };
  win.getActiveClassIds = rec('getActiveClassIds', () => win.__classIds.slice());
  win.refreshClassroomData = rec('refreshClassroomData', () => Promise.resolve());
  win.prompt = rec('prompt', () => win.__promptAnswer); win.confirm = rec('confirm', () => win.__confirmAnswer);
  win.requestAnimationFrame = fn => { win.__rafs.push(fn); win.__calls.push('["requestAnimationFrame"]'); return win.__rafs.length; };
  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  win.console.warn = (...a) => win.__calls.push(JSON.stringify(['warn', ...a.map(String)]));
  win.console.error = (...a) => win.__calls.push(JSON.stringify(['error', ...a.map(String)]));
  const origAdd = win.addEventListener.bind(win), origRemove = win.removeEventListener.bind(win);
  win.__resize = 0;
  win.addEventListener = (t, f, o) => { if (t === 'resize') { win.__resize++; win.__calls.push('["addEventListener","resize"]'); } return origAdd(t, f, o); };
  win.removeEventListener = (t, f, o) => { if (t === 'resize') win.__calls.push(JSON.stringify(['removeEventListener', 'resize', f === win._cbScaleCanvas])); return origRemove(t, f, o); };
  return { win, logs };
}
// Safe defaults for every service method: inline onclick handlers in the generated HTML (lock button, etc.) can reach
// the builder's async controllers, and an unscripted `undefined` result would become an unhandled rejection.
const SVC_DEFAULTS = {
  saveLayout: { ok: true, layoutId: 'L1', seats: [] }, markSeatOverlapFixed: { ok: true }, deleteLayout: { ok: true },
  generateBlueprint: { ok: true, layoutId: 'L1', generatedSeats: [], preservedLockedCount: 0 }, manualMoveStudent: { ok: true },
  setSeatLock: { ok: true, seat: { isLocked: true } }, getLiveSeatingMap: [], getUnassignedStudents: [],
  autoAllocateRemaining: { ok: true, placedCount: 0, unplacedRemaining: 0 }, duplicateSeats: [],
};
function patchService(win) {
  const svc = win.ClassroomService;
  for (const m of ['saveLayout', 'markSeatOverlapFixed', 'deleteLayout', 'generateBlueprint', 'manualMoveStudent', 'setSeatLock', 'getLiveSeatingMap', 'getUnassignedStudents', 'autoAllocateRemaining', 'duplicateSeats']) {
    svc[m] = (...args) => {
      win.__calls.push(JSON.stringify(['svc.' + m, ...args.map(a => (a && a.nodeType ? '<el>' : a))]));
      const r = (m in win.__svc) ? win.__svc[m] : SVC_DEFAULTS[m];
      return typeof r === 'function' ? r(...args) : (r && typeof r === 'object' ? JSON.parse(JSON.stringify(r)) : r);
    };
  }
}
async function evalOriginal(win) {
  for (const f of ['utils.js', 'repository/table-sync.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'db-service.js', 'modules/core/state-manager.js', 'dom.js', 'modules/seat-arrangement/classroom-service.js']) win.eval(read(f));
  runScript(win, read('modules/seat-arrangement/classroom-builder-render.js'));
  runScript(win, read('modules/seat-arrangement/classroom_builder.js'));
  runScript(win, PEEK_SCRIPT);
  patchService(win);
  await win.AppStore.ready;
}
async function evalBridge(win) {
  runScript(win, fs.readFileSync(path.join(__dirname, 'test-helpers', 'classroom-builder-render-combined-bundle.js'), 'utf8'));
  patchService(win);
  await win.AppStore.ready;
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v).replace(ISO, '<ISO>'));
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const $ = (win, sel) => win.document.querySelector(sel);
const $$ = (win, sel) => [...win.document.querySelectorAll(sel)];

const LAYOUTS = () => ([
  { id: 'L1', classId: 'c1', name: 'Main <room>', roomData: [{ type: 'teacher-desk', x: 100, y: 40, rotation: 0 }, { type: 'whiteboard', x: 600, y: 40, rotation: 90 }], seatOverlapFixed: true },
  { id: 'L2', classId: 'c1', name: 'Empty', seatOverlapFixed: true },
  { id: 'L3', classId: 'c2', name: 'Other', seatOverlapFixed: true },
]);
const SEATS = () => ([
  { id: 'seat1', layoutId: 'L1', xCoord: 100, yCoord: 100, label: 'A<1>' },
  { id: 'seat2', layoutId: 'L1', xCoord: 300, yCoord: 100, rotation: 90, isLocked: true },
  { id: 'seat3', layoutId: 'L1', xCoord: 500, yCoord: 100 },
]);
const ASSIGNS = () => ([{ layoutId: 'L1', seatId: 'seat1', studentId: 's1' }, { layoutId: 'L1', seatId: 'seat3', studentId: 's2' }]);
const STUDENTS = () => ([
  { id: 's1', name: 'Ana', classId: 'c1' }, { id: 's2', name: 'Ben <b>', classId: 'c1' }, { id: 's3', name: 'Cy', classId: 'c1' },
  { id: 's4', name: 'Di' }, { id: 's5', name: 'Eve', classId: 'c1' },
]);
const LOGS = () => ([
  { classId: 'c1', logDate: '2026-01-01', studentId: 's1', status: 'present' },
  { classId: 'c1', logDate: '2026-01-01', studentId: 's3', status: 'late' },
  { classId: 'c1', logDate: '2025-12-31', studentId: 's5', status: 'absent' },
  { classId: 'c9', logDate: '2026-01-01', studentId: 's5', status: 'present' },
]);
const VMS = () => ([
  { seatId: 'seat1', studentId: 's1', studentName: 'Ana', studentColor: '#ff0000', studentInit: 'A', attendanceStatus: 'present', color: { bg: 'rgba(0,255,0,.1)', border: '#0f0' }, isLocked: false },
  { seatId: 'seat2', color: { bg: 'rgba(9,9,9,.1)', border: '#999' }, isLocked: true },
  { seatId: 'seat3', studentId: 's2', color: { bg: 'rgba(1,2,3,.1)', border: '#123' }, isLocked: false },
]);
function seed(win, extra) {
  win.AppStore.updateState(d => { d.classroomLayouts = LAYOUTS(); d.seats = SEATS(); d.seatAssignments = ASSIGNS(); d.students = STUDENTS(); d.attendanceLogs = LOGS(); d.classSections = []; Object.assign(d, extra || {}); }, { type: 'test:seed' });
}
function mkDT(win) {
  return { effectAllowed: '', dropEffect: '', setDragImage() { win.__calls.push('["setDragImage"]'); }, setData(k, v) { win.__calls.push(JSON.stringify(['setData', k, v])); } };
}
function fire(win, el, type, props) {
  const ev = new win.Event(type, { bubbles: true, cancelable: true });
  const dt = mkDT(win);
  Object.defineProperty(ev, 'dataTransfer', { value: dt });
  for (const [k, v] of Object.entries(props || {})) Object.defineProperty(ev, k, { value: v });
  el.dispatchEvent(ev);
  return { prevented: ev.defaultPrevented, eff: dt.effectAllowed, drop: dt.dropEffect };
}

async function run(win, logs) {
  const out = { steps: [] };
  const root = () => win.document.getElementById('a-classroom');
  const step = async (label, fn) => {
    win.__rnd.s = 424242; win.__calls.length = 0; win.__rafs.length = 0;
    $(win, '#toast').innerHTML = '';
    let err = null, ret;
    try { ret = await fn(); } catch (e) { err = String(e && e.message); }
    await tick();
    // body counts non-script children only: the two sides load code through different numbers of <script> elements
    out.steps.push({ label, err, ret, calls: win.__calls.slice(), toast: $(win, '#toast').innerHTML, rafs: win.__rafs.length, page: root().innerHTML, body: [...win.document.body.children].filter(c => c.tagName !== 'SCRIPT').length, peek: JSON.parse(JSON.stringify(win.__peek())) });
  };
  const svc = o => { win.__svc = o; };
  const FNS = ['_cbRenderShell', '_cbScaleCanvas', '_cbRenderCanvas', '_cbRepaintSeats', '_cbRenderSidebar', '_cbStudentChip', '_cbRenderWizard', 'renderClassroomBuilder', '_cbSetMode', '_cbOnClassChange', '_cbOnLayoutChange', '_cbOpenBlueprintWizard', '_cbCloseBlueprintWizard', '_cbSetWizardShape', '_cbSetWizardPreset', '_cbToggleSeatSelection', '_cbAddSeat', '_cbAddProp', '_cbLoadState'];
  out.surface = {
    fns: FNS.map(n => [n, typeof win[n]]),
    keys: Object.keys(win).filter(k => /^(_cb|CB_|renderClassroomBuilder|renderStudentSeating|unmountClassroomBuilder)/.test(k)).sort(),
    trailing: ['_cbRenderCanvas', '_cbRenderShell', '_cbRepaintSeats', '_cbRenderSidebar', '_cbScaleCanvas', '_cbRenderWizard'].map(n => win[n] === win[n] && typeof win[n]),
    loadLogs: logs.slice(),
  };
  seed(win); svc({ getLiveSeatingMap: VMS });
  delete win.getClassLabel;

  // ── 2. build mode via the real entry point ──
  await step('build: first render (no getClassLabel)', () => win.renderClassroomBuilder());
  win.getClassLabel = (c, st) => 'Sec <' + c + '> ' + (st && st.classroomLayouts ? st.classroomLayouts.length : '?');
  await step('build: re-render with getClassLabel', () => win.renderClassroomBuilder());
  await step('build: layout without seats/props shows the empty state', () => { win._cbOnLayoutChange('L2'); });
  await step('build: back to the populated layout + select a seat (selection toolbar block)', () => { win._cbOnLayoutChange('L1'); win._cbToggleSeatSelection('seat1'); });
  await step('build: two seats selected', () => { win._cbToggleSeatSelection('seat3'); });
  await step('build: seat added (count + canvas)', () => { win._cbClearSeatSelection(); win._cbAddSeat(); });
  await step('build: props added', () => { win._cbAddProp('whiteboard'); win._cbAddProp('door'); });
  await step('build: class with no layouts', () => { win._cbOnClassChange('c9'); });
  await step('build: class c2 layout', () => { win._cbOnLayoutChange('L3'); });
  win._cbOnClassChange('c1'); win._cbOnLayoutChange('L1'); win.AppStore.updateState(() => {}, { type: 'test:noop' });

  // ── 3. assign mode ──
  await step('assign: roster + seat view-models', () => win._cbSetMode('assign'));
  await step('assign: everyone seated -> all-seated message, auto button disabled', () => { seed(win, { seatAssignments: [...ASSIGNS(), { layoutId: 'L1', seatId: 'seat2', studentId: 's3' }, { layoutId: 'L1', seatId: 'x', studentId: 's5' }] }); win._cbLoadState(); win._cbRenderSidebar(); });
  seed(win); win._cbLoadState();
  await step('assign: back to default roster', () => { win._cbRenderSidebar(); });
  await step('assign: random auto strategy selected', () => { win._cbSetAutoStrategy('random'); win._cbRenderSidebar(); });
  await step('assign: alphabetical strategy', () => { win._cbSetAutoStrategy('alphabetical'); win._cbRenderSidebar(); });
  await step('assign: no layout selected', () => { win._cbOnLayoutChange('GONE'); win._cbRenderCanvas(); });
  win._cbOnLayoutChange('L1');

  // ── 4. real DOM events ──
  const chips = () => $$(win, '.cb-student-chip[draggable="true"]');
  await step('chip dragstart (edited handler): class, dataTransfer, live _cbDragStudentId', () => {
    const c = chips()[0]; const r = fire(win, c, 'dragstart');
    return [r.eff, c.classList.contains('dragging'), win.__peek().dragStudentId, c.dataset.studentId];
  });
  await step('pool zone dragover / dragleave', () => {
    const z = $(win, '#cb-pool-zone'); const o = fire(win, z, 'dragover'); const a = z.classList.contains('drag-over'); fire(win, z, 'dragleave'); return [o.prevented, o.drop, a, z.classList.contains('drag-over')];
  });
  svc({ getLiveSeatingMap: VMS, manualMoveStudent: { ok: false, error: 'seat taken' } });
  await step('pool zone drop while a chip is being dragged -> manualMoveStudent(student, null, layout) fails', () => fire(win, $(win, '#cb-pool-zone'), 'drop').prevented);
  svc({ getLiveSeatingMap: VMS, manualMoveStudent: { ok: true } });
  await step('pool zone drop ok', () => fire(win, $(win, '#cb-pool-zone'), 'drop').prevented);
  await step('chip dragend clears the live _cbDragStudentId + class', () => { const c = chips()[0]; fire(win, c, 'dragend'); return [win.__peek().dragStudentId, c.classList.contains('dragging')]; });
  await step('pool zone drop with no dragged student -> ignored', () => fire(win, $(win, '#cb-pool-zone'), 'drop').prevented);
  await step('pool zone drop with no layout -> ignored', () => { chips()[0] && fire(win, chips()[0], 'dragstart'); win._cbOnLayoutChange('GONE'); const z = $(win, '#cb-pool-zone'); const r = z ? fire(win, z, 'drop').prevented : 'no-zone'; win._cbOnLayoutChange('L1'); return r; });
  await step('assign seat events: dragover/dragleave on an occupied seat', () => {
    const s = $(win, '.cb-seat[data-seat-id="seat1"]'); const o = fire(win, s, 'dragover'); const a = s.className; fire(win, s, 'dragleave'); return [o.drop, a, s.className];
  });
  await step('occupied seat: dragstart/dragend (occupant handlers)', () => {
    const s = $(win, '.cb-seat[data-seat-id="seat1"]'); const st = fire(win, s, 'dragstart'); const mid = [s.className, win.__peek().dragStudentId]; fire(win, s, 'dragend'); return [st.eff, mid, s.className, win.__peek().dragStudentId];
  });
  svc({ getLiveSeatingMap: VMS, manualMoveStudent: { ok: true } });
  await step('seat drop (assign) with a chip being dragged', () => { fire(win, chips()[0], 'dragstart'); fire(win, $(win, '.cb-seat[data-seat-id="seat2"]'), 'drop'); });
  svc({ getLiveSeatingMap: () => [{ seatId: 'seat1', studentId: 's1', color: { bg: 'x', border: 'y' } }], manualMoveStudent: { ok: true } });
  await step('click occupied seat -> unassign; click on the lock button is ignored', () => {
    const s = $(win, '.cb-seat[data-seat-id="seat1"]'); s.click();
    const lock = s.querySelector('.cb-lock-btn'); lock && lock.click();
  });
  svc({ getLiveSeatingMap: VMS });
  await step('empty seat has no click/dragstart wiring', () => { const s = $(win, '.cb-seat[data-seat-id="seat2"]'); s.click(); fire(win, s, 'dragstart'); return s.draggable; });
  win._cbSetMode('build');
  await step('build seat: dragstart / dragend (seat drag handlers)', () => {
    const s = $(win, '.cb-seat[data-seat-id="seat1"]'); const r = fire(win, s, 'dragstart', { clientX: 110, clientY: 100 }); const a = win.__peek().dragSeatId; fire(win, s, 'dragend'); return [r.eff, a, win.__peek().dragSeatId, s.draggable];
  });
  await step('build seat: plain click is a no-op, shift-click toggles selection', () => {
    const s = $(win, '.cb-seat[data-seat-id="seat3"]'); s.click(); const a = win.__peek().selected.slice();
    const ev = new win.Event('click', { bubbles: true, cancelable: true }); Object.defineProperty(ev, 'shiftKey', { value: true }); s.dispatchEvent(ev); return [a, win.__peek().selected];
  });
  await step('build prop: dragstart / dragend', () => {
    const p = $(win, '.cb-prop[data-prop-idx="0"]'); const r = fire(win, p, 'dragstart', { clientX: 20, clientY: 30 }); const a = win.__peek().dragSeatId; fire(win, p, 'dragend'); return [r.eff, a, win.__peek().dragSeatId, p.draggable];
  });
  await step('assign mode props/seats are not draggable', () => { win._cbSetMode('assign'); return [$(win, '.cb-prop[data-prop-idx="0"]').draggable, $(win, '.cb-seat[data-seat-id="seat2"]').draggable]; });
  win._cbSetMode('build');

  // ── 5. repaint ──
  const vms2 = () => [{ seatId: 'seat1', studentId: 's1', attendanceStatus: 'late', color: { bg: 'rgba(7,7,7,.1)', border: '#777' }, isLocked: true }, { seatId: 'seat2', color: { bg: 'rgba(8,8,8,.1)', border: '#888' }, isLocked: false }, { seatId: 'gone', color: { bg: 'z', border: 'z' } }];
  svc({ getLiveSeatingMap: vms2 });
  await step('repaint: colours + status text (build mode, no sidebar re-render)', () => win._cbRepaintSeats());
  await step('repaint: assign mode also re-renders the roster', () => { svc({ getLiveSeatingMap: VMS }); win._cbSetMode('assign'); svc({ getLiveSeatingMap: vms2 }); win._cbRepaintSeats(); });
  await step('repaint: vm without colour falls back to the _empty colour', () => { svc({ getLiveSeatingMap: () => [{ seatId: 'seat1' }] }); win._cbRepaintSeats(); });
  await step('repaint: guard — no layout', () => { svc({ getLiveSeatingMap: vms2 }); win._cbOnLayoutChange('GONE'); win._cbRepaintSeats(); });
  win._cbOnLayoutChange('L1'); win._cbSetMode('build'); svc({ getLiveSeatingMap: VMS });
  await step('repaint: guard — not mounted', () => { win.unmountClassroomBuilder(); win._cbRepaintSeats(); win.renderClassroomBuilder(); });

  // ── 6. student chip ──
  const chip = (s, assigned, log) => win._cbStudentChip(s, assigned, log);
  await step('student chip variants', () => [chip({ id: 's<1>', name: 'A "B"' }, false, null), chip({ id: 's2', name: 'Bo' }, true, null), chip({ id: 's3', name: 'Cy' }, false, { status: 'late' }), chip({ id: 's4', name: 'Di' }, true, { status: 'present' })]);

  // ── 7. wizard ──
  await step('wizard closed -> modal root emptied', () => { win._cbRenderWizard(); return $(win, '#cb-modal-root').innerHTML; });
  await step('wizard open (grid, traditional, 1 locked seat)', () => win._cbOpenBlueprintWizard());
  for (const [label, preset] of [['center_aisle', 'center_aisle'], ['double_aisle', 'double_aisle']]) await step('wizard preset ' + label, () => win._cbSetWizardPreset(preset));
  for (const shape of win.CB_SHAPE_TYPES.map(t => t.shape).filter(x => x !== 'grid')) await step('wizard shape ' + shape, () => win._cbSetWizardShape(shape));
  out.shapes = win.CB_SHAPE_TYPES.map(t => t.shape);
  await step('wizard: unknown shape throws identically (no matching CB_SHAPE_TYPES entry)', () => win._cbSetWizardShape('hexagon-zzz'));
  await step('wizard shape grid again', () => win._cbSetWizardShape('grid'));
  await step('wizard: plural locked note', () => { win.AppStore.updateState(d => { d.seats.find(s => s.id === 'seat1').isLocked = true; }, { type: 'test:seed' }); win._cbLoadState(); win._cbRenderWizard(); });
  await step('wizard: no locked seats note', () => { win.AppStore.updateState(d => { d.seats.forEach(s => { s.isLocked = false; }); }, { type: 'test:seed' }); win._cbLoadState(); win._cbRenderWizard(); });
  await step('wizard: no modal root element', () => { const r = $(win, '#cb-modal-root'); r.id = 'x'; win._cbRenderWizard(); r.id = 'cb-modal-root'; });
  await step('wizard closed again', () => win._cbCloseBlueprintWizard());

  // ── 8. scale canvas ──
  await step('scale: normal (sets transform from the live scale)', () => { win._cbScaleCanvas(); const c = $(win, '#cb-canvas'); return [c.style.width, c.style.height, c.style.transform]; });
  await step('scale: zero-size wrapper -> retries on the next frame, commits nothing', () => { const c = $(win, '#cb-canvas'); c.style.transform = ''; win.__zeroWrap = true; win._cbScaleCanvas(); const r = [c.style.transform, win.__rafs.length]; win.__zeroWrap = false; return r; });
  await step('scale: rAF callback is the same function and heals once laid out', () => { win.__zeroWrap = true; win._cbScaleCanvas(); win.__zeroWrap = false; const f = win.__rafs[0]; f(); return [f === win._cbScaleCanvas, $(win, '#cb-canvas').style.transform]; });
  await step('scale: no canvas / no wrap', () => { const c = $(win, '#cb-canvas'); c.id = 'x'; win._cbScaleCanvas(); c.id = 'cb-canvas'; const w = $(win, '#cb-canvas-wrap'); w.id = 'y'; win._cbScaleCanvas(); w.id = 'cb-canvas-wrap'; });
  await step('render canvas / sidebar without their elements', () => { const c = $(win, '#cb-canvas'); c.id = 'x'; win._cbRenderCanvas(); c.id = 'cb-canvas'; const s = $(win, '#cb-sidebar'); s.id = 'y'; win._cbRenderSidebar(); s.id = 'cb-sidebar'; });
  await step('shell wires the resize listener; unmount removes the same function', () => { win.renderClassroomBuilder(); win.unmountClassroomBuilder(); return win.__resize; });
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
  const oa = await run(A.win, A.logs), ob = await run(B.win, B.logs);
  const added = ob.surface.keys.filter(k => !oa.surface.keys.includes(k)).sort();
  const missing = oa.surface.keys.filter(k => !ob.surface.keys.includes(k));
  assert.deepStrictEqual(added, EXTRA_BRIDGE_KEYS, 'bridge adds exactly the builder\'s 8 documented snapshots to window');
  assert.deepStrictEqual(missing, [], 'bridge drops nothing the original put on window');
  const fd = firstDiff(clean(Object.assign({}, oa, { surface: Object.assign({}, oa.surface, { keys: null }) })), clean(Object.assign({}, ob, { surface: Object.assign({}, ob.surface, { keys: null }) })), 'out');
  assert.strictEqual(fd, null, 'bridge output must exactly match the original at every step — first difference at: ' + fd);

  // ── independent sanity (guards against a vacuous both-sides-wrong pass) ──
  const o = clean(oa);
  const S = label => { const s = o.steps.find(x => x.label === label); assert(s, 'missing step ' + label); return s; };
  assert.deepStrictEqual(o.surface.fns.map(e => e[1]), Array(19).fill('function'));
  const first = S('build: first render (no getClassLabel)');
  assert(first.page.includes('cb-canvas-wrap') && first.page.includes('3 seats') && first.page.includes('Duplicate Selected'), 'build shell: count + duplicate button');
  assert(first.page.includes('Main &lt;room&gt;') && first.page.includes('>Empty<'), 'layout options (escaped)');
  assert(first.page.includes('class="cb-seat') && first.page.includes('A&lt;1&gt;'), 'seats rendered with escaped labels');
  assert((first.page.match(/class="cb-prop"/g) || []).length === 2, 'two props rendered');
  assert(S('build: re-render with getClassLabel').page.includes('Sec &lt;c1&gt; 3'), 'class label via window.getClassLabel(c, state)');
  const emp = S('build: layout without seats/props shows the empty state'); assert(!/class="cb-seat[ "]/.test(emp.page) && !/class="cb-prop"/.test(emp.page) && /id="cb-empty"[^>]*display:\s*flex/.test(emp.page), 'empty layout: no seats/props on the canvas, empty state shown');
  assert.deepStrictEqual(S('build: two seats selected').peek.selected, ['seat1', 'seat3']);
  assert(S('build: two seats selected').page.includes('selected'), 'selected class on seats');
  assert(S('build: class with no layouts').page.includes('No layouts yet'), 'no-layouts option');
  const as = S('assign: roster + seat view-models').page;
  assert(as.includes('2 unseated') && as.includes('Not yet scanned') && as.includes('late'), 'assign roster: unassigned count and today-only log statuses');
  assert(as.includes('Ben &lt;b&gt;') && !as.includes('Ben <b>'), 'student names escaped in the roster');
  assert(S('assign: everyone seated -> all-seated message, auto button disabled').page.includes('All students are seated') && /id="cb-auto-btn"[\s\S]{0,300}disabled/.test(S('assign: everyone seated -> all-seated message, auto button disabled').page), 'all seated + disabled auto button');
  const cd = S('chip dragstart (edited handler): class, dataTransfer, live _cbDragStudentId');
  assert.deepStrictEqual(cd.ret.slice(0, 2), ['move', true]); assert.strictEqual(cd.ret[2], cd.ret[3]); assert.strictEqual(cd.peek.dragStudentId, cd.ret[3]);
  assert(cd.calls.some(c => c.startsWith('["setData","text/plain"')), 'dataTransfer.setData called');
  assert.deepStrictEqual(S('chip dragend clears the live _cbDragStudentId + class').ret, [null, false]);
  assert.deepStrictEqual(S('pool zone dragover / dragleave').ret, [true, 'move', true, false]);
  const pf = S('pool zone drop while a chip is being dragged -> manualMoveStudent(student, null, layout) fails');
  assert(pf.calls.some(c => c.startsWith('["svc.manualMoveStudent"') && c.includes(',null,"L1"')) && pf.toast.includes('seat taken'), 'pool drop calls manualMoveStudent(id, null, layout); failure toast');
  assert(S('pool zone drop ok').toast.includes('Returned to unassigned pool'));
  assert(!S('pool zone drop with no dragged student -> ignored').calls.some(c => c.startsWith('["svc.manualMoveStudent"')));
  assert(S('occupied seat: dragstart/dragend (occupant handlers)').ret[3] === null, 'occupant dragend clears');
  assert(S('click occupied seat -> unassign; click on the lock button is ignored').calls.filter(c => c.startsWith('["svc.manualMoveStudent"')).length === 1, 'seat click unassigns once; lock-button click ignored');
  assert.strictEqual(S('empty seat has no click/dragstart wiring').ret, false);
  assert.deepStrictEqual(S('build seat: plain click is a no-op, shift-click toggles selection').ret, [[], ['seat3']]);
  assert.deepStrictEqual(S('build prop: dragstart / dragend').ret.slice(1, 3), ['__prop__0', null]);
  assert.deepStrictEqual(S('assign mode props/seats are not draggable').ret, [false, false]);
  assert(S('repaint: colours + status text (build mode, no sidebar re-render)').page.includes('rgba(7, 7, 7, 0.1)'), 'repaint applied the new colour');
  assert.strictEqual(S('repaint: guard — no layout').calls.filter(c => c.startsWith('["svc.getLiveSeatingMap"')).length, 0, 'no layout -> repaint never asks the service');
  assert(S('repaint: colours + status text (build mode, no sidebar re-render)').calls.filter(c => c.startsWith('["svc.getLiveSeatingMap"')).length === 1, 'repaint asks the service exactly once');
  assert(S('student chip variants').ret[0].includes('s&lt;1&gt;') && S('student chip variants').ret[2].includes('late') && S('student chip variants').ret[1].includes('Already seated'), 'student chips');
  assert.strictEqual(S('wizard closed -> modal root emptied').ret, '');
  assert(S('wizard open (grid, traditional, 1 locked seat)').page.includes('locked seat in this layout will be preserved') || S('wizard open (grid, traditional, 1 locked seat)').page.includes('locked seat'), 'wizard locked note');
  assert(S('wizard: plural locked note').page.includes('2 locked seats') && !S('wizard: no locked seats note').page.includes('locked seat in this layout'), 'locked-seat note plural / absent');
  const sc = S('scale: normal (sets transform from the live scale)').ret; assert.deepStrictEqual(sc, ['1200px', '800px', 'scale(0.5)']);
  assert.deepStrictEqual(S('scale: zero-size wrapper -> retries on the next frame, commits nothing').ret, ['', 1]);
  assert.deepStrictEqual(S('scale: rAF callback is the same function and heals once laid out').ret, [true, 'scale(0.5)']);
  assert(S('shell wires the resize listener; unmount removes the same function').calls.includes('["addEventListener","resize"]') && S('shell wires the resize listener; unmount removes the same function').calls.includes('["removeEventListener","resize",true]'), 'resize listener added and removed with the same function');
  const EXPECTED_ERR = 'wizard: unknown shape throws identically (no matching CB_SHAPE_TYPES entry)';
  assert(o.shapes.length >= 3, 'CB_SHAPE_TYPES has several shapes: ' + o.shapes);
  assert.deepStrictEqual(o.steps.filter(s => s.err).map(s => s.label), [EXPECTED_ERR], 'only the deliberate unknown-shape step throws: ' + JSON.stringify(o.steps.filter(s => s.err).map(s => [s.label, s.err])));
  assert(/rowsLabel/.test(S(EXPECTED_ERR).err), 'unknown shape fails reading rowsLabel of the missing shape meta');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log(' - reverse-transform: original rebuilt byte-for-byte from the twin; 7 exports; 6-line trailing window block verbatim');
  console.log(' - ' + o.steps.length + ' steps compared: real builder + real render on both sides, whole #a-classroom DOM + live builder state after each');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
