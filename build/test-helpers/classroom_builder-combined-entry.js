// Test-only combined entry point for verify-classroom_builder-bridge.js. Not a production bridge.
// The REAL production bridge is imported (so every window.X is attached by the exact code that
// will ship), then __peek() reads the module's LIVE `export let` state through the namespace
// object — the bridge-side twin of the original side's in-scope peek snippet.
import './classroom_builder-globals.js';
import '../bridges/classroom_builder.bridge.js';
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
