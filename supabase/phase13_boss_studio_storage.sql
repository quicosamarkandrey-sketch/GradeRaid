-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 13 — BOSS STUDIO CROSS-DEVICE SYNC + STORAGE-BACKED ARTWORK
-- (see EduQuest_Pending_Fixes_Report.md §2)
--
-- Run once in the Supabase SQL editor, after Phase 1–12 (requires
-- public.is_staff() to already exist, same prerequisite as Phase 10/12).
--
-- THE TWO BUGS THIS CLOSES
--   a) Boss Studio designs (DB.bossLibrary — name, colors, animation slots,
--      artwork refs) lived ONLY in localStorage/IndexedDB. Not one column of
--      it was ever pulled from or pushed to Supabase (unlike every other
--      array on DB, which at least rides the bulk profiles/boss_events sync).
--      Design a boss on one device, it simply isn't there on another.
--   b) When a library design is linked to a live World Boss event, the full
--      artwork was resolved back out of IndexedDB into a raw base64 image
--      (often 1MB+) and written directly into boss_events.image, then synced
--      to Supabase as-is — every admin/student device downloads that full
--      blob on every sync, and it only gets heavier as the library grows.
--
-- THE FIX
--   a) A new `boss_library` table, one row per design, keyed by the same
--      client-generated id bs_storage.js already uses (bvp_...). Two RPCs,
--      same security-definer shape as every other RPC in this app:
--        get_boss_library()                  — read, STAFF-ONLY (unlike
--                                               get_dsm_settings(), students
--                                               never render a Boss Studio
--                                               profile directly — only the
--                                               already-baked boss_events
--                                               snapshot, which has its own
--                                               separately-RLS'd table).
--        save_boss_library_entry(id, data)    — write, staff-only.
--        delete_boss_library_entry(id)        — delete, staff-only.
--      The matching JS (bs_storage.js) queues a debounced push to
--      save_boss_library_entry()/delete_boss_library_entry() from inside
--      bsUpsert()/bsDelete() — the same two functions every existing
--      Boss Studio file already calls, so nothing but bs_storage.js itself
--      changes.
--   b) A new public Storage bucket, `boss-art`. Uploaded artwork is now ALSO
--      pushed here (fire-and-forget, alongside the existing IndexedDB
--      offload — IndexedDB stays as the fast same-device cache; Storage is
--      what makes the same bytes reachable from a different device). The
--      resulting public URL is what gets used for boss_events.image at
--      deploy time going forward, instead of an embedded blob. Write access
--      is staff-only; read is public (any logged-in student's browser needs
--      to display <img src="...">  for a live boss without hitting RLS).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── (a) Boss Library sync table + RPCs ────────────────────────────────────────

create table if not exists public.boss_library (
  id          text primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

alter table public.boss_library enable row level security;

-- No select/insert/update/delete policy is granted on the table itself, on
-- purpose — Boss Studio is an admin-only design surface (mirrors
-- save_dsm_settings()'s write-side posture, just applied to reads here too).
-- The three RPCs below are the sole path in both directions.

create or replace function public.get_boss_library()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_staff() then
    raise exception 'Only staff can read the Boss Studio library.';
  end if;
  return coalesce(
    (select jsonb_agg(jsonb_build_object('id', id, 'data', data) order by updated_at)
       from public.boss_library),
    '[]'::jsonb
  );
end;
$$;

grant execute on function public.get_boss_library() to anon, authenticated;

create or replace function public.save_boss_library_entry(p_id text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Only staff can modify the Boss Studio library.';
  end if;

  insert into public.boss_library (id, data, updated_at, updated_by)
  values (p_id, p_data, now(), auth.uid()::text)
  on conflict (id) do update
    set data       = excluded.data,
        updated_at = now(),
        updated_by = excluded.updated_by;
end;
$$;

grant execute on function public.save_boss_library_entry(text, jsonb) to anon, authenticated;

create or replace function public.delete_boss_library_entry(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Only staff can modify the Boss Studio library.';
  end if;

  delete from public.boss_library where id = p_id;
end;
$$;

grant execute on function public.delete_boss_library_entry(text) to anon, authenticated;

-- ── (b) Storage bucket for uploaded/deployed Boss artwork ─────────────────────

insert into storage.buckets (id, name, public)
values ('boss-art', 'boss-art', true)
on conflict (id) do nothing;

-- Read: public bucket — anyone with the URL (any logged-in student's img
-- tag) can GET an object without needing a policy check, by design of
-- Supabase's "public" bucket flag. No select policy is needed for that path;
-- one is added anyway for completeness/consistency of anything that reads
-- via the authenticated API instead of the public URL.
drop policy if exists boss_art_read_all on storage.objects;
create policy boss_art_read_all on storage.objects
  for select
  using (bucket_id = 'boss-art');

drop policy if exists boss_art_staff_write on storage.objects;
create policy boss_art_staff_write on storage.objects
  for insert
  with check (bucket_id = 'boss-art' and public.is_staff());

drop policy if exists boss_art_staff_update on storage.objects;
create policy boss_art_staff_update on storage.objects
  for update
  using (bucket_id = 'boss-art' and public.is_staff());

drop policy if exists boss_art_staff_delete on storage.objects;
create policy boss_art_staff_delete on storage.objects
  for delete
  using (bucket_id = 'boss-art' and public.is_staff());
