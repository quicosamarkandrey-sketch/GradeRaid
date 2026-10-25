// Phase 7, Stream B — bridge for modules/admin/teacher-directory.js.
import {
  tdSetSearch, tdGoToPage, tdPrevPage, tdNextPage, renderTeacherDirectory,
  doGenerateTeacherInvite, doCopyTeacherInviteLink, doRevokeTeacherInvite,
  doPromoteTeacher, doDemoteAdmin, doDeactivateAccount, doReactivateAccount,
  doSendPasswordReset, _tdOpenTransferModal, _tdSubmitTransfer,
} from '../../src/modules/admin/teacher-directory.js';

window.tdSetSearch = tdSetSearch;
window.tdGoToPage = tdGoToPage;
window.tdPrevPage = tdPrevPage;
window.tdNextPage = tdNextPage;
window.renderTeacherDirectory = renderTeacherDirectory;
window.doGenerateTeacherInvite = doGenerateTeacherInvite;
window.doCopyTeacherInviteLink = doCopyTeacherInviteLink;
window.doRevokeTeacherInvite = doRevokeTeacherInvite;
window.doPromoteTeacher = doPromoteTeacher;
window.doDemoteAdmin = doDemoteAdmin;
window.doDeactivateAccount = doDeactivateAccount;
window.doReactivateAccount = doReactivateAccount;
window.doSendPasswordReset = doSendPasswordReset;
window._tdOpenTransferModal = _tdOpenTransferModal;
window._tdSubmitTransfer = _tdSubmitTransfer;
