// Phase 7 (Stream D) — bridge for modules/seat-arrangement/classroom_builder.js.
// Re-attaches all 76 real exports to window (the rule). 8 module-state let/const entries
// (_cbLayoutName, _cbDragSeatId, _cbDragOffsetX/Y, _cbSubscriberKey, CB_SEAT_SIZE,
// CB_SEAT_MARGIN, _cbAutoFixInFlight) had no window line in the classic script, so they
// become one-time snapshots that did not exist before; nothing reads them. See the src
// header for the live-state plan for classroom-builder-render.js (file 20).
import {
  _cbMounted,
  _cbMode,
  _cbClassId,
  _cbLayoutId,
  _cbLayoutName,
  _cbLocalSeats,
  _cbLocalProps,
  _cbDragSeatId,
  _cbDragStudentId,
  _cbSelectedSeatIds,
  _cbDragOffsetX,
  _cbDragOffsetY,
  _cbSubscriberKey,
  CB_CANVAS_W,
  CB_CANVAS_H,
  CB_SEAT_SIZE,
  CB_SEAT_MARGIN,
  CB_PROP_TYPES,
  CB_SHAPE_TYPES,
  _cbAutoStrategy,
  _cbWizardOpen,
  _cbWizardShape,
  _cbWizardRows,
  _cbWizardCols,
  _cbWizardSpacing,
  _cbWizardPreset,
  CB_WALKWAY_PRESETS,
  _cbGenId,
  _cbCanvasScale,
  _cbVirtualCoords,
  _cbLoadState,
  _cbAutoFixInFlight,
  _cbResolveSeatOverlaps,
  _cbMaybeAutoFixSeatOverlap,
  renderClassroomBuilder,
  _cbSubscribeToStore,
  _cbOnClassChange,
  _cbOnLayoutChange,
  _cbSetMode,
  _cbNewLayout,
  _cbRenameLayout,
  _cbDeleteLayout,
  _cbSave,
  _cbAddSeat,
  _cbDeleteSeat,
  _cbRotateSeat,
  _cbToggleSeatSelection,
  _cbSelectAllSeats,
  _cbClearSeatSelection,
  _cbRefreshSelectionToolbar,
  _cbDuplicateSelectedSeats,
  _cbSeatDragStart,
  _cbSeatDragEnd,
  _cbPropDragStart,
  _cbPropDragEnd,
  _cbOnCanvasDragOver,
  _cbOnCanvasDragLeave,
  _cbOnCanvasDrop,
  _cbAddProp,
  _cbDeleteProp,
  _cbOpenBlueprintWizard,
  _cbCloseBlueprintWizard,
  _cbSetWizardShape,
  _cbSetWizardPreset,
  _cbSubmitBlueprintWizard,
  _cbSeatAssignDragOver,
  _cbSeatAssignDragLeave,
  _cbSeatAssignDrop,
  _cbSeatOccupantDragStart,
  _cbSeatOccupantDragEnd,
  _cbUnassign,
  _cbToggleSeatLock,
  _cbSetAutoStrategy,
  _cbRunAutoAllocate,
  renderStudentSeating,
  unmountClassroomBuilder,
} from '../../src/modules/seat-arrangement/classroom_builder.js';

window._cbMounted = _cbMounted;
window._cbMode = _cbMode;
window._cbClassId = _cbClassId;
window._cbLayoutId = _cbLayoutId;
window._cbLayoutName = _cbLayoutName;
window._cbLocalSeats = _cbLocalSeats;
window._cbLocalProps = _cbLocalProps;
window._cbDragSeatId = _cbDragSeatId;
window._cbDragStudentId = _cbDragStudentId;
window._cbSelectedSeatIds = _cbSelectedSeatIds;
window._cbDragOffsetX = _cbDragOffsetX;
window._cbDragOffsetY = _cbDragOffsetY;
window._cbSubscriberKey = _cbSubscriberKey;
window.CB_CANVAS_W = CB_CANVAS_W;
window.CB_CANVAS_H = CB_CANVAS_H;
window.CB_SEAT_SIZE = CB_SEAT_SIZE;
window.CB_SEAT_MARGIN = CB_SEAT_MARGIN;
window.CB_PROP_TYPES = CB_PROP_TYPES;
window.CB_SHAPE_TYPES = CB_SHAPE_TYPES;
window._cbAutoStrategy = _cbAutoStrategy;
window._cbWizardOpen = _cbWizardOpen;
window._cbWizardShape = _cbWizardShape;
window._cbWizardRows = _cbWizardRows;
window._cbWizardCols = _cbWizardCols;
window._cbWizardSpacing = _cbWizardSpacing;
window._cbWizardPreset = _cbWizardPreset;
window.CB_WALKWAY_PRESETS = CB_WALKWAY_PRESETS;
window._cbGenId = _cbGenId;
window._cbCanvasScale = _cbCanvasScale;
window._cbVirtualCoords = _cbVirtualCoords;
window._cbLoadState = _cbLoadState;
window._cbAutoFixInFlight = _cbAutoFixInFlight;
window._cbResolveSeatOverlaps = _cbResolveSeatOverlaps;
window._cbMaybeAutoFixSeatOverlap = _cbMaybeAutoFixSeatOverlap;
window.renderClassroomBuilder = renderClassroomBuilder;
window._cbSubscribeToStore = _cbSubscribeToStore;
window._cbOnClassChange = _cbOnClassChange;
window._cbOnLayoutChange = _cbOnLayoutChange;
window._cbSetMode = _cbSetMode;
window._cbNewLayout = _cbNewLayout;
window._cbRenameLayout = _cbRenameLayout;
window._cbDeleteLayout = _cbDeleteLayout;
window._cbSave = _cbSave;
window._cbAddSeat = _cbAddSeat;
window._cbDeleteSeat = _cbDeleteSeat;
window._cbRotateSeat = _cbRotateSeat;
window._cbToggleSeatSelection = _cbToggleSeatSelection;
window._cbSelectAllSeats = _cbSelectAllSeats;
window._cbClearSeatSelection = _cbClearSeatSelection;
window._cbRefreshSelectionToolbar = _cbRefreshSelectionToolbar;
window._cbDuplicateSelectedSeats = _cbDuplicateSelectedSeats;
window._cbSeatDragStart = _cbSeatDragStart;
window._cbSeatDragEnd = _cbSeatDragEnd;
window._cbPropDragStart = _cbPropDragStart;
window._cbPropDragEnd = _cbPropDragEnd;
window._cbOnCanvasDragOver = _cbOnCanvasDragOver;
window._cbOnCanvasDragLeave = _cbOnCanvasDragLeave;
window._cbOnCanvasDrop = _cbOnCanvasDrop;
window._cbAddProp = _cbAddProp;
window._cbDeleteProp = _cbDeleteProp;
window._cbOpenBlueprintWizard = _cbOpenBlueprintWizard;
window._cbCloseBlueprintWizard = _cbCloseBlueprintWizard;
window._cbSetWizardShape = _cbSetWizardShape;
window._cbSetWizardPreset = _cbSetWizardPreset;
window._cbSubmitBlueprintWizard = _cbSubmitBlueprintWizard;
window._cbSeatAssignDragOver = _cbSeatAssignDragOver;
window._cbSeatAssignDragLeave = _cbSeatAssignDragLeave;
window._cbSeatAssignDrop = _cbSeatAssignDrop;
window._cbSeatOccupantDragStart = _cbSeatOccupantDragStart;
window._cbSeatOccupantDragEnd = _cbSeatOccupantDragEnd;
window._cbUnassign = _cbUnassign;
window._cbToggleSeatLock = _cbToggleSeatLock;
window._cbSetAutoStrategy = _cbSetAutoStrategy;
window._cbRunAutoAllocate = _cbRunAutoAllocate;
window.renderStudentSeating = renderStudentSeating;
window.unmountClassroomBuilder = unmountClassroomBuilder;
