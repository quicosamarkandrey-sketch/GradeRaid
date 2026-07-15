-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 68 — CAMPAIGN REDESIGN PHASE 7: STUDENT SKILL INVENTORY
-- (`student_skills` table + `adjust_student_skill_count()` RPC)
--
-- Run once in the Supabase SQL editor, after Phase 67 (highest phaseNN file
-- present in supabase/ at the time this was written — check for a higher
-- number before assuming this is still the next one to run).
--
-- WHAT THIS IS FOR
--   Campaign Redesign Decision #5: Hint / Heal / Shield are earned randomly
--   through every completed learning interaction (reveal, drag-drop —
--   dialogue is flavor-only per Decision #10 and does not roll a drop) and
--   spent by the student mid-encounter (Decision #6). This closes the "new
--   per-student skill-inventory counts, synced the same way coins/XP
--   already sync today" scope item from CAMPAIGN_REDESIGN_IMPLEMENTATION_
--   ROADMAP.md's Phase 7.
--
-- WHY ONE ROW PER STUDENT, NOT ONE ROW PER GRANT
--   Unlike `inventory` (Phase 48, one row per (student_id, item_id) shop
--   item) or `loot_claims` (one row per claim event), a skill is a plain
--   count with no per-unit identity worth preserving (no rarity, no source,
--   nothing a UI ever needs to list individually) — a running total per
--   skill type is all campaign_engine.js's skill bar reads. One row per
--   student, three integer columns, mirrors the shape of `profiles.xp`/
--   `profiles.coins` far more than it mirrors `inventory`.
--
-- WHY AN RPC-ONLY WRITE PATH, NOT A BULK UPSERT
--   Two reasons, both deliberate:
--   1. RACE SAFETY — a grant (skill-drop roll) and a spend (skill-use
--      button) can both fire in quick succession in the same session, and a
--      naive "read count, add delta, write count back" from two overlapping
--      calls would lose an update. `adjust_student_skill_count()` below
--      does the increment inside a single atomic `UPDATE ... SET x =
--      greatest(0, x + delta)` statement — the same
--      "column-scoped delta applied server-side, nothing for a stale read
--      to clobber" shape `adjust_student_stats()` (phase9_student_stat_rpc.sql)
--      already uses for xp/coins, and the precedent this phase's own
--      session guide names directly.
--   2. AVOIDING A KNOWN BUG CLASS — this project has repeatedly hit "INSERT
--      policy without a matching UPDATE policy" gaps wherever a table is
--      written via db-service.js's bulk `.upsert(..., {onConflict:'id'})`
--      pattern (point_log — Phase 47, quiz_history — Phase 61; an audit of
--      other post-Phase-48 upsert-pattern tables for the same gap is still
--      an open thread as of this writing). Giving this table NO client-side
--      insert/update/delete policy at all — every write instead goes
--      through this SECURITY DEFINER RPC, which runs as the function owner
--      and so is not subject to that gap in the first place — sidesteps the
--      entire bug class rather than needing to get both policies right.
--      This mirrors `title_unlocks`/`user_achievements`'s existing "RPC
--      only, never bulk upsert" posture (see db-service.js's comments on
--      those tables) more closely than it mirrors `inventory`.
--
-- CALL SITE
--   campaign_engine.js's `_campSyncSkillDeltaToServer()` — called right
--   after `_campRollSkillDrop()` (grant, positive delta) and
--   `window._campUseSkill()` (spend, negative delta) apply their local
--   optimistic mutation, same fire-and-forget posture as
--   `syncStudentStatsToServer()` in utils.js. db-service.js's pull reshapes
--   this table into `DB.studentSkills[studentId] = {hint, heal, shield}` —
--   see that file's diff.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.student_skills (
  student_id   text primary key references public.profiles(id),
  hint_count   integer not null default 0,
  heal_count   integer not null default 0,
  shield_count integer not null default 0,
  updated_at   timestamptz not null default now()
);

alter table public.student_skills enable row level security;

drop policy if exists student_skills_select_scoped on public.student_skills;

-- Read-only for clients: a student may see their own counts, staff may see
-- any student's counts within a section they advise. There is deliberately
-- no insert/update/delete policy for any client role — see "WHY AN RPC-ONLY
-- WRITE PATH" above. adjust_student_skill_count() (below) is the only way
-- any row in this table is ever created or changed.
create policy student_skills_select_scoped on public.student_skills
  for select
  using (
    student_id = auth.uid()::text
    or public.is_staff_for_section((select p.class_id from public.profiles p where p.id = student_skills.student_id))
  );

-- ═════════════════════════════════════════════════════════════════════════
-- adjust_student_skill_count — atomic, column-scoped delta, same shape as
-- adjust_student_stats() (phase9_student_stat_rpc.sql). Auto-creates the
-- student's row on first grant/spend (a student with no prior skill
-- history has no row yet — `on conflict do nothing` before the update makes
-- that the common case work without a separate "seed on registration" step).
-- Clamped at 0 the same way adjust_student_stats() clamps xp/coins at 0 —
-- a spend the client already gated on a positive local count should never
-- actually go negative, but the clamp is a harmless no-op in that case and
-- a real safety net if two tabs' optimistic checks ever raced.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.adjust_student_skill_count(
  p_student_id text,
  p_skill      text,     -- 'hint' | 'heal' | 'shield'
  p_delta      integer
)
returns public.student_skills
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.student_skills;
begin
  if p_student_id is null or length(trim(p_student_id)) = 0 then
    raise exception 'p_student_id is required';
  end if;
  if p_skill not in ('hint', 'heal', 'shield') then
    raise exception 'p_skill must be one of hint, heal, shield (got %)', p_skill;
  end if;

  insert into public.student_skills (student_id)
  values (p_student_id)
  on conflict (student_id) do nothing;

  if p_skill = 'hint' then
    update public.student_skills
       set hint_count = greatest(0, hint_count + coalesce(p_delta, 0)),
           updated_at = now()
     where student_id = p_student_id
     returning * into v_row;
  elsif p_skill = 'heal' then
    update public.student_skills
       set heal_count = greatest(0, heal_count + coalesce(p_delta, 0)),
           updated_at = now()
     where student_id = p_student_id
     returning * into v_row;
  else
    update public.student_skills
       set shield_count = greatest(0, shield_count + coalesce(p_delta, 0)),
           updated_at = now()
     where student_id = p_student_id
     returning * into v_row;
  end if;

  if v_row.student_id is null then
    raise exception 'Student % not found', p_student_id;
  end if;

  return v_row;
end;
$$;

grant execute on function
  public.adjust_student_skill_count(text, text, integer)
to anon, authenticated;

-- Realtime: same two-part requirement as every prior phase that added a
-- table to this app's sync surface — the JS postgres_changes listener alone
-- does nothing until the table is also added to the supabase_realtime
-- publication.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'student_skills'
  ) then
    execute 'alter publication supabase_realtime add table public.student_skills';
  end if;
end $$;
