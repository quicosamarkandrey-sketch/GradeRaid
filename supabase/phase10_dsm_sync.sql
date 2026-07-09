-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 10 — DSM (NAVIGATION MANAGER) CROSS-DEVICE SYNC
-- (see EduQuest_Pending_Fixes_Report.md §1)
--
-- Run once in the Supabase SQL editor, after Phase 1–9.
--
-- THE BUG THIS CLOSES
--   Navigation Manager (dsm-manager.js) settings — sidebar order, visibility,
--   labels, lock state — used to live ONLY in localStorage (key
--   'eduquest_dsm_v2'), with no Supabase table backing them at all. An admin
--   editing the nav on one device/browser and clicking "Apply & Refresh"
--   only ever wrote to that one browser's storage; opening EduQuest anywhere
--   else showed the hardcoded defaults, because that browser's localStorage
--   never had the change.
--
-- THE FIX
--   A single small table holding one row per nav scope ('student'/'admin'),
--   plus two RPCs mirroring the pattern already used everywhere else in
--   this app (log_recitation_point, adjust_student_stats, etc.):
--     get_dsm_settings()            — read, open to any logged-in session
--                                      (both students and admins need the
--                                      current layout to render their own
--                                      sidebar).
--     save_dsm_settings(student,
--                        admin)      — write, staff-only (enforced inside
--                                      the function via is_staff(), not by
--                                      table-level RLS grants — there is no
--                                      insert/update policy on the table
--                                      itself, so the RPC is the only path
--                                      in either direction).
--   The matching JS change (dsm-service.js) makes DSMService a
--   cache-through facade exactly like DBService — dsm-manager.js's
--   dsmLoad()/dsmSave() call DSMService.read()/.write() completely
--   unchanged; they have no idea whether that's backed by localStorage or
--   Supabase underneath.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.dsm_settings (
  scope       text primary key check (scope in ('student', 'admin')),
  items       jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

alter table public.dsm_settings enable row level security;

-- Read: any logged-in session (student or admin) needs this to render its
-- own sidebar via dsmGetStudentNav()/dsmGetAdminNav().
drop policy if exists dsm_settings_read_all on public.dsm_settings;
create policy dsm_settings_read_all on public.dsm_settings
  for select
  using (true);

-- No insert/update/delete policy is granted here on purpose — every write
-- goes through save_dsm_settings() below, which is the sole write path in
-- both directions (mirrors how profiles' game-stat columns are now RPC-only
-- per phase9_student_stat_rpc.sql, just enforced from the start here rather
-- than narrowed after the fact).

create or replace function public.get_dsm_settings()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'student', coalesce((select items from public.dsm_settings where scope = 'student'), '[]'::jsonb),
    'admin',   coalesce((select items from public.dsm_settings where scope = 'admin'),   '[]'::jsonb)
  );
$$;

grant execute on function public.get_dsm_settings() to anon, authenticated;

create or replace function public.save_dsm_settings(
  p_student jsonb default null,
  p_admin   jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Only staff can modify navigation settings.';
  end if;

  if p_student is not null then
    insert into public.dsm_settings (scope, items, updated_at, updated_by)
    values ('student', p_student, now(), auth.uid()::text)
    on conflict (scope) do update
      set items      = excluded.items,
          updated_at = now(),
          updated_by = excluded.updated_by;
  end if;

  if p_admin is not null then
    insert into public.dsm_settings (scope, items, updated_at, updated_by)
    values ('admin', p_admin, now(), auth.uid()::text)
    on conflict (scope) do update
      set items      = excluded.items,
          updated_at = now(),
          updated_by = excluded.updated_by;
  end if;

  return public.get_dsm_settings();
end;
$$;

grant execute on function public.save_dsm_settings(jsonb, jsonb) to anon, authenticated;
