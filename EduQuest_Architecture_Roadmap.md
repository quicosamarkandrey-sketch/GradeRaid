# EduQuest — Architectural Refactoring Roadmap
**Baseline:** `EduQuest_Production_Audit.md` (prior audit — grade D+, Production Readiness 3/10)
**Goal:** Transform EduQuest from a feature-rich prototype into a professionally engineered application that can support hundreds of teachers and thousands of students, without a rewrite and without breaking existing functionality.
**Status:** Planning — no code changed yet. This document is for your approval before Phase 0 begins.

---

## How this roadmap is built

Two constraints from your brief shape everything below, and they pull in opposite directions, so I want to name the tension up front rather than paper over it:

- **"Never introduce breaking changes"** — for a codebase with 1,000+ direct references to a global `DB` object, zero tests, and a load-order-dependent boot sequence, "never break it" is only possible if I can *detect* breakage. Right now nothing in this codebase can tell us that.
- **"Root-cause fixes, not bandaids"** — several of the audit's Critical findings (state management, whole-table sync) are root-cause problems in the true sense: fixing them properly requires touching code that currently has no safety net.

So **Phase 0 is not glamorous, and it is not optional.** It's the thing that makes every subsequent "root cause, not bandaid" phase actually safe to do incrementally. I'm not going to start moving 1,000 `DB.*` references around with nothing checking my work. That would be exactly the kind of confident-but-unverified change that produced the "whole-roster last-save-wins" bug your own SQL history already shows you finding the hard way once.

Every phase after that is ordered so that **each phase makes the next phase safer or easier**, never the reverse. I will not start a phase that depends on a later phase's outcome.

---

## Priority Matrix

| # | Phase | Severity (from audit) | Effort | Depends on | Breaking-change risk |
|---|---|---|---|---|---|
| 0 | Safety-net infrastructure (tests + lint gates) | Critical (enabling) | Medium | none | None — additive only |
| 1 | Delete dead code & consolidate duplicate utilities | Medium | Small | Phase 0 | Near-zero |
| 2 | Security hardening: escaping + authorization audit | Critical | Medium | Phase 0 | Low, if done as additive gates first |
| 3 | Single source of truth: complete the state-management migration | Critical | Large | Phase 0, 1 | Medium — mitigated by incremental module-by-module cutover |
| 4 | Event-driven communication: replace monkey-patching | High | Medium–Large | Phase 3 | Medium |
| 5 | Data layer redesign: Repository pattern + delta sync | Critical | Large | Phase 3 | Medium-High — highest-value, highest-care phase |
| 6 | Decompose god files/functions | High | Large (ongoing) | Phase 3, 4, 5 | Low, if done after 3–5 stabilize interfaces |
| 7 | Module system / build tooling (replace 117 script tags) | High | Large | Phase 6 | Medium — infrastructure change |
| 8 | Replace `setTimeout` sequencing with real async coordination | Medium | Medium | Phase 4 | Low |
| 9 | Scalability hardening (lazy loading by role, realtime scoping, pagination) | High | Medium | Phase 5, 7 | Low |
| 10 | CI enforcement (make every fixed problem stay fixed) | Medium (enabling) | Small | Phase 0–9 (grows with each) | None — additive only |

**Read this table as the execution order.** Nothing here is optional if the goal is "professionally engineered" rather than "patched again." But I've sized each phase so we can stop after any one of them and the codebase is strictly better off than before — no phase leaves things half-migrated the way `app-state.js` was left.

---

## Phase 0 — Safety-Net Infrastructure
**Priority: Critical (enabling). Effort: Medium.**

### Problem
There are zero automated tests anywhere in this codebase and no lint configuration. Every one of the documented bugfixes in your SQL/JS history (stale-tab XP clobbering, RLS gaps found four separate times, spurious sync failures) was caught manually — in QA or in production — not by a regression suite. That means every refactor phase below is currently "change code, hope nothing broke, find out from a teacher or student later."

### Why it exists
The app was built iteratively, feature-by-feature, under real time pressure, with manual testing as the only feedback loop available at the time. That's a normal way to get an MVP out the door. It's not a viable way to do the kind of large structural surgery this roadmap calls for.

### Principle violated
No verification/regression-safety layer — this isn't one of the audit's named categories on its own, but it's the precondition for safely fixing *every* category the audit did name.

### Best-practice solution
1. **Golden-path smoke tests first, not unit-test purity.** Before touching architecture, write a small number of high-value end-to-end tests covering the flows most likely to break during refactoring: login → boot → dashboard render (student and admin), XP/coin award round-trip, a shop purchase, an achievement unlock, a boss-damage submission. These are the flows the audit flagged as having already had real data-corruption bugs — they're the ones that most need a tripwire.
2. **A lightweight test runner that doesn't require a build step**, so we're not forced into Phase 7 (module system) before Phase 0. Something like Playwright (drives the real `index.html` in a real browser context, which matches this codebase's actual execution model — global scripts, load order and all) for the smoke tests, plus a minimal Node+jsdom harness for pure-logic functions as they get extracted in later phases.
3. **A lint config** (ESLint, flat config) with a *small* starting rule set aimed directly at audit findings: no duplicate top-level function declarations across files, no `innerHTML` assignment without going through the shared escape helper (see Phase 2), no direct `DB.*` mutation outside `AppStore` (as a warning initially, error once Phase 3 lands). This turns several "I found this by manual grep" audit findings into things CI finds automatically from now on.

### Risks
- Writing smoke tests against the *current* architecture means some of that test setup (e.g., working around the load-order dependency) will itself become obsolete after Phase 7. That's fine — it's a small, cheap cost, and the alternative (no tests until after the architecture is fixed) is circular and unsafe.
- False sense of security if we stop at 5–6 smoke tests and consider it "done." I'll treat Phase 0 as a floor, not a ceiling — coverage should grow alongside every later phase, not be a one-time task.

### Deliverable
Test harness + 6–10 smoke tests covering the highest-risk flows + initial lint config, all passing against the current, unmodified codebase, committed before any Phase 1 change lands.

---

## Phase 1 — Delete Dead Code & Consolidate Duplicate Utilities
**Priority: Medium. Effort: Small.**

### Problem
`analytics.js` (root-level) is a fully orphaned duplicate of `modules/admin/analytics.js`, never loaded, sitting in the repo. `app-state.js` *is* loaded on every page but is functionally inert — its own header admits it was never wired up. `_esc()` is implemented twice (`utils.js` and `modules/leaderboard/admin-leaderboard.js`).

### Why it exists
`app-state.js` was an abandoned first attempt at the state-management fix this roadmap tackles properly in Phase 3. `analytics.js` is leftover from an incomplete extraction into `modules/admin/`. The duplicate `_esc()` is a case of a second author not knowing (or not checking) that a shared helper already existed — which is itself evidence there's currently no easy way to discover what utilities already exist.

### Principle violated
DRY; dead code.

### Best-practice solution
- Delete root `analytics.js` outright — it's unreachable, so this is a zero-risk removal (Phase 0's tests should still pass unchanged, which is exactly how we confirm it was truly dead).
- Delete `app-state.js` rather than finish wiring it up. This is a direct recommendation to abandon that design, not resume it — see Phase 3 for why `AppStore` (already used 255 times, already has the clone/commit/persist/notify pipeline `app-state.js` never got) is the better foundation to build on, not a second competing one.
- Remove the duplicate `_esc()` from `admin-leaderboard.js`, import the one in `utils.js`.

### Risks
Essentially none — this phase only removes code with zero live callers. The main risk is *missing* a live caller; Phase 0's smoke tests plus a full-repo reference grep before each deletion covers that.

### Deliverable
Two files deleted, one duplicate function removed, all Phase 0 tests still green, repo is measurably smaller and the "which state module is real" confusion is resolved by deletion rather than by documentation alone.

---

## Phase 2 — Security Hardening: Escaping & Authorization Audit
**Priority: Critical. Effort: Medium.**

### Problem
`_esc()` is used correctly at 689 call sites but is *missing* at a few others (`world-boss/leaderboard.js`, `leaderboard/hall-of-fame.js`) that interpolate user-influenced fields (`name`, `profilePic`) directly into `innerHTML`. Separately, client-side role checks (`currentRole === 'admin'`) gate UI, but the audit didn't have time to verify every admin-only action has a matching server-side (RLS/RPC) enforcement — and the SQL migration history shows this exact gap being found and closed reactively at least four times already.

### Why it exists
No shared, enforced rendering path — escaping is opt-in per author, not structural. Authorization has been hardened incident-by-incident rather than modeled comprehensively once.

### Principle violated
Encapsulation (nothing forces safe rendering); defense-in-depth (client gating without confirmed server backstop).

### Best-practice solution
1. **Fix the known unescaped interpolations first** — small, contained, immediately verifiable with a smoke test per fixed screen.
2. **Introduce one rendering entry point** for any DB-sourced field going into `innerHTML` — not just "remember to call `_esc()`" but a lint rule (Phase 0's config) that flags raw `innerHTML = \`...${x}...\`` with a DB-shaped variable name, so this can't silently regress the way it apparently did for these two files while 689 other call sites got it right.
3. **Full authorization matrix audit**: enumerate every admin/teacher-only client action, and for each one, confirm the matching RLS policy or RPC-level role check exists and is tested. Anything found missing gets a targeted RLS/RPC fix (following the same pattern as the existing, correctly-built RPCs like `adjust_student_stats`) — not a client-side-only patch.

### Risks
Tightening RLS policies can break a currently-working-by-accident flow (e.g., a query that only worked because a policy was looser than intended). This is why Phase 0's smoke tests need to cover the core teacher/student/admin flows *before* this phase — so a policy tightening that breaks something is caught immediately, not discovered by a teacher in production.

### Deliverable
Escaping fixed and structurally enforced going forward; documented authorization matrix; any found gaps closed at the RLS/RPC layer.

---

## Phase 3 — Single Source of Truth: Complete the State-Management Migration
**Priority: Critical. Effort: Large.**

### Problem
This is the audit's headline finding: ~1,007 direct `DB.*` references bypass the one mutation gate (`AppStore`) that was supposed to be the single source of truth, versus 255 references that go through it correctly. `app-state.js` was a second, abandoned attempt at the same goal (removed in Phase 1). Multiple sources of truth mean any module can mutate shared state without the clone/commit/persist/notify pipeline `AppStore` provides — which is the direct cause of at least one documented data-corruption bug already.

### Why it exists
`AppStore` was introduced after a large amount of code already existed and referenced `DB` directly, and the migration of existing call sites was never finished — likely for the same reason most such migrations stall: it's a large, cross-cutting, individually-low-value-per-change effort that's easy to deprioritize against visible feature work.

### Principle violated
Single source of truth; encapsulation; SOLID's dependency-inversion (modules should depend on an abstraction — `AppStore` — not on a concrete global).

### Best-practice solution
- **Do not attempt this in one pass.** Migrate module-by-module, in an order chosen by *blast radius*, smallest first: start with a leaf module that has few dependents (e.g., `modules/shared/*`), convert its `DB.*` reads to `AppStore.getSlice()`/`AppStore.getStudent()` and its writes to `AppStore.updateState()`, run Phase 0's smoke tests plus new targeted tests for that module, confirm, move to the next.
- **Keep `AppStore`'s public API frozen during this phase** (per its own v3 header comment: "100% UNCHANGED... zero edits" for callers) — this phase is about *who calls it*, not changing what it does. That constraint is what keeps each individual step low-risk.
- Once a module is fully migrated, add the Phase 0 lint rule *for that module's directory* forbidding new direct `DB.*` writes, so it can't regress while the rest of the app is still mid-migration.
- Last modules to migrate: the highest-blast-radius ones — `db-service.js` itself (which legitimately needs low-level access), `auth.js`/boot sequence, and anything touched by the monkey-patches (which Phase 4 is about to change anyway — sequencing these two phases together for those specific files avoids double-touching them).

### Risks
This is the largest, longest phase and the one most likely to surface latent bugs that were silently "working" only because of a specific mutation order. That's expected — Phase 0 exists specifically to catch that safely instead of in production. I will not batch multiple modules' migrations into one unreviewed change; each module is its own checkpoint.

### Deliverable
`DB.*` direct references eliminated module-by-module until only `db-service.js`/`AppStore` internals touch it directly; lint rule enforced repo-wide by the end of this phase; the "which state system is real" ambiguity the audit flagged is gone because there is, at that point, only one.

---

## Phase 4 — Event-Driven Communication: Replace Monkey-Patching
**Priority: High. Effort: Medium–Large.**

### Problem
23 files wrap global functions (`window.bootApp`, `window.finishQuiz`, `window.logAttendance`, `window.logRecitation`, `window.wbcApplyDamage`) by capturing `_orig` and reassigning, to bolt on cross-cutting behavior (mainly achievement checks and cross-module notifications). This makes the *actual* runtime behavior of these functions unreadable from any single file, and it's an idiom that already competes with a pub/sub system (`AppStore.subscribe`) that exists in the same codebase for the same purpose.

### Why it exists
Monkey-patching a global was the fastest way to hook into an existing function without editing it — and before Phase 3, editing shared call sites carried real risk, since there was no clean state boundary to hook into. This is a case where the *state* problem and the *coupling* problem reinforced each other, which is exactly why this phase follows Phase 3 rather than running in parallel: once state mutations flow through `AppStore.updateState()`, that's a natural, single place to emit an event, instead of needing to patch every function that might change relevant state.

### Principle violated
Open/Closed Principle (extending behavior by mutating existing global functions instead of composing); Separation of Concerns (achievement-checking logic living inside a wrapper around `logAttendance` rather than in the achievement module reacting to an event).

### Best-practice solution
- Define a small, explicit set of domain events emitted from `AppStore.updateState()` call sites (or from the service-layer functions that call it) — `quiz:finished`, `attendance:logged`, `recitation:logged`, `boss:damage-applied`, `session:booted` — matching exactly the five current monkey-patch targets, no more, no less, to keep this phase scoped to what the audit actually found.
- Convert each of the 23 patch sites to `AppStore.subscribe('<event>', handler)`, one file at a time, deleting the `_orig`-capture wrapper as each one converts.
- Verify with Phase 0/2/3's tests plus a new test per converted trigger (e.g., "logging attendance still triggers an achievement check") since this is exactly the kind of hidden-side-effect behavior that's easy to silently lose in a refactor.

### Risks
Patch *ordering* currently matters in a few places (multiple patches wrapping the same function run in a specific sequence based on script load order) — converting to pub/sub changes execution from "sequential and coupled" to "independent, order-agnostic" or "explicitly ordered via subscriber priority." I'll audit for any case where current behavior actually depends on patch order before converting it, and preserve that ordering explicitly (not accidentally) if it's load-bearing.

### Deliverable
Zero monkey-patches remain; `bootApp()` (and the other four hooked functions) become readable in isolation again; one consistent cross-module communication idiom (`AppStore.subscribe`) instead of two.

---

## Phase 5 — Data Layer Redesign: Repository Pattern + Delta Sync
**Priority: Critical. Effort: Large.**

### Problem
`_pushCacheToSupabase` is ~700 lines containing 13 near-identical hand-written blocks (filter → map camelCase-to-snake_case → upsert whole table → catch-and-warn). This is the root cause behind an already-documented data-corruption bug (stale-tab last-write-wins clobbering XP/coins/level/tier) — that specific bug was fixed by pulling those four fields out into a scoped RPC, but the same risk remains live in the other 12 tables, and it's also the biggest performance/scalability bottleneck identified in the audit (whole-catalog tables re-synced on unrelated saves).

### Why it exists
Each table was added incrementally as a feature shipped, and the fastest way to add "sync this new table too" was to copy the nearest existing block and change the field names. There was never a single abstraction that made adding a table *require* the safe pattern rather than *allow* a copy-pasted one.

### Principle violated
DRY; missing Repository/Data-Access-Layer abstraction; single-responsibility (this function does transport, mapping, and error isolation for 13 unrelated entities).

### Best-practice solution
This is the highest-value phase in the whole roadmap, and I want to be direct about scope: **root-causing this properly means two separable changes, and I recommend doing them in sequence, not combined.**

1. **Repository abstraction first** (lower risk, immediate DRY win): replace the 13 hand-written blocks with one generic `syncTable(config)` function driven by a declarative config per entity — `{ table, source: cache.slice, filter, fieldMap, conflictKey }`. This alone eliminates the copy-paste, makes adding a new synced table a config entry instead of 50 lines of new code, and is mechanically verifiable (each converted table should produce byte-identical upsert payloads to what the old hand-written block produced — testable directly).
2. **Delta/patch sync second** (higher risk, the actual root-cause fix for the scalability and race-condition problems): extend `AppStore.updateState()` (now the sole mutation gate, post-Phase 3) to track which specific records were dirtied by a given update, and change the repository layer to push only dirty rows instead of whole tables — generalizing the pattern already proven safe for `adjust_student_stats` to the other 12 tables, via RPC where per-row atomic writes matter (scarce resources, concurrent-editor fields) and via scoped upsert-of-dirty-rows-only where whole-row replacement is genuinely fine (e.g., a single teacher's own catalog edits).

### Risks
This is where "never introduce breaking changes" is hardest to guarantee, because it changes *what data gets sent, when* — exactly the kind of change where a subtle bug could reintroduce a stale-write race rather than fix one. Mitigations: convert one table at a time, starting with the lowest-traffic/lowest-consequence table (not starting with anything student-XP-adjacent, even though that one's already partially fixed) to prove the pattern; require a passing new test asserting the *no-clobber* property (two concurrent sessions changing different fields on the same entity, verify both changes survive) before converting the next table.

### Deliverable
One generic, tested repository layer replacing the 13-block function; delta sync live for all previously-bulk-upserted tables; the specific bug class that already bit `xp`/`coins`/`level`/`tier` structurally can't recur for any other table, because the safe pattern is now the *only* pattern available, not an opt-in one.

---

## Phase 6 — Decompose God Files & God Functions
**Priority: High. Effort: Large (ongoing).**

### Problem
`db-service.js` (2,384 lines), `classroom_builder.js` (1,735), `live_monitor.js` (1,539), `campaign_engine.js` (1,272), `hall-of-fame.js` (1,257), `utils.js` (1,195, an undifferentiated grab-bag) each mix multiple responsibilities in one file.

### Why it exists
Files grew by accretion — each new related feature got added to the file that already handled "that kind of thing," with no size/responsibility budget enforced.

### Principle violated
Single Responsibility Principle; file-level cohesion.

### Best-practice solution
This phase is sequenced *after* Phases 3–5 deliberately: `db-service.js` in particular is far easier to split cleanly once it's genuinely just "repository + realtime + auth-client" (Phase 5 already extracted the sync logic into its own repository module) rather than also being the thing every direct `DB.*` reference in the app implicitly depends on (Phase 3 already removed that). Splitting a god file before fixing what makes it a *load-bearing* god file just relocates the problem.
- Split by responsibility, not by line count: `db-service.js` → `supabase-client.js` (connection/auth), `repository/*.js` (one file per entity or entity group, from Phase 5's config-driven repository), `realtime-sync.js` (subscription management).
- Split `utils.js` by domain: string/formatting helpers, DOM helpers, business-logic helpers — the last of those probably belongs closer to the domain module that uses it, not in a shared file at all.
- Same treatment for the large UI modules (`classroom_builder.js`, `live_monitor.js`, `campaign_engine.js`, `hall-of-fame.js`): separate render logic from data-fetching/business logic from event-handling, per file.

### Risks
Low, if done after Phases 3–5 — the main risk at that point is purely mechanical (import/reference correctness), which Phase 0's test suite plus the lint rule from Phase 3 (no stray `DB.*`) catches directly.

### Deliverable
No JS file over ~400–500 lines without a specific justification; each file has one clearly statable responsibility.

---

## Phase 7 — Module System / Build Tooling
**Priority: High. Effort: Large.**

### Problem
117 `<script src="...">` tags in `index.html`, correctness dependent on exact load order, everything registered onto `window`. No bundler, no minification, no dead-code elimination (which is exactly how the Phase 1 dead files went unnoticed), no per-role code splitting (a student's browser downloads all admin/boss-studio/quiz-builder code on every login).

### Why it exists
The app started as a single-file prototype and modularized by extracting files, but never adopted an actual module system — extraction solved "where does this code live" without solving "how does this code declare what it needs."

### Principle violated
Explicit dependencies (currently implicit via script order); modularity (directory structure without enforced boundaries, per the audit).

### Best-practice solution
- Introduce a minimal, modern bundler (esbuild or Vite — both support incremental adoption and native ES module syntax without requiring a framework rewrite).
- Convert modules to real `import`/`export` incrementally, **starting with leaf modules that Phase 6 just cleanly separated** — this is why it's sequenced after decomposition, not before: converting a 2,000-line file with 15 internal responsibilities into a module just moves the mess, it doesn't fix it.
- Once modules have explicit imports, per-role code splitting becomes close to free: bundle a `student` entry point and an `admin` entry point that only pull in the modules each role actually needs.
- This phase also finally makes Phase 0's lint rules enforceable at build time (fail the build, not just warn) and enables real dead-code detection going forward, so a future orphaned `analytics.js` situation gets caught by tooling instead of a manual audit.

### Risks
This is genuine infrastructure change and the one phase most likely to have a rocky first deploy (build config issues, a missed script, a path problem). Mitigation: stand up the bundler in parallel with the existing script-tag boot sequence first (build output validated against Phase 0's full smoke-test suite before it replaces the old boot sequence, not after), and cut over in one deliberate, easily-revertible step once parity is confirmed — not file-by-file, since a half-bundled/half-script-tag app is its own new class of load-order bug.

### Deliverable
Explicit dependency graph; per-role bundles; automated dead-code and duplicate-symbol detection as a standing CI check, not a one-time manual audit.

---

## Phase 8 — Replace `setTimeout` Sequencing
**Priority: Medium. Effort: Medium.**

### Problem
99 `setTimeout(fn, N)` call sites use arbitrary millisecond delays (400ms appears 16 times, among others) to sequence side effects — e.g., "wait 400ms, then assume the achievement-relevant state has settled."

### Why it exists
Before Phase 3/4, there was no reliable signal for "this write has actually completed and propagated" — a fixed delay was a pragmatic stand-in.

### Principle violated
Correctness-by-assumption instead of correctness-by-guarantee; this is exactly the kind of code that gets flakier, not more forgiving, as concurrency and network latency increase with scale.

### Best-practice solution
By this point, Phase 4's event system (`AppStore.subscribe`) already fires *after* a state update genuinely commits, and Phase 5's repository layer returns real promises for sync completion. Most of the 99 `setTimeout` calls should become either a direct `await` on the operation they were really waiting on, or a subscription to the event that now exists for exactly that transition. Audit each call site individually — a few may be legitimate UI-timing delays (an animation duration, a toast dismissal) that should stay as `setTimeout` and aren't part of this problem; the fix targets the ones standing in for a missing async guarantee, not all 99 uses of the API.

### Risks
Low — by this phase, the actual completion signals this code was missing already exist from Phase 4/5, so this is mostly substitution, not new design.

### Deliverable
`setTimeout` used only for genuine UI-timing purposes; zero instances of it standing in for "wait for an async operation to probably be done."

---

## Phase 9 — Scalability Hardening
**Priority: High. Effort: Medium.**

### Problem
Beyond the sync-layer fix in Phase 5, the audit flagged: no lazy loading by role (fixed by Phase 7), no pagination on 12 of 13 bulk-synced tables (partially fixed by Phase 5's delta sync, but large *initial* loads for e.g. a school with years of `point_log` history still need bounded fetches), and `AppStore.getState()` full-clone calls in hot paths (flagged in its own source comments as something to avoid, with nothing currently enforcing that).

### Best-practice solution
- Extend the existing `_loadMoreHistory`/pagination pattern (already proven for `quiz_history`) to the other high-volume log tables.
- Add a lint/runtime warning for `AppStore.getState()` calls outside of designated slow paths, pushing remaining callers onto `getSlice()`/entity-scoped selectors.
- Load-test the delta-sync repository layer from Phase 5 against a simulated "hundreds of teachers, thousands of students" dataset before calling this phase done — this is the one place in the roadmap where I want a concrete numeric target agreed with you (e.g., "sync latency stays under Xms at Y concurrent sessions") rather than a qualitative "should scale better."

### Deliverable
Bounded, paginated data access everywhere; a load-tested number to point to instead of an architectural argument.

---

## Phase 10 — CI Enforcement (Ongoing, Compounding)
**Priority: Medium (enabling, but compounding value). Effort: Small per addition.**

### Problem
Every fix in this roadmap is only permanent if something stops it from regressing. The audit itself is proof this matters: several of its findings (RLS gaps, missing escaping) are cases where the *right* fix was applied once and a *different* instance of the same class of bug reappeared later elsewhere in the codebase.

### Best-practice solution
Each phase above already proposes its own specific CI gate (no direct `DB.*`, no unescaped `innerHTML`, no duplicate top-level function names, bundler-enforced dead-code detection, load-test thresholds). Phase 10 isn't a separate body of work — it's the discipline of actually turning each phase's guardrail on and keeping it on, tracked in one place (the living Engineering Refactoring Report below) so "did we actually enforce this or just fix it once" is always answerable.

---

## What I'm explicitly *not* proposing

- **Not a rewrite.** Every phase above operates on the existing codebase in place. Working functionality (the game mechanics, the admin tooling, the RLS-protected data model) is preserved throughout.
- **Not touching the SQL/RLS security model's fundamentals** — it's built correctly (real RLS, real RPCs, real Auth); Phase 2 closes gaps in its *coverage*, not its *design*.
- **Not adopting a frontend framework** (React/Vue/etc.). Nothing in the audit's findings requires one — the problems are state ownership, coupling, and sync correctness, all of which are solvable in the existing vanilla-JS + Supabase stack. Introducing a framework here would be scope creep relative to what's actually broken, and I'd be pushing back on it even if you asked for it, unless a specific phase above turns out to genuinely need it.

## What happens after you approve this

I'll begin Phase 0 exactly as scoped above — nothing else. I will not start Phase 1 until Phase 0's tests are in place and green, and I will not start any phase without first walking you through that phase's "Problem / Root Cause / Principle / Solution / Risks" (as required) *before* implementing it, and confirming the result against the living Engineering Refactoring Report afterward.
