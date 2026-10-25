# EduQuest — Living Engineering Refactoring Report
**Baseline:** `EduQuest_Production_Audit.md`
**Plan:** `EduQuest_Architecture_Roadmap.md`

This document is updated after every completed phase. Nothing is marked complete until Phase 0's (and by then, the growing) test suite passes and the relevant CI gate from that phase is turned on.

---

## Status Overview

| Phase | Status |
|---|---|
| 0 — Safety-Net Infrastructure | Done — verified end-to-end on the user's machine (25/25 unit, lint working, 6/6 smoke tests pass/skip correctly) |
| 1 — Delete Dead Code & Consolidate Duplicates | In progress — 2 findings resolved (see log) |
| 2 — Security Hardening | Done — escaping fixes + structural lint enforcement verified end-to-end (25/25 unit, 0 lint errors); authorization matrix audited, no live gaps found |
| 3 — Single Source of Truth | Module-by-module migration complete — 13 modules migrated (`modules/shared/`, `modules/attendance/`, `modules/section/`, `modules/recitation/`, `modules/leaderboard/`, `modules/mail/`, `modules/boss-studio/`, `modules/campaign/`, `modules/titles/`, `modules/admin/`, `modules/achievements/`, `modules/shop/`, `modules/world-boss/`, see log). Remaining `DB.*` references are confined to `modules/core/` (state-manager.js/db-service.js internals) and root-level files — both explicitly deferred to be sequenced with Phase 4 per this phase's own roadmap doc, not per-module targets. |
| 4 — Event-Driven Communication | 5/5 target functions done (see below), plus `renderStudentWorldBoss` investigation. **Continuation (Category A remaining monkey-patches, per `CONTINUATION_PLAN.md` §3):** 4/13 sites converted — `setupSidebar`, `renderAdminAchievements`, `renderAnalytics` (2nd patch site found + confirmed dead), `renderStudentDashboard` (confirmed dead via load-order trace, converted — see log). 0 lint errors, 80/80 unit tests. 9 Category A sites remain (`openBossForm` ×3, `navTo` ×2, `achCheckAndAward`-as-title-hook), plus Category B/C (deliberately out of scope) and live/browser verification (per §5 of the plan — user has run the smoke suite, full click-through still not confirmed here). |
| 5 — Data Layer Redesign | Not started |
| 6 — Decompose God Files | Not started |
| 7 — Module System / Build Tooling | Not started |
| 8 — Replace `setTimeout` Sequencing | Not started |
| 9 — Scalability Hardening | Not started |
| 10 — CI Enforcement | Ongoing, grows with each phase |

---

## Entry Template

Each completed improvement is logged below using this shape:

```
### <Phase #> — <Title>
**Date:**
**Problem:**
**Root Cause:**
**Files Changed:**
**Architecture Before:**
**Architecture After:**
**Why This Is Better:**
**Remaining Technical Debt:**
**CI Gate Added:**
```

---

## Log

### Phase 0 — Safety-Net Infrastructure
**Date:** 2026-07-21

**Problem:** Zero automated tests and no lint config anywhere in the codebase. Every documented bugfix in the SQL/JS history was caught manually, which means every later refactor phase would otherwise be "change code, hope nothing broke."

**Root Cause:** Built iteratively as an MVP under real time pressure, with manual QA as the only feedback loop.

**Files Changed (all new, zero existing app files touched):**
- `package.json` — devDependencies (`@playwright/test`, `eslint`, `jsdom`, `globals`) + `test`/`test:unit`/`test:smoke`/`lint` scripts
- `eslint.config.js` + `eslint-rules/no-duplicate-global-functions.js` — flat config, 3 rules
- `tests/unit/` — jsdom harness (`helpers/load-globals.js`) + 3 test files, 25 tests total, covering `eqGradeAnswer`/`eqNormalizeAnswer` (all 5 question types + partial credit + normalization edge cases), `computeAttendanceStreak`/`getStudentAttendanceRecords`, and `recalcStudentStats` (tier thresholds, quizAvg, attendance %, the `opts.attendanceLogs` draft-callback override, and the legacy `attendanceSessions` fallback)
- `tests/smoke/` — Playwright config + static file server + 3 spec files, 6 tests: student/admin login→boot→dashboard render (+ wrong-password path), achievement claim, and a primary-nav render sweep for both roles
- `.env.example`, `tests/README.md` — setup docs
- `.github/workflows/ci.yml` — CI gate (see below)

**Architecture Before:** No verification layer of any kind. No lint. No CI.

**Architecture After:** A jsdom unit layer for pure logic (fast, no network, runs in this sandbox and passed 25/25), a Playwright layer that drives the real `index.html` in a real browser against a real test/staging Supabase project (deliberately *not* mocked — see the rationale comment at the top of `playwright.config.js`), and a 3-rule ESLint flat config aimed directly at the audit's named hazards rather than a generic ruleset.

**Why This Is Better:** The highest-value, previously-manual-only checks (quiz grading/reward integrity, attendance math, login/boot, nav rendering) now have an automated tripwire. The lint config already found a real issue on its first run (see below) instead of a hypothetical one.

**Remaining Technical Debt / Honesty about verification:**
- **Unit tests are fully verified** — ran in this environment: 25/25 passing (`npm run test:unit`).
- **Lint is fully verified** — ran in this environment: 3 errors, 218 warnings. The 3 errors are a **real finding**, not noise: `modules/admin/analytics.js` redeclares 3 top-level function names (`_anlPagination`, `_anlRenderRollupShell`, `_anlRollupBodyHTML`) already declared in the root-level `analytics.js`. The root-level file is **not** currently `<script src>`'d from `index.html`, so this isn't live today — but it's exactly the kind of orphaned duplicate Phase 1 (Delete Dead Code) should resolve, and the rule will catch it again immediately if anyone re-adds that script tag or copies code between the two. The 218 warnings are almost all the new `DB.*` direct-mutation rule firing everywhere by design (warning-level on purpose — see Phase 3), plus routine `no-unused-vars` noise from this app's "declare then `window.foo = foo`" pattern, which a single-file linter can't see the far end of.
- **Playwright smoke tests could NOT be executed in this sandbox** — this environment's network egress doesn't allow downloading Playwright's browser binary (`cdn.playwright.dev`), and running them for real also requires a test/staging Supabase project's credentials (`.env`, see `.env.example`), which only you can provide. All 6 tests do pass Playwright's own static validation (`npx playwright test --list` discovers all 6 correctly) and every file passes `node --check`, but **none of them have been run against a live app yet.** Treat this phase as "ready for you to run `npx playwright install chromium`, fill in `.env`, and do the first real run" — not as "verified passing."
- The CI workflow's `lint-and-unit` job will fail on push right now, on the real analytics.js finding above — that's intentional, not a config bug. The `smoke` job is gated behind a `vars.EDUQUEST_SMOKE_TESTS_ENABLED` repo variable and stays a no-op until test-account secrets are added.
- This is a floor, not a ceiling (per the plan doc): shop purchase, world-boss damage submission, and the XP/coin server-sync RPC round trip aren't smoke-tested end-to-end yet, only at the logic layer (unit tests above cover the grading/stat math those flows depend on). Add coverage as each later phase touches that code.

**CI Gate Added:** `.github/workflows/ci.yml` — `lint-and-unit` job (blocking: ESLint errors + `npm run test:unit`) runs on every push/PR. `smoke` job (Playwright) is wired but dormant until secrets are configured.

### Phase 1 — Delete Dead Code & Consolidate Duplicates (first finding)
**Date:** 2026-07-21

**Problem:** Phase 0's new lint rule (`eduquest/no-duplicate-global-functions`) found a real hit on its very first run: a root-level `analytics.js` redeclared 3 top-level function names (`_anlPagination`, `_anlRenderRollupShell`, `_anlRollupBodyHTML`) already declared in `modules/admin/analytics.js`.

**Root Cause:** Two independent copies of the same original file existed side by side. The root-level copy was never `<script src>`'d from `index.html` — its own header comment even says so explicitly ("root analytics.js — never <script>-loaded by index.html, confirmed"), meaning a previous work session had already manually identified this exact fact and left a note, but never deleted the file. The two copies had since drifted: different variable/function names for the same "Student Performance Matrix" section (`_anlRenderMatrix`/`anl-matrix` vs. `_anlRenderStudentTable`/`anl-student-table`), and different empty-state markup. This is the same "two copies drift apart" class of bug the project's own `SYNC_AUDIT_REPORT.md` had already documented for `titles`/`store`.

**Files Changed:** Deleted `analytics.js` (root). No other files touched.

**Verification before deleting (this is the part that actually matters here):** Confirmed the live file, `modules/admin/analytics.js`, already contains every feature the root copy had — specifically the admin-only "School-Wide Rollup" mode (`_anlMode`, `anlSetMode`, the `#anl-rollup-body` section) that the root file's header comment described as new work — so nothing unique or unmerged existed only in the deleted copy. Also grepped for any dynamic `import()`/`fetch()` reference to the filename anywhere in the codebase, beyond the `<script src>` check Phase 0 already did — found none.

**Architecture Before:** Two divergent copies of the same renderer, one live, one silently dead, with no automated way to notice if someone edited the wrong one or re-added a `<script>` tag pointing at it.

**Architecture After:** One copy. The lint rule now guards against this recurring — deleting a duplicate is a one-time fix, but the rule is what stops the next one from sitting unnoticed for as long as this one did.

**Why This Is Better:** Removes a maintenance trap (a dev editing the wrong copy and wondering why nothing changed) with zero behavior change to the running app, verified by re-running the full Phase 0 suite afterward.

**Remaining Technical Debt:**
- This resolves the one duplicate Phase 0's lint run happened to surface. Phase 1's broader job — finding the rest of the dead code and duplicated logic across the codebase — is still ahead; this was the first, already-proven example, not the whole phase.
- Verified in this environment: `npm run lint` → 0 errors (218 pre-existing warnings, unchanged), `npm run test:unit` → 25/25 passing, `npx playwright test --list` → still discovers all 6 smoke tests correctly. **Not** re-verified: an actual `npm run test:smoke` run against a live Supabase project (needs your local `.env` + browser binary, same sandbox limitation as Phase 0) — recommended as the last check before treating this as fully closed.

**CI Gate Added:** None new — this fix is exactly what makes the existing Phase 0 `lint-and-unit` gate go green for the first time (it would have failed on push until this was resolved).

### Phase 1 — Dead "editing index/draft" tracker variables (recurring pattern)
**Date:** 2026-07-21

**Problem:** Went hunting for the next dead-code candidate systematically instead of by inspection: extracted every `window.X = ...` global export in the codebase (978 of them) and checked each one's total occurrence count across every `.js`/`.html` file. Any name appearing only once (its own definition, nowhere else, not even from an inline `onclick="..."` in its own file) is either genuinely unused or an intentional debug hook. Manually reviewed every real candidate that turned up (a handful of `__*_MODULE_VERSION__` debug stamps were left alone as intentional).

Found the same bug shape independently in **four different modules**:
- `modules/admin/starter-pack-editor.js` — `window._spEditIdx = idx;`, set when opening the achievement editor, never read anywhere. The save function (`_spSaveAchievement`) actually keys off a sibling variable, `_spEditBaseId`, instead.
- `modules/world-boss/admin-page.js` — `window._wbcEditingBossIdx = bossIdx;`, same pattern. `wbcSaveQuestions(bossIdx)` takes the boss index as its own function parameter (baked into the Save button's `onclick` at render time) and never reads the global.
- `modules/world-boss/minions.js` — `window._wbmEditingBossIdx = bossIdx;`, identical shape; `wbmSaveMinionSettings(bossIdx)` also takes it as a parameter.
- `modules/world-boss/rage.js` — `window._wbrageDraft = JSON.parse(JSON.stringify(cfg));`, a deep-cloned "draft" instead of an index, but the same dead-write shape: `wbrageAdminSave(bossIdx)` reads its values straight from the DOM inputs (`document.getElementById('wbr-enabled')`, etc.), never from the draft object.

Also found and removed a separate, smaller case: `modules/leaderboard/hall-of-fame.js` had two functions, `_eqlBuildStudentTabBar` and `_eqlRenderRow`, explicitly labeled in their own comment as "Keep old helper aliases alive so any external calls don't break" — a defensive backward-compat shim left over from renaming `_eql*` → `_hol*`. Confirmed zero remaining callers anywhere in the codebase, so the defensive aliasing was no longer needed.

**Root Cause:** Editor/modal-opening functions across several admin modules follow a copy-pasted pattern (open modal → stash "what am I editing" in a global → render form) where the "stash a global" step and the "save" step were written independently, or the save step was later rewritten to take its target as a direct function parameter instead. Nothing ever removed the now-redundant assignment. Same root cause across all four instances — worth watching for again in modules not yet audited (each editor modal in this codebase follows a very similar hand-rolled pattern, since there's no shared form/modal abstraction yet — that's arguably a Phase 6 concern, decomposing repeated per-module editor boilerplate into something shared, not a Phase 1 one).

**Files Changed:** `modules/admin/starter-pack-editor.js`, `modules/world-boss/admin-page.js`, `modules/world-boss/minions.js`, `modules/world-boss/rage.js`, `modules/leaderboard/hall-of-fame.js` — one dead assignment (or, for hall-of-fame.js, two dead functions) removed from each, no other lines touched.

**Architecture Before:** Five dead writes/functions sitting alongside working code doing the actual job through a different variable or parameter — harmless today, but exactly the kind of thing that misleads the next person reading the file into thinking the dead variable is what the save logic depends on.

**Architecture After:** Same behavior, minus the misleading dead code.

**Why This Is Better:** Zero behavior change (verified below), removes a "which variable actually matters here" trap for whoever touches these five files next. Also validates that the systematic global-usage-count method is a viable way to keep finding this class of bug in the remaining, not-yet-audited modules.

**Remaining Technical Debt:**
- This was a systematic pass over `window.*` globals only — it doesn't catch dead code that never got exported to `window` (purely internal-to-a-file dead functions/variables), nor dead CSS, nor dead Supabase columns/tables. Those need their own pass.
- **Found but deliberately NOT removed — flagged for a decision, not a bug:** `modules/world-boss/loot-rain.js` has a fully-built function, `window.wblrRewardCardsHTML(bossIdx)`, that renders a complete set of reward cards (name, rarity, remaining count, claim limit, per-student claimed count) — and it is never called from anywhere in the codebase. This is bigger and more central to student-facing UI than the four one-line fixes above, so it was left alone this session rather than assumed-and-deleted: it might be finished-but-never-wired-in (a real bug — something should be calling this and isn't) rather than superseded dead code. Needs a human decision on which. Two smaller, lower-stakes finds in the same area, also left alone: `wblrRemainingTotal` (a one-line helper whose logic is already duplicated inline inside `wblrLootSummary`) and `window._BS_PALETTES` (a debug/console-access export, same category as the `__*_MODULE_VERSION__` stamps — likely intentional, not a bug).
- Verified in this environment: `npm run lint` → 0 errors (unchanged from the previous entry), `npm run test:unit` → 25/25 passing, `npx playwright test --list` → still discovers all 6 smoke tests correctly. **Not** re-verified: an actual `npm run test:smoke` run (same sandbox limitation noted throughout this log) — recommended before treating this as fully closed, same as the previous entry.

**CI Gate Added:** None new.

### Phase 2 — Security Hardening
**Date:** 2026-07-21

**Problem:** `_esc()` was missing at the two sites the audit named (`world-boss/leaderboard.js`, `leaderboard/hall-of-fame.js`) for user-influenced `name`/`profilePic` fields going into `innerHTML`. While fixing those, found the Phase 0 safety net meant to catch exactly this class of bug had a structural hole: the lint rule intended to flag raw `.innerHTML =` assignments had never actually run. Separately audited the authorization side (client-side `currentRole === 'admin'` checks vs. server-side RLS/RPC enforcement) across every admin-only mutating RPC in `supabase/`.

**Root Cause:**
- **Escaping:** no shared, enforced rendering path — escaping is opt-in per author, not structural, exactly as the audit described.
- **The dead lint rule (the bigger finding):** `eslint.config.js` had two separate config blocks, both matching `**/*.js`, both setting the built-in `no-restricted-syntax` rule key — one for the innerHTML check (Phase 0's "audit finding #2"), one for the `DB.*` mutation check (Phase 0's "audit finding #3"). In ESLint's flat config, when two config objects match the same file and set the same rule key, the later object's value *replaces* the earlier one wholesale rather than merging array entries. The DB.* block came later in the array, so it silently ate the innerHTML selector. Confirmed with `eslint.calculateConfigForFile()`: for any file matching both blocks, only the DB.* selector survived. Every one of the 334 raw `.innerHTML =` sites in this codebase has had zero lint enforcement since Phase 0 shipped — this is almost certainly how the leaderboard/hall-of-fame bug got past a rule that was supposedly guarding exactly that.
- **Authorization:** the SQL migration history shows the pattern the audit predicted — `create_class_section`/`update_class_section`/`archive_class_section`/`unarchive_class_section` were originally `SECURITY DEFINER` functions granted to `anon, authenticated` with zero role check (Phase 4), letting any authenticated session — a student's own login included — create/rename/archive any section. This was already found and fixed reactively in `phase39_section_maker_auth_fix.sql`, which gates all four behind `is_staff()`/`is_staff_for_section()`. A systematic re-check of all 45 admin-invoked RPCs (script cross-referencing each RPC's *latest* definition across every `supabase/*.sql` phase file, not just its original one) found no *currently live* gap of this shape — every present-day mutating admin RPC has a matching `is_staff()`/`is_admin()`/`is_staff_for_section()`/equivalent `auth.uid()` check. The handful without one of those exact markers (`check_registration_status`, `check_teacher_invite`, `get_school_settings`, `log_client_error`, `redeem_teacher_invite`, `submit_registration`, `touch_presence`) were manually reviewed and are legitimately public/self-service/read-only endpoints (pre-auth registration/invite lookups, a client-error logger, a presence heartbeat gated on `auth.uid()`, and a read-only settings getter whose *write* counterpart `save_school_settings` does check `is_admin()`), not admin-only actions missing a check.

**Files Changed:**
- `modules/world-boss/leaderboard.js` — escaped `studentName`/`studentInit` (podium + row rendering, 4 sites)
- `modules/leaderboard/hall-of-fame.js` — escaped `name`/`displayName`/`profilePic`/`init` (podium card, row rendering, "Your Standing" bar — 8 sites)
- `modules/admin/analytics.js` — escaped `init`/`name` in two student tables (root duplicate `analytics.js`, already flagged dead in the Phase 1 log entry but still present in this working tree, had the same gap and was deleted rather than fixed, per that entry's already-verified conclusion)
- `modules/achievements/ach_admin_page.js`, `modules/titles/titles_admin_page.js` — escaped achievement/title/student names in grant/revoke `toast()` calls
- `modules/admin/student-manager.js` — escaped student name in an `<option>` list
- `modules/recitation/progress.js` — escaped student name/init/profilePic in the academic showcase share card
- `modules/shop/shop_pos_terminal.js` — escaped item/student names in claim/charge `toast()` calls and a result panel
- `modules/world-boss/student-page.js` — escaped `studentInit`/`studentName` in two damage-rank list renderers
- `eslint.config.js` — removed the dead `no-restricted-syntax` innerHTML selector (see Root Cause); replaced with two standalone plugin rules that can't collide with the DB.* check
- `eslint-rules/no-raw-innerhtml-assignment.js` (new) — the innerHTML check, now as its own plugin rule (`warn`, matching the DB.* rule's already-established posture — 334 pre-existing sites is a floor to work down, not a one-session fix)
- `eslint-rules/no-unescaped-db-field-in-html.js` (new) — a narrower, `error`-level rule matching the audit's actual ask: flags a known student-identity field (`name`/`displayName`/`profilePic`/`studentName`/`studentInit`/`init`, the last two gated to student-shaped object names so it doesn't also flag `boss.name`/`item.name`/`title.name`/`skill.name`) interpolated raw into an HTML-shaped template literal *or* passed straight to `toast()`/`showModal()` (both do `el.innerHTML = msg` internally in `dom.js`, so a plain-looking `toast(\`Granted "${title.name}" to ${student.name}!\`)` with no `<tag>` in sight is just as exploitable)

**Architecture Before:** Escaping was per-author discipline with a lint rule that looked like it enforced this but structurally never fired. Nine additional unescaped student-identity sites existed beyond the two the manual audit had found, several of them via `toast()`, a sink that isn't obviously "innerHTML" from the call site.

**Architecture After:** All 19 unescaped student-identity call sites found (2 originally flagged + 9 more the new rule surfaced, several with multiple sites) now route through `_esc()`. The innerHTML lint check is a real, firing rule again (previously dead), split from the DB.* check so the same config collision can't silently disable either one again. A new, narrower rule gives `error`-level, zero-tolerance enforcement specifically for student-identity fields — the exact shape of bug this phase was opened to fix — without the false-positive noise of flagging every entity's `.name`.

**Why This Is Better:** The original ask ("fix the two known files, then make it structural so it can't regress") undersold the actual gap — the structural enforcement had already silently failed once, and doing the "make it structural" step first (rather than declaring the two-file fix done and moving on) is what surfaced 9 more real instances. Authorization is now a documented, verified matrix rather than an assumption; the one real historical gap matches what the audit predicted and was already closed in a way this phase could independently confirm, rather than take on faith.

**Remaining Technical Debt:**
- `eduquest/no-raw-innerhtml-assignment` is `warn`-level with 319 remaining pre-existing sites (334 minus the ~15 addressed above where the assignment itself, not just an interpolated value, needed a look) — this is a floor for future phases to work down, same posture as the Phase 0 `DB.*` rule, not a one-session fix.
- `eduquest/no-unescaped-db-field-in-html`'s danger list (`displayName`, `studentName`, `studentInit`, `profilePic`, plus `name`/`init` gated to student-shaped objects) is a maintained allowlist, not exhaustive taint tracking — if a new user-controlled text field is introduced (e.g. a free-text bio), it needs to be added to the rule explicitly.
- Did not attempt CSS-injection-via-style-attribute (`${p.studentColor}` interpolated raw into `style="..."` throughout both files) — `studentColor` and `studentInit` appear to come from a fixed set of palette values/short computed strings rather than free text in every path checked, but this wasn't exhaustively traced through every write path the way `name`/`profilePic` were, since the audit's problem statement was specifically about `name`/`profilePic`. Worth a dedicated pass if student-facing color/avatar customization is ever made more free-form.
- The authorization audit was RPC-level (every admin-invoked RPC's latest definition checked for a role guard) rather than a full RLS-policy-by-policy review of every table; RLS policies themselves weren't individually re-read line by line.
- Verified in this environment: `npm run lint` → 0 errors (537 warnings: 319 raw-innerhtml, 75 DB.*, 143 pre-existing `no-unused-vars`), `npm run test:unit` → 25/25 passing. **Not** re-verified: `npm run test:smoke` against a live Supabase project — same sandbox limitation as every previous phase (no Playwright browser binary download, no test-project credentials available here).

**CI Gate Added:** `eduquest/no-unescaped-db-field-in-html` is `error`-level in the existing Phase 0 `lint-and-unit` CI job — a regression of this specific bug shape will now fail CI. `eduquest/no-raw-innerhtml-assignment` is `warn`-level (visible in CI output, non-blocking), same posture as the existing `DB.*` mutation rule.

### Phase 3 — Single Source of Truth (module: `modules/shared/`)
**Date:** 2026-07-21

**Problem:** Of `modules/shared/`'s nine files, only `notification-service.js` touched `DB` directly (17 references) — the other eight (`ambient-backdrop.js`, `button-loading.js`, `mascot-lines-service.js`, `particles.js`, `quick-jump.js`, `reward-presenter.js`, `sequence.js`, `stat-bars.js`) had zero `DB.*` references already. Chosen as the Phase 3 starting module per the roadmap's "smallest blast radius first" guidance — a leaf directory with a single offending file.

**Root Cause:** `notification-service.js` (Phase 67) was written entirely against the legacy `DB`/`saveDB()` globals, predating (or simply never revisiting) the `AppStore` mutation gate.

**Files Changed:**
- `modules/shared/notification-service.js` — every `DB.*` read replaced with `AppStore.getSlice(s => s.<key>)`; every direct `DB.notifications = ...` / `n.read = true; saveDB()` write replaced with `AppStore.updateState(draft => {...}, event)`. No public API, DOM structure, or behavior changed — see below for the one write-path correctness note.
- `eslint.config.js` — added a `modules/shared/**/*.js`-scoped block that promotes the existing repo-wide `no-restricted-syntax` DB.* check from `warn` to `error` for this directory only, since it's now fully migrated (per the roadmap: "add a lint rule *for that directory* forbidding new direct `DB.*` writes").

**Architecture Before:** `synthesize()`, `_myNotifs()`, `markRead()`, `markAllRead()`, and `openRow()` all read/wrote `window.DB` directly, relying on `DB.notifications` being a live, shared reference so that mutating a found notification object in place (then calling `saveDB()`, which calls `AppStore.syncFromLegacy(window.DB)`) would eventually reach `AppStore`'s internal `_state`.

**Architecture After:** All reads go through `AppStore.getSlice()`, which returns a clone. All writes go through `AppStore.updateState()`, the sole mutation gate — `markAllRead()`/`openRow()`/`markRead()` now build their mutation inside the `updateState` draft callback instead of mutating a previously-read clone (mutating a `getSlice()` clone would silently no-op against real state, which is exactly the aliasing hazard this phase exists to close). Read-then-conditionally-write ordering was preserved (a pre-check against a fresh `getSlice()` read still gates whether `updateState()` — and its persist + subscriber notify — fires at all), so a no-op click on an already-read notification still doesn't trigger a write.

**Why This Is Better:** Removes the last file in `modules/shared/` that could bypass `AppStore`'s clone/commit/persist/notify pipeline. The old pattern happened to work only because every call site remembered to call `saveDB()` after mutating `DB` in place — a convention, not something the type system or `AppStore`'s API enforced. The new lint rule makes a regression in this specific directory a CI error, not a warning.

**Remaining Technical Debt:**
- 58 other files across the codebase still reference `DB.*` directly (1,007 references at Phase 3's opening minus notification-service.js's 17); this entry closes out `modules/shared/` only, per the "don't batch multiple modules into one unreviewed change" instruction.
- `synthesize()`'s three `AppStore.getSlice()` calls (`notifications`, `pointLog`, `orders`) each deep-clone their full array on every `NotificationService.refresh()` call (fired from `updateTopbar()` on every state change) — same cost profile as the original `DB.pointLog`/`DB.orders` reads, so not a regression, but worth revisiting if `pointLog`/`orders` grow large; not in scope for this phase (Phase 3 is call-site migration only, `AppStore`'s public API is frozen per the roadmap).
- Full lint run shows 6 pre-existing errors unrelated to this change, in `analytics.js`/`modules/admin/analytics.js` (the root-level duplicate `analytics.js` the Phase 1 log says was deleted but is still present in this working tree, and 2 unescaped-field sites in it that Phase 2's fix pass didn't reach because it targeted the file Phase 1 said was already gone). Not touched here — orthogonal to Phase 3 and already tracked against Phase 1/2.
- Verified in this environment: `node --check` on the modified file, targeted `eslint` run (0 errors, 3 pre-existing warnings — down from 5, the 2 `DB.*` warnings this migration removes), full-repo `eslint .` (6 pre-existing errors as noted above, all unrelated; no new errors), `node --test tests/unit/**/*.test.js` → 25/25 passing (no existing unit test exercises this file directly). **Not** re-verified: `npm run test:smoke` (same sandbox limitation as every previous phase — no Playwright browser binary / live Supabase project here).

**CI Gate Added:** `no-restricted-syntax` (DB.* mutation) is now `error`-level for `modules/shared/**/*.js` specifically, layered on top of the existing repo-wide `warn`-level rule.

### Phase 3 — Single Source of Truth (module: `modules/attendance/`)
**Date:** 2026-07-21

**Problem:** Of `modules/attendance/`'s four files, two (`att_scanner_rfid.js`, `att_index.js`) had `DB.*`-shaped references; the other two (`attendance-recitation-log.js`, `attendance-service.js`) were already clean — `attendance-service.js` in particular is already a fully `AppStore`-based service module (see its `AppStore.updateState()`/`AppStore.getSlice()` calls used as a style reference for this migration). `att_index.js`'s only match was a comment describing already-deleted legacy code, not live code. `att_scanner_rfid.js` was the real target: 3 direct `DB.students` reads plus 3 `DB = loadDB()` legacy-bridge reassignments that fed them, sitting inside a file that already used `AppStore.getState()`/`AppStore.getSlice()` everywhere else — an inconsistent, partially-migrated file rather than an unmigrated one.

**Root Cause:** Same as the general Phase 3 root cause — these three call sites predate (or weren't touched during) this file's partial `AppStore` adoption.

**Files Changed:**
- `modules/attendance/att_scanner_rfid.js`:
  - `renderRfidScanner()`: removed a `DB = loadDB()` call that had become entirely dead — the function already computes `const state = AppStore.getState()` two lines below it, and (after the next change) nothing in the function reads `DB` at all.
  - The same function's classIds fallback: `DB.students` → `state.students` (using the `AppStore.getState()` result already in scope, instead of a separate legacy read).
  - `_rfidOpenAssignPicker()`: `DB = loadDB(); ... DB.students` → `AppStore.getSlice(s => s.students)`.
  - `_rfidOpenSettings()`: same pattern — `DB = loadDB()` removed, `DB.students` in the assign-card `<select>` template replaced with a `students` const fetched via `AppStore.getSlice(s => s.students)` once at the top of the function.
- `eslint.config.js` — extended the `modules/shared/**/*.js`-scoped error-level DB.* rule (added last session) to also cover `modules/attendance/**/*.js`.

**Architecture Before:** A file already built around `AppStore` for most of its reads, but with three leftover spots that dropped back to the legacy `DB`/`loadDB()` global — an easy trap for whoever edits this file next to copy, since both patterns visibly coexisted.

**Architecture After:** Every read in this file goes through `AppStore.getState()`/`AppStore.getSlice()`/`AppStore.getStudent()`; no direct `DB.*` reads or `DB = loadDB()` legacy-bridge reassignments remain in live code (the two remaining textual matches are both comments — one describing this module's own read boundary, one describing already-deleted legacy code).

**Why This Is Better:** Removes the inconsistency, not just the count — a file that's "mostly migrated" is arguably worse than one that's "not migrated," since it invites the next edit to follow whichever nearby pattern is closest instead of the correct one.

**Remaining Technical Debt:**
- The `no-restricted-syntax` selector this phase's CI gate relies on (`AssignmentExpression[left.object.name='DB']`) only matches `DB.x = ...` writes — it does **not** match a bare `DB = loadDB()` reassignment (that's an assignment to the identifier `DB` itself, not a member expression on it). So the new `modules/attendance/` error-level gate would not have caught the `DB = loadDB()` pattern removed in this entry, and won't catch a regression of that specific shape either. Worth a follow-up lint rule (`AssignmentExpression[left.name='DB']`) if this pattern shows up again elsewhere — flagged here rather than silently assumed-covered.
- Same repo-wide caveat as the previous entry: this closes out `modules/attendance/` only; ~950+ `DB.*` references remain across the rest of the codebase.
- Verified in this environment: `node --check` on the modified file, targeted `eslint modules/attendance/` (0 errors, 23 pre-existing warnings, none new), full-repo `eslint .` (same 6 pre-existing unrelated errors as the previous entry, no new errors), `node --test tests/unit/**/*.test.js` → 25/25 passing. **Not** re-verified: `npm run test:smoke` (same sandbox limitation as every previous phase).

**CI Gate Added:** `no-restricted-syntax` (DB.* mutation) is now `error`-level for `modules/attendance/**/*.js` in addition to `modules/shared/**/*.js` — see the Remaining Technical Debt note above on this gate's blind spot for bare `DB = ...` reassignment.

### Phase 3 — Single Source of Truth (module: `modules/section/`)
**Date:** 2026-07-21

**Problem:** `modules/section/` has a single file, `my-section.js` (the student "My Section" page), with 12 `DB.*`-shaped references — all inside its documented offline/local-only fallback path (the primary path is a `get_my_section_info()` Supabase RPC that never touches `DB` at all; the fallback only runs if Supabase is unconfigured or the RPC call fails). All 12 were reads, no writes.

**Root Cause:** Same general Phase 3 root cause — the fallback path was written directly against the legacy `DB` global rather than `AppStore`.

**Files Changed:**
- `modules/section/my-section.js`:
  - `_mySectionFetch()`'s local fallback: removed `DB = loadDB()`; `DB.students`, `DB.equippedTitles`, `DB.admin`, `DB.achievements`, `DB.quizzes`, `DB.stageMap`, `DB.store` all replaced with the corresponding `AppStore.getSlice(s => s.<key>)` calls.
  - `_mySectionStudentCardHTML()` used `DB.titles` inside a per-classmate render loop. Rather than call `AppStore.getSlice(s => s.titles)` once per classmate card (which would clone the whole titles array once per student on the roster), hoisted a single `AppStore.getSlice(s => s.titles)` call up into `_mySectionPaint()` and added a `titles` parameter to `_mySectionStudentCardHTML(c, i, st, titles)` — a private, file-local function with one call site, so widening its signature doesn't ripple anywhere else.
  - Updated the file's header comment (previously described the fallback as reading "`DB.students`"/"`DB.admin`") to describe the `AppStore`-based fallback accurately.

**Architecture Before:** The offline fallback path read seven different `DB.*` slices directly, including one (`DB.titles`) re-read from scratch on every classmate card instead of once per page render.

**Architecture After:** Every read in this file goes through `AppStore.getSlice()`; the titles lookup happens once per page render instead of once per classmate. Zero textual `DB` references remain anywhere in the file, including comments.

**Why This Is Better:** Same single-source-of-truth rationale as the previous two entries, plus a small, free performance fix (one clone of the titles array per page instead of one per classmate) that fell out of doing the migration properly rather than mechanically.

**Remaining Technical Debt:**
- Same repo-wide caveat as the previous two entries — this closes out `modules/section/` only.
- This file's fallback path is rarely exercised in practice (only when Supabase is down/misconfigured), so this migration is more about closing the audit's `DB.*` count and consistency than fixing an active bug — flagged here so it isn't mistaken for a hotter code path than it is.
- Verified in this environment: `node --check` on the modified file, targeted `eslint modules/section/` (0 errors, 3 pre-existing warnings, none new), full-repo `eslint .` (same 6 pre-existing unrelated errors as previous two entries, no new errors), `node --test tests/unit/**/*.test.js` → 25/25 passing. **Not** re-verified: `npm run test:smoke` (same sandbox limitation as every previous phase).

**CI Gate Added:** `no-restricted-syntax` (DB.* mutation) is now `error`-level for `modules/section/**/*.js` in addition to `modules/shared/**/*.js` and `modules/attendance/**/*.js`.

### Phase 3 — Single Source of Truth (module: `modules/recitation/`)
**Date:** 2026-07-21

**Problem:** `modules/recitation/` has three files; `recitation_index.js` had zero `DB.*` references. `logger.js` (5 real references) had this phase's first actual *write* path so far — `DB.students[idx].xp += pts` plus prepends to `DB.recitationLog` and `DB.pointLog`, all committed via `saveDB()`. `progress.js` (6 references, one a stray `DB = loadDB()`) had four read sites feeding the student "My Progress" page.

**Root Cause:** Same general Phase 3 root cause.

**Files Changed:**
- `modules/recitation/logger.js` — `logRecitation()` rewritten: looks up the student via `AppStore.getStudent(sid)` instead of `DB.students.findIndex()`; the xp bump and both log prepends now happen inside one `AppStore.updateState()` draft callback (event `recitation:logged`) instead of three separate `DB.*` mutations followed by `saveDB()`. `syncStudentStatsToServer(sid, pts, 0)` — the RPC that reconciles authoritative server totals back in (see `utils.js`) — still fires right after, same order as before.
  - **Also fixed a latent unescaped-name issue this change surfaced:** the closing `toast()` call read `DB.students[idx].name` — a computed member expression the Phase 2 `no-unescaped-db-field-in-html` rule's naming heuristic doesn't recognize as "student-shaped," so it was never flagged. Migrating to `AppStore.getStudent()` produced a plain `student` variable, and `student.name` in the same `toast()` call **did** trip the rule (`toast()` does `el.innerHTML = msg` internally — see Phase 2's entry). Wrapped it in `_esc()`. This was a real pre-existing gap in escaping coverage that the refactor's own tooling caught as a side effect of the naming change, not a regression introduced by this migration — flagged explicitly rather than silently fixed.
- `modules/recitation/progress.js` — `progGetRecitationsForStudent()` (`DB.recitationLog` → `AppStore.getSlice(s => s.recitationLog)`), `progBuildCalendar()` (`DB.pointLog` → `AppStore.getSlice(s => s.pointLog)`), `progRenderShowcase()` (`DB.achievementUnlocks`/`DB.achievements`/`DB.titles`/`DB.students` → `AppStore.getSlice()`, with the achievements/titles slices hoisted once above their `.map()` calls rather than re-fetched per unlocked item — same clone-avoidance pattern as the `modules/section/` entry). Removed a `DB = loadDB()` in `renderStudentProgress()` that existed solely to refresh the module-level `DB` global before these reads; it's no longer needed since every read now fetches its own current slice directly. (Notably, `progShowCalDay()` — reachable from calendar-day clicks without going through `renderStudentProgress()` first — was already implicitly relying on whichever render happened to run last to have refreshed `DB`; this migration removes that hidden coupling for every call path, not just the one that used to carry the explicit refresh.)
- `eslint.config.js` — extended the per-directory error-level DB.* gate to `modules/recitation/**/*.js`.

**Architecture Before:** `logger.js` mutated `DB` directly in three places, then called `saveDB()` — bypassing `AppStore`'s abort-on-error atomicity (a throw partway through would have left `DB` partially mutated before Phase 3, vs. an all-or-nothing draft under `AppStore.updateState()`). `progress.js`'s reads depended on a `DB = loadDB()` refresh that only one of its two entry points (`renderStudentProgress`) actually performed.

**Architecture After:** `logRecitation()`'s three-part write commits atomically through `AppStore.updateState()`. Every read in `progress.js` is self-sufficient — no call path depends on another function having refreshed a shared global first.

**Why This Is Better:** Closes a real atomicity gap (not just a style one) in the recitation write path, and removes a genuine hidden-coupling bug class in `progress.js` (a function correct only because of the order other functions happened to run in). The escaping fix in `logger.js` is a concrete example of Phase 2 and Phase 3 tooling reinforcing each other — the state migration surfaced a gap the security phase's rule couldn't previously see.

**Remaining Technical Debt:**
- Same repo-wide caveat as previous entries — ~925 `DB.*` references remain outside the four modules closed so far.
- `syncStudentStatsToServer()` (in root-level `utils.js`, not a `modules/` directory and therefore not in scope for this per-module pass) has its own direct `DB.students` mutation in its RPC-resolution callback (`s.xp = row.xp; ...`), alongside the `AppStore.updateState()` call it also makes in the same callback — i.e., it already does the "right" thing once, immediately followed by a legacy `DB.*` write mutating the same conceptual data a second time. Not touched here since `utils.js` isn't a `modules/*` leaf directory this phase's per-module pass targets, but flagged for whichever session tackles root-level files.
- Verified in this environment: `node --check` on both modified files, targeted `eslint modules/recitation/` (0 errors — down from 1 after the escaping fix — 4 pre-existing warnings), full-repo `eslint .` (same 6 pre-existing unrelated errors as previous entries, no new errors), `node --test tests/unit/**/*.test.js` → 25/25 passing. **Not** re-verified: `npm run test:smoke` (same sandbox limitation as every previous phase).

**CI Gate Added:** `no-restricted-syntax` (DB.* mutation) is now `error`-level for `modules/recitation/**/*.js` in addition to the three directories closed in previous entries.

### Phase 3 — Single Source of Truth (module: `modules/leaderboard/`)
**Date:** 2026-07-21

**Problem:** All four files in this directory except `index.js` had `DB.*` references (35 total). `eql-engine.js` (largest, 27 references) had both a config read/write path (`getConfig`/`setEnabled`/`resetPeriod`/`clearReset`, plus a startup migration block) and — the more interesting part — five read sites (`recitationLog`, `bossEvents`, `bossParticipants`, `pointLog`, `students`) called from inside `eqlBuildCategory()`'s per-student `.map()` over the whole class roster. `hall-of-fame.js` had the identical full-roster-loop pattern in `renderLeaderboard()` (calling the same `eqlCompute*` functions per student) plus 2 achievement-lookup reads in `_holGetTitle()`. `admin-leaderboard.js` had 1 config read.

**Root Cause:** Same general Phase 3 root cause, but with a performance wrinkle specific to this module: `eqlComputeRecitation`/`eqlComputeBoss`/`eqlComputeAcademic`/`eqlComputeOverall` are also called as globals from two files *outside* this directory (`modules/recitation/progress.js` — a single, non-looped call — and `utils.js`'s `eqGetTopQuestersThisWeek()`, which loops but lives in a root file out of this pass's scope). A naive per-call `AppStore.getSlice()` swap would have been correct but meant `eqlBuildCategory()` and `renderLeaderboard()` each cloning `recitationLog`/`bossEvents`/`bossParticipants`/`pointLog`/`students` once per student in the roster, instead of once per render — `AppStore.getSlice()` clones its result, unlike the old live-reference `DB.*` read, so this cost is new with the migration, not something that existed before.

**Files Changed:**
- `modules/leaderboard/eql-engine.js`:
  - `eqlComputeRecitation`, `eqlComputeBoss`, `eqlComputeAcademic`, `eqlComputeOverall` each gained an **optional third parameter, `cache`** — a bundle of pre-fetched slices. When omitted, each function falls back to its own `AppStore.getSlice()` call (functionally identical to before, just via `AppStore` instead of `DB`), so `progress.js`'s and `utils.js`'s existing 2-argument calls are completely unaffected — this is additive, not a breaking signature change.
  - `eqlBuildCategory()` now builds one `cache` bundle (`recitationLog`, `bossEvents`, `bossParticipants`, `pointLog`, `students`) per call and passes it into every per-student compute call in its `.map()` — one set of clones per render instead of one set per student.
  - The `AppStore.ready.then()` startup migration block rewritten to go through `AppStore.updateState()` — see the bugfix note below.
  - `window.EQL.getConfig/setEnabled/resetPeriod/clearReset/getStats` all migrated to `AppStore.getSlice()`/`AppStore.updateState()`, following the same read-then-conditionally-write pattern as previous write-path entries (only calls `updateState()` when the target key actually exists).
  - **Fixed a latent bug found during migration:** the original startup migration's non-destructive per-key backfill loop (`if (!DB.leaderboardConfig[k]) DB.leaderboardConfig[k] = ...`) mutated `DB` directly but was never followed by its own `saveDB()` call — only the *entirely-missing-config* branch above it called `saveDB()`. So if a device already had a `leaderboardConfig` object on disk but was missing an individual category key (plausible if a category were added to the roadmap after some devices had already synced), the backfill would silently not persist and re-run (uselessly) on every subsequent load. Both branches now go through `AppStore.updateState()`, which always persists.
  - Updated the file's header comment (`Depends on globals: DB, saveDB()` → `AppStore`) and the three data-provenance comments above each pillar's compute function.
- `modules/leaderboard/hall-of-fame.js`:
  - `_holGetTitle()`'s two achievement-lookup reads → `AppStore.getSlice()`. Left uncached (called once per row/card) since achievement definitions/unlocks are bounded by achievement count, not activity history, unlike the arrays above — noted as a candidate for the same cache treatment if it ever proves hot in practice.
  - `renderLeaderboard()`: `DB.leaderboardConfig`/`DB.students` → `AppStore.getSlice()`; applied the identical shared-cache pattern as `eqlBuildCategory()` (it independently loops the full roster calling the same `eqlCompute*` functions), passing the cache as each call's new third argument.
- `modules/leaderboard/admin-leaderboard.js`: `_cfg()`'s one config read → `AppStore.getSlice()`. Updated its file-header dependency comment (`db-schema.js → DB` / `app-state.js → saveDB()` → `state-manager.js → AppStore`).
- `modules/leaderboard/index.js`: updated its load-order comment, which listed `core/db.js (DB, saveDB)` as a dependency of this barrel — no longer true for any of its four files after this migration.
- `eslint.config.js` — extended the per-directory error-level DB.* gate to `modules/leaderboard/**/*.js`.

**Architecture Before:** Every read/write in this directory touched `DB` directly, including inside two independent full-roster render loops (`eqlBuildCategory`, `renderLeaderboard`) that would have each cloned five different slices once per student if migrated naively.

**Architecture After:** All reads/writes go through `AppStore`. The two full-roster loops each build one shared cache bundle per render and thread it through via an optional, backward-compatible third parameter on the four `eqlCompute*` functions — external 2-argument callers (`progress.js`, `utils.js`) are unaffected.

**Why This Is Better:** Closes the `DB.*` count for this directory while explicitly designing around this migration's one real performance trap (turning "free" repeated reads of a live reference into paid clones inside a hot loop) rather than accepting a silent per-student-clone regression. Also fixes a genuine persistence bug in the config backfill path.

**Remaining Technical Debt:**
- Same repo-wide caveat as previous entries — this closes out `modules/leaderboard/` only.
- `utils.js`'s `eqGetTopQuestersThisWeek()` (root file, out of scope for this per-`modules/*`-directory pass) still reads `DB.students` directly and calls `eqlComputeAcademic(s.id, resetAt)` in its own per-student loop without a cache — it would benefit from the same third-argument cache this entry introduced, once `utils.js` itself is in scope for a migration pass.
- `_holGetTitle()`'s achievement reads were deliberately left uncached (see above) — flagged as a candidate for the cache pattern if it proves to matter at scale, rather than pre-optimizing speculatively.
- Verified in this environment: `node --check` on all four modified files, targeted `eslint modules/leaderboard/` (0 errors, 7 pre-existing warnings, none new), full-repo `eslint .` (same 6 pre-existing unrelated errors as previous entries, no new errors — total warning count dropped as this directory's DB.* warnings were removed), `node --test tests/unit/**/*.test.js` → 25/25 passing. **Not** re-verified: `npm run test:smoke` (same sandbox limitation as every previous phase) — this entry touches render-heavy code (leaderboard podium/rows, admin panel) that a real browser pass would be worth prioritizing once Playwright is available in this environment.

**CI Gate Added:** `no-restricted-syntax` (DB.* mutation) is now `error`-level for `modules/leaderboard/**/*.js` in addition to the four directories closed in previous entries.

### Phase 3 — Single Source of Truth (module: `modules/mail/`)
**Date:** 2026-07-21

**Problem:** All four files in this directory had `DB.*` references (40 total). `mail-engine.js` (11 references) had two write paths — `mailMarkRead()` and `mailClaimRewards()` — both following the now-familiar pre-Phase-3 pattern: find an object via a live `DB.*` reference, mutate it in place, call `saveDB()`. `admin-compose.js` (18 references) is the full admin CRUD surface for mail (compose/send/edit/delete). `student-inbox.js` (7 references) is mostly read-only, plus two `DB = loadDB()` refreshes.

**Root Cause:** Same general Phase 3 root cause.

**Files Changed:**
- `modules/mail/mail-engine.js`:
  - `mailGetForStudent()`: `DB.mail` → `AppStore.getSlice(s => s.mail)`.
  - `mailMarkRead()`: rebuilt around a pre-check read (same "already read, skip" guard as before) followed by one `AppStore.updateState()` draft callback for the actual flag flip — same pattern as the `modules/recitation/` and prior entries' write-path migrations.
  - `mailClaimRewards()` — the most involved single-function migration so far: reward granting (xp/coins/title), the mail's `claimedBy`/`readBy` flags, and the `pointLog` prepend all now happen inside one `AppStore.updateState()` draft callback. **Also had to move the `checkLevelUp()` call itself inside that same callback** — `checkLevelUp()` mutates its argument's `.level` in place, and the pre-migration code got away with calling it on `DB.students[sIdx]` only because `DB` was a legacy-bridge clone about to be persisted wholesale via `saveDB()`. Calling it on the *already-committed* student object after `AppStore.updateState()` returns would have mutated `AppStore`'s internal state directly, bypassing the mutation gate — exactly the failure mode this whole phase exists to close. Flagged explicitly in an inline comment so a future editor doesn't move it back out.
- `modules/mail/admin-compose.js`:
  - `renderAdminMail()`, `mailAdminOpenCompose()`, `mailAdminDelete()`: straightforward read migrations (`DB.mail`/`DB.students`/`DB.titles` → `AppStore.getSlice()`), with `students` hoisted once per call rather than re-read per mail row.
  - `mailAdminSend()`: the "compose new mail" branch's `DB.mail.push(newMail); saveDB();` → one `AppStore.updateState()` call.
  - **Fixed a real, independently-discovered persistence bug in the "edit existing mail" branch:** the pre-migration code mutated `DB.mail[idx]` directly but — unlike the "compose new" branch two paths below it — never called `saveDB()` afterward. `renderAdminMail()`, called two lines later, starts with `DB = loadDB()`, which reloads from *persisted* storage and silently discards the just-made, never-saved edit. The `update_mail_batch()` RPC had already succeeded server-side, so the edit wasn't lost — but the admin's own screen would keep showing the pre-edit content until the next real Supabase pull resynced it. Now goes through `AppStore.updateState()`, which always persists, so the local view reflects the edit immediately, consistent with what the RPC just did.
  - `mailAdminConfirmDelete()`: `DB.mail = DB.mail.filter(...); saveDB();` → `AppStore.updateState()`.
- `modules/mail/student-inbox.js`: `renderStudentMail()`'s `DB = loadDB()` was unnecessary (nothing in the function reads `DB` directly — `mailGetForStudent()` handles its own read) and removed; `mailOpenDetail()`'s two `DB.mail` reads (initial lookup + the post-`mailMarkRead()` refresh) → `AppStore.getSlice()`; `mailDoClaimRewards()`'s `onClose` callback had a `DB = loadDB()` that served no purpose (nothing between it and `renderStudentMail()` reads `DB`) and was removed.
- `eslint.config.js` — extended the per-directory error-level DB.* gate to `modules/mail/**/*.js`.

**Architecture Before:** Two independent, unrelated write paths in this directory (`mailClaimRewards` and `mailAdminSend`'s edit branch) both mutated `DB` directly and either forgot to persist (the edit-mail bug) or only "worked" because a mutated live-shared-reference happened to get picked up by a later `saveDB()` call.

**Architecture After:** Every write in this directory goes through `AppStore.updateState()`, which always persists and always notifies. Both real bugs found during this migration are structurally impossible to reintroduce in code that follows the new pattern — persistence isn't something a caller can forget to invoke, and mutating an already-committed object outside a draft callback isn't a normal thing this style of code does.

**Why This Is Better:** This entry has two genuine, independently-verified correctness fixes (not just style/consistency), on top of the usual single-source-of-truth rationale — arguably the highest-value module closed so far in this phase.

**Remaining Technical Debt:**
- Same repo-wide caveat as previous entries — this closes out `modules/mail/` only.
- `mail-engine.js`'s ESLint run flags `mailMarkRead` and `mailClaimRewards` as `no-unused-vars` — both are real, actively-called functions (from `student-inbox.js`, a different file in the same classic-script global scope), so this is a pre-existing false-positive limitation of file-scoped analysis for this codebase's shared-global-scope architecture, not something this migration introduced or should try to fix.
- `student-inbox.js`'s `isRead` variable in `mailOpenDetail()` is computed but never referenced in the returned template — pre-existing dead code, confirmed unrelated to this migration (still computed the same way, just via `AppStore` now); left as-is since removing it isn't a Phase 3 concern.
- Verified in this environment: `node --check` on all four modified files, targeted `eslint modules/mail/` (0 errors, 5 pre-existing warnings, none new), full-repo `eslint .` (same 6 pre-existing unrelated errors, no new errors), `node --test tests/unit/**/*.test.js` → 25/25 passing. **Not** re-verified: `npm run test:smoke` (same sandbox limitation as every previous phase) — this entry in particular touches a real reward-granting code path (`mailClaimRewards`) that would benefit strongly from an actual browser-driven smoke test (claim a reward end-to-end, confirm xp/coins/level-up all land correctly) once Playwright is available here.

**CI Gate Added:** `no-restricted-syntax` (DB.* mutation) is now `error`-level for `modules/mail/**/*.js` in addition to the five directories closed in previous entries.

### Phase 3 — Single Source of Truth (module: `modules/boss-studio/`)
**Date:** 2026-07-21

**Problem:** Five of this directory's six files had `DB.*` references (58 total); `bs_editor.js` had none. `bs_storage.js` (32 references — the largest single file migrated in this phase so far) is the core Boss Visual Profile (BVP) storage layer, and its central function `bsLoad()` did double duty: it read `DB.bossLibrary` **and** mutated each profile in place (backfilling missing `visual`/`schemaVersion` defaults, resolving `idb:` artwork refs into cached data-URLs) — relying entirely on `DB` being one live, shared object so that a `bsLoad()` call anywhere would "warm" the data for every other function that read `DB.bossLibrary` afterward. `bs_animation_library.js` (9 references) had its own parallel, fully self-contained CRUD surface for animation presets. `bs_library.js` (5), `bs_bve_engine.js` (3), and `bs_index.js` (3) had read-only sites plus one migration-guard block each.

**Root Cause:** Same general Phase 3 root cause, compounded in `bs_storage.js` specifically by a design that leaned on `DB.bossLibrary` staying the *same object* across calls — `AppStore.getSlice()`'s "fresh clone every call" behavior breaks that assumption outright, not just cosmetically.

**Files Changed:**
- `modules/boss-studio/bs_storage.js`:
  - `bsLoad()`: now clones via `AppStore.getSlice(s => s.bossLibrary)` and applies the same defaults-backfill/artwork-resolve enrichment to that fresh clone on every call, rather than mutating a shared object once. Cheap — bounded by library size (how many boss designs exist), not activity-history size like `recitationLog`/`pointLog` in earlier entries.
  - `bsGet(id)`: **now calls `bsLoad()` internally** instead of reading `DB.bossLibrary` directly. Pre-migration, this only worked because nearly every call site elsewhere in this directory follows a `bsLoad(); const x = bsGet(id);` pattern (confirmed in `bs_library.js`, `bs_bve_engine.js`) — an implicit call-order dependency this change removes. Every existing "call `bsLoad()` then `bsGet()`" call site still works identically, just with one harmless redundant internal read.
  - `bsUpsert()`, `bsDelete()`: migrated to `AppStore.updateState()`. `bsDelete()`'s best-effort IndexedDB cleanup now reads via `bsGet()` before the removal (same shape as the pre-migration `DB.bossLibrary[idx]` read it replaces).
  - `bsUpsertAsync()`: its "was this a different image before?" comparison deliberately reads via a **raw** `AppStore.getSlice(s => s.bossLibrary)` (not `bsLoad()`) — `bsLoad()` resolves `idb:` refs back into data-URLs, which would break the ref-identity comparison this function depends on to detect and clean up a replaced image. Preserved that distinction explicitly in a comment, since it would be an easy thing for a future edit to "simplify" incorrectly.
  - `_bsPatchRemoteUrlInPlace()`: preserved the original's deliberate ordering (queue the cross-device push using the still-`idb:`-ref version, before anything resolves it into a data-URL) by capturing the mutated object from inside the `AppStore.updateState()` draft callback itself and queueing it immediately — same "draft becomes committed state synchronously" reasoning used for `mailClaimRewards`'s `updatedStudent` in the previous entry.
  - `_bsInitRemoteLibrary()`, `_bsMigrateLegacyInlineImages()`, and the trailing startup migration guard: migrated to `AppStore.getSlice()`/`AppStore.updateState()`, same read-then-conditionally-write pattern as prior config-migration entries (`modules/leaderboard/`, `bs_index.js` below).
  - Updated several header/doc comments that described `DB.bossLibrary` as a JSON-safe live object; left the one genuinely unrelated "DB" mention (the IndexedDB connection singleton comment) untouched.
- `modules/boss-studio/bs_animation_library.js`: `_alLoad()`/`_alUpsert()`/`_alDeleteRecord()`/`_alAll()`/`alGet()` all migrated to `AppStore.getSlice()`/`AppStore.updateState()` — same shape as the `bs_storage.js` boss-profile CRUD, but for animation presets, and simpler since nothing here needed artwork-ref resolution.
- `modules/boss-studio/bs_library.js`: 4 read sites (`_bsRenderLibraryBody`, the two tab badge counts, `_bsExportAll`, and one more in `_bsRenderBossTab` caught on a second sweep) migrated to `AppStore.getSlice()`.
- `modules/boss-studio/bs_bve_engine.js`: `bveLinkBossProfile()`'s boss-picker read, and a legacy `DB.bossImages` fallback read, migrated to `AppStore.getSlice()`.
- `modules/boss-studio/bs_index.js`: the startup migration guard (ensuring `bossLibrary`/`animationLibrary` exist) migrated to `AppStore.updateState()`, following the same guard-before-write pattern as every prior config-migration entry.
- `eslint.config.js` — extended the per-directory error-level DB.* gate to `modules/boss-studio/**/*.js`.

**Architecture Before:** `bsLoad()`/`bsGet()` in `bs_storage.js` only worked correctly given a specific call order (`bsLoad()` before `bsGet()`), enforced by convention across every call site in the directory, not by either function's own design.

**Architecture After:** `bsGet()` is self-sufficient — it no longer matters whether `bsLoad()` was called first. Every write in this directory (boss profiles, animation presets, library-existence migration) goes through `AppStore.updateState()`.

**Why This Is Better:** Removes a real (if currently harmless, since every call site happened to follow the convention) hidden coupling — the same class of issue found and fixed in `modules/recitation/progress.js` a few entries back, but at the scale of an entire storage layer rather than one render function.

**Remaining Technical Debt:**
- Same repo-wide caveat as previous entries — this closes out `modules/boss-studio/` only.
- **Pre-existing, unrelated duplication noted but not touched:** `bs_index.js` and `bs_storage.js` each have their own, nearly-identical `AppStore.ready.then()` block initializing the same `bossLibrary`/`animationLibrary` keys. Both are guarded by an existence check, so this is harmless (idempotent), just wasteful and confusing to read. This is Phase 1 (dead/duplicate code) territory, not Phase 3's scope, so it wasn't touched here — flagged explicitly for whichever session picks up Phase 1's remaining work.
- **Pre-existing behavior preserved, not fixed:** `bsDelete()`'s best-effort IndexedDB cleanup (`_bsImgDelete(existing.artwork.value)`) only works if `existing.artwork.value` is still an unresolved `idb:` ref at that point — but nearly every real call path reaches `bsDelete()` after a `bsLoad()`/`bsGet()` call has already resolved it into a data-URL, meaning the cleanup silently no-ops (skips deleting the orphaned IndexedDB entry) in practice. This is not something this migration introduced — the pre-migration code had the identical property, for the identical reason (the same shared-object convention meant artwork was usually already resolved by the time `bsDelete()` ran). Left unchanged rather than fixed, since it's an IndexedDB storage-bloat concern, not a Phase 3 single-source-of-truth concern, and fixing it would mean deciding how `bsDelete()` should know the *pre-resolution* ref — a design question outside this migration's scope.
- Verified in this environment: `node --check` on all five modified files, targeted `eslint modules/boss-studio/` (0 errors, 42 pre-existing warnings, none new), full-repo `eslint .` (same 6 pre-existing unrelated errors as previous entries, no new errors), `node --test tests/unit/**/*.test.js` → 25/25 passing. **Not** re-verified: `npm run test:smoke` (same sandbox limitation as every previous phase) — this entry restructured `bsGet()`'s internal call chain non-trivially; a real browser pass exercising the boss editor's save/duplicate/delete/export flows would be the highest-value smoke test to prioritize once Playwright is available here.

**CI Gate Added:** `no-restricted-syntax` (DB.* mutation) is now `error`-level for `modules/boss-studio/**/*.js` in addition to the six directories closed in previous entries.

### Phase 3 — Single Source of Truth (module: `modules/campaign/`)
**Date:** 2026-07-21

**Problem:** All four files had `DB.*` references (63 total). `campaign_admin_map_editor.js` (30 references) is the full admin CRUD surface for campaign worlds and stages. `campaign_engine.js` (26 references) is the student-facing gameplay engine — visibility filtering, stage-progress tracking, a per-student skill-count cache, and the stage-clear reward grant. `campaign_stage_map.js` (5) and `campaign_index.js` (3) had read-only sites plus one migration-guard block each.

**Root Cause:** Same general Phase 3 root cause — plus two more instances of the same "mutate DB directly, forget to persist" bug shape already seen twice in earlier entries (`modules/leaderboard/`'s config backfill, `modules/mail/`'s edit-mail branch).

**Files Changed:**
- `modules/campaign/campaign_admin_map_editor.js`: full world/stage CRUD (`renderAdminStageMap`, `adminEditWorld`, `adminSaveNewWorld`, `adminSaveEditWorld`, `adminDeleteWorld`, `adminEditStage`, `adminSaveStage`, `adminDeleteStage`, `adminMoveStage`) migrated to `AppStore.getSlice()`/`AppStore.updateState()`. Deliberately preserved several of the original's fragile-but-intentional behaviors rather than "improving" them: `adminDeleteStage`/`adminDeleteWorld`/`adminMoveStage` still read `worlds[wi]`/`.stages[si]` without existence guards (matching the pre-migration code's identical willingness to throw on a bad index — these are only ever called with indices produced by this same file's own rendered buttons, so the fragility was never a live risk); `adminSaveStage` preserves the exact early-return-with-no-side-effects behavior when the target world doesn't exist.
  - **Found and fixed a real persistence bug in `adminSaveEditWorld()`:** after a successful `set_campaign_world_sections()` RPC, the pre-migration code mutated `DB.campaignSectionAssignments` directly but never called `saveDB()` — and `renderAdminStageMap()`, called two lines later, reloads from persisted storage as its first action, silently discarding the optimistic local update even though the server-side assignment had already gone through. Identical bug shape to `mailAdminSend()`'s edit branch from the `modules/mail/` entry. Now goes through `AppStore.updateState()`, which always persists.
- `modules/campaign/campaign_engine.js`: `getVisibleCampaignWorlds()`, `isStageCleared()`, `markStageCleared()` migrated to `AppStore.getSlice()`/`AppStore.updateState()`. `_campGetSkillCounts()`/`_campAdjustSkillLocal()` migrated similarly. The stage-clear reward grant (student xp/coins bump + pointLog entry) rebuilt around one `AppStore.updateState()` call, preserving the original's exact conditional structure — `markStageCleared()`/`updateTopbar()`/the achievement-check `setTimeout` still run unconditionally whenever `currentRole === 'student' && currentUser`, independent of whether the student record itself was found, matching the pre-migration code's nesting exactly.
  - **Found and fixed a second real persistence bug**, same shape as the one above: `_campSyncSkillDeltaToServer()`'s async RPC-success callback mutated `DB.studentSkills[studentId]` directly with no follow-up `saveDB()` call. Since this callback fires asynchronously — often after whatever `saveDB()` call happened to run earlier in the same tick — there was no guarantee this specific write ever got persisted; it could silently vanish on the next reload. Now goes through `AppStore.updateState()`.
- `modules/campaign/campaign_stage_map.js`: 3 read sites (`getMapProgress`'s admin-mode total, `renderWorldTabs`'s and `renderStageMap`'s fallback reads) migrated to `AppStore.getSlice()`; two now-unneeded `DB = loadDB()` calls removed.
- `modules/campaign/campaign_index.js`: the startup migration guard (`stageMap`/`stageProgress` existence) migrated to `AppStore.updateState()`, same guard-before-write pattern as every prior config-migration entry.
- `eslint.config.js` — extended the per-directory error-level DB.* gate to `modules/campaign/**/*.js`.

**Architecture Before:** Two independent async-callback write paths in this directory (`adminSaveEditWorld`'s section-assignment sync, `_campSyncSkillDeltaToServer`'s reconciliation) mutated `DB` directly with no guaranteed persistence step following them.

**Architecture After:** Every write in this directory goes through `AppStore.updateState()`, which always persists and always notifies — the same structural guarantee that made the two bugs above impossible to reintroduce accidentally in the earlier `modules/leaderboard/` and `modules/mail/` entries.

**Why This Is Better:** Two more genuine, independently-verified correctness fixes on top of the usual single-source-of-truth rationale — this is now the third and fourth instance of the identical "async callback mutates DB directly, nothing guarantees it gets saved" bug shape found across this phase (leaderboard config backfill, mail edit-branch, and these two), which is itself a useful signal about which coding pattern in the pre-migration codebase was most failure-prone.

**Remaining Technical Debt:**
- Same repo-wide caveat as previous entries — this closes out `modules/campaign/` only.
- `adminDeleteStage`/`adminDeleteWorld`/`adminMoveStage`'s lack of index-existence guards (preserved faithfully from the pre-migration code, per above) means a caller passing a stale `wi`/`si` still throws rather than failing gracefully. Not introduced or worsened by this migration — flagged only because a future session touching this file might reasonably want to harden it, and should know that's a deliberate carry-forward, not an oversight.
- Verified in this environment: `node --check` on all four modified files, targeted `eslint modules/campaign/` (0 errors, 19 pre-existing warnings, none new), full-repo `eslint .` (same 6 pre-existing unrelated errors as previous entries, no new errors), `node --test tests/unit/**/*.test.js` → 25/25 passing. **Not** re-verified: `npm run test:smoke` (same sandbox limitation as every previous phase) — this entry touches the admin map editor's full CRUD flow and the student-facing stage-clear reward path, both good candidates for a real browser smoke test once Playwright is available here.

**CI Gate Added:** `no-restricted-syntax` (DB.* mutation) is now `error`-level for `modules/campaign/**/*.js` in addition to the seven directories closed in previous entries.

### Phase 3 — Single Source of Truth (module: `modules/titles/`)
**Date:** 2026-07-21

**Problem:** Five of this directory's six files had `DB.*` references (89 total); `titles_badge_renderer.js` had none. `titles_admin_page.js` (38 references, the largest single-file count in this phase so far) is the full admin CRUD + grant/revoke surface. `titles_sidebar_refresh.js` (24) holds the core equip/unlock write paths every other file in the app calls into. `titles_designer.js` (13) is the title-creation modal. `titles_student_page.js` (10) is read-only. `titles_index.js` (4) had one migration-guard block.

**Root Cause:** Same general Phase 3 root cause — plus a fourth instance of the "async callback mutates DB directly, nothing guarantees it's persisted" bug shape from earlier entries, and a third instance of the "duplicate migration guard across two files" pattern from `modules/boss-studio/`.

**Files Changed:**
- `modules/titles/titles_sidebar_refresh.js`: `tsGetEquippedTitle`/`tsGetUnlockedTitles`/`tsIsUnlocked` (read-only helpers used throughout the whole app, not just this directory) migrated to `AppStore.getSlice()`. `tsEquipTitle()` and `tsUnlockTitleForStudent()` — the two functions every unlock/equip path in the entire codebase funnels through — migrated to `AppStore.updateState()`. The `bootApp` patch's migration guard also migrated, with an explicit note that it duplicates `titles_index.js`'s own guard (same "flagged, not fixed — Phase 1 territory" treatment as the identical `bs_index.js`/`bs_storage.js` duplication found in `modules/boss-studio/`).
- `modules/titles/titles_admin_page.js`: full CRUD (`renderAdminTitles`, `_buildAdminTitlesList`, `_buildAdminTitleStats`, `_tsRefreshAdminTitlesPanel`, `tsAdminDelete`, `tsAdminToggle`, `tsAdminDuplicate`) plus the grant/revoke modal (`tsAdminGrantModal`, `tsAdminGrantRefreshStudentTitles`, `tsAdminGrantConfirm`, `tsAdminRevokeTitle`) all migrated. `tsAdminDelete()`'s cascading delete (title + all its unlocks + unequip everywhere it was equipped) — previously three separate `DB.*` mutations — now commits as one `AppStore.updateState()` call. `_buildAdminTitlesList`/`_buildAdminTitleStats` each hoist their shared `titleUnlocks`/`equippedTitles`/`achievements`/`titleSectionAssignments` reads once outside their per-title `.map()` loops, same clone-avoidance pattern used in the `modules/leaderboard/` and `modules/section/` entries.
- `modules/titles/titles_designer.js`: `tsAdminOpenDesigner()`'s three reads migrated; `tsAdminSave()` migrated to `AppStore.updateState()`, preserving the exact "don't regenerate `d.id` on create" comment and logic (this file's own prior fix for a real bug, kept intact through the migration).
  - **Found and fixed a fourth instance of the never-persisted-async-mutation bug:** after a successful `set_title_sections()` RPC, the pre-migration code mutated `DB.titleSectionAssignments` directly with no `saveDB()` call — memory-only, silently lost on the next reload from persisted storage. Identical shape to `campaign_admin_map_editor.js`'s `adminSaveEditWorld()` and `admin-compose.js`'s `mailAdminSend()` edit branch, both from earlier entries in this phase.
- `modules/titles/titles_student_page.js`: `_getTitleReqText`, `_tsTitleVisibleToStudent`, `renderTitlesPage`, `_tsRefreshStudentTitlesPanel` — all read-only sites migrated to `AppStore.getSlice()`; three now-unneeded `DB = loadDB()` calls removed.
- `modules/titles/titles_index.js`: the startup migration guard (`titles`/`titleUnlocks`/`equippedTitles` existence) migrated to `AppStore.updateState()`, same guard-before-write pattern as every prior config-migration entry.
- `eslint.config.js` — extended the per-directory error-level DB.* gate to `modules/titles/**/*.js`.

**Architecture Before:** `titles_sidebar_refresh.js`'s `tsEquipTitle()`/`tsUnlockTitleForStudent()` — called from student-facing pages, the admin grant modal, achievement auto-unlock, and mail reward claims alike — mutated `DB` directly. `titles_designer.js`'s section-assignment sync had no guaranteed persistence path.

**Architecture After:** Every title equip/unlock/grant/revoke/delete/toggle/duplicate anywhere in the app goes through `AppStore.updateState()`, all funneling through the same small set of now-migrated core functions in `titles_sidebar_refresh.js`.

**Why This Is Better:** This directory's core helpers (`tsEquipTitle`, `tsUnlockTitleForStudent`) are called from at least four other files across the codebase (`mail-engine.js`, `titles_admin_page.js`, the achievement auto-unlock patch in this same directory, and presumably `ach_admin_page.js`-style admin grants elsewhere) — migrating them here means every one of those call sites is now correctly single-source-of-truth without needing to touch any of them individually.

**Remaining Technical Debt:**
- Same repo-wide caveat as previous entries — this closes out `modules/titles/` only.
- The `bootApp` patch in `titles_sidebar_refresh.js` and the `AppStore.ready.then()` guard in `titles_index.js` both initialize the identical `titles`/`titleUnlocks`/`equippedTitles` keys — harmless (both guarded by an existence check) but redundant, same as the `bs_index.js`/`bs_storage.js` duplication flagged in the `modules/boss-studio/` entry. Left untouched — Phase 1 (dead/duplicate code) territory, not this phase's scope.
- Verified in this environment: `node --check` on all five modified files, targeted `eslint modules/titles/` (0 errors, 16 pre-existing warnings, none new), full-repo `eslint .` (same 6 pre-existing unrelated errors as previous entries, no new errors), `node --test tests/unit/**/*.test.js` → 25/25 passing. **Not** re-verified: `npm run test:smoke` (same sandbox limitation as every previous phase) — `tsEquipTitle`/`tsUnlockTitleForStudent` are exactly the kind of widely-called core function that would benefit from a real end-to-end browser pass (equip a title, unlock one via achievement, grant/revoke via admin) once Playwright is available here.

**CI Gate Added:** `no-restricted-syntax` (DB.* mutation) is now `error`-level for `modules/titles/**/*.js` in addition to the eight directories closed in previous entries.

### Phase 3 — Single Source of Truth (module: `modules/admin/`)
**Date:** 2026-07-21

**Problem:** Of this directory's 26 files, only 7 had `DB.*` references (99 total). `registrations.js` (51 refs — the largest single-file count in this phase) is the student registration approval workflow. `quiz-builder.js` (26) is the admin quest CRUD. `analytics.js` (10), `student-manager.js` (8), and `command-center.js` (4) were smaller. `starter-pack-service.js` and `content-oversight-service.js` had only comment mentions, not live code.

**Root Cause:** Same general Phase 3 root cause — plus a fifth instance of the never-persisted-async-mutation bug, and a case (the bulk XP award) of the checkLevelUp()-must-stay-in-the-draft subtlety first seen in `modules/mail/`.

**Files Changed:**
- `modules/admin/registrations.js`: full read migration across `renderAdminRegistrations`, `_regRenderListHTML`, `regAdminViewDetails`, `regAdminReassignModal`, the analytics-extension patch, plus the two validation helpers (`regValidateUsername`/`regValidateEmail`) called from the public registration form itself. **`regAdminApprove()`** — the most involved single-function migration in this entry — now commits the new student row, its three local-only per-student slice initializations (`inventory`, `achievementUnlocks`, `stageProgress`), and the registration's status flip to `'approved'` as **one atomic `AppStore.updateState()` call**, replacing five separate `DB.*` mutations. `regAdminConfirmReject()`/`regAdminConfirmReassign()` migrated similarly. Two now-unneeded `DB = loadDB()` calls removed from `regCheckField()`/`doRegister()` (both existed solely to refresh `DB` before calls into the now-self-sufficient validation helpers).
- `modules/admin/quiz-builder.js`: full CRUD (`_qbQuizCard`, `_qbRenderList`, `renderAdminQuizzes`, `openQuizBuilder`, `cloneQuiz`, `renderQuizBuilderModal`, `saveQuiz`, `deleteQuiz`/`confirmDeleteQuiz`, `openQuizAnalytics`) migrated. `_qbQuizCard()` gained `students`/`quizSectionAssignments` parameters (hoisted once in `_qbRenderList()` instead of read once per quiz card) — same clone-avoidance pattern as `modules/leaderboard/`'s and `modules/section/`'s entries. `renderQuizBuilderModal()`'s two identical "is this an edit?" checks (modal title, submit button label) consolidated into one hoisted `isEditingExisting` read instead of two separate `AppStore.getSlice()` calls.
  - **Found and fixed a fifth instance of the never-persisted-async-mutation bug:** `saveQuiz()`'s section-assignment sync, after a successful `set_quiz_sections()` RPC, mutated `DB.quizSectionAssignments` directly with no `saveDB()` call — identical shape to the leaderboard, mail, campaign (×2), and titles instances found in earlier entries of this phase.
- `modules/admin/student-manager.js`: `openAwardPoints()`'s read migrated; `doAwardPoints()` — the bulk XP-award write (can target one student or the entire class) — rebuilt around one `AppStore.updateState()` call. Same subtlety as `mail-engine.js`'s `mailClaimRewards()` and `campaign_engine.js`'s stage-clear grant: `checkLevelUp()` mutates its argument's `.level` in place, so it has to run inside the draft callback, once per targeted student, rather than on an already-committed object afterward.
- `modules/admin/analytics.js`: `_anlRenderStudentTable()`, `renderAnalytics()`, `_anlRollupBodyHTML()` migrated; `_anlRenderStudentTable()`'s per-row `DB.quizzes.length` read hoisted to a single `quizzesCount` computed once before the row map, same pattern as the student/section-count hoists elsewhere in this phase. **Deliberately did not touch** the root-level duplicate `analytics.js` flagged in the Phase 1/2 log entries — this migration only ever edited `modules/admin/analytics.js`.
- `modules/admin/command-center.js`: 4 read-only sites (`_ccScheduleFor`'s fallback, `_ccRosterFor`, `_ccRecitationCalledToday`, `_ccAttendanceCountsToday`) migrated to `AppStore.getSlice()`.
- `eslint.config.js` — extended the per-directory error-level DB.* gate to `modules/admin/**/*.js`.

**Architecture Before:** `regAdminApprove()` made five separate `DB.*` writes before one `saveDB()` call — no atomicity guarantee if something threw partway through. `saveQuiz()`'s section-assignment sync had the same never-persisted-mutation gap found four times already elsewhere in this phase.

**Architecture After:** Every write in this directory goes through `AppStore.updateState()`; `regAdminApprove()`'s five-part commit is now genuinely atomic.

**Why This Is Better:** `regAdminApprove()` is the single highest-stakes write in this whole codebase from a data-integrity standpoint — it creates a real student account with real initial state across four different slices. Making that atomic (rather than five sequential mutations hoping nothing throws in between) is a meaningful reliability improvement, independent of the general single-source-of-truth rationale.

**Remaining Technical Debt:**
- Same repo-wide caveat as previous entries — this closes out `modules/admin/` only. 19 of this directory's 26 files had zero `DB.*` references to begin with (already using `AppStore`/service-layer patterns, or simple enough to never have needed direct DB access) — this entry only touched the 7 that did.
- Verified in this environment: `node --check` on all five modified files, targeted `eslint modules/admin/` (0 errors, 88 pre-existing warnings across the whole directory, none new), full-repo `eslint .` (same 6 pre-existing unrelated errors as previous entries — still only the root-level `analytics.js` duplicate, confirmed untouched by this session's edits — no new errors), `node --test tests/unit/**/*.test.js` → 25/25 passing. **Not** re-verified: `npm run test:smoke` (same sandbox limitation as every previous phase) — `regAdminApprove()`'s new-account creation flow and `doAwardPoints()`'s bulk-class XP award are exactly the kind of high-stakes, multi-slice write that would benefit most from a real end-to-end browser pass once Playwright is available here.

**CI Gate Added:** `no-restricted-syntax` (DB.* mutation) is now `error`-level for `modules/admin/**/*.js` in addition to the nine directories closed in previous entries.

### Phase 3 — Single Source of Truth (module: `modules/achievements/`)
**Date:** 2026-07-21

**Problem:** All four files had `DB.*` references (109 total). `ach_admin_page.js` (60 refs — the largest single-file count in this phase) is the full admin CRUD + grant/revoke + category-management surface. `ach_engine.js` (36 refs) is the core check-and-award/claim engine — `achBuildStats()`, `achCheckAndAward()`, and `achGrantRewardsForClaim()` are called from achievement triggers scattered across the entire codebase (recitation, boss fights, attendance, quiz completion, mail claims). `ach_student_page.js` (8) was read-only. `ach_index.js` (5) had one migration-guard block.

**Root Cause:** Same general Phase 3 root cause — plus a sixth instance of the never-persisted-async-mutation bug.

**Files Changed:**
- `modules/achievements/ach_engine.js`: `achBuildStats()` (reads 8 different slices to compute one student's live achievement-trigger stats) migrated to `AppStore.getSlice()` — left as straightforward per-call reads rather than the cache-bundle pattern used in `modules/leaderboard/`'s hot loops, since every real call site (recitation/attendance/quiz/boss-fight trigger hooks) calls this once per student action, not in a synchronous per-student loop over the whole roster (the one multi-student call site, `combat-settings.js`'s boss-fight participant loop, staggers each call across its own `setTimeout`, spreading the clone cost over time rather than stacking it in one frame). `achCheckAndAward()` and `achGrantRewardsForClaim()` — the two functions the entire codebase's achievement-trigger hooks funnel through — each migrated to one atomic `AppStore.updateState()` commit.
  - **Preserved, not fixed:** `achCheckAndAward()`'s unconditional `currentUser = ...` reassignment, even when the studentId being checked isn't the logged-in session's own id (this function is sometimes called for *other* students — e.g. every boss-fight participant). This looks like a pre-existing bug, but whether it's actually wrong for those call sites is a question this storage-layer migration shouldn't silently resolve — flagged inline instead.
- `modules/achievements/ach_admin_page.js`: full CRUD (`renderAdminAchievements`, `achAdminOpenForm`, `achAdminSave`, `achAdminToggle`, `achAdminDelete`, `achAdminDuplicate`, `achAdminPreview`) plus grant/revoke (`achAdminGrantAchievement`, `achAdminUpdateGrantPreview`, `achAdminDoGrant`) plus category management (`achAdminManageCategories`, `achAdminAddCat`, `achAdminDeleteCat`) all migrated. `renderAdminAchievements()` hoists `achievementUnlocks`/`achievementSectionAssignments` once instead of re-reading them per achievement row, same clone-avoidance pattern as `modules/leaderboard/`'s and `modules/admin/`'s entries. `achAdminDoGrant()`'s revoke branch preserves the original's exact "sync the raw unlock amount as the negative delta, not a re-derived clamped value" behavior.
  - **Found and fixed a sixth instance of the never-persisted-async-mutation bug:** `achAdminSave()`'s section-assignment sync, after a successful `set_achievement_sections()` RPC, mutated `DB.achievementSectionAssignments` directly with no `saveDB()` call — identical shape to the leaderboard, mail, campaign (×2), titles, and quiz-builder instances found in earlier entries of this phase.
- `modules/achievements/ach_student_page.js`: `renderBadges()` and `achClaimReward()`'s reads migrated to `AppStore.getSlice()`; two now-unneeded `DB = loadDB()` calls removed.
- `modules/achievements/ach_index.js`: the startup migration guard (`achievements`/`achievementUnlocks`/`achievementCategories` existence) migrated to `AppStore.updateState()`, same guard-before-write pattern as every prior config-migration entry.
- `eslint.config.js` — extended the per-directory error-level DB.* gate to `modules/achievements/**/*.js`.

**Architecture Before:** `achCheckAndAward()`/`achGrantRewardsForClaim()` — called from essentially every gameplay system in the app — mutated `DB` directly. `achAdminSave()`'s section-assignment sync had the same never-persisted-mutation gap found five times already elsewhere in this phase.

**Architecture After:** Every write in this directory goes through `AppStore.updateState()`. Because `ach_engine.js`'s two core functions are the funnel point for achievement unlocks/claims across the whole codebase, this one migration correctly propagates to every caller without needing to touch any of them.

**Why This Is Better:** This is the sixth (and, by count, the module average is now roughly one such bug per two-to-three modules migrated) instance of the exact same async-mutation-without-persist shape — a genuinely useful pattern to have surfaced across this phase, since it suggests this specific coding habit (mutate `DB` inside an RPC success callback, forget the explicit persist because the mutation "looks" synchronous) was systemic across the pre-migration codebase rather than a one-off mistake.

**Remaining Technical Debt:**
- Same repo-wide caveat as previous entries — this closes out `modules/achievements/` only.
- The `achCheckAndAward()` unconditional-`currentUser`-reassignment question (see above) is worth a dedicated look in a future session focused on that function's actual multi-student call sites, but is explicitly out of scope here.
- Verified in this environment: `node --check` on all four modified files, targeted `eslint modules/achievements/` (0 errors, 4 pre-existing warnings, none new — including one pre-existing unused variable (`cats` in `renderAdminAchievements`) confirmed present before this migration too, not introduced by it), full-repo `eslint .` (same 6 pre-existing unrelated errors as previous entries, no new errors), `node --test tests/unit/**/*.test.js` → 25/25 passing. **Not** re-verified: `npm run test:smoke` (same sandbox limitation as every previous phase) — `achCheckAndAward`/`achGrantRewardsForClaim` are called from essentially every gameplay system in the app, making this module a strong candidate for a real end-to-end browser pass once Playwright is available here.

**CI Gate Added:** `no-restricted-syntax` (DB.* mutation) is now `error`-level for `modules/achievements/**/*.js` in addition to the ten directories closed in previous entries.

### Phase 3 — Single Source of Truth (module: `modules/shop/`)
**Date:** 2026-07-21

**Problem:** The largest module in this phase — 176 references across all 7 files. `shop_promotions.js` (50 refs) is the promo carousel + admin CRUD + analytics. `shop_pos_terminal.js` (39 refs) is the teacher-run POS terminal (claim-code scanning, in-person checkout). `shop_store.js` (25 refs) is the student self-checkout flow. `shop_inventory.js` (24 refs) is the student's owned-items view. `shop_admin_store.js` (22 refs) is the admin product CRUD. `shop_index.js` (12 refs) had one migration-guard block. `shop_orders.js` (4 refs) is student order tracking.

**Root Cause:** Same general Phase 3 root cause, plus one structural pattern specific to this module (see below) and a confirmation that the never-persisted-async-mutation bug class had already bitten this codebase hard enough once that a prior developer worked around it by convention — this migration replaces that convention with a structural guarantee.

**Files Changed:**
- `modules/shop/shop_orders.js`: student order tracking (`renderStudentOrders`, `ordCancelPrompt`, `ordExecuteCancel`, `ordUpdateSidebarBadge`) fully migrated.
- `modules/shop/shop_index.js`: startup migration guard (`store`/`orders`/`redemptions`/`inventory`/`promotions`/`promoAnalytics` existence) migrated to `AppStore.updateState()`.
- `modules/shop/shop_admin_store.js`: full product CRUD migrated. **Structural fix:** `renderAdminStore()`'s live 3-second stock-refresh interval used to compare against the shared `DB` global, reassigning it in place when a change was detected — relying on that global being kept current by whichever function ran last. Replaced with a self-contained closure variable (`baseline`) the interval owns and updates itself, removing the dependency entirely.
- `modules/shop/shop_inventory.js`: fully read-only file (student's owned-items view, use-item flow) — all reads migrated, one write (`invConfirmUse`) migrated to `AppStore.updateState()`.
- `modules/shop/shop_store.js`: `cartCheckout()` — the student self-checkout transaction (per-item stock reservation via `purchase_shop_product()` RPC, coin deduction, order/redemption creation, inventory upsert) — now commits as **one atomic `AppStore.updateState()` call**, replacing a sequence of direct `DB.*` mutations. `posGenCode()` gained an optional `existingOrders` parameter so claim-code uniqueness is checked against the in-progress draft (which keeps growing within the same checkout) rather than a stale pre-transaction snapshot.
- `modules/shop/shop_promotions.js`: `promoGetActive`, `promoRecordView`, `promoRecordClick`, the full admin CRUD (`renderAdminPromotions`, `promoAdminOpenForm`, `promoAdminSave`, `promoAdminToggle`, `promoAdminDelete`/`promoAdminConfirmDelete`, `promoAdminPreview`/`promoAdminPreviewStore`), and the carousel/countdown rendering functions all migrated. **`promoRecordPurchase()` redesigned with an optional `draftState` parameter** — when a caller (checkout flows in `shop_store.js`/`shop_pos_terminal.js`) passes their own in-progress `AppStore.updateState()` draft, this mutates it directly instead of opening a second commit, so the promo-analytics write lands in the exact same atomic transaction as the order/redemption/inventory writes it's conceptually part of. This preserves, by construction, the intent of a **pre-existing BUGFIX already documented in this function's own comment**: a prior developer had already hit a real crash from `promoRecordPurchase()` reassigning the shared `DB` global mid-loop (discarding the caller's not-yet-saved order/redemption/inventory mutations, and in multi-item carts throwing outright on the next iteration's now-uninitialized inventory lookup) and fixed it by convention ("operate on the DB object the caller already has loaded, don't save here"). `AppStore.updateState()`'s draft parameter makes that same guarantee structural instead of conventional — kept the historical BUGFIX comment in place, appended a note explaining the new mechanism.
- `modules/shop/shop_pos_terminal.js`: full claim-code scanner (`posLookupCode`, `posConfirmClaim`/`posExecuteClaim`, `posCancelOrderPrompt`/`posExecuteCancel`), RFID/manual student lookup, queue/history/analytics rendering, and the startup migration guard all migrated. **`_posPayAttemptCharge()`** — the teacher-POS equivalent of `cartCheckout()` — rebuilt around the identical one-atomic-commit shape, using the same `posGenCode(draft.orders)`/`promoRecordPurchase(item.id, draft)` coordination.
- `eslint.config.js` — extended the per-directory error-level DB.* gate to `modules/shop/**/*.js`.

**Architecture Before:** Two independent checkout flows (`cartCheckout()`, `_posPayAttemptCharge()`) each made a sequence of direct `DB.*` mutations across four different data structures (students, orders, redemptions, inventory) before one `saveDB()` call — no atomicity guarantee, and both depended on a third function (`promoRecordPurchase()`) correctly following an unenforced convention not to touch the shared `DB` global itself.

**Architecture After:** Both checkout flows commit their entire transaction atomically. `promoRecordPurchase()`'s "operate on the caller's in-progress object" contract is now enforced by AppStore's draft-callback design rather than relying on every future editor remembering not to call `loadDB()`/`saveDB()` inside it.

**Why This Is Better:** This module's checkout flows are the two highest-transaction-volume write paths in the entire application (every single student purchase, self-service or teacher-assisted, goes through one of them) — the atomicity and the removal of the shared-global convention both address real reliability properties, not just code style.

**Remaining Technical Debt:**
- Same repo-wide caveat as previous entries — this closes out `modules/shop/` only.
- Verified in this environment: `node --check` on all seven modified files, targeted `eslint modules/shop/` (0 errors, 46 pre-existing warnings across the whole directory — mostly the repo-wide unescaped-innerHTML warning already tracked from Phase 2, plus two pre-existing unused variables confirmed present before this migration too — none new), full-repo `eslint .` (same 6 pre-existing unrelated errors as previous entries, no new errors), `node --test tests/unit/**/*.test.js` → 25/25 passing. **Not** re-verified: `npm run test:smoke` (same sandbox limitation as every previous phase) — both checkout flows are exactly the kind of high-stakes, multi-slice, real-money-equivalent write that would benefit most from a real end-to-end browser pass (complete a self-checkout purchase, complete a POS-scanned purchase, verify stock/coins/orders/inventory all land correctly) once Playwright is available here.

**CI Gate Added:** `no-restricted-syntax` (DB.* mutation) is now `error`-level for `modules/shop/**/*.js` in addition to the eleven directories closed in previous entries.

### Phase 3 — Single Source of Truth (module: `modules/world-boss/`) — final per-module target
**Date:** 2026-07-21

**Problem:** The last real per-module target for this phase — 139 references across 14 files (a 15th, `index.js`, had none). `admin-page.js` (32 refs) is the admin boss-event CRUD. `minions.js` (19) is the minion-spawn mini-game. `combat-settings.js` (16) turned out to be this module's architectural core (see below). `skills.js` (12), `raid-flow.js` (11), `loot-rain.js` (11), `phases.js` (9), `summon-notify.js` (9), `leaderboard.js` (6), `rage.js` (4), `student-page.js`/`battle-overlay.js` (3 each), `loot-service.js`/`bve-patches.js` (2 each, mostly comments).

**Root Cause:** Same general Phase 3 root cause, plus one structural pattern specific to this module (see below) and — unusually for this phase — a cluster of four separate duplicate-function-definition findings, more than any other single module.

**The architectural core — `wbcGetParticipants()`:** Nearly every write path in this entire 14-file module depended on this one function (`combat-settings.js`) returning a *live* reference into `DB.bossParticipants[bossIdx]`, which callers then mutated directly before calling `saveDB()` separately — the same pattern `bs_storage.js`'s `bsLoad()`/`bsGet()` had in the `modules/boss-studio/` entry, but here it's the load-bearing core of an entire module rather than one storage layer. Redesigned the same way: `wbcGetParticipants()` now returns a fresh `AppStore.getSlice()` clone every call, and every write path that used to mutate its return value directly (`wbcJoinBoss`, `wbcApplyDamage`, both `wbcAnswer` definitions, `battle-overlay.js`'s HP-init patch, `raid-flow.js`'s answer/intro handlers, every write in `minions.js`) now builds its mutation inside its own `AppStore.updateState()` draft callback instead.

**Four duplicate-function-definition findings (flagged, not consolidated):**
- `window.wbcAnswer` is defined in both `combat-settings.js` and `student-page.js`; per `student-page.js`'s own header ("LOAD AFTER: combat-settings.js"), it loads second and wins — `combat-settings.js`'s entire `wbcAnswer` is dead code, never executed. Migrated its `DB.*` references anyway so it doesn't trip the lint gate, with an inline comment explaining why it's unreachable.
- `window.wbcJoinBoss` is defined in `combat-settings.js`, then wrapped by a patch in `battle-overlay.js` (adding `hp`/`maxHp`/`isKO` if missing), then **unconditionally overwritten again** in `raid-flow.js` (per its own header: "LOAD AFTER: battle-overlay.js") — a version that already inlines those same fields at creation. Both the original and the `battle-overlay.js` patch are dead; only `raid-flow.js`'s version runs.
- `window.wbcOpenCombatSettings`/`window.wbcSaveCombatSettings` are defined in both `combat-settings.js` and `admin-page.js`; `admin-page.js`'s own header ("LOAD AFTER: combat-settings.js") confirms its versions win.

None of these were fixed or consolidated — deciding which copy to delete is Phase 1 (dead/duplicate code) territory, the same treatment given to the root-level `analytics.js` duplicate found in Phase 1/2 and this phase's own `modules/admin/` entry.

**Other write-path rebuilds:**
- `combat-settings.js`'s `wbcApplyDamage()`: boss HP, the acting student's damage/correct-answer tally, and victory-reward distribution across every participant now commit as one atomic `AppStore.updateState()` call.
- `minions.js`: `wbmSpawnMinion()`, `wbmPruneExpiredMinions()`, `wbmDealDamage()`, `wbmAnswerMinion()`, `wbmMinionTimeout()`, `wbmSelfRevive()`, `wbmAdminReviveStudent()`, `wbmSaveMinionSettings()` all rebuilt around `AppStore.updateState()`. One incidental side effect: `wbmEnsureActiveMinions()` (a small "backfill `activeMinions` if missing" helper) is no longer called anywhere internally after this restructuring — left in place (still exported, still checked by `index.js`'s load-order verification) rather than removed, since deleting it is Phase 1's call, not this one's.
- `admin-page.js`: `bossActivate()` (ends sibling bosses in the same section, resets the target boss's full combat/loot state, clears participants — now one atomic commit), `bossEnd()`, `bossDelete()`, `saveBossForm()` (create/update), and the question-editor/combat-settings/boss-library-picker functions.
- `raid-flow.js`: the live `wbcJoinBoss()`, `wbrAnswer()` (mirrors the `wbcAnswer` redesign), and `wbrRecordFeed()` (the damage feed, previously mutated via a live `boss.damageFeed` reference).
- `skills.js`/`summon-notify.js`: both have a cross-tab "fire an effect on student screens" signal (`pendingSkill`, `pendingBossSummon`) written via `AppStore.updateState()` and consumed via a `window.addEventListener('storage', ...)` handler. Confirmed before migrating that `loadDB()` and `AppStore.getSlice()` have identical freshness characteristics (both read the same in-memory `_state`, neither re-hydrates from a native `storage` event on their own) — so swapping one for the other doesn't change this mechanism's behavior, working or not; investigating whether it actually works cross-tab was out of scope.

**Architecture Before:** An entire module's write surface depended on one function returning a live, shared reference — a single point of architectural fragility larger in scope than any other module in this phase.

**Architecture After:** Every write in this module goes through `AppStore.updateState()`; `wbcGetParticipants()`'s callers are each self-sufficient rather than relying on a shared mutable object convention.

**Why This Is Better:** This closes out the largest remaining architectural risk in the whole Phase 3 effort — one function whose contract (returns a mutable live reference) the entire module's write paths silently depended on, without that contract being stated or enforced anywhere.

**Remaining Technical Debt:**
- The four duplicate-definition findings above — real, load-bearing dead code in a live-traffic module, worth prioritizing whenever Phase 1 picks back up.
- `wbmEnsureActiveMinions()` in `minions.js` is now unused internally (see above) — a minor, incidental side effect of this migration's restructuring, not a pre-existing finding.
- Verified in this environment: `node --check` on all 14 modified files, targeted `eslint modules/world-boss/` (0 errors, 83 pre-existing warnings across the whole directory — confirmed two that looked new, `wbrAnswer`/`st` unused-var warnings, are pre-existing false positives unrelated to this migration's edits), full-repo `eslint .` (same 6 pre-existing unrelated errors as every previous entry, no new errors), `node --test tests/unit/**/*.test.js` → 25/25 passing. **Not** re-verified: `npm run test:smoke` (same sandbox limitation as every previous phase) — this module's `wbcGetParticipants()` redesign touches the single most load-bearing function in the whole 14-file module; a full raid playthrough (join, answer, take minion damage, get revived, defeat the boss, claim loot) would be the highest-value smoke test to prioritize once Playwright is available here, of any module closed in this phase.

**CI Gate Added:** `no-restricted-syntax` (DB.* mutation) is now `error`-level for `modules/world-boss/**/*.js` in addition to the twelve directories closed in previous entries. With this entry, every `modules/*` directory with real `DB.*` usage has been migrated — remaining `DB.*` references are confined to `modules/core/` (the `AppStore`/`db-service.js` internals themselves) and a handful of root-level files, both explicitly out of this phase's per-module scope per the original roadmap doc.

---

### Post-Phase-3 Technical Debt Review — Tier 1, Item 1: CI gate blind spot fixed
**Date:** 2026-07-21

**Problem:** A senior-level review of the technical debt accumulated across Phases 1–3 (prompted before starting Phase 4) identified that the repo-wide `no-restricted-syntax` rule backing every per-directory Phase 3 CI gate had a real gap: its selector, `AssignmentExpression[left.object.name='DB']`, only matches `DB.x = ...` (a MemberExpression target). It never matched a bare `DB = loadDB()` reassignment (an Identifier target) — the exact shape Phase 3's own migration work had to hand-fix multiple times (`bs_storage.js`, `campaign_engine.js`, and others across the mail/campaign/titles/quiz-builder/achievements entries). A regression of that specific shape in any already-migrated directory would have silently passed every gate.

**Root Cause:** The rule was written to catch the more common `DB.x = ...` mutation shape and never extended to cover the whole-object reassignment shape, even though both are the identical underlying problem (code depending on `DB` as a mutable object outside `AppStore`'s gate).

**Files Changed:**
- `eslint.config.js` — the repo-wide warn-level `no-restricted-syntax` block now has a second selector, `AssignmentExpression[left.name='DB']`, alongside the original. Both fire at the same `warn` severity repo-wide; both are promoted to `error` in every directory already covered by a per-directory Phase 3 gate (the two selectors share that same rule array, so directory-scoped blocks inherit both automatically — no changes needed to the twelve per-directory `files:` blocks themselves).

**Verification:** Running the full-repo lint with the new selector immediately surfaced one real, previously-invisible instance: `utils.js`'s `eqGrantQuizAttemptOverride()` still does `DB = loadDB(); ...; saveDB();`. This is a root-level file, out of every Phase 3 per-module gate's scope, so it correctly surfaces at `warn` only — not blocking, but now visible for whoever picks up Phase 4 or the remaining root-level cleanup. No other new instances found. Full-repo `eslint .` still shows the same 6 pre-existing unrelated errors (the root-level `analytics.js` duplicate) and no new errors; `node --test tests/unit/**/*.test.js` → 25/25 passing.

**Why This Was Prioritized:** Identified as a Tier 1 (fix-before-Phase-4) item specifically because Phase 4 will work directly in `db-service.js`/`state-manager.js` — the two files most likely to reintroduce this exact pattern — and because the fix is a two-line addition with no behavioral risk to anything already migrated.

**Remaining Tier 1 items (not yet actioned):** the four duplicate-function-definition findings in `modules/world-boss/` (`wbcAnswer`, `wbcJoinBoss`, `wbcOpenCombatSettings`/`wbcSaveCombatSettings`), deleting the inert root-level duplicate `analytics.js`, and getting at least a manual smoke-test pass on the highest-stakes flows (checkout, boss defeat, registration approval) before continuing further.

---

### Post-Phase-3 Technical Debt Review — Tier 1, Item 2: dead duplicate `analytics.js` deleted
**Date:** 2026-07-21

**Problem:** Root-level `analytics.js` was a stale, pre-migration duplicate of `modules/admin/analytics.js`, first flagged in the Phase 1/2 log entries and repeatedly confirmed-but-left-alone throughout every Phase 3 entry that touched `modules/admin/analytics.js`. It was the direct cause of all 6 pre-existing lint errors carried through this entire refactor effort — 3 `no-duplicate-global-functions` errors (from `modules/admin/analytics.js` re-declaring `_anlPagination`/`_anlRenderRollupShell`/`_anlRollupBodyHTML`, which the root file also declared) and 3 of its own `no-unescaped-db-field-in-html` errors on stale, pre-Phase-2 code.

**Root Cause:** The root file was never actually deleted when `analytics.js` was relocated into `modules/admin/` at some earlier point in this codebase's history — its own header comment even states it's "never `<script>`-loaded," confirming this was known, not newly discovered.

**Verification before deleting:** Confirmed `index.html` loads only `./modules/admin/analytics.js`, never the root file; grepped for any other `<script src="analytics.js">` or reference to it — none found.

**Files Changed:** Deleted `analytics.js` (root). No other files touched.

**Result:** Full-repo `eslint .` now reports **0 errors** (down from 6) for the first time in this entire refactor effort — every remaining lint finding across the whole codebase is `warn`-level. `node --test tests/unit/**/*.test.js` → 25/25 passing, unaffected.

**Why This Was Prioritized:** Zero risk (confirmed dead, confirmed unreferenced) and immediately clears every remaining error-level lint finding in the repo — the cheapest possible win in the Tier 1 list.

**Remaining Tier 1 items (not yet actioned):** the four duplicate-function-definition findings in `modules/world-boss/` (`wbcAnswer`, `wbcJoinBoss`, `wbcOpenCombatSettings`/`wbcSaveCombatSettings`), and getting at least a manual smoke-test pass on the highest-stakes flows (checkout, boss defeat, registration approval) before continuing further.

---

### Post-Phase-3 Technical Debt Review — Tier 1, Item 3: four duplicate function definitions removed
**Date:** 2026-07-21

**Problem:** `modules/world-boss/`'s own Phase 3 entry flagged four duplicate `window.*` function definitions across the module, each pair confirmed to have one dead (unconditionally overwritten) copy per the files' own "LOAD AFTER" header comments. Left in place at the time since resolving them was explicitly out of Phase 3's scope.

**Files Changed:**
- `modules/world-boss/combat-settings.js`: removed its dead `wbcAnswer` (shadowed by `student-page.js`'s), dead `wbcJoinBoss` (shadowed by `raid-flow.js`'s), and dead `wbcOpenCombatSettings`/`wbcSaveCombatSettings` pair (shadowed by `admin-page.js`'s) — three of the four findings all traced back to this one file being the "first-loaded, always-overwritten" copy.
- `modules/world-boss/battle-overlay.js`: removed its dead `wbcJoinBoss` wrapper (Patch 3) — this one was doubly moot, since it wrapped a version of `wbcJoinBoss` that was itself dead, and the version that actually runs (`raid-flow.js`'s) already inlines the same `hp`/`maxHp`/`isKO` fields this patch existed to add. Updated the file's own header comment, which listed `wbcJoinBoss` among the functions it monkey-patches.
- `modules/world-boss/raid-flow.js` and `modules/world-boss/admin-page.js`: updated comments that referenced the (now-deleted) shadowed copies as still-present dead code, so they don't mislead a future reader into thinking there's still a duplicate to find.

**Verification:** `node --check` on all four modified files. Targeted `eslint modules/world-boss/` and full-repo `eslint .`: 0 errors both times (matching the post-Item-2 baseline), same warning counts as before the deletions (no new findings, none resolved by coincidence). `node --test tests/unit/**/*.test.js` → 25/25 passing.

**Why This Was Prioritized:** These were genuinely load-bearing-looking dead code in a live-traffic module — exactly the shape of landmine where a future editor changes the wrong copy, sees no effect, and loses real time. All four were confirmed dead via each file's own header comment (not inferred), so removal carried effectively zero behavioral risk.

**Tier 1 status:** All three items from the technical debt review are now complete (CI gate blind spot fixed, dead duplicate `analytics.js` deleted, all four `modules/world-boss/` duplicate definitions resolved). The one remaining Tier 1 recommendation — a manual smoke-test pass on the highest-stakes flows before proceeding further — was a process recommendation, not a code change, and remains outstanding pending Playwright/browser access in this environment.

---

### Post-Phase-3 Technical Debt Review — Tier 2: duplicate migration guards and orphaned helper removed
**Date:** 2026-07-21

**Problem:** Three small, low-risk Tier 2 items from the debt review: two pairs of duplicate `AppStore.ready.then()` migration guards (flagged-not-fixed during the `modules/boss-studio/` and `modules/titles/` Phase 3 entries), and one helper function (`wbmEnsureActiveMinions`) left orphaned as an incidental side effect of the `modules/world-boss/` migration.

**Files Changed:**
- `modules/boss-studio/bs_index.js`: removed its `bossLibrary`/`animationLibrary` migration guard entirely — `bs_storage.js`'s own guard does the identical init check plus more (`bsLoad()`, legacy inline-image migration scheduling), so `bs_index.js`'s was a strict subset, not a partial duplicate. Nothing else in this file referenced it.
- `modules/titles/titles_sidebar_refresh.js`: trimmed the `bootApp` patch down to remove its duplicate `titles`/`titleUnlocks`/`equippedTitles` init check (byte-for-byte the same logic as `titles_index.js`'s own guard) while keeping the two things unique to this patch — the post-login achievement check and the sidebar/profile title refresh.
- `modules/world-boss/minions.js`: removed the now-unreachable `wbmEnsureActiveMinions()` — its three call sites were all rewritten during the Phase 3 migration to read a fresh `AppStore.getSlice()` clone with an inline `|| []` fallback instead, leaving this helper with zero callers.
- `modules/world-boss/index.js`: removed `wbmEnsureActiveMinions` from the load-order verification list so it doesn't fail expecting a function that no longer exists.

**Verification:** `node --check` on all four files. Targeted `eslint` on `modules/boss-studio/`, `modules/titles/`, `modules/world-boss/` and full-repo `eslint .`: 0 errors, same 465 total warnings as the post-Tier-1 baseline (no regressions, nothing newly silenced). `node --test tests/unit/**/*.test.js` → 25/25 passing.

**Why These Were Low-Risk:** Both guard removals leave exactly one copy of each initialization behind, still firing on the same `AppStore.ready` event with the same existence-check-before-write logic — no timing or outcome change. The `bootApp` patch trim preserves both of its non-duplicated responsibilities untouched. The orphaned-helper removal only removes code with zero remaining call sites (confirmed by grep before deleting, same as every other deletion in this debt-review pass).

**Remaining Tier 2 items:** the ~319-site raw-`innerHTML` escaping backlog (Phase 2), a dedicated CSS-injection-via-`style`-attribute audit for `studentColor`/`studentInit`, and a full line-by-line RLS policy review (Phase 2's audit was RPC-level, not policy-level). All three are larger, standalone efforts better scoped as their own sessions rather than folded into this quick-win pass.

---

### Phase 4 — Event-Driven Communication (site: all 5 target functions)
**Date:** 2026-07-31

**Problem:** 5 global functions (`window.bootApp`, `window.finishQuiz`, `window.logAttendance`, `window.logRecitation`, `window.wbcApplyDamage`) were hooked by monkey-patching — capturing `_orig` and reassigning — across what the roadmap's Problem section counted as 23 files total. Runtime behavior of these functions was unreadable from any single file, and the pattern competed with `AppStore.subscribe`, a pub/sub system already present in the same codebase for the same purpose.

**Root Cause:** Monkey-patching predates Phase 3 — before state mutations had a clean boundary (`AppStore.updateState()`), wrapping a global was the fastest way to bolt on cross-cutting behavior (mainly achievement checks and cross-module UI refresh) without editing the function directly.

**Files Changed:**
- `modules/core/state-manager.js`: added `AppStore.emit(event)` — a new lightweight public method that calls the existing internal `_notify()` directly, skipping `updateState()`'s clone/mutate/commit/window.DB-refresh/debounced-persist steps entirely. Needed because `bootApp()` never mutates `DB.*` itself (pure UI/navigation orchestration) and runs on every login and page refresh — routing it through `updateState(() => {}, event)` would have turned "nothing changed" into a real ~200KB state clone plus a wasted debounced write to localStorage/Supabase, on the single highest-frequency call in the app.
- `auth.js`: `bootApp()` now calls `AppStore.emit({type:'session:booted', payload:{role, userId}})` as its last statement — the same point in the timeline the last chained monkey-patch used to run.
- `modules/recitation/logger.js`: removed a stale inline `achCheckAndAward()` call, self-documented as "temporary until achievements is extracted" — that extraction had already happened, and the call was firing redundantly alongside two other paths (see below).
- `modules/achievements/ach_engine.js`: converted `finishQuiz`, `logRecitation`, and `wbcApplyDamage`'s patches (where live) to `AppStore.subscribe()` handlers; removed the dead `logAttendance` patch outright; added `AppStore.subscribe('ach-engine-session-booted', ...)` for its own `bootApp` hook. Wired the two attendance events that actually exist (`attendance:scan-recorded`, `attendance:override`) into the shared subscriber to restore the achievement-check behavior `logAttendance`'s dead patch was supposed to provide — deliberately excluding `attendance:session-closed` (a bulk absence-sweep that can only decrease a presence-based stat, never newly cross an unlock threshold).
- `modules/world-boss/phases.js`: converted its `wbcApplyDamage` patch — the one the roadmap specifically flagged for ordering risk (it branched on the wrapped call's return value, `result !== 'defeated'`) — to a subscriber reading `event.type` instead, which resolves that risk rather than just preserving it.
- `modules/shared/reward-presenter.js`, `modules/world-boss/summon-notify.js`, `modules/titles/titles_sidebar_refresh.js`, `modules/shop/shop_inventory.js`, `modules/shop/shop_orders.js`: converted their `bootApp` patches to dedicated `AppStore.subscribe()` handlers, one per file, preserving each file's distinct delay (20–800ms) and achievement-popup-suppression semantics exactly rather than consolidating into one shared handler.
- `index.html`: renamed the `finishQuiz()` completion event from `quiz:completed` to `quiz:finished` — a naming mistake from earlier (pre-this-doc) session work, caught by cross-checking against the canonical spec once it was available.
- 4 new test files (`log-recitation-event.test.js`, `finish-quiz-event.test.js`, `wbc-apply-damage-event.test.js`, plus `tests/unit/helpers/load-globals.js` additions: `loadLoggerWindow`, `loadAchEngineWindow`, `loadPhasesWindow`) — loading the real source files into jsdom against fake `AppStore`s, not reimplementations, per this project's existing test convention.

**Architecture Before:** 8 files chained `_orig`-capturing wrappers around 5 global functions. Two of those wrappers never actually ran: `logAttendance`'s patch targeted a function nothing in the app called anymore (attendance had moved to RFID scanning under different event names entirely), and `ach_engine.js`'s `wbcApplyDamage` patch was silently clobbered by `combat-settings.js`'s later, non-chaining definition — confirmed via `index.html`'s actual script load order, not inferred. Both were live, silent feature gaps (attendance- and per-hit-boss-damage-triggered achievement checks simply never fired) predating this phase entirely.

**Architecture After:** Zero monkey-patches remain for the 5 target functions (one dead, never-loaded duplicate file — `modules/world-boss/titles_sidebar_refresh.js` — still contains an inert copy of the old pattern; left untouched as it's unreachable and out of scope, matching this project's established "flag, don't silently fix unrelated dead code" posture). `AppStore.subscribe()`/`AppStore.emit()` is now the sole cross-module communication idiom for these triggers. Both previously-dead achievement-check paths are now live, wired to the actual events the app emits today rather than to a reconstruction of the original (already-broken) intent.

**Why This Is Better:** Each function's real behavior is readable in its own file again — no more chasing a chain of `_orig` wrappers across 6+ files to know what `bootApp()` actually does. The `wbcApplyDamage`/`phases.js` conversion specifically eliminates a correctness hazard (return-value-order dependency) rather than just relocating it. The two dead-patch discoveries were confirmed as genuine live bugs, not preserved as="working" via faithful-but-inert conversion — restoring them used the real, current event names rather than recreating the stale ones the dead patches referenced.

**Remaining Technical Debt:** The roadmap's "23 files" figure almost certainly described the *total* monkey-patching problem in the codebase, not a promise that all 23 touch these 5 functions — a broader sweep found 13 more files patching 21 *other* functions (`renderStudentWorldBoss`, `navTo`, `openBossForm`, `bossActivate`, `achCheckAndAward` itself, `_holGetTitle`, `renderStudentDashboard`, and 14 more), none of which this phase's scope covered ("matching the five current monkey-patch targets, no more, no less" — roadmap's own words). 8 (converted) + 13 (untouched) = 21, close enough to 23 to support this read given the imprecise counts found elsewhere in this project's source docs, though the exact 2-file gap wasn't fully resolved. Worth its own phase if the team wants zero monkey-patching codebase-wide rather than just on the achievement-check cross-cutting concern this phase targeted.

**CI Gate Added:** None this phase — no existing lint rule targets the monkey-patch pattern itself (unlike the `no-restricted-syntax` DB-mutation rule from Phase 3/Tier 1). Would be a reasonable follow-up: an ESLint rule flagging `const _orig = window.X; window.X = function` as a discouraged pattern, to prevent regression now that the codebase is (mostly) clear of it.

**Verification:** `node --check` on every modified `.js` file plus a Node syntax check on `index.html`'s extracted inline scripts (not ESLint-covered). Full-repo `eslint .`: 0 errors throughout (unchanged from the post-Phase-3-cleanup baseline). `node --test tests/unit/**/*.test.js`: 56/56 passing (25 pre-existing + 31 new across this phase).

---

### Phase 4 — Event-Driven Communication (site: renderStudentWorldBoss)
**Date:** 2026-08-01

**Problem:** While converting `wbcApplyDamage`, tracing script load order surfaced a related, unrelated-at-first-glance chain: 6 patches/definitions touch `window.renderStudentWorldBoss` across 5 files (`skills.js`, `phases.js`, `rage.js`, `student-page.js`, `battle-overlay.js` ×2, `raid-flow.js`, `bve-patches.js`).

**Root Cause:** Two separate silent-overwrite bugs, same shape as `wbcApplyDamage`'s: `student-page.js` defines `window.renderStudentWorldBoss` as a straight assignment (not a chain), discarding `skills.js`/`phases.js`/`rage.js`'s patches. `raid-flow.js` later does the same (`window.renderStudentWorldBoss = wbrRenderLobby;`), discarding `battle-overlay.js`'s two patches. Only `bve-patches.js`, loading last, ever actually ran.

**Investigation, not just conversion:** Before restoring anything, checked whether each dead patch's called functions had other live callers. Found `wbpCheckPhaseChange`, `_wbpUpdateHPBarColor`, and `wbrageCheckAndActivate` were **already live** via two other paths — a separate existing patch on `_wbcUpdateHPDisplay`, and this session's own `wbcApplyDamage` conversion. Also found `battle-overlay.js`'s two dead patches (one of which conditionally replaces the entire render with a full-screen battle overlay via `wbeRenderFullBattle`) had **zero other callers of `wbeRenderFullBattle`** — but a working, independent alternate mechanism (`wbrOpenBattle`/`_wbrOpenBattleRender`, a different overlay entirely) was found, strongly suggesting the `battle-overlay.js` patches are superseded architecture, not a live bug.

**Files Changed:** `modules/world-boss/raid-flow.js` (added `AppStore.emit('world-boss:student-view-rendered', ...)` to `_wbrRenderLobbyCore()`), `modules/world-boss/skills.js` (converted, restoring only the skill-cooldown loop — the one piece confirmed to have no other live caller), `modules/world-boss/phases.js` (converted, restoring only `_wbpInjectPhaseIndicator` — phase-change/HP-color deliberately not duplicated, already live elsewhere), `modules/world-boss/rage.js` (converted, restoring only the inactive-boss cleanup branch — the active-boss check deliberately not duplicated, already live via `wbcApplyDamage`'s subscriber).

**Architecture Before:** 3 dead monkey-patches (never executing), 2 more dead monkey-patches on a separate function (`battle-overlay.js`, left untouched — see below), 1 live monkey-patch (`bve-patches.js`, unchanged).

**Architecture After:** 3 dead patches converted to `AppStore.subscribe('world-boss:student-view-rendered', ...)` handlers, each restoring only the genuinely-missing piece rather than the dead patch's full original body (most of which was redundant with already-live code). `battle-overlay.js`'s 2 patches deliberately left as dead monkey-patches — restoring them risked reintroducing conflicts with the system (`wbrOpenBattle`) that appears to have already superseded them; treating this as a real architectural question for a human to decide, not something to silently resolve either direction.

**Why This Is Better:** Restores real, confirmed-missing gameplay behavior (skill-cooldown loop, phase-indicator UI) without duplicating already-working logic or resurrecting likely-superseded code. Caught and fixed a real syntax bug introduced during the edit itself (a dangling closing brace from an incompletely-removed IIFE) via `node --check` before it could ship.

**Remaining Technical Debt:** `battle-overlay.js`'s two dead patches are still dead. Whether they represent truly-superseded architecture (safe to eventually delete) or a still-needed feature reachable through some third path not yet found is not fully resolved — flagged in `CONTINUATION_PLAN.md` for follow-up, not silently decided here.

**CI Gate Added:** None.

**Verification:** `node --check` on all 4 touched files. `eslint .`: 0 errors, no new warnings. `node --test`: 56/56 passing (no new tests added — `skills.js`/`rage.js` hung when loaded standalone in jsdom, likely a blocking interval pattern; verified via manual code review instead, noted explicitly rather than implying equal test coverage to the rest of this phase).

### Phase 4 (Continuation) — Event-Driven Communication (sites: `setupSidebar`, `renderAdminAchievements`)
**Date:** 2026-08-03

**Problem:** Per `CONTINUATION_PLAN.md` §3's Category A list, converted the two sites explicitly recommended to go first — single confirmed patch site each, lowest blast radius, used to re-confirm the jsdom-standalone-load approach still works before the larger/riskier sites on the list.

**Root Cause:** Same as the original Phase 4 — monkey-patching predates `AppStore.updateState()`'s clean mutation boundary.

**Files Changed:**
- `nav.js`: `setupSidebar()` now ends with `AppStore.emit({type:'nav:sidebar-rendered', payload:{role: currentRole}})`.
- `modules/shop/shop_inventory.js`: converted its `setupSidebar` patch to `AppStore.subscribe('shop-inventory-sidebar-badge', ...)`; updated a stale header comment.
- `modules/shop/shop_index.js`: fixed a stale load-order comment.
- `modules/achievements/ach_admin_page.js`: `renderAdminAchievements()` now ends with `AppStore.emit({type:'admin:achievements-rendered', payload:null})`.
- `modules/titles/titles_admin_page.js`: converted its `renderAdminAchievements` patch to `AppStore.subscribe('titles-admin-achievements-link', ...)`; fixed a stale trailing `console.log`.
- 2 new test files (`setup-sidebar-event.test.js`, `render-admin-achievements-event.test.js`), plus `tests/unit/helpers/load-globals.js` additions: `loadNavAndInventoryWindow`, `loadAchAdminAndTitlesWindow`.

**Architecture Before:** 2 single-site `_orig`-capturing wrappers, both live, both confirmed post-hook/void-return via load-order trace (no chaining risk, no dead-code surprises at either site).

**Architecture After:** Both converted to `AppStore.subscribe()`. Zero remaining patches on either function.

**Why This Is Better:** Same rationale as the original Phase 4 entry — behavior is readable in each file again, and both now use the codebase's one pub/sub idiom instead of a second, competing one.

**Remaining Technical Debt:** 11 of the original 13 Category A sites still open (see next entry — the count changed mid-session).

**CI Gate Added:** None.

**Verification:** `node --check` on all touched files. `eslint .`: 0 errors, 466 warnings (unchanged baseline — no new warnings). `node --test`: 70/70 passing (56 pre-existing + 14 new across these two sites).

---

### Phase 4 (Continuation) — Event-Driven Communication (site: `renderAnalytics`) — 2nd patch site found, 1 of 2 confirmed dead
**Date:** 2026-08-03

**Problem:** `CONTINUATION_PLAN.md` §3's classification table counted `renderAnalytics` as a single patch site (`shop_pos_terminal.js`). Grepping all references before converting — step 1 of the plan's own methodology — surfaced a second, unlisted patch site: `modules/admin/registrations.js`, whose own header comment (`"NOTE: This patch extends the base renderAnalytics defined in analytics.js. In Phase 5 this becomes an explicit call in analytics.js directly."`) confirms it was always known-about internally, just missed by the classification pass. This is the same undercounted-inventory pattern flagged in `CONTINUATION_PLAN.md` §6 (the `renderStudentMail` precedent) — now confirmed a second time.

**Root Cause / Investigation:** Traced `index.html`'s actual script load order for all three files: `shop_pos_terminal.js` (:801) loads **before** `modules/admin/analytics.js` (:874) ever defines `window.renderAnalytics` — so `shop_pos_terminal.js`'s `const _orig = window.renderAnalytics` captures `undefined`, and analytics.js's own plain (non-chaining) `window.renderAnalytics = function() {...}` 73 lines later silently discards the patch entirely. This is the same silent-overwrite bug shape already found 3 times in this codebase (`wbcApplyDamage`, `renderStudentWorldBoss` ×2) — now a 4th confirmed instance, on a completely different function. `registrations.js` (:877) loads *after* analytics.js, so its capture of `renderAnalytics` is the real base — that patch is live.

Before converting or restoring anything, checked whether `shop_pos_terminal.js`'s dead block represented a live bug or superseded architecture (methodology step 5): its own file already renders a **strictly richer** version of the same order/revenue data via `_posAnalyticsHTML()`, on the POS Terminal's own "analytics" tab (reachable through the dead block's own "Open POS Terminal" button) — today/week/all-time/cancelled/pending counts, a 7-day chart, and a category breakdown, vs. the dead block's 4 raw numbers. Same shape as the `battle-overlay.js` finding from the earlier `renderStudentWorldBoss` investigation: strong evidence of superseded architecture, not a live bug — restoring it would risk conflicting with (or simply duplicating, worse) the richer view that already exists.

**Files Changed:**
- `modules/admin/analytics.js`: `renderAnalytics()` split into an outer `window.renderAnalytics` (calls `_renderAnalyticsCore()`, then unconditionally `AppStore.emit({type:'admin:analytics-rendered', payload:null})`) and the renamed original body as `_renderAnalyticsCore()`. Wrapping the whole function (rather than adding an emit before each of its 3 internal return paths — missing element, rollup mode, normal mode) preserves the old monkey-patch's "always runs after the original completes, regardless of which internal branch fired" semantics exactly, with one emit call instead of three that could drift out of sync on a future edit. Also corrected the file's own header comment, which still described both patches as live.
- `modules/admin/registrations.js`: converted its (live) patch to `AppStore.subscribe('registrations-analytics-block', ...)`.
- `modules/shop/shop_pos_terminal.js`: **not converted.** Added a comment at the patch site documenting the confirmed-dead finding and the reasoning above; the patch code itself is untouched (still dead, still inert) pending a human decision on outright deletion vs. eventual real wiring. Corrected the file's header comment.
- `modules/shop/shop_index.js`: corrected a stale load-order comment.
- 1 new test file (`render-analytics-event.test.js`), plus a `loadAnalyticsAndRegistrationsWindow` helper addition to `tests/unit/helpers/load-globals.js` (deliberately does not load `shop_pos_terminal.js` — nothing there is live behavior worth covering).

**Architecture Before:** 2 patches on `renderAnalytics`, 1 dead (never executed, confirmed via load-order trace) and 1 live.

**Architecture After:** The live patch converted to `AppStore.subscribe()`. The dead patch left as dead code, clearly documented in 3 places (its own site, its file's header, and `analytics.js`'s header) rather than silently converted-but-still-broken or silently deleted.

**Why This Is Better:** The live registration-stats behavior is preserved exactly and is now readable via the shared pub/sub idiom. The dead-patch finding — which the original classification pass missed — is now on record with a specific, falsifiable claim (`_posAnalyticsHTML()` supersedes it) instead of being either invisibly broken forever or silently "fixed" in a way that could conflict with the POS Terminal's existing richer view.

**Remaining Technical Debt:** `shop_pos_terminal.js`'s dead `renderAnalytics` patch — same open question as `battle-overlay.js`'s: delete outright, or is there a reason (not found in this investigation) it should eventually be wired up for real? Flagged for a human call, not resolved here. 10 of the original Category A list remain unconverted: `openBossForm` ×3, `navTo` ×2, `renderStudentDashboard`, `achCheckAndAward`-as-title-hook (last, per the plan's own risk ordering). The true count of "how many patch sites exist per function" should now be treated as provisional for every remaining item on the list too, not just the ones already converted — this session found a second miss on the very next site checked.

**CI Gate Added:** None yet — this finding strengthens the case for the ESLint rule flagging `const _orig = window.X; window.X = function` (recommended, not yet built, since Phase 4's original entry) even further, since it would have caught the dead `shop_pos_terminal.js` assignment (or at least the pattern) mechanically rather than requiring a manual load-order trace.

**Verification:** `node --check` on all 5 touched files. `eslint .`: 0 errors, 466 warnings (unchanged). `node --test`: 76/76 passing (70 pre-existing this session + 6 new).

---

### Phase 4 (Continuation) — Event-Driven Communication (site: `renderStudentDashboard`) — 4th confirmed dead-patch-via-load-order instance
**Date:** 2026-08-03

**Problem:** `CONTINUATION_PLAN.md` §3 listed `renderStudentDashboard` as the next site — single confirmed patch (`modules/titles/titles_sidebar_refresh.js`), classified post-hook/void-return. Per the plan's own methodology (§2 step 1), read the patch and traced load order before converting rather than converting on the classification alone.

**Root Cause / Investigation:** `titles_sidebar_refresh.js`'s `<script>` tag (index.html :817) loads and executes **before** the inline `<script>` block that defines the base `renderStudentDashboard()` (index.html :900). So `const _orig = window.renderStudentDashboard` inside the patch's IIFE captured `undefined`, and the base function's own plain (non-chaining) `function renderStudentDashboard(){...}` declaration silently overwrote `window.renderStudentDashboard` the moment that later script block ran — discarding the patch for good. This is the same silent-overwrite shape already found 3 times this engagement (`wbcApplyDamage`, `renderStudentWorldBoss` ×2) — now a 4th confirmed instance, on yet another function.

Checked what the dead patch's restored behavior would actually be covering (methodology step 4) before assuming it was a live bug worth restoring wholesale. The patch's only job was `setTimeout(tsRefreshProfileTitle, 80)` after the base function runs — restoring the `#ts-dash-title` equipped-title badge that every `renderStudentDashboard()` call wipes via its `innerHTML =` replacement. Grepped all real call sites of `renderStudentDashboard()` (4, after excluding the confirmed-dead `modules/world-boss/` duplicate file, which never loads): `nav.js`'s `navTo()` (called from `titles_sidebar_refresh.js`'s own **separate**, live `navTo` patch, which already re-runs `tsRefreshProfileTitle()` on `s-dashboard` navigation — covered), `auth.js`'s boot path (covered by the file's existing `session:booted` subscriber, ~300ms after boot), and two that were **not** covered by anything else: `modules/perceived-speed.js`'s mail-reward-claim popup `onClose`, and `modules/achievements/ach_student_page.js`'s achievement-claim popup `onClose`. Both of those wipe the profile-title badge on every claim with no live path to restore it — a real, if minor, visible gap while the patch was dead.

**Files Changed:**
- `index.html`: `renderStudentDashboard()` now ends with `AppStore.emit({ type: 'dashboard:student-rendered', payload: {} })`. No state mutation happens in the function body (confirmed — grepped for `updateState`/`AppStore.` inside it, none found), so `emit()` rather than `updateState()`, same reasoning as `bootApp()`.
- `modules/titles/titles_sidebar_refresh.js`: converted the dead patch to `AppStore.subscribe('titles-sidebar-dashboard-rendered', ...)` on the new event; updated the trailing `console.log` (no longer lists `renderStudentDashboard` as a patch, now lists both subscribers).
- 1 new test file (`render-student-dashboard-event.test.js`), plus a `loadTitlesSidebarRefreshWindow` helper addition to `tests/unit/helpers/load-globals.js`.

**Architecture Before:** 1 dead patch on `renderStudentDashboard`, silently discarded by script load order since the file was first written.

**Architecture After:** Converted to `AppStore.subscribe()`. Zero remaining patches on this function. The two previously-uncovered call sites (mail-claim close, achievement-claim close) now get the profile-title-badge restore for free, since a subscriber isn't sensitive to script tag order the way a captured `_orig` is — this fixes the gap rather than relocating it.

**Why This Is Better:** Same rationale as the other Category A conversions, plus a genuine (if small) live-bug fix: the equipped-title badge no longer silently disappears after claiming mail or achievement rewards.

**Coverage note:** `renderStudentDashboard()` itself lives inline in index.html's ~2700-line shared `<script>` block (canvas hero backdrop with a persistent `requestAnimationFrame` ambient-particle loop, heavy `DB.*`/`currentUser` surface) — assessed as unsafe to load standalone in jsdom for a real execution test, same category as `shop_pos_terminal.js`'s already-documented case. Verified instead via `node --check` on the extracted inline script block (clean) and direct inspection confirming the single `emit()` call at the function's end. The subscriber side (the actual new/changed logic) has full jsdom test coverage.

**Remaining Technical Debt:** 9 of the original Category A list remain unconverted: `openBossForm` ×3, `navTo` ×2, `achCheckAndAward`-as-title-hook (last, per the plan's own risk ordering — highest blast radius, most other code depends on `achCheckAndAward` behaving correctly). Per the `renderAnalytics` entry's finding, treat the per-function site counts as still provisional until each is actually traced.

**CI Gate Added:** None yet — same recommended follow-up as prior entries (ESLint rule for the `const _orig = window.X; window.X = function` shape).

**Verification:** `node --check` on `modules/titles/titles_sidebar_refresh.js` and the extracted inline `<script>` block from `index.html`. `eslint .`: 0 errors, 466 warnings (unchanged). `node --test`: 80/80 passing (76 pre-existing + 4 new).

---

### Phase 4 (Continuation) — Event-Driven Communication (site: `openBossForm`) — 3 confirmed-live sites, correctly chained
**Date:** 2026-08-03

**Problem:** `CONTINUATION_PLAN.md` §3 listed `openBossForm` as the next recommended site — 3 patch sites (`modules/world-boss/skills.js`, `phases.js`, `rage.js`), all classified post-hook/DOM-injection. Per the plan's own methodology (§2 step 1), read each patch and traced load order before converting rather than converting on the classification alone.

**Root Cause / Investigation:** Grepped all references first (methodology step 1) — unlike `renderAnalytics`/`renderStudentMail`, no unlisted 4th site turned up for the function itself, though `index.html`'s own "LOAD ORDER FIX" comment block claims `loot-rain.js` also wraps `openBossForm`; grepping `loot-rain.js` directly found no such patch — a stale comment, not a missed site (methodology step 1's "comments are frequently stale" warning, confirmed again). Traced `index.html`'s actual script order for the group: `admin-page.js` (base) loads first, then `loot-service.js`, `loot-rain.js`, `skills.js`, `phases.js`, `rage.js`, `summon-notify.js` — this ordering was itself the subject of an earlier, already-applied "LOAD ORDER FIX" (admin-page.js moved to load first within the group), so unlike `wbcApplyDamage`/`renderStudentWorldBoss` ×2/`renderStudentDashboard`, this is the first Category A function this session where **none** of the patches turned out dead: `skills.js` correctly captures the real base, `phases.js` correctly captures `skills.js`'s wrapped result, `rage.js` correctly captures `phases.js`'s wrapped result — a properly nested 3-deep chain, matching what the classification pass expected.

Confirmed `openBossForm`'s own body (`admin-page.js`) is pure post-hook/void-return shape: ends on a `showModal(...)` call with no return value used by any caller.

Checked the buttons' relative DOM ordering carefully before converting, since `rage.js`'s patch has a real behavioral dependency on `skills.js`'s: it looks for `#wbs-form-btn` as its preferred insertion anchor, only falling back to `.btn-primary` if that's missing. Under the old monkey-patch chain, this dependency was guaranteed by execution order (rage's wrapper calls phases' wrapper calls skills' wrapper calls base, synchronously, before any of their `setTimeout` callbacks fire) combined with each site's own delay (skills 90ms, phases 80ms, rage 100ms — phases first, then skills, then rage). Confirmed via both real (un-mocked) timers and `node:test`'s `mock.timers` that the same relative ordering — and therefore the same final DOM order (`phase, rage, skills, primary`) — holds after converting to independent `AppStore.subscribe()` handlers, because `AppStore`'s real `_notify()` walks `_subscribers` via `Object.keys()`, which preserves insertion order, and script load order (`skills.js` before `rage.js`) still determines subscribe-call order the same way it used to determine `_orig`-capture order.

**Files Changed:**
- `modules/world-boss/admin-page.js`: `openBossForm()` now ends with `AppStore.emit({ type: 'boss-form:opened', payload: { bossIndex } })`. No state mutation happens in the function body, so `emit()` rather than `updateState()` — same reasoning as `bootApp()`/`setupSidebar()`/`renderAnalytics()`.
- `modules/world-boss/skills.js`, `modules/world-boss/phases.js`, `modules/world-boss/rage.js`: each converted its `_orig`-capturing `window.openBossForm` wrapper to an `AppStore.subscribe('w{bs,p,rage}-boss-form-button', ...)` handler on the new event. Timing (90ms/80ms/100ms) and all DOM logic left byte-for-byte unchanged from the original patches — only the entry point (subscriber vs. monkey-patch) changed.
- 1 new test file (`boss-form-opened-event.test.js`), plus a `loadBossFormButtonsWindow` helper addition to `tests/unit/helpers/load-globals.js`. That loader stubs `setInterval` to a no-op before loading `skills.js`/`phases.js` — both register a top-level same-tab-fallback poll loop that would otherwise hang a standalone jsdom load indefinitely (methodology §2 step 6's "check this first" warning, hit for real here); documented in the loader's own comment rather than silently worked around.

**Architecture Before:** 3 `_orig`-capturing wrappers chained around `window.openBossForm`, all live.

**Architecture After:** Zero monkey-patches remain for `openBossForm`. Three independent `AppStore.subscribe()` handlers, each reacting to `boss-form:opened` — same effective behavior, same DOM output, same ordering, no chain to trace on the next person's next change.

**Why This Is Better:** Removes one more function from the monkey-patch inventory with zero behavior change (verified, not assumed) — no dead code found here, so this is purely a readability/maintainability win rather than also a bug fix, unlike the last 4 Category A sites converted.

**Coverage note:** the test suite verifies both real (`setTimeout`) and mocked (`mock.timers`) timer behavior agree with each other and with the original monkey-patch's DOM output — written that way after an initial version of the test asserted the wrong expected order (mis-derived from delay values alone, without accounting for `rage.js`'s anchor-on-`#wbs-form-btn` behavior actually reordering the DOM relative to a naive "fires later = appears later" assumption). Caught by running the loader against real timers first and correcting the assertion to match, rather than trusting the on-paper prediction.

**Remaining Technical Debt:** 6 of the original Category A list remain unconverted: `navTo` ×2, `achCheckAndAward`-as-title-hook (last, per the plan's own risk ordering — highest blast radius). `loot-rain.js`'s stale "also wraps openBossForm" comment in `index.html`'s LOAD ORDER FIX block is now known-incorrect and worth a small follow-up correction, not done here to keep this entry's diff focused on the actual conversion.

**CI Gate Added:** None yet — same recommended follow-up as prior entries (ESLint rule for the `const _orig = window.X; window.X = function` shape).

**Verification:** `node --check` on all 4 touched source files. `eslint .`: 0 errors, 466 warnings (unchanged). `node --test`: 87/87 passing (80 pre-existing + 7 new).

---

### Phase 4 (Continuation) — Event-Driven Communication (site: `navTo`) — 3rd unlisted site found (Category C, not converted)
**Date:** 2026-08-03

**Problem:** `CONTINUATION_PLAN.md` §3 listed `navTo` as the next recommended site — 2 patch sites (`reward-presenter.js`, `titles/titles_sidebar_refresh.js`), both classified post-hook/DOM-refresh. Per methodology (§2 step 1), grepped every `window.navTo =` assignment in the codebase before converting, rather than trusting the table's site count.

**Root Cause / Investigation:** The grep surfaced a 3rd site the plan's table didn't list: `modules/enrollment/enrollment-hub.js`'s `_enrollPatchNavGuard()`, which wraps `window.navTo` while Card Enrollment's kiosk lock mode is active, to block navigation to any page other than `a-enrollment`. This is the same undercounted-inventory pattern already hit on `renderAnalytics`/`renderStudentMail` this session — the plan's classification pass, done by reading `nav.js`'s own header comment (which itself turned out stale — see below), missed it.

Also found `nav.js`'s own "PHASE 1 EXTRACTION NOTE" header comment was stale: it claimed navTo was patched by "Leaderboard (HOL init), Titles (sidebar refresh), Inventory, DSM" — none of which, once grepped, actually assign `window.navTo` in this codebase. The real 3 sites are `reward-presenter.js`, `titles/titles_sidebar_refresh.js`, and `enrollment-hub.js`. Corrected in place rather than left to mislead the next person, same treatment as `loot-rain.js`'s stale "also wraps openBossForm" claim found in the prior entry.

`modules/world-boss/titles_sidebar_refresh.js` (the confirmed-dead duplicate of `modules/titles/titles_sidebar_refresh.js` from the `renderStudentDashboard` conversion) also still carries its own `navTo` patch in source — dead, not counted as a 4th site, same reasoning as before: no `<script>` tag loads that file.

**Classification — 2 convertible, 1 not:**
- `reward-presenter.js` and `titles/titles_sidebar_refresh.js`: both post-hook/void-return, both unconditionally applied at parse time — converted.
- `enrollment-hub.js`: **Category C** ("full replacement / call-rescheduling" per the plan's own §2 step 2) — its whole purpose is to *prevent* `navTo` from running when kiosk lock is active (`if (_enrollKioskLocked && id !== 'a-enrollment') { _enrollShowUnlockPrompt(); return; }` — never calls the real `navTo`). A reactive `AppStore.subscribe()` handler can only react after a function has already run; it cannot stop the function from running in the first place, so this genuinely cannot be expressed as a subscriber. It's also applied lazily at runtime (only once `_enrollLockKiosk()` actually fires), not unconditionally at parse time like the other two — by design, not oversight. Left as a monkey-patch, documented in place.

**Behavioral subtlety handled:** `navTo()`'s own body (in `nav.js`) has an early `return` at the very top — the `activeQuiz`/`quizFinishing` guard that reroutes to `abortQuiz()` instead of actually navigating when a student tries to leave an in-progress quiz via the sidebar. The old monkey-patches called `_orig(id)` first and ran their own side effects (badge refresh, title refresh) unconditionally afterward — including on that early-return path. Preserving that "always runs after, regardless of which internal branch fired" semantics (same reasoning as `renderAnalytics`'s `_renderAnalyticsCore()` split, two entries back) meant the new `AppStore.emit()` call had to sit outside the function body, not at its tail: `nav.js`'s original `navTo(id){...}` was renamed to `_navToCore(id)`, and a new thin `window.navTo = function(id){ _navToCore(id); AppStore.emit(...); }` wraps it. Verified directly (not just reasoned about): a test drives the abort path and asserts the event still fires with the originally-attempted `id`, matching what the old patches actually received.

**Files Changed:**
- `nav.js`: `navTo`'s body renamed to `_navToCore`; new `window.navTo` wrapper emits `{ type: 'nav:navigated', payload: { id } }` after calling it. Stale Phase 1 header comment corrected with the real, verified site list.
- `modules/shared/reward-presenter.js`: `navTo` patch → `AppStore.subscribe('reward-presenter-nav-badges', ...)`. Also corrected a stale trailing `console.log` that still described `navTo`/`bootApp` as "patched" when `bootApp` was already a subscriber from an earlier session.
- `modules/titles/titles_sidebar_refresh.js`: `navTo` patch → `AppStore.subscribe('titles-sidebar-nav-refresh', ...)`. Same stale trailing `console.log` correction (`bootApp` was already listed under both "Patches" and "Subscribers" — a pre-existing inconsistency, now resolved to just "Subscribers").
- `modules/enrollment/enrollment-hub.js`: no behavior change — added a comment documenting the Category C classification and confirming the guard still works correctly against the new, one-link-shorter `window.navTo` chain.
- 1 new test file (`nav-navigated-event.test.js`, 10 tests), plus a `loadNavAndBadgeRefreshWindow` helper addition to `tests/unit/helpers/load-globals.js`.

**Architecture Before:** 2 live `_orig`-capturing wrappers around `window.navTo` (unconditional), plus 1 conditional/lazy wrapper (`enrollment-hub.js`) applied on top of whichever of those was current at kiosk-lock time.

**Architecture After:** `window.navTo` is `nav.js`'s own thin wrapper, unless and until `enrollment-hub.js`'s kiosk-lock guard wraps it (chain is now at most 1 link deep instead of up to 3) — the 2 badge/title-refresh side effects are independent `AppStore.subscribe()` handlers instead.

**Why This Is Better:** No bug found here (unlike 4 of the 5 prior Category A conversions) — this is a readability/inventory-accuracy win: one less monkey-patch chain to trace, plus 2 stale comments corrected before they misled someone into looking for patches in Leaderboard/Inventory/DSM that were never there.

**Remaining Technical Debt:** 5 of the original Category A list remain unconverted: `achCheckAndAward`-as-title-hook (last, highest blast radius). `enrollment-hub.js`'s Category C guard stays a monkey-patch permanently — not technical debt, a correct architectural choice now documented as such.

**CI Gate Added:** None yet — same recommended follow-up as prior entries.

**Verification:** `node --check` on all 4 touched source files. `eslint .`: 0 errors, 465 warnings (down 1 from the previous entry's 466 — `navTo` was previously flagged `no-unused-vars` since nothing referenced the bare function-declaration name directly; the new wrapper calling `_navToCore` doesn't trip the same warning). `node --test`: 97/97 passing (87 pre-existing + 10 new).

---

### Phase 4 (Continuation) — Event-Driven Communication (site: `achCheckAndAward`-as-title-hook) — last Category A item, no dead patches found
**Date:** 2026-08-03

**Problem:** `CONTINUATION_PLAN.md` §3's last remaining Category A item — the plan itself flagged this as highest blast radius, since `achCheckAndAward` (unlike every other function converted this session) is called directly from ~8 places across the app rather than through one dispatch point.

**Root Cause / Investigation:** Grepped every reference to `achCheckAndAward` first. Confirmed the "highest blast radius" concern was about caller *count*, not conversion *risk*: since every one of those ~8 call sites (`campaign_engine.js`, `modules/world-boss/combat-settings.js`, `modules/shop/shop_store.js`, `modules/shop/shop_pos_terminal.js`, plus `ach_engine.js`'s own 4 internal subscribers) calls the single global `achCheckAndAward`, converting the ONE definition point in `ach_engine.js` covers all of them automatically — none needed to change. The actual risk was getting the base function's own early-return semantics right, not the caller count.

Confirmed load order (`ach_engine.js` at `index.html:807`, `titles/titles_sidebar_refresh.js` at `:817`) — same live, correctly-ordered pattern as every prior finding in this file (`ach_engine.js` has already been through several rounds of this conversion in earlier sessions; this was its last remaining patch).

**Behavioral subtlety handled — the reason this couldn't just reuse the existing `achievements:unlocked` event:** `achCheckAndAward`'s own body already emits `{ type: 'achievements:unlocked', ... }` via `AppStore.updateState()`, but only when `newlyUnlocked.length > 0`. The old title-unlock patch's own logic doesn't care about "newly" unlocked — on every call, it rescans the *entire* `achievementUnlocks` slice for the student against every active title's linked achievement, unlocking any title whose achievement is unlocked (new or old) that isn't already title-unlocked. That matters for a real scenario: an admin links a title to an achievement *after* a student already unlocked that achievement — the next unrelated call to `achCheckAndAward(studentId)` (nothing new to unlock) still needs to let the title-scan catch up. Reusing `achievements:unlocked` would have silently broken that catch-up path. Same "wrap the whole function, not just its tail" approach as `navTo`/`renderAnalytics`: `achCheckAndAward`'s body renamed to `_achCheckAndAwardCore`, with a thin `window.achCheckAndAward` wrapper that always emits a new, dedicated `achievements:check-and-award-ran` event after calling it — regardless of which internal branch `_achCheckAndAwardCore` took (no studentId, unknown student, or zero newly-unlocked). Verified directly: a test exercises the exact catch-up scenario (two titles linked to the same achievement across two separate calls, only the first unlock is "new") and confirms both eventually unlock.

**A real editing mistake caught before it shipped:** the first attempt at the `ach_engine.js` split accidentally dropped the `AppStore.emit()` call and the wrapper's closing brace during a `str_replace` (an old_str/new_str mismatch that deleted more than intended) — caught immediately by `node --check` failing with "Unexpected end of input" before any test was even run. Fixed and re-verified. Documented here as the same "verify before declaring done" discipline this plan has emphasized throughout — a static syntax check is cheap and catches this class of mistake instantly.

**Files Changed:**
- `modules/achievements/ach_engine.js`: `achCheckAndAward`'s body renamed to `_achCheckAndAwardCore` (plain function declaration, hoisted — referenced by the wrapper above its own textual position in the file, same as any hoisted function). New `window.achCheckAndAward` wrapper emits `{ type: 'achievements:check-and-award-ran', payload: { studentId, suppressPopup } }` after calling it.
- `modules/titles/titles_sidebar_refresh.js`: the `achCheckAndAward` patch → `AppStore.subscribe('titles-ach-check-and-award', ...)`. Same title-scan logic, byte-for-byte, just triggered by the new event instead of a captured `_orig`. Trailing `console.log` corrected — this file's last patch is now only `_holGetTitle`.
- 1 new test file (`ach-check-and-award-event.test.js`, 11 tests: emit-unconditionally, no-studentId safety, the base unlock→title-unlock round trip, no-link/inactive-title guards, the catch-up scenario, the already-unlocked guard, suppressPopup threading, unrelated-event no-op, and 2 static-shape checks), plus a `loadAchAndTitlesRoundTripWindow` helper addition to `tests/unit/helpers/load-globals.js` — loads both real files together with a fuller fake `AppStore` (mutable state, synchronous `updateState`/`emit` matching the real `_notify()`'s registration-order guarantee) so the test exercises the real round trip end to end, not just one half of it in isolation. Cross-realm gotcha hit and fixed along the way: array/object values mutated by code running inside the jsdom `vm` context aren't `===`-comparable via Node's `assert.deepStrictEqual` against literals written in the outer test file (different realm's `Array`/`Object` constructors) — switched those specific assertions to property-level checks or `JSON.stringify` comparison instead of deep-equal on the raw jsdom-realm values.

**Architecture Before:** 1 live `_orig`-capturing wrapper around `window.achCheckAndAward`, reached identically by all ~8 call sites regardless (since they all go through the same global name).

**Architecture After:** `window.achCheckAndAward` is `ach_engine.js`'s own thin wrapper around `_achCheckAndAwardCore`; the title-unlock logic is an independent `AppStore.subscribe()` handler. Same ~8 call sites, unchanged, still get the same combined behavior.

**Why This Is Better:** No bug found here — clean conversion, same as `openBossForm`. This closes out the Continuation Plan's entire original Category A list (the plan's own §3 table): `setupSidebar`, `renderAdminAchievements`, `renderAnalytics`, `renderStudentDashboard`, `openBossForm` (×3 sites), `navTo` (×2 sites, +1 correctly-left Category C found along the way), and now `achCheckAndAward` — 0 monkey-patches remain in that list except the 2 deliberate, documented exceptions (the dead `shop_pos_terminal.js` block, and `enrollment-hub.js`'s Category C `navTo` guard).

**Remaining Technical Debt:** None from the original Category A list — it's done. `_holGetTitle` (leaderboard title display) remains a monkey-patch in `titles_sidebar_refresh.js`, out of scope for this plan (not on the original list — worth a future pass if the pattern continues). The plan's own §5 (real browser/Supabase verification) remains the single largest open item across the whole engagement — every conversion this session, including this one, was verified via static analysis and jsdom unit tests only.

**CI Gate Added:** None yet — same recommended follow-up as every prior entry in this phase (an ESLint rule for the `const _orig = window.X; window.X = function` shape would have caught nothing new this entry, since none of the sites converted this session were newly introduced — but it would prevent regressions going forward).

**Verification:** `node --check` on all touched source files (and the one caught by this before any test ran). `eslint .`: 0 errors, 465 warnings (unchanged from the `navTo` entry). `node --test`: 108/108 passing (97 pre-existing + 11 new).

### Phase 5 — Data Layer Redesign (sub-phase A: Repository abstraction) — all 13 tables converted
**Date:** 2026-08-04

**Problem:** `_pushCacheToSupabase()` in `db-service.js` was ~700 lines (681, measured) containing 13 near-identical hand-written blocks — guard → (optional `isCatalogStaffSession` gate) → filter → map camelCase-to-snake_case → upsert whole table → catch-and-warn — one per synced table. This is the root cause behind the already-documented xp/coins/level/tier stale-tab clobbering bug (fixed for those four columns via the scoped `adjust_student_stats` RPC, Phase 9), and the same whole-roster last-write-wins risk remained structurally possible in the other 12 tables purely because nothing stopped a newly-added block from being a copy-paste of the nearest existing one, sans whatever safe exclusions that one happened to have accumulated.

**Root Cause:** Each table was added incrementally as a feature shipped; the fastest way to add "sync this new table too" was to copy the nearest block and change field names. No abstraction ever made the safe pattern the *only* option for a new table.

**Investigation / Session-context check before starting:** Confirmed all four inputs the Phase 5 write-up calls for were present and consistent before touching any code: `EduQuest_Engineering_Refactor_Log.md` confirms Phase 3 (all 12 module extractions) and all of Phase 4 (event-driven conversions) logged complete, satisfying the stated dependency. `modules/core/state-manager.js`'s `updateState()` is documented in the code itself as the sole mutation gate, matching what Phase 5B will need to hook into. `db-service.js`'s `_pushCacheToSupabase` measured at 681 lines across 14 `client.from(table)` calls (profiles + the 13 in scope here), matching the doc's "~700 lines" / "13 blocks" claims once profiles (already RPC-migrated, kept out of scope — see below) is set aside.

**Best-Practice Solution:** Replaced the 13 blocks with one generic `_runTableSync(client, cache, isCatalogStaffSession)` engine walking a declarative `_TABLE_SYNC_CONFIGS` array. Config shape: `table`, `getSource`, `hasRows` (guard), `requiresStaffGate` (boolean, replaces the inline `isCatalogStaffSession &&` checks), `buildRows` (the old filter+map logic, verbatim), `conflictKey`. One table (`boss_events`) keeps a custom `upsertRows` override instead of `buildRows`/`conflictKey`, since its write shape genuinely isn't a single upsert call — it needs per-row isolation (one malformed boss can't take down every other boss that cycle) and a retry-on-`23502` path recovering from a stale local `_id` whose server row was deleted out-of-band. Both of those behaviors are preserved exactly, not simplified away. 11 tables (`shop_products`, `achievements`, `titles`, `quizzes`, `campaign_worlds`, `point_log`, `notifications`, `redemptions`, `orders`, `inventory`, `quiz_history`) fit the fully generic shape; `boss_participants` fits it with a custom `buildRows` (its idx→uuid lookup + nested-object flatten). Adding a 14th synced table going forward is a config entry, not 40-50 new lines.

`profiles` (the students table) was deliberately NOT folded into this list, per the doc's own framing — it has its own bespoke per-class-id chunking and session-role branch that predates this repository layer and is already partially migrated onto RPCs for its highest-risk columns (`adjust_student_stats`, `sync_student_derived_stats`). Left untouched, unconverted, still inline in `_pushCacheToSupabase` exactly as before. Folding it into this generic shape is Phase 5B territory.

**Verification (this session, one-time, not a permanent test):** Built a throwaway harness loading BOTH the pre-refactor and post-refactor `db-service.js` into separate jsdom windows against a fake Supabase client recording every `.from(table).upsert(rows, opts)` call, run against identical fixture cache data covering all 14 tables plus edge cases (a brand-new boss row with no `_id`, an existing boss row, an unstamped-owner shop item). Compared across 5 scenarios: teacher session, student session, admin session, empty cache, and a forced `23502` response on the first `boss_events` upsert (to exercise the retry path). **All 5 scenarios produced byte-identical upsert payloads** (same tables called, same row contents, same `onConflict` values, same call counts: 15/15, 6/6, 15/15, 0/0, 16/16) between the original and refactored code — the mechanical verification the doc asked for.

**Files Changed:**
- `db-service.js`: inserted `_TABLE_SYNC_CONFIGS` (14 config objects) + `_runTableSync()` + hoisted `_pushTable()` above `_pushCacheToSupabase`; removed the 13 hand-written blocks from inside `_pushCacheToSupabase`, replaced with a single `await _runTableSync(client, cache, isCatalogStaffSession);` call. Added a test-only `DBService._test = { pushCacheToSupabase, tableSyncConfigs }` seam — not used by any runtime call site; `_flushUpload()`/`_getClient()` still drive every real push exactly as before.
- `tests/unit/helpers/load-globals.js`: added `loadDbServiceWindow()` (loads the real `db-service.js` into jsdom against a fake `window.supabase.createClient` and fake `AppStore.getSlice`) and `makeFakeSupabaseClient()` (records `.from(table).upsert(rows, opts)` calls, JSON-round-tripping rows/opts into host-realm plain objects so `assert.deepEqual` doesn't fail on the jsdom cross-realm-prototype gotcha already documented in this file's `loadAchAndTitlesRoundTripWindow` entry).
- 1 new test file (`tests/unit/db-service-repository-sync.test.js`, 6 tests): a simple table's filter+map (`point_log`, including the skip-if-no-id case), the staff-gate skip/include behavior (`shop_products` under a student vs. teacher session), the two nested-object flatten tables (`inventory`, `quiz_history`), `boss_participants`' idx→uuid resolution (including the "no matching boss uuid → skip, don't throw" case), table-isolation (an `achievements` failure doesn't block `titles` from being attempted the same cycle), and `boss_events`' 23502-retry path.

**Architecture Before:** 13 copy-pasted blocks, each hand-rolling its own guard/gate/filter/map/upsert/catch-warn, totaling ~630 of the function's 681 lines (profiles' block is the remainder).

**Architecture After:** One declarative config array + one generic engine (~40 lines) walking it, plus the two tables (`boss_events`, `boss_participants`) whose write shape needed a small documented escape hatch (`upsertRows` override, custom `buildRows`) rather than the fully generic path. `_pushCacheToSupabase` itself is now just the profiles block + a single `_runTableSync()` call.

**Why This Is Better:** Adding a synced table is now a config entry, not a 40-50 line copy-paste — directly closing the mechanism that let the DRY violation (and its associated clobbering-risk) grow to 13 instances in the first place. The two genuine exceptions (`boss_events`, `boss_participants`) are explicit, named, and documented in the config comments, not silently absorbed into a leaky "generic" abstraction that would have had to grow special-case branches inside itself.

**Remaining Technical Debt:** `profiles` is still its own bespoke block, unconverted — intentional, tracked as Phase 5B's first real target once a lowest-traffic/lowest-consequence table is chosen to start delta sync on (explicitly NOT `profiles`, per the doc's own risk-ordering, even though it's the most obviously related table). No delta/patch sync exists yet anywhere — every table in `_TABLE_SYNC_CONFIGS` still pushes its *entire* local slice on every cycle; that's the actual root-cause fix, deferred to Phase 5B, one table at a time, with a required no-clobber test (two concurrent sessions changing different fields on the same entity, both survive) before each conversion.

**CI Gate Added:** None yet. A future lint/test-coverage rule requiring any new `client.from(<table>).upsert(...)` call site outside `_TABLE_SYNC_CONFIGS` to fail CI would directly prevent this DRY violation from recurring — worth adding once Phase 5B's delta-sync shape is settled, since that phase will change what "the safe pattern" looks like per table.

**Verification:** `node --check db-service.js`. `node --test tests/unit/**/*.test.js`: 114/114 passing (108 pre-existing + 6 new). `eslint db-service.js`: 0 errors, 10 warnings — identical set to the pre-refactor file (confirmed by diffing lint output against the original file swapped back in temporarily), i.e. zero new warnings introduced. Plus the one-time original-vs-refactored byte-identical payload harness described above (5/5 scenarios identical, not re-run as part of the permanent suite).

### Phase 5 — Data Layer Redesign (sub-phase B: delta/patch sync, table: point_log)
**Date:** 2026-08-04

**Problem:** Every table in `_TABLE_SYNC_CONFIGS` (Phase 5A) still pushes its *entire* local slice to Supabase on every flush cycle. That's the actual root-cause risk the Phase 5 doc flagged: two sessions each pushing a full stale snapshot of the same table can silently overwrite each other's writes — the exact mechanism that corrupted xp/coins/level/tier before `adjust_student_stats` scoped that one write to just those columns (Phase 9). The same structural risk is still live in all 13 tables Phase 5A's generic engine covers; it just hasn't corrupted anything else yet.

**Root Cause:** `AppStore.updateState()` — the sole mutation gate — never tracked *which* rows a given commit actually changed, so the repository layer had no way to know what was safe to omit. Pushing the whole slice every time was the only option available, not a deliberate choice.

**Investigation / session-context check before starting:** Re-confirmed Phase 5A's own "Remaining Technical Debt" note names this exact gap and explicitly defers table selection to this session, "explicitly NOT `profiles`... even though it's the most obviously related table." Re-read `modules/core/state-manager.js`'s `updateState()` to confirm it really is the sole mutation gate (doc comment + code agree — nothing else assigns `_state`). Picked `point_log` as the first table, per the doc's own risk-ordering ("lowest-traffic/lowest-consequence... not anything student-XP-adjacent"): it's append-only — a row's fields are fixed forever once created — so there's no concurrent-same-row-edit scenario to get wrong while this plumbing is new, unlike `notifications` (read flag gets mutated in place) or `orders` (status transitions through POS/cancel flows).

**Best-Practice Solution:** Two pieces, matching the doc's "extend `updateState()`... generalize the RPC-proven pattern via scoped upsert-of-dirty-rows-only where whole-row replacement is genuinely fine" framing — `point_log` rows are always-whole-row-fine (nothing ever partially edits one), so no RPC was needed here, just a scoped upsert of the dirty subset:

1. **`modules/core/state-manager.js`** — added `_DELTA_TRACKED_SLICES` (currently just `point_log: { statePath: 'pointLog', idField: 'id' }`), a `_trackDirty(oldState, newState)` diff run inside `updateState()` *before* committing the draft (so an aborted mutation — `mutationFn` throwing — never reaches it, preserving the existing abort-on-error atomicity), and two new public methods: `getDirtyIds(table)` (returns a plain array copy, `[]` for an untracked table — same shape as "tracked, nothing pending") and `clearDirty(table, ids)` (called only after a confirmed successful push). `syncFromLegacy()` deliberately does NOT call `_trackDirty()` — every call site there is data arriving *from* Supabase, and marking a pull dirty would just re-push what the server already has, the same echo-loop shape `mirrorLocalOnly()` already exists to prevent for the whole-slice path.
2. **`db-service.js`** — `point_log`'s config gained `deltaTracked: true` / `idField: 'id'`. `_runTableSync()` now asks `AppStore.getDirtyIds(cfg.table)` for any `deltaTracked` config; a real array (even empty) means "trust this," filtering `buildRows`' source down to just those ids and skipping the push entirely when it's empty; anything else (no `AppStore.getDirtyIds`, or it returns non-array) falls back to Phase 5A's full-slice push unchanged. On a successful (non-throwing) upsert, `AppStore.clearDirty()` is called with exactly the ids that were pushed; on failure, nothing is cleared, so `_pushTable`'s existing catch-and-retry-next-cycle behavior naturally covers delta pushes too.

**No-clobber test (required before this table counted as converted):** `point_log`'s append-only shape means the doc's literal "two sessions editing different fields on the same row" scenario doesn't apply — there's no row that's ever edited twice. Adapted it to the equivalent real risk: two independent sessions each dirty their own new `point_log` entry and each run their own push cycle against a shared fake server. Asserts each session's payload contains *only* its own row (never the other session's), and that each session's dirty id clears independently. This proves the dirty-scoped-push plumbing itself before it's generalized to a table (e.g. `notifications`, `orders`) where the literal same-row-different-field scenario is real and this test's shape will need to change accordingly.

**Files Changed:**
- `modules/core/state-manager.js`: `_DELTA_TRACKED_SLICES`, `_dirty`, `_trackDirty()`, `getDirtyIds()`, `clearDirty()`; one new call (`_trackDirty(_state, draft)`) inside `updateState()`, placed before `_state = draft`.
- `db-service.js`: `point_log` config gained `deltaTracked`/`idField`. `_runTableSync()` gained the dirty-id lookup/filter/clear block. Config-shape doc comment above `_TABLE_SYNC_CONFIGS` extended to document the two new fields.
- `tests/unit/helpers/load-globals.js`: added `loadAppStoreWindow()` (loads the real `state-manager.js` against a fake `DBService.read()`/`DEFAULT_DB`, no Supabase round trip needed). Extended `loadDbServiceWindow()`'s fake `AppStore` to optionally expose `getDirtyIds`/`clearDirty` when a test passes `opts.dirtyIds` (a `{table: string[]}` map) — omitting it is what exercises the existing fallback-to-full-push path, so the Phase 5A `point_log` test needed zero changes.
- 2 new test files: `tests/unit/app-store-dirty-tracking.test.js` (5 tests — new row marked dirty, unrelated commit leaves it untouched, `clearDirty` removes exactly what's asked, an aborted mutation never dirties anything, an untracked table name is inert rather than an error) and `tests/unit/point-log-delta-sync.test.js` (4 tests — dirty-subset-only push + matching `clearDirty` call, an explicit empty dirty array skips the push and `clearDirty` entirely, a failed push leaves ids dirty for retry, and the no-clobber test described above).

**Architecture Before:** `updateState()` had no concept of "what changed" — every flush cycle re-sent every synced table's full local slice, on every table, unconditionally.

**Architecture After:** `updateState()` diffs a small, explicit allowlist of tracked slices on every commit and exposes exactly which local row ids are unsynced. `_runTableSync()` consults that per delta-tracked table and narrows its push to just those rows, clearing them only once the server confirms. Untracked tables (12 of 13) are completely unaffected — same Phase 5A full-slice behavior, byte-identical.

**Why This Is Better:** This is the actual root-cause fix the doc called for, not just the structural DRY cleanup Phase 5A did — a table converted this way can no longer have one session's full-slice push clobber another session's concurrent write to a *different* row, because it's no longer sending rows it didn't touch. `point_log` itself was never at real risk of that (append-only), which is exactly why it was the safe table to prove the mechanism on first.

**Remaining Technical Debt:** 12 of 13 `_TABLE_SYNC_CONFIGS` tables are still full-slice-push, unconverted — this is a one-table-at-a-time rollout by design, per the doc's own risk ordering, not a shortcut taken here. `profiles` (the actual origin of the documented xp/coins/level/tier bug) remains completely untouched, still inline in `_pushCacheToSupabase`, not even folded into the generic config shape yet — both Phase 5A's and this session's "next" item, still not this session's item. The next table chosen should be one where the no-clobber test's *literal* same-row-different-field scenario applies (`notifications`' read flag or `orders`' status transitions are the natural next candidates) so the test suite actually exercises the concurrent-edit case this mechanism exists for, not just the append-only variant proven here.

**CI Gate Added:** None yet — same open item as Phase 5A. Worth adding once more than one table's delta shape exists: a lint rule flagging any `_TABLE_SYNC_CONFIGS` entry with `deltaTracked: true` but no matching `_DELTA_TRACKED_SLICES` entry (or vice versa) would catch the two files silently drifting out of sync with each other, which nothing currently enforces beyond code review.

**Verification:** `node --check db-service.js` and `node --check modules/core/state-manager.js`. `node --test tests/unit/**/*.test.js`: 123/123 passing (114 pre-existing + 9 new — 5 in `app-store-dirty-tracking.test.js`, 4 in `point-log-delta-sync.test.js`). `eslint .`: 0 errors, 465 warnings — identical count to the pre-session baseline (confirmed against the Phase 5A entry's own recorded 465), i.e. zero new warnings introduced by either file.

### Phase 5 — Data Layer Redesign (sub-phase B: delta/patch sync, table: notifications)
**Date:** 2026-08-04

**Problem:** Same structural risk as the point_log entry above, but this time on a table where it's not theoretical: `notifications` has a field (`read`) that genuinely gets mutated after row creation (mark-read / mark-all-read), so a whole-slice push from a session holding a stale local copy of a notification it never touched can silently revert another session's already-confirmed `read` write.

**Root Cause:** Same as point_log's entry — `_pushCacheToSupabase` pushed whole slices because nothing tracked which rows actually changed.

**Investigation / session-context check before starting:** Re-read this session's own point_log entry's "Remaining Technical Debt" note, which named `notifications` (read flag) or `orders` (status transitions) as the natural next candidate specifically because they exercise the same-row-mutated-field case point_log's append-only shape couldn't test. Confirmed `notifications`' only post-creation mutation anywhere in the codebase is the `read` flag (grep for `.read =` / mark-read call sites) — every other column is set once at creation and never touched again, same "whole-row-replacement is genuinely fine" shape as point_log, so no RPC was needed here either, just delta-scoping the same upsert.

**Best-Practice Solution:** Mechanically identical extension of the same Phase 5B plumbing point_log now uses — no new mechanism, two lines of config/registration:
1. `modules/core/state-manager.js`: added `notifications: { statePath: 'notifications', idField: 'id' }` to `_DELTA_TRACKED_SLICES`.
2. `db-service.js`: `notifications`' config gained `deltaTracked: true` / `idField: 'id'`.

**No-clobber test (the real one this time):** Unlike point_log, this table's shape lets the doc's literal scenario be constructed directly: two sessions both start from an unread `n1`/`n2`. Session A marks `n1` read and pushes. Session B — which never pulled A's change, so its local cache still shows `n1` as unread — independently marks the *different* row `n2` read and pushes its own cycle. Asserts B's payload contains only `n2` (never a stale re-send of `n1`), and that `n1`'s `read:true` from A is never overwritten across both pushes. This is the first no-clobber test in this phase that isn't an adaptation — it's the actual scenario the doc asked for, just with two different rows sharing the same account rather than literally "different fields on one row" (no table converted so far has two independently-actor-edited columns on a single row; `orders`, once converted, will be the first candidate for that literal shape).

**Files Changed:**
- `modules/core/state-manager.js`: `_DELTA_TRACKED_SLICES` gained a `notifications` entry; comment above it updated to explain why this table is the mechanism's first real mutable-field test.
- `db-service.js`: `notifications` config gained `deltaTracked`/`idField` plus a short comment pointing at the same rationale.
- `tests/unit/helpers/load-globals.js`: `loadAppStoreWindow()` extended to also accept/seed a `notifications` array (was point_log-only).
- 1 new test file, `tests/unit/notifications-delta-sync.test.js` (4 tests): dirty-subset-only push + matching `clearDirty`, an explicit empty dirty array skips the push, a failed push leaves ids dirty for retry (same three shapes as point_log's suite, not re-explained there), and the stale-cache no-clobber test described above.

**Architecture Before/After:** Same shape as the point_log entry — 11 of 13 tables now remain full-slice-push; `point_log` and `notifications` are delta-tracked.

**Why This Is Better:** This is the first delta-tracked table where the fix isn't just structurally sound but demonstrably prevents a real clobber on a real mutable field, not an append-only one — closing the gap point_log's own "Remaining Technical Debt" note flagged.

**Remaining Technical Debt:** 11 of 13 tables still full-slice-push (`shop_products`, `achievements`, `titles`, `quizzes`, `campaign_worlds`, `redemptions`, `orders`, `inventory`, `quiz_history`, `boss_events`, `boss_participants`). `profiles` — the table the original xp/coins/level/tier bug actually happened on — is still untouched, still not even folded into the generic config shape. `orders` remains the first candidate for the doc's *literal* "different fields on the same row, two sessions" scenario (claim/cancel status transitions vs. other order fields) — nothing converted so far has genuinely independent actors editing different columns of one row. Same CI-gate gap as before: nothing enforces `_DELTA_TRACKED_SLICES` and `_TABLE_SYNC_CONFIGS`' `deltaTracked` entries staying in sync with each other.

**CI Gate Added:** None yet — same open item, now spanning two tables' worth of config that could silently drift apart.

**Verification:** `node --check db-service.js` and `node --check modules/core/state-manager.js`. `node --test tests/unit/**/*.test.js`: 127/127 passing (123 pre-existing + 4 new). `eslint .`: 0 errors, 465 warnings — unchanged from the point_log entry's own recorded baseline.

### Phase 5 — Data Layer Redesign (sub-phase B: delta/patch sync, table: orders)
**Date:** 2026-08-04

**Problem:** Same structural risk as the two prior entries, now on a table with more surface area: `orders` has THREE mutable-together fields per lifecycle transition (`status`/`claimed_at`/`claimed_by` on a staff claim; `cancelled_at`/`cancel_reason`/`cancelled_by` on a self-cancel), so a stale whole-slice push doesn't just risk reverting one flag — it can revert a whole transition bundle on a row at once.

**Root Cause:** Same as the prior two entries.

**Investigation / session-context check before starting:** Re-read the notifications entry's own "Remaining Technical Debt," which named `orders` specifically as "the first candidate for the doc's literal different-fields-same-row scenario." Read every `orders`-mutating call site (`cartCheckout`, `posExecuteClaim`, `posExecuteCancel`, `ordExecuteCancel`) to confirm which fields each touches — confirmed no two of those functions are ever both plausibly in-flight on the *same* order row at once in normal usage (claim/cancel are mutually exclusive terminal transitions), so the constructible no-clobber test remains "two sessions, two different rows" (same shape as the notifications entry) rather than genuinely simultaneous edits to different columns of one row — noted honestly below rather than overstating what this proves.

**Best-Practice Solution:** Same two-piece extension as the prior two tables:
1. `modules/core/state-manager.js`: `orders: { statePath: 'orders', idField: 'orderId' }` added to `_DELTA_TRACKED_SLICES`.
2. `db-service.js`: `orders` config gained `deltaTracked: true` / `idField: 'orderId'`.

No RPC needed — same "whole-row-replacement is fine, just needs to be scoped to the dirty row" reasoning as the other two tables; nothing partially edits an order row from two different actors at once.

**No-clobber test:** Session A (staff) claims `o1` — `status`/`claimed_at`/`claimed_by` change together. Session B, a second staff tab that never pulled A's claim (so its local `o1` is still `pending` with null claim fields), independently checks out a brand-new, unrelated order `o2` and pushes its own cycle. Asserts B's payload contains only `o2` — never a stale re-send of `o1` — and that `o1`'s claimed status (all three fields) survives across both pushes. Same "different row, not different fields of one row" caveat as the notifications entry applies here too; flagged in Remaining Technical Debt below rather than glossed over.

**Files Changed:**
- `modules/core/state-manager.js`: `_DELTA_TRACKED_SLICES` gained an `orders` entry; comment above it extended to explain the multi-field-bundle rationale.
- `db-service.js`: `orders` config gained `deltaTracked`/`idField` plus a comment pointing at the same rationale.
- `tests/unit/helpers/load-globals.js`: `loadAppStoreWindow()` extended to also accept/seed an `orders` array.
- 1 new test file, `tests/unit/orders-delta-sync.test.js` (4 tests): dirty-subset-only push, empty-dirty-array skip, failed-push-stays-dirty, and the multi-field no-clobber test above.

**Architecture Before/After:** Same shape as the prior two entries — 10 of 13 tables now remain full-slice-push; `point_log`, `notifications`, `orders` are delta-tracked.

**Why This Is Better:** Extends the proven mechanism to the highest-field-count table converted so far, with no new code in the engine itself — purely two lines of config per table, exactly the "config entry, not new code" outcome Phase 5A's repository abstraction was built to enable, now proven true for Phase 5B's delta layer too.

**Remaining Technical Debt:** 10 of 13 tables still full-slice-push (`shop_products`, `achievements`, `titles`, `quizzes`, `campaign_worlds`, `redemptions`, `inventory`, `quiz_history`, `boss_events`, `boss_participants`). `profiles` remains untouched. No table converted across all three entries so far has the doc's *literal* "two different actors editing two different columns of the identical row at the identical time" shape — every no-clobber test proven is "two different rows, one session's stale copy of the row it didn't touch." `boss_participants` (per-student combat stats — `totalDamage`/`correctAnswers`/`wrongAnswers` could plausibly be touched by different question-answer events landing close together within one student's session, though still not two *different* sessions on one row) may be worth a closer look for whether that literal shape is even constructible anywhere in this app, or whether it's a scenario the app's own architecture (each order/notification/point-log-entry is only ever authored by one lifecycle actor at a time) structurally avoids — worth resolving explicitly before claiming Phase 5B "fully proven" rather than continuing to defer it table after table. Same CI-gate gap as before, now spanning three tables.

**CI Gate Added:** None yet — same open item.

**Verification:** `node --check db-service.js` and `node --check modules/core/state-manager.js`. `node --test tests/unit/**/*.test.js`: 131/131 passing (127 pre-existing + 4 new). `eslint .`: 0 errors, 465 warnings — unchanged from prior entries' recorded baseline.

### Phase 5 — Data Layer Redesign (sub-phase B: delta/patch sync, table: boss_participants)
**Date:** 2026-08-04

**Problem:** The three prior entries' shared open question — "does the doc's literal two-actor, same-row clobber scenario exist anywhere in this app?" — turned out to have a concrete answer: `boss_participants`. Combat damage is already written through a scoped `apply_boss_damage` RPC (atomic, per-student, in real time — see `combat-settings.js`'s `wbcApplyDamage`), but the old whole-slice push still ran on every save cycle regardless, re-sending every OTHER student's cached roster entry for that boss along with the caller's own. Two students fighting the same boss concurrently: student B lands a hit (RPC updates B's row instantly). Student A's client, which hasn't pulled B's update yet, saves for an unrelated reason and bulk-pushes its whole local `bossParticipants[bossIdx]` — including A's stale cached copy of B's row — silently reverting B's just-recorded damage. This is the real thing the doc asked to prove fixed, not an adaptation.

**Root Cause:** Same structural gap as the other three entries, but here compounded by the fact that this table's most important field (`totalDamage`) is ALSO written by an RPC — meaning the whole-slice bulk push was, until this session, silently racing against and periodically overwriting its own more-careful sibling write path. `_pushCacheToSupabase`'s bulk upsert was never scoped to "what did THIS session touch," so it had no way to avoid re-sending data another actor already updated more precisely.

**Investigation / session-context check before starting:** Explicitly went looking for the literal scenario after flagging it as unresolved in the `orders` entry — grepped every `bossParticipants` write site (`combat-settings.js`, `minions.js`, `raid-flow.js`, `student-page.js`, `battle-overlay.js`, `admin-page.js`) to confirm every combat-side write indexes by `currentUser.id` (never cross-writes another student's key) and to find `wbcApplyDamage`'s existing RPC path, which is what made this table's real risk visible rather than theoretical.

**Best-Practice Solution:** `boss_participants` isn't a flat array (`bossParticipants[bossIdx][studentId]`), so this table needed two small, genuinely new (not copy-pasted) extensions to the Phase 5B mechanism rather than a pure config addition like the prior three:
1. `modules/core/state-manager.js`: `_DELTA_TRACKED_SLICES` gained a `shape: 'nested'` option (default remains `'array'`) and a new `_trackDirtyNested()` diff function for two-level keyed objects, producing a composite `"<bossIdx>:<studentId>"` dirty id.
2. `db-service.js`: added an OPTIONAL `deltaFilterSource(source, dirtySet, cache)` config field — an escape hatch for any delta-tracked table whose source isn't a flat array, so `idField` alone can't express "which rows are dirty." `boss_participants`' implementation pre-checks boss-uuid resolvability (the same check `buildRows` already makes) before including an id in its filtered output, so every id it returns is guaranteed to produce an actual pushed row — an unresolved boss's dirty ids are simply left out (and so stay dirty for a later cycle) rather than risk `clearDirty()` on an id `buildRows` silently dropped.

**No-clobber test:** Two students, same boss (`bossIdx: 0`), starting from the same pull (`s1` at 10 damage, `s2` at 20). Student A lands a hit on `s1` — only `"0:s1"` becomes dirty on A's client. A's push cycle is asserted to contain exactly one row (`s1`, updated damage) — `s2`'s row, still sitting in A's local cache from the original pull, must NOT be re-sent. This is the literal same-row-reachable-by-a-different-session case the doc originally asked for, closing the gap the prior three entries' tests couldn't.

**Files Changed:**
- `modules/core/state-manager.js`: `_DELTA_TRACKED_SLICES` gained `boss_participants` (`shape: 'nested'`) and its own comment explaining why; new `_trackDirtyNested()` function.
- `db-service.js`: new `deltaFilterSource` config field (documented alongside `deltaTracked`/`idField` in the `_TABLE_SYNC_CONFIGS` shape comment); `boss_participants` config gained `deltaTracked: true` + a `deltaFilterSource` implementation; `_runTableSync()` extended to call `cfg.deltaFilterSource` when present instead of the generic array filter, and to clear the ids it returns rather than deriving them from `rows.map(r => r[cfg.conflictKey])` (which doesn't apply to a composite `'boss_id,student_id'` conflict key anyway).
- `tests/unit/helpers/load-globals.js`: `loadAppStoreWindow()` extended to also accept/seed a `bossParticipants` object.
- 1 new test file, `tests/unit/boss-participants-delta-sync.test.js` (4 tests): dirty-pair-only push, an unresolved-boss dirty id is neither pushed nor cleared, an explicit empty dirty array skips the push, and the two-student no-clobber test above.

**Architecture Before/After:** 9 of 13 tables now remain full-slice-push; `point_log`, `notifications`, `orders`, `boss_participants` are delta-tracked. The delta mechanism itself is now proven across three shapes: append-only, mutable-flat-array, and nested-composite-key.

**Why This Is Better:** This is the first Phase 5B conversion that fixes a clobber risk this session could point to as *live*, not merely structurally-possible-someday — `apply_boss_damage`'s RPC was already doing the careful, scoped write; the bulk push was undermining it on every unrelated save. Also proves the Phase 5B mechanism generalizes past its original flat-array assumption without needing a rewrite — one new `shape` option, one new escape-hatch config field, same engine otherwise.

**Remaining Technical Debt:** 9 of 13 tables still full-slice-push (`shop_products`, `achievements`, `titles`, `quizzes`, `campaign_worlds`, `redemptions`, `inventory`, `quiz_history`, `boss_events`). `profiles` remains completely untouched — still the highest-value remaining target, still deferred every session so far. `boss_events` itself (not yet converted) has its own `upsertRows` override for per-row isolation reasons (Phase 14-era) that hasn't been reconciled with the delta-sync path at all — converting it will need to decide how `deltaTracked` and a custom `upsertRows` interact, since right now the engine's delta-filtering only narrows `source` before either `buildRows` OR `upsertRows` runs, untested against the latter. Same CI-gate gap as before, now spanning four tables plus two shape variants.

**CI Gate Added:** None yet — same open item, now also covering `shape: 'nested'` and `deltaFilterSource` drifting out of sync between the two files.

**Verification:** `node --check db-service.js` and `node --check modules/core/state-manager.js`. `node --test tests/unit/**/*.test.js`: 135/135 passing (131 pre-existing + 4 new). `eslint .`: 0 errors, 465 warnings — unchanged from prior entries' recorded baseline.

### Phase 5 — Data Layer Redesign (structural: fold `profiles` into the repository engine)
**Date:** 2026-08-04

**Problem:** `profiles` — the table the *original* documented xp/coins/level/tier clobbering bug actually happened on — was still a standalone ~160-line block inside `_pushCacheToSupabase`, never folded into Phase 5A's `_TABLE_SYNC_CONFIGS` abstraction at all. Every session's log entry in this phase (Phase 5A itself, and every Phase 5B entry so far) named this as the single most-repeated open item and then deferred it again.

**Root Cause:** `profiles` predates the repository engine and has genuinely more logic than any other table (a live session double-check beyond the cheap staff-gate every other table uses, per-class-id RLS-driven chunking, and a hard exclusion list of six RPC-owned columns) — Phase 5A scoped it out explicitly rather than risk getting that logic wrong while proving the abstraction on the other 13 tables first.

**Investigation before starting:** Read every line of the standalone block plus its own extensive inline comments (RLS type-mismatch history, the Phase 45 per-class-id chunking rationale, the Investigation Report §6.1 and Pending Fixes Report §3 column-exclusion history) to make sure nothing got silently dropped in the move — this is the highest-blast-radius table in the whole file, and a subtle behavior change here (e.g. one class_id's failure aborting every other table's push) is exactly the kind of regression the Phase 45 chunking fix was written to prevent in the first place.

**Best-Practice Solution:** Moved the entire block into a new `profiles` entry in `_TABLE_SYNC_CONFIGS`, as an `upsertRows` override (same escape hatch `boss_events` already uses for its own per-row-isolation needs) — every line of logic preserved verbatim: the live `client.auth.getSession()` check (kept as an *additional* layer alongside the new `requiresStaffGate: true` pre-filter, not a replacement for it — defense-in-depth was the original intent and stays that way), the admin-vs-teacher `writableClassIds` restriction, the per-class-id chunking with warn-not-throw on a rejected chunk, and the six-column RPC-ownership exclusion (`xp`/`coins`/`level`/`tier`/`attendance_pct`/`quiz_avg` never appear in the payload — still owned exclusively by `adjust_student_stats`/`sync_student_derived_stats`). The old standalone block in `_pushCacheToSupabase` is gone; `_runTableSync()` now drives profiles exactly like every other table.

**Deliberately NOT delta-tracked this session:** every other delta-tracked table's `clearDirty()` call assumes "the upsert didn't throw" means "everything in this push landed" — true for a single-batch upsert, but false here, since this table's upsert is chunked per `class_id` and a rejected chunk warns-and-continues rather than throwing (by design, so one bad chunk can't abort every other table's push). Naively delta-tracking this table with the existing engine would `clearDirty()` every dirtied student, including ones in a chunk that just failed, permanently losing their retry. Fixing that correctly needs `upsertRows` to report back which ids actually succeeded so the engine can clear only those — flagged as real, scoped follow-up work rather than shortcut into this pass just to check "profiles" off the delta-tracked list.

**Files Changed:**
- `db-service.js`: new `profiles` entry in `_TABLE_SYNC_CONFIGS` (first in the array); old standalone block removed from `_pushCacheToSupabase`; header comment above `_TABLE_SYNC_CONFIGS` updated to reflect profiles no longer being excluded.
- 1 new test file, `tests/unit/profiles-repository-sync.test.js` (5 tests) — none of this behavior had dedicated tests before (it was inline, untested-in-isolation code); now locked in: a student session never even attempts the upsert, an admin session's payload contains ONLY the eight identity/cosmetic columns (explicitly asserting all six RPC-owned columns are absent), an admin session isn't restricted by `writableClassIds`, a teacher session is restricted to their own advised sections and chunked one call per `class_id`, and one rejected `class_id` chunk doesn't block another chunk in the same cycle.

**Architecture Before:** `profiles` write logic lived as bespoke inline code, structurally disconnected from every other table's sync path, untested in isolation.

**Architecture After:** `profiles` is a config entry like every other table (via the same `upsertRows` escape hatch `boss_events` already established), driven by the same `_runTableSync()` loop, same `_pushTable()` per-table error isolation. Zero tables are now exempt from the generic engine.

**Why This Is Better:** Closes the single most-repeated debt item in this phase's log with zero behavior change (same payload, same chunking, same failure handling — verified byte-for-byte by the new tests, not just asserted) and, for the first time, gives this table's most historically fragile logic (the Phase 45 chunking fix, the RLS defense-in-depth check, the RPC-column exclusion) actual test coverage instead of relying on inline comments and code review alone.

**Remaining Technical Debt:** 9 of 13 non-profiles tables still full-slice-push (`shop_products`, `achievements`, `titles`, `quizzes`, `campaign_worlds`, `redemptions`, `inventory`, `quiz_history`, `boss_events`). `profiles` itself is now structurally consistent with the rest but still NOT delta-tracked — the real next step for it specifically is extending `upsertRows`' contract to report per-chunk success back to the engine, which would unlock safe delta tracking for any chunked-write table, not just this one. Same CI-gate gap as every prior entry.

**CI Gate Added:** None yet — same open item.

**Verification:** `node --check db-service.js`. `node --test tests/unit/**/*.test.js`: 140/140 passing (135 pre-existing + 5 new). `eslint .`: 0 errors, 465 warnings — one transient new warning (an unused `cache` param on the moved `upsertRows`) caught and removed before finalizing, confirmed back at the unchanged baseline.

### Phase 5 — Data Layer Redesign (sub-phase B: delta/patch sync, table: inventory)
**Date:** 2026-08-04

**Problem:** Same structural risk as the prior delta-tracked tables, on a table whose second-actor scenario is different in kind from `boss_participants`': the second actor isn't another student's own concurrent session — it's a TEACHER, operating the shop POS terminal on a student's behalf, writing into that same student's inventory list at the same time the student's own device independently makes a purchase.

**Root Cause:** Same as every prior entry in this phase.

**Investigation / session-context check before starting:** Grepped every writer of `draft.inventory` (`registrations.js`, `loot-service.js`, `shop_promotions.js`, `shop_store.js`, `shop_index.js`, `shop_inventory.js`, `shop_pos_terminal.js`) and confirmed `shop_pos_terminal.js` writes into `draft.inventory[studentId]` — i.e. a teacher-run terminal, not the student's own client — while `shop_store.js`/`shop_index.js` are the student's own purchase flow into the exact same array. Unlike `orders`' claim/cancel transitions (mutually exclusive on one row) or `boss_participants`' per-student-only writes, this is two DIFFERENT ROLES genuinely able to append to the same list concurrently in normal, non-adversarial use — a teacher helping a student redeem something in person while that student is also on their phone.

**Best-Practice Solution:** `inventory[studentId] = [items...]` is neither a flat array (`point_log`/`notifications`/`orders`) nor an object-of-objects (`boss_participants`) — it's an object keyed by student, whose *value* is an array. This needed one more, genuinely new (not copy-pasted) extension to the Phase 5B mechanism:
1. `modules/core/state-manager.js`: `_DELTA_TRACKED_SLICES` gained a `shape: 'nestedArray'` option and `_trackDirtyNestedArray()` — diffs an object-of-arrays, producing composite id `"<studentId>:<itemId>"` via a per-student `innerIdField` lookup (a hybrid of the existing `'array'` and `'nested'` diff algorithms, not a rewrite of either).
2. `db-service.js`: `inventory` config gained `deltaTracked: true` and a `deltaFilterSource` implementation for this shape — simpler than `boss_participants`' version since inventory rows don't reference another table's server-generated id, so no resolvability pre-check is needed.

**No-clobber test:** Both sessions start from student `s1` owning item `i1`. Session A (the student's own device) buys `i2` — only `"s1:i2"` dirties. Session B (a teacher on the POS terminal, working from a stale cache that still shows only `i1`) grants `i3` on the student's behalf — only `"s1:i3"` dirties. Asserts each push contains exactly its own new item, never a stale re-send of the other session's addition (or its own absence of the other's addition).

**Files Changed:**
- `modules/core/state-manager.js`: `_DELTA_TRACKED_SLICES` gained `inventory` (`shape: 'nestedArray'`, `innerIdField: 'itemId'`); new `_trackDirtyNestedArray()` function; comment above the config updated to document all three shapes now supported.
- `db-service.js`: `inventory` config gained `deltaTracked`/`deltaFilterSource`.
- `tests/unit/helpers/load-globals.js`: `loadAppStoreWindow()` extended to also accept/seed an `inventory` object.
- 1 new test file, `tests/unit/inventory-delta-sync.test.js` (4 tests): dirty-pair-only push, an explicit empty dirty array skips the push, a failed push leaves ids dirty for retry, and the teacher-vs-student no-clobber test above.

**Architecture Before/After:** 8 of 13 non-`profiles` tables now remain full-slice-push; `point_log`, `notifications`, `orders`, `boss_participants`, `inventory` are delta-tracked. Three dirty-tracking shapes now proven: `array`, `nested`, `nestedArray`.

**Why This Is Better:** Extends the mechanism to a table where the risk is genuinely everyday, not an edge case — a teacher helping a student at the register while that student's own phone is also in their hand is an ordinary classroom moment, not a rare race condition.

**Remaining Technical Debt:** 8 of 13 non-`profiles` tables still full-slice-push (`shop_products`, `achievements`, `titles`, `quizzes`, `campaign_worlds`, `redemptions`, `quiz_history`, `boss_events`). `profiles` remains structurally in the engine but not delta-tracked (needs the partial-success-reporting contract described in that entry). `boss_events` still has the untested `upsertRows`-vs-`deltaTracked` interaction flagged in the `boss_participants` entry. Same CI-gate gap as every prior entry, now spanning five delta-tracked tables and three shape variants.

**CI Gate Added:** None yet — same open item.

**Verification:** `node --check db-service.js` and `node --check modules/core/state-manager.js`. `node --test tests/unit/**/*.test.js`: 144/144 passing (140 pre-existing + 4 new). `eslint .`: 0 errors, 465 warnings — unchanged from prior entries' recorded baseline.

### Phase 5 — Data Layer Redesign (CI gate: delta-sync config consistency)
**Date:** 2026-08-04

**Problem:** Every single Phase 5B log entry so far (point_log through inventory) ended its "CI Gate Added" section with "None yet" — nothing stopped `modules/core/state-manager.js`'s `_DELTA_TRACKED_SLICES` and `db-service.js`'s `_TABLE_SYNC_CONFIGS` `deltaTracked` entries from silently drifting apart. A table added to one side and not the other wouldn't throw or warn — it would just quietly degrade: dirty tracking with no engine consuming it, or an engine expecting dirty info that never arrives and falls back to a full-slice push, with nothing in the console or the test suite ever mentioning it.

**Root Cause:** Both files were correct in isolation, verified by their own dedicated test files — but nothing verified them AGAINST each other. Two hand-maintained lists describing the same set of tables, updated by hand in two different files, with no single source of truth.

**Best-Practice Solution:** Rather than build separate tooling (a standalone lint rule or script), used the same test-only-seam pattern this phase already established (`DBService._test.tableSyncConfigs`, added in Phase 5A) — added the AppStore-side equivalent, `AppStore._test.deltaTrackedSlices`, then a new test file that loads both real modules and cross-checks them directly:
1. Every table name in AppStore's `_DELTA_TRACKED_SLICES` must have a matching `_TABLE_SYNC_CONFIGS` entry with `deltaTracked: true` for that exact table name, and vice versa — catches a table added to (or removed from) either side alone.
2. Every `deltaTracked` config's required field matches its AppStore-side `shape`: `'array'`-shaped slices need `idField` on the db-service config (the generic engine's array filter reads it); `'nested'`/`'nestedArray'`-shaped slices need `deltaFilterSource` instead (an `idField` alone can't express dirtiness for either non-flat shape, as `boss_participants`' and `inventory`'s own entries explain).

Because this landed as a `tests/unit/*.test.js` file, it's already wired into `npm run test:unit` (and therefore `npm test`) with zero additional pipeline changes — the "CI gate" IS the test suite here, same as every other regression this phase has been caught by.

**Verified it actually catches drift, not just passes today:** temporarily injected a fake `_DELTA_TRACKED_SLICES` entry with no matching `_TABLE_SYNC_CONFIGS` counterpart, confirmed the first assertion fails with a clear message naming the mismatch, then reverted the injection before finalizing this session's work.

**Files Changed:**
- `modules/core/state-manager.js`: added `AppStore._test.deltaTrackedSlices` (mirrors db-service.js's own `_test` seam pattern) — not used by any runtime call site.
- 1 new test file, `tests/unit/delta-sync-config-consistency.test.js` (2 tests): the name-set consistency check, and the shape-specific required-field check.

**Architecture Before:** Two independently-maintained lists of the same information, kept in sync only by whoever happened to remember to update both files in the same session.

**Architecture After:** A single automated check runs on every `npm test`, failing loudly and specifically (naming the exact table and exact missing field) the moment the two drift.

**Why This Is Better:** This is the first Phase 5 entry that closes a debt item instead of adding to the list of open ones — every prior entry in this phase named this exact gap and moved on. Table conversions from here forward get this check for free; nothing extra to remember.

**Remaining Technical Debt:** Unchanged from the `inventory` entry on the delta-sync-coverage front — 8 of 13 non-`profiles` tables still full-slice-push, `profiles` structurally converted but not delta-tracked, `boss_events`' `upsertRows`-vs-`deltaTracked` interaction still untested. This CI gate doesn't reduce that list — it just guarantees that whichever table is converted next can't silently misconfigure itself the way nothing was stopping before.

**CI Gate Added:** Yes — `tests/unit/delta-sync-config-consistency.test.js`, running as part of `npm run test:unit` / `npm test`.

**Verification:** `node --check modules/core/state-manager.js`. `node --test tests/unit/**/*.test.js`: 146/146 passing (144 pre-existing + 2 new). `eslint .`: 0 errors, 465 warnings — unchanged from prior entries' recorded baseline. Manually confirmed the new gate fails on an injected mismatch before reverting that injection.

### Phase 5 — Data Layer Redesign (sub-phase B: delta/patch sync, table: redemptions)
**Date:** 2026-08-04

**Problem:** Same structural risk as every prior entry — `redemptions` still full-slice-pushed on every cycle.

**Root Cause:** Same as every prior entry.

**Investigation / session-context check before starting:** Confirmed `redemptions` is append-only (client-generated `orderId`, upserted once, no call site anywhere edits a redemption after creation) — same shape as `point_log`, the first table converted. Not every remaining table needs a novel scenario to justify converting it; this one didn't, and forcing one would've been artificial. Converted it plainly, same as `point_log`.

**Best-Practice Solution:** Two-line config addition, identical pattern to `point_log`/`orders`: `_DELTA_TRACKED_SLICES` gained `redemptions: { statePath: 'redemptions', idField: 'orderId' }`; `redemptions` config gained `deltaTracked: true` / `idField: 'orderId'`. No new mechanism.

**No-clobber test:** Same shape as `point_log`'s — two sessions each add a different redemption entry, both survive independent push cycles, neither payload contains the other's row.

**Files Changed:**
- `modules/core/state-manager.js`: `_DELTA_TRACKED_SLICES` gained a `redemptions` entry.
- `db-service.js`: `redemptions` config gained `deltaTracked`/`idField`.
- `tests/unit/helpers/load-globals.js`: `loadAppStoreWindow()` extended to also accept/seed a `redemptions` array.
- 1 new test file, `tests/unit/redemptions-delta-sync.test.js` (4 tests, same four shapes as `point_log`'s suite).

**Architecture Before/After:** 7 of 13 non-`profiles` tables now remain full-slice-push; `point_log`, `notifications`, `orders`, `boss_participants`, `inventory`, `redemptions` are delta-tracked.

**Why This Is Better:** Same payoff as every prior conversion — extends the "config entry, not new code" outcome one table further, with the CI gate (added last session) now automatically covering it too.

**Remaining Technical Debt:** 7 of 13 non-`profiles` tables still full-slice-push (`shop_products`, `achievements`, `titles`, `quizzes`, `campaign_worlds`, `quiz_history`, `boss_events`). `profiles` structurally converted but not delta-tracked. `boss_events`' `upsertRows`-vs-`deltaTracked` interaction still untested.

**CI Gate Added:** None new this entry — already covered automatically by the gate added last session.

**Verification:** `node --check db-service.js` and `node --check modules/core/state-manager.js`. `node --test tests/unit/**/*.test.js`: 150/150 passing (146 pre-existing + 4 new). `eslint .`: 0 errors, 465 warnings — unchanged baseline.

### Phase 5 — Data Layer Redesign (sub-phase B: delta/patch sync, table: titles)
**Date:** 2026-08-04

**Problem:** Same structural risk as every prior entry, on a teacher-authored catalog table (title editor). Per direction this session, `shop_products` and `achievements` were explicitly skipped for now — they're catalog tables without an obvious concurrent-write scenario worth the conversion effort right now; `titles` was picked instead.

**Root Cause:** Same as every prior entry.

**Investigation / session-context check before starting:** `titles` rows are edited via a title editor and saved whole-row at a time (same "full-row-replacement is fine, just needs to be scoped to what changed" shape as `redemptions`/`boss_events`) — `requiresStaffGate` already applied. The realistic risk here isn't necessarily two different teachers editing the same title simultaneously — it's the same teacher's own second open tab (a gallery/dashboard view, common in this app) autosaving stale catalog data over an edit just made in the title editor tab. Framed the no-clobber test around that, honestly, rather than inventing a two-different-humans scenario that doesn't reflect how this table actually gets used.

**Best-Practice Solution:** Two-line config addition: `_DELTA_TRACKED_SLICES` gained `titles: { statePath: 'titles', idField: 'id' }`; `titles` config gained `deltaTracked: true` / `idField: 'id'`. No new mechanism.

**No-clobber test:** Tab A (title editor) renames `ti1`. Tab B — the same teacher's second tab, never pulled A's edit — independently creates a new `ti2` and pushes. Asserts B's payload contains only `ti2`, and `ti1`'s rename from A survives across both pushes.

**Files Changed:**
- `modules/core/state-manager.js`: `_DELTA_TRACKED_SLICES` gained a `titles` entry.
- `db-service.js`: `titles` config gained `deltaTracked`/`idField`.
- `tests/unit/helpers/load-globals.js`: `loadAppStoreWindow()` extended to also accept/seed a `titles` array.
- 1 new test file, `tests/unit/titles-delta-sync.test.js` (4 tests).

**Architecture Before/After:** 6 of 13 non-`profiles` tables now remain full-slice-push (`shop_products`, `achievements` deliberately skipped this session, plus `quizzes`, `campaign_worlds`, `quiz_history`, `boss_events`); `point_log`, `notifications`, `orders`, `boss_participants`, `inventory`, `redemptions`, `titles` are delta-tracked.

**Why This Is Better:** Same payoff as every prior conversion; the CI gate added two sessions ago automatically covers this addition too — verified by running the full suite (`delta-sync-config-consistency.test.js` passing confirms `titles` is correctly registered on both sides).

**Remaining Technical Debt:** `shop_products`/`achievements` explicitly deferred this session (not attempted, not broken — just skipped by direction). `quizzes`, `campaign_worlds`, `quiz_history`, `boss_events` still full-slice-push. `profiles` structurally converted but not delta-tracked. `boss_events`' `upsertRows`-vs-`deltaTracked` interaction still untested.

**CI Gate Added:** None new — already covered automatically by the existing gate.

**Verification:** `node --check db-service.js` and `node --check modules/core/state-manager.js`. `node --test tests/unit/**/*.test.js`: 154/154 passing (150 pre-existing + 4 new), including the delta-sync-config-consistency gate confirming `titles` is correctly registered on both sides. `eslint .`: 0 errors, 465 warnings — unchanged baseline.

### Phase 5 — Data Layer Redesign (BUGFIX: dirty-tracking did not survive a reload)
**Date:** 2026-08-05

**Problem:** Found during a self-requested adversarial review of every Phase 5B session so far, not reported by any test failure — every prior test in this phase simulated a COMPLETE session's lifecycle (edit → push → done). None simulated an INTERRUPTED one. `_dirty` (AppStore's delta-sync dirty-id tracking) lived only in a module-level JS variable, never persisted anywhere, while `_state` itself IS persisted to localStorage on every commit (`_flushNow()` → `DBService.write()`), independent of and faster than the debounced Supabase push (`_queueUpload()`, 400ms). On a normal tab close, crash, or offline session — any time that 400ms debounce doesn't get to run before the page goes away, and there is no `beforeunload`/`pagehide` handler that forces it through (only `flushPendingUpload()` exists, called solely on explicit logout) — the edit survives correctly in the local mirror, but the fact that it was still unsynced does not. A fresh reload's `_dirty` starts empty, so a delta-tracked table's un-pushed row is never reconsidered for push again unless that exact row happens to be edited a second time. For the append-only tables (`point_log`, `redemptions`) that second edit never happens: the row is stuck in that one browser's local mirror forever — correct locally, invisible to Supabase, invisible to every other device, gone with no error to anyone if that browser's storage is ever cleared.

**Root Cause:** Before Phase 5B, every push sent the whole local cache regardless of what triggered it, so any previously-unsynced row was automatically swept up by the very next save on ANY table, for ANY reason — an implicit, free self-healing property nobody had to design for. Delta sync's entire premise — "only push what actually changed this session" — removed that safety net without anything replacing the part of it that mattered: knowing what was still unsynced *from a previous, interrupted session*.

**Investigation:** Confirmed no writer bypasses `AppStore.updateState()` for any of the 7 delta-tracked tables (grepped every module touching them — all use `draft.<table>`, none write `window.DB.<table>` directly, which would have evaded dirty tracking entirely). Confirmed deletions (e.g. `titles`' local delete) were never routed through the bulk-push mechanism in the first place, before or after Phase 5B — handled by dedicated RPCs (`delete_title`, `start_boss_event`) — so that gap is pre-existing and unaffected by delta sync, not a new risk. Then reproduced the actual bug concretely (not just reasoned about it): a fresh AppStore instance seeded with a persisted `point_log` entry and empty dirty state came back with `getDirtyIds('point_log') === []` even though that entry had genuinely never been pushed.

**Best-Practice Solution:** Persist a serialized snapshot of `_dirty` alongside `_state`, and restore it on boot:
1. `db-service.js`: new `_DIRTY_TRACKING_KEY` localStorage key + `writeDirty(snapshot)`/`readDirty()` methods, mirroring the existing `write`/`read` pattern. Deliberately NOT stamped/gated by `_LAST_SYNCED_UID_KEY` the way `_STORAGE_KEY` is — this key only ever holds row-id strings, never actual row data, so a stale/cross-account id restored on a shared device can only ever cause a harmless extra idempotent re-push, never leak or corrupt real data. Erring toward "occasionally re-send something already synced" over "silently lose something that was never synced" is the correct failure mode.
2. `modules/core/state-manager.js`: `_persistDirtySnapshot()` (serializes `_dirty`'s Sets to `{table: string[]}`, calls `DBService.writeDirty`) runs from BOTH `_flushNow()` (new dirty ids added) AND `clearDirty()` (ids removed by a confirmed push) — not only on the debounced state flush, since `clearDirty()` runs outside `updateState()` entirely (called by db-service.js's engine after a push succeeds) and would otherwise leave a stale already-synced id sitting in storage until some unrelated later edit happened to trigger a flush. `_restoreDirtyFromStorage()` runs once in `init()`, right after `_state` is finalized, and prunes every restored id against what's actually present in the just-loaded state (`_dirtyIdStillExists()`, handling all three shapes — array/nested/nestedArray) — so a stale/unreconcilable id is dropped, not kept. Both new DBService methods are called through the same `typeof X === 'function'` guard this file already uses for every optional-newer-DBService-method check, so an older db-service.js degrades silently rather than crashing.

**Verified the fix, and verified the test actually catches its absence:** wrote a genuine two-window reload simulation (session 1 dirties a row, force-flushes, "closes"; session 2 loads with exactly what would have been persisted) — then temporarily removed the `_restoreDirtyFromStorage()` call and confirmed 3 of 4 new tests fail without it, before restoring the fix and confirming all pass.

**Also fixed while in there:** two comments left stale by incremental single-table edits across this phase — one said "only `point_log`" for a mechanism now used by 7 tables, another said "only `boss_participants`" for `deltaFilterSource`, now also used by `inventory`. No logic change; caught in the same review pass.

**Files Changed:**
- `db-service.js`: `_DIRTY_TRACKING_KEY` constant + `writeDirty`/`readDirty` methods; two stale comments corrected.
- `modules/core/state-manager.js`: `_persistDirtySnapshot()`, `_dirtyIdStillExists()`, `_restoreDirtyFromStorage()`; wired into `_flushNow()`, `clearDirty()`, and `init()`.
- `tests/unit/helpers/load-globals.js`: `loadAppStoreWindow()` extended with a fake `writeDirty`/`readDirty` (capturing every write, accepting a seeded `dirtySnapshot`) so a real two-window reload can be simulated in tests.
- 1 new test file, `tests/unit/dirty-tracking-persistence.test.js` (4 tests): the core reload-survival regression test, `clearDirty()`'s immediate persist, pruning a stale/nonexistent restored id, and the same reload-survival property for a nested-shape table (`boss_participants`).

**Why This Matters More Than Any Single Table Conversion:** every one of this phase's 7 table conversions inherited this gap silently — the bug wasn't in any specific table's config, it was in the shared mechanism underneath all of them. Fixing it here fixes it for all 7 at once, and for every table converted from here forward, without any of their individual configs needing to change.

**Remaining Technical Debt:** Unchanged on the table-coverage front. One adjacent, deliberately-not-addressed risk surface: this fix does not address two tabs of the SAME account racing on the SAME localStorage key (last-write-wins) — that's a pre-existing, general property of this app's localStorage-based persistence (`_STORAGE_KEY` already has the identical exposure for `_state` itself), not something newly introduced or worsened by this fix, and out of scope for a bugfix pass specifically about delta-sync dirty tracking.

**CI Gate Added:** None new — the existing `delta-sync-config-consistency.test.js` gate is unaffected by (and unrelated to) this fix.

**Verification:** `node --check db-service.js` and `node --check modules/core/state-manager.js`. `node --test tests/unit/**/*.test.js`: 158/158 passing (154 pre-existing + 4 new). Manually confirmed 3 of the 4 new tests fail when the fix's restore call is removed, then confirmed all pass with it restored. `eslint .`: 0 errors, 465 warnings — two transient new warnings (unused `e` in two new catch blocks) caught and resolved by logging instead of silently swallowing, back at the unchanged baseline.

### Phase 5 — Data Layer Redesign (sub-phase B: delta/patch sync, table: quiz_history — and boss_events ruled out)
**Date:** 2026-08-05

**Problem:** Same structural risk as every prior entry. Investigated the four remaining full-slice tables (`quizzes`, `campaign_worlds`, `quiz_history`, `boss_events`) to decide which was next.

**Investigation:** Checked each remaining table's identity scheme before attempting anything, since `titles`' `t.id`/`quizzes`' `q.id`/`campaign_worlds`' `w.id` conversions had all relied on an assumption never explicitly verified until now: that the id exists client-side from the moment a row is created. Traced each:
- `quizzes` — `id: uid()` assigned in `quiz-builder.js`'s `openQuizBuilder()` at draft-creation time, before the row ever reaches `AppStore.updateState()`. Safe.
- `campaign_worlds` — `id: 'w_' + uid()` assigned in `campaign_admin_map_editor.js` the same way. Safe.
- `quiz_history` — `id: 'qh_' + uid()` assigned inline at both `finishQuiz()` and `abortQuiz()` call sites in `index.html`. Safe, and append-only (neither ever edits an existing entry after logging it).
- `boss_events` — traced `adminSaveNewBoss()` in `admin-page.js` and found NO id assignment at all for a new boss draft; the local row is identified only by array index (`d._index`) until the server assigns a real UUID (`gen_random_uuid()`) on first successful sync. **This means a brand-new boss draft has nothing to track dirty by under the current id-based scheme — delta-tracking it as-is would mean new bosses silently never get pushed.** This is a more fundamental blocker than the partial-failure `clearDirty()` issue flagged in `boss_participants`' entry (which also still applies here, since `boss_events`' `upsertRows` warns-and-continues per row, same as `profiles`). Converting `boss_events` properly would require giving it a client-generated stable identity first — a separate, nontrivial piece of work, not attempted this session. Ruled out, not deferred by default — the reasoning is now written down so it doesn't need re-discovering.

**Best-Practice Solution (quiz_history):** Same shape/reasoning as `inventory` — `quizHistory[studentId] = [attempts...]`, `nestedArray` shape, no uuid-resolution step needed. Two-piece config addition, no new mechanism: `_DELTA_TRACKED_SLICES` gained `quiz_history`; `quiz_history` config gained `deltaTracked: true` + a `deltaFilterSource` mirroring `inventory`'s.

**No-clobber test:** Two students' quiz completions modeled as one session dirtying only its own student's history — asserts a push triggered by one student's completion never touches another student's (untouched) history array.

**Files Changed:**
- `modules/core/state-manager.js`: `_DELTA_TRACKED_SLICES` gained a `quiz_history` entry (with a comment explaining the `boss_events` contrast).
- `db-service.js`: `quiz_history` config gained `deltaTracked`/`deltaFilterSource`.
- `tests/unit/helpers/load-globals.js`: `loadAppStoreWindow()` extended to also accept/seed a `quizHistory` object.
- 1 new test file, `tests/unit/quiz-history-delta-sync.test.js` (4 tests).

**Architecture Before/After:** 3 of 13 non-`profiles` tables now remain full-slice-push (`shop_products`/`achievements` still deliberately skipped by request; `quizzes`/`campaign_worlds` confirmed-safe but not yet converted — ran out of session budget after the `boss_events` investigation; `boss_events` ruled out pending an identity-scheme change). 8 tables delta-tracked: `point_log`, `notifications`, `orders`, `boss_participants`, `inventory`, `redemptions`, `titles`, `quiz_history`.

**Why This Matters:** Confirming the identity-scheme assumption BEFORE attempting `boss_events` avoided shipping a conversion that would have silently broken new-boss creation — exactly the kind of gap the earlier dirty-tracking-persistence bugfix session was about catching before it reaches users, not after.

**Remaining Technical Debt:** `quizzes`/`campaign_worlds` are confirmed-safe, straightforward conversions (same shape/pattern as `titles`) — next-session work, not blocked on anything. `boss_events` needs a client-generated stable id before it can be delta-tracked at all, in addition to the still-open partial-failure `clearDirty()` contract shared with `profiles`. `shop_products`/`achievements` still explicitly out of scope by request.

**CI Gate Added:** None new — already covered automatically by the existing gate.

**Verification:** `node --check db-service.js` and `node --check modules/core/state-manager.js`. `node --test tests/unit/**/*.test.js`: 162/162 passing (158 pre-existing + 4 new). `eslint .`: 0 errors, 465 warnings — unchanged baseline.

### Phase 5 — Data Layer Redesign (sub-phase B: delta/patch sync, tables: quizzes, campaign_worlds)
**Date:** 2026-08-05

**Problem:** Same structural risk as every prior entry, on the two tables confirmed safe (client-generated ids) at the end of the last session.

**quizzes — plain conversion:** Same shape/pattern as `titles`. `_DELTA_TRACKED_SLICES` gained `quizzes: { statePath: 'quizzes', idField: 'id' }`; config gained `deltaTracked`/`idField`. No new mechanism. No-clobber test: same-teacher-second-tab shape, same as `titles`'.

**campaign_worlds — NOT a plain conversion. Found and fixed a real bug before it could ship:** `buildRows` computed `sort_order` from `.map((w, idx) => ...)`'s own `idx` — i.e. the row's position within whatever array `buildRows` was handed. That's correct for a full-slice push (the array IS `cache.stageMap`), but would have been silently WRONG the moment this table went delta-tracked: the engine filters `src` down to only the dirty world(s) *before* `buildRows` ever runs, so a single dirty world sitting at position 5 in the real map would get pushed with `sort_order: 0` — quietly reordering the campaign map server-side, with nothing anywhere raising an error. Caught this by asking, for every table, "does anything this config computes depend on the row's position in the array being processed, not just the row's own fields?" — a question the prior 9 conversions never needed because none of their `buildRows` functions referenced the implicit `.map()` index. Fixed by computing each world's true position from `cache.stageMap` (the full, unfiltered array — `buildRows` already receives `cache` as its second argument, same as `boss_participants`' uuid-resolution use of it) rather than the `src` argument's own index. Replicated the ORIGINAL two-step filter-then-index logic exactly (not raw array position) so a full-slice push computes byte-identical `sort_order` values to the pre-fix code — verified by the existing behavior being otherwise untouched (no test previously covered this table at all, so this fix additionally gives untested-until-now logic its first coverage).

**Verified the regression test actually catches the bug:** temporarily reverted `buildRows` to the original index-based version, confirmed the new `sort_order` test fails (`ok 2` → `not ok 2`) with exactly the predicted wrong value, then restored the fix.

**No-clobber tests:** `quizzes` — same-teacher-second-tab shape (title edit survives an unrelated new-quiz push from another tab). `campaign_worlds` — same shape, plus the dedicated `sort_order` regression test above (three worlds, only the last is dirty, asserts its pushed `sort_order` is still 2, not 0).

**Files Changed:**
- `modules/core/state-manager.js`: `_DELTA_TRACKED_SLICES` gained `quizzes` and `campaign_worlds` entries.
- `db-service.js`: `quizzes` config gained `deltaTracked`/`idField`. `campaign_worlds` config's `buildRows` rewritten to compute `sort_order` from `cache.stageMap` instead of the `src` argument's index, plus `deltaTracked`/`idField`.
- `tests/unit/helpers/load-globals.js`: `loadAppStoreWindow()` extended to also accept/seed `quizzes` and `stageMap`.
- 2 new test files: `tests/unit/quizzes-delta-sync.test.js` (4 tests) and `tests/unit/campaign-worlds-delta-sync.test.js` (5 tests, including the sort_order regression).

**Architecture Before/After:** 10 tables now delta-tracked: `point_log`, `notifications`, `orders`, `boss_participants`, `inventory`, `redemptions`, `titles`, `quiz_history`, `quizzes`, `campaign_worlds`. 1 of 13 non-`profiles` tables remains full-slice-push and unconverted (`boss_events`, blocked on its identity-scheme gap); `shop_products`/`achievements` still explicitly skipped by request.

**Why This Matters:** The `campaign_worlds` find is the second time this phase (after the `boss_events` identity-scheme investigation) that actually checking a table's specific logic — instead of pattern-matching "flat array, client-generated id, looks like titles" — caught something that would have shipped a real, silent bug. Worth calling out explicitly: superficial shape-matching between tables is not sufficient verification on its own.

**Remaining Technical Debt:** `boss_events` still needs a client-generated stable id before it can be delta-tracked at all. `profiles` still needs the partial-failure `clearDirty()` contract. `shop_products`/`achievements` still explicitly out of scope by request. With `quizzes`/`campaign_worlds` now converted, every remaining full-slice table has a concretely-identified reason for not being converted yet — nothing is simply "not gotten to."

**CI Gate Added:** None new — already covered automatically by the existing gate.

**Verification:** `node --check db-service.js` and `node --check modules/core/state-manager.js`. `node --test tests/unit/**/*.test.js`: 171/171 passing (162 pre-existing + 9 new). Manually confirmed the `campaign_worlds` sort_order regression test fails without the fix, then confirmed it passes with the fix restored. `eslint .`: 0 errors, 465 warnings — unchanged baseline.

### Phase 5 — Data Layer Redesign (sub-phase B: delta/patch sync, table: profiles — the last documented blocker resolved)
**Date:** 2026-08-05

**Problem:** `profiles` was the table this whole phase kept naming and deferring — folded into the generic engine several sessions ago, but never delta-tracked, because its chunked-per-class-id upsert warns-and-continues past a failed chunk on purpose, and the existing engine's clearDirty logic assumed "didn't throw" meant "everything landed." That assumption is only true for a single-batch upsert.

**Root Cause:** Same as every prior entry, compounded by profiles' two extra properties no other converted table has: (1) its upsert is chunked with partial-failure tolerance by design, and (2) its underlying row (`DB.students`) carries a large number of fields that change constantly via gameplay (xp, coins, level, tier, attendance, quiz average) that are never part of this table's own payload at all — they're RPC-owned.

**Best-Practice Solution — two genuinely new, reusable pieces, not workarounds specific to this one table:**

1. **The upsertRows-return-value contract (`db-service.js`):** `upsertRows` may now return an array of ids that were confirmed written. `_runTableSync()` clears only those. Returning nothing (the original, still-current contract for `boss_events`) means nothing gets cleared via this path — always safe, never wrong, just not yet wired to confirm success. `profiles`' `upsertRows` now collects `succeededIds` per class_id chunk and returns them at the end — a chunk that errors contributes nothing to that list, so its students stay dirty for retry.

2. **`watchFields` (`modules/core/state-manager.js`):** an opt-in narrowing for the existing `'array'` shape diff — when a `_DELTA_TRACKED_SLICES` entry sets `watchFields`, only those named properties are compared, not the whole row. `profiles` watches exactly the eight columns its upsert actually sends (`name`, `init`, `color`, `firstName`, `lastName`, `profilePic`, `classId`); everything else on a student row (all the RPC-owned gameplay stats) is invisible to this table's dirty-diff. Every other delta-tracked table is unaffected — `watchFields` defaults to absent, meaning "diff the whole row," exactly as before.

**Verified both pieces, not just asserted them:**
- **watchFields:** a test that changes only `xp`/`coins`/`level`/`attendancePct`/`quizAvg` on a student asserts `profiles` stays clean (`getDirtyIds('profiles') === []`); a second test changing only `name` asserts it DOES dirty. Confirms the scoping cuts exactly where intended, not too wide or too narrow.
- **Partial-failure contract:** two students in two different classes, one class_id's chunk rejected, the other succeeds. Asserts `clearDirty` was called with ONLY the succeeded student's id — then, to prove the test itself has teeth, temporarily replaced the real contract with the naive "didn't throw → clear everything dirty" rule this fix replaces, confirmed that test fails exactly as predicted, then restored the real fix.

**Files Changed:**
- `db-service.js`: `_runTableSync()`'s `upsertRows` branch now consumes an optional return value; `profiles`' `upsertRows` collects and returns `succeededIds`; `profiles` config gained `deltaTracked: true` / `idField: 'id'`; config-shape header comment documents the new contract.
- `modules/core/state-manager.js`: `_projectWatchFields()` + the array-shape diff branch's use of it; `_DELTA_TRACKED_SLICES` gained a `profiles` entry with `watchFields`.
- `tests/unit/helpers/load-globals.js`: `loadAppStoreWindow()` was never actually wired to accept a seeded `students` array despite `DEFAULT_DB` already listing it — fixed (a latent gap in the harness, caught by this session's own new tests failing against it, not found separately).
- `tests/unit/profiles-repository-sync.test.js`: header comment corrected (no longer says "not delta-tracked"); no behavioral changes — these 5 tests all use the fallback-to-full-push path and continue to pass unchanged, confirming the fold-in and this session's changes didn't alter that path at all.
- 1 new test file, `tests/unit/profiles-delta-sync.test.js` (5 tests): the two `watchFields` tests, dirty-subset-scoped-to-class-chunk push, the partial-failure contract test, and a non-staff session pushing/clearing nothing.

**Architecture Before/After:** 11 tables now delta-tracked: `point_log`, `notifications`, `orders`, `boss_participants`, `inventory`, `redemptions`, `titles`, `quiz_history`, `quizzes`, `campaign_worlds`, `profiles`. Only `boss_events` remains among the originally-full-slice tables, blocked on its own separate identity-scheme gap (no client-generated id) — the upsertRows-return-value contract built this session is available for it too, once that separate blocker is resolved.

**Why This Matters:** This closes the last item every single prior Phase 5B log entry named as still open. `watchFields` and the upsertRows-return-value contract are both small, generic additions to the shared mechanism — not special-cased to `profiles` — so they're available to any future table that needs either property (a row with fields outside its own sync payload, or a chunked/partial-failure-tolerant write path).

**Remaining Technical Debt:** `boss_events` — client-generated id still needed before delta-tracking is possible at all; the return-value contract is ready for it once that's solved. `shop_products`/`achievements` — still explicitly out of scope by request. No CI gate changes needed — the existing consistency gate already covers `profiles` automatically (confirmed: 11/11 tables match on both sides, verified directly rather than just trusted).

**CI Gate Added:** None new — already covered automatically by the existing gate.

**Verification:** `node --check db-service.js` and `node --check modules/core/state-manager.js`. `node --test tests/unit/**/*.test.js`: 176/176 passing (171 pre-existing + 5 new). Manually confirmed the partial-failure contract test fails against a naive "clear everything" implementation, then confirmed it passes with the real fix restored. `eslint .`: 0 errors, 465 warnings — unchanged baseline.

### Phase 5 — Data Layer Redesign (sub-phase B: delta/patch sync, tables: shop_products, achievements)
**Date:** 2026-08-06

**Problem:** Same structural risk as every prior entry, on the two tables deliberately skipped in earlier sessions by request. Converted now, per direction this session.

**Investigation before converting:** Traced both tables' id-assignment, same check applied to every table since the `boss_events`/`campaign_worlds` findings made clear that pattern-matching "looks like titles" isn't sufficient on its own.
- `achievements` — `.filter(a => a.id && a.ownerTeacherId)` already explicit about requiring `.id`; per-student unlock/claim state (`user_achievements`) is already documented as out of scope for this push path (RPC-only), so — like `titles`/`quizzes`/`shop_products` — no `watchFields` scoping is needed; every field in `buildRows`' output is a catalog-definition column.
- `shop_products` — id confirmed client-generated (`uid()`, assigned in `shop_admin_store.js`'s `doAddProduct()` on the same line as `ownerTeacherId`). Also noticed its filter was `.filter(p => p.ownerTeacherId)` — missing the explicit `.id` check every other catalog table's filter has. Harmless in practice (the two fields are always set together at creation), but tightened it to `.filter(p => p.id && p.ownerTeacherId)` for consistency while already in this code — a small, safe hardening, not a behavior change. Confirmed `stock` is deliberately absent from `buildRows`' output ("local/display value only — see RPC call below" in the original comment), so — same as `achievements` — no `watchFields` scoping needed.

**Best-Practice Solution:** Both plain two-line config additions, identical pattern to `titles`/`quizzes`. `_DELTA_TRACKED_SLICES` gained `shop_products: { statePath: 'store', idField: 'id' }` and `achievements: { statePath: 'achievements', idField: 'id' }`; both configs gained `deltaTracked: true` / `idField: 'id'`. No new mechanism needed for either.

**No-clobber tests:** Both use the same-teacher-second-tab shape established for `titles`/`quizzes`/`campaign_worlds` — an edit in one tab must survive an unrelated new-row push from another tab. `shop_products`' test additionally asserts `stock` never appears in a pushed row, reconfirming the RPC-only boundary this table's config comment already documented.

**Files Changed:**
- `modules/core/state-manager.js`: `_DELTA_TRACKED_SLICES` gained `shop_products` and `achievements` entries.
- `db-service.js`: both configs gained `deltaTracked`/`idField`; `shop_products`' filter tightened to explicitly check `.id`.
- `tests/unit/helpers/load-globals.js`: `loadAppStoreWindow()` extended to also accept/seed `store` and `achievements`.
- 2 new test files: `tests/unit/shop-products-delta-sync.test.js` and `tests/unit/achievements-delta-sync.test.js` (4 tests each).

**Architecture Before/After:** 13 of 14 `_TABLE_SYNC_CONFIGS` tables now delta-tracked — every table except `boss_events`, confirmed directly (not just asserted) by printing both files' tracked-table sets and diffing them programmatically. `boss_events` remains full-slice-push, blocked on its own separate identity-scheme gap (server-assigned id, no client-generated identity for a brand-new draft) documented in an earlier session — the `upsertRows`-return-value contract built for `profiles` is ready for it whenever that's resolved.

**Why This Is Better:** Closes out the two tables explicitly deferred earlier in this phase. With this session, delta-sync coverage is essentially complete — 13 of 14 tables, with the one holdout blocked on a concretely-scoped, separate piece of work rather than left unconverted by default.

**Remaining Technical Debt:** `boss_events` — needs a client-generated stable id before it can be delta-tracked at all. Same CI-gate note as every prior entry: already covers both new tables automatically, confirmed directly this session (13/13 match, zero drift).

**CI Gate Added:** None new — already covered automatically by the existing gate.

**Verification:** `node --check db-service.js` and `node --check modules/core/state-manager.js`. `node --test tests/unit/**/*.test.js`: 184/184 passing (176 pre-existing + 8 new). `eslint .`: 0 errors, 465 warnings — unchanged baseline. Directly queried both files' delta-tracked table sets via a standalone script (not just trusted the test suite) and confirmed 13/13 exact match, one remaining untracked table (`boss_events`), as expected.

### Phase 6 — Decompose God Files (files: db-service.js → supabase-client.js; utils.js → utils.js + student-stats.js + modules/quest-engine.js)
**Date:** 2026-08-07

**Problem:** `db-service.js` (2,725 lines) and `utils.js` (1,213 lines) were both flagged as god files mixing multiple responsibilities in one file — see roadmap. First session of this phase, per its own "one god file per session" cadence.

**Root Cause:** Same as every god file on the list — accretion with no size/responsibility budget enforced.

**Investigation before touching anything:** Confirmed Phases 3–5 were complete (module-by-module `DB.*` migration done, delta-sync coverage 13/14 tables) — the roadmap's own precondition for this phase being low-risk. Traced `db-service.js`'s internals to find a genuinely self-contained seam: `_getClient()`/`_resolveProvider()` and the Supabase config consts touch nothing else in the closure (no `_cache`, no derive functions) — safe to extract without touching the ~14 internal call sites or the public API methods built on them (`rpc`, `uploadPublicFile`, `getAuthClient`, `sendPasswordResetEmail`), which all go through `_getClient()` already. The much larger, more tightly-coupled repository/realtime sections (`_TABLE_SYNC_CONFIGS`, `_pushCacheToSupabase`, `_setupRealtimeSignals`) were deliberately NOT attempted this session — see Remaining Technical Debt. For `utils.js`, mapped all ~50 top-level declarations by domain (grep of every `function`/`const`/`window.X =` line) and confirmed every function already does explicit `window.X = X` after its declaration, meaning cross-file split risk is just load-order, not global-exposure — and since every consuming call happens after full page load, load order among split files doesn't matter as long as all three still load together where `utils.js` used to.

**Best-Practice Solution:**
1. **`db-service.js` → `supabase-client.js`:** extracted the Supabase client singleton + provider resolution verbatim into a new file exposing `window.SupabaseClient.getClient()`/`.resolveProvider()`. `db-service.js`'s own `_getClient()`/`_resolveProvider()` became one-line delegates — not a 14-site mechanical find-replace — so zero other lines in the file needed to change.
2. **`utils.js` → three files by domain:** extracted by exact `sed` line ranges (not hand-retyped) to guarantee byte-identical content, then diffed each new file's body against its extracted range to confirm zero transcription drift before wiring anything in.
   - `utils.js` (slimmed to 77 lines) keeps only the genuinely generic helpers: `uid`, `todayStr`/`nowStr`/`isoDate`, `csvDownload`, `_esc`, `_cssColor`.
   - `student-stats.js` (new, 457 lines): `TIER_THRESHOLDS`, `recalcStudentStats`, attendance records/streak, and every `sync*ToServer` RPC helper.
   - `modules/quest-engine.js` (new, 743 lines): the entire Quest Board/quiz domain — grading, staging, rarity/cadence/scheduling, combo/streak scoring, attempt cooldowns, mascot lines, quest chains.

**Files Changed:**
- New: `supabase-client.js`, `student-stats.js`, `modules/quest-engine.js`.
- `db-service.js`: removed `_SUPABASE_URL`/`_SUPABASE_ANON_KEY`/`_sb`/`_getClient()`/`_resolveProvider()` bodies, replaced with two-line delegates to `SupabaseClient`; one stale header comment corrected.
- `utils.js`: cut down to the generic-helpers subset only.
- `index.html`: added `<script src="./supabase-client.js">` before `db-service.js`; replaced the single `utils.js` script tag with `utils.js` → `student-stats.js` → `modules/quest-engine.js`, same relative order the code had inside the old single file.
- `tests/unit/helpers/load-globals.js`: `loadDbServiceWindow()` now loads `supabase-client.js` before `db-service.js`; `loadUtilsWindow()` now loads all three split files in order — both mirroring the index.html change, no test file itself needed edits since everything already went through these two shared loaders.

**Architecture Before/After:** `db-service.js` 2,725 → 2,716 lines (small first cut — connection/auth was the one cleanly-separable seam this session; the ~1,900-line repository+realtime core is still one file, see below). `utils.js` 1,213 → 77 + 457 + 743 across three files, each with one statable domain instead of one undifferentiated grab bag.

**Why This Is Better:** `supabase-client.js` and `student-stats.js`/`modules/quest-engine.js` are each independently readable/testable without holding the whole original file's unrelated concerns in your head. The `utils.js` split in particular directly addresses the roadmap's specific complaint ("an undifferentiated grab-bag").

**Remaining Technical Debt:** `db-service.js` still has its two largest, most load-bearing sections undecomposed: the `_TABLE_SYNC_CONFIGS`/`_runTableSync` repository layer (~1,100 lines, heavily unit-tested — the next session's target, since that test coverage makes it the safest large piece left to verify mechanically) and the realtime signal/scoped-refresh layer (~350 lines, NOT unit-tested — needs either a live Supabase harness or careful manual verification before attempting). `modules/quest-engine.js` at 743 lines is still above the ~400–500 target — a cohesive single domain now, but a candidate for a further split (scheduling vs. scoring vs. mascot lines) in a future session. `classroom_builder.js` (1,735), `live_monitor.js` (1,539), `campaign_engine.js` (1,286), `hall-of-fame.js` (1,263) not yet started.

**CI Gate Added:** None — this phase's risk is caught by the existing test suite + Phase 3's lint rule, not a new gate.

**Verification:** `node --check` on all 5 touched/new files. Diffed each new file's extracted body against the original `utils.js` byte-for-byte (via `sed` line-range extraction, not hand-copied) before wiring anything in. `node --test tests/unit/**/*.test.js`: 185/185 passing, unchanged from this session's own pre-work baseline. `eslint .`: 0 errors, 467 warnings (465 baseline + 2 expected — `SupabaseClient` and `isoDate` newly showing the same "cross-file global, unused within its own file" pattern every other exported global in this codebase already has; confirmed `isoDate`'s only call sites are in other files, not a real regression). Grep-counted declarations (60) and `window.X =` assignments (55) before vs. after the `utils.js` split to confirm nothing was dropped or duplicated.

### Phase 6 — Decompose God Files (file: db-service.js → repository/table-sync.js)
**Date:** 2026-08-07 (session 2)

**Problem:** `db-service.js` was still 2,716 lines after the prior session's small connection/auth extraction — the file's actual bulk, the declarative table-sync repository (`_TABLE_SYNC_CONFIGS` + the generic push engine), was untouched and flagged as next up in that session's own Remaining Technical Debt.

**Root Cause:** Same as every entry in this phase.

**Investigation before extracting:** Grepped the full `_TABLE_SYNC_CONFIGS`-through-`_pushCacheToSupabase` block (originally lines 1066–2011, ~950 lines) for every reference to db-service.js's OTHER internals — `_cache`, the `_derive*()` pull-side mapping functions, `_meta`, `_localStorageProvider`, `_getClient()` — and found none (one false-positive grep hit on the substring `_derived` turned out to be inside a comment, confirmed by reading it directly). The only things this code touches are its own parameters (`client`, `cache`) and two globals every other module already depends on directly (`currentUser`, `AppStore`). That's what made this a clean seam and not a repeat of the tighter coupling the pull side / realtime layer still have — see Remaining Technical Debt below for why those are still deliberately untouched.

**Best-Practice Solution:** Extracted the block verbatim (via `sed` line-range, not hand-retyped — same discipline as the `utils.js` split last session) into a new `repository/table-sync.js`, wrapped in its own IIFE exposing `TableSyncRepository.pushCacheToSupabase(client, cache)` and `TableSyncRepository.tableSyncConfigs`. `db-service.js`'s own `_pushCacheToSupabase` became a one-line delegate — so its one real call site (`_flushUpload()`) needed zero changes, and only the `_test` seam's `tableSyncConfigs: _TABLE_SYNC_CONFIGS` line needed updating to point at the new module's exposed copy.

**Files Changed:**
- New: `repository/table-sync.js` (990 lines).
- `db-service.js`: 2,716 → 1,781 lines. Removed lines 1066–2011 verbatim; added the 10-line delegate; updated the `_test.tableSyncConfigs` reference.
- `index.html`: added `<script src="./repository/table-sync.js">` between `supabase-client.js` and `db-service.js`.
- `tests/unit/helpers/load-globals.js`: `loadDbServiceWindow()` generalized to load an ordered file list (`supabase-client.js` → `repository/table-sync.js` → `db-service.js`) instead of two separate hand-written blocks, mirroring index.html's order.

**Architecture Before/After:** `db-service.js` 2,725 (session start of this phase) → 2,716 → **1,781** lines across the two sessions — a 35% reduction so far, now below every other remaining god file except `classroom_builder.js` (1,735, effectively tied). The declarative table-sync repository — the piece every Phase 5A/5B session's tests actually exercise — is now its own independently-readable file.

**Why This Is Better:** This was the file's single largest, best-tested, and (once traced) most cleanly-decoupled section — extracting it first, before the pull/realtime layers, follows the same "do the safely-verifiable piece first" discipline this whole refactor has used since Phase 5B. Every one of the ~15 delta-sync/no-clobber test files that exercise this code continues to pass unchanged, which is strong evidence the extraction is behavior-preserving, not just structurally tidy.

**Remaining Technical Debt:** `db-service.js` still holds the pull side (`_legacyRoleFromDbRole` + `_HISTORY_LIMITS` + ~35 `_derive*()` functions + `_pullCacheFromSupabase`, ~450 lines) and the realtime layer (`_REALTIME_TABLE_GROUPS`/`_REFRESH_GROUPS`/`_setupRealtimeSignals`/`_schedulePullRefresh`, ~350 lines) — both deliberately deferred again: the pull side is entangled with `_pullCacheFromSupabase`'s error/fallback handling and is not obviously separable from the cache-hydration logic in `initRemote()`/`refreshAfterAuthChange()` without a closer read than this session had budget for; the realtime layer has zero unit-test coverage (it needs a live Supabase session to exercise), so extracting it can't be verified the same mechanical way this session's piece was. `modules/quest-engine.js` (743 lines) still above the ~400–500 target. `classroom_builder.js` (1,735), `live_monitor.js` (1,539), `campaign_engine.js` (1,286), `hall-of-fame.js` (1,263) not yet started.

**CI Gate Added:** None — same reasoning as every prior Phase 6 entry.

**Verification:** `node --check` on both touched/new files. Diffed the extracted body against `/tmp/part_repository.txt` byte-for-byte before wiring anything in (zero drift). Grep-diffed every top-level `function`/`const _X` declaration name in `db-service.js` before vs. after (combined with the new file) — confirmed the only new symbol is the intended `_pushCacheToSupabase` delegate; nothing else lost or duplicated. `node --test tests/unit/**/*.test.js`: 185/185 passing, unchanged. `eslint .`: 0 errors, 468 warnings (467 prior baseline + 1 — `TableSyncRepository` joining the same expected "cross-file global, unused within its own file" pattern `DBService`/`SupabaseClient` already have; confirmed by isolating the new warning's file/line directly, not just trusting the total count).

### Phase 6 — Decompose God Files (file: classroom_builder.js → classroom-builder-render.js)
**Date:** 2026-08-07 (session 3)

**Problem:** `classroom_builder.js` (1,735 lines) was the largest untouched god file in the codebase — the seat-arrangement drag-and-drop builder, mixing module state, geometry math, DOM rendering, AppStore subscription handling, and ~28 `window._cb*` event/controller handlers in one flat (non-IIFE) file.

**Root Cause:** Same as every entry in this phase.

**Different risk profile than the prior two sessions — read in full before deciding anything:** Unlike `db-service.js`, this file has **zero automated test coverage** (confirmed by grep across `tests/` — no unit test or smoke spec references it), and the Playwright smoke suite that could exercise it live requires a real Supabase test project this sandbox doesn't have credentials for. That ruled out the "extract → run the suite → trust the pass count" verification loop used for db-service.js. Instead, every one of the file's ~28 functions was read individually to build an exact dependency map (which module-level `let` state each one reads vs. writes, which other functions it calls) before deciding on a split boundary, specifically to find a seam where the risk could be bounded by static reasoning even without a test suite behind it.

**What the read found:** The file's DOM-painting functions (`_cbRenderShell`, `_cbScaleCanvas`, `_cbRenderCanvas`, `_cbRepaintSeats`, `_cbRenderSidebar`, `_cbStudentChip`, `_cbRenderWizard`) all only **read** module state — none assigns to it directly (the one apparent exception, `_cbRenderSidebar`'s drag-chip listeners setting `_cbDragStudentId`, is safe because top-level `let` bindings are shared script-scope across `<script>` tags in the same page, not per-file, and top-level function declarations attach to `window` on load regardless of file order — the same reasoning already used for `SupabaseClient`/`TableSyncRepository`, verified applies here too). Everything else in the file — state, geometry helpers, `_cbLoadState`, the seat-overlap auto-fix, the AppStore subscription, and all 28 `window._cb*` controllers/drag-handlers — reads AND writes module state, so it stayed together rather than being force-split into an artificial "business logic" layer that doesn't actually exist as a separate concern in this file (writes go straight to `ClassroomService`, already a separate file).

**Best-Practice Solution:** A 2-way split along the one real, clean seam this file has — render vs. everything else — rather than forcing the doc's generic 3-way "render/data/events" template onto a file where the data-fetching piece is already externalized to `ClassroomService`. Extracted both render clusters (lines 576–987 and 1386–1457 of the original, non-contiguous because the blueprint-wizard renderer sits between two large blocks of event handlers) verbatim via `sed` line-range into a new `classroom-builder-render.js`.

**Files Changed:**
- New: `modules/seat-arrangement/classroom-builder-render.js` (526 lines).
- `modules/seat-arrangement/classroom_builder.js`: 1,735 → 1,265 lines. No delegates needed here (unlike the db-service.js sessions) — render functions are called by name from the retained file's event handlers/entry points exactly as before; nothing but the physical file they're defined in changed.
- `index.html`: added `<script src="./modules/seat-arrangement/classroom-builder-render.js">` immediately before `classroom_builder.js`.
- No test-harness changes needed (none existed to update).

**Architecture Before/After:** `classroom_builder.js` 1,735 → **1,265** lines (27% cut), now third-largest file behind `live_monitor.js` (1,539) and `campaign_engine.js` (1,286). The new 526-line render file is under the ~400–500 target only slightly over, and — more importantly for a UI file — has exactly one statable job: paint the DOM from current state.

**Why This Is Better:** The retained file is now genuinely "state + geometry + controllers," matching what a reader actually needs to trace an interaction bug (a click handler's full effect, without also holding ~500 lines of template-string rendering in their head). The render file can be read top-to-bottom as "what does the screen look like right now" with zero interaction logic mixed in.

**Remaining Technical Debt:** `classroom_builder.js` at 1,265 lines is still well above the ~400–500 target — it's now one cohesive "state + controllers" file rather than everything, which is real progress, but the ~28 `window._cb*` handlers are a plausible further split (build-mode seat/prop management vs. assign-mode drag-and-drop vs. blueprint wizard controllers) for a future session; deferred here rather than pushed through under the same read-everything-first discipline this session used, given time already spent. `live_monitor.js` (1,539), `campaign_engine.js` (1,286), `hall-of-fame.js` (1,263) not yet started — all three are also UI modules with (unconfirmed, not yet checked) likely-similar zero unit-test coverage, so each will need the same function-by-function read before any split, not a repeat of the db-service.js "grep for dependencies" shortcut. `db-service.js`'s pull side and realtime layer remain deferred from session 2. `modules/quest-engine.js` (743) still above target.

**CI Gate Added:** None.

**Verification:** `node --check` on both files (caught and fixed one real mistake mid-session — an off-by-one line boundary that dropped the final `}` of `_cbRenderWizard` on first extraction attempt; `node --check` failed immediately with a clear "Unexpected end of input," it was traced to the exact miscounted line, and the extraction was redone and re-verified before proceeding, not patched over). Diffed both extracted render clusters byte-for-byte against the original before wiring anything in. Grep-diffed the full set of top-level `function`/`window.X =`/`let`/`const` declarations before vs. after the split (83 in both) — confirmed identical, nothing lost or duplicated. `node --test tests/unit/**/*.test.js`: 185/185 passing, unchanged (expected — this file has no test coverage either way, so this confirms no *other* module broke, not that this one's behavior is preserved). `eslint .`: 0 errors, 486 warnings (468 prior baseline + 18) — isolated and individually accounted for every new warning: 10 pre-existing `innerHTML`/dead-variable warnings simply moved with their code (same lines, same content, different file), the other 18 are the same "cross-file global, unused within its own file" pattern already established, now larger in count only because the split intentionally moved several call sites (render functions calling drag-handlers, drag-handlers calling render functions) across the new file boundary.

### Phase 6 — Decompose God Files (file: campaign_engine.js → campaign-dragdrop-beat.js, campaign-skills.js)
**Date:** 2026-08-08 (session 4)

**Problem:** `campaign_engine.js` (1,286 lines) — the Campaign Stage Engine (story/encounter/reveal/dialogue/drag-drop beat playback, skill system, victory/defeat) — was the next-largest untouched god file.

**Root Cause:** Same as every entry in this phase.

**Investigation before extracting:** First checked whether this file shares `live_monitor.js`'s architecture (a bare IIFE with true closure-private state, discovered while scoping this file — see below) — it does not; `campaign_engine.js` uses the same flat top-level-`let`/`const` pattern as `db-service.js`'s public API and `classroom_builder.js`, so the shared-script-scope splitting technique already proven twice this phase applies directly, no interface work needed. Then read the full file to find a real seam, same discipline as the `classroom_builder.js` session: this file's central beat-dispatcher (`_campShowBeat`/`_campRenderBeatByType`) routes to five per-beat-type handlers (story, encounter, reveal, dialogue, drag-drop) plus a skill system that layers on top of encounter beats. Two of those — the drag-drop beat type and the skill system — turned out to be genuinely self-contained: grepped every external call site into each cluster's exposed names and confirmed the rest of the engine only ever calls a small, well-defined set of entry points into each (`_campShowDragDropBeat`/`_campHideDragDropUI` for drag-drop; `_campRollSkillDrop`/`_campRenderSkillBar`/`_campHideSkillBar`/`_campGetSkillCounts` for skills) — never reaches into either one's internals.

**Note on this session's file scoping:** `live_monitor.js` (this phase's other remaining candidate) was investigated first and set aside instead — it's wrapped in a genuine closure IIFE (`(function(){ 'use strict'; ... }());` with no captured return value), unlike every other file split so far in this phase. Splitting it verbatim the way the other five extractions were done isn't possible without either (a) breaking that closure's privacy — a real architecture change, not a mechanical move — or (b) building an explicit accessor interface between two files, which is a bigger, differently-risky change than anything attempted so far this phase. Neither was undertaken today; see Remaining Technical Debt.

**Best-Practice Solution:** Extracted both clusters verbatim (via `sed` line-range, byte-diffed against the original before wiring in — same discipline as every prior session) into two new files, each with one clearly statable responsibility: `campaign-dragdrop-beat.js` (the `interaction`/`dragdrop` beat type end to end — panel, pointer-driven drag, drop resolution, solved-check) and `campaign-skills.js` (the Hint/Heal/Shield system end to end — counts, local-optimistic adjust + server reconciliation RPC, random drop roll, skill bar UI, spend handler).

**Files Changed:**
- New: `modules/campaign/campaign-dragdrop-beat.js` (241 lines), `modules/campaign/campaign-skills.js` (258 lines).
- `modules/campaign/campaign_engine.js`: 1,286 → 874 lines. No delegates needed (same as the `classroom_builder.js` session) — extracted functions are called by name from the retained dispatcher/other beat handlers exactly as before.
- `index.html`: added both new `<script>` tags immediately after `campaign_engine.js`.
- No test-harness changes needed (no test coverage existed for this file either way).

**Architecture Before/After:** `campaign_engine.js` 1,286 → **874** lines (32% cut), dropping it below every other remaining god file except the already-shrunk `db-service.js`/`classroom_builder.js`. Both new files land close to the ~400–500 target's lower end and are self-evidently single-purpose from their names alone.

**Why This Is Better:** Each extracted file can now be understood as its own small state machine — reading `campaign-skills.js` top to bottom tells you everything about how Hint/Heal/Shield works without needing to hold the story/encounter/reveal/dialogue beat-playback logic in your head at the same time, and vice versa for the retained engine file.

**Remaining Technical Debt:** `campaign_engine.js` at 874 lines still holds four beat types (story, encounter, reveal, dialogue) plus the core dispatcher/HUD/victory/defeat flow — reveal and dialogue in particular look like further candidates for the same treatment in a future session, not yet attempted here given time already spent this session. `live_monitor.js` (1,539) — still not started; needs a real decision (break its closure's privacy vs. build an accessor interface) before any split, not a repeat of today's technique. `hall-of-fame.js` (1,263) also uses an IIFE per a quick header check this session — likely the same decision point, not yet investigated in depth. `db-service.js`'s pull side and realtime layer remain deferred from session 2. `modules/quest-engine.js` (743) still above target.

**CI Gate Added:** None.

**Verification:** `node --check` on all three touched/new files. Diffed both extracted clusters byte-for-byte against the original before wiring anything in — caught and fixed one real off-by-one boundary mistake mid-session (the reassembled `campaign_engine.js` was initially missing the `// ── Story scenes ──` comment line where the two extractions were spliced out; the byte-diff step caught the 1-line mismatch immediately, it was traced to the exact wrong `sed` start line, and corrected before proceeding — not patched over). Grep-diffed the full set of top-level declarations before vs. after (70 in both) — confirmed identical. `node --test tests/unit/**/*.test.js`: 185/185 passing, unchanged (this file has no test coverage of its own either way, so this confirms no *other* module broke). `eslint .`: 0 errors, 488 warnings (486 prior baseline + 2) — isolated and individually accounted for both new warnings as the same established "cross-file global, unused within its own file" pattern; all 13 pre-existing `innerHTML`/dead-variable warnings simply moved with their code, confirmed by comparing against a direct lint of the pre-extraction backup file.

### Phase 6 — Decompose God Files (file: live_monitor.js → live-monitor-render.js)
**Date:** 2026-08-08 (session 5)

**Problem:** `live_monitor.js` (1,539 lines) — the read-only Live Classroom Monitor dashboard (seating canvas, attendance scoreboard, recitation command center, cold-call spotlight) — was the largest untouched god file, and had been deliberately set aside in session 4 pending a real architectural decision (see that session's note).

**Root Cause:** Same as every entry in this phase.

**The decision session 4 deferred:** unlike every file split in sessions 1–4, `live_monitor.js` is wrapped in a genuine closure IIFE — `(function () { 'use strict'; ... }());` with no captured return value — not the flat top-level pattern `classroom_builder.js`/`campaign_engine.js`/`db-service.js`'s public API all use. The verbatim-extraction technique used so far relies on module state being reachable across script-tag boundaries via shared top-level lexical scope, which a real closure blocks by design. Two options existed: (a) build an explicit accessor interface between two files, preserving the closure's privacy but requiring new code, not a pure move; or (b) deliberately unwrap the IIFE, converting its state to shared top-level `let` bindings — the same pattern its sibling `classroom_builder.js` (same directory, same feature family) already uses. Chose (b): checked first for any `_lm`-prefixed name collision elsewhere in the codebase (found none — one unrelated comment mention in `db-service.js`), confirmed unwrapping brings this file in line with its closest sibling rather than introducing a third convention, and proceeded.

**A real behavior-preservation detail this surfaced:** the original IIFE's first statement was `'use strict';`, making its entire body strict-mode code — including every function that was about to move to a second file. Unwrapping the IIFE and simply deleting that line would have silently dropped the extracted render functions into sloppy mode, a genuine (if subtle) behavior change. Added `'use strict';` as its own top-of-file directive to *both* resulting files instead, so both halves keep the exact strict-mode semantics the original had.

**Investigation before extracting:** Same function-by-function read as the `classroom_builder.js` session — found the render/paint cluster (`_lmRender`, `_lmScaleCanvas`, `_lmRenderCanvas`, `_lmRenderSidebar`/`_lmRenderAttendanceSidebar`/`_lmOverridePanelHtml`, `_lmFeedItem`, `_lmRenderRecitationSidebar`/`_lmRecitationFeedItem`, `_lmAnimateNewRecitationEntries`/`_lmSpawnFloatingPoint`) only reads module state, with one expected exception — `_lmAnimateNewRecitationEntries` adds ids to a dedup Set (`_lmRecitationSeenIds`) so a repaint never replays the same score animation twice, the same category of exception `classroom_builder.js`'s render split already had and for the same reason (shared script-scope makes it safe either way). Deliberately left the cold-call/spotlight cluster (`_lmStartColdCall`/`_lmClearCycle`/`_lmLandOnWinner`/`_lmShowSpotlight`) untouched — it's a distinct subsystem, candidate for a future session, not pushed through under time pressure.

**Best-Practice Solution:** Extracted all 6 (non-contiguous — interaction handlers sit between several of them, same situation as `classroom_builder.js`'s wizard renderer) render clusters verbatim via `sed` line-range into a new `live-monitor-render.js`, each diffed byte-for-byte against the original before wiring in.

**Files Changed:**
- New: `modules/seat-arrangement/live-monitor-render.js` (474 lines).
- `modules/seat-arrangement/live_monitor.js`: 1,539 → 1,132 lines. IIFE wrapper removed; `'use strict';` kept as a top-level file directive; 6 render clusters removed with no delegates needed (functions still called by name across the two files).
- `index.html`: added `<script src="./modules/seat-arrangement/live-monitor-render.js">` immediately before `live_monitor.js`.
- No test-harness changes needed (no test coverage existed for this file either way).

**Architecture Before/After:** `live_monitor.js` 1,539 → **1,132** lines (26% cut). Combined with sessions 1–4, every one of the original six god files identified in this phase's kickoff doc has now had at least one extraction pass.

**Why This Is Better:** Same rationale as the `classroom_builder.js` split — the retained file is "state + event/session/scanner logic," readable as its own concern; the new file answers "what does this screen currently look like" without also holding kiosk/recitation/NFC/scanner lifecycle logic in view. The IIFE-unwrap additionally removes the one structural inconsistency between this file and its closest sibling.

**Remaining Technical Debt:** `live_monitor.js` at 1,132 lines still holds the cold-call/spotlight subsystem, the recitation session lifecycle (start/stop/reconcile), and the Scanner B / Web NFC listeners — each a plausible further split, not attempted here. `hall-of-fame.js` (1,263) — confirmed in session 4 to share this same closure-IIFE pattern; the unwrap-to-match-siblings reasoning used here may or may not apply (needs its own check for whether it has a flat-pattern sibling file the way `classroom_builder.js` was for this one) before repeating this approach. `campaign_engine.js`'s remaining beat types (874 lines: story/encounter/reveal/dialogue) and `db-service.js`'s pull side + realtime layer (session 2) remain deferred. `modules/quest-engine.js` (743) still above target.

**CI Gate Added:** None.

**Verification:** `node --check` on both files. Diffed all 6 extracted render clusters byte-for-byte against the original before wiring anything in (caught and corrected several anchor/line-offset mistakes mid-process via the diff step itself, same discipline as every prior session — each was found and fixed before proceeding, not after). Grep-diffed the full set of top-level declarations before vs. after (80 in both) — confirmed identical. `node --test tests/unit/**/*.test.js`: 185/185 passing, unchanged. `eslint .`: 0 errors, 492 warnings (488 prior baseline + 4) — reconciled exactly: isolated both files' warnings (11 total) against a direct lint of the pre-extraction backup (7 total) and confirmed the +4 delta is entirely the same established "cross-file global, unused within its own file" pattern (`_lmRender`, `_lmAnimateNewRecitationEntries`, `_lmResizeListenerAttached`, `_lmAwardSearch`), with the pre-existing `_lmArrivalFeedSeen` unused-var warning and all 6 `innerHTML` warnings simply retained/relocated with their code, not duplicated or lost.

### Phase 6 — Decompose God Files (file: campaign_engine.js → campaign-reveal-dialogue-beats.js)
**Date:** 2026-08-09 (session 6)

**Problem:** `campaign_engine.js` (874 lines, after sessions 4's drag-drop/skills extraction) still held its reveal (click-to-reveal hotspot) and dialogue (branching choice) beat types.

**Root Cause:** Same as every entry in this phase.

**Also resolved this session — the `hall-of-fame.js` question left open from session 5:** checked whether the same "unwrap the IIFE to match a flat-pattern sibling" reasoning that justified splitting `live_monitor.js` applies here. It does not: every file in `modules/leaderboard/` (`admin-leaderboard.js`, `eql-engine.js`, `hall-of-fame.js`, `index.js`) uses the closure-IIFE pattern — unlike `live_monitor.js`, whose sibling `classroom_builder.js` was already flat, `hall-of-fame.js` has no flat-pattern sibling to converge toward. Unwrapping it here would make it the inconsistent file in its own directory rather than resolve an inconsistency. Deliberately left `hall-of-fame.js` alone rather than force session 5's technique somewhere it isn't actually justified — it still needs either a real accessor-interface split or to stay as-is; that decision is unmade, not defaulted.

**Investigation before extracting:** Confirmed the reveal and dialogue beat-type clusters are each self-contained the same way the drag-drop/skills clusters were (checked in session 4) — grepped every external call site into their exposed entry points and found only the dispatcher and cleanup calls from other beat handlers, never internals. One difference from every extraction so far this phase: the two clusters call directly into *each other's* cleanup (`_campShowRevealBeat` calls `_campHideDialogueUI`, `_campShowDialogueBeat` calls `_campHideRevealUI` — each beat type defensively hides the other's UI in case it was showing). Extracting them into two separate files would work (shared script scope handles cross-file calls fine, as established) but would add a real cross-file dependency in both directions for no gain in cohesion — so they were extracted together into one file instead, an explicit judgment call, not a default.

**Best-Practice Solution:** Extracted the combined reveal+dialogue cluster verbatim (single contiguous 179-line block, unlike every prior campaign extraction) via `sed` line-range into a new `campaign-reveal-dialogue-beats.js`, diffed byte-for-byte against the original before wiring in.

**Files Changed:**
- New: `modules/campaign/campaign-reveal-dialogue-beats.js` (209 lines).
- `modules/campaign/campaign_engine.js`: 874 → 708 lines. No delegates needed — same pattern as every extraction this phase.
- `index.html`: added the new `<script>` tag alongside the other two campaign extraction files.
- No test-harness changes needed.

**Architecture Before/After:** `campaign_engine.js` 1,286 (phase start) → 874 → **708** lines across sessions 4 and 6 (45% total cut). Remaining: core dispatcher/HUD/story/encounter/victory/defeat flow — no more standalone beat-type clusters left to extract from this file.

**Why This Is Better:** Same rationale as every beat-type extraction this phase — each interaction type is independently readable without holding the rest of the beat-playback system in view. This session's one-file-not-two decision keeps that readability honest instead of manufacturing a boundary the code doesn't actually have.

**Remaining Technical Debt:** `campaign_engine.js` at 708 lines is close to the ~400–500 target but not there — the core dispatcher/HUD/story/encounter/victory/defeat flow is what's left, and unlike the four beat-type clusters already extracted, it's genuinely the file's central spine, not a peelable subsystem; further splitting it would need a different kind of decomposition (not attempted here). `hall-of-fame.js` (1,263) — decision explicitly deferred, not defaulted, per above. `live_monitor.js`'s cold-call/spotlight + recitation-session + scanner subsystems (1,132) and `db-service.js`'s pull side + realtime layer (session 2) remain deferred from earlier sessions. `modules/quest-engine.js` (743) still above target.

**CI Gate Added:** None.

**Verification:** `node --check` on both files. Diffed the extracted cluster byte-for-byte against the original before wiring in — one contiguous block this time (no multi-cluster reassembly risk like sessions 3/4/5 had). Grep-diffed the full set of top-level declarations before vs. after (47 in both) — confirmed identical. `node --test tests/unit/**/*.test.js`: 185/185 passing, unchanged. `eslint .`: 0 errors, 494 warnings (492 prior baseline + 2) — reconciled exactly: isolated both files' warnings (13 total) against a direct lint of the pre-extraction backup (11 total, all `innerHTML`) and confirmed the 11 `innerHTML` warnings are the same set simply split across two files (4 + 7 = 11, none duplicated or lost), with the +2 delta being the same established "cross-file global, unused within its own file" pattern (`_campShowRevealBeat`, `_campShowDialogueBeat`).

### Phase 6 — Decompose God Files (file: db-service.js → repository/pull-mappers.js)
**Date:** 2026-08-09 (session 7)

**Problem:** `db-service.js`'s pull side (`_legacyRoleFromDbRole`, `_HISTORY_LIMITS`, and all 30 `_deriveX()` per-table mapping functions, ~450 lines) had been deferred twice — sessions 2 and 3 both flagged it as needing "a closer read than a grep-for-dependencies pass" before it could be split safely.

**Root Cause:** Same as every entry in this phase.

**The closer read, finally done:** grepped the full 450-line block for every reference to `db-service.js`'s other internals (`_cache`, `_getClient()`, `_meta`, `_localStorageProvider`, `_pushCacheToSupabase`) — found none. Every `_deriveX()` function takes only its own raw-row-data parameters and returns a plain object/array; `_legacyRoleFromDbRole` and `_HISTORY_LIMITS` are equally self-contained. This turned out to be exactly as clean a seam as the push-side repository extraction from session 2 — the earlier caution wasn't wrong to have (this session confirmed it by actually checking, not by assuming), it just turned out the answer was "yes, safe" once someone did the check.

**What's still deliberately not touched:** `_pullCacheFromSupabase()` itself — the orchestrator that calls all 30 mappers and assembles the full pull — stayed in `db-service.js`. It reads `_cache` directly, as a fallback for two locally-cache-only fields (`attendanceSessions`, `stageProgress`) that never round-trip through Supabase. That's a real, load-bearing dependency on this file's state, unlike every mapper function around it — moving it would mean either passing `_cache` in as a new parameter (a real interface change, not a pure move) or duplicating the closure-privacy problem `live_monitor.js`/`hall-of-fame.js` already raised elsewhere in this phase. Left as a clean boundary: pure mappers extracted, stateful orchestrator stayed.

**Best-Practice Solution:** Extracted the full pull-mapper block verbatim via `sed` line-range into a new `repository/pull-mappers.js` — the read-side counterpart to session 2's `repository/table-sync.js` (write side). The two files together are now the complete cache-relational mapping layer, split by direction instead of living in one 950+line file.

**Files Changed:**
- New: `repository/pull-mappers.js` (499 lines).
- `db-service.js`: 1,781 → 1,341 lines. `_pullCacheFromSupabase()` and the scoped realtime refresh below it call every extracted mapper by name, unchanged.
- `index.html`: added `<script src="./repository/pull-mappers.js">` between `table-sync.js` and `db-service.js`.
- `tests/unit/helpers/load-globals.js`: `loadDbServiceWindow()`'s ordered file list extended with `repository/pull-mappers.js`.

**Architecture Before/After:** `db-service.js` 2,725 (phase start) → 2,716 → 1,781 → **1,341** lines across sessions 1, 2, and 7 (51% total cut). Only the pull orchestrator and the realtime signal/scoped-refresh layer (~350 lines, still no test coverage) remain of the file's original data-layer bulk.

**Why This Is Better:** `repository/pull-mappers.js` and `repository/table-sync.js` now form a matched pair — anyone working on the relational schema for a given table can find both its read and write mapping in the same directory, each independently readable without the connection/cache/realtime machinery around it.

**Remaining Technical Debt:** `db-service.js`'s realtime layer (`_REALTIME_TABLE_GROUPS`/`_REFRESH_GROUPS`/`_setupRealtimeSignals`/`_schedulePullRefresh`, ~350 lines) is now the last undecomposed piece of the original god file, and remains deferred for the same reason as sessions 2/3/5's other no-coverage files: it needs a live Supabase session to exercise, so a split here can't be verified by the test suite the way this session's was. `campaign_engine.js`'s core dispatcher/HUD/story/encounter/victory/defeat flow (708 lines) — a different kind of split than the beat-type extractions, not attempted. `live_monitor.js`'s cold-call/spotlight + recitation-session + scanner subsystems (1,132) and `hall-of-fame.js` (1,263, decision explicitly deferred in session 6) also remain. `modules/quest-engine.js` (743) still above target.

**CI Gate Added:** None.

**Verification:** `node --check` on both files. Diffed the extracted block byte-for-byte against the original before wiring anything in. Grep-diffed the full set of top-level declarations before vs. after (50 in both) — confirmed identical. `node --test tests/unit/**/*.test.js`: 185/185 passing, unchanged — notably including every delta-sync/no-clobber test that exercises this data indirectly through `DBService._test`, since those tests construct fake Supabase rows and assert on the resulting cache shape, which only holds if the extracted mappers still produce byte-identical output. `eslint .`: 0 errors, 525 warnings (494 prior baseline + 31) — reconciled exactly: isolated both files' warnings (41 total) against a direct lint of the pre-extraction backup (10 total). One of those 10 (`_legacyRoleFromDbRole`) was *already* an "unused" warning before this session touched anything, confirmed by lint diff rather than assumed — it simply moved with its declaration. The other 31 are the expected "cross-file global, unused within its own file" pattern (`_HISTORY_LIMITS` + all 30 `_deriveX()` functions), proportionally larger than prior sessions only because 30 functions moved at once, not because anything is actually wrong.

### Phase 6 — Decompose God Files (file: modules/quest-engine.js → modules/quest-mascot-lines.js, modules/quest-chains.js)
**Date:** 2026-08-09 (session 8)

**Problem:** `modules/quest-engine.js` (743 lines) — itself a session-1 extraction from the original `utils.js` grab-bag — was still above this phase's ~400–500 line target, flagged as such in every session's Remaining Technical Debt since session 1.

**Root Cause:** Same as every entry in this phase, one level removed — this file only exists because of an earlier Phase 6 extraction, and inherited more than one domain from the file it was cut from.

**Investigation before extracting:** Mapped the file's ~38 declarations into domains: core grading/streak mechanics, stage/timing, rarity/cadence/scheduling, combo/streak/analytics scoring, mascot lines, and quest chains + weekly leaderboard. The last two were the cleanest remaining seams — grepped both for dependencies beyond their own exports and found only pre-existing, already-cross-file globals (`window._eqMascotCustomLines` for mascot; `DB.*` and `eqlComputeAcademic()` from `modules/leaderboard/eql-engine.js` for chains) — nothing that became a *new* dependency because of this split.

**Best-Practice Solution:** Extracted both clusters verbatim via `sed` line-range: the mascot emotion library/line pools/trigger table into `modules/quest-mascot-lines.js`, and quest-chain metadata/status plus the weekly top-questers query into `modules/quest-chains.js`. `eqGrantQuizAttemptOverride` (a small, distinct AppStore-mutating function that happened to sit between the two clusters) stayed in the core file rather than being folded into either — it's a controller, not mascot or chain logic, and forcing it into one would have been the same kind of manufactured boundary the reveal+dialogue decision in session 6 explicitly avoided.

**Files Changed:**
- New: `modules/quest-mascot-lines.js` (163 lines), `modules/quest-chains.js` (115 lines).
- `modules/quest-engine.js`: 743 → 534 lines.
- `index.html`: added both new `<script>` tags immediately after `modules/quest-engine.js`.
- `tests/unit/helpers/load-globals.js`: `loadUtilsWindow()`'s ordered file list extended with both new files.

**Architecture Before/After:** `modules/quest-engine.js` 743 → **534** lines (28% cut). Still slightly above the ~400–500 target — noted honestly rather than padded down artificially; the remaining content (core grading, stage/timing, rarity/cadence/scheduling, combo/streak analytics) is more tightly interrelated than mascot lines or chains were, and didn't offer as clean a further seam in the time available this session.

**Why This Is Better:** `quest-mascot-lines.js` and `quest-chains.js` are each independently readable as their own small, complete concern — matches this phase's recurring pattern of extracting genuinely self-contained subsystems rather than splitting by line count alone.

**Remaining Technical Debt:** `modules/quest-engine.js` at 534 lines is close to target but not under it — a further split (e.g., separating the pure scoring/analytics functions from the stage-timing/grading core) is possible but wasn't attempted this session given the tighter interdependency observed. `db-service.js`'s realtime layer (~350 lines, no test coverage), `campaign_engine.js`'s core flow (708), `live_monitor.js`'s remaining subsystems (1,132), and `hall-of-fame.js` (1,263, decision explicitly deferred) all remain from earlier sessions.

**CI Gate Added:** None.

**Verification:** `node --check` on all three files. Diffed both extracted clusters byte-for-byte against the original before wiring anything in. Grep-diffed the full set of top-level declarations before vs. after (80 in both) — confirmed identical. Checked in advance that no test file references any of the moved function names directly (all test coverage goes through the shared `loadUtilsWindow()` harness, which was updated). `node --test tests/unit/**/*.test.js`: 185/185 passing, unchanged. `eslint .`: 0 errors, 525 warnings — **unchanged from the pre-split baseline**, confirmed by isolating all three files individually (zero warnings in any of them, before or after) rather than assuming the total staying flat meant nothing to check.

### Phase 6 — Decompose God Files (file: live_monitor.js → live-monitor-recitation.js, live-monitor-webnfc.js, live-monitor-coldcall.js)
**Date:** 2026-08-09 (session 9)

**Problem:** `live_monitor.js` (1,132 lines, after session 5's render-layer extraction) still held three distinct subsystems: recitation session lifecycle + Scanner B (keyboard-wedge RFID), phone-as-NFC-reader (Web NFC), and Cold Call (random present/late student selector + spotlight).

**Root Cause:** Same as every entry in this phase.

**Investigation before extracting:** Mapped the three remaining clusters and checked cross-references between them (same discipline as every session this phase): Cold Call is fully self-contained — calls only its own functions. Web NFC calls into the recitation/scanner cluster's `_lmSubmitScan()` by design (its own original header comment, kept in the new file, already says it's "entirely additive... only ever calls the same `_lmSubmitScan(tagId)` the keyboard path calls"). The recitation cluster calls back into Web NFC once — `_lmStopWebNfcCapture()` inside `window._lmToggleRecitationMode`, to not leave a phone's NFC radio armed after a session ends. That's a single one-directional defensive cleanup call, not the symmetric mutual coupling `campaign_engine.js`'s reveal+dialogue beats had (session 6) — so unlike that case, these stayed as three separate files rather than being combined.

**Best-Practice Solution:** Extracted all three clusters verbatim via `sed` line-range into `live-monitor-recitation.js`, `live-monitor-webnfc.js`, and `live-monitor-coldcall.js`, each diffed byte-for-byte against the original before wiring in. `'use strict';` added as each new file's own top-of-file directive, same reasoning as session 5's render-layer extraction (the original IIFE's strict-mode coverage has to be preserved explicitly per file now that it's unwrapped).

**Files Changed:**
- New: `modules/seat-arrangement/live-monitor-recitation.js` (177 lines), `modules/seat-arrangement/live-monitor-webnfc.js` (103 lines), `modules/seat-arrangement/live-monitor-coldcall.js` (218 lines).
- `modules/seat-arrangement/live_monitor.js`: 1,132 → 748 lines. No delegates needed — same pattern as every extraction this phase.
- `index.html`: added all three new `<script>` tags immediately after `live_monitor.js`.
- No test-harness changes needed (no test coverage existed for this file either way).

**Architecture Before/After:** `live_monitor.js` 1,539 (phase start) → 1,132 → **748** lines across sessions 5 and 9 (51% total cut). What remains is core state, mount/unmount, the AppStore subscription, and the toolbar/override/award event handlers — every distinct "screen mode" this file supports (render, recitation+scanner, Web NFC, cold call) now has its own file.

**Why This Is Better:** Same rationale as every subsystem extraction this phase — each of these three is independently readable as a complete, self-contained feature (a developer working on Cold Call, say, never needs to hold NFC capture logic in view to understand it).

**Remaining Technical Debt:** `live_monitor.js` at 748 lines is the file's true core — state, mount/unmount, subscription, and the toolbar/override/award controllers that don't belong to any single "screen mode." No further peelable subsystem was identified this session; any further reduction would need a different kind of split (e.g., separating the override panel from the manual-award panel), not attempted here. `db-service.js`'s realtime layer (~350 lines, no test coverage) remains the last undecomposed piece of that god file. `campaign_engine.js`'s core flow (708) and `hall-of-fame.js` (1,263, decision explicitly deferred in session 6) also remain.

**CI Gate Added:** None.

**Verification:** `node --check` on all four files. Diffed all three extracted clusters byte-for-byte against the original before wiring anything in. Grep-diffed the full set of top-level declarations before vs. after (69 in both) — confirmed identical. `node --test tests/unit/**/*.test.js`: 185/185 passing, unchanged. `eslint .`: 0 errors, 536 warnings (525 prior baseline + 11) — reconciled exactly: isolated all four files' warnings (14 total, all in two of the four files — `live-monitor-webnfc.js` and `live-monitor-coldcall.js` came out at zero) against a direct lint of the pre-extraction backup (3 total, all pre-existing from session 5). The +11 delta is entirely the same established "cross-file global, unused within its own file" pattern — ten module-state variables now touched only from the extracted files, plus `_lmReconcileSessionState`.

### Phase 6 — Decompose God Files (file: db-service.js → repository/realtime-groups.js)
**Date:** 2026-08-09 (session 10)

**Problem:** `db-service.js`'s realtime layer had been deferred in sessions 2, 3, 5, and 9 as the last undecomposed piece of the original god file — flagged every time as needing a live Supabase session to exercise, unlike everything else extracted from this file so far.

**Root Cause:** Same as every entry in this phase.

**What this session actually did, and what it deliberately didn't:** read the full realtime layer (`_REALTIME_TABLE_GROUPS`, `_REFRESH_GROUPS`, `_applyScopedRefresh`, `_setupRealtimeSignals`, `_schedulePullRefresh`) rather than deferring a fifth time, and found it splits into two genuinely different pieces, not one monolithic "no test coverage" block:
- `_REALTIME_TABLE_GROUPS` + `_REFRESH_GROUPS` (~210 lines) are pure declarative config — the same pattern as `_TABLE_SYNC_CONFIGS` (session 2) and the pull mappers (session 7). Every `apply` function takes `cache` as its own parameter rather than closing over `_cache`, confirmed by grep for every reference to `db-service.js`'s other internals (found none beyond one comment mention).
- `_applyScopedRefresh` reads and reassigns `_cache` directly (`_cache = await _pullCacheFromSupabase(client)`, `_cache = merged`) — genuine, real closure coupling, the same category that kept `_pullCacheFromSupabase` itself in `db-service.js` back in session 7. `_setupRealtimeSignals`/`_schedulePullRefresh` similarly own closure-private channel/subscriber state (`_signalChannel`, `_tableSyncChannel`, `_signalSubscribers`).

Extracted only the first piece. The second — the actual stateful orchestration, the part every prior session's "no test coverage" caution was really about — stays in `db-service.js`, still deferred, now for a more precise reason than before: it's not merely untested, it's genuinely coupled to this file's mutable cache and channel state in a way the config never was.

**A confidence-level distinction worth stating plainly:** this extraction, unlike sessions 2 and 7's config extractions, has **no unit test exercising it directly** — the delta-sync suite covers the push side and the pull side indirectly through `DBService._test`, but nothing constructs a fake realtime payload and asserts on `_applyScopedRefresh()`'s output. Verified instead by the same static dependency-tracing method used for `classroom_builder.js`/`live_monitor.js` (sessions 3/5/9) — a real check, but a different and weaker confidence level than "185/185 tests still pass and several of them specifically exercise this exact code path," which is what sessions 2 and 7 could claim. Documented in the new file's own header, not just here, so a future reader doesn't mistake this for the same guarantee.

**Best-Practice Solution:** Extracted the config verbatim via `sed` line-range into `repository/realtime-groups.js`, diffed byte-for-byte against the original before wiring in.

**Files Changed:**
- New: `repository/realtime-groups.js` (259 lines).
- `db-service.js`: 1,341 → 1,139 lines. `_applyScopedRefresh()` reads both extracted consts by name, unchanged.
- `index.html`: added `<script src="./repository/realtime-groups.js">` between `pull-mappers.js` and `db-service.js`.
- `tests/unit/helpers/load-globals.js`: `loadDbServiceWindow()`'s ordered file list extended with the new file.

**Architecture Before/After:** `db-service.js` 2,725 (phase start) → 2,716 → 1,781 → 1,341 → **1,139** lines across sessions 1, 2, 7, and 10 (58% total cut). `repository/` now holds three files — `table-sync.js` (push), `pull-mappers.js` (pull), `realtime-groups.js` (scoped-refresh config) — covering every declarative, closure-independent piece of the original data layer. What remains in `db-service.js` is exactly the stateful core: cache, upload queue, the three orchestrator functions (`_pullCacheFromSupabase`, `_applyScopedRefresh`, plus the signal/channel setup), and the public API.

**Why This Is Better:** Same rationale as sessions 2 and 7 — `repository/realtime-groups.js` can be read and reasoned about as pure data (which tables need which other tables refreshed together, and how to turn raw rows into cache slices) without needing to understand cache mutation, channel lifecycle, or subscription bookkeeping at the same time.

**Remaining Technical Debt:** `db-service.js`'s actual stateful realtime orchestration (`_applyScopedRefresh`, `_setupRealtimeSignals`, `_schedulePullRefresh`, ~230 lines combined) remains unextracted, and unlike this session's config piece, splitting it further would mean either accepting genuinely unverified cache-mutation logic in a second file or building a real accessor interface — a different, harder problem than anything resolved so far in this phase, correctly still deferred rather than forced. `campaign_engine.js`'s core dispatcher/HUD/story/encounter/victory/defeat flow (708) and `hall-of-fame.js` (1,263, decision explicitly deferred in session 6) remain from earlier sessions.

**CI Gate Added:** None.

**Verification:** `node --check` on both files. Diffed the extracted config byte-for-byte against the original before wiring anything in. Grep-diffed the full set of top-level declarations before vs. after (18 in both) — confirmed identical. `node --test tests/unit/**/*.test.js`: 185/185 passing, unchanged. `eslint .`: 0 errors, 538 warnings (536 prior baseline + 2) — isolated both files' warnings (11 total) and confirmed `db-service.js`'s 9 are the same familiar pre-existing catch-variable warnings from every prior db-service.js session, with the +2 delta being the expected "cross-file global, unused within its own file" pattern for the two extracted consts.

### Phase 6 — Decompose God Files (file: hall-of-fame.js → hall-of-fame-styles.js)
**Date:** 2026-08-09 (session 11)

**Problem:** `hall-of-fame.js` (1,263 lines) — the "decision explicitly deferred" file from session 6, where the sibling-convention reasoning that justified unwrapping `live_monitor.js`'s closure IIFE (session 5) was found not to apply, since every file in `modules/leaderboard/` uses the same IIFE pattern.

**Root Cause:** Same as every entry in this phase.

**What resolved the deferral:** reading the file's actual content rather than just its wrapper style found that half of it — 642 of 1,263 lines — is `injectHolStyles()`, a CSS-injection function that was ALREADY its own fully self-invoking IIFE (`(function injectHolStyles() { ... })();`) nested inside the outer one, with zero reference to anything else in the file: no `_hol*` state, no template interpolation (checked directly: zero `` ${ `` occurrences in the entire CSS string), nothing but `document.createElement('style')` + `document.head.appendChild(s)`. This made the sibling-convention question moot for this particular piece — extracting it required no IIFE-unwrap decision at all, since it was never coupled to the outer closure's state to begin with. It's arguably the single safest extraction of the whole phase: a static stylesheet with no behavioral surface whatsoever.

**Best-Practice Solution:** Extracted `injectHolStyles()` verbatim into a new `hall-of-fame-styles.js`, which runs standalone via its own `<script>` tag exactly as it ran nested before — no call site anywhere to update, since it was always self-invoking with no caller.

**Files Changed:**
- New: `modules/leaderboard/hall-of-fame-styles.js` (665 lines).
- `modules/leaderboard/hall-of-fame.js`: 1,263 → 628 lines.
- `index.html`: added `<script src="./modules/leaderboard/hall-of-fame-styles.js">` immediately before `hall-of-fame.js`.
- No test-harness changes needed (no test coverage existed for this file either way, confirmed in session 6).

**Architecture Before/After:** `hall-of-fame.js` 1,263 → **628** lines (50% cut) in a single, essentially risk-free move. Now close to the ~400–500 target — the remaining content (category metadata, pagination, card/stage/row renderers, `window.renderLeaderboard`) is real logic with genuine `_hol*` closure-state coupling, which is where the still-unresolved IIFE-unwrap-or-accessor-interface decision from session 6 actually lives; that decision remains open for the logic layer, not resolved by this session's CSS extraction.

**Why This Is Better:** `hall-of-fame-styles.js` can be handed to anyone doing visual/CSS work on the Hall of Fame page without any of the rendering logic in view, and vice versa — a cleaner split than the file's line count alone would suggest, since one whole half of it was never really "logic" in the first place.

**Remaining Technical Debt:** `hall-of-fame.js` at 628 lines still holds its real logic — `HOL_CAT`/`HOL_PERIODS` config, pagination state (`_holPage`/`_holLastTabPeriodKey`), and the render functions (`_holRenderCard`/`_holRenderStage`/`_holRenderRow`/`_holBuildNavBars`) that read that state. The session 6 question — whether to unwrap this file's closure (as `live_monitor.js` was) or build a proper accessor interface — is still unresolved for this remaining piece; this session made progress without needing to answer it, but didn't answer it either. `campaign_engine.js`'s core dispatcher/HUD/story/encounter/victory/defeat flow (708) remains from session 6.

**CI Gate Added:** None.

**Verification:** `node --check` on both files. Confirmed zero template interpolation in the CSS block before extracting (a `${` grep, not an assumption). Diffed the extracted block byte-for-byte against the original before wiring anything in. Grep-diffed the full set of top-level declarations before vs. after (20 in both, excluding `injectHolStyles` itself since it was never a top-level declaration in the grep's pattern — its content match was already confirmed by the byte-diff). `node --test tests/unit/**/*.test.js`: 185/185 passing, unchanged. `eslint .`: 0 errors, 538 warnings — **unchanged from the pre-split baseline**, confirmed directly by isolating both files (2 warnings total, both traced to the exact same line content at new line numbers in a direct lint of the pre-extraction backup, confirming they're pre-existing and unrelated to this session).

### Phase 7 — Module System / Build Tooling (session 1: parallel build stand-up)
**Date:** 2026-08-09 (session 1)

**Problem:** 133 `<script src>` tags in `index.html` (the Phase 7 spec's own "117" figure is stale — Phase 6's god-file decomposition sessions split files further after that doc was written), correctness dependent on exact load order, everything registered onto `window`, no bundler.

**Root Cause:** the app modularized by extracting files (Phases 1–6), which solved "where does this code live" but never solved "how does this code declare what it needs."

**What this session did:** stood up step 5.1 (parallel build, validated against existing behavior before any real conversion work starts) — and, in the process of validating it rather than assuming it, found and fixed one real production bug unrelated to Phase 7's own scope, and surfaced one real architectural constraint that changes how the rest of this phase's build strategy has to work.

**Finding 1 — esbuild `--bundle` is unsafe as a zero-source-change baseline for this codebase.** First attempt: generate an entry file importing all 133 local scripts in `index.html` order, bundle with esbuild `--format=iife`. Build succeeded with zero warnings and passed `node --check` — but that's a false positive. esbuild's bundle wraps combined files in a scope; this codebase has 432 distinct function names invoked from inline HTML event-handler attributes (`onclick="foo()"` etc., 35 static in `index.html`, the rest generated dynamically via `innerHTML` template strings across ~63 files), and 30 of those 432 are bare top-level `function foo(){}` declarations with **no** explicit `window.foo = foo` anywhere — they rely entirely on the browser's classic-script behavior where a top-level declaration in a `<script>` tag becomes an own property of `window`. Under IIFE bundling those 30 stop being reachable from inline handlers and silently break at runtime, despite a clean build and a clean `node --check`. (First attempt at counting this via an inline `node -e` with nested shell quoting produced a bogus 432/432 "all at risk" result — traced to a shell-escaping bug in the grep call, not a real finding; rewritten as a standalone script, `check-globals.js`, which gives the real 30/432 number. Left in the repo root, referenced from `PHASE7_IMPLICIT_GLOBALS.md`.)

**Resolution:** step 5.1's actual build (`build/concat.js`) does true ordered concatenation instead — no esbuild `--bundle`, no scope wrapper, just the same 133 files' source concatenated in `index.html`'s exact order into one script body, which is behaviorally identical to N sequential `<script>` tags (global scope shared, nothing re-wrapped). This is now the valid zero-source-change baseline. esbuild stays installed as a devDependency for real use starting in step 5.3, once files have actual `export`s — at that point the 30 implicit-global functions need `window.foo = foo` added at their declaration sites regardless (tracked in `PHASE7_IMPLICIT_GLOBALS.md`, 0/30 done), which is the correct permanent fix, not a Phase-7-only shim.

**Finding 2 — real pre-existing bug, unrelated to Phase 7 scope, found only because step 5.1 actually ran a build instead of assuming one would work.** `modules/seat-arrangement/live_monitor.js` redeclared its own local `const CB_CANVAS_W = 1200` / `const CB_CANVAS_H = 800` — identical names and values already declared as top-level globals in `modules/seat-arrangement/classroom_builder.js` (loaded earlier in `index.html`, at line 803 vs. `live_monitor.js` at line 806). `modules/seat-arrangement/live-monitor-render.js` (loaded in between, at line 805) already depends on reading `classroom_builder.js`'s `CB_CANVAS_W`/`H` as shared globals — its own header comment says so. Per spec, top-level `let`/`const` across multiple classic `<script>` tags in one document share ONE lexical scope; two declarations of the same name is an early SyntaxError. Confirmed no function/IIFE wrapper actually scopes `live_monitor.js`'s copy (it's indented 2 spaces by file convention only, not inside a block) — this is a real top-level redeclaration. In a real browser this throws `Uncaught SyntaxError: Identifier 'CB_CANVAS_W' has already been declared` the instant `live_monitor.js`'s script tag parses, meaning **nothing in that file executes** — the entire Live Classroom Monitor screen is very likely non-functional in current production, independent of anything in this refactor.

**Files Changed:**
- `modules/seat-arrangement/live_monitor.js`: removed the redundant `const CB_CANVAS_W` / `const CB_CANVAS_H` redeclaration (2 lines), replaced with a comment explaining why they're intentionally absent and pointing at `classroom_builder.js` as the real source. File now correctly reads the pre-existing global from `classroom_builder.js`, same as `live-monitor-render.js` already does.
- New: `build/concat.js` — the step 5.1 parallel-build generator (true ordered concatenation, not esbuild bundling; see Finding 1).
- New: `check-globals.js` (repo root) — standalone script correctly identifying inline-handler function names with no explicit `window.X =` assignment.
- New: `PHASE7_IMPLICIT_GLOBALS.md` — tracks the 30 functions found by `check-globals.js` that need `window.foo = foo` added before any file containing them can safely move to real ESM/bundled scoping (0/30 done — not yet started, this session only produced the list).
- `package.json` / `package-lock.json`: added `esbuild` as a devDependency (installed, not yet used for real bundling — see Finding 1).
- `dist/app.legacy-concat.js`, `dist/concat-manifest.json`: build output, gitignore-candidate (not committed logic, regenerable via `node build/concat.js`).

**Architecture Before/After:** Before: 133 files, correctness depends on `index.html`'s literal script-tag order, no build step exists, no way to validate load-order correctness except loading the real page. After: same 133 files, same load order, but now also produced as a single validated concatenated build (36,625 lines, 1.9MB unminified) that parses cleanly and — critically — was actually exercised as a real build rather than assumed to work, which is how Finding 2 surfaced. No behavior changed by this session's build tooling itself; the one behavior change (Finding 2's fix) is a bugfix this session's verification work incidentally uncovered, not a Phase 7 architecture change.

**Why This Is Better:** the project now has an actual, running signal for "does the full 133-file dependency chain still parse and stay collision-free as a single unit" instead of trusting `index.html`'s script order by inspection alone — and that signal already caught a real defect (Finding 2) that inspection alone had not.

**Remaining Technical Debt:**
- `PHASE7_IMPLICIT_GLOBALS.md`: 0/30 functions fixed. Must reach 0 remaining before any of those 30 functions' files can move to real `--bundle`/ESM scoping (step 5.3 onward).
- Step 5.1's dependency-map deliverable (§5.2 of the Phase 7 session memory doc) not started — this session only validated that a build is *possible*, not that the real per-file dependency graph is documented.
- Two files found genuinely unreferenced by `index.html` during this session's script-tag audit — `modules/world-boss/world-boss-index.js` and `modules/world-boss/titles_sidebar_refresh.js` — not loaded by any script tag and not referenced anywhere else in the codebase (grepped, zero hits). Likely dead code from a prior refactor (`world-boss-index.js` reads like a superseded `index.js`; `titles_sidebar_refresh.js`'s name suggests a feature that moved elsewhere). Not deleted this session — needs a human decision (confirm genuinely dead vs. intentionally-orphaned-for-now) before removal, not a build-tooling call.
- Playwright smoke suite not run this session — this sandbox has no browser install and no test-Supabase-project credentials (`playwright.config.js` requires three env vars, skips cleanly without them per its own design). Needs to run in a real dev environment before this session's build changes are considered fully verified per the project's own standard (unit tests alone are not the bar — see Phase 0's rationale for why the smoke suite exists at all).
- esbuild-based real bundling (§5.1's actual long-term deliverable — minification, dead-code elimination, per-role splitting) not started; this session only produced the safe zero-change baseline it has to build on top of.

**CI Gate Added:** None yet — no CI config exists anywhere in this repo (checked: `find . -iname '*.yml' -o -iname '*.yaml'` returns nothing). Standing up actual CI is implied by the Phase 7 spec's "standing CI check" deliverable and is still open; flagged in the Phase 7 session memory doc §8.1.

**Verification:** `node build/concat.js` then `node --check dist/app.legacy-concat.js` — passes (previously failed with `SyntaxError: Identifier 'CB_CANVAS_W' has already been declared` at the pre-fix state; re-ran after the `live_monitor.js` fix and confirmed clean). Wrote a second, independent check — a top-level `const`/`let`/`class` name scanner over the full concatenated output — confirming zero remaining duplicate top-level declarations across all 133 files (not just re-verifying the one already-found collision). `node --test tests/unit/**/*.test.js`: 185/185 passing, unchanged from the pre-session baseline — confirms the `live_monitor.js` fix didn't regress anything the existing suite covers (note: no existing unit test currently covers `live_monitor.js`'s canvas-dimension usage specifically, so this is process-of-elimination confirmation, not direct coverage — worth a targeted test in a future session, not claimed as covered here). Smoke suite not run this session (see Remaining Technical Debt). `check-globals.js`'s output cross-checked by hand against three specific names (`navTo`, `bsSaveForm`, `closeModal`) via direct grep before trusting the bulk 30-name result.

### Phase 7 — Module System / Build Tooling (session 2: inline-script gap fix + implicit-global cleanup)
**Date:** 2026-08-10 (session 2)

**Problem:** two loose ends from session 1 — the parallel build script only handled external `<script src>` tags, and the 30-item implicit-globals list it produced was untouched (0/30).

**Root Cause:** `index.html` has 3 inline `<script>` blocks with no `src` attribute, interleaved between the 133 external ones (4 lines of Supabase config; 54 lines of core state/leveling init; and a 2,702-line block containing the quiz runner, profile system, and reward/achievement/mail wiring). Session 1's `build/concat.js` only matched `<script src="...">`, so it silently omitted all 2,760 of those lines from the "zero source change" build — the build looked complete (clean syntax check, 185/185 tests) but wasn't actually building the full app. Found this while trying to locate 17 of the 30 tracked functions and discovering none of them existed in any of the 133 external files — they're declared directly inside `index.html`'s big inline block, which nothing had actually scanned as buildable source yet.

**What this session did:**
1. Rewrote `build/concat.js` to treat every `<script>` element in `index.html` — external or inline — as one ordered stream, in true document order (confirmed via character-offset-to-line-number mapping that the inline blocks are genuinely interleaved, not just appended at the end: block 1 sits between `recovery.js` and `reward-presenter.js`; the 2,702-line block sits between `modules/admin/index.js` and `modules/perceived-speed.js`). Rebuilt: 53,844 lines (up from 36,625), still parses clean, still zero duplicate top-level `const`/`let`/`class`/`var` declarations across the corrected full build.
2. Fixed the 30-item implicit-globals list from session 1 — found 2 were false positives (`if`, matched from an inline `onclick="if (...)"` conditional by the extraction regex; `claimReward`, matched from a JSDoc usage-example comment in `button-loading.js`, not real code — the actual `LootService.claimReward()` is already correctly module-scoped inside its own IIFE and never called as a bare global). Fixed the remaining 29: added `window.foo = foo` at the declaration site for 8 external-file functions (`dom.js` ×3, `auth.js` ×2, `recovery.js`, `modules/admin/teacher-invite.js`, `topbar.js`, `modules/world-boss/battle-overlay.js`, `modules/world-boss/raid-flow.js` ×2, `modules/shop/shop_pos_terminal.js`) and 17 functions living in `index.html`'s own inline block, added to its existing "EXPOSE GLOBALS" section (extending the established pattern rather than inventing a new one — that section already explicitly exposed `achUpdateSidebarBadge`/`achGrantRewardsForClaim` with a note about where the mail aliases moved to).

**Files Changed:**
- `build/concat.js`: rewritten to handle inline `<script>` blocks in document order (see Root Cause).
- `dom.js`, `auth.js`, `topbar.js`, `recovery.js`, `modules/admin/teacher-invite.js`, `modules/world-boss/battle-overlay.js`, `modules/world-boss/raid-flow.js`, `modules/shop/shop_pos_terminal.js`: each got a small appended `window.foo = foo;` block (with an explanatory comment) for the specific functions from the tracker declared in that file. No existing code in any of these files was changed — pure additive export lines.
- `index.html`: extended the existing "EXPOSE GLOBALS" section (in the big inline `<script>` block) with 17 more `window.foo = foo;` lines, same comment/placement convention as the two entries already there.
- `PHASE7_IMPLICIT_GLOBALS.md`: 0/30 → 29/29 fixed, 2 false positives documented with reasoning (not silently dropped from the record).

**Architecture Before/After:** Before: the parallel build was quietly incomplete (missing ~5% of the app's real source by line count) and 30 functions existed only as implicit globals. After: the build covers the entire document — every `<script>` element, external and inline, in real order — and every function reachable from an inline HTML event handler now has an explicit `window.X =` assignment (430/432 by the `check-globals.js` count; the remaining 2 are the confirmed false positives, not gaps).

**Why This Is Better:** the parallel build is now actually validating the full app instead of 95% of it, and the codebase no longer has any function that would silently vanish from `window` the moment a file containing it gets real ESM/bundle scoping — which is exactly the failure mode step 5.3 (real module conversion) would otherwise have hit one file at a time, discovered only when something's `onclick` handler stopped working.

**Remaining Technical Debt:**
- `PHASE7_IMPLICIT_GLOBALS.md` itself is now fully checked off — a future session should decide whether to delete it or keep it as a historical record once step 5.3 conversion work is underway and its purpose is fully served.
- The two dead files flagged in session 1 (`modules/world-boss/world-boss-index.js`, `modules/world-boss/titles_sidebar_refresh.js`) are still unresolved — still needs a human decision, not touched this session.
- Step 5.2's real dependency map still not started.
- Playwright smoke suite still not run (same sandbox limitation as session 1 — no browser install, no test-Supabase credentials). This matters more this session than last, since the fix touches `index.html` directly (not just an external file) — a real browser load of the actual page is the only thing that fully confirms the inline-block reordering assumption and the newly-added exports both behave correctly end to end. Treat this session's changes as unit-test-and-static-analysis-verified, not full-app-verified, until the smoke suite runs in a real environment.

**CI Gate Added:** None yet (unchanged from session 1 — no CI config exists in this repo).

**Verification:** `node build/concat.js` then `node --check dist/app.legacy-concat.js` — clean, 53,844 lines (up from session 1's incomplete 36,625). Re-ran the top-level duplicate-declaration scanner against the corrected full build (now including `var` in the pattern, since the inline blocks use `var DB` — zero duplicates found across `const`/`let`/`class`/`var` together). `node check-globals.js`: 430/432 inline-handler names now have a confirmed `window.X =` assignment (up from 402/432 at session 1's end); the remaining 2 are the documented false positives, individually re-confirmed by direct grep (`if` has no real declaration anywhere; `claimReward`'s only match is the JSDoc comment, and its real implementation is `LootService.claimReward()`, confirmed module-scoped via `window.LootService = (function(){...})()` at `modules/world-boss/loot-service.js:18`). `node --test tests/unit/**/*.test.js`: 185/185 passing, unchanged — confirms none of the 8-external-file additive export blocks broke anything the existing suite covers. Smoke suite not run this session (see Remaining Technical Debt).

### Phase 7 — Module System / Build Tooling (session 3: dead-file removal)
**Date:** 2026-08-10 (session 3)

**Problem:** two files flagged in session 1 as unreferenced by any `<script>` tag or code path — needed a human/deeper check before deletion, not a build-tooling call.

**Root Cause, confirmed this session (not just "unreferenced," but why):**
- `modules/world-boss/titles_sidebar_refresh.js` — a stale duplicate of `modules/titles/titles_sidebar_refresh.js` (the live, loaded file — `index.html:831`) from *before* the Phase 4 event-driven-communication conversion. The live version's `achCheckAndAward` title-unlock hook uses `AppStore.subscribe('titles-ach-check-and-award', ...)`; the world-boss copy still has the pre-Phase-4 monkey-patching pattern (`_orig = window.achCheckAndAward; window.achCheckAndAward = function(){...}`) that Phase 4 specifically converted away from. Left behind in the wrong directory, never deleted, never loaded.
- `modules/world-boss/world-boss-index.js` — a near-identical, slightly older snapshot of `modules/world-boss/index.js` (the live load-order guard, loaded — `index.html`). Diff showed exactly one line: the live version's `REQUIRED` symbol list includes `wbmEnsureActiveMinions`, which the stale copy predates. Most likely left behind when this file was renamed to `index.js`.

**Files Changed:** deleted both files. No other file referenced either (confirmed again this session via full-repo grep, including comments/docs/tests/eslint config — genuinely zero hits for both, distinct from the `titles_sidebar_refresh.js` *name*, which does legitimately appear ~10 places, all resolving to the live `modules/titles/` copy, not this one).

**Architecture Before/After:** Before: 140 `.js` files on disk, 133 actually loaded. After: 138 files on disk, 133 loaded — the gap between "exists" and "loaded" that session 1 first noticed is now fully accounted for and closed.

**Why This Is Better:** removes two files that could be edited by mistake (someone assuming `modules/world-boss/titles_sidebar_refresh.js` was live, given the name match) with zero effect on production, and removes a stale-symbol-list trap in `world-boss-index.js` that could confuse a future dependency-graph pass (step 5.2) into thinking there are two load-order guards for the same module.

**Remaining Technical Debt:** none introduced. Step 5.2 (real dependency map) still not started — this was pure cleanup, not conversion work.

**CI Gate Added:** none (unchanged).

**Verification:** `node build/concat.js` — output unchanged (133 external files, same as before deletion, since neither deleted file was ever in that set) — then `node --check dist/app.legacy-concat.js`: clean. `node --test tests/unit/**/*.test.js`: 185/185, unchanged. Re-ran full-repo grep for both filenames post-deletion to confirm no reference was missed pre-deletion.

### Phase 7 — Module System / Build Tooling (session 4: real dependency map, step 5.2)
**Date:** 2026-08-10 (session 4)

**Problem:** step 5.2 (an explicit, grep/AST-verified map of what each of the 136 source units actually reads from and writes to global scope) hadn't been started — step 5.3's leaf-first conversion strategy has no real "which files are safe leaves" answer without it.

**Root Cause:** the same one Phase 7 exists to fix — dependencies are currently implicit (whatever a file happens to read off `window` at runtime), so answering "does file A depend on file B" required either trusting `index.html`'s script order by inspection (session 1 already showed that alone isn't reliable enough — see the `CB_CANVAS_W` finding) or actually parsing every file and resolving every reference.

**What this session did:** wrote `build/dependency-map.js`, using `acorn` (parser) + `eslint-scope` (real scope resolution) — both already present as transitive ESLint dependencies, no new package needed. For each of the 136 source units (133 external files + 3 `index.html` inline `<script>` blocks): parses with `sourceType: 'script'` (matching how these actually execute — not `'module'`, since none use `import`/`export`), resolves every identifier reference that scope analysis says is genuinely free (not bound anywhere within that file), and records what the file declares (top-level `function`/`class`/`var`/`let`/`const`, plus explicit `window.X =` assignments found via a supplementary regex pass, since many live inside IIFEs where they're not "top-level" in the strict AST sense but are genuinely global in effect). Cross-referencing every unit's free-reference set against every other unit's declared-name set produces real dependency edges — not regex guesses.

**Correctness fix made mid-session, before trusting the output:** the first version's "multi-declared name" check lumped two very different risk classes together. Split it: **top-level `const`/`let`/`class` redeclared across units is a fatal `SyntaxError` risk** (the exact `CB_CANVAS_W` bug class from session 1); **top-level `function`/`var`/`window.X =` redeclared is NOT an error** under classic-script semantics (later-loaded silently wins) and in this codebase is frequently an intentional monkey-patch/override chain — exactly what the Phase 4 log entry's "21 additional unconverted patches across 13 files" note already describes. Conflating these into one undifferentiated list would have been actively misleading. Result: **zero** additional fatal collisions beyond the one already fixed in session 1; **41** reassignment-chain names, mostly legible as known Phase-4-adjacent patch pairs (`mailX` pairs between `mail-engine.js`/`mail/index.js`, `wbX` pairs across `world-boss/*.js`, etc.) — full list in `PHASE7_DEPENDENCY_MAP.md`.

**Two more real production bugs found via the "unresolved free reference" output (5 flagged; 2 were genuine ambient-globals gaps — `NDEFReader`, Web NFC; `indexedDB` — added to the allowlist, not bugs):**

1. `modules/recitation/logger.js`'s `logRecitation()` — called from the everyday "log recitation points" teacher action — unconditionally called `renderScanner()` as its last line. Nothing in production declares `renderScanner` anywhere; only a test-harness mock (`tests/unit/helpers/load-globals.js`) did, which is why the existing unit test passed despite the function not existing for real. Confirmed via `att_scanner_rfid.js`'s own header comment: `renderScanner()` was the pre-Phase-1 name, replaced by `renderRfidScanner()` when the RFID kiosk shipped — `nav.js:221` was updated correctly at the time, this one caller was missed. Effect in production: XP/log mutation and the confirmation toast both succeed (they run before the broken call), then an uncaught `ReferenceError` fires and the scanner UI never refreshes after logging. Fixed the call site, updated the stale mock name and its one dependent assertion to match.
2. `modules/world-boss/battle-overlay.js`'s `_wbeInitOrientationPrompt()` — a named function expression's own name (`_wbeOrientResizeListener`) is only visible inside that function's own body, not to sibling code. The `resize` listener was declared as an inline named function expression; a cleanup call a few lines earlier (inside the `orientationchange` handler) referenced that same name expecting it to be a shared binding — it wasn't. Effect: rotating a device while a boss-battle shell had already closed would throw `ReferenceError` on that cleanup path, so the `resize` listener was never actually removed — a permanent per-battle listener leak (each stale listener keeps calling `_updatePrompt()` on every window resize indefinitely). Fixed by hoisting `_wbeOrientResizeListener` to a real function declaration shared by both `addEventListener`/`removeEventListener` call sites.

**Files Changed:**
- New: `build/dependency-map.js` — the step 5.2 generator.
- New: `PHASE7_DEPENDENCY_MAP.md` — human-readable output (fatal-collision list, reassignment-chain list, leaf-candidate ranking, unresolved-reference triage). Regenerable, not meant to be hand-edited.
- New (git-ignorable, regenerable): `dist/dependency-map.json` — full machine-readable graph.
- `build/dependency-map.js`'s `AMBIENT_GLOBALS`: added `NDEFReader`, `indexedDB`.
- `modules/recitation/logger.js`: `renderScanner()` → `renderRfidScanner()`, with an explanatory comment.
- `modules/world-boss/battle-overlay.js`: hoisted `_wbeOrientResizeListener` out of an inline named-function-expression into a real function declaration shared by both call sites.
- `tests/unit/helpers/load-globals.js`: mock renamed `win.renderScanner` → `win.renderRfidScanner` (counter variable name kept as `renderScannerCalls` for a minimal diff).
- `tests/unit/log-recitation-event.test.js`: one test's name/assertions updated to match the renamed mock.

**Architecture Before/After:** Before: no real dependency graph existed; "is this file a safe leaf to convert first" had no verified answer. After: full 136-unit graph with fan-in/fan-out per unit. 19 true leaves found (fan-out 0 — depend on nothing else in this codebase). Of those, `dom.js` stands out as the highest-priority starting point for step 5.3: fan-out 0, fan-in 59 (more files depend on it than any other unit in the entire codebase except `state-manager.js`, `utils.js`, and the big `index.html` inline block) — converting it first both is safe (nothing it needs isn't already resolved) and unblocks the most downstream work. Full fan-in ranking and the other 18 leaves are in `PHASE7_DEPENDENCY_MAP.md`.

**Why This Is Better:** step 5.3 now has a verified starting point instead of a guess, and this pass caught two more real, currently-shipping bugs the same way sessions 1 and 3's checks did — by actually resolving every reference instead of assuming the code does what its call sites imply.

**Remaining Technical Debt:**
- The 41 reassignment-chain names are individually un-triaged — flagged as "likely intentional, mostly Phase-4-adjacent" based on pattern recognition, not confirmed file-by-file. Step 5.3 needs to check each one's actual load order and patch intent before converting either declaring file.
- `AMBIENT_GLOBALS` in `build/dependency-map.js` is necessarily a manually-maintained allowlist — will need occasional additions as step 5.3 proceeds and touches files using browser APIs not yet in the list (same discovery mechanism as this session's `NDEFReader`/`indexedDB` finds, not a one-time task).
- Computed/dynamic property access (`window['foo']`, `window[varName]`) is invisible to this analysis by design (stated as a known limitation in `build/dependency-map.js`'s own header comment) — a targeted grep for `window[` across the codebase hasn't been run yet; worth doing before treating any single file's dependency edges as complete.
- Smoke suite still not run in this sandbox (same limitation as every prior session) — matters more this session than most, since two of the four files changed are real runtime-behavior fixes (`logger.js`, `battle-overlay.js`), not build tooling.

**CI Gate Added:** none yet (unchanged).

**Verification:** `node build/dependency-map.js`: 136/136 units parsed cleanly, 0 fatal collisions, 0 units with unresolved free references after the two ambient-global additions and two bug fixes (started at 5 unresolved, ended at 0 — each of the 5 individually traced to its actual cause, not just added to an allowlist to make the number go away). `node build/concat.js` + `node --check`: clean. `node --test tests/unit/**/*.test.js`: introduced 5 failures immediately after the `logger.js` fix (expected — the old test was asserting the pre-fix broken behavior via a mock of the wrong name), fully traced to that one cause, fixed the mock and its one dependent test, re-ran: 185/185. `nav.js:221`'s existing `renderRfidScanner()` call cross-checked by direct grep to confirm it was the correct rename target before applying the same fix to `logger.js`, not assumed from the header comment alone.

### Phase 7 — Module System / Build Tooling (session 5: first real conversion, step 5.3)
**Date:** 2026-08-10 (session 5)

**Problem:** step 5.3 (converting real files to `import`/`export`) hadn't started — session 4 produced the dependency map that makes leaf selection possible, but no actual conversion had been attempted, and the phase's own sequencing (parallel build → single cutover, never file-by-file live) hadn't been reconciled with the practical mechanics of what converting one file actually requires.

**Root Cause / real architectural finding, before any conversion work started:** a classic `<script>` tag cannot contain the `export` keyword — adding real export syntax to a file still referenced by `index.html`'s `<script src>` would throw a `SyntaxError` and break production the instant the file is saved, not a style concern. Checked further: even `dom.js` — the top leaf candidate from session 4's map, fan-out 0 — isn't safe to flip to `type="module"` on its own either, because module scripts defer differently than classic scripts, and `dom.js` has 59 real consumers currently expecting `toast()`/`closeModal()`/etc. to exist synchronously the moment they run.

**Resolution:** real conversions land in a new parallel `src/` tree, mirroring the original file layout with actual `export` syntax. Original files stay completely untouched — still classic scripts, still what production and `build/concat.js`'s legacy build load — until enough of `src/` exists for the single cutover event. Documented as the repeatable pattern in the new `PHASE7_SRC_CONVERSION_TRACKER.md`, including a per-file conversion checklist, so this doesn't need re-deriving each session.

**First real conversion:** `dom.js` → `src/dom.js`. Picked per session 4's dependency map: fan-out 0 (depends on nothing else in the codebase), highest fan-in of any true leaf (59) — the single most valuable, lowest-risk starting point. Converted its 4 declarations (`toast`, `showModal`, `closeModal`, `closeModalForce`) to `export function`; dropped the trailing `window.X = X` lines from the `src/` copy since nothing consumes it via `import` in any shipping entry point yet.

**Files Changed:**
- New: `src/dom.js` — first real ESM conversion.
- New: `PHASE7_SRC_CONVERSION_TRACKER.md` — the conversion pattern, per-file checklist, and status table (1/19 true leaves converted so far).
- `dom.js` (original): unchanged — checksum-verified identical before/after this session's work.

**Architecture Before/After:** Before: zero files anywhere in the codebase used real `import`/`export`. After: one (`src/dom.js`), verified correct, with nothing else's behavior affected.

**Why This Is Better:** proves the conversion mechanics actually work end to end (Node's real ESM loader accepts it, esbuild's real bundler accepts it, exported-symbol count matches the original's declared-symbol count exactly) before committing to the pattern across the other 18 true leaves and, eventually, the rest of the codebase — and does so with zero risk to anything currently shipping, since the original file was never touched.

**Remaining Technical Debt:**
- The other 18 true leaves (fan-out 0) from session 4's map are unconverted — full list in `PHASE7_DEPENDENCY_MAP.md`.
- Open question flagged in `PHASE7_SRC_CONVERSION_TRACKER.md`, not yet resolved: once a converted `src/` file needs to be consumed by another file that ISN'T yet converted (the normal case once conversion moves past pure leaves), what does the entry-point wiring for step 5.4's `student.entry.js`/`admin.entry.js` look like when it needs to mix real `src/` imports with side-effect imports of not-yet-converted classic files? Didn't come up for `dom.js` specifically since nothing imports it yet, but will block the second or third conversion.
- `src/dom.js` isn't wired into any bundle/entry point that actually runs yet — it exists and is verified in isolation, not yet exercised as part of a larger built artifact. That's the next real piece of step 5.3/5.4 work.

**CI Gate Added:** none yet (unchanged).

**Verification:** exported-symbol count (4) cross-checked against `dist/dependency-map.json`'s `declaresCount` for `dom.js` (4) — exact match, not eyeballed. `node --input-type=module -e "import('./src/dom.js')..."`: imports cleanly, lists exactly `['closeModal', 'closeModalForce', 'showModal', 'toast']`. `npx esbuild src/dom.js --bundle --format=esm`: clean, correctly emits a real `export { ... }` block. `md5sum dom.js` before and after this session's work: identical — the original file was genuinely never touched. `node build/concat.js` + `node --check`: clean, unaffected by `src/`'s existence. `node --test tests/unit/**/*.test.js`: 185/185, unaffected.

### Phase 7 — Module System / Build Tooling (session 6: bridge pattern + real equivalence verification)
**Date:** 2026-08-10 (session 6)

**Problem:** session 5 converted `dom.js` to real ESM (`src/dom.js`) but left open how a converted file's exports reach its 59 still-unconverted consumers, since real ES module exports don't land on `window` the way a classic top-level declaration does.

**Root Cause / finding, checked before building anything:** `showModal` — one of `dom.js`'s 4 exports — has 34+ real consumers calling it by bare name across the codebase, and **zero** explicit `window.showModal =` anywhere. It works today purely because `dom.js` is an unconverted classic script and a top-level `function` declaration auto-attaches to `window`. Session 2's implicit-globals fix only covered symbols reachable from inline `onclick="..."` markup (30 of them) — `showModal` wasn't one of them, since nothing calls it via inline HTML, only via ordinary JS-to-JS calls from other files. This means a bridge covering only session 2's subset would have silently broken `showModal` for 34 files the moment `dom.js`'s classic copy was replaced.

**What this session did:**
1. Built `build/bridges/dom.bridge.js` — imports all 4 of `src/dom.js`'s real exports and explicitly re-assigns every one to `window` (not a subset — checked against the dependency map's full declared-symbol list for `dom.js`, all 4).
2. Bundled it with esbuild (`--bundle --format=iife`) to `dist/bridges/dom.bridge.js` — a self-contained script producing the identical global surface a `<script src="./dist/bridges/dom.bridge.js">` tag would give in place of the original.
3. Wrote a real behavioral equivalence check (`build/verify-dom-bridge.js`), not just a syntax/import check: loads the *original* classic `dom.js` into one jsdom window and the *bundled bridge* into a separate jsdom window with identical starter DOM, drives both through the same sequence of calls (`toast()` with HTML content and a custom color, `showModal()` with a size variant, `closeModal()` with no event arg, then `showModal()` again followed by `closeModalForce()`), and asserts the resulting DOM state is byte-identical at every step. Passed — confirmed via `assert.deepStrictEqual`, not eyeballed.
4. Identified, and explicitly did **not** yet attempt to solve, a larger prerequisite this surfaced: the bridge pattern proves *single-file substitution* is safe, but side-effect-importing *other* still-unconverted classic files into the *same* real esbuild bundle is a different and larger problem — any such file's fan-in > 0 symbols that lack an explicit `window.X =` (not just the onclick-reachable ones session 2 covered) would break the same way `showModal` would have. That audit is strictly bigger than session 2's 30-item pass and hasn't been started. Documented in `PHASE7_SRC_CONVERSION_TRACKER.md` as the next real blocker for scaling past single-file bridges.

**Files Changed:**
- New: `build/bridges/dom.bridge.js` — the bridge source.
- New (build artifact, regenerable): `dist/bridges/dom.bridge.js` — bundled bridge.
- New: `build/verify-dom-bridge.js` — the jsdom equivalence check.
- `PHASE7_SRC_CONVERSION_TRACKER.md`: resolved the "what happens when a converted file has fan-in > 0" open question for the single-file case; added the larger unresolved prerequisite for multi-file bundling.
- `dom.js` (original), `index.html`: **unchanged** — per Principle 8, the actual `<script>` tag swap only happens at the single full cutover event, not per-file. This session proves the bridge is ready to be part of that eventual cutover; it does not perform any cutover.

**Architecture Before/After:** Before: `src/dom.js` existed and was verified in isolation (Node ESM import, esbuild bundle check) but had no proven path to actually replacing the classic file in a running page. After: a verified, drop-in-ready bridge exists, with real behavioral proof (not just "it parses") that swapping `dom.js`'s `<script>` tag for the bridge's bundled output would change nothing observable for any of its 59 consumers.

**Why This Is Better:** turns "we converted a file" into "we proved the conversion is safe to actually use," and did it by finding the specific way a shallower approach would have broken (the `showModal` bare-call case) before it could cause a real regression, rather than after.

**Remaining Technical Debt:**
- The bridge is not wired into `index.html` or the legacy concat build — by design, per Principle 8, until the single cutover event.
- The larger multi-file bundling prerequisite identified this session (full window-export audit needed for any file beyond a single bridged conversion) is unstarted.
- Same 18 remaining true leaves from session 4/5, each will need its own bridge + equivalence check following this session's now-established pattern.
- Smoke suite still not run anywhere (unchanged limitation).

**CI Gate Added:** none yet (unchanged).

**Verification:** `npx esbuild build/bridges/dom.bridge.js --bundle --format=iife`: clean, 1.0kb output. `node --check dist/bridges/dom.bridge.js`: clean. `node build/verify-dom-bridge.js`: PASSED — `assert.deepStrictEqual` across 4 sequential DOM-state snapshots (after `toast()`, after `showModal()`, after `closeModal()`, after `showModal()`+`closeModalForce()`) found zero differences between the original classic file and the bundled bridge. `node build/concat.js` + `node --check`: clean, unaffected. `node --test tests/unit/**/*.test.js`: 185/185, unaffected.

### Phase 7 — Module System / Build Tooling (session 7: window-export audit — the multi-file bundling prerequisite)
**Date:** 2026-08-10 (session 7)

**Problem:** session 6 identified but explicitly did not solve a real prerequisite: before any file besides a single bridged conversion (`dom.js`) could be side-effect-imported into a real esbuild bundle, every one of its symbols with genuine cross-file consumers needed a confirmed explicit `window.X =` — not just the subset reachable from inline `onclick="..."` markup (session 2's scope), but every ordinary bare-JS-call consumer too, which session 6's `showModal` finding (34 real consumers, zero explicit export) showed was a materially larger set.

**Root Cause:** unchanged from every prior session — dependencies are implicit, satisfied only by classic-script auto-attach-to-`window` behavior for top-level declarations. esbuild's `--bundle` removes that auto-attachment (each file gets scope-wrapped), so any symbol relying on it purely implicitly breaks the moment its declaring file is combined into a real bundle with anything else.

**What this session did:**
1. Refactored the parsing/scope-analysis logic out of `build/dependency-map.js` into a shared `build/lib/analyze-unit.js`, so the new audit script wouldn't duplicate (and risk drifting from) the same analysis. Verified the refactor changed nothing: re-ran `build/dependency-map.js` post-refactor and confirmed identical counts to session 4's final numbers (136 units, 0 fatal collisions, 41 reassignment chains, 0 unresolved refs) before trusting it as a foundation.
2. Built `build/audit-window-exports.js`: for every name with real cross-file consumers (per the dependency graph — genuine scope-resolved free references, not regex), checks whether *any* of its declaring units already has an explicit `window.X =`. Handles reassignment chains (a name declared in more than one file) correctly: if any declarer already exports explicitly, the name is safe overall (today's real value already reaches `window` regardless of which specific file auto-attach would otherwise apply to); if none do, flags the **last-loaded** declarer specifically (confirmed via `index.html`'s actual document order, not assumed) — since that's the one whose declaration is actually live today under classic-script semantics.
3. Ran it: **429 names have real cross-file consumers; 249 already safe; 180 at risk, across 39 files.** Spot-checked the two highest-count files before trusting the list at scale: `classroom_builder.js`'s 31 at-risk symbols and `repository/pull-mappers.js`'s 31 are both real, legitimate patterns — a module-state-file / sibling-render-file pairing (same shape as `live_monitor.js`/`live-monitor-render.js`, found in session 1) and the Phase 6 data-layer mapper functions consumed by `db-service.js`/`repository/realtime-groups.js`, respectively. Not measurement artifacts.
4. Applied the fix: `build/apply-window-export-fixes.js` appended a commented `window.X = X;` block to each of the 37 affected *external* files (166 symbols — safe by the same hoisting reasoning verified manually in session 2, now applied at scale via script). The remaining 2 affected units are `index.html`'s own inline `<script>` blocks (14 symbols total: `currentUser`/`currentRole`/`selectedLoginRole` — 51 and 39 consumers respectively, the highest of any symbol in the codebase — plus 11 more in the big inline block, extending session 2's existing "EXPOSE GLOBALS" section) — these needed hand-placed insertion at the correct point in `index.html`, not a blind append.
5. Re-ran the audit: **0 at risk, 429/429 safe.**

**Files Changed:**
- New: `build/lib/analyze-unit.js` — shared parsing/scope-analysis, extracted from `dependency-map.js`.
- `build/dependency-map.js`: rewritten to use the shared lib. Behavior verified identical (see above).
- New: `build/audit-window-exports.js` — the audit itself.
- New: `build/apply-window-export-fixes.js` — the codemod (external files only).
- New: `PHASE7_WINDOW_EXPORT_AUDIT.md` / `dist/window-export-audit.json` — audit output, regenerable.
- 37 external files: appended `window.X = X;` block, 166 symbols total (full per-file list in this session's tool output / `PHASE7_WINDOW_EXPORT_AUDIT.md`'s fix-priority table). Notably includes `dom.js` itself (`showModal`, +1 — the exact gap session 6 found), `db-service.js` (`DBService`), `utils.js` (5 symbols including `uid`, date helpers), `app-state.js` (4), `nav.js` (6), and the two seat-arrangement state-file/render-file pairs (55 symbols combined across `classroom_builder.js`+`classroom-builder-render.js` and `live_monitor.js`+`live-monitor-render.js`).
- `index.html`: 2 targeted insertions — `currentUser`/`currentRole`/`selectedLoginRole` after the inline state-init block's `restoreSession()` call, and 11 more symbols extending the existing "EXPOSE GLOBALS" section in the big inline block.

**Architecture Before/After:** Before: 180 real cross-file dependencies existed purely as implicit classic-script behavior, invisible to any bundler. After: 0 — every symbol with a genuine consumer, per real scope-resolved analysis (not regex), now has a confirmed explicit path to `window`. The multi-file bundling prerequisite session 6 flagged is closed.

**Why This Is Better:** this was the actual blocker between "one file converted" and "the app can be meaningfully bundled/split at all." Finding it via a targeted audit (spot-checked before trusting) and fixing it via a verified-safe automated codemod, rather than discovering each gap one broken consumer at a time during step 5.4's entry-point work, avoids exactly the kind of piecemeal, hard-to-attribute regression this whole phase is structured to prevent.

**Remaining Technical Debt:**
- The 41 reassignment-chain names from session 4 are still individually un-triaged for *intent* (which ones are deliberate monkey-patches vs. accidental) — this session made them all bundle-safe regardless of intent, but didn't audit intent itself; still open.
- Step 5.4 (per-role entry points, actually mixing converted `src/` imports with side-effect imports of the now-bundle-safe classic files) can now proceed — this was the real gate.
- The other 18 true leaves from session 4/5 are still individually unconverted (though now provably bundle-safe as *consumers*, since anything they'd read from other files has an explicit window path — this session was about making files safe to be *combined into a bundle*, which is a prerequisite for conversion work generally, not specific to any one leaf).
- Smoke suite: **the person ran it externally this session** (outside this sandbox) against the state through session 6 — 5 passed, 1 skipped, confirmed good. This session's changes (166 + 14 = 180 new explicit window exports, purely additive lines) haven't been smoke-tested yet themselves; recommend a re-run given the scale of this change, even though the fix pattern itself is well-verified.

**CI Gate Added:** none yet (unchanged).

**Verification:** `build/dependency-map.js` re-run immediately after the `analyze-unit.js` refactor, before building anything on top of it: identical unit/fatal-collision/reassignment-chain/leaf/unresolved counts to session 4's last run. `build/audit-window-exports.js`: 180 at risk → 0 at risk after fixes, 429/429 names now safe. `build/dependency-map.js` re-run again post-fix: still 0 fatal collisions (confirms the codemod didn't introduce any new top-level const/let/class redeclarations). `node build/concat.js` + `node --check`: clean. `node --test tests/unit/**/*.test.js`: 185/185, unaffected. `node build/verify-dom-bridge.js`: re-run since `dom.js` itself was modified by the codemod (gained `window.showModal = showModal`) — still PASSED, byte-identical DOM state. Manually spot-checked the actual file contents post-edit for the two trickiest cases (a file's tail after append, and both `index.html` inline-block insertions) rather than trusting the codemod's own success output alone.

### Phase 7 — Module System / Build Tooling (session 8: first real full-app bundle — proven via actual execution, not just syntax)
**Date:** 2026-08-10 (session 8)

**Problem:** with session 7's window-export audit reporting 0 at-risk symbols, the theoretical prerequisite for real bundling looked closed — but nothing had actually tried building and *running* a real full-app esbuild bundle to confirm it. Static analysis, however careful, is a prediction; only real execution proves it.

**What this session did, in the order it actually happened (kept honest rather than presented as a clean linear success):**

1. Built `build/generate-full-entry.js` (an entry point importing all 136 units — 135 classic side-effect imports + 1 real import+bridge for `src/dom.js`) and bundled it for real with esbuild. **It built clean, zero warnings, passed `node --check`.** Looked done.
2. Built `build/verify-full-bundle.js` to actually *execute* both the legacy build and the new real bundle against the real `index.html` `<body>` in separate jsdom windows, diffing the resulting global surface — not trusting a clean build as proof. **The real bundle threw synchronously: `mailGetForStudent is not defined`.** The clean build had been a false sense of safety.
3. Traced it: `modules/mail/index.js` does `window.mailGetForStudent = mailGetForStudent;`, re-exporting a function actually declared in the sibling file `modules/mail/mail-engine.js`. Session 7's audit had incorrectly marked this "safe" because it found *an* explicit `window.X =` for the name — without checking that the explicit-exporting file's own reference to the RHS identifier was itself a genuine, unresolved cross-file dependency. **Root cause: a bug in the audit tooling itself**, not in the app — `build/lib/analyze-unit.js`'s `declares` set conflated "this file provides X via `window.X =`" with "this file has a real local declaration of X," letting a re-exporting file's own internal reference silently skip resolution.
4. Fixed by splitting `declares` (broad, for general reachability) from a new `astDeclares` (real AST-level declarations only), and rebuilding `declaredBy`/the self-reference-skip check on `astDeclares`. Re-ran the audit: numbers swung wildly (`96` unresolved units, up from `0`) — a second real bug, immediately caught before trusting it: symbols like `renderStatBar`, declared inside a same-file top-level IIFE (not literal `Program.body`) and re-exported via `window.renderStatBar = renderStatBar;` in that *same* file, were being wrongly flagged, since the fix didn't yet know a same-file, locally-resolvable re-export is safe regardless of nesting depth.
5. Fixed properly via full AST analysis (added `acorn-walk` as a direct devDependency — was only a transitive one, causing a `MODULE_NOT_FOUND` on first attempt) to distinguish, for every `window.X = Y` assignment: self-contained (`Y` is not a bare identifier, or *is* one but resolves locally per real scope analysis — safe) vs. genuine re-export (`Y` is a bare identifier that's actually free within that file — needs its own resolution). Re-ran: down to a clean, real 9 at-risk symbols across 2 files (`mail-engine.js` ×8, `modules/world-boss/student-page.js` ×1), matching hand-verification exactly.
6. Applied the fix, rebuilt, re-ran the real execution test: **new crash, different symbol — `_wbcStartLiveRefresh is not defined`.** Traced it: a THIRD real gap, this time in the "first declarer" heuristic itself (added earlier this session to handle monkey-patch chains correctly — a later patch file's own explicit export shouldn't count as "safe" if the patch's own code depends on an earlier, unexported original). `modules/world-boss/phases.js` has a guarded patch (`if (typeof _wbcStartLiveRefresh === 'function') { ... window._wbcStartLiveRefresh = ...; }`) that loads *before* `modules/world-boss/student-page.js` (the real, unconditional declarer) — meaning the guard is false when phases.js runs, in the real app today, not just under bundling. Static AST analysis has no way to know a conditional guard never actually fires; only real execution testing caught it.
7. Fixed directly on `student-page.js` (the true declarer) and documented the limitation explicitly in `build/audit-window-exports.js`'s header for future sessions, rather than trying to perfect the heuristic further. Rebuilt, re-ran: **evaluated without throwing, both builds.**
8. Remaining gap: bundle's global surface (1282 properties) vs. legacy's (1752). Rather than assume this was fine, cross-checked *all* 471 "legacy-only" names against the full dependency graph, not a sample: **zero have any real cross-file consumer.** These are internal, module-private helper functions that leaked onto `window` under classic-script scoping as an incidental side effect (any bare top-level function auto-attaches, whether or not anything else reads it) — real module bundling correctly stops that leak. This is proper encapsulation working as intended, one of the actual stated benefits of this migration, not a regression. One extra property in the other direction (`_bsRenderFormModal`) traced to a benign null-vs-set timing difference between two separate snapshot runs (`bs_library.js` initializes it to `null` as a placeholder with its own comment "set by editor.js after it loads"; both builds set it correctly, just possibly snapshotted a beat apart).

**Files Changed:**
- New: `build/generate-full-entry.js`, `build/verify-full-bundle.js` — the real bundle generator and the actual-execution verification harness.
- New (build artifact): `dist/app.full-bundle.js`, `build/entry.full.js`, `build/inline/inline{0,1,2}.js` (extracted copies of `index.html`'s inline `<script>` blocks, needed since esbuild imports files, not inline HTML content), `dist/full-bundle-diff.json`.
- `build/lib/analyze-unit.js`: added `astDeclares` (real AST-level declarations, separated from the broader `declares`), replaced the regex-based window-export detection with a proper `acorn-walk` AST traversal, and added the self-contained-vs-re-export distinction (checks the real free-reference set, not textual nesting).
- `build/dependency-map.js`, `build/audit-window-exports.js`: updated to build `declaredBy` and the self-reference-skip check from `astDeclares`; the audit's "any declarer has an export" check replaced with "the *first-loaded* real declarer has an export," with the conditional-guard limitation documented in its header comment.
- `package.json`/`package-lock.json`: `acorn-walk` promoted from transitive to a direct devDependency.
- `modules/mail/mail-engine.js`: 8 explicit `window.X = X` exports added (`mailGetForStudent`, `mailIsRead`, `mailIsClaimed`, `mailClaimRewards`, `mailMarkRead`, `mailUpdateSidebarBadge`, `mailUnreadCount`, `mailUnclaimedRewardCount`).
- `modules/world-boss/student-page.js`: 2 explicit exports added this session (`_wbcUpdateHPDisplay` from the earlier corrected-audit pass, `_wbcStartLiveRefresh` from the conditional-guard finding).
- `db-schema.js`: 2 explicit exports added (`saveDB`, `loadDB`).

**Architecture Before/After:** Before: a real full-app bundle had never been attempted; the window-export audit's "0 at risk" was an untested prediction. After: a real esbuild bundle of all 136 units, actually executed against the real page DOM in jsdom, confirmed behaviorally equivalent to the legacy build wherever it matters (zero real missing dependencies, zero throws) — with the difference in raw global-property count explained and confirmed benign, not hand-waved.

**Why This Is Better:** this session is the clearest demonstration yet, within this whole phase, of why "the build succeeded" and "the static audit says 0 at risk" are not the same claim as "this works." All three real gaps found this session passed a clean build and would have shipped silently broken without `build/verify-full-bundle.js` actually running the code. The fixes this session also directly improved the analysis tooling's correctness for every future session, not just this one.

**Remaining Technical Debt:**
- Only `dom.js` has an actual `src/` conversion; the full bundle currently proves the *mechanism*, not a meaningfully modularized app. Converting more leaves is still separate, ongoing work.
- Per-role entry-point splitting (student vs. admin bundles) — step 5.4's actual deliverable — hasn't started; this session proved the underlying full-bundle mechanism it depends on.
- The "first-loaded declarer" heuristic in `build/audit-window-exports.js`, while now correct for every case found so far, is documented as having a known blind spot (conditional guards) rather than claimed as complete — future sessions should keep using `build/verify-full-bundle.js` as a check on the audit, not treat the audit as sufficient alone.
- Smoke suite: still not run against this session's changes (unchanged limitation — no browser/credentials in this sandbox). Given this session touched real application files (`mail-engine.js`, `student-page.js`, `db-schema.js`) with real, confirmed-correct-but-still-worth-double-checking export additions, a smoke suite run is recommended before the next round of work builds further on top of this.

**CI Gate Added:** none yet (unchanged).

**Verification:** `node build/audit-window-exports.js`: 0 at risk, 432/432 safe (after all three fix rounds). `node build/dependency-map.js`: 0 fatal collisions, 0 unresolved free references, unchanged from prior sessions' expectations once the analysis bugs were fixed. `node build/generate-full-entry.js` + `npx esbuild ... --bundle --format=iife`: clean build, `node --check`: clean syntax. `node build/verify-full-bundle.js`: both legacy and real-bundle builds evaluate without throwing against the actual `index.html` body in jsdom; the 471-property global-surface gap cross-checked exhaustively (not sampled) against the full dependency graph — zero have real cross-file consumers. `node build/concat.js` + `node --check`: legacy build still clean, unaffected. `node --test tests/unit/**/*.test.js`: 185/185, unaffected. `node build/verify-dom-bridge.js`: re-confirmed still passing (unrelated to this session's changes, re-checked as part of full regression).

### Phase 7 — Module System / Build Tooling (session 9: per-role closure analysis — real progress, honest incompleteness)
**Date:** 2026-08-10 (session 9)

**Problem:** with the full-bundle mechanism proven in session 8, step 5.4's actual deliverable (separate `student`/`admin` entry points, so a student's browser doesn't download admin/boss-studio/quiz-builder code) hadn't been attempted.

**What this session did:** built `build/compute-role-split.js`, seeding a graph traversal from `nav.js`'s real routing table (every `id==='s-...'`/`id==='a-...'` branch, hand-transcribed — not guessed from directory names, per the session memory doc's §8.2 decision) through the real dependency graph.

**Finding 1 — nav.js hub problem, found and fixed:** first run produced 100% overlap (student and admin closures identical, 109/109 units each) — obviously wrong. Traced to `nav.js` itself: 43 direct dependency edges (roughly 4x any other file), because its routing table references every role's render function by bare name in one shared if/else chain. A student session never executes the `else if(id==='a-boss-studio')` branch, so nav.js referencing `renderBossStudio` there is safe at runtime — a static-analysis artifact of one legitimately-shared router file, not a real per-role dependency. Fixed by treating `nav.js` as a required-shared boundary node: included directly in both closures, its own outgoing edges not followed for splitting purposes. Re-ran: student closure 74, admin closure 105, 71 shared, 3 student-only, 34 admin-only, 28 unclassified — a real, meaningful split for the first time.

**Finding 2 — a deeper, structural gap, found by inspecting the "neither role" list rather than trusting the count:** it's dominated by files that are unmistakably role-specific and should never be unclassified — `modules/admin/student-manager.js`, `modules/admin/analytics.js`, `modules/boss-studio/bs_editor.js`, and nearly every module's own `*_index.js` aggregator (`ach_index.js`, `att_index.js`, `campaign_index.js`, `mail/index.js`, `shop_index.js`, `titles_index.js`, `world-boss/index.js`, etc.). Traced `bs_editor.js` specifically: its only real call site, per the dependency graph, is a self-call within its own file — nothing in `bs_library.js`'s reachable chain calls into it via any bare identifier the graph can see, even though it's unmistakably needed by the boss-studio feature. Root cause: this codebase's own `*_index.js` convention (a per-module aggregator whose job is to verify all sibling exports exist, similar to the "all exports verified ✅" pattern seen throughout) is a graph *sink* — it depends on its siblings, but nothing calls *into* it, so no render-function-seeded traversal can ever reach it, regardless of how correct the rest of the graph is.

**Decision, consistent with every prior session's discipline:** did **not** generate or ship actual `student.entry.js`/`admin.entry.js` bundles this session. Building them on top of a closure known to misclassify real files as "neither role" would mean presenting an unverified split as safe — exactly the failure mode session 8's real-execution testing exists to catch, and skipping that same discipline here (just because the closure computation looked complete on its own terms) would be inconsistent with how every other finding in this phase has been handled.

**Files Changed:**
- New: `build/compute-role-split.js` — the closure analysis, including the nav.js boundary-node fix.
- New: `PHASE7_ROLE_SPLIT.md` / `dist/role-split.json` — output, regenerable.
- `PHASE7_SRC_CONVERSION_TRACKER.md`: documents both the real fix (nav.js) and the identified-but-unsolved gap (aggregator sink files), with a concrete recommended approach for next session.
- No application files touched this session — pure analysis tooling, zero risk to anything shipping.

**Architecture Before/After:** Before: no per-role closure data existed at all. After: a real, partially-validated closure computation exists, with its specific known limitation (aggregator sink files) documented precisely enough that the next session doesn't need to rediscover it.

**Why This Is Better:** the nav.js fix alone is genuine, verified progress (100% overlap → a real 65%/77% role-specific split). Documenting the remaining gap precisely — rather than either quietly shipping something incomplete or vaguely gesturing at "more work needed" — gives the next session an exact, actionable starting point (directory-based grouping to catch aggregator sinks) instead of requiring the same investigation to happen twice.

**Remaining Technical Debt:**
- Actual `student.entry.js`/`admin.entry.js` generation and bundling: not started, blocked on the aggregator-sink gap above.
- Recommended fix (directory-based grouping layered on top of the call graph) is specified but not implemented.
- The other 18 true leaves from earlier sessions remain unconverted; this session's role-split work is orthogonal to `src/` conversion progress.
- Smoke suite: still not re-run since session 7's changes (unchanged from session 8's note) — this session touched no application files, so the risk profile hasn't grown, but the recommendation to re-run before further work still stands from session 8.

**CI Gate Added:** none yet (unchanged).

**Verification:** `node build/compute-role-split.js` run twice — once producing the diagnostic 100%-overlap result (correctly recognized as wrong rather than accepted), once after the nav.js fix producing the real split. `bs_editor.js`'s isolation confirmed by direct grep for all real call sites of `_bsRenderFormModal(`, not inferred. `node build/concat.js` + `node --check`: clean, unaffected (no application files touched). `node --test tests/unit/**/*.test.js`: 185/185, unaffected.

### Phase 7 — Module System / Build Tooling (session 10: real per-role bundles, first ones generated and verified)
**Date:** 2026-08-10 (session 10)

**Problem:** session 9 identified the aggregator-sink gap in the role-split closure computation and explicitly declined to ship bundles built on top of it. This session implements the recommended fix, discovers it's more nuanced than expected, and produces the phase's first actual per-role bundles.

**What this session did — three iterations on the directory-grouping fix, each checked against real files before trusting it:**

1. **Blanket directory grouping** (session 9's recommendation, as specified): once any file from a `modules/<feature>/` directory is in a closure, include every sibling. Fixed the sink problem (`bs_editor.js` now reachable), but overcorrected badly — shared jumped from 71 to 119 of 136 units. Traced it: boss-studio's `bs_bve_engine.js` is a *real*, legitimate shared dependency (confirmed: 10 world-boss files have genuine call-graph edges into it — a rendering engine used by both battle-viewing and battle-editing code), and blanket grouping used that one real shared file as an excuse to pull the entire directory — including the actual admin-only editor UI — into both roles.
2. **Sinks-only grouping**: only expand files with zero fan-in across the whole graph (true aggregator/verification sinks like `bs_editor.js`/`bs_index.js`), leaving files with real call-graph presence (like `bs_bve_engine.js`) to resolve normally. Better, but `bs_editor.js` still leaked into student's closure — any single touched file in a directory was still enough to trigger sink expansion for that whole role.
3. **Majority-threshold grouping**: only expand sinks into a closure that already holds a majority of the directory's non-sink files. Checked directly why boss-studio still didn't separate cleanly: student's closure genuinely touches 3 of its 4 real files (`bs_storage.js`, `bs_animation_library.js`, `bs_bve_engine.js` — everything except `bs_library.js`, the actual editor's declared entry point) — a real majority by any reasonable threshold, because boss-studio's internal structure genuinely has more shared rendering infrastructure than admin-exclusive surface.

**Decision:** stopped refining the heuristic at this point rather than continuing to chase a perfect general rule for what is, on inspection, a genuinely hard and borderline case — not a bug with a clean fix. Made an explicit, safety-driven call instead: over-inclusion is a safe failure mode (unused code shipped, bundle slightly larger than optimal); under-inclusion is not (a missing file throws, per every real bug session 8 found in the full-bundle work). `bs_editor.js`/`bs_index.js` (2 files) land in both bundles as a known, documented, harmless imperfection — noted explicitly in code comments, not hidden. The 5 files the closure computation couldn't attribute to either role at all (`error-capture.js`, `index.html#inline0`, `modules/admin/analytics.js`, `modules/admin/teacher-invite-service.js`, `recovery.js`) get the same safe-default treatment: included in both.

**Built and verified the actual bundles:**
- `build/generate-role-entries.js` — generates `build/entry.student.js`/`build/entry.admin.js` from the role-split data plus the documented safe-default policy.
- Bundled with esbuild: `dist/app.student-bundle.js` (96 files, 1.5MB) and `dist/app.admin-bundle.js` (131 files, 2.1MB), vs. the full bundle's 136 files/2.2MB — **a real 32% size reduction for the student bundle**, the actual deliverable named in the Phase 7 spec ("a student's browser downloads all admin/boss-studio/quiz-builder code on every login").
- `build/verify-role-bundles.js` — same real-execution discipline as session 8's `verify-full-bundle.js`: evaluates both bundles against the actual `index.html` `<body>` in jsdom. **Both evaluate without throwing synchronously.**

**Files Changed:**
- `build/compute-role-split.js`: three rounds of directory-grouping refinement (see above), final version uses majority-threshold sink expansion.
- New: `build/generate-role-entries.js`, `build/verify-role-bundles.js`.
- New (build artifacts): `build/entry.student.js`, `build/entry.admin.js`, `dist/app.student-bundle.js`, `dist/app.admin-bundle.js`.
- `PHASE7_SRC_CONVERSION_TRACKER.md`: documents all three refinement rounds, the final safety-driven decision, and the verified results.
- No production application files touched — all changes are in analysis/build tooling and generated artifacts.

**Architecture Before/After:** Before: no real per-role bundle had ever been generated; session 9 ended with a documented reason not to. After: both bundles exist, are meaningfully smaller where it matters (student bundle), and pass the same real-execution bar that caught 3 genuine bugs in the full-bundle work.

**Why This Is Better:** delivers the actual, concrete benefit this whole phase names as a goal — smaller downloads for the more numerous, more bandwidth-constrained user population (students) — while being explicit about the one remaining imperfection rather than either hiding it or letting the pursuit of a perfect heuristic block real, safe, shippable progress.

**Remaining Technical Debt:**
- `bs_editor.js`/`bs_index.js` ship in the student bundle unnecessarily (~2 files of unused code) — a known, low-priority cleanup, not a correctness issue.
- Verification so far is boot-sequence-level only (does the bundle evaluate without throwing), same as session 8's bar — not yet exercised via simulated page navigation/click-through for each role's actual pages.
- Neither bundle is wired into `index.html` — by design, per Principle 8, until the single full cutover event, which is still far off (only `dom.js` has a real `src/` conversion; steps 5.5/5.6 haven't started).
- Smoke suite: still not re-run since session 7 (now session 10's own work adds to what's accumulated since then) — the recommendation from sessions 8 and 9 to run it before further work stands, more so now that real bundle artifacts exist that could be spot-checked in a real browser too.

**CI Gate Added:** none yet (unchanged).

**Verification:** `node build/compute-role-split.js` run three times across the three refinement iterations, each checked against real files (`bs_bve_engine.js`'s actual call sites, `bs_editor.js`'s actual fan-in, the precise non-sink touch-count for boss-studio) rather than trusting the summary numbers alone. `node build/generate-role-entries.js`: 96 student / 131 admin files included, matching the closure data exactly. `npx esbuild ... --bundle --format=iife` for both: clean builds, `node --check`: clean syntax for both. `node build/verify-role-bundles.js`: both evaluate without throwing against the real `index.html` body. `node build/concat.js` + `node --check`: legacy build still clean. `node --test tests/unit/**/*.test.js`: 185/185, unaffected.

### Phase 7 — Module System / Build Tooling (session 11: second real conversion — modules/shared/stat-bars.js)
**Date:** 2026-08-10 (session 11)

**Problem:** step 5.3 had only 1 of 19 true leaves converted (`dom.js`, sessions 5-6). Continuing the established pattern for the next-highest-priority leaf.

**What this session did:** converted `modules/shared/stat-bars.js` → `src/stat-bars.js`, following the exact pattern sessions 5-6 established: real `src/` conversion (original file untouched), a bridge module re-attaching the real export to `window`, and a real jsdom behavioral equivalence check — not just a syntax/import check. Picked per `PHASE7_DEPENDENCY_MAP.md`: fan-out 0, fan-in 3 (highest of any remaining unconverted leaf after `dom.js`).

**Files Changed:**
- New: `src/stat-bars.js` — real ESM conversion (1 export: `renderStatBar`).
- New: `build/bridges/stat-bars.bridge.js`, `dist/bridges/stat-bars.bridge.js` — bridge source and bundled output.
- New: `build/verify-stat-bars-bridge.js` — jsdom equivalence check, exercising `percent`/`tier`/`justChanged`-pulse behavior, both-direction clamping (0-100), and the `null`-element/missing-field guard paths — not just the happy path.
- `modules/shared/stat-bars.js` (original): unchanged — checksum-verified.
- `PHASE7_SRC_CONVERSION_TRACKER.md`: status table updated, 2/19 true leaves converted.

**Architecture Before/After:** Before: 1 file converted. After: 2, with the same full verification chain (declares-vs-exports count match, real Node ESM import, real esbuild bundle, jsdom behavioral equivalence, original-file checksum) applied to both.

**Why This Is Better:** repeats the proven-safe pattern exactly, extending real coverage without introducing any new risk — the equivalence check this time specifically exercised edge cases (clamping in both directions, the `null`-element guard, missing `state` fields) precisely because `dom.js`'s simpler functions didn't have as much internal branching to be worth stress-testing the same way.

**Remaining Technical Debt:** 17 more true leaves remain unconverted (see `PHASE7_DEPENDENCY_MAP.md`'s leaf-candidate table). Neither converted file is wired into any shipping entry point yet — both exist as verified, ready-for-cutover units. Smoke suite still not re-run since session 7 (unchanged recommendation from sessions 8-10).

**CI Gate Added:** none yet (unchanged).

**Verification:** export count (1) matches `dependency-map.json`'s `declaresCount` for the original file (1) — exact match. `node --input-type=module` import: clean, `['renderStatBar']`. `npx esbuild --bundle --format=esm`: clean. `md5sum` before/after: identical, original untouched. `node build/verify-stat-bars-bridge.js`: PASSED — `assert.deepStrictEqual` across 4 snapshots (normal render, justChanged pulse, clamp-above-100, clamp-below-0), plus two additional calls specifically testing the `null`-element and missing-`state`-field guard paths (must not throw — didn't, in either build). `node build/concat.js` + `node --check`: clean, unaffected. `node --test tests/unit/**/*.test.js`: 185/185, unaffected. `node build/verify-dom-bridge.js`: re-confirmed still passing (unrelated to this session, re-checked as part of full regression).

### Phase 7 — Module System / Build Tooling (session 12: three more real conversions — sequence.js, particles.js, button-loading.js)
**Date:** 2026-08-10 (session 12)

**Problem:** continuing step 5.3's leaf-by-leaf conversion, following the pattern sessions 5-6 and 11 established.

**What this session did:** converted three more true leaves from `PHASE7_DEPENDENCY_MAP.md`'s remaining list — `modules/shared/sequence.js`, `modules/shared/particles.js`, `modules/shared/button-loading.js` — bringing the total to 5 of 19. Same discipline as every prior conversion (original untouched, checksum-verified; export count matches declares count; real Node ESM import; real esbuild bundle; a bridge module; a real jsdom behavioral equivalence check, not a syntax check), with three new wrinkles handled correctly rather than glossed over:

1. **`sequence.js` is inherently async** (`setTimeout`-driven) and returns a `cancel()` handle. The equivalence check exercises real timing (via `await wait(ms)`, not fake timers) and specifically confirms `cancel()` actually stops later steps from firing — not just that the function exists.
2. **`particles.js` uses 2D canvas rendering, which jsdom in this sandbox cannot do** (`getContext('2d')` isn't implemented without the optional native `canvas` npm package). Rather than skip verification silently or claim more than was checked, the equivalence check's own header comment states the limitation explicitly: guard clauses (null anchorEl, prefers-reduced-motion) and canvas element creation/dimensions were verified byte-identical between original and bridge; the actual per-frame `requestAnimationFrame` rendering was not and could not be, in either build. Both builds do fail identically (same `TypeError`, same call-stack shape) at the same untestable point, which is itself weak evidence toward equivalence, but the log is explicit that a real browser check is still warranted before treating this file as fully verified.
3. **`button-loading.js` is the first conversion with a same-file cross-function dependency** (`eqWithButtonLoading` calls `eqButtonLoading`, both now real exports in the same module) **and a module-top-level side effect** (one-time `<style>` tag injection, guarded by `if (!document.getElementById(...))`). Confirmed both work correctly under real ESM semantics rather than assuming they would: the style injection fires on import (checked via a jsdom-backed dynamic `import()`), and the cross-function call resolves via normal module-internal scope. The equivalence check specifically exercises the double-on guard (second `eqButtonLoading(btn, true, ...)` call while already loading must not clobber the saved original HTML), the never-was-loading no-op, the null-button guard, and — most importantly — `finally`-based restoration through both the success AND error paths of `eqWithButtonLoading`, confirming errors still propagate correctly to the caller while the button is still restored.

**Files Changed:**
- New: `src/sequence.js`, `src/particles.js`, `src/button-loading.js` — real ESM conversions.
- New: `build/bridges/{sequence,particles,button-loading}.bridge.js` + bundled `dist/bridges/` outputs.
- New: `build/verify-{sequence,particles,button-loading}-bridge.js` — equivalence checks.
- Three originals (`modules/shared/sequence.js`, `modules/shared/particles.js`, `modules/shared/button-loading.js`): unchanged, checksum-verified.
- `PHASE7_SRC_CONVERSION_TRACKER.md`: status table updated, 5/19 true leaves converted, particles.js's verification gap documented explicitly in its own row rather than only in the script comment.

**Architecture Before/After:** Before: 2 files converted. After: 5, with three new patterns (async/cancel-handle, canvas-dependent rendering, same-file cross-function dependency + module-level side effect) each handled and verified to the extent this sandbox allows, with limitations disclosed rather than hidden.

**Why This Is Better:** extends real, verified coverage while specifically seeking out files that exercise DIFFERENT conversion patterns than `dom.js`/`stat-bars.js` did (pure synchronous DOM mutation) — async timing, canvas/rendering, and cross-function module-internal calls are all real shapes the remaining 14 leaves and everything past them will need, so verifying the pattern works for each shape now is more valuable than converting five more files that all look like the first two.

**Remaining Technical Debt:**
- 14 more true leaves remain unconverted.
- `particles.js`'s canvas-rendering behavior specifically needs real-browser confirmation — flagged, not silently accepted as fully verified.
- None of the 5 converted files are wired into any shipping entry point yet.
- Smoke suite still not re-run since session 7 — now six sessions and several real conversions behind, the standing recommendation from sessions 8-11 applies more than ever.

**CI Gate Added:** none yet (unchanged).

**Verification:** all three files: declared-vs-exported symbol count matched exactly (1/1, 1/1, 2/2). Real Node ESM `import()` succeeded for all three, including confirming `button-loading.js`'s module-top-level style injection actually fires. `npx esbuild --bundle --format=esm`: clean for all three. `md5sum` before/after: all three originals unchanged. `node --check` on all three originals: still valid classic scripts. Equivalence checks: `sequence.js` — real timer-driven execution order plus confirmed working `cancel()`; `particles.js` — guard clauses and canvas creation/dimensions verified identical, rendering gap explicitly disclosed; `button-loading.js` — double-on guard, never-loading no-op, null-button guard, and success/error paths through `eqWithButtonLoading` all byte-identical. `node build/concat.js` + `node --check`: legacy build clean, unaffected. `node --test tests/unit/**/*.test.js`: 185/185, unaffected. All 5 bridge equivalence checks (including the two from prior sessions) re-run together as a full regression sweep: all PASSED.

### Phase 7 — Module System / Build Tooling (session 13: two more conversions — supabase-client.js, quest-mascot-lines.js — clears every fan-in ≥ 1 leaf)
**Date:** 2026-08-10 (session 13)

**Problem:** continuing step 5.3, converting the two remaining fan-in-1 leaves.

**What this session did:** converted `supabase-client.js` and `modules/quest-mascot-lines.js`, bringing the total to 7 of 19. Same full verification chain as every prior session (original untouched/checksum-verified, export count matches declares count, real Node ESM import, real esbuild bundle, bridge module, real jsdom behavioral equivalence check).

**Two new patterns handled:**
1. **`supabase-client.js`** is consumed elsewhere as a namespace object (`SupabaseClient.getClient()`), not individual function imports — the export shape matches that exactly (one named export, an object with 2 methods). The equivalence check exercised three real behaviors: the no-config/no-CDN fallback (`getClient()` → `null`), a stubbed-CDN configured path (no real network needed, just a fake `window.supabase.createClient`), and — the part that actually matters for something calling itself a "lazy singleton" — confirmed `createClient` is invoked exactly once despite `getClient()` being called twice, with both calls returning the identical object reference.
2. **`quest-mascot-lines.js`** has 6 declarations (3 constants, 3 functions) with internal cross-references (`eqMascotLine` calls `eqMascotLinePool`, both now real exports of the same module) and one function (`eqMascotLine`) driven by `Math.random()`. The equivalence check exhaustively exercised `eqMascotEmotionFor` across all 9 real trigger-table events — not a sample — plus the custom-admin-lines layering (confirmed default lines plus admin lines, blanks filtered, in the right order) and stubbed `Math.random()` to a fixed sequence so `eqMascotLine`'s actual pool-index math could be verified for real, not just "returns a string of the right shape."

**Test-tooling issue found and fixed, same root cause twice:** `assert.deepStrictEqual` failed on both files' equivalence checks even though the printed "actual" and "expected" values were visually identical — traced to a real but benign gotcha: objects/arrays constructed inside a jsdom vm-context realm have a different `Object.prototype`/`Array.prototype` than Node's native ones, which `deepStrictEqual` treats as non-equal regardless of content. Confirmed by inspecting the failure output (genuinely identical-looking) before concluding it wasn't a real behavioral difference, not assumed. Fixed both checks by comparing via `JSON.stringify`/`JSON.parse` instead, which sidesteps cross-realm prototype identity. Recognized immediately on the second occurrence rather than re-investigated from scratch.

**Files Changed:**
- New: `src/supabase-client.js`, `src/quest-mascot-lines.js` — real ESM conversions.
- New: `build/bridges/{supabase-client,quest-mascot-lines}.bridge.js` + bundled `dist/bridges/` outputs.
- New: `build/verify-{supabase-client,quest-mascot-lines}-bridge.js` — equivalence checks.
- Two originals (`supabase-client.js`, `modules/quest-mascot-lines.js`): unchanged, checksum-verified.
- `PHASE7_SRC_CONVERSION_TRACKER.md`: status table updated, 7/19 true leaves converted — this clears every leaf with fan-in ≥ 1; all remaining unconverted leaves have fan-in 0 (nothing currently depends on them).

**Architecture Before/After:** Before: 5 files converted. After: 7 — every leaf with a real consumer elsewhere in the codebase is now converted and bridge-verified.

**Why This Is Better:** clears the highest-value remaining conversions (anything anyone else actually depends on) before moving to the fan-in-0 leaves, which are lower-priority by definition — nothing else needs them yet, so converting them mainly sets up for later role-split/entry-point work rather than unblocking anything today.

**Remaining Technical Debt:** 12 more true leaves remain, all fan-in 0 — mostly the `*_index.js` aggregator files identified in sessions 9-10's role-split work (`modules/leaderboard/index.js`, `modules/recitation/recitation_index.js`, `modules/attendance/att_index.js`, `modules/boss-studio/bs_index.js`, `modules/world-boss/index.js`, `modules/admin/index.js`) plus a handful of others (`index.html#inline0`, `modules/core/active-section.js`, `modules/shared/quick-jump.js`, `modules/leaderboard/hall-of-fame-styles.js`). None of the 7 converted files are wired into any shipping entry point yet. Smoke suite still not re-run since session 7.

**CI Gate Added:** none yet (unchanged).

**Verification:** both files: declared-vs-exported symbol count matched exactly (1/1, 6/6). Real Node ESM `import()` succeeded for both. `npx esbuild --bundle --format=esm`: clean for both. `md5sum` before/after: both originals unchanged. Equivalence checks: `supabase-client.js` — fallback path, configured path, and singleton-caching (call count + reference identity) all confirmed; `quest-mascot-lines.js` — all 9 real events' emotion mapping, custom-line layering, and seeded-random pool-picking all confirmed. `node build/concat.js` + `node --check`: legacy build clean, unaffected. `node --test tests/unit/**/*.test.js`: 185/185, unaffected. All 7 bridge equivalence checks re-run together as a full regression sweep: all PASSED.

### Phase 7 — Module System / Build Tooling (session 14: three more conversions — ambient-backdrop.js, active-section.js, quick-jump.js — crosses the halfway point)
**Date:** 2026-08-10 (session 14)

**Problem:** continuing step 5.3. Session 13's tracker update missed one remaining fan-in-1 leaf (`ambient-backdrop.js`) in its "clears every leaf with fan-in ≥ 1" claim — caught by re-running the dependency map fresh at the start of this session rather than trusting the prior session's cached list.

**What this session did:** converted `modules/shared/ambient-backdrop.js` (fan-in 1, closing the gap from session 13), then `modules/core/active-section.js` and `modules/shared/quick-jump.js` (both fan-in 0, the highest-value remaining leaves) — bringing the total to 10 of 19, crossing the halfway point. Same full verification chain as every prior session throughout.

**Three different patterns, each verified for what it actually does:**
1. **`ambient-backdrop.js`** — same canvas-rendering limitation as `particles.js` (session 12), but more immediate: `tick()` runs synchronously on the very first call rather than deferred behind `requestAnimationFrame`, so only the two guard-clause paths (null canvas, reduced motion) are exercisable in this sandbox. Both confirmed byte-identical; the limitation is stated in the file's own header comment, not just the verification script's.
2. **`active-section.js`** — first conversion touching `localStorage` and cross-tab `storage` events. Real browsers fire `storage` events automatically in *other* open tabs; jsdom doesn't simulate that across separate instances (a browser-level mechanism, not a jsdom feature). Worked around by manually dispatching a `StorageEvent` on the window to exercise the module's actual registered handler directly — confirmed it correctly reacts to the right key and ignores unrelated ones, which tests the real code path without needing jsdom to fake real cross-tab behavior it can't provide anyway. Also verified: same-value `set()` doesn't re-fire listeners (a real guard in the source, `prev !== classId`), `set(null)` is a no-op, and `initFromURL` respects an already-chosen section rather than overriding it from the URL.
3. **`quick-jump.js`** — fully testable in jsdom, no external dependencies. Verified the missing-DOM no-op guard, Ctrl+K opening the overlay, live filtering, Escape closing it, and click delegation correctly invoking a result's action.

**Files Changed:**
- New: `src/ambient-backdrop.js`, `src/active-section.js`, `src/quick-jump.js` — real ESM conversions.
- New: `build/bridges/{ambient-backdrop,active-section,quick-jump}.bridge.js` + bundled `dist/bridges/` outputs.
- New: `build/verify-{ambient-backdrop,active-section,quick-jump}-bridge.js` — equivalence checks.
- Three originals: unchanged, checksum-verified.
- `PHASE7_SRC_CONVERSION_TRACKER.md`: status table updated, 10/19 true leaves converted; corrected the prior session's "clears every fan-in ≥ 1 leaf" claim now that `ambient-backdrop.js` is actually done.

**Architecture Before/After:** Before: 7 files converted. After: 10 — past the halfway mark for step 5.3's leaf-conversion work.

**Why This Is Better:** each of the three files this session exercised a genuinely different verification challenge (immediate-vs-deferred canvas rendering, cross-tab browser mechanisms jsdom can't replicate, and a fully-testable interactive UI component) — continuing to seek out different shapes rather than converting whatever's next alphabetically keeps building real confidence in the pattern's robustness across the kinds of code the remaining 9 leaves and everything past them will include.

**Remaining Technical Debt:** 9 more true leaves remain, all fan-in 0 — `index.html#inline0`, `modules/leaderboard/hall-of-fame-styles.js` (665 lines, the largest remaining leaf, deliberately deferred to its own session), and six `*_index.js` aggregator sinks from sessions 9-10's role-split work. None of the 10 converted files are wired into any shipping entry point yet. Smoke suite still not re-run since session 7.

**CI Gate Added:** none yet (unchanged).

**Verification:** all three files: declared-vs-exported symbol count matched exactly (1/1 each). Real Node ESM `import()` succeeded where applicable. `npx esbuild --bundle --format=esm`: clean for all three. `md5sum` before/after: all three originals unchanged. Equivalence checks: `ambient-backdrop.js` — both guard paths confirmed, canvas-rendering gap disclosed; `active-section.js` — get/set/onChange, same-value no-re-fire guard, null-set no-op, simulated cross-tab storage event (correct key reacts, wrong key ignored), and both `initFromURL` cases (first-use pickup, already-set override-prevention); `quick-jump.js` — no-op guard, open/filter/close/click-delegation all confirmed. `node build/concat.js` + `node --check`: legacy build clean, unaffected. `node --test tests/unit/**/*.test.js`: 185/185, unaffected. All 10 bridge equivalence checks re-run together as a full regression sweep: all PASSED.

### Phase 7 — Module System / Build Tooling (session 15: three more conversions — config.js, recitation-index.js, attendance-index.js — 13/19 leaves, self-correction along the way)
**Date:** 2026-08-10 (session 15)

**Problem:** continuing step 5.3. This session specifically targeted the remaining small leaves before the two larger ones (`hall-of-fame-styles.js` at 665 lines, `bs_index.js` at 345 lines), and the first real instances of this codebase's `*_index.js` aggregator/verification-sink pattern (identified as graph sinks in sessions 9-10's role-split work).

**What this session did:** converted `index.html#inline0` (→ `src/config.js`), `modules/recitation/recitation_index.js` (→ `src/recitation-index.js`), and `modules/attendance/att_index.js` (→ `src/attendance-index.js`) — bringing the total to 13 of 19.

**Two new patterns:**
1. **`config.js`** — first conversion with no functions at all, just two Supabase config constants. The bridge deliberately reuses the exact `window.__EDUQUEST_SUPABASE_URL__`/`__ANON_KEY__` names `supabase-client.js` (session 13) already reads, rather than introducing a second naming convention for the same values.
2. **`recitation-index.js`/`attendance-index.js`** — the first `*_index.js` aggregator/verification-sink conversions. These have no real function exports in the original — just a version-stamp constant and inline load-order verification logic (`typeof window[name] !== 'function'` checks, logging success or listing exactly what's missing).

**Self-correction caught mid-conversion, not after:** the first draft of `recitation-index.js` extracted its verification logic into a second export (`verifyExports`) for reusability — a reasonable-looking improvement. Caught before finalizing that this broke the "declared-count matches exported-count exactly" discipline every one of the prior 10 conversions held to (original declares 1 symbol; the draft would have exported 2). Reverted to keep the verification logic inline, matching the original's real shape. Worth logging explicitly rather than silently fixing, since it's exactly the kind of small drift that compounds if not caught early and consistently.

**`attendance-index.js`'s equivalence check specifically targeted its one real variation** from `recitation-index.js`'s pattern: it also checks `typeof window.AttendanceService !== 'object'`, not just function presence. Tested across three real conditions (nothing present, functions present but the service object missing, everything present) to confirm that branch fires correctly on its own — not assumed to work just because the surrounding file looks similar to the one already verified.

**Files Changed:**
- New: `src/config.js`, `src/recitation-index.js`, `src/attendance-index.js` — real ESM conversions.
- New: `build/bridges/{config,recitation-index,attendance-index}.bridge.js` + bundled `dist/bridges/` outputs.
- New: `build/verify-{config,recitation-index,attendance-index}-bridge.js` — equivalence checks.
- Three originals (`build/inline/inline0.js` representing `index.html`'s actual inline block, `modules/recitation/recitation_index.js`, `modules/attendance/att_index.js`): unchanged, checksum-verified.
- `PHASE7_SRC_CONVERSION_TRACKER.md`: status table updated, 13/19 true leaves converted; the `recitation-index.js` self-correction documented in its own row, not just this log entry.

**Architecture Before/After:** Before: 10 files converted. After: 13 — including the phase's first pure-config conversion and first two aggregator-sink conversions, both new shapes relative to everything converted in sessions 5-14.

**Why This Is Better:** proves the conversion pattern holds for config-only files and verification-sink files, not just files with real exported functions — meaningfully de-risks the remaining 6 leaves, 4 of which are the same aggregator-sink shape. The caught self-correction is itself a small but real demonstration that the "match declared/exported count exactly" discipline is being actively enforced each time, not just claimed.

**Remaining Technical Debt:** 6 more true leaves remain, all fan-in 0 — `modules/leaderboard/hall-of-fame-styles.js` (665 lines) and four more `*_index.js` aggregators (`modules/leaderboard/index.js`, `modules/boss-studio/bs_index.js` [345 lines], `modules/world-boss/index.js` [134 lines], `modules/admin/index.js`). None of the 13 converted files are wired into any shipping entry point yet. Smoke suite still not re-run since session 7.

**CI Gate Added:** none yet (unchanged).

**Verification:** all three files: declared-vs-exported symbol count matched exactly after the `recitation-index.js` correction (2/2, 1/1, 1/1). Real Node ESM `import()` succeeded for all three, including confirming the verification logic's console output fires correctly at import time. `npx esbuild --bundle --format=esm`: clean for all three. `md5sum` before/after: all three originals unchanged. Equivalence checks: `config.js` — exact value match, not just presence; `recitation-index.js` — both the missing-deps (error) and present-deps (success) real conditions confirmed identical; `attendance-index.js` — all three real conditions confirmed identical, specifically including the `AttendanceService` object-type branch in isolation. `node build/concat.js` + `node --check`: legacy build clean, unaffected. `node --test tests/unit/**/*.test.js`: 185/185, unaffected. All 13 bridge equivalence checks re-run together as a full regression sweep: all PASSED.

### Phase 7 — Module System / Build Tooling (session 16: leaderboard/index.js — 14/19 leaves)
**Date:** 2026-08-10 (session 16)

**Problem:** continuing step 5.3, the third `*_index.js` aggregator-sink conversion.

**What this session did:** converted `modules/leaderboard/index.js` → `src/leaderboard-index.js`, bringing the total to 14 of 19. Same aggregator-sink shape as sessions 15's two conversions, with one real variation worth handling deliberately: a `window.Leaderboard = window.EQL` convenience alias, guarded so it never overrides an already-set value (`if (!window.Leaderboard) { ... }`).

**Decision made and disclosed, not silently applied:** checked directly whether anything else in the codebase actually consumes `window.Leaderboard` — nothing does. Exported it anyway, matching this phase's "declared count = exported count" discipline held across all 13 prior conversions, rather than quietly dropping a symbol because it looks unused today. `window.EQL` itself is read via a real `window.` property access, not a bare identifier — confirmed this is safe under real module scoping regardless of whether `eql-engine.js` (which sets `window.EQL`) has its own `src/` conversion yet, since `window` is always the real global object no matter how a file is scoped.

**Equivalence check specifically targeted the alias guard**, not just the verification-logging pattern already covered by the prior two aggregator conversions: tested three real conditions — dependencies missing, dependencies present with no pre-existing `window.Leaderboard`, and dependencies present with `window.Leaderboard` already set to something else — confirming the guard preserves the pre-existing value rather than overwriting it, through the full bridge chain (module guard → export → bridge re-assignment), not just the module in isolation.

**Same cross-realm `assert.deepStrictEqual` gotcha hit a third time** (an object containing a function, created inside jsdom's vm-context realm, failed strict-equality comparison against a content-identical object despite matching output) — recognized immediately from the two prior occurrences (sessions 13, 15) and fixed the same way: compare a realm-safe derived value (a boolean reference check) instead of the raw cross-realm object.

**Files Changed:**
- New: `src/leaderboard-index.js` — real ESM conversion.
- New: `build/bridges/leaderboard-index.bridge.js` + bundled `dist/bridges/` output.
- New: `build/verify-leaderboard-index-bridge.js` — equivalence check.
- `modules/leaderboard/index.js` (original): unchanged, checksum-verified.
- `PHASE7_SRC_CONVERSION_TRACKER.md`: status table updated, 14/19 true leaves converted.

**Architecture Before/After:** Before: 13 files converted. After: 14 — including the first conversion with a genuine "alias one global to another, guarded" pattern, verified end to end rather than assumed safe because the surrounding aggregator-sink shape matched two already-verified files.

**Why This Is Better:** the alias-guard verification specifically protects against a real regression class — a naive conversion could easily have turned the guarded assignment into an unconditional one during the "clean up while I'm in here" temptation, which would silently change behavior for any future code that sets `window.Leaderboard` before this module runs. Testing it explicitly, rather than trusting it by inspection, is the same discipline this whole phase has applied to catch exactly this kind of subtle drift.

**Remaining Technical Debt:** 5 more true leaves remain, all fan-in 0 — `modules/leaderboard/hall-of-fame-styles.js` (665 lines) and three more `*_index.js` aggregators (`modules/boss-studio/bs_index.js` [345 lines], `modules/world-boss/index.js` [134 lines], `modules/admin/index.js`). None of the 14 converted files are wired into any shipping entry point yet. Smoke suite still not re-run since session 7.

**CI Gate Added:** none yet (unchanged).

**Verification:** declared-vs-exported symbol count matched exactly (2/2). Real Node ESM `import()` succeeded, confirmed the `Leaderboard` export correctly resolves to the `window.EQL` reference. `npx esbuild --bundle --format=esm`: clean. `md5sum` before/after: original unchanged. Equivalence check: missing-deps, present-deps-no-prior-alias, and present-deps-with-prior-alias all confirmed identical between original and bridge, with the guard behavior specifically isolated and verified in the third case. `node build/concat.js` + `node --check`: legacy build clean, unaffected. `node --test tests/unit/**/*.test.js`: 185/185, unaffected. All 14 bridge equivalence checks re-run together as a full regression sweep: all PASSED.

### Phase 7 — Module System / Build Tooling (session 17: final four conversions — admin-index.js, world-boss-index.js, boss-studio-index.js, hall-of-fame-styles.js — ALL 19 ORIGINAL LEAVES COMPLETE)
**Date:** 2026-08-10 (session 17)

**Problem:** completing step 5.3's leaf-conversion work — the final four files from `PHASE7_DEPENDENCY_MAP.md`'s original 19-leaf candidate list, including the two largest remaining conversions in the whole phase.

**What this session did:** converted `modules/admin/index.js`, `modules/world-boss/index.js`, `modules/boss-studio/bs_index.js` (345 lines — the largest conversion in the phase), and `modules/leaderboard/hall-of-fame-styles.js` (665 lines — the 19th and final leaf). **All 19 originally-identified true leaves are now converted, bridged, and verified.**

**Four more real variations found and handled precisely, not glossed over:**
1. **`admin-index.js`** — the largest verification list yet (63 expected functions). The file's own header comment claimed "60" — found to be wrong by 3 while writing the equivalence check, not assumed correct just because it was already there. Equivalence check added a case none of the smaller aggregators needed: exactly half the functions present, confirming the logged missing-list is the *precise* absent subset, not just "some nonempty list."
2. **`world-boss-index.js`** — a third distinct verification shape: `typeof window[sym] === 'undefined'`, which accepts *any* defined value (object, string, function), unlike every other aggregator's function-only check. Preserved exactly rather than silently normalized to match the others' pattern — confirmed by specifically setting every required symbol to a non-function object and verifying the check still reports success, the precise behavior that a careless "consistency cleanup" during conversion could have broken.
3. **`boss-studio-index.js`** — the largest and most structurally complex file converted this phase: 3 separate IIFEs (a 250+ line inline CSS injection, a DOM scaffold injection for the boss editor overlay, and a *fourth* distinct verification variant — `!== 'function' && !== 'object'`, accepting either). Generated **programmatically** from the original source rather than hand-retyped, specifically to eliminate transcription risk in the large template literals — verified byte-identical to the original except the one intentional change (version stamp → exported constant) via direct string comparison, not visual inspection. Equivalence check covered CSS injection idempotency, DOM scaffold idempotency (both re-evaluated a second time to confirm no duplication), and the function-OR-object check in all three real shapes.
4. **`hall-of-fame-styles.js`** — the simplest conversion in the entire phase: zero declared symbols, pure static CSS, no exports, bridge is a bare side-effect import. One thing checked rather than assumed: confirmed via grep that this file, unlike every guarded aggregator, has **no idempotency guard at all** — then verified the equivalence check preserves that real (slightly quirky) behavior exactly, rather than silently "fixing" it into a guarded version during conversion.

**Files Changed:**
- New: `src/admin-index.js`, `src/world-boss-index.js`, `src/boss-studio-index.js`, `src/hall-of-fame-styles.js` — real ESM conversions.
- New: `build/bridges/{admin-index,world-boss-index,boss-studio-index,hall-of-fame-styles}.bridge.js` + bundled `dist/bridges/` outputs.
- New: `build/verify-{admin-index,world-boss-index,boss-studio-index,hall-of-fame-styles}-bridge.js` — equivalence checks.
- Four originals: unchanged, checksum-verified (`boss-studio-index.js`'s and `hall-of-fame-styles.js`'s conversions additionally verified byte-identical to their originals via direct string comparison of the untouched portions, given their size).
- `PHASE7_SRC_CONVERSION_TRACKER.md`: status table completed — 19/19 true leaves converted — with a summary section stating plainly what this milestone does and does not mean for the rest of the phase.

**Architecture Before/After:** Before: 14 of 19 leaves converted. After: all 19 — every file in the codebase with zero outgoing dependencies now has a verified real-ESM twin.

**Why This Is Better:** completes the lowest-risk, highest-confidence tier of step 5.3 in full, with each of the phase's distinct structural patterns (async timing, canvas rendering, cross-tab events, config-only files, four different aggregator-verification shapes, a fully side-effect-only file) now proven to survive real conversion, not just assumed to generalize from the first couple of examples. This is real groundwork for the harder work ahead — files that depend on OTHER not-yet-converted files — since every pattern that pure leaves could exercise now has a working, verified precedent to build on.

**Remaining Technical Debt, stated plainly rather than left implicit:**
- None of the 19 converted files are wired into `index.html` or any shipping entry point — per Principle 8, only the single deliberate cutover event does that, and this phase isn't there yet.
- The vast majority of the codebase (117 of 136 total units) has fan-out > 0 — these are NOT leaves, and converting them requires the harder problem of a file depending on other, still-unconverted files, which hasn't been attempted yet. 19/136 converted is real progress on the easiest tier, not 19/136 of the way through the phase's hardest work.
- Sessions 9-10's per-role bundling has a documented aggregator-sink limitation involving two of the files converted this exact session (`bs_index.js`, `admin/index.js`'s siblings) — converting them to `src/` doesn't automatically resolve that limitation, since it's a role-split closure-computation issue, a separate tool that would need re-running to see if anything changed.
- Steps 5.5 (build-time lint gates) and 5.6 (dead-code/duplicate-symbol CI check) haven't started.
- Smoke suite still not re-run since session 7 — now ten sessions and nineteen real conversions behind. The recommendation from every session since 8 stands, more so now.

**CI Gate Added:** none yet (unchanged).

**Verification:** all four files: declared-vs-exported symbol count matched exactly (3/3, 2/2, 1/1, 0/0). Real Node ESM `import()` succeeded for all four. `npx esbuild --bundle --format=esm`: clean for all four. `md5sum` before/after: all four originals unchanged; `boss-studio-index.js` and `hall-of-fame-styles.js` additionally confirmed byte-identical to their originals (minus the one intentional change) via direct programmatic string comparison, not visual inspection, given their size. Equivalence checks: `admin-index.js` — nothing/everything/exactly-half-present, missing-list precision confirmed; `world-boss-index.js` — the undefined-only check specifically confirmed to accept non-function values; `boss-studio-index.js` — CSS/DOM injection idempotency across re-evaluation, function-OR-object check in all three shapes; `hall-of-fame-styles.js` — content completeness and the real unguarded re-evaluation behavior preserved exactly. `node build/concat.js` + `node --check`: legacy build clean, unaffected. `node --test tests/unit/**/*.test.js`: 185/185, unaffected. All 19 bridge equivalence checks re-run together as one full regression sweep: all PASSED.

### Phase 7 — Module System / Build Tooling (session 18: first non-leaf conversion — utils.js — plus a self-caught documentation-consistency mistake)
**Date:** 2026-08-10 (session 18)

**Problem:** with all 19 original leaves converted (session 17), the next tier is files that depend on other, not-yet-converted files — flagged as unstarted at the end of session 17.

**What this session did:** converted `utils.js` — the first file with a real dependency on an already-converted `src/` file, not a pure leaf. Selected via the dependency graph: fan-out 1 (single dependency, `dom.js`, already converted), fan-in 72 (second-highest in the entire codebase).

**Real difference from every prior conversion:** `csvDownload()` calls `toast()`, which is `src/dom.js`'s real export (session 6). `src/utils.js` uses a genuine `import { toast } from './dom.js';` — an actual module-graph edge between two `src/` files, confirmed via the bundled output that `toast`'s function body is really pulled in by esbuild's resolution, not just referenced hopefully.

**Real sandbox gap found and worked around, not skipped:** `csvDownload()` also calls `URL.createObjectURL()`, which jsdom doesn't implement (confirmed: `Blob` itself works fine in this sandbox, only `createObjectURL`/`revokeObjectURL` are missing — a narrower, two-line-stub-away gap than sessions 12/14's un-work-aroundable canvas limitation). Added a minimal standard stub in the test harness only, not touching any source file, so `csvDownload`'s real behavior — including confirming its internal `toast()` call actually fires with the correct content — could be verified end to end rather than settling for guard-clause-only coverage.

**Self-caught mistake, fixed before moving on:** the first `str_replace` updating `PHASE7_SRC_CONVERSION_TRACKER.md` for this session's work accidentally consumed the session 17 milestone section's header and the session 8 section's header as anchor text without preserving them in the replacement — leaving the "all 19 leaves" summary paragraph orphaned without its own heading, in the wrong chronological position relative to session 18's new content, and the "Full real bundle — proven, session 8" section similarly headerless. Caught by re-reading the document's full header list after the edit rather than assuming the edit landed cleanly, and fixed with two follow-up corrections restoring both headers and the correct chronological order. Documented here rather than silently re-edited and left unremarked, consistent with this whole phase's treatment of caught mistakes as worth logging, not just fixing quietly.

**Files Changed:**
- New: `src/utils.js` — real ESM conversion, first with a genuine cross-`src/` import.
- New: `build/bridges/utils.bridge.js` + bundled `dist/bridges/` output.
- New: `build/verify-utils-bridge.js` — equivalence check, including the `URL.createObjectURL`/`revokeObjectURL` test-harness stub.
- `utils.js` (original): unchanged, checksum-verified.
- `PHASE7_SRC_CONVERSION_TRACKER.md`: new session 18 section documenting the non-leaf conversion; session 17's milestone section and session 8's bundle section both repaired after the mid-edit mistake described above.

**Architecture Before/After:** Before: 19 files converted, all leaves (zero real cross-file dependencies). After: 20 — the first with a genuine dependency on another already-converted file, proving the module-graph-edge mechanism this whole phase has been building toward actually works when exercised for real, not just in the abstract.

**Why This Is Better:** `utils.js` was deliberately chosen as the simplest possible instance of the harder tier (exactly one dependency, already converted) rather than jumping to a more complex multi-dependency file — same incremental-difficulty discipline used throughout step 5.3's leaf conversions, now applied to the next tier of difficulty.

**Remaining Technical Debt:** 117 non-leaf units remain, the actual bulk of the phase's remaining conversion work — 20 of 136 total units converted is not 20/136 of the way through in difficulty terms, since every remaining file requires the same harder-tier real-import handling `utils.js` just proved out, often with more than one dependency. Steps 5.4 (per-role bundling refinement), 5.5 (lint gates), 5.6 (CI) unchanged from session 17. Smoke suite still not re-run since session 7 — now eleven sessions and twenty real conversions behind.

**CI Gate Added:** none yet (unchanged).

**Verification:** declared-vs-exported symbol count matched exactly (7/7). Real Node ESM `import()` succeeded; confirmed via the bundled esbuild output that `toast`'s implementation is genuinely pulled in through the real import, not merely referenced. `npx esbuild --bundle --format=esm`: clean. `md5sum` before/after: original unchanged. Equivalence check: `uid`/`_esc`/`_cssColor`/`todayStr`/`nowStr`/`isoDate` all confirmed correct (including `_cssColor`'s attribute-breakout-hazard fallback case), and `csvDownload`'s real end-to-end behavior confirmed via a minimal jsdom stub — specifically confirming its internal `toast()` call fires with the exact expected content, proving the cross-module import chain works in practice, not just in the bundle output. `node build/concat.js` + `node --check`: legacy build clean, unaffected. `node --test tests/unit/**/*.test.js`: 185/185, unaffected. All 20 bridge equivalence checks re-run together as one full regression sweep: all PASSED. `PHASE7_SRC_CONVERSION_TRACKER.md`'s header structure re-verified via `grep -n "^## "` after the documentation-consistency fix, confirming all sections present and in correct order before considering the session complete.
