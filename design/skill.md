---
name: spotlight-dark-design
description: Apply the "Spotlight Dark" visual design system (dark cinematic SaaS aesthetic with radial godray backgrounds, glassmorphic cards, pill buttons, and monochrome-plus-accent color language) reverse-engineered from an aura.build creative-portfolio template. Use this skill whenever the user asks to design, mock up, or restyle a page, landing page, dashboard, or component in this specific dark/premium/cinematic style — including phrases like "dark mode SaaS design," "that spotlight background look," "glassmorphic dark UI," or when they reference this template/skill by name. This is a DESIGN skill only: it governs visual decisions (color, type, layout, spacing, component styling) — it does not itself write code.
---

# Spotlight Dark — Design Skill

A design system skill for producing new page designs (wireframes, mockups, component specs, or design descriptions) that visually match the "Spotlight Dark" aesthetic documented in `design.md`.

Use this skill to make **design decisions** — what a new hero, feature section, dashboard, or footer should look like in this language — not to generate implementation code. If the user later asks for actual code/markup, treat this skill's output as the spec to hand off to that step, but stay in "designer" mode here: describe colors, type, spacing, and composition, not HTML/CSS/JS.

## When to reach for `design.md`

Always read `design.md` (bundled alongside this file) before producing a new design in this style — it contains the full color palette (with values), type scale, component specs, layout patterns, and the signature background treatment. Don't reconstruct the system from memory; the values in `design.md` are the source of truth.

## Core non-negotiables (the "signature" of this style)

If a new page design doesn't have these, it isn't actually in this style — always include them:

1. **The spotlight background.** A faint radial burst of grayscale rays from a point near top-center, present behind every section, not just the hero. This is the single most identity-defining element — never drop it, never recolor it.
2. **Near-black base (`#000000`–`#0A0A0A`) with cards one step lighter (`#141414`–`#1B1B1B`).** Never use pure gray or colored section backgrounds.
3. **Pill-shaped buttons only.** Primary = solid white/black text; secondary = outlined/transparent + white text. No square or slightly-rounded buttons.
4. **Grayscale-first UI, color as punctuation only.** Green for success/positive, violet for identity/avatars, iridescent gradients ONLY in decorative imagery — never as UI chrome, never as a wash across a whole section.
5. **Two-tone headlines.** Use white + muted-gray lines within the same headline block to build hierarchy instead of (or in addition to) size changes.
6. **Everything floats.** Cards, product mockups, and decorative imagery should be composed with shadow/overlap/slight rotation to feel like physical objects over the black void — flat, edge-to-edge blocks break the style.

## Workflow for applying this skill

1. **Clarify the section(s) needed** (hero, feature grid, dashboard preview, footer, CTA band, pricing, testimonials, etc.) if not already specified.
2. **Pull the relevant component spec(s) from `design.md`** — e.g. feature grid = 3×2 card grid with mini-mockup + title + description per card.
3. **Compose the layout** following the grid/spacing rules in `design.md` section 4, keeping the spotlight background and card treatment consistent with sections 6 and 5.
4. **Apply typography** per section 3 — bold large headlines with the two-tone technique where it fits, gray body copy, consistent label sizing for micro-elements.
5. **Choose accent color deliberately** — only introduce green/violet/iridescent where it's communicating something (success, identity, decoration), never as arbitrary brand color.
6. **Sanity-check against the 6 non-negotiables above** before presenting the design.

## Output format

When asked to "design" a page or section in this style (and not asked for code), produce:
- A clear written/structural description of the layout (what's where, in what order, at what approximate proportions)
- Specific color, type, and spacing values pulled from `design.md`
- Component-level detail for anything reused from the system (buttons, cards, badges, nav)
- Where relevant, a `visualize:show_widget` diagram/mockup (SVG or HTML/CSS) can be used to actually render the proposed design inline, following the sizing/palette rules above and the general Visualizer mockup guidance — read the mockup `read_me` module before doing so.

If the user does ask for real code afterward, treat everything above as the accepted design spec and implement against it exactly (matching hex values, radii, and spacing verbatim) rather than reinterpreting the style from scratch.

## Reference

- `design.md` — full design system: palette, type scale, layout grid, component specs, and the spotlight background treatment. Always consult before designing.
