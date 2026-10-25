// Phase 7 (Stream A) — bridge for modules/mail/mail-engine.js.
import {
  mailGetForStudent,
  mailIsRead,
  mailIsClaimed,
  mailMarkRead,
  mailClaimRewards,
  mailUpdateSidebarBadge,
  mailUnreadCount,
  mailUnclaimedRewardCount,
} from '../../src/modules/mail/mail-engine.js';

window.mailGetForStudent = mailGetForStudent;
window.mailIsRead = mailIsRead;
window.mailIsClaimed = mailIsClaimed;
window.mailMarkRead = mailMarkRead;
window.mailClaimRewards = mailClaimRewards;
window.mailUpdateSidebarBadge = mailUpdateSidebarBadge;
window.mailUnreadCount = mailUnreadCount;
window.mailUnclaimedRewardCount = mailUnclaimedRewardCount;
