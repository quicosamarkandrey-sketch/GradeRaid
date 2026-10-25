// Phase 7, Stream B — bridge for modules/admin/registrations.js.
// Importing this module also runs its own load-time side effects, kept
// verbatim in src/: the AppStore.subscribe('registrations-analytics-block',
// ...) registration, and the trailing `window.regX = regX;` explicit
// exports for the 5 functions other files in this app depend on as bare
// globals (regPasswordToggleBtn, regValidatePassword, regValidateName,
// regPickColor, regMakeInitials — consumed by teacher-invite.js and
// enrollment-hub.js). This bridge only needs to re-attach the remaining
// real onclick/entry-point exports.
import {
  regTogglePasswordVisibility, showRegScreen, hideRegScreen, regCheckField,
  regOnGradeChange, regCheckPasswordMatch, regCheckValidation, doRegister,
  showRegStatusScreen, regCheckStatusSubmit, renderAdminRegistrations, regSetFilter,
  _regRenderList, regGoToPage, regPrevPage, regNextPage, regAdminViewDetails,
  regAdminApprove, regAdminRejectModal, regAdminConfirmReject, regAdminReassignModal,
  regAdminConfirmReassign,
} from '../../src/modules/admin/registrations.js';

window.regTogglePasswordVisibility = regTogglePasswordVisibility;
window.showRegScreen = showRegScreen;
window.hideRegScreen = hideRegScreen;
window.regCheckField = regCheckField;
window.regOnGradeChange = regOnGradeChange;
window.regCheckPasswordMatch = regCheckPasswordMatch;
window.regCheckValidation = regCheckValidation;
window.doRegister = doRegister;
window.showRegStatusScreen = showRegStatusScreen;
window.regCheckStatusSubmit = regCheckStatusSubmit;
window.renderAdminRegistrations = renderAdminRegistrations;
window.regSetFilter = regSetFilter;
window._regRenderList = _regRenderList;
window.regGoToPage = regGoToPage;
window.regPrevPage = regPrevPage;
window.regNextPage = regNextPage;
window.regAdminViewDetails = regAdminViewDetails;
window.regAdminApprove = regAdminApprove;
window.regAdminRejectModal = regAdminRejectModal;
window.regAdminConfirmReject = regAdminConfirmReject;
window.regAdminReassignModal = regAdminReassignModal;
window.regAdminConfirmReassign = regAdminConfirmReassign;
