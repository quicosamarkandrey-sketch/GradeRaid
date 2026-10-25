// Test-only combined entry point for verify-db-migrations-bridge.js.
//
// NOT a production bridge — db-migrations.bridge.js (build/bridges/) is
// the real deliverable and correctly only re-attaches its own export
// (runMigrations). This exists solely so the verify script can read
// the SAME real DBService instance the bundle's saveDB()/loadDB() calls
// actually go through (via window.DBService.diagnostics().saveCount),
// the same reason table-sync.js/reward-presenter.js/
// notification-service.js each needed their own combined-entry bundle
// for a different transitively-real-imported dependency.
import { DBService } from '../../src/db-service.js';
import { runMigrations } from '../../src/db-migrations.js';

window.DBService = DBService;
window.runMigrations = runMigrations;
