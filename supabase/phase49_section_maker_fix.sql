-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 49 — SECTION MAKER: FIX AMBIGUOUS OVERLOAD + AUTO-OWN ON CREATE
--
-- Run once in the Supabase SQL editor, after Phase 39.
--
-- BUG #1 — "Could not choose the best candidate function" on create
--   Phase 5 (§3, "fold attendance schedule into section creation") DROPPED
--   the 3-arg create_class_section(grade, name, adviser) and replaced it
--   with a single 7-arg version (grade, name, adviser, open, start,
--   late_cutoff, close) — specifically to avoid ending up with two
--   overloads (see Phase 5's own comment on this).
--
--   Phase 39 ("write-side auth fix") re-added `if not is_staff() then raise`
--   to create_class_section(), but wrote it as a fresh
--   `create or replace function create_class_section(p_grade_level text,
--   p_section_name text, p_adviser_id text default null)` — a 3-ARG
--   signature. Postgres treats different argument lists as different
--   functions, so `create or replace` didn't touch the Phase 5 7-arg
--   version; it silently created a SECOND, overloaded function instead,
--   with the is_staff() check living only on the 3-arg one. Any call with
--   exactly 3 named args (grade/name/adviser — which is every call site,
--   since the schedule params are optional) became ambiguous: Postgres
--   can't tell which of the two functions to use and refuses to guess.
--
--   FIX: drop the stray 3-arg overload. There is exactly one
--   create_class_section() again, and it carries BOTH the is_staff() gate
--   (Phase 39's fix) AND the optional schedule params (Phase 5's fix).
--
-- BUG #2 — a teacher's own section had no adviser, so they lost access to
-- it immediately
--   is_staff_for_section() (Phase 36) treats a section with adviser_id
--   IS NULL as admin-only — by design, so a freshly-backfilled/unclaimed
--   section doesn't silently let just anyone touch it. But the Section
--   Maker UI only shows the adviser picker to admins (modules/admin/
--   sections.js, _secAdviserFieldHTML) — a teacher creating a section had
--   no way to set p_adviser_id at all, so it stayed NULL, and the
--   section they'd just created immediately became something only an
--   admin could edit, reschedule, or archive.
--
--   FIX: create_class_section() now resolves ownership server-side instead
--   of trusting the client-supplied p_adviser_id:
--     - caller is a teacher (not admin)  → p_adviser_id is FORCED to
--       auth.uid() — the new section is always theirs. This also closes a
--       privilege gap: previously a teacher could theoretically pass any
--       p_adviser_id and hand a brand-new section to someone else.
--     - caller is an admin               → p_adviser_id is respected as
--       passed (including NULL for "unassigned"), same as before — an
--       admin can still stand up a section for another teacher, or leave
--       it unclaimed.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Drop the stray 3-arg overload Phase 39 accidentally introduced.
-- ═════════════════════════════════════════════════════════════════════════
drop function if exists public.create_class_section(text, text, text);

-- ═════════════════════════════════════════════════════════════════════════
-- 2. The one true create_class_section() — is_staff() gate (Phase 39) +
--    optional same-transaction schedule (Phase 5) + server-side ownership.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.create_class_section(
  p_grade_level   text,
  p_section_name  text,
  p_adviser_id    text default null,
  p_open_time     time default null,
  p_start_time    time default null,
  p_late_cutoff   time default null,
  p_close_time    time default null
)
returns public.class_sections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      public.class_sections;
  v_id       text;
  v_uid      text := auth.uid()::text;
  v_is_admin boolean;
begin
  if not public.is_staff() then
    raise exception 'not authorized to create a section';
  end if;

  v_is_admin := public.is_admin();

  -- A teacher always owns what they create; only an admin may create a
  -- section for someone else (or leave it unassigned).
  if not v_is_admin then
    p_adviser_id := v_uid;
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

  -- Schedule fields are all-or-nothing: a partial set (e.g. only open_time)
  -- is almost certainly a caller bug, not an intentional "leave the rest
  -- blank" — fail loudly instead of silently skipping schedule creation.
  if (p_open_time is not null or p_start_time is not null or p_late_cutoff is not null or p_close_time is not null)
     and not (p_open_time is not null and p_start_time is not null and p_late_cutoff is not null and p_close_time is not null)
  then
    raise exception 'If any schedule time is provided, open_time, start_time, late_cutoff, and close_time are all required.';
  end if;

  if p_open_time is not null and not (p_open_time <= p_start_time and p_start_time <= p_late_cutoff and p_late_cutoff <= p_close_time) then
    raise exception 'Schedule times must satisfy open_time <= start_time <= late_cutoff <= close_time';
  end if;

  v_id := 'sec_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);

  insert into public.class_sections (id, grade_level, section_name, adviser_id, archived)
  values (v_id, p_grade_level, trim(p_section_name), p_adviser_id, false)
  returning * into v_row;

  if p_open_time is not null then
    insert into public.attendance_schedules (class_id, open_time, start_time, late_cutoff, close_time, active)
    values (v_id, p_open_time, p_start_time, p_late_cutoff, p_close_time, true)
    on conflict (class_id) do update
      set open_time   = excluded.open_time,
          start_time  = excluded.start_time,
          late_cutoff = excluded.late_cutoff,
          close_time  = excluded.close_time,
          active      = true,
          updated_at  = now();
  end if;

  return v_row;
end;
$$;

grant execute on function
  public.create_class_section(text, text, text, time, time, time, time)
to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. Sanity check — confirm exactly one create_class_section() remains.
--    (Informational only; safe to run, produces no rows if healthy.)
-- ═════════════════════════════════════════════════════════════════════════
-- select proname, pg_get_function_identity_arguments(oid)
--   from pg_proc where proname = 'create_class_section';
