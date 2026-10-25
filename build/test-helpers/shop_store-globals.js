// Test-only: put the SAME module instances the twin imports on window (as the production bootstrap does), BEFORE the
// bridge runs, so bare-global siblings and the harness's own helpers see one AppStore/DBService.
import { AppStore } from '../../src/modules/core/state-manager.js';
import { DBService } from '../../src/db-service.js';
import { toast, showModal, closeModalForce } from '../../src/dom.js';
import { _esc, uid, todayStr, nowStr } from '../../src/utils.js';

window.AppStore = AppStore;
window.DBService = DBService;
window.toast = toast;
window.showModal = showModal;
window.closeModalForce = closeModalForce;
window._esc = _esc;
window.uid = uid;
window.todayStr = todayStr;
window.nowStr = nowStr;
