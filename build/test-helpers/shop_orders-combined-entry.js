// Test-only combined entry point for verify-shop_orders-bridge.js.
// Not a production bridge. Shares one real AppStore instance (via the real
// state-manager.js, which has zero imports of its own — same shape as
// eql-engine.js's combined-entry, file 3/30) plus the real dom.js and
// utils.js leaf modules (both no-imports, no load-time side effects).
import { AppStore } from '../../src/modules/core/state-manager.js';
import { toast, showModal, closeModalForce } from '../../src/dom.js';
import { _esc } from '../../src/utils.js';
import * as ordExports from '../../src/modules/shop/shop_orders.js';

window.AppStore = AppStore;
window.toast = toast;
window.showModal = showModal;
window.closeModalForce = closeModalForce;
window._esc = _esc;
Object.keys(ordExports).forEach(k => { window[k] = ordExports[k]; });
