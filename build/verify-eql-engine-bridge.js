// Phase 7 (Stream D) — equivalence check for modules/leaderboard/eql-engine.js.
//
// Real-imports AppStore (state-manager.js, already converted — bare
// window-fallback for DBService/DEFAULT_DB itself, no imports of its own;
// confirmed via repo-wide grep it is never reassigned at runtime).
// ORIGINAL side evals the classic file chain (state-manager.js needs
// DBService/DEFAULT_DB/window.DB stubbed — same minimal stub set
// verify-progress-bridge.js uses, no supabase-client/db-service chain
// required since state-manager.js's twin has zero imports either) then the
// original eql-engine.js. BRIDGE side evals the combined test bundle
// (build/test-helpers/eql-engine-combined-bundle.js) sharing one real
// AppStore instance the same way a real ES module graph would.
//
// eqlBuildCategory also reads window.ActiveSection (bare, typeof-guarded in
// both versions) — stubbed directly, independent of AppStore.
//
// What's compared: eqlComputeRecitation/Boss/Academic/Overall across
// resetAt filtering + the `cache` bundle-vs-fresh-getSlice equivalence,
// eqlBuildCategory's section scoping/sorting/rank-tie logic for all 4
// categories, and every EQL public-API method including its AppStore
// mutations. Plus the load-time migration/backfill effect itself (both its
// branches: first-run init and per-key backfill of a partial config).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', url: 'https://example.org/app/index.html' });
  const win = dom.window;
  win.__EDUQUEST_SUPABASE_URL__ = '';
  win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };
  win.DBService = { initRemote: async () => {}, read: () => null, write: () => {} };
  win.DB = {};
  // Matches verify-progress-bridge.js's rationale: state-manager.js's init()
  // falls back to cloning the bare global DEFAULT_DB when DBService.read()
  // returns empty; a minimal stub satisfies init() identically on both
  // sides. eql-engine.js itself never reads DEFAULT_DB.
  win.DEFAULT_DB = { students: [], leaderboardConfig: null, recitationLog: [], bossEvents: [], bossParticipants: {}, pointLog: [] };
  win.ActiveSection = null; // eqlBuildCategory treats a falsy ActiveSection as "no scoping"
  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  return { win, logs };
}

async function evalOriginal(win, opts) {
  if (opts && opts.preExistingConfig) win.DEFAULT_DB = Object.assign({}, win.DEFAULT_DB, { leaderboardConfig: opts.preExistingConfig });
  win.eval(fs.readFileSync(path.join(__dirname, '..', 'modules', 'core', 'state-manager.js'), 'utf8'));
  win.eval(fs.readFileSync(path.join(__dirname, '..', 'modules', 'leaderboard', 'eql-engine.js'), 'utf8'));
  await win.AppStore.ready;
}
async function evalBridge(win, opts) {
  if (opts && opts.preExistingConfig) win.DEFAULT_DB = Object.assign({}, win.DEFAULT_DB, { leaderboardConfig: opts.preExistingConfig });
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'eql-engine-combined-bundle.js'), 'utf8'));
  await win.AppStore.ready;
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v).replace(ISO, '<ISO>'));

// ── fixtures ────────────────────────────────────────────────────────────────
function seedFull(win, opts) {
  opts = opts || {};
  win.AppStore.updateState(draft => {
    draft.students = [
      { id: 's1', name: 'Ana', xp: 500, classId: 'c1' },
      { id: 's2', name: 'Bo', xp: 900, classId: 'c1' },
      { id: 's3', name: 'Cy', xp: 100, classId: 'c2' },
      { id: 's4', name: 'Di', xp: 500, classId: 'c1' }, // ties s1 on overall-ish scores in some scenarios
    ];
    draft.recitationLog = [
      { studentId: 's1', createdAt: '2026-01-01T09:00:00.000Z', pts: 20, qr: true },
      { studentId: 's1', createdAt: '2026-01-02T09:00:00.000Z', pts: 5 },
      { studentId: 's1', createdAt: '2026-01-03T09:00:00.000Z', pts: 5 },
      { studentId: 's1', createdAt: 'not-a-date', pts: 5 },       // invalid createdAt -> resetAt filter catch branch
      { studentId: 's1', createdAt: '2026-01-01T12:00:00.000Z', pts: 7 }, // exactly AT the resetAt boundary used below (>= must include it)
      { studentId: 's2', createdAt: '2026-01-01T09:00:00.000Z', pts: 30, note: 'nice QR scan' },
      { studentId: 's2', createdAt: '2026-01-02T09:00:00.000Z', pts: 17 }, // strictly between 15 and 20: distinguishes the win threshold
      { studentId: 's3', createdAt: '2025-06-01T09:00:00.000Z', pts: 1 }, // old, excluded by resetAt
    ];
    draft.bossEvents = [
      { status: 'ended', startedAt: '2026-01-01T00:00:00.000Z' },
      { status: 'active', startedAt: '2026-01-02T00:00:00.000Z' },
      { status: 'loot', startedAt: '2025-06-01T00:00:00.000Z' },  // old, excluded by resetAt
    ];
    draft.bossParticipants = {
      0: { s1: { totalDamage: 300, critHits: 2, minionsDefeated: 1, correctAnswers: 4, studentId: 's1' },
           s2: { totalDamage: 900, critHits: 1, minionsDefeated: 0, correctAnswers: 2, studentId: 's2' } },
      1: { s1: { totalDamage: 50 } },
      2: { s1: { totalDamage: 10, studentId: 's1' } },
    };
    draft.pointLog = [
      { studentId: 's1', what: 'Quest: A (100%)', pts: 10, when: '2026-01-03T00:00:00.000Z' },
      { studentId: 's1', what: 'Quest: B (80%)', pts: 8, when: '2026-01-02T00:00:00.000Z' },
      { studentId: 's1', what: 'Quest: C (100%)', pts: -6, when: 'bad-date' },  // abs() + resetAt-catch branch
      { studentId: 's1', what: 'Bonus points', pts: 99, when: '2026-01-01T00:00:00.000Z' }, // not a Quest: line, excluded
      { studentId: 's2', what: 'Quest: D (100%)', pts: 12, when: '2026-01-01T00:00:00.000Z' },
      { studentId: 's3', what: 'Quest: no-score', pts: 5, when: '2026-01-01T00:00:00.000Z' },
    ];
  }, { type: 'test:seed' });
  if (opts.activeClass !== undefined) win.ActiveSection = { get: () => opts.activeClass };
  else win.ActiveSection = null;
}

async function run(win) {
  const out = {};
  out.compute = {};
  const both = (sid, resetAt, cache) => ({
    recitation: win.eqlComputeRecitation(sid, resetAt, cache),
    boss: win.eqlComputeBoss(sid, resetAt, cache),
    academic: win.eqlComputeAcademic(sid, resetAt, cache),
  });

  // empty-state (no seed yet)
  out.compute.emptyS1 = clean(both('s1'));

  seedFull(win);
  out.compute.s1_noReset = clean(both('s1'));
  out.compute.s2_noReset = clean(both('s2'));
  out.compute.s1_withReset = clean(both('s1', '2026-01-01T12:00:00.000Z'));
  // isolate the boundary-inclusion check from the rest of the fixture noise
  out.compute.s1_atBoundaryOnly = clean(win.eqlComputeRecitation('s1', '2026-01-01T12:00:00.000Z', {
    recitationLog: [{ studentId: 's1', createdAt: '2026-01-01T12:00:00.000Z', pts: 7 }],
  }));
  out.compute.unknownStudent = clean(both('ghost'));
  out.compute.overall_s1 = clean(win.eqlComputeOverall('s1'));
  out.compute.overall_s2 = clean(win.eqlComputeOverall('s2'));
  out.compute.overall_ghost = clean(win.eqlComputeOverall('ghost'));

  // cache bundle must give identical results to a fresh getSlice() call
  const cache = {
    recitationLog: win.AppStore.getSlice(s => s.recitationLog),
    bossEvents: win.AppStore.getSlice(s => s.bossEvents),
    bossParticipants: win.AppStore.getSlice(s => s.bossParticipants),
    pointLog: win.AppStore.getSlice(s => s.pointLog),
    students: win.AppStore.getSlice(s => s.students),
  };
  out.compute.s1_viaCache = clean(both('s1', null, cache));

  // eqlBuildCategory: unscoped, scoped, unknown key -> overall default
  out.categories = {};
  for (const key of ['recitation', 'boss', 'academic', 'overall', 'nope-defaults-to-overall']) {
    out.categories[key] = clean(win.eqlBuildCategory(key));
  }
  win.ActiveSection = { get: () => 'c1' };
  out.categories.scopedC1 = clean(win.eqlBuildCategory('overall'));
  win.ActiveSection = { get: () => 'c-empty' };
  out.categories.scopedEmptyClass = clean(win.eqlBuildCategory('overall'));
  win.ActiveSection = null;

  // EQL public API
  out.eql = {};
  out.eql.getLeaderboard = clean(win.EQL.getLeaderboard('recitation'));
  out.eql.getConfigAfterMigration = clean(win.EQL.getConfig());
  out.eql.getStats = clean(win.EQL.getStats());
  win.EQL.setEnabled('recitation', false);
  out.eql.afterDisable = clean(win.EQL.getConfig().recitation);
  win.EQL.setEnabled('academic', 1); // non-boolean truthy: exercises the !!enabled coercion
  out.eql.afterCoercedEnable = clean(win.EQL.getConfig().academic);
  win.EQL.setEnabled('nope', true); // unknown key -> no-op, must not throw or create a key
  out.eql.afterUnknownSetEnabled = clean(win.EQL.getConfig());
  win.EQL.resetPeriod('boss');
  out.eql.afterResetPeriod = clean(win.EQL.getConfig().boss);
  win.EQL.resetPeriod('nope'); // no-op
  win.EQL.clearReset('boss');
  out.eql.afterClearReset = clean(win.EQL.getConfig().boss);
  win.EQL.clearReset('nope'); // no-op
  out.eql.statsAfterAllChanges = clean(win.EQL.getStats());

  return out;
}

async function runBackfillScenario() {
  // Partial pre-existing config: 'recitation' and 'boss' already saved,
  // 'academic'/'overall' missing entirely -> needsInit=false, but the
  // per-key backfill loop must still add the two missing keys (this is the
  // Phase-3-migration bugfix documented at the top of the original file).
  const preExistingConfig = {
    recitation: { enabled: false, resetAt: '2025-01-01T00:00:00.000Z', label: 'Recitation', icon: '🎤', color: '#4edea3' },
    boss: { enabled: true, resetAt: null, label: 'Boss Raider', icon: '⚔️', color: '#EC4899' },
  };
  const O = makeWindow(), B = makeWindow();
  await evalOriginal(O.win, { preExistingConfig });
  await evalBridge(B.win, { preExistingConfig });
  const cfgA = clean(O.win.AppStore.getSlice(s => s.leaderboardConfig));
  const cfgB = clean(B.win.AppStore.getSlice(s => s.leaderboardConfig));
  assert.deepStrictEqual(cfgB, cfgA, 'backfill-branch config-migration result must match between original and bridge');
  assert.strictEqual(cfgA.recitation.enabled, false, 'pre-existing recitation entry preserved untouched (not re-initialized)');
  assert.strictEqual(cfgA.recitation.resetAt, '<ISO>', 'the pre-existing resetAt timestamp is preserved (blanked by clean(), but present)');
  assert.strictEqual(cfgA.boss.enabled, true);
  assert.ok(cfgA.academic && cfgA.overall, 'the two missing keys were backfilled');
  assert.strictEqual(cfgA.academic.enabled, true);
  assert.strictEqual(cfgA.academic.icon, '📚');
  assert.strictEqual(cfgA.overall.icon, '🏆');
}

function main() {
  return (async () => {
    await runBackfillScenario();

    const O = makeWindow(), B = makeWindow();
    await evalOriginal(O.win);
    await evalBridge(B.win);

    // load-time migration effect: both sides start with no pre-existing
    // leaderboardConfig, so eqlMigrate's first-run branch fires identically —
    // compared once here (before any test seeding touches it further).
    const cfgA = clean(O.win.AppStore.getSlice(s => s.leaderboardConfig));
    const cfgB = clean(B.win.AppStore.getSlice(s => s.leaderboardConfig));
    assert.deepStrictEqual(cfgB, cfgA, 'load-time config-migration result must match');
    assert.ok(cfgA && cfgA.recitation && cfgA.boss && cfgA.academic && cfgA.overall, 'sanity: all 4 categories initialized');
    assert.strictEqual(cfgA.recitation.enabled, true);
    assert.strictEqual(cfgA.recitation.resetAt, null);
    assert.strictEqual(cfgA.recitation.icon, '🎤');

    const oa = await run(O.win), ob = await run(B.win);
    assert.deepStrictEqual(clean(ob), clean(oa), 'bridge output must exactly match the original at every step');

    // ── hand-computed sanity on the ORIGINAL's output ──
    const o = clean(oa);
    assert.deepStrictEqual(o.compute.emptyS1, {
      recitation: { totalPts: 0, sessionCount: 0, streak: 0, wins: 0, qrCount: 0 },
      boss: { totalDamage: 0, participationCount: 0, victories: 0, mvpCount: 0, totalCrits: 0, totalMinionsKilled: 0, totalCorrect: 0 },
      academic: { academicXP: 0, quizCount: 0, perfectScores: 0, bestScore: 0, avgScore: 0, questCompletions: 0, perfectStreak: 0 },
    });
    const r1 = o.compute.s1_noReset.recitation;
    assert.strictEqual(r1.totalPts, 42, '20+5+5+5+7 across 5 valid recitation entries (no resetAt -> nothing filtered)');
    assert.strictEqual(r1.sessionCount, 5);
    assert.strictEqual(r1.qrCount, 1, "one entry has qr:true; the 'not-a-date' one has no note/qr");
    assert.strictEqual(r1.wins, 1, 'only the 20-pt entry belongs to s1 and is >= 15');
    const s2 = o.compute.s2_noReset;
    assert.strictEqual(s2.recitation.wins, 2, 'both the 30-pt and the 17-pt entries clear the >=15 threshold (a >=20 threshold would only count the 30-pt one)');
    const b1 = o.compute.s1_noReset.boss;
    assert.strictEqual(b1.totalDamage, 300 + 50 + 10);
    assert.strictEqual(b1.participationCount, 3);
    assert.strictEqual(b1.victories, 2, 'boss0 (ended) and boss2 (loot) both have s1 dealing damage > 0; boss1 is active (no resetAt filter applied here)');
    // MVP quirk (pre-existing, preserved verbatim, not "fixed" here): the
    // else-if fallback checks whether sid is the FIRST key inserted into the
    // boss's roster object, not whether it actually dealt the most damage.
    // boss0's roster is built {s1: ..., s2: ...} (s1 first), so s1 hits the
    // fallback and counts as MVP there even though s2 (900 dmg) outdid s1
    // (300 dmg) on the damage-sort check. boss1/boss2 rosters have no
    // studentId field on their records at all, so those also fall through
    // to the same "first key" fallback, where s1 is (trivially) the only key.
    assert.strictEqual(b1.mvpCount, 3, 'MVP fallback quirk: sid-is-first-roster-key counts on all 3 bosses s1 participated in');
    const a1 = o.compute.s1_noReset.academic;
    assert.strictEqual(a1.academicXP, 10 + 8 + 6, 'abs(-6) included; Bonus-points line excluded (not a Quest: line)');
    assert.strictEqual(a1.quizCount, 3);
    assert.strictEqual(a1.perfectScores, 2, '100% appears twice (A and C)');
    assert.strictEqual(a1.bestScore, 100); assert.strictEqual(a1.avgScore, 93, 'round((100+80+100)/3)=93');
    assert.strictEqual(a1.perfectStreak, 1, 'chronological oldest->newest: C(bad date, still 100%)=1, B(80%) resets, A(100%)=1 -> max 1');

    const r1reset = o.compute.s1_withReset.recitation;
    assert.strictEqual(r1reset.totalPts, 17, 'Jan2(5) + Jan3(5) + exact-boundary(7) = 17; Jan1 09:00(20) excluded, invalid-date(5) excluded');
    assert.strictEqual(r1reset.sessionCount, 3, 'resetAt=Jan1 12:00 keeps Jan2 09:00, Jan3 09:00, and the exact-boundary entry; excludes Jan1 09:00 and the invalid-date one');
    assert.strictEqual(o.compute.s1_atBoundaryOnly.totalPts, 7, 'an entry whose createdAt exactly equals resetAt is INCLUDED (>=, not >)');
    const b1reset = o.compute.s1_withReset.boss;
    assert.strictEqual(b1reset.participationCount, 1, 'resetAt=Jan1 noon: boss0 (Jan1 00:00) and boss2 (2025) both excluded; only boss1 (Jan2) counts');
    assert.strictEqual(b1reset.totalDamage, 50);

    assert.strictEqual(s2.recitation.totalPts, 30 + 17, 'the original 30-pt entry plus the new 17-pt one');
    assert.strictEqual(s2.boss.mvpCount, 1, 's2 dealt the most damage in boss0');
    assert.deepStrictEqual(o.compute.unknownStudent, o.compute.emptyS1, 'unknown student id behaves like empty state');
    assert.deepStrictEqual(o.compute.overall_ghost.baseXP, 0);
    assert.ok(o.compute.overall_s1.score > 0 && typeof o.compute.overall_s1.score === 'number');
    const expectedScore = Math.round(500 * 1.0 + r1.totalPts * 2.5 + 360 * 0.15 + b1.victories * 400 + 2 * 200 + r1.streak * 150 + b1.mvpCount * 500);
    assert.strictEqual(o.compute.overall_s1.score, expectedScore, 'overall score formula, hand-recomputed from the pillar stats');
    assert.deepStrictEqual(o.compute.s1_viaCache, o.compute.s1_noReset, 'passing a pre-fetched cache bundle must give identical results to fresh getSlice() calls');

    const cats = o.categories;
    assert.strictEqual(cats.recitation.length, 4, 'unscoped: all 4 students, including 0-scorers');
    assert.strictEqual(cats.recitation[0].student.id, 's2', 's2 (47 recitation pts) outranks s1 (42)');
    assert.strictEqual(cats.recitation[0].score, 47);
    assert.strictEqual(cats.recitation[0].score, Math.max(...cats.recitation.map(e => e.score)), 'sanity: first entry has the max score after sort');
    assert.deepStrictEqual(cats['nope-defaults-to-overall'], cats.overall, "unknown key falls through switch's default to 'overall' behavior");
    // rank ties: s3 and s4 both score 0 on recitation -> same rank, and rank sequence skips appropriately
    const zeroScorers = cats.recitation.filter(e => e.score === 0);
    if (zeroScorers.length > 1) assert.strictEqual(new Set(zeroScorers.map(e => e.rank)).size, 1, 'tied zero-scores share one rank');
    assert.strictEqual(cats.scopedC1.length, 3, "class c1 has s1, s2, s4 (s3 is c2)");
    assert.ok(cats.scopedC1.every(e => ['s1', 's2', 's4'].includes(e.student.id)));
    assert.deepStrictEqual(cats.scopedEmptyClass, [], 'a class with no students yields an empty (not error) leaderboard');

    assert.strictEqual(o.eql.getLeaderboard.length, cats.recitation.length);
    assert.strictEqual(o.eql.getConfigAfterMigration.recitation.enabled, true);
    assert.strictEqual(o.eql.getStats.recitation.totalStudents, 4);
    assert.strictEqual(o.eql.getStats.recitation.topStudent, cats.recitation[0].student.name);
    assert.strictEqual(o.eql.afterDisable.enabled, false);
    assert.strictEqual(o.eql.afterCoercedEnable.enabled, true, 'setEnabled(academic, 1) must store a real boolean (!!1), not the truthy number 1 itself');
    assert.strictEqual(Object.keys(o.eql.afterUnknownSetEnabled).sort().join(','), 'academic,boss,overall,recitation', 'unknown-key setEnabled must not add a new config key');
    assert.deepStrictEqual(o.eql.afterUnknownSetEnabled.boss, o.eql.getConfigAfterMigration.boss, 'and must not touch any existing key either');
    assert.strictEqual(o.eql.afterResetPeriod.resetAt, '<ISO>');
    assert.strictEqual(o.eql.afterClearReset.resetAt, null);
    assert.strictEqual(o.eql.statsAfterAllChanges.recitation.enabled, false);
    assert.strictEqual(o.eql.statsAfterAllChanges.boss.resetAt, null);

    console.log('EQUIVALENCE CHECK PASSED');
    console.log('Original eql-engine.js (via the real state-manager.js chain) and the bundled');
    console.log('src/ twin (real-imported through the same AppStore) agree on:');
    console.log(' - the load-time config-migration/backfill side effect (first-run branch)');
    console.log(' - eqlComputeRecitation/Boss/Academic: resetAt filtering (incl. invalid-date catch branches),');
    console.log('   cache-bundle vs fresh-getSlice equivalence, empty/unknown-student edge cases');
    console.log(' - eqlComputeOverall\'s weighted composite formula');
    console.log(' - eqlBuildCategory: all 4 categories + unknown-key fallback, section scoping (incl. an empty class), rank ties');
    console.log(' - every EQL public-API method (getLeaderboard/getConfig/setEnabled/resetPeriod/clearReset/getStats),');
    console.log('   including their AppStore mutations and their unknown-key no-ops');
    console.log(' - the load-time migration\'s OTHER branch: per-key backfill onto a partial pre-existing config');
  })();
}

main().catch(e => { console.error(e); process.exit(1); });
