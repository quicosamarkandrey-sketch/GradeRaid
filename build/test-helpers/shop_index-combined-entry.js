// Test-only combined entry for verify-shop_index-bridge.js. Imports the REAL
// production bridge (so the MODULE_VERSION -> window.__SHOP_MODULE_VERSION__
// mapping is exercised, not reimplemented) and exposes the same AppStore
// instance the twin real-imports.
import '../bridges/shop_index.bridge.js';
import { AppStore } from '../../src/modules/core/state-manager.js';
window.AppStore = AppStore;
