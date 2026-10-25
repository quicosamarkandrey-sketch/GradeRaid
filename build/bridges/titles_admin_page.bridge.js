// Phase 7 (Stream D) — bridge for modules/titles/titles_admin_page.js.
// Re-attaches all 12 real exports to window (the 2 builders were global function declarations).
import {
  renderAdminTitles,
  _buildAdminTitlesList,
  _buildAdminTitleStats,
  tsAdminTabSwitch,
  _tsRefreshAdminTitlesPanel,
  tsAdminDelete,
  tsAdminToggle,
  tsAdminDuplicate,
  tsAdminGrantModal,
  tsAdminGrantRefreshStudentTitles,
  tsAdminGrantConfirm,
  tsAdminRevokeTitle,
} from '../../src/modules/titles/titles_admin_page.js';

window.renderAdminTitles = renderAdminTitles;
window._buildAdminTitlesList = _buildAdminTitlesList;
window._buildAdminTitleStats = _buildAdminTitleStats;
window.tsAdminTabSwitch = tsAdminTabSwitch;
window._tsRefreshAdminTitlesPanel = _tsRefreshAdminTitlesPanel;
window.tsAdminDelete = tsAdminDelete;
window.tsAdminToggle = tsAdminToggle;
window.tsAdminDuplicate = tsAdminDuplicate;
window.tsAdminGrantModal = tsAdminGrantModal;
window.tsAdminGrantRefreshStudentTitles = tsAdminGrantRefreshStudentTitles;
window.tsAdminGrantConfirm = tsAdminGrantConfirm;
window.tsAdminRevokeTitle = tsAdminRevokeTitle;
