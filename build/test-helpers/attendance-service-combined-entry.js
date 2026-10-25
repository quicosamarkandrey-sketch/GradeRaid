// Test-only combined entry point for verify-attendance-service-bridge.js.
//
// NOT a production bridge — attendance-service.bridge.js (build/bridges/)
// is the real deliverable and correctly only re-attaches its own file's
// export. This exists solely so the verify script can seed the SAME
// real AppStore instance AttendanceService actually reads/writes, and
// spy on the SAME real DBService.rpc() method every AttendanceService
// method (and student-stats.js's syncStudentDerivedStatsToServer,
// called internally) goes through — mutating a real-imported
// dependency's own method still works across the import boundary,
// since the import hands back a reference to the same mutable object
// (documented in MEMORY.md, same technique as db-migrations.js's
// spyOnWrite).
import { AppStore } from '../../src/modules/core/state-manager.js';
import { DBService } from '../../src/db-service.js';
import { AttendanceService } from '../../src/modules/attendance/attendance-service.js';

window.AppStore = AppStore;
window.DBService = DBService;
window.AttendanceService = AttendanceService;
