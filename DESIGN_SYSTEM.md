# Nocturne — black-led design system

The shared presentation now covers student, teacher and admin views. Earlier phases established the student layouts; the current palette and local icon system apply across all roles, including dynamically rendered staff tools and dialogs.
The entry page enables `theme-nocturne`; `styles/modules/nocturne.css`
loads last so feature pages can be converted incrementally without deleting
working layout rules. The classic dashboard, build input, and ESM twin are
kept in sync.

- Near-black surfaces (#090909 / #121212), white text, quiet neutral
  borders and solid white (#f2f2f2) primary actions. Selective white cards
  create emphasis; restrained green, amber, red and blue communicate state. No global grayscale filter: photos,
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
onto the restrained interface palette. Source-module and classic-script versions are kept in sync.

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

## Functional color and selective light cards

The shell remains predominantly black with white navigation and controls.
The student overview and staff motivation card are light surfaces with scoped
dark text, borders and inverted primary actions. Other operational panels stay
dark. Success/present uses muted green, warning/late uses amber, error/absent
uses red, and information/excused uses blue. Attendance labels and border
patterns remain, so hue is an additional signal.

The presentation adapter maps known decorative legacy colors instead of
converting every unknown color to grayscale. Functional and data colors are
preserved. Dashboard attendance and quiz summary colors follow their numeric
values; stored statistics and business logic are unchanged. Browser checks
verify light-card contrast, semantic actions and attendance color alongside
the existing navigation, user-content and mobile checks.

### Appearance modes and monitor clarity

The top-bar sun/moon button switches the whole app between dark and light modes,
and saves `eduquest-color-mode` locally. Dark remains the default. Legacy neutral
CSS and inline colors use reversible neutral tokens; no page-wide image filter is
applied. White dashboard feature cards keep their own dark text in either mode.
Semantic green, amber, red and blue adapt to light backgrounds for readable states.

Present seats use a stronger emerald border and tinted fill. The text beneath
student names is removed; hover titles and accessible seat names retain attendance
information. Dashed, dotted and double borders still distinguish attendance states.
Recitation/selection highlights take priority over attendance borders. Shared UI
icons use emoji for dashboard decorations and other controls, while sidebar
navigation and sign-out use local line icons in both themes. Uploaded photos,
custom content, QR graphics and game art retain their original rendering.

### Classroom interaction controls

- Live Monitor attendance chips highlight matching seats; All clears the highlight.
  Totals include the whole class, and the status line identifies students without
  a seat. These display filters never alter attendance records or picker eligibility.
- Projection view hides the staff sidebar and individual scores by default. The
  Show scores checkbox explicitly reveals them. Escape exits projection, then
  fullscreen. Leaving Live Monitor clears its projection privacy classes.
- Fullscreen and viewport resize fit the bounds of the actual seats. Center & fit
  resets zoom/pan; plus/minus adjust size, and dragging empty space pans the view.
  Viewing transformations never change stored seat positions.
- Build mode offers optional 10/20/40px grid snapping, visible drag guides, alignment
  for two or more selected seats, and even spacing for three or more. These edits
  participate in the existing undo/redo history and save through the existing Save.
- Assign mode supports pointer dragging on mouse/touch, with a destination preview,
  and select-then-select moves/swaps using click, Enter or Space. Selecting a student
  no longer unseats them. Return to unassigned is explicit. Assignments save
  immediately through the existing atomic manualMoveStudent RPC; failed saves
  retain the current assignments. Build positions remain unchanged.

Validation: `node tests/browser/classroom-tools.cjs` boots the real app offline,
intercepts RPC calls with fixture responses, and checks these interactions without
writing to a hosted backend. The existing application-theme and seating-editor
checks cover themes, role routes and the earlier multi-selection/history controls.

### Student dashboard shortcuts

Dashboard shows participation points and the number of recorded contributions, with
an explicit shortcut that opens the existing My Progress page on Recitation History.
Repeated dashboard ranking, goal and statistic widgets are removed. Empty quest lists
say No available quests. My Progress and Hall of Fame retain their previous versions,
including all five progress tabs and the existing rankings presentation and scope.

Browser validation: `node tests/browser/student-learning.cjs` checks dashboard totals,
direct links into the restored progress tabs, Hall of Fame navigation, responsive
layouts and both themes. Fixture checks verify that records and unlocks are unchanged.

### Shared application foundation

`styles/modules/application-ui.css` loads last and uses appearance tokens directly
(`data-preserve-theme`). It standardizes the existing pages rather than replacing
page structures. My Progress and Hall of Fame retain their restored renderers.

- System sans-serif typography, restrained heading weights, sentence-case form
  labels, consistent section spacing and a quieter shared page-header treatment.
- Controls use 8px corners, cards 12px, dialogs 14px. Primary/secondary/destructive
  actions remain distinguishable. Touch controls are at least 44px; phone text
  fields use 16px text to avoid automatic browser zoom.
- Dark and light modes share geometry and use their own readable surface/control
  colors. Attendance, selection and recitation state colors remain intact.
- Functional controls and navigation use the closed local SVG registry. Emoji in
  reward imagery and celebrations remain. Uploaded pictures, game art, custom
  badges, form values and user prose are protected from presentation rewriting.
- Single-field form groups receive missing label associations. Existing IDs,
  explicit labels and input values are retained. Invalid fields have a visible
  semantic error border; no validation or save rules are changed.
- Shared dialogs have an accessible name, initial focus, Tab/Shift+Tab containment,
  Escape dismissal and focus restoration. The profile trigger is a native button,
  active navigation exposes aria-current, and toast messages use a polite status
  region. Tool shortcuts respect a dialog's handled Escape key.
- Staff quick-action descriptions use concrete wording such as Record attendance
  and Arrange seats and students.

`tests/browser/application-ui.cjs` checks label associations, icons, dialog focus,
contrast, target sizes, phone inputs, both modes, reduced motion and toast semantics
in the real app with external services blocked. The application-theme, classroom,
student-mobile and dashboard regression checks cover the existing workflows.

### Recitation award feedback

The floating +N indicator uses a compact monochrome chip that adapts to dark/light
mode. A short rise/fade, restrained total-number pulse and thin avatar ring replace
the orange glow and oversized floating text. Point-selection controls and history
point labels use the same neutral palette. Rapid awards in the same paint combine
into one chip. Effects clean up after completion, remain static for reduced motion,
and are suppressed when projection scores are private. Animation does not write
points or change the displayed session total.

`node tests/browser/recitation-count.cjs` checks both themes, readable contrast,
rapid-award grouping, unchanged records/totals, cleanup, reduced motion and privacy.
