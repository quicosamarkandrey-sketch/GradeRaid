// Phase 7, Stream B — bridge for modules/admin/analytics.js.
import {
  anlSetSearch, anlGoToPage, anlPrevPage, anlNextPage, anlSetMode, renderAnalytics,
} from '../../src/modules/admin/analytics.js';

window.anlSetSearch = anlSetSearch;
window.anlGoToPage = anlGoToPage;
window.anlPrevPage = anlPrevPage;
window.anlNextPage = anlNextPage;
window.anlSetMode = anlSetMode;
window.renderAnalytics = renderAnalytics;
