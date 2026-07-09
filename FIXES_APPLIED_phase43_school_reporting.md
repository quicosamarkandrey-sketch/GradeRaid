# FIXES APPLIED — Phase 43: School-Wide Reporting (Chunk F)

(ISOLATION_ROLES_PLAN.md §11 "School-wide reporting", §12 step 5 — the last
chunk in the agreed build order A → B → E → C → D → F.)

## What this chunk covers
Two items from §11's "School-wide reporting" group:
1. **Aggregate analytics rollup** — restored as admin's explicit "all
   sections" mode, once Analytics is (already) teacher-scoped by default.
2. **Cross-teacher registrations queue** — an explicit "reassign to a
   different section/teacher before approval" action, since a
   registration's target section might be wrong at signup time.

## What was already true before this chunk (confirmed, not changed)
Both items' underlying *data access* already worked with zero schema
changes, because of how Phase 14/33 built section scoping:
- `profiles_select_scoped` (Phase 14) has no per-teacher filter for
  `role = 'admin'` — an admin session's `DB.students` was already every
  student in the school, always. There was just no UI that broke that
  blended pile of students down by section/teacher, and no way to see it
  labeled as the aggregate it already was.
- `registrations_select_own_or_staff` (Phase 33) is the identical shape —
  `is_staff_for_section()` resolves to `true` for `role = 'admin'`
  regardless of `class_id`, so an admin's `DB.registrations` was already
  every pending signup school-wide, per §1's original decision. The
  "cross-teacher queue" was already there; it just wasn't labeled as such,
  and had no action to fix a wrong section before approving.

## What changed

**`supabase/phase43_school_reporting.sql`** (new)
- `reassign_registration(p_reg_id, p_new_class_id)` — admin-only
  (`is_admin()`), only callable on a still-`pending` registration. Takes a
  real `class_sections.id` (not a grade/section string pair) and
  re-derives `grade_level`/`section` from that row, so the two columns can
  never drift apart the way a hand-typed pair could. Logs to `audit_log`
  with `action = 'transfer'`, same shape as Chunk D's
  `reassign_section_adviser()`/`transfer_teacher_ownership()` — this is a
  consequential cross-teacher action, so (per phase40's note that Chunk F
  "gets its own logging (if wanted)") it does.
- Nothing else needed a migration — see the "already true" section above.

**`modules/admin/registrations-service.js`**
- Added `RegistrationService.reassign(regId, newClassId)`, calling
  `reassign_registration()`. Same shape as `approve()`/`reject()`.

**`modules/admin/registrations.js`**
- **Admin-only cross-teacher context**: `renderAdminRegistrations()` now
  lazily loads the teacher directory once per admin session
  (`_regEnsureTeacherMap()`, same cache-once pattern
  `content-oversight.js`'s picker and `audit-log.js`'s teacher filter
  already use) and annotates every pending row with its section's adviser
  name (`_regAdviserLabel()`) — so an admin looking at "every section,
  school-wide" can actually tell whose queue each request belongs to,
  instead of just a grade/section string. A teacher's own Registrations
  screen is unaffected (never fetches the directory, never shows this —
  every row they see is already their own section).
- Header now reads "Every section, school-wide" for admin sessions, making
  the already-true cross-teacher scope explicit rather than implicit.
- **Reassign action**: a `🔀 Reassign` button, admin-only, next to
  Approve/Reject on pending rows (both the list and the detail modal).
  Opens `regAdminReassignModal()` — a dropdown of every non-archived
  section (from the same `AppStore.classSections` slice the public
  registration form's grade→section cascade already uses), annotated with
  each section's adviser name where known. Confirming calls
  `RegistrationService.reassign()` and updates the local `DB.registrations`
  row's `gradeLevel`/`section`/`classId` to match, same "RPC first, then
  mirror the authoritative result into local state" pattern
  `regAdminApprove()`/`regAdminConfirmReject()` already use.
- Defense in depth: the button only renders for `currentRole === 'admin'`,
  and both new window functions early-return if `currentRole !== 'admin'`
  — the real enforcement is server-side (`is_admin()` in the RPC), same
  posture as every other admin-only action in this app.

**`modules/admin/analytics.js`**
- **Bugfix**: the header label was hardcoded to `"Grade 8-A"` regardless of
  who was logged in. `student-manager.js` (Command Center) already got the
  `getMySectionsLabel()` fix when Phase 33 landed; this file — the one
  actually `<script>`-loaded by `index.html` — never did. A duplicate,
  **unused** top-level `analytics.js` (confirmed not referenced by any
  `<script>` tag) had picked up the fix instead, which is exactly the
  "two copies of the same file drift apart" bug class this project's
  `SYNC_AUDIT_REPORT.md` already documented for `titles`/`store` — flagged
  here rather than silently left in place. The stale top-level file is
  unchanged; it was already dead code before this session and this chunk
  doesn't touch it further.
- **New — School-Wide Rollup mode** (admin-only, opt-in, the "explicit
  mode" §11 asks for): a `📊 Standard View` / `🏫 School-Wide Rollup` toggle
  appears only for `currentRole === 'admin'` (`anlSetMode()`, defense in
  depth mirrors the pattern above). Standard View is the existing screen,
  unchanged apart from the label bugfix above. Rollup mode
  (`_anlRenderRollupShell()` → `_anlRollupBodyHTML()`) fetches the teacher
  directory once per session (cached, same lazy-load-once pattern as
  `registrations.js`'s new teacher map) and joins it against `DB.students`
  purely in JS — no new RPC, since an admin session already has
  unrestricted access to all of this data (see file header for the full
  reasoning). Shows:
  - School-wide stat cards (students, sections, teacher accounts, avg XP,
    avg attendance, avg quiz).
  - **Enrollment & Engagement by Section** — one row per (teacher,
    section), not collapsed to one row per teacher, matching §11's "across
    every section, not just one teacher's" framing.
  - **Top Performers, School-Wide** — top 10 students by XP with their
    section label, vs. Standard View's full blended roster table.
  - Guards against a stale async fetch landing after the person switches
    back to Standard View mid-load, same pattern `content-oversight.js`
    uses around its own `await` boundary.

## Explicitly NOT touched / known v1 scope limits
- No new nav item, no new admin-only screen — both deliverables are a
  **mode within Analytics** and an **action within Registrations**,
  matching how the chunk was scoped ("restored as admin's explicit 'all
  sections' mode", "an explicit ... action here too"), not new surface
  area.
- `reassign_registration()` is intentionally admin-only, not
  `is_staff_for_section()`-gated the way `reassign_section_adviser()` is —
  per §11's framing, this is specifically an admin oversight action for
  the cross-teacher queue, not a same-teacher-multiple-sections convenience
  a teacher account would use.
- The School-Wide Rollup's per-section breakdown only lists sections that
  actually appear in the teacher directory's `sections[]` (i.e. have a real
  `class_sections` row) — a student whose `classId` doesn't resolve to any
  known section (pre-Section-Maker legacy data, same edge case
  `getClassLabel()` already handles elsewhere) is still counted in the
  school-wide totals at the top, just not attributed to any row in the
  per-section table. Not a new gap — the same shape as every other
  section-breakdown table in this app.

## Files changed
- `supabase/phase43_school_reporting.sql` (new)
- `modules/admin/registrations-service.js`
- `modules/admin/registrations.js`
- `modules/admin/analytics.js`

All edited/new JS files pass `node --check`.
