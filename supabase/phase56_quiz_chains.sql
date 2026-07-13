-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 56 — QUEST BOARD: QUEST CHAIN COLUMNS (`quizzes` table)
--
-- Run once in the Supabase SQL editor, after Phase 55.
--
-- THE GAP THIS CLOSES (quest_board_report.md §3.8, Phase 4 build order)
--   Phase 4's Quest Board work adds `quiz.chainId`, `quiz.chainOrder`, and
--   `quiz.chainLabel` as plain JS object fields — quizzes sharing the same
--   chainId form a sequential chain ("Chapter 5 Reviewer Part 1 → Part 2 →
--   Boss Recap"), unlocking in chainOrder as each prior part is completed
--   (eqGetQuestChains()/eqChainStatus() in utils.js). modules/admin/
--   quiz-builder.js now has a chain-id/part-number/display-name picker for
--   all three. But public.quizzes (Phase 20, extended in Phase 54 for
--   rarity/cadence) has no columns for any of them, and db-service.js's
--   push/pull mapping for the `quizzes` table doesn't mention them either —
--   the exact same "catalog table field silently dropped on the next sync"
--   bug class Phase 54's migration closed for rarity/cadence.
--
--   Net effect without this migration: a teacher chains three quizzes
--   together in the builder — it looks right locally, right up until the
--   next Supabase pull, which has no columns to read chainId/chainOrder/
--   chainLabel back from, so every quiz silently reverts to standalone.
--
-- THE FIX (this file)
--   Add chain_id/chain_order/chain_label to public.quizzes. chain_id stays
--   NULL by default (matching eqQuizChain()'s "no chainId = not chained"
--   fallback in utils.js — nothing old breaks), chain_order defaults to 1
--   (eqQuizChain()'s numeric fallback). The matching JS fix (db-service.js
--   push/pull mapping) is a separate, same-commit change — this migration
--   alone does not resync existing rows; anything set before both halves
--   land needs to be re-saved once from the Quest Builder to actually reach
--   Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.quizzes
  add column if not exists chain_id    text,
  add column if not exists chain_order integer default 1,
  add column if not exists chain_label text;

-- Backfill explicitly — same reasoning as Phase 54: makes sure every
-- pre-existing quiz has an unambiguous chain_order of 1 rather than NULL,
-- matching what eqQuizChain() already treats it as today. chain_id/
-- chain_label intentionally stay NULL (unchained), not backfilled to any
-- placeholder value.
update public.quizzes
   set chain_order = coalesce(chain_order, 1)
 where chain_order is null;

-- No RLS/grant changes needed — quizzes_select_all / quizzes_staff_write
-- (Phase 20) apply at the row level, not per-column.
