// Test-only combined entry for verify-inline2-bridge.js. See
// table-sync-combined-entry.js for why this is needed: inline2.js
// real-imports AppStore/updateTopbar/navTo/showPage/
// syncStudentStatsToServer/syncOwnProfileCosmeticToServer, all from
// files already converted by this stream — bundling them together here
// (test-only) gives the verify script ONE shared module instance of
// each, matching how they'll actually behave once wired into a single
// real entry point, unlike the production bridge (build/bridges/
// inline2.bridge.js) which correctly only re-attaches its OWN file's
// exports.
import { AppStore } from '../../src/modules/core/state-manager.js';
import { updateTopbar } from '../../src/topbar.js';
import { navTo, showPage } from '../../src/nav.js';
import { syncStudentStatsToServer, syncOwnProfileCosmeticToServer, computeAttendanceStreak } from '../../src/student-stats.js';
import * as inline2Exports from '../../src/inline2.js';

window.AppStore = AppStore;
window.updateTopbar = updateTopbar;
window.navTo = navTo;
window.showPage = showPage;
window.syncStudentStatsToServer = syncStudentStatsToServer;
window.syncOwnProfileCosmeticToServer = syncOwnProfileCosmeticToServer;
// modules/quest-engine.js (real, unconverted classic script — evaluated
// separately by the verify script, both sides identically) delegates
// computeQuestStreak() to this bare global.
window.computeAttendanceStreak = computeAttendanceStreak;
Object.keys(inline2Exports).forEach(k => { window[k] = inline2Exports[k]; });
