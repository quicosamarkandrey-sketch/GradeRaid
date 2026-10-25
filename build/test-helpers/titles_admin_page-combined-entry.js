// Test-only combined entry for verify-titles_admin_page-bridge.js. The REAL production bridges are imported
// (titles_badge_renderer first, as in index.html load order) so every window.X is attached by the exact code
// that will ship. One shared AppStore/DBService instance between harness and modules.
import './titles_admin_page-globals.js';
import '../bridges/titles_badge_renderer.bridge.js';
import '../bridges/titles_admin_page.bridge.js';
