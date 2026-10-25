// Phase 7 (Stream D) — bridge for modules/shop/shop_inventory.js.
// Re-attaches all 12 real exports to window.
import {
  INV_CAT_LABELS,
  INV_CAT_ICONS,
  INV_CAT_COLORS,
  renderInventory,
  invSwitchTab,
  invFilter,
  invHistFilter,
  invUseItem,
  invConfirmUse,
  invViewDetail,
  invShowCodes,
  invUpdateSidebarBadge,
} from '../../src/modules/shop/shop_inventory.js';

window.INV_CAT_LABELS = INV_CAT_LABELS;
window.INV_CAT_ICONS = INV_CAT_ICONS;
window.INV_CAT_COLORS = INV_CAT_COLORS;
window.renderInventory = renderInventory;
window.invSwitchTab = invSwitchTab;
window.invFilter = invFilter;
window.invHistFilter = invHistFilter;
window.invUseItem = invUseItem;
window.invConfirmUse = invConfirmUse;
window.invViewDetail = invViewDetail;
window.invShowCodes = invShowCodes;
window.invUpdateSidebarBadge = invUpdateSidebarBadge;
