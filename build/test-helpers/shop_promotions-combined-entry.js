// Test-only combined entry point for verify-shop_promotions-bridge.js.
// Not a production bridge. Shares one real AppStore instance (state-
// manager.js, zero imports of its own) plus the real dom.js/utils.js leaf
// modules — same pattern as shop_orders.js/shop_inventory.js's
// combined-entry.js (files 6/12).
import { AppStore } from '../../src/modules/core/state-manager.js';
import { toast, showModal, closeModalForce } from '../../src/dom.js';
import { _esc, uid } from '../../src/utils.js';
import * as promoExports from '../../src/modules/shop/shop_promotions.js';

window.AppStore = AppStore;
window.toast = toast;
window.showModal = showModal;
window.closeModalForce = closeModalForce;
window._esc = _esc;
window.uid = uid;
Object.keys(promoExports).forEach(k => { window[k] = promoExports[k]; });
