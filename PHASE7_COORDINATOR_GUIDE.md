# Phase 7 Parallelization — Coordinator Guide

## What changed from the first version of this system

The first draft used one large guide per stream (each repeating the full
methodology, ~200+ lines apiece) and a single append-forever log file per
stream. That's wasteful to re-read every session and grows without bound.
This version separates:

- **`PHASE7_GLOBAL_RULES.md`** — the methodology, written once, read by
  all 4 agents every session. Points to real converted files in the repo
  as the actual specification rather than re-describing the pattern in
  prose.
- **`guides/PHASE7_STREAM_X_GUIDE.md`** — just the file list and
  stream-specific facts (real cycles found, files already done). ~50
  lines each now, not ~220.
- **`.agent-memory/stream-X/MEMORY.md`** — private, compact (under ~700
  words), continuation state for that stream only. **Replaced each
  session, not appended to.** This is what lets a stream resume without
  reconstructing its history from scratch.
- **`.agent-memory/stream-X/HANDOFF.md`** — a status snapshot for you,
  the coordinator. Also replaced each session. This is what you read to
  check progress without pulling a stream into a conversation.

No stream reads another stream's guide, memory, or handoff file during
normal work. They don't need to — the `window`-fallback rule (in global
rules) means no stream is ever blocked on another's progress.

## Setup

Give each of your 4 Claude accounts, in a fresh conversation:

1. The current project zip (unzip so `PHASE7_GLOBAL_RULES.md` and
   `guides/` sit at the project root, `.agent-memory/` alongside them).
2. A message like: *"Read `PHASE7_GLOBAL_RULES.md`, then
   `guides/PHASE7_STREAM_A_GUIDE.md`, then
   `.agent-memory/stream-a/MEMORY.md`. Follow the operating loop at the
   bottom of the global rules file."* (Swap the letter per account.)

That's the entire instruction. The documents carry the rest.

## Checking progress without interrupting a stream

Read `.agent-memory/stream-X/HANDOFF.md` for that stream's current
done/remaining list and last regression result. You don't need to open a
conversation with that stream's Claude instance to know where it stands.

## When all 4 streams report done (or you're ready to merge partial progress)

1. Combine all 4 streams' new files into one working copy: their
   `src/*.js`, `build/bridges/*.js`, `dist/bridges/*.js`, and
   `build/verify-*.js` files. Since each stream only ever *creates* new,
   distinctly-named files (never edits a shared file), this is a plain
   union — copy everything from all 4 sources into one tree, no manual
   conflict resolution should be needed. If two streams somehow produced
   a file with the same name, that's the one thing worth manually
   checking before proceeding.
2. Regenerate the dependency map fresh: `node build/dependency-map.js`.
3. Run the full regression: `node build/concat.js && node --check
   dist/app.legacy-concat.js`, then `node --test tests/unit/**/*.test.js`
   (expect 185/185, unaffected — nothing here touches production files).
4. Run every equivalence check from every stream together: `for f in
   build/verify-*-bridge.js; do node "$f"; done`. Every one, from every
   stream, must say PASSED.
5. Fold each stream's `HANDOFF.md` into `EduQuest_Engineering_Refactor_Log.md`
   as a dated session entry, and update `PHASE7_SRC_CONVERSION_TRACKER.md`'s
   status table with the newly-converted files. This is the one place a
   human (or a fifth, dedicated Claude session given just the 4
   `HANDOFF.md` files and the two master docs) does real synthesis work —
   budget accordingly, but it's mechanical, not judgment-heavy.
6. Delete the `.agent-memory/` directory once folded in, so it doesn't
   linger as a second, stale source of truth.

## What NOT to do

- Don't let a stream touch `index.html` or any classic (non-`src/`)
  file — nothing gets cut over until a single later, deliberate event,
  well after all parallel conversion work (this included) is done and
  merged.
- Don't ask streams to coordinate with each other mid-flight if you
  notice apparent overlap (rare, given the partition, but
  `modules/core/state-manager.js` and `modules/admin/*-service.js` files
  reference each other across the Stream A/B boundary, for instance) —
  let the `window` fallback handle it, exactly as designed.
- Don't skip the post-merge regression run. Each stream verifies its own
  work in isolation; only the merge step proves nothing collided.

## Spot-checking quality across 4 sessions you can't watch in real time

Pull up 2-3 of each stream's `build/verify-*-bridge.js` files at merge
time. The single best quality signal in this whole project has been
whether an equivalence check exercises *real behavior* (calls the
function, asserts on real output, including edge cases) versus just
confirming a module imports without throwing. If a stream's checks look
thin, that stream's conversions are worth a closer look before trusting
them, even if every check technically says PASSED.
