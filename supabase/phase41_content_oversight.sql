-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 41 — CHUNK C: CONTENT OVERSIGHT (READ-ONLY DRILL-IN + "EDIT AS")
--
-- Run once in the Supabase SQL editor, after Phase 40.
--
-- WHAT THIS IS
--   A new admin-only screen: pick a teacher, see their achievements/titles/
--   quizzes/campaign world/shop content, read-only by default, with a
--   separate "Edit as [Teacher]" mode for the rare direct-fix case. Every
--   write made in "Edit as" mode is logged via Phase 40's
--   log_edit_as_action() (a separate call from the JS service layer, not
--   baked into these RPCs — see phase40's header note on why that's kept
--   narrow rather than generic).
--
-- SCOPE DECISIONS (confirmed before building)
--   - "Edit as" field depth mirrors the Starter Pack Editor (Phase 38)
--     exactly — core fields only, no quiz question builder, campaign
--     stages stay a raw JSON textarea. shop_products.stock is deliberately
--     left OUT for the same reason (not part of the starter pack's field
--     set) — flagging this explicitly in case direct stock fixes turn out
--     to be needed later.
--   - Delete is included, but reuses the EXISTING delete_achievement() /
--     delete_title() / delete_quiz() / delete_campaign_world() /
--     delete_shop_product() RPCs (phase23/28/29/32) completely unchanged —
--     they already check is_same_staff_or_admin(owner), which passes for
--     any admin regardless of who owns the row. Nothing to add here.
--
-- WHY NEW RPCs INSTEAD OF THE EXISTING BULK push() PATTERN
--   Today's normal single-teacher editing flow (db-service.js's push())
--   upserts a teacher's ENTIRE local achievements/titles/etc. cache array
--   at once, relying on RLS alone. That's wrong for oversight: an admin's
--   own local AppStore cache doesn't (and must not) contain another
--   teacher's rows, and stuffing one target row into it just to push()
--   would upsert-echo the admin's own unrelated catalog too and risk
--   leaking another teacher's data into the admin's own next render — the
--   exact trap starter-pack-service.js's header already called out and
--   avoided by not touching AppStore at all. So this mirrors phase38's
--   approach instead: dedicated SECURITY DEFINER RPCs, one row at a time,
--   is_admin()-gated, explicit p_owner_teacher_id — same shape as
--   upsert_starter_*(), just targeting the REAL (is_starter_template =
--   false) rows and taking an explicit owner instead of always writing to
--   the starter-template owner.
--
-- WHY is_admin() AND NOT is_same_staff_or_admin()
--   "Edit as" is an oversight override BY the admin account ON a teacher's
--   content — not a teacher's own edit. A teacher must not be able to
--   "edit as" another teacher, so these RPCs check is_admin() specifically,
--   same posture as upsert_starter_*() and save_school_settings().
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. get_teacher_content() — read-only bundle for the drill-in view.
--    Same jsonb_build_object shape as get_starter_pack(), scoped to one
--    teacher's REAL rows instead of the starter template.
-- ═════════════════════════════════════════════════════════════════════════
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
        'timeLimit', q.time_limit, 'questions', q.questions, 'active', q.active
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

-- ═════════════════════════════════════════════════════════════════════════
-- 2. oversight_upsert_*() — "Edit as" writes. One per table, same field
--    depth as upsert_starter_*() (Phase 38), targeting real rows for an
--    explicit p_owner_teacher_id instead of the starter-template owner.
--    Client always supplies p_id (fresh uid()-based id for "add new", the
--    existing row's id for "edit") — insert-or-update via ON CONFLICT.
--    The conflict-target WHERE guard checks BOTH not is_starter_template
--    AND owner_teacher_id = p_owner_teacher_id, so a colliding id can never
--    overwrite a starter-template row or a DIFFERENT teacher's row through
--    this path.
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.oversight_upsert_achievement(
  p_owner_teacher_id text, p_id text, p_name text, p_description text, p_icon text,
  p_category text, p_rarity text, p_xp_reward integer, p_coin_reward integer,
  p_trigger_type text, p_trigger_value integer, p_active boolean
)
returns public.achievements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.achievements;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can edit another teacher''s content.';
  end if;
  if p_owner_teacher_id is null then
    raise exception 'owner_teacher_id is required';
  end if;

  insert into public.achievements (
    id, owner_teacher_id, is_starter_template, name, description, icon, category,
    rarity, xp_reward, coin_reward, trigger_type, trigger_value, active
  ) values (
    p_id, p_owner_teacher_id, false, p_name, p_description, p_icon, p_category,
    p_rarity, p_xp_reward, p_coin_reward, p_trigger_type, p_trigger_value, p_active
  )
  on conflict (id) do update set
    name = excluded.name, description = excluded.description, icon = excluded.icon,
    category = excluded.category, rarity = excluded.rarity, xp_reward = excluded.xp_reward,
    coin_reward = excluded.coin_reward, trigger_type = excluded.trigger_type,
    trigger_value = excluded.trigger_value, active = excluded.active
  where not public.achievements.is_starter_template
    and public.achievements.owner_teacher_id = p_owner_teacher_id
  returning * into v_row;

  if v_row is null then
    raise exception 'Could not save — this id belongs to a different teacher or the starter pack.';
  end if;

  return v_row;
end;
$$;
grant execute on function
  public.oversight_upsert_achievement(text, text, text, text, text, text, text, integer, integer, text, integer, boolean)
to authenticated;

create or replace function public.oversight_upsert_title(
  p_owner_teacher_id text, p_id text, p_name text, p_description text, p_icon text,
  p_rarity text, p_active boolean, p_text_color text, p_border_color text,
  p_glow_color text, p_bg_color text
)
returns public.titles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.titles;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can edit another teacher''s content.';
  end if;
  if p_owner_teacher_id is null then
    raise exception 'owner_teacher_id is required';
  end if;

  insert into public.titles (
    id, owner_teacher_id, is_starter_template, name, description, icon, rarity,
    active, achievement_id, text_color, border_color, glow_color, bg_color
  ) values (
    p_id, p_owner_teacher_id, false, p_name, p_description, p_icon, p_rarity,
    p_active, null, p_text_color, p_border_color, p_glow_color, p_bg_color
  )
  on conflict (id) do update set
    name = excluded.name, description = excluded.description, icon = excluded.icon,
    rarity = excluded.rarity, active = excluded.active,
    text_color = excluded.text_color, border_color = excluded.border_color,
    glow_color = excluded.glow_color, bg_color = excluded.bg_color
  where not public.titles.is_starter_template
    and public.titles.owner_teacher_id = p_owner_teacher_id
  returning * into v_row;

  if v_row is null then
    raise exception 'Could not save — this id belongs to a different teacher or the starter pack.';
  end if;

  return v_row;
end;
$$;
grant execute on function
  public.oversight_upsert_title(text, text, text, text, text, text, boolean, text, text, text, text)
to authenticated;

create or replace function public.oversight_upsert_quiz(
  p_owner_teacher_id text, p_id text, p_title text, p_description text,
  p_xp_reward integer, p_coin_reward integer, p_time_limit integer,
  p_questions jsonb, p_active boolean
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
    coin_reward, time_limit, questions, active
  ) values (
    p_id, p_owner_teacher_id, false, p_title, p_description, p_xp_reward,
    p_coin_reward, p_time_limit, coalesce(p_questions, '[]'::jsonb), p_active
  )
  on conflict (id) do update set
    title = excluded.title, description = excluded.description, xp_reward = excluded.xp_reward,
    coin_reward = excluded.coin_reward, time_limit = excluded.time_limit,
    questions = excluded.questions, active = excluded.active
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
  public.oversight_upsert_quiz(text, text, text, text, integer, integer, integer, jsonb, boolean)
to authenticated;

create or replace function public.oversight_upsert_campaign_world(
  p_owner_teacher_id text, p_id text, p_label text, p_icon text, p_color text,
  p_description text, p_stages jsonb, p_active boolean
)
returns public.campaign_worlds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.campaign_worlds;
  v_next_sort integer;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can edit another teacher''s content.';
  end if;
  if p_owner_teacher_id is null then
    raise exception 'owner_teacher_id is required';
  end if;

  -- Sort order is scoped to the target teacher's own worlds, not global —
  -- each teacher has their own campaign map ordering (Phase 32).
  select coalesce(max(sort_order) + 1, 0) into v_next_sort
  from public.campaign_worlds
  where owner_teacher_id = p_owner_teacher_id and not is_starter_template;

  insert into public.campaign_worlds (
    id, owner_teacher_id, is_starter_template, label, icon, color, description,
    stages, sort_order, active
  ) values (
    p_id, p_owner_teacher_id, false, p_label, p_icon, p_color, p_description,
    coalesce(p_stages, '[]'::jsonb), v_next_sort, p_active
  )
  on conflict (id) do update set
    label = excluded.label, icon = excluded.icon, color = excluded.color,
    description = excluded.description, stages = excluded.stages, active = excluded.active
    -- sort_order deliberately NOT touched on update, same as upsert_starter_campaign_world().
  where not public.campaign_worlds.is_starter_template
    and public.campaign_worlds.owner_teacher_id = p_owner_teacher_id
  returning * into v_row;

  if v_row is null then
    raise exception 'Could not save — this id belongs to a different teacher or the starter pack.';
  end if;

  return v_row;
end;
$$;
grant execute on function
  public.oversight_upsert_campaign_world(text, text, text, text, text, text, jsonb, boolean)
to authenticated;

create or replace function public.oversight_upsert_shop_item(
  p_owner_teacher_id text, p_id text, p_name text, p_emoji text, p_description text,
  p_category text, p_cost integer, p_active boolean
)
returns public.shop_products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.shop_products;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can edit another teacher''s content.';
  end if;
  if p_owner_teacher_id is null then
    raise exception 'owner_teacher_id is required';
  end if;

  insert into public.shop_products (
    id, owner_teacher_id, is_starter_template, name, emoji, description, category, cost, active
  ) values (
    p_id, p_owner_teacher_id, false, p_name, p_emoji, p_description, p_category, p_cost, p_active
  )
  on conflict (id) do update set
    name = excluded.name, emoji = excluded.emoji, description = excluded.description,
    category = excluded.category, cost = excluded.cost, active = excluded.active
    -- stock deliberately not touched here — see header note, out of scope for v1.
  where not public.shop_products.is_starter_template
    and public.shop_products.owner_teacher_id = p_owner_teacher_id
  returning * into v_row;

  if v_row is null then
    raise exception 'Could not save — this id belongs to a different teacher or the starter pack.';
  end if;

  return v_row;
end;
$$;
grant execute on function
  public.oversight_upsert_shop_item(text, text, text, text, text, text, integer, boolean)
to authenticated;
