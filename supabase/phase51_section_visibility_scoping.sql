-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 51 — SECTION MAKER: STOP LEAKING OTHER TEACHERS' SECTIONS
--
-- Run once in the Supabase SQL editor, after Phase 50.
--
-- THE GAP
--   class_sections has had exactly one SELECT policy since it was created
--   (Phase 4): `class_sections_select_all ... using (true)`. That's wide
--   open to anon AND authenticated — every logged-in teacher's Section
--   Maker screen, kiosk class picker, seating builder, and Live Monitor
--   pull class_sections straight off this table with no ownership filter
--   anywhere client-side either, so every teacher has always seen every
--   section from every other teacher: names, grade levels, who advises
--   them, all of it.
--
--   This was never as bad as it could have been — every WRITE path
--   (create/update/archive/unarchive_class_section, Phase 39/49, and
--   upsert_attendance_schedule, Phase 50) is already gated by
--   is_staff_for_section(), so another teacher's Edit/Archive button in the
--   UI would fail server-side rather than actually do anything. But "you
--   can see it and the RPC just silently no-ops with an error" is not the
--   same as "you don't see it at all", which is what was asked for.
--
-- WHY THIS ISN'T JUST is_staff_for_section() OUTRIGHT
--   The public, UNAUTHENTICATED registration form (modules/admin/
--   registrations.js, regOnGradeChange()) reads class_sections directly to
--   populate its grade→section dropdown for a brand-new visitor who hasn't
--   logged in yet and never will as staff. If SELECT were narrowed to
--   is_staff_for_section() alone, that anon session would resolve to
--   "false" for every row and the sign-up form's section picker would go
--   permanently empty. Anon access has to stay open for that flow — the
--   fix scopes AUTHENTICATED access only.
--
-- THE FIX
--   auth.role() distinguishes the two cases directly (Supabase's own JWT
--   role claim — 'anon' for the public/logged-out client, 'authenticated'
--   for any logged-in session, service-role callers are unaffected since
--   that role bypasses RLS entirely):
--     - anon (not logged in)        → unchanged, sees every row (needed
--       for the public sign-up form above).
--     - authenticated, staff        → is_staff_for_section(id): admin sees
--       every row (unchanged); a teacher sees ONLY sections where
--       class_sections.adviser_id = their own id.
--     - authenticated, student      → sees nothing. No student-facing
--       screen reads class_sections directly today (every consumer found —
--       Section Maker, the kiosk, seating builder, Live Monitor,
--       enrollment hub, world boss/achievements/titles admin pages — is
--       staff-only), so this has no visible effect on students; it just
--       closes the row to an audience that never needed it.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists class_sections_select_all on public.class_sections;

create policy class_sections_select_scoped on public.class_sections
  for select
  using (
    auth.role() <> 'authenticated'      -- anon (public registration form): unchanged, sees all
    or public.is_staff_for_section(id)  -- authenticated: admin sees all, teacher sees only their own
  );

-- Grants are unchanged — the policy above is what actually narrows what
-- each role's SELECT returns; repeating the grant is harmless.
grant select on public.class_sections to anon, authenticated;
