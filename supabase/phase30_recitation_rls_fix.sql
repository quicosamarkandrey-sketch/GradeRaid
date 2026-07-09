-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 30 — fix: recitation_log insert blocked by RLS (42501)
--
-- ROOT CAUSE
--   Phase 3 (phase3_recitation_command_center.sql) wrote log_recitation_point()
--   / undo_recitation_log() as plain `language plpgsql` — no `security definer`
--   — and said so explicitly: "two new SECURITY-DEFINER-free RPCs... RLS stays
--   exactly as Wave 1 left it (open)". That was true at the time: Wave 1's
--   `recitation_log_anon_all` policy allowed inserts from anyone, so a
--   non-security-definer RPC worked fine — it ran as the caller, and the
--   caller was allowed to insert.
--
--   Phase 14 then dropped that open policy ("close the ALL/true hole") and
--   replaced it with ONLY a SELECT policy (`recitation_log_select_scoped`),
--   reasoning "writes already go through log_recitation_point() RPC — no
--   direct insert/update policy needed here." That reasoning assumed the RPC
--   was privileged. It never was. With no INSERT policy at all and a
--   non-security-definer function, every call to log_recitation_point() now
--   runs the INSERT as the calling role against a table with zero INSERT
--   grants — hence `42501 new row violates row-level security policy for
--   table "recitation_log"`. Same exposure applies to undo_recitation_log()'s
--   DELETE (no DELETE policy exists either, so undo is silently a no-op
--   right now, not an error, since `delete ... where id = ...` just deletes
--   zero rows under RLS rather than throwing).
--
-- FIX — bring these two RPCs in line with every other write-RPC already in
--   this codebase (delete_boss_event, delete_achievement, delete_title, etc.
--   — see phase23_catalog_delete_sync.sql): `security definer` + an explicit
--   in-function authorization check, instead of relying on table RLS to do
--   it. This is additive/replace-only, same signatures, nothing else changes.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.log_recitation_point(
  p_student_id text,
  p_class_id   text,
  p_points     integer default 1,
  p_note       text default null,
  p_source     text default 'scan'
)
returns public.recitation_log
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.recitation_log;
begin
  if p_student_id is null or length(trim(p_student_id)) = 0 then
    raise exception 'p_student_id is required';
  end if;

  -- same authorization shape as point_log_staff_write / redemptions_staff_write:
  -- caller must be staff for the section the point is being logged into.
  if not public.is_staff_for_section(p_class_id) then
    raise exception 'not authorized to log recitation for this section';
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

create or replace function public.undo_recitation_log(p_log_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted  integer;
  v_class_id text;
begin
  if p_log_id is null then
    return false;
  end if;

  select class_id into v_class_id from public.recitation_log where id = p_log_id;
  if v_class_id is null then
    return false; -- row gone already, or (legacy) never had a class_id — nothing safe to authorize
  end if;
  if not public.is_staff_for_section(v_class_id) then
    raise exception 'not authorized to undo recitation for this section';
  end if;

  delete from public.recitation_log where id = p_log_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

grant execute on function public.log_recitation_point(text, text, integer, text, text) to anon, authenticated;
grant execute on function public.undo_recitation_log(text) to anon, authenticated;
