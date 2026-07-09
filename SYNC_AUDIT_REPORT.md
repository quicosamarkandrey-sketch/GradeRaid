# SYNC AUDIT REPORT — Shop / Mail / Quiz / Achievement / Titles
**Updated after Phase 19.** This replaces the audit given earlier in this
thread — that one is now stale (it predates the duplicate-key bug found and
fixed below, and predates Phase 19's realtime fix).

---

## 🔴 Critical — found and fixed this session

**Titles silently never synced, despite Phase 18 shipping.** `db-service.js`'s
Supabase pull function is one big object literal. The real, correct mapping
added for Phase 18 (`titles: titlesArr, titleUnlocks: titleUnlocksObj,
equippedTitles`) was followed later in that *same* object by a leftover
fallback line (`titles: _cache?.titles || []`, etc.). In a JS object literal
the later duplicate key wins, so every fresh pull threw away the just-synced
title data and fell back to local cache — Phase 18's entire point, silently
undone. This is the identical bug class already documented in this file for
`store` (Phase 14/15). **Fixed**: the stale fallback keys were removed.
⚠️ If you deployed `db-service.js` from the first Phase 18 zip before this
fix, redeploy it.

**Realtime never wired for achievements/titles.** The `postgres_changes`
subscription list (used so one device's change shows up on another without
a manual reload) never included `achievements`, `titles`, or `title_unlocks`
— only `user_achievements` was there. A badge or title created/unlocked on
one device only reached another device on that device's *next full reload*,
not live. **Fixed in Phase 19**: added all three to both the JS subscription
list *and* the `supabase_realtime` publication (the JS listener alone isn't
suf­ficient — Postgres has to be told to publish change events for a table
before `postgres_changes` fires for it at all; this is the same two-part gap
`phase8_attendance_realtime.sql` closed for attendance).

---

## Module-by-module status

### Achievements — ✅ solid (Phase 17)
- `achievements` (catalog): now pulled **and** pushed. Previously push-only-missing — admin edits never left the device that made them.
- `user_achievements` (per-student unlock/claim): three RPCs now exist *and are called* — `award_achievement_to_student()` (auto-unlock + admin grant), `claim_achievement_reward()` (student claim), `revoke_achievement_from_student()` (admin revoke). Previously these RPCs didn't exist at all; unlocks/claims/revokes never reached Supabase.
- `achievement_sections` (Phase 16 read+write): confirmed done, including the read-side filter (`renderBadges()`, auto-unlock check) that was the last open piece before this thread started.
- Realtime: now included (Phase 19).
- Known, non-blocking: `isHidden` (admin's "hide from picker" toggle) isn't a real column — stays local-only. Hard-delete of an achievement definition doesn't delete the Supabase row (see "Shared limitation" below).

### Titles — ✅ solid, section-scoping deliberately deferred (Phase 18)
- `titles` (catalog), `title_unlocks` (per-student), `equipped_title_id` (column on `profiles`): now pulled and pushed/RPC'd correctly (after the duplicate-key fix above).
- Three RPCs, all wired: `unlock_title_for_student()`, `revoke_title_from_student()` (also clears equip if that title was equipped), `set_equipped_title()` (validates the student actually unlocked the title first).
- Mail's title-reward lookup fixed to use the real synced catalog instead of the old "whatever's cached on this tab" guess.
- Realtime: now included (Phase 19).
- **Not done, by agreement**: `title_sections` (the section-assignment table from Phase 14) has RLS but no RPC, no admin picker, and no read-side filter. Titles now *exist* cross-device — scoping which section can see which title is the next task, not started.
- Known, non-blocking: hard-delete of a title doesn't delete the Supabase row (see below).

### Shop — ✅ solid, no new issues found
- Product CRUD (`shop_products`) syncs correctly. `stock` is deliberately excluded from the bulk upsert push — it's written only through `purchase_shop_product()`/`restock_shop_product()` RPCs, specifically to avoid clobbering a purchase or restock that happened between a tab's last pull and its next push. This is good, intentional design, not a gap.
- `cartCheckout()`'s coin-deduction bug (Phase 14 — coin spend was local-cache-only, could "un-happen" on reload) is fixed and confirmed still in place.

### Mail — ✅ solid, no new issues found
- Batch reconstruction (`mail_messages` rows → the app's one-compose-many-recipients shape) and the read/claimed-state row-id fix are confirmed correct.
- Title-reward display now reflects real synced title data (see Titles above).

### Quiz — 🟡 bigger gap than "done" implies
- `quiz_sections` (the section-*assignment* junction) syncs correctly.
- **But `DB.quizzes` — the actual quiz content (questions, answers, settings) — is never pulled from or pushed to Supabase.** It's a hardcoded local-only fallback (`quizzes: _cache?.quizzes || []`), the same class of gap achievements/titles had before this thread's fixes. A quiz authored on one device never reaches another device at all. This is separate from, and larger than, the already-known read-side section-filter gap (`quiz-builder.js`/`renderStudentQuizzes()`) — that gap assumes the quiz data is even present to filter, which today it isn't, cross-device.

### Campaign — 🟡 confirmed fully local (matches what you already knew, made explicit)
- `stageMap` (worlds/stages/scenes/questions) has the identical gap as quiz content: `stageMap: _cache?.stageMap || []`. Entirely local, never synced. This matches the "campaign is separate WIP" status already on record — noted here so it's explicit that the *content itself*, not just section-scoping, is unbuilt.

---

## Shared limitation across every catalog table — ✅ resolved (Phase 23)
`boss_events`, `shop_products`, `achievements`, and `titles` all pushed via
upsert-only, so hard-deleting a definition locally never removed the
Supabase row. `shop_products` already had a real fix (Phase 14's
`delete_shop_product()`); **Phase 23** brings the other three up to the
same pattern instead of introducing a second (soft-delete/`active`-flag)
scheme — `active` already means "enabled/disabled" on both achievements and
titles, so overloading it for "deleted" would have broken that toggle.

- `delete_boss_event()` — section-scope-checked (`is_staff_for_section`),
  cascades `boss_participants` + `loot_claims` for that boss first, then
  deletes the row. Wired into `bossDelete()`.
- `delete_achievement()` — staff-checked (`is_staff()`), cascades
  `user_achievements` + `achievement_sections`, then deletes the row. Wired
  into `achAdminDelete()`.
- `delete_title()` — staff-checked, cascades `title_unlocks` +
  `title_sections`, clears `equipped_title_id` wherever it pointed at the
  deleted title, then deletes the row. Wired into `tsAdminDelete()`,
  replacing the old per-student `syncTitleRevokeToServer()` loop that only
  ever cleaned up unlock rows and left the `titles` row itself orphaned.

All three follow `delete_shop_product()`'s idempotent shape — deleting an
already-gone row is a silent no-op, not an error.

**Migration to run**: `phase23_catalog_delete_sync.sql`.

---

## Boss damage race — ✅ narrowed (wired up)
`apply_boss_damage()` (written in Phase 14) existed in Supabase but was
never actually called from the client — every hit was a pure local
read-decrement-write, then whatever the next bulk `boss_events` push
happened to sync, so two students hitting the boss on different devices
around the same time could clobber each other's damage.

**Fixed**: `wbcApplyDamage()` (the single choke point all three combat
call sites — `combat-settings.js`'s and `student-page.js`'s `wbcAnswer`,
and `raid-flow.js`'s `wbrAnswer` — funnel through, including the
`phases.js` phase-change wrapper) now calls `apply_boss_damage()` after
its local optimistic HP update, and corrects `boss.currentHp`/defeated
state to whatever the RPC actually returns. All three call sites and the
wrapper were converted to `async`/`await` to support this. `isCrit` is now
threaded through to the RPC too, so `boss_participants.crit_hits`
increments atomically server-side, not just in the local optimistic copy.

**Not fully closed**: `current_hp`/`status` are still also part of
`db-service.js`'s bulk `boss_events` upsert, because admin-driven
transitions (start/reset-to-maxHp/end in `admin-page.js`) don't have their
own RPC yet and rely on that bulk push to sync at all. So the race is
narrowed (each hit is corrected to the server's authoritative HP right
after the call, closing the by-far most frequent source of clobbering) but
not eliminated for the rare case of a stale tab's bulk push landing right
after a fresh RPC result. Fully closing that would mean adding
`start_boss_event()`/`end_boss_event()` RPCs and dropping `current_hp`/
`status` from the bulk upsert entirely, mirroring how `loot_claims` and
shop `stock` are already excluded — worth doing, not urgent.

---

## Boss activate/end race — ✅ narrowed further (Phase 24)
Closed the specific follow-up above: `bossActivate()` and `bossEnd()` now
call new `start_boss_event()`/`end_boss_event()` RPCs (section-scope-
checked, same trust model as `apply_boss_damage()`) right alongside their
existing local state updates, instead of relying solely on the next bulk
`boss_events` push to reach Supabase.

- `start_boss_event()` atomically ends any other still-active/loot boss in
  the same section, resets `current_hp`/`status`/`defeated_at`/`ended_at`/
  `loot_started_at`/`loot_finalized_at`, and wipes that boss's
  `boss_participants`/`loot_claims` rows — mirroring `bossActivate()`'s
  local "fresh run" reset exactly.
- `end_boss_event()` sets `status`/`ended_at`.
- **Bonus fix found along the way**: `ended_at` was being set locally by
  `bossEnd()` but was never actually part of `db-service.js`'s pull/push
  mapping — `status='ended'` synced fine, but the timestamp itself was
  silently local-only the whole time. Added the column and wired both
  directions while touching this code anyway.

**Still not fully closed, and deliberately not attempted here**:
`current_hp`/`status`/`defeated_at`/`ended_at`/`loot_started_at`/
`loot_finalized_at` remain part of the bulk `boss_events` upsert, because
the loot-rush transition (`prepareLootRush()`/`finalizeLoot()` in
`loot-service.js` — sets `status='loot'`, `defeatedAt`, `lootStartedAt`,
`lootFinalizedAt`) still has no RPC of its own and depends entirely on
that bulk push to sync at all. Dropping these fields now would silently
break loot-rush sync — a worse regression than the narrow remaining race
this migration leaves in place.

**Migration to run**: `phase24_boss_lifecycle_rpc.sql`.

## Priority suggestion for what's next
1. **Loot-rush transition RPCs** (`start_loot_rush()`/`finalize_loot()`,
   mirroring `start_boss_event()`/`end_boss_event()`'s shape) — the last
   piece of the boss-event lifecycle still relying purely on the bulk
   upsert, and also the one part of `prepareLootRush()` that's most likely
   to actually race in practice (multiple students can all observe
   `currentHp <= 0` and call it near-simultaneously; today's `if
   (boss.status === 'loot') return alreadyActive` guard only checks the
   local snapshot, not the server's real state). Once that's wired,
   `current_hp`/`status`/the four timestamp columns can finally be dropped
   from the bulk `boss_events` upsert entirely, closing the boss-event
   race for good.
2. Everything else previously on this list (quiz content sync, title
   section-scoping, campaign content sync, catalog-table delete-sync,
   student-damage race) is done.
