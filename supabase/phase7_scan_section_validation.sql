-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 7 — CROSS-SECTION SCAN VALIDATION (see EduQuest_Investigation_Report.md §4)
--
-- Run once in the Supabase SQL editor, after Phase 1–6.
--
-- WHAT THIS FIXES
--   process_attendance_scan(p_tag_id, p_class_id) looks up which student owns
--   the scanned card and logs the attendance under whatever class_id the
--   kiosk currently has selected — it never checked that the student's own
--   profiles.class_id matched the kiosk's selected section. A student from
--   Section A tapping in while the kiosk was set to Section B was logged
--   into Section B without complaint.
--
--   This adds a check right after the card lookup: if the student's own
--   profiles.class_id doesn't match the kiosk's selected p_class_id, the
--   scan is rejected with a new 'wrong_section' error before any schedule
--   or time-window logic runs (a student who simply isn't in this section
--   shouldn't get a "not open yet" / "closed" message — they should get told
--   they're at the wrong kiosk).
--
-- CLIENT-SIDE COMPANION CHANGE
--   modules/attendance/att_scanner_rfid.js — _rfidHandleAttendanceScan()
--   now maps 'wrong_section' to a specific message instead of falling back
--   to the SQL function's generic result.message.
-- ─────────────────────────────────────────────────────────────────────────────

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

  -- ── NEW: cross-section guard ──────────────────────────────────────────────
  -- Reject before touching the schedule/time-window logic at all — a
  -- student who isn't enrolled in this section is a different problem than
  -- "the window isn't open yet", and should read as one to whoever's at the
  -- kiosk.
  select name, class_id into v_student_name, v_student_class
    from public.profiles
   where id = v_student_id;

  if v_student_class is distinct from p_class_id then
    return jsonb_build_object('ok', false, 'error', 'wrong_section',
      'message', coalesce(v_student_name, 'This student') ||
        ' is enrolled in a different section and cannot be scanned here.',
      'student_id', v_student_id, 'student_class_id', v_student_class);
  end if;

  select * into v_sched from public.attendance_schedules
   where class_id = p_class_id and active = true limit 1;

  if v_sched is null then
    return jsonb_build_object('ok', false, 'error', 'no_schedule',
      'message', 'No active attendance schedule for class ' || p_class_id);
  end if;

  -- Already-recorded guard (checked before the time-window checks so a
  -- re-tap after the window closes still reports the original result
  -- instead of an unhelpful "closed" error).
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
    -- Lost a race to a concurrent scan/override that landed between our
    -- SELECT-guard above and this INSERT. Report whatever won.
    select * into v_log from public.attendance_logs
     where student_id = v_student_id and class_id = p_class_id and log_date = v_today;
    return jsonb_build_object('ok', true, 'already_recorded', true,
      'student_id', v_student_id, 'status', v_log.status, 'log', to_jsonb(v_log));
  end if;

  return jsonb_build_object('ok', true, 'already_recorded', false,
    'student_id', v_student_id, 'status', v_status, 'log', to_jsonb(v_log));
end;
$$;
