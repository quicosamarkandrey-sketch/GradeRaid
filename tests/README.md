# EduQuest — Test & Lint Infrastructure (Phase 0)

This is the Phase 0 "safety-net" deliverable from
`EduQuest_Engineering_Refactor_Log.md` / `Phase_0_Safety_Net_Infrastructure.md`:
a test harness + starter smoke tests + lint config, added with **zero
changes to app behavior**, so every later refactor phase has a tripwire.

## Setup

```bash
npm install
npx playwright install chromium   # one-time, downloads a browser binary
cp .env.example .env               # fill in a TEST/STAGING Supabase project's
                                    # test student + admin account credentials
```

## Running

```bash
npm run test:unit    # node:test + jsdom — pure-logic functions (utils.js), no network, always runs
npm run test:smoke   # Playwright — real browser, real (test-project) Supabase, needs .env
npm run lint         # ESLint flat config — 3 audit-targeted rules, see eslint.config.js
npm test             # unit + smoke
```

## What's covered so far

**Unit (`tests/unit/`)** — pure functions loaded from the real `utils.js` into
a jsdom `window` (not reimplemented — regressions in the actual file break
these):
- `eqGradeAnswer` / `eqNormalizeAnswer` — quiz grading for every question
  type (mc/tf/id/enum/match), including partial credit and normalization
  edge cases. This is the function that decides whether a student earns
  XP/coins for an answer.
- `computeAttendanceStreak` / `getStudentAttendanceRecords` — streak math
  and Excused/Early/On-Time/Late normalization.
- `recalcStudentStats` — tier-from-level thresholds, quiz average, and
  attendance %, including the `opts.attendanceLogs` draft-callback override
  and the legacy `attendanceSessions` fallback path.

**Smoke (`tests/smoke/`, Playwright)** — drives the real `index.html` in a
real browser, against a real test/staging Supabase project (network is
NOT mocked — see the comment at the top of `playwright.config.js` for why):
- Student and admin/teacher login → `bootApp()` → dashboard render, with a
  hard fail on any uncaught page error.
- Wrong-password path shows the error message rather than a silently dead
  button.
- Achievement claim (skips with a clear reason if the test account has
  nothing unclaimed to claim against).
- A primary-nav sweep for both roles — every major admin and student page
  renders non-empty with no page errors.

## What's NOT covered yet (by design — floor, not ceiling)

Per the Phase 0 plan, this is deliberately a starting set, not full
coverage. Not yet covered: shop purchase, world-boss damage submission, and
the XP/coin server-sync RPC round trip end-to-end (the grading/stat *logic*
that feeds those flows IS covered above — the network round trip isn't).
Add to these suites as each later refactor phase touches that code, rather
than trying to backfill everything up front.

## Lint

`eslint.config.js` intentionally starts small — three rules tied directly to
audit findings (duplicate top-level function names across files, raw
`.innerHTML =` bypassing the `_esc()` helper, and direct `DB.*` mutation
outside the state layer). `no-undef` is off on purpose: every file here is a
plain global `<script>`, so nearly everything looks "undefined" to a
single-file linter until Phase 7 (module system) lands. See the comments in
that file for the reasoning behind each rule and its scope.
