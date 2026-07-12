-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 53 — FIX STUDENT-SIDE CATALOG VISIBILITY + CAMPAIGN SECTION SCOPING
--            + "MY SECTION" READ RPC
--
-- Run once in the Supabase SQL editor, after Phase 52.
--
-- ═════════════════════════════════════════════════════════════════════════
-- BUG #1 — students can't see their own teacher's shop/quizzes/achievements/
--          campaign at all (the reported symptom)
-- ═════════════════════════════════════════════════════════════════════════
-- ROOT CAUSE
--   Phase 32 gave achievements/titles/quizzes/campaign_worlds (and
--   shop_products, back in Phase 14) a SELECT policy with two branches:
--     1) public.is_same_staff_or_admin(owner_teacher_id) — the owning
--        teacher, or an admin.
--     2) a student in a section advised by that owner_teacher_id, checked
--        with a plain (non-security-definer) EXISTS that JOINs
--        public.class_sections:
--          exists (
--            select 1 from public.profiles p
--            join public.class_sections cs on cs.id = p.class_id
--            where p.id = auth.uid()::text and cs.adviser_id = <owner>
--          )
--
--   Because that EXISTS is a plain policy expression (not a SECURITY
--   DEFINER function), it runs under the CALLING student's own privileges
--   — so the inner `class_sections cs` reference is itself subject to
--   class_sections' RLS.
--
--   Phase 51 (this app's very next section-visibility hardening pass)
--   locked class_sections SELECT down to staff-only for authenticated
--   callers: "authenticated, student → sees nothing" (documented as
--   intentional there, since no student screen read class_sections
--   *directly* at the time). That's true — nothing reads it directly. But
--   branch 2 above reads it *indirectly*, inside a subquery, under the
--   student's own row-level security. The join now always returns zero
--   rows for a student, branch 2 is always false, and branch 1 is false
--   for anyone who isn't staff — so the whole policy evaluates false and a
--   student sees ZERO rows in achievements, titles, quizzes,
--   campaign_worlds, and shop_products. Every one of those tables inherited
--   this the moment Phase 51 shipped.
--
-- THE FIX
--   Move the "is this owner_teacher_id my section's adviser" check into a
--   SECURITY DEFINER helper (same posture as is_staff_for_section() /
--   is_same_staff_or_admin(), Phase 14) so it bypasses class_sections' RLS
--   internally — it still only ever answers "is <owner> MY adviser", never
--   exposes another row — then swap it into the five SELECT policies in
--   place of the broken raw join. Nothing else about those policies
--   (owner/admin branch, write policies, delete RPCs) changes.
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.is_my_advisers_content(p_owner_teacher_id text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.class_sections cs on cs.id = p.class_id
    where p.id = auth.uid()::text
      and cs.adviser_id = p_owner_teacher_id
  );
$$;
grant execute on function public.is_my_advisers_content(text) to anon, authenticated;

-- achievements
drop policy if exists achievements_select_scoped on public.achievements;
create policy achievements_select_scoped on public.achievements
  for select
  using (
    public.is_same_staff_or_admin(owner_teacher_id)
    or public.is_my_advisers_content(owner_teacher_id)
  );

-- titles
drop policy if exists titles_select_scoped on public.titles;
create policy titles_select_scoped on public.titles
  for select
  using (
    public.is_same_staff_or_admin(owner_teacher_id)
    or public.is_my_advisers_content(owner_teacher_id)
  );

-- quizzes
drop policy if exists quizzes_select_scoped on public.quizzes;
create policy quizzes_select_scoped on public.quizzes
  for select
  using (
    public.is_same_staff_or_admin(owner_teacher_id)
    or public.is_my_advisers_content(owner_teacher_id)
  );

-- campaign_worlds
drop policy if exists campaign_worlds_select_scoped on public.campaign_worlds;
create policy campaign_worlds_select_scoped on public.campaign_worlds
  for select
  using (
    public.is_same_staff_or_admin(owner_teacher_id)
    or public.is_my_advisers_content(owner_teacher_id)
  );

-- shop_products (Phase 14 original — same broken shape, same fix)
drop policy if exists shop_products_select_scoped on public.shop_products;
create policy shop_products_select_scoped on public.shop_products
  for select
  using (
    public.is_same_staff_or_admin(owner_teacher_id)
    or public.is_my_advisers_content(owner_teacher_id)
  );

-- ═════════════════════════════════════════════════════════════════════════
-- BUG #2 — campaign worlds have no per-section scoping at all (gap, not a
--          regression): quizzes and achievements can already be limited to
--          one or more of a teacher's sections (quiz_sections /
--          achievement_sections, Phases 15/16), but campaign_worlds never
--          got the equivalent wiring. campaign_stage_sections (the table)
--          has existed since Phase 14 — flagged again in
--          phase22_campaign_content_sync.sql as "a separate, not-yet-built
--          concern" — but no write RPC and no client read-side ever
--          landed, so every campaign world has always been visible to
--          EVERY section a teacher advises, with no way to say "this
--          storyline is only for 8-A, not 8-B."
--
-- THE FIX
--   set_campaign_world_sections(world_id, class_ids[]) — same
--   delete-then-insert shape as set_quiz_sections()/
--   set_achievement_sections(), except it fans the assignment out to every
--   stage_id inside the given world (campaign_stage_sections is keyed by
--   stage, not world, since a future "assign this one stage" UI can reuse
--   the same table without a migration). The client (Phase 53 JS changes)
--   always calls this at world granularity and reconstructs a
--   {worldId: [classId, ...]} map for reading, exactly like
--   quizSectionAssignments/achievementSectionAssignments.
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.set_campaign_world_sections(p_world_id text, p_class_ids text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class_id text;
  v_stage_id text;
  v_owner    text;
begin
  if p_world_id is null or trim(p_world_id) = '' then
    raise exception 'world id is required';
  end if;

  select owner_teacher_id into v_owner from public.campaign_worlds where id = p_world_id;
  if v_owner is null then
    raise exception 'campaign world not found';
  end if;
  if not public.is_same_staff_or_admin(v_owner) then
    raise exception 'not authorized for this campaign world';
  end if;

  foreach v_class_id in array coalesce(p_class_ids, array[]::text[]) loop
    if not public.is_staff_for_section(v_class_id) then
      raise exception 'not authorized for section %', v_class_id;
    end if;
  end loop;

  for v_stage_id in
    select (stage->>'id')
    from public.campaign_worlds cw, jsonb_array_elements(cw.stages) as stage
    where cw.id = p_world_id
  loop
    delete from public.campaign_stage_sections css
     where css.stage_id = v_stage_id
       and public.is_staff_for_section(css.class_id);

    insert into public.campaign_stage_sections (stage_id, class_id)
    select v_stage_id, x from unnest(coalesce(p_class_ids, array[]::text[])) as x
    on conflict (stage_id, class_id) do nothing;
  end loop;
end;
$$;
grant execute on function public.set_campaign_world_sections(text, text[]) to anon, authenticated;

-- Realtime — same two-part requirement as every prior phase that added a
-- table to this app's sync surface: the JS postgres_changes listener alone
-- does nothing until the table is also added to the publication.
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.campaign_stage_sections';
  exception when duplicate_object then
    null;
  end;
end $$;

-- delete_campaign_world() (Phase 32) never cleaned up campaign_stage_sections
-- rows for the deleted world's stages — harmless before now since nothing
-- read that table, but a real gap now that set_campaign_world_sections()
-- writes into it. Re-defined here to also delete those rows; everything
-- else (owner check, idempotent-on-missing behavior) is unchanged.
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

  delete from public.campaign_stage_sections css
   where css.stage_id in (
     select (stage->>'id')
     from public.campaign_worlds cw, jsonb_array_elements(cw.stages) as stage
     where cw.id = p_world_id
   );
  delete from public.campaign_worlds where id = p_world_id;
end;
$$;
grant execute on function public.delete_campaign_world(text) to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- ADDITION — get_my_section_info(): backs the new student-facing "My
-- Section" page (modules/section/my-section.js). A student can never read
-- class_sections or a classmate's profiles.* row directly (Phase 51 /
-- Phase 14 both correctly keep that closed) — this is a narrow, purpose-
-- built SECURITY DEFINER read that returns ONLY the calling student's own
-- section: its label, its adviser's display name + how much content
-- they've published, and the roster of the student's own classmates
-- (name/avatar/level/xp/tier — display fields only, nothing sensitive).
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.get_my_section_info()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_class_id text;
  v_result   jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  select class_id into v_class_id
  from public.profiles
  where id = auth.uid()::text and role = 'student';

  if v_class_id is null then
    return jsonb_build_object('section', null, 'teacher', null, 'classmates', '[]'::jsonb);
  end if;

  select jsonb_build_object(
    'section', jsonb_build_object(
      'id', cs.id,
      'gradeLevel', cs.grade_level,
      'sectionName', cs.section_name,
      'label', cs.grade_level || '-' || cs.section_name
    ),
    'teacher', (
      select jsonb_build_object(
        'id', p.id,
        'displayName', p.display_name,
        'achievementCount',   (select count(*)::int from public.achievements    a  where a.owner_teacher_id  = p.id),
        'quizCount',          (select count(*)::int from public.quizzes         q  where q.owner_teacher_id  = p.id),
        'campaignWorldCount', (select count(*)::int from public.campaign_worlds w  where w.owner_teacher_id  = p.id),
        'shopProductCount',   (select count(*)::int from public.shop_products   sp where sp.owner_teacher_id = p.id)
      )
      from public.profiles p
      where p.id = cs.adviser_id
    ),
    'classmates', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'displayName', s.display_name,
          'init', s.init,
          'color', s.color,
          'profilePicUrl', s.profile_pic_url,
          'xp', s.xp,
          'level', s.level,
          'tier', s.tier,
          'equippedTitleId', s.equipped_title_id
        )
        order by s.xp desc nulls last, s.display_name
      )
      from public.profiles s
      where s.class_id = cs.id and s.role = 'student'
    ), '[]'::jsonb)
  )
  into v_result
  from public.class_sections cs
  where cs.id = v_class_id;

  return coalesce(v_result, jsonb_build_object('section', null, 'teacher', null, 'classmates', '[]'::jsonb));
end;
$$;
grant execute on function public.get_my_section_info() to authenticated;
