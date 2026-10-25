// Test-only: the SAME AppStore/DBService/toast instances the twins import, plus the globals the markup's inline handlers (closeModalForce) and the harness
// (RecitationService object, to exercise the typeof guards) need on window, BEFORE the bridges run.
import { AppStore } from '../../src/modules/core/state-manager.js';
import { DBService } from '../../src/db-service.js';
import { toast, closeModalForce, showModal } from '../../src/dom.js';
import { RecitationService } from '../../src/modules/seat-arrangement/recitation-service.js';

window.AppStore = AppStore;
window.DBService = DBService;
window.toast = toast;
window.showModal = showModal;
window.closeModalForce = closeModalForce;
window.__RS = RecitationService;
