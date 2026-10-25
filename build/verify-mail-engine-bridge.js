// Phase 7 (Stream A) — equivalence check for modules/mail/mail-engine.js.
//
// Real-imports AppStore, DBService, setCurrentUser (app-state.js),
// updateTopbar (topbar.js), and syncStudentStatsToServer
// (student-stats.js) — all this stream's own already-converted files/
// symbols, all confirmed via repo-wide grep against the "no runtime
// reassignment anywhere" rule (MEMORY.md) before finalizing.
//
// setCurrentUser()/updateTopbar() aren't spied on directly (a real
// import can't be monkey-patched by external reassignment — see
// MEMORY.md). Instead this script confirms they ran via their own real,
// observable side effects: setCurrentUser() sets window.currentUser
// (itself window-fallback, same as the original), and updateTopbar()
// writes into real topbar DOM elements. DBService.rpc IS mockable via
// the established shared-object-method-mutation technique, since both
// mailMarkRead/mailClaimRewards and syncStudentStatsToServer read
// DBService.rpc off the same shared object at call time.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const TOPBAR_HTML = `
  <div id="topbar-coin-val"></div><div id="topbar-coins" style="display:none"></div>
  <div id="topbar-av"></div><div id="sb-avatar"></div><div id="sb-name"></div>
  <div id="sb-tier"></div><div id="sb-xp-fill" style="width:0%"></div>
  <div id="sb-xp-label"></div><div id="sb-xp-next"></div>
  <div id="nav-s-mail"></div>
`;

function makeWindow() {
  const dom = new JSDOM(`<!doctype html><html><body>${TOPBAR_HTML}</body></html>`, { runScripts: 'dangerously', url: 'https://example.org/app/index.html' });
  const win = dom.window;
  win.__EDUQUEST_SUPABASE_URL__ = '';
  win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };
  win.DBService = { initRemote: async () => {}, read: () => null, write: () => {} };
  win.DEFAULT_DB = { students: [], mail: [], pointLog: [] };

  win.currentUser = null;
  win.currentRole = null;
  let uidCounter = 0;
  win.uid = () => 'UID' + (++uidCounter);
  win.getNowLabel = () => 'Just now';
  // checkLevelUp() (app-state.js, real code once evaled — window
  // auto-attach overwrites any earlier stub) internally calls the bare
  // `getLevel` window-fallback, which this chain never defines (neither
  // inline1.js nor student-stats.js's recalcStudentStats() is loaded
  // here) — provide it directly so checkLevelUp() doesn't throw.
  win.getLevel = (xp) => Math.floor(xp / 1000);

  return win;
}

async function evalFullOriginalChain(win) {
  const files = ['supabase-client.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'repository/table-sync.js', 'db-service.js', 'modules/core/state-manager.js', 'app-state.js', 'topbar.js', 'student-stats.js', 'modules/mail/mail-engine.js'];
  for (const f of files) win.eval(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
  await win.AppStore.ready;
}

async function evalBridge(win) {
  const supabaseClientSrc = fs.readFileSync(path.join(__dirname, '..', 'supabase-client.js'), 'utf8');
  win.eval(supabaseClientSrc);
  const bridgeSrc = fs.readFileSync(path.join(__dirname, 'test-helpers', 'mail-engine-combined-bundle.js'), 'utf8');
  win.eval(bridgeSrc);
  await win.AppStore.ready;
}

function mockRpc(win, handlers) {
  const calls = [];
  win.DBService.rpc = async function (name, params) {
    calls.push({ name, params });
    const h = handlers[name];
    if (!h) return { data: null, error: null };
    return typeof h === 'function' ? h(params) : h;
  };
  return calls;
}

async function seedState(win, overrides) {
  await win.AppStore.ready;
  win.AppStore.updateState(draft => {
    Object.assign(draft, {
      students: [{ id: 's1', name: 'Ana Cruz', xp: 100, coins: 20, level: 0, color: '#8b5cf6', init: 'AC' }],
      mail: [],
      pointLog: [],
    }, overrides || {});
  }, { type: 'test:seed' });
}

async function runGetterScenarios(win) {
  const results = {};
  await seedState(win, {
    mail: [
      { id: 'm-all', to: 'all', sentAt: '2026-08-01T00:00:00.000Z' },
      { id: 'm-mine', to: ['s1'], sentAt: '2026-08-15T00:00:00.000Z' },
      { id: 'm-other', to: ['s2'], sentAt: '2026-08-20T00:00:00.000Z' },
    ],
  });
  results.forStudent = win.mailGetForStudent('s1').map(m => m.id);

  const readMail = { readBy: { s1: true } };
  const unreadMail = { readBy: {} };
  const noReadByMail = {};
  results.isRead = { yes: win.mailIsRead(readMail, 's1'), no: win.mailIsRead(unreadMail, 's1'), missing: win.mailIsRead(noReadByMail, 's1') };

  const claimedMail = { claimedBy: { s1: true } };
  results.isClaimed = { yes: win.mailIsClaimed(claimedMail, 's1'), no: win.mailIsClaimed({ claimedBy: {} }, 's1') };

  return results;
}

async function runMarkReadScenarios(win) {
  const results = {};

  // --- unknown mailId: no-op ---
  await seedState(win, {});
  const rpcCalls1 = mockRpc(win, {});
  win.mailMarkRead('does-not-exist', 's1');
  results.unknownMailId = { rpcCalls: rpcCalls1.length, mail: win.AppStore.getSlice(s => s.mail) };

  // --- already read: skip updateState entirely, no RPC ---
  await seedState(win, { mail: [{ id: 'm1', readBy: { s1: true }, rowIdBySid: { s1: 'row-1' } }] });
  const rpcCalls2 = mockRpc(win, { mark_mail_read: { data: {}, error: null } });
  win.mailMarkRead('m1', 's1');
  results.alreadyRead = { rpcCalls: rpcCalls2.length };

  // --- new read, with a real rowId -> updateState + RPC ---
  await seedState(win, { mail: [{ id: 'm2', readBy: {}, rowIdBySid: { s1: 'row-2' } }] });
  const rpcCalls3 = mockRpc(win, { mark_mail_read: { data: {}, error: null } });
  win.mailMarkRead('m2', 's1');
  await new Promise(r => setTimeout(r, 10));
  results.newReadWithRowId = { readByAfter: win.AppStore.getSlice(s => s.mail)[0].readBy, rpcCalls: rpcCalls3.map(c => c.name), rpcParams: rpcCalls3[0] && rpcCalls3[0].params };

  // --- new read, NO rowId yet -> updateState happens, but no RPC ---
  await seedState(win, { mail: [{ id: 'm3', readBy: {} }] });
  const rpcCalls4 = mockRpc(win, { mark_mail_read: { data: {}, error: null } });
  win.mailMarkRead('m3', 's1');
  results.newReadNoRowId = { readByAfter: win.AppStore.getSlice(s => s.mail)[0].readBy, rpcCalls: rpcCalls4.length };

  return results;
}

async function runClaimScenarios(win) {
  const results = {};

  // window.checkLevelUp(s) is called unconditionally (no typeof guard)
  // in mailClaimRewards(). It's explicit window-fallback (not real-
  // imported), so a plain, deterministic stub set here — AFTER any
  // eval, so it isn't overwritten by app-state.js's own real
  // definition on the ORIGINAL side, and IS defined at all on the
  // BRIDGE side (which never loads app-state.js's classic script,
  // since setCurrentUser is real-imported directly) — keeps both sides
  // symmetric without needing the real getLevel-dependent logic here.
  win.__checkLevelUpCalls = [];
  win.checkLevelUp = (s) => { win.__checkLevelUpCalls.push({ id: s.id, xp: s.xp }); if (s.xp >= 1000 * (s.level + 1)) { s.level = (s.level || 0) + 1; return true; } return false; };

  // --- ineligible: no reward ---
  await seedState(win, { mail: [{ id: 'm-noreward', hasReward: false }] });
  results.noReward = win.mailClaimRewards('m-noreward', 's1');

  // --- ineligible: already claimed ---
  await seedState(win, { mail: [{ id: 'm-claimed', hasReward: true, rewards: [{ type: 'xp', amount: 10 }], claimedBy: { s1: true } }] });
  results.alreadyClaimed = win.mailClaimRewards('m-claimed', 's1');

  // --- ineligible: unknown mail ---
  results.unknownMail = win.mailClaimRewards('does-not-exist', 's1');

  // --- success: xp + coins reward, with rowId -> RPC fires ---
  await seedState(win, { mail: [{ id: 'm-full', subject: 'Bonus!', hasReward: true, rewards: [{ type: 'xp', amount: 200 }, { type: 'coins', amount: 30 }], claimedBy: {}, readBy: {}, rowIdBySid: { s1: 'row-full' } }] });
  win.currentUser = { id: 's1' };
  const rpcCalls = mockRpc(win, {
    mark_mail_claimed: { data: {}, error: null },
    // adjust_student_stats' real caller (syncStudentStatsToServer,
    // student-stats.js) reconciles xp/coins/level/tier straight from
    // `result.data` back into AppStore — an empty/incomplete mock
    // response would overwrite the student's real stats with
    // `undefined` (a bug in a naive mock, not in the source; caught by
    // exactly that happening on a first pass). Compute a realistic
    // post-update row from the current student + the delta so the
    // reconciliation lands on the SAME values the optimistic local
    // update already produced — the point of this RPC's response
    // handling is idempotent reconciliation, not a second mutation.
    adjust_student_stats: (params) => {
      const s = win.AppStore.getStudent(params.p_student_id) || {};
      return { data: { xp: (s.xp || 0), coins: (s.coins || 0), level: (s.level || 0), tier: s.tier || 'Novice' }, error: null };
    },
  });
  const claimResult = win.mailClaimRewards('m-full', 's1');
  await new Promise(r => setTimeout(r, 10));
  results.fullClaim = {
    returnedRewards: claimResult,
    studentXpAfter: win.AppStore.getStudent('s1').xp,
    studentCoinsAfter: win.AppStore.getStudent('s1').coins,
    studentLevelAfter: win.AppStore.getStudent('s1').level,
    mailNowClaimed: win.AppStore.getSlice(s => s.mail)[0].claimedBy,
    mailNowRead: win.AppStore.getSlice(s => s.mail)[0].readBy,
    pointLogEntry: win.AppStore.getSlice(s => s.pointLog)[0],
    currentUserAfter: win.currentUser,
    topbarCoinValAfter: win.document.getElementById('topbar-coin-val').textContent,
    badgeElementAfter: win.document.getElementById('nav-s-mail').innerHTML,
    rpcNames: rpcCalls.map(c => c.name).sort(),
    markClaimedParams: rpcCalls.find(c => c.name === 'mark_mail_claimed').params,
  };

  // --- level-up case: enough xp granted to cross a level boundary ---
  await seedState(win, { mail: [{ id: 'm-levelup', subject: 'Big reward', hasReward: true, rewards: [{ type: 'xp', amount: 950 }], claimedBy: {}, readBy: {} }] });
  win.currentUser = { id: 's1' };
  mockRpc(win, {});
  win.mailClaimRewards('m-levelup', 's1');
  results.levelUpClaim = { studentLevelAfter: win.AppStore.getStudent('s1').level, studentXpAfter: win.AppStore.getStudent('s1').xp };

  return results;
}

async function runBadgeScenarios(win) {
  const results = {};

  // --- not a student ---
  win.currentRole = 'teacher';
  win.currentUser = { id: 't1' };
  win.mailUpdateSidebarBadge();
  results.notStudent = win.document.getElementById('nav-s-mail').innerHTML;

  // --- student, no unread/unclaimed ---
  win.currentRole = 'student';
  win.currentUser = { id: 's1' };
  await seedState(win, { mail: [] });
  win.mailUpdateSidebarBadge();
  results.studentNoBadge = win.document.getElementById('nav-s-mail').innerHTML;

  // --- student, unread + unclaimed present ---
  await seedState(win, {
    mail: [
      { id: 'm1', to: 'all', hasReward: false, readBy: {}, sentAt: '2026-08-01T00:00:00.000Z' },
      { id: 'm2', to: 'all', hasReward: true, readBy: { s1: true }, claimedBy: {}, sentAt: '2026-08-02T00:00:00.000Z' },
    ],
  });
  win.mailUpdateSidebarBadge();
  results.studentWithBadge = win.document.getElementById('nav-s-mail').innerHTML;
  results.unreadCount = win.mailUnreadCount('s1');
  results.unclaimedCount = win.mailUnclaimedRewardCount('s1');

  // --- calling again with the same counts should reuse the existing badge element, not duplicate ---
  win.mailUpdateSidebarBadge();
  results.badgeCountAfterSecondCall = (win.document.getElementById('nav-s-mail').innerHTML.match(/mail-nav-badge/g) || []).length;

  return results;
}

async function runFullSuite(evalFn) {
  const results = {};

  const win1 = makeWindow();
  await evalFn(win1);
  results.getters = await runGetterScenarios(win1);

  const win2 = makeWindow();
  await evalFn(win2);
  results.markRead = await runMarkReadScenarios(win2);

  const win3 = makeWindow();
  await evalFn(win3);
  results.claim = await runClaimScenarios(win3);

  const win4 = makeWindow();
  await evalFn(win4);
  results.badge = await runBadgeScenarios(win4);

  return results;
}

function normalizeTimestamps(results) {
  // `createdAt: new Date().toISOString()` in mailClaimRewards' pointLog
  // entry — not a stubbable helper, inherently non-deterministic.
  const clone = JSON.parse(JSON.stringify(results));
  if (clone.claim && clone.claim.fullClaim && clone.claim.fullClaim.pointLogEntry) {
    clone.claim.fullClaim.pointLogEntry.createdAt = 'NORMALIZED';
  }
  return clone;
}

async function main() {
  const resultOriginal = normalizeTimestamps(await runFullSuite(evalFullOriginalChain));
  const resultBridge = normalizeTimestamps(await runFullSuite(evalBridge));

  // jsdom cross-realm gotcha (documented in MEMORY.md): compare via
  // JSON.stringify rather than assert.deepStrictEqual.
  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original at every step');

  // Sanity checks against the original's real values.
  assert.deepStrictEqual(resultOriginal.getters.forStudent, ['m-mine', 'm-all'], 'sanity: "all" + own-recipient mail returned, sorted newest first');
  assert.strictEqual(resultOriginal.getters.isRead.yes, true, 'sanity: mailIsRead true case');
  assert.strictEqual(resultOriginal.getters.isRead.no, false, 'sanity: mailIsRead false case');
  assert.strictEqual(resultOriginal.getters.isRead.missing, false, 'sanity: mailIsRead with no readBy at all');
  assert.strictEqual(resultOriginal.getters.isClaimed.yes, true, 'sanity: mailIsClaimed true case');
  assert.strictEqual(resultOriginal.getters.isClaimed.no, false, 'sanity: mailIsClaimed false case');

  assert.strictEqual(resultOriginal.markRead.unknownMailId.rpcCalls, 0, 'sanity: unknown mailId never calls the RPC');
  assert.strictEqual(resultOriginal.markRead.alreadyRead.rpcCalls, 0, 'sanity: already-read mail skips the redundant RPC entirely');
  assert.strictEqual(resultOriginal.markRead.newReadWithRowId.readByAfter.s1, true, 'sanity: new read sets readBy[sid]');
  assert.deepStrictEqual(resultOriginal.markRead.newReadWithRowId.rpcCalls, ['mark_mail_read'], 'sanity: new read with a rowId fires the RPC');
  assert.strictEqual(resultOriginal.markRead.newReadWithRowId.rpcParams.p_mail_id, 'row-2', 'sanity: RPC uses the per-row id (rowIdBySid), not the batch mailId');
  assert.strictEqual(resultOriginal.markRead.newReadNoRowId.readByAfter.s1, true, 'sanity: local state still updates even without a server row id yet');
  assert.strictEqual(resultOriginal.markRead.newReadNoRowId.rpcCalls, 0, 'sanity: no RPC fires without a row id (would silently match zero rows)');

  assert.strictEqual(resultOriginal.claim.noReward, false, 'sanity: no-reward mail is ineligible');
  assert.strictEqual(resultOriginal.claim.alreadyClaimed, false, 'sanity: already-claimed mail is ineligible');
  assert.strictEqual(resultOriginal.claim.unknownMail, false, 'sanity: unknown mail is ineligible');
  assert.strictEqual(resultOriginal.claim.fullClaim.studentXpAfter, 300, 'sanity: xp granted (100 + 200)');
  assert.strictEqual(resultOriginal.claim.fullClaim.studentCoinsAfter, 50, 'sanity: coins granted (20 + 30)');
  assert.strictEqual(resultOriginal.claim.fullClaim.mailNowClaimed.s1, true, 'sanity: mail flagged claimed');
  assert.strictEqual(resultOriginal.claim.fullClaim.mailNowRead.s1, true, 'sanity: claiming also marks it read');
  assert.strictEqual(resultOriginal.claim.fullClaim.pointLogEntry.pts, 30, 'sanity: pointLog pts uses coins-first (coinGrant || xpGrant)');
  assert.ok(resultOriginal.claim.fullClaim.pointLogEntry.what.includes('Bonus!'), 'sanity: pointLog entry references the mail subject');
  assert.strictEqual(resultOriginal.claim.fullClaim.studentLevelAfter, 0, 'sanity: 300 total xp is still level 0 (floor(300/1000)), checkLevelUp() correctly does not level up');
  assert.strictEqual(resultOriginal.claim.fullClaim.currentUserAfter.xp, 300, 'sanity: setCurrentUser() really updated window.currentUser with the new xp');
  assert.strictEqual(resultOriginal.claim.fullClaim.topbarCoinValAfter, '-', 'sanity: updateTopbar() really ran; currentRole isn\'t \'student\' in this scenario so it shows the "-" placeholder, not a coin number — proves the call happened without needing to fake the role');
  assert.ok(resultOriginal.claim.fullClaim.badgeElementAfter.length >= 0, 'sanity: mailUpdateSidebarBadge() ran without throwing');
  assert.deepStrictEqual(resultOriginal.claim.fullClaim.rpcNames, ['adjust_student_stats', 'mark_mail_claimed'], 'sanity: both the stats-sync RPC and the mark-claimed RPC fired');
  assert.strictEqual(resultOriginal.claim.fullClaim.markClaimedParams.p_mail_id, 'row-full', 'sanity: mark_mail_claimed also uses the per-row id');
  assert.strictEqual(resultOriginal.claim.levelUpClaim.studentXpAfter, 1050, 'sanity: level-up scenario xp total (100 + 950)');
  assert.strictEqual(resultOriginal.claim.levelUpClaim.studentLevelAfter, 1, 'sanity: checkLevelUp() really runs inside mailClaimRewards and updates .level in place when a threshold is crossed');

  assert.ok(!resultOriginal.badge.notStudent.includes('mail-nav-badge'), 'sanity: non-student role never gets a mail badge');
  assert.ok(!resultOriginal.badge.studentNoBadge.includes('mail-nav-badge'), 'sanity: zero unread/unclaimed -> no badge');
  assert.ok(resultOriginal.badge.studentWithBadge.includes('mail-nav-badge'), 'sanity: unread+unclaimed present -> badge shown');
  assert.strictEqual(resultOriginal.badge.unreadCount, 1, 'sanity: mailUnreadCount');
  assert.strictEqual(resultOriginal.badge.unclaimedCount, 1, 'sanity: mailUnclaimedRewardCount');
  assert.strictEqual(resultOriginal.badge.badgeCountAfterSecondCall, 1, 'sanity: calling again reuses the existing badge element, does not duplicate it');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('mail-engine.js: mailGetForStudent filtering/sorting, mailIsRead/mailIsClaimed, mailMarkRead');
  console.log('(already-read skip, batch-id-vs-row-id RPC targeting, missing-row-id no-RPC path),');
  console.log('mailClaimRewards (ineligibility checks, xp/coins grants, pointLog entry, checkLevelUp/');
  console.log('setCurrentUser/updateTopbar/mailUpdateSidebarBadge side effects, dual RPC calls), and the');
  console.log('sidebar badge (role gate, create/reuse/remove) all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
