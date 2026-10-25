# Nocturne — black and white design system

The shared presentation now covers student, teacher and admin views. Earlier phases established the student layouts; the current palette and local icon system apply across all roles, including dynamically rendered staff tools and dialogs.
The entry page enables `theme-nocturne`; `styles/modules/nocturne.css`
loads last so feature pages can be converted incrementally without deleting
working layout rules. The classic dashboard, build input, and ESM twin are
kept in sync.

- Near-black surfaces (#090909 / #121212), white text, quiet neutral
  borders and solid white (#f2f2f2) primary actions. No warm or colored accent. No global grayscale filter: photos,
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

## Shared presentation boundary

`modules/shared/presentation.js` applies the shared design to legacy renderers
without altering service APIs or stored records. It batches new DOM subtrees,
replaces decorative symbols and Material icon-font names with a closed local
SVG registry, and maps known legacy colors in inline styles and local stylesheets
onto the monochrome palette. Source-module and classic-script versions are kept in sync.

No whole-page grayscale filter is used. Editable values, marked user prose,
profile-name containers, artwork URLs, avatars, custom badge previews, and live
seat/attendance data are protected. The interface renders attendance in neutral
border patterns with visible status text; stored color metadata is unchanged. Original icon metadata in saved records
is not rewritten. Existing status labels remain visible. Styles loaded later by
staff tools receive the same treatment; cross-origin font stylesheets are ignored.
New pages can use `uiIcon(name)` and design tokens directly rather than depend on
legacy adaptation. Layout and role authorization remain owned by their modules.

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
  shape as well as tone, and attendance states retain explicit text labels.
- Inventory details, cart and claim-code displays retain their original
  actions; claim codes wrap safely on narrow screens. No live checkout or
  Supabase write is performed by the fixture browser checks.
- Browser checks now cover inventory details, adding an item to the cart,
  opening the cart and a claim code at 320px, plus the original layout checks.

## Application-wide verification

`node tests/browser/application-theme.cjs` boots the actual app with external
services blocked, seeds local fixture data, and checks 48 page visits across
admin, teacher and student at phone/desktop widths. This covers navigation,
Command Center, Sections, staff store/quest builder, scanner, classroom builder
and monitor, settings, and all student navigation destinations. It also verifies
idempotent decoration, late-injected styles, local SVG navigation, and protected
profile text, draft values, photos, selected options and attendance colors.
No live login, purchase, scan hardware or hosted Supabase write is exercised.

## Monochrome refinement

The interface now uses black backgrounds, white actions, finer tonal borders
and less visual weight in cards. The local SVG icon system and sans-serif
typography remain. UI color declarations are neutralized without image filters;
artwork URLs, profile photos, protected custom art, form values and records are
not rewritten. Live Monitor shows each student's attendance status in text;
solid, dashed, dotted and double borders distinguish attendance states without
relying on hue. Classroom selection and locked-seat markers remain visible.
The full-app check asserts neutral header styling and visible attendance labels.
