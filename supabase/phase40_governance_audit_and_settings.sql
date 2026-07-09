-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 40 — CHUNK E: GOVERNANCE (AUDIT LOG + GLOBAL SETTINGS)
--
-- Run once in the Supabase SQL editor, after Phase 39.
-- Ships ahead of Chunk C per the agreed build order (A → B → E → C → D → F) —
-- the "Edit as" override in C needs somewhere to log to on day one.
--
-- SCOPE DECISIONS (confirmed before building)
--   - Audit log is NARROW: built specifically for the "Edit as" override,
--     not a generic action-logger wired into every admin write. Chunk D's
--     ownership transfer and Chunk F's registration reassignment get their
--     own logging (if wanted) when those chunks are built — not retrofitted
--     here.
--   - Global settings v1 is just `school_name` (text) — no logo/branding.
--   - Term/school-year is a single free-text label (e.g. "SY 2026-2027") —
--     no start/end dates, no multi-term calendar.
--
-- WHAT THIS ADDS
--   1. `audit_log` table + `log_edit_as_action()` (write, admin-only) +
--      `get_audit_log()` (read, admin-only) — RPC-only, same pattern as
--      every other table in this app (see phase1_rfid_attendance.sql's
--      design note). Chunk C calls `log_edit_as_action()` once per write
--      it performs while an admin is in "Edit as" mode for a teacher.
--   2. `school_settings` table (single row) + `get_school_settings()`
--      (read, open to anon/authenticated — same openness as
--      get_dsm_settings(), since a school name/year label isn't sensitive
--      and may be shown in headers/kiosk) + `save_school_settings()`
--      (write, admin-only).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. AUDIT LOG
-- ═════════════════════════════════════════════════════════════════════════

create table if not exists public.audit_log (
  id                text primary key,        -- 'aud_' || generated random suffix
  actor_id          text not null references public.profiles(id), -- the admin who acted
  target_teacher_id text not null references public.profiles(id), -- whose account/content was edited
  table_name        text not null,           -- e.g. 'achievements', 'titles', 'quizzes'
  record_id         text not null,           -- the row id that was written
  action            text not null,           -- 'create' | 'update' | 'delete'
  details           jsonb,                   -- optional free-form context (e.g. changed fields)
  session_id        text,                    -- optional — lets a future UI group multiple
                                              -- writes under one "Edit as" session; nullable,
                                              -- not required for a single one-off write
  created_at        timestamptz not null default now()
);

create index if not exists audit_log_target_teacher_idx on public.audit_log (target_teacher_id);
create index if not exists audit_log_created_at_idx      on public.audit_log (created_at desc);

alter table public.audit_log enable row level security;
-- No select/insert policies at all — every access goes through the two RPCs
-- below, both of which are admin-gated. This mirrors class_sections'
-- "revoke, then RPC-only" pattern (phase4_section_maker.sql), tightened
-- further here since audit rows are more sensitive than section metadata.
revoke all on public.audit_log from anon, authenticated;

-- log_edit_as_action(): called by Chunk C once per write made while an
-- admin is in "Edit as" mode for a teacher. Actor is taken from auth.uid()
-- internally (never trusted from the client) so a caller can't forge who
-- performed the action.
create or replace function public.log_edit_as_action(
  p_target_teacher_id text,
  p_table_name        text,
  p_record_id         text,
  p_action            text,
  p_details           jsonb default null,
  p_session_id        text default null
)
returns public.audit_log
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.audit_log;
  v_id  text;
begin
  if not public.is_admin() then
    raise exception 'not authorized to log an Edit as action';
  end if;

  if p_target_teacher_id is null then
    raise exception 'target_teacher_id is required';
  end if;
  if p_table_name is null or length(trim(p_table_name)) = 0 then
    raise exception 'table_name is required';
  end if;
  if p_record_id is null or length(trim(p_record_id)) = 0 then
    raise exception 'record_id is required';
  end if;
  if p_action not in ('create', 'update', 'delete') then
    raise exception 'action must be one of create/update/delete, got: %', p_action;
  end if;

  v_id := 'aud_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);

  insert into public.audit_log
    (id, actor_id, target_teacher_id, table_name, record_id, action, details, session_id)
  values
    (v_id, auth.uid()::text, p_target_teacher_id, p_table_name, p_record_id, p_action, p_details, p_session_id)
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function
  public.log_edit_as_action(text, text, text, text, jsonb, text)
to anon, authenticated;

-- get_audit_log(): admin-only read. Optional filters; results newest first.
create or replace function public.get_audit_log(
  p_target_teacher_id text default null,
  p_limit             int  default 200
)
returns setof public.audit_log
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized to read the audit log';
  end if;

  return query
    select * from public.audit_log
     where p_target_teacher_id is null or target_teacher_id = p_target_teacher_id
     order by created_at desc
     limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;
grant execute on function public.get_audit_log(text, int) to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. GLOBAL SETTINGS (school name + current term/school-year label)
-- ═════════════════════════════════════════════════════════════════════════

create table if not exists public.school_settings (
  id                 boolean primary key default true, -- singleton row, enforced below
  school_name        text,
  school_year_label  text,                              -- e.g. 'SY 2026-2027', free text
  updated_at         timestamptz not null default now(),
  updated_by         text references public.profiles(id),
  constraint school_settings_singleton check (id = true)
);

insert into public.school_settings (id) values (true)
on conflict (id) do nothing;

alter table public.school_settings enable row level security;
revoke all on public.school_settings from anon, authenticated;
-- Same "RPC-only" pattern as everything else — reads go through
-- get_school_settings() rather than a select policy, so it stays
-- consistent with dsm_settings/class_sections rather than a one-off.

create or replace function public.get_school_settings()
returns public.school_settings
language sql
security definer
stable
set search_path = public
as $$
  select * from public.school_settings where id = true;
$$;
grant execute on function public.get_school_settings() to anon, authenticated;

create or replace function public.save_school_settings(
  p_school_name       text,
  p_school_year_label text
)
returns public.school_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.school_settings;
begin
  if not public.is_admin() then
    raise exception 'not authorized to change school settings';
  end if;

  update public.school_settings
     set school_name       = nullif(trim(p_school_name), ''),
         school_year_label = nullif(trim(p_school_year_label), ''),
         updated_at        = now(),
         updated_by        = auth.uid()::text
   where id = true
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.save_school_settings(text, text) to anon, authenticated;
