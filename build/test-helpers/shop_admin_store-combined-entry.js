// Test-only combined entry point for verify-shop_admin_store-bridge.js.
// Not a production bridge. Combines the multi-hop DBService chain pattern
// (classroom-service.js, file 4/30) with the real dom.js/utils.js leaf-
// import pattern (shop_orders.js, file 6/30).
import { AppStore } from '../../src/modules/core/state-manager.js';
import { DBService } from '../../src/db-service.js';
import { toast, showModal, closeModalForce } from '../../src/dom.js';
import { _esc, uid } from '../../src/utils.js';
import * as adminStoreExports from '../../src/modules/shop/shop_admin_store.js';

window.AppStore = AppStore;
window.DBService = DBService;
window.toast = toast;
window.showModal = showModal;
window.closeModalForce = closeModalForce;
window._esc = _esc;
window.uid = uid;
Object.keys(adminStoreExports).forEach(k => { window[k] = adminStoreExports[k]; });
