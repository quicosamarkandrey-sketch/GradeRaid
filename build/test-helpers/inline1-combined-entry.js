// Test-only combined entry point for verify-inline1-bridge.js.
//
// NOT a production bridge — inline1.bridge.js (build/bridges/) is the
// real deliverable and correctly only re-attaches its own file's
// exports. This exists solely so the verify script can also reach
// AppStore directly (to read back state via getSlice/getState for
// assertions) — same reason several other Stream A files needed their
// own combined-entry bundle.
import { AppStore } from '../../src/modules/core/state-manager.js';
import * as inline1Exports from '../../src/inline1.js';

window.AppStore = AppStore;
Object.keys(inline1Exports).forEach(k => { window[k] = inline1Exports[k]; });
