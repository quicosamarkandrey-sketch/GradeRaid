# Phase 7 — Implicit Global Tracker

Found during Phase 7 session 1 (2026-08-09) while standing up the parallel build (step 5.1).

## Why this file exists

esbuild's `--bundle` (any output format — `iife`, `cjs`, `esm`) wraps combined
files in a scope to prevent symbol collisions. This codebase currently relies
on the opposite: 133 files loaded as classic `<script>` tags share ONE global
scope, and top-level `function foo(){}` / `var foo` declarations become real
properties of `window` as a side effect of that — no explicit
`window.foo = foo` required. 432 distinct function names are invoked from
inline HTML event-handler attributes (`onclick="foo()"` etc., both static in
`index.html` and dynamically generated via `innerHTML` template strings
across ~63 files). 402 of those already have an explicit `window.X =`
assignment somewhere and are safe under any future scoping change. The
**30 below do not** — they rely purely on the implicit classic-script->window
behavior, which any real module system (Phase 7's actual goal) removes.

**Each of these 30 must get an explicit `window.foo = foo` line at its
declaration site before that file is bundled with real scoping (esbuild
`--bundle`, or `export`/`import`) — otherwise its inline `onclick` (etc.)
wiring will silently stop working the moment that specific file's bundle
mode changes, even though the file's own internal logic still runs fine.**

This is separate from — and simpler than — the full ESM-conversion shim
policy in the Phase 7 session memory doc (§8.3). Adding `window.foo = foo`
here is not a "temporary shim to be removed later," it's the same pattern
~400 other functions in this codebase already use permanently. Do it once,
correctly, and it never needs revisiting for these specific names.

## How to fix each entry

Find the top-level declaration (`function foo(...) {`), add
`window.foo = foo;` immediately after the function (or convert to
`window.foo = function foo(...) { ... }` inline, matching this file's
existing local convention — check what the file already does for its OTHER
window-exposed functions and match it, don't introduce a third style into
one file).

## Status: 29 / 29 fixed (session 2, 2026-08-10)

All 29 genuine at-risk functions now have explicit `window.foo = foo` at
their declaration site (8 external files got a small appended export
block; 17 lived inside `index.html`'s own inline `<script>` block and were
added to its existing "EXPOSE GLOBALS" section instead of inventing a new
pattern). Two names from the original 30-item list were false positives,
found while doing this pass — corrected here, not silently dropped:

- `if` — matched by the extraction regex from an inline `onclick="if (...)"`
  conditional, not a function name at all.
- `claimReward` — the only "declaration" was inside a JSDoc usage-example
  comment in `modules/shared/button-loading.js` (illustrating the
  `eqWithButtonLoading` pattern), not real code. The one real
  `claimReward` in the codebase is `LootService.claimReward()` in
  `modules/world-boss/loot-service.js`, already correctly module-scoped
  inside its own IIFE (`window.LootService = (function(){...})()`) — never
  called as a bare global anywhere. Not a hazard; left as-is.

Re-verified via `node check-globals.js`: 430/432 inline-handler names now
have a confirmed `window.X =` assignment; the remaining 2 are the false
positives above (expected, not bugs).

- [x] `_posPayRenderGrid` — `modules/shop/shop_pos_terminal.js`
- [x] `closeModal` / `closeModalForce` / `toast` — `dom.js`
- [x] `doLogin` / `doLogout` — `auth.js`
- [x] `recCheckValidation` — `recovery.js`
- [x] `teacherInviteCheckValidation` — `modules/admin/teacher-invite.js`
- [x] `toggleSidebar` — `topbar.js`
- [x] `wbeFinishIntro` — `modules/world-boss/battle-overlay.js`
- [x] `wbrAnswer` / `wbrCloseBattle` — `modules/world-boss/raid-flow.js`
- [x] `closeProfile`, `confirmAbortQuiz`, `handleProfilePicUpload`,
      `profileAvatarClick`, `profileOverlayClick`, `quizNext`, `quizPrev`,
      `removeProfilePic`, `saveEmail`, `savePassword`, `saveProfileEdit`,
      `startQuiz`, `submitEnumAnswer`, `submitIdAnswer`,
      `submitMatchAnswer`, `switchProfileTab`, `useHint` — all in
      `index.html`'s inline `<script>` block, exported via its existing
      "EXPOSE GLOBALS" section.
- [x] ~~`claimReward`~~ — false positive, see above, not fixed because
      there was nothing to fix.

This tracker is now empty of open work. Kept for history / as the
reference for what "done" looked like, per the project's own convention
of not deleting completed tracking artifacts outright — a future session
can archive or remove it once Phase 7's later steps make it moot.

Regenerate/re-verify this list any time with:
```
node check-globals.js
```
(script lives at repo root — see Phase 7 session 1 log entry for how it
differs from a naive/broken first attempt at the same check)
