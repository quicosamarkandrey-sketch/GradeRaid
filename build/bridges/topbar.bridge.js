// Phase 7 (Stream A) — bridge for topbar.js.
import { updateTopbar, SIDEBAR_COLLAPSE_KEY, toggleSidebar, restoreSidebarState } from '../../src/topbar.js';

window.updateTopbar = updateTopbar;
window.SIDEBAR_COLLAPSE_KEY = SIDEBAR_COLLAPSE_KEY;
window.toggleSidebar = toggleSidebar;
window.restoreSidebarState = restoreSidebarState;
