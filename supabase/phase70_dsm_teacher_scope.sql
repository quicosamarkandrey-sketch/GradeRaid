-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 70 — DSM (NAVIGATION MANAGER) TEACHER SCOPE — SQL SIDE
-- (see modules/admin/dsm-manager.js's own "PHASE 70" comments and
-- dsm-service.js's _flushUpload() — the JS side of this shipped already;
-- this file is the SQL half that was never run.)
--
-- Run once in the Supabase SQL editor, after Phase 34.
--
-- THE BUG THIS CLOSES
--   dsm-manager.js / dsm-service.js were upgraded to give the Nav Manager a
--   third 'teacher' scope (separate from 'student'/'admin'), and
--   DSMService's _flushUpload() now calls:
--       DBService.rpc('save_dsm_settings', { p_student, p_teacher, p_admin })
--   But the deployed public.save_dsm_settings() (phase10, re-tightened in
--   phase34) only ever accepted (p_student, p_admin) — there is no
--   p_teacher parameter on the server. Supabase/PostgREST rejects an RPC
--   call that includes a named argument the function doesn't declare, so
--   THE ENTIRE CALL FAILS — not just the teacher part. Every "Apply &
--   Refresh" in Nav Manager (any tab, any scope) has therefore been
--   silently failing to sync to Supabase since the client-side Phase 70
--   change shipped; only the immediate in-memory + localStorage write in
--   dsm-service.js's write() succeeds, which is why changes look "saved"
--   in the moment but never actually reach the server.
--
--   Compounding it: public.get_dsm_settings() (read side) never returned a
--   'teacher' key at all, and dsm-service.js's initRemote() unconditionally
--   overwrites BOTH the in-memory cache and the localStorage mirror with
--   whatever it gets back from that RPC. So on every subsequent page
--   load/login, initRemote() pulls the last state that WAS ever
--   successfully saved on the server (stale, pre-Phase-70 data) and
--   stomps the newer local customization with it — which is what makes
--   Nav Manager changes look like they don't "permanently stay."
--
-- THE FIX
--   1. Allow 'teacher' in dsm_settings.scope.
--   2. get_dsm_settings() also returns a 'teacher' key.
--   3. save_dsm_settings() gains p_teacher jsonb default null and persists
--      it the same way as the other two scopes. Old 2-arg overload is
--      dropped so there's exactly one version of this function again.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Widen the scope check constraint to include 'teacher'.
alter table public.dsm_settings drop constraint if exists dsm_settings_scope_check;
alter table public.dsm_settings add constraint dsm_settings_scope_check
  check (scope in ('student', 'teacher', 'admin'));

-- 2. get_dsm_settings() — add 'teacher' to the returned object.
create or replace function public.get_dsm_settings()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'student', coalesce((select items from public.dsm_settings where scope = 'student'), '[]'::jsonb),
    'teacher', coalesce((select items from public.dsm_settings where scope = 'teacher'), '[]'::jsonb),
    'admin',   coalesce((select items from public.dsm_settings where scope = 'admin'),   '[]'::jsonb)
  );
$$;

grant execute on function public.get_dsm_settings() to anon, authenticated;

-- 3. save_dsm_settings() — add p_teacher; drop the stale 2-arg overload so
--    only one version of this function exists.
drop function if exists public.save_dsm_settings(jsonb, jsonb);

create or replace function public.save_dsm_settings(
  p_student jsonb default null,
  p_teacher jsonb default null,
  p_admin   jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can modify navigation settings.';
  end if;

  if p_student is not null then
    insert into public.dsm_settings (scope, items, updated_at, updated_by)
    values ('student', p_student, now(), auth.uid()::text)
    on conflict (scope) do update
      set items      = excluded.items,
          updated_at = now(),
          updated_by = excluded.updated_by;
  end if;

  if p_teacher is not null then
    insert into public.dsm_settings (scope, items, updated_at, updated_by)
    values ('teacher', p_teacher, now(), auth.uid()::text)
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

grant execute on function public.save_dsm_settings(jsonb, jsonb, jsonb) to authenticated;
