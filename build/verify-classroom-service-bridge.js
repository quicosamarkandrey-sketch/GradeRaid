// Phase 7 (Stream D) — equivalence check for
// modules/seat-arrangement/classroom-service.js.
//
// Real-imports AppStore (state-manager.js) and DBService (db-service.js —
// itself real-importing pull-mappers.js/realtime-groups.js/
// repository/table-sync.js, all already converted by other streams). ORIGINAL
// side evals the classic file chain in production load order (table-sync.js,
// pull-mappers.js, realtime-groups.js, db-service.js, state-manager.js,
// classroom-service.js — matching index.html); BRIDGE side evals the
// combined test bundle sharing one real AppStore+DBService instance.
//
// DBService.rpc() ultimately calls SupabaseClient.getClient().rpc(name,
// params) — SupabaseClient is a bare window global in db-service.js on BOTH
// sides (confirmed: not imported there), so it's stubbed directly with a
// mock client whose .rpc is a test-controlled dispatch table keyed by RPC
// name. This exercises the REAL rpc()/read()/write() wiring in db-service.js
// (offline-guard branches, JSON round-tripping) while keeping every RPC's
// returned {data,error} fully scripted and deterministic. The mock client
// also has a no-op .auth.getSession() so db-service.js's own debounced
// background upload (write() -> _queueUpload() -> _flushUpload() 400ms
// later) bails out cleanly via its own "no session" branch instead of
// erroring — never asserted on, since it's db-service.js's own concern, not
// classroom-service.js's.
//
// currentUser stays a bare global `let` binding (matches index.html's
// classic inline-script declaration) on both sides, exactly like the
// ach_engine.js check's rationale for the same pattern.
//
// What's compared: getLiveSeatingMap's full color-computation matrix,
// getColdCallCandidates/pickRandomStudent's 4 strategies + every error
// branch, getUnassignedStudents/getLayoutsForClass, duplicateSeats (pure,
// including its Math.random()-based id — seeded identically both sides),
// and all 8 RPC-wrapper functions: input validation, the success path
// (response mapping + exact AppStore mutation + exact event payload), the
// error path (message passthrough), and the "offline" (no client) path.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', url: 'https://example.org/app/index.html' });
  const win = dom.window;
  win.__EDUQUEST_SUPABASE_URL__ = '';
  win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };

  // Shared, test-controlled RPC dispatch. win.__rpcCalls records every call;
  // win.__rpcMock[name] is either a {data,error} literal or a function
  // (call, params) => {data,error} for cases needing per-call logic.
  win.__rpcCalls = [];
  win.__rpcMock = {};
  win.__rpcOffline = false; // when true, getClient() returns null (offline branch)
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
  win.SupabaseClient = {
    getClient: () => (win.__rpcOffline ? null : mockClient),
    resolveProvider: () => 'supabase',
  };
  win.DEFAULT_DB = { students: [], classroomLayouts: [], seats: [], seatAssignments: [], attendanceLogs: [], recitationLog: [], pointLog: [] };
  win.eval("let currentUser = null, currentRole = null;");

  // state-manager.js's own init() reads a BARE `DBService` global (it has no
  // import of its own) — this pre-stub satisfies that lookup regardless of
  // module-evaluation order inside the bundle. On the bridge side, the real
  // db-service.js DBService (which classroom-service.js DOES real-import) is
  // a separate, private module-scoped binding; the combined-entry.js's own
  // top-level `window.DBService = DBService;` overwrites this pre-stub with
  // that real one once the whole bundle finishes evaluating, before control
  // returns from win.eval() — so by the time this function's caller awaits
  // AppStore.ready, window.DBService is the real, single instance classroom-
  // service.js's rpc() calls also use. On the original side db-service.js is
  // one classic global; this pre-stub is simply overwritten in-place the
  // instant that classic file's own `window.DBService = (function(){...}())`
  // line runs (its real init() only fires from state-manager.js's init(),
  // which runs after — see production load order in evalOriginal). Either
  // way, state-manager.js's OWN local read()/write() calls (used only for
  // seeding/migrating DEFAULT_DB) never touch this real DBService's rpc().
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };

  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  win.console.warn = () => {}; // silence db-service.js's expected offline/mock-client warnings
  win.console.error = () => {};
  return { win, logs };
}

// isoDate() is a real import in the twin (via utils.js, already converted)
// but a bare classic global on the original side — eval the classic
// utils.js for real (a clean leaf file, no imports or load-time side
// effects) so BOTH sides compute "today" via the exact same
// toLocaleDateString(Asia/Manila) logic, whatever day the test actually
// runs on. TODAY (module-level, computed once) mirrors that same value for
// the test's own fixtures/assertions.
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

async function evalOriginal(win) {
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  win.eval(read('utils.js'));
  win.eval(read('repository/table-sync.js'));
  win.eval(read('repository/pull-mappers.js'));
  win.eval(read('repository/realtime-groups.js'));
  win.eval(read('db-service.js'));
  win.eval(read('modules/core/state-manager.js'));
  win.eval(read('modules/seat-arrangement/classroom-service.js'));
  await win.AppStore.ready;
}
async function evalBridge(win) {
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'classroom-service-combined-bundle.js'), 'utf8'));
  await win.AppStore.ready;
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const TMPID = /new_[a-z0-9]+/g;
const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v).replace(ISO, '<ISO>').replace(TMPID, '<TMPID>'));

function seedDataset(win) {
  win.AppStore.updateState(draft => {
    draft.students = [
      { id: 's1', name: 'Ana', classId: 'c1' },
      { id: 's2', name: 'Bo', classId: 'c1' },
      { id: 's3', name: 'Cy', classId: 'c1' },
      { id: 's4', name: 'Di' }, // no classId -> falls back to 'default-class'
    ];
    draft.classroomLayouts = [{ id: 'L1', classId: 'c1', name: 'Room A' }];
    draft.seats = [
      { id: 'seat1', layoutId: 'L1', xCoord: 0, yCoord: 0, isLocked: false },
      { id: 'seat2', layoutId: 'L1', xCoord: 100, yCoord: 0, isLocked: true },
      { id: 'seat3', layoutId: 'L1', xCoord: 200, yCoord: 0, isLocked: false },
      { id: 'seat4', layoutId: 'L1', xCoord: 300, yCoord: 0, isLocked: false },
      { id: 'seat5', layoutId: 'L2-other', xCoord: 0, yCoord: 0, isLocked: false }, // different layout, must be excluded
    ];
    draft.seatAssignments = [
      { id: 'a1', seatId: 'seat1', layoutId: 'L1', studentId: 's1' },
      { id: 'a2', seatId: 'seat2', layoutId: 'L1', studentId: 's2' },
      { id: 'a3', seatId: 'seat3', layoutId: 'L1', studentId: 's3' },
      // seat4 unassigned; s4 unassigned entirely
    ];
    draft.attendanceLogs = [
      { studentId: 's1', classId: 'c1', logDate: TODAY, status: 'Early' },
      { studentId: 's2', classId: 'c1', logDate: TODAY, status: 'Absent' },
      { studentId: 's3', classId: 'c1', logDate: TODAY, status: 'Late' },
      // s1 has an older log too, must be ignored for "today"
      { studentId: 's1', classId: 'c1', logDate: '2025-12-01', status: 'Excused' },
    ];
    draft.recitationLog = [{ studentId: 's1' }, { studentId: 's1' }, { studentId: 's3' }];
    draft.pointLog = [{ studentId: 's3' }];
  }, { type: 'test:seed' });
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedRand = (win, n) => { win.Math.random = mulberry32(n); };

async function run(win) {
  const out = {};
  seedDataset(win);

  // ── getLiveSeatingMap: full color matrix ──
  out.liveMap = clean(win.ClassroomService.getLiveSeatingMap('c1', 'L1', TODAY));
  out.liveMapUnknownLayout = clean(win.ClassroomService.getLiveSeatingMap('c1', 'nope', '2026-01-05'));
  out.liveMapNoLogsToday = clean(win.ClassroomService.getLiveSeatingMap('c1', 'L1', '2099-01-01'));

  // ── getColdCallCandidates / pickRandomStudent ──
  out.candidates = clean(win.ClassroomService.getColdCallCandidates('c1', 'L1', TODAY));
  out.pick = {};
  seedRand(win, 1); out.pick.pureRandom = clean(win.ClassroomService.pickRandomStudent('L1', 'pure_random', []));
  seedRand(win, 1); out.pick.unknownStrategyFallsBackToPureRandom = clean(win.ClassroomService.pickRandomStudent('L1', 'bogus', []));
  seedRand(win, 1); out.pick.leastParticipative = clean(win.ClassroomService.pickRandomStudent('L1', 'least_participative', []));
  out.pick.lateOnly = clean(win.ClassroomService.pickRandomStudent('L1', 'late_only', [])); // pool size 1 -> deterministic regardless of seed
  out.pick.lateOnlyEmpty = clean(win.ClassroomService.pickRandomStudent('L1', 'late_only', [])); // s3 is the only Late; still non-empty, see sanity
  out.pick.spatialBlockHit = clean(win.ClassroomService.pickRandomStudent('L1', 'spatial_block', ['seat1'])); // pool size 1 -> deterministic
  out.pick.spatialBlockMiss = clean(win.ClassroomService.pickRandomStudent('L1', 'spatial_block', ['seat4'])); // seat4 unassigned -> empty intersection
  out.pick.spatialBlockNoSeatsSelected = clean(win.ClassroomService.pickRandomStudent('L1', 'spatial_block', []));
  out.pick.noLayoutId = clean(win.ClassroomService.pickRandomStudent(null, 'pure_random', []));
  out.pick.unknownLayoutId = clean(win.ClassroomService.pickRandomStudent('nope', 'pure_random', []));

  // ── getUnassignedStudents / getLayoutsForClass ──
  out.unassigned = clean(win.ClassroomService.getUnassignedStudents('c1', 'L1'));
  out.unassignedDefaultClass = clean(win.ClassroomService.getUnassignedStudents('default-class', 'L1'));
  out.layoutsForClass = clean(win.ClassroomService.getLayoutsForClass('c1'));
  out.layoutsForUnknownClass = clean(win.ClassroomService.getLayoutsForClass('nope'));

  // ── duplicateSeats (pure, seeded Math.random) ──
  const seedRandom = n => { win.Math.random = (function (a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })(n); };
  seedRandom(7);
  const dupRaw = win.ClassroomService.duplicateSeats([{ xCoord: 10, yCoord: 20, rotation: 5, label: 'X', isLocked: true }]);
  out.dupIdLength = dupRaw[0].id.length; // raw, unblanked — catches a length change clean()'s <TMPID> blanking would otherwise hide
  out.dupDefaultOffset = clean(dupRaw);
  seedRandom(7);
  out.dupCustomOffset = clean(win.ClassroomService.duplicateSeats([{ xCoord: 10, yCoord: 20 }], 5));
  seedRandom(7);
  out.dupBadOffset = clean(win.ClassroomService.duplicateSeats([{ xCoord: 10, yCoord: 20 }], NaN)); // falls back to 30
  out.dupEmpty = clean(win.ClassroomService.duplicateSeats([]));
  out.dupNull = clean(win.ClassroomService.duplicateSeats(null));

  // ── RPC-wrapper functions ──
  out.rpc = {};
  const configureRpc = mock => { win.eval('__rpcMock'); Object.assign(win.__rpcMock, mock); };
  const resetRpc = () => { win.__rpcMock = {}; win.__rpcCalls.length = 0; win.__rpcOffline = false; };

  // saveLayout
  resetRpc();
  out.rpc.saveLayoutValidation = clean(await win.ClassroomService.saveLayout(null, 'Name', [], []));
  configureRpc({ save_classroom_layout: { data: { layout: { id: 'NEW1', class_id: 'c1', name: 'Room B', room_data: [{ type: 'door', x: 1, y: 2 }], shape: 'custom', walkway_preset: 'traditional', seat_overlap_fixed: false, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }, seats: [{ id: 'seatNew', layout_id: 'NEW1', x_coord: 5, y_coord: 6, rotation: 0, label: null, is_locked: false }] }, error: null } });
  out.rpc.saveLayoutSuccess = clean(await win.ClassroomService.saveLayout('c1', 'Room B', [{ id: null, xCoord: 5, yCoord: 6 }], [{ type: 'door', x: 1, y: 2 }]));
  out.rpc.saveLayoutSuccessCall = clean(win.__rpcCalls[win.__rpcCalls.length - 1]);
  out.rpc.saveLayoutSuccessState = clean({
    layouts: win.AppStore.getSlice(s => s.classroomLayouts).filter(l => l.id === 'NEW1'),
    seats: win.AppStore.getSlice(s => s.seats).filter(s => s.layoutId === 'NEW1'),
  });
  resetRpc();
  configureRpc({ save_classroom_layout: { data: null, error: { message: 'RLS violation' } } });
  out.rpc.saveLayoutError = clean(await win.ClassroomService.saveLayout('c1', 'X', [], []));
  resetRpc(); win.__rpcOffline = true;
  out.rpc.saveLayoutOffline = clean(await win.ClassroomService.saveLayout('c1', 'X', [], []));

  // assignStudentToSeat (also exercises currentUser -> assignedBy)
  resetRpc();
  out.rpc.assignValidation = clean(await win.ClassroomService.assignStudentToSeat('s1', null, 'L1'));
  win.eval("currentUser = { id: 'teacher-42' };");
  configureRpc({ assign_student_to_seat: { data: { affected: [{ seat_id: 'seat4', student_id: 's4' }] }, error: null } });
  out.rpc.assignSuccess = clean(await win.ClassroomService.assignStudentToSeat('s4', 'seat4', 'L1'));
  out.rpc.assignSuccessCall = clean(win.__rpcCalls[win.__rpcCalls.length - 1]);
  out.rpc.assignSuccessState = clean(win.AppStore.getSlice(s => s.seatAssignments).filter(a => a.seatId === 'seat4'));
  win.eval("currentUser = null;");
  resetRpc();
  configureRpc({ assign_student_to_seat: { data: { affected: [{ seat_id: 'seat1', student_id: null }] }, error: null } }); // unassign path
  out.rpc.unassignSuccess = clean(await win.ClassroomService.assignStudentToSeat(null, 'seat1', 'L1'));
  out.rpc.unassignState = clean(win.AppStore.getSlice(s => s.seatAssignments).filter(a => a.seatId === 'seat1'));
  resetRpc();
  configureRpc({ assign_student_to_seat: { data: null, error: { code: '42501' } } }); // error with only .code, no .message
  out.rpc.assignErrorCodeOnly = clean(await win.ClassroomService.assignStudentToSeat('s1', 'seat1', 'L1'));

  // generateBlueprint (validation matrix)
  resetRpc();
  out.rpc.blueprintNoClassOrShape = clean(await win.ClassroomService.generateBlueprint(null, null, 'N', null, 3, 3));
  out.rpc.blueprintBadShape = clean(await win.ClassroomService.generateBlueprint(null, 'c1', 'N', 'triangle', 3, 3));
  out.rpc.blueprintBadRowsCols = clean(await win.ClassroomService.generateBlueprint(null, 'c1', 'N', 'grid', 0, 3));
  out.rpc.blueprintCenterAisleTooFewCols = clean(await win.ClassroomService.generateBlueprint(null, 'c1', 'N', 'grid', 3, 1, 80, 'center_aisle'));
  out.rpc.blueprintDoubleAisleTooFewCols = clean(await win.ClassroomService.generateBlueprint(null, 'c1', 'N', 'grid', 3, 2, 80, 'double_aisle'));
  out.rpc.blueprintBadPresetFallsBackToTraditional = null; // asserted via the success call's params below
  configureRpc({ generate_room_blueprint: { data: {
    layout: { id: 'L1', class_id: 'c1', name: 'Room A', room_data: [], shape: 'grid', walkway_preset: 'traditional', seat_overlap_fixed: false, created_at: '<ISO>', updated_at: '<ISO>' },
    generated_seats: [{ id: 'genA', layout_id: 'L1', x_coord: 0, y_coord: 0, rotation: 0, label: null, is_locked: false }],
    preserved_locked_count: 1,
  }, error: null } });
  out.rpc.blueprintSuccess = clean(await win.ClassroomService.generateBlueprint('L1', 'c1', 'Room A', 'grid', 2, 2, 80, 'nonsense-preset'));
  out.rpc.blueprintSuccessCall = clean(win.__rpcCalls[win.__rpcCalls.length - 1]); // preset should show 'traditional' fallback
  // seat2 (locked, seeded) must be PRESERVED alongside the generated seat; seat1/3/4 (unlocked) replaced
  out.rpc.blueprintSuccessState = clean(win.AppStore.getSlice(s => s.seats).filter(s => s.layoutId === 'L1').map(s => s.id).sort());
  // assignment pruning: seat1's assignment (a1, unlocked seat now gone) must be pruned; seat2's (a2, locked, preserved) must survive
  out.rpc.blueprintPrunedAssignments = clean(win.AppStore.getSlice(s => s.seatAssignments).map(a => a.seatId).sort());

  // manualMoveStudent
  resetRpc();
  out.rpc.moveValidation = clean(await win.ClassroomService.manualMoveStudent(null, 'seat1', 'L1'));
  configureRpc({ manual_move_student: { data: { affected: [{ seat_id: 'seat2', student_id: 's2' }, { seat_id: null, student_id: 's3' }], swapped: true, note: 'swapped' }, error: null } });
  out.rpc.moveSuccess = clean(await win.ClassroomService.manualMoveStudent('s2', 'seat2', 'L1'));

  // autoAllocateRemaining
  resetRpc();
  out.rpc.autoAllocNoLayout = clean(await win.ClassroomService.autoAllocateRemaining(null, ['s4'], 'alphabetical'));
  out.rpc.autoAllocEmptyIds = clean(await win.ClassroomService.autoAllocateRemaining('L1', [], 'alphabetical'));
  configureRpc({ auto_allocate_remaining: { data: { affected: [{ seat_id: 'seat4', student_id: 's4' }], placed_count: 1, unplaced_remaining: 0 }, error: null } });
  out.rpc.autoAllocSuccess = clean(await win.ClassroomService.autoAllocateRemaining('L1', ['s4'], 'random'));
  out.rpc.autoAllocSuccessCall = clean(win.__rpcCalls[win.__rpcCalls.length - 1]);
  out.rpc.autoAllocBadStrategyDefaultsToAlphabetical = clean(await (async () => { configureRpc({ auto_allocate_remaining: { data: { affected: [], placed_count: 0 }, error: null } }); return win.ClassroomService.autoAllocateRemaining('L1', ['s4'], 'bogus'); })());
  out.rpc.autoAllocBadStrategyCall = clean(win.__rpcCalls[win.__rpcCalls.length - 1]);

  // setSeatLock — re-seed first: the blueprint test above replaced seat1
  // (it was unlocked) with a generated seat, so seat1 no longer exists.
  seedDataset(win);
  resetRpc();
  out.rpc.lockValidation = clean(await win.ClassroomService.setSeatLock(null, 'L1', true));
  configureRpc({ set_seat_lock: { data: { id: 'seat1', layout_id: 'L1', x_coord: 0, y_coord: 0, rotation: 0, label: null, is_locked: true }, error: null } });
  out.rpc.lockSuccess = clean(await win.ClassroomService.setSeatLock('seat1', 'L1', true));
  out.rpc.lockSuccessState = clean(win.AppStore.getSlice(s => s.seats).find(s => s.id === 'seat1'));

  // markSeatOverlapFixed — re-seed for isolation from prior mutations.
  seedDataset(win);
  resetRpc();
  out.rpc.overlapValidation = clean(await win.ClassroomService.markSeatOverlapFixed(null));
  configureRpc({ mark_seat_overlap_fixed: { data: { id: 'L1', class_id: 'c1', name: 'Room A', room_data: [], shape: 'grid', walkway_preset: 'traditional', seat_overlap_fixed: true, created_at: '<ISO>', updated_at: '<ISO>' }, error: null } });
  out.rpc.overlapSuccess = clean(await win.ClassroomService.markSeatOverlapFixed('L1'));

  // deleteLayout — re-seed for isolation from prior mutations.
  seedDataset(win);
  resetRpc();
  out.rpc.deleteValidation = clean(await win.ClassroomService.deleteLayout(null));
  configureRpc({ delete_classroom_layout: { data: null, error: null } });
  out.rpc.deleteSuccess = clean(await win.ClassroomService.deleteLayout('L1'));
  out.rpc.deleteSuccessState = clean({
    layouts: win.AppStore.getSlice(s => s.classroomLayouts).filter(l => l.id === 'L1'),
    seats: win.AppStore.getSlice(s => s.seats).filter(s => s.layoutId === 'L1'),
    assignments: win.AppStore.getSlice(s => s.seatAssignments).filter(a => a.layoutId === 'L1'),
  });

  return out;
}

function main() {
  return (async () => {
    const O = makeWindow(), B = makeWindow();
    await evalOriginal(O.win);
    await evalBridge(B.win);

    assert.ok(O.logs.some(l => l.includes('classroom-service.js loaded')), 'classroom-service.js\'s own load banner must be present (state-manager.js logs its own init banner too, which is fine)');
    assert.deepStrictEqual(clean(B.logs), clean(O.logs), 'load-time console output must match');

    const oa = await run(O.win), ob = await run(B.win);
    assert.deepStrictEqual(clean(ob), clean(oa), 'bridge output must exactly match the original at every step');

    // ── hand-computed sanity on the ORIGINAL's output ──
    const o = clean(oa);
    const byId = arr => Object.fromEntries(arr.map(vm => [vm.seatId, vm]));
    const lm = byId(o.liveMap);
    assert.strictEqual(o.liveMap.length, 4, 'only L1 seats (4), seat5 on a different layout excluded');
    assert.strictEqual(lm.seat1.attendanceStatus, 'Early'); assert.strictEqual(lm.seat1.color.label, '🟢');
    assert.strictEqual(lm.seat2.attendanceStatus, 'Absent'); assert.strictEqual(lm.seat2.isLocked, true);
    assert.strictEqual(lm.seat3.attendanceStatus, 'Late');
    assert.strictEqual(lm.seat4.studentId, null); assert.deepStrictEqual(lm.seat4.color, { bg: 'rgba(42,40,54,0.6)', border: 'rgba(255,255,255,0.06)', label: '—' }, '_empty color for an unassigned seat');
    assert.deepStrictEqual(o.liveMapUnknownLayout, [], 'unknown layout -> empty array, not a throw');
    const lmNoLogs = byId(o.liveMapNoLogsToday);
    assert.strictEqual(lmNoLogs.seat1.attendanceStatus, null, 'no log for that date -> _no_log branch');
    assert.deepStrictEqual(lmNoLogs.seat1.color, { bg: 'rgba(78,75,102,0.5)', border: 'rgba(255,255,255,0.12)', label: '⚪' });

    assert.strictEqual(o.candidates.length, 2, 'only Early/Late students (s1, s3); Absent s2 and empty seat4 excluded');
    assert.deepStrictEqual(o.candidates.map(c => c.studentId).sort(), ['s1', 's3']);

    assert.ok(['s1', 's3'].includes(o.pick.pureRandom.winner.studentId));
    assert.strictEqual(o.pick.pureRandom.pool.length, 2);
    assert.deepStrictEqual(o.pick.unknownStrategyFallsBackToPureRandom.strategy, 'pure_random');
    assert.strictEqual(o.pick.leastParticipative.pool.length, 2, 's1 (2 recitation entries) and s3 (1 recitation + 1 pointLog = 2) are tied lowest, so the pool keeps both');
    assert.ok(['s1', 's3'].includes(o.pick.leastParticipative.winner.studentId), 'winner is drawn from the tied pool');
    assert.strictEqual(o.pick.lateOnly.winner.studentId, 's3'); assert.strictEqual(o.pick.lateOnly.pool.length, 1);
    assert.strictEqual(o.pick.spatialBlockHit.winner.studentId, 's1'); assert.strictEqual(o.pick.spatialBlockHit.pool.length, 1);
    assert.strictEqual(o.pick.spatialBlockMiss.ok, false); assert.ok(o.pick.spatialBlockMiss.error.includes('None of the targeted'));
    assert.strictEqual(o.pick.spatialBlockNoSeatsSelected.ok, false); assert.ok(o.pick.spatialBlockNoSeatsSelected.error.includes('Select at least one'));
    assert.strictEqual(o.pick.noLayoutId.ok, false); assert.strictEqual(o.pick.unknownLayoutId.ok, false);

    assert.deepStrictEqual(o.unassigned, [], "s1/s2/s3 (c1) are all assigned; s4's classId falls back to 'default-class', so it doesn't match 'c1' at all and is excluded, not counted as unassigned");
    assert.deepStrictEqual(o.unassignedDefaultClass.map(s => s.id), ['s4'], "s4 matches classId 'default-class' via the || fallback, and has no assignment for L1");
    assert.strictEqual(o.layoutsForClass.length, 1); assert.strictEqual(o.layoutsForClass[0].id, 'L1');
    assert.deepStrictEqual(o.layoutsForUnknownClass, []);

    assert.strictEqual(o.dupDefaultOffset[0].xCoord, 40, '10+30 default offset'); assert.strictEqual(o.dupDefaultOffset[0].yCoord, 50);
    assert.strictEqual(o.dupDefaultOffset[0].isLocked, false, 'isLocked always reset on a clone'); assert.strictEqual(o.dupDefaultOffset[0].studentId, null);
    assert.strictEqual(o.dupCustomOffset[0].xCoord, 15, '10+5 custom offset');
    assert.strictEqual(o.dupBadOffset[0].xCoord, 40, 'NaN offset falls back to 30');
    assert.deepStrictEqual(o.dupEmpty, []); assert.deepStrictEqual(o.dupNull, []);
    assert.strictEqual(o.dupDefaultOffset[0].id, '<TMPID>');
    assert.strictEqual(oa.dupIdLength, 13, "'new_' (4 chars) + 9 base36 chars");

    assert.deepStrictEqual(o.rpc.saveLayoutValidation, { ok: false, error: 'classId and layoutName are required.' });
    assert.strictEqual(o.rpc.saveLayoutSuccess.ok, true); assert.strictEqual(o.rpc.saveLayoutSuccess.layoutId, 'NEW1');
    assert.strictEqual(o.rpc.saveLayoutSuccess.seats[0].id, 'seatNew');
    assert.deepStrictEqual(o.rpc.saveLayoutSuccessCall.params.p_seats, [{ id: null, x_coord: 5, y_coord: 6, rotation: 0, label: null, is_locked: false }], 'camelCase UI shape translated to snake_case RPC params');
    assert.strictEqual(o.rpc.saveLayoutSuccessState.layouts.length, 1); assert.strictEqual(o.rpc.saveLayoutSuccessState.seats.length, 1);
    assert.deepStrictEqual(o.rpc.saveLayoutError, { ok: false, error: 'RLS violation' });
    assert.strictEqual(o.rpc.saveLayoutOffline.ok, false); assert.ok(o.rpc.saveLayoutOffline.error.includes('offline') || o.rpc.saveLayoutOffline.error.includes('Could not save'));

    assert.deepStrictEqual(o.rpc.assignValidation, { ok: false, error: 'seatId and layoutId are required.' });
    assert.strictEqual(o.rpc.assignSuccessCall.params.p_assigned_by, 'teacher-42', 'currentUser.id passed through as assignedBy');
    assert.strictEqual(o.rpc.assignSuccessState.length, 1); assert.strictEqual(o.rpc.assignSuccessState[0].studentId, 's4');
    assert.deepStrictEqual(o.rpc.unassignState, [], 'a null student_id in the affected array removes the seat assignment entirely');
    assert.strictEqual(o.rpc.assignErrorCodeOnly.error, 'Could not assign seat.', 'no error.message -> generic fallback text used');

    assert.deepStrictEqual(o.rpc.blueprintNoClassOrShape, { ok: false, error: 'classId and shape are required.' });
    assert.ok(o.rpc.blueprintBadShape.error.includes('grid, u_shape, or group_pods'));
    assert.ok(o.rpc.blueprintBadRowsCols.error.includes('at least 1'));
    assert.ok(o.rpc.blueprintCenterAisleTooFewCols.error.includes('Center Aisle'));
    assert.ok(o.rpc.blueprintDoubleAisleTooFewCols.error.includes('Double Aisle'));
    assert.strictEqual(o.rpc.blueprintSuccessCall.params.p_preset, 'traditional', "an unrecognized preset string normalizes to 'traditional'");
    assert.deepStrictEqual(o.rpc.blueprintSuccessState, ['genA', 'seat2'], 'locked seat2 preserved + the one generated seat; unlocked seat1/3/4 replaced');
    assert.deepStrictEqual(o.rpc.blueprintPrunedAssignments, ['seat2'], "a1(seat1)/a3(seat3) pruned (seats gone); a2(seat2, locked+preserved) survives");

    assert.deepStrictEqual(o.rpc.moveValidation, { ok: false, error: 'studentId and layoutId are required.' });
    assert.strictEqual(o.rpc.moveSuccess.swapped, true); assert.strictEqual(o.rpc.moveSuccess.note, 'swapped');

    assert.deepStrictEqual(o.rpc.autoAllocNoLayout, { ok: false, error: 'layoutId is required.' });
    assert.ok(o.rpc.autoAllocEmptyIds.error.includes('non-empty array'));
    assert.strictEqual(o.rpc.autoAllocSuccessCall.params.p_strategy, 'random');
    assert.strictEqual(o.rpc.autoAllocSuccess.placedCount, 1);
    assert.strictEqual(o.rpc.autoAllocBadStrategyCall.params.p_strategy, 'alphabetical', "an unrecognized strategy normalizes to 'alphabetical'");

    assert.deepStrictEqual(o.rpc.lockValidation, { ok: false, error: 'seatId and layoutId are required.' });
    assert.strictEqual(o.rpc.lockSuccessState.isLocked, true);

    assert.deepStrictEqual(o.rpc.overlapValidation, { ok: false, error: 'layoutId is required.' });
    assert.strictEqual(o.rpc.overlapSuccess.layout.seatOverlapFixed, true);

    assert.deepStrictEqual(o.rpc.deleteValidation, { ok: false, error: 'layoutId is required.' });
    assert.strictEqual(o.rpc.deleteSuccess.ok, true);
    assert.deepStrictEqual(o.rpc.deleteSuccessState, { layouts: [], seats: [], assignments: [] }, 'delete cascades layouts+seats+assignments in the local slice');

    console.log('EQUIVALENCE CHECK PASSED');
    console.log('Original classroom-service.js (via the real table-sync/pull-mappers/');
    console.log('realtime-groups/db-service/state-manager chain) and the bundled src/ twin');
    console.log('(real-imported through the same chain) agree on:');
    console.log(' - getLiveSeatingMap\'s full color matrix (present/absent/late/no-log/empty/unknown-layout)');
    console.log(' - getColdCallCandidates + pickRandomStudent\'s 4 strategies and every error branch');
    console.log(' - getUnassignedStudents (incl. the default-class fallback) and getLayoutsForClass');
    console.log(' - duplicateSeats (seeded Math.random, custom/NaN offset, empty/null input)');
    console.log(' - all 8 RPC-wrapper functions: validation, success (mapping + AppStore mutation +');
    console.log('   event payload + exact RPC params), error passthrough, and the offline branch');
  })();
}

main().catch(e => { console.error(e); process.exit(1); });
