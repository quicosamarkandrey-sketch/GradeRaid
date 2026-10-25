// Test-only combined entry for verify-classroom-builder-render-bridge.js. Both REAL production bridges are
// imported (the builder first, then the render layer, whose twin imports the builder's live bindings), so every
// window.X is attached by the exact code that will ship. __peek() reads the builder twin's LIVE `export let`
// state through the namespace object — the bridge-side twin of the original side's in-scope peek script.
import './classroom-builder-render-globals.js';
import '../bridges/classroom_builder.bridge.js';
import '../bridges/classroom-builder-render.bridge.js';
import * as B from '../../src/modules/seat-arrangement/classroom_builder.js';

window.__peek = () => ({
  mounted: B._cbMounted, mode: B._cbMode, classId: B._cbClassId, layoutId: B._cbLayoutId,
  layoutName: B._cbLayoutName, localSeats: B._cbLocalSeats, localProps: B._cbLocalProps,
  dragSeatId: B._cbDragSeatId, dragStudentId: B._cbDragStudentId, selected: [...B._cbSelectedSeatIds],
  dragOffX: B._cbDragOffsetX, dragOffY: B._cbDragOffsetY, subscriberKey: B._cbSubscriberKey,
  autoStrategy: B._cbAutoStrategy, wizardOpen: B._cbWizardOpen, wizardShape: B._cbWizardShape,
  wizardRows: B._cbWizardRows, wizardCols: B._cbWizardCols, wizardSpacing: B._cbWizardSpacing,
  wizardPreset: B._cbWizardPreset, autoFixInFlight: [...B._cbAutoFixInFlight],
});
