// Phase 7 (Stream A) — bridge for modules/mail/admin-compose.js.
import {
  MAIL_TYPES,
  renderAdminMail,
  mailAdminOpenCompose,
  mailAdminSend,
  mailAdminDelete,
  mailAdminConfirmDelete,
  mailAdminToChange,
  mailAdminToggleRewards,
} from '../../src/modules/mail/admin-compose.js';

window.MAIL_TYPES = MAIL_TYPES;
window.renderAdminMail = renderAdminMail;
window.mailAdminOpenCompose = mailAdminOpenCompose;
window.mailAdminSend = mailAdminSend;
window.mailAdminDelete = mailAdminDelete;
window.mailAdminConfirmDelete = mailAdminConfirmDelete;
window.mailAdminToChange = mailAdminToChange;
window.mailAdminToggleRewards = mailAdminToggleRewards;
