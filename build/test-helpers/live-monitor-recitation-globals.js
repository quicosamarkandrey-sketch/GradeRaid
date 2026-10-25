// Test-only: put the SAME AppStore/toast instances the twin imports on window (the harness seeds and reads through
// window.AppStore) BEFORE the bridge runs.
import { AppStore } from '../../src/modules/core/state-manager.js';
import { DBService } from '../../src/db-service.js';
import { toast } from '../../src/dom.js';

window.AppStore = AppStore;
window.DBService = DBService;
window.toast = toast;
