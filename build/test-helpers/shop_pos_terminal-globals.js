// Test-only: the SAME AppStore/DBService/toast instances the twin imports on window (the harness seeds and reads through window.AppStore) BEFORE the bridge runs,
// plus __peek(): a live read of the twin's module-private lets (the classic original reads them from its own global lexical scope instead).
import { AppStore } from '../../src/modules/core/state-manager.js';
import { DBService } from '../../src/db-service.js';
import { toast, showModal, closeModalForce } from '../../src/dom.js';
import * as B from '../../src/modules/shop/shop_pos_terminal.js';

window.AppStore = AppStore;
window.DBService = DBService;
window.toast = toast;
window.showModal = showModal;
window.closeModalForce = closeModalForce;
window.__peek = () => ({ cart: B._posPayCart, manual: B._posPayManualStudentId, armed: B._posPayScanArmed, focusInterval: !!B._posPayCaptureFocusInterval, captureTimer: !!B._posPayCaptureTimer,
  lastTag: B._posPayLastChargedTag, lastAt: B._posPayLastChargeAt, busy: B._posPayBusy, hist: B._posHistPage, histSize: B._POS_HIST_PAGE_SIZE });
