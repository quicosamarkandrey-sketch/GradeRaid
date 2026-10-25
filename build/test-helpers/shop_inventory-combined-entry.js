// Test-only combined entry point for verify-shop_inventory-bridge.js.
// Not a production bridge. Shares one real AppStore instance (state-
// manager.js, zero imports of its own) plus the real dom.js/utils.js leaf
// modules (both no-imports, no load-time side effects) — same pattern as
// shop_orders.js's combined-entry.js (file 6/30).
import { AppStore } from '../../src/modules/core/state-manager.js';
import { toast, showModal, closeModalForce } from '../../src/dom.js';
import { _esc, todayStr, nowStr } from '../../src/utils.js';
import * as invExports from '../../src/modules/shop/shop_inventory.js';

window.AppStore = AppStore;
window.toast = toast;
window.showModal = showModal;
window.closeModalForce = closeModalForce;
window._esc = _esc;
window.todayStr = todayStr;
window.nowStr = nowStr;
Object.keys(invExports).forEach(k => { window[k] = invExports[k]; });
