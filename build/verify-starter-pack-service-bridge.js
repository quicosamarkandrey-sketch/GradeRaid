// Phase 7, Stream B — equivalence check for modules/admin/starter-pack-service.js.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html></html>', { runScripts: 'dangerously' });
  const win = dom.window;
  const calls = [];
  win.__dbCalls = calls;
  win.DBService = {
    async rpc(name, params) {
      calls.push({ name, params: JSON.parse(JSON.stringify(params || {})) });
      if (name === 'get_starter_pack') {
        if (win.__packFail) return { data: null, error: { message: 'boom: fetch failed' } };
        if (win.__packEmpty) return { data: null, error: null };
        return { data: { achievements: [{ id: 'a1' }] }, error: null };
      }
      if (String(name).startsWith('upsert_starter_')) {
        if (params.p_name === 'FAIL' || params.p_title === 'FAIL' || params.p_label === 'FAIL') {
          return { data: null, error: { message: 'boom: save failed for ' + name } };
        }
        return { data: { ...params, saved: true }, error: null };
      }
      if (String(name).startsWith('delete_')) {
        const idKey = Object.keys(params)[0];
        if (params[idKey] === 'FAIL') return { data: null, error: { message: 'boom: delete failed for ' + name } };
        return { data: null, error: null };
      }
      throw new Error('unexpected rpc: ' + name);
    },
  };
  return win;
}

async function runSequence(win) {
  const results = {};

  results.fetchOk = await win.StarterPackService.fetch();
  win.__packEmpty = true;
  results.fetchEmptyFallback = await win.StarterPackService.fetch();
  win.__packEmpty = false;
  win.__packFail = true;
  results.fetchFail = await win.StarterPackService.fetch();
  win.__packFail = false;

  results.saveAchievementFull = await win.StarterPackService.saveAchievement({
    id: 'a1', name: 'Ach', description: 'd', icon: '🏆', category: 'Cat', rarity: 'Rare',
    xpReward: 10, coinReward: 5, triggerType: 'auto', triggerValue: 3, active: false,
  });
  results.saveAchievementDefaults = await win.StarterPackService.saveAchievement({ id: 'a2', name: 'Ach2' });
  results.saveAchievementFail = await win.StarterPackService.saveAchievement({ id: 'a3', name: 'FAIL' });

  results.saveTitleFull = await win.StarterPackService.saveTitle({
    id: 't1', name: 'Title', description: 'd', icon: '🎖️', rarity: 'Epic', active: false,
    textColor: '#fff', borderColor: '#000', glowColor: '#f00', bgColor: '#00f',
  });
  results.saveTitleDefaults = await win.StarterPackService.saveTitle({ id: 't2', name: 'T2' });

  results.saveQuizFull = await win.StarterPackService.saveQuiz({
    id: 'q1', title: 'Quiz', description: 'd', xpReward: 1, coinReward: 2, timeLimit: 60, questions: [{ q: 1 }],
    active: false, rarity: 'Common', cadence: 'daily', chainId: 'c1', chainOrder: 2, chainLabel: 'L',
    startDate: 's', endDate: 'e',
  });
  results.saveQuizDefaults = await win.StarterPackService.saveQuiz({ id: 'q2', title: 'Q2' });

  results.saveCampaignWorldFull = await win.StarterPackService.saveCampaignWorld({
    id: 'w1', label: 'World', icon: '🗺️', color: '#123', description: 'd', stages: [1, 2], active: false,
  });
  results.saveCampaignWorldDefaults = await win.StarterPackService.saveCampaignWorld({ id: 'w2', label: 'FAIL' });

  results.saveShopItemFull = await win.StarterPackService.saveShopItem({
    id: 'p1', name: 'Item', emoji: '🎁', description: 'd', category: 'Cat', cost: 100, active: false,
  });
  results.saveShopItemDefaults = await win.StarterPackService.saveShopItem({ id: 'p2', name: 'P2' });

  results.deleteAchievementOk = await win.StarterPackService.deleteAchievement('a1');
  results.deleteAchievementFail = await win.StarterPackService.deleteAchievement('FAIL');
  results.deleteTitleOk = await win.StarterPackService.deleteTitle('t1');
  results.deleteQuizOk = await win.StarterPackService.deleteQuiz('q1');
  results.deleteCampaignWorldOk = await win.StarterPackService.deleteCampaignWorld('w1');
  results.deleteShopItemOk = await win.StarterPackService.deleteShopItem('p1');
  results.deleteShopItemFail = await win.StarterPackService.deleteShopItem('FAIL');

  results.dbCalls = win.__dbCalls;
  return results;
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'starter-pack-service.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'starter-pack-service.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.StarterPackService, 'object');
  const resultOriginal = await runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.StarterPackService, 'object');
  const resultBridge = await runSequence(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original output');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('starter-pack-service.js: fetch (incl. null-data fallback + RPC error), all 5 save*() with');
  console.log('full args and default-fallback args, and all 5 delete*() (incl. errors) match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
