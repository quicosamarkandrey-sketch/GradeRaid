-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 35 — TEACHER DIRECTORY (READ-ONLY LIST)
-- (see ISOLATION_ROLES_PLAN.md §11 "Teacher directory", §12 step 5, chunk A2)
--
-- Run once in the Supabase SQL editor, after Phase 34.
--
-- WHAT THIS ADDS
--   get_teacher_directory() — the single read RPC behind the Teacher
--   Directory screen (modules/admin/teacher-directory.js, same phase).
--   Admin-gated (is_admin()), returns one row per admin/teacher profile:
--   display name, role, email + created/last-active (from auth.users —
--   same auth.users join pattern phase12_kiosk_identity_lock.sql already
--   established for this codebase), the sections they advise, student
--   count across those sections, and per-teacher content counts across
--   the five owner-scoped catalog tables (achievements, titles, quizzes,
--   campaign_worlds, shop_products).
--
-- WHAT'S NOT IN THIS FILE
--   Any mutation beyond what Phase 34 already shipped (promote_to_admin /
--   demote_to_teacher) — account create/deactivate/reactivate and password
--   reset are later chunks (A3/A4). This is read-only.
-- ─────────────────────────────────────────────────────────────────────────────

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
