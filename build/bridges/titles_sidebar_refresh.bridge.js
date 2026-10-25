// Phase 7 (Stream D) — bridge for modules/titles/titles_sidebar_refresh.js.
// Re-attaches the 10 real exports to window. (The 4 AppStore.subscribe registrations and the dead _holGetTitle patch run in the module body.)
import {
  tsGetEquippedTitle,
  tsGetUnlockedTitles,
  tsIsUnlocked,
  tsEquipTitle,
  tsUnlockTitleForStudent,
  tsShowTitleUnlockPopup,
  tsRefreshSidebarTitle,
  tsRefreshProfileTitle,
  tsRefreshProfileOverlay,
  tsOpenTitlesFromProfile,
} from '../../src/modules/titles/titles_sidebar_refresh.js';

window.tsGetEquippedTitle = tsGetEquippedTitle;
window.tsGetUnlockedTitles = tsGetUnlockedTitles;
window.tsIsUnlocked = tsIsUnlocked;
window.tsEquipTitle = tsEquipTitle;
window.tsUnlockTitleForStudent = tsUnlockTitleForStudent;
window.tsShowTitleUnlockPopup = tsShowTitleUnlockPopup;
window.tsRefreshSidebarTitle = tsRefreshSidebarTitle;
window.tsRefreshProfileTitle = tsRefreshProfileTitle;
window.tsRefreshProfileOverlay = tsRefreshProfileOverlay;
window.tsOpenTitlesFromProfile = tsOpenTitlesFromProfile;
