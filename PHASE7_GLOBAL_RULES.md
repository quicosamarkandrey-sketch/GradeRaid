# Phase 7 — Global Rules (read this every session, nothing else project-wide)

These rules are shared by all 4 streams. Read this + your own stream guide
+ your own `.agent-memory/stream-X/MEMORY.md`. Nothing else, unless the
task at hand genuinely requires it. Don't read the other streams' guides
or memory files, don't read the full session-by-session refactor log,
don't read `PHASE7_DEPENDENCY_MAP.md` in full — the specific facts you
need are either below, in your file list, or faster to get by running a
command than by reading a document.

## What this is

`eduquest` is migrating from classic `<script src>` globals to real ES
modules, one file at a time, without ever touching what's live. 20 files
are already converted — **read 2 or 3 of them before converting your
first file; they are the spec, not this document**:

- `src/dom.js` + `build/bridges/dom.bridge.js` + `build/verify-dom-bridge.js`
  — simplest case, pure functions.
- `src/utils.js` + its bridge + its verify script — the one case with a
  real `import` from another converted file (`dom.js`).
- `src/admin-index.js` (or any `*-index.js` in `src/`) — the
  verification/aggregator-sink shape, if a file on your list looks like
  this.

The pattern in those three files *is* the spec. If your file doesn't
match any of them closely, use judgment and stay consistent with the
spirit (verbatim body, real exports, a bridge, a real behavioral check)
rather than looking for a fourth example that doesn't exist yet.

## The one rule that matters most: the `window` fallback

Every real symbol in this codebase already has a confirmed, explicit
`window.X =` export somewhere (verified codebase-wide in an earlier
session). This means:

- **A dependency outside your own file list** → reference it as a bare
  identifier (`toast(...)`, not `import`). It resolves via `window` at
  runtime in both the original and your conversion, regardless of
  whether another stream has converted it yet or ever will. This is not
  a workaround, it's how 19 of the first 20 conversions in this project
  already worked.
- **A dependency inside your own file list, already converted by you** →
  real `import` is better where a clean order exists.
- **A dependency inside your own list that depends back on the file
  you're converting** (a real cycle — check with a quick grep for the
  symbol name in both directions if unsure) → fall back to `window` for
  that pair too. Don't force an import through a cycle. Your stream guide
  names any cycles already found in your assignment; more may exist that
  weren't caught — trust a quick check over the list if they disagree.

You never need to know or check another stream's progress to follow this
rule. That's the entire point of it.

## Per-file checklist (every file, no exceptions)

1. Find the original file. Check what it exports today: grep it for
   `window\.\w+\s*=` and top-level `function`/`const`/`class`
   declarations, or run `node build/dependency-map.js` and look up its
   `declaresCount` in `dist/dependency-map.json` if you want a second
   check.
2. Create `src/<same relative path>`. Copy function bodies verbatim —
   this is a move, not a rewrite. For files with large static content
   (big CSS/HTML strings), generate the conversion with a small script
   that does a targeted find-replace on the original text rather than
   hand-retyping it, then diff the result against the original to
   confirm nothing else changed.
3. **Export count must equal the number found in step 1, exactly.** If
   something looks unused elsewhere, export it anyway — don't silently
   drop it.
4. Sanity-check the module loads: `node --input-type=module -e
   "import('./src/your-file.js').then(m=>console.log(Object.keys(m)))"`
5. Sanity-check it bundles: `npx esbuild src/your-file.js --bundle
   --format=esm --outfile=/tmp/check.js && node --check /tmp/check.js`
6. Confirm the original is untouched: `md5sum` before/after your
   session, and `node --check` on the original.
7. Build the bridge (`build/bridges/<name>.bridge.js`): import every
   real export, re-attach every one to `window`. Bundle it: `npx esbuild
   build/bridges/<name>.bridge.js --bundle --format=iife --outfile=
   dist/bridges/<name>.bridge.js && node --check` the output.
8. Write `build/verify-<name>-bridge.js`: load the original into one
   jsdom window, the bundled bridge into another with identical starter
   DOM, drive both through the same real calls — edge cases too, not
   just the happy path — `assert.deepStrictEqual` the results. Async
   code: await real timing, don't fake it.
   - jsdom gotcha: `assert.deepStrictEqual` can fail on two
     content-identical objects if they came from different jsdom vm
     realms. Compare via `JSON.stringify` instead if you hit this — it's
     not a real bug.
   - jsdom gap: no real 2D canvas (`getContext('2d')` returns `null`),
     no `URL.createObjectURL`/`revokeObjectURL` (though `Blob` works). If
     a file needs either, say so in the check's comments, verify what
     you can (guard clauses, setup), stub `createObjectURL` with a
     2-line mock if that's all that's blocking full coverage — don't
     stub or fake canvas rendering, just disclose the gap.
9. Run the check. It must print PASSED. Read the output — don't just
   check the exit code.

## Hard boundaries

- Never edit `index.html` or any classic (non-`src/`) file's contents.
- Never edit another stream's files or `.agent-memory/` directory.
- Never edit `EduQuest_Engineering_Refactor_Log.md` or
  `PHASE7_SRC_CONVERSION_TRACKER.md` — a separate merge step handles
  those once, after all streams finish. Your own `HANDOFF.md` is what
  that step reads.
- Nothing gets wired into `index.html`. That's a single later event, not
  part of this work.

## Your operating loop, every session

1. Read: this file, your stream guide, your `MEMORY.md`. Nothing else
   by default.
2. Work through your file list, applying the checklist above.
3. Before stopping: run your own local regression (`node build/concat.js
   && node --check dist/app.legacy-concat.js`, `node --test
   tests/unit/**/*.test.js` — both must be unaffected/unchanged from
   baseline, since you haven't touched anything they depend on), and
   every equivalence check you've written so far, together.
4. Compress `MEMORY.md` — replace, don't append. It should let your next
   session continue without re-reading this whole loop's history. Keep
   it under ~700 words: what's genuinely non-obvious, what's unresolved,
   what you'd forget otherwise. Not a log of what you did.
5. Write/update `HANDOFF.md` (same directory as `MEMORY.md`): current
   state for the coordinator. Overwrite each session, don't append.
   Use this shape:

   ```markdown
   # Stream X Handoff — last updated: <date>

   ## Done (N / total)
   - modules/foo/bar.js
   - modules/foo/baz.js

   ## Remaining (total - N)
   - modules/foo/qux.js
   - ...

   ## Blockers / deviations from the guide
   (none, or specifics — e.g. "file X wasn't on the list, added it" /
   "file Y doesn't exist anymore, skipped")

   ## Last regression run
   - `node --test tests/unit/**/*.test.js`: 185/185
   - `node build/concat.js && node --check dist/app.legacy-concat.js`: clean
   - All N of this stream's equivalence checks: PASSED
   ```
6. Stop.
