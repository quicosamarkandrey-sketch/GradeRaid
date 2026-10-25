// Phase 7 (Stream D) — bridge for modules/seat-arrangement/live-monitor-recitation.js.
// Re-attaches the 8 real exports to window.
import {
  _lmReconcileSessionState,
  _lmToggleRecitationMode,
  _lmStartRecitationSession,
  _lmStopRecitationSession,
  _lmStartScannerBListener,
  _lmStopScannerBListener,
  _lmSubmitScan,
  _lmFinalizeScan,
} from '../../src/modules/seat-arrangement/live-monitor-recitation.js';

window._lmReconcileSessionState = _lmReconcileSessionState;
window._lmToggleRecitationMode = _lmToggleRecitationMode;
window._lmStartRecitationSession = _lmStartRecitationSession;
window._lmStopRecitationSession = _lmStopRecitationSession;
window._lmStartScannerBListener = _lmStartScannerBListener;
window._lmStopScannerBListener = _lmStopScannerBListener;
window._lmSubmitScan = _lmSubmitScan;
window._lmFinalizeScan = _lmFinalizeScan;
