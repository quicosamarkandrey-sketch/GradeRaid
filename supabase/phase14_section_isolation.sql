-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 14 — SECTION / TEACHER ISOLATION
--
-- Run once in the Supabase SQL editor, after Phase 4 (Section Maker) and
-- Phase 13 (Boss Studio Storage). Additive — nothing here breaks anything
-- currently live; see inline notes on backfill behavior for existing data.
--
-- SCOPING MODEL USED THROUGHOUT THIS FILE (confirmed with the client):
--   • Boss/Loot/Achievement-unlocks, Attendance, Leaderboard  → PER-SECTION
--     (only that one section's own students/teacher see it)
--   • Shop                                                     → PER-TEACHER
--     (one teacher's shop is shared across every section that teacher runs)
--   • Quiz / Campaign-stage / Achievement-definition / Title  → PER-SECTION,
--     many-to-many, but a teacher may only assign their OWN section(s)
--   • Mail                                                     → per-student,
--     owned by the sending teacher (their own section's students only)
--
-- is_staff() (existing, confirmed via `select prosrc from pg_proc`) is:
--     role in ('admin','teacher')  — NOT section-aware.
-- Every policy below that needs section ownership uses the new
-- is_staff_for_section() instead, never bare is_staff() alone (admins keep
-- cross-section access via that same helper, so nothing changes for them).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 0. OWNERSHIP HELPERS
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.is_staff_for_section(p_class_id text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()::text
      and pr.role in ('admin', 'teacher')
      and (
        pr.role = 'admin'
        or exists (
          select 1 from public.class_sections cs
          where cs.id = p_class_id and cs.adviser_id = pr.id
        )
        -- a section with no adviser assigned yet is admin-only until one is set
      )
  );
$$;
grant execute on function public.is_staff_for_section(text) to anon, authenticated;

-- Shop is per-TEACHER, not per-section — this checks "is the caller this
-- teacher," not "does the caller own this section."
create or replace function public.is_same_staff_or_admin(p_owner_teacher_id text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid()::text
      and pr.role in ('admin', 'teacher')
      and (pr.role = 'admin' or pr.id = p_owner_teacher_id)
  );
$$;
grant execute on function public.is_same_staff_or_admin(text) to anon, authenticated;

-- Backfill safety net: make sure a 'default-class' section row exists, in
-- case any of the tables below predate every student being enrolled in one.
insert into public.class_sections (id, grade_level, section_name, archived)
select 'default-class', '0', 'default-class', false
where not exists (select 1 from public.class_sections where id = 'default-class');

-- ═════════════════════════════════════════════════════════════════════════
-- 1. SCHEMA — add class_id to the tables that currently have none
-- ═════════════════════════════════════════════════════════════════════════
alter table public.boss_events       add column if not exists class_id text references public.class_sections(id);
alter table public.boss_participants add column if not exists class_id text references public.class_sections(id);
alter table public.loot_claims       add column if not exists class_id text references public.class_sections(id);
alter table public.user_achievements add column if not exists class_id text references public.class_sections(id);

update public.boss_events       set class_id = 'default-class' where class_id is null;
update public.boss_participants set class_id = 'default-class' where class_id is null;
update public.loot_claims       set class_id = 'default-class' where class_id is null;
update public.user_achievements set class_id = 'default-class' where class_id is null;
-- Left nullable for now (not `not null`) — flip that once you've confirmed
-- the backfill looks right against your real data.

create index if not exists boss_events_class_idx       on public.boss_events(class_id);
create index if not exists boss_participants_class_idx on public.boss_participants(class_id);
create index if not exists loot_claims_class_idx        on public.loot_claims(class_id);
create index if not exists user_achievements_class_idx  on public.user_achievements(class_id);

-- achievements (the catalog table — definitions, not per-student unlocks)
-- deliberately does NOT get a class_id here. It gets a many-to-many
-- assignment table instead — see §5 — because one achievement definition
-- can be assigned to several sections at once. Same reasoning for quizzes
-- and campaign stages.

-- ═════════════════════════════════════════════════════════════════════════
-- 2. RLS — boss_events / boss_participants / loot_claims / user_achievements
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists boss_events_select_all  on public.boss_events;
drop policy if exists boss_events_staff_write on public.boss_events;

create policy boss_events_select_scoped on public.boss_events
  for select
  using (
    public.is_staff_for_section(class_id)
    or class_id in (select p.class_id from public.profiles p where p.id = auth.uid()::text)
  );

create policy boss_events_staff_write on public.boss_events
  for all
  using (public.is_staff_for_section(class_id))
  with check (public.is_staff_for_section(class_id));

drop policy if exists boss_participants_select_all              on public.boss_participants;
drop policy if exists boss_participants_staff_full_write         on public.boss_participants;
drop policy if exists boss_participants_self_update_while_active on public.boss_participants;
drop policy if exists boss_participants_self_insert_while_active on public.boss_participants;

create policy boss_participants_select_scoped on public.boss_participants
  for select
  using (
    public.is_staff_for_section(class_id)
    or class_id in (select p.class_id from public.profiles p where p.id = auth.uid()::text)
  );

create policy boss_participants_staff_full_write on public.boss_participants
  for all
  using (public.is_staff_for_section(class_id))
  with check (public.is_staff_for_section(class_id));
-- Students no longer write this table directly — apply_boss_damage() below
-- (security definer) is the only path now. If any other client code still
-- writes boss_participants directly outside that RPC it will now fail;
-- that's intentional (see the db-service.js follow-up note on raid-flow.js).

drop policy if exists loot_claims_select_all              on public.loot_claims;
drop policy if exists loot_claims_staff_manage             on public.loot_claims;
drop policy if exists loot_claims_staff_delete             on public.loot_claims;
drop policy if exists loot_claims_no_direct_student_insert on public.loot_claims;

create policy loot_claims_select_scoped on public.loot_claims
  for select
  using (
    public.is_staff_for_section(class_id)
    or class_id in (select p.class_id from public.profiles p where p.id = auth.uid()::text)
  );
create policy loot_claims_staff_manage on public.loot_claims
  for update using (public.is_staff_for_section(class_id)) with check (public.is_staff_for_section(class_id));
create policy loot_claims_staff_delete on public.loot_claims
  for delete using (public.is_staff_for_section(class_id));
create policy loot_claims_no_direct_student_insert on public.loot_claims
  for insert with check (false); -- unchanged: claim_loot_reward() RPC only

drop policy if exists user_achievements_select_own_or_staff      on public.user_achievements;
drop policy if exists user_achievements_staff_manage             on public.user_achievements;
drop policy if exists user_achievements_no_direct_student_insert on public.user_achievements;

create policy user_achievements_select_scoped on public.user_achievements
  for select
  using (student_id = auth.uid()::text or public.is_staff_for_section(class_id));
create policy user_achievements_staff_manage on public.user_achievements
  for update using (public.is_staff_for_section(class_id)) with check (public.is_staff_for_section(class_id));
create policy user_achievements_no_direct_student_insert on public.user_achievements
  for insert with check (false); -- unchanged: awarded server-side only

-- ═════════════════════════════════════════════════════════════════════════
-- 3. RLS — close the wide-open reads on attendance_logs / attendance_schedules
--       / rfid_cards / profiles (any authenticated caller could read every
--       section's roster/attendance/cards regardless of which section they
--       belong to)
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists attendance_logs_select_all on public.attendance_logs;
create policy attendance_logs_select_scoped on public.attendance_logs
  for select
  using (public.is_staff_for_section(class_id) or student_id = auth.uid()::text);

drop policy if exists attendance_schedules_select_all on public.attendance_schedules;
create policy attendance_schedules_select_scoped on public.attendance_schedules
  for select
  using (
    public.is_staff_for_section(class_id)
    or class_id in (select p.class_id from public.profiles p where p.id = auth.uid()::text)
  );

drop policy if exists rfid_cards_select_all on public.rfid_cards;
create policy rfid_cards_select_scoped on public.rfid_cards
  for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = rfid_cards.student_id
        and (public.is_staff_for_section(p.class_id) or p.id = auth.uid()::text)
    )
  );

drop policy if exists profiles_select_all_authenticated on public.profiles;
create policy profiles_select_scoped on public.profiles
  for select
  using (
    id = auth.uid()::text
    or public.is_staff_for_section(class_id)
  );
drop policy if exists profiles_staff_full_write on public.profiles;
create policy profiles_staff_full_write on public.profiles
  for all
  using (public.is_staff_for_section(class_id))
  with check (public.is_staff_for_section(class_id));
-- profiles_self_update_cosmetic_only (student updating their own row) is
-- untouched — still id = auth.uid()::text, no section concept needed there.

-- ═════════════════════════════════════════════════════════════════════════
-- 4. RLS — close the point_log / recitation_log / redemptions ALL/true hole
--       (pre-existing, unrelated to multi-section, same fix shape — any
--       authenticated client could write any student's points/recitation/
--       redemption rows in any section)
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists point_log_anon_all on public.point_log;
create policy point_log_select_scoped on public.point_log
  for select
  using (
    student_id = auth.uid()::text
    or public.is_staff_for_section((select class_id from public.profiles where id = point_log.student_id))
  );
create policy point_log_staff_write on public.point_log
  for insert
  with check (public.is_staff_for_section((select class_id from public.profiles where id = point_log.student_id)));

drop policy if exists recitation_log_anon_all on public.recitation_log;
create policy recitation_log_select_scoped on public.recitation_log
  for select
  using (student_id = auth.uid()::text or public.is_staff_for_section(class_id));
-- writes already go through log_recitation_point() RPC (Phase 3) — no
-- direct insert/update policy needed here.

drop policy if exists redemptions_anon_all on public.redemptions;
create policy redemptions_select_scoped on public.redemptions
  for select
  using (
    student_id = auth.uid()::text
    or public.is_staff_for_section((select class_id from public.profiles where id = redemptions.student_id))
  );
create policy redemptions_staff_write on public.redemptions
  for insert
  with check (public.is_staff_for_section((select class_id from public.profiles where id = redemptions.student_id)));

-- ═════════════════════════════════════════════════════════════════════════
-- 5. NEW TABLES — Shop (per-teacher), Mail (per-student/owning-teacher),
--    Quiz/Campaign/Achievement/Title section-assignment (many-to-many,
--    restricted to the assigning teacher's own sections)
--
--    None of these sync to Supabase at all today (confirmed: no supabase/*.sql
--    file and no client.from() call anywhere in modules/shop, modules/mail,
--    modules/campaign, modules/achievements, modules/titles) — they are
--    brand new tables, not migrations of existing ones. JS wiring to
--    actually populate/read them (db-service.js pull/push, and the
--    multi-section-assignment UI in each admin screen) is tracked as
--    follow-up work, not included in this SQL-only pass.
-- ═════════════════════════════════════════════════════════════════════════

-- 5a. Shop — one row per product, owned by a teacher (shared across every
--      section that teacher runs, per the confirmed scoping model).
-- NOTE: this app's shop items use a client-generated id from utils.js's
-- uid() (e.g. "id_ab12cd34e") — NOT a real Postgres uuid — so the primary
-- key here is `text`, supplied by the client, not server-generated.
create table if not exists public.shop_products (
  id              text primary key,
  owner_teacher_id text not null references public.profiles(id),
  name            text not null,
  emoji           text,
  description     text,
  category        text,
  cost            int not null default 0,
  stock           int, -- null = unlimited
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
alter table public.shop_products enable row level security;

create policy shop_products_select_scoped on public.shop_products
  for select
  using (
    public.is_same_staff_or_admin(owner_teacher_id)
    or exists (
      select 1 from public.profiles p
      join public.class_sections cs on cs.id = p.class_id
      where p.id = auth.uid()::text and cs.adviser_id = shop_products.owner_teacher_id
    )
  );
create policy shop_products_staff_write on public.shop_products
  for all
  using (public.is_same_staff_or_admin(owner_teacher_id))
  with check (public.is_same_staff_or_admin(owner_teacher_id));

-- Atomic stock decrement (same reasoning as apply_boss_damage — a plain
-- read-then-write "buy" action is a race when two students buy the last
-- unit at once).
create or replace function public.purchase_shop_product(
  p_product_id text,
  p_student_id text,
  p_quantity   int default 1
) returns table(ok boolean, remaining_stock int)
language plpgsql security definer set search_path = public
as $$
declare
  v_stock int;
  v_owner text;
begin
  if p_quantity is null or p_quantity < 1 then
    raise exception 'quantity must be a positive integer';
  end if;

  select stock, owner_teacher_id into v_stock, v_owner
  from public.shop_products where id = p_product_id for update;

  if v_owner is null then
    raise exception 'product not found';
  end if;

  -- null stock = unlimited, always succeeds
  if v_stock is not null and v_stock < p_quantity then
    return query select false, v_stock;
    return;
  end if;

  if v_stock is not null then
    update public.shop_products set stock = stock - p_quantity where id = p_product_id
    returning stock into v_stock;
  end if;

  return query select true, v_stock;
end;
$$;
grant execute on function public.purchase_shop_product(text, text, int) to anon, authenticated;

-- Admin-set absolute stock (the "restock" input in shop_admin_store.js).
-- Kept as its own RPC, same reasoning as purchase_shop_product above: if
-- `stock` also rode the generic bulk upsert, a teacher restocking at the
-- same moment a student's purchase decremented it would have one silently
-- clobber the other. This and purchase_shop_product are the ONLY two things
-- allowed to touch shop_products.stock; it must stay out of any bulk write.
create or replace function public.restock_shop_product(
  p_product_id text,
  p_new_stock  int
) returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_owner text;
  v_stock int;
begin
  select owner_teacher_id into v_owner from public.shop_products where id = p_product_id;
  if v_owner is null then raise exception 'product not found'; end if;
  if not public.is_same_staff_or_admin(v_owner) then
    raise exception 'not authorized for this product';
  end if;
  if p_new_stock < 0 then raise exception 'stock cannot be negative'; end if;

  update public.shop_products set stock = p_new_stock where id = p_product_id
  returning stock into v_stock;
  return v_stock;
end;
$$;
grant execute on function public.restock_shop_product(text, int) to anon, authenticated;

create or replace function public.delete_shop_product(p_product_id text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_owner text;
begin
  select owner_teacher_id into v_owner from public.shop_products where id = p_product_id;
  if v_owner is null then return; end if; -- already gone, treat as success
  if not public.is_same_staff_or_admin(v_owner) then
    raise exception 'not authorized for this product';
  end if;
  delete from public.shop_products where id = p_product_id;
end;
$$;
grant execute on function public.delete_shop_product(text) to anon, authenticated;

-- 5b. Mail — per-student, owned by the sending teacher.
create table if not exists public.mail_messages (
  id               uuid primary key default gen_random_uuid(),
  sender_teacher_id text references public.profiles(id), -- null = system-sent
  recipient_student_id text not null references public.profiles(id),
  subject          text,
  body             text,
  xp_reward        int default 0,
  coin_reward      int default 0,
  read             boolean not null default false,
  claimed          boolean not null default false,
  created_at       timestamptz not null default now()
);
alter table public.mail_messages enable row level security;

create policy mail_messages_select_scoped on public.mail_messages
  for select
  using (
    recipient_student_id = auth.uid()::text
    or exists (
      select 1 from public.profiles p
      where p.id = mail_messages.recipient_student_id
        and public.is_staff_for_section(p.class_id)
    )
  );
create policy mail_messages_staff_write on public.mail_messages
  for insert
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = mail_messages.recipient_student_id
        and public.is_staff_for_section(p.class_id)
    )
  );
create policy mail_messages_self_update on public.mail_messages
  for update
  using (recipient_student_id = auth.uid()::text)
  with check (recipient_student_id = auth.uid()::text); -- students may only flip read/claimed on their own mail

-- 5c. Quiz / Campaign-stage / Achievement / Title section-assignment —
--     many-to-many junctions. A row can only be inserted for a class_id the
--     inserting teacher owns (is_staff_for_section), which is what stops a
--     teacher from ever assigning content into another teacher's section.
create table if not exists public.quiz_sections (
  quiz_id  text not null,
  class_id text not null references public.class_sections(id),
  primary key (quiz_id, class_id)
);
alter table public.quiz_sections enable row level security;
create policy quiz_sections_select_scoped on public.quiz_sections
  for select using (
    public.is_staff_for_section(class_id)
    or class_id in (select p.class_id from public.profiles p where p.id = auth.uid()::text)
  );
create policy quiz_sections_staff_write on public.quiz_sections
  for all using (public.is_staff_for_section(class_id)) with check (public.is_staff_for_section(class_id));

create table if not exists public.campaign_stage_sections (
  stage_id text not null,
  class_id text not null references public.class_sections(id),
  primary key (stage_id, class_id)
);
alter table public.campaign_stage_sections enable row level security;
create policy campaign_stage_sections_select_scoped on public.campaign_stage_sections
  for select using (
    public.is_staff_for_section(class_id)
    or class_id in (select p.class_id from public.profiles p where p.id = auth.uid()::text)
  );
create policy campaign_stage_sections_staff_write on public.campaign_stage_sections
  for all using (public.is_staff_for_section(class_id)) with check (public.is_staff_for_section(class_id));

-- NOTE: achievements.id's exact column type wasn't confirmed against your
-- live schema (it predates every migration file in this project — see
-- Phase 14 report). If it's uuid, change achievement_id below to `uuid` and
-- add `references public.achievements(id)`; left as untyped `text` with no
-- FK here so this migration can't fail on a type mismatch either way.
create table if not exists public.achievement_sections (
  achievement_id text not null,
  class_id       text not null references public.class_sections(id),
  primary key (achievement_id, class_id)
);
alter table public.achievement_sections enable row level security;
create policy achievement_sections_select_scoped on public.achievement_sections
  for select using (
    public.is_staff_for_section(class_id)
    or class_id in (select p.class_id from public.profiles p where p.id = auth.uid()::text)
  );
create policy achievement_sections_staff_write on public.achievement_sections
  for all using (public.is_staff_for_section(class_id)) with check (public.is_staff_for_section(class_id));

create table if not exists public.title_sections (
  title_id text not null,
  class_id text not null references public.class_sections(id),
  primary key (title_id, class_id)
);
alter table public.title_sections enable row level security;
create policy title_sections_select_scoped on public.title_sections
  for select using (
    public.is_staff_for_section(class_id)
    or class_id in (select p.class_id from public.profiles p where p.id = auth.uid()::text)
  );
create policy title_sections_staff_write on public.title_sections
  for all using (public.is_staff_for_section(class_id)) with check (public.is_staff_for_section(class_id));
-- Note: a title unlocked THROUGH an achievement needs no row here at all —
-- its visibility already follows achievement_sections via the achievement
-- it's linked to. This table is only for standalone, teacher-granted titles.

-- ═════════════════════════════════════════════════════════════════════════
-- 6. ATOMIC BOSS DAMAGE — replaces the read/compute/write client upsert for
--    current_hp specifically. Wired into wbcApplyDamage() (Phase 23 —
--    see combat-settings.js/phases.js/student-page.js/raid-flow.js) as the
--    authoritative writer for current_hp/status during student damage.
--    NOTE: current_hp/status are still also included in db-service.js's
--    boss_events bulk upsert, because admin-driven transitions (start/
--    reset-to-maxHp/end) have no RPC of their own yet and still rely on
--    that bulk push to sync. This narrows the original race (each hit is
--    now corrected to the server's authoritative HP immediately after the
--    RPC call, before the next bulk push can fire) without fully closing
--    it — a bulk push from a stale tab could still in principle race a
--    fresh RPC result. Fully closing that would mean giving admin
--    start/end their own narrow RPCs (mirroring this one) and dropping
--    current_hp/status from the bulk upsert entirely — flagged as a
--    follow-up, not done in this pass.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.apply_boss_damage(
  p_boss_id    uuid,
  p_class_id   text,
  p_student_id text,
  p_damage     int,
  p_is_crit    boolean default false
)
returns table(new_hp int, defeated boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_hp int;
begin
  if p_damage is null or p_damage < 0 then
    raise exception 'damage must be a non-negative integer';
  end if;

  if not public.is_staff_for_section(p_class_id)
     and not exists (
       select 1 from public.profiles
       where id = p_student_id and class_id = p_class_id and id = auth.uid()::text
     ) then
    raise exception 'not authorized for this section';
  end if;

  insert into public.boss_participants
    (boss_id, class_id, student_id, total_damage, correct_answers, crit_hits, joined_at)
  values
    (p_boss_id, p_class_id, p_student_id, p_damage, 1, case when p_is_crit then 1 else 0 end, now())
  on conflict (boss_id, student_id) do update
    set total_damage    = boss_participants.total_damage + excluded.total_damage,
        correct_answers = boss_participants.correct_answers + 1,
        crit_hits       = boss_participants.crit_hits + (case when p_is_crit then 1 else 0 end),
        class_id        = excluded.class_id;

  update public.boss_events
     set current_hp = greatest(0, current_hp - p_damage),
         status     = case when current_hp - p_damage <= 0 then 'defeated' else status end
   where id = p_boss_id and class_id = p_class_id
  returning current_hp into v_new_hp;

  if v_new_hp is null then
    raise exception 'boss % not found in section %', p_boss_id, p_class_id;
  end if;

  return query select v_new_hp, (v_new_hp <= 0);
end;
$$;
grant execute on function public.apply_boss_damage(uuid, text, text, int, boolean) to anon, authenticated;
