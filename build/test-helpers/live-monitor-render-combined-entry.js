// Test-only combined entry for verify-live-monitor-render-bridge.js: the REAL production bridges of live_monitor.js (OWNER of the shared
// state accessors, file 27) and live-monitor-render.js (file 28). The render twin imports classroom-service / recitation-service /
// classroom_builder / live-monitor-webnfc itself.
import './live-monitor-render-globals.js';
import '../bridges/live_monitor.bridge.js';
import '../bridges/live-monitor-render.bridge.js';
