-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 69 — SYSTEM HEALTH PANEL (Chunk 1: DATA LAYER)
--
-- Run once in the Supabase SQL editor, after Phase 68.
-- Backs the new admin-only "System Health" page. See ADMIN_SYSTEM_HEALTH.md
-- (added alongside this migration) for the full phase plan — this file is
-- Phase 1 of 4: schema + RPCs only. No client code calls any of this yet.
--
-- SCOPE DECISIONS (confirmed before building)
--   - Presence is HEARTBEAT-based, not a live Realtime Presence channel.
--     A `last_seen_at` timestamp on `profiles`, refreshed periodically by
--     the client while a tab is open (Chunk 2 wires the actual interval).
--     "Online" = last_seen_at within the last 2 minutes. This trades a
--     little lag for zero new socket/channel infrastructure — consistent
--     with command-center.js's own note that a real presence feature
--     "would need its own realtime channel — out of scope" until now, and
--     even now we're deliberately taking the cheaper of the two options
--     discussed rather than standing up Realtime Presence.
--   - Client error logs are narrow: message/stack/source/user_agent/url,
--     a `resolved` flag for triage, nothing fancier (no severity levels,
--     no grouping/fingerprinting) in v1. Same "don't extend scope without
--     deciding" posture as audit_log (see phase40).
--   - Both new RPCs that WRITE (touch_presence, log_client_error) are
--     intentionally open to any authenticated caller (and log_client_error
--     to anon too, since a login-screen JS error has no session yet) —
--     they only ever touch/insert the caller's OWN activity, never anyone
--     else's. Both READ RPCs (get_admin_user_counts, get_client_error_logs,
--     resolve_client_error_log) are admin-gated via is_admin(), same as
--     get_audit_log().
--
-- WHAT THIS ADDS
--   1. profiles.last_seen_at column + touch_presence() (write, any caller,
--      own row only) — the heartbeat.
--   2. get_admin_user_counts() (read, admin-only) — total users by role
--      + how many are currently "online" per the 2-minute window above.
--   3. client_error_logs table + log_client_error() (write, anon/
--      authenticated) + get_client_error_logs() (read, admin-only) +
--      resolve_client_error_log() (write, admin-only) — RPC-only access,
--      same "revoke all, RPC or nothing" pattern as audit_log.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. PRESENCE HEARTBEAT
-- ═════════════════════════════════════════════════════════════════════════

alter table public.profiles add column if not exists last_seen_at timestamptz;

create index if not exists profiles_last_seen_at_idx on public.profiles (last_seen_at desc);

-- touch_presence(): called periodically by any logged-in client (Chunk 2
-- wires the interval) to mark "I'm still here". Always writes the caller's
-- OWN row only — auth.uid() is never trusted from a parameter, there isn't
-- one. Silently no-ops (returns null) if called with no session, rather
-- than raising, since a stray call during logout/token-refresh shouldn't
-- surface as an error to the user.
create or replace function public.touch_presence()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  if auth.uid() is null then
    return null;
  end if;

  update public.profiles
     set last_seen_at = v_now
   where id = auth.uid()::text;

  return v_now;
end;
$$;
grant execute on function public.touch_presence() to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. ADMIN USER COUNTS
-- ═════════════════════════════════════════════════════════════════════════

-- get_admin_user_counts(): admin-only. Single-row summary — total accounts
-- per role, plus how many across ALL roles have pinged touch_presence()
-- within the last 2 minutes. Threshold is hardcoded rather than a param —
-- keeping the "online" definition consistent everywhere it's shown matters
-- more than making it configurable for a v1 that has no caller yet anyway.
create or replace function public.get_admin_user_counts()
returns table (
  total_users     bigint,
  total_admins    bigint,
  total_teachers  bigint,
  total_students  bigint,
  online_now      bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized to read system health counts';
  end if;

  return query
    select
      count(*)                                                            as total_users,
      count(*) filter (where role = 'admin')                              as total_admins,
      count(*) filter (where role = 'teacher')                            as total_teachers,
      count(*) filter (where role = 'student')                            as total_students,
      count(*) filter (where last_seen_at > now() - interval '2 minutes') as online_now
    from public.profiles;
end;
$$;
grant execute on function public.get_admin_user_counts() to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. CLIENT ERROR LOGS
-- ═════════════════════════════════════════════════════════════════════════

create table if not exists public.client_error_logs (
  id          text primary key,        -- 'cerr_' || generated random suffix
  user_id     text references public.profiles(id) on delete set null, -- nullable — a
                                        -- pre-login screen (e.g. the login page
                                        -- itself) has no session yet
  role        text,                    -- denormalized at time of error — role
                                        -- can change later, this shouldn't drift
  message     text not null,
  stack       text,
  source      text,                    -- e.g. a nav id like 's-quizzes', or
                                        -- 'onerror' / 'unhandledrejection'
  user_agent  text,
  url         text,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists client_error_logs_created_at_idx on public.client_error_logs (created_at desc);
create index if not exists client_error_logs_resolved_idx   on public.client_error_logs (resolved);

alter table public.client_error_logs enable row level security;
-- Same posture as audit_log: no select/insert policies at all. Every access
-- goes through the three RPCs below.
revoke all on public.client_error_logs from anon, authenticated;

-- log_client_error(): the write side. Deliberately open to anon AND
-- authenticated — an error on the login screen happens before any session
-- exists, and that's exactly the kind of error you still want to see. Role
-- is looked up server-side from profiles when a session IS present, never
-- trusted from the client.
create or replace function public.log_client_error(
  p_message    text,
  p_stack      text default null,
  p_source     text default null,
  p_user_agent text default null,
  p_url        text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   text;
  v_uid  text := auth.uid()::text;
  v_role text;
begin
  if p_message is null or length(trim(p_message)) = 0 then
    -- Silently drop rather than raise — a logging call failing loudly would
    -- itself be a second error to report, which defeats the purpose.
    return;
  end if;

  if v_uid is not null then
    select role into v_role from public.profiles where id = v_uid;
  end if;

  v_id := 'cerr_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);

  insert into public.client_error_logs
    (id, user_id, role, message, stack, source, user_agent, url)
  values
    (v_id, v_uid, v_role, left(p_message, 2000), left(p_stack, 8000), p_source, p_user_agent, p_url);
exception when others then
  -- Never let a logging failure propagate to the caller (which is itself
  -- inside an error handler — see Chunk 2's global window.onerror hook).
  return;
end;
$$;
grant execute on function
  public.log_client_error(text, text, text, text, text)
to anon, authenticated;

-- get_client_error_logs(): admin-only read, optionally filtered.
create or replace function public.get_client_error_logs(
  p_resolved boolean default null,
  p_role     text    default null,
  p_limit    int     default 200
)
returns setof public.client_error_logs
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized to read client error logs';
  end if;

  return query
    select * from public.client_error_logs
     where (p_resolved is null or resolved = p_resolved)
       and (p_role is null or role = p_role)
     order by created_at desc
     limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;
grant execute on function public.get_client_error_logs(boolean, text, int) to anon, authenticated;

-- resolve_client_error_log(): admin-only write — toggles the triage flag.
create or replace function public.resolve_client_error_log(
  p_id       text,
  p_resolved boolean default true
)
returns public.client_error_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.client_error_logs;
begin
  if not public.is_admin() then
    raise exception 'not authorized to update client error logs';
  end if;

  update public.client_error_logs
     set resolved = p_resolved
   where id = p_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'client error log not found: %', p_id;
  end if;

  return v_row;
end;
$$;
grant execute on function public.resolve_client_error_log(text, boolean) to anon, authenticated;
