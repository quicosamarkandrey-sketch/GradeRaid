-- ══════════════════════════════════════════════════════════════════════════
-- Phase 8 — attendance_logs realtime publication
--
-- ROOT CAUSE: Live Monitor's realtime subscription in db-service.js already
-- listens for postgres_changes on `attendance_logs` and correctly re-pulls +
-- re-renders when it fires (this was never a JS bug). But `postgres_changes`
-- only fires for tables that are actually part of the `supabase_realtime`
-- publication, and `attendance_logs` was never added to it — only
-- `recitation_log` was (see phase3_recitation_command_center.sql). So an
-- RFID kiosk scan on one device silently never notified any *other* device's
-- Live Monitor; it only ever looked like it worked on the kiosk's own tab,
-- because processScan()'s local AppStore.updateState() call updates that
-- one tab optimistically regardless of Realtime.
--
-- Manual Overrides "worked" for the same reason, not because Realtime was
-- functioning for them either — the Manual Override panel lives inside Live
-- Monitor itself, so overrideAttendance()'s local optimistic update repaints
-- the very page you're looking at, with no round trip needed. On a second
-- device, an override would have exactly the same delay as a scan does today.
--
-- Safe to run multiple times — the duplicate_object branch below no-ops if
-- the table is already in the publication.
-- ══════════════════════════════════════════════════════════════════════════

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.attendance_logs';
  exception when duplicate_object then
    null;
  end;
end $$;

-- ── The rest of db-service.js's postgres_changes listener list ─────────────
-- Same gap, same fix. recitation_log was the only table ever explicitly
-- added to the publication before this file — profiles, boss_events,
-- loot_claims, user_achievements, and rfid_cards all had the identical
-- "looks live on the tab that made the change, silent everywhere else"
-- symptom. Adding all of them now so every table db-service.js already
-- listens for actually behaves the way that code assumes.

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.profiles';
  exception when duplicate_object then
    null;
  end;
end $$;

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.boss_events';
  exception when duplicate_object then
    null;
  end;
end $$;

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.loot_claims';
  exception when duplicate_object then
    null;
  end;
end $$;

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.user_achievements';
  exception when duplicate_object then
    null;
  end;
end $$;

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.rfid_cards';
  exception when duplicate_object then
    null;
  end;
end $$;

