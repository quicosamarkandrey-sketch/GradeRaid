-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 46 — BOSS ADVANCED SETTINGS SYNC
--
-- Run once in the Supabase SQL editor.
--
-- THE BUG THIS FIXES
--   Six World Boss admin features were writing to fields on the local
--   `boss` object that were never given a boss_events column and were never
--   part of db-service.js's pull/push mapping:
--
--     boss.bossQuestions    (admin-page.js "Questions" editor)
--     boss.minionSettings   (minions.js "Minions" panel)
--     boss.combatSettings   (combat-settings.js "Combat Settings" modal)
--     boss.skills /
--     boss.skillFireMode /
--     boss.skillIntervalMin/Max  (skills.js "Skill Configuration" modal)
--     boss.rageSettings     (rage.js "Rage Mode" config)
--     boss.phases           (phases.js "Phase Configuration" modal)
--
--   saveDB() writes these into the in-memory cache + localStorage
--   immediately (so they look saved), but since the Supabase push never
--   sent them anywhere, they lived only in that one browser tab. Two things
--   then wipe them right back out: (1) a plain page refresh re-pulls
--   "clean" data from Supabase, and (2) boss_events has a realtime
--   subscription that re-pulls on ANY change to that table (e.g. an HP tick
--   from a student answering) — both rebuild the boss object from the
--   database, which has never heard of these fields, so they silently
--   disappear. This migration adds the missing columns; the matching
--   db-service.js pull/push changes are shipped alongside this file.
--
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.boss_events add column if not exists boss_questions      jsonb default '[]'::jsonb;
alter table public.boss_events add column if not exists minion_settings     jsonb default '{}'::jsonb;
alter table public.boss_events add column if not exists combat_settings     jsonb default '{}'::jsonb;
alter table public.boss_events add column if not exists skills              jsonb default '{}'::jsonb;
alter table public.boss_events add column if not exists skill_fire_mode     text;
alter table public.boss_events add column if not exists skill_interval_min  int;
alter table public.boss_events add column if not exists skill_interval_max  int;
alter table public.boss_events add column if not exists rage_settings       jsonb default '{}'::jsonb;
alter table public.boss_events add column if not exists phases              jsonb default '[]'::jsonb;

-- No RLS changes needed — these are plain columns on a table that's already
-- staff-writable via the existing boss_events upsert policy (same table
-- that name/description/loot_rewards/etc. already write through). Nothing
-- here is student-writable, matching every other boss-config field.
