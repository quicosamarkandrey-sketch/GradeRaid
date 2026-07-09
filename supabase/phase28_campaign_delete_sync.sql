-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 28 — CAMPAIGN WORLD DELETE SYNC (extends Phase 23's catalog
-- delete-sync pattern to campaign_worlds)
--
-- Run once in the Supabase SQL editor, after Phase 22.
--
-- THE GAP THIS CLOSES
--   Phase 22 wired campaign content (worlds/stages/scenes/enemies/
--   questions) to sync — but only via upsert, the same gap boss_events/
--   achievements/titles had before Phase 23. adminDeleteWorld() in
--   campaign_admin_map_editor.js only ever spliced the local array;
--   deleting a world locally never removed the Supabase `campaign_worlds`
--   row, so it would silently reappear on the next pull for anyone else.
--   The local code already flagged this itself as the same known,
--   non-blocking limitation documented for the other catalogs.
--
-- THE FIX
--   `delete_campaign_world()` — same shape as delete_achievement()/
--   delete_title() (Phase 23): campaign_worlds is a global staff-writable
--   catalog with no per-section owner column, so it checks is_staff(),
--   same as the table's own RLS write policy. No child table to cascade —
--   stages/scenes/enemies/questions all live in campaign_worlds' own
--   `stages` jsonb column, not a separate relational table, so they're
--   removed automatically with the row. stageProgress (per-student
--   progress) has no Supabase table at all yet (still local-cache-only,
--   out of scope, unchanged), so there's nothing else to cascade.
--   Idempotent — deleting an already-gone row is a silent no-op, not an
--   error, same as every other delete_* RPC.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.delete_campaign_world(p_world_id text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.campaign_worlds where id = p_world_id) then
    return; -- already gone, treat as success
  end if;

  if not public.is_staff() then
    raise exception 'not authorized to delete campaign worlds';
  end if;

  delete from public.campaign_worlds where id = p_world_id;
end;
$$;
grant execute on function public.delete_campaign_world(text) to anon, authenticated;
