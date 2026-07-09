# FIXES APPLIED — Phase 18: Title Sync to Supabase

## What was unfinished
`DB.titles` (catalog), `DB.titleUnlocks` (per-student unlock list), and
`DB.equippedTitles` (per-student equipped title) were entirely local —
no Supabase table, no pull, no push. A title created, unlocked, equipped,
granted, or revoked on one device never reached another. This mirrors the
achievements gap closed in Phase 17, and uses the exact same shapes/trust
model on purpose.

## What changed

**`supabase/phase18_titles_sync.sql`**
- `titles` table (full styling/rarity/description field set) — public
  select, `is_staff()` write. Mirrors `achievements`.
- `title_unlocks` table (`student_id, title_id, unlocked_at, class_id`) —
  RLS mirrors `user_achievements` exactly: select own-or-staff-for-section,
  no direct student insert, staff-only update.
- `equipped_title_id` column added to `profiles` — a scalar per student,
  so it's its own column + its own narrow RPC, **not** part of the bulk
  profiles upsert (same reasoning as Phase 9/10/11 — avoids reintroducing
  the whole-roster write race those phases closed).
- `unlock_title_for_student(p_student_id, p_title_id, p_class_id)` —
  SECURITY DEFINER, conflict-safe no-op if already unlocked.
- `revoke_title_from_student(p_student_id, p_title_id)` — SECURITY
  DEFINER, deletes the unlock row **and** clears `equipped_title_id` if
  that was the equipped one (a revoked title can't stay equipped).
- `set_equipped_title(p_student_id, p_title_id)` — SECURITY DEFINER.
  Unequip (`p_title_id = null`) always allowed; equipping requires the
  student to actually have unlocked that title (checked against
  `title_unlocks`) — a real, cheap, enforceable rule, unlike achievement
  trigger-condition validation which would mean reimplementing every
  trigger type in SQL.
- Trust model matches `adjust_student_stats()`/Phase 17's achievement RPCs:
  granted to `anon, authenticated`, no extra ownership check beyond the
  unlock-existence check above. Same kiosk-trust posture as everywhere
  else in this app.

**`db-service.js`**
- Added `titles` + `title_unlocks` to the parallel Supabase fetch, with
  full camelCase mapping back to the legacy `DB.titles`/`DB.titleUnlocks`
  shape.
- `equippedTitles` is built alongside `DB.students` from
  `profiles.equipped_title_id` (no separate fetch needed — same row).
- Added a push block for `titles` (catalog), same upsert-by-id pattern as
  `achievements`. `title_unlocks` and `equipped_title_id` are **not**
  bulk-pushed — RPC only, same reasoning as `user_achievements`.
- Fixed the mail title-reward lookup (`mailByBatch` construction): it used
  to fall back to `_cache.titles` with a comment flagging titles as
  not-yet-synced. Now that `titles` is real synced data pulled in the same
  function, it looks the reward title up against that directly.

**`utils.js`**
- Added `syncTitleUnlockToServer()`, `syncTitleRevokeToServer()`,
  `syncEquippedTitleToServer()` — same fire-and-forget shape as the
  achievement helpers from Phase 17.

**`modules/titles/titles_sidebar_refresh.js`**
- `tsUnlockTitleForStudent()` now calls `syncTitleUnlockToServer()` right
  after the local unlock push. This one function is the single funnel for
  all three real unlock call sites (achievement-linked auto-unlock in this
  same file, admin manual grant, and mail reward claim in
  `mail-engine.js`), so all three are covered without touching
  `mail-engine.js` at all.
- `tsEquipTitle()` now calls `syncEquippedTitleToServer()` right after the
  local equip/unequip.

**`modules/titles/titles_admin_page.js`**
- `tsAdminRevokeTitle()` now calls `syncTitleRevokeToServer()`.
- `tsAdminDelete()` (hard delete of a title definition) now calls
  `syncTitleRevokeToServer()` for every student who had it unlocked, so
  their server-side unlock rows are cleaned up too.

## Explicitly NOT touched / known limitations
- **Hard-deleting a title definition does not delete the Supabase `titles`
  row.** The push path is upsert-only (same as `achievements`/
  `boss_events` — no table in this app currently supports a delete-sync),
  so `tsAdminDelete()` leaves an orphaned row server-side. Flagged in code
  comments; not fixed here since it would mean adding a delete RPC, which
  is a broader pattern change across several catalog tables, not a
  titles-specific gap.
- **`title_sections` (section-scoping)** was explicitly agreed to be the
  *next* piece of work, not this one. Titles now exist in Supabase, which
  was the blocker; scoping which section can see which title is separate.
- No backfill was run — per your earlier answer, no-rows-yet is fine
  (nothing to scope yet since section-filtering isn't wired regardless).

## Files changed
- `supabase/phase18_titles_sync.sql` (new)
- `db-service.js`
- `utils.js`
- `modules/titles/titles_sidebar_refresh.js`
- `modules/titles/titles_admin_page.js`

All four edited JS files pass `node --check`.
