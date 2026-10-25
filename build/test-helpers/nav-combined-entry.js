// Test-only combined entry point for verify-nav-bridge.js.
//
// NOT a production bridge — nav.bridge.js (build/bridges/) is the real
// deliverable and correctly only re-attaches its own file's exports.
// This exists solely so the verify script can seed/read the SAME real
// AppStore instance, and confirm the 5 real-imported render*() calls
// actually happened by exposing them too (they're simple stubs on the
// window in the test, not the real render bodies — those are already
// covered by their own files' verify scripts; this script only cares
// that nav.js calls the right one for each page id).
import { AppStore } from '../../src/modules/core/state-manager.js';
import { unmountRfidScanner } from '../../src/modules/attendance/att_scanner_rfid.js';
import * as navExports from '../../src/nav.js';

window.AppStore = AppStore;
window.unmountRfidScanner = unmountRfidScanner; // test-only cleanup helper — nav.js itself never imports this (only renderRfidScanner, behind a typeof guard elsewhere)
Object.keys(navExports).forEach(k => { window[k] = navExports[k]; });
