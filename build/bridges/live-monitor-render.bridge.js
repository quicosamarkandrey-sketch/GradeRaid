// build/bridges/live-monitor-render.bridge.js — re-attaches every export of the live-monitor-render twin to window (Phase 7, Stream D, file 28/30).
import {
  _lmRender,
  _lmScaleCanvas,
  _lmRenderCanvas,
  _lmRenderSidebar,
  _lmRenderAttendanceSidebar,
  _lmOverridePanelHtml,
  _lmFeedItem,
  _lmRenderRecitationSidebar,
  _lmRecitationFeedItem,
  _lmAnimateNewRecitationEntries,
  _lmSpawnFloatingPoint,
} from '../../src/modules/seat-arrangement/live-monitor-render.js';

window._lmRender = _lmRender;
window._lmScaleCanvas = _lmScaleCanvas;
window._lmRenderCanvas = _lmRenderCanvas;
window._lmRenderSidebar = _lmRenderSidebar;
window._lmRenderAttendanceSidebar = _lmRenderAttendanceSidebar;
window._lmOverridePanelHtml = _lmOverridePanelHtml;
window._lmFeedItem = _lmFeedItem;
window._lmRenderRecitationSidebar = _lmRenderRecitationSidebar;
window._lmRecitationFeedItem = _lmRecitationFeedItem;
window._lmAnimateNewRecitationEntries = _lmAnimateNewRecitationEntries;
window._lmSpawnFloatingPoint = _lmSpawnFloatingPoint;
