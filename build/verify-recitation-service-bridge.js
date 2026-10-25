// Phase 7 (Stream D) — equivalence check for
// modules/seat-arrangement/recitation-service.js.
//
// Real-imports AppStore (state-manager.js) and DBService (db-service.js —
// itself real-importing pull-mappers.js/realtime-groups.js/
// repository/table-sync.js), same dependency shape as classroom-service.js
// (file 4/30) — see that file's verify script and MEMORY.md for the
// pre-stub-then-overwrite rationale for the shared `DBService` bare global.
// ORIGINAL evals the classic file chain in production load order; BRIDGE
// evals the combined test bundle sharing one real AppStore+DBService.
//
// DBService.rpc() is stubbed via the same SupabaseClient-mock-client
// dispatch table as classroom-service.js's check. No Math.random or
// isoDate dependency here — getTodayTotalForStudent's "today" boundary
// comes from an inline `new Date().toLocaleDateString('en-CA',{timeZone:
// 'Asia/Manila'})` in the file itself (identical code on both sides, so
// automatically consistent between them) — TODAY here just lines up this
// test's OWN fixtures with whatever day the check actually runs on.
//
// currentUser is not referenced by this file at all (unlike
// classroom-service.js's assignedBy) — no bare-global stub needed for it.
//
// What's compared: canScanTag/processScannerTap (cooldown enforcement,
// unregistered-card rejection, success path incl. the xp bump and the
// AppStore event payload), manualAward (validation matrix + success),
// undoRecitation (validation, already-removed, success incl. xp reversal),
// the 4 pure selectors (getSessionEntries/getSessionCounts/
// getTodayTotalForStudent/getAllTimeTotalForStudent), and
// startSession/stopSession/getActiveSession (validation, success, upsert-
// by-id semantics for a repeat session id).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', url: 'https://example.org/app/index.html' });
  const win = dom.window;
  win.__EDUQUEST_SUPABASE_URL__ = '';
  win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };

  win.__rpcCalls = [];
  win.__rpcMock = {};
  win.__rpcOffline = false;
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
  win.DEFAULT_DB = { students: [], rfidCards: [], recitationLog: [], recitationSessions: [] };
  // Pre-stub, synchronously, before any eval: state-manager.js's own init()
  // reads a bare `DBService` global with no import of its own. See
  // classroom-service.js's verify script for the full rationale — the real
  // db-service.js DBService (a separate module-scoped binding on the bridge
  // side) overwrites this the instant the combined-entry's own top-level
  // code runs, before this function's caller ever inspects window.DBService.
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };

  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  win.console.warn = () => {};
  win.console.error = () => {};
  return { win, logs };
}

async function evalOriginal(win) {
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  win.eval(read('repository/table-sync.js'));
  win.eval(read('repository/pull-mappers.js'));
  win.eval(read('repository/realtime-groups.js'));
  win.eval(read('db-service.js'));
  win.eval(read('modules/core/state-manager.js'));
  win.eval(read('modules/seat-arrangement/recitation-service.js'));
  await win.AppStore.ready;
}
async function evalBridge(win) {
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'recitation-service-combined-bundle.js'), 'utf8'));
  await win.AppStore.ready;
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v).replace(ISO, '<ISO>'));

function seedDataset(win) {
  win.AppStore.updateState(draft => {
    draft.students = [
      { id: 's1', name: 'Ana', xp: 100 },
      { id: 's2', name: 'Bo', xp: 0 },
    ];
    draft.rfidCards = [
      { tagId: 'TAG1', studentId: 's1', isActive: true },
      { tagId: 'TAG2', studentId: 's2', isActive: false }, // inactive, must be rejected
    ];
    draft.recitationLog = [
      { id: 'r1', studentId: 's1', classId: 'c1', pts: 3, note: null, when: 'Yesterday', createdAt: '2020-01-01T00:00:00.000Z' },
      { id: 'r2', studentId: 's1', classId: 'c1', pts: 2, note: null, when: 'Today', createdAt: TODAY + 'T05:00:00.000Z' },
      { id: 'r3', studentId: 's2', classId: 'c1', pts: 1, note: null, when: 'Today', createdAt: TODAY + 'T06:00:00.000Z' },
      { id: 'r4', studentId: 's1', classId: 'c2', pts: 4, note: null, when: 'Today', createdAt: TODAY + 'T07:00:00.000Z' }, // different class, still counts for all-time/today totals
    ];
    draft.recitationSessions = [
      { id: 'sess1', classId: 'c1', startedBy: 't1', startedAt: '2026-01-01T00:00:00.000Z', endedAt: null, isActive: true },
      { id: 'sess2', classId: 'c2', startedBy: 't1', startedAt: '2025-01-01T00:00:00.000Z', endedAt: '2025-01-02T00:00:00.000Z', isActive: false },
    ];
  }, { type: 'test:seed' });
}

async function run(win) {
  const out = {};
  seedDataset(win);

  const configureRpc = mock => Object.assign(win.__rpcMock, mock);
  const resetRpc = () => { win.__rpcMock = {}; win.__rpcCalls.length = 0; win.__rpcOffline = false; };

  // ── canScanTag / processScannerTap ──
  out.scan = {};
  out.scan.canScanFreshTag = win.RecitationService.canScanTag('NEVER_SCANNED');
  out.scan.emptyTag = clean(await win.RecitationService.processScannerTap('  ', 'c1'));
  out.scan.unregisteredTag = clean(await win.RecitationService.processScannerTap('NOPE', 'c1'));
  out.scan.inactiveCard = clean(await win.RecitationService.processScannerTap('TAG2', 'c1'));
  resetRpc();
  configureRpc({ log_recitation_point: { data: { id: 'newlog1', student_id: 's1', class_id: 'c1', pts: 1, note: null, when_label: 'Just now', created_at: '2026-02-01T00:00:00.000Z' }, error: null } });
  out.scan.success = clean(await win.RecitationService.processScannerTap('TAG1', 'c1'));
  out.scan.successCall = clean(win.__rpcCalls[win.__rpcCalls.length - 1]);
  out.scan.successXp = clean(win.AppStore.getSlice(s => s.students).find(s => s.id === 's1').xp);
  out.scan.cooldownBlocked = clean(await win.RecitationService.processScannerTap('TAG1', 'c1')); // same tag immediately again
  out.scan.canScanAfterAccept = win.RecitationService.canScanTag('TAG1');
  resetRpc();
  configureRpc({ log_recitation_point: { data: null, error: { message: 'RLS violation' } } });
  out.scan.errorPath = clean(await win.RecitationService.processScannerTap('TAG1', 'c1')); // TAG1 still in cooldown -> this actually tests the cooldown branch, not the RPC error; see below
  // isolate the RPC-error branch on a fresh tag/card (no cooldown interference)
  win.AppStore.updateState(draft => { draft.rfidCards.push({ tagId: 'TAG3', studentId: 's1', isActive: true }); }, { type: 'test:seed2' });
  out.scan.errorPathFreshTag = clean(await win.RecitationService.processScannerTap('TAG3', 'c1'));

  // ── manualAward ──
  resetRpc();
  out.award = {};
  out.award.noStudent = clean(await win.RecitationService.manualAward(null, 'c1', 5));
  out.award.zeroPoints = clean(await win.RecitationService.manualAward('s1', 'c1', 0));
  out.award.nanPoints = clean(await win.RecitationService.manualAward('s1', 'c1', 'abc'));
  configureRpc({ log_recitation_point: { data: { id: 'newlog2', student_id: 's2', class_id: 'c1', pts: -2, note: 'deduction', when_label: 'Just now', created_at: '2026-02-01T00:00:00.000Z' }, error: null } });
  out.award.negativeSuccess = clean(await win.RecitationService.manualAward('s2', 'c1', -2, '  deduction  '));
  out.award.negativeSuccessCall = clean(win.__rpcCalls[win.__rpcCalls.length - 1]);
  out.award.negativeSuccessXp = clean(win.AppStore.getSlice(s => s.students).find(s => s.id === 's2').xp);
  resetRpc();
  configureRpc({ log_recitation_point: { data: null, error: {} } }); // error object with no .message
  out.award.errorNoMessage = clean(await win.RecitationService.manualAward('s1', 'c1', 5));

  // ── undoRecitation — re-seed first: scan/award success above added
  // newlog1/newlog2 into recitationLog, which would otherwise leak in here.
  seedDataset(win);
  resetRpc();
  out.undo = {};
  out.undo.noLogId = clean(await win.RecitationService.undoRecitation(null));
  configureRpc({ undo_recitation_log: { data: null, error: null } }); // already removed
  out.undo.alreadyRemoved = clean(await win.RecitationService.undoRecitation('r1'));
  resetRpc();
  configureRpc({ undo_recitation_log: { data: true, error: null } }); // success — reverses r2's +2 xp
  out.undo.success = clean(await win.RecitationService.undoRecitation('r2'));
  out.undo.successState = clean(win.AppStore.getSlice(s => s.recitationLog).map(r => r.id).sort());
  out.undo.successXp = clean(win.AppStore.getSlice(s => s.students).find(s => s.id === 's1').xp);
  resetRpc();
  configureRpc({ undo_recitation_log: { data: null, error: { message: 'not found' } } });
  out.undo.errorPath = clean(await win.RecitationService.undoRecitation('rX'));

  // ── selectors (fresh re-seed for a clean, known recitationLog) ──
  seedDataset(win);
  out.selectors = {};
  out.selectors.sessionEntriesNoArgs = clean(win.RecitationService.getSessionEntries(null, TODAY));
  out.selectors.sessionEntries = clean(win.RecitationService.getSessionEntries('c1', TODAY + 'T00:00:00.000Z'));
  out.selectors.sessionCounts = clean(win.RecitationService.getSessionCounts('c1', TODAY + 'T00:00:00.000Z'));
  out.selectors.todayTotalS1 = win.RecitationService.getTodayTotalForStudent('s1');
  out.selectors.todayTotalNoStudent = win.RecitationService.getTodayTotalForStudent(null);
  out.selectors.allTimeS1 = win.RecitationService.getAllTimeTotalForStudent('s1');
  out.selectors.allTimeUnknown = win.RecitationService.getAllTimeTotalForStudent('ghost');

  // ── startSession / stopSession / getActiveSession ──
  resetRpc();
  out.session = {};
  out.session.startNoClass = clean(await win.RecitationService.startSession(null));
  configureRpc({ start_recitation_session: { data: { id: 'sess1', class_id: 'c1', started_by: 't2', started_at: '2026-03-01T00:00:00.000Z', ended_at: null, is_active: true }, error: null } });
  out.session.startExistingIdUpserts = clean(await win.RecitationService.startSession('c1')); // same id as seeded sess1 -> must UPDATE in place, not duplicate
  out.session.startExistingIdState = clean(win.AppStore.getSlice(s => s.recitationSessions).filter(s => s.id === 'sess1'));
  resetRpc();
  configureRpc({ start_recitation_session: { data: null, error: { message: 'db down' } } });
  out.session.startError = clean(await win.RecitationService.startSession('c1'));
  resetRpc();
  out.session.stopNoClass = clean(await win.RecitationService.stopSession(null));
  configureRpc({ stop_recitation_session: { data: { id: 'sess1', class_id: 'c1', started_by: 't2', started_at: '2026-03-01T00:00:00.000Z', ended_at: '2026-03-01T01:00:00.000Z', is_active: false }, error: null } });
  out.session.stopSuccess = clean(await win.RecitationService.stopSession('c1'));
  out.session.activeAfterStop = clean(win.RecitationService.getActiveSession('c1'));
  out.session.activeC2 = clean(win.RecitationService.getActiveSession('c2')); // seeded inactive -> null
  out.session.activeUnknownClass = clean(win.RecitationService.getActiveSession('nope'));
  out.session.activeNoClassId = clean(win.RecitationService.getActiveSession(null));

  return out;
}

function main() {
  return (async () => {
    const O = makeWindow(), B = makeWindow();
    await evalOriginal(O.win);
    await evalBridge(B.win);

    assert.ok(O.logs.some(l => l.includes('recitation-service.js loaded')));
    assert.deepStrictEqual(clean(B.logs), clean(O.logs), 'load-time console output must match');

    const oa = await run(O.win), ob = await run(B.win);
    assert.deepStrictEqual(clean(ob), clean(oa), 'bridge output must exactly match the original at every step');

    // ── hand-computed sanity on the ORIGINAL's output ──
    const o = clean(oa);
    assert.strictEqual(o.scan.canScanFreshTag, true);
    assert.deepStrictEqual(o.scan.emptyTag, { ok: false, error: 'Empty scan.' });
    assert.deepStrictEqual(o.scan.unregisteredTag, { ok: false, error: 'This card is not registered to any student.' });
    assert.deepStrictEqual(o.scan.inactiveCard, { ok: false, error: 'This card is not registered to any student.' }, 'an isActive:false card must be treated as unregistered');
    assert.strictEqual(o.scan.success.ok, true); assert.strictEqual(o.scan.success.studentId, 's1');
    assert.strictEqual(o.scan.successCall.params.p_points, 1, 'scanner taps are always worth exactly 1 point');
    assert.strictEqual(o.scan.successCall.params.p_source, 'scan');
    assert.strictEqual(o.scan.successXp, 101, '100 + 1 from the scan');
    assert.deepStrictEqual(o.scan.cooldownBlocked, { ok: false, error: 'cooldown', cooldown: true }, 'same tag again within 5s is blocked, even though the RPC mock was reconfigured to error');
    assert.strictEqual(o.scan.canScanAfterAccept, false);
    assert.deepStrictEqual(o.scan.errorPath, { ok: false, error: 'cooldown', cooldown: true }, 'TAG1 is still within its cooldown window here, so this hits the cooldown branch, not the RPC');
    assert.deepStrictEqual(o.scan.errorPathFreshTag, { ok: false, error: 'RLS violation' }, 'a different tag (TAG3), no cooldown -> reaches the RPC and surfaces its error');

    assert.deepStrictEqual(o.award.noStudent, { ok: false, error: 'A student is required.' });
    assert.deepStrictEqual(o.award.zeroPoints, { ok: false, error: 'Points must be a non-zero number.' });
    assert.deepStrictEqual(o.award.nanPoints, { ok: false, error: 'Points must be a non-zero number.' });
    assert.strictEqual(o.award.negativeSuccess.ok, true);
    assert.strictEqual(o.award.negativeSuccessCall.params.p_points, -2, 'negative points (a deduction) pass straight through, unlike the scanner path');
    assert.strictEqual(o.award.negativeSuccessCall.params.p_note, 'deduction', 'note is trimmed');
    assert.strictEqual(o.award.negativeSuccessCall.params.p_source, 'manual');
    assert.strictEqual(o.award.negativeSuccessXp, 0, 'xp floored at 0 via Math.max(0, ...), even though 0 + (-2) would be negative');
    assert.strictEqual(o.award.errorNoMessage.error, 'Could not award points.', 'no error.message -> generic fallback text');

    assert.deepStrictEqual(o.undo.noLogId, { ok: false, error: 'logId is required.' });
    assert.deepStrictEqual(o.undo.alreadyRemoved, { ok: false, error: 'That entry was already removed.' });
    assert.strictEqual(o.undo.success.ok, true);
    assert.deepStrictEqual(o.undo.successState, ['r1', 'r3', 'r4'], 'r2 removed from the local slice');
    assert.strictEqual(o.undo.successXp, 98, '100 - 2 reverses r2\'s earlier +2 grant');
    assert.deepStrictEqual(o.undo.errorPath, { ok: false, error: 'not found' });

    assert.deepStrictEqual(o.selectors.sessionEntriesNoArgs, [], 'missing classId -> empty array, not a throw');
    assert.strictEqual(o.selectors.sessionEntries.length, 2, 'r2 and r3 (c1, createdAt today) qualify; r1 (yesterday) and r4 (c2) do not');
    assert.deepStrictEqual(o.selectors.sessionEntries.map(e => e.id), ['r3', 'r2'], 'newest first: r3 (06:00) before r2 (05:00)');
    assert.deepStrictEqual(o.selectors.sessionCounts, { s1: 2, s2: 1 });
    assert.strictEqual(o.selectors.todayTotalS1, 6, "r2(2) + r4(4) are today, across BOTH c1 and c2 — today's total is not class-scoped");
    assert.strictEqual(o.selectors.todayTotalNoStudent, 0);
    assert.strictEqual(o.selectors.allTimeS1, 9, 'r1(3) + r2(2) + r4(4) = 9, every entry regardless of date or class');
    assert.strictEqual(o.selectors.allTimeUnknown, 0);

    assert.deepStrictEqual(o.session.startNoClass, { ok: false, error: 'A class is required.' });
    assert.strictEqual(o.session.startExistingIdUpserts.ok, true);
    assert.strictEqual(o.session.startExistingIdState.length, 1, 'an RPC response reusing seeded sess1\'s id UPDATES that entry in place rather than duplicating it');
    assert.strictEqual(o.session.startExistingIdState[0].startedBy, 't2', 'the update really took effect');
    assert.deepStrictEqual(o.session.startError, { ok: false, error: 'db down' });
    assert.deepStrictEqual(o.session.stopNoClass, { ok: false, error: 'A class is required.' });
    assert.deepStrictEqual(o.session.stopSuccess, { ok: true });
    assert.strictEqual(o.session.activeAfterStop, null, 'session is_active:false after stopSession -> getActiveSession no longer finds it');
    assert.strictEqual(o.session.activeC2, null, 'sess2 was seeded isActive:false');
    assert.strictEqual(o.session.activeUnknownClass, null);
    assert.strictEqual(o.session.activeNoClassId, null);

    console.log('EQUIVALENCE CHECK PASSED');
    console.log('Original recitation-service.js (via the real table-sync/pull-mappers/');
    console.log('realtime-groups/db-service/state-manager chain) and the bundled src/ twin');
    console.log('(real-imported through the same chain) agree on:');
    console.log(' - canScanTag/processScannerTap: cooldown enforcement, inactive/unregistered');
    console.log('   card rejection, the success path (fixed +1, xp bump, event payload)');
    console.log(' - manualAward: validation matrix, negative-points deduction, xp floor at 0');
    console.log(' - undoRecitation: validation, already-removed, success + xp reversal');
    console.log(' - all 4 pure selectors, incl. getTodayTotalForStudent\'s cross-class scope');
    console.log(' - startSession/stopSession/getActiveSession, incl. upsert-by-id on a repeat session id');
  })();
}

main().catch(e => { console.error(e); process.exit(1); });
