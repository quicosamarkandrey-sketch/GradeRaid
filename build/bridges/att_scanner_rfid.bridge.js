// Phase 7 (Stream A) — bridge for modules/attendance/att_scanner_rfid.js.
import {
  _rfidFocusInterval,
  _rfidScanBuffer,
  _rfidInactivityTimer,
  _rfidScannerMounted,
  _rfidScanMode,
  _rfidAssignTargetStudentId,
  _rfidSelectedClassId,
  _rfidClockInterval,
  _rfidScheduleTimerInterval,
  _rfidWebNfcActive,
  _rfidWebNfcAbortController,
  _rfidKioskMode,
  renderRfidScanner,
  _rfidUpdateStatusEyebrow,
  _rfidClassOptionLabel,
  _rfidRefreshClassSelectCounts,
  unmountRfidScanner,
  _rfidToggleKioskMode,
  _rfidTickClock,
  _rfidStartClock,
  _rfidScheduleFor,
  _rfidTimeStrToDate,
  _rfidNextScheduleMilestone,
  _rfidFormatCountdown,
  _rfidTickScheduleTimer,
  _rfidStartScheduleTimer,
  _rfidStartCapture,
  _rfidWebNfcSupported,
  _rfidToggleWebNfc,
  _rfidStartWebNfcCapture,
  _rfidStopWebNfcCapture,
  _rfidRefreshWebNfcButton,
  _rfidNormalizeTagId,
  _rfidFinalizeScan,
  _rfidHandleAttendanceScan,
  _rfidHandleAssignScan,
  _rfidSpotlightIdleHtml,
  _rfidWelcomeMessage,
  _rfidLevelProgress,
  _rfidClassRank,
  _rfidProfileCardHtml,
  _rfidRenderSpotlight,
  _rfidTodayISO,
  _rfidRenderActivity,
  _rfidSetMode,
  _rfidOpenAssignPicker,
  _rfidOnClassChange,
  _rfidOpenSettings,
  _rfidRenderScheduleForm,
  _rfidSaveSchedule,
  _rfidCloseSession,
} from '../../src/modules/attendance/att_scanner_rfid.js';

window._rfidFocusInterval = _rfidFocusInterval;
window._rfidScanBuffer = _rfidScanBuffer;
window._rfidInactivityTimer = _rfidInactivityTimer;
window._rfidScannerMounted = _rfidScannerMounted;
window._rfidScanMode = _rfidScanMode;
window._rfidAssignTargetStudentId = _rfidAssignTargetStudentId;
window._rfidSelectedClassId = _rfidSelectedClassId;
window._rfidClockInterval = _rfidClockInterval;
window._rfidScheduleTimerInterval = _rfidScheduleTimerInterval;
window._rfidWebNfcActive = _rfidWebNfcActive;
window._rfidWebNfcAbortController = _rfidWebNfcAbortController;
window._rfidKioskMode = _rfidKioskMode;
window.renderRfidScanner = renderRfidScanner;
window._rfidUpdateStatusEyebrow = _rfidUpdateStatusEyebrow;
window._rfidClassOptionLabel = _rfidClassOptionLabel;
window._rfidRefreshClassSelectCounts = _rfidRefreshClassSelectCounts;
window.unmountRfidScanner = unmountRfidScanner;
window._rfidToggleKioskMode = _rfidToggleKioskMode;
window._rfidTickClock = _rfidTickClock;
window._rfidStartClock = _rfidStartClock;
window._rfidScheduleFor = _rfidScheduleFor;
window._rfidTimeStrToDate = _rfidTimeStrToDate;
window._rfidNextScheduleMilestone = _rfidNextScheduleMilestone;
window._rfidFormatCountdown = _rfidFormatCountdown;
window._rfidTickScheduleTimer = _rfidTickScheduleTimer;
window._rfidStartScheduleTimer = _rfidStartScheduleTimer;
window._rfidStartCapture = _rfidStartCapture;
window._rfidWebNfcSupported = _rfidWebNfcSupported;
window._rfidToggleWebNfc = _rfidToggleWebNfc;
window._rfidStartWebNfcCapture = _rfidStartWebNfcCapture;
window._rfidStopWebNfcCapture = _rfidStopWebNfcCapture;
window._rfidRefreshWebNfcButton = _rfidRefreshWebNfcButton;
window._rfidNormalizeTagId = _rfidNormalizeTagId;
window._rfidFinalizeScan = _rfidFinalizeScan;
window._rfidHandleAttendanceScan = _rfidHandleAttendanceScan;
window._rfidHandleAssignScan = _rfidHandleAssignScan;
window._rfidSpotlightIdleHtml = _rfidSpotlightIdleHtml;
window._rfidWelcomeMessage = _rfidWelcomeMessage;
window._rfidLevelProgress = _rfidLevelProgress;
window._rfidClassRank = _rfidClassRank;
window._rfidProfileCardHtml = _rfidProfileCardHtml;
window._rfidRenderSpotlight = _rfidRenderSpotlight;
window._rfidTodayISO = _rfidTodayISO;
window._rfidRenderActivity = _rfidRenderActivity;
window._rfidSetMode = _rfidSetMode;
window._rfidOpenAssignPicker = _rfidOpenAssignPicker;
window._rfidOnClassChange = _rfidOnClassChange;
window._rfidOpenSettings = _rfidOpenSettings;
window._rfidRenderScheduleForm = _rfidRenderScheduleForm;
window._rfidSaveSchedule = _rfidSaveSchedule;
window._rfidCloseSession = _rfidCloseSession;
