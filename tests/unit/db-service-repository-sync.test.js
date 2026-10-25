'use strict';
// Phase 5 — Data Layer Redesign, sub-phase A (Repository abstraction).
//
// Covers the generic _runTableSync engine + _TABLE_SYNC_CONFIGS that
// replaced 13 hand-written filter→map→upsert→catch-warn blocks in
// _pushCacheToSupabase. This is regression coverage for the CURRENT code
// (not the one-time original-vs-refactored byte-identical diff that was
// run manually during the Phase 5A session — that verification is recorded
// in the Refactoring Report, not re-run here).
//
// What this suite asserts, so a future edit to a config or to the engine
// itself can't silently reintroduce the exact bugs this repository layer
// was built to prevent:
//   - a simple table (point_log) round-trips filter+map correctly
//   - a staff-gated table (shop_products) is skipped for a student session
//     and included for a teacher session — the isCatalogStaffSession gate
//   - the nested-object flatten tables (inventory, quiz_history,
//     boss_participants) build rows correctly from their non-array cache
//     shapes
//   - one table's upsert throwing does not stop a later table in the same
//     cycle from being attempted (the table-isolation bugfix _pushTable
//     exists for)
//   - boss_events' bespoke per-row retry-on-23502 path still fires

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadDbServiceWindow, makeFakeSupabaseClient } = require('./helpers/load-globals');

function teacherSession(classSections) {
  return { currentUser: { id: 't1', role: 'teacher' }, currentRole: 'teacher', classSections: classSections || [] };
}

test('db-service repository sync: point_log filters unstamped entries and maps fields', async () => {
  const { DBService } = loadDbServiceWindow(teacherSession());
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  const cache = {
    pointLog: [
      { id: 'pl1', studentId: 's1', what: 'Good job', pts: 5, when: 'today' },
      { studentId: 's2', what: 'no id — pre-migration, should be skipped', pts: 1, when: 'today' },
    ],
  };
  await DBService._test.pushCacheToSupabase(client, cache);
  const pointLogCall = calls.find(c => c.table === 'point_log');
  assert.ok(pointLogCall, 'point_log upsert should have been called');
  assert.equal(pointLogCall.opts.onConflict, 'id');
  assert.deepEqual(pointLogCall.rows, [{ id: 'pl1', student_id: 's1', what: 'Good job', pts: 5, when_label: 'today' }]);
});

test('db-service repository sync: staff-gated table skipped for student session, included for teacher', async () => {
  const cache = { store: [{ id: 'p1', ownerTeacherId: 't1', name: 'Pencil', emoji: '✏️', desc: 'd', cat: 'school', cost: 10, active: true }] };

  const student = loadDbServiceWindow({ currentUser: { id: 's1', role: 'student' }, currentRole: 'student' });
  const studentCalls = [];
  await student.DBService._test.pushCacheToSupabase(
    makeFakeSupabaseClient((table, rows, opts) => { studentCalls.push(table); }),
    cache
  );
  assert.ok(!studentCalls.includes('shop_products'), 'a student session must not push shop_products');

  const teacher = loadDbServiceWindow(teacherSession());
  const teacherCalls = [];
  await teacher.DBService._test.pushCacheToSupabase(
    makeFakeSupabaseClient((table, rows, opts) => { teacherCalls.push(table); }),
    cache
  );
  assert.ok(teacherCalls.includes('shop_products'), 'a teacher session must push shop_products');
});

test('db-service repository sync: inventory and quiz_history flatten their per-student object shape', async () => {
  const { DBService } = loadDbServiceWindow(teacherSession());
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  const cache = {
    inventory: {
      s1: [{ itemId: 'i1', itemName: 'Item', emoji: 'e', category: 'cat', quantity: 2, datePurchased: 'd1', lastPurchased: 'd2', source: 'Store', status: 'active', usedAt: null }],
    },
    quizHistory: {
      s1: [{ id: 'qh1', quizId: 'q1', score: 90, attempt: 1, completedAt: 123, date: 'd', results: null, aborted: false }],
    },
  };
  await DBService._test.pushCacheToSupabase(client, cache);

  const invCall = calls.find(c => c.table === 'inventory');
  assert.equal(invCall.opts.onConflict, 'student_id,item_id');
  assert.deepEqual(invCall.rows, [{
    student_id: 's1', item_id: 'i1', item_name: 'Item', emoji: 'e', category: 'cat',
    quantity: 2, date_purchased: 'd1', last_purchased: 'd2', source: 'Store', status: 'active', used_at: null,
  }]);

  const qhCall = calls.find(c => c.table === 'quiz_history');
  assert.equal(qhCall.opts.onConflict, 'id');
  assert.deepEqual(qhCall.rows, [{
    id: 'qh1', student_id: 's1', quiz_id: 'q1', score: 90, attempt: 1,
    completed_at: 123, date_label: 'd', question_results: null, aborted: false,
  }]);
});

test('db-service repository sync: boss_participants resolves boss index to its server _id via _bossIdById', async () => {
  const { DBService } = loadDbServiceWindow(teacherSession());
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  const cache = {
    _bossIdById: { 'boss-uuid-1': 0 },
    bossParticipants: {
      0: { s1: { classId: 'classA', totalDamage: 10, correctAnswers: 1, wrongAnswers: 0, critHits: 0, minionsDefeated: 0, lastQIdx: 1 } },
      // index 1 has no matching boss uuid — must be skipped, not thrown on
      1: { s2: { classId: 'classA', totalDamage: 5, correctAnswers: 0, wrongAnswers: 1, critHits: 0, minionsDefeated: 0, lastQIdx: 0 } },
    },
  };
  await DBService._test.pushCacheToSupabase(client, cache);
  const bpCall = calls.find(c => c.table === 'boss_participants');
  assert.equal(bpCall.rows.length, 1, 'only the roster with a resolvable boss uuid should be pushed');
  assert.equal(bpCall.rows[0].boss_id, 'boss-uuid-1');
  assert.equal(bpCall.rows[0].student_id, 's1');
});

test('db-service repository sync: one table failing does not block a later table in the same cycle', async () => {
  const { DBService } = loadDbServiceWindow(teacherSession());
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => {
    calls.push(table);
    if (table === 'achievements') return { error: { code: '42501', message: 'RLS denied' } };
    return { error: null };
  });
  const cache = {
    achievements: [{ id: 'a1', ownerTeacherId: 't1', name: 'X', description: 'd', icon: 'i', category: 'c', rarity: 'r', xpReward: 1, coinReward: 1, triggerType: 't', triggerValue: 1, active: true }],
    titles: [{ id: 'ti1', ownerTeacherId: 't1', name: 'T', description: 'd', icon: 'i', rarity: 'r', active: true, achievementId: null, textColor: null, borderColor: null, glowColor: null, bgColor: null, primaryColor: null, secondaryColor: null, gradientFrom: null, gradientTo: null, borderStyle: null, animation: null, particles: null, bgEffect: null, customBorderCSS: null, customAnimationCSS: null, customBgCSS: null, frameShape: null, frameStyle: null, accentColor: null, effect: null, frameTemplate: null }],
  };
  await DBService._test.pushCacheToSupabase(client, cache);
  assert.ok(calls.includes('achievements'), 'achievements should have been attempted');
  assert.ok(calls.includes('titles'), 'titles must still be attempted even though achievements failed');
});

test('db-service repository sync: boss_events retries once on 23502 (stale local _id) then seeds full lifecycle fields', async () => {
  const { DBService } = loadDbServiceWindow(teacherSession());
  let attempt = 0;
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => {
    if (table !== 'boss_events') return { error: null };
    attempt++;
    calls.push(rows);
    if (attempt === 1) return { error: { code: '23502', message: 'null value in column "current_hp"' } };
    return { error: null };
  });
  const cache = {
    bossEvents: [{
      _id: 'b1', classId: 'classA', name: 'Dragon', description: null, image: null,
      startDate: null, endDate: null, xpReward: 1, coinReward: 1,
      participationReward: 0, victoryReward: 0, defeatNarrTitle: null, defeatNarrText: null,
      victoryTitle: null, victoryMessage: null, lootRewards: [], lootDuration: null,
      bossQuestions: [], minionSettings: {}, combatSettings: {}, skills: {},
      skillFireMode: null, skillIntervalMin: null, skillIntervalMax: null,
      rageSettings: {}, phases: [],
      maxHp: 5000, currentHp: 3000, // existing row: max_hp/current_hp normally omitted unless present
      status: 'active', defeatedAt: null, endedAt: null, lootStartedAt: null, lootFinalizedAt: null,
    }],
  };
  await DBService._test.pushCacheToSupabase(client, cache);
  assert.equal(attempt, 2, 'should retry exactly once after a 23502');
  const retryRow = calls[1];
  assert.equal(retryRow.status, 'active', 'retry should seed lifecycle fields from the local draft');
  assert.equal(retryRow.max_hp, 5000);
});
