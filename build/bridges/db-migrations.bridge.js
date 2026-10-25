// Phase 7 (Stream A) — bridge for db-migrations.js.
import { runMigrations } from '../../src/db-migrations.js';

window.runMigrations = runMigrations;
