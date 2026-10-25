// Phase 7 (Stream D) — bridge for modules/shop/shop_index.js.
// Re-attaches the single real export under its original window name
// (the twin exports it as MODULE_VERSION — see the src file's header).
import { MODULE_VERSION } from '../../src/modules/shop/shop_index.js';

window.__SHOP_MODULE_VERSION__ = MODULE_VERSION;
