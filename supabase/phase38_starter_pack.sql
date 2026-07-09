-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 38 — STARTER PACK: seed_new_teacher() + the template editor's RPCs
-- (see ISOLATION_ROLES_PLAN.md §6 "Starter pack — the mechanism", §7 "draft
--  content", §11 "Starter-template editor", §12 step 5, chunk B)
--
-- Run once in the Supabase SQL editor, after Phase 37.
--
-- WHAT THIS CLOSES
--   §6 describes seed_new_teacher() as a one-time copy from a fixed set of
--   "is_starter_template = true" rows, owned by a reserved template
--   pseudo-account, into a brand new teacher's own catalog rows with fresh
--   ids. None of that existed yet: no flag column, no template account, no
--   seeded content, no RPC, and no way to maintain the template set short of
--   editing this file by hand forever (the exact thing §11 flags as the
--   problem with freezing it in a migration).
--
-- SCOPE NOTE — 5 tables, not 4
--   §6's prose says "achievements/titles/quizzes/campaign worlds" (four
--   tables) but §7's draft content explicitly includes 5 shop items too,
--   and shop_products already has the identical owner_teacher_id shape
--   (Phase 14) the other four just gained (Phase 32). Treating this as a
--   drafting gap rather than a deliberate exclusion — shop items get the
--   same is_starter_template treatment as the other four, so the starter
--   pack a new teacher receives actually matches what §7 describes.
--
-- THE TEMPLATE ACCOUNT
--   A real profiles row is required — every catalog table's owner_teacher_id
--   is `references public.profiles(id)`, so template rows need something to
--   point at. Using a fixed, well-known id rather than gen_random_uuid() so
--   this migration is re-runnable and every RPC below can find it by
--   constant instead of a lookup. It is NOT a real login: nothing in
--   Supabase Auth has this id, so nobody can ever authenticate as it — the
--   only way to reach it is through the SECURITY DEFINER functions below,
--   which bypass RLS entirely. role = 'template' (not 'admin'/'teacher'/
--   'student') so it's automatically excluded from every existing
--   role-in-('admin','teacher') check (is_staff(), is_admin(),
--   get_teacher_directory(), etc.) with zero changes needed to any of them.
--
-- WHY TEMPLATE ROWS ARE INVISIBLE TO REGULAR TEACHER SESSIONS ALREADY
--   achievements_select_scoped (and the equivalent policy on the other four
--   tables) reads: `is_same_staff_or_admin(owner_teacher_id) OR exists(...
--   adviser_id = owner_teacher_id)`. For a real teacher session neither
--   branch is true for the template account's id, so RLS already hides these
--   rows from every teacher — no policy changes needed here. The one
--   session that CAN see them is an admin session, because
--   is_same_staff_or_admin()'s admin branch bypasses the owner check for
--   every row regardless of who owns it. That's actually exactly what's
--   needed for the admin-only template editor's reads/writes to work with
--   zero new RLS — the only gap was the client-side db-service.js pull
--   never filtering is_starter_template out of the ordinary catalog arrays,
--   so an admin session's regular Achievement/Titles/Quiz/Campaign/Shop
--   screens would otherwise show template rows mixed in with real content.
--   That JS-side filter is a separate, non-SQL change made alongside this
--   migration (db-service.js's four catalog pulls + shop pull).
--
-- WHAT'S NOT IN THIS FILE
--   - Section-scoping for the starter pack itself — not applicable, it's
--     never assigned to a section; it only ever exists as an admin-visible
--     template until copied.
--   - A full-fidelity title cosmetic editor (gradients/animations/particles/
--     custom CSS) — the editor RPC below covers the core fields
--     (name/description/icon/rarity/active + the four basic color fields);
--     the rest stay editable only by a teacher on their OWN copy after
--     seeding, same as today. Flagged here as a deliberate v1 scope choice,
--     not an oversight.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 0. Add 'template' to the app_role enum
-- ─────────────────────────────────────────────────────────────────────────
-- MUST BE RUN AS ITS OWN QUERY, SEPARATELY, BEFORE THE REST OF THIS FILE.
-- Postgres will not let a newly-added enum value be used in the same
-- transaction that added it. The Supabase SQL editor runs everything you
-- paste as one implicit transaction, so:
--   1) Select just the one line below, run it, let it commit.
--   2) Then select and run everything from here down (or the whole file).
-- Running the whole file in a single paste will hit the same
-- "invalid input value for enum app_role" error again on the profiles insert.
-- ═════════════════════════════════════════════════════════════════════════
alter type public.app_role add value if not exists 'template';

-- ═════════════════════════════════════════════════════════════════════════
-- 1. is_starter_template flag on all 5 catalog tables
-- ═════════════════════════════════════════════════════════════════════════
alter table public.achievements    add column if not exists is_starter_template boolean not null default false;
alter table public.titles          add column if not exists is_starter_template boolean not null default false;
alter table public.quizzes         add column if not exists is_starter_template boolean not null default false;
alter table public.campaign_worlds add column if not exists is_starter_template boolean not null default false;
alter table public.shop_products   add column if not exists is_starter_template boolean not null default false;

create index if not exists achievements_starter_idx    on public.achievements    (is_starter_template) where is_starter_template;
create index if not exists titles_starter_idx          on public.titles          (is_starter_template) where is_starter_template;
create index if not exists quizzes_starter_idx         on public.quizzes         (is_starter_template) where is_starter_template;
create index if not exists campaign_worlds_starter_idx on public.campaign_worlds (is_starter_template) where is_starter_template;
create index if not exists shop_products_starter_idx   on public.shop_products   (is_starter_template) where is_starter_template;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. Template pseudo-account + a helper so the constant lives in one place
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.starter_template_owner_id()
returns text
language sql
immutable
as $$
  select '00000000-0000-0000-0000-000000000000'::text;
$$;

insert into public.profiles (
  id, role, display_name, init, color, xp, coins, level, tier,
  attendance_pct, quiz_avg, first_name, last_name, join_date, is_active
) values (
  public.starter_template_owner_id(), 'template', 'Starter Pack Template',
  'SP', '#8b5cf6', 0, 0, 1, 'Novice', 0, 0, 'Starter', 'Pack', current_date, false
)
on conflict (id) do nothing;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. Seed content (§7's draft, as agreed — deterministic ids so this block
--    is safely re-runnable; ON CONFLICT DO NOTHING means re-running this
--    file never duplicates or resets anything an admin has since edited via
--    the template editor below).
-- ═════════════════════════════════════════════════════════════════════════

-- Achievements (12) — real trigger types from ach_engine.js's ACH_TRIGGER_TYPES,
-- nothing decorative. "Top of the Class" uses top_rank=1 (live rank only —
-- see §7's honesty note on why this isn't weekly/monthly).
insert into public.achievements (
  id, owner_teacher_id, is_starter_template, name, description, icon, category,
  rarity, xp_reward, coin_reward, trigger_type, trigger_value, active
) values
  ('starter-ach-01', public.starter_template_owner_id(), true, 'Rising Voice', 'Recite in class 5 times.', '🎤', 'Participation', 'Common',    30, 15, 'recitations',       5,  true),
  ('starter-ach-02', public.starter_template_owner_id(), true, 'Vocal Contributor', 'Recite in class 10 times.', '🗣️', 'Participation', 'Uncommon', 60, 30, 'recitations',       10, true),
  ('starter-ach-03', public.starter_template_owner_id(), true, 'Recitation Master', 'Recite in class 15 times.', '🎙️', 'Participation', 'Rare',      100, 50, 'recitations',      15, true),
  ('starter-ach-04', public.starter_template_owner_id(), true, 'Attendance Starter', 'Be present for 5 sessions.', '📅', 'Attendance', 'Common',    30, 15, 'attendance_present', 5,  true),
  ('starter-ach-05', public.starter_template_owner_id(), true, 'Reliable Presence', 'Be present for 10 sessions.', '✅', 'Attendance', 'Uncommon',  60, 30, 'attendance_present', 10, true),
  ('starter-ach-06', public.starter_template_owner_id(), true, 'Attendance Champion', 'Be present for 15 sessions.', '🏅', 'Attendance', 'Rare',    100, 50, 'attendance_present', 15, true),
  ('starter-ach-07', public.starter_template_owner_id(), true, 'Top of the Class', 'Reach rank #1 on the leaderboard.', '👑', 'Leaderboard', 'Legendary', 150, 75, 'top_rank', 1, true),
  ('starter-ach-08', public.starter_template_owner_id(), true, 'First Quest', 'Complete your first quest.', '🎯', 'Quests', 'Common',        20, 10, 'quests_completed', 1,  true),
  ('starter-ach-09', public.starter_template_owner_id(), true, 'Quest Grinder', 'Complete 10 quests.', '⚔️', 'Quests', 'Uncommon',            80, 40, 'quests_completed', 10, true),
  ('starter-ach-10', public.starter_template_owner_id(), true, 'Perfect Score', 'Score 100% on a quiz.', '💯', 'Academics', 'Rare',           100, 50, 'quiz_score', 100, true),
  ('starter-ach-11', public.starter_template_owner_id(), true, 'Level 5 Milestone', 'Reach level 5.', '⭐', 'Progression', 'Common',           30, 15, 'level', 5, true),
  ('starter-ach-12', public.starter_template_owner_id(), true, 'Boss Slayer', 'Defeat a World Boss.', '🐉', 'Boss Battles', 'Rare',            100, 50, 'boss_victories', 1, true)
on conflict (id) do nothing;

-- Titles (8) — manual-grant class-officer roles (achievement_id left null on
-- purpose; see titles_admin_page.js's "Granted by teacher" display for a
-- null achievementId). Cosmetic fields left at a simple, consistent default
-- for the teacher to restyle after copying — see the v1 scope note above.
insert into public.titles (
  id, owner_teacher_id, is_starter_template, name, description, icon, rarity,
  active, achievement_id, text_color, border_color, glow_color, bg_color
) values
  ('starter-title-01', public.starter_template_owner_id(), true, 'President',       'Class President.',       '🎖️', 'Legendary', true, null, '#fbbf24', '#f59e0b', 'rgba(251,191,36,0.3)', 'rgba(251,191,36,0.08)'),
  ('starter-title-02', public.starter_template_owner_id(), true, 'Vice President',  'Class Vice President.',  '🎖️', 'Epic',      true, null, '#a78bfa', '#8b5cf6', 'rgba(167,139,250,0.3)', 'rgba(167,139,250,0.08)'),
  ('starter-title-03', public.starter_template_owner_id(), true, 'Secretary',       'Class Secretary.',       '📝', 'Rare',      true, null, '#60a5fa', '#3b82f6', 'rgba(96,165,250,0.3)', 'rgba(96,165,250,0.08)'),
  ('starter-title-04', public.starter_template_owner_id(), true, 'Treasurer',       'Class Treasurer.',       '💰', 'Rare',      true, null, '#4ade80', '#22c55e', 'rgba(74,222,128,0.3)', 'rgba(74,222,128,0.08)'),
  ('starter-title-05', public.starter_template_owner_id(), true, 'Auditor',         'Class Auditor.',         '🔍', 'Uncommon',  true, null, '#38bdf8', '#0ea5e9', 'rgba(56,189,248,0.3)', 'rgba(56,189,248,0.08)'),
  ('starter-title-06', public.starter_template_owner_id(), true, 'P.I.O.',          'Public Information Officer.', '📢', 'Uncommon', true, null, '#f472b6', '#ec4899', 'rgba(244,114,182,0.3)', 'rgba(244,114,182,0.08)'),
  ('starter-title-07', public.starter_template_owner_id(), true, 'Muse',            'Class Muse.',            '🎨', 'Uncommon',  true, null, '#c084fc', '#a855f7', 'rgba(192,132,252,0.3)', 'rgba(192,132,252,0.08)'),
  ('starter-title-08', public.starter_template_owner_id(), true, 'Escort',          'Class Escort.',          '🛡️', 'Common',    true, null, '#94a3b8', '#64748b', 'rgba(148,163,184,0.3)', 'rgba(148,163,184,0.08)')
on conflict (id) do nothing;

-- Quiz (1 sample) — a short, clearly-placeholder warm-up. Question shape
-- matches quiz-builder.js exactly: {q, opts:[4 strings], answer: index}.
insert into public.quizzes (
  id, owner_teacher_id, is_starter_template, title, description, xp_reward,
  coin_reward, time_limit, questions, active
) values (
  'starter-quiz-01', public.starter_template_owner_id(), true, 'Getting Started',
  'A short warm-up quiz — edit or delete this and replace it with your own content.',
  20, 10, 5,
  '[
    {"q": "What is 2 + 2?", "opts": ["3", "4", "5", "6"], "answer": 1},
    {"q": "What color do you get by mixing blue and yellow?", "opts": ["Purple", "Orange", "Green", "Red"], "answer": 2},
    {"q": "How many days are there in a week?", "opts": ["5", "6", "7", "8"], "answer": 2}
  ]'::jsonb,
  true
)
on conflict (id) do nothing;

-- Campaign world (1 sample) — one tutorial stage: intro narrator scene → one
-- enemy with 2 generic questions → victory scene. Stage/scene/enemy shape
-- matches campaign_admin_map_editor.js's adminAddStage() default exactly.
insert into public.campaign_worlds (
  id, owner_teacher_id, is_starter_template, label, icon, color, description,
  stages, sort_order, active
) values (
  'starter-world-01', public.starter_template_owner_id(), true,
  'World 1: The First Steps', '🗺️', '#8b5cf6',
  'A tutorial world — edit or delete this and replace it with your own campaign.',
  '[
    {
      "id": "starter-stage-01", "title": "The First Steps", "icon": "⭐",
      "type": "normal", "xp": 100, "coins": 50, "lives": 3,
      "scenes": [
        {"type": "story", "speaker": "NARRATOR", "text": "Your adventure begins here...", "bg": "#1a0a2e"}
      ],
      "enemies": [
        {
          "sprite": "👹", "name": "Practice Foe", "title": "ENEMY ENCOUNTER",
          "questions": [
            {"q": "What is 3 + 5?", "opts": ["7", "8", "9", "10"], "answer": 1},
            {"q": "What is the opposite of \"up\"?", "opts": ["Down", "Left", "Right", "Sideways"], "answer": 0}
          ]
        }
      ],
      "outro": [
        {"type": "story", "speaker": "NARRATOR", "text": "Victory! On to the next challenge.", "bg": "#0e1a0e"}
      ]
    }
  ]'::jsonb,
  0, true
)
on conflict (id) do nothing;

-- Shop items (5, per §7 "my call as agreed"). stock left null (= unlimited)
-- on the template row itself — meaningless until copied; see seed_new_teacher()
-- below for what a fresh copy actually gets.
insert into public.shop_products (
  id, owner_teacher_id, is_starter_template, name, emoji, description, category, cost, active
) values
  ('starter-shop-01', public.starter_template_owner_id(), true, 'Homework Pass',              '📄', 'Skip one homework assignment.',            'Passes',   100, true),
  ('starter-shop-02', public.starter_template_owner_id(), true, 'Class Treat',                 '🍬', 'A small treat for the class.',              'Treats',   50,  true),
  ('starter-shop-03', public.starter_template_owner_id(), true, 'Seat of Choice (for a day)',  '🪑', 'Pick your seat for one day.',               'Privileges', 75, true),
  ('starter-shop-04', public.starter_template_owner_id(), true, 'Extra 5 Minutes (next quiz)', '⏱️', '5 extra minutes on your next quiz.',        'Academics', 80, true),
  ('starter-shop-05', public.starter_template_owner_id(), true, 'Bonus XP Booster (+10%)',     '⚡', '+10% XP on your next quest.',                'Boosts',   120, true)
on conflict (id) do nothing;

-- ═════════════════════════════════════════════════════════════════════════
-- 4. seed_new_teacher() — the one-time copy (§6)
--
--    Achievements are copied first into a temp id-remap table so titles'
--    achievement_id can be correctly repointed at the NEW copies rather than
--    the template's original ids — none of today's 8 starter titles are
--    achievement-linked (all manual-grant, achievement_id null), but a
--    future template edit via the editor below could add one, and this
--    handles that correctly rather than silently leaving a dangling
--    reference to a template-only id the new teacher can never see.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.seed_new_teacher(p_new_teacher_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_existing_count int;
begin
  select role into v_role from public.profiles where id = p_new_teacher_id;
  if v_role is null then
    raise exception 'No profile exists for %.', p_new_teacher_id;
  end if;
  if v_role not in ('teacher', 'admin') then
    raise exception 'Starter pack seeding only applies to teacher/admin accounts.';
  end if;

  -- Guard: this is meant to run exactly once, right after account creation.
  -- If the target already owns ANY catalog content, treat this as already
  -- seeded (or a real teacher with real content) and refuse, rather than
  -- silently piling a second starter pack on top.
  select
      (select count(*) from public.achievements    where owner_teacher_id = p_new_teacher_id)
    + (select count(*) from public.titles          where owner_teacher_id = p_new_teacher_id)
    + (select count(*) from public.quizzes         where owner_teacher_id = p_new_teacher_id)
    + (select count(*) from public.campaign_worlds where owner_teacher_id = p_new_teacher_id)
    + (select count(*) from public.shop_products   where owner_teacher_id = p_new_teacher_id)
  into v_existing_count;

  if v_existing_count > 0 then
    raise exception 'This account already owns content — starter pack seeding is one-time-only for brand new accounts.';
  end if;

  create temporary table _seed_ach_map (old_id text primary key, new_id text not null) on commit drop;

  insert into _seed_ach_map (old_id, new_id)
  select id, gen_random_uuid()::text from public.achievements where is_starter_template;

  insert into public.achievements (
    id, owner_teacher_id, is_starter_template, name, description, icon, category,
    rarity, xp_reward, coin_reward, trigger_type, trigger_value, active
  )
  select m.new_id, p_new_teacher_id, false, a.name, a.description, a.icon, a.category,
         a.rarity, a.xp_reward, a.coin_reward, a.trigger_type, a.trigger_value, a.active
  from public.achievements a
  join _seed_ach_map m on m.old_id = a.id;

  insert into public.titles (
    id, owner_teacher_id, is_starter_template, name, description, icon, rarity,
    active, achievement_id, text_color, border_color, glow_color, bg_color,
    primary_color, secondary_color, gradient_from, gradient_to, border_style,
    animation, particles, bg_effect, custom_border_css, custom_animation_css, custom_bg_css
  )
  select gen_random_uuid()::text, p_new_teacher_id, false, t.name, t.description, t.icon, t.rarity,
         t.active, m.new_id, -- null passes straight through via the left join below when t.achievement_id is null
         t.text_color, t.border_color, t.glow_color, t.bg_color,
         t.primary_color, t.secondary_color, t.gradient_from, t.gradient_to, t.border_style,
         t.animation, t.particles, t.bg_effect, t.custom_border_css, t.custom_animation_css, t.custom_bg_css
  from public.titles t
  left join _seed_ach_map m on m.old_id = t.achievement_id
  where t.is_starter_template;

  insert into public.quizzes (
    id, owner_teacher_id, is_starter_template, title, description, xp_reward,
    coin_reward, time_limit, questions, active
  )
  select gen_random_uuid()::text, p_new_teacher_id, false, q.title, q.description,
         q.xp_reward, q.coin_reward, q.time_limit, q.questions, q.active
  from public.quizzes q
  where q.is_starter_template;

  insert into public.campaign_worlds (
    id, owner_teacher_id, is_starter_template, label, icon, color, description,
    stages, sort_order, active
  )
  select gen_random_uuid()::text, p_new_teacher_id, false, w.label, w.icon, w.color,
         w.description, w.stages, w.sort_order, w.active
  from public.campaign_worlds w
  where w.is_starter_template;

  -- Shop items get a real starting stock on the new teacher's copy (null =
  -- unlimited) rather than inheriting whatever the template row happens to
  -- have — the template's stock value is never meaningful, only its
  -- name/price/description are.
  insert into public.shop_products (
    id, owner_teacher_id, is_starter_template, name, emoji, description, category, cost, stock, active
  )
  select gen_random_uuid()::text, p_new_teacher_id, false, sp.name, sp.emoji, sp.description,
         sp.category, sp.cost, null, sp.active
  from public.shop_products sp
  where sp.is_starter_template;
end;
$$;
grant execute on function public.seed_new_teacher(text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 5. redeem_teacher_invite() — re-created to call seed_new_teacher() right
--    after the new profile is created, in the SAME transaction (atomic: a
--    seeding failure rolls back the whole redemption instead of leaving a
--    real teacher account with no starter content and no way to retry,
--    since seed_new_teacher()'s own guard above refuses a second run once
--    ANY content exists — including a partial one that somehow committed).
--    Everything else in this function is byte-for-byte identical to
--    phase37_teacher_invites.sql's version.
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

  -- Phase 38: give the brand new teacher their starter pack.
  perform public.seed_new_teacher(v_profile.id);

  return v_profile;
end;
$$;
grant execute on function public.redeem_teacher_invite(text, text, text, text, text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 6. get_starter_pack() — admin-only read, backing the new Starter Pack
--    Editor screen (§11). Bundles all 5 tables' template rows in one call,
--    same "one jsonb blob" shape get_teacher_directory()/get_teacher_invites()
--    already use.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.get_starter_pack()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can view the starter pack.';
  end if;

  return jsonb_build_object(
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'description', a.description, 'icon', a.icon,
        'category', a.category, 'rarity', a.rarity, 'xpReward', a.xp_reward,
        'coinReward', a.coin_reward, 'triggerType', a.trigger_type,
        'triggerValue', a.trigger_value, 'active', a.active
      ) order by a.name)
      from public.achievements a where a.is_starter_template
    ), '[]'::jsonb),
    'titles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'description', t.description, 'icon', t.icon,
        'rarity', t.rarity, 'active', t.active,
        'textColor', t.text_color, 'borderColor', t.border_color,
        'glowColor', t.glow_color, 'bgColor', t.bg_color
      ) order by t.name)
      from public.titles t where t.is_starter_template
    ), '[]'::jsonb),
    'quizzes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'title', q.title, 'description', q.description,
        'xpReward', q.xp_reward, 'coinReward', q.coin_reward,
        'timeLimit', q.time_limit, 'questions', q.questions, 'active', q.active
      ) order by q.title)
      from public.quizzes q where q.is_starter_template
    ), '[]'::jsonb),
    'campaignWorlds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'label', w.label, 'icon', w.icon, 'color', w.color,
        'description', w.description, 'stages', w.stages, 'active', w.active
      ) order by w.sort_order)
      from public.campaign_worlds w where w.is_starter_template
    ), '[]'::jsonb),
    'shopProducts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sp.id, 'name', sp.name, 'emoji', sp.emoji, 'description', sp.description,
        'category', sp.category, 'cost', sp.cost, 'active', sp.active
      ) order by sp.name)
      from public.shop_products sp where sp.is_starter_template
    ), '[]'::jsonb)
  );
end;
$$;
grant execute on function public.get_starter_pack() to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 7. upsert_starter_*() — admin-only create/edit, one per table. The client
--    generates `p_id` itself (uid(), same convention every other catalog
--    editor in this app already uses for new rows) and always passes it;
--    insert-or-update via ON CONFLICT, so one function covers both "new
--    item" and "edit existing item." The `where` guard on the conflict
--    target is defense-in-depth only — with client-generated fresh ids for
--    new rows this should never fire, but it means a colliding id can never
--    silently overwrite a REAL teacher's row through this path, only
--    another template row.
--
--    Deletes reuse the existing delete_achievement()/delete_title()/
--    delete_quiz()/delete_campaign_world()/delete_shop_product() RPCs
--    unchanged — each already checks is_same_staff_or_admin(owner), and an
--    admin session passes that regardless of which teacher (or the
--    template account) owns the row. No new delete RPCs needed.
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.upsert_starter_achievement(
  p_id text, p_name text, p_description text, p_icon text, p_category text,
  p_rarity text, p_xp_reward integer, p_coin_reward integer,
  p_trigger_type text, p_trigger_value integer, p_active boolean
)
returns public.achievements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.achievements;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can edit the starter pack.';
  end if;

  insert into public.achievements (
    id, owner_teacher_id, is_starter_template, name, description, icon, category,
    rarity, xp_reward, coin_reward, trigger_type, trigger_value, active
  ) values (
    p_id, public.starter_template_owner_id(), true, p_name, p_description, p_icon, p_category,
    p_rarity, p_xp_reward, p_coin_reward, p_trigger_type, p_trigger_value, p_active
  )
  on conflict (id) do update set
    name = excluded.name, description = excluded.description, icon = excluded.icon,
    category = excluded.category, rarity = excluded.rarity, xp_reward = excluded.xp_reward,
    coin_reward = excluded.coin_reward, trigger_type = excluded.trigger_type,
    trigger_value = excluded.trigger_value, active = excluded.active
  where public.achievements.is_starter_template
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.upsert_starter_achievement(text, text, text, text, text, text, integer, integer, text, integer, boolean) to authenticated;

create or replace function public.upsert_starter_title(
  p_id text, p_name text, p_description text, p_icon text, p_rarity text,
  p_active boolean, p_text_color text, p_border_color text, p_glow_color text, p_bg_color text
)
returns public.titles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.titles;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can edit the starter pack.';
  end if;

  insert into public.titles (
    id, owner_teacher_id, is_starter_template, name, description, icon, rarity,
    active, achievement_id, text_color, border_color, glow_color, bg_color
  ) values (
    p_id, public.starter_template_owner_id(), true, p_name, p_description, p_icon, p_rarity,
    p_active, null, p_text_color, p_border_color, p_glow_color, p_bg_color
  )
  on conflict (id) do update set
    name = excluded.name, description = excluded.description, icon = excluded.icon,
    rarity = excluded.rarity, active = excluded.active,
    text_color = excluded.text_color, border_color = excluded.border_color,
    glow_color = excluded.glow_color, bg_color = excluded.bg_color
  where public.titles.is_starter_template
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.upsert_starter_title(text, text, text, text, text, boolean, text, text, text, text) to authenticated;

create or replace function public.upsert_starter_quiz(
  p_id text, p_title text, p_description text, p_xp_reward integer,
  p_coin_reward integer, p_time_limit integer, p_questions jsonb, p_active boolean
)
returns public.quizzes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.quizzes;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can edit the starter pack.';
  end if;

  insert into public.quizzes (
    id, owner_teacher_id, is_starter_template, title, description, xp_reward,
    coin_reward, time_limit, questions, active
  ) values (
    p_id, public.starter_template_owner_id(), true, p_title, p_description, p_xp_reward,
    p_coin_reward, p_time_limit, coalesce(p_questions, '[]'::jsonb), p_active
  )
  on conflict (id) do update set
    title = excluded.title, description = excluded.description, xp_reward = excluded.xp_reward,
    coin_reward = excluded.coin_reward, time_limit = excluded.time_limit,
    questions = excluded.questions, active = excluded.active
  where public.quizzes.is_starter_template
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.upsert_starter_quiz(text, text, text, integer, integer, integer, jsonb, boolean) to authenticated;

create or replace function public.upsert_starter_campaign_world(
  p_id text, p_label text, p_icon text, p_color text, p_description text,
  p_stages jsonb, p_active boolean
)
returns public.campaign_worlds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.campaign_worlds;
  v_next_sort integer;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can edit the starter pack.';
  end if;

  select coalesce(max(sort_order) + 1, 0) into v_next_sort
  from public.campaign_worlds where is_starter_template;

  insert into public.campaign_worlds (
    id, owner_teacher_id, is_starter_template, label, icon, color, description,
    stages, sort_order, active
  ) values (
    p_id, public.starter_template_owner_id(), true, p_label, p_icon, p_color, p_description,
    coalesce(p_stages, '[]'::jsonb), v_next_sort, p_active
  )
  on conflict (id) do update set
    label = excluded.label, icon = excluded.icon, color = excluded.color,
    description = excluded.description, stages = excluded.stages, active = excluded.active
    -- sort_order deliberately NOT touched on update — only set once, at creation.
  where public.campaign_worlds.is_starter_template
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.upsert_starter_campaign_world(text, text, text, text, text, jsonb, boolean) to authenticated;

create or replace function public.upsert_starter_shop_item(
  p_id text, p_name text, p_emoji text, p_description text, p_category text,
  p_cost integer, p_active boolean
)
returns public.shop_products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.shop_products;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can edit the starter pack.';
  end if;

  insert into public.shop_products (
    id, owner_teacher_id, is_starter_template, name, emoji, description, category, cost, active
  ) values (
    p_id, public.starter_template_owner_id(), true, p_name, p_emoji, p_description, p_category, p_cost, p_active
  )
  on conflict (id) do update set
    name = excluded.name, emoji = excluded.emoji, description = excluded.description,
    category = excluded.category, cost = excluded.cost, active = excluded.active
  where public.shop_products.is_starter_template
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.upsert_starter_shop_item(text, text, text, text, text, integer, boolean) to authenticated;
