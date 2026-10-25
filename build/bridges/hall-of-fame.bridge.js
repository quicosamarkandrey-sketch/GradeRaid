// Phase 7 (Stream D) — bridge for modules/leaderboard/hall-of-fame.js.
// Re-attaches the 4 real exports (holGoToPage, holPrevPage, holNextPage, renderLeaderboard) to window.
import {
  holGoToPage,
  holPrevPage,
  holNextPage,
  renderLeaderboard,
} from '../../src/modules/leaderboard/hall-of-fame.js';

window.holGoToPage = holGoToPage;
window.holPrevPage = holPrevPage;
window.holNextPage = holNextPage;
window.renderLeaderboard = renderLeaderboard;
