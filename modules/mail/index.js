// ═══════════════════════════════════════════════════════════════════════════
// modules/mail/index.js
// Phase 3 Day 1 extraction — Mail module public API surface.
//
// Load order (classic scripts, shared global scope):
//   1. mail-engine.js   (data layer: mailGetForStudent, mailIsRead, etc.)
//   2. student-inbox.js (renderStudentMail, mailOpenDetail, mailDoClaimRewards)
//   3. admin-compose.js (renderAdminMail, mailAdminOpenCompose, etc.)
//   4. index.js         (this file — explicit window.* aliases)
//
// These aliases were originally emitted from the "EXPOSE GLOBALS" block at
// the end of the legacy inline <script> (index.html ~25415-25428). They are
// redundant for top-level `function` declarations in classic scripts (such
// declarations are already properties of `window`), but are preserved
// verbatim for explicitness and backward compatibility with any code that
// references them defensively via `window.mailX`.
//
// NOTE — bootApp()/navTo() patches:
// Per EXTRACTION_PLAN.md Day 1, the 2 monkey-patches on bootApp() and navTo()
// that call mailUpdateSidebarBadge() on login/navigation also call
// achUpdateSidebarBadge() (an Achievements-module concern, extracted on
// Days 6-7). Replacing these patches with explicit calls requires the
// Achievements module's index.js to exist first. The patch IIFEs therefore
// remain in index.html for now; see modules/achievements/index.js and the
// PATCH REPLACEMENT NOTES at the bottom of this Extraction Plan execution
// for the de-patch step performed once Achievements is extracted.
// ═══════════════════════════════════════════════════════════════════════════

window.mailGetForStudent       = mailGetForStudent;
window.mailIsRead              = mailIsRead;
window.mailIsClaimed           = mailIsClaimed;
window.mailMarkRead            = mailMarkRead;
window.mailClaimRewards        = mailClaimRewards;
window.mailUpdateSidebarBadge  = mailUpdateSidebarBadge;
window.mailUnreadCount         = mailUnreadCount;
window.mailUnclaimedRewardCount = mailUnclaimedRewardCount;
