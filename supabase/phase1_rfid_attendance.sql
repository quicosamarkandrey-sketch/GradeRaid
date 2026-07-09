-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 1 — RFID/NFC INFRASTRUCTURE & SMART ATTENDANCE
--
-- Run once in the Supabase SQL editor, after Wave 1.
--
-- DESIGN NOTE — WHY THESE TABLES ARE WRITE-LOCKED FROM THE ANON KEY
--   Every other table in this project currently grants the anon key full
--   read/write (see Wave 1 notes — that's a known, separately-tracked gap,
--   not something this file silently fixes everywhere). attendance_logs and
--   rfid_cards are different: their invariants (one active card per
--   student, one attendance row per student/class/day, no double-counted
--   scans) can only be enforced atomically inside a transaction, and a bulk
--   client-side upsert can't do that safely. So this phase introduces a new
--   pattern for this app: ALL writes to these four new tables go through
--   SECURITY DEFINER RPC functions; the anon/authenticated roles get SELECT
--   only, nothing else. The RPCs still work for them because a SECURITY
--   DEFINER function runs with its owner's privileges (the table owner),
--   and RLS is bypassed for the table owner by default — so revoking INSERT/
--   UPDATE/DELETE from anon does not break the RPCs, it just closes the
--   direct-table-write hole.
--
-- TIMEZONE NOTE
--   process_attendance_scan() compares the scan's wall-clock time against
--   the schedule using Asia/Manila (matches the 'en-PH' formatting already
--   used throughout this codebase). Change the `at time zone` literal below
--   if your school is elsewhere.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── profiles.class_id — new column, additive only ─────────────────────────
-- Attendance is scoped per class/section. There's no `classes` table in this
-- app yet (sections today are just a free-text field captured at
-- registration) — class_id is a plain text key, not a foreign key, so admins
-- can start using it immediately ('default-class' for single-class
-- deployments) without first building out a full classes module.
alter table public.profiles
  add column if not exists class_id text not null default 'default-class';

-- ── rfid_cards ──────────────────────────────────────────────────────────────
create table if not exists public.rfid_cards (
  id          uuid primary key default gen_random_uuid(),
  tag_id      text not null,
  student_id  text not null references public.profiles(id),
  is_active   boolean not null default true,
  assigned_at timestamptz not null default now(),
  revoked_at  timestamptz
);

-- A tag can only be active on ONE row at a time; a student can only have
-- ONE active card at a time. Replacing a card means the old row's is_active
-- flips to false (see assign_rfid_card()) — it is NEVER deleted, so any
-- attendance_logs row that recorded a scan against that tag stays
-- historically intact and explainable ("which card scanned this?").
create unique index if not exists rfid_cards_tag_active_uq
  on public.rfid_cards (tag_id) where (is_active);
create unique index if not exists rfid_cards_student_active_uq
  on public.rfid_cards (student_id) where (is_active);
create index if not exists rfid_cards_student_idx on public.rfid_cards (student_id);

alter table public.rfid_cards enable row level security;
create policy rfid_cards_select_all on public.rfid_cards for select using (true);
revoke insert, update, delete on public.rfid_cards from anon, authenticated;
grant select on public.rfid_cards to anon, authenticated;

-- ── attendance_schedules ────────────────────────────────────────────────────
-- One active rule set per class. open_time/close_time bound the whole
-- scannable window; start_time/late_cutoff split that window into the
-- Early / On Time / Late buckets used by process_attendance_scan().
create table if not exists public.attendance_schedules (
  id          uuid primary key default gen_random_uuid(),
  class_id    text not null unique,
  open_time   time not null,
  start_time  time not null,
  late_cutoff time not null,
  close_time  time not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint attendance_schedules_order_chk
    check (open_time <= start_time and start_time <= late_cutoff and late_cutoff <= close_time)
);

alter table public.attendance_schedules enable row level security;
create policy attendance_schedules_select_all on public.attendance_schedules for select using (true);
revoke insert, update, delete on public.attendance_schedules from anon, authenticated;
grant select on public.attendance_schedules to anon, authenticated;

-- ── attendance_logs ─────────────────────────────────────────────────────────
create table if not exists public.attendance_logs (
  id            uuid primary key default gen_random_uuid(),
  student_id    text not null references public.profiles(id),
  class_id      text not null,
  log_date      date not null default current_date,
  status        text not null check (status in ('Early','On Time','Late','Absent','Excused')),
  scanned_at    timestamptz not null default now(),
  entry_method  text not null check (entry_method in ('RFID','Manual')),
  rfid_tag      text,             -- which physical card triggered this (null for Manual)
  recorded_by   text,             -- teacher/admin profile id (null for RFID)
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (student_id, class_id, log_date)
);

create index if not exists attendance_logs_class_date_idx on public.attendance_logs (class_id, log_date);
create index if not exists attendance_logs_student_idx on public.attendance_logs (student_id);

alter table public.attendance_logs enable row level security;
create policy attendance_logs_select_all on public.attendance_logs for select using (true);
revoke insert, update, delete on public.attendance_logs from anon, authenticated;
grant select on public.attendance_logs to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPCs — the only write path into the four objects above.
-- ─────────────────────────────────────────────────────────────────────────────

-- set_student_class(): admin assigns/reassigns which class a student belongs
-- to. Needed before close_attendance_session() can sweep a roster.
create or replace function public.set_student_class(p_student_id text, p_class_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set class_id = p_class_id where id = p_student_id;
$$;

-- upsert_attendance_schedule(): admin create/edit of a class's rule set.
create or replace function public.upsert_attendance_schedule(
  p_class_id    text,
  p_open_time   time,
  p_start_time  time,
  p_late_cutoff time,
  p_close_time  time
)
returns public.attendance_schedules
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.attendance_schedules;
begin
  if not (p_open_time <= p_start_time and p_start_time <= p_late_cutoff and p_late_cutoff <= p_close_time) then
    raise exception 'Schedule times must satisfy open_time <= start_time <= late_cutoff <= close_time';
  end if;

  insert into public.attendance_schedules (class_id, open_time, start_time, late_cutoff, close_time, active)
  values (p_class_id, p_open_time, p_start_time, p_late_cutoff, p_close_time, true)
  on conflict (class_id) do update
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

-- assign_rfid_card(): register or REPLACE a student's card. Old card is
-- deactivated, never deleted — historical attendance_logs rows referencing
-- the old rfid_tag stay readable and explainable.
create or replace function public.assign_rfid_card(p_student_id text, p_tag_id text)
returns public.rfid_cards
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.rfid_cards;
begin
  if p_student_id is null or p_tag_id is null or length(trim(p_tag_id)) = 0 then
    raise exception 'student_id and tag_id are required';
  end if;

  if not exists (select 1 from public.profiles where id = p_student_id) then
    raise exception 'Unknown student_id: %', p_student_id;
  end if;

  -- This student's previous card (if any) is retired.
  update public.rfid_cards
     set is_active = false, revoked_at = now()
   where student_id = p_student_id and is_active = true;

  -- If this physical tag was previously bound to a DIFFERENT student
  -- (re-issued/lost-and-found card), retire that binding too — the unique
  -- partial index on tag_id would reject the insert below otherwise.
  update public.rfid_cards
     set is_active = false, revoked_at = now()
   where tag_id = p_tag_id and is_active = true and student_id <> p_student_id;

  insert into public.rfid_cards (tag_id, student_id, is_active)
  values (p_tag_id, p_student_id, true)
  returning * into v_row;

  return v_row;
end;
$$;

-- process_attendance_scan(): the RFID hot path. Looks up the card, applies
-- the class's schedule, and inserts exactly one log row per student per
-- class per day. Re-scans (forgotten first tap, kid being a kid and tapping
-- twice) are reported back as already_recorded instead of overwriting the
-- first result — a teacher uses override_attendance() if a correction is
-- genuinely needed.
create or replace function public.process_attendance_scan(p_tag_id text, p_class_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id text;
  v_sched      public.attendance_schedules;
  v_now        timestamptz := now();
  v_local_ts   timestamptz := v_now at time zone 'Asia/Manila';
  v_scan_time  time := v_local_ts::time;
  v_today      date := v_local_ts::date;
  v_status     text;
  v_log        public.attendance_logs;
begin
  select student_id into v_student_id
    from public.rfid_cards
   where tag_id = p_tag_id and is_active = true
   limit 1;

  if v_student_id is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_card',
      'message', 'This card is not registered to any student.');
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

-- close_attendance_session(): sweep every student in a class who has no
-- attendance_logs row yet for the given day and mark them Absent. Intended
-- to be called once, after close_time, by an admin action (or a scheduled
-- job later) — NOT by the scanner itself.
create or replace function public.close_attendance_session(p_class_id text, p_log_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.attendance_logs (student_id, class_id, log_date, status, scanned_at, entry_method)
  select p.id, p_class_id, p_log_date, 'Absent', now(), 'Manual'
    from public.profiles p
   where p.role = 'student'
     and p.class_id = p_class_id
     and not exists (
       select 1 from public.attendance_logs al
        where al.student_id = p.id and al.class_id = p_class_id and al.log_date = p_log_date
     );

  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'absences_recorded', v_count, 'class_id', p_class_id, 'log_date', p_log_date);
end;
$$;

-- override_attendance(): teacher-initiated set/edit/remove. p_status is one
-- of 'Present' | 'Early' | 'On Time' | 'Late' | 'Absent' | 'Excused'
-- (Present is accepted as a convenience alias for 'On Time' — the table
-- itself only ever stores the five-value enum) | 'Remove' (deletes the row
-- instead of writing one — this is how a teacher undoes a mistaken entry).
-- "Edit" isn't a separate code path: calling this again with a different
-- status on an already-logged student just updates that row in place.
create or replace function public.override_attendance(
  p_student_id  text,
  p_class_id    text,
  p_status      text,
  p_recorded_by text,
  p_log_date    date default current_date,
  p_notes       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_log    public.attendance_logs;
begin
  if p_status = 'Remove' then
    delete from public.attendance_logs
     where student_id = p_student_id and class_id = p_class_id and log_date = p_log_date;
    return jsonb_build_object('ok', true, 'removed', true);
  end if;

  v_status := case when p_status = 'Present' then 'On Time' else p_status end;
  if v_status not in ('Early','On Time','Late','Absent','Excused') then
    raise exception 'Invalid status: %', p_status;
  end if;

  insert into public.attendance_logs (student_id, class_id, log_date, status, scanned_at, entry_method, recorded_by, notes)
  values (p_student_id, p_class_id, p_log_date, v_status, now(), 'Manual', p_recorded_by, p_notes)
  on conflict (student_id, class_id, log_date) do update
    set status       = excluded.status,
        entry_method = 'Manual',
        recorded_by  = excluded.recorded_by,
        notes        = excluded.notes,
        updated_at   = now()
  returning * into v_log;

  return jsonb_build_object('ok', true, 'log', to_jsonb(v_log));
end;
$$;

grant execute on function
  public.set_student_class(text, text),
  public.upsert_attendance_schedule(text, time, time, time, time),
  public.assign_rfid_card(text, text),
  public.process_attendance_scan(text, text),
  public.close_attendance_session(text, date),
  public.override_attendance(text, text, text, text, date, text)
to anon, authenticated;
