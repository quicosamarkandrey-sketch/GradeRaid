// Phase 7 (Stream D) — bridge for modules/titles/titles_designer.js.
// Re-attaches all 20 real exports to window (_TS3_RARITY_COLORS was a global const, not a window prop: new one-time snapshot).
import {
  TS_TEMPLATE_CATS,
  _TS3_RARITY_COLORS,
  tsAdminOpenDesigner,
  ts3UpdateDraftSections,
  ts3Tab,
  ts3FilterGallery,
  ts3ApplyTemplate,
  ts3RefreshAllPickers,
  ts3PickShape,
  ts3PickStyle,
  ts3PickEffect,
  ts3PickAnim,
  ts3SetColor,
  ts3SetRarity,
  ts3Preview,
  tsLivePreview,
  tsUpdateRarityInfo,
  tsApplyRarityDefaults,
  tsPreset,
  tsAdminSave,
} from '../../src/modules/titles/titles_designer.js';

window.TS_TEMPLATE_CATS = TS_TEMPLATE_CATS;
window._TS3_RARITY_COLORS = _TS3_RARITY_COLORS;
window.tsAdminOpenDesigner = tsAdminOpenDesigner;
window.ts3UpdateDraftSections = ts3UpdateDraftSections;
window.ts3Tab = ts3Tab;
window.ts3FilterGallery = ts3FilterGallery;
window.ts3ApplyTemplate = ts3ApplyTemplate;
window.ts3RefreshAllPickers = ts3RefreshAllPickers;
window.ts3PickShape = ts3PickShape;
window.ts3PickStyle = ts3PickStyle;
window.ts3PickEffect = ts3PickEffect;
window.ts3PickAnim = ts3PickAnim;
window.ts3SetColor = ts3SetColor;
window.ts3SetRarity = ts3SetRarity;
window.ts3Preview = ts3Preview;
window.tsLivePreview = tsLivePreview;
window.tsUpdateRarityInfo = tsUpdateRarityInfo;
window.tsApplyRarityDefaults = tsApplyRarityDefaults;
window.tsPreset = tsPreset;
window.tsAdminSave = tsAdminSave;
