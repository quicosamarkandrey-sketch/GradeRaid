-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 47 — three console-error fixes reported together this session:
--
--   1. `boss_events.class_id` type drift (42883 "operator does not exist:
--      text = uuid", surfaced via finalize_loot_rush, but silently affects
--      EVERY boss RPC that filters on class_id — apply_boss_damage,
--      start_boss_event, end_boss_event, start_loot_rush, claim_loot_reward,
--      delete_boss_event too, they just weren't exercised this session).
--
--   2. `boss_participants` / `point_log` 42501 RLS rejections on the
--      client's bulk sync push — a real gap left behind by Phase 14, not
--      a client bug.
--
-- Run once, after Phase 46 (and after the phase25/phase44 SQL edits that
-- ship alongside this file, which fix the *separate* ambiguous-column bugs
-- in start_loot_rush/finalize_loot_rush/claim_loot_reward).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. boss_events.class_id TYPE DRIFT
--
--    Phase 14 ran `alter table public.boss_events add column if not exists
--    class_id text references public.class_sections(id)`. On this database
--    that column already existed — as `uuid`, left over from before Section
--    Maker (Phase 4) introduced text-keyed ('sec_...') sections — so the
--    `if not exists` guard made the ALTER a silent no-op and the column
--    was never actually retyped. Every later RPC (apply_boss_damage,
--    start_boss_event, end_boss_event, start_loot_rush, finalize_loot_rush,
--    claim_loot_reward, delete_boss_event) was written assuming `class_id
--    text` to match class_sections.id — so any of them comparing
--    `class_id = p_class_id` hits `uuid = text`, which Postgres has no
--    operator for. finalize_loot_rush is just the one that got exercised
--    and reported; the fix has to be the column, not any one RPC.
--
--    Converting uuid -> text is always safe (same literal representation).
--    Any existing value that doesn't match a real class_sections.id (e.g.
--    a leftover pre-Section-Maker uuid) is remapped to 'default-class' —
--    same placeholder Phase 14 used for NULLs — so the FK constraint below
--    doesn't reject real rows.
-- ═════════════════════════════════════════════════════════════════════════
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'boss_events'
      and column_name = 'class_id' and data_type = 'uuid'
  ) then
    alter table public.boss_events
      alter column class_id type text using class_id::text;
  end if;
end $$;

insert into public.class_sections (id, grade_level, section_name, archived)
select 'default-class', '7', 'Default', false
where not exists (select 1 from public.class_sections where id = 'default-class');

update public.boss_events
   set class_id = 'default-class'
 where class_id is not null
   and not exists (select 1 from public.class_sections cs where cs.id = boss_events.class_id);

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'boss_events'
      and constraint_name = 'boss_events_class_id_fkey'
  ) then
    alter table public.boss_events
      add constraint boss_events_class_id_fkey
      foreign key (class_id) references public.class_sections(id);
  end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. boss_participants — restore a scoped self-write policy.
--
--    Phase 14 dropped boss_participants_self_insert_while_active /
--    _self_update_while_active on the theory that apply_boss_damage()
--    (SECURITY DEFINER) would become the only write path. That covers
--    total_damage/correct_answers/crit_hits — but db-service.js's bulk
--    boss_participants upsert (see push logic in db-service.js) is still
--    the only place minions_defeated/last_question_idx ever get written,
--    and it's a plain client upsert, not an RPC. Without a self-write
--    policy a student's own tab can no longer sync either field, which is
--    exactly the 42501 reported. Scoping this to the caller's own
--    student_id (mirroring point_log/user_achievements' shape below) keeps
--    the "students can't touch other students' rows" guarantee Phase 14
--    cared about, without blocking their own.
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists boss_participants_self_write on public.boss_participants;
create policy boss_participants_self_write on public.boss_participants
  for insert
  with check (
    student_id = auth.uid()::text
    and class_id in (select p.class_id from public.profiles p where p.id = auth.uid()::text)
  );

drop policy if exists boss_participants_self_update on public.boss_participants;
create policy boss_participants_self_update on public.boss_participants
  for update
  using (student_id = auth.uid()::text)
  with check (student_id = auth.uid()::text);

-- ═════════════════════════════════════════════════════════════════════════
-- 3. point_log — restore student self-insert.
--
--    Phase 14's point_log_staff_write replaced the old wide-open
--    point_log_anon_all policy with a staff-only insert check. That's
--    right for student-manager.js's admin point grants, but several
--    student-initiated flows also append to point_log directly — campaign
--    stage completion (campaign_engine.js), boss victory rewards
--    (combat-settings.js), mail reward claims (mail-engine.js), and
--    achievement claims (ach_engine.js). None of those go through staff,
--    so Phase 14 silently broke all four — every one of them now fails
--    the bulk point_log upsert with 42501. Add back a self-insert path
--    for a student's own point_log rows, same shape as the existing
--    point_log_select_scoped policy just above it.
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists point_log_staff_write on public.point_log;
drop policy if exists point_log_self_or_staff_write on public.point_log;
create policy point_log_self_or_staff_write on public.point_log
  for insert
  with check (
    student_id = auth.uid()::text
    or public.is_staff_for_section((select class_id from public.profiles where id = point_log.student_id))
  );

-- ═════════════════════════════════════════════════════════════════════════
-- 4. point_log — the same upsert also needs UPDATE permission, not just
--    INSERT.
--
--    db-service.js's push re-sends db.pointLog IN FULL every sync cycle —
--    not just entries added since the last sync — via
--    `.upsert(rows, { onConflict: 'id' })`. Any row whose id already made
--    it to Supabase on an earlier cycle collides on that id and Postgres
--    runs it as an UPDATE instead of an INSERT. Section 3's policy only
--    grants INSERT, so that UPDATE has no policy to satisfy at all and is
--    denied by RLS's default-deny — reported as "(USING expression)"
--    specifically because that's the missing clause (UPDATE policies are
--    checked against USING first, then WITH CHECK). Same self-or-staff
--    shape as the insert policy above; the values being "changed" are
--    identical to what's already there, so this is a same-data no-op in
--    practice, just one RLS has to be told is allowed.
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists point_log_self_or_staff_update on public.point_log;
create policy point_log_self_or_staff_update on public.point_log
  for update
  using (
    student_id = auth.uid()::text
    or public.is_staff_for_section((select class_id from public.profiles where id = point_log.student_id))
  )
  with check (
    student_id = auth.uid()::text
    or public.is_staff_for_section((select class_id from public.profiles where id = point_log.student_id))
  );
