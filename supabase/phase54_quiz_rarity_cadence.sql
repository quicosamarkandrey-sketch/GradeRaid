-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 54 — QUEST BOARD: RARITY & CADENCE COLUMNS (`quizzes` table)
--
-- Run once in the Supabase SQL editor, after Phase 53.
--
-- THE GAP THIS CLOSES (quest_board_report.md §3.2/§3.4)
--   Phase 3's Quest Board work added `quiz.rarity` and `quiz.cadence` as
--   plain JS object fields, plus eqQuizRarity()/eqQuizCadence() helpers in
--   utils.js that default missing values to 'Common'/'standing' so older
--   quizzes never break. modules/admin/quiz-builder.js now has pickers for
--   both. But public.quizzes (Phase 20) was built before either field
--   existed, and db-service.js's push/pull mapping for the `quizzes` table
--   never mentioned them — the exact same "catalog table field silently
--   dropped on the next sync" bug class already fixed once for titles'
--   Designer v3 columns (Phase 52) and originally for titles/quizzes
--   content itself (Phase 17/18/20, see SYNC_AUDIT_REPORT.md).
--
--   Net effect without this migration: a teacher sets a quiz's rarity to
--   Epic and its cadence to daily in the builder — it looks right locally,
--   right up until the next Supabase pull, which has no columns to read
--   those values back from, so both silently reset to their defaults.
--
-- THE FIX (this file)
--   Add rarity/cadence to public.quizzes, matching the same defaults
--   eqQuizRarity()/eqQuizCadence() already fall back to, so any row saved
--   before this migration (columns NULL) renders identically to how it
--   already behaved. The matching JS fix (db-service.js push/pull mapping)
--   is a separate, same-commit change — this migration alone does not
--   resync existing rows; anything set before both halves land needs to be
--   re-saved once from the Quest Builder to actually reach Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.quizzes
  add column if not exists rarity  text default 'Common',
  add column if not exists cadence text default 'standing';

-- Backfill explicitly — same reasoning as Phase 52: makes sure every
-- pre-existing quiz is unambiguously 'Common'/'standing' rather than NULL,
-- matching what eqQuizRarity()/eqQuizCadence() already treat it as today.
update public.quizzes
   set rarity  = coalesce(rarity, 'Common'),
       cadence = coalesce(cadence, 'standing')
 where rarity is null or cadence is null;

-- No RLS/grant changes needed — quizzes_select_all / quizzes_staff_write
-- (Phase 20) apply at the row level, not per-column.
