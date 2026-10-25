// Phase 7, Stream B — bridge for modules/admin/dsm-manager.js.
import {
  dsmGetStudentNav, dsmGetAdminNav, dsmGetTeacherNav, dsmIsWidgetVisible,
  dsmGetWidgetConfig, renderNavManager, dsmSwitchTab, dsmSetSearch, dsmToggle,
  dsmSetStatus, dsmSetField, dsmExpandRow, dsmAssignGroup, dsmRenameGroup,
  dsmMoveGroup, dsmShowAll, dsmHideAll, dsmUnlockAll, dsmResetToDefaults,
  dsmApplyAndRefresh,
} from '../../src/modules/admin/dsm-manager.js';

window.dsmGetStudentNav = dsmGetStudentNav;
window.dsmGetAdminNav = dsmGetAdminNav;
window.dsmGetTeacherNav = dsmGetTeacherNav;
window.dsmIsWidgetVisible = dsmIsWidgetVisible;
window.dsmGetWidgetConfig = dsmGetWidgetConfig;
window.renderNavManager = renderNavManager;
window.dsmSwitchTab = dsmSwitchTab;
window.dsmSetSearch = dsmSetSearch;
window.dsmToggle = dsmToggle;
window.dsmSetStatus = dsmSetStatus;
window.dsmSetField = dsmSetField;
window.dsmExpandRow = dsmExpandRow;
window.dsmAssignGroup = dsmAssignGroup;
window.dsmRenameGroup = dsmRenameGroup;
window.dsmMoveGroup = dsmMoveGroup;
window.dsmShowAll = dsmShowAll;
window.dsmHideAll = dsmHideAll;
window.dsmUnlockAll = dsmUnlockAll;
window.dsmResetToDefaults = dsmResetToDefaults;
window.dsmApplyAndRefresh = dsmApplyAndRefresh;
