-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 29 — QUIZ DELETE SYNC (extends the catalog delete-sync pattern —
-- Phase 23 for boss_events/achievements/titles, Phase 28 for
-- campaign_worlds — to quizzes)
--
-- Run once in the Supabase SQL editor, after Phase 20.
--
-- THE GAP THIS CLOSES
--   Phase 20 wired quiz content (title/description/rewards/questions) to
--   sync — but only via upsert. confirmDeleteQuiz() in quiz-builder.js
--   only ever filtered the local array (plus cleared this caller's own
--   quiz_sections rows via set_quiz_sections([])) — deleting a quiz
--   locally never removed the Supabase `quizzes` row itself, so it would
--   silently reappear on the next pull for anyone else. The local code
--   already flagged this itself as the same known, non-blocking
--   limitation documented for the other catalogs.
--
-- THE FIX
--   `delete_quiz()` — same shape as delete_achievement()/
--   delete_campaign_world(): quizzes is a global staff-writable catalog
--   with no per-section owner column, so it checks is_staff(), same as
--   the table's own RLS write policy. Cascades quiz_sections first —
--   replacing the old per-caller set_quiz_sections([]) cleanup call in
--   quiz-builder.js, which only ever cleared rows that caller owned and
--   left the quizzes row itself orphaned (same reasoning delete_title()
--   used to replace the old per-student syncTitleRevokeToServer() loop).
--   Per-student completedQuizzes/history has no Supabase table at all
--   (still local-cache-only, out of scope, unchanged), so there's nothing
--   else to cascade. Idempotent — deleting an already-gone row is a
--   silent no-op, not an error, same as every other delete_* RPC.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.delete_quiz(p_quiz_id text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.quizzes where id = p_quiz_id) then
    return; -- already gone, treat as success
  end if;

  if not public.is_staff() then
    raise exception 'not authorized to delete quizzes';
  end if;

  delete from public.quiz_sections where quiz_id = p_quiz_id;
  delete from public.quizzes       where id = p_quiz_id;
end;
$$;
grant execute on function public.delete_quiz(text) to anon, authenticated;
