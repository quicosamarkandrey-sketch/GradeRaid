// Test-only: window globals the not-yet-converted/cyclic code needs, imported FIRST
// by classroom_builder-combined-entry.js (ES import order guarantees it runs before the
// bridge below it). ONE shared real AppStore/DBService/ClassroomService instance for the
// harness and the module under test.
import { AppStore } from '../../src/modules/core/state-manager.js';
import { DBService } from '../../src/db-service.js';
import { ClassroomService } from '../../src/modules/seat-arrangement/classroom-service.js';
import { toast, showModal, closeModalForce } from '../../src/dom.js';
import { _esc, uid } from '../../src/utils.js';

window.AppStore = AppStore;
window.DBService = DBService;
window.ClassroomService = ClassroomService;
window.toast = toast;
window.showModal = showModal;
window.closeModalForce = closeModalForce;
window._esc = _esc;
window.uid = uid;
