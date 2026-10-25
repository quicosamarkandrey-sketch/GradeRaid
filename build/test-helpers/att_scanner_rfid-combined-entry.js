// Test-only combined entry point for verify-att_scanner_rfid-bridge.js.
//
// NOT a production bridge — att_scanner_rfid.bridge.js (build/bridges/)
// is the real deliverable and correctly only re-attaches its own file's
// exports. This exists solely so the verify script can seed/read the
// SAME real AppStore instance, and spy on the SAME real DBService.rpc
// (via AttendanceService) — same reason attendance-service.js's own
// verify script needed a combined entry.
import { AppStore } from '../../src/modules/core/state-manager.js';
import { DBService } from '../../src/db-service.js';
import { AttendanceService } from '../../src/modules/attendance/attendance-service.js';
import * as scannerExports from '../../src/modules/attendance/att_scanner_rfid.js';

window.AppStore = AppStore;
window.DBService = DBService;
window.AttendanceService = AttendanceService;
Object.keys(scannerExports).forEach(k => { window[k] = scannerExports[k]; });
