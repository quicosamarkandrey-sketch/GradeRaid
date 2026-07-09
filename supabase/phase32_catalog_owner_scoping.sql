-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 32 — CATALOG OWNER SCOPING
-- (see ISOLATION_ROLES_PLAN.md §4/§5, §12 step 3)
--
-- Run once in the Supabase SQL editor, after Phase 31.
--
-- THE GAP THIS CLOSES
--   achievements, titles, quizzes, and campaign_worlds are the four catalog
--   tables with no owner column at all today — global, any staff (which
--   today means any account, since role='admin' is all that exists) can
--   read AND edit every row. shop_products already solved this exact
--   problem back in Phase 14 with owner_teacher_id + is_same_staff_or_admin()
--   — this migration copies that pattern onto the remaining four tables,
--   verbatim, rather than inventing a new shape.
--
-- SEQUENCING NOTE
--   This does NOT yet depend on the admin/teacher role split actually
--   landing. is_same_staff_or_admin() already treats any account with
--   role in ('admin','teacher') as staff, and grants the 'admin' branch a
--   blanket override — so today, with every non-student account still
--   role='admin', every existing account keeps full read/write access to
--   everything, same as before. The isolation only takes effect once (a)
--   real teacher accounts exist and (b) each catalog row's owner_teacher_id
--   is set to someone other than the caller. Nothing breaks in the
--   meantime — this is safe to run now, ahead of the role-relabel step.
--
-- BACKFILL TARGET
--   Every existing row in these four tables backfills to
--   282c271c-2251-4b80-af0b-9f2e8cc6d4a0 (admin@gmail.com) per
--   ISOLATION_ROLES_PLAN.md §1 — its content stays with it even after that
--   account is relabeled role='teacher'.
--
-- WHAT'S NOT IN THIS FILE
--   - The role relabel itself (admin@gmail.com -> 'teacher', the new
--     oversight admin account) — separate step, not run here.
--   - seed_new_teacher() / the starter-pack copy mechanism (§6) — later
--     step, needs this column to exist first.
--   - award_achievement_to_student() / unlock_title_for_student() and the
--     other per-student unlock RPCs are UNCHANGED here on purpose: they
--     write to user_achievements / title_unlocks, never to the four
--     catalog tables themselves, so they have no owner_teacher_id to check
--     against. They keep the same no-extra-ownership-check kiosk-trust
--     posture phase17 already documented for award_achievement_to_student
--     (mirrors adjust_student_stats()). Flagging this explicitly since the
--     plan doc's §5 step 5 lists them alongside the delete_* RPCs — on
--     inspection they don't touch the columns this migration adds, so
--     there's nothing to change in them for this step.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Add the column (nullable first), backfill, then lock it down.
-- ═════════════════════════════════════════════════════════════════════════
alter table public.achievements    add column if not exists owner_teacher_id text references public.profiles(id);
alter table public.titles          add column if not exists owner_teacher_id text references public.profiles(id);
alter table public.quizzes         add column if not exists owner_teacher_id text references public.profiles(id);
alter table public.campaign_worlds add column if not exists owner_teacher_id text references public.profiles(id);

update public.achievements    set owner_teacher_id = '282c271c-2251-4b80-af0b-9f2e8cc6d4a0' where owner_teacher_id is null;
update public.titles          set owner_teacher_id = '282c271c-2251-4b80-af0b-9f2e8cc6d4a0' where owner_teacher_id is null;
update public.quizzes         set owner_teacher_id = '282c271c-2251-4b80-af0b-9f2e8cc6d4a0' where owner_teacher_id is null;
update public.campaign_worlds set owner_teacher_id = '282c271c-2251-4b80-af0b-9f2e8cc6d4a0' where owner_teacher_id is null;

alter table public.achievements    alter column owner_teacher_id set not null;
alter table public.titles          alter column owner_teacher_id set not null;
alter table public.quizzes         alter column owner_teacher_id set not null;
alter table public.campaign_worlds alter column owner_teacher_id set not null;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. Policies — replace the global select-all/staff-write pair on each
--    table with the exact shop_products_select_scoped / shop_products_
--    staff_write shape (phase14_section_isolation.sql §5a): owner or admin
--    can read+write; a student in a section advised by that owner can also
--    read (so their own teacher's badges/titles/quizzes/campaign still
--    render for them).
-- ═════════════════════════════════════════════════════════════════════════

-- achievements
drop policy if exists achievements_select_all  on public.achievements;
drop policy if exists achievements_staff_write on public.achievements;

create policy achievements_select_scoped on public.achievements
  for select
  using (
    public.is_same_staff_or_admin(owner_teacher_id)
    or exists (
      select 1 from public.profiles p
      join public.class_sections cs on cs.id = p.class_id
      where p.id = auth.uid()::text and cs.adviser_id = achievements.owner_teacher_id
    )
  );
create policy achievements_staff_write on public.achievements
  for all
  using (public.is_same_staff_or_admin(owner_teacher_id))
  with check (public.is_same_staff_or_admin(owner_teacher_id));

-- titles
drop policy if exists titles_select_all  on public.titles;
drop policy if exists titles_staff_write on public.titles;

create policy titles_select_scoped on public.titles
  for select
  using (
    public.is_same_staff_or_admin(owner_teacher_id)
    or exists (
      select 1 from public.profiles p
      join public.class_sections cs on cs.id = p.class_id
      where p.id = auth.uid()::text and cs.adviser_id = titles.owner_teacher_id
    )
  );
create policy titles_staff_write on public.titles
  for all
  using (public.is_same_staff_or_admin(owner_teacher_id))
  with check (public.is_same_staff_or_admin(owner_teacher_id));

-- quizzes
drop policy if exists quizzes_select_all  on public.quizzes;
drop policy if exists quizzes_staff_write on public.quizzes;

create policy quizzes_select_scoped on public.quizzes
  for select
  using (
    public.is_same_staff_or_admin(owner_teacher_id)
    or exists (
      select 1 from public.profiles p
      join public.class_sections cs on cs.id = p.class_id
      where p.id = auth.uid()::text and cs.adviser_id = quizzes.owner_teacher_id
    )
  );
create policy quizzes_staff_write on public.quizzes
  for all
  using (public.is_same_staff_or_admin(owner_teacher_id))
  with check (public.is_same_staff_or_admin(owner_teacher_id));

-- campaign_worlds
drop policy if exists campaign_worlds_select_all  on public.campaign_worlds;
drop policy if exists campaign_worlds_staff_write on public.campaign_worlds;

create policy campaign_worlds_select_scoped on public.campaign_worlds
  for select
  using (
    public.is_same_staff_or_admin(owner_teacher_id)
    or exists (
      select 1 from public.profiles p
      join public.class_sections cs on cs.id = p.class_id
      where p.id = auth.uid()::text and cs.adviser_id = campaign_worlds.owner_teacher_id
    )
  );
create policy campaign_worlds_staff_write on public.campaign_worlds
  for all
  using (public.is_same_staff_or_admin(owner_teacher_id))
  with check (public.is_same_staff_or_admin(owner_teacher_id));

-- ═════════════════════════════════════════════════════════════════════════
-- 3. delete_* RPCs (phase23/phase28/phase29) — swap the is_staff() check
--    for is_same_staff_or_admin(owner), same upgrade shop_products'
--    delete_shop_product() already had from day one. Idempotent-on-missing
--    behavior (return early if already gone) is unchanged.
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.delete_achievement(p_achievement_id text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_owner text;
begin
  select owner_teacher_id into v_owner from public.achievements where id = p_achievement_id;
  if v_owner is null then return; end if; -- already gone, treat as success

  if not public.is_same_staff_or_admin(v_owner) then
    raise exception 'not authorized to delete this achievement';
  end if;

  delete from public.user_achievements   where achievement_id = p_achievement_id;
  delete from public.achievement_sections where achievement_id = p_achievement_id;
  delete from public.achievements         where id = p_achievement_id;
end;
$$;
grant execute on function public.delete_achievement(text) to anon, authenticated;

create or replace function public.delete_title(p_title_id text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_owner text;
begin
  select owner_teacher_id into v_owner from public.titles where id = p_title_id;
  if v_owner is null then return; end if; -- already gone, treat as success

  if not public.is_same_staff_or_admin(v_owner) then
    raise exception 'not authorized to delete this title';
  end if;

  update public.profiles set equipped_title_id = null where equipped_title_id = p_title_id;
  delete from public.title_unlocks  where title_id = p_title_id;
  delete from public.title_sections where title_id = p_title_id;
  delete from public.titles         where id = p_title_id;
end;
$$;
grant execute on function public.delete_title(text) to anon, authenticated;

create or replace function public.delete_quiz(p_quiz_id text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_owner text;
begin
  select owner_teacher_id into v_owner from public.quizzes where id = p_quiz_id;
  if v_owner is null then return; end if; -- already gone, treat as success

  if not public.is_same_staff_or_admin(v_owner) then
    raise exception 'not authorized to delete this quiz';
  end if;

  delete from public.quiz_sections where quiz_id = p_quiz_id;
  delete from public.quizzes       where id = p_quiz_id;
end;
$$;
grant execute on function public.delete_quiz(text) to anon, authenticated;

create or replace function public.delete_campaign_world(p_world_id text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_owner text;
begin
  select owner_teacher_id into v_owner from public.campaign_worlds where id = p_world_id;
  if v_owner is null then return; end if; -- already gone, treat as success

  if not public.is_same_staff_or_admin(v_owner) then
    raise exception 'not authorized to delete this campaign world';
  end if;

  delete from public.campaign_worlds where id = p_world_id;
end;
$$;
grant execute on function public.delete_campaign_world(text) to anon, authenticated;
