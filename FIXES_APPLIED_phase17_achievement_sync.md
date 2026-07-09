# FIXES APPLIED — Phase 17: Achievement Sync Gap Fix

## Why this happened
While tracing the achievements module as the reference pattern for syncing
`DB.titles` to Supabase (the actual ask), the pattern turned out to be
incomplete. Two write paths that look wired (tables + RLS exist, comments
say "RPC only") never actually had their RPC or push written:

1. **`achievements` (the catalog)** — pulled from Supabase, never pushed.
   Admin create/edit/delete of a badge only ever mutated `DB.achievements`
   locally; a badge made on one device never reached another.
2. **`user_achievements` (per-student unlock/claim)** — RLS already says
   "awarded server-side only" / "RPC only", but no RPC existed and no bulk
   push existed either. Auto-unlock, student claim, and admin grant/revoke
   all only ever touched `DB.achievementUnlocks` locally.

This is a pre-existing gap, not something introduced by Phase 14/15/16 —
flagging and fixing it now because titles was about to copy the same
incomplete pattern.

## What changed

**`supabase/phase17_achievement_sync_fix.sql`**
- Confirmed RLS on `achievements`: public select, `is_staff()` write.
- Added a unique index on `user_achievements(student_id, achievement_id)`
  for idempotent upserts.
- `award_achievement_to_student(p_student_id, p_achievement_id, p_xp_granted, p_coins_granted, p_claimed, p_class_id)` —
  SECURITY DEFINER, records an unlock. Used for both auto-unlock
  (`p_claimed=false`, 0/0) and immediate admin grant (`p_claimed=true`,
  actual amounts). Conflict-safe no-op if already unlocked.
- `claim_achievement_reward(p_student_id, p_achievement_id, p_xp_granted, p_coins_granted)` —
  SECURITY DEFINER, marks a previously-unlocked-but-unclaimed row claimed
  and stamps the real reward amounts. Only touches `claimed = false` rows,
  so it can't double-grant on a retry or double-click.
- `revoke_achievement_from_student(p_student_id, p_achievement_id)` —
  SECURITY DEFINER, deletes the unlock row.
- Trust model deliberately mirrors `adjust_student_stats()`
  (phase9): granted to `anon, authenticated`, no extra ownership check in
  the function body. Same kiosk-trust posture already used everywhere else
  in this app — not a new gap.

**`db-service.js`**
- Added a push block for `achievements` (name/description/icon/category/
  rarity/xp_reward/coin_reward/trigger_type/trigger_value/active), same
  upsert-by-id pattern as `boss_events`/`shop_products`.
- `user_achievements` is deliberately **not** bulk-pushed — same
  "RPC-only" reasoning as `loot_claims`/`registrations`.

**`utils.js`**
- Added three fire-and-forget helpers, same shape as
  `syncStudentStatsToServer()`: `syncAchievementUnlockToServer()`,
  `syncAchievementClaimToServer()`, `syncAchievementRevokeToServer()`.

**`modules/achievements/ach_engine.js`**
- `achCheckAndAward()` now calls `syncAchievementUnlockToServer()` right
  after the local unlock push.
- `achGrantRewardsForClaim()` now calls `syncAchievementClaimToServer()`
  right after the local claim.

**`modules/achievements/ach_admin_page.js`**
- `achAdminDoGrant()` grant branch calls `syncAchievementUnlockToServer()`
  with `claimed:true` and the actual reward amounts.
- `achAdminDoGrant()` revoke branch calls `syncAchievementRevokeToServer()`.

## Explicitly NOT touched
- `isHidden` on achievement definitions stays local-only — it isn't a real
  column in the `achievements` table today, and adding one wasn't part of
  this fix. An admin's "hide from picker" toggle still won't persist
  cross-device. Flagging, not silently dropping.
- No backfill was run against existing local-only `DB.achievements` /
  `DB.achievementUnlocks` data — the next `saveDB()` on each device will
  push whatever that device currently has cached, same as any other
  additive migration in this app.
- Titles (`DB.titles`, `DB.titleUnlocks`, `DB.equippedTitles`) are still
  entirely local — this pass only fixed the achievements reference pattern
  so titles doesn't copy the same gap. Titles sync is next.

## Files changed
- `supabase/phase17_achievement_sync_fix.sql` (new)
- `db-service.js`
- `utils.js`
- `modules/achievements/ach_engine.js`
- `modules/achievements/ach_admin_page.js`

All four edited JS files pass `node --check`.
