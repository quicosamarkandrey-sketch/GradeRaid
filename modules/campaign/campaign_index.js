// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/campaign/index.js
//  CSS injection + AppStore migration + load-order guard for the campaign module.
//
//  Required load order:
//    1. engine.js           — camp state, launchCampaignStage, combat loop, victory/defeat
//    2. stage-map.js        — openStageMap, closeStageMap, renderStageMap, switchWorld
//    3. admin-map-editor.js — renderAdminStageMap, world/stage CRUD
//    4. index.js            — this file
// ═══════════════════════════════════════════════════════════════════════════════

// ── CSS Injection ─────────────────────────────────────────────────────────────
;(function injectCampaignCSS() {
  if (document.getElementById('campaign-module-css')) return;
  const style = document.createElement('style');
  style.id = 'campaign-module-css';
  style.textContent = `
/* ── Stage map overlay ── */
#stage-map-overlay{position:fixed;inset:0;z-index:800;background:rgba(0,0,0,.85);backdrop-filter:blur(12px);display:flex;align-items:stretch;opacity:0;pointer-events:none;transition:opacity .3s}
#stage-map-overlay.open{opacity:1;pointer-events:all}
.smap-inner{display:flex;flex-direction:column;width:100%;max-width:700px;margin:auto;background:var(--surface);border-radius:20px;overflow:hidden;max-height:90vh}
.smap-header{display:flex;align-items:center;gap:14px;padding:20px 24px;background:rgba(0,0,0,.3);border-bottom:1px solid var(--border);flex-shrink:0}
.smap-av{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-family:var(--fh);font-weight:900;font-size:16px;border:2px solid}
.smap-info{flex:1;min-width:0}
.smap-name-row{font-family:var(--fh);font-size:16px;font-weight:900;color:var(--on-surface)}
.smap-tier-row{font-family:var(--fm);font-size:9px;color:var(--text-muted);letter-spacing:.12em;margin-top:2px}
.smap-progress-row{display:flex;align-items:center;gap:10px;margin-top:6px}
.smap-prog-bar-wrap{flex:1;height:4px;background:rgba(255,255,255,.08);border-radius:4px;overflow:hidden}
.smap-prog-bar{height:100%;background:linear-gradient(90deg,#8b5cf6,#4edea3);border-radius:4px;transition:width .6s ease}
.smap-stages-done{font-family:var(--fm);font-size:9px;color:var(--primary);font-weight:700;letter-spacing:.08em}
.world-tabs-wrap{border-bottom:1px solid var(--border);flex-shrink:0;overflow-x:auto}
#world-tabs-sm{display:flex;gap:0;padding:0 20px}
.world-tab{padding:10px 16px;font-size:12px;font-weight:700;color:var(--text-muted);background:none;border:none;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap;transition:all .2s;font-family:var(--fb)}
.world-tab:hover{color:var(--on-surface)}
.world-tab.active{border-bottom-color:var(--primary-dark)}
#smap-body{overflow-y:auto;padding:24px;flex:1}
.smap-close-btn{background:rgba(255,255,255,.08);border:1px solid var(--border2);color:var(--on-surface);border-radius:8px;width:34px;height:34px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px;flex-shrink:0;transition:all .15s}
.smap-close-btn:hover{background:rgba(255,255,255,.14)}

/* ── Stage path layout ── */
.stage-path{display:flex;flex-direction:column;gap:0}
.stage-row{display:flex;margin-bottom:0}
.stage-row.left{justify-content:flex-start}
.stage-row.right{justify-content:flex-end}
.stage-row.center{justify-content:center}
.stage-node{background:rgba(35,31,56,.9);border:2px solid rgba(255,255,255,.1);border-radius:16px;padding:14px 16px;width:260px;cursor:pointer;transition:all .3s;position:relative;backdrop-filter:blur(8px)}
.stage-node:hover:not(.locked){transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.4);border-color:rgba(208,188,255,.3)}
.stage-node.active{border-color:rgba(208,188,255,.5);background:rgba(35,31,56,.98);box-shadow:0 0 24px rgba(139,92,246,.2)}
.stage-node.completed{border-color:rgba(78,222,163,.3);background:rgba(20,30,25,.85)}
.stage-node.locked{opacity:.6;cursor:default}
.stage-node.boss{border-color:rgba(245,158,11,.4);background:rgba(40,20,0,.85)}
.stage-node.boss.active{box-shadow:0 0 32px rgba(245,158,11,.3)}
.stage-num{position:absolute;top:-10px;left:12px;background:rgba(35,31,56,.95);border:1px solid rgba(255,255,255,.15);border-radius:6px;padding:1px 8px;font-family:var(--fm);font-size:9px;font-weight:900;color:var(--text-muted);letter-spacing:.08em}
.node-icon-ring{width:44px;height:44px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0}
.stage-connector{height:28px;display:flex;align-items:center;justify-content:center;position:relative}
.stage-connector::before{content:'';position:absolute;width:3px;height:100%;background:linear-gradient(to bottom,var(--from-color,rgba(255,255,255,.08)),var(--to-color,rgba(255,255,255,.08)));border-radius:2px}
.stage-connector.locked-dots::before{background:repeating-linear-gradient(to bottom,rgba(255,255,255,.1) 0px,rgba(255,255,255,.1) 4px,transparent 4px,transparent 8px)}

/* ── Legacy duplicate campaign-overlay block removed here ──
   This used to redefine #campaign-overlay/#camp-scene/#camp-story-panel/
   #camp-encounter/#camp-result/#camp-options by ID, injected into <head>
   at runtime. Since IDs always beat the real class-based rules in
   campaign.css (.camp-story-panel, .camp-encounter, .camp-result,
   .camp-options, etc.) regardless of load order, this leftover copy was
   the actual live cause of the "narration on top" bug — campaign.css's
   own copy of this same block was already removed (see the matching note
   there), but this JS-injected twin was never cleaned up, so the bug
   never actually went away. Its class-only rules (.camp-hud, .camp-narr-
   box, .camp-q-text, .camp-res-emoji, etc.) never matched anything — the
   real elements use .camp-story-panel/.camp-narration/.camp-question-text/
   .camp-result-emoji etc., defined in campaign.css — so nothing is lost
   by removing it. */

/* ── Admin stage map editor ── */
.smap-admin-card{background:rgba(35,31,56,.85);border:1px solid var(--border);border-radius:16px;overflow:hidden;backdrop-filter:blur(12px)}
.smap-admin-world-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;cursor:pointer;gap:12px;transition:background .15s}
.smap-admin-world-header:hover{background:rgba(255,255,255,.03)}
.smap-stage-row{display:flex;align-items:center;gap:12px;padding:12px 20px;border-top:1px solid rgba(255,255,255,.04);transition:background .15s}
.smap-stage-row:hover{background:rgba(255,255,255,.02)}
.scene-block{background:rgba(35,31,56,.8);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:14px;margin-bottom:8px}
.scene-block-num{font-family:var(--fm);font-size:9px;font-weight:900;color:var(--primary);letter-spacing:.12em}
.boss-tag{background:rgba(245,158,11,.15);color:#ffb95f;border:1px solid rgba(245,158,11,.3);border-radius:5px;padding:1px 7px;font-family:var(--fm);font-size:9px;font-weight:800;letter-spacing:.06em}
.normal-tag{background:rgba(78,222,163,.1);color:#4edea3;border:1px solid rgba(78,222,163,.25);border-radius:5px;padding:1px 7px;font-family:var(--fm);font-size:9px;font-weight:800;letter-spacing:.06em}

/* ── Dashboard stage notif dot ── */
#stage-notif{display:none;width:8px;height:8px;border-radius:50%;background:#8b5cf6;box-shadow:0 0 8px rgba(139,92,246,.6);animation:achBadgePulse 2s ease-in-out infinite}
`;
  document.head.appendChild(style);
})();

// ── AppStore migration guard ──────────────────────────────────────────────────
// [SUPABASE MIGRATION] Deferred until AppStore.ready resolves — see the
// matching note in modules/shop/shop_pos_terminal.js for why this can no
// longer run synchronously at parse time.
AppStore.ready.then(function campaignMigrateDB() {
  const current = AppStore.getSlice(s => ({ stageMap: s.stageMap, stageProgress: s.stageProgress }));
  const missing = ['stageMap', 'stageProgress'].filter(k => !current || !current[k]);
  if (!missing.length) return; // already fully set up — nothing to do

  AppStore.updateState(draft => {
    if (!draft.stageMap)      draft.stageMap      = [];
    if (!draft.stageProgress) draft.stageProgress = {};
  }, { type: 'campaign:libraries-initialized', payload: { keys: missing } });
});

// ── Load-order verification ───────────────────────────────────────────────────
;(function campaignVerifyExports() {
  const EXPECTED = [
    // engine.js
    'isStageCleared', 'markStageCleared', 'getMapProgress', 'getStageProgress',
    'launchCampaignStage', '_campKeyHandler', 'campAnswer',
    'retryCampaign', 'nextStageCampaign', 'exitCampaign', 'confirmExitCampaign',
    // stage-map.js
    'openStageMap', 'closeStageMap', 'renderWorldTabs', 'switchWorld',
    'renderStageMap', 'lockedStageClick',
    // admin-map-editor.js
    'renderAdminStageMap', 'adminToggleWorld', 'adminPreviewMap',
    'adminAddWorld', 'adminEditWorld', 'adminSaveNewWorld', 'adminSaveEditWorld', 'adminDeleteWorld',
    'adminAddStage', 'adminEditStage', '_reloadStageEditor', 'adminSaveStage',
    'adminDeleteStage', 'adminMoveStage',
    'adminAddScene', 'adminRemoveScene', 'adminAddEnemy', 'adminRemoveEnemy',
    'adminAddQuestion', 'adminRemoveQuestion', 'adminSetAnswer',
  ];

  const missing = EXPECTED.filter(name => typeof window[name] !== 'function');
  if (missing.length) {
    console.error('[EduQuest] campaign/index.js — MISSING exports:', missing);
  } else {
    console.log('[EduQuest] campaign/index.js — All exports verified ✅');
  }

  window.__CAMPAIGN_MODULE_VERSION__ = '1.0.0';
})();
