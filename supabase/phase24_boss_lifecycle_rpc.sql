-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 24 — BOSS ACTIVATE/END RPCs (narrows the last piece of the boss
-- damage race flagged as a follow-up in Phase 23)
--
-- Run once in the Supabase SQL editor, after Phase 23.
--
-- THE GAP THIS CLOSES
--   Phase 23 wired apply_boss_damage() into every student hit, so
--   current_hp/status are now corrected to the server's authoritative
--   value right after each hit — but current_hp/status/defeated_at/
--   ended_at/loot_started_at/loot_finalized_at were still ALSO part of
--   db-service.js's plain bulk boss_events upsert, because the admin
--   Activate ("bossActivate") and End ("bossEnd") actions had no RPC of
--   their own and relied entirely on that bulk push to reach Supabase at
--   all. A bulk push carrying a stale locally-computed HP (from before an
--   Activate/End) could in principle still land after a fresh RPC result
--   and stomp it.
--
-- THE FIX
--   `start_boss_event()` and `end_boss_event()` — SECURITY DEFINER RPCs,
--   section-scope-checked the same way apply_boss_damage() and
--   boss_events' own RLS write policy already are. Called from
--   bossActivate()/bossEnd() right alongside the existing local state
--   update, same "local optimistic update + explicit RPC call" shape
--   already used for delete_boss_event() (Phase 23) and
--   delete_shop_product() (Phase 14).
--
--   `start_boss_event()` also ends any other still-active/loot boss in
--   the same section (mirroring bossActivate()'s local
--   "only end other bosses in THIS boss's own section" sweep) and clears
--   that boss's `boss_participants`/`loot_claims` rows server-side, for
--   the same "fresh run" reason bossActivate() resets them locally.
--
-- STILL NOT FULLY CLOSED (by design, flagged rather than fixed here)
--   current_hp/status/defeated_at/ended_at/loot_started_at/
--   loot_finalized_at remain part of the bulk boss_events upsert in
--   db-service.js. They can't be dropped yet: the loot-rush transition
--   (prepareLootRush()/finalizeLoot() in loot-service.js — status='loot',
--   defeatedAt, lootStartedAt, lootFinalizedAt) still has no RPC of its
--   own and depends entirely on that bulk push to sync at all. Dropping
--   these fields now would silently break loot-rush sync, a worse
--   regression than the narrow remaining race this migration leaves in
--   place. Giving prepareLootRush()/finalizeLoot() their own RPCs (same
--   shape as this one) is the natural next follow-up before those fields
--   can be safely removed from the bulk upsert.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 0. `ended_at` was set locally (bossEnd()) but was never actually part of
--    db-service.js's push/pull mapping — status='ended' synced, but the
--    timestamp itself was silently local-only. Adding the column here
--    (and wiring the pull/push mapping alongside this migration) closes
--    that in passing, since end_boss_event() below needs somewhere to
--    write it anyway.
-- ═════════════════════════════════════════════════════════════════════════
alter table public.boss_events add column if not exists ended_at timestamptz;


create or replace function public.start_boss_event(
  p_boss_id  uuid,
  p_class_id text
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_max_hp int;
begin
  if not public.is_staff_for_section(p_class_id) then
    raise exception 'not authorized for this section';
  end if;

  select max_hp into v_max_hp from public.boss_events
   where id = p_boss_id and class_id = p_class_id;
  if v_max_hp is null then
    raise exception 'boss % not found in section %', p_boss_id, p_class_id;
  end if;

  -- End any other still-active/loot boss in this same section — mirrors
  -- bossActivate()'s local "only end other bosses in THIS boss's own
  -- section" sweep (see phase14_section_isolation.sql's original note on
  -- why this must stay section-scoped, not global).
  update public.boss_events
     set status = 'ended'
   where class_id = p_class_id
     and id <> p_boss_id
     and status in ('active', 'loot');

  update public.boss_events
     set status             = 'active',
         current_hp          = v_max_hp,
         defeated_at         = null,
         ended_at            = null,
         loot_started_at     = null,
         loot_finalized_at   = null
   where id = p_boss_id and class_id = p_class_id;

  -- Fresh run: wipe this boss's participant/loot rows, same as
  -- bossActivate()'s local `DB.bossParticipants[bi] = {}` /
  -- `boss.lootClaims = []` resets.
  delete from public.boss_participants where boss_id = p_boss_id;
  delete from public.loot_claims       where boss_id = p_boss_id;
end;
$$;
grant execute on function public.start_boss_event(uuid, text) to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. end_boss_event — marks a boss ended (hidden from students), without
--    touching participant/loot history.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.end_boss_event(
  p_boss_id  uuid,
  p_class_id text
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff_for_section(p_class_id) then
    raise exception 'not authorized for this section';
  end if;

  update public.boss_events
     set status = 'ended', ended_at = now()
   where id = p_boss_id and class_id = p_class_id;
end;
$$;
grant execute on function public.end_boss_event(uuid, text) to anon, authenticated;
