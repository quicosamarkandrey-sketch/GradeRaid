-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 67 — STUDENT NOTIFICATION SYSTEM
--
-- Run once in the Supabase SQL editor, after Phase 61.
--
-- WHAT THIS IS
--   A brand-new `notifications` table backing the topbar bell icon
--   (students only — teachers/admin are explicitly out of scope for this
--   phase). Rows are synthesized CLIENT-SIDE by notification-service.js,
--   one per point_log entry / order the student hasn't been notified about
--   yet (see that file's header comment for the full design). Every row is
--   always written by the affected student's own client, using their own
--   session — never by a teacher/admin session on a student's behalf — so
--   RLS can stay a simple "self" policy with no is_staff_for_section()
--   carve-out, unlike point_log/boss_participants.
--
-- LESSON APPLIED FROM PHASE 44–61 (see phase47's point_log section and the
-- Phase 61 quiz_history fix): db-service.js's bulk push re-sends the WHOLE
-- local array every sync cycle via `.upsert(rows, { onConflict: 'id' })`.
-- Any row that already exists server-side (e.g. one just marked `read`)
-- goes through the UPDATE path, not INSERT. Shipping an INSERT policy
-- without a matching UPDATE policy from the start would immediately hit the
-- exact same 42501 bug this project has now hit five separate times — so
-- both are added together here, not as a follow-up fix.
--
-- Safe to run multiple times — `create table if not exists`, `drop policy
-- if exists` before every `create policy`, and the realtime publication add
-- is wrapped the same duplicate_object-swallowing way phase19/phase8 use.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.notifications (
  id          text primary key,
  student_id  text not null references public.profiles(id),
  -- 'achievement' | 'title' | 'mail_reward' | 'quiz' | 'campaign' | 'boss' |
  -- 'points' | 'store' — see notification-service.js NOTIF_TYPES.
  type        text not null,
  icon        text,
  title       text not null,
  body        text,
  -- page id passed to navTo() when the notification is clicked, e.g. 's-badges'.
  action      text,
  -- optional +/- amount shown as a colored pill (XP/coins/points). Null for
  -- notifications that aren't about a point delta (e.g. a plain quiz-assigned ping).
  pts         integer,
  -- id of the source row this notification was synthesized from (a
  -- point_log id, an orders orderId, etc). Used purely client-side to avoid
  -- re-synthesizing the same notification twice; no FK since it can point at
  -- different tables depending on `type`.
  source_id   text,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_student_idx on public.notifications (student_id);
create index if not exists notifications_created_idx on public.notifications (created_at desc);
-- Speeds up the "does a notification already exist for this source row"
-- dedupe check notification-service.js runs on every sync.
create index if not exists notifications_source_idx on public.notifications (student_id, source_id);

alter table public.notifications enable row level security;

drop policy if exists notifications_self_select on public.notifications;
create policy notifications_self_select on public.notifications
  for select
  using (student_id = auth.uid()::text);

drop policy if exists notifications_self_insert on public.notifications;
create policy notifications_self_insert on public.notifications
  for insert
  with check (student_id = auth.uid()::text);

-- Needed for marking a notification (or all of them) read — same upsert
-- path the bulk push uses for every other synced table.
drop policy if exists notifications_self_update on public.notifications;
create policy notifications_self_update on public.notifications
  for update
  using (student_id = auth.uid()::text)
  with check (student_id = auth.uid()::text);

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.notifications';
  exception when duplicate_object then
    null;
  end;
end $$;
