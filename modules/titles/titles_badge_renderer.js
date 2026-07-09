// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/titles/badge-renderer.js
//  THE CRITICAL FIRST FILE — must load before every other titles file.
//
//  Exports: TS_FRAME_SHAPES_REGISTRY, TS_FRAME_STYLES_REGISTRY,
//           TS_EFFECTS_REGISTRY, TS_ANIMATIONS_REGISTRY,
//           TS_RARITY_ENHANCEMENTS (= TS_RARITY), TS_BORDER_STYLES,
//           TS_MMORPG_TEMPLATES, tsDefaultTitle(),
//           tsBuildBadgeHTML, tsGetFrameShape, tsGetFrameStyle
//
//  Also resolves: leaderboard module's tsBuildBadgeHTML typeof guard.
//  After this file loads all callers that use typeof guards get the real function.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Registries ────────────────────────────────────────────────────────────────

window.TS_FRAME_SHAPES_REGISTRY = [
  { id:'classic',   label:'Classic',    icon:'⬜' },
  { id:'rectangle', label:'Rectangle',  icon:'▬'  },
  { id:'capsule',   label:'Capsule',    icon:'💊' },
  { id:'ribbon',    label:'Ribbon',     icon:'🎀' },
  { id:'banner',    label:'Banner',     icon:'🏳️' },
  { id:'shield',    label:'Shield',     icon:'🛡️' },
  { id:'hexagon',   label:'Hexagon',    icon:'⬡'  },
  { id:'diamond',   label:'Diamond',    icon:'♦️' },
  { id:'dragon',    label:'Dragon',     icon:'🐉' },
  { id:'scale',     label:'Scale',      icon:'🐍' },
  { id:'flame',     label:'Flame',      icon:'🔥' },
  { id:'crystal',   label:'Crystal',    icon:'💎' },
  { id:'ghost',     label:'Ghost',      icon:'👻' },
  { id:'poison',    label:'Poison',     icon:'☠️' },
  { id:'shadow',    label:'Shadow',     icon:'🌑' },
  { id:'royal',     label:'Royal',      icon:'👑' },
  { id:'arcane',    label:'Arcane',     icon:'🔮' },
  { id:'celestial', label:'Celestial',  icon:'⭐' },
];

window.TS_FRAME_STYLES_REGISTRY = [
  { id:'none',      label:'None'      },
  { id:'metal',     label:'Metal'     },
  { id:'stone',     label:'Stone'     },
  { id:'crystal',   label:'Crystal'   },
  { id:'shadow',    label:'Shadow'    },
  { id:'fire',      label:'Fire'      },
  { id:'poison',    label:'Poison'    },
  { id:'arcane',    label:'Arcane'    },
  { id:'royal',     label:'Royal'     },
  { id:'celestial', label:'Celestial' },
];

window.TS_EFFECTS_REGISTRY = [
  { id:'none',       label:'None'       },
  { id:'glow',       label:'Glow'       },
  { id:'pulse',      label:'Pulse Wave' },
  { id:'embers',     label:'Embers'     },
  { id:'smoke',      label:'Smoke'      },
  { id:'runes',      label:'Runes'      },
  { id:'lightning',  label:'Lightning'  },
  { id:'stars',      label:'Stars'      },
  { id:'drips',      label:'Drips'      },
  { id:'particles',  label:'Particles'  },
];

window.TS_ANIMATIONS_REGISTRY = [
  { id:'none',            label:'None'           },
  { id:'pulse',           label:'Pulse'          },
  { id:'glow-pulse',      label:'Glow Pulse'     },
  { id:'float',           label:'Float'          },
  { id:'wave',            label:'Wave'           },
  { id:'fire-flicker',    label:'Fire Flicker'   },
  { id:'ghost-drift',     label:'Ghost Drift'    },
  { id:'shake',           label:'Shake'          },
  { id:'flicker',         label:'Flicker'        },
  { id:'burn',            label:'Burn'           },
  { id:'orbit',           label:'Orbit'          },
  { id:'spectral-drift',  label:'Spectral Drift' },
  { id:'rune-rotation',   label:'Rune Rotation'  },
];

window.TS_RARITY_ENHANCEMENTS = {
  Common:    { shadowSpread: 8,  glowMul: 0.15, label:'Common'    },
  Uncommon:  { shadowSpread: 10, glowMul: 0.28, label:'Uncommon'  },
  Rare:      { shadowSpread: 14, glowMul: 0.45, label:'Rare'      },
  Epic:      { shadowSpread: 18, glowMul: 0.65, label:'Epic'      },
  Legendary: { shadowSpread: 24, glowMul: 0.85, label:'Legendary' },
  Mythic:    { shadowSpread: 30, glowMul: 1.0,  label:'Mythic'    },
};
window.TS_RARITY = window.TS_RARITY_ENHANCEMENTS;

window.TS_BORDER_STYLES = [
  { id:'none',   label:'None',    cssClass:''            },
  { id:'solid',  label:'Solid',   cssClass:''            },
  { id:'double', label:'Double',  cssClass:'tsb-double'  },
  { id:'dashed', label:'Dashed',  cssClass:'tsb-dashed'  },
  { id:'flame',  label:'Flame',   cssClass:'tsb-flame'   },
  { id:'scale',  label:'Scale',   cssClass:'tsb-scale'   },
  { id:'crystal',label:'Crystal', cssClass:'tsb-crystal' },
  { id:'shadow', label:'Shadow',  cssClass:'tsb-shadow'  },
  { id:'ghost',  label:'Ghost',   cssClass:'tsb-ghost'   },
  { id:'poison', label:'Poison',  cssClass:'tsb-poison'  },
  { id:'custom', label:'Custom',  cssClass:''            },
];

// ── Default title factory ─────────────────────────────────────────────────────

window.tsDefaultTitle = function () {
  return {
    id: uid(), name: '', description: '', icon: '🏆', rarity: 'Common', active: true,
    achievementId: null,
    frameShape: 'classic',
    primaryColor: '#d0bcff', secondaryColor: '#8b5cf6', accentColor: '#a78bfa',
    borderColor: '#8b5cf6', glowColor: '#8b5cf6', textColor: '#ffffff',
    bgColor: '#1a1438', gradientFrom: '#8b5cf6', gradientTo: '#4edea3',
    frameStyle: 'none', effect: 'none', animation: 'none',
    borderStyle: 'solid', frameTemplate: 'solid', particles: 'none',
    bgEffect: 'none', customBorderCSS: '', customAnimationCSS: '', customBgCSS: '',
    createdAt: new Date().toISOString(),
  };
};

// ── CSS Injection ─────────────────────────────────────────────────────────────
// The full titles CSS (badge plate base, border styles, animation keyframes,
// effect layers, bg effects, particles, unlock popup, designer layout,
// student title grid, admin cards, sidebar equipped, tab system, designer selects)
// is injected by titles/index.js. This file only injects frame-specific
// styles that tsBuildBadgeHTML references via dynamic class names.
// (The full CSS block is in index.js to keep this file focused on the render engine.)

// ── Helper lookups ─────────────────────────────────────────────────────────────

window.tsGetFrameShape = function (id) {
  return TS_FRAME_SHAPES_REGISTRY.find(s => s.id === id) || TS_FRAME_SHAPES_REGISTRY[0];
};
window.tsGetFrameStyle = function (id) {
  return TS_FRAME_STYLES_REGISTRY.find(s => s.id === id) || TS_FRAME_STYLES_REGISTRY[0];
};

// ── MMORPG Template Library ───────────────────────────────────────────────────
window.TS_MMORPG_TEMPLATES = [
  { id:'np_warrior',   cat:'nameplate',   label:'Warrior',       icon:'⚔️',  frameShape:'classic',   frameStyle:'metal',    effect:'glow',       animation:'pulse',        rarity:'Rare',      primaryColor:'#ef4444', secondaryColor:'#b91c1c', accentColor:'#fca5a5', borderColor:'#dc2626', glowColor:'#ef4444', textColor:'#fff5f5', bgColor:'#1a0808', gradientFrom:'#dc2626', gradientTo:'#7f1d1d' },
  { id:'np_mage',      cat:'nameplate',   label:'Arcane Mage',   icon:'🔮',  frameShape:'arcane',    frameStyle:'arcane',   effect:'runes',      animation:'glow-pulse',   rarity:'Epic',      primaryColor:'#a855f7', secondaryColor:'#7c3aed', accentColor:'#d8b4fe', borderColor:'#9333ea', glowColor:'#c084fc', textColor:'#fdf4ff', bgColor:'#0d0621', gradientFrom:'#7c3aed', gradientTo:'#4c1d95' },
  { id:'np_paladin',   cat:'nameplate',   label:'Holy Paladin',  icon:'✨',  frameShape:'shield',    frameStyle:'royal',    effect:'glow',       animation:'glow-pulse',   rarity:'Legendary', primaryColor:'#fbbf24', secondaryColor:'#d97706', accentColor:'#fef08a', borderColor:'#f59e0b', glowColor:'#fbbf24', textColor:'#fffbeb', bgColor:'#1a1200', gradientFrom:'#d97706', gradientTo:'#92400e' },
  { id:'np_rogue',     cat:'nameplate',   label:'Shadow Rogue',  icon:'🗡️', frameShape:'ribbon',    frameStyle:'shadow',   effect:'smoke',      animation:'ghost-drift',  rarity:'Rare',      primaryColor:'#6b7280', secondaryColor:'#374151', accentColor:'#9ca3af', borderColor:'#4b5563', glowColor:'#6b7280', textColor:'#f9fafb', bgColor:'#080808', gradientFrom:'#374151', gradientTo:'#111827' },
  { id:'np_hunter',    cat:'nameplate',   label:'Ranger',        icon:'🏹',  frameShape:'capsule',   frameStyle:'none',     effect:'glow',       animation:'float',        rarity:'Uncommon',  primaryColor:'#4ade80', secondaryColor:'#16a34a', accentColor:'#86efac', borderColor:'#22c55e', glowColor:'#4ade80', textColor:'#f0fdf4', bgColor:'#021a07', gradientFrom:'#15803d', gradientTo:'#14532d' },
  { id:'ach_legend',   cat:'achievement', label:'Legend Banner',  icon:'🏆',  frameShape:'banner',    frameStyle:'royal',    effect:'glow',       animation:'glow-pulse',   rarity:'Legendary', primaryColor:'#fbbf24', secondaryColor:'#f59e0b', accentColor:'#fde047', borderColor:'#d97706', glowColor:'#fbbf24', textColor:'#fef9c3', bgColor:'#1c1200', gradientFrom:'#b45309', gradientTo:'#451a03' },
  { id:'ach_dragon',   cat:'achievement', label:'Dragon Slayer',  icon:'🐉',  frameShape:'dragon',    frameStyle:'fire',     effect:'embers',     animation:'fire-flicker', rarity:'Mythic',    primaryColor:'#f97316', secondaryColor:'#ea580c', accentColor:'#fed7aa', borderColor:'#c2410c', glowColor:'#f97316', textColor:'#fff7ed', bgColor:'#1a0800', gradientFrom:'#c2410c', gradientTo:'#7c2d12' },
  { id:'ach_champion', cat:'achievement', label:'Champion',       icon:'🥇',  frameShape:'hexagon',   frameStyle:'metal',    effect:'glow',       animation:'pulse',        rarity:'Epic',      primaryColor:'#60a5fa', secondaryColor:'#2563eb', accentColor:'#bfdbfe', borderColor:'#3b82f6', glowColor:'#60a5fa', textColor:'#eff6ff', bgColor:'#000d1f', gradientFrom:'#1d4ed8', gradientTo:'#1e3a8a' },
  { id:'ach_celestial',cat:'achievement', label:'Celestial Mark', icon:'🌟',  frameShape:'celestial', frameStyle:'celestial',effect:'stars',      animation:'glow-pulse',   rarity:'Mythic',    primaryColor:'#e0f2fe', secondaryColor:'#38bdf8', accentColor:'#bae6fd', borderColor:'#0ea5e9', glowColor:'#7dd3fc', textColor:'#f0f9ff', bgColor:'#00091f', gradientFrom:'#0369a1', gradientTo:'#082f49' },
  { id:'guild_gm',     cat:'guild',       label:'Guild Master',   icon:'👑',  frameShape:'royal',     frameStyle:'royal',    effect:'glow',       animation:'glow-pulse',   rarity:'Legendary', primaryColor:'#fde047', secondaryColor:'#ca8a04', accentColor:'#fef08a', borderColor:'#eab308', glowColor:'#fde047', textColor:'#fefce8', bgColor:'#120e00', gradientFrom:'#ca8a04', gradientTo:'#713f12' },
  { id:'guild_officer',cat:'guild',       label:'Officer',        icon:'⚜️',  frameShape:'banner',    frameStyle:'metal',    effect:'glow',       animation:'float',        rarity:'Epic',      primaryColor:'#a78bfa', secondaryColor:'#7c3aed', accentColor:'#ddd6fe', borderColor:'#8b5cf6', glowColor:'#a78bfa', textColor:'#f5f3ff', bgColor:'#0a0616', gradientFrom:'#6d28d9', gradientTo:'#2e1065' },
  { id:'guild_veteran',cat:'guild',       label:'Veteran',        icon:'🛡️',  frameShape:'shield',    frameStyle:'stone',    effect:'none',       animation:'pulse',        rarity:'Rare',      primaryColor:'#94a3b8', secondaryColor:'#475569', accentColor:'#cbd5e1', borderColor:'#64748b', glowColor:'#94a3b8', textColor:'#f8fafc', bgColor:'#0d0f11', gradientFrom:'#334155', gradientTo:'#1e293b' },
  { id:'item_mythic',  cat:'item',        label:'Mythic Loot',    icon:'💎',  frameShape:'crystal',   frameStyle:'crystal',  effect:'lightning',  animation:'glow-pulse',   rarity:'Mythic',    primaryColor:'#67e8f9', secondaryColor:'#0891b2', accentColor:'#a5f3fc', borderColor:'#06b6d4', glowColor:'#22d3ee', textColor:'#ecfeff', bgColor:'#00101a', gradientFrom:'#0e7490', gradientTo:'#164e63' },
];

// ── Badge HTML Renderer ───────────────────────────────────────────────────────

/**
 * tsBuildBadgeHTML(title, opts) → HTML string  [window.tsBuildBadgeHTML]
 *
 * Renders an MMORPG-style title badge as an HTML string.
 * Used throughout EduQuest: leaderboard, sidebar, dashboard, inventory,
 * student Titles page, admin designer preview.
 *
 * opts: {
 *   small      — compact size (ts-size-sm)
 *   xs         — extra-small size (ts-size-xs)
 *   noParticles — skip particle HTML (performance / static contexts)
 *   style      — additional inline CSS string for the wrapper
 * }
 *
 * The SVG frame is generated inline (no external assets) so badges work
 * in all rendering contexts including modals, sidebars, and PDFs.
 * Rarity overlays (Legendary glint, Mythic burst) are injected inside
 * .ts-rarity-overlay-host (overflow:hidden) to prevent visual bleed.
 */
window.tsBuildBadgeHTML = function (title, opts) {
  if (!title) return '';
  opts = opts || {};
  const rCfg   = TS_RARITY[title.rarity] || TS_RARITY.Common;
  const bg       = title.bgColor      || '#1a1438';
  const border   = title.borderColor  || '#8b5cf6';
  const glow     = title.glowColor    || '#8b5cf6';
  const text     = title.textColor    || '#ffffff';
  const gradFrom = title.gradientFrom || '#8b5cf6';
  const gradTo   = title.gradientTo   || '#4edea3';
  const spread   = opts.small ? rCfg.shadowSpread * 0.6 : rCfg.shadowSpread;
  const alpha    = opts.small ? rCfg.glowMul * 0.7      : rCfg.glowMul;

  function h2rgba(hex, a) {
    const r = parseInt((hex || '#8b5cf6').slice(1, 3), 16) || 139;
    const g = parseInt((hex || '#8b5cf6').slice(3, 5), 16) || 92;
    const b = parseInt((hex || '#8b5cf6').slice(5, 7), 16) || 246;
    return `rgba(${r},${g},${b},${a})`;
  }

  const glowShadow = `0 0 ${spread}px ${h2rgba(glow, alpha)}`;
  const glowMax    = `0 0 ${spread * 2}px ${h2rgba(glow, Math.min(1, alpha * 1.6))}`;

  const cssVars = [
    `--ts-bg:${bg}`, `--ts-border:${border}`, `--ts-glow:${glow}`,
    `--ts-grad-from:${gradFrom}`, `--ts-grad-to:${gradTo}`,
    `--ts-primary:${title.primaryColor || '#d0bcff'}`,
    `--ts-accent:${title.accentColor || gradTo || '#fde047'}`,
    `--ts-glow-shadow:${glowShadow}`, `--ts-glow-shadow-max:${glowMax}`,
    `--ts-text:${text}`,
  ].join(';');

  const bStyleDef   = TS_BORDER_STYLES.find(b => b.id === (title.borderStyle || 'solid')) || TS_BORDER_STYLES[1];
  const borderClass = bStyleDef.cssClass || '';
  const rarityClass = 'ts-rarity-' + ((title.rarity || 'Common').toString().toLowerCase());
  const useLegacyBorderClass = !title.frameTemplate || title.frameTemplate === 'solid';
  const customBorderStyle    = (title.customBorderCSS && title.borderStyle === 'custom') ? `border:${title.customBorderCSS};` : '';

  let animClass = '';
  if (title.animation && title.animation !== 'none' && title.animation !== 'custom')
    animClass = `ts-anim-${title.animation}`;
  const customAnimStyle = (title.customAnimationCSS && title.animation === 'custom') ? `animation:${title.customAnimationCSS};` : '';

  let bgClass = '';
  if (title.bgEffect && title.bgEffect !== 'none' && title.bgEffect !== 'custom')
    bgClass = `tsbg-${title.bgEffect}`;

  let effectClass = '';
  if (title.effect && title.effect !== 'none') effectClass = `ts-effect-${title.effect}`;

  const customBgStyle  = (title.customBgCSS && title.bgEffect === 'custom') ? `background:${title.customBgCSS};` : '';
  const sizeClass      = opts.xs ? 'ts-size-xs' : opts.small ? 'ts-size-sm' : '';
  const frameShape     = (title.frameShape || title.frameTemplate || title.borderStyle || 'classic').toString().toLowerCase();
  const frameStyleId   = (title.frameStyle || 'none').toString().toLowerCase();
  const frameClass     = 'ts-frame-' + frameShape;
  const styleClass     = frameStyleId !== 'none' ? 'ts-style-' + frameStyleId : '';
  const wrapperClasses = ['ts-badge-wrap', frameClass, styleClass, useLegacyBorderClass ? borderClass : '', bgClass, animClass, effectClass, rarityClass, sizeClass].filter(Boolean).join(' ');
  const wrapperInlineStyle = [cssVars, `background:${customBgStyle ? '' : 'transparent'}`, customBgStyle, `border-color:${border}`, `box-shadow:${glowShadow}`, customBorderStyle, customAnimStyle, opts.style || ''].filter(Boolean).join(';');
  const innerInlineStyle   = [`color:${text}`].join(';');

  // ── SVG Frame builder ──────────────────────────────────────────────────────
  function buildFrameSVG(shape) {
    const gId = 'g-' + (Math.random() + '').slice(2, 8);
    const stroke = title.borderColor || '#8b5cf6';
    switch ((shape || 'classic')) {
      case 'solid': case 'double': case 'dashed': case 'dotted': case 'custom': case 'classic':
        return `<svg class="ts-frame-svg" viewBox="0 0 220 72" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".9"/><stop offset="1" stop-color="${gradTo||stroke}" stop-opacity=".45"/></linearGradient></defs><rect x="10" y="10" width="200" height="52" rx="20" fill="url(#${gId})" stroke="${stroke}" stroke-width="3"/><path d="M24 22 H84" stroke="rgba(255,255,255,.28)" stroke-width="4" stroke-linecap="round"/><path d="M24 50 H84" stroke="rgba(255,255,255,.16)" stroke-width="3" stroke-linecap="round"/></svg>`;
      case 'rectangle':
        return `<svg class="ts-frame-svg" viewBox="0 0 220 70" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".9"/><stop offset="1" stop-color="${gradTo||stroke}" stop-opacity=".45"/></linearGradient></defs><rect x="10" y="10" width="200" height="50" fill="url(#${gId})" stroke="${stroke}" stroke-width="2"/><path d="M20 22 H90" stroke="rgba(255,255,255,.28)" stroke-width="3" stroke-linecap="round"/></svg>`;
      case 'capsule':
        return `<svg class="ts-frame-svg" viewBox="0 0 220 58" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".9"/><stop offset="1" stop-color="${gradTo||stroke}" stop-opacity=".45"/></linearGradient></defs><rect x="8" y="10" width="204" height="38" rx="20" fill="url(#${gId})" stroke="${stroke}" stroke-width="3"/><path d="M32 22 H88" stroke="rgba(255,255,255,.28)" stroke-width="3" stroke-linecap="round"/></svg>`;
      case 'ribbon':
        return `<svg class="ts-frame-svg" viewBox="0 0 220 70" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".95"/><stop offset="1" stop-color="${gradTo||stroke}" stop-opacity=".5"/></linearGradient></defs><path d="M10 18 H210 Q214 18 214 22 V42 Q214 46 210 46 H10 Q6 46 6 42 V22 Q6 18 10 18 Z" fill="url(#${gId})" stroke="${stroke}" stroke-width="2"/><path d="M10 18 L2 28 L10 38" fill="url(#${gId})" stroke="${stroke}" stroke-width="2"/><path d="M210 18 L218 28 L210 38" fill="url(#${gId})" stroke="${stroke}" stroke-width="2"/></svg>`;
      case 'banner':
        return `<svg class="ts-frame-svg" viewBox="0 0 220 74" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".95"/><stop offset="1" stop-color="${gradTo||stroke}" stop-opacity=".5"/></linearGradient></defs><path d="M10 22 H210 Q214 22 214 26 V46 Q214 50 210 50 H10 Q6 50 6 46 V26 Q6 22 10 22 Z" fill="url(#${gId})" stroke="${stroke}" stroke-width="2"/><path d="M10 22 L0 34 L10 46" fill="url(#${gId})" stroke="${stroke}" stroke-width="2"/><path d="M210 22 L220 34 L210 46" fill="url(#${gId})" stroke="${stroke}" stroke-width="2"/></svg>`;
      case 'shield':
        return `<svg class="ts-frame-svg" viewBox="0 0 240 96" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".98"/><stop offset="0.4" stop-color="${gradTo||stroke}" stop-opacity=".78"/><stop offset="1" stop-color="${stroke}" stop-opacity=".58"/></linearGradient><linearGradient id="${gId}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgba(255,255,255,.32)"/><stop offset=".5" stop-color="rgba(255,255,255,.06)"/><stop offset="1" stop-color="rgba(0,0,0,.18)"/></linearGradient><radialGradient id="${gId}c" cx="50%" cy="35%" r="45%"><stop offset="0" stop-color="rgba(255,255,255,.28)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/></radialGradient><filter id="fsh${gId}"><feGaussianBlur stdDeviation="1.8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path filter="url(#fsh${gId})" d="M18 10 H222 L222 54 C222 70 200 84 176 90 L148 96 C138 100 130 96 120 96 C110 96 102 100 92 96 L64 90 C40 84 18 70 18 54 Z" fill="url(#${gId})" stroke="${stroke}" stroke-width="2.4"/><path d="M32 18 H208 L208 52 C208 65 190 77 168 83 L148 88 C138 91 130 88 120 88 C110 88 102 91 92 88 L72 83 C50 77 32 65 32 52 Z" fill="url(#${gId}b)" opacity=".55"/><ellipse cx="120" cy="46" rx="80" ry="36" fill="url(#${gId}c)" opacity=".6"/><line x1="26" y1="52" x2="214" y2="52" stroke="rgba(255,255,255,.2)" stroke-width="1.4"/><line x1="120" y1="18" x2="120" y2="86" stroke="rgba(255,255,255,.12)" stroke-width="1.2"/><polygon points="120,30 130,42 120,54 110,42" fill="rgba(255,255,255,.28)" stroke="rgba(255,255,255,.5)" stroke-width="1.2"/><polygon points="120,34 127,42 120,50 113,42" fill="${gradTo||stroke}" opacity=".55"/><circle cx="50" cy="11" r="3.5" fill="rgba(255,255,255,.4)"/><circle cx="120" cy="10" r="4" fill="rgba(255,255,255,.5)"/><circle cx="190" cy="11" r="3.5" fill="rgba(255,255,255,.4)"/></svg>`;
      case 'hexagon':
        return `<svg class="ts-frame-svg" viewBox="0 0 220 70" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".95"/><stop offset="1" stop-color="${gradTo||stroke}" stop-opacity=".45"/></linearGradient></defs><polygon points="30,20 190,20 210,36 190,54 30,54 10,36" fill="url(#${gId})" stroke="${stroke}" stroke-width="3"/><path d="M40 28 L80 28" stroke="rgba(255,255,255,.3)" stroke-width="4"/></svg>`;
      case 'diamond':
        return `<svg class="ts-frame-svg" viewBox="0 0 220 70" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".95"/><stop offset="1" stop-color="${gradTo||stroke}" stop-opacity=".45"/></linearGradient></defs><polygon points="110,10 200,36 110,60 20,36" fill="url(#${gId})" stroke="${stroke}" stroke-width="3"/><path d="M110,14 L110,56" stroke="rgba(255,255,255,.2)" stroke-width="3"/></svg>`;
      case 'dragon':
        return `<svg class="ts-frame-svg" viewBox="0 0 240 88" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".95"/><stop offset=".5" stop-color="${gradTo||stroke}" stop-opacity=".75"/><stop offset="1" stop-color="${stroke}" stop-opacity=".55"/></linearGradient><filter id="f${gId}"><feGaussianBlur stdDeviation="2.2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path filter="url(#f${gId})" d="M14 70 L14 50 C14 44 18 38 24 34 L24 22 L30 14 L36 24 C42 18 50 14 60 16 L68 4 L74 18 C82 12 92 10 104 12 L110 2 L116 12 C128 8 140 10 152 14 L158 4 L164 18 C174 14 184 16 192 22 L198 10 L204 22 C212 26 220 32 222 40 L222 52 C222 62 218 68 212 70 L196 76 C186 80 176 72 166 76 L154 82 C144 78 134 74 120 78 L110 82 L100 78 C86 74 76 80 66 76 L50 70 C38 66 26 70 14 70 Z" fill="url(#${gId})" stroke="${stroke}" stroke-width="2.2"/><polygon points="120,30 126,38 120,46 114,38" fill="rgba(255,255,255,.28)" stroke="rgba(255,255,255,.4)" stroke-width="1.2"/></svg>`;
      case 'scale':
        return `<svg class="ts-frame-svg" viewBox="0 0 220 76" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".95"/><stop offset="1" stop-color="${gradTo||stroke}" stop-opacity=".38"/></linearGradient><filter id="f-${gId}"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path d="M14 54 L26 18 Q36 6 50 12 L64 6 Q76 22 92 10 L108 6 Q122 20 138 10 L154 6 Q168 22 184 14 L196 34 Q200 48 188 62 L170 70 Q154 56 142 72 L128 60 Q112 74 96 58 L82 72 Q66 56 54 70 L38 56 Q26 70 14 54 Z" fill="url(#${gId})" stroke="${stroke}" stroke-width="2" filter="url(#f-${gId})"/></svg>`;
      case 'flame':
        return `<svg class="ts-frame-svg ts-flame-anim-svg" viewBox="0 0 240 88" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#c81200"/><stop offset=".22" stop-color="#ff4500"/><stop offset=".5" stop-color="#ff8c00" stop-opacity=".95"/><stop offset=".78" stop-color="#ffda00" stop-opacity=".85"/><stop offset="1" stop-color="#fff8b0" stop-opacity=".55"/></linearGradient><filter id="fsharp${gId}"><feGaussianBlur stdDeviation="1.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path class="fl-outer" filter="url(#fsharp${gId})" d="M4 88 C4 88 4 72 6 62 C8 52 10 44 12 36 C14 28 14 14 20 20 C22 8 28 0 32 10 C36 2 42 0 46 8 C50 0 56 2 60 12 C64 2 70 0 74 8 C78 0 82 4 86 14 C90 4 96 0 100 10 C104 2 108 0 112 8 C114 2 118 0 120 6 C122 0 126 2 128 8 C132 0 136 0 140 10 C144 2 148 0 152 8 C156 0 160 4 164 14 C168 4 174 0 178 8 C182 2 186 0 190 10 C194 2 200 2 202 14 C206 6 210 8 214 22 C218 32 226 50 228 64 C230 74 236 88 236 88 Z" fill="url(#${gId})"/></svg>`;
      case 'crystal':
        return `<svg class="ts-frame-svg" viewBox="0 0 240 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".9"/><stop offset=".35" stop-color="rgba(255,255,255,.55)"/><stop offset=".7" stop-color="${stroke}" stop-opacity=".6"/><stop offset="1" stop-color="${gradTo||stroke}" stop-opacity=".45"/></linearGradient><filter id="f${gId}"><feGaussianBlur stdDeviation="1.8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path d="M16 60 L8 36 L20 12 L36 4 L56 16 L80 6 L100 18 L120 4 L140 18 L160 6 L184 16 L204 4 L220 12 L232 36 L224 60 L204 72 L160 76 L120 78 L80 76 L36 72 Z" fill="url(#${gId})" stroke="${stroke}" stroke-width="2" filter="url(#f${gId})"/><path d="M100 18 L120 30 L140 18 L120 4 Z" fill="rgba(255,255,255,.4)" stroke="rgba(255,255,255,.6)" stroke-width=".8"/><circle cx="36" cy="4" r="2.5" fill="rgba(255,255,255,.9)"/><circle cx="120" cy="4" r="3" fill="rgba(255,255,255,.95)"/><circle cx="204" cy="4" r="2.5" fill="rgba(255,255,255,.9)"/></svg>`;
      case 'ghost':
        return `<svg class="ts-frame-svg" viewBox="0 0 200 64" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="rgba(255,255,255,.14)"/><stop offset="1" stop-color="rgba(255,255,255,.02)"/></linearGradient><filter id="f-${gId}"><feGaussianBlur stdDeviation="5" result="blur"/></filter></defs><path d="M0 42 Q10 20 24 24 Q36 12 52 22 Q64 10 78 18 Q92 6 106 18 Q122 8 134 20 Q148 12 162 26 Q176 18 188 30 Q196 38 200 46 L200 62 L0 62 Z" fill="url(#${gId})" stroke="${stroke}" stroke-width="1" opacity=".92" filter="url(#f-${gId})"/></svg>`;
      case 'poison':
        return `<svg class="ts-frame-svg ts-poison-anim-svg" viewBox="0 0 240 88" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0d4a1e"/><stop offset=".3" stop-color="#166534"/><stop offset=".6" stop-color="#15803d"/><stop offset="1" stop-color="#065f46"/></linearGradient><filter id="fsoft${gId}"><feGaussianBlur stdDeviation="1.8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path filter="url(#fsoft${gId})" d="M12 66 L12 46 C12 36 14 28 20 22 C17 14 20 8 26 10 C30 6 36 8 38 14 C42 6 50 6 54 14 C58 6 66 8 70 16 C74 6 84 6 88 16 C92 6 100 8 104 16 C108 6 118 6 122 14 C126 8 132 8 136 16 C140 6 150 8 154 16 C158 6 168 6 172 14 C176 8 182 8 186 16 C190 8 198 10 200 20 C206 26 210 36 212 48 L212 64 L196 74 C182 80 166 70 152 76 L138 82 L122 74 C108 82 96 76 84 72 L70 78 L56 70 C44 78 30 72 18 66 Z" fill="url(#${gId})" stroke="#22c55e" stroke-width="1.8"/></svg>`;
      case 'shadow':
        return `<svg class="ts-frame-svg" viewBox="0 0 220 70" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="#111827"/><stop offset="1" stop-color="#1e293b"/></linearGradient><radialGradient id="s-${gId}" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="rgba(255,255,255,.1)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/></radialGradient></defs><path d="M10 20 C30 10 50 12 74 16 C96 20 114 12 134 18 C154 24 172 14 190 20 C206 24 214 34 216 48 L216 66 L4 66 L4 48 C6 34 14 28 30 22 Z" fill="url(#${gId})" stroke="rgba(255,255,255,.08)" stroke-width="1.4"/><ellipse cx="110" cy="40" rx="80" ry="28" fill="url(#s-${gId})" opacity=".32"/></svg>`;
      case 'royal':
        return `<svg class="ts-frame-svg" viewBox="0 0 220 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="#ffeb9d"/><stop offset=".45" stop-color="#fbd155"/><stop offset="1" stop-color="#b5810d"/></linearGradient><radialGradient id="r-${gId}" cx="50%" cy="22%" r="22%"><stop offset="0" stop-color="rgba(255,255,255,.95)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/></radialGradient></defs><rect x="10" y="18" width="200" height="44" rx="22" fill="url(#${gId})" stroke="${stroke}" stroke-width="2.5"/><rect x="28" y="24" width="164" height="32" rx="16" fill="rgba(255,255,255,.06)"/><circle cx="110" cy="40" r="12" fill="url(#r-${gId})" opacity=".92"/><path d="M110 30 L118 38 L110 46 L102 38 Z" fill="rgba(255,255,255,.4)"/></svg>`;
      case 'arcane':
        return `<svg class="ts-frame-svg ts-arcane-glass" viewBox="0 0 220 70" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f472b6" stop-opacity=".9"/><stop offset="50%" stop-color="#d946ef" stop-opacity=".88"/><stop offset="100%" stop-color="#a855f7" stop-opacity=".85"/></linearGradient><filter id="arcane-blur-${gId}"><feGaussianBlur stdDeviation="6"/></filter></defs><rect x="8" y="12" width="204" height="46" rx="23" fill="url(#${gId})" filter="url(#arcane-blur-${gId})" opacity=".88"/><rect x="8" y="12" width="204" height="46" rx="23" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2.5"/><rect x="20" y="20" width="180" height="30" rx="15" fill="rgba(255,255,255,.12)" opacity=".6"/><path d="M110 20 L118 35 L110 50 L102 35 Z" fill="rgba(255,255,255,.3)"/></svg>`;
      case 'celestial':
        return `<svg class="ts-frame-svg" viewBox="0 0 220 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gId}" x1="0" x2="1"><stop offset="0" stop-color="#f7fbff" stop-opacity=".95"/><stop offset="1" stop-color="${gradTo}" stop-opacity=".4"/></linearGradient></defs><rect x="10" y="18" width="200" height="44" rx="22" fill="url(#${gId})" stroke="${stroke}" stroke-width="2"/><path d="M100 12 L110 28 L126 34 L112 46 L116 62 L100 54 L84 62 L88 46 L74 34 L90 28 Z" fill="rgba(255,255,255,.26)"/><circle cx="38" cy="18" r="4.5" fill="rgba(255,255,255,.3)"/><circle cx="182" cy="18" r="4.5" fill="rgba(255,255,255,.3)"/><ellipse cx="110" cy="40" rx="76" ry="30" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="1.6"/></svg>`;
      default:
        return `<!-- no svg -->`;
    }
  }

  // ── Particles ──────────────────────────────────────────────────────────────
  const pColors = { embers:'#f97316', smoke:'#9ca3af', mist:'#e0f2fe', stars:'#fde68a', bubbles:'#93c5fd', lightning:'#fbbf24', leaves:'#4ade80', snow:'#e2e8f0', sparkles:'#f0abfc' };
  let particlesHTML = '';
  if (title.particles && title.particles !== 'none' && !opts.noParticles) {
    const pc  = pColors[title.particles] || '#ffffff';
    const cnt = Math.max(2, Math.round((opts.small ? 3 : 5) * (1 + (rCfg.glowMul || 0) * 2)));
    let ph = '';
    for (let i = 0; i < cnt; i++) {
      const sz  = (2 + Math.random() * (2 + (rCfg.glowMul || 0) * 3)).toFixed(1);
      const lft = 8 + Math.random() * 84;
      const dur = (0.9 + Math.random() * (1.4 - (rCfg.glowMul || 0))).toFixed(2);
      const dly = Math.random() * 1.6;
      const dx  = (-10 + Math.random() * 20).toFixed(1);
      ph += `<span class="ts-particle" style="width:${sz}px;height:${sz}px;background:${pc};left:${lft}%;bottom:0;--ts-part-dur:${dur}s;--ts-part-delay:${dly}s;--ts-part-dx:${dx}px;box-shadow:0 0 6px ${pc}88;"></span>`;
    }
    particlesHTML = `<span class="ts-particle-host">${ph}</span>`;
  }

  // ── FX layer ───────────────────────────────────────────────────────────────
  let fxLayerHTML = '';
  if (title.effect && title.effect !== 'none') {
    const eff = title.effect;
    let fxInner = '';
    if (eff === 'embers') {
      const cnt = opts.small ? 4 : 7;
      for (let i = 0; i < cnt; i++) { const sz = (1.5 + Math.random() * 2.5).toFixed(1); const lft = (8 + Math.random() * 84).toFixed(0); const dur = (1.0 + Math.random() * 1.4).toFixed(2); const dly = (Math.random() * 2).toFixed(2); const dx = (-12 + Math.random() * 24).toFixed(1); fxInner += `<span class="ts-fx-ember" style="width:${sz}px;height:${sz}px;left:${lft}%;--edur:${dur}s;--edly:${dly}s;--edx:${dx}px;background:${glow};"></span>`; }
    } else if (eff === 'runes') {
      const chars = ['ᚦ','ᚨ','ᚱ','ᚲ','ᛉ','ᛊ','ᛏ','ᛒ','ᛖ','ᛗ','ᛚ','ᛜ'];
      fxInner = chars.slice(0, opts.small ? 4 : 6).join(' ');
    } else if (eff === 'lightning') {
      const positions = [10, 26, 42, 58, 74, 90];
      ['⚡','⚡','⚡','⚡','⚡'].forEach((b, i) => { const dur = (0.7 + Math.random() * 0.6).toFixed(2); const dly = (Math.random() * 1.5).toFixed(2); fxInner += `<span class="ts-fx-bolt" style="left:${positions[i]||20}%;--bdur:${dur}s;--bdly:${dly}s">${b}</span>`; });
    } else if (eff === 'stars') {
      [{x:5,y:50,sz:10,dur:4.0,dly:0},{x:88,y:50,sz:9,dur:3.5,dly:.8},{x:30,y:10,sz:8,dur:5.0,dly:1.4},{x:68,y:15,sz:9,dur:4.2,dly:.3},{x:15,y:80,sz:7,dur:3.8,dly:2.1},{x:82,y:75,sz:8,dur:4.6,dly:1.0}].forEach(p => { fxInner += `<span class="ts-fx-star" style="left:${p.x}%;top:${p.y}%;--sdur:${p.dur}s;--sdly:${p.dly}s;--ssz:${p.sz}px;--sox:${p.x}%;--soy:${p.y}%">★</span>`; });
    } else if (eff === 'drips') {
      [12, 28, 45, 60, 76, 90].forEach(lft => { const dur = (1.6 + Math.random() * 1.4).toFixed(2); const dly = (Math.random() * 2).toFixed(2); fxInner += `<span class="ts-fx-drip" style="left:${lft}%;--ddur:${dur}s;--ddly:${dly}s;"></span>`; });
    }
    fxLayerHTML = `<span class="ts-fx-layer" aria-hidden="true">${fxInner}</span>`;
  }

  // ── Rarity overlays ────────────────────────────────────────────────────────
  const _lid = 'lg-' + (Math.random() + '').slice(2, 9);
  const _mid = 'mb-' + (Math.random() + '').slice(2, 9);
  let rarityOverlayInner = '';
  if ((title.rarity || '').toLowerCase() === 'legendary')
    rarityOverlayInner = `<svg class="ts-legendary-glint" viewBox="0 0 100 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${_lid}" x1="0" x2="1"><stop offset="0" stop-color="rgba(255,255,255,0)"/><stop offset=".42" stop-color="rgba(255,255,255,0.72)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/></linearGradient></defs><rect x="0" y="0" width="100" height="100" fill="url(#${_lid})"/></svg>`;
  else if ((title.rarity || '').toLowerCase() === 'mythic')
    rarityOverlayInner = `<svg class="ts-mythic-burst" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="${_mid}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="rgba(255,220,255,0.95)"/><stop offset=".5" stop-color="rgba(255,120,200,0.35)"/><stop offset="1" stop-color="rgba(255,120,200,0)"/></radialGradient></defs><circle cx="50" cy="50" r="50" fill="url(#${_mid})"/></svg>`;

  const rarityOverlay = rarityOverlayInner ? `<span class="ts-rarity-overlay-host">${rarityOverlayInner}</span>` : '';

  return `<span class="${wrapperClasses}" style="${wrapperInlineStyle}" title="${title.name || ''} (${title.rarity || ''})">` +
    buildFrameSVG(frameShape) + rarityOverlay + particlesHTML + fxLayerHTML +
    `<span class="ts-badge ts-badge-text" style="${innerInlineStyle}">${_esc(title.name || 'Title')}</span>` +
    `</span>`;
};

console.log('[EduQuest] titles/badge-renderer.js loaded — tsBuildBadgeHTML registered. Leaderboard typeof guard now resolved.');
