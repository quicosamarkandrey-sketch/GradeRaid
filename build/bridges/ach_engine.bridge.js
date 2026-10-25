// Phase 7 (Stream D) — bridge for modules/achievements/ach_engine.js.
// Re-attaches all 11 real exports to window (the 9 that were explicit
// window.X = ... assignments in the classic script, plus the 2 top-level
// function declarations achEvaluateTrigger/_achCheckAndAwardCore, which are
// real window properties in a classic script too).
import {
  ACH_RARITY,
  ACH_RARITIES,
  ACH_TRIGGER_TYPES,
  achRarityClass,
  achBuildStats,
  achEvaluateTrigger,
  achCheckAndAward,
  _achCheckAndAwardCore,
  achGrantRewardsForClaim,
  achUpdateSidebarBadge,
  achShowUnlockPopup,
} from '../../src/modules/achievements/ach_engine.js';

window.ACH_RARITY = ACH_RARITY;
window.ACH_RARITIES = ACH_RARITIES;
window.ACH_TRIGGER_TYPES = ACH_TRIGGER_TYPES;
window.achRarityClass = achRarityClass;
window.achBuildStats = achBuildStats;
window.achEvaluateTrigger = achEvaluateTrigger;
window.achCheckAndAward = achCheckAndAward;
window._achCheckAndAwardCore = _achCheckAndAwardCore;
window.achGrantRewardsForClaim = achGrantRewardsForClaim;
window.achUpdateSidebarBadge = achUpdateSidebarBadge;
window.achShowUnlockPopup = achShowUnlockPopup;
