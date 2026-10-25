// Phase 7 (Stream D) — bridge for modules/achievements/ach_admin_page.js.
// Re-attaches all 16 real exports to window, including the module-level mutable
// draftAchSections (one-time snapshot; no outside reader — see the src header).
import {
  draftAchSections,
  renderAdminAchievements,
  achAdminOpenForm,
  updateDraftAchSections,
  achAdminUpdateTriggerHint,
  achAdminSave,
  achAdminToggle,
  achAdminDelete,
  achAdminDuplicate,
  achAdminPreview,
  achAdminGrantAchievement,
  achAdminUpdateGrantPreview,
  achAdminDoGrant,
  achAdminManageCategories,
  achAdminAddCat,
  achAdminDeleteCat,
} from '../../src/modules/achievements/ach_admin_page.js';

window.draftAchSections = draftAchSections;
window.renderAdminAchievements = renderAdminAchievements;
window.achAdminOpenForm = achAdminOpenForm;
window.updateDraftAchSections = updateDraftAchSections;
window.achAdminUpdateTriggerHint = achAdminUpdateTriggerHint;
window.achAdminSave = achAdminSave;
window.achAdminToggle = achAdminToggle;
window.achAdminDelete = achAdminDelete;
window.achAdminDuplicate = achAdminDuplicate;
window.achAdminPreview = achAdminPreview;
window.achAdminGrantAchievement = achAdminGrantAchievement;
window.achAdminUpdateGrantPreview = achAdminUpdateGrantPreview;
window.achAdminDoGrant = achAdminDoGrant;
window.achAdminManageCategories = achAdminManageCategories;
window.achAdminAddCat = achAdminAddCat;
window.achAdminDeleteCat = achAdminDeleteCat;
