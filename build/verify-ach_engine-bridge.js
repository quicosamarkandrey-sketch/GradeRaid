// Phase 7 (Stream D) — equivalence check for modules/achievements/ach_engine.js.
//
// Loads the ORIGINAL classic ach_engine.js into one jsdom window and the
// BUNDLED BRIDGE (dist/bridges/ach_engine.bridge.js, built from
// src/modules/achievements/ach_engine.js) into another, with identical
// starter DOM and identical stubs for everything outside this file (per the
// global rule those are bare-identifier window fallbacks: AppStore, uid,
// _esc, navTo, updateTopbar, getCurrentRole/getCurrentUser,
// eqGetQuestChains, computeQuestStreak, the three sync*ToServer functions).
// Both windows are driven through the same scenarios and every observable
// result (return values, AppStore state mutations, AppStore.emit/updateState
// calls, DOM, sync-call arguments, the current-user binding) is compared.
//
// FAITHFUL GLOBALS: index.html declares `let currentUser = null,
// currentRole = null` in a classic inline <script> — a global LEXICAL
// binding, not a window property. The stubs are injected as a real
// <script> element using `let` for exactly that reason: ach_engine's two
// bare `currentUser = ...` assignments must work against that kind of
// binding in both the original and the IIFE-bundled bridge.
//
// OBSERVING INTERNAL CALLS: inside the original, bare calls such as
// achCheckAndAward(...) from the subscribers resolve through window at call
// time; inside the bundle they bind to the module's own export. So this
// check deliberately does NOT spy on window.achCheckAndAward (that would
// only see the original's calls). It observes the *effects* instead —
// chiefly the 'achievements:check-and-award-ran' event the exported
// wrapper emits, whose payload carries the suppressPopup value.
//
// ASYNC: real timers, nothing faked — 400ms/500ms subscriber delays, the
// i*1400ms popup stagger, the 400ms popup-out animation, the 4500ms
// auto-dismiss. Ordering assertions are load-independent (400ms-group emits
// must precede 500ms-group emits); absolute timing only uses lower bounds.
//
// jsdom notes: cross-realm objects are compared via JSON round-trips (see
// global rules). `style.animation` isn't a modelled CSS property in jsdom but
// the JS property assignment still round-trips, so it is compared directly.
//
// Prints EQUIVALENCE CHECK PASSED only if every comparison and every
// hand-computed sanity assertion on the ORIGINAL's results holds.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const EXPORT_KINDS = {
  ACH_RARITY: 'object',
  ACH_RARITIES: 'array',
  ACH_TRIGGER_TYPES: 'array',
  achRarityClass: 'function',
  achBuildStats: 'function',
  achEvaluateTrigger: 'function',
  achCheckAndAward: 'function',
  _achCheckAndAwardCore: 'function',
  achGrantRewardsForClaim: 'function',
  achUpdateSidebarBadge: 'function',
  achShowUnlockPopup: 'function',
};

const STARTER_HTML = `<!doctype html><html><body>
  <button id="nav-s-badges">Badges</button>
</body></html>`;

// Everything ach_engine.js needs from outside itself. NOTE: no `window.` on
// the lets — they must be true global lexical bindings, like index.html's.
const STUBS = `
let currentUser = null, currentRole = null;
var __state = {};
var __calls = [];
var __emitTimes = [];
var __subs = {};
var AppStore = {
  getSlice: function (fn) { return fn(__state); },
  updateState: function (fn, ev) { fn(__state); __calls.push({ k: 'updateState', ev: ev }); },
  emit: function (ev) { __calls.push({ k: 'emit', ev: ev }); __emitTimes.push(Date.now()); },
  subscribe: function (id, fn) { __subs[id] = fn; },
};
function uid() { return 'UID'; }
function _esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function navTo(x) { __calls.push({ k: 'navTo', x: x }); }
function updateTopbar() { __calls.push({ k: 'updateTopbar' }); }
function getCurrentRole() { return currentRole; }
function getCurrentUser() { return currentUser; }
function syncStudentStatsToServer() { __calls.push({ k: 'syncStudentStats', a: Array.prototype.slice.call(arguments) }); }
function syncAchievementUnlockToServer() { __calls.push({ k: 'syncUnlock', a: Array.prototype.slice.call(arguments) }); }
function syncAchievementClaimToServer() { __calls.push({ k: 'syncClaim', a: Array.prototype.slice.call(arguments) }); }
// assigned (not declared) so they are configurable and the typeof-guard
// branches in achBuildStats can be exercised by deleting them
window.eqGetQuestChains = function () { return __state.__chains || []; };
window.computeQuestStreak = function (sid) { return { current: ((__state.__streak || {})[sid]) || 0 }; };
`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
// Round-trip through JSON in THIS realm and blank out wall-clock timestamps.
const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v).replace(ISO, '<ISO>'));

function makeWindow(src) {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  win.console.error = (...a) => logs.push('ERROR ' + a.join(' '));
  const s = win.document.createElement('script');
  s.textContent = STUBS;
  win.document.body.appendChild(s);
  win.eval(src);
  return { win, logs };
}

function setState(win, state, role, userId) {
  win.eval('__state = ' + JSON.stringify(state) + '; __calls.length = 0; __emitTimes.length = 0;');
  win.eval('currentRole = ' + JSON.stringify(role || null) + ';');
  win.eval('currentUser = ' + (userId ? '(__state.students||[]).find(function(x){return x.id===' + JSON.stringify(userId) + '}) || null' : 'null') + ';');
  win.document.getElementById('nav-s-badges').innerHTML = 'Badges';
  const p = win.document.getElementById('ach-unlock-popup');
  if (p) p.remove();
}

// Make currentUser a DISTINCT stale copy of the state's student. Without this
// the harness's currentUser is the very same object the code would reassign it
// to, so dropping `currentUser = ...` would be invisible (a mutation test
// caught exactly that gap). After the flow: fresh object => userStale false.
const stale = win => win.eval('currentUser = currentUser ? Object.assign({}, currentUser, { __stale: true }) : null;');

const snapBadge = win => {
  const b = win.document.querySelector('#nav-s-badges .ach-nav-badge');
  return b ? { text: b.textContent, html: b.outerHTML, count: win.document.querySelectorAll('#nav-s-badges .ach-nav-badge').length } : null;
};
const snapPopup = win => {
  const els = win.document.querySelectorAll('#ach-unlock-popup');
  if (!els.length) return null;
  return { count: els.length, html: els[0].outerHTML, anim: els[0].style.animation || '' };
};
const snap = win => clean({
  state: win.eval('__state'),
  calls: win.eval('__calls'),
  badge: snapBadge(win),
  popup: snapPopup(win),
  currentUserId: win.eval('currentUser && currentUser.id'),
  userStale: !!win.eval('currentUser && currentUser.__stale'),
});

// ── fixtures ────────────────────────────────────────────────────────────────
const statsState = () => ({
  students: [
    { id: 's1', level: 5, xp: 500, coins: 120, attendance: 88, quizAvg: 91, completedQuizzes: ['q1', 'q2'], classId: 'c1' },
    { id: 's2', level: 9, xp: 900, coins: 5 },
    { id: 's3', xp: 100 },
  ],
  // keyed by boss INDEX (achBuildStats reads bossParticipants[bi] by array index)
  bossParticipants: {
    0: { s1: { totalDamage: 300, critHits: 4, minionsDefeated: 7 }, s2: { totalDamage: 900, critHits: 1, minionsDefeated: 2 } },
    1: { s1: { totalDamage: 50, critHits: 2, minionsDefeated: 3 } },
    3: { s1: { totalDamage: 0 } },
  },
  bossEvents: [{ status: 'ended' }, { status: 'loot' }, { status: 'active' }, { status: 'ended' }],
  redemptions: [{ studentId: 's1', pts: 50 }, { studentId: 's1' }, { studentId: 's2', pts: 30 }],
  attendanceLogs: [
    { studentId: 's1', status: 'Early' }, { studentId: 's1', status: 'On Time' }, { studentId: 's1', status: 'Late' },
    { studentId: 's1', status: 'Absent' }, { studentId: 's1', status: 'Excused' }, { studentId: 's2', status: 'Early' },
  ],
  // newest -> oldest, as the app unshifts
  pointLog: [
    { studentId: 's1', what: 'Quest: A (100%)' },
    { studentId: 's1', what: 'Bonus points' },
    { studentId: 's1', what: 'Quest: B (100%)' },
    { studentId: 's1', what: 'Quest: C (80%)' },
    { studentId: 's1', what: 'Quest: D (100%)' },
    { studentId: 's1' },
    { studentId: 's1', what: 'Quest: E (100%)' },
    { studentId: 's1', what: 'Quest: F (100%)' },
    { studentId: 's1', what: 'Quest: G (no score)' },
    { studentId: 's1', what: 'Quest: H (100%)' },
    { studentId: 's2', what: 'Quest: X (100%)' },
  ],
  recitationLog: [{ studentId: 's1' }, { studentId: 's1' }, { studentId: 's1' }, { studentId: 's2' }],
  quizzes: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }, { id: 'q4' }],
  __chains: [
    { quizzes: [{ id: 'q1' }, { id: 'q2' }] }, // fully done
    { quizzes: [{ id: 'q3' }] },                // not done
    { quizzes: [] },                            // empty chain never counts
  ],
  __streak: { s1: 6 },
});

const checkState = () => ({
  students: [{ id: 's1', level: 5, xp: 500, coins: 120, classId: 'c1' }, { id: 's2', level: 1, xp: 1 }],
  achievements: [
    { id: 'a1', active: true, triggerType: 'level', triggerValue: 3, xpReward: '50', coinReward: 10 },
    { id: 'a2', active: true, triggerType: 'xp_earned', triggerValue: 400, xpReward: 20 },
    { id: 'a3', active: false, triggerType: 'level', triggerValue: 1 },
    { id: 'a4', active: true, triggerType: 'level', triggerValue: 100 },
    { id: 'a5', active: true, triggerType: 'level', triggerValue: 1 },  // already unlocked
    { id: 'a6', active: true, triggerType: 'level', triggerValue: 1 },  // scoped to another class
    { id: 'a7', active: true, triggerType: 'level', triggerValue: 1 },  // scoped incl. own class
    { id: 'a8', active: true, triggerType: 'manual', triggerValue: 0 },
    { id: 'a9', active: true, triggerType: 'level', triggerValue: 1 },  // empty scope list == global
  ],
  achievementUnlocks: { s1: [{ achId: 'a5', claimed: true }] },
  achievementSectionAssignments: { a6: ['other-class'], a7: ['c1', 'c2'], a9: [] },
});

// ── the scenarios, run identically against each window ─────────────────────
async function runAll(win) {
  const out = {};

  // 1. constants + which symbols exist on window, and of what kind
  out.constants = clean({ r: win.ACH_RARITY, rs: win.ACH_RARITIES, t: win.ACH_TRIGGER_TYPES });
  out.kinds = {};
  for (const [name, kind] of Object.entries(EXPORT_KINDS)) {
    const v = win[name];
    out.kinds[name] = Array.isArray(v) ? 'array' : typeof v;
    assert.strictEqual(out.kinds[name], kind, `window.${name} should be a ${kind}`);
  }

  // 2. achRarityClass
  out.rarityClass = [win.achRarityClass('Rare'), win.achRarityClass(), win.achRarityClass(''), win.achRarityClass(null), win.achRarityClass('MYTHIC')];

  // 3. achBuildStats — empty inputs, rich state, guard-branch variants
  setState(win, {}, null, null);
  out.statsNull = clean([win.achBuildStats(null), win.achBuildStats(undefined)]);
  out.statsBareStudent = clean(win.achBuildStats({ id: 'sx' })); // all slices missing, all || 0 fallbacks
  setState(win, statsState(), null, null);
  const st = () => win.eval('__state').students;
  out.statsS1 = clean(win.achBuildStats(st().find(s => s.id === 's1')));
  out.statsS2 = clean(win.achBuildStats(st().find(s => s.id === 's2')));
  out.statsS3 = clean(win.achBuildStats(st().find(s => s.id === 's3')));
  out.statsUnknown = clean(win.achBuildStats({ id: 'ghost', xp: 1 })); // not in students -> live_rank 0
  // typeof-guard branches: the two quest helpers not defined at all
  win.eval('var __saveChains = eqGetQuestChains, __saveStreak = computeQuestStreak; delete window.eqGetQuestChains; delete window.computeQuestStreak;');
  out.statsNoQuestHelpers = clean(win.achBuildStats(st().find(s => s.id === 's1')));
  win.eval('window.eqGetQuestChains = __saveChains; window.computeQuestStreak = __saveStreak;');

  // 4. achEvaluateTrigger — every trigger type at and just below its boundary
  const S = { level: 10, xp: 10, coins: 10, coins_spent: 10, quests_completed: 10, total_quests: 10, best_quiz_score: 10, quizAvg: 10,
    perfect_streak: 10, boss_victories: 10, boss_damage: 10, boss_crits: 10, minions_killed: 10, attendance_present: 10, attendance: 10,
    store_purchases: 10, recitation_count: 10, live_rank: 10, quest_chains_completed: 10, quest_streak: 10 };
  out.triggers = {};
  const types = win.ACH_TRIGGER_TYPES.map(t => t.value);
  assert.strictEqual(types.length, 21, 'sanity: 21 trigger types');
  for (const t of types) {
    const at = (v, stats) => win.achEvaluateTrigger({ triggerType: t, active: true, triggerValue: v }, stats || S);
    out.triggers[t] = [at(10), at(11), at('10'), at(0)];
  }
  out.triggers.unknownType = win.achEvaluateTrigger({ triggerType: 'nope', active: true, triggerValue: 1 }, S);
  out.triggers.inactive = win.achEvaluateTrigger({ triggerType: 'level', active: false, triggerValue: 1 }, S);
  out.triggers.noType = win.achEvaluateTrigger({ active: true, triggerValue: 1 }, S);
  out.triggers.noAch = [win.achEvaluateTrigger(null, S), win.achEvaluateTrigger(undefined, S)];
  out.triggers.nanValue = win.achEvaluateTrigger({ triggerType: 'level', active: true, triggerValue: 'abc' }, S); // v -> 0
  out.triggers.allQuests = [
    win.achEvaluateTrigger({ triggerType: 'all_quests', active: true }, { total_quests: 0, quests_completed: 0 }),
    win.achEvaluateTrigger({ triggerType: 'all_quests', active: true }, { total_quests: 3, quests_completed: 2 }),
    win.achEvaluateTrigger({ triggerType: 'all_quests', active: true }, { total_quests: 3, quests_completed: 3 }),
  ];
  out.triggers.topRank = [0, 1, 3, 4].map(rank => win.achEvaluateTrigger({ triggerType: 'top_rank', active: true, triggerValue: 3 }, { live_rank: rank }));
  out.triggers.manual = win.achEvaluateTrigger({ triggerType: 'manual', active: true, triggerValue: 0 }, S);

  // 5a. achCheckAndAward — no student id / unknown student (emit still fires)
  out.check = {};
  setState(win, checkState(), 'student', 's1'); stale(win);
  win.achCheckAndAward(undefined, true);
  win.achCheckAndAward('ghost', false);
  out.check.early = snap(win);

  // 5b. real unlocks, popup suppressed: scoping, already-unlocked, inactive, manual, unmet
  setState(win, checkState(), 'student', 's1'); stale(win);
  win.achCheckAndAward('s1', true);
  out.check.unlocked = snap(win);

  // 5c. nothing new to unlock (second call right after) — no updateState/sync, emit still fires
  win.eval('__calls.length = 0'); stale(win);
  win.achCheckAndAward('s1', true);
  out.check.nothingNew = snap(win);

  // 5d. classId fallback to 'default-class' when the student has none
  const fb = checkState();
  fb.students = [{ id: 's9', level: 1, xp: 1 }];
  fb.achievements = [{ id: 'f1', active: true, triggerType: 'level', triggerValue: 1 }, { id: 'f2', active: true, triggerType: 'level', triggerValue: 1 }];
  fb.achievementUnlocks = {}; // and no slice entry for this student at all
  fb.achievementSectionAssignments = { f1: ['default-class'], f2: ['c1'] };
  setState(win, fb, 'student', 's9'); stale(win);
  win.achCheckAndAward('s9', true);
  out.check.classFallback = snap(win);

  // 5e. popup NOT suppressed, two unlocks -> staggered i*1400ms (real timing)
  const pop = checkState();
  pop.achievements = [{ id: 'p1', name: 'First', icon: '🥇', rarity: 'Epic', active: true, triggerType: 'level', triggerValue: 1, xpReward: 5 },
                      { id: 'p2', name: 'Second', active: true, triggerType: 'level', triggerValue: 1 }];
  pop.achievementUnlocks = {}; pop.achievementSectionAssignments = {};
  setState(win, pop, 'student', 's1');
  win.achCheckAndAward('s1');
  await sleep(150);
  out.check.stagger150 = snap(win);   // first popup only
  await sleep(1500);                  // t ~ 1650ms: second popup replaced the first
  out.check.stagger1650 = snap(win);
  win.document.getElementById('ach-unlock-popup').remove();

  // 6. achGrantRewardsForClaim
  out.claim = {};
  const cl = () => ({
    students: [{ id: 's1', xp: 10, coins: 5 }],
    achievements: [{ id: 'k1', name: 'Claimable' }],
    achievementUnlocks: { s1: [
      { achId: 'k1', claimed: false, xpGranted: '25', coinsGranted: 7 },
      { achId: 'k2', claimed: false, xpGranted: 40, coinsGranted: 0 },   // ach record missing -> name fallback, xp-only pts
      { achId: 'k3', claimed: false, xpGranted: 0, coinsGranted: 0 },    // nothing to grant -> no pointLog entry
      { achId: 'k4', claimed: true, xpGranted: 99, coinsGranted: 99 },   // already claimed
    ] },
  });
  setState(win, cl(), 'student', 's1'); stale(win);
  out.claim.r1 = clean(win.achGrantRewardsForClaim('s1', 'k1'));
  out.claim.after1 = snap(win);
  out.claim.r2 = clean(win.achGrantRewardsForClaim('s1', 'k2'));
  out.claim.r3 = clean(win.achGrantRewardsForClaim('s1', 'k3'));
  stale(win); // a failed claim below must leave currentUser alone
  out.claim.r4 = clean(win.achGrantRewardsForClaim('s1', 'k4'));
  out.claim.r5 = clean(win.achGrantRewardsForClaim('s1', 'nope'));
  out.claim.r6 = clean(win.achGrantRewardsForClaim('ghost', 'k1'));
  out.claim.r7 = clean(win.achGrantRewardsForClaim('s1', 'k1')); // double-claim
  out.claim.failedClaimsLeftUserStale = snap(win).userStale;
  out.claim.afterAll = snap(win);
  // unlock exists but the student vanished before the update -> false, no sync
  const van = cl(); van.students = [];
  setState(win, van, 'student', null);
  out.claim.vanished = clean(win.achGrantRewardsForClaim('s1', 'k1'));
  out.claim.vanishedSnap = snap(win);
  // zero-grant claim on a state with NO pointLog at all must not create one
  const noLog = cl(); delete noLog.pointLog;
  setState(win, noLog, 'student', 's1');
  win.achGrantRewardsForClaim('s1', 'k3');
  out.claim.noPointLog = snap(win);

  // 7. achUpdateSidebarBadge — every branch
  out.badge = {};
  const unl = n => ({ students: [{ id: 's1' }], achievementUnlocks: { s1: Array.from({ length: n }, (_, i) => ({ achId: 'b' + i, claimed: false })).concat([{ achId: 'done', claimed: true }]) } });
  setState(win, unl(3), 'teacher', 's1'); win.achUpdateSidebarBadge(); out.badge.notStudent = snapBadge(win);
  setState(win, unl(3), 'student', null);  win.achUpdateSidebarBadge(); out.badge.noUser = snapBadge(win);
  setState(win, unl(3), 'student', 's1');
  win.document.getElementById('nav-s-badges').remove();
  win.achUpdateSidebarBadge(); // no button in DOM: must not throw
  out.badge.noButtonNoThrow = true;
  win.document.body.insertAdjacentHTML('beforeend', '<button id="nav-s-badges">Badges</button>');
  win.achUpdateSidebarBadge(); out.badge.three = snapBadge(win);
  win.achUpdateSidebarBadge(); out.badge.threeAgainNoDup = snapBadge(win);
  win.eval('__state = ' + JSON.stringify(unl(99)));  win.achUpdateSidebarBadge(); out.badge.n99 = snapBadge(win);   // last uncapped value
  win.eval('__state = ' + JSON.stringify(unl(100))); win.achUpdateSidebarBadge(); out.badge.n100 = snapBadge(win);  // first capped value
  win.eval('__state = ' + JSON.stringify(unl(150))); win.achUpdateSidebarBadge(); out.badge.capped = snapBadge(win);
  win.eval('__state = ' + JSON.stringify(unl(0)));   win.achUpdateSidebarBadge(); out.badge.removed = snapBadge(win);
  win.achUpdateSidebarBadge(); out.badge.zeroAgain = snapBadge(win); // no badge, no button work, no throw

  // 8. achShowUnlockPopup — variants, replacement, click, auto-dismiss (real timing)
  out.popup = {};
  setState(win, {}, 'student', null);
  win.achShowUnlockPopup({ id: 'x1', name: '<b>Bold</b> & "q"', icon: '🎉', rarity: 'Legendary', xpReward: 10 });
  out.popup.legendaryRewards = snapPopup(win);
  win.achShowUnlockPopup({ id: 'x2', name: 'Plain', rarity: 'Bogus' }); // unknown rarity -> Common, no icon -> 🏅, no rewards
  out.popup.unknownRarityReplaces = snapPopup(win);
  win.achShowUnlockPopup({ id: 'x3', name: 'Coins only', coinReward: 5 }); // rarity undefined -> Common; coinReward counts as rewards
  out.popup.coinOnly = snapPopup(win);
  win.document.getElementById('ach-unlock-popup').click();
  out.popup.clickedImmediately = snapPopup(win);
  await sleep(500);
  out.popup.clickedAfter500 = snapPopup(win);
  out.popup.clickedCalls = clean(win.eval('__calls'));
  // auto-dismiss on a fresh popup; the earlier popups' stale 4500ms timers
  // fire during this window on already-removed elements and must be no-ops
  win.achShowUnlockPopup({ id: 'x4', name: 'Auto', rarity: 'Mythic' });
  await sleep(4000); out.popup.auto4000 = snapPopup(win);
  await sleep(700);  out.popup.auto4700 = snapPopup(win); // animating out
  await sleep(400);  out.popup.auto5100 = snapPopup(win); // gone
  out.popup.finalCalls = clean(win.eval('__calls'));

  // 9. the 4 load-time subscribers: registration order, filtering, delays
  out.subs = {};
  out.subs.registered = Object.keys(win.eval('__subs'));
  setState(win, { students: [{ id: 's1' }], achievements: [], achievementUnlocks: { s1: [{ achId: 'z', claimed: false }] } }, 'student', 's1');
  const fire = (id, type, payload, extra) => win.eval('__subs')[id](win.eval('__state'), Object.assign({ type }, payload === undefined ? {} : { payload }, extra || {}));
  const btn = win.document.getElementById('nav-s-badges');
  // state-sync: ignored events must not touch the sidebar or schedule a check
  btn.innerHTML = 'Badges';
  fire('ach-engine-state-sync', 'not:watched', { studentId: 's1' });
  fire('ach-engine-state-sync', 'attendance:scan-recorded', { studentId: 's1', alreadyRecorded: true });
  out.subs.ignoredBadge = snapBadge(win);
  fire('ach-engine-state-sync', 'xp:awarded', {});                 // watched, no studentId: badge refresh only
  out.subs.noStudentIdBadge = snapBadge(win);
  fire('ach-engine-state-sync', 'xp:awarded', undefined);          // watched, no payload at all
  const watched = ['recitation:logged', 'loot:claimed', 'xp:awarded', 'state:legacy-sync', 'attendance:scan-recorded', 'attendance:override'];
  watched.forEach((t, i) => fire('ach-engine-state-sync', t, { studentId: 'w' + i }));
  fire('ach-engine-state-sync', 'attendance:scan-recorded', { studentId: 'w9', alreadyRecorded: false });
  // boss damage: two accepted types, three ignored shapes
  fire('ach-engine-boss-damage', 'world-boss:damage-applied', { studentId: 'b1' });
  fire('ach-engine-boss-damage', 'world-boss:defeated', { studentId: 'b2' });
  fire('ach-engine-boss-damage', 'world-boss:other', { studentId: 'bx' });
  fire('ach-engine-boss-damage', 'world-boss:damage-applied', undefined);
  fire('ach-engine-boss-damage', 'world-boss:damage-applied', {});
  // session booted: student+user -> fires for current user; wrong type / wrong role ignored
  fire('ach-engine-session-booted', 'session:booted', {});
  fire('ach-engine-session-booted', 'something:else', {});
  win.eval("currentRole = 'teacher'");
  fire('ach-engine-session-booted', 'session:booted', {});
  win.eval("currentRole = 'student'");
  // quiz finished (500ms, popup NOT suppressed)
  fire('ach-engine-quiz-finished', 'quiz:finished', { studentId: 'q1' });
  fire('ach-engine-quiz-finished', 'quiz:other', { studentId: 'qx' });
  fire('ach-engine-quiz-finished', 'quiz:finished', {});
  const t0 = Date.now();
  await sleep(200);
  out.subs.at200 = snap(win); // no delayed check has fired yet
  await sleep(700);           // t ~ 900ms: everything has fired
  out.subs.at900 = snap(win);
  out.subs.emitCount = win.eval('__emitTimes').length;
  // Timing scratch, compared separately in main() with lower bounds only
  // (load-independent). t0 is taken just AFTER the firing loop (sub-ms), and
  // Node may fire a timer ~1ms early, so bounds get 20ms of slack.
  out._emitElapsed = win.eval('__emitTimes').map(t => t - t0);

  return out;
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'achievements', 'ach_engine.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'ach_engine.bridge.js'), 'utf8');

  const A = makeWindow(originalSrc);
  const B = makeWindow(bridgeSrc);

  // load-time console output must match
  assert.deepStrictEqual(clean(B.logs), clean(A.logs), 'load-time console output must match');
  assert.strictEqual(A.logs.length, 1, 'sanity: exactly one load-time log line');
  assert.ok(A.logs[0].includes('achievements/engine.js loaded'), 'sanity: it is the engine.js banner');

  const [oa, ob] = await Promise.all([runAll(A.win), runAll(B.win)]);

  // strip timing scratch (compared separately) then compare everything
  const ea = oa._emitElapsed, eb = ob._emitElapsed; delete oa._emitElapsed; delete ob._emitElapsed;
  assert.deepStrictEqual(clean(ob), clean(oa), 'bridge results must exactly match the original at every step');

  // ── sanity assertions on the ORIGINAL's results (so equal-but-wrong can't pass) ──
  const o = clean(oa);
  assert.strictEqual(o.constants.rs.length, 6);
  assert.strictEqual(o.constants.t.length, 21);
  assert.strictEqual(o.constants.r.Mythic.color, '#f472b6');
  assert.deepStrictEqual(o.rarityClass, ['ach-rarity-rare', 'ach-rarity-common', 'ach-rarity-common', 'ach-rarity-common', 'ach-rarity-mythic']);

  assert.deepStrictEqual(o.statsNull, [{}, {}]);
  assert.strictEqual(o.statsBareStudent.level, 0);
  assert.strictEqual(o.statsBareStudent.live_rank, 0);
  assert.strictEqual(o.statsBareStudent.quest_streak, 0);
  const s1 = o.statsS1;
  assert.strictEqual(s1.level, 5); assert.strictEqual(s1.xp, 500); assert.strictEqual(s1.coins, 120);
  assert.strictEqual(s1.attendance, 88); assert.strictEqual(s1.quizAvg, 91);
  assert.strictEqual(s1.quests_completed, 2); assert.strictEqual(s1.total_quests, 4);
  assert.strictEqual(s1.boss_victories, 2, 'idx0 ended + idx1 loot count; idx2 active and idx3 zero-damage do not');
  assert.strictEqual(s1.boss_damage, 350); assert.strictEqual(s1.boss_crits, 6); assert.strictEqual(s1.minions_killed, 10);
  assert.strictEqual(s1.store_purchases, 2); assert.strictEqual(s1.coins_spent, 50);
  assert.strictEqual(s1.attendance_present, 3, 'Early + On Time + Late; Absent/Excused/other students excluded');
  assert.strictEqual(s1.best_quiz_score, 100);
  assert.strictEqual(s1.recitation_count, 3);
  assert.strictEqual(s1.live_rank, 2); assert.strictEqual(s1.student_count, 3);
  assert.strictEqual(s1.perfect_streak, 3, 'oldest-first: H100, G(no score) resets, F100,E100,D100 = 3, C80 resets');
  assert.strictEqual(s1.quest_chains_completed, 1); assert.strictEqual(s1.quest_streak, 6);
  assert.strictEqual(o.statsS2.live_rank, 1); assert.strictEqual(o.statsS3.live_rank, 3);
  assert.strictEqual(o.statsUnknown.live_rank, 0);
  assert.strictEqual(o.statsNoQuestHelpers.quest_chains_completed, 0);
  assert.strictEqual(o.statsNoQuestHelpers.quest_streak, 0);

  for (const t of types21(o)) {
    if (['manual', 'all_quests', 'top_rank'].includes(t)) continue;
    assert.deepStrictEqual(o.triggers[t], [true, false, true, true], `trigger ${t}: at-boundary true, one-above false, string ok, zero true`);
  }
  assert.strictEqual(o.triggers.manual, false);
  assert.deepStrictEqual(o.triggers.allQuests, [false, false, true]);
  assert.deepStrictEqual(o.triggers.topRank, [false, true, true, false]);
  assert.strictEqual(o.triggers.unknownType, false); assert.strictEqual(o.triggers.inactive, false);
  assert.strictEqual(o.triggers.noType, false); assert.deepStrictEqual(o.triggers.noAch, [false, false]);
  assert.strictEqual(o.triggers.nanValue, true, "'abc' parses to NaN -> v=0, and 10 >= 0");

  // check-and-award
  const early = o.check.early;
  assert.deepStrictEqual(early.calls.map(c => c.k), ['emit', 'emit'], 'early exits still emit check-and-award-ran');
  assert.strictEqual(early.userStale, true, 'early exits must not reassign currentUser');
  const unlocked = o.check.unlocked;
  const ids = unlocked.state.achievementUnlocks.s1.map(u => u.achId);
  assert.deepStrictEqual(ids, ['a5', 'a1', 'a2', 'a7', 'a9'], 'a5 pre-existing; then a1,a2,a7,a9 (a3 inactive, a4 unmet, a6 other class, a8 manual excluded)');
  const rec = unlocked.state.achievementUnlocks.s1.find(u => u.achId === 'a1');
  assert.deepStrictEqual([rec.xpGranted, rec.coinsGranted, rec.claimed, rec.claimedAt], [50, 10, false, null], "string xpReward '50' parsed; unclaimed");
  assert.deepStrictEqual(unlocked.calls.filter(c => c.k === 'syncUnlock').map(c => c.a), ['a1', 'a2', 'a7', 'a9'].map(id => ['s1', id, 0, 0, false, 'c1']));
  assert.strictEqual(unlocked.currentUserId, 's1');
  assert.strictEqual(unlocked.userStale, false, 'real unlock path reassigns currentUser to the fresh state student (bare-global assignment works)');
  assert.strictEqual(unlocked.badge.text, '4', 'badge shows the 4 new unclaimed unlocks (a5 is claimed)');
  assert.strictEqual(unlocked.popup, null, 'suppressPopup=true: no popup');
  assert.deepStrictEqual(unlocked.calls.map(c => c.k), ['updateState', 'syncUnlock', 'syncUnlock', 'syncUnlock', 'syncUnlock', 'emit']);
  assert.deepStrictEqual(o.check.nothingNew.calls.map(c => c.k), ['emit'], 'nothing new: only the emit');
  assert.strictEqual(o.check.nothingNew.userStale, true, 'nothing new: currentUser untouched');
  assert.strictEqual(o.check.classFallback.userStale, false, 'class-fallback unlock path reassigns currentUser');
  assert.deepStrictEqual(o.check.classFallback.state.achievementUnlocks.s9.map(u => u.achId), ['f1'], "no classId -> 'default-class': f1 allowed, f2 (scoped to c1) not");
  assert.ok(o.check.classFallback.calls.find(c => c.k === 'syncUnlock').a[5] === 'default-class');
  assert.ok(o.check.stagger150.popup && o.check.stagger150.popup.html.includes('First'), 'first popup shows immediately');
  assert.ok(o.check.stagger150.popup.html.includes('Tap to claim rewards'), 'xpReward>0 -> claim text');
  assert.ok(o.check.stagger1650.popup && o.check.stagger1650.popup.html.includes('Second') && o.check.stagger1650.popup.count === 1, 'second popup replaced the first at ~1400ms');
  assert.ok(o.check.stagger1650.popup.html.includes('View in Achievements'));

  // claim
  assert.deepStrictEqual(o.claim.r1, { xp: 25, coins: 7 });
  const a1 = o.claim.after1;
  assert.deepStrictEqual([a1.state.students[0].xp, a1.state.students[0].coins], [35, 12]);
  assert.strictEqual(a1.state.achievementUnlocks.s1[0].claimed, true);
  assert.strictEqual(a1.state.achievementUnlocks.s1[0].claimedAt, '<ISO>');
  assert.deepStrictEqual(a1.state.pointLog[0], { id: 'pl_UID', studentId: 's1', what: '🏅 Achievement Claimed: Claimable', pts: 7, when: 'Just now', createdAt: '<ISO>' }, 'pts = coins when coins > 0');
  assert.deepStrictEqual(a1.calls.map(c => c.k), ['updateState', 'syncStudentStats', 'syncClaim', 'updateTopbar']);
  assert.strictEqual(a1.userStale, false, 'successful claim reassigns currentUser to the updated student');
  assert.strictEqual(o.claim.failedClaimsLeftUserStale, true, 'failed/duplicate claims leave currentUser alone');
  assert.deepStrictEqual(a1.calls.find(c => c.k === 'syncStudentStats').a, ['s1', 25, 7]);
  assert.deepStrictEqual(o.claim.r2, { xp: 40, coins: 0 });
  assert.deepStrictEqual(o.claim.r3, { xp: 0, coins: 0 });
  assert.strictEqual(o.claim.r4, false); assert.strictEqual(o.claim.r5, false); assert.strictEqual(o.claim.r6, false); assert.strictEqual(o.claim.r7, false);
  const pl = o.claim.afterAll.state.pointLog;
  assert.strictEqual(pl.length, 2, 'k1 and k2 logged; k3 (0/0) not');
  assert.strictEqual(pl[0].what, '🏅 Achievement Claimed: Achievement', 'missing ach -> name fallback');
  assert.strictEqual(pl[0].pts, 40, 'pts = xp when coins are 0');
  assert.strictEqual(o.claim.vanished, false);
  assert.ok(!o.claim.vanishedSnap.calls.some(c => c.k.startsWith('sync')), 'vanished student: no server sync');
  assert.strictEqual(o.claim.noPointLog.state.pointLog, undefined, 'zero-grant claim must not create a pointLog');

  // badge
  assert.strictEqual(o.badge.notStudent, null); assert.strictEqual(o.badge.noUser, null);
  assert.strictEqual(o.badge.three.text, '3'); assert.strictEqual(o.badge.threeAgainNoDup.count, 1);
  assert.strictEqual(o.badge.n99.text, '99'); assert.strictEqual(o.badge.n100.text, '99+', 'cap boundary: 99 shown as-is, 100 -> 99+');
  assert.strictEqual(o.badge.capped.text, '99+'); assert.strictEqual(o.badge.removed, null); assert.strictEqual(o.badge.zeroAgain, null);

  // popup
  const pp = o.popup;
  // _esc() entity-escapes the name; outerHTML then re-serializes the text node
  // (it escapes & < > but NOT double quotes inside text), so the expected
  // markup is: &lt;b&gt;Bold&lt;/b&gt; &amp; "q". Also prove no live <b> element got injected.
  assert.ok(pp.legendaryRewards.html.includes('&lt;b&gt;Bold&lt;/b&gt; &amp; "q"'), 'name escaped via _esc');
  assert.ok(!pp.legendaryRewards.html.includes('<b>Bold'), 'name must not be injected as live markup');
  assert.ok(pp.legendaryRewards.html.includes('#fbbf24') && pp.legendaryRewards.html.includes('Tap to claim rewards'));
  assert.strictEqual(pp.unknownRarityReplaces.count, 1);
  assert.ok(pp.unknownRarityReplaces.html.includes('🏅') && pp.unknownRarityReplaces.html.includes('#9ca3af') && pp.unknownRarityReplaces.html.includes('View in Achievements'));
  assert.ok(pp.coinOnly.html.includes('Tap to claim rewards'));
  assert.ok(pp.clickedImmediately && pp.clickedImmediately.anim === 'achPopOut .4s ease forwards', 'click starts the pop-out animation');
  assert.strictEqual(pp.clickedAfter500, null);
  assert.deepStrictEqual(pp.clickedCalls, [{ k: 'navTo', x: 's-badges' }]);
  assert.ok(pp.auto4000 && pp.auto4000.anim === '', 'still shown, not yet animating at 4.0s');
  assert.ok(pp.auto4700 && pp.auto4700.anim === 'achPopOut .4s ease forwards', 'animating out at 4.7s');
  assert.strictEqual(pp.auto5100, null, 'removed by 5.1s');
  assert.deepStrictEqual(pp.finalCalls, [{ k: 'navTo', x: 's-badges' }], 'stale timers on removed popups did nothing (no extra navTo)');

  // subscribers
  assert.deepStrictEqual(o.subs.registered, ['ach-engine-boss-damage', 'ach-engine-session-booted', 'ach-engine-state-sync', 'ach-engine-quiz-finished'], 'registration order');
  assert.strictEqual(o.subs.ignoredBadge, null, 'ignored state-sync events leave the sidebar alone');
  assert.strictEqual(o.subs.noStudentIdBadge && o.subs.noStudentIdBadge.text, '1', 'watched event without studentId still refreshes the badge');
  assert.deepStrictEqual(o.subs.at200.calls.filter(c => c.k === 'emit'), [], 'nothing delayed has fired at 200ms');
  const emits = o.subs.at900.calls.filter(c => c.k === 'emit').map(c => c.ev.payload);
  // 400ms group, in firing order: state-sync (6 watched + w9), boss-damage (b1,b2), session-booted (s1). Then 500ms: quiz (q1).
  // Order of firing above: state-sync w0..w5, w9, then boss b1,b2, then session s1, then quiz q1.
  assert.deepStrictEqual(emits.map(p => p.studentId), ['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w9', 'b1', 'b2', 's1', 'q1'], 'exact set + order: 400ms group before the 500ms quiz emit');
  assert.deepStrictEqual(emits.map(p => p.suppressPopup), [true, true, true, true, true, true, true, undefined, undefined, undefined, undefined], 'state-sync passes suppressPopup=true; boss/session/quiz leave it default (key absent after JSON)');
  for (const [label, e] of [['original', ea], ['bridge', eb]]) {
    assert.strictEqual(e.length, 11, label + ': 11 delayed emits');
    assert.ok(e.slice(0, 10).every(t => t >= 380), label + ': the ten 400ms-group emits happened >= ~400ms after firing (got ' + e.slice(0, 10).join(',') + ')');
    assert.ok(e[10] >= 480, label + ': the 500ms quiz emit happened >= ~500ms after firing (got ' + e[10] + ')');
  }

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('Original ach_engine.js and the bundled src/modules/achievements/ach_engine.js bridge agree on:');
  console.log(' - all 11 exports present on window with the right kinds; load-time banner identical');
  console.log(' - achRarityClass, achBuildStats (rich state, empty state, guard branches, unknown student)');
  console.log(' - achEvaluateTrigger: all 21 types at/below boundary + unknown/inactive/NaN/all_quests/top_rank edges');
  console.log(' - achCheckAndAward: early exits, section scoping, already-unlocked, class fallback, nothing-new, 1400ms popup stagger');
  console.log(' - achGrantRewardsForClaim: success, xp-only, zero-grant, already-claimed, missing, vanished-student');
  console.log(' - achUpdateSidebarBadge: every branch incl. 99+ cap and removal; achShowUnlockPopup: variants, click, 4.5s auto-dismiss, stale timers');
  console.log(' - 4 load-time subscribers: registration order, filtering, 400/500ms delays, suppressPopup args');
}

function types21(o) { return o.constants.t.map(t => t.value); }

main().catch(e => { console.error(e); process.exit(1); });
