-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 4 — SMART CARD ENROLLMENT HUB
--
-- Run once in the Supabase SQL editor, after Phase 1 (RFID/Attendance) and
-- Phase 4 Section Maker.
--
-- DEVIATION FROM THE ORIGINAL SPEC — READ THIS FIRST
--   The spec for this migration asked for (a) a unique `profiles.rfid_tag`
--   column and (b) a new `class_sections` table. Neither is added here:
--
--   (a) public.rfid_cards already exists (phase1_rfid_attendance.sql) and is
--       the canonical card-ownership store. It supports what a single
--       `profiles.rfid_tag` column cannot: keeping a retired card's history
--       intact (`is_active = false`, never deleted) so old attendance_logs
--       rows referencing that tag stay explainable. Adding a second,
--       unsynced `rfid_tag` column on profiles would let the two disagree
--       about who owns a card. The Hub reads/writes rfid_cards exclusively.
--
--   (b) public.class_sections already exists (phase4_section_maker.sql),
--       and profiles.class_id already IS the "section_id" foreign key the
--       spec asked for (it stores a class_sections.id value — see that
--       migration's header). No new column or table needed; the Section
--       Filter Dropdown in the Hub just reads draft.classSections and
--       filters students by classId.
--
-- WHAT THIS FILE ACTUALLY ADDS
--   One new RPC, enroll_rfid_card(). It's a thin wrapper around the
--   existing assign_rfid_card() that adds the one piece of behavior the
--   Hub genuinely needs and assign_rfid_card() doesn't have: a way to
--   detect "this physical card is already bound to a DIFFERENT student"
--   as a distinguishable, catchable condition (CARD_TAKEN:<name>) instead
--   of silently stealing the card the way the kiosk's admin-only Assign
--   Card mode intentionally does today. assign_rfid_card() itself is left
--   completely untouched — the RFID kiosk's existing Assign Card mode
--   keeps behaving exactly as before.
-- ─────────────────────────────────────────────────────────────────────────────

-- enroll_rfid_card(): Hub-specific entry point for card enrollment.
--   p_force = false (default): if the tag is currently active on a
--     DIFFERENT student, raise a catchable conflict instead of writing
--     anything. This is what lets the Hub show "This card is already
--     linked to <name> — reassign anyway?" instead of the swap happening
--     invisibly the way it does in the kiosk's existing Assign Card mode.
--   p_force = true: caller has already confirmed the reassignment (e.g.
--     the operator clicked "Reassign anyway" in the Hub's conflict
--     dialog) — delegates straight to assign_rfid_card(), which retires
--     the old binding and inserts the new one atomically.
create or replace function public.enroll_rfid_card(
  p_student_id text,
  p_tag_id      text,
  p_force       boolean default false
)
returns public.rfid_cards
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_student_id text;
  v_existing_name       text;
begin
  if p_student_id is null or p_tag_id is null or length(trim(p_tag_id)) = 0 then
    raise exception 'student_id and tag_id are required';
  end if;

  if not exists (select 1 from public.profiles where id = p_student_id) then
    raise exception 'Unknown student_id: %', p_student_id;
  end if;

  select student_id into v_existing_student_id
    from public.rfid_cards
   where tag_id = p_tag_id and is_active = true and student_id <> p_student_id;

  if v_existing_student_id is not null and not p_force then
    select coalesce(display_name, first_name || ' ' || last_name, id)
      into v_existing_name
      from public.profiles
     where id = v_existing_student_id;

    -- Prefix is intentional and load-bearing: EnrollmentService parses it
    -- client-side to distinguish "needs confirmation" from a hard failure,
    -- without needing a second round-trip just to look the name up again.
    raise exception 'CARD_TAKEN:%', coalesce(v_existing_name, 'another student');
  end if;

  -- Reuse the existing, already-atomic reassignment logic verbatim rather
  -- than duplicating its retire-old-bindings-then-insert transaction here.
  return public.assign_rfid_card(p_student_id, p_tag_id);
end;
$$;

grant execute on function
  public.enroll_rfid_card(text, text, boolean)
to anon, authenticated;
