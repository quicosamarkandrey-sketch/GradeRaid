# Title presentation refresh

Titles keep their own colors and character. Badge plates now have a readable foreground, an icon, restrained frame artwork and lighter glow. Existing shapes, custom colors, effects, animations and saved title data are retained. Text that fails contrast against a supported hex background gets a readable display color without rewriting the stored title. Small/xs versions use fewer effects for compact profile, sidebar and leaderboard contexts. Reduced-motion settings stop badge animation.

The student Titles tab has an equipped-profile showcase, All / Unlocked / To unlock filters, search, full title names and requirements, and a preview showing full/small/xs sizes. Equipped titles and unlocked titles appear first. Locked previews explain the requirement and provide no equip action. Inactive titles are excluded from the count. Achievement-linked title discovery now follows the linked achievement's section assignment; already-unlocked titles remain visible across later section reassignment.

Badges/Titles tabs use tab roles, keyboard arrows/Home/End and preserve the selected tab through refreshes. Unlock notifications lead directly to Titles. Equipping still uses the existing service and RPCs; this refresh does not award XP, coins or unlocks.

The teacher designer gains four optional palettes: Cobalt Scholar, Emerald Sage, Golden Luminary and Stellar Mind. They are templates, not automatically created titles. Compact samples display at actual size, and the mobile live preview moves above the controls. Shape/template pickers support keyboard activation. New title defaults use a deep blue palette; existing catalog records are unchanged until the teacher saves an edit.

No database migration is required. Classic and ESM source twins and role bundle entries are updated.

Validation:

- `npm run test:unit` — includes contrast recovery, compact effects and escaped title markup.
- `node tests/browser/titles-refresh.cjs` — actual app at 320/390/1440 in both themes; collection/search/filter/scope, previews, equip/unequip without reward/catalog/unlock mutations, keyboard tabs/designer, reduced motion and responsive layout. External services are intercepted.
- `node tests/browser/application-theme.cjs` — shared page/theme regression.
- `node tests/browser/student-learning.cjs` — existing dashboard, Progress and Hall of Fame navigation.
- `npx esbuild build/entry.full.js --bundle --outfile=/tmp/graderaid-titles.js`
