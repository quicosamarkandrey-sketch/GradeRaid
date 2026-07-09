-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 12 — KIOSK SELF-SERVICE IDENTITY CHECK
-- (see EduQuest_Pending_Fixes_Report.md §4)
--
-- Run once in the Supabase SQL editor, after Phase 1–11.
--
-- THE PROBLEM THIS CLOSES
--   On the Card Enrollment Hub's Student Self-Service Kiosk mode, nothing
--   verified that the student standing at the kiosk was actually the
--   student ID being enrolled to a new RFID card — anyone could type any
--   name and bind a card to it.
--
-- WHY THIS NEEDS A NEW RPC (NOT client-side supabase.auth.signInWithPassword)
--   The Card Enrollment Hub is an admin-only nav item — the browser tab
--   running the kiosk is signed in as the TEACHER/ADMIN who opened it, not
--   as the student standing in front of it. Calling
--   supabase.auth.signInWithPassword() with the student's email/password
--   directly from the client would, on success, REPLACE the tab's active
--   session with the student's — silently logging the admin out of their
--   own kiosk session and swapping the tab's write permissions out from
--   under the rest of the app. That's unacceptable for a shared classroom
--   device mid-workflow.
--
--   Instead, this RPC verifies the student's password entirely server-side
--   — comparing it against the same bcrypt hash Supabase Auth itself uses
--   (auth.users.encrypted_password, via pgcrypto's crypt()) — and returns
--   only a boolean. No session is created, refreshed, or swapped; the
--   calling tab's admin session is completely untouched either way. This is
--   the standard Supabase pattern for "confirm this password" checks that
--   must not double as a sign-in (the same shape Supabase's own community
--   docs recommend for password-confirmation flows).
--
-- ACCESS CONTROL / BRUTE-FORCE NOTE
--   Gated on public.is_staff() — only an already-authenticated
--   teacher/admin session can call this at all (matches the fact that only
--   an admin can open the Card Enrollment Hub in the first place). This
--   doesn't rate-limit repeated guesses on its own; the app-side call site
--   (enrollment-hub.js) additionally caps it to 3 attempts before bouncing
--   the kiosk back to the search screen. If this ever needs stronger
--   brute-force protection, add a `login_attempts`-style counter table
--   keyed by student ID — not part of this pass.
--
-- COMPANION CHANGE (no SQL needed)
--   The kiosk's "unlock from Lock Mode" flow re-verifies the ADMIN's own
--   password, which reuses supabase.auth.signInWithPassword() with the
--   admin's OWN email — safe there, because re-authenticating the same
--   account that's already signed in just refreshes that tab's existing
--   session rather than swapping to a different one. See
--   enrollment-hub.js's _enrollVerifyAdminPassword().
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

create or replace function public.verify_student_password(
  p_student_id text,
  p_password   text
)
returns boolean
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_hash text;
begin
  if not public.is_staff() then
    raise exception 'Only a staff session may verify a student password.';
  end if;

  if p_student_id is null or p_password is null or length(p_password) = 0 then
    return false;
  end if;

  select u.encrypted_password into v_hash
    from auth.users u
    join public.profiles p on p.id = u.id::text
   where p.id = p_student_id
     and p.role = 'student';

  if v_hash is null then
    -- Unknown student (or a student row with no matching Auth user, e.g.
    -- pre-migration seed data): do a dummy crypt() call anyway so this
    -- branch doesn't return measurably faster than a real mismatch, then
    -- return false either way.
    perform crypt(p_password, gen_salt('bf'));
    return false;
  end if;

  return v_hash = crypt(p_password, v_hash);
end;
$$;

grant execute on function
  public.verify_student_password(text, text)
to authenticated;
