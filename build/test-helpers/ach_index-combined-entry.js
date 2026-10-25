// Test-only combined entry for verify-ach_index-bridge.js. Imports the REAL
// production bridge (so the MODULE_VERSION -> window name mapping is
// exercised) and exposes the same AppStore instance the twin real-imports.
import '../bridges/ach_index.bridge.js';
import { AppStore } from '../../src/modules/core/state-manager.js';
window.AppStore = AppStore;
