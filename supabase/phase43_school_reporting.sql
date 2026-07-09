-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 43 — CHUNK F: SCHOOL-WIDE REPORTING (last chunk — build order was
-- A → B → E → C → D → F, see phase40's header for the reasoning)
-- (ISOLATION_ROLES_PLAN.md §11 "School-wide reporting", §12 step 5)
--
-- Run once in the Supabase SQL editor, after Phase 42.
--
-- WHAT THIS ADDS
--   reassign_registration() — admin-only RPC letting the cross-teacher
--   registrations queue move a PENDING registration to a different section
--   (and therefore a different teacher) before approval, since a
--   registration's target section may be wrong at signup time (§11). Same
--   shape/logging as Chunk D's reassign_section_adviser() (phase42).
--
-- WHAT THIS DELIBERATELY DOES NOT ADD — both halves of this chunk's other
-- deliverable already work today with zero schema changes:
--   - "Cross-teacher registrations queue" — every registrations row an
--     admin needs is already visible to an admin session
--     (registrations_select_own_or_staff, Phase 33 — is_staff_for_section()
--     resolves to true for role='admin' regardless of class_id, same as
--     every other section-scoped table in this app). Nothing to add here;
--     the "restored as an explicit admin queue" part is a client-side
--     UI change (see modules/admin/registrations.js).
--   - "Aggregate analytics rollup" — DB.students (profiles) is the same
--     story (Phase 14's profiles_select_scoped): an admin session already
--     pulls every student, school-wide, with no per-teacher filter at all.
--     get_teacher_directory() (Phase 35) already returns each teacher's
--     owned sections + student counts. The rollup is a client-side
--     breakdown of data an admin session already has in full (DB.students
--     × TeacherDirectoryService.getDirectory()) — see
--     modules/admin/analytics.js. No new RPC needed to read data an admin
--     session already has unrestricted access to.
--
-- Logging note (per phase40's header, revisited here as instructed):
-- worth doing, since this is a consequential cross-teacher action with the
-- same shape as reassign_section_adviser()/transfer_teacher_ownership()
-- (both of which already log inline) — so this does too, rather than
-- leaving it as a silent write.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.reassign_registration(
  p_reg_id       text,
  p_new_class_id text
)
returns public.registrations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg     public.registrations;
  v_row     public.registrations;
  v_section public.class_sections;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can reassign a registration to a different section.';
  end if;

  select * into v_reg from public.registrations where id = p_reg_id;
  if v_reg is null then
    raise exception 'Registration not found.';
  end if;
  if v_reg.status <> 'pending' then
    raise exception 'Only a pending registration can be reassigned — % is already %.', p_reg_id, v_reg.status;
  end if;

  select * into v_section from public.class_sections where id = p_new_class_id and not archived;
  if v_section is null then
    raise exception 'Unknown or archived section id: %', p_new_class_id;
  end if;

  update public.registrations
     set grade_level = v_section.grade_level,
         section     = v_section.section_name,
         class_id    = v_section.id
   where id = p_reg_id
  returning * into v_row;

  insert into public.audit_log
    (id, actor_id, target_teacher_id, table_name, record_id, action, details)
  values (
    'aud_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
    auth.uid()::text,
    -- target_teacher_id is NOT NULL — a brand-new/unassigned section has no
    -- adviser yet, so fall back to the caller, same posture
    -- reassign_section_adviser() already uses for the symmetric case.
    coalesce(v_section.adviser_id, auth.uid()::text),
    'registrations',
    p_reg_id,
    'transfer',
    jsonb_build_object(
      'studentName',    v_reg.first_name || ' ' || v_reg.last_name,
      'fromClassId',    v_reg.class_id,
      'toClassId',      v_section.id,
      'toSectionLabel', v_section.grade_level || '-' || v_section.section_name
    )
  );

  return v_row;
end;
$$;
grant execute on function public.reassign_registration(text, text) to authenticated;
