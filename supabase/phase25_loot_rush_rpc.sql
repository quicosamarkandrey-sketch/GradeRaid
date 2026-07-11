-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 25 — LOOT-RUSH TRANSITION RPCs (closes the last piece of the boss-
-- event lifecycle still relying purely on the bulk boss_events upsert)
--
-- Run once in the Supabase SQL editor, after Phase 24.
--
-- UPDATED (this session) — finalize_loot_rush() now also transitions the
-- boss to status='ended'/ended_at=now() instead of only setting
-- loot_finalized_at. See the bugfix comment inside that function below for
-- the full "boss never properly ends" explanation. RE-RUN THIS FILE in the
-- Supabase SQL editor even if Phase 25 was already applied — create or
-- replace is idempotent and safe to run again.
--
-- THE GAP THIS CLOSES
--   prepareLootRush()/finalizeLoot() in loot-service.js only ever mutated
--   local AppStore state (status='loot', defeatedAt, lootStartedAt,
--   lootFinalizedAt) and relied entirely on the next bulk boss_events push
--   to reach Supabase — same gap start_boss_event()/end_boss_event()
--   (Phase 24) closed for Activate/End. The race flagged as a follow-up in
--   the audit: multiple students can all observe currentHp <= 0 and call
--   the loot-rush transition near-simultaneously; the client's own
--   `if (boss.status === 'loot') return alreadyActive` guard only checks
--   the LOCAL snapshot, not the server's real state, so it can't actually
--   prevent two devices from both thinking they're "first."
--
-- THE FIX
--   `start_loot_rush()` / `finalize_loot_rush()` — SECURITY DEFINER RPCs,
--   same shape as start_boss_event()/end_boss_event(). Called from
--   wblrPrepareLootRush()/wblrFinalizeLoot()/wblrAdminFinalizeLoot() right
--   alongside the existing local state update ("local optimistic update +
--   explicit RPC call", same pattern as apply_boss_damage()).
--
--   Unlike start_boss_event()/end_boss_event() (staff-only — Activate/End
--   are admin actions), these two are triggered by whichever STUDENT
--   happens to land the killing blow or be viewing the loot page when the
--   timer/claims run out, so the authorization check mirrors
--   apply_boss_damage()'s: staff OR the calling student themselves,
--   scoped to their own section.
--
--   The atomic guard is the `and status <> 'loot'` / `and status = 'loot'
--   and loot_finalized_at is null` clause on each UPDATE: only the first
--   caller's statement actually matches a row, so only the first caller
--   gets `already_active`/`already_finalized = false` back. Every other
--   near-simultaneous caller sees the transition already applied and gets
--   the server's real timestamp instead of clobbering it with their own.
--
-- STILL NOT DROPPED FROM THE BULK UPSERT (deliberately, out of scope here)
--   current_hp/status/defeated_at/ended_at/loot_started_at/
--   loot_finalized_at remain part of db-service.js's bulk boss_events
--   upsert for this pass. Now that every transition (damage, activate,
--   end, loot-start, loot-finalize) has its own RPC, dropping those six
--   fields from the bulk upsert entirely is safe to do as a follow-up —
--   just not attempted in this migration.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. start_loot_rush — transitions a boss to 'loot' status atomically.
--    Idempotent: if the boss is already in 'loot', this is a no-op that
--    reports already_active = true and returns the server's real
--    loot_started_at instead of overwriting it.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.start_loot_rush(
  p_boss_id  uuid,
  p_class_id text
)
returns table(loot_started_at timestamptz, already_active boolean)
language plpgsql security definer set search_path = public
as $$
declare
  v_loot_started_at timestamptz;
  v_updated         boolean := false;
begin
  if not public.is_staff_for_section(p_class_id)
     and not exists (
       select 1 from public.profiles
       where class_id = p_class_id and id = auth.uid()::text
     ) then
    raise exception 'not authorized for this section';
  end if;

  update public.boss_events b
     set status            = 'loot',
         current_hp         = 0,
         defeated_at        = now(),
         loot_started_at    = now(),
         loot_finalized_at  = null
   where b.id = p_boss_id and b.class_id = p_class_id and b.status <> 'loot'
  returning b.loot_started_at into v_loot_started_at;

  if found then
    v_updated := true;
    -- Fresh loot rush: wipe any residual claims, mirroring the client's
    -- local `b.lootClaims = []` reset in prepareLootRush(). In practice
    -- start_boss_event() already clears loot_claims on Activate, so this
    -- is normally a no-op — kept for the same "belt and suspenders"
    -- reason start_boss_event() itself wipes participant/loot rows.
    delete from public.loot_claims where boss_id = p_boss_id;
  else
    select b.loot_started_at into v_loot_started_at
      from public.boss_events b
     where b.id = p_boss_id and b.class_id = p_class_id;
    if not found then
      raise exception 'boss % not found in section %', p_boss_id, p_class_id;
    end if;
  end if;

  return query select v_loot_started_at, not v_updated;
end;
$$;
grant execute on function public.start_loot_rush(uuid, text) to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. finalize_loot_rush — marks the loot rush finalized atomically.
--    Idempotent: if already finalized, reports already_finalized = true
--    and returns the server's real loot_finalized_at.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.finalize_loot_rush(
  p_boss_id  uuid,
  p_class_id text
)
returns table(loot_finalized_at timestamptz, already_finalized boolean)
language plpgsql security definer set search_path = public
as $$
declare
  v_loot_finalized_at timestamptz;
  v_updated           boolean := false;
begin
  if not public.is_staff_for_section(p_class_id)
     and not exists (
       select 1 from public.profiles
       where class_id = p_class_id and id = auth.uid()::text
     ) then
    raise exception 'not authorized for this section';
  end if;

  -- BUGFIX (boss never properly ends): this used to only set
  -- loot_finalized_at, leaving `status` stuck at 'loot' forever — there was
  -- no RPC or UI path that ever moved a finalized boss to 'ended' short of
  -- a teacher activating a *different* boss in the same section (which
  -- force-ends this one client-side only, never server-synced). Finalizing
  -- the loot rush IS the natural end of the encounter, so this now sets
  -- status/ended_at the same way end_boss_event() (Phase 24) does for a
  -- manual end — just reached automatically. Mirrors the matching fix in
  -- loot-service.js's finalizeLoot().
  update public.boss_events b
     set loot_finalized_at = now(),
         status            = 'ended',
         ended_at          = now()
   where b.id = p_boss_id and b.class_id = p_class_id
     and b.status = 'loot' and b.loot_finalized_at is null
  returning b.loot_finalized_at into v_loot_finalized_at;

  if found then
    v_updated := true;
  else
    select b.loot_finalized_at into v_loot_finalized_at
      from public.boss_events b
     where b.id = p_boss_id and b.class_id = p_class_id;
    if not found then
      raise exception 'boss % not found in section %', p_boss_id, p_class_id;
    end if;
  end if;

  return query select v_loot_finalized_at, not v_updated;
end;
$$;
grant execute on function public.finalize_loot_rush(uuid, text) to anon, authenticated;
