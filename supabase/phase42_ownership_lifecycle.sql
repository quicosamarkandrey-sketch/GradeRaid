-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 42 — CHUNK D: OWNERSHIP & LIFECYCLE
--
-- Run once in the Supabase SQL editor, after Phase 41.
--
-- WHAT THIS IS
--   Two related but independent actions:
--     1. reassign_section_adviser() — a single section's adviser changes
--        hands (mid-year coverage change). Small, standalone, does not
--        touch anything else the departing/previous adviser owns.
--     2. transfer_teacher_ownership() — full offboarding. Moves EVERY
--        section a teacher advises and EVERY piece of content they own
--        (achievements, titles, quizzes, campaign worlds, shop products,
--        boss library entries) to a single destination teacher in one
--        transaction, with a per-section choice to archive instead of
--        reassign. Meant to run right before/after
--        deactivate_teacher_account() (Phase 36) for a teacher who's
--        actually leaving — the two are deliberately separate calls, not
--        combined, so an admin can transfer ownership without immediately
--        locking the account (e.g. a role change) and can deactivate
--        without being forced to pick a destination for content they'd
--        rather leave in place.
--
-- SCOPE DECISIONS (confirmed before building)
--   - Content ownership can NEVER be null (owner_teacher_id is NOT NULL on
--     every one of these tables — Phase 32/33 made that a hard constraint
--     on purpose, since every RLS policy on these tables reads it). So
--     unlike sections, content has no "archived state" of its own — it
--     always moves to a real destination teacher. p_to_teacher_id is
--     required and must be an ACTIVE admin/teacher account.
--   - Sections DO have a real archived state already (Phase 4/36), so the
--     per-section choice is: reassign to the destination teacher (default
--     for every section the departing teacher advises), or archive instead
--     (adviser cleared, archived = true) for sections named in
--     p_archive_section_ids — e.g. a section being dissolved rather than
--     handed to someone else. This reuses the exact archive semantics
--     Section Maker already has; nothing new about what "archived" means.
--   - Logging: unlike Chunk C's log_edit_as_action() (deliberately narrow,
--     JS-side, one call per row — see phase40's header), both RPCs here
--     write directly to audit_log themselves, inside the same transaction
--     as the data change. These are bulk/consequential admin actions where
--     "the write succeeded but the log entry didn't" is a worse tradeoff
--     than it is for Chunk C's one-row-at-a-time edits, and both RPCs are
--     already admin-authorized SECURITY DEFINER functions, so there's no
--     new privilege boundary to cross to do the insert inline. Both use
--     audit_log.action = 'transfer' (a value log_edit_as_action() doesn't
--     allow, but the table itself has no CHECK constraint on that column —
--     see phase40 — so a direct insert is free to use it). get_audit_log()
--     (Phase 40) already returns these with no changes needed on that side.
--   - reassign_section_adviser() reuses update_class_section()'s exact
--     authorization shape (is_staff_for_section — current adviser or
--     admin), so a teacher can still hand off their own section without
--     admin involvement, same as today. transfer_teacher_ownership() is
--     is_admin()-only — full offboarding is an admin action.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. reassign_section_adviser() — standalone, single-section reassignment.
--    A thinner, single-purpose sibling of update_class_section() (Phase 4/
--    39) — same authorization and same column write, but doesn't also take
--    grade/name, so a "change who covers this section" action doesn't need
--    to round-trip the section's other fields, and gets its own audit
--    trail entry (update_class_section() deliberately does not log).
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.reassign_section_adviser(
  p_section_id     text,
  p_new_adviser_id text default null,
  p_clear_adviser  boolean default false
)
returns public.class_sections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row         public.class_sections;
  v_old_adviser text;
  v_target_role text;
  v_target_active boolean;
begin
  if not public.is_staff_for_section(p_section_id) then
    raise exception 'not authorized for this section';
  end if;

  select * into v_row from public.class_sections where id = p_section_id;
  if v_row is null then
    raise exception 'Unknown section id: %', p_section_id;
  end if;
  v_old_adviser := v_row.adviser_id;

  if not p_clear_adviser then
    if p_new_adviser_id is null then
      raise exception 'new_adviser_id is required unless clear_adviser is true';
    end if;
    select role, is_active into v_target_role, v_target_active
      from public.profiles where id = p_new_adviser_id;
    if v_target_role is null then
      raise exception 'Unknown teacher/admin id: %', p_new_adviser_id;
    end if;
    if v_target_role not in ('admin', 'teacher') then
      raise exception 'Adviser must be an admin or teacher account.';
    end if;
    if not coalesce(v_target_active, false) then
      raise exception 'Cannot assign a deactivated account as adviser.';
    end if;
  end if;

  update public.class_sections
     set adviser_id = case when p_clear_adviser then null else p_new_adviser_id end,
         updated_at = now()
   where id = p_section_id
  returning * into v_row;

  insert into public.audit_log
    (id, actor_id, target_teacher_id, table_name, record_id, action, details)
  values (
    'aud_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
    auth.uid()::text,
    -- target_teacher_id is NOT NULL — fall back through new adviser, then
    -- old adviser, then the caller, so a "clear an already-unassigned
    -- section" call (both null) still has somewhere valid to point.
    coalesce(v_row.adviser_id, v_old_adviser, auth.uid()::text),
    'class_sections',
    p_section_id,
    'transfer',
    jsonb_build_object(
      'fromAdviserId', v_old_adviser,
      'toAdviserId', v_row.adviser_id,
      'sectionLabel', v_row.grade_level || '-' || v_row.section_name
    )
  );

  return v_row;
end;
$$;
grant execute on function
  public.reassign_section_adviser(text, text, boolean)
to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. transfer_teacher_ownership() — full offboarding, one call, one
--    transaction. Admin-only.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.transfer_teacher_ownership(
  p_from_teacher_id     text,
  p_to_teacher_id       text,
  p_archive_section_ids text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_role       text;
  v_to_role         text;
  v_to_active       boolean;
  v_sections_reassigned int := 0;
  v_sections_archived   int := 0;
  v_achievements     int := 0;
  v_titles           int := 0;
  v_quizzes          int := 0;
  v_campaign_worlds  int := 0;
  v_shop_products    int := 0;
  v_boss_library     int := 0;
  v_summary          jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can transfer ownership.';
  end if;

  if p_from_teacher_id is null or p_to_teacher_id is null then
    raise exception 'Both from_teacher_id and to_teacher_id are required.';
  end if;
  if p_from_teacher_id = p_to_teacher_id then
    raise exception 'Destination teacher must be different from the departing teacher.';
  end if;

  select role into v_from_role from public.profiles where id = p_from_teacher_id;
  if v_from_role is null or v_from_role not in ('admin', 'teacher') then
    raise exception 'Unknown or invalid departing teacher id: %', p_from_teacher_id;
  end if;

  select role, is_active into v_to_role, v_to_active from public.profiles where id = p_to_teacher_id;
  if v_to_role is null or v_to_role not in ('admin', 'teacher') then
    raise exception 'Unknown or invalid destination teacher id: %', p_to_teacher_id;
  end if;
  if not coalesce(v_to_active, false) then
    raise exception 'Destination teacher account is deactivated.';
  end if;

  -- Sections: reassign everything the departing teacher advises, except
  -- the ones the caller named to archive instead.
  update public.class_sections
     set adviser_id = p_to_teacher_id, updated_at = now()
   where adviser_id = p_from_teacher_id
     and not (id = any (p_archive_section_ids));
  get diagnostics v_sections_reassigned = row_count;

  update public.class_sections
     set adviser_id = null, archived = true, updated_at = now()
   where adviser_id = p_from_teacher_id
     and id = any (p_archive_section_ids);
  get diagnostics v_sections_archived = row_count;

  -- Content: every owned catalog table moves in full — no partial/per-item
  -- picker in v1 (see header). Starter-template rows are excluded on
  -- principle (same guard Chunk C uses everywhere) even though in practice
  -- they're owned by the reserved template account, never a real teacher.
  update public.achievements set owner_teacher_id = p_to_teacher_id
   where owner_teacher_id = p_from_teacher_id and not is_starter_template;
  get diagnostics v_achievements = row_count;

  update public.titles set owner_teacher_id = p_to_teacher_id
   where owner_teacher_id = p_from_teacher_id and not is_starter_template;
  get diagnostics v_titles = row_count;

  update public.quizzes set owner_teacher_id = p_to_teacher_id
   where owner_teacher_id = p_from_teacher_id and not is_starter_template;
  get diagnostics v_quizzes = row_count;

  update public.campaign_worlds set owner_teacher_id = p_to_teacher_id
   where owner_teacher_id = p_from_teacher_id and not is_starter_template;
  get diagnostics v_campaign_worlds = row_count;

  update public.shop_products set owner_teacher_id = p_to_teacher_id
   where owner_teacher_id = p_from_teacher_id and not is_starter_template;
  get diagnostics v_shop_products = row_count;

  -- boss_library (Phase 33) has owner_teacher_id but no is_starter_template
  -- column — it was never part of the Starter Pack (Phase 38's scope was
  -- the same 5 tables oversight_upsert_*() covers), so no guard needed.
  update public.boss_library set owner_teacher_id = p_to_teacher_id
   where owner_teacher_id = p_from_teacher_id;
  get diagnostics v_boss_library = row_count;

  v_summary := jsonb_build_object(
    'fromTeacherId', p_from_teacher_id,
    'toTeacherId', p_to_teacher_id,
    'sectionsReassigned', v_sections_reassigned,
    'sectionsArchived', v_sections_archived,
    'achievements', v_achievements,
    'titles', v_titles,
    'quizzes', v_quizzes,
    'campaignWorlds', v_campaign_worlds,
    'shopProducts', v_shop_products,
    'bossLibrary', v_boss_library
  );

  insert into public.audit_log
    (id, actor_id, target_teacher_id, table_name, record_id, action, details)
  values (
    'aud_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
    auth.uid()::text,
    p_from_teacher_id,
    'ownership_transfer',
    p_from_teacher_id,
    'transfer',
    v_summary
  );

  return v_summary;
end;
$$;
grant execute on function
  public.transfer_teacher_ownership(text, text, text[])
to authenticated;
