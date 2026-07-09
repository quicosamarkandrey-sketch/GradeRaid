-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 33 — REGISTRATIONS + BOSS STUDIO OWNER SCOPING
-- (see ISOLATION_ROLES_PLAN.md §9, §12 step 4)
--
-- Run once in the Supabase SQL editor, after Phase 32 (Catalog Owner Scoping).
--
-- WHAT THIS CLOSES — the two remaining Medium items from §12 step 4 that
-- actually need schema/RPC changes. (Command Center / a-dashboard and
-- Analytics / a-analytics — the other two step-4 rows — read only from
-- profiles, point_log, redemptions, shop_products and quizzes, which are
-- ALREADY section/owner-scoped by Phase 14 and Phase 32. Nothing in those
-- two screens bypasses that scoping, so there is no migration for them here;
-- see the note at the very bottom of this file.)
--
--   1. registrations — today any staff account sees and can approve/reject
--      EVERY pending signup school-wide (registrations_select_own_or_staff
--      checks `role in ('admin','teacher')` with no section check at all).
--      Target (ISOLATION_ROLES_PLAN.md §1): teacher only sees/decides their
--      own section's registrations; admin sees/decides all.
--   2. boss_library + the `boss-art` storage bucket — today any staff can
--      read/write/delete every OTHER teacher's saved Boss Studio designs and
--      uploaded artwork files (get/save/delete_boss_library_entry() and the
--      boss_art_staff_* storage policies all gate on bare is_staff()).
--      Target: teacher owns their own designs/files; admin keeps the
--      cross-account override for support, same shape as shop_products.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- A. REGISTRATIONS
-- ═════════════════════════════════════════════════════════════════════════

-- ── A0. Small reusable helper ──────────────────────────────────────────────
-- Pulled out of approve_registration()'s inline lookup (wave2) so submit-time
-- backfill and approval-time re-resolution can't drift into two different
-- matching rules. Same "no active section found → default-class" fallback
-- approve_registration() already used.
create or replace function public.resolve_section_class_id(p_grade_level text, p_section text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select cs.id
       from public.class_sections cs
      where cs.grade_level = p_grade_level
        and lower(cs.section_name) = lower(p_section)
        and not cs.archived
      limit 1),
    'default-class'
  );
$$;
grant execute on function public.resolve_section_class_id(text, text) to anon, authenticated;

-- ── A1. Schema — add the owner column registrations never had ─────────────
alter table public.registrations add column if not exists class_id text references public.class_sections(id);

update public.registrations
   set class_id = public.resolve_section_class_id(grade_level, section)
 where class_id is null;

-- Left nullable, same posture as Phase 14's class_id backfills — a null
-- class_id (shouldn't happen after the backfill above, but just in case)
-- falls through is_staff_for_section()'s "admin-only until a section
-- actually matches" behavior rather than erroring.

-- ── A2. RLS — replace the blanket staff bypass with section scoping ───────
drop policy if exists registrations_select_own_or_staff on public.registrations;
create policy registrations_select_own_or_staff on public.registrations
  for select using (
    auth.uid()::text = id
    or public.is_staff_for_section(class_id)
  );
-- insert/update/delete stay revoked from anon/authenticated — unchanged from
-- wave2; every write still goes through the RPCs below.

-- ── A3. submit_registration() — stamp class_id at submission time ─────────
-- Behavior otherwise byte-identical to wave2's version; only the insert
-- column list changed.
create or replace function public.submit_registration(
  p_id             text,
  p_first_name     text,
  p_last_name      text,
  p_username       text,
  p_email          text,
  p_student_id_text text,
  p_grade_level    text,
  p_section        text
)
returns public.registrations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.registrations;
begin
  if auth.uid() is null or auth.uid()::text <> p_id then
    raise exception 'You can only submit a registration for your own account.';
  end if;

  if exists (select 1 from public.registrations where id = p_id) then
    raise exception 'A registration already exists for this account.';
  end if;
  if exists (
    select 1 from public.registrations
     where lower(username) = lower(p_username) and status <> 'rejected'
  ) then
    raise exception 'Username already requested.';
  end if;
  if exists (
    select 1 from public.registrations
     where lower(email) = lower(p_email) and status <> 'rejected'
  ) then
    raise exception 'Email already requested.';
  end if;

  insert into public.registrations (
    id, first_name, last_name, username, email, student_id_text,
    grade_level, section, class_id, status, submitted_at
  ) values (
    p_id, trim(p_first_name), trim(p_last_name), lower(trim(p_username)),
    lower(trim(p_email)), trim(p_student_id_text), p_grade_level, trim(p_section),
    public.resolve_section_class_id(p_grade_level, trim(p_section)),
    'pending', now()
  )
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.submit_registration(text, text, text, text, text, text, text, text)
  to authenticated;

-- ── A4. approve_registration() — staff check becomes section-scoped ───────
-- Also re-resolves class_id at approval time (not just trusting the
-- submit-time snapshot from A3) in case a section was renamed/archived in
-- between, and persists that re-resolved value back onto the registrations
-- row so a second admin/teacher glancing at the queue afterward sees the
-- same section the profile actually landed in.
create or replace function public.approve_registration(
  p_reg_id text,
  p_color  text,
  p_init   text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg     public.registrations;
  v_profile public.profiles;
  v_class_id text;
begin
  select * into v_reg from public.registrations where id = p_reg_id;
  if v_reg is null then
    raise exception 'Registration not found.';
  end if;

  if not public.is_staff_for_section(v_reg.class_id) then
    raise exception 'You can only approve registrations for your own section(s).';
  end if;

  if v_reg.status = 'approved' and v_reg.approved_student_id is not null then
    raise exception 'Already approved.';
  end if;
  if exists (select 1 from public.profiles where id = v_reg.id) then
    raise exception 'An account already exists for this registration.';
  end if;

  v_class_id := public.resolve_section_class_id(v_reg.grade_level, v_reg.section);

  insert into public.profiles (
    id, role, display_name, init, color, xp, coins, level, tier,
    attendance_pct, quiz_avg, first_name, last_name, class_id, join_date
  ) values (
    v_reg.id, 'student', v_reg.first_name || ' ' || v_reg.last_name, p_init, p_color,
    0, 0, 1, 'Novice', 0, 0, v_reg.first_name, v_reg.last_name, v_class_id, current_date
  )
  returning * into v_profile;

  update public.registrations
     set status = 'approved',
         class_id = v_class_id,
         reviewed_at = now(),
         reviewed_by = coalesce((select display_name from public.profiles where id = auth.uid()::text), 'Admin'),
         approved_student_id = v_profile.id,
         rejection_reason = null
   where id = p_reg_id;

  return v_profile;
end;
$$;
grant execute on function public.approve_registration(text, text, text) to authenticated;

-- ── A5. reject_registration() — same section-scoped swap ──────────────────
create or replace function public.reject_registration(p_reg_id text, p_reason text)
returns public.registrations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg public.registrations;
  v_row public.registrations;
begin
  select * into v_reg from public.registrations where id = p_reg_id;
  if v_reg is null then
    raise exception 'Registration not found.';
  end if;

  if not public.is_staff_for_section(v_reg.class_id) then
    raise exception 'You can only reject registrations for your own section(s).';
  end if;

  update public.registrations
     set status = 'rejected',
         reviewed_at = now(),
         reviewed_by = coalesce((select display_name from public.profiles where id = auth.uid()::text), 'Admin'),
         rejection_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = p_reg_id
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.reject_registration(text, text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- B. BOSS STUDIO — boss_library table + boss-art storage bucket
-- ═════════════════════════════════════════════════════════════════════════

-- ── B1. Schema — add the owner column boss_library never had ──────────────
alter table public.boss_library add column if not exists owner_teacher_id text references public.profiles(id);

update public.boss_library
   set owner_teacher_id = '282c271c-2251-4b80-af0b-9f2e8cc6d4a0'
 where owner_teacher_id is null;
-- Same backfill target as Phase 32's four catalog tables, per
-- ISOLATION_ROLES_PLAN.md §1 — existing designs stay with the account
-- that's being relabeled 'teacher'.

-- ── B2. get_boss_library() — filter to own rows (or all, if admin) ────────
create or replace function public.get_boss_library()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_staff() then
    raise exception 'Only staff can read the Boss Studio library.';
  end if;
  return coalesce(
    (select jsonb_agg(jsonb_build_object('id', id, 'data', data) order by updated_at)
       from public.boss_library
      where public.is_same_staff_or_admin(owner_teacher_id)),
    '[]'::jsonb
  );
end;
$$;
grant execute on function public.get_boss_library() to anon, authenticated;

-- ── B3. save_boss_library_entry() — stamp owner on create, check on update ─
-- New row: owner_teacher_id = the caller. Existing row: caller must be the
-- original owner or admin (mirrors delete's check below) — the owner itself
-- never changes on an "edit as" admin save, same call as Phase 32's catalog
-- RPCs kept for shop_products/quizzes/etc.
create or replace function public.save_boss_library_entry(p_id text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_owner text;
begin
  if not public.is_staff() then
    raise exception 'Only staff can modify the Boss Studio library.';
  end if;

  select owner_teacher_id into v_existing_owner from public.boss_library where id = p_id;

  if v_existing_owner is not null and not public.is_same_staff_or_admin(v_existing_owner) then
    raise exception 'You can only edit your own Boss Studio designs.';
  end if;

  insert into public.boss_library (id, data, updated_at, updated_by, owner_teacher_id)
  values (p_id, p_data, now(), auth.uid()::text, coalesce(v_existing_owner, auth.uid()::text))
  on conflict (id) do update
    set data       = excluded.data,
        updated_at = now(),
        updated_by = excluded.updated_by;
        -- owner_teacher_id intentionally NOT in the update set — preserved
        -- from whatever it already was, even when an admin is the one
        -- saving.
end;
$$;
grant execute on function public.save_boss_library_entry(text, jsonb) to anon, authenticated;

-- ── B4. delete_boss_library_entry() — owner or admin only ──────────────────
create or replace function public.delete_boss_library_entry(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_owner text;
begin
  if not public.is_staff() then
    raise exception 'Only staff can modify the Boss Studio library.';
  end if;

  select owner_teacher_id into v_existing_owner from public.boss_library where id = p_id;
  if v_existing_owner is null then
    return; -- already gone — idempotent, same posture as delete_shop_product() etc.
  end if;

  if not public.is_same_staff_or_admin(v_existing_owner) then
    raise exception 'You can only delete your own Boss Studio designs.';
  end if;

  delete from public.boss_library where id = p_id;
end;
$$;
grant execute on function public.delete_boss_library_entry(text) to anon, authenticated;

-- ── B5. Storage — `boss-art` bucket gets a folder-prefix ownership check ──
-- Read stays fully public (bucket_id = 'boss-art', no auth check) — unchanged,
-- students' <img> tags for a deployed boss still need to load with zero
-- RLS friction. Write/update/delete now also require the first path segment
-- to be the caller's own uid, UNLESS the caller is admin. bs_storage.js
-- (JS side, same phase) is updated to upload under `${teacherId}/library/...`
-- instead of the old flat `library/...` so this actually lines up.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid()::text and role = 'admin'
  );
$$;
grant execute on function public.is_admin() to anon, authenticated;

drop policy if exists boss_art_staff_write on storage.objects;
create policy boss_art_staff_write on storage.objects
  for insert
  with check (
    bucket_id = 'boss-art'
    and public.is_staff()
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

drop policy if exists boss_art_staff_update on storage.objects;
create policy boss_art_staff_update on storage.objects
  for update
  using (
    bucket_id = 'boss-art'
    and public.is_staff()
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

drop policy if exists boss_art_staff_delete on storage.objects;
create policy boss_art_staff_delete on storage.objects
  for delete
  using (
    bucket_id = 'boss-art'
    and public.is_staff()
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );
-- boss_art_read_all (select, public) is untouched — see phase13.

-- ═════════════════════════════════════════════════════════════════════════
-- NOTE — Command Center (a-dashboard) and Analytics (a-analytics)
-- ═════════════════════════════════════════════════════════════════════════
-- Both screens render purely from DB.students (→ profiles, RLS-scoped by
-- Phase 14's profiles_select_scoped), DB.pointLog / DB.redemptions
-- (section-scoped, Phase 14), and DB.store / DB.quizzes (owner-scoped,
-- Phase 14 / Phase 32). A teacher's client only ever pulls their own
-- section's/own content's rows in the first place — there is no
-- over-fetching to close at the SQL layer here, so no migration for these
-- two rows. The only follow-up they still need is JS-side (this phase, see
-- modules/admin/student-manager.js and modules/admin/analytics.js): the
-- hardcoded "Grade 8-A" header label gets replaced with the caller's actual
-- owned section name(s), since a real second teacher account would
-- otherwise see another teacher's hardcoded grade label above their own
-- (correctly scoped) roster. The cross-teacher aggregate rollup admin
-- eventually needs on top of this (§11) is deliberately deferred to step 5.
