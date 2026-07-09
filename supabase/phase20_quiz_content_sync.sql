-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 20 — QUIZ CONTENT SYNC (`quizzes` table)
--
-- Run once in the Supabase SQL editor, after Phase 15
-- (phase15_mail_and_quiz_sections_sync.sql — this file assumes quiz_sections
-- already exists; quizzes.id is what quiz_sections.quiz_id references
-- logically, though there is no FK today since quiz_sections predates this
-- table and was built to tolerate quiz ids that only exist client-side).
--
-- THE GAP THIS CLOSES (SYNC_AUDIT_REPORT.md, "Quiz — bigger gap than 'done'
-- implies")
--   quiz_sections (who can SEE a quiz) has synced correctly since Phase 15.
--   But DB.quizzes — the quiz CONTENT itself (title, description, rewards,
--   time limit, questions/answers) — was never pulled from or pushed to
--   Supabase at all. db-service.js's pull function fell back to
--   `quizzes: _cache?.quizzes || []` (pure local cache, no table backing
--   it), and the push function had no matching upsert block. A quest
--   authored or edited on one device (modules/admin/quiz-builder.js)
--   never reached any other device. This is the exact same "catalog table
--   with no push block" bug class already fixed for achievements (Phase 17)
--   and titles (Phase 18) — same fix shape applied here.
--
-- WHAT THIS DOES NOT CHANGE
--   - quiz_sections is untouched (already synced, already has its own RPC).
--   - Per-student quiz results (DB.students[].completedQuizzes / quiz
--     history) are NOT part of this migration — that's a separate concern
--     already handled elsewhere and out of scope for "quiz content."
--   - No RPC is added for quizzes — same as achievements/titles, this is a
--     simple admin-authored catalog table: public read, staff-only bulk
--     upsert write, no per-row student mutation path needed.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.quizzes (
  id           text primary key,
  title        text not null,
  description  text,
  xp_reward    integer not null default 0,
  coin_reward  integer not null default 0,
  time_limit   integer, -- minutes
  questions    jsonb not null default '[]'::jsonb, -- [{q, opts:[...], answer}]
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

alter table public.quizzes enable row level security;

drop policy if exists quizzes_select_all  on public.quizzes;
drop policy if exists quizzes_staff_write on public.quizzes;

-- Catalog is global; per-section visibility is handled client-side via
-- quiz_sections (Phase 15), not by hiding rows here — identical posture to
-- achievements_select_all / titles_select_all.
create policy quizzes_select_all on public.quizzes
  for select using (true);

create policy quizzes_staff_write on public.quizzes
  for all using (public.is_staff()) with check (public.is_staff());

-- Realtime: same two-part requirement Phase 19 documented for
-- achievements/titles/title_unlocks — the JS postgres_changes listener
-- alone does nothing until the table is also added to the
-- supabase_realtime publication.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'quizzes'
  ) then
    execute 'alter publication supabase_realtime add table public.quizzes';
  end if;
end $$;
