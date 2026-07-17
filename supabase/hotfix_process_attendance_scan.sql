-- HOTFIX: process_attendance_scan() referenced public.profiles.name, which
-- does not exist (the column is display_name). This was throwing 42703 on
-- every RFID scan. Re-running this replaces the function with the corrected
-- version. Safe to run multiple times.

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

  select display_name, class_id into v_student_name, v_student_class
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
