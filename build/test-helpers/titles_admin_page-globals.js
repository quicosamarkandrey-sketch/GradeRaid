// Test-only: window globals that not-yet-converted / sibling code needs BEFORE any bridge body runs
// (titles_badge_renderer's twin keeps uid/_cssColor/_esc bare). Imported FIRST by the entry.
import { AppStore } from '../../src/modules/core/state-manager.js';
import { DBService } from '../../src/db-service.js';
import { toast, showModal, closeModalForce } from '../../src/dom.js';
import { _esc, uid, _cssColor } from '../../src/utils.js';

window.AppStore = AppStore;
window.DBService = DBService;
window.toast = toast;
window.showModal = showModal;
window.closeModalForce = closeModalForce;
window._esc = _esc;
window.uid = uid;
window._cssColor = _cssColor;
