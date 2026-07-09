-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 21 — TITLE SECTION-SCOPING (`title_sections` write RPC + realtime)
--
-- Run once in the Supabase SQL editor, after Phase 14
-- (phase14_section_isolation.sql — this file assumes title_sections + its
-- RLS policies already exist, created there). Additive only.
--
-- THE GAP THIS CLOSES (SYNC_AUDIT_REPORT.md, "Titles — ✅ solid,
-- section-scoping deliberately deferred (Phase 18)")
--   title_sections has had a table + RLS since Phase 14, but — same story
--   as achievement_sections before Phase 16 — no write RPC, no admin
--   picker, and no read-side filter ever got built. Titles themselves sync
--   fine cross-device (Phase 18); this closes the one deferred piece:
--   scoping which section can see which STANDALONE (non-achievement-linked)
--   title. A title unlocked through a linked achievement needs no row
--   here at all — its visibility already follows achievement_sections via
--   the achievement it's tied to (see phase14_section_isolation.sql's
--   comment on title_sections). This RPC/read-filter only matters for
--   titles with no achievementId, i.e. teacher-granted-only titles.
--
-- THE FIX — mirrors phase16_achievement_sections_rpc.sql exactly, same
-- reasoning: set_title_sections() atomically replaces every title_sections
-- row for ONE title_id that the caller could have created themselves
-- (is_staff_for_section on the row's own class_id), so two teachers
-- assigning the same shared title to their own different sections can
-- never stomp on each other, and a page refresh mid-save can't leave a
-- half-applied delete+insert behind.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.set_title_sections(p_title_id text, p_class_ids text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class_id text;
begin
  if p_title_id is null or trim(p_title_id) = '' then
    raise exception 'title id is required';
  end if;

  foreach v_class_id in array coalesce(p_class_ids, array[]::text[]) loop
    if not public.is_staff_for_section(v_class_id) then
      raise exception 'not authorized for section %', v_class_id;
    end if;
  end loop;

  delete from public.title_sections t_s
   where t_s.title_id = p_title_id
     and public.is_staff_for_section(t_s.class_id);

  insert into public.title_sections (title_id, class_id)
  select p_title_id, x from unnest(coalesce(p_class_ids, array[]::text[])) as x
  on conflict (title_id, class_id) do nothing;
end;
$$;
grant execute on function public.set_title_sections(text, text[]) to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- REALTIME — same two-part gap/fix shape as Phase 16/19: the JS
-- postgres_changes listener (added in this pass) does nothing until the
-- table is also added to the supabase_realtime publication.
-- ═════════════════════════════════════════════════════════════════════════

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.title_sections';
  exception when duplicate_object then
    null;
  end;
end $$;
