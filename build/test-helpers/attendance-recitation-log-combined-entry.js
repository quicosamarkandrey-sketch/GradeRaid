// Test-only combined entry for verify-attendance-recitation-log-bridge.js.
// See table-sync-combined-entry.js for why this is needed (esbuild
// bundles each bridge's dependencies independently — evaling two
// separately-bundled bridges that both real-import the same shared
// dependency creates two disconnected instances of it).
import { AppStore } from '../../src/modules/core/state-manager.js';
import {
  renderRecitationAttendanceLog, unmountRecitationAttendanceLog, talSetSection,
  talSetType, talSetRange, talSetSearch, talClearFilters, talGoToPage,
  talPrevPage, talNextPage, talExportCsv,
} from '../../src/modules/attendance/attendance-recitation-log.js';

window.AppStore = AppStore;
window.renderRecitationAttendanceLog = renderRecitationAttendanceLog;
window.unmountRecitationAttendanceLog = unmountRecitationAttendanceLog;
window.talSetSection = talSetSection;
window.talSetType = talSetType;
window.talSetRange = talSetRange;
window.talSetSearch = talSetSearch;
window.talClearFilters = talClearFilters;
window.talGoToPage = talGoToPage;
window.talPrevPage = talPrevPage;
window.talNextPage = talNextPage;
window.talExportCsv = talExportCsv;
