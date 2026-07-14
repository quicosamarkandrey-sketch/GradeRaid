-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 62 — Improvement Plan §12 item 7: Mascot / Narrator
--   Admin-editable line pools (§6: "Admins can add/edit custom lines per
--   event and per stage through an admin panel... layered on top of a
--   built-in default pool so the mascot always has something to say even
--   with zero admin customization").
--
-- Run once in the Supabase SQL editor, after Phase 61.
--
-- DESIGN — deliberately a single JSONB blob, not a normalized per-line
-- table with individual insert/delete RPCs. Mirrors school_settings exactly
-- (phase40_governance_audit_and_settings.sql): one singleton row, one open
-- read RPC, one admin-only write RPC that replaces the whole blob. Chosen
-- because:
--   - The full custom-lines object is tiny (a few dozen short strings at
--     most) — no pagination/lookup need that would justify per-row RPCs.
--   - The admin UI (modules/admin/mascot-lines.js) already has to hold the
--     whole structure in memory to render "your custom lines per event/
--     stage" in one screen; saving it as one blob avoids a save-per-line
--     round trip every time an admin adds/removes a single line.
--   - get_mascot_line_settings() must be readable by STUDENTS (the quiz
--     screen needs it to build eqMascotLinePool()'s custom half) as well as
--     admins — same openness as get_school_settings()/get_dsm_settings().
--
-- Shape of custom_lines (matches MASCOT_DEFAULT_LINES in utils.js):
--   {
--     "start": ["..."], "retry": ["..."],
--     "correct": {"0":["..."],"1":["..."],"2":["..."]},
--     "wrong":   {"0":["..."],"1":["..."],"2":["..."]},
--     "milestone": ["..."],
--     "stageTransition": {"1":["..."],"2":["..."]},
--     "lowTime": {"0":["..."],"1":["..."],"2":["..."]},
--     "pass": ["..."], "fail": ["..."]
--   }
-- Client-side eqMascotLinePool() (utils.js) treats any missing/malformed
-- key as an empty array, so a partially-filled blob (or the pre-migration
-- default of '{}') never errors — it just contributes nothing on top of
-- the shipped defaults.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.mascot_line_settings (
  id           boolean primary key default true, -- singleton row, enforced below
  custom_lines jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  updated_by   text references public.profiles(id),
  constraint mascot_line_settings_singleton check (id = true)
);

insert into public.mascot_line_settings (id) values (true)
on conflict (id) do nothing;

alter table public.mascot_line_settings enable row level security;
revoke all on public.mascot_line_settings from anon, authenticated;
-- RPC-only, same convention as school_settings/dsm_settings — no select
-- policy; reads go through get_mascot_line_settings() below.

create or replace function public.get_mascot_line_settings()
returns public.mascot_line_settings
language sql
security definer
stable
set search_path = public
as $$
  select * from public.mascot_line_settings where id = true;
$$;
grant execute on function public.get_mascot_line_settings() to anon, authenticated;

create or replace function public.save_mascot_line_settings(
  p_custom_lines jsonb
)
returns public.mascot_line_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.mascot_line_settings;
begin
  if not public.is_admin() then
    raise exception 'not authorized to change mascot lines';
  end if;

  if p_custom_lines is null or jsonb_typeof(p_custom_lines) <> 'object' then
    raise exception 'custom_lines must be a JSON object';
  end if;

  update public.mascot_line_settings
     set custom_lines = p_custom_lines,
         updated_at   = now(),
         updated_by   = auth.uid()::text
   where id = true
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.save_mascot_line_settings(jsonb) to anon, authenticated;
