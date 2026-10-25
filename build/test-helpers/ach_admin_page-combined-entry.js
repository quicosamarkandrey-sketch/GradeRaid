// Test-only combined entry point for verify-ach_admin_page-bridge.js.
// Not a production bridge. ONE shared real AppStore/DBService instance between
// the harness and the modules under test, plus the real dom.js/utils.js leaves.
// Both REAL production bridges are imported (ach_engine first, as in index.html
// load order) so every window.X is attached by the exact code that will ship.
import './ach_admin_page-globals.js';
import '../bridges/ach_engine.bridge.js';
import '../bridges/ach_admin_page.bridge.js';
