// src/modules/mail/index.js — real-ESM twin of ../../../modules/mail/index.js.
// Phase 7 (Stream A), file 7/29. Original stays untouched.
//
// This file is unusual: all 8 of its statements are `window.X = X;`
// where X is a bare identifier defined ELSEWHERE (mail-engine.js, item
// 26 later in this stream's list, not yet converted) — this file
// doesn't declare or own any of these values itself; by its own header
// comment, every one of these lines is "redundant... but preserved
// verbatim for explicitness." Converting the RHS to a real export
// required one necessary, documented deviation from pure verbatim copy:
// `export const mailGetForStudent = mailGetForStudent;` would THROW a
// ReferenceError at module-evaluation time (a `const` declaration's own
// name shadows the outer/global one inside its own initializer, and
// that binding is still in its temporal dead zone — confirmed
// empirically: `const foo = foo;` throws "Cannot access 'foo' before
// initialization", it does NOT read an outer `foo`). Reading explicitly
// from `window.<name>` on the RHS instead avoids this entirely (a
// property access, not a bare-identifier binding lookup) and is the
// documented, necessary fix — every other line (including the
// redundant `window.X = X;` re-assignment right after each export,
// preserved exactly as the original had it) is unchanged.
//
// One bounded, honest behavioral difference this creates: if
// mail-engine.js somehow had NOT already run by the time this file
// loads (a violation of the documented load order, but not something
// guarded against in the original either), the ORIGINAL's bare
// `mailGetForStudent` reference would throw a ReferenceError and halt
// script execution; this converted version's `window.mailGetForStudent`
// property read would instead silently evaluate to `undefined` and
// continue (arguably safer, but different — not a change worth
// engineering around given production's load order guarantees this
// never happens in practice).
//
// mailGetForStudent, mailIsRead, mailIsClaimed, mailMarkRead,
// mailClaimRewards, mailUpdateSidebarBadge, mailUnreadCount, and
// mailUnclaimedRewardCount are all read as bare globals via `window.`
// (window fallback) — mail-engine.js is in this stream's own list but
// not yet converted, so no real import is possible yet; no cycle risk
// since mail-engine.js doesn't depend back on this file
// (fanOut/fanIn confirm this file has zero incoming dependents anyway).

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

export const mailGetForStudent = window.mailGetForStudent;
window.mailGetForStudent = mailGetForStudent;
export const mailIsRead = window.mailIsRead;
window.mailIsRead = mailIsRead;
export const mailIsClaimed = window.mailIsClaimed;
window.mailIsClaimed = mailIsClaimed;
export const mailMarkRead = window.mailMarkRead;
window.mailMarkRead = mailMarkRead;
export const mailClaimRewards = window.mailClaimRewards;
window.mailClaimRewards = mailClaimRewards;
export const mailUpdateSidebarBadge = window.mailUpdateSidebarBadge;
window.mailUpdateSidebarBadge = mailUpdateSidebarBadge;
export const mailUnreadCount = window.mailUnreadCount;
window.mailUnreadCount = mailUnreadCount;
export const mailUnclaimedRewardCount = window.mailUnclaimedRewardCount;
window.mailUnclaimedRewardCount = mailUnclaimedRewardCount;
