// build/bridges/shop_pos_terminal.bridge.js — re-attaches the window-facing exports of the shop_pos_terminal twin to window (Phase 7, Stream D, file 30/30).
// NOT re-attached (deliberately): the 9 top-level `let`s (_posPayCart, _posPayManualStudentId, _posPayScanArmed, _posPayCaptureFocusInterval,
// _posPayCaptureTimer, _posPayLastChargedTag, _posPayLastChargeAt, _posPayBusy, _posHistPage) and `const _POS_HIST_PAGE_SIZE`: in the classic file they
// were global LEXICAL bindings, never window properties, and nothing outside the file references them; a window copy of a reassigned `let` would be a stale snapshot.
import {
  renderPOS,
  posSwitchTab,
  posLookupCode,
  posConfirmClaim,
  posExecuteClaim,
  posCancelOrderPrompt,
  posExecuteCancel,
  _posPayTotal,
  _posPayRenderPanel,
  _posPayRenderGrid,
  posPayAddItem,
  posPayIncQty,
  posPayDecQty,
  posPayClearCart,
  _posPayRenderCart,
  _posPayIdleStatusHTML,
  _posPayStartCapture,
  unmountPosPayCapture,
  _posPayOnCaptureInput,
  _posPayFinalizeCapture,
  posPayArmScan,
  posPayCancelScan,
  posPayEditSale,
  _posPayHandleTag,
  _posPayRenderScanError,
  posPaySearchStudent,
  posPaySelectStudent,
  posPayManualCharge,
  _posPayRenderProcessing,
  _posPayRenderDeclined,
  _posPayRenderStockFail,
  _posPayRenderReceipt,
  posPayNewTransaction,
  _posPayAttemptCharge,
  posFilterQueue,
  posGoToHistPage,
  posPrevHistPage,
  posNextHistPage,
  _posHistPagination,
  posFilterHistory,
  _posAnalyticsHTML,
} from '../../src/modules/shop/shop_pos_terminal.js';

window.renderPOS = renderPOS;
window.posSwitchTab = posSwitchTab;
window.posLookupCode = posLookupCode;
window.posConfirmClaim = posConfirmClaim;
window.posExecuteClaim = posExecuteClaim;
window.posCancelOrderPrompt = posCancelOrderPrompt;
window.posExecuteCancel = posExecuteCancel;
window._posPayTotal = _posPayTotal;
window._posPayRenderPanel = _posPayRenderPanel;
window._posPayRenderGrid = _posPayRenderGrid;
window.posPayAddItem = posPayAddItem;
window.posPayIncQty = posPayIncQty;
window.posPayDecQty = posPayDecQty;
window.posPayClearCart = posPayClearCart;
window._posPayRenderCart = _posPayRenderCart;
window._posPayIdleStatusHTML = _posPayIdleStatusHTML;
window._posPayStartCapture = _posPayStartCapture;
window.unmountPosPayCapture = unmountPosPayCapture;
window._posPayOnCaptureInput = _posPayOnCaptureInput;
window._posPayFinalizeCapture = _posPayFinalizeCapture;
window.posPayArmScan = posPayArmScan;
window.posPayCancelScan = posPayCancelScan;
window.posPayEditSale = posPayEditSale;
window._posPayHandleTag = _posPayHandleTag;
window._posPayRenderScanError = _posPayRenderScanError;
window.posPaySearchStudent = posPaySearchStudent;
window.posPaySelectStudent = posPaySelectStudent;
window.posPayManualCharge = posPayManualCharge;
window._posPayRenderProcessing = _posPayRenderProcessing;
window._posPayRenderDeclined = _posPayRenderDeclined;
window._posPayRenderStockFail = _posPayRenderStockFail;
window._posPayRenderReceipt = _posPayRenderReceipt;
window.posPayNewTransaction = posPayNewTransaction;
window._posPayAttemptCharge = _posPayAttemptCharge;
window.posFilterQueue = posFilterQueue;
window.posGoToHistPage = posGoToHistPage;
window.posPrevHistPage = posPrevHistPage;
window.posNextHistPage = posNextHistPage;
window._posHistPagination = _posHistPagination;
window.posFilterHistory = posFilterHistory;
window._posAnalyticsHTML = _posAnalyticsHTML;
