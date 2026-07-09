-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 9 — COLUMN-SCOPED STUDENT STAT UPDATES (see EduQuest_Investigation_Report.md §6.1)
--
-- Run once in the Supabase SQL editor, after Phase 1–8.
--
-- THE BUG THIS CLOSES
--   db-service.js's debounced bulk sync (_pushCacheToSupabase) re-upserts
--   EVERY student's xp/coins/level/tier/attendance_pct/quiz_avg from
--   whatever a single browser tab happens to have cached in memory, on
--   every saveDB() call anywhere in the app. Seven features (recitation
--   award, campaign stage rewards, admin manual XP/coin adjust, world boss
--   rewards, mail rewards, achievement grant/revoke, achievement claim)
--   mutate xp/coins locally and rely on that same debounced bulk push to
--   persist the change. If any OTHER browser tab/device with a stale
--   cached roster calls saveDB() for an unrelated reason in the following
--   400ms window (or even much later — the whole roster is re-sent every
--   time), it silently overwrites the fresh xp/coins for every student
--   with its own stale snapshot.
--
-- THE FIX
--   adjust_student_stats() is a SECURITY DEFINER RPC that applies an
--   ATOMIC, COLUMN-SCOPED delta directly in Postgres — exactly the same
--   pattern already used for recitation (log_recitation_point(), see
--   phase3_recitation_command_center.sql + phase5_bugfix_pack.sql's xp
--   trigger) and attendance (process_attendance_scan(),
--   override_attendance()). Because it's a delta applied server-side, it
--   can never be "clobbered" by a stale snapshot the way a full-row upsert
--   can — there is nothing for a stale tab to overwrite, since that tab
--   never sent an absolute xp/coins value in the first place once its
--   call site is migrated to call this RPC instead of relying on the bulk
--   push (see the matching JS change in utils.js:
--   syncStudentStatsToServer(), and its seven call sites).
--
-- LEVEL/TIER ARE NOW DERIVED HERE TOO
--   Mirrors the client's checkLevelUp()/recalcStudentStats() rules exactly
--   (utils.js / app-state.js): level only ever increases
--   (floor(xp / 1000), never regresses on an xp deduction — same as
--   checkLevelUp()), and tier is derived from level via the same
--   thresholds as utils.js's TIER_THRESHOLDS. Once every xp/coins write
--   site is migrated to this RPC, xp/coins/level/tier no longer need to
--   ride along in the bulk profiles upsert at all — see the matching
--   db-service.js change that drops those four columns from that payload.
--   attendance_pct and quiz_avg are NOT touched here: neither has an RPC
--   path yet (both are still only ever recomputed client-side by
--   recalcStudentStats() and persisted via the bulk push), so they stay
--   in that payload unchanged. Narrowing those two is a follow-up, not
--   part of this fix.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.adjust_student_stats(
  p_student_id  text,
  p_xp_delta    integer default 0,
  p_coins_delta integer default 0
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row       public.profiles;
  v_new_level integer;
  v_new_tier  text;
begin
  if p_student_id is null or length(trim(p_student_id)) = 0 then
    raise exception 'p_student_id is required';
  end if;

  update public.profiles
     set xp    = greatest(0, coalesce(xp, 0)    + coalesce(p_xp_delta, 0)),
         coins = greatest(0, coalesce(coins, 0) + coalesce(p_coins_delta, 0))
   where id = p_student_id
     and role = 'student'
   returning * into v_row;

  if v_row.id is null then
    raise exception 'Student % not found', p_student_id;
  end if;

  -- Level only ever goes up (matches app-state.js's checkLevelUp() — an
  -- achievement revoke or negative admin adjustment reduces xp but does
  -- not demote a level already earned).
  v_new_level := greatest(coalesce(v_row.level, 0), floor(coalesce(v_row.xp, 0) / 1000)::integer);
  v_new_tier  := case
                   when v_new_level >= 20 then 'Legend'
                   when v_new_level >= 15 then 'Master'
                   when v_new_level >= 10 then 'Scholar'
                   when v_new_level >= 5  then 'Achiever'
                   else 'Novice'
                 end;

  if v_new_level is distinct from v_row.level or v_new_tier is distinct from v_row.tier then
    update public.profiles
       set level = v_new_level,
           tier  = v_new_tier
     where id = p_student_id
     returning * into v_row;
  end if;

  return v_row;
end;
$$;

grant execute on function
  public.adjust_student_stats(text, integer, integer)
to anon, authenticated;
