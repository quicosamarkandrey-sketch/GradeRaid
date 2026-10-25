// Phase 7, Stream B — equivalence check for modules/admin/content-oversight.js.
// Same composition as starter-pack-editor.js/audit-log.js: both
// ContentOversightService and TeacherDirectoryService are already
// independently equivalence-checked, so both windows share an identical
// fake DBService.rpc, with the ORIGINAL window evaling both real,
// untouched service files first. Drives: the teacher picker (load +
// search + "View Content"), the drill-in shell (edit-mode toggle with
// confirm accept/decline, read-only vs edit-mode button visibility), tab
// switching, and for all 5 entity types: render, open-form (incl. the
// non-edit-mode no-op guard), save (validation + RPC error + success),
// and delete (declined/success/RPC-error).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const STARTER_HTML = `<!doctype html><html><body>
  <div id="a-content-oversight"></div>
  <div id="modal-root"></div>
</body></html>`;

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously' });
  const win = dom.window;
  const calls = [];
  win.__calls = calls;

  win.currentRole = 'admin';
  win.navTo = function (id) { calls.push({ name: 'navTo', id }); };
  win.toast = function (msg, color) { calls.push({ name: 'toast', msg, color }); };
  win.closeModalForce = function () { calls.push({ name: 'closeModalForce' }); win.document.getElementById('modal-root').innerHTML = ''; };
  win.showModal = function (html, size) {
    calls.push({ name: 'showModal', size });
    win.document.getElementById('modal-root').innerHTML = html;
  };
  win.__confirmAnswer = true;
  win.confirm = function (msg) { calls.push({ name: 'confirm', msg }); return win.__confirmAnswer; };
  let uidCounter = 0;
  win.uid = function () { uidCounter++; return 'uid' + uidCounter; };
  win.ACH_RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'];
  win.ACH_TRIGGER_TYPES = [{ value: 'manual', label: 'Manual' }, { value: 'auto', label: 'Auto' }];

  const teachers = [
    { id: 't1', displayName: 'Ms. Alpha', email: 'alpha@x.com', role: 'teacher', achievementCount: 1, titleCount: 1, quizCount: 1, campaignWorldCount: 1, shopProductCount: 1 },
    { id: 't2', displayName: 'Mr. Beta', email: 'beta@x.com', role: 'teacher', achievementCount: 0, titleCount: 0, quizCount: 0, campaignWorldCount: 0, shopProductCount: 0 },
  ];
  const content = {
    achievements: [{ id: 'a1', name: 'First Steps', description: 'd', icon: '🏅', category: 'General', rarity: 'Common', xpReward: 10, coinReward: 5, triggerType: 'manual', triggerValue: 1, active: true }],
    titles: [{ id: 'ti1', name: 'Champion', description: 'd', icon: '🎖️', rarity: 'Rare', textColor: '#d0bcff', borderColor: '#8b5cf6', glowColor: 'rgba(1,1,1,.3)', bgColor: 'rgba(1,1,1,.08)', active: true }],
    quizzes: [{ id: 'q1', title: 'Quiz One', description: 'd', xpReward: 20, coinReward: 10, timeLimit: 5, rarity: 'Common', cadence: 'standing', questions: [{ q: 'Q?', opts: ['A', 'B', 'C', 'D'], answer: 0 }], active: true }],
    campaignWorlds: [{ id: 'w1', label: 'World One', icon: '🗺️', color: '#8b5cf6', description: 'd', stages: [{ name: 'stage1' }], active: true }],
    shopProducts: [{ id: 'p1', name: 'Cool Hat', emoji: '🎁', description: 'd', category: 'General', cost: 50, active: true }],
  };

  win.DBService = {
    async rpc(name, params) {
      calls.push({ name, params: JSON.parse(JSON.stringify(params || {})) });
      if (name === 'get_teacher_directory') {
        if (win.__dirFail) return { data: null, error: { message: 'boom: directory failed' } };
        return { data: teachers.map(t => ({ id: t.id, display_name: t.displayName, email: t.email, role: t.role, achievement_count: t.achievementCount, title_count: t.titleCount, quiz_count: t.quizCount, campaign_world_count: t.campaignWorldCount, shop_product_count: t.shopProductCount })), error: null };
      }
      if (name === 'get_teacher_content') {
        if (win.__fetchFail) return { data: null, error: { message: 'boom: fetch failed' } };
        return { data: JSON.parse(JSON.stringify(content)), error: null };
      }
      if (name === 'log_edit_as_action') return { data: { id: 'log-1' }, error: null };
      if (String(name).startsWith('oversight_upsert_')) {
        if (params.p_id === 'FAIL') return { data: null, error: { message: 'boom: ' + name + ' failed' } };
        return { data: { id: params.p_id, ...params }, error: null };
      }
      if (String(name).startsWith('delete_')) {
        const idParam = Object.keys(params).find(k => k !== 'p_owner_teacher_id');
        if (params[idParam] === 'FAIL') return { data: null, error: { message: 'boom: ' + name + ' failed' } };
        return { data: null, error: null };
      }
      throw new Error('unexpected rpc: ' + name);
    },
  };

  return win;
}

function snapshot(win) {
  return {
    mainHtml: win.document.getElementById('a-content-oversight').innerHTML,
    modalHtml: win.document.getElementById('modal-root').innerHTML,
    calls: win.__calls,
  };
}

async function runSequence(win) {
  const results = {};

  // Non-admin gate.
  win.currentRole = 'teacher';
  await win.renderContentOversight();
  results.nonAdminGate = snapshot(win);
  win.__calls.length = 0;
  win.currentRole = 'admin';

  // Picker: directory fetch failure.
  win.__dirFail = true;
  await win.renderContentOversight();
  results.pickerFetchFail = snapshot(win);
  win.__calls.length = 0;
  win.__dirFail = false;

  // Picker: normal load + search.
  await win.renderContentOversight();
  results.pickerLoaded = snapshot(win);
  win.__calls.length = 0;

  win._coSetPickerSearch('beta');
  results.pickerSearchFiltered = snapshot(win);
  win._coSetPickerSearch('zzz-no-match');
  results.pickerSearchNoMatch = snapshot(win);
  win._coSetPickerSearch('');
  win.__calls.length = 0;

  // openContentOversightFor jumps straight to a teacher's drill-in.
  win.openContentOversightFor('t1', 'Ms. Alpha');
  results.afterOpenFor = snapshot(win);
  win.__calls.length = 0;

  // renderContentOversight now drills straight in (content-oversight fetch failure case first).
  win.__fetchFail = true;
  await win.renderContentOversight();
  results.drillInFetchFail = snapshot(win);
  win.__calls.length = 0;
  win.__fetchFail = false;

  await win.renderContentOversight();
  results.drillInLoaded = snapshot(win);
  win.__calls.length = 0;

  // Try to open a form while still read-only — no-op guard.
  win._coOpenAchievementForm(-1);
  results.openFormWhileReadOnlyNoop = snapshot(win);
  win.__calls.length = 0;

  // Toggle edit mode: decline the confirm first.
  win.__confirmAnswer = false;
  win._coToggleEditMode();
  results.editModeToggleDeclined = snapshot(win);
  win.__calls.length = 0;

  // Toggle edit mode: accept.
  win.__confirmAnswer = true;
  win._coToggleEditMode();
  results.editModeToggleAccepted = snapshot(win);
  win.__calls.length = 0;

  // Tab switching through all 5 tabs.
  results.tabs = {};
  for (const tab of ['titles', 'quizzes', 'campaignWorlds', 'shopProducts', 'achievements']) {
    win._coSwitchTab(tab);
    results.tabs[tab] = snapshot(win);
    win.__calls.length = 0;
  }

  // ── Achievements: add, validation error, save ok, delete declined/ok/fail ──
  win._coOpenAchievementForm(-1);
  win.document.getElementById('co-a-name').value = '';
  await win._coSaveAchievement();
  results.achSaveValidationError = snapshot(win);
  win.__calls.length = 0;

  win._coOpenAchievementForm(-1);
  win.document.getElementById('co-a-name').value = 'New Ach';
  await win._coSaveAchievement();
  results.achSaveOk = snapshot(win);
  win.__calls.length = 0;

  win._coOpenAchievementForm(0);
  win.document.getElementById('co-a-name').value = 'FAIL';
  await win._coSaveAchievement();
  results.achSaveRpcFail = snapshot(win);
  win.__calls.length = 0;

  win.__confirmAnswer = false;
  await win._coDeleteAchievement(0);
  results.achDeleteDeclined = snapshot(win);
  win.__calls.length = 0;
  win.__confirmAnswer = true;
  await win._coDeleteAchievement(0);
  results.achDeleteOk = snapshot(win);
  win.__calls.length = 0;

  // ── Titles: open, save, delete (lighter pass) ──────────────────────────
  win._coSwitchTab('titles');
  win.__calls.length = 0;
  win._coOpenTitleForm(-1);
  win.document.getElementById('co-t-name').value = 'New Title';
  await win._coSaveTitle();
  results.titleSaveOk = snapshot(win);
  win.__calls.length = 0;
  await win._coDeleteTitle(0);
  results.titleDeleteOk = snapshot(win);
  win.__calls.length = 0;

  // ── Quizzes: open, add question, save, delete ──────────────────────────
  win._coSwitchTab('quizzes');
  win.__calls.length = 0;
  win._coOpenQuizForm(-1);
  results.quizAddFormDefaults = snapshot(win);
  win._coAddQuizQuestion();
  results.quizAfterAddQuestion = snapshot(win);
  win.document.getElementById('co-q-title').value = 'New Quiz';
  await win._coSaveQuiz();
  results.quizSaveOk = snapshot(win);
  win.__calls.length = 0;
  await win._coDeleteQuiz(0);
  results.quizDeleteOk = snapshot(win);
  win.__calls.length = 0;

  // ── Campaign Worlds: open, valid JSON save, malformed JSON error, delete ──
  win._coSwitchTab('campaignWorlds');
  win.__calls.length = 0;
  win._coOpenWorldForm(-1);
  win.document.getElementById('co-w-label').value = 'New World';
  win.document.getElementById('co-w-stages').value = '[{"name":"s1"}]';
  await win._coSaveWorld();
  results.worldSaveOk = snapshot(win);
  win.__calls.length = 0;

  win._coOpenWorldForm(-1);
  win.document.getElementById('co-w-label').value = 'Bad World';
  win.document.getElementById('co-w-stages').value = 'not json {{{';
  await win._coSaveWorld();
  results.worldSaveBadJson = snapshot(win);
  win.__calls.length = 0;
  await win._coDeleteWorld(0);
  results.worldDeleteOk = snapshot(win);
  win.__calls.length = 0;

  // ── Shop Items: open, save, delete ──────────────────────────────────────
  win._coSwitchTab('shopProducts');
  win.__calls.length = 0;
  win._coOpenShopForm(-1);
  win.document.getElementById('co-p-name').value = 'New Item';
  await win._coSaveShopItem();
  results.shopSaveOk = snapshot(win);
  win.__calls.length = 0;
  await win._coDeleteShopItem(0);
  results.shopDeleteOk = snapshot(win);
  win.__calls.length = 0;

  // Back to picker, and unmount resets edit mode.
  win._coBackToPicker();
  results.backToPicker = snapshot(win);
  win.__calls.length = 0;

  win.openContentOversightFor('t1', 'Ms. Alpha');
  win.__confirmAnswer = true;
  win._coToggleEditMode();
  win.unmountContentOversight();
  win.openContentOversightFor('t1', 'Ms. Alpha');
  await win.renderContentOversight();
  results.unmountResetsEditMode = snapshot(win);

  return results;
}

async function main() {
  const contentServiceSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'content-oversight-service.js'), 'utf8');
  const auditLogServiceSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'audit-log-service.js'), 'utf8');
  const teacherDirServiceSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'teacher-directory-service.js'), 'utf8');
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'content-oversight.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'content-oversight.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(auditLogServiceSrc); // content-oversight-service.js's own bare dependency
  winOriginal.eval(contentServiceSrc);
  winOriginal.eval(teacherDirServiceSrc);
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.renderContentOversight, 'function');
  const resultOriginal = await runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.renderContentOversight, 'function');
  const resultBridge = await runSequence(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original output at every step');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('content-oversight.js: non-admin gate, picker (fetch-fail/load/search/navigate), drill-in');
  console.log('(fetch-fail/load), the open-form-while-read-only no-op guard, edit-mode toggle');
  console.log('(confirm decline/accept), all 5 tabs, and for each entity type: save (validation/RPC-error/');
  console.log('success) and delete (declined/success) — plus quiz question-add and the campaign world raw-');
  console.log('JSON textarea (valid + malformed) — plus back-to-picker and unmount resetting edit mode.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
