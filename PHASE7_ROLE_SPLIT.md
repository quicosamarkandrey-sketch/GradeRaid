# Phase 7 — Role Split Analysis (step 5.4)

Generated 2026-08-13T11:39:27.044Z by `build/compute-role-split.js`, from nav.js's real routing table (hand-transcribed, not guessed from directory names) walked through the real dependency graph.

**136 total units.** Student closure: 91. Admin closure: 126. Shared: 86. Student-only: 5. Admin-only: 40. In neither closure: 5.

## Units in NEITHER closure (5) — needs a look

Not reachable from any known role entry point via the dependency graph. Could be: boot-sequence/core infrastructure that every page needs regardless of role (most likely, for early-loading files like `db-service.js`, `auth.js`, `app-state.js`), truly dead code, or something reached only via a path this graph doesn't capture (e.g. purely event-driven code with no direct call edge). Needs a human decision, not an automatic assignment — same caution as the two dead files found in session 1.

- `error-capture.js`
- `index.html#inline0`
- `modules/admin/analytics.js`
- `modules/admin/teacher-invite-service.js`
- `recovery.js`

## Shared (86) — goes in both bundles

- `app-state.js`
- `auth.js`
- `db-migrations.js`
- `db-schema.js`
- `db-service.js`
- `dom.js`
- `dsm-service.js`
- `index.html#inline1`
- `index.html#inline2`
- `modules/achievements/ach_engine.js`
- `modules/achievements/ach_index.js`
- `modules/achievements/ach_student_page.js`
- `modules/admin/command-center.js`
- `modules/admin/dsm-manager.js`
- `modules/admin/registrations-service.js`
- `modules/admin/sections-service.js`
- `modules/admin/system-health-service.js`
- `modules/admin/system-health.js`
- `modules/attendance/attendance-service.js`
- `modules/boss-studio/bs_animation_library.js`
- `modules/boss-studio/bs_bve_engine.js`
- `modules/boss-studio/bs_editor.js`
- `modules/boss-studio/bs_index.js`
- `modules/boss-studio/bs_storage.js`
- `modules/campaign/campaign-dragdrop-beat.js`
- `modules/campaign/campaign-reveal-dialogue-beats.js`
- `modules/campaign/campaign-skills.js`
- `modules/campaign/campaign_engine.js`
- `modules/campaign/campaign_index.js`
- `modules/campaign/campaign_stage_map.js`
- `modules/core/active-section.js`
- `modules/core/state-manager.js`
- `modules/enrollment/enrollment-hub.js`
- `modules/enrollment/enrollment-service.js`
- `modules/leaderboard/eql-engine.js`
- `modules/leaderboard/hall-of-fame-styles.js`
- `modules/leaderboard/hall-of-fame.js`
- `modules/leaderboard/index.js`
- `modules/mail/index.js`
- `modules/mail/mail-engine.js`
- `modules/perceived-speed.js`
- `modules/quest-chains.js`
- `modules/quest-engine.js`
- `modules/quest-mascot-lines.js`
- `modules/shared/ambient-backdrop.js`
- `modules/shared/button-loading.js`
- `modules/shared/mascot-lines-service.js`
- `modules/shared/notification-service.js`
- `modules/shared/particles.js`
- `modules/shared/quick-jump.js`
- `modules/shared/reward-presenter.js`
- `modules/shared/sequence.js`
- `modules/shared/stat-bars.js`
- `modules/shop/shop_index.js`
- `modules/shop/shop_inventory.js`
- `modules/shop/shop_orders.js`
- `modules/shop/shop_promotions.js`
- `modules/shop/shop_store.js`
- `modules/titles/titles_badge_renderer.js`
- `modules/titles/titles_designer.js`

...and 26 more.

## Student-only (5)

- `modules/mail/student-inbox.js`
- `modules/recitation/logger.js`
- `modules/recitation/progress.js`
- `modules/recitation/recitation_index.js`
- `modules/section/my-section.js`

## Admin-only (40)

- `modules/achievements/ach_admin_page.js`
- `modules/admin/audit-log-service.js`
- `modules/admin/audit-log.js`
- `modules/admin/content-oversight-service.js`
- `modules/admin/content-oversight.js`
- `modules/admin/index.js`
- `modules/admin/mascot-lines.js`
- `modules/admin/ownership-service.js`
- `modules/admin/quiz-builder.js`
- `modules/admin/registrations.js`
- `modules/admin/school-settings-service.js`
- `modules/admin/school-settings.js`
- `modules/admin/sections.js`
- `modules/admin/sections_index.js`
- `modules/admin/starter-pack-editor.js`
- `modules/admin/starter-pack-service.js`
- `modules/admin/student-manager.js`
- `modules/admin/teacher-directory-service.js`
- `modules/admin/teacher-directory.js`
- `modules/admin/teacher-invite.js`
- `modules/attendance/att_index.js`
- `modules/attendance/att_scanner_rfid.js`
- `modules/attendance/attendance-recitation-log.js`
- `modules/boss-studio/bs_library.js`
- `modules/campaign/campaign_admin_map_editor.js`
- `modules/leaderboard/admin-leaderboard.js`
- `modules/mail/admin-compose.js`
- `modules/seat-arrangement/classroom-builder-render.js`
- `modules/seat-arrangement/classroom-service.js`
- `modules/seat-arrangement/classroom_builder.js`
- `modules/seat-arrangement/classroom_index.js`
- `modules/seat-arrangement/live-monitor-coldcall.js`
- `modules/seat-arrangement/live-monitor-recitation.js`
- `modules/seat-arrangement/live-monitor-render.js`
- `modules/seat-arrangement/live-monitor-webnfc.js`
- `modules/seat-arrangement/live_monitor.js`
- `modules/seat-arrangement/recitation-service.js`
- `modules/shop/shop_admin_store.js`
- `modules/shop/shop_pos_terminal.js`
- `modules/titles/titles_admin_page.js`
