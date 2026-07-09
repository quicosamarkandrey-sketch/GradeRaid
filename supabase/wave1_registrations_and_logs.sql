-- ─────────────────────────────────────────────────────────────────────────────
-- WAVE 1 MIGRATION — registrations, point_log, redemptions, recitation_log
--
-- Run this once in the Supabase SQL editor (or `supabase db execute`) against
-- the project already referenced in index.html
-- (window.__EDUQUEST_SUPABASE_URL__).
--
-- WHY THESE FOUR FIRST
--   These are the highest-risk fields still on localStorage-only:
--     • registrations  — pending student signups. Lost on a cleared browser,
--       a student literally has to re-register and re-explain themselves.
--     • point_log / redemptions / recitation_log — history that drives
--       leaderboards, "why does this student have these coins" audits, and
--       parent/admin questions. Losing it doesn't break the app, but it
--       erodes trust in the numbers.
--
-- RLS STATUS — INTENTIONALLY OPEN, MATCHING EXISTING TABLES
--   profiles / boss_events / etc. currently have no RLS (anon key can read
--   everything). These four tables follow the same model for consistency —
--   NOT because it's correct, but because turning on RLS here while every
--   other table stays open doesn't actually protect anything, and would
--   silently break write paths (the client has no real per-user Supabase
--   Auth session yet — see db-service.js [BLOCKER-AUTH] note). Real RLS
--   across ALL tables, gated on real Supabase Auth sessions, is its own
--   follow-up — do not consider this file "secure" once it's run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── registrations ─────────────────────────────────────────────────────────
-- Mirrors DB.registrations[] exactly. `id` stays a client-generated text key
-- ('reg_' + uid()) instead of a server uuid, because admin code already
-- looks records up by that id (regAdminApprove, regAdminConfirmReject, etc.)
-- and there's no round-trip moment where the client would learn a
-- server-assigned id otherwise (unlike boss_events, which re-pulls on every
-- realtime change).
create table if not exists public.registrations (
  id                  text primary key,
  first_name          text not null,
  last_name           text not null,
  username            text not null unique,
  email               text not null unique,
  student_id_text     text,           -- the school-issued ID *string* the student typed in; unrelated to profiles.id
  grade_level         text,
  section             text,
  pass                text not null, -- plaintext, same caveat as profiles.pass — see [BLOCKER-AUTH]
  status              text not null default 'pending' check (status in ('pending','approved','rejected')),
  submitted_at        timestamptz not null default now(),
  reviewed_at         timestamptz,
  reviewed_by         text,
  rejection_reason    text,
  approved_student_id text references public.profiles(id)
);

create index if not exists registrations_status_idx on public.registrations (status);

alter table public.registrations enable row level security;
create policy registrations_anon_all on public.registrations
  for all using (true) with check (true);

-- ── point_log ──────────────────────────────────────────────────────────────
-- Append-only. `id` is now generated client-side at creation time (see the
-- nine call-site edits in modules/*) specifically so repeated pushes of the
-- whole array can upsert by id instead of blind-inserting duplicates.
create table if not exists public.point_log (
  id          text primary key,
  student_id  text not null references public.profiles(id),
  what        text not null,
  pts         integer not null,
  when_label  text,           -- legacy cosmetic string ("Just now", "Yesterday") — display only, NOT for sorting
  created_at  timestamptz not null default now()  -- use this for real chronological ordering
);

create index if not exists point_log_student_idx on public.point_log (student_id);
create index if not exists point_log_created_idx on public.point_log (created_at desc);

alter table public.point_log enable row level security;
create policy point_log_anon_all on public.point_log
  for all using (true) with check (true);

-- ── redemptions ────────────────────────────────────────────────────────────
-- order_id is already generated uniquely client-side at purchase time
-- (shop_store.js: 'ORD-' + Date.now()... + '-' + q), so it's reused directly
-- as the primary key — no extra id needed.
create table if not exists public.redemptions (
  order_id    text primary key,
  student_id  text not null references public.profiles(id),
  item_id     text,
  item_name   text,
  emoji       text,
  item_label  text,      -- the "emoji name" combined display string (DB.redemptions[].item)
  pts         integer not null,
  date_label  text,
  time_label  text,
  claim_code  text,
  created_at  timestamptz not null default now()
);

create index if not exists redemptions_student_idx on public.redemptions (student_id);

alter table public.redemptions enable row level security;
create policy redemptions_anon_all on public.redemptions
  for all using (true) with check (true);

-- ── recitation_log ─────────────────────────────────────────────────────────
create table if not exists public.recitation_log (
  id          text primary key,
  student_id  text not null references public.profiles(id),
  pts         integer not null,
  note        text,
  when_label  text,
  created_at  timestamptz not null default now()
);

create index if not exists recitation_log_student_idx on public.recitation_log (student_id);

alter table public.recitation_log enable row level security;
create policy recitation_log_anon_all on public.recitation_log
  for all using (true) with check (true);
