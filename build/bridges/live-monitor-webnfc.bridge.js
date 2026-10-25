// Phase 7 (Stream D) — bridge for modules/seat-arrangement/live-monitor-webnfc.js.
// Re-attaches all 5 real exports to window. Reads/writes of the shared live_monitor.js state
// (_lmWebNfcActive etc.) stay bare — they resolve through the global lexical environment.
import {
  _lmWebNfcSupported,
  _lmToggleWebNfc,
  _lmStartWebNfcCapture,
  _lmStopWebNfcCapture,
  _lmRefreshWebNfcButton,
} from '../../src/modules/seat-arrangement/live-monitor-webnfc.js';

window._lmWebNfcSupported = _lmWebNfcSupported;
window._lmToggleWebNfc = _lmToggleWebNfc;
window._lmStartWebNfcCapture = _lmStartWebNfcCapture;
window._lmStopWebNfcCapture = _lmStopWebNfcCapture;
window._lmRefreshWebNfcButton = _lmRefreshWebNfcButton;
