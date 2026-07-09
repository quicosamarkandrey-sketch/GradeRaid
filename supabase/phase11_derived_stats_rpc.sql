-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 11 — COLUMN-SCOPED attendance_pct / quiz_avg SYNC
-- (see EduQuest_Pending_Fixes_Report.md §3)
--
-- Run once in the Supabase SQL editor, after Phase 1–10.
--
-- THE BUG THIS CLOSES
--   db-service.js's debounced bulk sync (_pushCacheToSupabase) re-upserts
--   EVERY student's attendance_pct/quiz_avg from whatever a single browser
--   tab happens to have cached, on every saveDB() call anywhere in the app.
--   This is the same "whole-roster last-save-wins" shape already fixed for
--   xp/coins/level/tier in phase9_student_stat_rpc.sql — attendance_pct and
--   quiz_avg were deliberately left riding the bulk upsert at the time
--   because neither had an RPC path yet. A stale tab calling saveDB() for
--   any unrelated reason can still silently clobber these two columns with
--   whatever it had cached, even though recalcStudentStats() had already
--   computed a fresher value elsewhere.
--
-- THE FIX
--   Unlike adjust_student_stats() (which applies a DELTA), attendance_pct
--   and quiz_avg are already fully-derived values by the time the client
--   calls this — recalcStudentStats() (utils.js) recomputes both from
--   scratch every time (from attendanceLogs / quizHistory) rather than
--   incrementing them. So this RPC takes the two freshly-recomputed
--   ABSOLUTE values and writes them, column-scoped, to just that one
--   student's row — no other column on the row is touched, so it can never
--   clobber xp/coins/level/tier (owned by adjust_student_stats) or any
--   identity/cosmetic field. Called right after every recalcStudentStats()
--   call site (utils.js: syncStudentDerivedStatsToServer(), and its call
--   sites in attendance-service.js), same fire-and-forget rhythm as
--   syncStudentStatsToServer().
--
-- SCOPE NOTE
--   quiz_avg is still only ever recomputed client-side from
--   DB.quizHistory, which itself has no Supabase table of its own yet (see
--   the report's open question). This RPC only closes the "last-save-wins"
--   write-clobber gap for whatever value the client currently has — it
--   does not address DB.quizHistory's own single-device-only storage.
--   That's a separate, larger follow-up (giving quizHistory a real synced
--   table), not part of this fix.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.sync_student_derived_stats(
  p_student_id     text,
  p_attendance_pct integer default null,
  p_quiz_avg       integer default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.profiles;
begin
  if p_student_id is null or length(trim(p_student_id)) = 0 then
    raise exception 'p_student_id is required';
  end if;

  update public.profiles
     set attendance_pct = coalesce(p_attendance_pct, attendance_pct),
         quiz_avg       = coalesce(p_quiz_avg, quiz_avg)
   where id = p_student_id
     and role = 'student'
   returning * into v_row;

  if v_row.id is null then
    raise exception 'Student % not found', p_student_id;
  end if;

  return v_row;
end;
$$;

grant execute on function
  public.sync_student_derived_stats(text, integer, integer)
to anon, authenticated;
