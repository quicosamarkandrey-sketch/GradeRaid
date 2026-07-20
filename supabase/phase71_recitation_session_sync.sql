-- ══════════════════════════════════════════════════════════════════════════
-- Phase 71 — Recitation session cross-device sync
--
-- THE GAP THIS CLOSES: Phase 3 (recitation_command_center.sql) deliberately
-- kept "is a recitation session active" entirely client-side — see
-- recitation-service.js's header comment: "there's no session_id column and
-- this migration deliberately doesn't add one." Right call for single-device
-- use, but it means pressing "Start Recitation Session" on one device (e.g.
-- a phone) has no way to reach any OTHER device signed into the same
-- account (e.g. the classroom computer) — each Live Monitor screen only
-- knows about the session IT personally started, in a plain in-memory JS
-- variable (_lmSessionStartAt in live_monitor.js).
--
-- THE FIX: a small recitation_sessions table — one row per session, at most
-- one ACTIVE row per class_id at a time (enforced by the partial unique
-- index below) — written to exclusively via two SECURITY DEFINER RPCs
-- (start_recitation_session / stop_recitation_session), same posture as
-- log_recitation_point/undo_recitation_log already use. Both RPCs are
-- idempotent: if a session is already active for a class,
-- start_recitation_session() just returns the EXISTING row instead of
-- erroring or creating a duplicate — this is what lets two devices that
-- both press "Start" within moments of each other converge on the exact
-- same session start time instead of racing.
--
-- RLS follows the same is_staff_for_section() shape every other
-- section-owned table in this schema already uses. All writes go through
-- the RPCs (SECURITY DEFINER bypasses RLS for the underlying table, same as
-- every other write-RPC here), so the only RLS policy needed is SELECT.
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.recitation_sessions (
  id           uuid primary key default gen_random_uuid(),
  class_id     text not null,
  started_by   text references public.profiles(id),
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  is_active    boolean not null default true
);

create index if not exists recitation_sessions_class_idx on public.recitation_sessions (class_id);

-- At most one ACTIVE session per class at any time — this is what makes
-- start_recitation_session() idempotent (see function below): a second
-- "Start" from another device just finds and returns this same row instead
-- of racing to insert a duplicate.
create unique index if not exists recitation_sessions_one_active_per_class
  on public.recitation_sessions (class_id)
  where is_active;

alter table public.recitation_sessions enable row level security;

drop policy if exists recitation_sessions_select_scoped on public.recitation_sessions;
create policy recitation_sessions_select_scoped on public.recitation_sessions
  for select
  using (public.is_staff_for_section(recitation_sessions.class_id));

-- ══════════════════════════════════════════════════════════════════════════
-- start_recitation_session(p_class_id) → recitation_sessions row
-- Idempotent — see header comment above.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.start_recitation_session(p_class_id text)
returns public.recitation_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.recitation_sessions;
begin
  if not public.is_staff_for_section(p_class_id) then
    raise exception 'Not authorized to start a recitation session for this class.';
  end if;

  select * into v_row
  from public.recitation_sessions
  where class_id = p_class_id and is_active
  limit 1;

  if found then
    return v_row;
  end if;

  insert into public.recitation_sessions (class_id, started_by, is_active)
  values (p_class_id, auth.uid()::text, true)
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.start_recitation_session(text) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- stop_recitation_session(p_class_id) → recitation_sessions row | null
-- Ends whichever session is currently active for this class, regardless of
-- which device/teacher started it (any staff for the section may stop it —
-- same "any staff can act on this section's data" posture as every other
-- write RPC in this schema). Returns null if nothing was active (e.g. two
-- devices both pressed "Stop" — the second is a harmless no-op, same shape
-- as undo_recitation_log's "already removed" case).
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.stop_recitation_session(p_class_id text)
returns public.recitation_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.recitation_sessions;
begin
  if not public.is_staff_for_section(p_class_id) then
    raise exception 'Not authorized to stop a recitation session for this class.';
  end if;

  update public.recitation_sessions
  set is_active = false, ended_at = now()
  where class_id = p_class_id and is_active
  returning * into v_row;

  return v_row; -- null if nothing was active
end;
$$;
grant execute on function public.stop_recitation_session(text) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- Realtime — add to the same publication every other live-synced table
-- rides. Same guarded/idempotent pattern as phase8_attendance_realtime.sql;
-- safe to run multiple times.
-- ══════════════════════════════════════════════════════════════════════════
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.recitation_sessions';
  exception when duplicate_object then
    null;
  end;
end $$;
