-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 5 — BUG FIX PACK (see EduQuest_Bug_Investigation_Report.md)
--
-- Run once in the Supabase SQL editor, after Phase 1–4.
--
-- Fixes three server-side issues from the investigation report:
--   §1 — Manual Override / Recitation Award never reflected in a student's
--        stored totals (attendance_pct always computed correctly from logs,
--        it just was never re-derived after a write; recitation xp was never
--        folded back into profiles.xp at all).
--   §2 — Live Monitor / attendance day-rollover used the DB session's
--        default timezone (UTC) instead of Asia/Manila, so "today" flipped
--        at 8:00 AM Manila time instead of midnight.
--   §3 — New sections had no attendance schedule until a second, separate
--        step, so a brand-new section couldn't take attendance yet.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- §1a — RECITATION → profiles.xp SYNC TRIGGER
--
-- WHY A TRIGGER, NOT A CLIENT-SIDE RECOMPUTE
--   profiles.xp is a mixed bag fed by several legacy in-memory write paths
--   (quiz completion, achievements, world boss, shop) that have no queryable
--   ledger — only recitation and attendance have a real log table to
--   recompute from. XP can't be "recomputed from scratch" the way attendance
--   % can (there's nothing to recompute quiz/achievement XP FROM), so this
--   has to be an incremental accumulator: +pts exactly once per log row
--   inserted, -pts exactly once per row deleted (undo). A database trigger
--   is the only place that guarantee can be made atomically regardless of
--   which client (kiosk, Live Monitor, another tab) performed the write.
--
-- WHY class_id IS NOT NULL SCOPES THIS
--   Legacy rows (old Scanner-page "Log Recitation" button, see
--   modules/recitation/logger.js) already increment student.xp directly in
--   the browser and get persisted via the old bulk profiles upsert — AND
--   that same button also writes a recitation_log row (with class_id left
--   NULL, since the old page has no concept of "class"). If this trigger
--   applied to every row, those legacy points would be double-counted: once
--   by the old direct-increment path, once by this trigger. Scoping to
--   class_id IS NOT NULL means the trigger only ever fires for rows written
--   by the NEW system (Live Monitor's Manual Award panel / Scanner B tap via
--   log_recitation_point()), which is exactly the gap the bug report
--   describes — the old rows are left alone because they're already handled.
--
-- KNOWN LIMITATION (not introduced by this fix — pre-existing in the app)
--   The legacy bulk sync (db-service.js _pushCacheToSupabase) unconditionally
--   overwrites profiles.xp with whatever value a browser tab has cached in
--   memory, on every saveDB() call from ANYWHERE in the app (quiz grading,
--   achievements, world boss, etc.) — not a partial/column-scoped update. If
--   an admin has a stale tab open from before a Live Monitor recitation
--   award landed, the next unrelated saveDB() in that stale tab will clobber
--   the trigger's increment back down. This is the same "whole-row-wins"
--   risk that already exists for coins/achievements today; fixing it
--   properly means moving the bulk sync to column-scoped updates, which is
--   a larger refactor outside this bug report's scope. In the common case
--   (one admin session, or a fresh reload) the trigger fix below is
--   immediate and correct.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.trg_recitation_log_sync_xp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    if new.class_id is not null then
      update public.profiles
         set xp = greatest(0, coalesce(xp, 0) + coalesce(new.pts, 0))
       where id = new.student_id;
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    if old.class_id is not null then
      update public.profiles
         set xp = greatest(0, coalesce(xp, 0) - coalesce(old.pts, 0))
       where id = old.student_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists recitation_log_xp_sync on public.recitation_log;
create trigger recitation_log_xp_sync
  after insert or delete on public.recitation_log
  for each row execute function public.trg_recitation_log_sync_xp();


-- ═════════════════════════════════════════════════════════════════════════════
-- §2 — MANILA TIMEZONE FIX
--
-- process_attendance_scan() already computed "today" via
-- `now() at time zone 'Asia/Manila'` (see phase1_rfid_attendance.sql). These
-- three defaults did not, and silently used the database session's own
-- timezone (UTC on a stock Supabase project) — an 8-hour gap that made the
-- Live Monitor / manual override / close-session actions roll over to a new
-- day at 8:00 AM Manila time instead of midnight, and let a manual entry and
-- a real RFID scan for the same physical day land on two different
-- `log_date` values.
-- ═════════════════════════════════════════════════════════════════════════════

-- attendance_logs.log_date: only matters for any INSERT that omits log_date
-- entirely (defensive — every current call site passes it explicitly), but
-- fixing the column default closes the gap for future code too.
alter table public.attendance_logs
  alter column log_date set default ((now() at time zone 'Asia/Manila')::date);

create or replace function public.close_attendance_session(
  p_class_id text,
  p_log_date date default ((now() at time zone 'Asia/Manila')::date)
)
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

create or replace function public.override_attendance(
  p_student_id  text,
  p_class_id    text,
  p_status      text,
  p_recorded_by text,
  p_log_date    date default ((now() at time zone 'Asia/Manila')::date),
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

-- Signatures are unchanged (still `(text, date)` / `(text,text,text,text,date,text)`),
-- so the existing grants from phase1_rfid_attendance.sql still apply — no
-- re-grant needed, but harmless to repeat:
grant execute on function
  public.close_attendance_session(text, date),
  public.override_attendance(text, text, text, text, date, text)
to anon, authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- §3 — FOLD ATTENDANCE SCHEDULE INTO SECTION CREATION
--
-- create_class_section() gains four OPTIONAL schedule params. When all four
-- are supplied, the new section gets a matching attendance_schedules row in
-- the SAME transaction the section is created in, so it's immediately usable
-- for attendance — no second trip to the kiosk's settings screen required.
-- Omitting them (existing call sites, or an admin who wants to configure the
-- schedule later) behaves exactly as before: section created, no schedule
-- yet, editable later via upsert_attendance_schedule() same as today.
-- ═════════════════════════════════════════════════════════════════════════════

-- IMPORTANT: this changes the function's signature (4 new trailing params).
-- `create or replace function` only replaces a function with the EXACT SAME
-- signature — with a different arg list, Postgres would instead create a
-- second, overloaded function and leave the old 3-arg one in place, which
-- makes every existing 3-arg call site ("create_class_section(grade, name,
-- adviserId)") throw "function is not unique". Drop the old signature first
-- so there is exactly one create_class_section() going forward.
drop function if exists public.create_class_section(text, text, text);

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
