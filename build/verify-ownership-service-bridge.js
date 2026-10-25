// Phase 7, Stream B — equivalence check for modules/admin/ownership-service.js.
// Covers validation errors, the RPC happy/error path, and both branches of
// the post-transfer window.refreshSectionData() call: present (resolves and
// rejects) and absent.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow(refreshMode) {
  const dom = new JSDOM('<!doctype html><html></html>', { runScripts: 'dangerously' });
  const win = dom.window;
  const calls = [];
  win.__dbCalls = calls;
  win.DBService = {
    async rpc(name, params) {
      calls.push({ name, params: JSON.parse(JSON.stringify(params || {})) });
      if (name === 'transfer_teacher_ownership') {
        if (params.p_from_teacher_id === 'FAIL') return { data: null, error: { message: 'boom: transfer failed' } };
        return {
          data: {
            fromTeacherId: params.p_from_teacher_id, toTeacherId: params.p_to_teacher_id,
            sectionsReassigned: 3, sectionsArchived: 1, achievements: 2, titles: 0,
            quizzes: 5, campaignWorlds: 0, shopProducts: 1, bossLibrary: 0,
          },
          error: null,
        };
      }
      throw new Error('unexpected rpc: ' + name);
    },
  };
  if (refreshMode === 'resolves') {
    win.refreshSectionData = async function () { win.__refreshCalled = (win.__refreshCalled || 0) + 1; };
  } else if (refreshMode === 'rejects') {
    win.refreshSectionData = async function () { win.__refreshCalled = (win.__refreshCalled || 0) + 1; throw new Error('refresh boom'); };
  }
  // refreshMode undefined -> window.refreshSectionData left absent, exercising the typeof-guard branch.
  return win;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runOne(win) {
  const results = {};
  results.missingFrom = await win.OwnershipService.transferOwnership({ toTeacherId: 't2' });
  results.missingTo = await win.OwnershipService.transferOwnership({ fromTeacherId: 't1' });
  results.sameTeacher = await win.OwnershipService.transferOwnership({ fromTeacherId: 't1', toTeacherId: 't1' });
  results.rpcFail = await win.OwnershipService.transferOwnership({ fromTeacherId: 'FAIL', toTeacherId: 't2' });
  results.ok = await win.OwnershipService.transferOwnership({ fromTeacherId: 't1', toTeacherId: 't2', archiveSectionIds: ['s1'] });
  results.okNoArchiveList = await win.OwnershipService.transferOwnership({ fromTeacherId: 't3', toTeacherId: 't4' });
  await sleep(20); // let the fire-and-forget refreshSectionData() settle either way
  results.dbCalls = win.__dbCalls;
  results.refreshCalled = win.__refreshCalled || 0;
  return results;
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'ownership-service.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'ownership-service.bridge.js'), 'utf8');

  for (const mode of [undefined, 'resolves', 'rejects']) {
    const winOriginal = makeWindow(mode);
    winOriginal.eval(originalSrc);
    assert.strictEqual(typeof winOriginal.OwnershipService, 'object');
    const resultOriginal = await runOne(winOriginal);

    const winBridge = makeWindow(mode);
    winBridge.eval(bridgeSrc);
    assert.strictEqual(typeof winBridge.OwnershipService, 'object');
    const resultBridge = await runOne(winBridge);

    assert.strictEqual(
      JSON.stringify(resultBridge), JSON.stringify(resultOriginal),
      `bridge output must exactly match original output (refreshSectionData mode: ${mode})`
    );
  }

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('ownership-service.js: transferOwnership matches across validation errors, RPC error, happy');
  console.log('path, and all three window.refreshSectionData() branches (absent/resolves/rejects).');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
