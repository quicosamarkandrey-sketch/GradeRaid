# EduQuest — Continuation Plan: Event-Driven Communication (Phase 4) & Beyond

**Author's role note:** written as the senior engineer who did the work this plan covers. Where I'm confident, I say so plainly. Where I'm not, I say that too — this document does not round up.

**Date:** 2026-08-01
**Status of this codebase as of writing:** `eslint .` → 0 errors, 466 warnings. `node --test tests/unit/**/*.test.js` → 56/56 passing. **No part of this codebase has ever been executed in a real browser or against a live Supabase project this entire engagement.** That is the single most important line in this document — see §5.

---

## 1. Where things actually stand

### 1.1 Fully complete, verified to the extent possible without live execution
- **Tier 1** (dead code, duplicate functions, CI-gate fix) — done in an earlier session, not re-verified here.
- **Tier 2** (innerHTML/CSS-injection audit across all directories, the `toast()` sweep, the RLS policy review) — done. See the main engineering log for the full breakdown.
- **Phase 3 tail** (the `DB.*` → `AppStore.updateState()` migration on `utils.js`, `index.html`, `modules/admin/student-manager.js`, `modules/admin/registrations.js`, `modules/admin/quiz-builder.js`) — done. This is what the original `EduQuest_Phase4_Handoff.md` scoped as "Phase 4," but per the codebase's own canonical numbering (`EduQuest_Engineering_Refactor_Log (4).md`), it was actually finishing Phase 3.
- **Phase 4 — Event-Driven Communication, the 5 target functions from `Phase_4_Event_Driven_Communication.md`** (`bootApp`, `finishQuiz`, `logAttendance`, `logRecitation`, `wbcApplyDamage`) — done. All converted to `AppStore.subscribe()`/`AppStore.emit()`. Two were found to be partially or fully dead code (see §4) and restored using real, live events rather than reconstructions of the original (already-broken) intent.
- **`renderStudentWorldBoss` investigation** — done, as a direct consequence of converting `wbcApplyDamage` uncovered a related dead-patch chain. Restored narrowly (see §4).

### 1.2 Explicitly not done, and not safe to do casually
- **The original Category A list from the classification pass (§3) is fully converted.** 2 deliberate exceptions remain, both documented, neither is debt: `renderAnalytics`'s confirmed-dead `shop_pos_terminal.js` block (left as documented dead code — see §3), and `enrollment-hub.js`'s `navTo` guard (Category C — can block navigation outright, which a subscriber structurally can't express — see the `navTo` row). 7 sites done since this plan was written: `setupSidebar`, `renderAdminAchievements`, `renderAnalytics` (the live `registrations.js` patch), `renderStudentDashboard`, `openBossForm` (all 3 of its sites), `navTo` (2 of its 3 found sites), `achCheckAndAward` (its 1 site) — all logged in `EduQuest_Engineering_Refactor_Log (4).md`, "Phase 4 (Continuation)" entries.
- **A confirmed-incomplete inventory** of monkey-patches beyond the original 21 — `renderStudentMail` alone was found using a syntax my search missed, and a second `renderAnalytics` patch site (`registrations.js`) was found the same way during the continuation work; there are almost certainly more.
- **Category B/C patterns** (6 sites confirmed architecturally incompatible with pub/sub, 2 confirmed needing base-function restructuring) — deliberately left as monkey-patches. Converting them would break working features. Do not "clean these up" without the same level of individual investigation this plan describes in §4.
- **Live/browser verification of anything done this entire engagement.** Every fix — from the Tier 2 escaping work through the wbcApplyDamage/renderStudentWorldBoss restoration and the continuation-phase conversions — is verified by static analysis (ESLint, `node --check`, manual code review) and, where practical, targeted `node:test` unit tests loading real source files into `jsdom`. Nothing has been clicked through in an actual browser against a real Supabase backend.

---

## 2. The methodology that got us here (use this, don't skip steps)

This is the actual process that found 3 separate dead-code bugs this session (`logAttendance`, half of `wbcApplyDamage`, most of `renderStudentWorldBoss`) that a faster, more mechanical approach would have missed or — worse — "fixed" incorrectly by faithfully converting dead code into live code that duplicates or conflicts with something else.

**For each patch site being converted:**

1. **Read the patch's actual code**, not just its name or a comment describing it. Comments in this codebase are frequently stale — several times this session a comment confidently described behavior the code no longer had.
2. **Classify the shape**, before assuming it fits the "post-hook, react-after" pub/sub pattern:
   - **Post-hook, void return** (calls original, then reacts, doesn't touch the return value) → straightforwardly convertible.
   - **Return-value decoration** (modifies or replaces what the original returns) → **not convertible** — pub/sub subscribers can't inject content back into a function's return value. Leave as a monkey-patch, or design a proper composition/hook-registry pattern as separate, deliberate work — do not attempt to shoehorn this into `AppStore.subscribe()`.
   - **Pre-hook** (runs something *before* the original, possibly to set up state the original's own execution depends on) → **not convertible** via simple subscription. Needs the base function itself restructured, which is a bigger, riskier change requiring its own review.
   - **Full replacement / call-rescheduling** (doesn't call the original at all, or defers/reschedules when it runs) → **not convertible**. The point of the patch is to change *what* or *when* something runs, which is outside what a reactive subscriber can express.
3. **Trace the actual script load order in `index.html`** for every file touching the same function. Do not assume all patches of "the same function" share one shape or are all live — this session found multiple cases where they didn't. A later, non-chaining `window.fn = ...` assignment silently discards every earlier patch. This has now been found **three separate times** in this codebase (`wbcApplyDamage`, `renderStudentWorldBoss` — twice, actually, at two different points in its chain). Treat it as a real, recurring pattern in this specific codebase, not a one-off.
4. **Check every function the dead code called for other live callers** before restoring "the whole patch." In the `renderStudentWorldBoss` case, 3 of the 5 things a dead patch would have restored were already live through a completely different path (a different patch on `_wbcUpdateHPDisplay`, plus this session's own earlier `wbcApplyDamage` conversion). Restoring them again would have been redundant, not a fix. Only restore what a targeted caller-count check confirms is genuinely still missing.
5. **Check for a plausible superseding system** before assuming dead code represents a bug. `battle-overlay.js`'s two dead patches looked, at first, like a critical live gameplay bug (a full-screen battle view that could never trigger). A 10-minute check for alternate live call paths (`wbrOpenBattle`) found a completely independent, working mechanism that very likely superseded the dead one. Not every dead patch is a bug to fix — some are leftover debris from an architecture that already moved on. Restoring superseded code risks reintroducing conflicts with the system that replaced it.
6. **Convert, verify, test, in that order — never skip the verify step because a conversion "looks obviously right."** Minimum bar for every conversion:
   - `node --check` on every touched file (`index.html` isn't covered by ESLint — extract and check its inline `<script>` blocks separately).
   - `npx eslint .` — must stay at 0 errors repo-wide.
   - `node --test tests/unit/**/*.test.js` — must stay green.
   - Where the touched file can be loaded standalone in `jsdom` without hanging (check this first — some files have blocking intervals/timers that never resolve outside a real browser, and will hang your test run), write real tests against the actual source file, not a reimplementation. Where it can't be loaded standalone safely, say so explicitly in the summary rather than silently having thinner coverage than the rest.
7. **When a discovery changes the scope or risk of the work mid-task, stop and say so before continuing**, especially if continuing means either (a) inventing new architecture (like `AppStore.emit()`) or (b) restoring dead code that could be live-bug-fixing or could be resurrecting superseded cruft. Don't let momentum carry a "just keep converting" pass through a finding that actually changes the picture.

---

## 3. Remaining scope: the Category A sites

**Status as of 2026-08-03:** All 7 of the original rows below are done (marked ✅) — see `EduQuest_Engineering_Refactor_Log (4).md`'s "Phase 4 (Continuation)" entries for the full investigation and reasoning behind each. Rows are kept in this table even once done, so the per-site cautions stay attached to the record of what was actually checked. The Category A conversion effort this plan tracks is complete; see §5 for what's actually next.

From the classification pass, confirmed post-hook/void-return shape **at the time of classification** — but per §2.3, every one of these still needs its own load-order trace before conversion, because that's exactly the step that turned "13 easy sites" into "3 of them were dead and the investigation ate an entire session." Do not batch-convert these on the assumption that classification alone is enough.

| Function | File(s) | Notes before starting |
|---|---|---|
| ✅ `openBossForm` | `rage.js`, `skills.js`, `phases.js` | **Done.** 3 sites, all confirmed live and correctly chained (no dead patch found — the first Category A site this session where that's true). See `EduQuest_Engineering_Refactor_Log (4).md`'s "Phase 4 (Continuation)" entry for the DOM-ordering verification (rage.js's button placement depends on skills.js's, and that dependency was checked against both real and mocked timers before being asserted in a test). |
| ✅ `setupSidebar` | `shop_inventory.js` | **Done.** Single site, confirmed live, converted cleanly. |
| ✅ `navTo` | `reward-presenter.js`, `titles/titles_sidebar_refresh.js` | **Done** (2 of 2 listed sites converted). A 3rd, unlisted site was found while grepping every `window.navTo =` assignment before converting: `modules/enrollment/enrollment-hub.js`'s kiosk-lock guard — deliberately left as a monkey-patch (Category C, not A — it can block navigation outright, which a subscriber can't express). Base is `nav.js:139` (renamed to `_navToCore`, wrapped by a thin `window.navTo`). See `EduQuest_Engineering_Refactor_Log (4).md`'s "Phase 4 (Continuation)" entry. **Important (still relevant):** `navTo` itself internally dispatches to `renderStudentWorldBoss`, `renderAnalytics`, `renderAdminAchievements`, `renderStudentDashboard` — those were NOT consolidated into the new `nav:navigated` event; each already has its own separate event, called from many places besides `navTo`. |
| ✅ `renderAnalytics` | `shop_pos_terminal.js`, `modules/admin/registrations.js` | **Done — partially.** A 2nd, unlisted patch site (`registrations.js`) was found during conversion — the original classification missed it, same as `renderStudentMail`. That live patch was converted. `shop_pos_terminal.js`'s patch was confirmed **dead** (load-order trace) and strong evidence points to it being superseded by `_posAnalyticsHTML()`'s richer view — left unconverted and documented in place, not deleted; still an open human call. |
| ✅ `renderAdminAchievements` | `titles_admin_page.js` | **Done.** Single site, confirmed live, converted cleanly. |
| ✅ `renderStudentDashboard` | `titles/titles_sidebar_refresh.js` (the `modules/world-boss/` copy is the confirmed-dead duplicate file — do not convert that one, it never loads) | **Done.** Confirmed **dead** via load-order trace (script tag loads before the base function is defined) — the same silent-overwrite bug found in `wbcApplyDamage`/`renderStudentWorldBoss`, 4th instance. Converting it fixed a real (if minor) live gap: the equipped-title badge wasn't being restored after mail-reward-claim or achievement-claim popups closed. |
| ✅ `achCheckAndAward`-as-title-unlock-hook | `titles/titles_sidebar_refresh.js` | **Done.** 1 site, confirmed live, load order traced (`ach_engine.js:807` before `titles/titles_sidebar_refresh.js:817`). The "highest blast radius" concern was about caller *count* (~8 direct call sites app-wide), not conversion risk — since all of them call the single global `achCheckAndAward`, converting its one definition point covered every caller automatically. The real subtlety was a catch-up case the existing `achievements:unlocked` event doesn't cover — see `EduQuest_Engineering_Refactor_Log (4).md`'s "Phase 4 (Continuation)" entry for the full reasoning and the mid-edit mistake caught by `node --check` before it shipped. |

**Recommended order:** ~~`setupSidebar` and `renderAdminAchievements` first~~ — done. ~~`openBossForm` next~~ — done, no dead patches found. ~~`navTo` next~~ — done, 2 of 2 listed sites converted, plus a 3rd unlisted site found and correctly left unconverted (Category C). ~~`achCheckAndAward`-as-title-hook last~~ — done, no dead patches found, clean conversion. **The original Category A list from §3 is now fully worked through.** What remains is not a checklist item but the plan's own §5: nothing in this codebase has been exercised in a real browser or against a live Supabase project this entire engagement — every conversion above was verified via `node --check` + `eslint` + jsdom `node --test` only. Getting the Playwright smoke suite running against a real test/staging Supabase project is the highest-value next step, not another monkey-patch site.

**Do not treat this table as a checklist to clear in one sitting.** Budget roughly the same per-site time this session spent on `wbcApplyDamage`/`renderStudentWorldBoss` — those two "single function conversions" each turned into their own multi-step investigation. 5 of the 7 sites converted since this plan was written turned up something not in the original classification (a dead patch, a missed 2nd/3rd site, or both) — treat that as the norm, not the exception, for any similar conversion work in the future. `openBossForm` and `achCheckAndAward` were the two clean exceptions (all sites confirmed live, no surprises) — a reminder that "no findings" is a possible, verified outcome of doing the trace, not a sign the trace was skipped.

---

## 4. What was actually restored this session, and why each call was made

Kept here because the reasoning matters more than the diff for anyone continuing this work.

- **`logAttendance`** — confirmed fully dead (zero callers of the function, zero emitters of its event name anywhere in the codebase). Removed the dead patch. Then, on a follow-up request, restored the *intent* by wiring achievement checks onto the real live events (`attendance:scan-recorded`, `attendance:override`) rather than recreating the dead event name. Deliberately excluded `attendance:session-closed` (a bulk absence-sweep — can only decrease a presence-based stat, never newly cross an unlock threshold; wiring it in would be a guaranteed no-op).
- **`wbcApplyDamage`** — one of its two patches (`ach_engine.js`'s) was confirmed dead via script-load-order tracing (loaded before the base function existed, then silently overwritten). Restored using the real live events (`world-boss:damage-applied`, `world-boss:defeated`) the base function already emits. The other patch (`phases.js`'s) was live and got converted normally — this was also the one place the roadmap specifically flagged for ordering risk (branching on a wrapped call's return value), and converting to events resolved that risk rather than just relocating it.
- **`renderStudentWorldBoss`** — the deepest investigation. 5 of 6 things touching this function were dead (two separate silent-overwrite bugs). Of what those dead patches would have done, most was already covered live through other paths already in the codebase (a separate patch on `_wbcUpdateHPDisplay`, plus this session's own `wbcApplyDamage` conversion). Restored only the two pieces confirmed to have zero other live callers: the skill-cooldown loop and the phase-indicator DOM strip. Deliberately left `battle-overlay.js`'s two dead patches alone — strong evidence (`wbrOpenBattle`'s independent, working equivalent) that they're superseded, not broken.

**Pattern across all three:** never restore a dead patch's full original body on autopilot. Check what it actually still needs to do versus what's already covered, and check whether something else already replaced it.

---

## 5. The thing that matters more than any of the above: verification

Repeating this because it's the actual highest-priority item, not a footnote:

**Nothing in this codebase has been run in a browser this entire engagement.** Every verification claim in every session summary — including this one — means "static analysis and unit tests pass," not "confirmed working." For a production-facing student/teacher app, that gap matters more than whether 12 more monkey-patches get converted.

**Before doing meaningfully more feature-level work** (continuing §3, or anything beyond it), the highest-value next action is getting the Playwright smoke-test suite actually running — `.env.example` names the required vars (`EDUQUEST_TEST_STUDENT_EMAIL`/`PASSWORD`, `EDUQUEST_TEST_ADMIN_EMAIL`/`PASSWORD`) against a real test/staging Supabase project. Short of that, even a single manual click-through of a full quiz-completion flow and a full world-boss raid (the two highest-traffic, most-modified code paths this session) would surface issues static analysis structurally cannot.

**If continuation happens without that verification gap closing first**, at minimum: keep every session's changed-file list small and well-documented (as this session's log entries do), so that if something surfaces broken in production, there's a short, honest list of exactly what changed and why — not a sprawling diff across dozens of speculative "while I'm here" fixes.

---

## 6. Open items, unresolved, worth tracking

- **The 23-files-vs-actual-count discrepancy** in the original roadmap doc — resolved to a reasonable working theory (the 23 figure likely described the *total* monkey-patching problem, not just the 5 targeted functions), but not proven exactly, and the true total count is now known to be **higher** than 21 (confirmed via `renderStudentMail`'s missed syntax variant). Worth a dedicated, more exhaustive search if a future phase wants a truly complete inventory.
- **`db-service.js`, `db-migrations.js`, `db-schema.js`, `auth.js`** — established early this session as not needing the SSOT migration work the original handoff doc assumed they needed. Not re-checked since; should still be accurate, but flagging that this finding is now several sessions old.
- **CI gate for the monkey-patch pattern itself** — no ESLint rule currently flags `const _orig = window.X; window.X = function...`. Worth adding once the remaining live patches are converted, to prevent regression — noted in the Phase 4 log entry as a reasonable follow-up, not yet built.

---

## Appendix — Log entries added this session

The full engineering log is `EduQuest_Engineering_Refactor_Log (4).md` at the repo root — these entries were appended there in full during this session. Reproduced here for a self-contained record.

### Phase status table update
```
| 4 — Event-Driven Communication | Done — 5/5 target functions converted (bootApp, finishQuiz,
logAttendance, logRecitation, wbcApplyDamage); 2 previously-dead monkey-patches discovered and
their intent restored via real live events; AppStore.emit() added; 0 lint errors, 56/56 unit
tests. 13 files patching 21 other functions remain outside this phase's scope — see log entry. |
```

### Phase 4 — Event-Driven Communication (site: all 5 target functions)
**Date:** 2026-07-31

**Problem:** 5 global functions (`window.bootApp`, `window.finishQuiz`, `window.logAttendance`, `window.logRecitation`, `window.wbcApplyDamage`) were hooked by monkey-patching — capturing `_orig` and reassigning — across what the roadmap's Problem section counted as 23 files total.

**Root Cause:** Monkey-patching predates Phase 3 — before state mutations had a clean boundary (`AppStore.updateState()`), wrapping a global was the fastest way to bolt on cross-cutting behavior without editing the function directly.

**Files Changed:** `modules/core/state-manager.js` (added `AppStore.emit()`), `auth.js`, `modules/recitation/logger.js`, `modules/achievements/ach_engine.js`, `modules/world-boss/phases.js`, `modules/shared/reward-presenter.js`, `modules/world-boss/summon-notify.js`, `modules/titles/titles_sidebar_refresh.js`, `modules/shop/shop_inventory.js`, `modules/shop/shop_orders.js`, `index.html`, plus 4 new test files.

**Architecture Before:** 8 files chained `_orig`-capturing wrappers around 5 global functions. Two of those wrappers never actually ran.

**Architecture After:** Zero monkey-patches remain for the 5 target functions. `AppStore.subscribe()`/`AppStore.emit()` is the sole cross-module communication idiom for these triggers.

**Why This Is Better:** Each function's real behavior is readable in its own file again. The `wbcApplyDamage`/`phases.js` conversion eliminates a correctness hazard rather than relocating it. Both dead-patch discoveries were restored using real, current events rather than reconstructions of stale intent.

**Remaining Technical Debt:** 13 files patching 21 other functions remain unconverted, outside this phase's stated scope. See §3/§6 of this plan for the narrowed, re-verified subset actually worth continuing.

**CI Gate Added:** None yet — recommended follow-up in §6.

**Verification:** `node --check` on every modified file. `eslint .`: 0 errors. `node --test`: 56/56 passing.

---

*(The `renderStudentWorldBoss` investigation and restoration now has its own full log entry in `EduQuest_Engineering_Refactor_Log (4).md`, added alongside this plan. The Category A/B/C classification itself is recorded here in §3 rather than as a separate log entry, since it produced a plan rather than a completed change.)*
