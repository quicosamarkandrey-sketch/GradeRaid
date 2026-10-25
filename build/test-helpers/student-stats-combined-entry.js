// Test-only combined entry for verify-student-stats-bridge.js. See
// table-sync-combined-entry.js for why this is needed.
import { AppStore } from '../../src/modules/core/state-manager.js';
import { DBService } from '../../src/db-service.js';
import {
  TIER_THRESHOLDS, recalcStudentStats, getStudentAttendanceRecords, computeAttendanceStreak,
  syncStudentStatsToServer, syncOwnProfileCosmeticToServer, syncStudentDerivedStatsToServer,
  syncAchievementUnlockToServer, syncAchievementClaimToServer, syncAchievementRevokeToServer,
  syncTitleUnlockToServer, syncTitleRevokeToServer, syncEquippedTitleToServer,
} from '../../src/student-stats.js';

window.AppStore = AppStore;
window.DBService = DBService;
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
