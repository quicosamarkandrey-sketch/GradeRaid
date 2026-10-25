// Test-only combined entry for verify-ach_student_page-bridge.js. Both REAL production bridges are
// imported (ach_engine first, as in index.html load order) so every window.X is attached by the exact
// code that will ship. One shared AppStore/DBService instance between harness and modules.
import './ach_student_page-globals.js';
import '../bridges/ach_engine.bridge.js';
import '../bridges/ach_student_page.bridge.js';
