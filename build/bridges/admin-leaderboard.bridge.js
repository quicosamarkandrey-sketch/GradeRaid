// Phase 7 (Stream D) — bridge for modules/leaderboard/admin-leaderboard.js.
// Re-attaches all 6 real exports to window.
import {
  renderAdminLeaderboards,
  eqlToggle,
  eqlAdminPreview,
  eqlAdminResetConfirm,
  eqlDoReset,
  eqlDoClearReset,
} from '../../src/modules/leaderboard/admin-leaderboard.js';

window.renderAdminLeaderboards = renderAdminLeaderboards;
window.eqlToggle = eqlToggle;
window.eqlAdminPreview = eqlAdminPreview;
window.eqlAdminResetConfirm = eqlAdminResetConfirm;
window.eqlDoReset = eqlDoReset;
window.eqlDoClearReset = eqlDoClearReset;
