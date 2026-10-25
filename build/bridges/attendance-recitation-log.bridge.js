// Phase 7 (Stream A) — bridge for modules/attendance/attendance-recitation-log.js.
import {
  renderRecitationAttendanceLog, unmountRecitationAttendanceLog, talSetSection,
  talSetType, talSetRange, talSetSearch, talClearFilters, talGoToPage,
  talPrevPage, talNextPage, talExportCsv,
} from '../../src/modules/attendance/attendance-recitation-log.js';

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
