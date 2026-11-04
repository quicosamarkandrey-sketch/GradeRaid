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

Victory stays in the battle overlay: combat controls clear, the boss collapses, and rarity-marked loot bursts outward into settled, clickable drops around the boss. The victory banner appears when looting finishes. Every student still fighting transitions into the same loot race. A shared release countdown precedes claiming; confirmed stock, per-raider limits and remaining time stay visible. Confirmed loot appears in **My Inventory**. Finished events remain under **Past raids**.

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


## In-battle victory and shared loot race

The battlefield remains open after a final hit or a classmate's confirmed defeat update. Combat loops/effects stop, and questions, minions, HP and feed panels are hidden without destroying the shared campaign DOM. The boss collapses into a remnant, vector relics burst from the boss body into deterministic scattered positions on every side. The victory banner appears when the loot race ends. Every stock unit is its own physical piece, scattered into seeded, irregular floor positions. Settled drops have generous, non-overlapping touch targets on phones; reduced motion skips travel and collapse animation. Empty loot pools still show victory.

Loot becomes claimable at a common time derived from `loot_started_at`: four seconds after defeat, capped at one quarter of unusually short loot windows. Snapshots include a server clock used to correct device clock differences. Active battle/loot sessions poll snapshots every second while visible; students already fighting enter automatically. A returning contributor can use **Enter loot battlefield** to resume the same stock/window. Closing or restarting a raid does not trigger a false victory. Confirmed pickups disappear from the floor on all clients without moving the remaining treasure. Expiry and finalization close controls in place, with confirmed loot and results still available.

Claims reuse the existing authenticated, row-locked RPC, per-student limits and idempotent receipt IDs. A failed request never grants a visual success or local inventory. A lost stock race refreshes the drop's state. Only the server-confirmed winner secures limited stock. Rendering preserves drop nodes during clock updates and pending requests; exit removes observers, timers and listeners and restores scrolling.

Apply [supabase/phase77_world_boss_loot_race.sql](supabase/phase77_world_boss_loot_race.sql) **after phase75** to enforce the shared release on the server. The latest full phase75 also includes this guard. Phase77 is repeatable, supports native text/UUID boss IDs, and preserves grants, events, reward history and balances. This workspace has tested it locally, not applied it to hosted Supabase.

- `npm run test:boss-loot` — two separate student browsers using the actual local PostgreSQL/PGlite RPC: final attack, passive classmate transition, server-clock release with a 30-second device clock difference, racing for one Legendary item, failed/retried claims, inventory, 320/390/1440 non-overlapping targets, resume, reduced motion, expiry, results and cleanup.
- `npm run test:boss-db` — includes installing phase77 over a pre-countdown function, repeat application and rejecting pre-release claims without inventory writes, for text and UUID boss IDs.


## Individual floor treasure (phase78)

Each reward quantity expands into that many independent pieces: twenty-two crystals produce twenty-two clickable crystals. There is no per-reward visual cap, stock counter, sold-out placeholder or separate outside-page claim-card flow. The return page opens the same battlefield. Pickups preserve the teacher's per-student limits. Larger piles extend the scrollable floor so every piece remains reachable.

The boss remains centered in the field, and every projectile starts at its body. The burst now uses a charging boss/core impact, expanding ground rings and shards, then individual arcing trajectories with different heights, multiple tumbles, landing compression, two bounces and dust. The seeded floor layout surrounds a centered boss, with small physical treasure targets instead of rows of cards. The victory banner stays hidden throughout looting and appears only after expiry or finalization. Pickup confirmation produces a short upward collection effect before removing the piece; another student's pickup removes that same piece. Remaining treasure never shifts. Reduced motion keeps stationary targets. Achievement and duplicate toast popups cannot cover the active floor; pickup feedback stays inline.

Apply [supabase/phase78_world_boss_floor_treasure.sql](supabase/phase78_world_boss_floor_treasure.sql) after phase75. This repeatable migration labels existing claims with stable `drop_index` values and adds a unique index per boss/reward/piece. The updated native text/UUID RPC validates the selected piece, ownership, stock, release time and personal limits under the existing boss lock. Two users clicking the same piece cannot both receive it even if other pieces of that reward remain. Older clients without a piece index are assigned one free piece. Retries retain both receipt and piece identity; inventory still increments once per confirmed pickup. Existing balances and inventory are preserved. The latest complete phase75 contains these changes as well; phase78 includes the phase77 shared-release/clock behavior.

The new floor requires the updated API; older installed battle functions show a teacher-update message instead of accepting ambiguous individual-piece claims. Hosted SQL has not been applied from this workspace.

Validation: `npm run test:boss-loot` uses two student browsers against the actual local PostgreSQL RPC, with a 25-piece pile, a same-piece race while another copy remains, separate one-by-one pickups, disappearance on both clients, fixed remaining positions, failed/retried receipts, inventory, 320/390/1440 hit targets, clock differences, resume, expiry and reduced motion. Database tests cover both key types, receipt backfill, replay/mismatched-piece rejection and repeatable migration. Unit and build checks remain part of the regression pass.


## Visible treasure ejection and pickup direction

Active fighters now receive a complete local rupture sequence when entering loot, even when a defeat snapshot arrives late. The old sequence subtracted server elapsed time and launched a whole pile within 280ms; that could skip the visible origin. The shared disabled-button theme also forced `transform:none!important`, keeping loot at its landing spots. Projectile art now animates in its own visual span while the real button stays disabled and stationary until landing. Server release, expiry, per-piece identity and inventory confirmation remain authoritative.

The boss compresses, lights along body cracks, ruptures with a ground shockwave and ejects individual treasures in a seeded order. Each piece is visible inside the boss before taking a tumbling arc and landing with compression, bounce and dust. Typical piles emit across several seconds, allowing earlier pieces to be picked up while later ones are still coming out. Large piles use a bounded emission span. Explicit resume and reduced motion show settled treasure immediately. Status updates preserve the art nodes and do not restart flight/trail effects.

The battlefield has no loot-race bar, visible countdown or remaining-time readout. Confirmed personal pickups add a brief spark ring, flying fragments and item-name flourish before disappearing; other students' claimed pieces simply vanish. Victory remains hidden until looting finishes. Closing mid-intro cancels pending ejections and effects. This presentation update requires no SQL beyond the previously documented phase78 individual-piece API.

`npm run test:boss-loot` now also checks progressive emission, the rendered treasure's position inside the boss during its first visible frames under the actual disabled-button theme, stable art nodes during clock updates, late-snapshot intros, mid-intro exit cleanup, no timer DOM, resume and reduced motion.


## Larger elemental battle arena and five new challenges

The active boss fight has a dedicated indigo/cyan/gold palette, independent of the main app theme. Desktop layouts expand to 1880px with a 350–520px boss wrapper, a taller stage, an illuminated geometric arena floor and larger question/answer controls. Existing artwork inline size limits are overridden only inside the active battle. Phone/tablet sizes remain separately constrained. Rage changes the background, HP, stage, aura and minion wards to crimson with warm highlights; correct answers remain green and wrong answers red. Loot retains its own presentation.

Five additional skills join the original six: **Lightning Storm** charges a choice beneath branching bolts; **Glacial Prison** raises ice spires and freezes choices that shatter when revealed; **Void Lance** projects crimson/violet beams and seals a choice; **Gravity Well** compresses and pulls moving choices; **Phantom Orbit** moves choices through opposing circular paths beneath boss echoes. They support the existing cooldown, phase-trigger, enabled and manual/auto controls. Ice/Gravity default to phase 2 and Void/Orbit to phase 3; manual teacher firing can override phase timing. The skill editor includes all eleven controls and usable phone layouts.

Wind, Earthquake, Roar, Gravity and Orbit intentionally make pointer targets difficult. Hover and pointer-down no longer add the steady-target class for these skills. Wind speed uses the configured setting; movement, shrinking, concealment and swapping preserve original text, IDs and handlers. Reveal-before-submit remains in effect for obscured choices. Effects clear at expiry, on a submitted answer or battle exit, and reduced motion retains static challenges. Positive durations support up to the editor's 60-second maximum. No new damage, XP, coin or loot rules are introduced.

Apply [supabase/phase79_world_boss_elemental_skills.sql](supabase/phase79_world_boss_elemental_skills.sql) after phase75 to allow **teacher-triggered signals** for the five additional skill IDs. This repeatable patch preserves native text/UUID signatures, grants, stored events and rewards. The updated complete phase75 and phase78 scripts include the expanded allowlist so reapplying them does not undo it. Automatic client-side casting and visual/layout improvements do not require this signal patch. Hosted SQL is not applied from this workspace.

Verification includes all eleven real browser effects; enlarged desktop artwork; pointer movement/hover behavior; answer identity and reveal guards; teacher configuration; 320/390/1440 layouts; rage/minions; duration cleanup; reduced motion; unchanged reward/progress state; and the full two-student loot regression. Database tests install phase79 over the old six-skill API, apply it twice, fire all five teacher signals, reject unknown/disabled skills and retain section/role checks for both text and UUID boss IDs.


## Battlefield-wide answer flight

Wind, Earthquake, Berserk Roar, Gravity Well and Phantom Orbit now release the **original answer buttons** from the question panel into a temporary fixed battlefield layer. Wind sweeps through broad paths, Orbit circles, Gravity pulls inward and releases, Earthquake throws targets in stepped jumps, and Roar scatters them in pulses. Hover does not steady them. The question and skill cue remain visible in a compact panel; controls are bounded to the visible arena above it and below the exit header.

No answer clones or alternate click handlers are created. Original DOM anchors preserve each option's text, ID, handler and order. Expiry, answer submission, skill replacement and exit cancel the entry/loop animations and return the same nodes. If the question has already been repainted, obsolete floating nodes are removed rather than restored into the new question. Resize/scroll rebuild paths within the new viewport without extending the skill duration; keyboard shortcuts still target the original IDs. Reduced motion keeps choices in their normal layout. This change needs no additional SQL.

The effects browser test checks real movement outside the question box, restoration and anchor cleanup, stale-question repaint, phone hit mapping and viewport bounds. Touch mapping uses a paused rendered frame to make the target selection deterministic; motion itself is verified separately through its actual Web Animations frames. The two-student SQL/browser loot test now lands the final attack from a floating answer and checks that battle-to-loot transition removes every floating control. Structural end-to-end tests use manual skill mode and long-lived minions to avoid random effects/expiry during responsive layout assertions.


## Shared raid feedback and Boss Studio motion

Confirmed raid snapshots now compare independent per-player cursors against the server's answer history. Every new damaging answer enters the local raid feed with its contributor and critical flag; the same snapshot never replays a hit. Cursors survive background roster pulls. Older receipts without answer history use an explicitly labeled total-since-update entry. Account and run identities isolate cursors, and a new run clears the feed. These are presentation changes: damage, XP, coins, inventory and reward authority remain on the existing server API. The existing one-second foreground battle snapshot loop delivers updates; this is not a new websocket transport and depends on connectivity.

The battlefield shows named damage for both your attacks and classmates' attacks. Rapid simultaneous hits are grouped per contributor, with at most three named groups plus one combined group per update to bound visual clutter; individual receipt entries remain in the feed. An expandable contribution panel lists all raiders, damage totals, class damage share and recovery state. Live refreshes preserve its disclosure, focus and scrolling. A sync indicator distinguishes confirmed updates from reconnecting.

Boss Studio now includes 25 presets (12 additional motions): Heavy Breathing, Predator Prowl, Arcane Levitation, Rune Ritual, Predator Lunge, Singularity Charge, Heavy Recoil, Armor Impact, Phase Distortion, Inferno Heartbeat, Mechanical Overdrive and Spectral Ascension. Assign these through the existing Idle/Cast/Hit/Rage slots. Existing assignments continue working. Saving an event also snapshots its selected animation definitions, so a teacher-local custom preset referencing shipped CSS resolves on student devices. Previously saved events with custom-only preset IDs should be opened and saved again to include those definitions. Presets still require their CSS to exist in the application. The battle resolves the exact event profile, uses its actual motion duration for hit recovery, shows hit flashes during casting, and returns transient animations to the idle or rage base stance. Rage no longer locks out casting/hit reactions. Question changes preserve the sprite and active animations. Legacy visual hooks respect configured rage thresholds. Reduced motion disables these animations.

Skills now telegraph for 1.2 seconds with a charge ring, skill icon, readable preparation card and progress bar before disrupting answers. Reduced motion applies the skill directly with a static cue. All cue timers and boss state timers are cleared on exit. No additional SQL is required beyond the already installed raid reliability API.

Verification: unit coverage for per-answer attribution, duplicate snapshot suppression, background roster replacement, run reset and old receipt fallback; actual two-student PostgreSQL/browser attacks with reciprocal named feedback, contributions, focus preservation and disconnect/reconnect; all 25 Studio presets checked against computed animations on the real boss sprite; cast/hit return to rage and sprite preservation through question redraw; existing mobile, effects, lifecycle and shared loot regressions. Hosted Supabase is not accessed by these tests.


## Cataclysm: shared interruptible ultimate (phase80)

Install [supabase/phase80_world_boss_ultimate.sql](supabase/phase80_world_boss_ultimate.sql) **after phase75** and any installed elemental patches. The repeatable migration keeps native text/UUID IDs, adds server-owned ultimate state and foreground raid presence, and patches the existing authoritative answer RPC without replacing its reward or loot implementation. Applying phase75 again afterward removes the hooks: reapply phase80 last. Hosted SQL has not been applied from this workspace.

Teachers configure Cataclysm in **World Boss → Skills**: enable it, choose automatic casting, set a 10–40 second cast window (default 18), a 10–35 second storm (default 22), 1–2 hearts of damage (default 1), and a 60–300 second recovery (default 120). Save before using the manual **Cast Cataclysm now** control. That control is disabled until a phase80 snapshot is present. Automatic casting first becomes eligible 45 seconds after the first active raid snapshot; the server starts one shared cast, not one random cast on each device.

Connected battle participants report foreground presence through the existing authenticated snapshot API. The server scales and freezes the required correct-answer count using available questions, the active answering roster and the configured question cooldown. Correct, newly accepted answers during the cast each contribute one fracture regardless of damage or critical multiplier. Wrong answers, replayed receipts and answers received after the server deadline do not advance the interrupt. Reaching the target shatters the core and cancels the ultimate. Defeating the boss cancels a pending ultimate before loot.

On failure the locked server transaction damages every non-KO participant seen on the battlefield within the last 20 seconds, once per cast. Explicit departure clears presence; returning after a disconnected cast does not retroactively mark the returning player present at impact. Zero HP uses the existing KO/revive flow. Failure transitions to an absolute, server-timed storm window, so refreshing or changing devices cannot restart it. Snapshot requests advance deadlines; no browser independently decides an outcome or writes health. The helper RPC is private, while section, account, run and teacher checks stay in the existing entry point.

The charge has orbiting runic rings, inward-moving fragments, a pulsing core, visible shared progress and accumulating fracture lines. Interruption explodes the core into mint-colored shards. Failure detonates it into crimson/purple shockwaves, debris, a vortex, sustained edge pressure and answer targets that move across the battlefield while half are sealed. Tap a seal to reveal the unchanged answer before submitting. The question remains visible. The storm persists across question changes and ends at its original server deadline. Ordinary local skill casts yield to the ultimate. Reduced motion retains the shared objective, countdown and temporary concealment with stationary choices and static effects.

Verification includes repeatable installation on text and UUID schemas; section/teacher/private-helper checks; wrong, replayed and deadline-late answers; successful class interruption; one-time class damage; explicit departure; KO and teacher revival; automatic casting; a one-answer remaining target; boss defeat cancellation; two actual student browsers against the SQL API; clock skew; shared progress and core fractures; question changes during the storm; 320/390/1440 layouts; reduced motion; expiry, loot transition and exit cleanup. Use `npm run test:boss-ultimate-db` and `npm run test:boss-ultimate`.
