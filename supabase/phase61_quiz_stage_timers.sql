-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 61 — QUEST BOARD: PER-STAGE QUESTION TIMER COLUMN (`quizzes` table)
--
-- Run once in the Supabase SQL editor, after Phase 60.
--
-- THE FEATURE THIS SUPPORTS (Improvement Plan §2/§4 — Phase 3 of the
-- Improvement Plan's §12 rollout, unrelated to this repo's own Phase
-- numbering)
--   Quizzes are now split into 3 escalating stages (Warm-Up / Surge /
--   Overdrive) purely by question order, each with its own per-question
--   countdown that resets every item instead of one countdown for the
--   whole quiz. Shipped defaults are 30/20/10 seconds; a teacher can
--   override any/all three per quiz in the Quest Builder
--   (modules/admin/quiz-builder.js), and eqQuizStageSeconds() in utils.js
--   always falls back to the shipped default for any slot left blank.
--
-- THE GAP THIS CLOSES
--   Same bug class already fixed for rarity/cadence (Phase 54), quest
--   chains (Phase 56), and scheduling (Phase 58): a new JS-only field
--   (quiz.stageTimers) with no matching column in public.quizzes would
--   look right locally right up until the next Supabase pull, which has
--   no column to read it back from — a teacher's timer override would
--   silently reset to defaults on their next login/device.
--
-- THE FIX (this file)
--   Add stage_timers (jsonb) to public.quizzes, defaulting to
--   '[null,null,null]' — "use shipped defaults for every stage" — so any
--   row saved before this migration renders identically to how it already
--   behaved (a flat 30/20/10 quiz). The matching JS fix (db-service.js
--   pull/push mapping) is a separate, same-commit change — this migration
--   alone does not resync existing rows; a teacher's earlier-set override
--   (if any existed only in local storage) needs one re-save from the
--   Quest Builder to actually reach Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.quizzes
  add column if not exists stage_timers jsonb default '[null,null,null]'::jsonb;

-- Backfill explicitly — same reasoning as Phase 54/56/58: makes every
-- pre-existing quiz unambiguously [null,null,null] rather than SQL NULL,
-- matching what eqQuizStageSeconds() already treats a missing value as
-- (fall back to the shipped 30/20/10 default for that stage).
update public.quizzes
   set stage_timers = '[null,null,null]'::jsonb
 where stage_timers is null;

-- No RLS/grant changes needed — quizzes_select_all / quizzes_staff_write
-- (Phase 20) apply at the row level, not per-column.
