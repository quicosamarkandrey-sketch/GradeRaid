// Test-only: titles_badge_renderer's twin keeps uid/_cssColor/_esc bare, so put the SAME module instances on window
// BEFORE the bridge runs (as the production bootstrap does).
import { AppStore } from '../../src/modules/core/state-manager.js';
import { _esc, uid, _cssColor } from '../../src/utils.js';

window.AppStore = AppStore;
window._esc = _esc;
window.uid = uid;
window._cssColor = _cssColor;
