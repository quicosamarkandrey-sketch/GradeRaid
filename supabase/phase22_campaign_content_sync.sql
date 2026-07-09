-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 22 — CAMPAIGN CONTENT SYNC (`campaign_worlds` table)
--
-- Run once in the Supabase SQL editor. No ordering dependency on other
-- phases beyond is_staff() existing (see phase9_student_stat_rpc.sql or
-- any earlier phase — it's used throughout this project).
--
-- THE GAP THIS CLOSES (SYNC_AUDIT_REPORT.md, "Campaign — confirmed fully
-- local")
--   DB.stageMap (worlds → stages → scenes/enemies/questions) was entirely
--   local-only: db-service.js's pull function fell back to
--   `stageMap: _cache?.stageMap || []`, and there was no push block at
--   all. A world or stage authored/edited on one device
--   (modules/campaign/admin-map-editor.js) never reached any other
--   device. Identical gap shape to quiz content before Phase 20 — same
--   fix shape applied here.
--
-- WHY ONE JSONB COLUMN FOR STAGES, NOT A RELATIONAL STAGE TABLE
--   A stage already nests scenes[], enemies[] (each with its own
--   questions[]), and an outro[] — the same "content is a nested JSON
--   document, not a set of relational rows" shape quizzes.questions
--   already uses. Modelling scenes/enemies/questions as their own tables
--   would be a much larger schema for no real benefit here (nothing reads
--   or filters at that granularity server-side — the client always reads
--   a whole stage's content at once). One row per WORLD, with its stages
--   array stored as jsonb, mirrors quizzes' approach and keeps
--   admin-map-editor.js's existing whole-world/whole-stage read/write
--   pattern working unchanged.
--
-- WHY sort_order EXISTS
--   World order is meaningful (rendered in array order, and presumably
--   intended as a difficulty/progression sequence) but there is no
--   reorder-world feature in admin-map-editor.js today (only stages
--   within a world can be reordered) — array position is creation order.
--   sort_order preserves that ordering across the sync round-trip; pushed
--   as each world's index in cache.stageMap at push time, and pulled back
--   ordered by it.
--
-- WHAT THIS DOES NOT CHANGE
--   - stageProgress (per-student campaign progress) is NOT part of this
--     migration — out of scope, same as quiz completedQuizzes/history
--     being out of scope for Phase 20. Only the CONTENT is synced here.
--   - No RPC is added — same as quizzes/achievements/titles, this is a
--     simple admin-authored catalog table: public read, staff-only bulk
--     upsert write.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.campaign_worlds (
  id           text primary key,
  label        text not null,
  icon         text,
  color        text,
  description  text,
  stages       jsonb not null default '[]'::jsonb, -- full stages[] array: scenes, enemies, questions, outro
  sort_order   integer not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

alter table public.campaign_worlds enable row level security;

drop policy if exists campaign_worlds_select_all  on public.campaign_worlds;
drop policy if exists campaign_worlds_staff_write on public.campaign_worlds;

-- Catalog is global; per-section visibility for campaign content is a
-- separate, not-yet-built concern (campaign_stage_sections exists per
-- phase14_section_isolation.sql but, like title_sections was before Phase
-- 21, has no write RPC or read-side filter yet — flagged as a follow-up,
-- not part of this migration's scope).
create policy campaign_worlds_select_all on public.campaign_worlds
  for select using (true);

create policy campaign_worlds_staff_write on public.campaign_worlds
  for all using (public.is_staff()) with check (public.is_staff());

-- Realtime: same two-part requirement as every prior phase that added a
-- table to this app's sync surface (Phase 19/20/21) — the JS
-- postgres_changes listener alone does nothing until the table is also
-- added to the supabase_realtime publication.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'campaign_worlds'
  ) then
    execute 'alter publication supabase_realtime add table public.campaign_worlds';
  end if;
end $$;
