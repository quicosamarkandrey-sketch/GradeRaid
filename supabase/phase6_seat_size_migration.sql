-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 6 — SEAT SIZE MIGRATION (see Seating_ColdCall_Enhancement_Report.md §1)
--
-- Run once in the Supabase SQL editor, after Phase 1–5.
--
-- WHAT THIS FIXES
--   Seats are bumping from 80×80 to 120×120px (classroom_builder.js /
--   live_monitor.js). Seats aren't on a grid — each has a free-form
--   xCoord/yCoord center position — so any layout built with seats packed
--   closer than ~120px apart will visually overlap once seats render 50%
--   bigger. This migration adds the one-time-ever auto-fix path chosen for
--   that (report §1, option 2): the client detects overlaps the first time
--   a layout is opened after this ships, auto-spreads them apart, and then
--   permanently marks the layout as fixed — so the fix never re-runs, even
--   if a teacher intentionally re-packs seats tight afterward.
--
-- WHY A NEW COLUMN, NOT SOMETHING DERIVED
--   Whether a layout "needs" fixing can't be re-derived from current seat
--   distances at read-time, because a teacher packing seats close together
--   on purpose after the one-time fix has already run must NOT retrigger
--   it. The flag has to be a stored, durable fact about the layout, not a
--   live computation.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════
-- A. classroom_layouts.seat_overlap_fixed
-- ═════════════════════════════════════════════════════════════════════════
-- Defaults to false so every existing layout is treated as "not yet
-- checked" and gets exactly one pass through the client-side auto-fix.
-- Brand-new layouts created after this migration (via the Blueprint wizard
-- or "+ New") are generated with the new 130px default spacing already
-- seat-size-safe (see _cbWizardSpacing in classroom_builder.js), so the
-- flag being false for them just means the client's one no-op overlap
-- check runs once and immediately marks them fixed too — harmless.
alter table public.classroom_layouts
  add column if not exists seat_overlap_fixed boolean not null default false;


-- ═════════════════════════════════════════════════════════════════════════
-- B. Unrelated cleanup, bundled here because it's the next migration you'll
--    actually run: an earlier hand-run migration left a stale uuid-typed
--    overload of delete_classroom_layout() in the database (same class of
--    issue save_classroom_layout() already had — see phase2's fix for that
--    one). PostgREST can't tell it apart from the text-typed version and
--    errors with PGRST203 "Could not choose the best candidate function."
--    This has also been fixed in phase2_seating_hybrid_engine.sql directly,
--    for anyone running it fresh in a new environment — but you don't need
--    to re-run all of phase2 just for this; running phase6 once is enough.
-- ═════════════════════════════════════════════════════════════════════════
drop function if exists public.delete_classroom_layout(uuid);


-- ═════════════════════════════════════════════════════════════════════════
-- C. mark_seat_overlap_fixed()
--   Tiny dedicated toggle, same shape as set_seat_lock() in Phase 2 — the
--   UI shouldn't have to round-trip a whole layout object through
--   save_classroom_layout() just to flip one boolean.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.mark_seat_overlap_fixed(p_layout_id text)
returns public.classroom_layouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.classroom_layouts;
begin
  update public.classroom_layouts
     set seat_overlap_fixed = true
   where id = p_layout_id::uuid
   returning * into v_row;

  if v_row is null then
    raise exception 'Layout % not found.', p_layout_id;
  end if;

  return v_row;
end;
$$;

grant execute on function
  public.mark_seat_overlap_fixed(text)
to authenticated;
