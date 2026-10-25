// Test-only: sets the window globals that not-yet-converted code (here:
// ach_engine.js's load-time AppStore.subscribe() calls, which use the bare
// window fallback) needs BEFORE any bridge module body runs. Imported first by
// ach_admin_page-combined-entry.js — ES import order guarantees it evaluates
// before the bridges below it.
import { AppStore } from '../../src/modules/core/state-manager.js';
import { DBService } from '../../src/db-service.js';
import { toast, showModal, closeModalForce } from '../../src/dom.js';
import { _esc, uid } from '../../src/utils.js';

window.AppStore = AppStore;
window.DBService = DBService;
window.toast = toast;
window.showModal = showModal;
window.closeModalForce = closeModalForce;
window._esc = _esc;
window.uid = uid;
