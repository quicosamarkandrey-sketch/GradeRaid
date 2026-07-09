-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 34 — ADMIN ROLE MANAGEMENT RPCs + NAV-MANAGER ADMIN-ONLY GATE
-- (see ISOLATION_ROLES_PLAN.md §11 "Role changes", §12 step 5, chunk A1)
--
-- Run once in the Supabase SQL editor, after Phase 33.
--
-- WHAT THIS ADDS
--   1. promote_to_admin(p_teacher_id) / demote_to_teacher(p_admin_id) — the
--      "Role changes" bullet from §11: promote/demote between `teacher` and
--      `admin` from a screen, instead of only the SQL-editor one-off command
--      §1 originally described for creating the first oversight admin.
--      Both are admin-gated (is_admin(), from Phase 33) and callable by any
--      authenticated session — the function body is the only real gate,
--      same shape as every other admin-only RPC in this app.
--   2. save_dsm_settings() — tightened from is_staff() (any admin OR
--      teacher) to is_admin() only. This is the actual enforcement half of
--      making Navigation Manager admin-only (§10): hiding the sidebar
--      button (nav.js/dsm-manager.js, same phase) means nothing on its own
--      if a teacher's session could still call the RPC directly and
--      reconfigure the single shared dsm_settings row for the whole school.
--
-- WHAT'S NOT IN THIS FILE
--   - The Teacher Directory read RPC (get_teacher_directory() or similar)
--     that will actually list accounts to promote/demote — that's chunk A2,
--     built next. This phase only ships the mutation RPCs so A2 has
--     something to wire its buttons to.
--   - Account creation/deactivation — chunk A3+.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. promote_to_admin() / demote_to_teacher()
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.promote_to_admin(p_teacher_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can promote another account.';
  end if;

  if not exists (
    select 1 from public.profiles where id = p_teacher_id and role = 'teacher'
  ) then
    raise exception 'Target account is not a teacher account.';
  end if;

  update public.profiles set role = 'admin' where id = p_teacher_id;
end;
$$;
grant execute on function public.promote_to_admin(text) to authenticated;

-- Guards against locking the school out of oversight entirely: refuses to
-- demote the last remaining admin. Anything beyond that (an admin demoting
-- themselves while other admins still exist, etc.) is allowed — that's a
-- legitimate "step back to a normal teacher account" action, not a mistake
-- this function can distinguish from a deliberate one.
create or replace function public.demote_to_teacher(p_admin_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_count int;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change another admin''s role.';
  end if;

  if not exists (
    select 1 from public.profiles where id = p_admin_id and role = 'admin'
  ) then
    raise exception 'Target account is not an admin account.';
  end if;

  select count(*) into v_admin_count from public.profiles where role = 'admin';
  if v_admin_count <= 1 then
    raise exception 'Cannot demote the last remaining admin account.';
  end if;

  update public.profiles set role = 'teacher' where id = p_admin_id;
end;
$$;
grant execute on function public.demote_to_teacher(text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. save_dsm_settings() — is_staff() → is_admin()
-- ═════════════════════════════════════════════════════════════════════════

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
grant execute on function public.save_dsm_settings(jsonb, jsonb) to authenticated;
