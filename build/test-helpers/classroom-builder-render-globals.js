// Test-only: window globals not-yet-converted / sibling code needs BEFORE any bridge module body runs.
// Imported FIRST by classroom-builder-render-combined-entry.js. ONE shared AppStore/DBService/ClassroomService
// instance between the harness and the modules under test.
import { AppStore } from '../../src/modules/core/state-manager.js';
import { DBService } from '../../src/db-service.js';
import { ClassroomService } from '../../src/modules/seat-arrangement/classroom-service.js';
import { toast, showModal, closeModalForce } from '../../src/dom.js';
import { _esc, uid, _cssColor } from '../../src/utils.js';

window.AppStore = AppStore;
window.DBService = DBService;
window.ClassroomService = ClassroomService;
window.toast = toast;
window.showModal = showModal;
window.closeModalForce = closeModalForce;
window._esc = _esc;
window.uid = uid;
window._cssColor = _cssColor;
