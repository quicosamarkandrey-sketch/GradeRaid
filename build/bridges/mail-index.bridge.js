// Phase 7 (Stream A) — bridge for modules/mail/index.js.
// Importing this module also runs its own redundant `window.X = X;`
// re-assignments (kept verbatim in src/) — this bridge's re-attachment
// is technically redundant on top of that redundancy, but present
// anyway to match the established per-file checklist shape.
import {
  mailGetForStudent, mailIsRead, mailIsClaimed, mailMarkRead,
  mailClaimRewards, mailUpdateSidebarBadge, mailUnreadCount,
  mailUnclaimedRewardCount,
} from '../../src/modules/mail/index.js';

window.mailGetForStudent = mailGetForStudent;
window.mailIsRead = mailIsRead;
window.mailIsClaimed = mailIsClaimed;
window.mailMarkRead = mailMarkRead;
window.mailClaimRewards = mailClaimRewards;
window.mailUpdateSidebarBadge = mailUpdateSidebarBadge;
window.mailUnreadCount = mailUnreadCount;
window.mailUnclaimedRewardCount = mailUnclaimedRewardCount;
