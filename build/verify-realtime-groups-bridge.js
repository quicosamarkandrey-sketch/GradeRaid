// Phase 7 (Stream A) — equivalence check for repository/realtime-groups.js.
// The original file's own header states this has NO existing unit-test
// coverage anywhere in the codebase — this is the first real behavioral
// verification it's had. Structural completeness across ALL groups, plus
// deep fetch+apply testing on 4 representative groups (profiles:
// cache-dependent apply; raid: compound destructured return;
// achievements: simplest case; pointLog: uses _HISTORY_LIMITS in fetch()).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function makeContext() {
  const ctx = { window: {}, console, Promise, Object, Array, Date };
  ctx.window = ctx;
  vm.createContext(ctx);
  return ctx;
}

function runInContext(src, ctx) {
  new vm.Script(src).runInContext(ctx);
}

function makeFakeClient(fixtures) {
  function chainableWithData(table) {
    const p = Promise.resolve({ data: fixtures[table] || [] });
    p.order = () => p;
    p.limit = () => p;
    return p;
  }
  return { from: (table) => ({ select: () => chainableWithData(table) }) };
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'repository', 'realtime-groups.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'realtime-groups.bridge.js'), 'utf8');
  const pullMappersSrc = fs.readFileSync(path.join(__dirname, '..', 'repository', 'pull-mappers.js'), 'utf8');

  const results = {};
  for (const [label, src, needsPullMappers] of [['original', originalSrc, true], ['bridge', bridgeSrc, false]]) {
    console.log(`\n=== ${label} ===`);
    const ctx = makeContext();
    if (needsPullMappers) runInContext(pullMappersSrc, ctx);
    runInContext(src, ctx);

    const groupNames = Object.keys(ctx._REFRESH_GROUPS);
    const structOk = groupNames.every((g) => typeof ctx._REFRESH_GROUPS[g].fetch === 'function' && typeof ctx._REFRESH_GROUPS[g].apply === 'function');
    const allTablesMapToRealGroups = Object.values(ctx._REALTIME_TABLE_GROUPS).every((g) => groupNames.includes(g));
    results[`${label}_groupCount`] = groupNames.length;
    results[`${label}_structOk`] = structOk;
    results[`${label}_allTablesMapToRealGroups`] = allTablesMapToRealGroups;
    results[`${label}_tableGroupsJSON`] = JSON.stringify(ctx._REALTIME_TABLE_GROUPS);
    console.log('  structural completeness:', groupNames.length, 'groups, all valid:', structOk, allTablesMapToRealGroups);

    const client = makeFakeClient({ profiles: [{ id: 'u1', role: 'student', display_name: 'Ana' }] });
    const profRaw = await ctx._REFRESH_GROUPS.profiles.fetch(client);
    const profApplied = ctx._REFRESH_GROUPS.profiles.apply(profRaw, { quizHistory: {}, admin: null });
    results[`${label}_profiles`] = JSON.stringify(profApplied);

    const raidClient = makeFakeClient({
      boss_events: [{ id: 'b1', created_at: '2026-01-01T00:00:00Z', name: 'Test Boss', status: 'active' }],
      boss_participants: [{ id: 'p1', boss_event_id: 'b1', student_id: 'u1', damage_dealt: 50 }],
      loot_claims: [],
    });
    const raidRaw = await ctx._REFRESH_GROUPS.raid.fetch(raidClient);
    const raidApplied = ctx._REFRESH_GROUPS.raid.apply(raidRaw);
    results[`${label}_raid`] = JSON.stringify(raidApplied);

    const achClient = makeFakeClient({
      achievements: [{ id: 'a1', name: 'First Steps' }],
      user_achievements: [{ id: 'ua1', achievement_id: 'a1', student_id: 'u1' }],
    });
    const achRaw = await ctx._REFRESH_GROUPS.achievements.fetch(achClient);
    const achApplied = ctx._REFRESH_GROUPS.achievements.apply(achRaw);
    results[`${label}_achievements`] = JSON.stringify(achApplied);

    const plClient = makeFakeClient({ point_log: [{ id: 'pl1', student_id: 'u1', points: 10 }] });
    const plRaw = await ctx._REFRESH_GROUPS.pointLog.fetch(plClient);
    const plApplied = ctx._REFRESH_GROUPS.pointLog.apply(plRaw);
    results[`${label}_pointLog`] = JSON.stringify(plApplied);

    console.log('  profiles/raid/achievements/pointLog fetch+apply: ran without throwing');
  }

  const pairs = ['groupCount', 'structOk', 'allTablesMapToRealGroups', 'tableGroupsJSON', 'profiles', 'raid', 'achievements', 'pointLog'];
  for (const p of pairs) {
    assert.strictEqual(results[`bridge_${p}`], results[`original_${p}`], `${p}: bridge must match original exactly`);
  }

  assert.strictEqual(results.original_structOk, true, 'sanity: every group must have both fetch and apply');
  assert.strictEqual(results.original_allTablesMapToRealGroups, true, 'sanity: every table must map to a real group');
  assert.ok(results.original_groupCount >= 15, 'sanity: should have a substantial number of refresh groups');
  const raidParsed = JSON.parse(results.original_raid);
  assert.strictEqual(raidParsed.bossEvents[0].name, 'Test Boss');
  assert.ok('_bossIdById' in raidParsed, 'sanity: raid apply must expose _bossIdById for cross-referencing');
  const achParsed = JSON.parse(results.original_achievements);
  assert.strictEqual(achParsed.achievements.length, 1);
  const plParsed = JSON.parse(results.original_pointLog);
  assert.strictEqual(plParsed.pointLog.length, 1);

  console.log('\nEQUIVALENCE CHECK PASSED');
}

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
