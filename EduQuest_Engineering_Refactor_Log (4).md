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
| 4 — Event-Driven Communication | Not started |
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
