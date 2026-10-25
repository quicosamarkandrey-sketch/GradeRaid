// Test-only combined entry point for verify-auth-bridge.js.
//
// NOT a production bridge — auth.bridge.js (build/bridges/) is the real
// deliverable and correctly only re-attaches its own file's exports.
// This exists solely so the verify script can seed/read the SAME real
// AppStore instance, mock the SAME real DBService's methods (by
// mutating them on the shared object), and confirm updateTopbar() ran
// via its real DOM side effects.
import { AppStore } from '../../src/modules/core/state-manager.js';
import { DBService } from '../../src/db-service.js';
import { updateTopbar } from '../../src/topbar.js';
import * as authExports from '../../src/auth.js';

window.AppStore = AppStore;
window.DBService = DBService;
window.updateTopbar = updateTopbar;
Object.keys(authExports).forEach(k => { window[k] = authExports[k]; });
