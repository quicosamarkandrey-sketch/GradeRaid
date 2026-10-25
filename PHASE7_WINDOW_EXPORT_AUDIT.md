# Phase 7 — Window-Export Audit (session 7)

Generated 2026-08-12T11:10:00.280Z by `build/audit-window-exports.js`. Regenerate any time source changes.

**432 names have real cross-file consumers** (at least one other unit references them as a free global, and something in the codebase actually declares them). Of those:
- **432** already have an explicit `window.X =` on at least one declarer — safe today, safe under real bundling.
- **0** do not — these only work today because their declaring file is an unwrapped classic script. Any of these files being side-effect-imported into a real esbuild bundle would silently break every listed consumer.

## Fix priority — declaring files ranked by how many at-risk symbols they'd need to export (0 files affected)

| file | symbols needing `window.X =` |
|---|---|

## Full at-risk list (0), sorted by consumer count

| symbol | effective declarer | consumers | all declarers |
|---|---|---|---|
