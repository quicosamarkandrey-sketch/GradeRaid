-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 58 — QUEST BOARD: SCHEDULING COLUMNS (`quizzes` table)
--
-- Run once in the Supabase SQL editor, after Phase 57.
--
-- THE GAP THIS CLOSES (quest_board_report.md §18, Phase 5 build order)
--   Phase 5's admin-tooling work adds `quiz.startDate` / `quiz.endDate` as
--   plain JS object fields ('YYYY-MM-DD' strings, Manila calendar day, same
--   convention as isoDate()) — a quest with both unset stays always
--   available (the pre-Phase-5 default), one with either set only shows on
--   the student's Quest Board within that window
--   (eqQuizScheduleStatus() in utils.js). modules/admin/quiz-builder.js now
--   has date pickers for both. But public.quizzes (Phase 20, extended for
--   rarity/cadence in Phase 54 and chains in Phase 56) has no columns for
--   either, and db-service.js's push/pull mapping doesn't mention them —
--   the exact same "catalog table field silently dropped on the next sync"
--   bug class Phase 54/56's migrations already closed for rarity/cadence
--   and chains.
--
--   Net effect without this migration: a teacher sets a quest to auto-
--   expire next Friday — it looks right locally, right up until the next
--   Supabase pull, which has no columns to read startDate/endDate back
--   from, so the quest silently reverts to always-available.
--
-- THE FIX (this file)
--   Add start_date/end_date to public.quizzes. Both stay NULL by default
--   (matching eqQuizScheduleStatus()'s "neither set = always available"
--   fallback in utils.js — nothing old breaks). The matching JS fix
--   (db-service.js push/pull mapping) is a separate, same-commit change —
--   this migration alone does not resync existing rows; anything set
--   before both halves land needs to be re-saved once from the Quest
--   Builder to actually reach Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.quizzes
  add column if not exists start_date date,
  add column if not exists end_date   date;

-- No backfill needed — NULL is the correct, intentional value for an
-- unscheduled (always-available) quest, not a placeholder to coalesce away.

-- No RLS/grant changes needed — quizzes_select_all / quizzes_staff_write
-- (Phase 20) apply at the row level, not per-column.
