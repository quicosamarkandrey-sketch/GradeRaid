// Test-only combined entry point for verify-recitation-service-bridge.js.
// Not a production bridge. Same rationale as classroom-service-combined-
// entry.js (file 4/30): shares one real AppStore + DBService instance
// through the real db-service.js chain, so this file's DBService.rpc()/
// AppStore.updateState() calls are exercised against the genuine converted
// dependency chain, not a reimplementation of it.
import { AppStore } from '../../src/modules/core/state-manager.js';
import { DBService } from '../../src/db-service.js';
import { RecitationService } from '../../src/modules/seat-arrangement/recitation-service.js';

window.AppStore = AppStore;
window.DBService = DBService;
window.RecitationService = RecitationService;
