'use strict';
// Phase 5 — Data Layer Redesign, sub-phase B (Delta/patch sync):
// quiz_history, the eighth table converted. quizHistory[studentId] =
// [attempts...] — same 'nestedArray' shape as inventory. Append-only, same
// low-blast-radius reasoning as point_log/redemptions — no new mechanism
// needed; converted plainly, same as those two.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadDbServiceWindow, loadAppStoreWindow, makeFakeSupabaseClient } = require('./helpers/load-globals');

function dj(arr) { return Array.from(arr); }
function jn(x) { return JSON.parse(JSON.stringify(x)); }

function teacherSession(extra) {
  return Object.assign({ currentUser: { id: 't1', role: 'teacher' }, currentRole: 'teacher', classSections: [] }, extra);
}

function attempt(overrides) {
  return Object.assign({ id: 'qh1', quizId: 'q1', score: 80, attempt: 1, completedAt: 't', date: '2026-08-01', results: [], aborted: false }, overrides);
}

test('quiz_history delta sync: pushes only the dirty (studentId, attemptId) pair', async () => {
  const dirtyIds = { quiz_history: ['s2:qh1'] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  const cache = {
    quizHistory: {
      s1: [attempt({ id: 'qh1' })],
      s2: [attempt({ id: 'qh1' }), attempt({ id: 'qh2' })],
    },
  };
  await loaded.DBService._test.pushCacheToSupabase(client, cache);

  const call = calls.find(c => c.table === 'quiz_history');
  assert.ok(call);
  assert.equal(call.rows.length, 1);
  assert.equal(call.rows[0].student_id, 's2');
  assert.equal(call.rows[0].id, 'qh1');
  assert.deepEqual(jn(loaded.win.clearDirtyCalls), [{ table: 'quiz_history', ids: ['s2:qh1'] }]);
});

test('quiz_history delta sync: an explicit empty dirty array skips the push entirely', async () => {
  const dirtyIds = { quiz_history: [] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const calls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { calls.push({ table, rows, opts }); });
  await loaded.DBService._test.pushCacheToSupabase(client, { quizHistory: { s1: [attempt()] } });

  assert.ok(!calls.some(c => c.table === 'quiz_history'));
  assert.deepEqual(jn(loaded.win.clearDirtyCalls), []);
});

test('quiz_history delta sync: a failed push leaves its ids dirty so the next cycle retries them', async () => {
  const dirtyIds = { quiz_history: ['s1:qh1'] };
  const loaded = loadDbServiceWindow(teacherSession({ dirtyIds }));
  const client = makeFakeSupabaseClient((table) => {
    if (table === 'quiz_history') return { error: { code: '42501', message: 'RLS denied' } };
    return { error: null };
  });
  await loaded.DBService._test.pushCacheToSupabase(client, { quizHistory: { s1: [attempt()] } });

  assert.deepEqual(jn(loaded.win.clearDirtyCalls), []);
});

test('no-clobber: two students completing quizzes concurrently — one push does not resend, and clobber tracking of, the other', async () => {
  const sessionA = loadAppStoreWindow({ quizHistory: { s1: [], s2: [] } });
  await sessionA.AppStore.ready;

  sessionA.AppStore.updateState((draft) => {
    draft.quizHistory.s1.push(attempt({ id: 'qh-a' }));
  });
  assert.deepEqual(dj(sessionA.AppStore.getDirtyIds('quiz_history')), ['s1:qh-a']);

  const serverCalls = [];
  const client = makeFakeSupabaseClient((table, rows, opts) => { serverCalls.push({ table, rows, opts }); });
  const dbA = loadDbServiceWindow(teacherSession());
  dbA.win.AppStore.getDirtyIds = (t) => sessionA.AppStore.getDirtyIds(t);
  dbA.win.AppStore.clearDirty = (t, ids) => sessionA.AppStore.clearDirty(t, ids);
  await dbA.DBService._test.pushCacheToSupabase(client, { quizHistory: sessionA.AppStore.getState().quizHistory });

  const call = serverCalls.find(c => c.table === 'quiz_history');
  assert.equal(call.rows.length, 1, "s2's (empty) history must not be touched by a push that only dirtied s1");
  assert.equal(call.rows[0].student_id, 's1');
});
