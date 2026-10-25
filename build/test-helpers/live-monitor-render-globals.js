// Test-only: the SAME AppStore/DBService/toast instances the twins import, on window (the harness seeds and reads through window.AppStore) BEFORE the bridges run.
import { AppStore } from '../../src/modules/core/state-manager.js';
import { DBService } from '../../src/db-service.js';
import { toast } from '../../src/dom.js';

window.AppStore = AppStore;
window.DBService = DBService;
window.toast = toast;
