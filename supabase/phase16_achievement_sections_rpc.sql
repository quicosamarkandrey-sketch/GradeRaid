-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 16 — "assign to section(s)" RPC for Achievements
--
-- Run once in the Supabase SQL editor, after Phase 14
-- (phase14_section_isolation.sql — this file assumes achievement_sections
-- + its RLS policies already exist, created there). Additive only.
--
-- WHY THIS FILE EXISTS: phase14_section_isolation.sql created the
-- achievement_sections table and its RLS policies, but — unlike
-- quiz_sections, which got its own set_quiz_sections() RPC in Phase 15 —
-- no write RPC was ever added for achievement_sections. The table's own
-- `achievement_sections_staff_write` RLS policy (`for all using
-- is_staff_for_section(class_id)`) is permissive enough that a client
-- COULD write directly with .from('achievement_sections').upsert(...)/
-- .delete(...), but every other section-assignment write path in this app
-- (set_quiz_sections) goes through a scoped RPC instead of raw table
-- writes, specifically so "replace this item's assigned sections" is one
-- atomic delete+insert scoped to a single achievement_id, never a
-- two-network-call sequence a page refresh or a slow connection could
-- leave half-applied. This RPC mirrors set_quiz_sections() exactly, same
-- reasoning: two teachers assigning the same shared achievement to their
-- own different sections can never stomp on each other, because the
-- delete only ever removes rows for THIS achievement_id that the caller
-- themselves could have created (is_staff_for_section on the row's own
-- class_id).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.set_achievement_sections(p_achievement_id text, p_class_ids text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class_id text;
begin
  if p_achievement_id is null or trim(p_achievement_id) = '' then
    raise exception 'achievement id is required';
  end if;

  foreach v_class_id in array coalesce(p_class_ids, array[]::text[]) loop
    if not public.is_staff_for_section(v_class_id) then
      raise exception 'not authorized for section %', v_class_id;
    end if;
  end loop;

  delete from public.achievement_sections a_s
   where a_s.achievement_id = p_achievement_id
     and public.is_staff_for_section(a_s.class_id);

  insert into public.achievement_sections (achievement_id, class_id)
  select p_achievement_id, x from unnest(coalesce(p_class_ids, array[]::text[])) as x
  on conflict (achievement_id, class_id) do nothing;
end;
$$;
grant execute on function public.set_achievement_sections(text, text[]) to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- REALTIME — same gap/fix shape as phase15_mail_and_quiz_sections_sync.sql's
-- addition for quiz_sections. Without this, db-service.js's
-- postgres_changes listener (updated in this pass to also listen on this
-- table) would silently never fire for it.
-- ═════════════════════════════════════════════════════════════════════════

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.achievement_sections';
  exception when duplicate_object then
    null;
  end;
end $$;
