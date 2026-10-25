// Test-only combined entry point for verify-logger-bridge.js.
//
// NOT a production bridge — logger.bridge.js (build/bridges/) is the
// real deliverable and correctly only re-attaches its own file's export
// (logRecitation). This exists solely so the verify script can seed the
// SAME real AppStore instance logRecitation() actually reads/writes,
// via window.AppStore.updateState(...)/ready/getStudent — same reason
// several other Stream A files needed their own combined-entry bundle.
// syncStudentStatsToServer is real-imported too, but does NOT need
// exposing here for spying — see verify-logger-bridge.js's own header
// for why its RPC call is a harmless, already-caught failure in tests
// (no network client configured), identical on both sides.
import { AppStore } from '../../src/modules/core/state-manager.js';
import { logRecitation } from '../../src/modules/recitation/logger.js';

window.AppStore = AppStore;
window.logRecitation = logRecitation;
