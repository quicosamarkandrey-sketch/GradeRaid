// Test-only combined entry point for verify-notification-service-bridge.js.
//
// NOT a production bridge — notification-service.bridge.js (build/bridges/)
// is the real deliverable and correctly only re-attaches its own file's
// exports. This exists solely so the verify script can seed the SAME
// real AppStore instance the bundle's synthesize()/etc. read from, via
// window.AppStore.updateState(...)/ready (same reason as
// reward-presenter-combined-entry.js / table-sync-combined-entry.js).
import { AppStore } from '../../src/modules/core/state-manager.js';
import { eqTimeAgo, eqClassifyActivity, NotificationService } from '../../src/modules/shared/notification-service.js';

window.AppStore = AppStore;
window.eqTimeAgo = eqTimeAgo;
window.eqClassifyActivity = eqClassifyActivity;
window.NotificationService = NotificationService;
