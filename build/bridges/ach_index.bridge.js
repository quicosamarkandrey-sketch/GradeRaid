// Phase 7 (Stream D) — bridge for modules/achievements/ach_index.js.
// Re-attaches MODULE_VERSION under its original window name (see the src
// file's header). achClaimRewardFallback needs no attachment of its own —
// the src file already conditionally assigns it to window.achClaimReward
// itself, as a plain runtime statement; the bridge only needs the
// module's side effects to run, which importing it for its value achieves.
import { MODULE_VERSION, achClaimRewardFallback } from '../../src/modules/achievements/ach_index.js';

window.__ACHIEVEMENTS_MODULE_VERSION__ = MODULE_VERSION;
void achClaimRewardFallback; // referenced only to avoid an unused-import lint concern; no attachment needed
