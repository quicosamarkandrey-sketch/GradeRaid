-- ─────────────────────────────────────────────────────────────────────────────
-- HOTFIX — delete_classroom_layout() overload ambiguity (PGRST203)
--
-- Safe to run any number of times. Drops the stale uuid-typed overload of
-- delete_classroom_layout() so PostgREST is left with exactly one candidate
-- (the text-typed version, which is what classroom-service.js actually
-- calls). This is the same statement already present in
-- phase2_seating_hybrid_engine.sql and phase6_seat_size_migration.sql —
-- this file exists only so you don't have to re-run either of those in
-- full just to close this gap again if it reappears.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.delete_classroom_layout(uuid);

-- Confirms exactly one delete_classroom_layout() remains, and that it's the
-- text-typed one. Run this SELECT after the DROP above to double-check.
select p.proname, pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'delete_classroom_layout';
