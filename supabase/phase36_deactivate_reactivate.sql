-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 36 — DEACTIVATE / REACTIVATE TEACHER ACCOUNTS
-- (see ISOLATION_ROLES_PLAN.md §11 "Account & access management", §12 step 5,
--  chunk A3)
--
-- Run once in the Supabase SQL editor, after Phase 35.
--
-- THE GAP THIS CLOSES
--   profiles has no active/deactivated flag at all today. There was no way
--   to lock out a departing/suspended teacher's account short of deleting
--   their Auth user outright (which would also orphan every row they own).
--
-- THE FIX
--   1. profiles.is_active (default true).
--   2. Every existing access-control helper this app already routes
--      everything through — is_staff(), is_staff_for_section(),
--      is_same_staff_or_admin(), is_admin() — now also requires
--      is_active = true. This is the REAL enforcement: a deactivated
--      account's existing session immediately loses every RLS-gated read/
--      write and every RPC gated by one of these helpers, the moment this
--      migration runs, with no separate "kick out active sessions" step
--      needed. (is_staff()'s body below is recreated to match its
--      confirmed-via-`select prosrc from pg_proc` original shape, per
--      phase14_section_isolation.sql's note, with the is_active clause
--      added on top — not a guess at unrelated behavior.)
--   3. deactivate_teacher_account() / reactivate_teacher_account() —
--      admin-gated, with the same "can't lock out the last admin" posture
--      Phase 34's demote_to_teacher() already established. Also refuses to
--      let an admin deactivate their own account (use another admin, or
--      demote first) — a self-lockout is never the intended action, and
--      unlike demote there's no "step back to a lesser role" reading of it.
--   4. get_teacher_directory() (Phase 35) — re-created to also return
--      isActive, so the directory screen can show/toggle status.
--   5. auth.js (same phase, JS side) checks profile.is_active at login and
--      refuses to boot a deactivated session client-side too — belt and
--      suspenders on top of #2, since a clean "you've been deactivated"
--      message is better UX than a session that silently can't do anything.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Column
-- ═════════════════════════════════════════════════════════════════════════
alter table public.profiles add column if not exists is_active boolean not null default true;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. Helper functions — add the is_active gate
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.is_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid()::text
      and pr.role in ('admin', 'teacher')
      and pr.is_active
  );
$$;
grant execute on function public.is_staff() to anon, authenticated;

create or replace function public.is_staff_for_section(p_class_id text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()::text
      and pr.role in ('admin', 'teacher')
      and pr.is_active
      and (
        pr.role = 'admin'
        or exists (
          select 1 from public.class_sections cs
          where cs.id = p_class_id and cs.adviser_id = pr.id
        )
        -- a section with no adviser assigned yet is admin-only until one is set
      )
  );
$$;
grant execute on function public.is_staff_for_section(text) to anon, authenticated;

create or replace function public.is_same_staff_or_admin(p_owner_teacher_id text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid()::text
      and pr.role in ('admin', 'teacher')
      and pr.is_active
      and (pr.role = 'admin' or pr.id = p_owner_teacher_id)
  );
$$;
grant execute on function public.is_same_staff_or_admin(text) to anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid()::text and role = 'admin' and is_active
  );
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. deactivate_teacher_account() / reactivate_teacher_account()
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.deactivate_teacher_account(p_target_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_active_admin_count int;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can deactivate an account.';
  end if;

  if p_target_id = auth.uid()::text then
    raise exception 'You cannot deactivate your own account.';
  end if;

  select role into v_role from public.profiles where id = p_target_id;
  if v_role is null then
    raise exception 'Account not found.';
  end if;
  if v_role not in ('admin', 'teacher') then
    raise exception 'Only admin/teacher accounts can be deactivated here.';
  end if;

  if v_role = 'admin' then
    select count(*) into v_active_admin_count
      from public.profiles where role = 'admin' and is_active;
    if v_active_admin_count <= 1 then
      raise exception 'Cannot deactivate the last remaining active admin.';
    end if;
  end if;

  update public.profiles set is_active = false where id = p_target_id;
end;
$$;
grant execute on function public.deactivate_teacher_account(text) to authenticated;

create or replace function public.reactivate_teacher_account(p_target_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can reactivate an account.';
  end if;

  if not exists (
    select 1 from public.profiles where id = p_target_id and role in ('admin', 'teacher')
  ) then
    raise exception 'Account not found.';
  end if;

  update public.profiles set is_active = true where id = p_target_id;
end;
$$;
grant execute on function public.reactivate_teacher_account(text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 4. get_teacher_directory() — add isActive to the returned shape
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.get_teacher_directory()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
stable
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can view the teacher directory.';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id',                p.id,
          'displayName',       p.display_name,
          'role',              p.role,
          'isActive',          p.is_active,
          'email',             u.email,
          'createdAt',         u.created_at,
          'lastActiveAt',      u.last_sign_in_at,
          'sections', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', cs.id,
                'label', cs.grade_level || '-' || cs.section_name,
                'archived', cs.archived
              )
              order by cs.grade_level, cs.section_name
            )
            from public.class_sections cs
            where cs.adviser_id = p.id
          ), '[]'::jsonb),
          'studentCount', (
            select count(*)::int
            from public.profiles s
            join public.class_sections cs2 on cs2.id = s.class_id
            where cs2.adviser_id = p.id and s.role = 'student'
          ),
          'achievementCount',    (select count(*)::int from public.achievements    a  where a.owner_teacher_id  = p.id),
          'titleCount',          (select count(*)::int from public.titles          t  where t.owner_teacher_id  = p.id),
          'quizCount',           (select count(*)::int from public.quizzes         q  where q.owner_teacher_id  = p.id),
          'campaignWorldCount',  (select count(*)::int from public.campaign_worlds cw where cw.owner_teacher_id = p.id),
          'shopProductCount',    (select count(*)::int from public.shop_products   sp where sp.owner_teacher_id = p.id)
        )
        order by (p.role = 'admin') desc, p.display_name
      )
      from public.profiles p
      left join auth.users u on u.id::text = p.id
      where p.role in ('admin', 'teacher')
    ),
    '[]'::jsonb
  );
end;
$$;
grant execute on function public.get_teacher_directory() to authenticated;
