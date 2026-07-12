-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 50 — SECTION MAKER: EDITABLE SCHEDULE + upsert_attendance_schedule() AUTH FIX
--
-- Run once in the Supabase SQL editor, after Phase 49.
--
-- WHAT THIS IS FOR
--   Section Maker's edit modal only ever showed the attendance-schedule
--   fields on CREATE (modules/admin/sections.js — the block was wrapped in
--   `${isEdit ? '' : ...}`). Once a section existed, its open/start/late-
--   cutoff/close times could only be changed from the RFID kiosk's settings
--   screen, not from Section Maker itself, even though the RPC that does
--   the write (upsert_attendance_schedule(), Phase 1) already supports
--   updating an existing schedule via its `on conflict (class_id) do
--   update`. This migration doesn't change that RPC's behavior — the JS/UI
--   change (same commit) is what actually lets Section Maker call it in
--   edit mode. This file closes an auth gap discovered while wiring that up.
--
-- THE GAP THIS CLOSES
--   upsert_attendance_schedule() has been SECURITY DEFINER, granted to
--   anon + authenticated, with NO role/ownership check at all since Phase 1
--   — unlike create/update/archive_class_section() (closed by Phase 39) it
--   was never brought under is_staff_for_section(). Any authenticated
--   session — a student's own login included — could rewrite ANY section's
--   attendance window. Wiring Section Maker's edit modal to call this RPC
--   directly is exactly the moment to close this, not a new problem it
--   introduces: it was already reachable, just not from this screen.
--
-- THE FIX
--   Same helper, same posture as every other per-section write:
--   is_staff_for_section(p_class_id) — admin: any section; teacher: only a
--   section where class_sections.adviser_id = their own id; a section with
--   no adviser yet: admin-only. Signature and return shape are unchanged,
--   so AttendanceService.upsertSchedule() (JS) needs no changes.
-- ─────────────────────────────────────────────────────────────────────────────

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
  if not public.is_staff_for_section(p_class_id) then
    raise exception 'not authorized for this section';
  end if;

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

-- Signature is unchanged, so the existing grant from phase1_rfid_attendance.sql
-- still applies — repeating it here is harmless.
grant execute on function
  public.upsert_attendance_schedule(text, time, time, time, time)
to anon, authenticated;
