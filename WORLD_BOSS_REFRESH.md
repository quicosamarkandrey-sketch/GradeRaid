# World Boss flow and presentation

The event manager, student raid lobby, battle stage, victory dialog, loot pool and results now share a quieter application design, clear controls and responsive layouts. Boss artwork carries the character of the experience. Dark/light page themes remain supported; the battle arena uses a dedicated dark surface for contrast.

## Teacher workflow

1. Open **Boss Studio**. Create a profile or start from **Obsidian Wyrm**, **Clockwork Sentinel** or **Veil Phantom**. The three original SVG illustrations ship with the app and need no external image service. Edit identity, artwork, animations and theme; save the profile.
2. Open **World Boss events → Create event**. Choose an authorized section, link the profile, enter HP and event dates, and set the victory rewards. Studio selection preserves the event form. Profile cards work with Enter/Space and Escape closes the picker.
3. Save the event, then use **Questions, loot & battle tools** to add questions, configure limited rewards, damage/critical chance, minions, skills, phases and rage. Import supports multiple-choice and true/false questions; unsupported quest formats are skipped with an explanation.
4. Check readiness and launch manually. Launch is confirmed by the server before showing success. Re-running creates a new run, resets participants/claims, and preserves previously earned inventory. Ending a raid without defeating the boss does not award victory rewards.
5. During battle, teachers can send minion/skill commands and revive participants. Finish the loot window or let its timer/stock run out. Results include standings and the student's confirmed rewards/loot.

The participation field is an **XP bonus on victory**; the victory field is a **coin bonus on victory**. Total victory XP = base XP + participation XP. Total victory coins = base coins + victory bonus. Only contributors with positive damage qualify. Extra loot is separate and limited by stock and the per-raider claim limit.

## Student workflow

The lobby shows shared HP, class participation, question count, potential victory rewards and your saved question progress. Join/resume opens the battle. Intro controls work by click or keyboard; 1–4 select answer buttons, and Escape/Exit battle returns to the lobby. Answers remain disabled while confirming or cooling down. Minion challenges, knockouts, revive controls, phases and skills remain available in the arena. Decorative motion honors reduced-motion preferences.

Victory leads to stationary reward cards, avoiding moving targets on phones. Stock, claim limits, remaining time and confirmation/error messages stay visible. Confirmed loot appears in **My Inventory**. Finished events remain under **Past raids**.

## Required backend activation

Apply [supabase/phase75_world_boss_reliability.sql](supabase/phase75_world_boss_reliability.sql) in the project's Supabase SQL editor **after the existing boss, quiz, profile and inventory migrations (including phases 24, 25, 44, 46–48)**. Re-running phase75 is supported. It has been tested against a local PostgreSQL/PGlite fixture; **it has not been applied to the production database** because this workspace has no production database access.

The migration adds a version/run ID to events, private answer receipts and a private victory reward ledger, durable question/life state, embedded visual profiles, and the authenticated `world_boss_action` RPC. The RPC:

- Resolves the caller from Supabase Auth and checks their role and section against the actual boss.
- Serializes section launches and locks each boss for mutations.
- Records a question once per student and run, validates order/choice/cooldown, and calculates damage/criticals on the server. Retries return the original receipt.
- Updates shared HP and moves a defeated boss into loot. Victory XP/coins are paid once per contributing student and run in the same transaction. Explicit zero rewards and zero critical chance remain zero.
- Checks participation, stock, limits, expiry and claim ownership. Claim insertion and inventory increment happen in the same transaction; retries with the same claim ID cannot add another item.
- Handles event start/end/delete/finalization, timed expiration without fake victory, and shared teacher skill/minion signals. Signals are bounded and consumed once by an open student battle. Revives check the stored timer or staff authority.

Once events have `raid_version=1`, the client uses this RPC. Generic participant sync excludes RPC-owned damage, answer totals, criticals and question progress; its remaining minion/life/narration updates are restricted to the student's own row. Existing legacy minion life mechanics retain their authorized participant sync path; this change is not a redesign of all database policies or an anti-cheat system.

Before phase75 is applied, presentation/form fixes and the existing event/attack/claim RPCs still work. Requests must confirm before the UI commits damage/claims or says a lifecycle action succeeded. The old per-device victory payout path is retained for legacy events; the **cross-device, exactly-once payout and atomic claim-to-inventory guarantees require phase75**. Do not treat local fixture results as confirmation that production SQL has been deployed.

## Additional fixes

- Editing HP no longer heals a live or defeated boss; an active event keeps its section and current HP.
- New draft events receive a stable UUID so repeated syncs cannot create duplicate server rows. An insert is seeded once and deleted events are excluded from uploads.
- Zero HP stays zero in the topbar. Legacy relative/data/image URLs render as images rather than giant text; title/question/option content is escaped.
- Studio fields can be cleared, concurrent saves are guarded, failed library pushes remain pending for retry, unsynced drafts survive library refresh, and account changes reject late library/raid responses. A local-only save is labeled honestly.
- Battle opening is guarded, stale runs close, and exit stops skill, minion and answer timers and restores scrolling. Raid notifications do not interrupt an already-open raid page or battle.
- Skills target the current arena; mirror skills shuffle the actual answer list. Answering a minion in one dock does not disable the other dock's controls.

## Verification

- `npm run test:unit` — includes request deduplication, stale account responses, failed-request immutability, section scope and exclusion of server-owned participant fields.
- `npm run test:boss-db` — repeatable migration, role/section checks, join, correct/wrong/replayed answers, shared HP, cooldown, zero critical chance/rewards, per-run payouts, claim retries/stock/inventory, expiry, restart/stale run, teacher signals/revives and private receipt tables.
- `npm run test:boss-browser` — real application with intercepted external services; Studio create/save/clear, keyboard profile selection, event creation/edit, question imports, launch, join/intro/battle, failed and repeated attacks, victory, failed/retried loot claims, results and finalization. Includes 320/390/1440 layouts and both themes, plus phone battle/editor checks. No hosted backend writes occur.
- `node tests/browser/application-theme.cjs` — shared page/theme regression.
- Full, student and admin esbuild entry compilation; classic and source mirror syntax checks.


## Cached client compatibility and minion flanks

Joining, resuming and answering now negotiate the installed battle API with a read-only snapshot if cached event metadata lacks phase75's version/run fields. A successful snapshot selects `world_boss_action` for both correct and wrong answers. Network/authorization errors never select a local-answer fallback; the legacy path is considered only when the new function is actually missing. Snapshot application also restores protocol fields directly from the response, so an older cached mapper cannot keep an upgraded event in legacy mode. Legacy errors retain the actual database message instead of all appearing as a reconnect warning. This compatibility fix needs no additional SQL migration.

The two minion docks flank the central boss encounter on desktop and occupy opposing columns on phones/tablets. Both-side spawning fills only an empty flank; it does not duplicate the survivor when replacing a defeated minion. Random spawning favors the empty flank for the second minion. Contrast is maintained in the dark arena under either page theme.


## Battle motion and rage presentation

The arena now uses a scoped presentation layer for all six boss skills. A brief preparing cue precedes ground fractures, wind ribbons, an eclipse, prismatic mirror echoes, roar shockwaves or a meteor barrage. The question remains visible while each skill challenges the answer controls: Earthquake shifts and buries choices, Wind drifts them, Eclipse conceals them, Mirror repeatedly reshuffles them, Roar shakes and obscures them, and Meteor Shower marks then shatters individual choices. Original button identities, text, handlers and correct-answer indices are preserved. Confirmed attacks produce boss recoil, damage numbers and a delayed health-bar echo.

Phase changes have concise announcements and persistent phase indicators. Rage uses the configured HP threshold, an orbiting aura, an Enraged indicator and matching minion rims/badges. Minions enter from their own flank once per spawn and react to correct or incorrect answers. Rage uses one skill clock with the configured frequency multiplier; the configured spawn multiplier now also adjusts the minion spawn delay. No damage, reward or answer-confirmation rules change.

Foreground weather, shockwaves, background camera impacts and cinematic phase/rage titles intensify the arena. Rage adds a breathing crimson perimeter, stronger boss aura and animated minion wards. Decorative effects ignore pointer input. Concealed choices take one click/tap to reveal and another to answer; aiming steadies a moving choice. Only one answer disruption runs at a time, all choices recover automatically, and exit or answer confirmation clears disruptions. Reduced motion disables movement while retaining timed concealment and reveal controls. The new assets are local CSS/SVG with no additional image service or SQL migration.

- `npm run test:boss-effects` — all six telegraphed skills, moving/concealed/shuffled choices with preserved identities, reveal-before-submit, real phone taps, automatic recovery and overlap cleanup, phase/rage/minion states, spawn acceleration, confirmed-hit presentation, 320/390/1440 layouts, reduced motion, exit cleanup and unchanged reward/progress state, using intercepted services.


## Repair for `boss_status: "defeated"`

If an installed database reports `invalid input value for enum boss_status: "defeated"`, run [supabase/phase76_world_boss_status_enum_fix.sql](supabase/phase76_world_boss_status_enum_fix.sql) in Supabase SQL Editor after phase75. GitHub deployment alone does not update the installed SQL functions. The repeatable repair preserves function grants, event data, authorization and reward rules; it changes only the incompatible status expressions.

The launch path now compares legacy status names as text, avoiding an enum coercion of `defeated`. Legacy `apply_boss_damage` leaves status unchanged while returning zero HP/defeat; `start_loot_rush` retains responsibility for setting loot status and all loot timestamps. The current `world_boss_action` answer path continues to move directly into loot and award victory rewards atomically. No new enum value is needed. The historical migration files are corrected for fresh installs too.

`npm run test:boss-db` now uses `boss_status` as an enum excluding `defeated`, reproduces both installed-function failures, applies the repair twice, and verifies legacy final hits plus the complete current launch/answer/reward/claim lifecycle. These checks use local PostgreSQL/PGlite, not the hosted database.


## Phase75 compatibility with existing text boss IDs

The current phase75 script detects `boss_events.id` and creates the answer-receipt and victory-reward foreign keys with that same type. The RPC parameter also uses the native column type, supporting UUID installations and existing text IDs such as `boss_legacy_science_01`. Existing IDs, participants, loot claims, receipts, reward ledgers and balances are preserved. An obsolete alternate-signature overload of this RPC is removed transactionally to avoid ambiguous PostgREST calls; authenticated-only execution grants are applied to the native signature, and the API schema cache is notified.

For `boss_id uuid` versus `boss_events.id text` errors, run the **updated complete phase75 script** in Supabase SQL Editor, then the **updated phase76** repair. There is no need to convert or recreate the boss tables. Phase75 already includes the launch status-enum correction; phase76 also repairs the older damage function. A failed phase75 transaction has not installed the battle API successfully. Refresh the app after both scripts succeed.

`npm run test:boss-db` runs the full lifecycle against both UUID and text primary keys, including non-UUID text IDs, repeat installation with paid rewards/history, real foreign-key validation/cascade, obsolete-overload removal, API grants and the enum repair. Tests remain local; hosted SQL must be applied separately.
