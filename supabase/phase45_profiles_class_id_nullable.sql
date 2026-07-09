-- Phase 45: allow profiles.class_id to be null for teacher accounts
--
-- Background (see REPORT_cross_account_data_and_template_row.md, Part 5):
--
-- phase1_rfid_attendance.sql added `class_id` to `profiles` as:
--   class_id text not null default 'default-class';
-- At the time, every profile (student or staff) was expected to carry a
-- class_id.
--
-- phase37_teacher_invites.sql later changed the design: teachers are no
-- longer tied to a single class_id — their sections come from
-- class_sections.adviser_id instead (see get_teacher_directory(), Phase 35).
-- redeem_teacher_invite() therefore inserts `null` for class_id on purpose,
-- but the column was never relaxed, so every invite redemption has been
-- failing with:
--   null value in column "class_id" of relation "profiles" violates
--   not-null constraint
--
-- Fix: drop the NOT NULL constraint. Students keep working exactly as
-- before — the column default ('default-class') is untouched, so any
-- existing insert path that doesn't explicitly pass class_id is unaffected.
-- This does not change RLS, does not touch existing rows, and does not
-- affect any other table.

alter table public.profiles
  alter column class_id drop not null;
