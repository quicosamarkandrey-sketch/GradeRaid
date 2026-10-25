// Test-only combined entry point for verify-admin-compose-bridge.js.
//
// NOT a production bridge — admin-compose.bridge.js (build/bridges/) is
// the real deliverable and correctly only re-attaches its own file's
// exports. This exists solely so the verify script can seed/read the
// SAME real AppStore instance and mock the SAME real DBService.rpc.
import { AppStore } from '../../src/modules/core/state-manager.js';
import { DBService } from '../../src/db-service.js';
import * as adminComposeExports from '../../src/modules/mail/admin-compose.js';

window.AppStore = AppStore;
window.DBService = DBService;
Object.keys(adminComposeExports).forEach(k => { window[k] = adminComposeExports[k]; });
