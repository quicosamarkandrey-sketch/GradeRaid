// Phase 7 (Stream D) — bridge for modules/shop/shop_orders.js.
// Re-attaches all 7 real exports to window.
import {
  ordStatusPill,
  ordLabel,
  renderStudentOrders,
  ordSwitchTab,
  ordCancelPrompt,
  ordExecuteCancel,
  ordUpdateSidebarBadge,
} from '../../src/modules/shop/shop_orders.js';

window.ordStatusPill = ordStatusPill;
window.ordLabel = ordLabel;
window.renderStudentOrders = renderStudentOrders;
window.ordSwitchTab = ordSwitchTab;
window.ordCancelPrompt = ordCancelPrompt;
window.ordExecuteCancel = ordExecuteCancel;
window.ordUpdateSidebarBadge = ordUpdateSidebarBadge;
