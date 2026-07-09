-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 37 — TEACHER ACCOUNT CREATION VIA INVITE LINK
-- (see ISOLATION_ROLES_PLAN.md §11 "Account & access management", §12 step 5,
--  chunk A5)
--
-- Run once in the Supabase SQL editor, after Phase 36.
--
-- WHY INVITE-LINK, NOT AN EDGE FUNCTION
--   Creating a Supabase Auth user from admin-side code normally needs the
--   service-role key (supabase.auth.admin.createUser()), which this static
--   client-only app deliberately does not have access to — same reasoning
--   already spelled out in registrations-service.js's header for why student
--   signup works the way it does. So this reuses that exact precedent: the
--   NEW ACCOUNT HOLDER calls the normal, unprivileged, anon-callable
--   supabase.auth.signUp() for themselves. The only thing admin-side code
--   contributes is a token that (a) proves an admin actually invited someone
--   and (b) is the ONLY way the resulting profiles.role ever becomes
--   'teacher' instead of the normal self-serve 'student' path.
--
-- FLOW
--   1. Admin clicks "Generate Invite Link" → create_teacher_invite() inserts
--      a pending row with a random token + 7-day expiry, returns it.
--   2. Admin copies the link (built client-side as
--      `${origin}${pathname}?teacher_invite=${token}`) and shares it with
--      the new teacher by whatever channel (Slack/email/etc.) — this app
--      has no way to send a custom invite email itself (see #1).
--   3. The invited person opens the link. check_teacher_invite() (anon-
--      callable, no session needed yet) validates the token before the
--      signup form even renders — see modules/admin/teacher-invite.js.
--   4. They fill in their own name/email/password and submit. Client calls
--      auth.signUp() for themselves (same two-step "sign in if no session"
--      handling as RegistrationService.registerStudent(), for the same
--      "Confirm email" project-setting reason), then calls
--      redeem_teacher_invite() under that fresh session.
--   5. redeem_teacher_invite() is the only place role='teacher' gets set
--      for a brand new account outside the SQL editor — gated entirely by
--      the token (must be pending + unexpired), not by any role check on
--      the caller, since the caller has no profile/role yet at all.
--
-- WHAT'S NOT IN THIS FILE
--   - Any way to email the invite link automatically — deliberately out of
--     scope per the "no service-role key" constraint above.
--   - Per-invite pre-filled name/email (this app generates GENERIC links —
--     the invited person fills in everything themselves).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Table
-- ═════════════════════════════════════════════════════════════════════════
create table if not exists public.teacher_invites (
  token       text primary key default replace(gen_random_uuid()::text, '-', ''),
  created_by  text not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '7 days'),
  status      text not null default 'pending' check (status in ('pending', 'used', 'revoked')),
  used_at     timestamptz,
  used_by     text references public.profiles(id)
);

create index if not exists teacher_invites_status_idx on public.teacher_invites (status);

alter table public.teacher_invites enable row level security;
-- Deliberately NO direct table policies (unlike registrations, which has an
-- open anon policy). Every legitimate access path here is one of the
-- security definer RPCs below — create/get/revoke gated by is_admin(),
-- check/redeem gated by the token itself, none of which need a table
-- policy to also allow direct .from('teacher_invites') access. RLS enabled
-- + zero policies means any such direct call fails closed.

-- ═════════════════════════════════════════════════════════════════════════
-- 2. create_teacher_invite() — admin-only, generates a new pending invite
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.create_teacher_invite()
returns public.teacher_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.teacher_invites;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can create a teacher invite.';
  end if;

  insert into public.teacher_invites (created_by)
  values (auth.uid()::text)
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.create_teacher_invite() to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. get_teacher_invites() — admin-only list, for the directory's
--    "Outstanding invites" panel (copy link again / see who used what).
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.get_teacher_invites()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can view teacher invites.';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'token',         ti.token,
          'createdAt',     ti.created_at,
          'expiresAt',     ti.expires_at,
          'status',        ti.status,
          'usedAt',        ti.used_at,
          'usedByName',    up.display_name,
          'createdByName', cp.display_name
        )
        order by ti.created_at desc
      )
      from public.teacher_invites ti
      left join public.profiles up on up.id = ti.used_by
      left join public.profiles cp on cp.id = ti.created_by
    ),
    '[]'::jsonb
  );
end;
$$;
grant execute on function public.get_teacher_invites() to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 4. revoke_teacher_invite() — admin-only, cancels a still-pending invite
--    (e.g. sent to the wrong person, or the hire fell through).
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.revoke_teacher_invite(p_token text)
returns public.teacher_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.teacher_invites;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can revoke a teacher invite.';
  end if;

  update public.teacher_invites
     set status = 'revoked'
   where token = p_token and status = 'pending'
  returning * into v_row;

  if v_row is null then
    raise exception 'Invite not found, or already used/revoked.';
  end if;

  return v_row;
end;
$$;
grant execute on function public.revoke_teacher_invite(text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 5. check_teacher_invite() — anon-callable (the visitor has no session
--    yet), validates a token BEFORE the signup form renders. Always returns
--    exactly one row (unlike a plain SELECT, which would return zero rows
--    for an unknown token) so the client can show a specific message either
--    way instead of guessing from an empty result.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.check_teacher_invite(p_token text)
returns table (valid boolean, reason text)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_invite public.teacher_invites;
begin
  select * into v_invite from public.teacher_invites where token = p_token;

  if v_invite is null then
    return query select false, 'not_found'::text;
    return;
  end if;
  if v_invite.status = 'used' then
    return query select false, 'used'::text;
    return;
  end if;
  if v_invite.status = 'revoked' then
    return query select false, 'revoked'::text;
    return;
  end if;
  if v_invite.expires_at <= now() then
    return query select false, 'expired'::text;
    return;
  end if;

  return query select true, null::text;
end;
$$;
grant execute on function public.check_teacher_invite(text) to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 6. redeem_teacher_invite() — the only place a brand-new account becomes
--    role='teacher' outside the SQL editor. Caller must already have a
--    real (freshly signed-up) Supabase Auth session — see step 4 of the
--    flow above — but that session has NO profile/role yet, so the gate
--    here is entirely the token, not anything about the caller.
--
--    Column list mirrors approve_registration()'s profiles insert exactly
--    (wave2_registration_security_fixes.sql) for consistency, with
--    class_id left null — teachers aren't tied to a single class_id the
--    way students are; their sections come from class_sections.adviser_id
--    (see get_teacher_directory(), Phase 35), set later via the section
--    assignment screens, not at account-creation time.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.redeem_teacher_invite(
  p_token      text,
  p_first_name text,
  p_last_name  text,
  p_color      text,
  p_init       text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite  public.teacher_invites;
  v_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to complete an invite.';
  end if;

  -- Row lock so two near-simultaneous redemption attempts of the same
  -- token (double-submit) can't both pass the pending/expiry check before
  -- either one updates status — mirrors the race-guard reasoning already
  -- used elsewhere in this app (see submit_registration()'s comment).
  select * into v_invite from public.teacher_invites where token = p_token for update;

  if v_invite is null then
    raise exception 'This invite link is invalid.';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'This invite link has already been used or was revoked.';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'This invite link has expired. Ask your admin for a new one.';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid()::text) then
    raise exception 'An account already exists for this login.';
  end if;

  insert into public.profiles (
    id, role, display_name, init, color, xp, coins, level, tier,
    attendance_pct, quiz_avg, first_name, last_name, class_id, join_date
  ) values (
    auth.uid()::text, 'teacher', trim(p_first_name) || ' ' || trim(p_last_name),
    p_init, p_color, 0, 0, 1, 'Novice', 0, 0,
    trim(p_first_name), trim(p_last_name), null, current_date
  )
  returning * into v_profile;

  update public.teacher_invites
     set status = 'used', used_at = now(), used_by = v_profile.id
   where token = p_token;

  return v_profile;
end;
$$;
grant execute on function public.redeem_teacher_invite(text, text, text, text, text) to authenticated;
