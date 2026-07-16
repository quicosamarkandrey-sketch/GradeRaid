// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/attendance/index.js
//  Load-order guard + window.* alias verification for the attendance module.
//
//  Required load order:
//    1. attendance-service.js  — AttendanceService (RPC-backed repository layer)
//    2. att_scanner_rfid.js    — renderRfidScanner, unmountRfidScanner
//    3. attendance-recitation-log.js — renderRecitationAttendanceLog,
//                                      unmountRecitationAttendanceLog (reads
//                                      draft.attendanceLogs/recitationLog —
//                                      see that file's header)
//    4. index.js               — this file (load last)
//
//  NOTE (Investigation Report §1): att_editor.js, att_bulk_edit.js, and the
//  legacy att_scanner.js were deleted — they operated on DB.attendanceSessions,
//  a dead local-only array nothing has written to since Phase 1 shipped. Their
//  functions (renderScanner, renderAttEditSection, attBulkEdit, etc.) no longer
//  exist and are intentionally not checked for here.
// ═══════════════════════════════════════════════════════════════════════════════

;(function () {
  const EXPECTED_FUNCTIONS = [
    // att_scanner_rfid.js
    'renderRfidScanner',
    'unmountRfidScanner',
    // attendance-recitation-log.js
    'renderRecitationAttendanceLog',
    'unmountRecitationAttendanceLog',
  ];

  const missing = EXPECTED_FUNCTIONS.filter(name => typeof window[name] !== 'function');
  if (missing.length || typeof window.AttendanceService !== 'object') {
    console.error('[EduQuest] attendance/index.js — MISSING exports:', missing.concat(typeof window.AttendanceService !== 'object' ? ['AttendanceService'] : []));
  } else {
    console.log('[EduQuest] attendance/index.js — All exports verified ✅');
  }

  window.__ATTENDANCE_MODULE_VERSION__ = '1.2.0';
})();
