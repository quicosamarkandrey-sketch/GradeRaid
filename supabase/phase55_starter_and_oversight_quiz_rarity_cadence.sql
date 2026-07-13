-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 55 — QUEST BOARD: RARITY & CADENCE ON THE STARTER-PACK / OVERSIGHT
--            QUIZ RPCs (closes the sibling gap to Phase 54)
--
-- Run once in the Supabase SQL editor, after Phase 54.
--
-- THE GAP THIS CLOSES
--   Phase 54 added rarity/cadence columns to public.quizzes and taught
--   db-service.js's regular pull/push mapping about them. But two other
--   write paths insert/update the SAME public.quizzes rows through
--   security-definer RPCs that build their own explicit column lists, and
--   neither one knew about the two new columns either:
--     - upsert_starter_quiz()   (Phase 38) — admin-authored starter-pack
--       templates, called from modules/admin/starter-pack-service.js.
--     - oversight_upsert_quiz() (Phase 41) — admin editing another
--       teacher's quiz, called from modules/admin/content-oversight-service.js.
--   Both would silently reset rarity to 'Common' and cadence to 'standing'
--   on every save, the same way the regular quiz-builder path did before
--   Phase 54 — this is that same bug class, just via a different door.
--
-- THE FIX (this file)
--   Add p_rarity/p_cadence as new DEFAULTED trailing parameters to both
--   functions (defaults match what a pre-Phase-3 row already resolves to
--   via eqQuizRarity()/eqQuizCadence(), so any existing caller that still
--   omits them behaves exactly as before). Per PostgreSQL's rules for
--   CREATE OR REPLACE FUNCTION, changing a function's parameter list at
--   all — even just appending defaulted params — creates a new overload
--   instead of truly replacing the old one, which then causes ambiguous-
--   call errors (PGRST203) once both signatures exist. So, same pattern as
--   hotfix_delete_classroom_layout_overload.sql: explicitly DROP the old
--   signature first, then CREATE the new one in its place.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.upsert_starter_quiz(text, text, text, integer, integer, integer, jsonb, boolean);

create or replace function public.upsert_starter_quiz(
  p_id text, p_title text, p_description text, p_xp_reward integer,
  p_coin_reward integer, p_time_limit integer, p_questions jsonb, p_active boolean,
  p_rarity text default 'Common', p_cadence text default 'standing'
)
returns public.quizzes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.quizzes;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can edit the starter pack.';
  end if;

  insert into public.quizzes (
    id, owner_teacher_id, is_starter_template, title, description, xp_reward,
    coin_reward, time_limit, questions, active, rarity, cadence
  ) values (
    p_id, public.starter_template_owner_id(), true, p_title, p_description, p_xp_reward,
    p_coin_reward, p_time_limit, coalesce(p_questions, '[]'::jsonb), p_active,
    coalesce(p_rarity, 'Common'), coalesce(p_cadence, 'standing')
  )
  on conflict (id) do update set
    title = excluded.title, description = excluded.description, xp_reward = excluded.xp_reward,
    coin_reward = excluded.coin_reward, time_limit = excluded.time_limit,
    questions = excluded.questions, active = excluded.active,
    rarity = excluded.rarity, cadence = excluded.cadence
  where public.quizzes.is_starter_template
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function
  public.upsert_starter_quiz(text, text, text, integer, integer, integer, jsonb, boolean, text, text)
to authenticated;

drop function if exists public.oversight_upsert_quiz(text, text, text, text, integer, integer, integer, jsonb, boolean);

create or replace function public.oversight_upsert_quiz(
  p_owner_teacher_id text, p_id text, p_title text, p_description text,
  p_xp_reward integer, p_coin_reward integer, p_time_limit integer,
  p_questions jsonb, p_active boolean,
  p_rarity text default 'Common', p_cadence text default 'standing'
)
returns public.quizzes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.quizzes;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can edit another teacher''s content.';
  end if;
  if p_owner_teacher_id is null then
    raise exception 'owner_teacher_id is required';
  end if;

  insert into public.quizzes (
    id, owner_teacher_id, is_starter_template, title, description, xp_reward,
    coin_reward, time_limit, questions, active, rarity, cadence
  ) values (
    p_id, p_owner_teacher_id, false, p_title, p_description, p_xp_reward,
    p_coin_reward, p_time_limit, coalesce(p_questions, '[]'::jsonb), p_active,
    coalesce(p_rarity, 'Common'), coalesce(p_cadence, 'standing')
  )
  on conflict (id) do update set
    title = excluded.title, description = excluded.description, xp_reward = excluded.xp_reward,
    coin_reward = excluded.coin_reward, time_limit = excluded.time_limit,
    questions = excluded.questions, active = excluded.active,
    rarity = excluded.rarity, cadence = excluded.cadence
  where not public.quizzes.is_starter_template
    and public.quizzes.owner_teacher_id = p_owner_teacher_id
  returning * into v_row;

  if v_row is null then
    raise exception 'Could not save — this id belongs to a different teacher or the starter pack.';
  end if;

  return v_row;
end;
$$;
grant execute on function
  public.oversight_upsert_quiz(text, text, text, text, integer, integer, integer, jsonb, boolean, text, text)
to authenticated;

-- Confirms exactly one overload of each remains, and that it's the 10/11-arg
-- version with rarity/cadence. Run after the statements above to double-check.
select p.proname, pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('upsert_starter_quiz', 'oversight_upsert_quiz');
