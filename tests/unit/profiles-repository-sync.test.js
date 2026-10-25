'use strict';
// Phase 5 — Data Layer Redesign: folding `profiles` into
// _TABLE_SYNC_CONFIGS. This locks in the exact full-slice-push behavior
// that used to live in a standalone block inside _pushCacheToSupabase —
// none of these properties are new, they're just newly under test now that
// the logic lives in the generic engine instead of bespoke code. Every test
// in THIS file uses the fallback-to-full-push path (no `dirtyIds` passed to
// loadDbServiceWindow), which is what verifies the fold-in didn't change
// anything. profiles' delta-specific behavior (watchFields scoping, the
// partial-chunk-failure clearDirty contract) is covered separately in
// profiles-delta-sync.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadDbServiceWindow, makeFakeSupabaseClient } = require('./helpers/load-globals');

function student(overrides) {
  return Object.assign({
    id: 's1', name: 'Alex', init: 'A', color: '#fff',
    firstName: 'Alex', lastName: 'Lee', profilePic: null, classId: 'classA',
    xp: 999, coins: 999, level: 9, tier: 'gold', attendancePct: 88, quizAvg: 77, // RPC-owned — must never appear in the payload
  }, overrides);
}

test('profiles: a non-staff (student) session never triggers the upsert at all', async () => {
  const { DBService } = loadDbServiceWindow({ currentUser: { id: 's1', role: 'student' }, currentRole: 'student' });
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  await DBService._test.pushCacheToSupabase(client, { students: [student()] });

  assert.ok(!calls.some(c => c.table === 'profiles'), 'a student session must never even attempt the profiles upsert');
});

test('profiles: an admin session upserts only identity/cosmetic columns — RPC-owned columns are never sent', async () => {
  const { DBService } = loadDbServiceWindow({ currentUser: { id: 't1', role: 'admin' }, currentRole: 'admin' });
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  await DBService._test.pushCacheToSupabase(client, { students: [student()] });

  const call = calls.find(c => c.table === 'profiles');
  assert.ok(call, 'an admin session should push profiles');
  assert.deepEqual(call.rows, [{
    id: 's1', role: 'student', display_name: 'Alex', init: 'A', color: '#fff',
    first_name: 'Alex', last_name: 'Lee', profile_pic_url: null, class_id: 'classA',
  }]);
  assert.ok(!('xp' in call.rows[0]) && !('coins' in call.rows[0]) && !('level' in call.rows[0]) &&
    !('tier' in call.rows[0]) && !('attendance_pct' in call.rows[0]) && !('quiz_avg' in call.rows[0]),
    'none of the six RPC-owned columns may ever ride along in this bulk upsert');
});

test('profiles: an admin session is not restricted by writableClassIds (bypasses the section filter entirely)', async () => {
  const { DBService } = loadDbServiceWindow({ currentUser: { id: 't1', role: 'admin' }, currentRole: 'admin', classSections: [] });
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  await DBService._test.pushCacheToSupabase(client, {
    students: [student({ id: 's1', classId: 'classA' }), student({ id: 's2', classId: 'classB' })],
  });

  const profileCalls = calls.filter(c => c.table === 'profiles');
  const totalRows = profileCalls.reduce((n, c) => n + c.rows.length, 0);
  assert.equal(totalRows, 2, 'admin should be able to push students across multiple classes in one cycle (still chunked per class_id, but neither is skipped)');
});

test('profiles: a teacher session is restricted to their own advised sections, chunked per class_id, one upsert call per class', async () => {
  const { DBService } = loadDbServiceWindow({
    currentUser: { id: 't1', role: 'teacher' }, currentRole: 'teacher',
    classSections: [{ id: 'classA', adviserId: 't1' }, { id: 'classB', adviserId: 't2' }],
  });
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  await DBService._test.pushCacheToSupabase(client, {
    students: [
      student({ id: 's1', classId: 'classA' }),
      student({ id: 's2', classId: 'classB' }), // t1 doesn't advise this section — must be skipped
    ],
  });

  const profileCalls = calls.filter(c => c.table === 'profiles');
  assert.equal(profileCalls.length, 1, 'only classA should be pushed — one upsert call for it');
  assert.equal(profileCalls[0].rows.length, 1);
  assert.equal(profileCalls[0].rows[0].id, 's1');
});

test('profiles: one class_id chunk being rejected does not throw, and does not block another class_id chunk in the same cycle', async () => {
  const { DBService } = loadDbServiceWindow({
    currentUser: { id: 't1', role: 'admin' }, currentRole: 'admin',
  });
  const seenClassIds = [];
  const client = makeFakeSupabaseClient((table, rows) => {
    if (table === 'profiles') {
      const classId = rows[0].class_id;
      seenClassIds.push(classId);
      if (classId === 'classA') return { error: { code: '42501', message: 'RLS denied' } };
    }
    return { error: null };
  });
  await DBService._test.pushCacheToSupabase(client, {
    students: [student({ id: 's1', classId: 'classA' }), student({ id: 's2', classId: 'classB' })],
  });

  assert.deepEqual(seenClassIds.sort(), ['classA', 'classB'], "classB's chunk must still be attempted even though classA's failed");
});
