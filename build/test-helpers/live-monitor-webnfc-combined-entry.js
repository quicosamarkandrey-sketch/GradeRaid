// Test-only combined entry point for verify-live-monitor-webnfc-bridge.js. Not a production bridge.
// The REAL production bridge is imported, so every window._lm* is attached by the exact code that ships.
// (The module's own toast import is bundled in.) The shared live_monitor.js state it reads/writes bare
// is declared by a separate CLASSIC <script> in the harness, exactly like the real page.
import '../bridges/live-monitor-webnfc.bridge.js';
