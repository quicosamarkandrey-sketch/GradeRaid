-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 55 — SECTION MAKER: EXPLICIT "NO CLASS THIS DAY"
--
-- Run once in the Supabase SQL editor, after Phase 54.
--
-- WHAT THIS ADDS
--   Phase 54 gave every weekday one of two states: "same as the default
--   schedule" (no override row) or "its own custom hours" (an override
--   row with real times). There was no way to say "this section simply
--   doesn't meet on Tuesdays" — the closest a teacher could get was
--   leaving Tuesday alone, which silently inherited the Monday–Friday
--   default instead of actually having no window that day.
--
--   attendance_schedules gains `day_off boolean not null default false`.
--   A day-specific override row (day_of_week 1..7) can now be marked
--   day_off = true — real times are still stored (the NOT NULL/order
--   check still applies, so a placeholder like 00:00 all the way through
--   is used), but every reader treats day_off = true as "no attendance
--   window at all today", not as "use these times". The default (day_of_week
--   0) row can never be day_off — a section with literally no schedule is
--   already representable by having no rows at all; forcing day_off there
--   would just be a confusing second way to say the same thing.
--
-- RESOLUTION — UNCHANGED SHAPE, NEW MEANING
--   get_effective_attendance_schedule() still returns "that weekday's
--   override if one exists, else the default row" exactly as Phase 54 left
--   it — a day_off row IS an override, so it's still returned instead of
--   falling through to the default. Every caller now needs to check the
--   returned row's day_off flag rather than assume a non-null result means
--   "scanning is open": process_attendance_scan() does this below, and the
--   JS-side callers (kiosk countdown, Command Center's Today's Schedule)
--   are updated in the same commit.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Schema — add day_off, restrict it to override rows only.
-- ═════════════════════════════════════════════════════════════════════════
alter table public.attendance_schedules
  add column if not exists day_off boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'attendance_schedules_dayoff_chk'
  ) then
    alter table public.attendance_schedules
      add constraint attendance_schedules_dayoff_chk check (not day_off or day_of_week between 1 and 7);
  end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. upsert_attendance_schedule() — gains p_day_off (default false, so
--    every Phase 54 call site keeps writing normal custom-hours rows
--    exactly as before). When true, the order check is skipped — the
--    stored times are a placeholder the UI never shows, not a real window.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.upsert_attendance_schedule(
  p_class_id    text,
  p_open_time   time,
  p_start_time  time,
  p_late_cutoff time,
  p_close_time  time,
  p_day_of_week smallint default 0,
  p_day_off     boolean default false
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

  if p_day_off and p_day_of_week = 0 then
    raise exception 'The default schedule cannot be marked as a day off — clear the section''s schedule instead.';
  end if;

  if not p_day_off and not (p_open_time <= p_start_time and p_start_time <= p_late_cutoff and p_late_cutoff <= p_close_time) then
    raise exception 'Schedule times must satisfy open_time <= start_time <= late_cutoff <= close_time';
  end if;

  insert into public.attendance_schedules (class_id, day_of_week, day_off, open_time, start_time, late_cutoff, close_time, active)
  values (p_class_id, p_day_of_week, p_day_off, p_open_time, p_start_time, p_late_cutoff, p_close_time, true)
  on conflict (class_id, day_of_week) do update
    set day_off     = excluded.day_off,
        open_time   = excluded.open_time,
        start_time  = excluded.start_time,
        late_cutoff = excluded.late_cutoff,
        close_time  = excluded.close_time,
        active      = true,
        updated_at  = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- Old 6-arg signature is superseded by the 7-arg one above.
drop function if exists public.upsert_attendance_schedule(text, time, time, time, time, smallint);

grant execute on function
  public.upsert_attendance_schedule(text, time, time, time, time, smallint, boolean)
to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. process_attendance_scan() — a day_off override now short-circuits to
--    the same "no schedule" rejection as a missing schedule, instead of
--    scanning against its (meaningless) placeholder times. New error code
--    'no_class_today' so the kiosk can render its calmer "closed" look
--    instead of the alarming red error look — this is an expected state,
--    not a malfunction.
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

  select * into v_sched from public.get_effective_attendance_schedule(p_class_id, v_today);

  if v_sched is null then
    return jsonb_build_object('ok', false, 'error', 'no_schedule',
      'message', 'No active attendance schedule for class ' || p_class_id);
  end if;

  if v_sched.day_off then
    return jsonb_build_object('ok', false, 'error', 'no_class_today',
      'message', 'This section has no class today.');
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
