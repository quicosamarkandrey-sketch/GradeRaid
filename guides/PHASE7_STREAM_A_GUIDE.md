# Stream A — Core Infrastructure

Read `PHASE7_GLOBAL_RULES.md` first. This document only adds what's
specific to your assignment.

## Why this is highest-stakes, not highest-risk

`modules/core/state-manager.js` has 84 fan-in — the most depended-upon
file in the codebase. `db-service.js` has 41. Nothing you do can break
production (originals stay untouched, nothing gets cut over), but this
is the group most worth double-checking your equivalence checks actually
exercise real behavior, not just structure.

## Known real cycle in this list

`nav.js`, `auth.js`, `index.html`'s two inline blocks, and
`modules/core/state-manager.js` genuinely depend on each other in both
directions. There is no clean order for this five-way cluster. Use the
`window` fallback between them specifically — don't hunt for an order
that doesn't exist.

`index.html#inline1`/`#inline2` refer to the 2nd and 3rd inline
`<script>` blocks in `index.html` (the 1st, pure config, is already
converted as `src/config.js`). Extract their current text with
`node build/generate-full-entry.js` (writes `build/inline/inline{1,2}.js`)
before converting them, or extract manually — they're real, ordinary
JS once isolated.

## File list — 29 files, in a computed rough order (leaf-like within this list first; not a strict requirement given the cycle above)

1. `repository/pull-mappers.js`
2. `dsm-service.js`
3. `modules/shared/mascot-lines-service.js`
4. `repository/realtime-groups.js`
5. `error-capture.js`
6. `recovery.js`
7. `modules/mail/index.js`
8. `modules/core/state-manager.js`
9. `repository/table-sync.js`
10. `modules/attendance/attendance-recitation-log.js`
11. `db-service.js`
12. `student-stats.js`
13. `db-schema.js`
14. `topbar.js`
15. `modules/shared/reward-presenter.js`
16. `modules/shared/notification-service.js`
17. `db-migrations.js`
18. `modules/recitation/progress.js`
19. `modules/recitation/logger.js`
20. `index.html#inline1`
21. `modules/attendance/attendance-service.js`
22. `app-state.js`
23. `modules/attendance/att_scanner_rfid.js`
24. `modules/mail/student-inbox.js`
25. `modules/mail/admin-compose.js`
26. `modules/mail/mail-engine.js`
27. `auth.js`
28. `nav.js`
29. `index.html#inline2`
