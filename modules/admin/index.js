// ══════════════════════════════════════════════════════
//  modules/admin/index.js
//  Admin module loader & export verification
//  Phase 3 Day 18-19
//
//  Load order (in index.html):
//    student-manager.js   → renderAdminDashboard, openAwardPoints, doAwardPoints
//    analytics.js         → renderAnalytics (base)
//    quiz-builder.js      → renderAdminQuizzes, openQuizBuilder, saveQuiz, etc.
//    registrations.js     → renderAdminRegistrations, doRegister, regAdminApprove, etc.
//                           + analytics patch (registration stats block)
//    teacher-directory-service.js → TeacherDirectoryService (promoteToAdmin, demoteToTeacher)
//    teacher-directory.js → renderTeacherDirectory (admin-only, chunk A1 placeholder)
//    content-oversight-service.js → ContentOversightService (Chunk C — pairs
//                           each oversight_upsert_*()/delete_*() RPC with
//                           log_edit_as_action(), see phase41_content_oversight.sql)
//    content-oversight.js → renderContentOversight, openContentOversightFor,
//                           unmountContentOversight (Chunk C)
//    audit-log-service.js → AuditLogService (log_edit_as_action, get_audit_log
//                           wrappers — Chunk E, see
//                           phase40_governance_audit_and_settings.sql)
//    audit-log.js         → renderAuditLog (Chunk E viewer — reads back what
//                           Chunk C's "Edit as" mode has been logging)
//    ownership-service.js → OwnershipService (transferOwnership — Chunk D,
//                           full offboarding, see phase42_ownership_lifecycle.sql)
//    school-settings-service.js → SchoolSettingsService (get/save)
//    school-settings.js   → renderSchoolSettings, saveSchoolSettings (Chunk E)
//    dsm-manager.js       → renderNavManager, dsmGetAdminNav, dsmGetStudentNav
//                           + navTo guard patch
//    index.js             ← this file (load last)
// ══════════════════════════════════════════════════════

// ── LOAD VERIFICATION ──────────────────────────────────
const _ADMIN_EXPECTED = [
  'renderAdminDashboard', 'openAwardPoints', 'doAwardPoints',
  'renderAnalytics',
  'renderAdminQuizzes', 'openQuizBuilder', 'openEditQuiz',
  'addQuestion', 'removeQuestion', 'setCorrect', 'addOption', 'removeOption',
  'saveQuiz', 'deleteQuiz', 'confirmDeleteQuiz',
  'renderAdminRegistrations', 'regSetFilter', 'regAdminViewDetails',
  'regAdminApprove', 'regAdminRejectModal', 'regAdminConfirmReject',
  'showRegScreen', 'hideRegScreen', 'doRegister',
  'renderNavManager', 'dsmGetStudentNav', 'dsmGetAdminNav',
  'dsmSwitchTab', 'dsmToggle', 'dsmSetStatus', 'dsmSetField',
  'dsmExpandRow', 'dsmShowAll', 'dsmHideAll', 'dsmUnlockAll',
  'dsmApplyAndRefresh', 'dsmResetToDefaults',
  'renderSectionMaker', 'unmountSectionMaker',
  'getActiveClassIds', 'getClassLabel',
  'renderTeacherDirectory', 'doPromoteTeacher', 'doDemoteAdmin',
  'doDeactivateAccount', 'doReactivateAccount',
  '_tdOpenTransferModal', '_tdSubmitTransfer',
  'renderStarterPackEditor',
  'renderSchoolSettings', 'saveSchoolSettings',
  'renderContentOversight', 'openContentOversightFor', 'unmountContentOversight',
  'renderAuditLog', 'auditLogSetTeacherFilter', 'auditLogSetActionFilter',
  'auditLogSetTableFilter', 'auditLogLoadMore',
];

const _adminMissing = _ADMIN_EXPECTED.filter(fn => typeof window[fn] !== 'function');
if (_adminMissing.length > 0) {
  console.error('[EduQuest] Admin module — missing exports:', _adminMissing);
} else {
  console.log('[EduQuest] Admin module loaded ✅ — all', _ADMIN_EXPECTED.length, 'exports verified.');
}

window.__ADMIN_MODULE_VERSION__ = '1.0.0';
