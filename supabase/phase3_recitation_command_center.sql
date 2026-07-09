-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 3 — RECITATION COMMAND CENTER (Live Classroom Monitor integration)
--
-- Run once in the Supabase SQL editor, after Wave 1 and Phase 1/2.
--
-- IMPORTANT — THIS DOES NOT CREATE A NEW recitation_log TABLE
--   public.recitation_log already exists (see wave1_registrations_and_logs.sql)
--   and is already load-bearing: modules/recitation/logger.js writes to it
--   today via the legacy DB.recitationLog bulk-upsert path (db-service.js),
--   and modules/recitation/progress.js, modules/achievements/ach_engine.js,
--   and modules/leaderboard/eql-engine.js all read from it. Creating a
--   second table named recitation_log, or recreating this one with a
--   `points` column instead of `pts`, would either silently no-op (`create
--   table if not exists`) or fork recitation history into two disconnected
--   places. Instead this migration is ADDITIVE ONLY:
--     • one nullable column added (class_id) so entries can optionally be
--       scoped to a class/session — existing rows (and every existing write
--       path) are unaffected, since they simply never set it.
--     • two new SECURITY-DEFINER-free RPCs that insert/delete through the
--       same table, matching the Phase 1/2 "repository pattern" convention
--       (RecitationService calls DBService.rpc(), never client.from()
--       directly — see modules/seat-arrangement/recitation-service.js).
--   RLS stays exactly as Wave 1 left it (open — see that file's RLS note);
--   these RPCs are convenience/atomicity wrappers, not a privilege change.
--
-- WHY pts/when_label INSTEAD OF points/created_at IN THE JS LAYER
--   The service layer (recitation-service.js) exposes `points` in its public
--   API for clarity, and maps it to the table's existing `pts` column
--   internally — same reasoning as classroom-service.js's _mapSeat()/etc.
--   translating snake_case rows to camelCase view-models. `created_at`
--   already existed on the table (it's what real chronological session
--   filtering uses); `when_label` is left alone as the legacy cosmetic
--   string other screens already render.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── recitation_log.class_id — new column, additive only ────────────────────
-- Plain text key, same pattern as profiles.class_id from Phase 1 — no
-- `classes` table exists yet, so this stays a free-text scope key. NULL for
-- every pre-Phase-3 row (the old Scanner-page "Log Recitation" button never
-- set a class), which is fine: the Live Monitor's session queries filter on
-- class_id = <current class>, so those legacy rows simply never appear in a
-- session feed/badge — they remain fully intact for the screens that already
-- read them (progress.js, ach_engine.js, eql-engine.js, and
-- ClassroomService.pickRandomStudent()'s least_participative count, which
-- deliberately counts ALL recitationLog entries regardless of class).
alter table public.recitation_log
  add column if not exists class_id text;

create index if not exists recitation_log_class_idx on public.recitation_log (class_id);
create index if not exists recitation_log_created_idx on public.recitation_log (created_at desc);

-- ── log_recitation_point() ──────────────────────────────────────────────────
-- The one write path for both Scanner B taps and Manual Award. p_source is
-- purely descriptive (stored nowhere new — it only shapes the default note
-- text) so the undo feed can say "Manual award" vs a bare scan with no note.
create or replace function public.log_recitation_point(
  p_student_id text,
  p_class_id   text,
  p_points     integer default 1,
  p_note       text default null,
  p_source     text default 'scan'
)
returns public.recitation_log
language plpgsql
as $$
declare
  v_row public.recitation_log;
begin
  if p_student_id is null or length(trim(p_student_id)) = 0 then
    raise exception 'p_student_id is required';
  end if;
  if p_points is null or p_points = 0 then
    p_points := 1;
  end if;

  insert into public.recitation_log (id, student_id, class_id, pts, note, when_label, created_at)
  values (
    'rec_' || replace(gen_random_uuid()::text, '-', ''),
    p_student_id,
    p_class_id,
    p_points,
    coalesce(p_note, case when p_source = 'manual' then 'Manual award' else null end),
    'Just now',
    now()
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- ── undo_recitation_log() ───────────────────────────────────────────────────
-- Hard delete of a single row by id. recitation_log is otherwise append-only
-- (same as point_log) — this is the one intentional exception, scoped to a
-- single id, so a mis-tap/mis-click during a live session can be corrected
-- without leaving a wrong entry sitting in a student's history forever.
create or replace function public.undo_recitation_log(p_log_id text)
returns boolean
language plpgsql
as $$
declare
  v_deleted integer;
begin
  if p_log_id is null then
    return false;
  end if;
  delete from public.recitation_log where id = p_log_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

grant execute on function public.log_recitation_point(text, text, integer, text, text) to anon, authenticated;
grant execute on function public.undo_recitation_log(text) to anon, authenticated;

-- ── Realtime — optional, only if your project uses the default publication
--   name. Lets a second device (e.g. a projector also on the Live Monitor)
--   see recitation taps live instead of waiting for the next unrelated
--   bulk-sync poll. Safe to run twice — the second run just hits the
--   duplicate_object branch and no-ops.
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.recitation_log';
  exception when duplicate_object then
    null;
  end;
end $$;
