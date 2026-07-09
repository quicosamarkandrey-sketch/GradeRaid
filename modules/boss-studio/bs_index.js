// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/boss-studio/index.js
//  Full Boss Studio CSS injection, editor overlay DOM scaffold,
//  DB migration guard, and load-order verification.
//
//  Required load order:
//    1. storage.js          — IndexedDB layer, BVP CRUD
//    2. library.js          — renderBossStudio, boss cards, search/filter/export
//    3. animation-library.js — AL_BUILTINS, alGet, alOptionsForTarget, full CRUD
//    4. editor.js           — bsOpenCreate, bsOpenEdit, full editor overlay
//    5. bve-engine.js       — bveRenderBossArt, bveLinkBossProfile
//    6. index.js            — this file
// ═══════════════════════════════════════════════════════════════════════════════

// ── CSS Injection ─────────────────────────────────────────────────────────────
;(function injectBossStudioCSS() {
  if (document.getElementById('boss-studio-module-css')) return;
  const style = document.createElement('style');
  style.id = 'boss-studio-module-css';
  style.textContent = `
/* ── Boss Studio hero ── */
.bs-hero{background:linear-gradient(135deg,#0d0a1f 0%,#1a1038 50%,#0e1020 100%);border:1px solid rgba(236,72,153,.2);border-radius:20px;padding:28px 32px;margin-bottom:24px;position:relative;overflow:hidden}
.bs-hero::before{content:'';position:absolute;top:-30px;right:-30px;width:200px;height:200px;background:radial-gradient(circle,rgba(236,72,153,.12) 0%,transparent 70%);pointer-events:none;border-radius:50%}
.bs-hero-inner{display:flex;align-items:flex-start;gap:18px;position:relative;z-index:1;flex-wrap:wrap}
.bs-hero-icon{width:56px;height:56px;border-radius:16px;background:linear-gradient(135deg,rgba(236,72,153,.25),rgba(139,92,246,.2));border:1px solid rgba(236,72,153,.4);display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0}
.bs-hero-info{flex:1;min-width:0}
.bs-hero-label{font-family:var(--fm);font-size:9px;color:rgba(236,72,153,.7);letter-spacing:.18em;text-transform:uppercase;margin-bottom:5px}
.bs-hero-title{font-family:var(--fh);font-size:24px;font-weight:900;color:var(--on-surface);margin-bottom:5px;line-height:1}
.bs-hero-sub{font-size:13px;color:var(--text-muted);line-height:1.5;margin-bottom:10px}
.bs-hero-stats-bar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.bs-stat-pill{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:var(--text-muted);background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:4px 10px}
.bs-stat-pill .material-symbols-outlined{font-size:13px}
.bs-io-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bs-io-label{font-size:11px;color:var(--text-muted);font-weight:700}
.bs-io-btn{display:flex;align-items:center;gap:4px;padding:5px 12px;border-radius:8px;border:1px solid var(--border2);background:rgba(255,255,255,.05);color:var(--text-muted);font-size:11px;font-weight:700;cursor:pointer;font-family:var(--fb);transition:all .15s}
.bs-io-btn:hover{background:rgba(255,255,255,.1);color:var(--on-surface)}
.bs-io-btn .material-symbols-outlined{font-size:13px}
.bs-hero-actions{flex-shrink:0;align-self:flex-start}

/* ── Tab bar ── */
.bs-tabs{display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:24px;overflow-x:auto}
.bs-tab{display:flex;align-items:center;gap:7px;padding:11px 18px;font-size:13px;font-weight:700;color:var(--text-muted);background:none;border:none;cursor:pointer;border-bottom:2px solid transparent;transition:all .2s;font-family:var(--fb);white-space:nowrap}
.bs-tab:hover{color:var(--on-surface)}
.bs-tab.active{color:#EC4899;border-bottom-color:#EC4899}
.bs-tab .material-symbols-outlined{font-size:15px}

/* ── Library toolbar ── */
.bs-library-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.bs-search-wrap{flex:1;min-width:200px;display:flex;align-items:center;gap:8px;background:rgba(35,31,56,.9);border:1px solid var(--border2);border-radius:12px;padding:9px 14px}
.bs-search-wrap .material-symbols-outlined{font-size:18px;color:var(--text-muted);flex-shrink:0}
.bs-search-wrap input{flex:1;background:none;border:none;outline:none;color:var(--text);font-family:var(--fb);font-size:13px}
.bs-filter-row{display:flex;gap:5px;flex-wrap:wrap}
.bs-filter-btn{padding:6px 12px;border-radius:8px;font-size:11px;font-weight:700;border:1px solid var(--border2);background:rgba(255,255,255,.04);color:var(--text-muted);cursor:pointer;transition:all .15s;font-family:var(--fb)}
.bs-filter-btn:hover{border-color:rgba(236,72,153,.3);color:var(--on-surface)}
.bs-filter-btn.active{background:rgba(236,72,153,.12);border-color:rgba(236,72,153,.35);color:#EC4899}
.bs-sort-select{background:rgba(35,31,56,.9);border:1px solid var(--border2);border-radius:10px;padding:7px 10px;font-size:11px;font-family:var(--fb);color:var(--text);cursor:pointer}
.bs-view-btn{background:rgba(255,255,255,.04);border:1px solid var(--border2);border-radius:8px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-muted);transition:all .15s}
.bs-view-btn.active,.bs-view-btn:hover{background:rgba(236,72,153,.12);border-color:rgba(236,72,153,.3);color:#EC4899}

/* ── Boss library grid ── */
.bs-library-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
.bs-library-grid.list-view{grid-template-columns:1fr}
.bs-boss-card{background:rgba(35,31,56,.88);border:1px solid var(--border);border-radius:16px;overflow:hidden;transition:all .3s;cursor:pointer;position:relative;display:flex;flex-direction:column}
.bs-boss-card:hover{transform:translateY(-3px);box-shadow:0 12px 40px rgba(0,0,0,.5),0 0 0 1px rgba(236,72,153,.15)}
.bs-boss-card.list-card{flex-direction:row;align-items:center;border-radius:12px}
.bs-card-artwork{position:relative;height:130px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.2);overflow:hidden;flex-shrink:0}
.bs-boss-card.list-card .bs-card-artwork{width:88px;height:88px;border-radius:0}
.bs-card-aura{position:absolute;inset:0;opacity:.6;pointer-events:none}
.bs-card-artwork-emoji{font-size:60px;line-height:1;z-index:1;position:relative;filter:drop-shadow(0 4px 16px rgba(0,0,0,.4))}
.bs-card-artwork-img{width:88px;height:88px;object-fit:contain;z-index:1;position:relative;filter:drop-shadow(0 4px 16px rgba(0,0,0,.5))}
.bs-card-artwork-placeholder{display:flex;flex-direction:column;align-items:center;gap:6px;color:rgba(255,255,255,.2)}
.bs-card-artwork-placeholder .material-symbols-outlined{font-size:32px}
.bs-card-artwork-placeholder span:last-child{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.bs-card-rage-badge{position:absolute;top:8px;right:8px;z-index:2;font-size:14px}
.bs-card-preview-btn{position:absolute;bottom:8px;right:8px;z-index:2;background:rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:4px 9px;color:rgba(255,255,255,.7);font-size:10px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:4px;font-family:var(--fb);opacity:0;transition:opacity .2s}
.bs-boss-card:hover .bs-card-preview-btn{opacity:1}
.bs-card-preview-btn .material-symbols-outlined{font-size:13px}
.bs-card-body{padding:14px;flex:1;display:flex;flex-direction:column;gap:5px;min-width:0}
.bs-card-tags{display:flex;gap:4px;flex-wrap:wrap}
.bs-card-tag{font-size:9px;font-weight:700;padding:2px 7px;border-radius:5px;border:1px solid;letter-spacing:.04em}
.bs-card-name{font-family:var(--fh);font-size:14px;font-weight:900;line-height:1.2}
.bs-card-desc{font-size:11px;color:var(--text-muted);line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;flex:1}
.bs-card-slot-pips{display:flex;gap:5px;margin-top:2px}
.bs-card-slot-pip{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);transition:all .2s;flex-shrink:0}
.bs-card-slot-pip.filled{background:rgba(78,222,163,.5);border-color:rgba(78,222,163,.7);box-shadow:0 0 6px rgba(78,222,163,.4)}
.bs-card-slot-pip.filled.rage-pip{background:rgba(236,72,153,.5);border-color:rgba(236,72,153,.7);box-shadow:0 0 6px rgba(236,72,153,.4)}
.bs-card-footer{display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:6px}
.bs-card-meta{font-size:10px;color:var(--text-muted)}
.bs-card-actions{display:flex;gap:4px;opacity:0;transition:opacity .2s}
.bs-boss-card:hover .bs-card-actions{opacity:1}
.bs-card-act-btn{width:28px;height:28px;border-radius:7px;border:1px solid var(--border2);background:rgba(255,255,255,.05);color:var(--text-muted);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .15s}
.bs-card-act-btn:hover{background:rgba(255,255,255,.12);color:var(--on-surface)}
.bs-card-act-btn.danger:hover{background:rgba(255,100,100,.12);border-color:rgba(255,100,100,.3);color:#ffb4ab}
.bs-card-act-btn.clone:hover{background:rgba(78,222,163,.1);border-color:rgba(78,222,163,.25);color:var(--secondary)}
.bs-card-act-btn .material-symbols-outlined{font-size:14px}

/* ── Empty states ── */
.bs-empty,.al-empty{text-align:center;padding:72px 20px;border:2px dashed rgba(255,255,255,.07);border-radius:16px;display:flex;flex-direction:column;align-items:center;gap:8px}
.bs-empty-icon,.al-empty-icon{font-size:56px}
.bs-empty-title,.al-empty-title{font-family:var(--fh);font-size:18px;font-weight:900;color:var(--on-surface)}
.bs-empty-sub,.al-empty-sub{font-size:13px;color:var(--text-muted);max-width:320px}

/* ── Animation library cards ── */
.al-hero{background:linear-gradient(135deg,#0d0a1f,#1a1038);border:1px solid rgba(78,222,163,.15);border-radius:18px;padding:24px 28px;margin-bottom:24px}
.al-hero-inner{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap}
.al-hero-icon{width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,rgba(78,222,163,.25),rgba(139,92,246,.15));border:1px solid rgba(78,222,163,.35);display:flex;align-items:center;justify-content:center;font-size:26px;flex-shrink:0}
.al-hero-info{flex:1;min-width:0}
.al-hero-label{font-family:var(--fm);font-size:9px;color:rgba(78,222,163,.6);letter-spacing:.18em;text-transform:uppercase;margin-bottom:4px}
.al-hero-title{font-family:var(--fh);font-size:22px;font-weight:900;color:var(--on-surface);margin-bottom:4px}
.al-hero-sub{font-size:12px;color:var(--text-muted);line-height:1.5}
.al-hero-actions{flex-shrink:0}
.al-library-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}
.al-card{background:rgba(35,31,56,.85);border:1px solid var(--border);border-radius:14px;overflow:hidden;transition:all .25s;display:flex;flex-direction:column}
.al-card:hover{border-color:rgba(78,222,163,.2);transform:translateY(-2px);box-shadow:0 8px 28px rgba(0,0,0,.4)}
.al-card-stage{background:rgba(0,0,0,.2);height:100px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.al-card-body{padding:12px;flex:1;display:flex;flex-direction:column;gap:4px}
.al-card-name{font-family:var(--fh);font-size:13px;font-weight:800;color:var(--on-surface)}
.al-card-type{display:flex;gap:5px;flex-wrap:wrap;align-items:center}
.al-card-desc{font-size:11px;color:var(--text-muted);line-height:1.4;flex:1}
.al-card-tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:2px}
.al-card-tag{font-size:9px;font-weight:700;padding:2px 7px;border-radius:5px;background:rgba(208,188,255,.1);border:1px solid rgba(208,188,255,.2);color:var(--primary)}
.al-card-tag.builtin{background:rgba(78,222,163,.08);border-color:rgba(78,222,163,.2);color:var(--secondary)}
.al-card-footer{display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:6px;border-top:1px solid rgba(255,255,255,.04)}
.al-card-actions{display:flex;gap:4px}
.al-card-act-btn{width:26px;height:26px;border-radius:6px;border:1px solid var(--border2);background:rgba(255,255,255,.04);color:var(--text-muted);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .15s}
.al-card-act-btn:hover{background:rgba(255,255,255,.1);color:var(--on-surface)}
.al-card-act-btn.danger:hover{background:rgba(255,100,100,.1);border-color:rgba(255,100,100,.25);color:#ffb4ab}
.al-card-act-btn .material-symbols-outlined{font-size:13px}
.al-preview-stage{background:rgba(20,18,40,.8);border:1px solid rgba(255,255,255,.08);border-radius:14px;width:160px;height:160px}
.al-preview-replay{display:flex;align-items:center;gap:5px;padding:6px 14px;border-radius:8px;border:1px solid var(--border2);background:rgba(255,255,255,.05);color:var(--text-muted);font-size:11px;font-weight:700;cursor:pointer;font-family:var(--fb);transition:all .15s}
.al-preview-replay:hover{background:rgba(255,255,255,.1);color:var(--on-surface)}
.al-form-layout{display:grid;grid-template-columns:1fr 180px;gap:20px}
@media(max-width:540px){.al-form-layout{grid-template-columns:1fr}}
.al-form-col,.al-preview-col{display:flex;flex-direction:column;gap:0}
.al-preview-col{align-items:center;gap:12px;padding-top:20px}
.al-target-grid{display:flex;gap:6px;flex-wrap:wrap}
.al-target-btn{padding:6px 12px;border-radius:8px;font-size:11px;font-weight:700;border:1px solid var(--border2);background:rgba(255,255,255,.04);color:var(--text-muted);cursor:pointer;transition:all .15s;font-family:var(--fb);display:flex;align-items:center;gap:4px}
.al-target-btn.sel{background:rgba(78,222,163,.12);border-color:rgba(78,222,163,.35);color:var(--secondary)}
.field-err{font-size:11px;color:#f87171;margin-top:4px}

/* ── Editor overlay ── */
#bs-editor-overlay{position:fixed;inset:0;z-index:1000;background:rgba(8,7,20,.97);display:flex;flex-direction:column;opacity:0;pointer-events:none;transition:opacity .25s}
#bs-editor-overlay.open{opacity:1;pointer-events:all}
.bseo-header{display:flex;align-items:center;gap:12px;padding:14px 20px;background:rgba(0,0,0,.4);border-bottom:1px solid rgba(255,255,255,.07);flex-shrink:0}
.bseo-header-icon{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,rgba(236,72,153,.25),rgba(139,92,246,.2));border:1px solid rgba(236,72,153,.35);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.bseo-title-wrap{flex:1;min-width:0;display:flex;align-items:center;gap:8px}
#bs-eo-title{font-family:var(--fh);font-size:16px;font-weight:900;color:var(--on-surface);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#bs-dirty-dot{width:8px;height:8px;border-radius:50%;background:#f97316;box-shadow:0 0 8px rgba(249,115,22,.6);opacity:0;flex-shrink:0;transition:opacity .2s}
#bs-dirty-dot.visible{opacity:1}
.bseo-header-actions{display:flex;gap:8px;flex-shrink:0;align-items:center}
.bseo-layout{display:grid;grid-template-columns:380px 1fr;flex:1;overflow:hidden}
@media(max-width:760px){.bseo-layout{grid-template-columns:1fr}}
.bseo-form-col{overflow-y:auto;border-right:1px solid rgba(255,255,255,.07);padding:20px}
.bseo-preview-col{overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:16px;background:rgba(0,0,0,.15)}

/* ── Editor form tool tabs ── */
.bs-tool-tabs{display:flex;gap:4px;margin-bottom:16px;flex-wrap:wrap}
.bs-tool-tab{padding:7px 14px;border-radius:9px;font-size:12px;font-weight:700;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.05);color:var(--text-muted);cursor:pointer;transition:all .15s;font-family:var(--fb)}
.bs-tool-tab:hover{color:var(--on-surface)}
.bs-tool-tab.active{background:rgba(236,72,153,.12);border-color:rgba(236,72,153,.35);color:#EC4899}
.bsf-tool-panel{display:block}
.bsf-art-panel{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:14px}
.bsf-art-tab-btn{padding:5px 12px;border-radius:7px;font-size:11px;font-weight:700;border:1px solid var(--border2);background:rgba(255,255,255,.04);color:var(--text-muted);cursor:pointer;margin-right:4px;margin-bottom:4px;font-family:var(--fb)}
.bsf-art-tab-btn.active{background:rgba(208,188,255,.12);border-color:rgba(208,188,255,.3);color:var(--primary)}
.bsf-dropzone{border:2px dashed rgba(255,255,255,.12);border-radius:12px;padding:20px;text-align:center;cursor:pointer;transition:all .2s;display:flex;flex-direction:column;align-items:center;gap:8px}
.bsf-dropzone.drag-over{border-color:rgba(236,72,153,.6);background:rgba(236,72,153,.06)}
.bsf-slot-stage-preview{display:flex;align-items:center;gap:8px}
.bsf-slot-mini-stage{width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.07);cursor:pointer;transition:all .2s}
.bsf-slot-mini-stage:hover{border-color:rgba(208,188,255,.3)}
.bsf-slot-anim-name{font-size:10px;color:var(--text-muted);font-weight:600;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-palette-swatch:hover{outline:2px solid rgba(255,255,255,.5) !important}

/* ── Editor preview stage ── */
.bsed-preview-card{background:rgba(25,22,48,.9);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:20px;display:flex;flex-direction:column;align-items:center;gap:14px}
#bsed-main-stage{width:160px;height:160px;border-radius:16px;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle,var(--bs-stage-glow,rgba(139,92,246,.3)) 0%,rgba(0,0,0,.4) 100%);border:1px solid rgba(255,255,255,.1);position:relative;overflow:hidden;cursor:pointer;transition:all .3s}
.bsed-stage-art{width:100%;height:100%;display:flex;align-items:center;justify-content:center;position:relative;z-index:1}
#bsed-nameplate{font-family:var(--fh);font-size:14px;font-weight:900;color:var(--on-surface);text-align:center}
.bsed-hp-bar{width:100%;max-width:200px;height:8px;background:rgba(255,255,255,.08);border-radius:4px;overflow:hidden}
#bsed-hp-fill{height:100%;width:68%;border-radius:4px;background:linear-gradient(90deg,var(--bs-hp-color,#EC4899),var(--bs-hp-color2,#8b5cf6));transition:background .4s}
.bsed-slot-preview-bar{display:flex;gap:8px;justify-content:center}
.bsed-slot-preview-bar button{padding:5px 10px;border-radius:7px;border:1px solid var(--border2);background:rgba(255,255,255,.05);color:var(--text-muted);font-size:10px;font-weight:700;cursor:pointer;font-family:var(--fb);transition:all .15s;display:flex;align-items:center;gap:3px}
.bsed-slot-preview-bar button:hover:not([disabled]){background:rgba(255,255,255,.1);color:var(--on-surface)}
.bsed-slot-preview-bar button.active{background:rgba(236,72,153,.15);border-color:rgba(236,72,153,.35);color:#EC4899}
.bsed-slot-preview-bar button[disabled]{opacity:.35;cursor:not-allowed}
.bsed-slot-pips{display:flex;gap:6px;justify-content:center}
.bsed-slot-pip{width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);transition:all .2s}
.bsed-slot-pip.filled{background:rgba(78,222,163,.5);border-color:rgba(78,222,163,.7);box-shadow:0 0 6px rgba(78,222,163,.4)}
.bsed-ts-chips{display:flex;gap:6px}
.bsed-ts-chip{display:flex;align-items:center;gap:4px;padding:4px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);font-size:11px;font-weight:700}
.bsed-ts-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.bsed-readiness-bar-wrap{width:100%;max-width:200px}
.bsed-readiness-bar-track{background:rgba(255,255,255,.07);border-radius:4px;height:6px;overflow:hidden;margin-bottom:4px}
#bsed-readiness-bar{height:100%;border-radius:4px;transition:width .4s,background .4s;width:0%}
#bsed-readiness-text{font-size:10px;color:var(--text-muted);text-align:center;font-weight:600}

/* ── BVE artwork wrappers ── */
.bve-art-wrap{display:inline-flex;align-items:center;justify-content:center;position:relative}
.bve-art-inner{display:flex;align-items:center;justify-content:center;position:relative;z-index:1}
.bve-aura{pointer-events:none}
.bvlp-card{background:rgba(35,31,56,.9);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:12px;cursor:pointer;transition:all .25s}
.bvlp-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.4)}

/* ── Boss Studio animation CSS classes (built-in) ── */
.bs-anim-stage{background:rgba(20,18,40,.85);border:1px solid rgba(255,255,255,.07);border-radius:14px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;position:relative;overflow:hidden}
.bs-anim-stage-art{font-size:48px;line-height:1;display:flex;align-items:center;justify-content:center}
.bs-anim-label{font-family:var(--fm);font-size:9px;font-weight:700;letter-spacing:.08em;color:rgba(255,255,255,.35);text-transform:uppercase}
@keyframes bsIdleFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes bsIdleBob{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.94)}}
@keyframes bsIdleSway{0%,100%{transform:rotate(0deg)}25%{transform:rotate(-4deg)}75%{transform:rotate(4deg)}}
@keyframes bsIdleGlow{0%,100%{filter:brightness(1) drop-shadow(0 0 0px transparent)}50%{filter:brightness(1.15) drop-shadow(0 0 18px var(--bs-card-glow,rgba(139,92,246,.6)))}}
@keyframes bsCastCharge{0%,100%{transform:scale(1);filter:brightness(1)}50%{transform:scale(1.18);filter:brightness(1.4) drop-shadow(0 0 24px rgba(255,220,100,.7))}}
@keyframes bsCastSpin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
@keyframes bsCastFlash{0%,100%{filter:brightness(1)}25%{filter:brightness(2) saturate(2)}50%{filter:brightness(1)}75%{filter:brightness(1.8) saturate(1.5)}}
@keyframes bsHitFlinch{0%,100%{transform:translate(0,0) rotate(0deg)}20%{transform:translate(-6px,-4px) rotate(-6deg)}40%{transform:translate(4px,2px) rotate(3deg)}60%{transform:translate(-3px,-1px) rotate(-2deg)}80%{transform:translate(2px,1px) rotate(1deg)}}
@keyframes bsHitShake{0%,100%{transform:translateX(0)}15%{transform:translateX(-8px)}30%{transform:translateX(8px)}45%{transform:translateX(-6px)}60%{transform:translateX(6px)}75%{transform:translateX(-3px)}90%{transform:translateX(3px)}}
@keyframes bsHitFlashRed{0%,100%{filter:brightness(1) hue-rotate(0deg)}50%{filter:brightness(1.5) hue-rotate(-30deg) saturate(3)}}
@keyframes bsRageBurst{0%{transform:scale(1);filter:brightness(1)}30%{transform:scale(1.35);filter:brightness(2) saturate(2) drop-shadow(0 0 28px rgba(236,72,153,.9))}70%{transform:scale(.95);filter:brightness(1.3) drop-shadow(0 0 14px rgba(236,72,153,.5))}100%{transform:scale(1);filter:brightness(1)}}
@keyframes bsRagePulse{0%,100%{filter:brightness(1) drop-shadow(0 0 6px rgba(236,72,153,.4))}50%{filter:brightness(1.3) drop-shadow(0 0 22px rgba(236,72,153,.9))}}
@keyframes bsRageVibrate{0%,100%{transform:translate(0,0)}10%{transform:translate(-3px,-2px)}20%{transform:translate(3px,2px)}30%{transform:translate(-2px,3px)}40%{transform:translate(2px,-3px)}50%{transform:translate(-3px,1px)}60%{transform:translate(3px,-1px)}70%{transform:translate(-1px,3px)}80%{transform:translate(1px,-2px)}90%{transform:translate(-2px,2px)}}
.bs-anim-play-idle-float{animation:bsIdleFloat 2.8s ease-in-out infinite}
.bs-anim-play-idle-bob{animation:bsIdleBob 1.8s ease-in-out infinite}
.bs-anim-play-idle-sway{animation:bsIdleSway 3.2s ease-in-out infinite}
.bs-anim-play-idle-glow{animation:bsIdleGlow 2.4s ease-in-out infinite}
.bs-anim-play-cast-charge{animation:bsCastCharge .8s ease-in-out 1}
.bs-anim-play-cast-spin{animation:bsCastSpin .6s linear 1}
.bs-anim-play-cast-flash{animation:bsCastFlash .5s ease-in-out 1}
.bs-anim-play-hit-flinch{animation:bsHitFlinch .5s ease-out 1}
.bs-anim-play-hit-shake{animation:bsHitShake .4s ease-out 1}
.bs-anim-play-hit-flashred{animation:bsHitFlashRed .35s ease-in-out 1}
.bs-anim-play-rage-burst{animation:bsRageBurst .9s ease-out 1}
.bs-anim-play-rage-pulse{animation:bsRagePulse 1.6s ease-in-out infinite}
.bs-anim-play-rage-vibrate{animation:bsRageVibrate .25s linear infinite}
`;
  document.head.appendChild(style);
})();

// ── Editor overlay DOM scaffold ───────────────────────────────────────────────
// Must be injected once at startup — the editor overlay is a fixed overlay
// that persists in the DOM; editors open/close by toggling .open class.
;(function injectEditorOverlay() {
  if (document.getElementById('bs-editor-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id    = 'bs-editor-overlay';
  overlay.innerHTML = `
  <div class="bseo-header">
    <div class="bseo-header-icon">🎭</div>
    <div class="bseo-title-wrap">
      <span id="bs-eo-title">Boss Profile Editor</span>
      <span id="bs-dirty-dot" title="Unsaved changes"></span>
    </div>
    <div class="bseo-header-actions">
      <button class="btn btn-ghost btn-sm" onclick="window._bsCloseEditor()"><span class="material-symbols-outlined" style="font-size:16px">close</span> Close</button>
      <button class="btn btn-primary" style="font-family:var(--fh);font-weight:800" onclick="window.bsSaveForm()"><span class="material-symbols-outlined" style="font-size:16px">save</span> Save Profile</button>
    </div>
  </div>
  <div class="bseo-layout">
    <div class="bseo-form-col" id="bs-editor-form-body"></div>
    <div class="bseo-preview-col">
      <div class="bsed-preview-card">
        <div id="bsed-main-stage" onclick="window._bsEditorPlayState('idle')" title="Click to preview idle animation">
          <div class="bsed-stage-art" id="bsed-stage-art"><span style="font-size:88px">💀</span></div>
        </div>
        <div id="bsed-nameplate" style="font-family:var(--fh);font-size:14px;font-weight:900;color:var(--on-surface)">New Boss</div>
        <div class="bsed-hp-bar"><div id="bsed-hp-fill"></div></div>
        <div class="bsed-slot-preview-bar">
          <button id="bsed-btn-idle"  onclick="window._bsEditorPlayState('idle')" disabled><span class="material-symbols-outlined" style="font-size:12px">play_circle</span>Idle</button>
          <button id="bsed-btn-cast"  onclick="window._bsEditorPlayState('cast')" disabled><span class="material-symbols-outlined" style="font-size:12px">bolt</span>Cast</button>
          <button id="bsed-btn-hit"   onclick="window._bsEditorPlayState('hit')"  disabled><span class="material-symbols-outlined" style="font-size:12px">gpp_bad</span>Hit</button>
          <button id="bsed-btn-rage"  onclick="window._bsEditorPlayState('rage')" disabled><span class="material-symbols-outlined" style="font-size:12px">local_fire_department</span>Rage</button>
        </div>
        <div class="bsed-slot-pips">
          <div class="bsed-slot-pip" id="bsed-pip-idle"  title="Idle slot"></div>
          <div class="bsed-slot-pip" id="bsed-pip-cast"  title="Cast slot"></div>
          <div class="bsed-slot-pip" id="bsed-pip-hit"   title="Hit slot"></div>
          <div class="bsed-slot-pip" id="bsed-pip-rage"  title="Rage slot"></div>
        </div>
        <div id="bsed-tag-preview" style="display:flex;gap:5px;flex-wrap:wrap;justify-content:center"></div>
        <div class="bsed-ts-chips">
          <div class="bsed-ts-chip"><div class="bsed-ts-dot" id="bsed-ts-theme"></div><span id="bsed-ts-theme-val" style="font-family:monospace;font-size:10px"></span></div>
          <div class="bsed-ts-chip"><div class="bsed-ts-dot" id="bsed-ts-aura"></div><span id="bsed-ts-aura-val" style="font-family:monospace;font-size:10px"></span></div>
          <div class="bsed-ts-chip"><div class="bsed-ts-dot" id="bsed-ts-accent"></div><span id="bsed-ts-accent-val" style="font-family:monospace;font-size:10px"></span></div>
        </div>
        <div class="bsed-readiness-bar-wrap">
          <div class="bsed-readiness-bar-track"><div id="bsed-readiness-bar"></div></div>
          <div id="bsed-readiness-text">0% complete</div>
        </div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(overlay);
})();

// ── DB migration guard ────────────────────────────────────────────────────────
// [SUPABASE MIGRATION] Deferred until AppStore.ready resolves — see the
// matching note in modules/shop/shop_pos_terminal.js for why this can no
// longer run synchronously at parse time.
AppStore.ready.then(function bossMigrateDB() {
  DB = loadDB();
  let dirty = false;
  if (!DB.bossLibrary)      { DB.bossLibrary      = []; dirty = true; }
  if (!DB.animationLibrary) { DB.animationLibrary = []; dirty = true; }
  if (dirty) saveDB();
});

// ── Load-order verification ───────────────────────────────────────────────────
;(function bossVerifyExports() {
  const EXPECTED = [
    // storage.js
    'bsLoad', 'bsGet', 'bsUpsertAsync', '_bsUpsert', '_bsDelete',
    '_bsImgFetch', '_bsIsImgRef', '_bsResolveArtwork',
    '_bsMigrateLegacyInlineImages',
    // library.js
    'BS_PALETTES', 'bsvpBlank', 'renderBossStudio', '_bsSetTab',
    'bsOpenPreview', '_bsCloseEncounter', '_bsEncPlayState',
    '_bsSearchUpdate', '_bsSetFilter', '_bsSetSort', '_bsSetView',
    'bsDuplicate', 'bsConfirmDelete', '_bsDeleteConfirmed',
    '_bsExportSingle', '_bsExportAll', '_bsImportJSON',
    '_bsRefreshLibrary', '_bsDateLabel',
    // animation-library.js
    '_alGet', '_alOptionsForTarget', '_alRenderTabBody',
    '_alOpenCreate', '_alOpenEdit', '_alToggleTarget',
    '_alFormPreviewRefresh', '_alSaveForm',
    '_alConfirmDelete', '_alDeleteConfirmed',
    '_alSearchUpdate', '_alSetFilter', '_alTogglePreview',
    '_alOpenPreviewModal', '_alPreviewModalReplay',
    // editor.js
    'bsOpenCreate', 'bsOpenEdit', '_bsMarkDirty',
    '_bsCloseEditor', '_bsForceCloseEditor',
    '_bsSyncEditorPreview', '_bsEditorPlayState',
    '_bsSetToolTab', '_bsRefreshAllSlotStages', '_bsRefreshSlotStage',
    '_bsToggleSlotPreview', '_bsArtTab',
    '_bsPickEmoji', '_bsUpdatePreviewImg', '_bsHandleFileUpload',
    '_bsDragOver', '_bsDragLeave', '_bsDropFile', '_bsClearUpload',
    '_bsApplyPaletteIdx', '_bsApplyPalette',
    'bsSaveForm', '_bsRenderFormModal',
    // bve-engine.js
    'bveRenderBossArt', 'bveRenderCompactArt', 'bveRenderBossArtAsync',
    'bveLinkBossProfile', '_bvePickProfile',
  ];

  const missing = EXPECTED.filter(name => typeof window[name] !== 'function' && typeof window[name] !== 'object');
  if (missing.length) {
    console.error('[EduQuest] boss-studio/index.js — MISSING exports:', missing);
  } else {
    console.log('[EduQuest] boss-studio/index.js — All exports verified ✅');
  }

  window.__BOSS_STUDIO_MODULE_VERSION__ = '1.0.0';
})();
