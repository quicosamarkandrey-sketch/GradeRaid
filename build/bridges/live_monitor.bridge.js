// Phase 7 (Stream D) — bridge for modules/seat-arrangement/live_monitor.js.
// Re-attaches the 18 real exports to window. (The shared-state accessors and the style injection run in the module body.)
import {
  renderClassroomMonitor,
  unmountClassroomMonitor,
  _lmToggleKioskMode,
  _lmSubscribeToStore,
  _lmOnClassChange,
  _lmOnLayoutChange,
  _lmOnStrategyChange,
  _lmToggleSeatTarget,
  _lmOnOverrideStudentChange,
  _lmOnOverrideStatusChange,
  _lmOnOverrideNoteInput,
  _lmToggleOverridePanel,
  _lmSubmitOverride,
  _lmOnAwardSearchInput,
  _lmSelectAwardStudentFromSeat,
  _lmSetAwardPoints,
  _lmSubmitManualAward,
  _lmUndoRecitation,
} from '../../src/modules/seat-arrangement/live_monitor.js';

window.renderClassroomMonitor = renderClassroomMonitor;
window.unmountClassroomMonitor = unmountClassroomMonitor;
window._lmToggleKioskMode = _lmToggleKioskMode;
window._lmSubscribeToStore = _lmSubscribeToStore;
window._lmOnClassChange = _lmOnClassChange;
window._lmOnLayoutChange = _lmOnLayoutChange;
window._lmOnStrategyChange = _lmOnStrategyChange;
window._lmToggleSeatTarget = _lmToggleSeatTarget;
window._lmOnOverrideStudentChange = _lmOnOverrideStudentChange;
window._lmOnOverrideStatusChange = _lmOnOverrideStatusChange;
window._lmOnOverrideNoteInput = _lmOnOverrideNoteInput;
window._lmToggleOverridePanel = _lmToggleOverridePanel;
window._lmSubmitOverride = _lmSubmitOverride;
window._lmOnAwardSearchInput = _lmOnAwardSearchInput;
window._lmSelectAwardStudentFromSeat = _lmSelectAwardStudentFromSeat;
window._lmSetAwardPoints = _lmSetAwardPoints;
window._lmSubmitManualAward = _lmSubmitManualAward;
window._lmUndoRecitation = _lmUndoRecitation;
