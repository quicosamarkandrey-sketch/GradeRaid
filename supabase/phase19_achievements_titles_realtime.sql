-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 19 — REALTIME PARITY FOR ACHIEVEMENTS/TITLES
--
-- Run once in the Supabase SQL editor, after Phase 18.
--
-- ROOT CAUSE (same shape as phase8_attendance_realtime.sql and
-- phase16_achievement_sections_rpc.sql's REALTIME section): db-service.js's
-- postgres_changes listener now subscribes to `achievements`, `titles`, and
-- `title_unlocks` (added this pass), but postgres_changes only fires for
-- tables that are actually part of the `supabase_realtime` publication.
-- None of these three were ever added to it — `user_achievements` was (see
-- phase8), but the achievements/titles catalogs and title_unlocks were not.
--
-- Practical effect before this: a badge or title created/edited on one
-- device, or a title unlocked/revoked, only reached another device on that
-- device's next full reload — not live, the same silent gap phase8 closed
-- for attendance_logs.
--
-- Safe to run multiple times — the duplicate_object branch no-ops if a
-- table is already in the publication.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.achievements';
  exception when duplicate_object then
    null;
  end;
end $$;

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.titles';
  exception when duplicate_object then
    null;
  end;
end $$;

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.title_unlocks';
  exception when duplicate_object then
    null;
  end;
end $$;
