# Nocturne design direction

Phase 1 establishes shared chrome, controls and the student dashboard.
The entry page enables `theme-nocturne`; `styles/modules/nocturne.css`
loads last so feature pages can be converted incrementally without deleting
working layout rules. The classic dashboard, build input, and ESM twin are
kept in sync.

- Charcoal surfaces (#101112 / #191a1c), quiet structural borders, warm white
  text and restrained silver emphasis. No global grayscale filter: photos,
  artwork and meaningful status colors retain their own rendering.
- Georgia for editorial headings, system sans-serif for controls and body
  text, monospace only for identifiers/numbers. No new font download.
- Solid white primary actions, outlined secondary actions, visible keyboard
  focus, 44px primary touch targets, and muted semantic success/danger styles.
- Static, decorative inline SVG icons on the dashboard, with readable text
  labels. No emoji section markers, random subject emoji, neon glows, clipped
  button corners, ambient particle loop, or scanning overlay on that page.
- Existing phone density rules remain in place. Sidebar collapse and the
  active-raid header stay responsive.

## Next conversion phases

1. My Section, Inventory/Armory and My Progress: migrate their hardcoded
   surfaces, illustrations and accents onto this foundation.
2. Remaining student feature pages, including quest details and dialogs.
3. Teacher/admin classroom tools and remaining staff pages.

Shared tokens/chrome apply now; those pages' feature-specific visuals are
not claimed as fully converted. Preserve state labels, authorization, reward
logic, and meaningful user-supplied images during future conversions.

## Validation

- `npm run test:unit` — 185 passed.
- `node tests/browser/nocturne.cjs` — real renderers and shared header with
  fixture data at 320/390/768/1440px; styling, overflow, active-raid header,
  keyboard focus, and quest/Armory/reward action dispatch.
- `node tests/browser/student-mobile.cjs` — five student pages at six widths,
  every progress tab at 320px, inventory filtering/history, and unchanged
  desktop geometry when mobile-specific rules are disabled.

Browser checks self-host their assets and use system Chromium, overridable
through `CHROMIUM_PATH`. They do not authenticate against Supabase or exercise
live account data. Screenshots use sample students and rewards.
