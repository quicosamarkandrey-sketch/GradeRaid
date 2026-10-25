// Phase 7 (Stream A) — equivalence check for modules/mail/student-inbox.js.
//
// Real-imports AppStore (state-manager.js) and eqRewardPresent
// (reward-presenter.js), both this stream's own already-converted
// files, both confirmed via repo-wide grep against the "no runtime
// reassignment anywhere" rule (MEMORY.md) before finalizing.
//
// jsdom canvas gap (documented in reward-presenter.js's own verify
// script and MEMORY.md), inherited here: eqRewardPresent() always
// throws partway through (after setting the overlay's innerHTML, before
// wiring the close handler) because HTMLCanvasElement#getContext('2d')
// returns null in jsdom. mailDoClaimRewards()'s call to eqRewardPresent
// is wrapped in try/catch here; the overlay HTML it produced before the
// throw is still inspected to verify rarity/reward-chip content. The
// onClose callback (which calls renderStudentMail() again) can never be
// exercised end-to-end in this environment — disclosed, not faked.
//
// mail-engine.js (mailGetForStudent/mailIsRead/mailIsClaimed/
// mailMarkRead/mailClaimRewards/mailUpdateSidebarBadge) isn't converted
// by this stream yet, so this script provides simple stand-in
// implementations that read/write the SAME real AppStore `mail` slice
// mailOpenDetail() reads directly — consistent behavior between the two
// data-access paths is what matters for this file's own equivalence,
// not matching mail-engine.js's real (not-yet-relevant) internals.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html><body><div id="s-mail"></div></body></html>', { runScripts: 'dangerously', url: 'https://example.org/app/index.html' });
  const win = dom.window;
  win.__EDUQUEST_SUPABASE_URL__ = '';
  win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };
  win.DBService = { initRemote: async () => {}, read: () => null, write: () => {} };
  win.DEFAULT_DB = { students: [], mail: [] };

  win.currentUser = { id: 's1', name: 'Ana Cruz' };
  win.currentRole = 'student';

  win.__badgeCalls = 0;
  win.mailUpdateSidebarBadge = () => { win.__badgeCalls++; };
  win.mailIsRead = (m, sid) => (m.readBy || []).includes(sid);
  win.mailIsClaimed = (m, sid) => (m.claimedBy || []).includes(sid);
  win.mailGetForStudent = (sid) => (win.AppStore.getSlice(s => s.mail) || []).slice();
  win.mailMarkRead = (mailId, sid) => {
    win.AppStore.updateState(draft => {
      const m = (draft.mail || []).find(x => x.id === mailId);
      if (m) { m.readBy = m.readBy || []; if (!m.readBy.includes(sid)) m.readBy.push(sid); }
    }, { type: 'test:markRead' });
  };
  win.mailClaimRewards = (mailId, sid) => {
    let result = false;
    win.AppStore.updateState(draft => {
      const m = (draft.mail || []).find(x => x.id === mailId);
      if (!m || !m.hasReward) { result = false; return; }
      m.claimedBy = m.claimedBy || [];
      if (m.claimedBy.includes(sid)) { result = false; return; }
      m.claimedBy.push(sid);
      result = m.rewards || [];
    }, { type: 'test:claimRewards' });
    return result;
  };

  win.__toastCalls = [];
  win.toast = (msg, color) => { win.__toastCalls.push({ msg, color }); };
  win.__modalCalls = [];
  win.showModal = (html, size) => { win.__modalCalls.push({ html, size }); };
  win.__closeModalCalls = 0;
  win.closeModalForce = () => { win.__closeModalCalls++; };

  win._esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  win._cssColor = (s, fallback) => {
    fallback = fallback || '#8b5cf6';
    const v = String(s || '').trim();
    return /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ? v : fallback;
  };

  return win;
}

async function evalFullOriginalChain(win) {
  const files = ['supabase-client.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'repository/table-sync.js', 'db-service.js', 'modules/core/state-manager.js', 'modules/shared/reward-presenter.js', 'modules/mail/student-inbox.js'];
  for (const f of files) win.eval(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
  await win.AppStore.ready;
}

async function evalBridge(win) {
  const supabaseClientSrc = fs.readFileSync(path.join(__dirname, '..', 'supabase-client.js'), 'utf8');
  win.eval(supabaseClientSrc);
  const bridgeSrc = fs.readFileSync(path.join(__dirname, 'test-helpers', 'student-inbox-combined-bundle.js'), 'utf8');
  win.eval(bridgeSrc);
  await win.AppStore.ready;
}

async function seedMail(win, mail) {
  await win.AppStore.ready;
  win.AppStore.updateState(draft => { draft.mail = mail; }, { type: 'test:seed' });
}

async function runRenderScenarios(win) {
  const results = {};

  // --- Empty inbox ---
  await seedMail(win, []);
  win.renderStudentMail();
  results.emptyInbox = win.document.getElementById('s-mail').innerHTML;
  results.badgeCallsAfterEmpty = win.__badgeCalls;

  // --- Mixed inbox: read, unread, unclaimed reward, claimed reward ---
  await seedMail(win, [
    { id: 'm1', subject: 'Welcome!', body: 'Hi there', sender: 'Ms. Garcia', type: 'announcement', hasReward: false, sentAt: '2026-08-01T00:00:00.000Z', readBy: ['s1'], claimedBy: [] },
    { id: 'm2', subject: 'Bonus <coins>!', body: 'Nice work this week', sender: 'Ms. Garcia', type: 'reward', hasReward: true, rewards: [{ type: 'coins', amount: 50, icon: '🪙', label: 'Coins' }], sentAt: '2026-08-15T00:00:00.000Z', readBy: [], claimedBy: [] },
    { id: 'm3', subject: 'Title Unlocked', body: 'You earned a title', sender: 'System', type: 'title', hasReward: true, rewards: [{ type: 'title', label: 'Star Student', icon: '🎖️' }], sentAt: '2026-08-20T00:00:00.000Z', readBy: ['s1'], claimedBy: ['s1'] },
  ]);
  win.renderStudentMail();
  const mixedHtml = win.document.getElementById('s-mail').innerHTML;
  results.mixedHasUnreadDot = (mixedHtml.match(/mail-unread-dot/g) || []).length;
  results.mixedHasRewardBadge = (mixedHtml.match(/mail-has-reward/g) || []).length;
  results.mixedMessageCount = (mixedHtml.match(/class="mail-item(?:"| unread")/g) || []).length;
  results.mixedEscapedSubject = mixedHtml.includes('Bonus &lt;coins&gt;!');

  return results;
}

async function runDetailScenarios(win) {
  const results = {};

  await seedMail(win, [
    { id: 'm-no-reward', subject: 'Plain message', body: 'Nothing special', sender: 'Teacher', type: 'general', hasReward: false, sentAt: '2026-08-01T00:00:00.000Z', readBy: [], claimedBy: [] },
    { id: 'm-unclaimed', subject: 'Reward mail', body: 'Claim me', sender: 'Teacher', type: 'reward', hasReward: true, rewards: [{ type: 'xp', amount: 100, icon: '⭐', label: 'XP' }], sentAt: '2026-08-02T00:00:00.000Z', readBy: [], claimedBy: [] },
    { id: 'm-claimed', subject: 'Already claimed', body: 'Done already', sender: 'Teacher', type: 'gift', hasReward: true, rewards: [{ type: 'coins', amount: 20 }], sentAt: '2026-08-03T00:00:00.000Z', readBy: [], claimedBy: ['s1'] },
  ]);

  // --- unknown mailId: early return, no modal ---
  win.__modalCalls.length = 0;
  win.mailOpenDetail('does-not-exist');
  results.unknownMailModalCalls = win.__modalCalls.length;

  // --- no-reward mail: opens, marks read, no reward box ---
  win.__modalCalls.length = 0; win.__badgeCalls = 0;
  win.mailOpenDetail('m-no-reward');
  results.noRewardModal = win.__modalCalls[0] ? win.__modalCalls[0].html : null;
  results.noRewardMarkedRead = win.AppStore.getSlice(s => s.mail).find(m => m.id === 'm-no-reward').readBy.includes('s1');
  results.noRewardBadgeCalls = win.__badgeCalls;

  // --- unclaimed reward mail: shows Claim button ---
  win.__modalCalls.length = 0;
  win.mailOpenDetail('m-unclaimed');
  results.unclaimedModalHasClaimButton = win.__modalCalls[0].html.includes('mailDoClaimRewards');

  // --- claimed reward mail: shows "Rewards Claimed" badge, not a button ---
  win.__modalCalls.length = 0;
  win.mailOpenDetail('m-claimed');
  results.claimedModalHasClaimedBadge = win.__modalCalls[0].html.includes('Rewards Claimed');
  results.claimedModalNoClaimButton = !win.__modalCalls[0].html.includes('mailDoClaimRewards');

  return results;
}

async function runClaimScenarios(win) {
  const results = {};

  // --- not logged in as student ---
  win.currentUser = null;
  win.__toastCalls.length = 0;
  win.mailDoClaimRewards('anything');
  results.notLoggedIn = { toastCalls: win.__toastCalls.slice(), closeModalCalls: win.__closeModalCalls };

  win.currentUser = { id: 's1', name: 'Ana Cruz' };
  win.currentRole = 'teacher';
  win.__toastCalls.length = 0;
  win.mailDoClaimRewards('anything');
  results.wrongRole = { toastCalls: win.__toastCalls.slice() };
  win.currentRole = 'student';

  // --- claim returns false (already claimed / not found) ---
  await seedMail(win, [{ id: 'm-claimed', subject: 'x', body: 'y', hasReward: true, rewards: [{ type: 'coins', amount: 5 }], sentAt: '2026-08-01T00:00:00.000Z', readBy: [], claimedBy: ['s1'] }]);
  win.__toastCalls.length = 0;
  win.mailDoClaimRewards('m-claimed');
  results.alreadyClaimed = { toastCalls: win.__toastCalls.slice(), closeModalCalls: win.__closeModalCalls };

  // --- successful claim: coins-heavy reward -> Rare rarity ---
  await seedMail(win, [{ id: 'm-coins', subject: 'x', body: 'y', hasReward: true, rewards: [{ type: 'coins', amount: 500, icon: '🪙', label: 'Coins' }], sentAt: '2026-08-01T00:00:00.000Z', readBy: [], claimedBy: [] }]);
  win.__closeModalCalls = 0;
  let threwCoins = null;
  try { win.mailDoClaimRewards('m-coins'); } catch (e) { threwCoins = e.message; }
  results.coinsClaim = {
    threw: threwCoins,
    closeModalCalls: win.__closeModalCalls,
    overlayHTML: win.document.getElementById('eq-reward-overlay') ? win.document.getElementById('eq-reward-overlay').innerHTML : null,
    nowClaimed: win.AppStore.getSlice(s => s.mail).find(m => m.id === 'm-coins').claimedBy.includes('s1'),
  };

  // --- successful claim: title reward -> Legendary rarity ---
  await seedMail(win, [{ id: 'm-title', subject: 'x', body: 'y', hasReward: true, rewards: [{ type: 'title', label: 'Star Student', icon: '🎖️' }], sentAt: '2026-08-01T00:00:00.000Z', readBy: [], claimedBy: [] }]);
  let threwTitle = null;
  try { win.mailDoClaimRewards('m-title'); } catch (e) { threwTitle = e.message; }
  results.titleClaim = {
    threw: threwTitle,
    overlayHTML: win.document.getElementById('eq-reward-overlay') ? win.document.getElementById('eq-reward-overlay').innerHTML : null,
  };

  // --- successful claim: small xp-only reward -> Common rarity ---
  await seedMail(win, [{ id: 'm-small', subject: 'x', body: 'y', hasReward: true, rewards: [{ type: 'xp', amount: 10, icon: '⭐', label: 'XP' }], sentAt: '2026-08-01T00:00:00.000Z', readBy: [], claimedBy: [] }]);
  let threwSmall = null;
  try { win.mailDoClaimRewards('m-small'); } catch (e) { threwSmall = e.message; }
  results.smallClaim = {
    threw: threwSmall,
    overlayHTML: win.document.getElementById('eq-reward-overlay') ? win.document.getElementById('eq-reward-overlay').innerHTML : null,
  };

  return results;
}

async function runFullSuite(evalFn) {
  const results = {};

  const win1 = makeWindow();
  await evalFn(win1);
  results.render = await runRenderScenarios(win1);

  const win2 = makeWindow();
  await evalFn(win2);
  results.detail = await runDetailScenarios(win2);

  const win3 = makeWindow();
  await evalFn(win3);
  results.claim = await runClaimScenarios(win3);

  return results;
}

async function main() {
  const resultOriginal = await runFullSuite(evalFullOriginalChain);
  const resultBridge = await runFullSuite(evalBridge);

  // jsdom cross-realm gotcha (documented in MEMORY.md): compare via
  // JSON.stringify rather than assert.deepStrictEqual.
  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original at every step');

  // Sanity checks against the original's real values.
  assert.ok(resultOriginal.render.emptyInbox.includes('Your inbox is empty'), 'sanity: empty inbox message');
  assert.strictEqual(resultOriginal.render.badgeCallsAfterEmpty, 1, 'sanity: renderStudentMail always calls mailUpdateSidebarBadge');
  assert.strictEqual(resultOriginal.render.mixedHasUnreadDot, 1, 'sanity: exactly one unread dot for the one unread message');
  assert.strictEqual(resultOriginal.render.mixedHasRewardBadge, 1, 'sanity: exactly one REWARD badge (unclaimed reward only, not the already-claimed one)');
  assert.strictEqual(resultOriginal.render.mixedMessageCount, 3, 'sanity: all 3 messages rendered');
  assert.strictEqual(resultOriginal.render.mixedEscapedSubject, true, 'sanity: subject HTML-escaped via _esc');

  assert.strictEqual(resultOriginal.detail.unknownMailModalCalls, 0, 'sanity: unknown mailId never opens a modal');
  assert.ok(resultOriginal.detail.noRewardModal.includes('Plain message'), 'sanity: no-reward mail modal shows the subject');
  assert.ok(!resultOriginal.detail.noRewardModal.includes('ATTACHED REWARDS'), 'sanity: no-reward mail has no reward box');
  assert.strictEqual(resultOriginal.detail.noRewardMarkedRead, true, 'sanity: opening detail marks the mail read');
  assert.strictEqual(resultOriginal.detail.noRewardBadgeCalls, 1, 'sanity: opening detail refreshes the sidebar badge');
  assert.strictEqual(resultOriginal.detail.unclaimedModalHasClaimButton, true, 'sanity: unclaimed reward shows the Claim button');
  assert.strictEqual(resultOriginal.detail.claimedModalHasClaimedBadge, true, 'sanity: claimed reward shows the Claimed badge');
  assert.strictEqual(resultOriginal.detail.claimedModalNoClaimButton, true, 'sanity: claimed reward has no Claim button');

  assert.ok(resultOriginal.claim.notLoggedIn.toastCalls[0].msg.includes('must be logged in'), 'sanity: not-logged-in toast');
  assert.strictEqual(resultOriginal.claim.notLoggedIn.closeModalCalls, 0, 'sanity: not-logged-in never closes the modal');
  assert.ok(resultOriginal.claim.wrongRole.toastCalls[0].msg.includes('must be logged in'), 'sanity: non-student role gets the same guard message');
  assert.ok(resultOriginal.claim.alreadyClaimed.toastCalls[0].msg.includes('already claimed'), 'sanity: already-claimed toast');
  assert.strictEqual(resultOriginal.claim.alreadyClaimed.closeModalCalls, 0, 'sanity: a failed claim never closes the modal');

  assert.strictEqual(typeof resultOriginal.claim.coinsClaim.threw, 'string', 'sanity (jsdom gap, disclosed): eqRewardPresent throws on the canvas call, same as reward-presenter.js\'s own verify script');
  assert.strictEqual(resultOriginal.claim.coinsClaim.closeModalCalls, 1, 'sanity: a successful claim closes the modal BEFORE presenting rewards');
  assert.strictEqual(resultOriginal.claim.coinsClaim.nowClaimed, true, 'sanity: the mail is actually marked claimed');
  assert.ok(resultOriginal.claim.coinsClaim.overlayHTML.includes('Mail Rewards Claimed!'), 'sanity: reward overlay title');
  assert.ok(resultOriginal.claim.coinsClaim.overlayHTML.includes('+500'), 'sanity: coin amount shown in the overlay');

  assert.ok(resultOriginal.claim.titleClaim.overlayHTML.includes('Star Student'), 'sanity: title reward label shown');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('student-inbox.js: inbox rendering (empty state, unread/reward badges, escaping),');
  console.log('mailOpenDetail (unknown id, no-reward/unclaimed/claimed reward states, mark-read + badge');
  console.log('refresh side effects), and mailDoClaimRewards (auth guards, already-claimed guard, and the');
  console.log('successful-claim flow up to the disclosed eqRewardPresent canvas gap) all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
