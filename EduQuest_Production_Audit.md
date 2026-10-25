# EduQuest — Production Code Quality Audit
**Scope:** Full codebase (`index.html`, 17 root-level JS modules, 18 `modules/` subsystems, 137 total JS/HTML files, 17 CSS files, 73 SQL migrations — ~49,000 lines of JS, 3,564-line `index.html`)
**Method:** Static review, dependency/reference tracing, dead-code detection, pattern grep across the full tree, and manual reading of the highest-risk files (`db-service.js`, `auth.js`, `app-state.js`, `state-manager.js`, achievement/analytics modules, SQL migrations).
**Reviewer stance:** This is judged as a production system, not a prototype.

---

## Executive Summary

EduQuest is a genuinely large, feature-rich application that works and has clearly been through several real rounds of bug-hunting — the SQL migration history and the comment trail in `db-service.js` show real production incidents (race conditions, RLS gaps, whole-roster clobbering) being found and fixed. That is worth crediting.

But structurally, this is a **monolith that was never actually decoupled**, with a **local-first cache architecture bolted onto a relational backend after the fact**. The dominant patterns are: one 754+/1000+-reference global mutable object (`DB`) as the true state store, load-order-dependent global-namespace scripts (117 `<script src>` tags, no bundler, no module system), pervasive runtime monkey-patching used as the primary extensibility mechanism, and `setTimeout`-based sequencing used in place of real async coordination in dozens of places. A parallel, better-designed state module (`app-state.js`) was written and **never wired up** — it sits in the bundle, loaded on every page view, doing nothing.

This is not "vibe-coded and broken." It runs. But it was engineered reactively — fix-on-discovery — rather than designed up front, and the seams show everywhere: two competing state systems, a `_pushCacheToSupabase` function pushing 13 near-identical hand-copied table blocks, dead files still being shipped to the browser, and authorization logic that is client-checked in the UI and only inconsistently backstopped by RLS/RPCs.

**It is not production-ready as-is for "hundreds of teachers, thousands of students."** Section 12 explains why in detail.

---

## 1. Architecture

**Organization:** Logical at the top level — `modules/<domain>/` is a sensible split, and the DB-schema/db-service/db-migrations/app-state layering has the right *names*. But the actual **module boundary is fake**: every file dumps its exports directly onto `window`, so nothing is actually encapsulated or independently loadable. `modules/` is a folder convention, not an architectural boundary — there is no import graph, only load order in `index.html`.

**Coupling:**
- Extremely high implicit coupling through shared globals: `DB`, `currentUser`, `currentRole`, `AppStore`, and 1,000+ `DB.*` call sites across dozens of files.
- **Monkey-patching as an extensibility mechanism.** 23 files wrap existing global functions (`window.bootApp`, `window.finishQuiz`, `window.logAttendance`, `window.wbcApplyDamage`, etc.) by capturing `_orig` and reassigning. This means the *actual* behavior of `bootApp()` on login is scattered across `auth.js` + `achievements/ach_engine.js` + `world-boss/summon-notify.js` + `titles/*` + `admin/dsm-manager.js`, with no single place to read to know what happens on boot. `auth.js`'s own header comment admits this ("`bootApp()` is monkey-patched by at least 4 other modules... Patches will be replaced with explicit init() calls in Phase 5" — Phase 5 never happened; the codebase is now well past Phase 70 in the SQL migrations).
- A parallel pub/sub system (`AppStore.subscribe`) exists *alongside* the monkey-patch pattern for the same class of problem (cross-module reactivity), so there are two competing idioms for "notify other modules something happened," chosen inconsistently per file.

**Files doing too many unrelated things:**
- `index.html` (3,564 lines) mixes markup, 275+ inline `style=` attributes, and multiple inline `<script>` blocks alongside 117 external script tags — it is simultaneously the page shell, the boot orchestrator, and a dumping ground for whatever wasn't extracted yet.
- `db-service.js` (2,384 lines) is a data-access layer, a cache/derivation layer, a realtime-subscription manager, an upload-queue manager, and a Supabase-Auth-client factory, all in one IIFE.
- `utils.js` (1,195 lines) is an undifferentiated grab-bag (string escaping, formatting, UI helpers, misc business logic) — the classic junk-drawer module.

**Scalability of the architecture:** Poor, as designed. There is no bundling/tree-shaking, no lazy loading (every module loads on every page regardless of role — a student's browser downloads all admin, boss-studio, and quiz-builder code on every login), and the central `DB` cache is a single client-side plain object that is bulk-cloned and bulk-persisted, which does not scale gracefully as the dataset per class/school grows (see §7, §9).

**Severity: High** — architecture works today at small scale (one school pilot) but actively fights growth in team size, feature count, and data volume.

---

## 2. Code Quality

| Issue | Evidence | Severity |
|---|---|---|
| Giant files | `db-service.js` 2,384 lines; `classroom_builder.js` 1,735; `live_monitor.js` 1,539; `campaign_engine.js` 1,272; `hall-of-fame.js` 1,257; `utils.js` 1,195; `index.html` 3,564 | High |
| Giant functions | `_pushCacheToSupabase` (db-service.js, lines 1047–1746, ~700 lines, 13 near-duplicate table-push blocks inline); `_pullCacheFromSupabase` (lines 656–1005, ~350 lines) | High |
| Duplicated/copy-paste implementations | 13 `_pushTable(...)` blocks in `db-service.js` each hand-write the same filter → map → upsert → error-throw shape per table, differing only in field names | High |
| Duplicated utility function | `_esc()` (HTML-escaping helper) is defined independently in both `utils.js` and `modules/leaderboard/admin-leaderboard.js` instead of being imported once | Medium |
| Dead code shipped to production | `analytics.js` (19 KB, top-level) is superseded by `modules/admin/analytics.js` (same function names, e.g. `_anlRollupBodyHTML`, `_anlPagination`) but is **not referenced anywhere in `index.html`** — orphaned, unreachable, still sitting in the repo | Medium |
| Dead code still *loaded* | `app-state.js` is loaded via `<script>` on every page view; its own header states "not currently imported or called by any module" and "All 754 references to DB... still use the raw globals directly" — it ships and executes for zero effect | Medium |
| Magic numbers | 99 `setTimeout(fn, N)` calls with untyped millisecond literals (400 appears 16×, 800 5×, 2000 4×, etc.) used to sequence cross-module side effects instead of promises/callbacks/events | Medium |
| Inconsistent naming | Mix of Hungarian-ish domain prefixes (`wbc*`, `ach*`, `bs*`, `dsm*`, `co*`) with no documented convention, plus `camelCase` DB-cache fields (`ownerTeacherId`) mapped by hand to `snake_case` columns (`owner_teacher_id`) in every single push block rather than one mapping layer | Low–Medium |
| console noise | 244 `console.log/warn/error` calls left in shipped code, several of them narrative debug logs (e.g. `console.log('[EduQuest] achievements/engine.js loaded — ...')`) | Low |
| Commented-out / narrative legacy comments | Multiple files carry paragraph-length "BUGFIX," "AUTH MIGRATION NOTE," and "PHASE N EXTRACTION NOTE" comments documenting the *history* of the file rather than its current contract — useful once, but now a maintenance liability (comments will silently rot as code changes further) | Low |

**Severity overall: High.**

---

## 3. Maintainability

- **Confusing/hidden dependencies:** `auth.js`'s `doLogin()`/`bootApp()` depend on globals defined in `index.html`'s inline script (`selectedLoginRole`, `DB`), on `DBService` (db-service.js), on `RegistrationService`, and — invisibly — on whatever the 4+ monkey-patch modules decided to bolt onto `bootApp` at load time. A new engineer cannot determine "what happens when a user logs in" by reading `auth.js` alone.
- **Tightly coupled, load-order-fragile boot sequence:** correctness depends on the exact order of 117 `<script>` tags in `index.html`. Reordering, lazy-loading, or code-splitting any of them is a functional risk, not just a build concern.
- **Two competing state-management systems** (`app-state.js`'s dead getter/setter API vs. `AppStore` in `state-manager.js`, which is itself only used for 255 of the ~1,262 total state touches) mean a new contributor has to first figure out *which one is real* before making a change — and will find comments in `app-state.js` that actively contradict the state of the codebase ("Phase 2+" never happened).
- **Future problem:** the 13-block copy-paste in `_pushCacheToSupabase` means every new synced table requires a developer to correctly replicate ~50 lines of filter/map/upsert/error-handling boilerplate by hand. This has already produced at least two documented bugs in the codebase's own history (missing staff-session gates on `shop_products`/`boss_events`/`achievements`, each discovered and fixed separately instead of once).

**Severity: High** for onboarding cost and change risk; the codebase is comprehensible file-by-file but not comprehensible as a system.

---

## 4. Design Principles

| Principle | Verdict | Evidence |
|---|---|---|
| Single Responsibility | Violated repeatedly | `db-service.js` = network client + cache + derivation + realtime + upload queue; `index.html` = shell + boot script + inline styling |
| DRY | Violated | 13-block table-push duplication; duplicate `_esc()`; duplicate `analytics.js`/`modules/admin/analytics.js` with identical function names |
| KISS | Violated | Monkey-patching global functions to add cross-cutting behavior, when a pub/sub system (`AppStore.subscribe`) *already exists in the same codebase* and is the simpler, already-proven mechanism |
| Separation of Concerns | Partially followed | `modules/<domain>-service.js` vs `modules/<domain>.js` naming convention (service vs. UI) is followed in several newer modules (sections, teacher-directory, starter-pack) — a real bright spot — but is not applied consistently to older modules (`db-service.js` mixes transport and rendering-adjacent derivation logic) |
| Modularity | Nominal only | Directory structure suggests modules; runtime reality is one shared global namespace with no enforced boundaries |
| Reusability | Weak | Per-table push logic isn't reusable (hand-copied); `_esc()` had to be reinvented in a second file because the first wasn't obviously reusable/importable |
| Encapsulation | Essentially absent | `DB` is a single object every module can read *and write* directly; nothing prevents any of the 137 files from mutating any part of shared state |

**Severity: High.**

---

## 5. State Management

- **Multiple sources of truth, by design admission:** the codebase itself documents that `app-state.js` was supposed to be the single mutation gate and never became one; `AppStore` in `state-manager.js` is a *second*, actually-used attempt at the same goal, but 1,007 direct `DB.*` references bypass it entirely. There is no enforcement stopping any module from mutating `DB` directly and skipping `AppStore.updateState()`'s clone/commit/persist/notify pipeline.
- **Documented race conditions, some fixed, likely more latent:** the codebase's own comments describe a real production bug where any `saveDB()` (triggered by something as small as a student login) queued a full re-push of `shop_products`/`boss_events`/`achievements`, and a separate, more serious bug where `xp`/`coins`/`level`/`tier` were bulk-upserted from whichever browser tab last saved, silently overwriting fresher values written by another device seconds earlier ("whole-roster last-save-wins"). The fix (routing those four columns through an `adjust_student_stats` RPC) is real and good — but it was applied to **one set of fields**; every other bulk-upserted table (13 of them) still uses the same last-write-wins whole-table upsert pattern the bug report flagged as unsafe, just without (yet) a documented incident.
- **Unnecessary global state:** `currentUser`, `currentRole`, `selectedLoginRole`, `DB` are bare top-level variables relied upon by dozens of files with no access control.
- **Manual synchronization:** cross-tab and cross-module state changes are propagated via a mix of `AppStore.subscribe`, direct global mutation, and timer-delayed side effects (`setTimeout(..., 400)` after triggering an award, a quiz finish, etc.) rather than awaited completion.

**Severity: Critical** — this is the single biggest structural risk in the codebase, and it's the one place where the code's own comments corroborate the assessment rather than just my reading of it.

---

## 6. Database Layer

**Positives:** Real Postgres RLS is in use (not just client-side gating), 18 `SECURITY DEFINER` RPCs exist for privileged writes (loot claims, achievement grants, XP adjustment), row locking (`FOR UPDATE`) is used for scarce-resource arbitration in `claim_loot_reward()`, and index coverage is reasonably broad (47 `CREATE INDEX` statements across ~30 of ~35 tables). No dynamic/string-built SQL was found anywhere in the 73 migration files, so classic SQL-injection-via-string-concat is not present.

**Negatives:**
- **Duplicated query/upsert logic:** the 13-block `_pushTable` pattern in `db-service.js` is effectively 13 copies of the same DB-access shape with no shared row-mapping abstraction.
- **Missing abstraction layer:** there is no repository/DAO pattern — Supabase client calls (`client.from(table).upsert(...)`) are inlined directly in `db-service.js`'s giant push/pull functions rather than behind a per-entity interface.
- **Poor transaction handling at the client-sync level:** the "bulk upsert whole table on every save" strategy is not transactional across tables — a partial failure (now caught per-table via `_pushTable`'s try/catch, a real improvement) still leaves the local cache and remote DB in different states with only a `console.warn`, no user-visible reconciliation and no retry/backoff.
- **Reactive RLS hardening:** 11 of 73 SQL files are explicitly named `*fix*`/`*hotfix*`/`*bugfix*`, most closing authorization gaps after the fact (e.g., `wave2_registration_security_fixes.sql`, `phase47_boss_class_id_and_write_rls_fixes.sql`). This is evidence the RLS policy surface was not modeled comprehensively up front — the recurring bug class the codebase's own memory of itself calls out ("INSERT policy without matching UPDATE policy") recurred across `point_log`, `quiz_history`, `boss_participants`, and others as *separate* incidents rather than being caught by a single audit before shipping any of them.
- **Inconsistent naming across layers:** client-side cache uses `camelCase` (`ownerTeacherId`), Postgres uses `snake_case` (`owner_teacher_id`) — fine in principle, but the mapping is manually re-written per table inside each push block instead of centralized, so a typo in one mapping silently drops a field with no compile-time or schema check to catch it.

**Severity: High.**

---

## 7. Performance

- **Redundant database reads/writes:** the sync model bulk-pulls and bulk-pushes large slices of tables on a debounced timer rather than diffing/patching only changed rows for most entities (XP/coins/level/tier being the one exception that got a scoped RPC). This does not scale with student/class count — a 700-student school's `shop_products`/`achievements`/`titles` catalogs get re-serialized and re-upserted in full on saves that may have touched a single unrelated field.
- **No lazy loading:** every module (student, teacher, admin, boss-studio, quiz-builder, seat-arrangement) ships to every client regardless of role, inflating initial load for all 117 scripts.
- **Full-DB cloning on reads:** `AppStore.getState()` is documented as returning a full deep-clone of the entire `DB` and is explicitly flagged in its own comments as something to "avoid in hot paths" — meaning the authors know it's expensive and are relying on developer discipline (not an actual guardrail) to avoid misuse.
- **Timer-based sequencing (`setTimeout`) instead of real completion signals** in ~99 call sites adds arbitrary latency and, worse, is a source of intermittent timing bugs under slower devices/networks (a 400 ms assumption that a DB write "should be done by then" is not a guarantee).
- **No code-splitting/bundling** means no minification, no tree-shaking, no HTTP/2 request coalescing beyond what the browser does natively for 117 files.

**Severity: High**, and it is the category most directly relevant to the "hundreds of teachers, thousands of students" scaling target in §9.

---

## 8. Security

**Positives:**
- Real Supabase Auth (`signInWithPassword`) replaced an earlier local plaintext-password scheme (per the codebase's own audit history) — a substantial, correctly-executed fix.
- Generic "Invalid login credentials" error is preserved on purpose to avoid user-enumeration via the login form — good practice, and the code comments explicitly explain why.
- Authorization for privileged writes increasingly routes through `SECURITY DEFINER` RPCs rather than trusting the client, which is the right pattern.
- HTML-escaping helper (`_esc()`) is used at 689 call sites, showing real XSS awareness in most rendering paths.

**Negatives:**
- **Inconsistent XSS mitigation:** at least two rendering paths (`modules/world-boss/leaderboard.js`, `modules/leaderboard/hall-of-fame.js`) interpolate `s.profilePic` and `s.name` directly into `innerHTML` **without** the `_esc()` helper that's used elsewhere in the same codebase for the same kind of data, while a near-identical roster-portrait pattern in `modules/admin/sections.js` *does* escape it. If either of those unescaped fields can ever contain attacker-influenced content (a student-editable display name or an externally-hosted avatar URL), this is a stored-XSS path. The inconsistency itself — not universally missing, just inconsistently applied — is the real finding: there's no lint rule or shared render helper enforcing escaping, so it depends on each author remembering.
- **Client-side role gating without confirmed server-side backstop everywhere:** UI-level checks like `currentRole === 'admin'` gate 10+ admin code paths; these are necessary but not sufficient, and the audit didn't have time to verify that *every* admin-only UI action is separately enforced by a matching RLS policy or RPC role check (the codebase's own history shows this gap has been found and closed multiple times reactively — see §6 — which suggests more may exist unfound).
- **Publishable API key embedded in `index.html`** (`window.__EDUQUEST_SUPABASE_ANON_KEY__`) — this is expected/normal for a Supabase publishable key and is not itself a vulnerability *provided* RLS is airtight on every table, but it does mean the security model rests entirely on RLS correctness, and §6/§9 show that correctness has been arrived at iteratively rather than by design.
- **No CSP, no Subresource Integrity** on the 117 script tags (not verified against externally-hosted scripts, but worth confirming none are pulled from third-party CDNs without SRI).

**Severity: Medium–High** — no smoking-gun critical vulnerability was found in this pass, but the *pattern* (inconsistent escaping, reactive RLS discovery, no automated enforcement of either) is exactly the pattern that produces one under load or as new modules are added.

---

## 9. Scalability

Assuming hundreds of teachers / thousands of students concurrently:

1. **Full-table bulk upserts on every save** (§6, §7) will not scale — catalog tables (`shop_products`, `achievements`, `titles`, `quizzes`) get rewritten in full by any teacher's save, and this pattern was *already* causing spurious RLS-rejection noise at current scale per the code's own bugfix comments.
2. **Client-side full-DB caching model** means each client holds and periodically re-serializes a large in-memory object; this gets worse per-school as roster size, quiz history, and point logs grow, since history/log tables are paginated (`_loadMoreHistory` exists) but the bulk catalog tables are not.
3. **No server-side pagination/virtualization evident in the bulk-push tables** — `quiz_history` gets special-cased pagination, but 12 other tables don't.
4. **No lazy module loading** means server/CDN load per page view is flat regardless of role, multiplying unnecessarily as concurrent users grow.
5. **`setTimeout`-based sequencing** becomes proportionally less reliable under real-world network latency variance at scale — a fixed 400 ms assumption that "the write finished" is far less safe when thousands of concurrent writes are contending for the same RPCs/tables.
6. **Global in-browser mutable state with no encapsulation** doesn't cause a *server*-side bottleneck directly, but it means the client is doing far more work (full clones, full re-renders) than necessary per state change, which matters for lower-end school-issued Chromebooks at real classroom scale.

**Severity: Critical** at the target scale stated in the prompt — this architecture will work for a pilot of one or a few classrooms and degrade materially past that without the sync layer being redesigned (delta-sync/patch instead of bulk-upsert being the highest-leverage fix).

---

## 10. Code Smells

| Smell | Where |
|---|---|
| **God Object** | `DB` — single global object holding all application state, mutated from ~100+ files |
| **God Function** | `_pushCacheToSupabase` (~700 lines), `_pullCacheFromSupabase` (~350 lines) in `db-service.js` |
| **Shotgun Surgery** | Any change to boot/login behavior requires touching `auth.js` *and* the 4+ files that monkey-patch `bootApp`; any new synced table requires replicating the 13-block push pattern |
| **Feature Envy** | Achievement-trigger logic in `ach_engine.js` reaches into and wraps `finishQuiz`, `logAttendance`, `logRecitation`, `wbcApplyDamage`, and `bootApp` — five other modules' responsibilities — rather than those modules emitting an event `ach_engine.js` subscribes to |
| **Long Methods** | See God Function row; also `bootApp()` itself plus its four external patches functionally form one very long, physically scattered method |
| **Circular/Hidden Dependencies** | `app-state.js` depends on globals defined inline in `index.html`'s `<script>` block; `AppStore` documents a required load-order relationship with `db-migrations.js` and `db-schema.js` enforced only by `<script>` tag ordering, not by any dependency resolution |
| **Spaghetti Code (localized)** | The monkey-patch chains (`bve-patches.js`, `ach_engine.js` trigger hooks) — tracing actual runtime behavior of a core function requires jumping across 4–5 files with no static reference between them |
| **Hidden Side Effects** | `setTimeout(() => achCheckAndAward(...), 400)` fired from inside a *patched* `logAttendance` — a developer calling `logAttendance()` has no local indication that achievements will also be checked 400 ms later |
| **Duplicated Code** | 13-block table push; duplicate `_esc()`; duplicate `analytics.js` |
| **Dead Code** | `app-state.js` (loaded, unused), root `analytics.js` (not even loaded) |

**Severity: High.**

---

## 11. Technical Debt

| Item | Type | Severity |
|---|---|---|
| `app-state.js` written as "the" state layer, abandoned mid-migration, still shipped | Abandoned refactor | Medium |
| 13-block copy-paste table sync in `db-service.js` | "Just make it work" duplication | High |
| Monkey-patch pattern used instead of the pub/sub system that already exists in the same codebase | Inconsistent pattern / unfinished migration ("Phase 5: Replace Monkey-Patches" never executed) | High |
| Reactive RLS bugfix migrations (11 of 73 files) | Patch-after-incident security work | High |
| `setTimeout`-based sequencing (99 sites) standing in for real async coordination | Workaround logic | Medium |
| Root-level `analytics.js` orphaned duplicate | Leftover from incomplete extraction | Low |
| Duplicate `_esc()` implementation | Copy-paste instead of reuse | Low |
| Inconsistent escaping on user-influenced fields in leaderboard/hall-of-fame rendering | Security shortcut | Medium–High |

**Severity overall: High** — none of these are "the app is broken" issues; all are "this will cost real engineering time and/or cause an incident as the app grows" issues, which is precisely the technical-debt profile this audit was asked to surface.

---

## 12. Production Readiness

**Verdict: Not production-ready for the stated target scale (hundreds of teachers, thousands of concurrent students) without further work.** It may be acceptable for a single-school or small-pilot deployment where current sync volume and concurrency stay low, because:

1. **State management has no single source of truth**, and the codebase's own abandoned `app-state.js` refactor is direct evidence the team *knew* this and didn't finish fixing it.
2. **The sync layer's dominant pattern (bulk whole-table upsert) is the same pattern that has already caused at least two documented data-corruption-class bugs** (stale-tab XP clobbering, spurious RLS failures) for the one set of fields it was fixed for — the same risk is still live in the other 12 synced tables.
3. **Security enforcement is real (RLS + RPCs) but has been arrived at through repeated reactive patching rather than an up-front authorization model**, and escaping discipline for XSS is inconsistently applied rather than centrally enforced.
4. **There is no test suite of any kind** (no `*.test.js`, `*.spec.js`, or test runner config found anywhere in the tree) — every one of the many documented bugfixes in the SQL/JS history was presumably caught by manual QA or in production, not by automated regression coverage, so there is nothing preventing a re-introduction of any previously-fixed bug.
5. **No build tooling** (no bundler, no minification, no lint config) means there is no automated gate catching the duplicate-function, dead-file, or inconsistent-escaping issues found by hand in this audit — they will keep accumulating.

**What would need to happen before scaling this to production-at-scale:** replace whole-table bulk upserts with real delta/patch sync for the remaining 12 tables (extending the pattern already proven for XP/coins/level/tier); finish or abandon the `app-state.js` migration explicitly (pick one state-access API and delete the other); replace monkey-patching with the existing `AppStore.subscribe` pub/sub for all cross-module triggers; add a lint rule or shared render helper that makes unescaped `innerHTML` interpolation of any DB-sourced field fail CI; add automated tests around the RLS/RPC authorization surface given how many times that surface has needed a reactive fix; and introduce at least a minimal bundler/build step so dead files and duplicate implementations are caught automatically rather than by manual audit.

---

## Overall Scores (1–10)

| Category | Score | Rationale (short) |
|---|---|---|
| Architecture | 4 | Sensible folder layout undermined by fake module boundaries and a global-namespace runtime |
| Maintainability | 4 | Extensive, honest comments help; monkey-patching and two competing state systems hurt more |
| Scalability | 3 | Bulk-upsert-everything sync model and no lazy loading are the two biggest blockers at target scale |
| Security | 5 | Real RLS/RPC/Auth foundations exist; escaping and authorization coverage are inconsistent, not centrally enforced |
| Performance | 4 | Full-object cloning, full-table syncs, and 99 timer-based delays add up at any real scale |
| Readability | 6 | Individual files are usually readable line-by-line; system-level behavior is hard to trace |
| Modularity | 3 | Directory-level modularity only; runtime coupling through shared globals is total |
| Production Readiness | 3 | Works for a small pilot; not ready for hundreds of teachers / thousands of students without the fixes in §12 |

## Overall Engineering Grade: **D+**

This reflects a codebase that *functions* and shows real evidence of engineers finding and fixing genuine bugs over time — but one that was built by continuously patching a monolith rather than by following through on its own architectural decisions (the abandoned `app-state.js` migration is the clearest single piece of evidence for this). The gap between "works" and "engineered properly" is exactly where the prompt asked this audit to focus, and on that basis it lands solidly in shortcut/technical-debt territory rather than professional-production territory.
