# Phase 7 — src/ Conversion Tracker (step 5.3)

## The pattern (read this before converting anything else)

Real `import`/`export` conversion happens in a **new parallel `src/` tree**,
mirroring the original file layout. The original file (e.g. `dom.js`) stays
**completely untouched** — still a classic script, still what `index.html`
and `build/concat.js`'s legacy build actually load in production — until
enough of `src/` exists to flip the whole boot sequence over in one
deliberate cutover (Phase 7 session memory doc, principle 8; also the
phase spec's own "stand up in parallel... cut over in one deliberate step,
not file-by-file" guidance).

**Why not just add `export` to the original file in place?** Two reasons,
both confirmed while converting `dom.js` (session 5), not assumed:
1. A classic `<script>` cannot contain the `export` keyword — it's a hard
   `SyntaxError`, not a style choice. The instant a live-loaded file gains
   real export syntax, production breaks.
2. Even for a **zero-fan-out** file like `dom.js`, switching its own
   `<script>` tag to `type="module"` isn't safe on its own: module scripts
   defer differently than classic scripts, and `dom.js` has 59 real
   consumers (fan-in 59, the highest of any true leaf) that currently
   expect `toast()`/`closeModal()`/etc. to exist synchronously the moment
   they run. Deferred module timing could break that even though nothing
   about `dom.js`'s own logic needs anything else converted first.

## Per-file conversion checklist

1. Confirm the target is a real leaf or has all its dependencies already
   converted — check `PHASE7_DEPENDENCY_MAP.md` (fan-out 0 = safest,
   already-converted deps = next-safest).
2. Create `src/<same relative path>.js` with real `export function` /
   `export const` for every symbol the original declares. Drop the
   trailing `window.X = X` lines from the `src/` copy — nothing consumes
   it via `window` (nothing imports it in a shipping entry point yet).
3. Grep-diff verify: declared-symbol count from
   `dist/dependency-map.json` (`declaresCount` for that unit) must equal
   the exported-symbol count in the new `src/` file. Don't eyeball it.
4. `node --input-type=module -e "import('./src/X.js').then(m =>
   console.log(Object.keys(m)))"` — confirms it's syntactically valid ESM
   and lists the real export surface for a second, independent check
   against step 3.
5. `npx esbuild src/X.js --bundle --format=esm --outfile=/tmp/check.js` —
   confirms it survives real bundling, not just Node's own module loader.
6. Confirm the **original** file is byte-identical to before (checksum) —
   this step must produce zero changes to anything currently shipping.
7. Re-run `node build/concat.js` + `node --check` on the legacy build, and
   the full unit test suite — both must stay clean. Adding a `src/` file
   should never be able to affect either, but confirm it, don't assume it.
8. Log the conversion to `EduQuest_Engineering_Refactor_Log.md` under a
   Phase 7 entry, same as every other session.

## What happens when a converted file has fan-in > 0 from files that
## AREN'T yet converted — resolved (session 6, 2026-08-10), with an
## important scope caveat

**Resolved for the single-file-substitution case:** each converted `src/`
file gets a small **bridge module** (`build/bridges/<name>.bridge.js`) that
imports its real exports and explicitly re-attaches every one of them to
`window` — not just the subset any prior session happened to flag, *all*
of them. Bundled with esbuild (`--bundle --format=iife`), the bridge is a
drop-in replacement for the original classic `<script>` tag: same global
surface, verified byte-for-byte identical behavior via a real jsdom
equivalence check (`build/verify-dom-bridge.js` — loads the *original*
`dom.js` into one jsdom window and the *bundled bridge* into a separate
jsdom window with identical starter DOM, drives both through the same
call sequence, diffs the resulting DOM state; not a syntax check, an
actual behavioral one). Confirmed `dom.js` needed this: `showModal` has
34+ real bare-call consumers and zero explicit `window.showModal =`
anywhere — it only works today via dom.js being an unconverted classic
script. A bridge that only covered the session-2 subset would have
silently broken it.

**RESOLVED (session 7, 2026-08-10):** built `build/audit-window-exports.js`,
which generalizes session 2's onclick-only audit to *every* symbol with a
real cross-file consumer (429 of them, per the dependency graph). Found
180 at risk across 39 files — spot-checked the two highest-count files
(`classroom_builder.js`, `repository/pull-mappers.js`, 31 each) before
trusting the list at scale; both legitimate, not artifacts. Fixed via an
automated codemod (`build/apply-window-export-fixes.js`) for 37 external
files (166 symbols) plus 2 hand-placed insertions in `index.html`'s inline
blocks (14 symbols, including `currentUser`/`currentRole` — 51 and 39
consumers, the highest of any symbol in the codebase). Re-audit: 0 at
risk, 429/429 safe. Full details in `PHASE7_WINDOW_EXPORT_AUDIT.md`.

**Any file in this codebase can now safely be side-effect-imported into a
real esbuild bundle** without silently breaking a consumer that relied on
implicit classic-script global attachment — the actual gate for step 5.4's
entry-point work is now open.

## Status

| Original file | fan-out | fan-in | `src/` twin created | Verified |
|---|---|---|---|---|
| `dom.js` | 0 | 59 | ✅ `src/dom.js` | ✅ session 5 (2026-08-10): export-count matches declares-count (4/4), imports cleanly via Node ESM, bundles cleanly via esbuild `--format=esm`, original file checksum-confirmed unchanged, legacy concat build + full 185-test suite unaffected. ✅ session 6 (2026-08-10): bridge module built (`build/bridges/dom.bridge.js`, bundled to `dist/bridges/dom.bridge.js`), real jsdom behavioral equivalence check passed — bundled bridge and original classic file produce byte-identical DOM state across `toast()`/`showModal()`/`closeModal()`/`closeModalForce()`. **Not yet cut over into `index.html`** — bridge exists and is verified in isolation, per Principle 8 the actual `<script>` tag swap only happens at the single full cutover event, not per-file. |
| `modules/shared/stat-bars.js` | 0 | 3 | ✅ `src/stat-bars.js` | ✅ session 11 (2026-08-10): export-count matches declares-count (1/1), imports cleanly via Node ESM, bundles cleanly via esbuild `--format=esm`, original file checksum-confirmed unchanged. Bridge built (`build/bridges/stat-bars.bridge.js`), real jsdom equivalence check (`build/verify-stat-bars-bridge.js`) passed across percent/tier/`justChanged`-pulse/clamping (both directions)/null-guard/missing-field cases — byte-identical DOM state at every step. Legacy concat build + full 185-test suite unaffected. **Not yet cut over**, same as `dom.js`. |
| `modules/shared/sequence.js` | 0 | 1 | ✅ `src/sequence.js` | ✅ session 12 (2026-08-10): export-count matches declares-count (1/1), imports/bundles clean, checksum unchanged. Bridge + real jsdom equivalence check (`build/verify-sequence-bridge.js`) — exercised the actual async `setTimeout`-driven execution order AND the returned `cancel()` handle (confirmed it genuinely stops later steps from firing, not just structurally present), byte-identical between original and bridge. **Not yet cut over.** |
| `modules/shared/particles.js` | 0 | 1 | ✅ `src/particles.js` | ✅ session 12 (2026-08-10): export-count matches declares-count (1/1), imports/bundles clean, checksum unchanged, function body copied byte-for-byte (verbatim move). **Known, disclosed verification limitation:** jsdom in this sandbox has no real 2D canvas backend (`getContext('2d')` not implemented without the optional native `canvas` package) — the `requestAnimationFrame` `tick()` loop's actual per-frame rendering could not be exercised or compared here, in either build. What COULD be and was verified: the null-anchorEl guard, the prefers-reduced-motion guard, and canvas element creation/class/dimensions — all byte-identical between original and bridge. Both builds also fail identically (same `TypeError`, same call stack shape) at the same untestable point, which is itself a data point toward equivalence. Recommend confirming the animation itself in a real browser before this file is considered fully verified. **Not yet cut over.** |
| `modules/shared/button-loading.js` | 0 | 1 | ✅ `src/button-loading.js` | ✅ session 12 (2026-08-10): export-count matches declares-count (2/2 — `eqButtonLoading`, `eqWithButtonLoading`), imports/bundles clean, checksum unchanged. First conversion with a same-file cross-function dependency (`eqWithButtonLoading` calls `eqButtonLoading`) and a module-top-level side effect (one-time `<style>` injection) — both confirmed working correctly under real ESM semantics, not just assumed. Bridge + real jsdom equivalence check (`build/verify-button-loading-bridge.js`) exercised the double-on guard (no clobbering saved state), the never-was-loading no-op, the null-button guard, and — most importantly — `finally`-based restoration and error re-throwing through `eqWithButtonLoading`'s success AND failure paths. Byte-identical between original and bridge on every case. **Not yet cut over.** |
| `supabase-client.js` | 0 | 1 | ✅ `src/supabase-client.js` | ✅ session 13 (2026-08-10): export-count matches declares-count (1/1 — `SupabaseClient`, a namespace object with 2 methods, matching how `db-service.js` actually consumes it). Bridge + real jsdom equivalence check (`build/verify-supabase-client-bridge.js`) exercised the no-config/no-CDN fallback path (`getClient()` → `null`, `resolveProvider()` → `'localStorage'`), a stubbed-CDN configured path (no real network needed), and — the part that actually matters for a "lazy singleton" — confirmed `createClient` is called exactly ONCE despite `getClient()` being called twice, with both calls returning the identical object reference. One test-harness fix needed along the way: `assert.deepStrictEqual` on objects/arrays created inside a jsdom vm-context realm fails even for visually-identical content (different-realm `Object.prototype`/`Array.prototype`) — switched to `JSON.stringify`-based comparison, a real-but-benign test-tooling gotcha, not a behavioral difference (confirmed by inspecting the "identical-looking" failure output before concluding that). **Not yet cut over.** |
| `modules/quest-mascot-lines.js` | 0 | 1 | ✅ `src/quest-mascot-lines.js` | ✅ session 13 (2026-08-10): export-count matches declares-count (6/6 — 3 constants, 3 functions with internal cross-references, e.g. `eqMascotLine` calling `eqMascotLinePool`). Bridge + real jsdom equivalence check (`build/verify-quest-mascot-lines-bridge.js`) exhaustively exercised `eqMascotEmotionFor` across all 9 real trigger-table events (not a sample), the custom-admin-lines layering (confirmed appended after defaults with blanks filtered), and `eqMascotLine`'s `Math.random()`-driven pick — stubbed to a fixed sequence for reproducible comparison, verifying actual index math, not just "returns a string." Same cross-realm `assert` gotcha hit and fixed the same way as `supabase-client.js`, immediately recognized rather than re-investigated from scratch. **Not yet cut over.** |

**This completes every leaf with fan-in ≥ 1** — all remaining unconverted leaves (see below) have fan-in 0, meaning nothing else in the codebase currently depends on them.

| `modules/shared/ambient-backdrop.js` | 0 | 1 | ✅ `src/ambient-backdrop.js` | ✅ session 14 (2026-08-10): export-count matches declares-count (1/1). Same disclosed canvas-rendering limitation as `particles.js` (session 12), more immediate here since `tick()` runs synchronously on the first call rather than deferred — only the two guard-clause paths (null canvas, reduced motion) are exercisable in this sandbox; both confirmed byte-identical between original and bridge. **Not yet cut over.** |
| `modules/core/active-section.js` | 0 | 0 | ✅ `src/active-section.js` | ✅ session 14 (2026-08-10): export-count matches declares-count (1/1 — `ActiveSection`, a 4-method namespace object). First conversion involving `localStorage` and cross-tab `storage` events. Real browsers fire `storage` events in *other* tabs automatically; jsdom doesn't simulate that across separate instances, so the check manually dispatches a `StorageEvent` to exercise the module's actual `window.addEventListener('storage', ...)` handler directly — confirmed it correctly reacts to the right key and ignores unrelated ones. Also verified: same-value `set()` doesn't re-fire listeners, `set(null)` is a no-op, and `initFromURL` picks up a query param on first use but never overrides an already-chosen section. All byte-identical between original and bridge. **Not yet cut over.** |
| `modules/shared/quick-jump.js` | 0 | 0 | ✅ `src/quick-jump.js` | ✅ session 14 (2026-08-10): export-count matches declares-count (1/1). Fully testable in jsdom (no canvas/localStorage) — the equivalence check exercised the missing-DOM no-op guard, Ctrl+K opening the overlay and rendering items, live filtering via input, Escape closing it, and click delegation correctly invoking a result's action and closing the overlay. All byte-identical between original and bridge. **Not yet cut over.** |

**10 of 19 true leaves converted — over halfway.** 9 remain, all fan-in 0: `index.html#inline0`, `modules/leaderboard/hall-of-fame-styles.js`, and the six `*_index.js` aggregator sinks from sessions 9-10's role-split work (`modules/leaderboard/index.js`, `modules/recitation/recitation_index.js`, `modules/attendance/att_index.js`, `modules/boss-studio/bs_index.js`, `modules/world-boss/index.js`, `modules/admin/index.js`).

| `index.html#inline0` | 0 | 0 | ✅ `src/config.js` | ✅ session 15 (2026-08-10): first conversion with no functions at all — pure config (2 Supabase credentials). Export count matches declares count exactly (2/2). Bridge sets the SAME `window.__EDUQUEST_SUPABASE_URL__`/`__ANON_KEY__` globals `supabase-client.js` already reads, not a new naming convention. Equivalence check confirmed exact value match, not just presence. **Not yet cut over.** |
| `modules/recitation/recitation_index.js` | 0 | 0 | ✅ `src/recitation-index.js` | ✅ session 15 (2026-08-10): first of the `*_index.js` aggregator/verification-sink pattern (confirmed as graph sinks in sessions 9-10 — nothing calls into them). No real function exports in the original, just a version-stamp constant and inline load-order verification logic. **Self-correction during this conversion:** an initial draft extracted the verification logic into a second export (`verifyExports`) for reusability — caught before finalizing that this broke the "declared-count matches exported-count exactly" discipline every other conversion has held to (1 declared, would have been 2 exported), reverted to keep the check inline, matching the original's real shape (1/1). Equivalence check exercised BOTH real conditions the verification logic is designed for (dependencies missing → error log; dependencies present → success log), not just "ran without throwing." **Not yet cut over.** |
| `modules/attendance/att_index.js` | 0 | 0 | ✅ `src/attendance-index.js` | ✅ session 15 (2026-08-10): same aggregator-sink pattern as `recitation-index.js`, with one real variation — also checks `typeof window.AttendanceService !== 'object'`, not just function presence. Equivalence check specifically exercised this branch across three real conditions (nothing present, functions present but `AttendanceService` missing, everything present), confirming the object-type check fires correctly on its own, not just alongside the function checks. Export count matches exactly (1/1). **Not yet cut over.** |

**13 of 19 true leaves converted.** 6 remain, all fan-in 0: `modules/leaderboard/hall-of-fame-styles.js` (665 lines) and four more `*_index.js` aggregators (`modules/leaderboard/index.js`, `modules/boss-studio/bs_index.js` [345 lines], `modules/world-boss/index.js` [134 lines], `modules/admin/index.js`).

| `modules/leaderboard/index.js` | 0 | 0 | ✅ `src/leaderboard-index.js` | ✅ session 16 (2026-08-10): third aggregator-sink conversion, with a real variation — `window.Leaderboard = window.EQL` (a convenience alias for the leaderboard engine, guarded so it never overrides an already-set value). Checked directly: nothing else in the codebase consumes `window.Leaderboard` — exported anyway, for consistency with this phase's "declared count = exported count" discipline rather than quietly dropping an unused-today symbol. `window.EQL` is read via real `window.` property access (not a bare identifier), so it's safe under real module scoping regardless of whether `eql-engine.js` has its own `src/` conversion yet. Equivalence check specifically exercised the alias guard across three real conditions: deps missing, deps present with no pre-existing `window.Leaderboard`, and deps present with `window.Leaderboard` already set to something else (confirmed the guard preserves it rather than overwriting, through the full bridge chain, not just the module in isolation). Export count matches exactly (2/2). Same cross-realm `assert` gotcha hit again (an object containing a function failed `deepStrictEqual` despite identical content) — recognized and fixed immediately, third occurrence. **Not yet cut over.** |

**14 of 19 true leaves converted.** 5 remain, all fan-in 0: `modules/leaderboard/hall-of-fame-styles.js` (665 lines) and three more `*_index.js` aggregators (`modules/boss-studio/bs_index.js` [345 lines], `modules/world-boss/index.js` [134 lines], `modules/admin/index.js`).

| `modules/admin/index.js` | 0 | 0 | ✅ `src/admin-index.js` | ✅ session 17 (2026-08-10): fourth aggregator-sink conversion, largest verification list so far (63 expected functions — the header comment's "60" was itself off by 3, discovered while writing this file's equivalence check, not assumed correct). Export count matches exactly (3/3 — `ADMIN_EXPECTED`, `adminMissing`, `MODULE_VERSION`, all confirmed unused elsewhere via grep but exported anyway for discipline-consistency). Equivalence check added a PARTIAL case (exactly half the functions present) beyond the missing/present pattern used for the smaller aggregators — confirmed the logged missing-list is *exactly* the correct absent subset, not just non-empty. **Not yet cut over.** |
| `modules/world-boss/index.js` | 0 | 0 | ✅ `src/world-boss-index.js` | ✅ session 17 (2026-08-10): a genuinely different verification shape from every other aggregator — checks `typeof window[sym] === 'undefined'` (accepts ANY defined value: object, string, function), not `!== 'function'` like admin/recitation/attendance. Preserved exactly, not normalized to match the other files. Export count matches (2/2 — `VERSION`, `SIGNAL_KEYS`, an undocumented-elsewhere localStorage-key registry, exported for consistency though unused). Equivalence check specifically set every required symbol to a *non-function object* and confirmed the check still reports success — the exact behavior that would silently break if this file were normalized to match the other aggregators' function-only pattern. **Not yet cut over.** |
| `modules/boss-studio/bs_index.js` | 0 | 0 | ✅ `src/boss-studio-index.js` | ✅ session 17 (2026-08-10): largest conversion in the phase (345 lines — 3 separate IIFEs: CSS injection with a 250+ line inline stylesheet, DOM scaffold injection for the boss editor overlay, and verification with a *third* distinct check variant: `!== 'function' && !== 'object'`, accepting either). Generated **programmatically** rather than hand-retyped, to guarantee byte-exact preservation of the large CSS/HTML template literals — verified byte-identical to the original except the one intentional line (version stamp → exported constant) via direct string comparison, not by eye. Export count matches (1/1). Equivalence check covered three distinct real behaviors: CSS injection idempotency, DOM scaffold idempotency (both re-evaluated the source a second time and confirmed no duplication), and the function-OR-object verification check exercised in all three real shapes. **Not yet cut over.** |
| `modules/leaderboard/hall-of-fame-styles.js` | 0 | 0 | ✅ `src/hall-of-fame-styles.js` | ✅ session 17 (2026-08-10): the 19th and final originally-identified true leaf. Simplest conversion in the whole phase — zero declared symbols, pure static CSS injection, no exports at all (the bridge is a bare side-effect import). Generated programmatically like `bs_index.js`, confirmed byte-identical to the original via direct comparison. One thing specifically checked rather than assumed: this file, unlike every guarded aggregator, has **no idempotency guard** at all in the original (confirmed via grep — zero `if` statements). The equivalence check verified the original's real, unguarded re-evaluation behavior (a second `<style>` tag DOES get appended) is preserved exactly in the bridge too — not silently "fixed" into a guarded version during conversion. **Not yet cut over.** |

## Step 5.3 — ALL 19 originally-identified true leaves converted (session 17, 2026-08-10)

Every leaf from `PHASE7_DEPENDENCY_MAP.md`'s original candidate list now has
a verified `src/` conversion: real ESM export syntax, a bridge re-attaching
every export to `window` for not-yet-converted consumers, and a real jsdom
behavioral equivalence check — not a syntax check — comparing the original
classic file against the bundled bridge. All 19 pass together as a single
regression sweep, alongside the unchanged legacy concat build (185/185
unit tests, unaffected) and the earlier `dom.js`/full-bundle verification
work from sessions 6-10.

**What this took, honestly:** not every file was a clean copy-paste.
Sessions 12 and 14 disclosed real, sandbox-specific verification gaps
(canvas rendering untestable without a native package neither build could
exercise). Session 15 caught and reverted a real drift from the
established discipline before it shipped. Session 16 hit the same
cross-realm `assert` gotcha three separate times and got faster at
recognizing it each time. Session 17 found the admin aggregator's own
header comment was wrong about its own function count. None of these were
hidden or smoothed over in the retelling — each is in its own session's
log entry, in its own conversion's tracker row.

**What ISN'T done yet, as of session 17:** none of the 19 converted files
are wired into `index.html` or any shipping entry point — per Principle
8, that only happens at the single deliberate cutover event, and this
phase isn't there yet. Everything past the leaves (files whose fan-out
isn't zero — the vast majority of the codebase, since 19 leaves out of
136 total units is a small fraction) requires the SAME conversion
discipline applied to files that themselves depend on other,
not-yet-converted files — a materially different and harder problem than
leaf conversion, not yet started as of session 17. Step 5.4's per-role
bundling (sessions 9-10) still has the documented aggregator-sink
limitation for two of the files converted this session (though converting
them doesn't automatically fix that limitation — the role-split closure
computation is a separate tool that would need re-running against the
now-larger `src/` tree to see if anything changed). Steps 5.5/5.6 (lint
gates, CI) still haven't started.

## Step 5.3 — beyond leaves: the first non-leaf conversion (session 18, 2026-08-10)

With all 19 original leaves converted (session 17), the next tier is
files that depend on OTHER, not-yet-converted files — the harder problem
flagged as unstarted at the end of session 17. `utils.js` was the first
one ready: fan-out 1, its single dependency (`dom.js`) already converted,
and fan-in 72 (second-highest in the entire codebase) — high value for
being the first instance of this pattern.

**Real difference from every leaf conversion:** `csvDownload()` calls
`toast()`, which is `src/dom.js`'s real export. `src/utils.js` uses a
genuine `import { toast } from './dom.js';` — the actual module-graph
edge this phase has been building toward, not a window-read. Confirmed
via the bundled output that `toast`'s function body is really pulled in
by esbuild's module resolution, not just referenced hopefully.

**Real sandbox gap found and worked around, not skipped:** `csvDownload()`
calls `URL.createObjectURL()`, which jsdom doesn't implement (confirmed:
`Blob` itself works fine, only `createObjectURL`/`revokeObjectURL` are
missing — a narrower gap than sessions 12/14's canvas limitation).
Added a minimal standard stub in the test harness only (not touching any
source file) so the real download-triggering logic — and critically, its
internal `toast()` call — could actually be exercised end to end, rather
than settling for guard-clause-only verification. This is different from
the particles.js/ambient-backdrop.js precedent: there the gap was
un-work-aroundable (real canvas rendering), here it was a two-line stub
away from full coverage, so the fuller path was taken.

**Bridge composition note, disclosed rather than hidden:** because
`utils.bridge.js` is bundled independently (its own esbuild invocation,
separate from `dom.bridge.js`), the bundled output contains its OWN copy
of `dom.js`'s `toast` function inline — used only internally by
`csvDownload`, never re-exposed on `window` by this bridge (confirmed:
`window.toast` does not appear in `utils.bridge.js`'s output). This is
expected, correct behavior for per-file bridge testing, not a duplicate-
symbol bug — a real eventual full bundle (session 8's approach) would
naturally de-duplicate shared imports across a single module graph;
today's isolated per-file bridges don't need to, since each is verified
independently and none are live in production yet.

| `utils.js` | 1 (`dom.js`) | 72 | ✅ `src/utils.js` | ✅ session 18 (2026-08-10): first non-leaf conversion — real `import { toast } from './dom.js'` between two `src/` files, not a window-read. Export count matches exactly (7/7: `uid`, `_esc`, `_cssColor`, `todayStr`, `nowStr`, `isoDate`, `csvDownload`). Equivalence check added a minimal `URL.createObjectURL`/`revokeObjectURL` stub (jsdom doesn't implement them; `Blob` itself does) to verify `csvDownload`'s real behavior end to end, including confirming its internal `toast()` call actually fires with correct content — not just that the function runs without throwing. **Not yet cut over.** |

**19 leaves + 1 non-leaf (20 files total) converted.** 117 non-leaf units
remain, all still fan-out > 0 with at least one not-yet-converted
dependency — this is the actual bulk of the phase's remaining work, not a
short tail.

## Full real bundle — proven, session 8 (2026-08-10)

Step 5.4's actual mechanism (side-effect-importing every classic file plus
a real import+bridge for converted `src/` files into ONE real esbuild
bundle) is now built and verified against the ACTUAL `index.html` DOM —
not a syntax check, real execution:

- `build/generate-full-entry.js` — generates `build/entry.full.js`
- `dist/app.full-bundle.js` — the real bundle (esbuild `--bundle
  --format=iife`), 1282 global-surface properties vs. legacy's 1752 (see
  below for why fewer is correct, not a bug)
- `build/verify-full-bundle.js` — evaluates BOTH the legacy concat build
  and the real bundle against the real `index.html` `<body>` in separate
  jsdom windows, diffs the resulting global surface
- **Result: both evaluate without throwing. Zero of the 471
  "legacy-only" properties have any real cross-file consumer** (checked
  rigorously against the full dependency graph, not sampled) — they're
  internal, module-private helper functions that leaked onto `window`
  under classic-script scoping purely as a side effect, never actually
  read by anything else. Real modules correctly stop that leak; this is
  proper encapsulation working as intended, not a regression. One extra
  property in the bundle direction (`_bsRenderFormModal`) is a benign
  null-vs-set timing artifact between two separate snapshot runs.

Getting here required three rounds of real bug-hunting, all found by
actually EXECUTING the bundle, not by the static analysis alone — see the
session 8 log entry for the full story (a root-cause bug in the analysis
tooling itself, a same-file-IIFE false positive, and a conditional-guard
blind spot that static analysis fundamentally can't see). This is the
strongest evidence yet that **real execution testing remains necessary**
even with a thorough static audit — the audit is a strong first pass, not
a substitute.

## Next: what step 5.4 still needs

The full bundle exists and is verified, but it currently imports EVERY
classic file (135 of them) as side effects, with only `dom.js` going
through a real `src/` conversion. Per-role splitting (separate
`student`/`admin` entry points) still needs the actual entry-point
logic built on top of `generate-full-entry.js`'s approach — this proved
the MECHANISM works; role-based subsetting is separate, not-yet-started
work.

## Per-role closure analysis — real progress, real remaining gap (session 9, 2026-08-10)

Built `build/compute-role-split.js`: seeds a traversal from nav.js's real
routing table (every `id==='s-...'`/`id==='a-...'` branch, hand-
transcribed, not guessed from directory names — matching the §8.2
decision), walks the real dependency graph from each role's render
functions.

**First run: 100% overlap** (student and admin closures identical, 109/109
units each). Traced it: `nav.js` is a genuine, legitimate hub — one shared
router whose routing table references EVERY role's render function by
bare name in a single if/else chain (43 direct dependency edges, ~4x any
other file in the codebase). A student session never takes the
`else if(id==='a-boss-studio')` branch, so nav.js referencing
`renderBossStudio` there is completely safe at runtime — it's a static-
analysis artifact of one shared file legitimately handling both roles'
dispatch, not a real per-role dependency. Naive transitive closure through
nav.js pulls in its full 43-edge fan-out for BOTH roles, collapsing any
real distinction.

**Fixed:** treat `nav.js` as a required-shared boundary node — included
directly in both closures (both roles obviously need navigation), but its
own outgoing edges aren't followed for splitting purposes. Re-ran:
student closure 74, admin closure 105, 71 shared, 3 student-only, 34
admin-only, 28 in neither closure — a real, meaningful split for the
first time.

**Remaining, more fundamental gap, found by inspecting the "neither role"
list rather than trusting the count:** it's full of files that are
*obviously* role-specific and should not be uncategorized —
`modules/admin/student-manager.js`, `modules/admin/analytics.js`,
`modules/boss-studio/bs_editor.js`, and nearly every module's own
`index.js` aggregator (`modules/admin/index.js`,
`modules/leaderboard/index.js`, `modules/world-boss/index.js`, etc.).
Traced `bs_editor.js` specifically: nothing in `bs_library.js`'s
reachable chain calls into it via any bare identifier the dependency
graph can see — its only real call site is a self-call within its own
file. It's needed by the boss-studio feature regardless, wired in some
other way (most likely via `bs_index.js`, a pure verification/aggregator
file that depends on ALL its siblings for its own "all exports verified"
check but that nothing else calls INTO — a graph *sink*, unreachable from
any render-function-seeded traversal no matter how correct the rest of
the graph is).

**This means the per-symbol call-graph approach (however carefully built
and already twice fixed this session) has a structural blind spot for
this codebase's own `*_index.js` aggregator convention** — these files
are common across nearly every module (`ach_index.js`, `att_index.js`,
`campaign_index.js`, `recitation_index.js`, `shop_index.js`,
`titles_index.js`, etc. — essentially the whole "neither role" list is
dominated by this one pattern), and a pure reachability graph will never
correctly attribute them to a role, regardless of further per-symbol
refinement.

**Conclusion: did NOT generate or ship actual `student.entry.js`/
`admin.entry.js` bundles this session.** Doing so on top of a
demonstrably incomplete closure would mean presenting an unverified split
as safe — exactly the mistake session 8's real-execution testing was
built to catch, and it would be dishonest to skip that same discipline
here just because the closure computation itself looked complete on its
own terms.

**Recommended fix for next session, not yet implemented:** switch to (or
layer on top of) directory-based grouping as a coarser, more reliable
signal specifically for this codebase's structure — if any file in a
`modules/<feature>/` directory is reachable from a role's closure,
include every file in that directory. This sidesteps the aggregator/sink
problem entirely (a feature's `index.js` ships whenever any of its
siblings do, regardless of whether the call graph can see the edge into
it) and matches how this app is actually organized (one directory per
cohesive feature, consistently, throughout). The per-symbol call graph
remains valuable for everything ELSE this phase uses it for (leaf
selection, window-export safety, dead-code candidates) — this is a
narrower, role-splitting-specific limitation, not a reason to distrust
the graph generally.

## Real per-role bundles generated and verified (session 10, 2026-08-10)

Implemented the directory-grouping fix session 9 recommended, then
refined it twice more after checking the actual output against real
files rather than trusting the numbers:

1. **First attempt (blanket grouping):** include every sibling once any
   file from a directory is in the closure. Fixed the sink problem
   (`bs_editor.js` now reachable) but overcorrected — 100% overlap
   collapsed to near-100% shared (119/136), because directories with even
   ONE genuinely-shared file (e.g. boss-studio's `bs_bve_engine.js`, a
   rendering engine legitimately used by both student battle-viewing and
   admin battle-editing code — confirmed via 10 real call-graph edges
   from world-boss files) pulled their ENTIRE directory into both roles.
2. **Second attempt (sinks only):** only expand files with zero fan-in
   across the whole graph — real files like `bs_bve_engine.js` are left
   to the ordinary call graph (which already places them correctly).
   Better, but `bs_editor.js` still leaked into student's closure: any
   single shared file in a directory was still enough to trigger sink
   expansion for that whole role.
3. **Third attempt (majority threshold):** only expand sinks into a
   closure that already holds a majority of the directory's non-sink
   files. Checked directly why this still didn't fully separate
   boss-studio: student's closure genuinely touches 3 of its 4 real
   files (`bs_storage.js`, `bs_animation_library.js`, `bs_bve_engine.js`
   — everything except `bs_library.js`, the actual editor's declared
   entry point) — a real majority by any reasonable threshold, because
   boss-studio's internal structure has more shared rendering
   infrastructure than admin-exclusive surface.

**Decision: stopped refining the heuristic here.** This is a genuinely
hard, borderline case, not a bug with a clean fix — boss-studio mixes
shared utilities and admin-only UI in one directory more than any other
feature in the codebase. Rather than keep chasing a perfect general rule,
made an explicit, safety-driven call: over-inclusion is a safe failure
mode (unused code shipped, bundle slightly larger than optimal);
under-inclusion is not (a missing file throws, per every real bug session
8 found). `bs_editor.js`/`bs_index.js` (2 files) land in both bundles as
a known, documented, harmless imperfection. The 5 files the closure
computation couldn't attribute to either role at all (`error-capture.js`,
`index.html#inline0`, `modules/admin/analytics.js`,
`modules/admin/teacher-invite-service.js`, `recovery.js`) are added to
both bundles by the same safe-default policy, documented explicitly in
`build/generate-role-entries.js` rather than silently applied.

**Built and verified real bundles:**
- `build/generate-role-entries.js` generates `build/entry.student.js` /
  `build/entry.admin.js` from the role-split data plus the safe-default
  policy above.
- Bundled with esbuild: `dist/app.student-bundle.js` (96 files, 1.5MB)
  and `dist/app.admin-bundle.js` (131 files, 2.1MB) vs. the full bundle's
  136 files / 2.2MB — **a real 32% size reduction for the student
  bundle**, the actual deliverable the Phase 7 spec asked for ("a
  student's browser downloads all admin/boss-studio/quiz-builder code on
  every login").
- `build/verify-role-bundles.js` — same real-execution discipline as
  session 8's `verify-full-bundle.js`: evaluates both bundles against the
  actual `index.html` body in jsdom. **Both evaluate without throwing.**

This is real, checked progress — the first actual per-role bundles this
phase has produced, not just a proven mechanism. Not yet exercised beyond
the boot sequence (no simulated page navigation/click-through per role),
and not yet wired into `index.html` at all, per Principle 8 — that only
happens at the single deliberate cutover event.
