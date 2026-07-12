-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 52 — TITLES: ADD THE MISSING DESIGNER V3 COLUMNS
--
-- Run once in the Supabase SQL editor, after Phase 51.
--
-- THE BUG
--   "Frame shape doesn't save — refresh reverts to Classic."
--
--   public.titles (Phase 18) was built for the ORIGINAL title styling
--   model: text/border/glow/bg/primary/secondary colors, a gradient, a
--   border_style, an animation, particles, a bg_effect, and raw custom-CSS
--   overrides. The MMORPG Title Designer v3 (modules/titles/titles_designer.js
--   + titles_badge_renderer.js) that superseded it added FIVE more fields to
--   every title draft — frameShape, frameStyle, accentColor, effect, and
--   frameTemplate (see tsDefaultTitle() in titles_badge_renderer.js) — but
--   nobody added matching columns to this table, and nobody added them to
--   db-service.js's push/pull mapping for the `titles` table either.
--
--   Net effect: tsAdminSave() writes the full draft — including the frame
--   you picked — into the LOCAL cache just fine, so it looks correct until
--   the next sync. The next push to Supabase (_pushTable('titles', ...) in
--   db-service.js) builds its row from a field list that simply doesn't
--   mention those 5 keys, so they're silently dropped from what's sent.
--   The next full load pulls titles back FROM Supabase — which never had
--   them — so title.frameShape comes back undefined, and
--   tsBuildBadgeHTML()'s fallback chain (`title.frameShape ||
--   title.frameTemplate || title.borderStyle || 'classic'`) lands on
--   'classic', the very first entry in TS_FRAME_SHAPES_REGISTRY. Same story
--   for frameStyle ('none'), accentColor, and effect ('none') — every one
--   of them quietly resets on refresh, not just the frame shape.
--
-- THE FIX (this file)
--   Add the 5 missing columns to public.titles, matching tsDefaultTitle()'s
--   own defaults so any row saved before this migration (frame fields
--   NULL) renders exactly the same as it did a moment after being created,
--   before ever being lost: 'classic' shape, 'none' style, 'none' effect,
--   'solid' template. accent_color is left NULL — the renderer already
--   falls back to gradientTo or a fixed color when it's unset
--   (titles_badge_renderer.js, `title.accentColor || gradTo || '#fde047'`),
--   so there's no single "right" default to force here.
--
--   The matching JS fix (db-service.js push/pull mapping) is a separate,
--   same-commit change — this migration alone does not resync existing
--   rows' frame data; anything saved before both halves of this fix land
--   still needs to be re-saved once from the Designer to populate these
--   columns for the first time.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.titles
  add column if not exists frame_shape    text default 'classic',
  add column if not exists frame_style    text default 'none',
  add column if not exists accent_color   text,
  add column if not exists effect         text default 'none',
  add column if not exists frame_template text default 'solid';

-- Backfill existing rows explicitly (add column if not exists with a
-- DEFAULT only applies the default going forward on some Postgres
-- versions' fast-path; this makes sure every pre-existing title is
-- unambiguously 'classic/none/none/solid' rather than NULL, matching what
-- it was actually rendering as before this fix).
update public.titles
   set frame_shape    = coalesce(frame_shape, 'classic'),
       frame_style    = coalesce(frame_style, 'none'),
       effect         = coalesce(effect, 'none'),
       frame_template = coalesce(frame_template, 'solid')
 where frame_shape is null or frame_style is null or effect is null or frame_template is null;

-- No RLS/grant changes needed — titles_select_all / titles_staff_write
-- (Phase 18) apply at the row level, not per-column.
