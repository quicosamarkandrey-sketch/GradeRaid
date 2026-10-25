// Phase 7 (Stream A) — equivalence check for modules/mail/admin-compose.js.
//
// Real-imports AppStore (state-manager.js) and DBService (db-service.js),
// both this stream's own already-converted files, both confirmed via
// repo-wide grep against the "no runtime reassignment anywhere" rule
// (MEMORY.md) before finalizing. DBService.rpc is mocked by mutating
// the shared real object's `.rpc` method (same technique as
// attendance-service.js's own verify script).
//
// mail-engine.js (mailIsRead/mailIsClaimed) isn't converted by this
// stream yet — simple stand-ins here read the SAME real AppStore `mail`
// slice this file reads directly, same approach as student-inbox.js's
// own verify script.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html><body><div id="a-mail"></div></body></html>', { runScripts: 'dangerously', url: 'https://example.org/app/index.html' });
  const win = dom.window;
  win.__EDUQUEST_SUPABASE_URL__ = '';
  win.__EDUQUEST_SUPABASE_ANON_KEY__ = '';
  win.supabase = { createClient() { return {}; } };
  win.DBService = { initRemote: async () => {}, read: () => null, write: () => {} };
  win.DEFAULT_DB = { students: [], mail: [], titles: [] };

  win.currentUser = { id: 'teacher-1', name: 'Ms. Garcia' };

  win.mailIsRead = (m, sid) => !!(m.readBy && m.readBy[sid]);
  win.mailIsClaimed = (m, sid) => !!(m.claimedBy && m.claimedBy[sid]);

  win.__toastCalls = [];
  win.toast = (msg, color) => { win.__toastCalls.push({ msg, color }); };
  win.__modalCalls = [];
  win.showModal = (html, size) => { win.__modalCalls.push({ html, size }); };
  win.__closeModalCalls = 0;
  win.closeModalForce = () => { win.__closeModalCalls++; };
  win._esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return win;
}

async function evalFullOriginalChain(win) {
  const files = ['supabase-client.js', 'repository/pull-mappers.js', 'repository/realtime-groups.js', 'repository/table-sync.js', 'db-service.js', 'modules/core/state-manager.js', 'modules/mail/admin-compose.js'];
  for (const f of files) win.eval(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
  await win.AppStore.ready;
}

async function evalBridge(win) {
  const supabaseClientSrc = fs.readFileSync(path.join(__dirname, '..', 'supabase-client.js'), 'utf8');
  win.eval(supabaseClientSrc);
  const bridgeSrc = fs.readFileSync(path.join(__dirname, 'test-helpers', 'admin-compose-combined-bundle.js'), 'utf8');
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
      students: [{ id: 's1', name: 'Ana Cruz' }, { id: 's2', name: 'Solo' }],
      mail: [],
      titles: [{ id: 't1', name: 'Star Student', rarity: 'rare', active: true, icon: '🎖️' }, { id: 't2', name: 'Retired Title', rarity: 'common', active: false }],
    }, overrides || {});
  }, { type: 'test:seed' });
}

async function runRenderScenarios(win) {
  const results = {};

  await seedState(win, {});
  win.renderAdminMail();
  results.emptyState = win.document.getElementById('a-mail').innerHTML;

  await seedState(win, {
    mail: [
      { id: 'm1', subject: 'All-class note', body: 'x'.repeat(120), type: 'announcement', to: 'all', hasReward: false, sentAt: '2026-08-01T00:00:00.000Z', readBy: { s1: true, s2: false }, claimedBy: {} },
      { id: 'm2', subject: 'Bonus <coins>', body: 'short', type: 'reward', to: ['s1'], hasReward: true, sentAt: '2026-08-15T00:00:00.000Z', readBy: { s1: true }, claimedBy: { s1: true } },
    ],
  });
  win.renderAdminMail();
  const mixedHtml = win.document.getElementById('a-mail').innerHTML;
  results.mixedHasEscapedSubject = mixedHtml.includes('Bonus &lt;coins&gt;');
  results.mixedRowCount = (mixedHtml.match(/class="admin-mail-row"/g) || []).length;
  results.mixedTruncatesLongBody = mixedHtml.includes('…');
  results.mixedShowsRewardBadge = (mixedHtml.match(/bp-gold/g) || []).length;
  results.mixedShowsSentStat = /ach-stat-val[^>]*>(\d+)</.exec(mixedHtml)[1];

  return results;
}

async function runComposeScenarios(win) {
  const results = {};
  await seedState(win, {
    mail: [{ id: 'm-edit', subject: 'Old subject', body: 'Old body', type: 'gift', to: ['s1', 's2'], hasReward: true, rewards: [{ type: 'xp', amount: 50 }], sentAt: '2026-08-01T00:00:00.000Z', readBy: {}, claimedBy: {} }],
  });

  // --- new compose ---
  win.mailAdminOpenCompose();
  const newHtml = win.__modalCalls[win.__modalCalls.length - 1].html;
  results.newHasRecipientSelect = newHtml.includes('id="ml-to"');
  results.newHasEmptySubject = newHtml.includes('id="ml-subject" value=""');
  results.newTitleOptionsExcludeInactive = newHtml.includes('Star Student') && !newHtml.includes('Retired Title');

  // --- edit compose ---
  win.mailAdminOpenCompose('m-edit');
  const editHtml = win.__modalCalls[win.__modalCalls.length - 1].html;
  results.editHasNoRecipientSelect = !editHtml.includes('id="ml-to"');
  results.editShowsRecipientNames = editHtml.includes('Ana Cruz') && editHtml.includes('Solo');
  results.editPrefillsSubject = editHtml.includes('value="Old subject"');
  results.editRewardsSectionVisible = editHtml.includes('id="ml-rewards-section" style="display:block"');
  results.editPrefillsXp = editHtml.includes('id="ml-xp" value="50"');

  // --- toggle helpers ---
  win.document.getElementById('a-mail').innerHTML = '<select id="ml-to"><option value="multi" selected>x</option></select><div id="ml-multi-wrap" style="display:none"></div><input type="checkbox" id="ml-has-reward" checked><div id="ml-rewards-section" style="display:none"></div>';
  win.mailAdminToChange();
  results.multiWrapShownAfterToggle = win.document.getElementById('ml-multi-wrap').style.display;
  win.mailAdminToggleRewards();
  results.rewardsSectionShownAfterToggle = win.document.getElementById('ml-rewards-section').style.display;

  return results;
}

async function runSendScenarios(win) {
  const results = {};

  // --- validation: no subject ---
  win.document.getElementById('a-mail').innerHTML = '<input id="ml-subject" value=""><textarea id="ml-body">body</textarea><select id="ml-type"><option value="general" selected>x</option></select>';
  win.__toastCalls.length = 0;
  await win.mailAdminSend();
  results.noSubject = win.__toastCalls.slice();

  // --- validation: no recipients selected (multi mode) ---
  await seedState(win, {});
  win.document.getElementById('a-mail').innerHTML = '<input id="ml-subject" value="Hi"><textarea id="ml-body">body</textarea><select id="ml-type"><option value="general" selected>x</option></select><select id="ml-to"><option value="multi" selected>x</option></select><select id="ml-students" multiple></select>';
  win.__toastCalls.length = 0;
  await win.mailAdminSend();
  results.noRecipients = win.__toastCalls.slice();

  // --- validation: reward checked but no values ---
  win.document.getElementById('a-mail').innerHTML = '<input id="ml-subject" value="Hi"><textarea id="ml-body">body</textarea><select id="ml-type"><option value="reward" selected>x</option></select><select id="ml-to"><option value="all" selected>x</option></select><input type="checkbox" id="ml-has-reward" checked><input id="ml-xp" value="0"><input id="ml-coins" value="0"><select id="ml-title"><option value="">none</option></select>';
  win.__toastCalls.length = 0;
  await win.mailAdminSend();
  results.noRewardValues = win.__toastCalls.slice();

  // --- success: new mail, all students ---
  win.document.getElementById('a-mail').innerHTML = '<input id="ml-subject" value="Welcome"><textarea id="ml-body">Hi everyone</textarea><select id="ml-type"><option value="announcement" selected>x</option></select><select id="ml-to"><option value="all" selected>x</option></select><input type="checkbox" id="ml-has-reward">';
  mockRpc(win, { send_mail: { data: 'batch-1', error: null } });
  win.__toastCalls.length = 0; win.__closeModalCalls = 0;
  await win.mailAdminSend();
  results.sendSuccess = {
    toastCalls: win.__toastCalls.slice(),
    closeModalCalls: win.__closeModalCalls,
    mailAfter: win.AppStore.getSlice(s => s.mail),
  };

  // --- success: new mail, RPC error ---
  win.document.getElementById('a-mail').innerHTML = '<input id="ml-subject" value="Bad"><textarea id="ml-body">x</textarea><select id="ml-type"><option value="general" selected>x</option></select><select id="ml-to"><option value="all" selected>x</option></select><input type="checkbox" id="ml-has-reward">';
  mockRpc(win, { send_mail: { data: null, error: { message: 'server down' } } });
  win.__toastCalls.length = 0;
  const mailCountBefore = win.AppStore.getSlice(s => s.mail).length;
  await win.mailAdminSend();
  results.sendError = { toastCalls: win.__toastCalls.slice(), mailCountUnchanged: win.AppStore.getSlice(s => s.mail).length === mailCountBefore };

  // --- success: edit existing mail ---
  await seedState(win, { mail: [{ id: 'm-edit', subject: 'Old', body: 'Old body', type: 'gift', to: ['s1'], hasReward: false, rewards: [], sentAt: '2026-08-01T00:00:00.000Z', readBy: {}, claimedBy: {} }] });
  win.document.getElementById('a-mail').innerHTML = '<input id="ml-subject" value="New subject"><textarea id="ml-body">New body</textarea><select id="ml-type"><option value="gift" selected>x</option></select><input type="checkbox" id="ml-has-reward">';
  mockRpc(win, { update_mail_batch: { data: null, error: null } });
  win.__toastCalls.length = 0; win.__closeModalCalls = 0;
  await win.mailAdminSend('m-edit');
  results.editSuccess = {
    toastCalls: win.__toastCalls.slice(),
    updatedSubject: win.AppStore.getSlice(s => s.mail).find(m => m.id === 'm-edit').subject,
  };

  return results;
}

async function runDeleteScenarios(win) {
  const results = {};
  await seedState(win, { mail: [{ id: 'm-del', subject: 'Delete me', body: 'x', to: 'all', hasReward: false, sentAt: '2026-08-01T00:00:00.000Z', readBy: {}, claimedBy: {} }] });

  win.mailAdminDelete('does-not-exist');
  results.unknownMailModalCalls = win.__modalCalls.length;

  win.mailAdminDelete('m-del');
  results.confirmModalHtml = win.__modalCalls[win.__modalCalls.length - 1].html;

  mockRpc(win, { delete_mail_batch: { data: null, error: null } });
  win.__toastCalls.length = 0; win.__closeModalCalls = 0;
  await win.mailAdminConfirmDelete('m-del');
  results.afterConfirmDelete = {
    mailRemaining: win.AppStore.getSlice(s => s.mail).length,
    toastCalls: win.__toastCalls.slice(),
    closeModalCalls: win.__closeModalCalls,
  };

  await seedState(win, { mail: [{ id: 'm-del2', subject: 'x', body: 'x', to: 'all', hasReward: false, sentAt: '2026-08-01T00:00:00.000Z', readBy: {}, claimedBy: {} }] });
  mockRpc(win, { delete_mail_batch: { data: null, error: { message: 'network blip' } } });
  win.__toastCalls.length = 0;
  await win.mailAdminConfirmDelete('m-del2');
  results.afterConfirmDeleteRpcError = {
    mailRemaining: win.AppStore.getSlice(s => s.mail).length,
    toastCalls: win.__toastCalls.slice(),
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
  results.compose = await runComposeScenarios(win2);

  const win3 = makeWindow();
  await evalFn(win3);
  results.send = await runSendScenarios(win3);

  const win4 = makeWindow();
  await evalFn(win4);
  results.delete = await runDeleteScenarios(win4);

  return results;
}

function normalizeTimestamps(results) {
  // `sentAt: new Date().toISOString()` in the source (not a stubbable
  // helper) — inherently non-deterministic across two separate runs.
  const clone = JSON.parse(JSON.stringify(results));
  if (clone.send && clone.send.sendSuccess && clone.send.sendSuccess.mailAfter) {
    clone.send.sendSuccess.mailAfter.forEach(m => { if (m.sentAt) m.sentAt = 'NORMALIZED'; });
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
  assert.ok(resultOriginal.render.emptyState.includes('No mail sent yet'), 'sanity: empty state message');
  assert.strictEqual(resultOriginal.render.mixedHasEscapedSubject, true, 'sanity: subject escaped via _esc');
  assert.strictEqual(resultOriginal.render.mixedRowCount, 2, 'sanity: both mails rendered as rows');
  assert.strictEqual(resultOriginal.render.mixedTruncatesLongBody, true, 'sanity: long body preview truncated with an ellipsis');
  assert.strictEqual(resultOriginal.render.mixedShowsRewardBadge, 1, 'sanity: only the reward mail shows the gold badge');
  assert.strictEqual(resultOriginal.render.mixedShowsSentStat, '2', 'sanity: stats bar shows 2 sent');

  assert.strictEqual(resultOriginal.compose.newHasRecipientSelect, true, 'sanity: new compose shows the recipient picker');
  assert.strictEqual(resultOriginal.compose.newHasEmptySubject, true, 'sanity: new compose starts with an empty subject');
  assert.strictEqual(resultOriginal.compose.newTitleOptionsExcludeInactive, true, 'sanity: only active titles appear in the title dropdown');
  assert.strictEqual(resultOriginal.compose.editHasNoRecipientSelect, true, 'sanity: edit mode hides the recipient picker (read-only per Phase 15)');
  assert.strictEqual(resultOriginal.compose.editShowsRecipientNames, true, 'sanity: edit mode shows the (read-only) recipient names instead');
  assert.strictEqual(resultOriginal.compose.editPrefillsSubject, true, 'sanity: edit mode prefills the existing subject');
  assert.strictEqual(resultOriginal.compose.editRewardsSectionVisible, true, 'sanity: edit mode shows the reward section when the mail already has one');
  assert.strictEqual(resultOriginal.compose.editPrefillsXp, true, 'sanity: edit mode prefills the existing XP reward value');
  assert.strictEqual(resultOriginal.compose.multiWrapShownAfterToggle, 'block', 'sanity: mailAdminToChange shows the multi-select wrap for "multi"');
  assert.strictEqual(resultOriginal.compose.rewardsSectionShownAfterToggle, 'block', 'sanity: mailAdminToggleRewards shows the rewards section when checked');

  assert.ok(resultOriginal.send.noSubject[0].msg.includes('Subject is required'), 'sanity: missing subject validation');
  assert.ok(resultOriginal.send.noRecipients.some(t => t.msg.includes('Select at least one recipient')), 'sanity: missing recipients validation');
  assert.ok(resultOriginal.send.noRewardValues.some(t => t.msg.includes('Add at least one reward')), 'sanity: reward-checked-but-empty validation');
  assert.strictEqual(resultOriginal.send.sendSuccess.toastCalls.length, 1, 'sanity: successful send toasts once');
  assert.ok(resultOriginal.send.sendSuccess.toastCalls[0].msg.includes('Mail sent to 2 students'), 'sanity: send toast includes the recipient count');
  assert.strictEqual(resultOriginal.send.sendSuccess.closeModalCalls, 1, 'sanity: successful send closes the modal');
  assert.strictEqual(resultOriginal.send.sendSuccess.mailAfter.length, 1, 'sanity: the new mail was actually added to AppStore');
  assert.ok(resultOriginal.send.sendError.toastCalls[0].msg.includes('Could not send mail'), 'sanity: RPC error surfaced on send');
  assert.strictEqual(resultOriginal.send.sendError.mailCountUnchanged, true, 'sanity: a failed send never mutates local state');
  assert.ok(resultOriginal.send.editSuccess.toastCalls[0].msg.includes('Mail updated'), 'sanity: successful edit toasts');
  assert.strictEqual(resultOriginal.send.editSuccess.updatedSubject, 'New subject', 'sanity: edit actually updates the local AppStore copy immediately (the Phase 3 bugfix this file documents)');

  assert.strictEqual(resultOriginal.delete.unknownMailModalCalls, 0, 'sanity: deleting an unknown mailId never opens a modal');
  assert.ok(resultOriginal.delete.confirmModalHtml.includes('Delete Mail?'), 'sanity: delete confirmation modal content');
  assert.strictEqual(resultOriginal.delete.afterConfirmDelete.mailRemaining, 0, 'sanity: confirmed delete removes the mail locally');
  assert.ok(resultOriginal.delete.afterConfirmDelete.toastCalls[0].msg.includes('Mail deleted'), 'sanity: delete toast');
  assert.strictEqual(resultOriginal.delete.afterConfirmDelete.closeModalCalls, 1, 'sanity: confirmed delete closes the modal');
  assert.strictEqual(resultOriginal.delete.afterConfirmDeleteRpcError.mailRemaining, 0, 'sanity: local delete happens even if the RPC then fails (optimistic, per the file\'s own comment)');
  assert.ok(resultOriginal.delete.afterConfirmDeleteRpcError.toastCalls.some(t => t.msg.includes('may not have synced')), 'sanity: RPC failure after a local delete gets its own warning toast');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('admin-compose.js: mail list rendering (stats, truncation, reward badges), the compose modal');
  console.log('(new vs. read-only-recipients edit mode, title/reward prefill), toggle helpers, mailAdminSend');
  console.log('(all validation paths, success + RPC-error paths for both send and edit), and');
  console.log('mailAdminDelete/mailAdminConfirmDelete (including the optimistic-delete-survives-RPC-failure');
  console.log('behavior) all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
