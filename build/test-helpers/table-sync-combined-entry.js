// Test-only combined entry point for verify-table-sync-bridge.js.
//
// NOT a production bridge — table-sync.bridge.js (build/bridges/) is the
// real deliverable. This exists solely because esbuild's --bundle
// inlines each bridge's dependencies independently: evaluating
// state-manager.bridge.js and table-sync.bridge.js SEPARATELY in the
// same jsdom window creates two disconnected AppStore instances (each
// bridge's own bundle has its own inlined copy of state-manager.js),
// which is a bundling artifact, not something that would happen in a
// real browser's native ES module loader (where both bridges importing
// the SAME literal path would share one cached module instance). This
// combined entry imports both real src files together in one bundle, so
// esbuild naturally de-duplicates the shared state-manager.js module —
// giving the verify script one coherent, shared AppStore instance to
// test against, matching real production module-graph behavior.
import { AppStore } from '../../src/modules/core/state-manager.js';
import { TableSyncRepository } from '../../src/repository/table-sync.js';

window.AppStore = AppStore;
window.TableSyncRepository = TableSyncRepository;
