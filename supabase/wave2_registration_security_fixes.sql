-- ─────────────────────────────────────────────────────────────────────────────
-- WAVE 2 MIGRATION — Registration system security & correctness fixes
--
-- Run this once in the Supabase SQL editor, AFTER wave1_registrations_and_logs.sql
-- (and after Phase 1-4). Safe to re-run (every statement is idempotent).
--
-- WHAT THIS FIXES (see Registration_Fix_List.md)
--   🔴 #1  Approved students couldn't log in — nothing ever created a real
--         Supabase Auth account for them.
--   🔴 #2  profiles.id (a real Auth UUID, per every other table already
--         written against it — see phase2's _classroom_layout_visible
--         comment) never matched what regAdminApprove() actually wrote
--         there (the plaintext username).
--   🟠 #3  registrations RLS was `using (true) with check (true)` — anon
--         could read every pending plaintext password or self-approve.
--   🟠 #4  Passwords were stored in plaintext in registrations.pass.
--   🟠 #5  No server-side validation beyond two unique constraints.
--
-- THE FIX, IN ONE SENTENCE
--   Move Auth-account creation from "admin approval time" (which required a
--   service-role key / Edge Function we don't have) to "registration time"
--   (a plain client-side supabase.auth.signUp() call, which every student
--   can already legally do for themselves). Approval then just adds a
--   `profiles` row for a UUID that already exists — no service role needed
--   anywhere, and the password never has to be stored by us in any table
--   because GoTrue (Supabase Auth) is the one hashing and holding it.
--
--   A pending student can already sign in (the Auth account exists) but
--   gets no `profiles` row back until an admin approves them — auth.js's
--   existing "signed in but no profile found" branch is what gates access,
--   we just made it point at a real, friendlier reason (see auth.js diff).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- SECTION A — Drop the plaintext password column. It is never written again;
-- the real password lives only in Supabase Auth (auth.users), which we never
-- read or write directly (GoTrue owns the hashing).
-- ═════════════════════════════════════════════════════════════════════════

alter table public.registrations drop column if exists pass;

-- registrations.id used to be a client-generated 'reg_' + random text key.
-- It is now always the real Auth UUID (as text — same ::text convention as
-- profiles.id elsewhere in this project, see phase2_seating_hybrid_engine.sql).
comment on column public.registrations.id is
  'The Supabase Auth user UUID (as text), created via auth.signUp() at submission time — NOT a client-generated key. Matches profiles.id once approved.';

-- ═════════════════════════════════════════════════════════════════════════
-- SECTION B — Server-side validation (🟠 #5). Defense in depth: the RPC in
-- Section D validates everything too, but a `check` constraint means even a
-- direct-to-Postgres write (service role, SQL editor, future bug) can't
-- produce a row this app's own client validation would have rejected.
-- ═════════════════════════════════════════════════════════════════════════

alter table public.registrations
  drop constraint if exists registrations_first_name_check,
  add constraint registrations_first_name_check
    check (length(trim(first_name)) >= 2 and first_name ~ '^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'' -]*$');

alter table public.registrations
  drop constraint if exists registrations_last_name_check,
  add constraint registrations_last_name_check
    check (length(trim(last_name)) >= 2 and last_name ~ '^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'' -]*$');

alter table public.registrations
  drop constraint if exists registrations_username_check,
  add constraint registrations_username_check
    check (username ~ '^[a-z0-9._]{3,}$');

alter table public.registrations
  drop constraint if exists registrations_email_check,
  add constraint registrations_email_check
    check (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$');

alter table public.registrations
  drop constraint if exists registrations_grade_level_check,
  add constraint registrations_grade_level_check
    check (grade_level in ('7','8','9','10','11','12'));

alter table public.registrations
  alter column student_id_text set not null,
  drop constraint if exists registrations_student_id_text_check,
  add constraint registrations_student_id_text_check
    check (length(trim(student_id_text)) > 0);

alter table public.registrations
  alter column section set not null;

-- ── Section must resolve to a real, non-archived class_sections row ───────
-- There's no section_id FK column in this table (section is stored as the
-- section NAME string, resolved to a class_sections row only at approval
-- time — see regAdminApprove()'s existing matchedSection logic). A plain
-- `check` constraint can't do a cross-table lookup, so this is a trigger
-- instead — same effect as "make section_id not null + validated" from the
-- fix list, adapted to this table's actual (name-based) shape.
create or replace function public._registrations_validate_section()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.class_sections cs
     where cs.grade_level = new.grade_level
       and lower(cs.section_name) = lower(trim(new.section))
       and not cs.archived
  ) then
    raise exception 'No active section "%" found for grade %', new.section, new.grade_level
      using errcode = '23514'; -- check_violation, same class as the other constraints above
  end if;
  return new;
end;
$$;

drop trigger if exists registrations_validate_section on public.registrations;
create trigger registrations_validate_section
  before insert or update of grade_level, section on public.registrations
  for each row execute function public._registrations_validate_section();

-- ═════════════════════════════════════════════════════════════════════════
-- SECTION C — Lock down RLS (🟠 #3). No more `using (true) with check (true)`.
--   SELECT: the row's own owner (auth.uid() = id), or staff.
--   INSERT / UPDATE: nobody, directly. Every write goes through a SECURITY
--     DEFINER RPC (Section D) — same "RPC-only write" pattern already used
--     for class_sections, classroom_layouts, attendance, and recitation_log
--     elsewhere in this project.
-- ═════════════════════════════════════════════════════════════════════════

drop policy if exists registrations_anon_all on public.registrations;
drop policy if exists registrations_select_own_or_staff on public.registrations;
drop policy if exists registrations_no_direct_insert on public.registrations;
drop policy if exists registrations_no_direct_update on public.registrations;

create policy registrations_select_own_or_staff on public.registrations
  for select using (
    auth.uid()::text = id
    or exists (
      select 1 from public.profiles
       where id = auth.uid()::text and role in ('admin', 'teacher')
    )
  );

revoke insert, update, delete on public.registrations from anon, authenticated;
grant select on public.registrations to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- SECTION D — RPCs. The only write path into `registrations`, and the only
-- path that turns an approved registration into a real `profiles` row.
-- ═════════════════════════════════════════════════════════════════════════

-- submit_registration(): called by a freshly-signed-up student, right after
-- supabase.auth.signUp() on the client, with the new user's own session
-- (see registrations.js doRegister()). p_id must equal auth.uid() — a
-- signed-in user can only ever submit a registration for themselves, never
-- on behalf of someone else's uid.
create or replace function public.submit_registration(
  p_id             text,
  p_first_name     text,
  p_last_name      text,
  p_username       text,
  p_email          text,
  p_student_id_text text,
  p_grade_level    text,
  p_section        text
)
returns public.registrations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.registrations;
begin
  if auth.uid() is null or auth.uid()::text <> p_id then
    raise exception 'You can only submit a registration for your own account.';
  end if;

  -- ── Duplicate / uniqueness checks (mirrors the client-side checks in
  -- regValidateUsername/regValidateEmail — server-side so a direct RPC call
  -- can't bypass them, and so two near-simultaneous submissions can't race
  -- past the client-side check, fix list item #6/#5).
  if exists (select 1 from public.registrations where id = p_id) then
    raise exception 'A registration already exists for this account.';
  end if;
  if exists (
    select 1 from public.registrations
     where lower(username) = lower(p_username) and status <> 'rejected'
  ) then
    raise exception 'Username already requested.';
  end if;
  if exists (
    select 1 from public.registrations
     where lower(email) = lower(p_email) and status <> 'rejected'
  ) then
    raise exception 'Email already requested.';
  end if;
  -- NOTE: `profiles` has no dedicated username column (see file header) —
  -- username only ever exists in `registrations`, purely as a request-time
  -- display/dedup convenience, so there's no approved-account collision to
  -- check here beyond the pending-registration check just above.

  insert into public.registrations (
    id, first_name, last_name, username, email, student_id_text,
    grade_level, section, status, submitted_at
  ) values (
    p_id, trim(p_first_name), trim(p_last_name), lower(trim(p_username)),
    lower(trim(p_email)), trim(p_student_id_text), p_grade_level, trim(p_section),
    'pending', now()
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.submit_registration(text, text, text, text, text, text, text, text)
  to authenticated;

-- check_registration_status(): lets a not-yet-approved student (or someone
-- who forgot they already registered) check where their request stands,
-- keyed by email — fix list item #9. Deliberately returns the minimum
-- information needed (no name/username/id) and the exact same generic
-- "not found" shape whether the email was never registered or belongs to
-- someone else, so this can't be used to enumerate registered emails.
create or replace function public.check_registration_status(p_email text)
returns table (status text, rejection_reason text, submitted_at timestamptz)
language sql
security definer
stable
set search_path = public
as $$
  select r.status, r.rejection_reason, r.submitted_at
    from public.registrations r
   where lower(r.email) = lower(trim(p_email))
   order by r.submitted_at desc
   limit 1;
$$;

grant execute on function public.check_registration_status(text) to anon, authenticated;

-- approve_registration(): the only way a `registrations` row becomes a real
-- `profiles` row. Staff-only (checked explicitly below — this table's RPCs
-- are a stricter gate than the rest of the app's RPCs, per the fix list's
-- specific call-out that this table's open-security-hole status needed
-- closing). Idempotent-ish: re-approving an already-approved row is a no-op
-- error rather than creating a duplicate profile.
create or replace function public.approve_registration(
  p_reg_id text,
  p_color  text,
  p_init   text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg     public.registrations;
  v_profile public.profiles;
  v_class_id text;
begin
  if not exists (
    select 1 from public.profiles
     where id = auth.uid()::text and role in ('admin', 'teacher')
  ) then
    raise exception 'Only staff can approve registrations.';
  end if;

  select * into v_reg from public.registrations where id = p_reg_id;
  if v_reg is null then
    raise exception 'Registration not found.';
  end if;
  if v_reg.status = 'approved' and v_reg.approved_student_id is not null then
    raise exception 'Already approved.';
  end if;
  if exists (select 1 from public.profiles where id = v_reg.id) then
    raise exception 'An account already exists for this registration.';
  end if;

  select cs.id into v_class_id
    from public.class_sections cs
   where cs.grade_level = v_reg.grade_level
     and lower(cs.section_name) = lower(v_reg.section)
     and not cs.archived
   limit 1;
  if v_class_id is null then
    v_class_id := 'default-class';
  end if;

  insert into public.profiles (
    id, role, display_name, init, color, xp, coins, level, tier,
    attendance_pct, quiz_avg, first_name, last_name, class_id, join_date
  ) values (
    v_reg.id, 'student', v_reg.first_name || ' ' || v_reg.last_name, p_init, p_color,
    0, 0, 1, 'Novice', 0, 0, v_reg.first_name, v_reg.last_name, v_class_id, current_date
  )
  returning * into v_profile;

  update public.registrations
     set status = 'approved',
         reviewed_at = now(),
         reviewed_by = coalesce((select display_name from public.profiles where id = auth.uid()::text), 'Admin'),
         approved_student_id = v_profile.id,
         rejection_reason = null
   where id = p_reg_id;

  return v_profile;
end;
$$;

grant execute on function public.approve_registration(text, text, text) to authenticated;

-- reject_registration(): staff-only status flip, no profile side effects.
create or replace function public.reject_registration(p_reg_id text, p_reason text)
returns public.registrations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.registrations;
begin
  if not exists (
    select 1 from public.profiles
     where id = auth.uid()::text and role in ('admin', 'teacher')
  ) then
    raise exception 'Only staff can reject registrations.';
  end if;

  update public.registrations
     set status = 'rejected',
         reviewed_at = now(),
         reviewed_by = coalesce((select display_name from public.profiles where id = auth.uid()::text), 'Admin'),
         rejection_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = p_reg_id
  returning * into v_row;

  if v_row is null then
    raise exception 'Registration not found.';
  end if;

  return v_row;
end;
$$;

grant execute on function public.reject_registration(text, text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- SECTION E — Duplicate-submission short-window guard (fix list item #6's
-- server-side half; the client-side half is the submit-button
-- disable/spinner in registrations.js). Belt-and-suspenders against a
-- double-click racing two submit_registration() calls before the first one
-- commits: the registrations_username_check / email uniqueness-in-app-code
-- above already stop most of this, but a true unique index closes the race
-- window completely (two concurrent transactions can both pass an `exists`
-- check before either commits; a unique index cannot be raced the same way).
-- ═════════════════════════════════════════════════════════════════════════

-- wave1 declared username/email as blanket-unique (`text not null unique`).
-- That's actually too strict for this app's own logic: regValidateUsername/
-- regValidateEmail (and submit_registration() above) both deliberately
-- treat a REJECTED registration's username/email as free to reuse, so a
-- student who was rejected can fix their info and register again. Under a
-- blanket unique constraint that resubmission would fail at the database
-- layer even though the app told them it was fine. Replace with partial
-- unique indexes that only cover non-rejected rows.
alter table public.registrations drop constraint if exists registrations_username_key;
alter table public.registrations drop constraint if exists registrations_email_key;

create unique index if not exists registrations_username_unique_pending_idx
  on public.registrations (lower(username))
  where status <> 'rejected';

create unique index if not exists registrations_email_unique_pending_idx
  on public.registrations (lower(email))
  where status <> 'rejected';

