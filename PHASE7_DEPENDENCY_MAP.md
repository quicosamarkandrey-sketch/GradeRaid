# Phase 7 — Dependency Map (step 5.2)

Generated 2026-09-21T02:38:56.034Z by `build/dependency-map.js`. Regenerate any time source changes; do not hand-edit the data sections below.

**136 source units analyzed** (133 external files + 3 inline `<script>` blocks in `index.html`).

## Parse failures: none — all 136 units parsed cleanly.

## ⚠ FATAL-risk collisions — top-level `const`/`let`/`class` declared in more than one unit (0)

Same class of bug as session 1's `CB_CANVAS_W` finding. **Every one of these needs a manual look against `index.html`'s actual load order** before assuming it's live-broken.

None found.

## Reassignment chains — `function`/`var`/`window.X =` declared in more than one unit (30)

NOT a SyntaxError risk under classic-script semantics — frequently an intentional monkey-patch/override chain in this codebase (see refactor log's Phase 4 entry). See `PHASE7_WINDOW_EXPORT_AUDIT.md` for whether the *currently effective* (last-loaded) declarer of each of these has an explicit `window.X =` — that's the file that would need one before any bundling touches it.

- `loadDB` — declared/assigned in: `db-schema.js`, `modules/core/state-manager.js`
- `saveDB` — declared/assigned in: `db-schema.js`, `modules/core/state-manager.js`
- `DB` — declared/assigned in: `modules/core/state-manager.js`, `index.html#inline1`
- `XP_PER_LEVEL` — declared/assigned in: `student-stats.js`, `index.html#inline1`
- `getLevel` — declared/assigned in: `student-stats.js`, `index.html#inline1`
- `dsmGetStudentNav` — declared/assigned in: `nav.js`, `modules/admin/dsm-manager.js`
- `dsmGetAdminNav` — declared/assigned in: `nav.js`, `modules/admin/dsm-manager.js`
- `dsmGetTeacherNav` — declared/assigned in: `nav.js`, `modules/admin/dsm-manager.js`
- `navTo` — declared/assigned in: `nav.js`, `modules/enrollment/enrollment-hub.js`
- `renderStudentMail` — declared/assigned in: `modules/mail/student-inbox.js`, `modules/perceived-speed.js`
- `mailDoClaimRewards` — declared/assigned in: `modules/mail/student-inbox.js`, `modules/perceived-speed.js`
- `renderAnalytics` — declared/assigned in: `modules/shop/shop_pos_terminal.js`, `modules/admin/analytics.js`
- `renderBadges` — declared/assigned in: `modules/achievements/ach_student_page.js`, `modules/titles/titles_student_page.js`, `modules/perceived-speed.js`
- `achClaimReward` — declared/assigned in: `modules/achievements/ach_student_page.js`, `modules/achievements/ach_index.js`, `modules/perceived-speed.js`
- `_tsOpenTitlesTab` — declared/assigned in: `modules/titles/titles_student_page.js`, `modules/titles/titles_sidebar_refresh.js`
- `_bsRenderFormModal` — declared/assigned in: `modules/boss-studio/bs_library.js`, `modules/boss-studio/bs_editor.js`
- `wbcUpdateTopbarWidget` — declared/assigned in: `modules/world-boss/combat-settings.js`, `modules/world-boss/bve-patches.js`
- `_bossEventCardHTML` — declared/assigned in: `modules/world-boss/admin-page.js`, `modules/world-boss/skills.js`, `modules/world-boss/phases.js`, `modules/world-boss/rage.js`, `modules/world-boss/bve-patches.js`
- `bossActivate` — declared/assigned in: `modules/world-boss/admin-page.js`, `modules/world-boss/rage.js`, `modules/world-boss/summon-notify.js`
- `wblrClaimReward` — declared/assigned in: `modules/world-boss/loot-rain.js`, `modules/perceived-speed.js`
- `wblrRenderStudentLootPage` — declared/assigned in: `modules/world-boss/loot-rain.js`, `modules/perceived-speed.js`
- `wbsStopSkillLoop` — declared/assigned in: `modules/world-boss/skills.js`, `modules/world-boss/rage.js`
- `wblTrackCrit` — declared/assigned in: `modules/world-boss/skills.js`, `modules/world-boss/leaderboard.js`
- `wbrShowEncounter` — declared/assigned in: `modules/world-boss/skills.js`, `modules/world-boss/raid-flow.js`
- `wbmStopSpawnLoop` — declared/assigned in: `modules/world-boss/skills.js`, `modules/world-boss/minions.js`
- `_wbcStartLiveRefresh` — declared/assigned in: `modules/world-boss/phases.js`, `modules/world-boss/student-page.js`
- `_wbcFloatDamage` — declared/assigned in: `modules/world-boss/student-page.js`, `modules/world-boss/bve-patches.js`
- `renderStudentWorldBoss` — declared/assigned in: `modules/world-boss/student-page.js`, `modules/world-boss/bve-patches.js`
- `wbcAnswer` — declared/assigned in: `modules/world-boss/student-page.js`, `modules/world-boss/bve-patches.js`
- `_eqMascotCustomLines` — declared/assigned in: `modules/admin/mascot-lines.js`, `index.html#inline2`

## Leaf candidates (0 unresolved free references, sorted by fan-out then fan-in)

| unit | fan-out | fan-in |
|---|---|---|
| `dom.js` | 0 | 59 |
| `modules/shared/stat-bars.js` | 0 | 3 |
| `supabase-client.js` | 0 | 1 |
| `modules/quest-mascot-lines.js` | 0 | 1 |
| `modules/shared/button-loading.js` | 0 | 1 |
| `modules/shared/sequence.js` | 0 | 1 |
| `modules/shared/particles.js` | 0 | 1 |
| `modules/shared/ambient-backdrop.js` | 0 | 1 |
| `index.html#inline0` | 0 | 0 |
| `modules/core/active-section.js` | 0 | 0 |
| `modules/shared/quick-jump.js` | 0 | 0 |
| `modules/leaderboard/hall-of-fame-styles.js` | 0 | 0 |
| `modules/leaderboard/index.js` | 0 | 0 |
| `modules/recitation/recitation_index.js` | 0 | 0 |
| `modules/attendance/att_index.js` | 0 | 0 |
| `modules/boss-studio/bs_index.js` | 0 | 0 |
| `modules/world-boss/index.js` | 0 | 0 |
| `modules/admin/index.js` | 0 | 0 |
| `utils.js` | 1 | 72 |
| `modules/titles/titles_badge_renderer.js` | 1 | 10 |
| `modules/admin/teacher-directory-service.js` | 1 | 6 |
| `modules/leaderboard/eql-engine.js` | 1 | 4 |
| `repository/pull-mappers.js` | 1 | 2 |
| `dsm-service.js` | 1 | 2 |
| `modules/shared/mascot-lines-service.js` | 1 | 2 |
| `modules/admin/registrations-service.js` | 1 | 2 |
| `modules/admin/audit-log-service.js` | 1 | 2 |
| `modules/admin/system-health-service.js` | 1 | 2 |
| `repository/realtime-groups.js` | 1 | 1 |
| `modules/admin/starter-pack-service.js` | 1 | 1 |
| `modules/admin/teacher-invite-service.js` | 1 | 1 |
| `modules/admin/ownership-service.js` | 1 | 1 |
| `modules/admin/school-settings-service.js` | 1 | 1 |
| `error-capture.js` | 1 | 0 |
| `modules/mail/index.js` | 1 | 0 |
| `modules/shop/shop_index.js` | 1 | 0 |
| `modules/achievements/ach_index.js` | 1 | 0 |
| `modules/titles/titles_index.js` | 1 | 0 |
| `modules/campaign/campaign_index.js` | 1 | 0 |
| `modules/core/state-manager.js` | 2 | 84 |

...and 96 more with 0 unresolved refs (see `dist/dependency-map.json` for the full list).

## Units with unresolved free references (0)

