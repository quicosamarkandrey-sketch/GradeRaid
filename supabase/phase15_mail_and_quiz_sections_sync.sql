-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 15 — MAIL cross-device sync, and QUIZ "assign to section(s)" picker
--
-- Run once in the Supabase SQL editor, after Phase 14
-- (phase14_section_isolation.sql — this file assumes mail_messages and
-- quiz_sections already exist, created there). Additive only:
--   • ALTERs mail_messages with new nullable columns (no data loss, no
--     existing row is touched since mail_messages has never been written to
--     by the app yet — see Phase 14's own note that this table was brand
--     new and unused).
--   • Adds RPCs. No existing policy is dropped or narrowed.
--
-- WHY THESE COLUMNS ARE NEEDED (mail_messages, as shipped in Phase 14, was
-- one row per single recipient with only subject/body/xp_reward/coin_reward/
-- read/claimed — the local app's mail object supports a lot more than that:
-- a single compose action fans out to many recipients but is shown/managed
-- as ONE item in the admin list, has a type/icon, and can carry a title
-- grant in addition to xp/coins):
--   • batch_id        — ties every per-recipient row from one compose action
--                        back together, so the admin UI can keep showing
--                        "one message → N recipients" instead of N separate
--                        rows.
--   • mail_type       — announcement/reward/gift/event/title/compensation/
--                        general, purely cosmetic (icon lookup), but the
--                        existing UI already persists and displays it.
--   • title_reward_id — mail can grant a title, not just xp/coins. Left as
--                        untyped text with no FK, same reasoning as
--                        achievement_sections in Phase 14 — the `titles`
--                        table doesn't have a Supabase-synced source of
--                        truth yet either (that is its own known gap,
--                        unrelated to this pass; unlocking a title from a
--                        claimed mail reward still happens exactly the way
--                        it already does today, client-side only).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.mail_messages add column if not exists batch_id       uuid;
alter table public.mail_messages add column if not exists mail_type      text default 'general';
alter table public.mail_messages add column if not exists title_reward_id text;

create index if not exists mail_messages_batch_idx     on public.mail_messages(batch_id);
create index if not exists mail_messages_recipient_idx on public.mail_messages(recipient_student_id);

-- ═════════════════════════════════════════════════════════════════════════
-- MAIL RPCs
--
-- Reward-granting model deliberately mirrors achievements (ach_engine.js's
-- achGrantRewardsForClaim), NOT the stricter loot_claims/apply_boss_damage
-- pattern: the client checks its own locally-cached claimed flag before
-- calling claim, then calls syncStudentStatsToServer() separately for the
-- actual xp/coins delta (that RPC already exists — adjust_student_stats,
-- phase9). mark_mail_claimed below only needs to persist the read/claimed
-- flags themselves. A rare cross-device double-claim race is the same
-- accepted risk this app already carries for achievement claims today —
-- not introduced by this file, and not worth a heavier atomic redesign for
-- a reward class (mail) with the same stakes as achievements, not loot.
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.send_mail(
  p_recipient_ids  text[],
  p_subject        text,
  p_body           text,
  p_mail_type      text default 'general',
  p_xp_reward      int  default 0,
  p_coin_reward    int  default 0,
  p_title_reward_id text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid := gen_random_uuid();
  v_rid      text;
  v_class_id text;
begin
  if p_recipient_ids is null or array_length(p_recipient_ids, 1) is null then
    raise exception 'at least one recipient is required';
  end if;
  if coalesce(trim(p_subject), '') = '' then
    raise exception 'subject is required';
  end if;

  -- Every recipient must belong to a section the caller is staff-for —
  -- stops a teacher mailing another teacher's students.
  foreach v_rid in array p_recipient_ids loop
    select class_id into v_class_id from public.profiles where id = v_rid;
    if v_class_id is null or not public.is_staff_for_section(v_class_id) then
      raise exception 'not authorized to mail student %', v_rid;
    end if;
  end loop;

  insert into public.mail_messages
    (batch_id, sender_teacher_id, recipient_student_id, subject, body,
     mail_type, xp_reward, coin_reward, title_reward_id)
  select v_batch_id, auth.uid()::text, x, p_subject, p_body,
         coalesce(p_mail_type, 'general'), coalesce(p_xp_reward, 0),
         coalesce(p_coin_reward, 0), p_title_reward_id
  from unnest(p_recipient_ids) as x;

  return v_batch_id;
end;
$$;
grant execute on function public.send_mail(text[], text, text, text, int, int, text) to anon, authenticated;

-- Edit: content only, NEVER read/claimed — those belong exclusively to the
-- recipient-side RPCs below.
create or replace function public.update_mail_batch(
  p_batch_id        uuid,
  p_subject         text,
  p_body            text,
  p_mail_type       text,
  p_xp_reward       int,
  p_coin_reward     int,
  p_title_reward_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mail_messages m
     set subject         = p_subject,
         body            = p_body,
         mail_type       = coalesce(p_mail_type, m.mail_type),
         xp_reward       = coalesce(p_xp_reward, 0),
         coin_reward     = coalesce(p_coin_reward, 0),
         title_reward_id = p_title_reward_id
   where m.batch_id = p_batch_id
     and exists (
       select 1 from public.profiles p
       where p.id = m.recipient_student_id and public.is_staff_for_section(p.class_id)
     );
end;
$$;
grant execute on function public.update_mail_batch(uuid, text, text, text, int, int, text) to anon, authenticated;

create or replace function public.delete_mail_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.mail_messages m
   where m.batch_id = p_batch_id
     and exists (
       select 1 from public.profiles p
       where p.id = m.recipient_student_id and public.is_staff_for_section(p.class_id)
     );
end;
$$;
grant execute on function public.delete_mail_batch(uuid) to anon, authenticated;

-- Recipient-side: restricted to the caller's OWN row, regardless of role.
create or replace function public.mark_mail_read(p_mail_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mail_messages
     set read = true
   where id = p_mail_id and recipient_student_id = auth.uid()::text;
end;
$$;
grant execute on function public.mark_mail_read(uuid) to anon, authenticated;

create or replace function public.mark_mail_claimed(p_mail_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mail_messages
     set claimed = true, read = true
   where id = p_mail_id and recipient_student_id = auth.uid()::text;
end;
$$;
grant execute on function public.mark_mail_claimed(uuid) to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- QUIZ SECTION ASSIGNMENT — one scoped RPC, not a bulk upsert
--
-- quiz_sections (table + RLS) already shipped in Phase 14. Deliberately NOT
-- wired through the generic bulk push in db-service.js: quizzes have no
-- owner concept (DB.quizzes is shared, global content, same as it's always
-- been), so a blanket "replace this quiz's section rows with whatever this
-- tab has cached" on every unrelated saveDB() call would risk exactly the
-- whole-roster clobber class of bug this project has fixed repeatedly
-- elsewhere (xp/coins, current_hp, stock) — one teacher's stale tab could
-- silently erase another teacher's section assignment for a quiz they
-- both use. This RPC instead only ever touches rows for the ONE quiz_id
-- passed in, and only ever deletes rows the caller themselves could have
-- created (is_staff_for_section on the row's own class_id), so two
-- teachers assigning the same shared quiz to their own different sections
-- can never stomp on each other.
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.set_quiz_sections(p_quiz_id text, p_class_ids text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class_id text;
begin
  if p_quiz_id is null or trim(p_quiz_id) = '' then
    raise exception 'quiz id is required';
  end if;

  foreach v_class_id in array coalesce(p_class_ids, array[]::text[]) loop
    if not public.is_staff_for_section(v_class_id) then
      raise exception 'not authorized for section %', v_class_id;
    end if;
  end loop;

  delete from public.quiz_sections qs
   where qs.quiz_id = p_quiz_id
     and public.is_staff_for_section(qs.class_id);

  insert into public.quiz_sections (quiz_id, class_id)
  select p_quiz_id, x from unnest(coalesce(p_class_ids, array[]::text[])) as x
  on conflict (quiz_id, class_id) do nothing;
end;
$$;
grant execute on function public.set_quiz_sections(text, text[]) to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- REALTIME — same gap/fix shape as phase8_attendance_realtime.sql. Without
-- this, db-service.js's postgres_changes listener (updated in this pass to
-- also listen on these two tables) would silently never fire for them.
-- ═════════════════════════════════════════════════════════════════════════

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.mail_messages';
  exception when duplicate_object then
    null;
  end;
end $$;

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.quiz_sections';
  exception when duplicate_object then
    null;
  end;
end $$;
