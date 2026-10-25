# Stream D — Seat Arrangement, Shop, Titles, Achievements, Leaderboard

Read `PHASE7_GLOBAL_RULES.md` first. This document only adds what's
specific to your assignment.

## Already converted, not in your list

`modules/leaderboard/index.js` (→ `src/leaderboard-index.js`) and
`modules/leaderboard/hall-of-fame-styles.js` (→
`src/hall-of-fame-styles.js`). Don't touch either.

## Known real cycles in this list

Same state-file/render-file pairing pattern found elsewhere in this
codebase: `classroom_builder.js` ↔ `classroom-builder-render.js`,
`live_monitor.js` ↔ its render/coldcall/recitation/webnfc siblings, and
`shop_store.js` ↔ `shop_inventory.js` ↔ `shop_promotions.js` are all
mutually dependent within their own clusters. `titles_sidebar_refresh.js`
reaches into `modules/achievements/` and `modules/leaderboard/` — a real
cross-directory dependency, but both sides are in your own assignment,
so a real `import` is fine there once the dependency is converted. Don't
force imports through the cycles above; use `window` fallback within
them.

## File list — 30 files, in a computed rough order (leaf-like-within-this-list first; expect real cycles regardless, per above)

1. `modules/achievements/ach_engine.js`
2. `modules/titles/titles_badge_renderer.js`
3. `modules/leaderboard/eql-engine.js`
4. `modules/seat-arrangement/classroom-service.js`
5. `modules/seat-arrangement/recitation-service.js`
6. `modules/shop/shop_orders.js`
7. `modules/shop/shop_admin_store.js`
8. `modules/seat-arrangement/classroom_index.js`
9. `modules/shop/shop_index.js`
10. `modules/achievements/ach_index.js`
11. `modules/titles/titles_index.js`
12. `modules/shop/shop_inventory.js`
13. `modules/shop/shop_promotions.js`
14. `modules/leaderboard/admin-leaderboard.js`
15. `modules/achievements/ach_admin_page.js`
16. `modules/seat-arrangement/classroom_builder.js`
17. `modules/seat-arrangement/live-monitor-webnfc.js`
18. `modules/achievements/ach_student_page.js`
19. `modules/titles/titles_admin_page.js`
20. `modules/seat-arrangement/classroom-builder-render.js`
21. `modules/titles/titles_designer.js`
22. `modules/shop/shop_store.js`
23. `modules/leaderboard/hall-of-fame.js`
24. `modules/titles/titles_student_page.js`
25. `modules/seat-arrangement/live-monitor-recitation.js`
26. `modules/titles/titles_sidebar_refresh.js`
27. `modules/seat-arrangement/live_monitor.js`
28. `modules/seat-arrangement/live-monitor-render.js`
29. `modules/seat-arrangement/live-monitor-coldcall.js`
30. `modules/shop/shop_pos_terminal.js`
