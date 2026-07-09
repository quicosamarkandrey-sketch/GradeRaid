-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 18 — TITLE SYNC (closes the "titles are entirely local" gap)
--
-- Run once in the Supabase SQL editor, after Phase 17.
--
-- BEFORE THIS
--   DB.titles (definitions), DB.titleUnlocks (per-student unlock list), and
--   DB.equippedTitles (per-student currently-equipped title) were never
--   pulled from or pushed to Supabase at all — pure localStorage, single
--   device. This migration + the matching JS changes bring titles up to the
--   same real cross-device sync that achievements now has (Phase 17),
--   using the exact same shapes/trust model on purpose:
--     - `titles`         mirrors `achievements`       (catalog, staff-write)
--     - `title_unlocks`  mirrors `user_achievements`  (per-student unlock)
--     - equipped title   is a scalar per student, so it's a column on
--                        `profiles` + its own narrow RPC — same reasoning
--                        as Phase 9/10/11 (attendance_pct, dsm_settings):
--                        one field, one RPC, never the bulk profiles upsert.
--
-- NOT DONE HERE (by explicit agreement — separate task)
--   title_sections (section-scoping / "which section can see this title")
--   is not part of this migration. This phase only makes titles exist in
--   Supabase at all; section-filtering is the next piece of work, same as
--   how achievements got Phase 14 (sections table) before Phase 16 (the
--   RPC) before the read-side filter (most recent achievements patch).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. `titles` — the catalog (styling/rarity/description). Mirrors
--    `achievements`: public read, staff write, bulk-upserted from the client
--    the same way boss_events/shop_products/achievements already are.
-- ═════════════════════════════════════════════════════════════════════════
create table if not exists public.titles (
  id                text primary key,
  name              text not null,
  description       text,
  icon              text,
  rarity            text,
  active            boolean not null default true,
  achievement_id    text,               -- optional link to achievements.id; no FK
                                         -- on purpose (mirrors how achievement_id
                                         -- is stored client-side today — plain
                                         -- reference, not an enforced relation).
  text_color        text,
  border_color      text,
  glow_color        text,
  bg_color          text,
  primary_color     text,
  secondary_color   text,
  gradient_from     text,
  gradient_to       text,
  border_style      text,
  animation         text,
  particles         text,
  bg_effect         text,
  custom_border_css text,
  custom_animation_css text,
  custom_bg_css     text,
  created_at        timestamptz not null default now()
);

drop policy if exists titles_select_all  on public.titles;
drop policy if exists titles_staff_write on public.titles;

create policy titles_select_all on public.titles
  for select using (true);

create policy titles_staff_write on public.titles
  for all using (public.is_staff()) with check (public.is_staff());

-- ═════════════════════════════════════════════════════════════════════════
-- 2. `title_unlocks` — per-student unlock record. Mirrors user_achievements'
--    shape and RLS exactly (minus claim/xp/coins — titles are cosmetic-only,
--    no reward stacking).
-- ═════════════════════════════════════════════════════════════════════════
create table if not exists public.title_unlocks (
  student_id  text not null,
  title_id    text not null,
  unlocked_at timestamptz not null default now(),
  class_id    text references public.class_sections(id),
  primary key (student_id, title_id)
);

create index if not exists title_unlocks_class_idx on public.title_unlocks(class_id);

drop policy if exists title_unlocks_select_scoped         on public.title_unlocks;
drop policy if exists title_unlocks_staff_manage          on public.title_unlocks;
drop policy if exists title_unlocks_no_direct_student_insert on public.title_unlocks;

create policy title_unlocks_select_scoped on public.title_unlocks
  for select
  using (student_id = auth.uid()::text or public.is_staff_for_section(class_id));
create policy title_unlocks_staff_manage on public.title_unlocks
  for update using (public.is_staff_for_section(class_id)) with check (public.is_staff_for_section(class_id));
create policy title_unlocks_no_direct_student_insert on public.title_unlocks
  for insert with check (false); -- unlocked_title_for_student() RPC only, same as user_achievements

-- ═════════════════════════════════════════════════════════════════════════
-- 3. Equipped title — scalar per student. Own column, own narrow RPC.
--    Deliberately NOT part of the bulk profiles upsert (see Phase 9/10/11 —
--    that's exactly the whole-roster-write race this app has been moving
--    away from).
-- ═════════════════════════════════════════════════════════════════════════
alter table public.profiles add column if not exists equipped_title_id text;

-- ═════════════════════════════════════════════════════════════════════════
-- 4. RPCs
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.unlock_title_for_student(
  p_student_id text,
  p_title_id   text,
  p_class_id   text default null
)
returns public.title_unlocks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.title_unlocks;
begin
  if p_student_id is null or length(trim(p_student_id)) = 0 then
    raise exception 'p_student_id is required';
  end if;
  if p_title_id is null or length(trim(p_title_id)) = 0 then
    raise exception 'p_title_id is required';
  end if;

  insert into public.title_unlocks (student_id, title_id, unlocked_at, class_id)
  values (p_student_id, p_title_id, now(),
          coalesce(p_class_id, (select class_id from public.profiles where id = p_student_id), 'default-class'))
  on conflict (student_id, title_id) do nothing
  returning * into v_row;

  if v_row.student_id is null then
    select * into v_row from public.title_unlocks
     where student_id = p_student_id and title_id = p_title_id;
  end if;

  return v_row;
end;
$$;
grant execute on function
  public.unlock_title_for_student(text, text, text)
to anon, authenticated;

create or replace function public.revoke_title_from_student(
  p_student_id text,
  p_title_id   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.title_unlocks
   where student_id = p_student_id and title_id = p_title_id;

  -- A revoked title can't stay equipped — mirrors the app's own convention
  -- of never leaving stale state that would show something the student no
  -- longer has (see achievement unlock's "already-unlocked stays visible"
  -- rule from the other direction: this is the corresponding guard when
  -- something is taken away instead of granted).
  update public.profiles
     set equipped_title_id = null
   where id = p_student_id and equipped_title_id = p_title_id;
end;
$$;
grant execute on function
  public.revoke_title_from_student(text, text)
to anon, authenticated;

create or replace function public.set_equipped_title(
  p_student_id text,
  p_title_id   text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_student_id is null or length(trim(p_student_id)) = 0 then
    raise exception 'p_student_id is required';
  end if;

  -- Unequip is always allowed. Equipping requires the student to actually
  -- have unlocked that title first — cheap, real check (unlike achievement
  -- trigger-condition validation, which would mean reimplementing every
  -- trigger type in SQL — this one's just an existence check).
  if p_title_id is not null then
    if not exists (
      select 1 from public.title_unlocks
       where student_id = p_student_id and title_id = p_title_id
    ) then
      raise exception 'Student % has not unlocked title %', p_student_id, p_title_id;
    end if;
  end if;

  update public.profiles
     set equipped_title_id = p_title_id
   where id = p_student_id;
end;
$$;
grant execute on function
  public.set_equipped_title(text, text)
to anon, authenticated;
