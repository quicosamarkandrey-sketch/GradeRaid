-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 39 — SECTION MAKER: WRITE-SIDE AUTH FIX
--
-- Run once in the Supabase SQL editor, after Phase 38.
-- Closes ISOLATION_ROLES_PLAN.md §8 ("Headline finding independent of the
-- tier decision: the sections gap"), sequenced first per §12 step 1
-- ("blocking, small, and everything else's correctness depends on it").
--
-- THE GAP THIS CLOSES
--   create_class_section() / update_class_section() / archive_class_section()
--   / unarchive_class_section() (all Phase 4) are SECURITY DEFINER and
--   granted to anon + authenticated with zero role check of any kind — no
--   is_staff(), no is_staff_for_section(), nothing. Any authenticated
--   session (a student's own login included) could create a section, rename
--   any section, or reassign/clear any section's adviser_id, which is the
--   exact column every other isolation check (is_staff_for_section(),
--   is_same_staff_or_admin()) ultimately reads. §8 flags archive/unarchive
--   were named separately in the plan text but share the identical gap
--   (same p_section_id shape, same file, same missing check), so this
--   migration closes all four rather than leaving two half-fixed.
--
-- THE FIX
--   - create_class_section(): no existing row to check ownership against
--     yet, so gated to public.is_staff() (any active admin/teacher). Per
--     §8/§12, this is the tier-independent minimum fix — restricting WHO a
--     teacher may create a section for/as-owner is the Large, tier-specific
--     work tracked separately in §9 row 12 and deferred.
--   - update_class_section() / archive_class_section() /
--     unarchive_class_section(): gated to public.is_staff_for_section(id),
--     the same helper already governing every other per-section table since
--     Phase 14/36. This already gives "teacher: own sections only, admin:
--     any" — including "no adviser yet = admin-only" — for free, with no
--     new helper needed, which is why §12 calls this step small.
--   - Nothing else about these four functions changes (signatures, return
--     shapes, backfill) — existing callers (SectionService.createSection /
--     updateSection, and any archive/unarchive callers) need no changes.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. create_class_section() — now requires is_staff()
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.create_class_section(
  p_grade_level  text,
  p_section_name text,
  p_adviser_id   text default null
)
returns public.class_sections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.class_sections;
  v_id  text;
begin
  if not public.is_staff() then
    raise exception 'not authorized to create a section';
  end if;

  if p_grade_level is null or length(trim(p_grade_level)) = 0 then
    raise exception 'grade_level is required';
  end if;
  if p_section_name is null or length(trim(p_section_name)) = 0 then
    raise exception 'section_name is required';
  end if;

  if exists (
    select 1 from public.class_sections
     where grade_level = p_grade_level
       and lower(section_name) = lower(trim(p_section_name))
  ) then
    raise exception 'A section named "%" already exists for grade %', p_section_name, p_grade_level;
  end if;

  v_id := 'sec_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);

  insert into public.class_sections (id, grade_level, section_name, adviser_id, archived)
  values (v_id, p_grade_level, trim(p_section_name), p_adviser_id, false)
  returning * into v_row;

  return v_row;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. update_class_section() — now requires is_staff_for_section(p_section_id)
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.update_class_section(
  p_section_id   text,
  p_grade_level  text default null,
  p_section_name text default null,
  p_adviser_id   text default null,
  p_clear_adviser boolean default false
)
returns public.class_sections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.class_sections;
  v_new_grade text;
  v_new_name  text;
begin
  if not public.is_staff_for_section(p_section_id) then
    raise exception 'not authorized for this section';
  end if;

  select * into v_row from public.class_sections where id = p_section_id;
  if v_row is null then
    raise exception 'Unknown section id: %', p_section_id;
  end if;

  v_new_grade := coalesce(p_grade_level, v_row.grade_level);
  v_new_name  := coalesce(nullif(trim(p_section_name), ''), v_row.section_name);

  if exists (
    select 1 from public.class_sections
     where grade_level = v_new_grade
       and lower(section_name) = lower(v_new_name)
       and id <> p_section_id
  ) then
    raise exception 'A section named "%" already exists for grade %', v_new_name, v_new_grade;
  end if;

  update public.class_sections
     set grade_level  = v_new_grade,
         section_name = v_new_name,
         adviser_id   = case when p_clear_adviser then null
                             else coalesce(p_adviser_id, adviser_id) end,
         updated_at   = now()
   where id = p_section_id
  returning * into v_row;

  return v_row;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. archive_class_section() — now requires is_staff_for_section(p_section_id)
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.archive_class_section(p_section_id text)
returns public.class_sections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.class_sections;
begin
  if not public.is_staff_for_section(p_section_id) then
    raise exception 'not authorized for this section';
  end if;

  update public.class_sections
     set archived = true, updated_at = now()
   where id = p_section_id
  returning * into v_row;

  if v_row is null then
    raise exception 'Unknown section id: %', p_section_id;
  end if;

  return v_row;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 4. unarchive_class_section() — now requires is_staff_for_section(p_section_id)
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.unarchive_class_section(p_section_id text)
returns public.class_sections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.class_sections;
begin
  if not public.is_staff_for_section(p_section_id) then
    raise exception 'not authorized for this section';
  end if;

  update public.class_sections
     set archived = false, updated_at = now()
   where id = p_section_id
  returning * into v_row;

  if v_row is null then
    raise exception 'Unknown section id: %', p_section_id;
  end if;

  return v_row;
end;
$$;

-- Grants unchanged (anon still can't do anything useful — is_staff()/
-- is_staff_for_section() both resolve auth.uid() to null for anon and
-- return false, so every one of the four now raises for anon regardless).
grant execute on function
  public.create_class_section(text, text, text),
  public.update_class_section(text, text, text, text, boolean),
  public.archive_class_section(text),
  public.unarchive_class_section(text)
to anon, authenticated;
