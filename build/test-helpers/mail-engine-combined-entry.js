// Test-only combined entry point for verify-mail-engine-bridge.js.
//
// NOT a production bridge — mail-engine.bridge.js (build/bridges/) is
// the real deliverable and correctly only re-attaches its own file's
// exports. This exists solely so the verify script can seed/read the
// SAME real AppStore instance, mock the SAME real DBService.rpc, and
// (for currentUser/topbar DOM assertions) confirm setCurrentUser()/
// updateTopbar() ran by checking their real, observable side effects —
// no spying needed since both mutate window.currentUser / the DOM
// directly, using the SAME window-fallback currentUser/currentRole
// this bundle's other real imports also read.
import { AppStore } from '../../src/modules/core/state-manager.js';
import { DBService } from '../../src/db-service.js';
import * as mailEngineExports from '../../src/modules/mail/mail-engine.js';

window.AppStore = AppStore;
window.DBService = DBService;
Object.keys(mailEngineExports).forEach(k => { window[k] = mailEngineExports[k]; });
