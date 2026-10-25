// ══════════════════════════════════════════════════════
//  src/admin-index.js
//  Admin module loader & export verification (real-ESM twin)
//  Phase 3 Day 18-19
//
//  Phase 7 (2026-08-10, session 17) — step 5.3, fifteenth real conversion.
//  Real-ESM twin of the original ../modules/admin/index.js, which stays
//  completely untouched. Fourth aggregator-sink conversion, largest
//  verification list so far (60 expected functions vs. leaderboard's 12).
//  All 3 declared symbols exported for consistency, even though
//  ADMIN_EXPECTED/adminMissing are checked to have zero cross-file
//  consumers (confirmed via grep, not assumed) — same discipline as
//  leaderboard-index.js's unused-but-still-exported Leaderboard alias.
// ══════════════════════════════════════════════════════

export const ADMIN_EXPECTED = [
  'renderAdminDashboard', 'openAwardPoints', 'doAwardPoints',
  'renderAnalytics',
  'renderAdminQuizzes', 'openQuizBuilder', 'openEditQuiz',
  'addQuestion', 'removeQuestion', 'setCorrect', 'addOption', 'removeOption',
  'saveQuiz', 'deleteQuiz', 'confirmDeleteQuiz',
  'renderAdminRegistrations', 'regSetFilter', 'regAdminViewDetails',
  'regAdminApprove', 'regAdminRejectModal', 'regAdminConfirmReject',
  'showRegScreen', 'hideRegScreen', 'doRegister',
  'renderNavManager', 'dsmGetStudentNav', 'dsmGetTeacherNav', 'dsmGetAdminNav', 'dsmIsWidgetVisible', 'dsmGetWidgetConfig',
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
  'unmountCommandCenter',
];

export const adminMissing = ADMIN_EXPECTED.filter((fn) => typeof window[fn] !== 'function');
if (adminMissing.length > 0) {
  console.error('[EduQuest] Admin module — missing exports:', adminMissing);
} else {
  console.log('[EduQuest] Admin module loaded ✅ — all', ADMIN_EXPECTED.length, 'exports verified.');
}

export const MODULE_VERSION = '1.0.0';
window.__ADMIN_MODULE_VERSION__ = MODULE_VERSION;
