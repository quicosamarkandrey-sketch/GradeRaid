# Nocturne design direction

Phases 1–2 establish shared chrome, controls, the student dashboard, My Section, Inventory/Armory, and My Progress.
The entry page enables `theme-nocturne`; `styles/modules/nocturne.css`
loads last so feature pages can be converted incrementally without deleting
working layout rules. The classic dashboard, build input, and ESM twin are
kept in sync.

- Charcoal surfaces (#101112 / #191a1c), quiet structural borders, warm white
  text and restrained silver emphasis. No global grayscale filter: photos,
  artwork and meaningful status colors retain their own rendering.
- System sans-serif (Inter when available, then Segoe UI / Arial) for headings,
  controls and body text; monospace only for identifiers/numbers. No serif
  headings or new font download.
- Solid white primary actions, outlined secondary actions, visible keyboard
  focus, 44px primary touch targets, and muted semantic success/danger styles.
- Static, decorative inline SVG icons on the dashboard, with readable text
  labels. No emoji section markers, random subject emoji, neon glows, clipped
  button corners, ambient particle loop, or scanning overlay on that page.
- Existing phone density rules remain in place. Sidebar collapse and the
  active-raid header stay responsive.

## Next conversion phases

1. Remaining student feature pages, including quest details and dialogs.
2. Teacher/admin classroom tools and remaining staff pages.

Shared tokens/chrome apply now; the remaining feature pages are not claimed
as fully converted. Preserve state labels, authorization, reward
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

## Phase 2 notes

- Section and catalog cards use monochrome surfaces, category line icons,
  numeric class ranks, and preserved student photographs. Stored item emoji
  and redemption data are left unchanged; these pages render UI pictograms.
- Progress cards, all five tabs, empty states, milestones and the academic
  showcase share the new surfaces and typography. Calendar dots differ by
  shape as well as tone, and absent states retain a muted red label.
- Inventory details, cart and claim-code displays retain their original
  actions; claim codes wrap safely on narrow screens. No live checkout or
  Supabase write is performed by the fixture browser checks.
- Browser checks now cover inventory details, adding an item to the cart,
  opening the cart and a claim code at 320px, plus the original layout checks.
