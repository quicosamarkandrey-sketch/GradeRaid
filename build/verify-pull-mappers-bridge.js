// Phase 7 (Stream A) — equivalence check for repository/pull-mappers.js.
// 32 pure data-transform functions, no DOM/browser APIs needed — tested
// directly in Node via a minimal vm context, not jsdom.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ALL_32 = [
  '_legacyRoleFromDbRole', '_HISTORY_LIMITS', '_deriveStudents', '_deriveAdmin',
  '_deriveEquippedTitles', '_deriveBossEvents', '_deriveBossParticipants',
  '_deriveAchievements', '_deriveAchievementUnlocks', '_deriveTitles',
  '_deriveTitleUnlocks', '_deriveTitleSectionAssignments', '_deriveQuizzes',
  '_deriveCampaignWorlds', '_deriveCampaignSectionAssignments', '_deriveMail',
  '_deriveQuizSectionAssignments', '_deriveAchievementSectionAssignments',
  '_deriveInventory', '_deriveQuizHistory', '_deriveStudentSkills',
  '_derivePointLog', '_deriveRedemptions', '_deriveOrders', '_deriveNotifications',
  '_deriveRecitationLog', '_deriveRecitationSessions', '_deriveRfidCards',
  '_deriveAttendanceSchedules', '_deriveAttendanceLogs', '_deriveStore',
  '_deriveRegistrations',
];

function makeContext() {
  const ctx = { window: {}, console, Date, Array, Object, Set, JSON, Math };
  ctx.window = ctx; // classic-script self-reference (bare globals ARE window props)
  vm.createContext(ctx);
  return ctx;
}

function runInContext(src, ctx) {
  new vm.Script(src).runInContext(ctx);
}

function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'repository', 'pull-mappers.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'pull-mappers.bridge.js'), 'utf8');

  // Bridge is an ESM bundle (IIFE format from esbuild) — real Node vm can
  // run it directly since esbuild already compiled away the import/export
  // syntax into the IIFE. Confirmed by inspecting dist/bridges/pull-
  // mappers.bridge.js before writing this check: it's a plain IIFE, no
  // remaining import/export keywords.

  for (const [label, src] of [['ORIGINAL', originalSrc], ['BRIDGE', bridgeSrc]]) {
    console.log(`\n=== ${label} ===`);
    const ctx = makeContext();
    runInContext(src, ctx);

    // Completeness: all 32 present.
    const missing = ALL_32.filter((name) => typeof ctx[name] === 'undefined');
    assert.deepStrictEqual(missing, [], `${label}: all 32 exports must be present on window`);
    console.log('  all 32 exports present: OK');

    ctx.__results = {};

    // 1. _legacyRoleFromDbRole — simple mapping, all 3 branches + unknown input.
    ctx.__results.role1 = ctx._legacyRoleFromDbRole('admin');
    ctx.__results.role2 = ctx._legacyRoleFromDbRole('teacher');
    ctx.__results.role3 = ctx._legacyRoleFromDbRole('student');
    ctx.__results.role4 = ctx._legacyRoleFromDbRole('something-unexpected');

    // 2. _deriveAdmin — the DEFAULT_DB-guarded fallback path specifically.
    //    Case A: DEFAULT_DB undefined (typeof guard), no admin row, no previousAdmin -> null.
    ctx.__results.admin_noFallback = ctx._deriveAdmin([], null);
    //    Case B: DEFAULT_DB undefined, real admin row present, no previousAdmin pass -> falls to 'admin123' literal.
    ctx.__results.admin_realRowNoDefault = ctx._deriveAdmin(
      [{ id: 'u1', role: 'admin', display_name: 'Ms. Cruz' }], null
    );
    //    Case C: previousAdmin already has a pass -> that wins over any fallback.
    ctx.__results.admin_prevPassWins = ctx._deriveAdmin(
      [{ id: 'u1', role: 'teacher', display_name: 'Mr. Reyes' }],
      { pass: 'existing-pass' }
    );

    // 3. _deriveEquippedTitles — filters correctly by role AND presence of equipped_title_id.
    ctx.__results.equippedTitles = ctx._deriveEquippedTitles([
      { id: 's1', role: 'student', equipped_title_id: 't5' },
      { id: 's2', role: 'student', equipped_title_id: null },
      { id: 's3', role: 'admin', equipped_title_id: 't9' }, // wrong role, must be excluded
    ]);

    // 4. _deriveBossEvents — complex object mapping: sorting by date,
    //    Date.parse conversions, defaults, index assignment.
    const bossResult = ctx._deriveBossEvents([
      { id: 'b2', created_at: '2026-01-02T00:00:00Z', name: 'Later Boss', class_id: null, status: 'active' },
      { id: 'b1', created_at: '2026-01-01T00:00:00Z', name: 'Earlier Boss', class_id: 'sec_1', status: 'defeated', defeated_at: '2026-01-05T00:00:00Z' },
    ], []);
    const bossArr = bossResult.bossEventsArr;
    ctx.__results.bossEventNames = bossArr.map((b) => b.name); // must be sorted by date
    ctx.__results.bossEventDefaultClassId = bossArr.find((b) => b.name === 'Later Boss').classId; // must default to 'default-class'
    ctx.__results.bossEventRealClassId = bossArr.find((b) => b.name === 'Earlier Boss').classId;
    ctx.__results.bossEventDefeatedAtIsNumber = typeof bossArr.find((b) => b.name === 'Earlier Boss').defeatedAt === 'number';
    ctx.__results.bossEventNoDefeatedAtIsNull = bossArr.find((b) => b.name === 'Later Boss').defeatedAt;
    ctx.__results.bossIdByIdMapping = bossResult.bossIdById; // {b2: 0, b1: 1} — sorted-order index map

    // 5. _deriveAchievements / _deriveAchievementUnlocks — simple array pass, empty-input safety.
    ctx.__results.achievementsEmpty = ctx._deriveAchievements([]);
    ctx.__results.achievementsNull = ctx._deriveAchievements(null); // must not throw on null input

    // 6. _HISTORY_LIMITS — a data constant, must match exactly.
    ctx.__results.historyLimitsKeys = Object.keys(ctx._HISTORY_LIMITS).sort();
    ctx.__results.historyLimitsSample = ctx._HISTORY_LIMITS[ctx.__results.historyLimitsKeys[0]];

    console.log('  ran 6 functional test groups across the 32 exports: OK');

    if (label === 'ORIGINAL') global.__originalResults = JSON.parse(JSON.stringify(ctx.__results));
    else global.__bridgeResults = JSON.parse(JSON.stringify(ctx.__results));
  }

  assert.deepStrictEqual(global.__bridgeResults, global.__originalResults, 'bridge results must exactly match original results across every test group');

  // Sanity checks on the ORIGINAL's actual values, so a bug that exists
  // identically in both builds still gets caught.
  assert.strictEqual(global.__originalResults.role1, 'admin');
  assert.strictEqual(global.__originalResults.role4, 'student', 'sanity: unrecognized role must default to student');
  assert.strictEqual(global.__originalResults.admin_noFallback, null, 'sanity: no row + no previousAdmin + no DEFAULT_DB -> null');
  assert.strictEqual(global.__originalResults.admin_realRowNoDefault.pass, 'admin123', 'sanity: DEFAULT_DB undefined must fall through to the "admin123" literal, not throw');
  assert.strictEqual(global.__originalResults.admin_prevPassWins.pass, 'existing-pass', 'sanity: an existing previousAdmin.pass must win over any fallback');
  assert.deepStrictEqual(global.__originalResults.equippedTitles, { s1: 't5' }, 'sanity: only the qualifying student row should appear');
  assert.deepStrictEqual(global.__originalResults.bossEventNames, ['Earlier Boss', 'Later Boss'], 'sanity: boss events must be sorted oldest-first');
  assert.strictEqual(global.__originalResults.bossEventDefaultClassId, 'default-class');
  assert.strictEqual(global.__originalResults.bossEventRealClassId, 'sec_1');
  assert.strictEqual(global.__originalResults.bossEventDefeatedAtIsNumber, true);
  assert.strictEqual(global.__originalResults.bossEventNoDefeatedAtIsNull, null);
  assert.deepStrictEqual(global.__originalResults.bossIdByIdMapping, { b1: 0, b2: 1 }, 'sanity: bossIdById maps id -> sorted-order index (b1 sorts first, Jan 1 < Jan 2)');
  assert.deepStrictEqual(global.__originalResults.achievementsEmpty, []);
  assert.deepStrictEqual(global.__originalResults.achievementsNull, [], 'sanity: null input must not throw, must return []');

  console.log('\nEQUIVALENCE CHECK PASSED');
}

main();
