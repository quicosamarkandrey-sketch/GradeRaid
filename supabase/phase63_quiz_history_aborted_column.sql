-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 63 — QUEST BOARD: `aborted` COLUMN ON quiz_history + COMPLETION-STATE
--            SYNC FIX (closes the "quizzes/chains reset to unfinished" bug)
--
-- Run once in the Supabase SQL editor, after Phase 62.
--
-- THE BUG THIS CLOSES
--   1) db-service.js's _pullCacheFromSupabase() hardcoded every student's
--      completedQuizzes to [] on every pull ("quiz history stays in its own
--      table" — true, but nothing ever actually derived it back FROM that
--      table). Because the quiz_history table is in this app's realtime
--      subscription list, finishing a quiz (which inserts a quiz_history
--      row) immediately triggers a pull refresh that wipes completedQuizzes
--      back to [] for every student — which is why a just-finished quiz
--      reappeared as "pending" on the Quest Board and quest chains reset to
--      step 1 moments after being cleared. The JS fix (deriving
--      completedQuizzes from quiz_history instead) is a same-commit change
--      to db-service.js.
--   2) That derivation needs to exclude aborted attempts (abortQuiz() in
--      index.html logs `passed:false, aborted:true` locally, but quiz_history
--      never had a column for it, so an abandoned attempt round-tripped
--      through Supabase was indistinguishable from a real one — including,
--      worst case, one where the student had already locked in several
--      correct answers before walking away). This column, plus the matching
--      push/pull mapping fix in db-service.js, closes that gap so an abort
--      never counts as a completion and never counts toward the new
--      perfect-score lock (Phase 63's other half — see utils.js
--      eqQuizAttemptStatus()).
--
-- THE FIX (this file)
--   New `aborted` column, defaulting false so every pre-existing row (all
--   of which were real scored attempts) reads correctly without a backfill.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.quiz_history
  add column if not exists aborted boolean not null default false;

-- No backfill needed — every row logged before this phase was a real
-- finishQuiz() completion (abortQuiz() rows never had anywhere to go before
-- now, but they were never distinguishable either way, so `false` is the
-- correct — if slightly generous — default for old data).

-- No RLS/grant changes needed — quiz_history_select_scoped /
-- quiz_history_student_insert / quiz_history_staff_write (Phase 57) apply
-- at the row level, not per-column.
