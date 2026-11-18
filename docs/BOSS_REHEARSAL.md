# Boss encounter rehearsal and visual identities

## Rehearse a boss

Open Boss Studio → edit/create a boss → **Animations → Open encounter rehearsal**. Theme → **Rehearse this encounter** opens the same stage.

The rehearsal takes a snapshot of the current draft. It does not publish that draft, create a World Boss event, submit answers, award points, or claim loot. The preview question's buttons trigger visual previews only. Closing returns focus to the editor; editor close/logout also destroys the rehearsal.

The 25-second visual sequence covers idle, wind-up, skill release, confirmed hit, rage, ultimate charge, interrupt/eruption, defeat and treasure. Play/pause, restart, speed, cue buttons and a scrubber let the teacher inspect the sequence. The outcome selector can show either a successful class interrupt or a completed ultimate. The event's actual timings and mechanics remain in its settings; this is an illustrative director's timeline.

Desktop, projector and phone frames help inspect proportions and cue readability. Light/Standard/High use the existing Pixi renderer and its texture/particle caps; Off uses the poster/preset fallback. Background tabs pause playback. Reduced motion uses the static presentation. Bad assets keep the poster available and report the loading error. Graphics context loss restores the poster; changing quality can rebuild the renderer.

Authored idle/cast/hit/rage/defeat clips use the same validated grid/atlas source loader and GPU renderer as battle. Rehearsal can seek directly between poses without the live fight's casting lock, while the live fight retains that lock. CSS presets are paused and sampled against the rehearsal cursor rather than continuing independently when paused. Particle playback is live; seeking reconstructs the current cue instead of simulating the full historical particle path. Individual animation-slot preview remains available for reviewing a clip's entire exported duration.

Treasure uses the live loot silhouette registry. These are preview objects, not claimable server tokens. The victory preview follows the treasure cue.

## Give each boss an identity

Boss Studio → **Theme → Encounter identity**:

| Identity | Arena and casting language | Ultimate presentation |
|---|---|---|
| Classic arena | Existing blue arena | Cataclysm solar crown |
| Obsidian dominion | Fractured basalt, scale geometry, cinder light | Solar Rupture |
| Clockwork citadel | Mechanical rings, gear teeth, pressure lines | Core Overload reactor seal |
| Veil sanctuary | Layered crescents, suspended shards, violet light | Eclipse Collapse seal |

Restrained/Balanced/Dramatic scales presentation density within the existing device limits. The common red escalation and visible damage cues remain. Each identity changes arena art, procedural casting accents, palette and ultimate glyph/title. It does **not** introduce a new damage formula or bypass the shared interrupt/answer/heart rules. Ultimate gameplay is still the event's existing Cataclysm mechanic; the identities give it distinct visual presentation.

New wyrm, sentinel and phantom starters select matching identities. Existing bosses keep Classic unless explicitly changed. The identity lives in the existing boss-profile JSON as `visualIdentity: {version: 1, type, intensity}`. Unknown types/intensities resolve to safe defaults. Save the profile, then **save its linked event** to deploy that snapshot to students. The saved profile's authored animation assets and identity travel together.

No new SQL migration or external graphics dependency is required. Existing World Boss migrations and shared artwork storage still apply.

## Validation

`npm run test:boss-rehearsal` exercises actual Chromium/WebGL with authored sprites: all lifecycle cues, fast scrubbing, pause/play, both ultimate outcomes, shared loot art, identity choices, quality fallback/recovery, invalid assets, phone widths, reduced motion, cleanup and absence of score/claim/publish RPCs. Existing Pixi tests verify profile saving/event deployment with an identity. The PostgreSQL-backed ultimate test runs under the clockwork identity to check the existing fight mechanics.
