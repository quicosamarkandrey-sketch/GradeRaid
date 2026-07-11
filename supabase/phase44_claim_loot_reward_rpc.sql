-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 44 — claim_loot_reward() RPC (closes the "comment-says-done-but-isn't"
-- gap: two different files asserted this RPC already existed and wrote
-- claimed loot server-side. It didn't. loot-service.js's claimReward() was
-- 100% local AppStore state — a claimed reward lived only in the claiming
-- student's own tab and vanished on the next fresh Supabase pull.)
--
-- Run once in the Supabase SQL editor, after Phase 25.
--
-- THE GAP THIS CLOSES
--   phase14_section_isolation.sql's loot_claims_no_direct_student_insert
--   policy (`for insert with check (false)`) has said "unchanged:
--   claim_loot_reward() RPC only" since Phase 14. db-service.js's bulk-push
--   path has said "lootClaims are NOT pushed from here — they are written
--   via claim_loot_reward() RPC at claim time" since the sync audit. Neither
--   RPC ever existed. This migration makes both comments true.
--
-- THE FIX
--   `claim_loot_reward()` — SECURITY DEFINER RPC, same authorization shape
--   as apply_boss_damage() (staff OR the calling student themselves, scoped
--   to their own section). Unlike start_loot_rush()/finalize_loot_rush()
--   (simple idempotent status flips), this one guards a genuinely scarce
--   shared resource — a reward's `quantity` — so it does the remaining-stock
--   check-and-insert as ONE atomic statement under a row lock on the boss
--   event, the same "SELECT ... FOR UPDATE before check-and-write" shape
--   purchase_shop_product() (Phase 14) uses for shop stock. Two students
--   racing for the last unit of a reward can no longer both "win" it.
--
--   Reward definitions (quantity, claimLimit, itemName, rarity) live in
--   boss_events.loot_rewards (jsonb), not a separate table, so the RPC reads
--   the specific reward out of that jsonb array under the same row lock
--   instead of trusting whatever the client claims the reward looks like.
--
--   student_name/student_init/student_color are added as columns here
--   (previously client-only fields on the local claim object) so the claim
--   feed (wblrClaimFeedHTML) still shows real names/colors after a refresh
--   instead of falling back to "Student" placeholders once claims actually
--   started surviving reload.
--
--   p_claim_id lets the client pass its own client-generated id (same
--   `uid()` used for the local optimistic claim). If the RPC is retried
--   after a network blip that actually succeeded server-side, the second
--   call finds its own earlier row by id and returns the same success
--   result instead of raising or double-counting against `quantity`.
--
-- CALL SITE
--   loot-rain.js's wblrSyncClaimRewardRpc(), fired right after
--   LootService.claimReward() commits the local optimistic claim — same
--   "local optimistic update + explicit RPC call" shape as
--   start_loot_rush()/finalize_loot_rush() (Phase 25) and apply_boss_damage()
--   (Phase 14). Unlike those, a definitive rejection here (reward actually
--   gone / limit actually reached — the local check raced and lost) rolls
--   the local claim back via LootService.rollbackClaim() rather than just
--   logging a warning, since silently leaving a phantom claim in local state
--   would show the student loot they don't actually have.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. SCHEMA — add the display fields the claim feed needs that were
--    previously client-only (local claim objects had these; the table
--    never did, since nothing ever wrote to the table at all).
-- ═════════════════════════════════════════════════════════════════════════
alter table public.loot_claims add column if not exists student_name  text;
alter table public.loot_claims add column if not exists student_init  text;
alter table public.loot_claims add column if not exists student_color text;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. claim_loot_reward — atomic check-and-insert against a locked boss row.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.claim_loot_reward(
  p_boss_id      uuid,
  p_class_id     text,
  p_reward_id    text,
  p_student_id   text,
  p_student_name text default null,
  p_student_init text default null,
  p_student_color text default null,
  p_claim_id     text default null
)
returns table(
  ok           boolean,
  reason       text,
  already_gone boolean,
  claim_id     text,
  item_name    text,
  rarity       text,
  claimed_at   timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_boss          public.boss_events;
  v_reward        jsonb;
  v_item_name     text;
  v_rarity        text;
  v_quantity      int;
  v_claim_limit   int;
  v_claimed_count int;
  v_my_count      int;
  v_claim_id      text := coalesce(p_claim_id, 'id_' || substr(md5(random()::text || clock_timestamp()::text), 1, 9));
  v_existing_ts   timestamptz;
begin
  if not public.is_staff_for_section(p_class_id)
     and not exists (
       select 1 from public.profiles
       where id = p_student_id and class_id = p_class_id and id = auth.uid()::text
     ) then
    raise exception 'not authorized for this section';
  end if;

  -- Idempotent retry: this exact claim id already made it in on an earlier
  -- attempt (e.g. the response to a successful insert never reached the
  -- client). Return the same success result instead of re-checking stock —
  -- re-checking would be wrong here, this claim was already counted.
  select lc.claimed_at, lc.item_name, lc.rarity
    into v_existing_ts, v_item_name, v_rarity
    from public.loot_claims lc
   where lc.id = v_claim_id;

  if found then
    return query select true, null::text, false, v_claim_id, v_item_name, v_rarity, v_existing_ts;
    return;
  end if;

  -- Lock the boss row so concurrent claims against the same reward serialize
  -- here rather than both reading "1 left" and both inserting.
  select * into v_boss from public.boss_events
   where id = p_boss_id and class_id = p_class_id
   for update;

  if not found then
    raise exception 'boss % not found in section %', p_boss_id, p_class_id;
  end if;

  if v_boss.status <> 'loot' then
    return query select false, 'Loot Rush has ended.', false, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;
  if v_boss.loot_finalized_at is not null then
    return query select false, 'Loot Rush has been finalized.', false, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select r into v_reward
    from jsonb_array_elements(coalesce(v_boss.loot_rewards, '[]'::jsonb)) r
   where r->>'id' = p_reward_id
   limit 1;

  if v_reward is null then
    return query select false, 'Reward not found.', false, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  v_item_name   := coalesce(v_reward->>'itemName', 'Reward');
  v_rarity      := coalesce(v_reward->>'rarity', 'Common');
  v_quantity    := coalesce((v_reward->>'quantity')::int, 0);
  v_claim_limit := greatest(1, coalesce((v_reward->>'claimLimit')::int, 1));

  select count(*) into v_claimed_count
    from public.loot_claims
   where boss_id = p_boss_id and reward_id = p_reward_id;

  if v_claimed_count >= v_quantity then
    return query select false, 'That reward is already gone.', true, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select count(*) into v_my_count
    from public.loot_claims
   where boss_id = p_boss_id and reward_id = p_reward_id and student_id = p_student_id;

  if v_my_count >= v_claim_limit then
    return query select false, ('Claim limit reached for ' || v_item_name || '.'), false, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  insert into public.loot_claims as lc
    (id, boss_id, class_id, reward_id, item_name, rarity, student_id, student_name, student_init, student_color, claimed_at)
  values
    (v_claim_id, p_boss_id, p_class_id, p_reward_id, v_item_name, v_rarity, p_student_id, p_student_name, p_student_init, p_student_color, now())
  returning lc.claimed_at into v_existing_ts;

  return query select true, null::text, false, v_claim_id, v_item_name, v_rarity, v_existing_ts;
end;
$$;
grant execute on function public.claim_loot_reward(uuid, text, text, text, text, text, text, text) to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. db-service.js pull mapping needs the two-line follow-up below to
--    actually restore student_name/student_init/student_color (currently
--    it only restores id/rewardId/itemName/rarity/studentId/claimedAt/
--    classId) — done as part of this same change, see loot-service.js /
--    loot-rain.js / db-service.js diffs shipped alongside this migration.
-- ═════════════════════════════════════════════════════════════════════════
