// Test-only combined entry point for verify-admin-leaderboard-bridge.js.
// Not a production bridge. Shares ONE real AppStore instance between the
// test harness (window.AppStore.updateState/ready) and the module under test
// (which imports AppStore and eql-engine.js for real), plus the real dom.js
// leaf (toast/showModal/closeModalForce — no imports, no load-time side
// effects). The REAL production bridge is imported last, so window.X for the
// 6 exports is attached by the exact code that will ship.
import { AppStore } from '../../src/modules/core/state-manager.js';
import { toast, showModal, closeModalForce } from '../../src/dom.js';

window.AppStore = AppStore;
window.toast = toast;
window.showModal = showModal;
window.closeModalForce = closeModalForce;

import '../bridges/admin-leaderboard.bridge.js';
