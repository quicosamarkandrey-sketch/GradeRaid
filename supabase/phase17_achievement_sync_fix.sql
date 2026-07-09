-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 17 — ACHIEVEMENT SYNC GAP FIX
--
-- Run once in the Supabase SQL editor, after Phase 16.
--
-- THE BUG THIS CLOSES
--   Found while tracing the achievements module as a reference pattern for
--   syncing titles to Supabase. Two write paths were never actually wired,
--   despite the tables/RLS already existing:
--
--   1. `achievements` (the catalog — name/icon/rarity/xp_reward/coin_reward/
--      trigger rules) is pulled from Supabase in db-service.js, but there is
--      no matching push block in _pushCacheToSupabase(). Admin create/edit/
--      delete of a badge (ach_admin_page.js) only ever mutates the local
--      DB.achievements array — a badge created or edited on one device
--      never reaches another device at all.
--
--   2. `user_achievements` (the per-student unlock/claim record) already has
--      RLS that blocks direct student inserts and comments saying "awarded
--      server-side only" / "unchanged: RPC only" — but no such RPC was ever
--      written, and no bulk-push exists for it either. An achievement a
--      student unlocks, claims, or has manually granted/revoked by an admin
--      today only ever updates DB.achievementUnlocks locally; none of it
--      reaches Supabase.
--
-- THE FIX
--   - `achievements` gets RLS confirming public read + is_staff() write, and
--     a new push block in db-service.js upserts it, same pattern already
--     used for boss_events/shop_products.
--   - `award_achievement_to_student()` — SECURITY DEFINER RPC, records an
--     unlock (claimed=false for auto-unlock, or claimed=true + reward
--     amounts for an immediate admin grant). Idempotent via a unique
--     constraint on (student_id, achievement_id) — a second call for an
--     already-unlocked achievement is a silent no-op, not an error.
--   - `claim_achievement_reward()` — SECURITY DEFINER RPC, marks a
--     previously-auto-unlocked-but-unclaimed row claimed and stamps the
--     actual xp/coins granted at claim time. Only affects rows where
--     claimed = false, so double-claiming can't double-grant.
--   - `revoke_achievement_from_student()` — SECURITY DEFINER RPC, deletes
--     the unlock row (mirrors achAdminDoGrant's revoke branch).
--
--   Trust model matches the existing adjust_student_stats() RPC exactly
--   (see phase9_student_stat_rpc.sql): granted to anon+authenticated with
--   no extra ownership check inside the function body. This is not a new
--   gap — it's the same posture already used for every other
--   student-stat-mutating RPC in this app (kiosk-trust model, not a
--   public-internet-facing API).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. `achievements` — confirm RLS (public read, staff write), so the new
--    push block below has somewhere safe to land.
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists achievements_select_all  on public.achievements;
drop policy if exists achievements_staff_write on public.achievements;

create policy achievements_select_all on public.achievements
  for select using (true); -- catalog is global; per-section visibility is
                            -- handled client-side via achievement_sections
                            -- (Phase 16), not by hiding rows here.

create policy achievements_staff_write on public.achievements
  for all using (public.is_staff()) with check (public.is_staff());

-- ═════════════════════════════════════════════════════════════════════════
-- 2. `user_achievements` — idempotency + the three missing RPCs.
-- ═════════════════════════════════════════════════════════════════════════
create unique index if not exists user_achievements_student_ach_uidx
  on public.user_achievements(student_id, achievement_id);

create or replace function public.award_achievement_to_student(
  p_student_id     text,
  p_achievement_id text,
  p_xp_granted     integer default 0,
  p_coins_granted  integer default 0,
  p_claimed        boolean default false,
  p_class_id       text default null
)
returns public.user_achievements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.user_achievements;
begin
  if p_student_id is null or length(trim(p_student_id)) = 0 then
    raise exception 'p_student_id is required';
  end if;
  if p_achievement_id is null or length(trim(p_achievement_id)) = 0 then
    raise exception 'p_achievement_id is required';
  end if;

  insert into public.user_achievements
    (student_id, achievement_id, unlocked_at, xp_granted, coins_granted, claimed, claimed_at, class_id)
  values
    (p_student_id, p_achievement_id, now(), coalesce(p_xp_granted, 0), coalesce(p_coins_granted, 0),
     coalesce(p_claimed, false),
     case when coalesce(p_claimed, false) then now() else null end,
     coalesce(p_class_id, (select class_id from public.profiles where id = p_student_id), 'default-class'))
  on conflict (student_id, achievement_id) do nothing
  returning * into v_row;

  -- Already existed (idempotent replay, e.g. a retried fire-and-forget
  -- call) — return the existing row instead of null so the caller can
  -- still tell the unlock is in place.
  if v_row.student_id is null then
    select * into v_row from public.user_achievements
     where student_id = p_student_id and achievement_id = p_achievement_id;
  end if;

  return v_row;
end;
$$;
grant execute on function
  public.award_achievement_to_student(text, text, integer, integer, boolean, text)
to anon, authenticated;

create or replace function public.claim_achievement_reward(
  p_student_id     text,
  p_achievement_id text,
  p_xp_granted     integer default 0,
  p_coins_granted  integer default 0
)
returns public.user_achievements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.user_achievements;
begin
  update public.user_achievements
     set claimed        = true,
         claimed_at      = now(),
         xp_granted      = coalesce(p_xp_granted, 0),
         coins_granted   = coalesce(p_coins_granted, 0)
   where student_id = p_student_id
     and achievement_id = p_achievement_id
     and claimed = false
   returning * into v_row;

  -- No row updated means it was already claimed (or never unlocked) —
  -- returning null lets the caller treat this the same as
  -- achGrantRewardsForClaim()'s existing "false" return today, without
  -- granting a second time.
  return v_row;
end;
$$;
grant execute on function
  public.claim_achievement_reward(text, text, integer, integer)
to anon, authenticated;

create or replace function public.revoke_achievement_from_student(
  p_student_id     text,
  p_achievement_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.user_achievements
   where student_id = p_student_id
     and achievement_id = p_achievement_id;
end;
$$;
grant execute on function
  public.revoke_achievement_from_student(text, text)
to anon, authenticated;
