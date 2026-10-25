// Phase 7 (Stream A) — bridge for student-stats.js.
import {
  TIER_THRESHOLDS, recalcStudentStats, getStudentAttendanceRecords, computeAttendanceStreak,
  syncStudentStatsToServer, syncOwnProfileCosmeticToServer, syncStudentDerivedStatsToServer,
  syncAchievementUnlockToServer, syncAchievementClaimToServer, syncAchievementRevokeToServer,
  syncTitleUnlockToServer, syncTitleRevokeToServer, syncEquippedTitleToServer,
} from '../../src/student-stats.js';

window.TIER_THRESHOLDS = TIER_THRESHOLDS;
window.recalcStudentStats = recalcStudentStats;
window.getStudentAttendanceRecords = getStudentAttendanceRecords;
window.computeAttendanceStreak = computeAttendanceStreak;
window.syncStudentStatsToServer = syncStudentStatsToServer;
window.syncOwnProfileCosmeticToServer = syncOwnProfileCosmeticToServer;
window.syncStudentDerivedStatsToServer = syncStudentDerivedStatsToServer;
window.syncAchievementUnlockToServer = syncAchievementUnlockToServer;
window.syncAchievementClaimToServer = syncAchievementClaimToServer;
window.syncAchievementRevokeToServer = syncAchievementRevokeToServer;
window.syncTitleUnlockToServer = syncTitleUnlockToServer;
window.syncTitleRevokeToServer = syncTitleRevokeToServer;
window.syncEquippedTitleToServer = syncEquippedTitleToServer;
