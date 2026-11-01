# Title presentation refresh

Titles keep their own colors and character. Badge plates now have a readable foreground, text-only nameplates, restrained frame artwork and lighter glow. Existing shapes, custom colors, effects, animations and saved title data are retained. Text that fails contrast against a supported hex background gets a readable display color without rewriting the stored title. Small/xs versions use fewer effects for compact profile, sidebar and leaderboard contexts. Reduced-motion settings stop badge animation.

The student Titles tab has an equipped-profile showcase, All / Unlocked / To unlock filters, search, full title names and requirements, and a preview showing full/small/xs sizes. Equipped titles and unlocked titles appear first. Locked previews explain the requirement and provide no equip action. Inactive titles are excluded from the count. Achievement-linked title discovery now follows the linked achievement's section assignment; already-unlocked titles remain visible across later section reassignment.

Badges/Titles tabs use tab roles, keyboard arrows/Home/End and preserve the selected tab through refreshes. Unlock notifications lead directly to Titles. Equipping still uses the existing service and RPCs; this refresh does not award XP, coins or unlocks.

The teacher designer gains four optional palettes: Cobalt Scholar, Emerald Sage, Golden Luminary and Stellar Mind. They are templates, not automatically created titles. Compact samples display at actual size, and the mobile live preview moves above the controls. Shape/template pickers support keyboard activation. New title defaults use a deep blue palette; existing catalog records are unchanged until the teacher saves an edit.

The visual refresh needs no database migration. Classic and ESM source twins and role bundle entries are updated. Optional collection metadata and award history require the migration described below.

Validation:

- `npm run test:unit` — includes contrast recovery, compact effects and escaped title markup.
- `node tests/browser/titles-refresh.cjs` — actual app at 320/390/1440 in both themes; collection/search/filter/scope, previews, equip/unequip without reward/catalog/unlock mutations, keyboard tabs/designer, reduced motion and responsive layout. External services are intercepted.
- `node tests/browser/application-theme.cjs` — shared page/theme regression.
- `node tests/browser/student-learning.cjs` — existing dashboard, Progress and Hall of Fame navigation.
- `npx esbuild build/entry.full.js --bundle --outfile=/tmp/graderaid-titles.js`

Emoji icons are no longer rendered on title nameplates, title unlock notifications, title reward rows or designer controls. The designer uses text labels and existing vector frame previews. The obsolete icon input is removed; stored legacy icon fields are retained for compatibility. User-authored title names and reward/unlock data are preserved.


## Material frames and recognition collections

Flame, shield, crystal, shadow and smoke use integrated SVG frames rather than emoji. Flames and embers rise along the frame, a highlight travels around the shield, crystal facets catch moving light, shadows flow around the edges, and layered smoke drifts around the nameplate. Built-in frame motion keeps the text still and readable. Compact badges are still; reduced-motion preferences stop animation. Teachers can choose **Still material** in the designer. Separately selected legacy badge animations remain supported.

The designer adds five optional presets: Flameforged, Aegis, Prismatic, Nightfall and Veil of Mist. These do not create catalog records or change existing awards. Supported existing frame shapes/styles receive the corresponding material treatment automatically.

Locked achievement-linked titles display progress using the existing achievement statistics, where a numeric target exists. Unlinked titles explicitly say **Teacher grant only**; linked manual achievements retain their recognition requirement. Progress is read-only and does not grant, equip, revoke or purchase anything.

Teachers can optionally set a collection family, stage number and season in the title designer. A student can filter collections and preview their rank path. Stages describe an ordered collection, not an automatic upgrade: every stage retains its own achievement or teacher-grant requirement, and earning one never awards or equips the next. Seasonal labels organize existing titles; they do not schedule expiration or issue awards.

## Enabling account-backed metadata and history

Run [supabase/phase74_title_collections.sql](supabase/phase74_title_collections.sql) in the project's Supabase SQL editor after the existing title/achievement schema migrations. The migration is repeatable. It adds staff-owned collection metadata, scoped read/write RPCs and an award-history trigger on existing title unlocks. It preserves the current grant/revoke RPCs and earning rules. Direct table access is denied to anonymous and authenticated clients.

This SQL has been tested locally with PostgreSQL/PGlite; it has **not been applied to the production database**. Without it, material frames, presets and read-only unlock progress still work. The optional collection editor stays disabled until its account RPC is available.

New grants and revocations record the date, title name/description snapshot, source and the granting staff member when present. Students can read their own recent history (up to 500 events). Existing awards show their recorded unlock date; missing historical actors and explanations are not invented. The description snapshot is the title's recorded description, not a new per-student teacher comment.

Additional validation:

- `npm run test:titles-db` — migration reapply, staff ownership, unique stage numbers, private tables, student isolation, legacy dates, grant/revoke audit and unchanged wallets.
- `node tests/browser/title-materials.cjs` — real app material motion/text stability, compact/still/reduced-motion behavior, mobile/desktop in both themes, teacher grant requirements, achievement progress, collection paths, history and teacher metadata save. Remote services are intercepted.
- `npm run test:unit` — includes material markup/escaping and progress rules that preserve manual awards.
