// Test-only combined entry for verify-titles_student_page-bridge.js: the REAL production bridge for the student page
// (the twin imports titles_badge_renderer / hall-of-fame itself). The renderBadges the patch wraps is stubbed on
// window BEFORE this bundle is evaluated, mirroring ach_student_page loading first in index.html.
import './titles_student_page-globals.js';
import '../bridges/titles_student_page.bridge.js';
