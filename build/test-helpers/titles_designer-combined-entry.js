// Test-only combined entry for verify-titles_designer-bridge.js. The REAL production bridges are imported
// (badge renderer + admin page + designer) so every window.X is attached by the exact code that will ship.
import './titles_designer-globals.js';
import '../bridges/titles_badge_renderer.bridge.js';
import '../bridges/titles_admin_page.bridge.js';
import '../bridges/titles_designer.bridge.js';
