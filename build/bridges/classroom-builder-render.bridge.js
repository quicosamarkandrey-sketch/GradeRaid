// Phase 7 (Stream D) — bridge for modules/seat-arrangement/classroom-builder-render.js.
// Re-attaches all 7 real exports to window. The builder twin (classroom_builder.bridge.js) calls six of
// them through bare window names; this file reads the builder's state through live ES imports instead.
import {
  _cbRenderShell,
  _cbScaleCanvas,
  _cbRenderCanvas,
  _cbRepaintSeats,
  _cbRenderSidebar,
  _cbStudentChip,
  _cbRenderWizard,
} from '../../src/modules/seat-arrangement/classroom-builder-render.js';

window._cbRenderShell = _cbRenderShell;
window._cbScaleCanvas = _cbScaleCanvas;
window._cbRenderCanvas = _cbRenderCanvas;
window._cbRepaintSeats = _cbRepaintSeats;
window._cbRenderSidebar = _cbRenderSidebar;
window._cbStudentChip = _cbStudentChip;
window._cbRenderWizard = _cbRenderWizard;
