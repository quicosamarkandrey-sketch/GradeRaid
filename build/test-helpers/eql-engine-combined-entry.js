// Test-only combined entry point for verify-eql-engine-bridge.js.
//
// NOT a production bridge — eql-engine.bridge.js (build/bridges/) is the
// real deliverable and correctly only re-attaches its own file's exports.
// This exists solely so the verify script can seed the SAME real AppStore
// instance eqlComputeRecitation/Boss/Academic/Overall/eqlBuildCategory/EQL
// actually read from, via window.AppStore.updateState()/getSlice()/ready —
// same reason progress.js/table-sync.js/reward-presenter.js each needed
// their own combined-entry bundle.
import { AppStore } from '../../src/modules/core/state-manager.js';
import * as eqlExports from '../../src/modules/leaderboard/eql-engine.js';

window.AppStore = AppStore;
Object.keys(eqlExports).forEach(k => { window[k] = eqlExports[k]; });
