// Phase 7 (Stream A) — bridge for repository/pull-mappers.js.
import {
  _legacyRoleFromDbRole, _HISTORY_LIMITS, _deriveStudents, _deriveAdmin,
  _deriveEquippedTitles, _deriveBossEvents, _deriveBossParticipants,
  _deriveAchievements, _deriveAchievementUnlocks, _deriveTitles,
  _deriveTitleUnlocks, _deriveTitleSectionAssignments, _deriveQuizzes,
  _deriveCampaignWorlds, _deriveCampaignSectionAssignments, _deriveMail,
  _deriveQuizSectionAssignments, _deriveAchievementSectionAssignments,
  _deriveInventory, _deriveQuizHistory, _deriveStudentSkills,
  _derivePointLog, _deriveRedemptions, _deriveOrders, _deriveNotifications,
  _deriveRecitationLog, _deriveRecitationSessions, _deriveRfidCards,
  _deriveAttendanceSchedules, _deriveAttendanceLogs, _deriveStore,
  _deriveRegistrations,
} from '../../src/pull-mappers.js';

window._legacyRoleFromDbRole = _legacyRoleFromDbRole;
window._HISTORY_LIMITS = _HISTORY_LIMITS;
window._deriveStudents = _deriveStudents;
window._deriveAdmin = _deriveAdmin;
window._deriveEquippedTitles = _deriveEquippedTitles;
window._deriveBossEvents = _deriveBossEvents;
window._deriveBossParticipants = _deriveBossParticipants;
window._deriveAchievements = _deriveAchievements;
window._deriveAchievementUnlocks = _deriveAchievementUnlocks;
window._deriveTitles = _deriveTitles;
window._deriveTitleUnlocks = _deriveTitleUnlocks;
window._deriveTitleSectionAssignments = _deriveTitleSectionAssignments;
window._deriveQuizzes = _deriveQuizzes;
window._deriveCampaignWorlds = _deriveCampaignWorlds;
window._deriveCampaignSectionAssignments = _deriveCampaignSectionAssignments;
window._deriveMail = _deriveMail;
window._deriveQuizSectionAssignments = _deriveQuizSectionAssignments;
window._deriveAchievementSectionAssignments = _deriveAchievementSectionAssignments;
window._deriveInventory = _deriveInventory;
window._deriveQuizHistory = _deriveQuizHistory;
window._deriveStudentSkills = _deriveStudentSkills;
window._derivePointLog = _derivePointLog;
window._deriveRedemptions = _deriveRedemptions;
window._deriveOrders = _deriveOrders;
window._deriveNotifications = _deriveNotifications;
window._deriveRecitationLog = _deriveRecitationLog;
window._deriveRecitationSessions = _deriveRecitationSessions;
window._deriveRfidCards = _deriveRfidCards;
window._deriveAttendanceSchedules = _deriveAttendanceSchedules;
window._deriveAttendanceLogs = _deriveAttendanceLogs;
window._deriveStore = _deriveStore;
window._deriveRegistrations = _deriveRegistrations;
