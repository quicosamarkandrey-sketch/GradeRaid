// Test-only combined entry point for verify-progress-bridge.js.
//
// NOT a production bridge — progress.bridge.js (build/bridges/) is the
// real deliverable and correctly only re-attaches its own file's
// exports. This exists solely so the verify script can seed the SAME
// real AppStore instance progGetRecitationsForStudent()/
// progBuildCalendar() etc. actually read from, via
// window.AppStore.updateState(...)/ready — same reason
// table-sync.js/reward-presenter.js/notification-service.js each needed
// their own combined-entry bundle.
import { AppStore } from '../../src/modules/core/state-manager.js';
import * as progressExports from '../../src/modules/recitation/progress.js';

window.AppStore = AppStore;
Object.keys(progressExports).forEach(k => { window[k] = progressExports[k]; });
