// Phase 7 (Stream A) — equivalence check for db-migrations.js.
//
// Real-imports DEFAULT_DB (only) from this stream's own db-schema.js —
// which itself real-imports DBService from db-service.js, which
// real-imports table-sync.js -> AppStore (state-manager.js), the same
// transitive chain already documented for db-schema.js's own verify
// script. ORIGINAL side evals the full real chain in dependency order;
// BRIDGE side evals the single self-contained esbuild bundle
// (dist/bridges/db-migrations.bridge.js), which inlines its own copies
// of that whole chain.
//
// IMPORTANT — `saveDB` is deliberately NOT real-imported (see this
// file's own src/db-migrations.js header for the full story): a first
// pass DID real-import it, and this verify script is what caught the
// bug — state-manager.js reassigns `window.saveDB` at runtime, once
// AppStore finishes booting, to a shim that no longer matches
// db-schema.js's original body. A real import would have permanently
// bypassed that shim. Because saveDB is window-fallback on both sides
// now, a plain `win.saveDB = spy` monkey-patch (see spyOnSaveDB()) works
// symmetrically — no special-casing needed, unlike the DEFAULT_DB real
// import, which this script never overrides with a test double (per the
// documented "manual win.X stub is ignored once X is real-imported"
// gotcha) and never asserts against a hand-picked value either — both
// sides read the SAME real static data from db-schema.js regardless of
// classic-eval vs. esbuild-bundle packaging, so an equivalence
// comparison between the two sides is valid without knowing the content
// in advance.
//
// `DB` itself stays a plain window global for this test (not real-
// imported by this file at all — see this file's src header) — set
// directly via `win.DB = {...}` before each call, read back after.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html></html>', { runScripts: 'dangerously', url: 'https://example.org/app/index.html' });
  const win = dom.window;
  win.__EDUQUEST_SUPABASE_URL__ = '';
  win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };
  win.DBService = { initRemote: async () => {}, read: () => null, write: () => {} };
  let uidCounter = 0;
  win.uid = () => 'UID' + (++uidCounter);
  return win;
}

async function evalFullOriginalChain(win) {
  const files = ['supabase-client.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'repository/table-sync.js', 'db-service.js', 'modules/core/state-manager.js', 'db-schema.js', 'db-migrations.js'];
  for (const f of files) win.eval(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
  await win.AppStore.ready;
}

async function evalBridge(win) {
  const supabaseClientSrc = fs.readFileSync(path.join(__dirname, '..', 'supabase-client.js'), 'utf8');
  win.eval(supabaseClientSrc);
  // makeWindow() already pre-set win.DBService as a stub — same
  // ordering-inversion shim documented for db-service.js's own verify
  // script: this bundle transitively includes state-manager.js (via
  // db-service.js -> table-sync.js's real AppStore import), whose eager
  // init() does a synchronous `DBService` check BEFORE this combined
  // test bundle's own `window.DBService = DBService;` line runs (ES
  // module evaluation runs all imported modules' top-level code first).
  // Uses build/test-helpers/db-migrations-combined-bundle.js (NOT the
  // production db-migrations.bridge.js) so this script can read the
  // SAME real DBService instance saveDB()/loadDB() actually go through
  // — see that combined-entry file's own header for why.
  const bridgeSrc = fs.readFileSync(path.join(__dirname, 'test-helpers', 'db-migrations-combined-bundle.js'), 'utf8');
  win.eval(bridgeSrc);
  await sleep(30);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function spyOnSaveDB(win) {
  // saveDB is a plain window-fallback bare identifier on BOTH sides now
  // (see this file's src header for why it's deliberately NOT a real
  // import) — a simple window monkey-patch works symmetrically here,
  // unlike the DBService.write() case this replaced. Whatever saveDB
  // currently resolves to (db-schema.js's original, or state-manager.js's
  // runtime-installed "Legacy Bridge" shim once AppStore has booted —
  // see MEMORY.md) is irrelevant for this check: we only care whether
  // runMigrations() called it, not which implementation was live.
  const real = win.saveDB;
  let count = 0;
  win.saveDB = function () { count++; return real.apply(win, arguments); };
  return {
    count: () => count,
    restore: () => { win.saveDB = real; },
  };
}

function freshDirtyDB(overrides) {
  return Object.assign({
    admin: { id: 'admin1', name: 'Root Admin' },
    students: [{ id: 's1', name: 'Ana Cruz' }, { id: 's2', name: 'Solo' }],
    store: [{ id: 'item1', emoji: '🧣', cat: 'gear' }],
    redemptions: [
      { itemId: 'item1', itemName: 'Cape of Focus', studentId: 's1', date: '2026-01-01' },
      { itemId: 'item1', itemName: 'Cape of Focus', studentId: 's1', date: '2026-01-02' },
      { itemId: 'no-such-item', itemName: 'Mystery Box', studentId: 's2', date: '2026-01-03' },
    ],
    achievementUnlocks: { s1: [{ id: 'a1', unlockedAt: '2026-01-01T00:00:00.000Z' }, { id: 'a2' }] },
    titles: [{ id: 'title-real' }],
    titleUnlocks: { s1: ['title-real', 'title-orphan'] },
    equippedTitles: { s1: 'title-orphan', s2: 'title-real' },
    pointLog: [{ id: undefined, studentId: 's1', what: 'Quest: X (50%)', pts: 10 }, { id: 'already-has-id', studentId: 's1', what: 'y', pts: 1 }],
    recitationLog: [{ id: undefined, studentId: 's1' }],
  }, overrides || {});
}

async function runScenarios(win) {
  const results = {};

  // --- Scenario 1: fully-fresh/legacy DB (almost everything missing) ---
  win.DB = freshDirtyDB();
  const spy1 = spyOnSaveDB(win);
  win.runMigrations();
  const saveCallCount1 = spy1.count();
  spy1.restore();
  results.freshMigration = {
    schemaVersion: win.DB.schemaVersion,
    guardedArraysPresent: ['attendanceSessions', 'recitationLog', 'pointLog', 'achievements', 'titles', 'redemptions', 'stageProgress', 'bossEvents', 'bossParticipants', 'bossLibrary', 'animationLibrary', 'orders', 'mail', 'promotions', 'registrations', 'notifications'].every(k => win.DB[k] !== undefined),
    stageMapIsArray: Array.isArray(win.DB.stageMap),
    achClaimMigrated: win.DB._achClaimMigrated,
    achievementsClaimedFilledIn: win.DB.achievementUnlocks.s1.every(u => u.claimed === true && !!u.claimedAt),
    achievementsClaimedAtPreserved: win.DB.achievementUnlocks.s1[0].claimedAt === '2026-01-01T00:00:00.000Z',
    inventoryMigrated: win.DB._inventoryMigrated,
    inventoryS1: win.DB.inventory.s1,
    achievementCategories: win.DB.achievementCategories,
    titleUnlocksOrphanRemoved: win.DB.titleUnlocks.s1,
    equippedTitleOrphanCleared: win.DB.equippedTitles.s1,
    equippedTitleValidKept: win.DB.equippedTitles.s2,
    adminProfileBootstrapped: {
      firstName: win.DB.admin.firstName, lastName: win.DB.admin.lastName,
      displayName: win.DB.admin.displayName, email: win.DB.admin.email,
      hasJoinDate: !!win.DB.admin.joinDate, hasProfilePic: win.DB.admin.profilePic === '',
    },
    studentSoloSingleNameFirstLast: { firstName: win.DB.students[1].firstName, lastName: win.DB.students[1].lastName },
    wave1BackfillMigrated: win.DB._wave1IdBackfillMigrated,
    pointLogIdsAllPresent: win.DB.pointLog.every(p => !!p.id),
    pointLogPreexistingIdUntouched: win.DB.pointLog[1].id === 'already-has-id',
    recitationLogIdsAllPresent: win.DB.recitationLog.every(r => !!r.id),
    saveCountDelta: saveCallCount1,
  };

  // --- Scenario 2: calling again on the now-fully-migrated DB is a
  //     true no-op (idempotency) — no new saveDB() call. ---
  const spy2 = spyOnSaveDB(win);
  const snapshotBefore = JSON.stringify(win.DB);
  win.runMigrations();
  const saveCallCount2 = spy2.count();
  spy2.restore();
  results.idempotentSecondCall = {
    dbUnchanged: JSON.stringify(win.DB) === snapshotBefore,
    saveCountDelta: saveCallCount2,
  };

  // --- Scenario 3: schemaVersion below 3 gets bumped; a DB with
  //     everything else already present but schemaVersion 1 still marks
  //     dirty (isolates the schema-version guard from all the others). ---
  win.DB = freshDirtyDB();
  win.runMigrations(); // fully migrate first
  win.DB.schemaVersion = 1;
  const spy3 = spyOnSaveDB(win);
  win.runMigrations();
  const saveCallCount3 = spy3.count();
  spy3.restore();
  results.schemaVersionBump = {
    schemaVersion: win.DB.schemaVersion,
    saveCountDelta: saveCallCount3,
  };

  return results;
}

async function main() {
  const winO = makeWindow();
  await evalFullOriginalChain(winO);
  const resultOriginal = await runScenarios(winO);

  const winB = makeWindow();
  await evalBridge(winB);
  const resultBridge = await runScenarios(winB);

  // jsdom cross-realm gotcha (documented in the global rules / this
  // stream's MEMORY.md): compare via JSON.stringify rather than
  // assert.deepStrictEqual.
  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original at every step');

  // Sanity checks against the original's real values.
  assert.strictEqual(resultOriginal.freshMigration.schemaVersion, 3, 'sanity: schemaVersion bumped to 3');
  assert.strictEqual(resultOriginal.freshMigration.guardedArraysPresent, true, 'sanity: all simple array/object guards populated');
  assert.strictEqual(resultOriginal.freshMigration.stageMapIsArray, true, 'sanity: stageMap cloned from DEFAULT_DB');
  assert.strictEqual(resultOriginal.freshMigration.achClaimMigrated, true, 'sanity: achievement-claim migration ran');
  assert.strictEqual(resultOriginal.freshMigration.achievementsClaimedFilledIn, true, 'sanity: undefined .claimed backfilled true with a claimedAt');
  assert.strictEqual(resultOriginal.freshMigration.achievementsClaimedAtPreserved, true, 'sanity: pre-existing unlockedAt reused as claimedAt when present');
  assert.strictEqual(resultOriginal.freshMigration.inventoryMigrated, true, 'sanity: inventory migration ran');
  assert.strictEqual(resultOriginal.freshMigration.inventoryS1.length, 1, 'sanity: two redemptions of the same item merge into one inventory row');
  assert.strictEqual(resultOriginal.freshMigration.inventoryS1[0].quantity, 2, 'sanity: duplicate redemption increments quantity instead of duplicating the row');
  assert.strictEqual(resultOriginal.freshMigration.titleUnlocksOrphanRemoved.length, 1, 'sanity: orphaned title id removed from titleUnlocks');
  assert.strictEqual(resultOriginal.freshMigration.titleUnlocksOrphanRemoved[0], 'title-real', 'sanity: valid title id kept');
  assert.strictEqual(resultOriginal.freshMigration.equippedTitleOrphanCleared, null, 'sanity: equipped orphan title nulled out');
  assert.strictEqual(resultOriginal.freshMigration.equippedTitleValidKept, 'title-real', 'sanity: equipped valid title left alone');
  assert.strictEqual(resultOriginal.freshMigration.adminProfileBootstrapped.firstName, 'Root', 'sanity: admin firstName derived from name');
  assert.strictEqual(resultOriginal.freshMigration.adminProfileBootstrapped.lastName, 'Admin', 'sanity: admin lastName derived from name');
  assert.strictEqual(resultOriginal.freshMigration.studentSoloSingleNameFirstLast.firstName, 'Solo', 'sanity: single-word student name -> firstName only');
  assert.strictEqual(resultOriginal.freshMigration.studentSoloSingleNameFirstLast.lastName, '', 'sanity: single-word student name -> empty lastName, not undefined');
  assert.strictEqual(resultOriginal.freshMigration.wave1BackfillMigrated, true, 'sanity: wave-1 id backfill ran');
  assert.strictEqual(resultOriginal.freshMigration.pointLogIdsAllPresent, true, 'sanity: every pointLog row has an id after backfill');
  assert.strictEqual(resultOriginal.freshMigration.pointLogPreexistingIdUntouched, true, 'sanity: pre-existing pointLog id is not overwritten');
  assert.strictEqual(resultOriginal.freshMigration.saveCountDelta, 2, 'sanity: a genuinely dirty migration calls saveDB() twice — once from the title-orphan-cleanup block\'s own immediate conditional save (it has its own local dirty flag, separate from _migrationDirty), plus once from the final consolidated save');

  assert.strictEqual(resultOriginal.idempotentSecondCall.dbUnchanged, true, 'sanity: calling runMigrations() again on an already-migrated DB changes no DB values');
  // Pre-existing bug in the ORIGINAL, faithfully preserved (found via
  // this very check): the profile-bootstrap block's email/profilePic
  // guards do `if (!user.email) user.email = '';` — an empty string is
  // still falsy, so this guard (and its sibling for profilePic) can
  // NEVER be satisfied once a user has no email, and marks
  // _migrationDirty true on EVERY call forever, forcing a save each
  // time despite nothing actually changing. Not fixed here — the
  // conversion's job is behavioral equivalence, not bug fixes; both
  // sides reproduce it identically (see the deepStrictEqual above).
  assert.strictEqual(resultOriginal.idempotentSecondCall.saveCountDelta, 1, 'sanity: the email/profilePic guard bug means saveDB() fires again even on a fully-migrated DB');

  assert.strictEqual(resultOriginal.schemaVersionBump.schemaVersion, 3, 'sanity: schemaVersion alone re-bumped on a fully-migrated-otherwise DB');
  assert.strictEqual(resultOriginal.schemaVersionBump.saveCountDelta, 1, 'sanity: the schemaVersion guard alone is enough to trigger the consolidated save');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('db-migrations.js: every guard clause, the achievement-claim/inventory/title-orphan/profile-');
  console.log('bootstrap/wave-1-id-backfill migrations, the consolidated single-save behavior (including the');
  console.log('pre-existing email/profilePic non-idempotency bug, faithfully preserved not fixed), and the');
  console.log('title-orphan-cleanup block\'s own separate immediate save all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
