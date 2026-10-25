// Phase 7, Stream B — bridge for modules/admin/system-health.js.
import {
  renderSystemHealth, shStopCountsRefresh, shSetResolvedFilter, shSetRoleFilter,
  shLoadMoreLogs, shToggleStack, shToggleResolved,
} from '../../src/modules/admin/system-health.js';

window.renderSystemHealth = renderSystemHealth;
window.shStopCountsRefresh = shStopCountsRefresh;
window.shSetResolvedFilter = shSetResolvedFilter;
window.shSetRoleFilter = shSetRoleFilter;
window.shLoadMoreLogs = shLoadMoreLogs;
window.shToggleStack = shToggleStack;
window.shToggleResolved = shToggleResolved;
