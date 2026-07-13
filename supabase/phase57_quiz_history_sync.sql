-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 57 — QUIZ HISTORY SYNC (flagged in Phase 11, closed here)
--
-- Run once in the Supabase SQL editor, after Phase 56 (quiz chains).
--
-- THE GAP THIS CLOSES (phase11_derived_stats_rpc.sql's own comment called
-- this out and deferred it: "DB.quizHistory, which itself has no Supabase
-- table of its own yet... That's a separate, larger follow-up (giving
-- quizHistory a real synced [pipeline])" — that follow-up never happened
-- until now)
--   DB.quizHistory[studentId] = [{ quizId, score, completedAt, date, attempt }]
--   is written locally in index.html's finishQuiz() and read by three
--   Phase 4 features shipped this same session:
--     • computeQuestStreak() (utils.js) — the "Day Streak" hero stat
--     • quizAttemptNumber (index.html) — drives eqRetryMultiplier(), i.e.
--       whether a retry earns full or reduced reward
--     • the "Cleared" score shown per quest in the Completed Quests list
--   None of it ever reached Postgres — no table, no push, no pull. Every
--   attempt/score/streak lived in that one browser's localStorage only:
--     • the streak silently resets (looks broken) on a new device/browser
--     • worse, a retry on a different device is miscounted as attempt #1,
--       so a student can re-earn full first-attempt reward by switching
--       devices instead of getting the intended reduced-reward tier —
--       a real reward-integrity hole, not just a display glitch.
--
-- THE FIX
--   New `quiz_history` table, RLS shaped exactly like Phase 48's
--   orders/inventory: a student may insert/read their own rows, staff may
--   read/write every row for their own section(s) via is_staff_for_section().
--   No RPC layer — grading already happens client-side and is trusted at
--   the same level point_log/orders/inventory already are in this app, so
--   a plain self-scoped insert policy matches the existing trust model
--   instead of inventing a new one. The matching db-service.js push/pull
--   (upsert-by-id, same as point_log) is a separate, same-commit change —
--   see that file's diff.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.quiz_history (
  id           text primary key,          -- client-generated, e.g. 'qh_' + uid()
  student_id   text not null references public.profiles(id),
  quiz_id      text not null,
  score        integer not null default 0,
  attempt      integer not null default 1,
  completed_at timestamptz not null default now(),
  date_label   text                         -- 'YYYY-MM-DD' calendar day, matches
                                             -- isoDate() — what computeQuestStreak()
                                             -- actually groups by, kept as its own
                                             -- column rather than derived from
                                             -- completed_at so the client's Manila-
                                             -- calendar day boundary is authoritative,
                                             -- not Postgres's session timezone.
);

create index if not exists quiz_history_student_idx  on public.quiz_history (student_id);
create index if not exists quiz_history_quiz_idx     on public.quiz_history (student_id, quiz_id);
create index if not exists quiz_history_date_idx     on public.quiz_history (student_id, date_label);

alter table public.quiz_history enable row level security;

create policy quiz_history_select_scoped on public.quiz_history
  for select
  using (
    student_id = auth.uid()::text
    or public.is_staff_for_section((select p.class_id from public.profiles p where p.id = quiz_history.student_id))
  );

-- A student records their own quiz attempts (finishQuiz() runs in the
-- student's own session, same trust boundary as cartCheckout()'s order
-- insert in Phase 48). Append-only from the student side — no update/delete
-- policy for students, matching point_log's append-only posture.
create policy quiz_history_student_insert on public.quiz_history
  for insert
  with check (student_id = auth.uid()::text);

create policy quiz_history_staff_write on public.quiz_history
  for all
  using (public.is_staff_for_section((select p.class_id from public.profiles p where p.id = quiz_history.student_id)))
  with check (public.is_staff_for_section((select p.class_id from public.profiles p where p.id = quiz_history.student_id)));
