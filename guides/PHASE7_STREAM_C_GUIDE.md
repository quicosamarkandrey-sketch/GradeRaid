# Stream C — World-Boss, Boss-Studio, Campaign & Quest

Read `PHASE7_GLOBAL_RULES.md` first. This document only adds what's
specific to your assignment.

## Why these are grouped together

Real, confirmed coupling: `bs_bve_engine.js` (boss-battle rendering) is
genuinely used by both the boss-studio editor and the live world-boss
battle UI — not a directory-naming coincidence. Keeping both areas in one
stream means a real `import` is possible across that boundary.

`modules/boss-studio/bs_index.js` is already converted
(`src/boss-studio-index.js`) — not in your list.

## Known real cycles in this list

The most internally interconnected of the four streams — real mutual
dependencies concentrated in `modules/campaign/` (the beat-type files
reference each other) and `modules/world-boss/` (`loot-rain.js`
specifically is mutually dependent on several siblings). Don't try to
find one clean global order; convert roughly leaf-like files first (the
order below already reflects that), use `window` fallback freely within
tightly-coupled clusters, and don't burn time forcing imports through
cycles.

## File list — 29 files, in a computed rough order (leaf-like-within-this-list first; expect real cycles regardless, per above)

1. `modules/quest-engine.js`
2. `modules/boss-studio/bs_storage.js`
3. `modules/quest-chains.js`
4. `modules/boss-studio/bs_animation_library.js`
5. `modules/campaign/campaign_index.js`
6. `modules/world-boss/combat-settings.js`
7. `modules/campaign/campaign-skills.js`
8. `modules/campaign/campaign_stage_map.js`
9. `modules/boss-studio/bs_library.js`
10. `modules/world-boss/loot-service.js`
11. `modules/campaign/campaign_admin_map_editor.js`
12. `modules/world-boss/bve-patches.js`
13. `modules/perceived-speed.js`
14. `modules/boss-studio/bs_editor.js`
15. `modules/boss-studio/bs_bve_engine.js`
16. `modules/world-boss/minions.js`
17. `modules/campaign/campaign-dragdrop-beat.js`
18. `modules/campaign/campaign-reveal-dialogue-beats.js`
19. `modules/world-boss/summon-notify.js`
20. `modules/world-boss/skills.js`
21. `modules/campaign/campaign_engine.js`
22. `modules/world-boss/leaderboard.js`
23. `modules/world-boss/phases.js`
24. `modules/world-boss/rage.js`
25. `modules/world-boss/student-page.js`
26. `modules/world-boss/admin-page.js`
27. `modules/world-boss/loot-rain.js`
28. `modules/world-boss/battle-overlay.js`
29. `modules/world-boss/raid-flow.js`
