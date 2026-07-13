-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 60 — QUEST BOARD: STARTER-PACK / OVERSIGHT QUIZ RPCs — CLOSE THE
--            RARITY/CADENCE READ-SIDE GAP + CHAIN + SCHEDULING COLUMNS
--
-- Run once in the Supabase SQL editor, after Phase 59.
--
-- THE GAP THIS CLOSES
--   Four RPCs read/write public.quizzes through their own explicit column
--   lists instead of `select *` / a plain upsert, same as every other
--   catalog table in this app:
--     - get_starter_pack()      (Phase 38) — starter-pack editor's read
--     - upsert_starter_quiz()   (Phase 38, rarity/cadence added Phase 55)
--     - get_teacher_content()   (Phase 41) — "Edit as" drill-in's read
--     - oversight_upsert_quiz() (Phase 41, rarity/cadence added Phase 55)
--
--   Phase 55 added p_rarity/p_cadence to the two WRITE RPCs only. Nobody
--   ever added rarity/cadence to the two READ RPCs' jsonb_build_object —
--   which means starter-pack-editor.js and content-oversight.js have never
--   once been able to see a quiz's real rarity/cadence. Every quiz drawn
--   from either editor defaults its draft to rarity:'Common'/cadence:
--   'standing' (see the `d = idx>=0 ? ... : {defaults}` fallback in both
--   files) regardless of what the row actually has — and because the write
--   RPCs DO now accept and persist p_rarity/p_cadence, opening a real
--   teacher's Epic/daily quiz through "Edit as" and clicking Save silently
--   downgrades it back to Common/standing. This is a genuine data-loss bug,
--   not just a stale-cache display issue — closing it is this migration's
--   main purpose.
--
--   Separately, neither read nor write side of either RPC ever knew about
--   chain_id/chain_order/chain_label (Phase 56) or start_date/end_date
--   (Phase 58) either — same bug class, just never surfaced because
--   nothing exercised those columns through these particular doors before.
--   Fixed here in the same pass rather than leaving a third migration to
--   catch it later.
--
-- THE FIX (this file)
--   1. get_starter_pack() / get_teacher_content(): add rarity, cadence,
--      chainId, chainOrder, chainLabel, startDate, endDate to the quizzes
--      jsonb_build_object (same camelCase keys the rest of the app's
--      RPC-returned JSON already uses).
--   2. upsert_starter_quiz() / oversight_upsert_quiz(): add
--      p_chain_id/p_chain_order/p_chain_label/p_start_date/p_end_date as
--      new DEFAULTED trailing parameters (rarity/cadence params already
--      exist from Phase 55, untouched here). Defaults match the same
--      "unset = pre-Phase-4/5 default" fallback eqQuizChain()/
--      eqQuizScheduleStatus() already use in utils.js, so any existing
--      caller that still omits them behaves exactly as before.
--   Same drop-then-recreate pattern as Phase 55/56/58 for the two write
--   RPCs, since PostgreSQL treats an appended parameter list as a new
--   overload rather than a true replacement.
--
--   The matching JS fix (starter-pack-service.js / content-oversight-
--   service.js now pass the five new params; both editors' "new draft"
--   defaults gain matching fields) is a separate, same-commit change.
--   This migration alone does not retroactively fix data already lost to
--   a prior Edit-as save — anything that already got reset to Common/
--   standing needs to be re-set once from the Quest Builder.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1a. get_starter_pack() — add rarity/cadence/chain/schedule to quizzes ──
create or replace function public.get_starter_pack()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can view the starter pack.';
  end if;

  return jsonb_build_object(
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'description', a.description, 'icon', a.icon,
        'category', a.category, 'rarity', a.rarity, 'xpReward', a.xp_reward,
        'coinReward', a.coin_reward, 'triggerType', a.trigger_type,
        'triggerValue', a.trigger_value, 'active', a.active
      ) order by a.name)
      from public.achievements a where a.is_starter_template
    ), '[]'::jsonb),
    'titles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'description', t.description, 'icon', t.icon,
        'rarity', t.rarity, 'active', t.active,
        'textColor', t.text_color, 'borderColor', t.border_color,
        'glowColor', t.glow_color, 'bgColor', t.bg_color
      ) order by t.name)
      from public.titles t where t.is_starter_template
    ), '[]'::jsonb),
    'quizzes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'title', q.title, 'description', q.description,
        'xpReward', q.xp_reward, 'coinReward', q.coin_reward,
        'timeLimit', q.time_limit, 'questions', q.questions, 'active', q.active,
        'rarity', coalesce(q.rarity, 'Common'), 'cadence', coalesce(q.cadence, 'standing'),
        'chainId', q.chain_id, 'chainOrder', coalesce(q.chain_order, 1), 'chainLabel', q.chain_label,
        'startDate', q.start_date, 'endDate', q.end_date
      ) order by q.title)
      from public.quizzes q where q.is_starter_template
    ), '[]'::jsonb),
    'campaignWorlds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'label', w.label, 'icon', w.icon, 'color', w.color,
        'description', w.description, 'stages', w.stages, 'active', w.active
      ) order by w.sort_order)
      from public.campaign_worlds w where w.is_starter_template
    ), '[]'::jsonb),
    'shopProducts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sp.id, 'name', sp.name, 'emoji', sp.emoji, 'description', sp.description,
        'category', sp.category, 'cost', sp.cost, 'active', sp.active
      ) order by sp.name)
      from public.shop_products sp where sp.is_starter_template
    ), '[]'::jsonb)
  );
end;
$$;
grant execute on function public.get_starter_pack() to authenticated;

-- ── 1b. get_teacher_content() — same fix, scoped to one real teacher ──
create or replace function public.get_teacher_content(p_owner_teacher_id text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can view another teacher''s content.';
  end if;
  if p_owner_teacher_id is null then
    raise exception 'owner_teacher_id is required';
  end if;

  return jsonb_build_object(
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'description', a.description, 'icon', a.icon,
        'category', a.category, 'rarity', a.rarity, 'xpReward', a.xp_reward,
        'coinReward', a.coin_reward, 'triggerType', a.trigger_type,
        'triggerValue', a.trigger_value, 'active', a.active
      ) order by a.name)
      from public.achievements a
      where a.owner_teacher_id = p_owner_teacher_id and not a.is_starter_template
    ), '[]'::jsonb),
    'titles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'description', t.description, 'icon', t.icon,
        'rarity', t.rarity, 'active', t.active,
        'textColor', t.text_color, 'borderColor', t.border_color,
        'glowColor', t.glow_color, 'bgColor', t.bg_color
      ) order by t.name)
      from public.titles t
      where t.owner_teacher_id = p_owner_teacher_id and not t.is_starter_template
    ), '[]'::jsonb),
    'quizzes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'title', q.title, 'description', q.description,
        'xpReward', q.xp_reward, 'coinReward', q.coin_reward,
        'timeLimit', q.time_limit, 'questions', q.questions, 'active', q.active,
        'rarity', coalesce(q.rarity, 'Common'), 'cadence', coalesce(q.cadence, 'standing'),
        'chainId', q.chain_id, 'chainOrder', coalesce(q.chain_order, 1), 'chainLabel', q.chain_label,
        'startDate', q.start_date, 'endDate', q.end_date
      ) order by q.title)
      from public.quizzes q
      where q.owner_teacher_id = p_owner_teacher_id and not q.is_starter_template
    ), '[]'::jsonb),
    'campaignWorlds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'label', w.label, 'icon', w.icon, 'color', w.color,
        'description', w.description, 'stages', w.stages, 'active', w.active
      ) order by w.sort_order)
      from public.campaign_worlds w
      where w.owner_teacher_id = p_owner_teacher_id and not w.is_starter_template
    ), '[]'::jsonb),
    'shopProducts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sp.id, 'name', sp.name, 'emoji', sp.emoji, 'description', sp.description,
        'category', sp.category, 'cost', sp.cost, 'active', sp.active
      ) order by sp.name)
      from public.shop_products sp
      where sp.owner_teacher_id = p_owner_teacher_id and not sp.is_starter_template
    ), '[]'::jsonb)
  );
end;
$$;
grant execute on function public.get_teacher_content(text) to authenticated;

-- ── 2a. upsert_starter_quiz() — add chain + scheduling params ──
drop function if exists public.upsert_starter_quiz(text, text, text, integer, integer, integer, jsonb, boolean, text, text);

create or replace function public.upsert_starter_quiz(
  p_id text, p_title text, p_description text, p_xp_reward integer,
  p_coin_reward integer, p_time_limit integer, p_questions jsonb, p_active boolean,
  p_rarity text default 'Common', p_cadence text default 'standing',
  p_chain_id text default null, p_chain_order integer default 1, p_chain_label text default null,
  p_start_date date default null, p_end_date date default null
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
    coin_reward, time_limit, questions, active, rarity, cadence,
    chain_id, chain_order, chain_label, start_date, end_date
  ) values (
    p_id, public.starter_template_owner_id(), true, p_title, p_description, p_xp_reward,
    p_coin_reward, p_time_limit, coalesce(p_questions, '[]'::jsonb), p_active,
    coalesce(p_rarity, 'Common'), coalesce(p_cadence, 'standing'),
    p_chain_id, coalesce(p_chain_order, 1), p_chain_label, p_start_date, p_end_date
  )
  on conflict (id) do update set
    title = excluded.title, description = excluded.description, xp_reward = excluded.xp_reward,
    coin_reward = excluded.coin_reward, time_limit = excluded.time_limit,
    questions = excluded.questions, active = excluded.active,
    rarity = excluded.rarity, cadence = excluded.cadence,
    chain_id = excluded.chain_id, chain_order = excluded.chain_order, chain_label = excluded.chain_label,
    start_date = excluded.start_date, end_date = excluded.end_date
  where public.quizzes.is_starter_template
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function
  public.upsert_starter_quiz(text, text, text, integer, integer, integer, jsonb, boolean, text, text, text, integer, text, date, date)
to authenticated;

-- ── 2b. oversight_upsert_quiz() — same fix ──
drop function if exists public.oversight_upsert_quiz(text, text, text, text, integer, integer, integer, jsonb, boolean, text, text);

create or replace function public.oversight_upsert_quiz(
  p_owner_teacher_id text, p_id text, p_title text, p_description text,
  p_xp_reward integer, p_coin_reward integer, p_time_limit integer,
  p_questions jsonb, p_active boolean,
  p_rarity text default 'Common', p_cadence text default 'standing',
  p_chain_id text default null, p_chain_order integer default 1, p_chain_label text default null,
  p_start_date date default null, p_end_date date default null
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
    coin_reward, time_limit, questions, active, rarity, cadence,
    chain_id, chain_order, chain_label, start_date, end_date
  ) values (
    p_id, p_owner_teacher_id, false, p_title, p_description, p_xp_reward,
    p_coin_reward, p_time_limit, coalesce(p_questions, '[]'::jsonb), p_active,
    coalesce(p_rarity, 'Common'), coalesce(p_cadence, 'standing'),
    p_chain_id, coalesce(p_chain_order, 1), p_chain_label, p_start_date, p_end_date
  )
  on conflict (id) do update set
    title = excluded.title, description = excluded.description, xp_reward = excluded.xp_reward,
    coin_reward = excluded.coin_reward, time_limit = excluded.time_limit,
    questions = excluded.questions, active = excluded.active,
    rarity = excluded.rarity, cadence = excluded.cadence,
    chain_id = excluded.chain_id, chain_order = excluded.chain_order, chain_label = excluded.chain_label,
    start_date = excluded.start_date, end_date = excluded.end_date
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
  public.oversight_upsert_quiz(text, text, text, text, integer, integer, integer, jsonb, boolean, text, text, text, integer, text, date, date)
to authenticated;

-- Confirms exactly one overload of each remains, and that it's the new
-- 15/16-arg version with chain + scheduling params.
select p.proname, pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('upsert_starter_quiz', 'oversight_upsert_quiz');
