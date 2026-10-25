// Phase 7, Stream B — bridge for modules/admin/teacher-invite.js.
// Importing this module runs the same load-time side effects the original
// classic script did (the ?teacher_invite=<token> entry-point IIFE, and
// the module's own `window.teacherInviteCheckValidation = ...` line) —
// this bridge's job is only to re-attach the 3 real onclick-handler
// exports that the original set via `window.X =`.
import {
  showTeacherInviteScreen, doCompleteTeacherSignup, hideTeacherInviteScreen,
} from '../../src/modules/admin/teacher-invite.js';

window.showTeacherInviteScreen = showTeacherInviteScreen;
window.doCompleteTeacherSignup = doCompleteTeacherSignup;
window.hideTeacherInviteScreen = hideTeacherInviteScreen;
