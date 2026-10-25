// build/bridges/live-monitor-coldcall.bridge.js — re-attaches every export of the live-monitor-coldcall twin to window (Phase 7, Stream D, file 29/30).
import {
  _lmStartColdCall,
  _lmClearCycle,
  _lmLandOnWinner,
  _lmShowSpotlight,
} from '../../src/modules/seat-arrangement/live-monitor-coldcall.js';

window._lmStartColdCall = _lmStartColdCall;
window._lmClearCycle = _lmClearCycle;
window._lmLandOnWinner = _lmLandOnWinner;
window._lmShowSpotlight = _lmShowSpotlight;
