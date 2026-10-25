// Phase 7 (Stream D) — bridge for modules/achievements/ach_student_page.js.
// Re-attaches both real exports to window. perceived-speed.js / titles_student_page.js wrap
// window.renderBadges AFTER this runs, exactly as they wrap the classic function today.
import {
  renderBadges,
  achClaimReward,
} from '../../src/modules/achievements/ach_student_page.js';

window.renderBadges = renderBadges;
window.achClaimReward = achClaimReward;
