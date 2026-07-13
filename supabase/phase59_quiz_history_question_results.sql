-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 59 — QUEST BOARD: PER-QUESTION RESULTS COLUMN (`quiz_history` table)
--
-- Run once in the Supabase SQL editor, after Phase 58.
--
-- THE GAP THIS CLOSES (quest_board_report.md §19, Phase 5 build order)
--   Phase 5's admin-tooling work adds a per-quest analytics view (Quest
--   Builder's new "📊 Analytics" button) showing completion rate, average
--   score, and — the genuinely new part — per-question miss-rate, so a
--   teacher can see which specific question in a reviewer most students
--   get wrong (eqComputeQuizAnalytics() in utils.js).
--
--   Completion rate and average score were already answerable from
--   quiz_history's existing `score` column (Phase 57). Per-question
--   miss-rate is not: `score` is a single rolled-up percentage for the
--   whole attempt, with no record of which individual question(s) it came
--   from. finishQuiz() (index.html) already computes a per-question
--   fraction for every question while grading — it just never used to
--   keep it, only the rolled-up total.
--
-- THE FIX (this file)
--   New `question_results` jsonb column on quiz_history: an array of
--   per-question fractions (same order as quiz.questions, same 0..1 scale
--   eqGradeAnswer() already returns), stamped once at attempt-completion
--   time, same as `score`. Rows logged before this phase simply have
--   question_results = NULL — eqComputeQuizAnalytics() already treats a
--   missing `results` array as "this attempt doesn't contribute a
--   per-question breakdown" rather than erroring, so old attempts keep
--   counting toward completion rate / average score and just don't
--   contribute to the new per-question view. The matching JS fix
--   (db-service.js push/pull mapping, finishQuiz()'s `results` capture in
--   index.html) is a separate, same-commit change — this migration alone
--   does not backfill question_results for existing rows (there's nothing
--   to derive it from after the fact).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.quiz_history
  add column if not exists question_results jsonb;

-- No backfill — NULL is correct for every pre-Phase-5 row (no per-question
-- breakdown was ever recorded for them), not a placeholder to coalesce away.

-- No RLS/grant changes needed — quiz_history_select_scoped /
-- quiz_history_student_insert / quiz_history_staff_write (Phase 57) apply
-- at the row level, not per-column.
