# Design System — "Spotlight Dark" (aura.build creative-portfolio-87 reference)

> Reverse-engineered from screenshots of the live template. This document captures the visual language so it can be reapplied consistently to new pages. It describes **design only** — no markup or code.

---

## 1. Concept & Mood

A premium, dark, cinematic SaaS/product aesthetic. The defining signature is a **radial spotlight / godray burst** that emanates from a fixed point near the top-center of the viewport and fans downward across the entire page, sitting behind every section like a stage light hitting a dark set. This single recurring background effect is what visually unifies otherwise very different sections (hero, dashboard preview, feature grid, footer, CTA band).

Mood words: cinematic, premium, confident, minimal, futuristic, editorial, quiet-luxury-tech.

---

## 2. Color Palette

| Role | Value | Notes |
|---|---|---|
| Base background | `#000000` – `#0A0A0A` | True near-black, consistent site-wide |
| Spotlight rays | `rgba(255,255,255,0.03–0.08)` | Soft radial/conic gradient rays, grayscale only, very low opacity — never colored |
| Card surface | `#141414` – `#1B1B1B` | Slightly lifted off the base black |
| Card border | `rgba(255,255,255,0.08–0.12)` | Hairline 1px, barely-there separation, glass-like |
| Primary text | `#FFFFFF` | Headlines, key labels |
| Secondary text | `#9A9A9A` – `#A8A8A8` | Body copy, nav links, descriptions |
| Muted text | `#6E6E6E` | Timestamps, tertiary labels |
| Success / positive accent | `#3ECF8E`-ish green | Used sparingly: "Passed" badges, positive $ deltas, checkmarks |
| Identity accent | Violet/purple `#7C6CF0`-ish | User/workspace avatar badges only |
| Decorative iridescent | Holographic rainbow gradient (cyan→magenta→gold) | Used ONLY inside decorative 3D render imagery, never in UI chrome |
| Primary button | White fill `#FFFFFF` / black text `#000000` | Highest-contrast element on the page |
| Secondary button | Transparent/dark fill + white text + 1px subtle border | |

**Rule of thumb:** the UI itself is almost entirely grayscale. Color is reserved for (a) semantic states — green = positive/success, violet = identity — and (b) decorative imagery, never structural chrome.

---

## 3. Typography

- **Typeface:** Modern geometric/grotesk sans-serif (Inter / Geist / similar). Clean, no personality quirks — lets the layout and lighting carry the drama.
- **Headline weight:** Bold–Extrabold (700–800), tight line-height (~1.05–1.1), tight letter-spacing.
- **Headline scale:** Very large — 48–80px depending on section (hero largest, section intros smaller).
- **Two-tone headline technique:** within a single headline block, some lines are pure white and others are muted gray (`#7A7A7A`) — used to create hierarchy/contrast without changing size or weight. E.g. three bold white lines followed by one gray line of equal size.
- **Body copy:** Regular weight, 15–18px, gray (`#9A9A9A`), generous line-height (~1.5–1.6), always noticeably smaller and lower-contrast than headlines.
- **Card titles:** Bold white, 18–20px.
- **Nav links:** Regular, 14–15px, gray, mixed case (not uppercase), with small chevron glyphs on dropdown items.
- **Micro-labels** (badges, tags, stat labels): 11–13px, gray, sometimes letter-spaced slightly wider for a "label" feel.

---

## 4. Layout & Grid

- **Nav:** Fixed/sticky top bar, transparent (sits directly over the spotlight background, no solid bar fill). Three-zone layout: logo left, nav links + dropdown chevrons centered/left-of-center, auth actions right (ghost "Login" + solid pill primary CTA with trailing arrow →).
- **Hero variants seen:**
  1. *Split hero:* large stacked headline + CTAs + checklist on the left (roughly 45% width), a scattered "gallery" collage of tilted image tiles on the right (55% width).
  2. *Centered hero:* headline + subhead centered, CTAs centered below, with a floating product-screenshot mockup centered beneath everything, slightly overlapping the next section.
- **Feature grid:** 3-column × 2-row grid of cards (responsive to 1-column on mobile). Each card = mini UI mockup on top (~60% of card height) + title + 2-line description below.
- **Dashboard/product mockups:** Presented as a single large "floating" panel — rounded corners (~20–24px), soft drop shadow, sits centered and slightly overlapping the section above/below it, implying depth against the spotlight backdrop.
- **Footer:** 4-column grid — brand column (logo + 1–2 line tagline) + three link columns (headed by a bold white label, links below in gray, ~12–16px vertical rhythm between links).
- **CTA band (pre-footer):** A single large rounded card (24px radius), centered content, sits on its own darker/inset panel distinct from the pure-black page background, with the spotlight rays still visible through it (semi-transparent glass effect).

**Spacing:** Generous. Sections breathe — large vertical padding (100–160px) between major sections despite the visual density of the dark palette.

---

## 5. Components

### Buttons
- **Primary:** Fully rounded (pill, `border-radius: 999px`), solid white fill, black text, medium-bold weight, often paired with a trailing → arrow glyph. Comfortable padding (~14px vertical / 28px horizontal).
- **Secondary:** Same pill shape, transparent or near-black fill, white text, 1px subtle white-alpha border. No arrow.
- **Ghost/nav "Login":** Text-only or thin-outline pill, smaller than primary CTA.

### Cards
- Rounded corners: 16–24px depending on card size (bigger card = bigger radius).
- Background: `#141414`–`#1B1B1B`, one step lighter than page background.
- Border: hairline, near-invisible, white at ~10% opacity — reads as "glass edge" rather than a hard line.
- No heavy shadows on flat cards; shadows appear mainly on *floating/overlapping* elements (product mockups, collage tiles) to imply z-depth.

### Badges / Pills
- Small rounded-full tags, e.g. status labels ("Passed" in green), notification counters ("2 NEW UPDATES"), workspace/avatar chips (colored circle + initials).
- Low-contrast dark fill with a colored dot/icon for semantic meaning, or a solid brand-colored circle avatar for identity.

### Iconography
- Thin, minimal line icons.
- Monochrome gray by default; only accent-colored when communicating state (green check, colored avatar).
- Sidebar/nav icons are small (~18–20px), evenly spaced, no labels unless active.

### Decorative imagery
- Abstract, glossy/holographic 3D renders (rings, chrome boxes, crystalline shapes, iridescent blobs) — used purely as atmosphere, arranged in a tilted, overlapping "scattered photo" collage in hero sections.
- Product screenshots (dashboards, forms, terminals) are treated the same way structurally — rounded frame, drop shadow, floating over the spotlight backdrop — whether they're "real" UI or decorative.

### Data displays (dashboard mockup)
- Stat cards: label (small gray) + big bold number, optional trend icon.
- Activity/transaction rows: icon avatar + name/time (two-line) + category tag + amount (green if positive, white if neutral/negative).
- Charts: simple grayscale-gradient bar charts, minimal axis labels, one bold callout number above the chart.
- Tabs: text label with a thin underline indicating active state, inactive tabs muted gray.

---

## 6. Signature Background Treatment (the "Spotlight")

This is the single most important, must-replicate element:

- A radial burst of thin, faint rays originates from a single point near top-center of the viewport (roughly 50% horizontal, near the very top, sometimes above the visible frame).
- Rays are pure grayscale/white at very low opacity, fanning outward and downward like light through fog or a theater spotlight.
- The effect is present (at reduced/varied intensity) behind *every* section, not just the hero — this continuity is what makes the page feel like one cohesive dark "stage" rather than separate colored blocks.
- No other background texture, gradient hue, or pattern is used — the rays are the entire background language.

---

## 7. Motion & Interaction (implied, not directly visible)

Not visible in static screenshots, but consistent with this design language and safe to assume for future pages:
- Buttons: subtle brightness/scale on hover.
- Cards: slight lift/border-brighten on hover.
- Collage tiles: gentle parallax or float animation.
- Tabs/toggles: underline or fill slides on active state change.

---

## 8. Design Principles Summary

1. **Monochrome first, color as punctuation.** Grayscale carries 95% of the UI; green/violet/iridescent only appear for meaning or pure decoration.
2. **One background motif, everywhere.** The spotlight rays are the connective tissue across all sections.
3. **Contrast does the hierarchy work.** White vs. gray text, not size alone, separates emphasis from support.
4. **Everything floats.** Cards, mockups, and collage imagery all read as physical objects with depth (shadow, rotation, overlap) against a flat black void.
5. **Pills everywhere for actions, rounded rectangles for containers.** Consistent radius language: fully-round for buttons/badges, 16–24px for cards/panels.
6. **Generous air.** Despite the dark, dense visual style, spacing between sections and elements stays large and calm.
