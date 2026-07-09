-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 23 — CATALOG DELETE SYNC (closes the "hard-delete never reaches
-- Supabase" gap for boss_events / achievements / titles)
--
-- Run once in the Supabase SQL editor, after Phase 22.
--
-- THE GAP THIS CLOSES
--   Every catalog table in this app (boss_events, shop_products,
--   achievements, titles) is pushed via upsert-only. `shop_products`
--   already got a real fix for this back in Phase 14 (delete_shop_product()),
--   but the other three never did — admin "delete" only ever mutated the
--   local array, so the Supabase row stayed live forever and could
--   reappear on the next pull for anyone else.
--
-- THE DECIDED PATTERN
--   Same one Phase 14 already established for shop_products: a narrow
--   SECURITY DEFINER `delete_*` RPC per table, called from the existing
--   admin delete handler right after the local splice. No soft-delete /
--   `active`-flag scheme — `active` already means something else on both
--   achievements and titles (the admin's enable/disable toggle), so
--   overloading it for "deleted" would break that feature. A real delete
--   is also simpler: nothing else has to remember to filter hidden rows
--   out of every picker/renderer.
--
--   - boss_events is per-section owned, so its RPC checks
--     is_staff_for_section(class_id) — same trust model as the table's own
--     RLS write policy. Cascades boss_participants + loot_claims for that
--     boss first (no FK/ON DELETE CASCADE was ever declared for these).
--   - achievements and titles are global staff-writable catalogs (no
--     per-section owner column), so their RPCs check is_staff() — same as
--     their table RLS write policies. Each cascades its own per-student
--     join/unlock table first, and titles additionally clears
--     equipped_title_id wherever it pointed at the deleted title.
--
--   All three follow delete_shop_product()'s shape: if the row is already
--   gone, treat it as success (idempotent) rather than raising.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. delete_boss_event — cascades boss_participants + loot_claims first.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.delete_boss_event(p_boss_id text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_class_id text;
begin
  select class_id into v_class_id from public.boss_events where id = p_boss_id;
  if v_class_id is null then return; end if; -- already gone, treat as success

  if not public.is_staff_for_section(v_class_id) then
    raise exception 'not authorized for this boss event';
  end if;

  delete from public.boss_participants where boss_id = p_boss_id;
  delete from public.loot_claims       where boss_id = p_boss_id;
  delete from public.boss_events       where id      = p_boss_id;
end;
$$;
grant execute on function public.delete_boss_event(text) to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. delete_achievement — cascades user_achievements + achievement_sections.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.delete_achievement(p_achievement_id text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.achievements where id = p_achievement_id) then
    return; -- already gone, treat as success
  end if;

  if not public.is_staff() then
    raise exception 'not authorized to delete achievements';
  end if;

  delete from public.user_achievements   where achievement_id = p_achievement_id;
  delete from public.achievement_sections where achievement_id = p_achievement_id;
  delete from public.achievements         where id = p_achievement_id;
end;
$$;
grant execute on function public.delete_achievement(text) to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. delete_title — cascades title_unlocks + title_sections, and unequips
--    the title from any profile that had it equipped.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.delete_title(p_title_id text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.titles where id = p_title_id) then
    return; -- already gone, treat as success
  end if;

  if not public.is_staff() then
    raise exception 'not authorized to delete titles';
  end if;

  update public.profiles set equipped_title_id = null where equipped_title_id = p_title_id;
  delete from public.title_unlocks  where title_id = p_title_id;
  delete from public.title_sections where title_id = p_title_id;
  delete from public.titles         where id = p_title_id;
end;
$$;
grant execute on function public.delete_title(text) to anon, authenticated;
