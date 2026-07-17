-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 54 — SECTION MAKER: WEEKLY ATTENDANCE SCHEDULE
--
-- Run once in the Supabase SQL editor, after Phase 50.
--
-- WHAT THIS FIXES
--   attendance_schedules has always been "one row per section, period" —
--   command-center.js even carries a DATA GAP comment about it:
--     "There is one attendance_schedules row per SECTION, not one per
--      weekday/period ... A section that meets at different times on
--      different days cannot be represented yet."
--   This migration removes that gap. A section now gets a DEFAULT schedule
--   (applies every day) plus, optionally, PER-DAY OVERRIDE rows for any day
--   that runs different hours (e.g. a shorter Friday, a later Wednesday
--   flag ceremony). Section Maker's UI (same commit) is where a teacher
--   actually sets these.
--
-- THE SHAPE
--   attendance_schedules gains `day_of_week smallint not null default 0`:
--     0     = the DEFAULT / whole-week row — every existing row becomes
--             one of these on migrate, so nothing already configured
--             changes behavior.
--     1..7  = an OVERRIDE for one ISO weekday (1=Monday .. 7=Sunday,
--             matching Postgres' `extract(isodow from date)`), used only
--             if present — a class_id with no override rows behaves
--             exactly as it always has (default row governs every day).
--   The old `unique (class_id)` becomes `unique (class_id, day_of_week)` —
--   a section can now have up to 8 rows (1 default + 7 overrides) instead
--   of exactly 1.
--
-- RESOLUTION ORDER (see get_effective_attendance_schedule() below)
--   For a given class + date: use that weekday's override row if one
--   exists and is active, otherwise fall back to the default (day 0) row.
--   process_attendance_scan() is repointed at this resolver instead of its
--   old "the one row for this class_id" lookup — same Early/On Time/Late/
--   Absent logic, just fed the correct day's window.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Schema — add day_of_week, swap the uniqueness constraint.
-- ═════════════════════════════════════════════════════════════════════════
alter table public.attendance_schedules
  add column if not exists day_of_week smallint not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'attendance_schedules_dow_chk'
  ) then
    alter table public.attendance_schedules
      add constraint attendance_schedules_dow_chk check (day_of_week between 0 and 7);
  end if;
end $$;

-- The original Phase 1 table declared `class_id text not null unique`, which
-- Postgres names attendance_schedules_class_id_key by default.
alter table public.attendance_schedules
  drop constraint if exists attendance_schedules_class_id_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'attendance_schedules_class_dow_key'
  ) then
    alter table public.attendance_schedules
      add constraint attendance_schedules_class_dow_key unique (class_id, day_of_week);
  end if;
end $$;

create index if not exists attendance_schedules_class_dow_idx
  on public.attendance_schedules (class_id, day_of_week);

-- ═════════════════════════════════════════════════════════════════════════
-- 2. create_class_section() — same 7-arg signature (Phase 49), its inline
--    schedule insert now targets the day-0 default row explicitly.
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
    insert into public.attendance_schedules (class_id, day_of_week, open_time, start_time, late_cutoff, close_time, active)
    values (v_id, 0, p_open_time, p_start_time, p_late_cutoff, p_close_time, true)
    on conflict (class_id, day_of_week) do update
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
-- 3. upsert_attendance_schedule() — gains p_day_of_week (default 0, so
--    every pre-existing call site — the kiosk's own quick-edit form —
--    keeps writing the default/whole-week row exactly as before).
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.upsert_attendance_schedule(
  p_class_id    text,
  p_open_time   time,
  p_start_time  time,
  p_late_cutoff time,
  p_close_time  time,
  p_day_of_week smallint default 0
)
returns public.attendance_schedules
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.attendance_schedules;
begin
  if not public.is_staff_for_section(p_class_id) then
    raise exception 'not authorized for this section';
  end if;

  if p_day_of_week is null or p_day_of_week < 0 or p_day_of_week > 7 then
    raise exception 'day_of_week must be between 0 (whole week) and 7 (Sunday)';
  end if;

  if not (p_open_time <= p_start_time and p_start_time <= p_late_cutoff and p_late_cutoff <= p_close_time) then
    raise exception 'Schedule times must satisfy open_time <= start_time <= late_cutoff <= close_time';
  end if;

  insert into public.attendance_schedules (class_id, day_of_week, open_time, start_time, late_cutoff, close_time, active)
  values (p_class_id, p_day_of_week, p_open_time, p_start_time, p_late_cutoff, p_close_time, true)
  on conflict (class_id, day_of_week) do update
    set open_time   = excluded.open_time,
        start_time  = excluded.start_time,
        late_cutoff = excluded.late_cutoff,
        close_time  = excluded.close_time,
        active      = true,
        updated_at  = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- Old 5-arg signature is superseded by the 6-arg one above — drop it so
-- there's exactly one upsert_attendance_schedule(), same reasoning as the
-- create_class_section() overload fix in Phase 49.
drop function if exists public.upsert_attendance_schedule(text, time, time, time, time);

grant execute on function
  public.upsert_attendance_schedule(text, time, time, time, time, smallint)
to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 4. clear_attendance_schedule_override() — removes ONE day's override so
--    that day falls back to the default row. Cannot touch day 0 itself
--    (that's a normal upsert/edit, not a "clear"); Section Maker's "Same as
--    default" toggle calls this when a teacher turns an override back off.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.clear_attendance_schedule_override(
  p_class_id    text,
  p_day_of_week smallint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff_for_section(p_class_id) then
    raise exception 'not authorized for this section';
  end if;

  if p_day_of_week is null or p_day_of_week < 1 or p_day_of_week > 7 then
    raise exception 'day_of_week must be between 1 (Monday) and 7 (Sunday) to clear an override';
  end if;

  delete from public.attendance_schedules
   where class_id = p_class_id and day_of_week = p_day_of_week;

  return found;
end;
$$;

grant execute on function
  public.clear_attendance_schedule_override(text, smallint)
to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 5. get_effective_attendance_schedule() — "which window applies on this
--    date": that weekday's override if one exists and is active, else the
--    default row. Used by process_attendance_scan() below, and is a plain
--    SELECT-able RPC so the kiosk/Command Center can ask the same question
--    the JS side used to answer by just grabbing "the" schedule row.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.get_effective_attendance_schedule(
  p_class_id text,
  p_for_date date default current_date
)
returns public.attendance_schedules
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dow smallint;
  v_row public.attendance_schedules;
begin
  v_dow := extract(isodow from p_for_date)::smallint; -- 1=Monday .. 7=Sunday

  select * into v_row from public.attendance_schedules
   where class_id = p_class_id and day_of_week = v_dow and active = true;

  if v_row is null then
    select * into v_row from public.attendance_schedules
     where class_id = p_class_id and day_of_week = 0 and active = true;
  end if;

  return v_row;
end;
$$;

grant execute on function
  public.get_effective_attendance_schedule(text, date)
to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 6. process_attendance_scan() — based on the Phase 7 version (cross-section
--    guard + Phase 5's race-safe `on conflict do nothing` insert), repointed
--    at the resolver above instead of "the one row for this class_id".
--    Everything else — Early/On Time/Late thresholds, already-recorded
--    guard, open/closed errors, the wrong-section check — is unchanged.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.process_attendance_scan(p_tag_id text, p_class_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id    text;
  v_student_name  text;
  v_student_class text;
  v_sched         public.attendance_schedules;
  v_now           timestamptz := now();
  v_local_ts      timestamptz := v_now at time zone 'Asia/Manila';
  v_scan_time     time := v_local_ts::time;
  v_today         date := v_local_ts::date;
  v_status        text;
  v_log           public.attendance_logs;
begin
  select student_id into v_student_id
    from public.rfid_cards
   where tag_id = p_tag_id and is_active = true
   limit 1;

  if v_student_id is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_card',
      'message', 'This card is not registered to any student.');
  end if;

  select name, class_id into v_student_name, v_student_class
    from public.profiles
   where id = v_student_id;

  if v_student_class is distinct from p_class_id then
    return jsonb_build_object('ok', false, 'error', 'wrong_section',
      'message', coalesce(v_student_name, 'This student') ||
        ' is enrolled in a different section and cannot be scanned here.',
      'student_id', v_student_id, 'student_class_id', v_student_class);
  end if;

  -- Was: `select * from attendance_schedules where class_id = p_class_id
  -- and active = true limit 1` — now resolves TODAY's weekday override if
  -- one exists, else the default (day 0) row. See §5 above.
  select * into v_sched from public.get_effective_attendance_schedule(p_class_id, v_today);

  if v_sched is null then
    return jsonb_build_object('ok', false, 'error', 'no_schedule',
      'message', 'No active attendance schedule for class ' || p_class_id);
  end if;

  select * into v_log from public.attendance_logs
   where student_id = v_student_id and class_id = p_class_id and log_date = v_today;
  if v_log is not null then
    return jsonb_build_object('ok', true, 'already_recorded', true,
      'student_id', v_student_id, 'status', v_log.status, 'log', to_jsonb(v_log));
  end if;

  if v_scan_time < v_sched.open_time then
    return jsonb_build_object('ok', false, 'error', 'not_open',
      'message', 'Attendance scanning has not opened yet.');
  elsif v_scan_time > v_sched.close_time then
    return jsonb_build_object('ok', false, 'error', 'closed',
      'message', 'The attendance window is closed. Use a manual override instead.');
  elsif v_scan_time < v_sched.start_time then
    v_status := 'Early';
  elsif v_scan_time < v_sched.late_cutoff then
    v_status := 'On Time';
  else
    v_status := 'Late';
  end if;

  insert into public.attendance_logs (student_id, class_id, log_date, status, scanned_at, entry_method, rfid_tag)
  values (v_student_id, p_class_id, v_today, v_status, v_now, 'RFID', p_tag_id)
  on conflict (student_id, class_id, log_date) do nothing
  returning * into v_log;

  if v_log is null then
    select * into v_log from public.attendance_logs
     where student_id = v_student_id and class_id = p_class_id and log_date = v_today;
    return jsonb_build_object('ok', true, 'already_recorded', true,
      'student_id', v_student_id, 'status', v_log.status, 'log', to_jsonb(v_log));
  end if;

  return jsonb_build_object('ok', true, 'already_recorded', false,
    'student_id', v_student_id, 'status', v_status, 'log', to_jsonb(v_log));
end;
$$;

grant execute on function
  public.process_attendance_scan(text, text)
to anon, authenticated;
