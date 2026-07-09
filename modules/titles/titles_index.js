// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/titles/index.js
//  Full titles CSS injection + DB migration + load-order guard.
//
//  Required load order:
//    1. badge-renderer.js  — tsBuildBadgeHTML, registries, tsDefaultTitle
//    2. sidebar-refresh.js — tsEquipTitle, tsUnlockTitleForStudent, refresh fns, patches
//    3. student-page.js    — renderTitlesPage, tsTabSwitch, tsStudentEquip/Unequip
//    4. admin-page.js      — renderAdminTitles, tsAdmin* CRUD, grant/revoke
//    5. designer.js        — tsAdminOpenDesigner, ts3* handlers, tsAdminSave
//    6. index.js           — this file
// ═══════════════════════════════════════════════════════════════════════════════

// ── CSS Injection ─────────────────────────────────────────────────────────────
;(function injectTitlesCSS() {
  if (document.getElementById('titles-module-css')) return;
  const style = document.createElement('style');
  style.id = 'titles-module-css';
  style.textContent = `
/* ── Badge plate base ── */
.ts-badge-wrap{display:inline-flex;align-items:center;justify-content:center;position:relative;overflow:hidden;border:1.5px solid;border-radius:12px;padding:4px 12px 4px 10px;min-width:90px;max-width:220px;height:34px;font-family:var(--fb);font-size:12px;font-weight:700;letter-spacing:.04em;transition:all .25s;box-sizing:border-box;text-decoration:none;white-space:nowrap;flex-shrink:0;vertical-align:middle;background:var(--ts-bg,#1a1438)}
.ts-badge-wrap:hover{filter:brightness(1.08)}
.ts-badge-text{position:relative;z-index:3;pointer-events:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px;color:var(--ts-text,#fff)}
.ts-frame-svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;display:block}
.ts-rarity-overlay-host{position:absolute;inset:0;z-index:2;pointer-events:none;overflow:hidden;border-radius:inherit}
.ts-legendary-glint{position:absolute;inset:0;width:100%;height:100%;animation:tsGlintSweep 3s ease-in-out infinite;opacity:.7}
.ts-mythic-burst{position:absolute;inset:0;width:100%;height:100%;animation:tsMythicPulse 2s ease-in-out infinite}
@keyframes tsGlintSweep{0%{transform:translateX(-120%)}40%{transform:translateX(-120%)}60%{transform:translateX(120%)}100%{transform:translateX(120%)}}
@keyframes tsMythicPulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:.7;transform:scale(1.2)}}

/* ── Size modifiers ── */
.ts-size-sm{height:26px;padding:2px 8px 2px 7px;font-size:10px;border-radius:9px;min-width:64px;max-width:160px}
.ts-size-xs{height:20px;padding:1px 6px;font-size:9px;border-radius:7px;min-width:44px;max-width:120px;font-weight:800}

/* ── Frame shapes ── */
.ts-frame-classic{border-radius:12px}
.ts-frame-rectangle{border-radius:4px}
.ts-frame-capsule{border-radius:50px}
.ts-frame-ribbon,.ts-frame-banner{border-radius:6px}
.ts-frame-shield,.ts-frame-dragon{border-radius:14px 14px 18px 18px}
.ts-frame-hexagon{border-radius:8px}
.ts-frame-diamond{border-radius:4px;transform:perspective(200px) rotateX(4deg)}
.ts-frame-crystal{border-radius:8px 8px 14px 14px}
.ts-frame-ghost{border-radius:40px 40px 0 0;overflow:visible}
.ts-frame-arcane{border-radius:6px;clip-path:polygon(8% 0%,92% 0%,100% 50%,92% 100%,8% 100%,0% 50%)}
.ts-frame-celestial{border-radius:14px}
.ts-frame-flame{border-radius:8px;border-top-left-radius:6px;border-top-right-radius:6px}
.ts-frame-poison{border-radius:12px 12px 8px 8px}
.ts-frame-scale{border-radius:14px}
.ts-frame-royal{border-radius:20px}
.ts-frame-shadow{border-radius:8px}

/* ── Frame styles ── */
.ts-style-metal{border-style:solid;box-shadow:inset 0 1px 0 rgba(255,255,255,.18),inset 0 -1px 0 rgba(0,0,0,.4)}
.ts-style-crystal{backdrop-filter:blur(8px)}
.ts-style-fire{animation:tsFireFlicker 2.5s ease-in-out infinite}
.ts-style-royal::after{content:'';position:absolute;top:-1px;left:-1px;right:-1px;bottom:-1px;border-radius:inherit;border:2px solid rgba(255,215,0,.3);pointer-events:none;z-index:4}

/* ── Animations ── */
.ts-anim-pulse{animation:tsPulse 2.2s ease-in-out infinite}
.ts-anim-glow-pulse{animation:tsGlowPulse 2.4s ease-in-out infinite}
.ts-anim-float{animation:tsFloat 3.5s ease-in-out infinite}
.ts-anim-wave{animation:tsWave 3s ease-in-out infinite}
.ts-anim-fire-flicker{animation:tsFireFlicker 1.8s ease-in-out infinite}
.ts-anim-ghost-drift{animation:tsGhostDrift 4s ease-in-out infinite}
.ts-anim-shake{animation:tsShake .8s ease-in-out infinite}
.ts-anim-flicker{animation:tsFlicker 1.4s ease-in-out infinite}
.ts-anim-burn{animation:tsBurn 2s ease-in-out infinite}
.ts-anim-orbit{animation:tsOrbit 6s linear infinite}
.ts-anim-spectral-drift{animation:tsGhostDrift 5s ease-in-out infinite}
.ts-anim-rune-rotation{animation:tsOrbit 8s linear infinite}
@keyframes tsPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
@keyframes tsGlowPulse{0%,100%{box-shadow:var(--ts-glow-shadow)}50%{box-shadow:var(--ts-glow-shadow-max)}}
@keyframes tsFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes tsWave{0%,100%{transform:skewX(0deg)}25%{transform:skewX(-2deg)}75%{transform:skewX(2deg)}}
@keyframes tsFireFlicker{0%,100%{opacity:1;transform:scaleY(1)}50%{opacity:.92;transform:scaleY(.97)}}
@keyframes tsGhostDrift{0%,100%{transform:translateY(0) translateX(0);opacity:.9}33%{transform:translateY(-3px) translateX(1px);opacity:.7}66%{transform:translateY(1px) translateX(-1px);opacity:.85}}
@keyframes tsShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-2px)}40%{transform:translateX(2px)}60%{transform:translateX(-1px)}80%{transform:translateX(1px)}}
@keyframes tsFlicker{0%,100%{opacity:1}50%{opacity:.7}}
@keyframes tsBurn{0%,100%{filter:brightness(1) saturate(1)}50%{filter:brightness(1.12) saturate(1.3)}}
@keyframes tsOrbit{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}

/* ── Effect layers ── */
.ts-fx-layer{position:absolute;inset:0;pointer-events:none;z-index:2;overflow:hidden}
.ts-fx-ember{position:absolute;border-radius:50%;bottom:0;animation:tsFxEmber var(--edur,1.2s) var(--edly,0s) ease-out infinite;box-shadow:0 0 4px currentColor}
@keyframes tsFxEmber{0%{opacity:0;bottom:0;transform:translateX(0)}50%{opacity:.9}100%{opacity:0;bottom:100%;transform:translateX(var(--edx,0))}}
.ts-fx-runes{font-family:monospace;font-size:8px;color:rgba(255,255,255,.35);letter-spacing:.1em;display:flex;align-items:center;padding:0 4px;animation:tsFlicker 2.5s ease-in-out infinite}
.ts-fx-bolt{position:absolute;font-size:9px;color:#fbbf24;animation:tsFxBolt var(--bdur,1s) var(--bdly,0s) ease-in-out infinite}
@keyframes tsFxBolt{0%,100%{opacity:0}50%{opacity:.8}}
.ts-fx-star{position:absolute;color:#fde68a;animation:tsFxStar var(--sdur,4s) var(--sdly,0s) ease-in-out infinite;font-size:var(--ssz,10px)}
@keyframes tsFxStar{0%,100%{opacity:.3;transform:scale(.7)}50%{opacity:1;transform:scale(1.1)}}
.ts-fx-drip{position:absolute;width:3px;border-radius:0 0 3px 3px;background:var(--ts-glow,#8b5cf6);top:0;animation:tsFxDrip var(--ddur,2s) var(--ddly,0s) ease-in infinite}
@keyframes tsFxDrip{0%{height:0;opacity:.9}80%{height:100%;opacity:.5}100%{height:100%;opacity:0}}

/* ── Particles ── */
.ts-particle-host{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2}
.ts-particle{position:absolute;border-radius:50%;animation:tsParticle var(--ts-part-dur,1.2s) var(--ts-part-delay,0s) ease-out infinite;box-shadow:0 0 4px rgba(255,255,255,.5)}
@keyframes tsParticle{0%{opacity:0;bottom:0;transform:translateX(0)}50%{opacity:.8}100%{opacity:0;bottom:100%;transform:translateX(var(--ts-part-dx,0))}}

/* ── Rarity tag sub-components ── */
.ts-rarity-strip{position:absolute;top:0;left:0;right:0;height:2px;border-radius:inherit;z-index:4;pointer-events:none}

/* ── Sidebar equipped ── */
.ts-sidebar-equipped{display:flex;align-items:center;padding:6px 12px;margin-top:4px}

/* ── Unlock popup ── */
.ts-unlock-popup{position:fixed;bottom:24px;left:24px;z-index:9998;display:flex;align-items:center;gap:14px;background:rgba(26,24,44,0.97);border:1.5px solid rgba(255,185,95,.4);border-radius:16px;padding:16px 20px;box-shadow:0 8px 40px rgba(255,185,95,.25);max-width:320px;animation:achPopIn .4s ease;backdrop-filter:blur(16px)}

/* ── Student title grid ── */
.ts-title-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
.ts-title-card{background:rgba(35,31,56,.85);border:1px solid var(--border);border-radius:16px;padding:18px;transition:all .3s;display:flex;flex-direction:column;gap:8px;backdrop-filter:blur(12px)}
.ts-title-card:hover{transform:translateY(-2px);border-color:rgba(208,188,255,.25)}
.ts-title-card.ts-equipped{border-color:rgba(78,222,163,.4);background:rgba(35,31,56,.95)}
.ts-title-card-header{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.ts-title-card-actions{display:flex;gap:8px;margin-top:4px}
.ts-equip-btn{flex:1;padding:8px;border:none;border-radius:9px;background:linear-gradient(135deg,var(--primary-dark),#7c3aed);color:#fff;font-size:11px;font-weight:800;cursor:pointer;font-family:var(--fb);transition:all .2s}
.ts-equip-btn:hover{transform:scale(1.04);box-shadow:0 4px 16px rgba(139,92,246,.4)}
.ts-equip-btn.ts-unequip{background:rgba(78,222,163,.12);border:1px solid rgba(78,222,163,.3);color:var(--secondary)}

/* ── Admin cards ── */
.ts-admin-cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
.ts-admin-card{background:rgba(35,31,56,.85);border:1px solid var(--border);border-radius:16px;overflow:hidden;transition:all .3s;display:flex;flex-direction:column}
.ts-admin-card:hover{border-color:rgba(208,188,255,.2)}
.ts-admin-card-inactive{opacity:.6}
.ts-admin-card-preview{position:relative;padding:20px;background:rgba(0,0,0,.2);display:flex;justify-content:center;align-items:center;min-height:64px;border-bottom:1px solid var(--border)}
.ts-admin-card-body{padding:14px;flex:1;display:flex;flex-direction:column;gap:6px}
.ts-admin-card-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:auto}

/* ── Designer modal layout ── */
.ts3-modal{max-width:820px;width:100%}
.ts3-layout{display:grid;grid-template-columns:1fr 300px;gap:20px;margin-bottom:0}
@media(max-width:700px){.ts3-layout{grid-template-columns:1fr}}
.ts3-tabs{display:flex;gap:4px;margin-bottom:14px;flex-wrap:wrap}
.ts3-tab{padding:7px 14px;border-radius:8px;font-size:12px;font-weight:700;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:var(--text-muted);cursor:pointer;transition:all .15s;font-family:var(--fb)}
.ts3-tab:hover{color:var(--on-surface)}
.ts3-tab.active{background:rgba(139,92,246,.15);border-color:rgba(208,188,255,.3);color:var(--primary)}
.ts3-tab-panel{display:none}.ts3-tab-panel.active{display:block}
.ts3-gallery-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.ts3-gallery-tab{padding:5px 12px;border-radius:7px;font-size:10px;font-weight:700;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);color:var(--text-muted);cursor:pointer;transition:all .15s;font-family:var(--fb)}
.ts3-gallery-tab.active,.ts3-gallery-tab:hover{background:rgba(139,92,246,.15);color:var(--primary);border-color:rgba(208,188,255,.3)}
.ts3-template-grid{display:flex;gap:8px;flex-wrap:wrap}
.ts3-template-card{padding:8px;border-radius:10px;border:1px solid rgba(255,255,255,.07);background:rgba(35,31,56,.8);cursor:pointer;transition:all .15s;text-align:center;min-width:80px}
.ts3-template-card:hover{border-color:rgba(208,188,255,.3);background:rgba(35,31,56,.95)}
.ts3-template-card.selected{border-color:rgba(208,188,255,.5);background:rgba(139,92,246,.12)}
.ts3-template-preview{display:flex;align-items:center;justify-content:center;height:32px;overflow:hidden;margin-bottom:4px}
.ts3-template-label{font-size:9px;color:var(--text-muted);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ts3-pick-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(68px,1fr));gap:6px;margin-bottom:4px}
.ts3-pick-grid-sm{grid-template-columns:repeat(auto-fill,minmax(56px,1fr))}
.ts3-pick-item{padding:7px 4px;border-radius:9px;border:1px solid rgba(255,255,255,.07);background:rgba(35,31,56,.8);cursor:pointer;transition:all .15s;text-align:center}
.ts3-pick-item:hover{border-color:rgba(208,188,255,.3);background:rgba(35,31,56,.95)}
.ts3-pick-item.selected{border-color:rgba(208,188,255,.5);background:rgba(139,92,246,.12)}
.ts3-pick-preview{height:28px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.ts3-pick-label{font-size:8px;color:var(--text-muted);font-weight:700;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ts3-shape-mini{width:54px;height:28px}
.ts3-preview-pane{display:flex;flex-direction:column;align-items:center;gap:12px;background:rgba(20,18,40,.6);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:16px;height:fit-content;position:sticky;top:0}
.ts3-preview-label{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.35)}
.ts3-preview-stage{width:100%;background:linear-gradient(135deg,#0d0a1f,#1a1038);border-radius:12px;padding:20px;display:flex;flex-direction:column;align-items:center;gap:10px;border:1px solid rgba(255,255,255,.06)}
.ts3-preview-player{font-family:var(--fh);font-size:14px;font-weight:900;color:rgba(255,255,255,.5)}
.ts3-rarity-bar{display:flex;gap:6px;flex-wrap:wrap}
.ts3-rarity-btn{padding:5px 10px;border-radius:7px;font-size:10px;font-weight:800;cursor:pointer;font-family:var(--fb);transition:all .15s}
.ts3-color-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.ts3-color-item label{font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:5px}
.ts3-color-swatch-wrap{display:flex;align-items:center;gap:7px}

/* ── Shared tab system (reused by student and admin pages) ── */
.ts-form-tabs{display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:20px}
.ts-form-tab{display:flex;align-items:center;gap:7px;padding:11px 20px;font-size:13px;font-weight:700;color:var(--text-muted);background:none;border:none;cursor:pointer;border-bottom:2px solid transparent;transition:all .2s;font-family:var(--fb)}
.ts-form-tab:hover{color:var(--on-surface)}
.ts-form-tab.active{color:var(--primary);border-bottom-color:var(--primary-dark)}
.ts-form-panel{display:none}.ts-form-panel.active{display:block}

/* ── Flame anim in SVG ── */
.ts-flame-anim-svg .fl-outer{animation:tsFireFlicker 1.8s ease-in-out infinite}
`;
  document.head.appendChild(style);
})();

// ── DB migration guard ────────────────────────────────────────────────────────
// [SUPABASE MIGRATION] Deferred until AppStore.ready resolves — see the
// matching note in modules/shop/shop_pos_terminal.js for why this can no
// longer run synchronously at parse time.
AppStore.ready.then(function titlesMigrateDB() {
  DB = loadDB();
  let dirty = false;
  if (!DB.titles)         { DB.titles         = []; dirty = true; }
  if (!DB.titleUnlocks)   { DB.titleUnlocks   = {}; dirty = true; }
  if (!DB.equippedTitles) { DB.equippedTitles = {}; dirty = true; }
  if (dirty) saveDB();
});

// ── Load-order verification ───────────────────────────────────────────────────
;(function titlesVerifyExports() {
  const EXPECTED = [
    // badge-renderer.js
    'TS_FRAME_SHAPES_REGISTRY', 'TS_FRAME_STYLES_REGISTRY',
    'TS_EFFECTS_REGISTRY', 'TS_ANIMATIONS_REGISTRY',
    'TS_RARITY_ENHANCEMENTS', 'TS_RARITY', 'TS_BORDER_STYLES', 'TS_MMORPG_TEMPLATES',
    'tsDefaultTitle', 'tsBuildBadgeHTML', 'tsGetFrameShape', 'tsGetFrameStyle',
    // sidebar-refresh.js
    'tsGetEquippedTitle', 'tsGetUnlockedTitles', 'tsIsUnlocked',
    'tsEquipTitle', 'tsUnlockTitleForStudent', 'tsShowTitleUnlockPopup',
    'tsRefreshSidebarTitle', 'tsRefreshProfileTitle', 'tsRefreshProfileOverlay',
    'tsOpenTitlesFromProfile',
    // student-page.js
    'renderTitlesPage', 'tsTabSwitch', 'tsStudentEquip', 'tsStudentUnequip',
    '_tsRefreshStudentTitlesPanel',
    // admin-page.js
    'renderAdminTitles', '_tsRefreshAdminTitlesPanel', 'tsAdminTabSwitch',
    'tsAdminDelete', 'tsAdminToggle', 'tsAdminDuplicate',
    'tsAdminGrantModal', 'tsAdminGrantRefreshStudentTitles', 'tsAdminGrantConfirm',
    'tsAdminRevokeTitle',
    // designer.js
    'TS_TEMPLATE_CATS', 'tsAdminOpenDesigner',
    'ts3Tab', 'ts3FilterGallery', 'ts3ApplyTemplate', 'ts3RefreshAllPickers',
    'ts3PickShape', 'ts3PickStyle', 'ts3PickEffect', 'ts3PickAnim',
    'ts3SetColor', 'ts3SetRarity', 'ts3Preview',
    'tsApplyRarityDefaults', 'tsPreset', 'tsAdminSave',
    'tsLivePreview', 'tsUpdateRarityInfo',
  ];

  const missing = EXPECTED.filter(name => typeof window[name] !== 'function' && typeof window[name] !== 'object');
  if (missing.length) {
    console.error('[EduQuest] titles/index.js — MISSING exports:', missing);
  } else {
    console.log('[EduQuest] titles/index.js — All exports verified ✅');
  }

  window.__TITLES_MODULE_VERSION__ = '1.0.0';
})();
