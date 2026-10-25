// Phase 7, Stream B — bridge for modules/admin/sections.js.
import {
  renderSectionMaker, unmountSectionMaker, _secRenderList, _secOpenCreateModal,
  _secOpenEditModal, _secToggleScheduleFields, _secToggleDayOverride, _secToggleDayOff,
  _secSyncDefaultIntoUnoverriddenDays, _secSubmitForm, _secConfirmArchive, _secArchive,
  _secUnarchive, _secOpenReassignModal, _secOpenRosterModal, _secRerenderRoster,
  _secSubmitReassign,
} from '../../src/modules/admin/sections.js';

window.renderSectionMaker = renderSectionMaker;
window.unmountSectionMaker = unmountSectionMaker;
window._secRenderList = _secRenderList;
window._secOpenCreateModal = _secOpenCreateModal;
window._secOpenEditModal = _secOpenEditModal;
window._secToggleScheduleFields = _secToggleScheduleFields;
window._secToggleDayOverride = _secToggleDayOverride;
window._secToggleDayOff = _secToggleDayOff;
window._secSyncDefaultIntoUnoverriddenDays = _secSyncDefaultIntoUnoverriddenDays;
window._secSubmitForm = _secSubmitForm;
window._secConfirmArchive = _secConfirmArchive;
window._secArchive = _secArchive;
window._secUnarchive = _secUnarchive;
window._secOpenReassignModal = _secOpenReassignModal;
window._secOpenRosterModal = _secOpenRosterModal;
window._secRerenderRoster = _secRerenderRoster;
window._secSubmitReassign = _secSubmitReassign;
