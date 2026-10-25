// Phase 7 (Stream D) — bridge for modules/titles/titles_badge_renderer.js.
// Re-attaches all 12 real exports to window, including BOTH aliases
// TS_RARITY and TS_RARITY_ENHANCEMENTS (same object, as in the classic file).
import {
  TS_FRAME_SHAPES_REGISTRY,
  TS_FRAME_STYLES_REGISTRY,
  TS_EFFECTS_REGISTRY,
  TS_ANIMATIONS_REGISTRY,
  TS_RARITY_ENHANCEMENTS,
  TS_RARITY,
  TS_BORDER_STYLES,
  tsDefaultTitle,
  tsGetFrameShape,
  tsGetFrameStyle,
  TS_MMORPG_TEMPLATES,
  tsBuildBadgeHTML,
} from '../../src/modules/titles/titles_badge_renderer.js';

window.TS_FRAME_SHAPES_REGISTRY = TS_FRAME_SHAPES_REGISTRY;
window.TS_FRAME_STYLES_REGISTRY = TS_FRAME_STYLES_REGISTRY;
window.TS_EFFECTS_REGISTRY = TS_EFFECTS_REGISTRY;
window.TS_ANIMATIONS_REGISTRY = TS_ANIMATIONS_REGISTRY;
window.TS_RARITY_ENHANCEMENTS = TS_RARITY_ENHANCEMENTS;
window.TS_RARITY = TS_RARITY;
window.TS_BORDER_STYLES = TS_BORDER_STYLES;
window.tsDefaultTitle = tsDefaultTitle;
window.tsGetFrameShape = tsGetFrameShape;
window.tsGetFrameStyle = tsGetFrameStyle;
window.TS_MMORPG_TEMPLATES = TS_MMORPG_TEMPLATES;
window.tsBuildBadgeHTML = tsBuildBadgeHTML;
