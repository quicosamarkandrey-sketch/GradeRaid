// Test-only combined entry point for verify-classroom-service-bridge.js.
// Not a production bridge. Shares one real AppStore + DBService instance
// (through the real db-service.js -> pull-mappers.js/realtime-groups.js/
// repository/table-sync.js chain) the same way the real module graph would,
// so classroom-service.js's DBService.rpc()/AppStore.updateState() calls
// are exercised against the genuine converted dependency chain, not a
// reimplementation of it.
import { AppStore } from '../../src/modules/core/state-manager.js';
import { DBService } from '../../src/db-service.js';
import { ClassroomService } from '../../src/modules/seat-arrangement/classroom-service.js';

window.AppStore = AppStore;
window.DBService = DBService;
window.ClassroomService = ClassroomService;
