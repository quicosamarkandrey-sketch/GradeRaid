-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 48 — SHOP ORDERS / INVENTORY SYNC + BOSS LOOT → INVENTORY
--
-- Run once in the Supabase SQL editor, after Phase 44 (claim_loot_reward RPC).
--
-- THE GAP THIS CLOSES (see "Phase 2" investigation)
--   Bug #2 — cartCheckout() (shop_store.js) has always correctly created
--   DB.orders / DB.inventory entries client-side, and shop_pos_terminal.js /
--   shop_orders.js already correctly read/mutate them (claim, cancel,
--   student self-cancel). None of that ever reached Postgres: there was no
--   `orders` or `inventory` table, and db-service.js had zero push/pull
--   logic for either. Every order and inventory item lived in that tab's
--   localStorage snapshot only — gone on refresh, invisible on another
--   device or the teacher's POS terminal.
--
--   Bug #3 — LootService.claimReward() (loot-service.js) wrote claimed boss
--   loot into student.bossLoot, a field nothing else in the codebase reads
--   (confirmed: grep for "bossLoot" only matches loot-service.js itself).
--   shop_inventory.js — the actual "My Inventory" page — reads exclusively
--   from DB.inventory[studentId]. Boss loot was routed to a dead end.
--
-- THE FIX
--   1. New `orders` / `inventory` tables, mirroring DB.orders[] / DB.inventory{}
--      exactly (see db-service.js pull/push diffs shipped alongside this file).
--   2. RLS follows the existing `redemptions`/`point_log` shape (self OR
--      is_staff_for_section(), via a subquery to profiles — no new class_id
--      column needed on either table): a student may insert their own order/
--      inventory rows and read them; staff may read/write everything in
--      their own section(s). A narrow extra policy lets a student move
--      their OWN order to 'cancelled' (mirrors shop_orders.js's
--      ordExecuteCancel — the only student-side status mutation that
--      exists), but not to 'claimed' — that stays a staff-only transition
--      via shop_pos_terminal.js.
--   3. loot-service.js's claimReward()/rollbackClaim() are updated (separately,
--      not in this SQL file) to upsert/remove a DB.inventory[studentId] entry
--      instead of the dead-end bossLoot array, tagged source:'Boss Loot' —
--      it then rides the exact same `inventory` table/RLS/sync path as shop
--      purchases, so no separate boss-loot column or sync path is needed.
--
-- BONUS FIX — redemptions insert RLS
--   While wiring this, found that redemptions_staff_write (Phase 14) requires
--   is_staff_for_section() on INSERT — but the only call site that inserts a
--   redemption is cartCheckout(), running in the STUDENT's own session. That
--   meant every student purchase's redemption insert has been silently 42501
--   failing (caught by _pushTable's try/catch, logged as a console warning)
--   since Phase 14 shipped — "Purchase History" has never actually synced
--   for a student session. Same fix shape as orders/inventory above: self OR
--   staff, not staff-only.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. orders — one row per unit purchased (mirrors DB.orders[] exactly).
--    order_id is already a unique client-generated key from checkout time
--    (shop_store.js: 'ORD-' + Date.now()... + '-' + q), reused directly as PK.
-- ═════════════════════════════════════════════════════════════════════════
create table if not exists public.orders (
  order_id         text primary key,
  student_id       text not null references public.profiles(id),
  student_name     text,
  student_init     text,
  student_color    text,
  item_id          text,
  item_name        text,
  emoji            text,
  cost             integer not null default 0,
  category         text,
  claim_code       text,
  status           text not null default 'pending'
                     check (status in ('pending','ready','claimed','cancelled')),
  created_at       timestamptz not null default now(),
  created_date_str text,
  claimed_at       timestamptz,
  claimed_by       text,
  cancelled_at     timestamptz,
  cancel_reason    text,
  cancelled_by     text
);

create index if not exists orders_student_idx    on public.orders (student_id);
create index if not exists orders_claim_code_idx on public.orders (claim_code);
create index if not exists orders_status_idx     on public.orders (status);

alter table public.orders enable row level security;

create policy orders_select_scoped on public.orders
  for select
  using (
    student_id = auth.uid()::text
    or public.is_staff_for_section((select p.class_id from public.profiles p where p.id = orders.student_id))
  );

-- A student creates their own pending order at checkout.
create policy orders_student_insert on public.orders
  for insert
  with check (student_id = auth.uid()::text);

-- Staff (POS terminal) can read/write every order in their own section(s);
-- admins keep cross-section access via is_staff_for_section()'s own logic.
create policy orders_staff_write on public.orders
  for all
  using (public.is_staff_for_section((select p.class_id from public.profiles p where p.id = orders.student_id)))
  with check (public.is_staff_for_section((select p.class_id from public.profiles p where p.id = orders.student_id)));

-- A student may cancel THEIR OWN order (mirrors shop_orders.js's
-- ordExecuteCancel) but the with-check pins the destination status to
-- 'cancelled' only — they cannot use this path to mark it 'claimed'.
create policy orders_student_self_cancel on public.orders
  for update
  using (student_id = auth.uid()::text)
  with check (student_id = auth.uid()::text and status = 'cancelled');

-- ═════════════════════════════════════════════════════════════════════════
-- 2. inventory — one row per (student, item) (mirrors DB.inventory{} exactly:
--    DB.inventory[studentId] is an array of these, upserted-by-itemId
--    client-side in both cartCheckout() and, after the loot-service.js patch
--    shipped alongside this file, LootService.claimReward()).
-- ═════════════════════════════════════════════════════════════════════════
create table if not exists public.inventory (
  student_id     text not null references public.profiles(id),
  item_id        text not null,
  item_name      text,
  emoji          text,
  category       text,
  quantity       integer not null default 1,
  date_purchased text,
  last_purchased text,
  source         text, -- 'Store' | 'Boss Loot'
  status         text not null default 'active' check (status in ('active','used')),
  used_at        text,
  primary key (student_id, item_id)
);

create index if not exists inventory_student_idx on public.inventory (student_id);

alter table public.inventory enable row level security;

create policy inventory_select_scoped on public.inventory
  for select
  using (
    student_id = auth.uid()::text
    or public.is_staff_for_section((select p.class_id from public.profiles p where p.id = inventory.student_id))
  );

-- A student owns their own inventory rows outright (checkout adds items,
-- invConfirmUse() decrements quantity / flips status to 'used').
create policy inventory_self_write on public.inventory
  for all
  using (student_id = auth.uid()::text)
  with check (student_id = auth.uid()::text);

create policy inventory_staff_write on public.inventory
  for all
  using (public.is_staff_for_section((select p.class_id from public.profiles p where p.id = inventory.student_id)))
  with check (public.is_staff_for_section((select p.class_id from public.profiles p where p.id = inventory.student_id)));

-- ═════════════════════════════════════════════════════════════════════════
-- 3. BONUS FIX — redemptions insert RLS (see header note above)
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists redemptions_staff_write on public.redemptions;
create policy redemptions_write_scoped on public.redemptions
  for insert
  with check (
    student_id = auth.uid()::text
    or public.is_staff_for_section((select p.class_id from public.profiles p where p.id = redemptions.student_id))
  );
