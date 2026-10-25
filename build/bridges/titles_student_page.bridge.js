// Phase 7 (Stream D) — bridge for modules/titles/titles_student_page.js.
// Re-attaches the 8 real exports to window. (The renderBadges patch and window._tsOpenTitlesTab flag run in the module body.)
import {
  _getTitleReqText,
  _tsTitleVisibleToStudent,
  _buildStudentTitlesHTML,
  renderTitlesPage,
  tsTabSwitch,
  tsStudentEquip,
  tsStudentUnequip,
  _tsRefreshStudentTitlesPanel,
} from '../../src/modules/titles/titles_student_page.js';

window._getTitleReqText = _getTitleReqText;
window._tsTitleVisibleToStudent = _tsTitleVisibleToStudent;
window._buildStudentTitlesHTML = _buildStudentTitlesHTML;
window.renderTitlesPage = renderTitlesPage;
window.tsTabSwitch = tsTabSwitch;
window.tsStudentEquip = tsStudentEquip;
window.tsStudentUnequip = tsStudentUnequip;
window._tsRefreshStudentTitlesPanel = _tsRefreshStudentTitlesPanel;
