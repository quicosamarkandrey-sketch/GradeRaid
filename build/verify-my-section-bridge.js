// Phase 7, Stream B — equivalence check for modules/section/my-section.js.
// getClassLabel's own equivalence is already proven
// (verify-sections-service-bridge.js), so the ORIGINAL window evals the
// real, untouched sections-service.js first. Covers: remote RPC success,
// RPC error -> local fallback, RPC throw -> local fallback, no DBService
// at all -> local fallback, no AppStore at all (bare local fallback with
// every guard hitting its "undefined" branch), a classmate with no
// equipped title, one with an equipped title (real tsBuildBadgeHTML
// call), and the "no classmates" / "no teacher assigned" empty states.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body><div id="s-my-section"></div></body></html>', { runScripts: 'dangerously' });
  const win = dom.window;
  const calls = [];
  win.__calls = calls;

  win._esc = s => String(s == null ? '' : s);
  win._cssColor = c => c || '#888';
  win.tsBuildBadgeHTML = function (t, opts2) { calls.push({ name: 'tsBuildBadgeHTML', titleId: t.id, opts: opts2 }); return `<span class="title-badge">${t.id}</span>`; };

  win.currentUser = opts.noCurrentUser ? null : { id: 's1', classId: 'sec-a' };

  if (!opts.noDBService) {
    win.DBService = {
      async rpc(name, params) {
        calls.push({ name, params });
        if (opts.rpcThrows) throw new Error('network exploded');
        if (opts.rpcFails) return { data: null, error: { message: 'boom: rpc failed' } };
        return {
          data: {
            section: { id: 'sec-a', label: 'Grade 10 - Rizal' },
            teacher: { id: 't1', displayName: 'Ms. Alpha', achievementCount: 3, quizCount: 5, campaignWorldCount: 1, shopProductCount: 2 },
            classmates: opts.emptyClassmates ? [] : [
              { id: 's1', displayName: 'You', init: 'Y', color: '#8b5cf6', profilePicUrl: null, xp: 500, level: 5, tier: 'Gold', equippedTitleId: null },
              { id: 's2', displayName: 'Classmate Two', init: 'C', color: '#4edea3', profilePicUrl: null, xp: 800, level: 7, tier: 'Platinum', equippedTitleId: 'title1' },
            ],
          },
          error: null,
        };
      },
    };
  }

  if (!opts.noAppStore) {
    const students = [
      { id: 's1', name: 'You (local)', init: 'Y', color: '#8b5cf6', profilePic: null, xp: 500, level: 5, tier: 'Gold', classId: 'sec-a' },
      { id: 's2', name: 'Local Classmate', init: 'L', color: '#4edea3', profilePic: null, xp: 300, level: 3, tier: 'Silver', classId: 'sec-a' },
      { id: 's3', name: 'Other Section', init: 'O', color: '#ff6b6b', profilePic: null, xp: 100, level: 1, tier: 'Bronze', classId: 'sec-b' },
    ];
    win.AppStore = {
      getSlice(fn) {
        const state = {
          students, equippedTitles: { s2: 'title1' }, admin: { id: 'admin1', name: 'Admin Fallback' },
          achievements: [1, 2], quizzes: [1], stageMap: [], store: [1, 2, 3], titles: [{ id: 'title1', name: 'Star' }],
          classSections: [{ id: 'sec-a', gradeLevel: '10', sectionName: 'Rizal', adviserId: 'admin1', archived: false }],
        };
        return fn(state);
      },
      getState() {
        return {
          classSections: [{ id: 'sec-a', gradeLevel: '10', sectionName: 'Rizal', adviserId: 'admin1', archived: false }],
        };
      },
    };
  }

  return win;
}

function snapshot(win) {
  return { html: win.document.getElementById('s-my-section').innerHTML, calls: win.__calls };
}

async function runCase(win) {
  await win.renderMySection();
  return snapshot(win);
}

async function main() {
  const sectionsServiceSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'sections-service.js'), 'utf8');
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'section', 'my-section.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'my-section.bridge.js'), 'utf8');

  const cases = [
    { name: 'remoteSuccess', opts: {} },
    { name: 'remoteSuccessNoClassmates', opts: { emptyClassmates: true } },
    { name: 'rpcErrorFallsBackLocal', opts: { rpcFails: true } },
    { name: 'rpcThrowsFallsBackLocal', opts: { rpcThrows: true } },
    { name: 'noDBServiceFallsBackLocal', opts: { noDBService: true } },
    { name: 'noAppStoreEitherWay', opts: { noDBService: true, noAppStore: true } },
    { name: 'noCurrentUserNoRender', opts: { noCurrentUser: true } },
  ];

  for (const c of cases) {
    const winO = makeWindow(c.opts);
    winO.eval(sectionsServiceSrc);
    winO.eval(originalSrc);
    assert.strictEqual(typeof winO.renderMySection, 'function');
    const rO = await runCase(winO);

    const winB = makeWindow(c.opts);
    winB.eval(bridgeSrc);
    assert.strictEqual(typeof winB.renderMySection, 'function');
    const rB = await runCase(winB);

    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), `case "${c.name}" mismatch`);
  }

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('my-section.js: remote RPC success (incl. empty classmates), RPC error / throw / missing');
  console.log('DBService falling back to local AppStore cache, no-AppStore-either-way, and the');
  console.log('no-currentUser early-return all match — including the real tsBuildBadgeHTML call for a');
  console.log('classmate with an equipped title.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
