-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 4 — SECTION MAKER
--
-- Run once in the Supabase SQL editor, after Phase 1 (RFID/Attendance) and
-- Phase 2 (Seating). Implements Section_Maker_Feature_Spec.md.
--
-- WHAT THIS FIXES
--   Today `classId` is a free-text string that independently shows up on
--   profiles.class_id, attendance_schedules.class_id, classroom_layouts.class_id,
--   and attendance_logs.class_id, with nothing keeping them consistent and no
--   way to see/create an empty class. This migration adds a real
--   `class_sections` table and makes it the canonical source for that string
--   — every existing `classId` column stays exactly as-is (still `text`),
--   it just now gets populated with a `class_sections.id` value instead of
--   a hand-typed one.
--
-- FOLLOWS THE SAME RPC-ONLY WRITE PATTERN AS PHASE 1
--   (see the design note at the top of phase1_rfid_attendance.sql) — anon/
--   authenticated get SELECT only; every write goes through a SECURITY
--   DEFINER function.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── class_sections ──────────────────────────────────────────────────────────
create table if not exists public.class_sections (
  id            text primary key,          -- 'sec_' || generated random suffix — see create_class_section()
  grade_level   text not null,             -- '7'..'12', matches registrations.grade_level values exactly
  section_name  text not null,             -- e.g. 'Rizal'
  adviser_id    text references public.profiles(id), -- optional, nullable — the teacher/admin who owns it
  archived      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (grade_level, section_name)
);

create index if not exists class_sections_grade_idx on public.class_sections (grade_level);
create index if not exists class_sections_archived_idx on public.class_sections (archived);

alter table public.class_sections enable row level security;
create policy class_sections_select_all on public.class_sections for select using (true);
revoke insert, update, delete on public.class_sections from anon, authenticated;
grant select on public.class_sections to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPCs — the only write path into class_sections.
-- ─────────────────────────────────────────────────────────────────────────────

-- create_class_section(): admin creates a new section. Generates a stable,
-- rename-safe id (per §7.1 of the spec — a generated key survives renames,
-- since it's the value already baked into profiles/attendance_logs/
-- classroom_layouts/attendance_schedules as their classId).
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

-- update_class_section(): rename, reassign adviser, or change grade level.
-- Never touches `id` — renaming/regrading relabels the existing row so every
-- historical join (attendance_logs, classroom_layouts, etc.) stays intact,
-- per §5 of the spec. Pass NULL for any field you don't want to change.
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

-- archive_class_section() / unarchive_class_section(): soft-delete only —
-- never a hard delete, since a section may already have students, a
-- schedule, a seating layout, or attendance history attached (§5).
create or replace function public.archive_class_section(p_section_id text)
returns public.class_sections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.class_sections;
begin
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

create or replace function public.unarchive_class_section(p_section_id text)
returns public.class_sections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.class_sections;
begin
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

grant execute on function
  public.create_class_section(text, text, text),
  public.update_class_section(text, text, text, text, boolean),
  public.archive_class_section(text),
  public.unarchive_class_section(text)
to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- BACKFILL (§7.4) — one class_sections row per distinct classId string
-- already in use today, so no student silently loses their class on rollout.
-- Safe to re-run: ON CONFLICT DO NOTHING, keyed by the same generated-id
-- scheme, using the existing classId string AS the new id (this is the one
-- and only place a section id is NOT the 'sec_' random form — it preserves
-- the exact string every other table already has on file, so zero rows in
-- profiles/attendance_schedules/attendance_logs/classroom_layouts need to
-- be touched by this backfill).
--
-- grade_level/section_name are best-effort guesses ('backfilled classId
-- string' as the section_name, grade_level '0' as an "ungraded / legacy"
-- bucket) — an admin should review and rename these in Section Maker after
-- rollout; they are NOT meant to be the final display names.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.class_sections (id, grade_level, section_name, archived)
select distinct p.class_id, '0', p.class_id, false
  from public.profiles p
 where p.class_id is not null
   and length(trim(p.class_id)) > 0
   and not exists (select 1 from public.class_sections cs where cs.id = p.class_id)
on conflict (id) do nothing;

insert into public.class_sections (id, grade_level, section_name, archived)
select distinct s.class_id, '0', s.class_id, false
  from public.attendance_schedules s
 where s.class_id is not null
   and length(trim(s.class_id)) > 0
   and not exists (select 1 from public.class_sections cs where cs.id = s.class_id)
on conflict (id) do nothing;
