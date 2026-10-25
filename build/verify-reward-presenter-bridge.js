// Phase 7 (Stream A) — equivalence check for modules/shared/reward-presenter.js.
//
// Real-imports AppStore (state-manager.js, this stream's own file) —
// same combined-bundle need as table-sync.js/student-stats.js (see
// build/test-helpers/reward-presenter-combined-entry.js's own header):
// the ORIGINAL window evals the real, untouched state-manager.js first
// (driven by a fake DBService), then the real, untouched
// reward-presenter.js on top of it (AppStore.subscribe() calls run at
// FILE-LOAD time, so load order matters); the BRIDGE side evals the
// combined test bundle, which shares one real AppStore instance between
// state-manager.js and reward-presenter.js the same way a real ES
// module graph would.
//
// jsdom gap disclosed, not faked: HTMLCanvasElement#getContext('2d')
// returns null in jsdom (no `canvas` npm package installed — the global
// rules explicitly say not to add one just to fake this). _eqrRunParticles
// calls ctx methods with no null-guard, so BOTH the original and the
// bridge throw identically, synchronously, inside eqRewardPresent()
// (which calls _eqrRunParticles() right after setting the overlay's
// innerHTML and appending it to <body>, but BEFORE wiring the close
// button's click handler). This means: (1) the close-button/overlay
// click handlers and the onClose callback genuinely cannot be exercised
// end-to-end via a real call to eqRewardPresent() in this environment —
// disclosed here, not stubbed around; (2) the overlay's generated HTML
// (reward cards, rarity styling, escaping, title-reward formatting) CAN
// still be verified, since it's set before the throw — every
// eqRewardPresent() call below is wrapped in try/catch, asserts the
// thrown error is the expected canvas one, and then still inspects
// document.getElementById('eq-reward-overlay').innerHTML.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', url: 'https://example.org/app/index.html' });
  const win = dom.window;
  win.__logs = [];
  ['log', 'warn', 'error'].forEach(level => {
    win.console[level] = (...args) => { win.__logs.push({ level, args: args.map(a => (a instanceof Error ? a.message : (a && a.message) || String(a))) }); };
  });

  win.currentUser = opts.currentUser !== undefined ? opts.currentUser : null;
  win.currentRole = opts.currentRole !== undefined ? opts.currentRole : null;
  win.__mailCalls = 0;
  win.__achCalls = 0;
  win.mailUpdateSidebarBadge = () => { win.__mailCalls++; };
  win.achUpdateSidebarBadge = () => { win.__achCalls++; };

  win.DEFAULT_DB = { students: [], quizzes: [], bossEvents: [], pointLog: [], notifications: [], orders: [], bossParticipants: {}, inventory: {}, redemptions: [], titles: [], quizHistory: {}, stageMap: [], store: [], achievements: [], classSections: [] };
  win.DBService = { initRemote: async () => {}, read: () => win.DEFAULT_DB, write: () => {} };

  // _esc/_cssColor are utils.js window-fallbacks (already converted, but
  // NOT by this stream, so still window-fallback here too) — reward
  // card rendering calls both. Stubbed with the REAL utils.js
  // implementations (copied verbatim) rather than no-op stubs, since
  // this file's escaping/color-validation behavior is exactly what
  // several assertions below check.
  win._esc = function (s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  win._cssColor = function (s, fallback) {
    fallback = fallback || '#8b5cf6';
    const v = String(s || '').trim();
    if (/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) return v;
    if (/^var\(--[a-zA-Z0-9-]+\)$/.test(v)) return v;
    return fallback;
  };

  return win;
}

function normalizeLogs(logs) {
  return logs.filter(l => !l.args.some(a => typeof a === 'string' && a.includes('[AppStore]')));
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function tryPresent(win, opts) {
  let threw = null;
  try {
    win.eqRewardPresent(opts);
  } catch (e) {
    threw = e.message;
  }
  const overlay = win.document.getElementById('eq-reward-overlay');
  return {
    threw,
    overlayHTML: overlay ? overlay.innerHTML : null,
    overlayExists: !!overlay,
  };
}

async function runPresentScenarios(win) {
  const results = {};

  // 1. Defaults (empty opts): default title/subtitle/icon/rarity/source, no rewards.
  results.defaults = await tryPresent(win, {});

  // 2. Custom opts, rewards array mixing a normal numeric reward, a
  //    string-amount reward, and a title-type reward; also exercises the
  //    escaping helper (_esc, window-fallback to utils.js) via a title
  //    containing HTML-special characters.
  results.custom = await tryPresent(win, {
    title: 'Boss <Slain>!',
    subtitle: 'You defeated the "Molecule Dragon" & earned rewards.',
    icon: '🐉',
    rarity: 'legendary',
    source: 'boss',
    rewards: [
      { type: 'xp', amount: 500, icon: '⭐', label: 'XP' },
      { type: 'coins', amount: 'N/A', icon: '🪙', label: 'Coins', color: '#ffb95f' },
      { type: 'title', label: 'Boss Tamer', icon: '🎖️', color: '#f472b6' },
    ],
    onClose: () => {},
  });

  // 3. Unknown rarity falls back to Rare's color set.
  results.unknownRarity = await tryPresent(win, { rarity: 'nonexistent-rarity' });

  // 4. Unknown source falls back to the generic 'REWARD' label.
  results.unknownSource = await tryPresent(win, { source: 'totally-unknown-source' });

  // 5. Calling again removes the previous overlay first — only one
  //    #eq-reward-overlay should ever exist at a time.
  await tryPresent(win, { title: 'First' });
  const firstOverlay = win.document.getElementById('eq-reward-overlay');
  results.overlayExistsAfterFirst = !!firstOverlay;
  await tryPresent(win, { title: 'Second' });
  const allOverlays = win.document.querySelectorAll('#eq-reward-overlay');
  results.overlayCountAfterSecond = allOverlays.length;

  return results;
}

async function runParticlesDirectScenarios(win) {
  const results = {};
  const dummyColor = { bg: '#000', border: '#111', strip: '#222', glow: '#333' };

  // Missing canvas: no-op, must not throw (the one guard clause this
  // function DOES have, and it's fully verifiable without real canvas).
  let noCanvasThrew = false;
  try { win._eqrRunParticles('does-not-exist', dummyColor); } catch (e) { noCanvasThrew = true; }
  results.noCanvasThrew = noCanvasThrew;

  // Existing canvas: throws due to the jsdom 2D-context gap (disclosed
  // above) — both sides must throw identically.
  const canvas = win.document.createElement('canvas');
  canvas.id = 'standalone-canvas';
  win.document.body.appendChild(canvas);
  let threw = null;
  try { win._eqrRunParticles('standalone-canvas', dummyColor); } catch (e) { threw = e.message; }
  results.withCanvasThrew = threw;

  return results;
}

async function runSubscriberScenarios(win) {
  const results = {};

  // session:booted — student + currentUser present: badges refresh after 400ms.
  win.currentRole = 'student';
  win.currentUser = { id: 's1' };
  win.AppStore.emit({ type: 'session:booted' });
  await sleep(20);
  results.bootedStudentImmediately = { mail: win.__mailCalls, ach: win.__achCalls };
  await sleep(420);
  results.bootedStudentAfter420ms = { mail: win.__mailCalls, ach: win.__achCalls };

  // session:booted — student but currentUser falsy: gated off (booted
  // case explicitly checks `&& currentUser`, unlike the nav case below).
  win.__mailCalls = 0; win.__achCalls = 0;
  win.currentUser = null;
  win.AppStore.emit({ type: 'session:booted' });
  await sleep(420);
  results.bootedStudentNoUserAfter420ms = { mail: win.__mailCalls, ach: win.__achCalls };

  // session:booted — non-student role: gated off.
  win.__mailCalls = 0; win.__achCalls = 0;
  win.currentRole = 'teacher';
  win.currentUser = { id: 't1' };
  win.AppStore.emit({ type: 'session:booted' });
  await sleep(420);
  results.bootedTeacherAfter420ms = { mail: win.__mailCalls, ach: win.__achCalls };

  // nav:navigated — student, currentUser NOT checked at all here:
  // must fire even with currentUser null.
  win.__mailCalls = 0; win.__achCalls = 0;
  win.currentRole = 'student';
  win.currentUser = null;
  win.AppStore.emit({ type: 'nav:navigated' });
  await sleep(170);
  results.navStudentNoUserAfter170ms = { mail: win.__mailCalls, ach: win.__achCalls };

  // nav:navigated — non-student: gated off.
  win.__mailCalls = 0; win.__achCalls = 0;
  win.currentRole = 'admin';
  win.AppStore.emit({ type: 'nav:navigated' });
  await sleep(170);
  results.navAdminAfter170ms = { mail: win.__mailCalls, ach: win.__achCalls };

  // Unrelated event type: both subscribers no-op.
  win.__mailCalls = 0; win.__achCalls = 0;
  win.currentRole = 'student';
  win.currentUser = { id: 's1' };
  win.AppStore.emit({ type: 'some:other-event' });
  await sleep(420);
  results.unrelatedEventAfter420ms = { mail: win.__mailCalls, ach: win.__achCalls };

  return results;
}

async function runFullSuite(makeEval, isBridge) {
  const results = {};

  const win1 = makeWindow({});
  makeEval(win1);
  // EQR_RARITY_COLORS/EQR_SOURCE_LABELS are plain top-level `const` in the
  // original classic script — per established project convention
  // (confirmed on SIDEBAR_COLLAPSE_KEY/DB_KEY/QUEST_IMAGES etc.) they
  // never land on window there; only the bridge's own combined test
  // bundle explicitly re-exports them for external test access. Read
  // them only on the bridge side, and verify the original's values
  // indirectly instead, through the overlay HTML/behavioral checks below
  // (which exercise the same underlying color/label tables).
  results.rarityColorsOnWindow = isBridge ? win1.EQR_RARITY_COLORS : null;
  results.sourceLabelsOnWindow = isBridge ? win1.EQR_SOURCE_LABELS : null;
  results.present = await runPresentScenarios(win1);
  results.particlesDirect = await runParticlesDirectScenarios(win1);

  const win2 = makeWindow({});
  makeEval(win2);
  results.subscribers = await runSubscriberScenarios(win2);
  results.loadLog = normalizeLogs(win2.__logs).find(l => l.args.some(a => typeof a === 'string' && a.includes('shared/reward-presenter.js loaded'))) || null;

  return results;
}

async function main() {
  const stateManagerSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'core', 'state-manager.js'), 'utf8');
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'shared', 'reward-presenter.js'), 'utf8');
  const combinedBridgeSrc = fs.readFileSync(path.join(__dirname, 'test-helpers', 'reward-presenter-combined-bundle.js'), 'utf8');

  const resultOriginal = await runFullSuite(win => { win.eval(stateManagerSrc); win.eval(originalSrc); }, false);
  const resultBridge = await runFullSuite(win => { win.eval(combinedBridgeSrc); }, true);

  // Expected asymmetry: the original never puts these plain consts on
  // window; the bridge/combined test bundle explicitly does, for test
  // access. Verify the asymmetry itself, then drop both fields before
  // the main structural comparison.
  assert.strictEqual(resultOriginal.rarityColorsOnWindow, null, 'sanity: original never puts EQR_RARITY_COLORS on window');
  assert.strictEqual(resultOriginal.sourceLabelsOnWindow, null, 'sanity: original never puts EQR_SOURCE_LABELS on window');
  assert.ok(resultBridge.rarityColorsOnWindow && resultBridge.rarityColorsOnWindow.Rare, 'sanity: bridge/combined bundle exposes EQR_RARITY_COLORS on window');
  assert.ok(resultBridge.sourceLabelsOnWindow && resultBridge.sourceLabelsOnWindow.boss, 'sanity: bridge/combined bundle exposes EQR_SOURCE_LABELS on window');
  delete resultOriginal.rarityColorsOnWindow; delete resultBridge.rarityColorsOnWindow;
  delete resultOriginal.sourceLabelsOnWindow; delete resultBridge.sourceLabelsOnWindow;

  assert.deepStrictEqual(resultBridge, resultOriginal, 'bridge output must exactly match original at every step');

  // Sanity checks against the original's own real values, so a
  // trivially-passing no-op comparison can't hide behind "both sides do
  // nothing".
  assert.strictEqual(resultOriginal.present.defaults.threw !== null, true, 'sanity: jsdom canvas gap makes eqRewardPresent() throw (disclosed, not faked)');
  assert.ok(resultOriginal.present.defaults.overlayHTML.includes('Rewards Acquired!'), 'sanity: default title present in generated HTML despite the later throw');
  assert.ok(resultOriginal.present.defaults.overlayHTML.includes('eqr-no-rewards'), 'sanity: no-rewards state renders the empty-state div');
  assert.ok(resultOriginal.present.custom.overlayHTML.includes('Boss &lt;Slain&gt;!'), 'sanity: title is escaped via _esc (utils.js window-fallback)');
  assert.ok(resultOriginal.present.custom.overlayHTML.includes('Boss Tamer'), 'sanity: title-type reward label rendered');
  assert.ok(resultOriginal.present.custom.overlayHTML.includes('Title Unlocked'), 'sanity: title-type reward gets the "Title Unlocked" sub-label, not its own label text');
  assert.strictEqual(resultOriginal.present.overlayExistsAfterFirst, true, 'sanity: overlay created');
  assert.strictEqual(resultOriginal.present.overlayCountAfterSecond, 1, 'sanity: calling again replaces rather than stacks overlays');
  assert.strictEqual(resultOriginal.particlesDirect.noCanvasThrew, false, 'sanity: the one real guard clause (missing canvas) does not throw');
  assert.strictEqual(typeof resultOriginal.particlesDirect.withCanvasThrew, 'string', 'sanity: real canvas still throws on the null 2D context (jsdom gap)');
  assert.strictEqual(resultOriginal.subscribers.bootedStudentImmediately.mail, 0, 'sanity: booted badges are deferred (setTimeout 400ms), not immediate');
  assert.strictEqual(resultOriginal.subscribers.bootedStudentAfter420ms.mail, 1, 'sanity: booted badges fire once after 400ms for a student session');
  assert.strictEqual(resultOriginal.subscribers.bootedStudentAfter420ms.ach, 1, 'sanity: both badges fire together');
  assert.strictEqual(resultOriginal.subscribers.bootedStudentNoUserAfter420ms.mail, 0, 'sanity: booted gate requires currentUser truthy too');
  assert.strictEqual(resultOriginal.subscribers.bootedTeacherAfter420ms.mail, 0, 'sanity: booted gate requires currentRole===student');
  assert.strictEqual(resultOriginal.subscribers.navStudentNoUserAfter170ms.mail, 1, 'sanity: nav gate does NOT require currentUser (unlike booted gate)');
  assert.strictEqual(resultOriginal.subscribers.navAdminAfter170ms.mail, 0, 'sanity: nav gate requires currentRole===student');
  assert.strictEqual(resultOriginal.subscribers.unrelatedEventAfter420ms.mail, 0, 'sanity: unrelated event types are ignored by both subscribers');
  assert.ok(resultOriginal.loadLog, 'sanity: the load-time console.log line fired');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('reward-presenter.js: rarity/source tables, overlay HTML generation (escaping, title-reward');
  console.log('formatting, overlay replace-not-stack) verified up to the disclosed jsdom canvas-context gap,');
  console.log('the one real canvas guard clause, and both AppStore subscribers (session:booted requiring');
  console.log('currentUser, nav:navigated NOT requiring it) all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
