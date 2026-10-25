// Test-only: window globals not-yet-converted code needs BEFORE any bridge module body runs
// (ach_engine.js subscribes to AppStore at load via the bare global). Imported FIRST by the entry.
import { AppStore } from '../../src/modules/core/state-manager.js';
import { DBService } from '../../src/db-service.js';
import { toast, showModal, closeModalForce } from '../../src/dom.js';
import { _esc, uid } from '../../src/utils.js';

window.AppStore = AppStore;
window.DBService = DBService;
window.toast = toast;
window.showModal = showModal;
window.closeModalForce = closeModalForce;
window._esc = _esc;
window.uid = uid;
