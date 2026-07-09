-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 2 — DYNAMIC CLASSROOM & SEATING MANAGEMENT
-- File: supabase/phase2_seating_hybrid_engine.sql
-- Run once in the Supabase SQL editor, after phase1_rfid_attendance.sql.
--
-- IMPORTANT CONTEXT FOR WHOEVER RUNS THIS
--   classroom-service.js already calls save_classroom_layout(),
--   assign_student_to_seat(), and delete_classroom_layout() via DBService.rpc(),
--   but no migration defining classroom_layouts / seats / seat_assignments or
--   those three functions exists anywhere in this project yet. Section A below
--   creates that missing foundation. Section B is the actual Phase 2 Hybrid
--   Engine update (blueprints + locking + auto-allocate). If your project
--   already ran an equivalent of Section A by hand, it's all `create if not
--   exists` / `add column if not exists`, so re-running this file is safe.
--
-- SECURITY MODEL (matches phase1_rfid_attendance.sql's pattern)
--   anon/authenticated get SELECT only on all three tables. Every write —
--   including seat generation, manual drags, swaps, and auto-allocation —
--   goes through a SECURITY DEFINER RPC, so the same-transaction invariants
--   below (one student in one seat per layout, locked seats are untouchable
--   by bulk ops) can't be bypassed by a direct client-side table write.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════
-- SECTION A — Foundation tables (classroom_layouts / seats / seat_assignments)
-- ═════════════════════════════════════════════════════════════════════════

create table if not exists public.classroom_layouts (
  id          uuid primary key default gen_random_uuid(),
  class_id    text not null,
  name        text not null,
  room_data   jsonb not null default '[]'::jsonb,   -- door/window/whiteboard/desk props
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists classroom_layouts_class_idx on public.classroom_layouts (class_id);

create table if not exists public.seats (
  id          uuid primary key default gen_random_uuid(),
  layout_id   uuid not null references public.classroom_layouts(id) on delete cascade,
  x_coord     numeric not null,
  y_coord     numeric not null,
  rotation    integer not null default 0,
  label       text
);

create index if not exists seats_layout_idx on public.seats (layout_id);

create table if not exists public.seat_assignments (
  id           uuid primary key default gen_random_uuid(),
  seat_id      uuid not null references public.seats(id) on delete cascade,
  layout_id    uuid not null references public.classroom_layouts(id) on delete cascade,
  student_id   text not null references public.profiles(id),
  assigned_at  timestamptz not null default now(),
  assigned_by  text,
  -- A seat holds at most one student, and (belt-and-suspenders against the
  -- swap/evict RPCs below ever racing each other) a student holds at most
  -- one seat per layout.
  unique (seat_id),
  unique (student_id, layout_id)
);

create index if not exists seat_assignments_layout_idx on public.seat_assignments (layout_id);
create index if not exists seat_assignments_student_idx on public.seat_assignments (student_id);

alter table public.classroom_layouts enable row level security;
alter table public.seats             enable row level security;
alter table public.seat_assignments  enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='classroom_layouts' and policyname='classroom_layouts_select_all') then
    create policy classroom_layouts_select_all on public.classroom_layouts for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='seats' and policyname='seats_select_all') then
    create policy seats_select_all on public.seats for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='seat_assignments' and policyname='seat_assignments_select_all') then
    create policy seat_assignments_select_all on public.seat_assignments for select using (true);
  end if;
end;
$$;

revoke insert, update, delete on public.classroom_layouts from anon, authenticated;
revoke insert, update, delete on public.seats             from anon, authenticated;
revoke insert, update, delete on public.seat_assignments  from anon, authenticated;
grant select on public.classroom_layouts to anon, authenticated;
grant select on public.seats             to anon, authenticated;
grant select on public.seat_assignments  to anon, authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- SECTION B — PHASE 2 UPDATE: Hybrid Engine (Blueprints + Locking)
-- ═════════════════════════════════════════════════════════════════════════

-- ── B1. New column: is_locked ───────────────────────────────────────────────
-- A locked seat is invisible to BOTH automated entry points
-- (generate_room_blueprint's reconciliation step and auto_allocate_remaining).
-- It remains fully editable through manual_move_student(), which is exactly
-- the "granular override" behavior the spec calls for.
alter table public.seats
  add column if not exists is_locked boolean not null default false;

-- ── B2. New column: shape (purely descriptive, drives wizard UI re-display) ─
alter table public.classroom_layouts
  add column if not exists shape text not null default 'custom'
    check (shape in ('custom', 'grid', 'u_shape', 'group_pods'));

-- ── B2b. New column: walkway_preset (grid-only; remembers aisle config) ────
alter table public.classroom_layouts
  add column if not exists walkway_preset text not null default 'traditional'
    check (walkway_preset in ('traditional', 'center_aisle', 'double_aisle'));


-- ─────────────────────────────────────────────────────────────────────────────
-- B3. generate_room_blueprint()
--   Parametric wizard backend. Wipes and regenerates the seat layer for a
--   layout from a shape + dimensions, in one transaction.
--
--   DESIGN CHOICE — locked seats survive regeneration.
--   "Generate" is meant for fast initial structure, not for destroying a
--   teacher's manual work-in-progress. So this does NOT blindly delete every
--   seat: locked seats (and their assignments) are preserved as-is, and the
--   new blueprint geometry is generated only for the remaining capacity.
--   This matches the spec's "is_locked seats must be ignored/preserved by
--   automated layout algorithms" rule — blueprint generation counts as an
--   automated layout algorithm.
--
--   p_shape:  'grid' | 'u_shape' | 'group_pods'
--   p_preset: 'traditional' | 'center_aisle' | 'double_aisle'
--     Only meaningful when p_shape = 'grid' — a walkway split is fundamentally
--     a "rows of columns" concept (splitting a U-shape or pod cluster down
--     the middle doesn't map onto a teacher's mental model of an aisle the
--     same way). u_shape/group_pods ignore p_preset and always lay out as
--     traditional. p_cols is the TOTAL seat-column count across all blocks
--     combined — e.g. center_aisle with p_cols=6 means 3+3 around one aisle,
--     not 6+6.
--   p_rows, p_cols: grid dimensions (u_shape uses rows=seats-per-arm,
--     cols=3 fixed arms conceptually, but we accept rows/cols generically
--     and let the shape function decide how to use them)
--   p_spacing: pixel gap between seat centers in the virtual 1200x800 canvas
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.generate_room_blueprint(
  p_layout_id text,
  p_class_id  text,
  p_name      text,
  p_shape     text,
  p_rows      integer,
  p_cols      integer,
  p_spacing   numeric default 80,
  p_preset    text default 'traditional'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layout       public.classroom_layouts;
  v_layout_uuid  uuid;
  v_start_x      numeric := 100;
  v_start_y      numeric := 150;
  v_r            integer;
  v_c            integer;
  v_x            numeric;
  v_y            numeric;
  v_locked_count integer;
  v_new_seats    jsonb := '[]'::jsonb;
  v_seat         public.seats;
  v_pod_idx      integer;
  v_pod_cols     integer := 2;     -- seats per pod row
  v_pod_gap      numeric;
  -- Walkway-split bookkeeping (grid shape only):
  v_aisle_w      numeric;          -- extra pixel gap injected per walkway
  v_block_sizes  integer[];        -- column-count of each block, left→right
  v_block_idx    integer;
  v_col_in_block integer;
  v_global_col   integer;          -- running column index across all blocks, for x calc
  v_block_start_x numeric;
begin
  if p_shape not in ('grid', 'u_shape', 'group_pods') then
    raise exception 'Unknown shape: %. Must be grid, u_shape, or group_pods.', p_shape;
  end if;
  if p_preset not in ('traditional', 'center_aisle', 'double_aisle') then
    raise exception 'Unknown preset: %. Must be traditional, center_aisle, or double_aisle.', p_preset;
  end if;
  if p_rows is null or p_rows < 1 or p_cols is null or p_cols < 1 then
    raise exception 'rows and cols must each be at least 1.';
  end if;
  if p_rows * p_cols > 400 then
    raise exception 'rows * cols (%) exceeds the 400-seat safety cap.', p_rows * p_cols;
  end if;
  if p_shape = 'grid' and p_preset = 'center_aisle' and p_cols < 2 then
    raise exception 'center_aisle needs at least 2 columns (1 per side).';
  end if;
  if p_shape = 'grid' and p_preset = 'double_aisle' and p_cols < 3 then
    raise exception 'double_aisle needs at least 3 columns (1 per block minimum).';
  end if;

  -- Resolve or create the layout row.
  if p_layout_id is not null and p_layout_id <> '' then
    v_layout_uuid := p_layout_id::uuid;

    -- Ownership guard (Section D). A layout created before created_by
    -- existed has created_by = null and is treated as ungoverned legacy
    -- data — any staff member may still regenerate it, exactly like today.
    -- A layout that DOES have an owner can only be regenerated by that same
    -- owner. IS DISTINCT FROM (not <>) is required here: an anonymous/
    -- no-session caller has auth.uid() = null, and `created_by <> null`
    -- would itself evaluate to null (never true) under standard SQL
    -- three-valued logic, silently letting an unauthenticated caller through.
    if exists (
      select 1 from public.classroom_layouts
       where id = v_layout_uuid
         and created_by is not null
         and created_by is distinct from auth.uid()
    ) then
      raise exception 'You do not have permission to modify this layout.';
    end if;

    update public.classroom_layouts
       set name = coalesce(p_name, name), shape = p_shape, walkway_preset = p_preset, updated_at = now()
     where id = v_layout_uuid
     returning * into v_layout;
    if v_layout is null then
      raise exception 'Layout % not found.', p_layout_id;
    end if;
  else
    insert into public.classroom_layouts (class_id, name, room_data, shape, walkway_preset, created_by)
    values (p_class_id, coalesce(p_name, 'New Layout'), '[]'::jsonb, p_shape, p_preset, auth.uid())
    returning * into v_layout;
    v_layout_uuid := v_layout.id;
  end if;

  -- Locked seats (and their assignments, via FK cascade if deleted — but we
  -- are NOT deleting them) are left completely untouched.
  select count(*) into v_locked_count from public.seats
   where layout_id = v_layout_uuid and is_locked = true;

  -- Delete only the UN-locked seats for this layout. Cascades to
  -- seat_assignments for those seats only, since locked seats' assignment
  -- rows aren't touched.
  delete from public.seats where layout_id = v_layout_uuid and is_locked = false;

  -- ── Generate geometry per shape ──────────────────────────────────────────
  if p_shape = 'grid' then
    -- Split p_cols across 1, 2, or 3 blocks depending on preset, as evenly
    -- as possible (extra columns land in the leftmost blocks). A walkway
    -- is injected as one extra spacing-width gap between consecutive blocks
    -- — wide enough to visually read as an aisle, not just a seat short.
    v_aisle_w := p_spacing * 1.6;

    if p_preset = 'traditional' then
      v_block_sizes := array[p_cols];
    elsif p_preset = 'center_aisle' then
      v_block_sizes := array[ceil(p_cols / 2.0)::integer, floor(p_cols / 2.0)::integer];
    else -- double_aisle
      v_block_sizes := array[
        ceil(p_cols / 3.0)::integer,
        ceil((p_cols - ceil(p_cols / 3.0)::integer) / 2.0)::integer,
        0  -- filled in below as the remainder, so the three sizes always sum to p_cols
      ];
      v_block_sizes[3] := p_cols - v_block_sizes[1] - v_block_sizes[2];
    end if;

    for v_r in 0 .. (p_rows - 1) loop
      v_global_col := 0;
      v_block_start_x := v_start_x;
      for v_block_idx in 1 .. array_length(v_block_sizes, 1) loop
        if v_block_idx > 1 then
          v_block_start_x := v_block_start_x + (v_aisle_w);
        end if;
        for v_col_in_block in 0 .. (v_block_sizes[v_block_idx] - 1) loop
          v_x := v_block_start_x + (v_col_in_block * p_spacing);
          v_y := v_start_y + (v_r * p_spacing);
          insert into public.seats (layout_id, x_coord, y_coord, rotation, is_locked)
          values (v_layout_uuid, v_x, v_y, 0, false)
          returning * into v_seat;
          v_new_seats := v_new_seats || to_jsonb(v_seat);
        end loop;
        v_block_start_x := v_block_start_x + (v_block_sizes[v_block_idx] * p_spacing);
      end loop;
    end loop;

  elsif p_shape = 'u_shape' then
    -- Three arms of a U: left column (top→bottom), bottom row (left→right),
    -- right column (bottom→top). p_rows = seats per vertical arm,
    -- p_cols = seats along the bottom arm (excluding the two corners, which
    -- belong to the vertical arms so corners aren't double-seated).
    -- Left arm (facing right, rotation 0).
    for v_r in 0 .. (p_rows - 1) loop
      v_x := v_start_x;
      v_y := v_start_y + (v_r * p_spacing);
      insert into public.seats (layout_id, x_coord, y_coord, rotation, is_locked)
      values (v_layout_uuid, v_x, v_y, 90, false)
      returning * into v_seat;
      v_new_seats := v_new_seats || to_jsonb(v_seat);
    end loop;
    -- Bottom arm (facing up, rotation 180), left-to-right between the arms.
    for v_c in 0 .. (p_cols - 1) loop
      v_x := v_start_x + p_spacing + (v_c * p_spacing);
      v_y := v_start_y + ((p_rows - 1) * p_spacing);
      insert into public.seats (layout_id, x_coord, y_coord, rotation, is_locked)
      values (v_layout_uuid, v_x, v_y, 180, false)
      returning * into v_seat;
      v_new_seats := v_new_seats || to_jsonb(v_seat);
    end loop;
    -- Right arm (facing left, rotation 270).
    for v_r in 0 .. (p_rows - 1) loop
      v_x := v_start_x + p_spacing + (p_cols * p_spacing);
      v_y := v_start_y + (v_r * p_spacing);
      insert into public.seats (layout_id, x_coord, y_coord, rotation, is_locked)
      values (v_layout_uuid, v_x, v_y, 270, false)
      returning * into v_seat;
      v_new_seats := v_new_seats || to_jsonb(v_seat);
    end loop;

  elsif p_shape = 'group_pods' then
    -- p_rows = number of pods, p_cols = seats per pod (clustered 2-wide).
    v_pod_gap := p_spacing * 2.2;
    for v_pod_idx in 0 .. (p_rows - 1) loop
      for v_c in 0 .. (p_cols - 1) loop
        v_x := v_start_x + (v_pod_idx * v_pod_gap) + ((v_c % v_pod_cols) * (p_spacing * 0.7));
        v_y := v_start_y + ((v_c / v_pod_cols) * (p_spacing * 0.7));
        insert into public.seats (layout_id, x_coord, y_coord, rotation, is_locked)
        values (v_layout_uuid, v_x, v_y, 0, false)
        returning * into v_seat;
        v_new_seats := v_new_seats || to_jsonb(v_seat);
      end loop;
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'layout', to_jsonb(v_layout),
    'generated_seats', v_new_seats,
    'preserved_locked_count', v_locked_count
  );
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- B4. manual_move_student()
--   Single entry point for ALL manual sidebar/canvas interactions:
--     • sidebar → empty seat        (p_student_id set, p_target_seat_id set, evict=null path)
--     • assigned seat → sidebar     (p_student_id set, p_target_seat_id = NULL  → vacate)
--     • seat A → occupied seat B    (swap: both students end up in each other's seat)
--
--   LOCKING RULE: manual_move_student() is the one thing that's allowed to
--   touch a locked seat — locking only blocks AUTOMATED algorithms
--   (generate_room_blueprint's regen step, auto_allocate_remaining). A
--   teacher's deliberate, explicit drag onto a locked seat is itself the
--   override and must succeed, otherwise "lock" would make a seat
--   permanently frozen even for the person who locked it.
--
--   Returns the set of seat_assignments rows affected so the client can
--   reconcile a swap (two rows change) in one AppStore.updateState() call.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.manual_move_student(
  p_student_id     text,
  p_target_seat_id text,
  p_layout_id      text,
  p_assigned_by    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layout_uuid     uuid := p_layout_id::uuid;
  v_target_seat_uuid uuid;
  v_origin_seat_id  uuid;
  v_occupant_id     text;
  v_affected        jsonb := '[]'::jsonb;
  v_row             public.seat_assignments;
begin
  if p_student_id is null or length(trim(p_student_id)) = 0 then
    raise exception 'student_id is required.';
  end if;
  if not exists (select 1 from public.profiles where id = p_student_id) then
    raise exception 'Unknown student_id: %', p_student_id;
  end if;
  if not exists (select 1 from public.classroom_layouts where id = v_layout_uuid) then
    raise exception 'Unknown layout_id: %', p_layout_id;
  end if;

  -- Where is this student sitting right now, if anywhere in this layout?
  select seat_id into v_origin_seat_id
    from public.seat_assignments
   where student_id = p_student_id and layout_id = v_layout_uuid;

  -- ── Case 1: target is NULL → vacate (drag back to sidebar) ───────────────
  if p_target_seat_id is null or length(trim(p_target_seat_id)) = 0 then
    if v_origin_seat_id is null then
      return jsonb_build_object('ok', true, 'affected', '[]'::jsonb, 'note', 'Student was already unassigned.');
    end if;
    delete from public.seat_assignments
     where student_id = p_student_id and layout_id = v_layout_uuid;
    v_affected := v_affected || jsonb_build_object('seat_id', v_origin_seat_id, 'student_id', null);
    return jsonb_build_object('ok', true, 'affected', v_affected);
  end if;

  v_target_seat_uuid := p_target_seat_id::uuid;
  if not exists (select 1 from public.seats where id = v_target_seat_uuid and layout_id = v_layout_uuid) then
    raise exception 'Seat % does not belong to layout %.', p_target_seat_id, p_layout_id;
  end if;

  -- Dropping onto the seat the student is already in is a no-op.
  if v_origin_seat_id = v_target_seat_uuid then
    return jsonb_build_object('ok', true, 'affected', '[]'::jsonb, 'note', 'No change — already in that seat.');
  end if;

  select student_id into v_occupant_id
    from public.seat_assignments
   where seat_id = v_target_seat_uuid;

  -- ── Case 2: target seat is occupied by someone else → SWAP ───────────────
  if v_occupant_id is not null and v_occupant_id <> p_student_id then
    -- Clear both seats first so the unique(seat_id)/(student_id,layout_id)
    -- constraints never see a transient collision inside this transaction.
    delete from public.seat_assignments where seat_id = v_target_seat_uuid;
    if v_origin_seat_id is not null then
      delete from public.seat_assignments where seat_id = v_origin_seat_id;
    end if;

    insert into public.seat_assignments (seat_id, layout_id, student_id, assigned_by)
    values (v_target_seat_uuid, v_layout_uuid, p_student_id, p_assigned_by)
    returning * into v_row;
    v_affected := v_affected || to_jsonb(v_row);

    if v_origin_seat_id is not null then
      insert into public.seat_assignments (seat_id, layout_id, student_id, assigned_by)
      values (v_origin_seat_id, v_layout_uuid, v_occupant_id, p_assigned_by)
      returning * into v_row;
      v_affected := v_affected || to_jsonb(v_row);
    end if;
    -- else: dragged student had no prior seat (came from "unassigned" pool);
    -- the displaced occupant simply returns to the unassigned pool.

    return jsonb_build_object('ok', true, 'affected', v_affected, 'swapped', true);
  end if;

  -- ── Case 3: target seat is empty → plain move/assign ─────────────────────
  if v_origin_seat_id is not null then
    delete from public.seat_assignments where seat_id = v_origin_seat_id;
    v_affected := v_affected || jsonb_build_object('seat_id', v_origin_seat_id, 'student_id', null);
  end if;

  insert into public.seat_assignments (seat_id, layout_id, student_id, assigned_by)
  values (v_target_seat_uuid, v_layout_uuid, p_student_id, p_assigned_by)
  returning * into v_row;
  v_affected := v_affected || to_jsonb(v_row);

  return jsonb_build_object('ok', true, 'affected', v_affected, 'swapped', false);
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- B5. auto_allocate_remaining()
--   Bulk/parametric assignment. Reads the current layout, finds every seat
--   that is BOTH unlocked AND currently empty, and fills as many as possible
--   from the supplied pool of unassigned student ids, in the requested
--   strategy order.
--
--   p_strategy: 'alphabetical' | 'random'
--     'alphabetical' orders students by profiles.name (falls back to id)
--     and fills seats in canvas reading order (top-to-bottom, left-to-right
--     — i.e. y_coord then x_coord) for a predictable, explainable result.
--     'random' shuffles the student list server-side (so re-running gives a
--     different result, instead of the client doing Math.random() and the
--     two ever disagreeing about who's actually unassigned).
--
--   Locked seats are excluded by definition (this IS the "automated layout
--   algorithm" the spec says must ignore them). Already-occupied unlocked
--   seats are also left alone — this fills gaps, it doesn't reshuffle people
--   who are already manually placed. Use a separate full-reshuffle action if
--   you ever want to also displace already-seated, unlocked students.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.auto_allocate_remaining(
  p_layout_id      text,
  p_student_ids    text[],
  p_strategy       text default 'alphabetical',
  p_assigned_by    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layout_uuid uuid := p_layout_id::uuid;
  v_seat        record;
  v_student_id  text;
  v_pool        text[];
  v_affected    jsonb := '[]'::jsonb;
  v_row         public.seat_assignments;
  v_idx         integer;
  v_tmp         text;
begin
  if p_strategy not in ('alphabetical', 'random') then
    raise exception 'strategy must be alphabetical or random, got: %', p_strategy;
  end if;
  if not exists (select 1 from public.classroom_layouts where id = v_layout_uuid) then
    raise exception 'Unknown layout_id: %', p_layout_id;
  end if;

  -- Only students NOT already seated anywhere in this layout are eligible,
  -- even if the caller's list is stale/includes someone already placed.
  select array_agg(sid) into v_pool
    from unnest(p_student_ids) as sid
   where sid not in (
     select student_id from public.seat_assignments where layout_id = v_layout_uuid
   );

  if v_pool is null then
    return jsonb_build_object('ok', true, 'affected', '[]'::jsonb, 'note', 'No eligible students to place.');
  end if;

  if p_strategy = 'alphabetical' then
    -- BUGFIX: profiles has no `name` column — the display name column is
    -- `display_name` (see db-service.js's _pullCacheFromSupabase profiles
    -- mapping). The original `coalesce(p.name, sid)` here referenced a
    -- nonexistent column, which throws "column p.name does not exist" the
    -- first time a teacher runs Auto-Fill with the Alphabetical strategy.
    select array_agg(sid order by coalesce(p.display_name, sid))
      into v_pool
      from unnest(v_pool) as sid
      left join public.profiles p on p.id = sid;
  else
    -- Fisher-Yates shuffle, server-side, so the result is authoritative.
    -- (plpgsql's `for .. in reverse hi..lo` needs literal/variable bounds,
    -- not a function call directly in the range, so capture the length first.)
    declare
      v_len integer := array_length(v_pool, 1);
      v_j   integer;
    begin
      for v_idx in reverse v_len .. 2 loop
        v_j := 1 + floor(random() * v_idx)::integer;
        v_tmp := v_pool[v_idx];
        v_pool[v_idx] := v_pool[v_j];
        v_pool[v_j] := v_tmp;
      end loop;
    end;
  end if;

  -- Unlocked AND currently-empty seats, in stable reading order.
  for v_seat in
    select s.id as seat_id
      from public.seats s
      left join public.seat_assignments sa on sa.seat_id = s.id
     where s.layout_id = v_layout_uuid
       and s.is_locked = false
       and sa.id is null
     order by s.y_coord asc, s.x_coord asc
  loop
    if array_length(v_pool, 1) is null or array_length(v_pool, 1) = 0 then
      exit;
    end if;
    v_student_id := v_pool[1];
    v_pool := v_pool[2:];

    insert into public.seat_assignments (seat_id, layout_id, student_id, assigned_by)
    values (v_seat.seat_id, v_layout_uuid, v_student_id, p_assigned_by)
    on conflict (student_id, layout_id) do nothing  -- safety net; should not fire given the pre-filter above
    returning * into v_row;

    if v_row.id is not null then
      v_affected := v_affected || to_jsonb(v_row);
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'affected', v_affected,
    'placed_count', jsonb_array_length(v_affected),
    'unplaced_remaining', coalesce(array_length(v_pool, 1), 0)
  );
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- B6. set_seat_lock()
--   Tiny dedicated toggle so the UI doesn't need to round-trip a whole seat
--   object through save_classroom_layout() just to flip one boolean.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_seat_lock(p_seat_id text, p_is_locked boolean)
returns public.seats
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.seats;
begin
  update public.seats
     set is_locked = p_is_locked
   where id = p_seat_id::uuid
   returning * into v_row;

  if v_row is null then
    raise exception 'Seat % not found.', p_seat_id;
  end if;

  return v_row;
end;
$$;


-- ═════════════════════════════════════════════════════════════════════════
-- SECTION C — Foundation RPCs referenced by classroom-service.js
--   (save_classroom_layout / assign_student_to_seat / delete_classroom_layout)
--   Included here because no prior migration defines them. If you already
--   have working versions of these three, skip Section C.
-- ═════════════════════════════════════════════════════════════════════════

-- An earlier hand-run migration created save_classroom_layout() with
-- p_layout_id typed as `uuid` instead of `text`. Because classroom-service.js
-- calls the RPC with named parameters, PostgREST can't tell that overload
-- apart from the `text` version below (PGRST203 "Could not choose the best
-- candidate function"). Drop the stale uuid-typed overload so only one
-- candidate remains.
drop function if exists public.save_classroom_layout(uuid, text, text, jsonb, jsonb);

create or replace function public.save_classroom_layout(
  p_layout_id text,
  p_class_id  text,
  p_name      text,
  p_room_data jsonb,
  p_seats     jsonb   -- [{id|null, x_coord, y_coord, rotation, label}]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layout      public.classroom_layouts;
  v_layout_uuid uuid;
  v_seat_in     jsonb;
  v_seat_out    public.seats;
  v_keep_ids    uuid[] := '{}';
  v_out_seats   jsonb := '[]'::jsonb;
begin
  if p_layout_id is not null and p_layout_id <> '' then
    v_layout_uuid := p_layout_id::uuid;

    -- Ownership guard (Section D) — same rule and same NULL-safety reasoning
    -- as generate_room_blueprint() above: legacy (created_by is null) layouts
    -- stay editable by any staff member; owned layouts only by their owner.
    if exists (
      select 1 from public.classroom_layouts
       where id = v_layout_uuid
         and created_by is not null
         and created_by is distinct from auth.uid()
    ) then
      raise exception 'You do not have permission to modify this layout.';
    end if;

    update public.classroom_layouts
       set name = p_name, room_data = coalesce(p_room_data, '[]'::jsonb), updated_at = now()
     where id = v_layout_uuid
     returning * into v_layout;
    if v_layout is null then
      raise exception 'Layout % not found.', p_layout_id;
    end if;
  else
    insert into public.classroom_layouts (class_id, name, room_data, created_by)
    values (p_class_id, p_name, coalesce(p_room_data, '[]'::jsonb), auth.uid())
    returning * into v_layout;
    v_layout_uuid := v_layout.id;
  end if;

  -- Upsert each incoming seat; new seats (id = null) get a fresh UUID.
  for v_seat_in in select * from jsonb_array_elements(coalesce(p_seats, '[]'::jsonb))
  loop
    if (v_seat_in->>'id') is not null and (v_seat_in->>'id') <> '' then
      update public.seats
         set x_coord = (v_seat_in->>'x_coord')::numeric,
             y_coord = (v_seat_in->>'y_coord')::numeric,
             rotation = coalesce((v_seat_in->>'rotation')::integer, 0),
             label = v_seat_in->>'label',
             is_locked = coalesce((v_seat_in->>'is_locked')::boolean, is_locked)
       where id = (v_seat_in->>'id')::uuid and layout_id = v_layout_uuid
       returning * into v_seat_out;
      if v_seat_out is null then
        -- id was supplied but doesn't belong to this layout (or doesn't
        -- exist) — treat as new rather than silently dropping the seat.
        insert into public.seats (layout_id, x_coord, y_coord, rotation, label, is_locked)
        values (v_layout_uuid, (v_seat_in->>'x_coord')::numeric, (v_seat_in->>'y_coord')::numeric,
                coalesce((v_seat_in->>'rotation')::integer, 0), v_seat_in->>'label',
                coalesce((v_seat_in->>'is_locked')::boolean, false))
        returning * into v_seat_out;
      end if;
    else
      insert into public.seats (layout_id, x_coord, y_coord, rotation, label, is_locked)
      values (v_layout_uuid, (v_seat_in->>'x_coord')::numeric, (v_seat_in->>'y_coord')::numeric,
              coalesce((v_seat_in->>'rotation')::integer, 0), v_seat_in->>'label',
              coalesce((v_seat_in->>'is_locked')::boolean, false))
      returning * into v_seat_out;
    end if;

    v_keep_ids := v_keep_ids || v_seat_out.id;
    v_out_seats := v_out_seats || to_jsonb(v_seat_out);
  end loop;

  -- Any seat for this layout NOT present in the incoming array was removed
  -- on the canvas — delete it (cascades to its seat_assignments row).
  delete from public.seats
   where layout_id = v_layout_uuid
     and not (id = any(v_keep_ids));

  return jsonb_build_object('ok', true, 'layout', to_jsonb(v_layout), 'seats', v_out_seats);
end;
$$;

create or replace function public.assign_student_to_seat(
  p_seat_id     text,
  p_layout_id   text,
  p_student_id  text default null,
  p_assigned_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  -- This is now a thin convenience wrapper: with a student id it's a manual
  -- move/swap (delegates to manual_move_student), with student_id = null
  -- it's an explicit unassign of whoever currently holds p_seat_id.
  if p_student_id is null then
    return (
      with current_occupant as (
        select student_id from public.seat_assignments
         where seat_id = p_seat_id::uuid
      )
      select public.manual_move_student(
        (select student_id from current_occupant), null, p_layout_id, p_assigned_by
      )
    );
  end if;

  return public.manual_move_student(p_student_id, p_seat_id, p_layout_id, p_assigned_by);
end;
$$;

-- An earlier hand-run migration also created delete_classroom_layout() with
-- p_layout_id typed as `uuid` instead of `text` — same PGRST203 ambiguity
-- as save_classroom_layout() above. Drop the stale uuid-typed overload.
drop function if exists public.delete_classroom_layout(uuid);

create or replace function public.delete_classroom_layout(p_layout_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layout public.classroom_layouts;
begin
  select * into v_layout from public.classroom_layouts where id = p_layout_id::uuid;
  if v_layout is null then
    raise exception 'Layout % not found.', p_layout_id;
  end if;

  -- Ownership guard (Section D) — same legacy-grandfather rule as the other
  -- two write paths above: created_by is null → any staff member may delete
  -- it (pre-existing behavior, preserved); created_by set → owner only.
  if v_layout.created_by is not null and v_layout.created_by is distinct from auth.uid() then
    raise exception 'You do not have permission to delete this layout.';
  end if;

  delete from public.classroom_layouts where id = p_layout_id::uuid;
  return jsonb_build_object('ok', true);
end;
$$;


-- ═════════════════════════════════════════════════════════════════════════
-- SECTION D — OWNERSHIP & ACCESS SCOPING
--   Adds the `created_by` column the spec asks for ("future-proof so adding
--   multiple independent teacher accounts later won't require a database
--   refactor") and tightens read access to match it. The write-side half of
--   ownership enforcement (the actual "staff can only insert/update/delete
--   THEIR OWN layouts" guarantee) was added directly into
--   generate_room_blueprint() / save_classroom_layout() / delete_classroom_
--   layout() above, NOT as table-level RLS — see the note below for why.
--
--   LEGACY DATA: every layout created before this section runs has
--   created_by = null. That is treated everywhere as "ungoverned" — visible
--   and editable by any staff member, exactly like the app behaves today.
--   Only layouts created from now on get a real owner (via the column
--   DEFAULT, and explicitly in the three RPCs' insert statements above).
--   With a single teacher account in production today, this is invisible —
--   every layout they create is, trivially, "their own." The moment a
--   second teacher account exists, new layouts each teacher creates are
--   automatically siloed with zero further migration.
--
--   WHY WRITE ENFORCEMENT LIVES IN THE RPCS, NOT IN NEW RLS POLICIES:
--   Section A already revokes INSERT/UPDATE/DELETE on all three tables from
--   anon AND authenticated and funnels every write through a SECURITY
--   DEFINER RPC (see the file header's SECURITY MODEL note). Table-level
--   write policies would therefore be dead code: Postgres checks the GRANT
--   before it ever evaluates a USING/WITH CHECK clause, so no policy can
--   permit a write a role was never granted in the first place. The
--   equivalent — and, given this app's documented auth.uid()/profiles.id
--   text-cast bug class (see db-service.js's _pushCacheToSupabase comment),
--   the more auditable — enforcement point is the plain SQL ownership check
--   now at the top of each function that mutates a classroom_layouts row.
--
--   This section only adds/updates the READ side (SELECT policies), which
--   genuinely is evaluated by PostgREST as the authenticated role and so is
--   the correct place for "students only see their own class" / "staff only
--   see their own layouts."
--
--   ORDERING NOTE: generate_room_blueprint() (Section B3) and
--   save_classroom_layout()/delete_classroom_layout() (Section C) above
--   already reference created_by even though it's only added down here.
--   That's safe — plpgsql function bodies aren't checked against the schema
--   at CREATE-time, only the first time they're actually called, and this
--   whole file runs to completion (column included) before the app ever
--   calls any of them.
-- ═════════════════════════════════════════════════════════════════════════

alter table public.classroom_layouts
  add column if not exists created_by uuid references auth.users(id) default auth.uid();

create index if not exists classroom_layouts_created_by_idx on public.classroom_layouts (created_by);

-- ── Shared visibility check, reused by all three SELECT policies below ────
-- security definer so it can read profiles.role / profiles.class_id
-- regardless of whatever profiles' own RLS says (mirroring how is_staff()-
-- style helpers already work elsewhere in this project) — the comparison
-- against profiles.id (text) uses the documented ::text cast on auth.uid()
-- (uuid) to avoid the exact "operator does not exist: text = uuid" class of
-- bug already on file in db-service.js's _pushCacheToSupabase comment.
create or replace function public._classroom_layout_visible(p_layout_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.classroom_layouts cl
     where cl.id = p_layout_id
       and (
         -- Staff: their own layouts, plus any legacy (unowned) layout.
         (
           exists (
             select 1 from public.profiles
              where id = auth.uid()::text and role in ('admin', 'teacher')
           )
           and (cl.created_by is null or cl.created_by = auth.uid())
         )
         or
         -- Students: any layout belonging to their own class, regardless
         -- of which teacher created it.
         cl.class_id in (
           select class_id from public.profiles where id = auth.uid()::text
         )
       )
  );
$$;

drop policy if exists classroom_layouts_select_all on public.classroom_layouts;
create policy classroom_layouts_select_scoped on public.classroom_layouts
  for select using (public._classroom_layout_visible(id));

drop policy if exists seats_select_all on public.seats;
create policy seats_select_scoped on public.seats
  for select using (public._classroom_layout_visible(layout_id));

drop policy if exists seat_assignments_select_all on public.seat_assignments;
create policy seat_assignments_select_scoped on public.seat_assignments
  for select using (public._classroom_layout_visible(layout_id));

-- ── Close the matching write-side gap: these RPCs were grantable to `anon`
-- (i.e. callable by a request carrying only the public anon key, no signed-
-- in session at all), which made every ownership check above moot for an
-- unauthenticated caller — auth.uid() is null for anon, and the guards
-- already added (and documented as NULL-safe via IS DISTINCT FROM) correctly
-- reject that, but it's cleaner to also stop offering the capability to
-- anon in the first place. The app never calls any classroom RPC before a
-- real Supabase Auth session exists (every classroom page is behind
-- bootApp(), which only runs after doLogin() succeeds), so this should be
-- invisible in normal use. If you have a legitimate anon-write flow this
-- project doesn't show me, re-grant the specific function(s) you need.
-- NOTE: this is handled by narrowing the GRANTS block immediately below to
-- `authenticated` only (rather than a revoke statement here), because a
-- revoke executed at this point in the file would simply be undone by the
-- original `grant ... to anon, authenticated` statement that already
-- follows it further down — GRANT/REVOKE apply in statement order, same as
-- any other SQL.


-- ═════════════════════════════════════════════════════════════════════════
-- GRANTS
-- ═════════════════════════════════════════════════════════════════════════
-- `authenticated` only (no `anon`) as of Section D — see the write-side
-- explanation up there. SELECT grants on the three tables (Section A) are
-- untouched and still include anon; that stays harmless now that the
-- _select_scoped policies return zero rows for any caller without a real
-- session.
grant execute on function
  public.save_classroom_layout(text, text, text, jsonb, jsonb),
  public.assign_student_to_seat(text, text, text, text),
  public.delete_classroom_layout(text),
  public.generate_room_blueprint(text, text, text, text, integer, integer, numeric, text),
  public.manual_move_student(text, text, text, text),
  public.auto_allocate_remaining(text, text[], text, text),
  public.set_seat_lock(text, boolean)
to authenticated;
