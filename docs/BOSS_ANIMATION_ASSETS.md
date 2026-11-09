# Boss animation assets and PixiJS

The battlefield now has a locally hosted, lazy-loaded PixiJS 8.22.0 WebGL layer. HTML still owns questions, buttons, accessibility and gameplay interactions. The server still owns answers, damage, hearts, phases and limited loot claims. No animation frame is sent over realtime or used to decide a reward.

## Preparing your artwork

Use either:

- **Grid spritesheet:** one PNG or WebP containing equally sized frames, ordered left-to-right then top-to-bottom. Enter columns, rows, first/last frame (zero-based, last inclusive), FPS and scale in Boss Studio.
- **Single-page JSON atlas:** TexturePacker JSON or Aseprite JSON, plus its PNG/WebP image. Named `animations` groups and Aseprite `meta.frameTags` are supported, including forward/reverse/ping-pong tags. Trimmed and rotated TexturePacker frames are supported. Multi-page atlases are rejected rather than partly rendered.

This does not import Spine skeletons, Rive files, GIF timelines, videos, Blender projects or 3D models. Render those to spritesheets or export a supported atlas first. For Blender, keep the camera, framing and lighting consistent between frames and render with transparent backgrounds. Supply a static poster in the existing Artwork tab for loading, reduced motion, unsupported devices and failed assets.

Recommended first delivery:

| Clip | Behavior | Suggested length |
|---|---|---|
| Idle | seamless loop | 1–3 seconds |
| Casting | anticipation and release; the final pose can be held during an ultimate charge | 0.7–2 seconds |
| Hit | recoil and recovery | 0.2–0.6 seconds |
| Rage | seamless transformed stance | 1–3 seconds |
| Defeat | collapse, breakup or dissolve | 1–3 seconds |
| Skill/VFX overlays | transparent hit, rage or named skill effect | 0.5–4 seconds |

Use the same logical frame canvas and pivot between states to avoid jumping. Default anchor is `(0.5, 0.5)`; adjust scale/anchors in the preview if the exported art needs it. Do not bake question text, player scores or loot into artwork.

Start at 12–24 FPS with a sheet of 1024–2048 pixels per side. A 2048×2048 image consumes approximately **16 MiB of decoded texture memory**, even if its WebP file is only a few hundred kilobytes. Prefer reusing one atlas across multiple states. Maximum: 4096 px per side, 512 frames per clip/group, 12 MiB downloaded image, 512 KiB JSON manifest, 1–60 FPS and ten seconds for one-shot clips. Large sheets can be refused on Light/Standard settings; the poster remains visible.

## Boss Studio workflow

1. Open a boss → **Animations → Animated assets · PixiJS**.
2. Choose Idle, Casting, Hit, Rage, Defeat, Hit/Rage VFX overlay, or a named skill slot.
3. Choose Grid or JSON atlas and enter its public URL/settings. Alternatively open **Upload to the shared boss-art library** and upload the image plus matching JSON for an atlas. The uploader replaces `meta.image` with the shared image URL.
4. Preview the asset using the same renderer as battle. Check crop, anchor, frame range and speed. The main cinema state buttons can play assigned authored assets too. The fallback CSS presets remain available for static artwork.
5. Save the boss profile. **Save the linked World Boss event** to copy the updated asset settings into its student-visible visual profile. Existing events retain their saved profile until updated.

Uploads use the existing `boss-art` bucket and owner-prefixed storage paths. Files must actually upload successfully; blob/IndexedDB/local-only animation references are not deployed. A host used for URL-based assets must allow browser CORS requests. Prefer immutable/versioned filenames with cache headers. If a bucket has manually restricted its MIME types to images only, host the JSON externally or allow `application/json` in that bucket's configuration. No new database migration is required for these optional profile fields; the existing boss profile/event storage must already be installed.

Example grid settings for a 2048×2048 sheet of 16 square 512px frames:

```json
{
  "version": 1,
  "slots": {
    "idle": {
      "type": "grid",
      "url": "https://YOUR-ASSET-HOST/boss-idle.webp",
      "columns": 4,
      "rows": 4,
      "start": 0,
      "end": 15,
      "fps": 12,
      "scale": 1,
      "anchorX": 0.5,
      "anchorY": 0.5
    }
  }
}
```

For an atlas, use `type: "atlas"`, the JSON URL, `animation: "idle"` (the exported group/tag name), FPS, scale and anchors. Studio writes these settings for you; editing JSON by hand is optional.

## Visual improvements

Hits use bounded impact sparks and expanding ground rings. Casting gathers energy inward. Rage adds red embers and a persistent ground aura. Wind, lightning, earthquake, ice, meteors, gravity, darkness, void, phantom, mirror and sonic skills have distinct complementary GPU motifs. Up to three motifs remain active at once. Existing answer disruption stays controlled by its original skill lifecycle.

Cataclysm retains its readable casting progress and original answer-rebuild mechanics, with GPU charging rings/fractures, confirmed-progress impacts and continuous layered solar shafts. Ending/interruption clears the extra solar layer. Custom Cataclysm artwork can occupy its named VFX slot.

The defeat-to-loot field can play the authored Defeat clip. It adds a body-origin burst, capped spark trails following the actual emitted treasure, landing rings and confirmed pickup sparks. These never postpone server release/expiry clocks. Late arrivals see settled loot without replaying a false drop race. Treasure has new faceted rarity silhouettes, small floor plinths, and a limited set of gentle epic/legendary accents. Each object remains the same individually claimable server token. Claimed items disappear through the existing receipt flow; no new stock counters or premature victory banner are introduced.

## Performance and concurrent classes

PixiJS runs on **each student's GPU**. Having more students does not multiply the number of bosses, renderers or particles on another student's phone. Graphics callbacks make no scoring RPCs. However, more students still mean more asset downloads, answer submissions, state synchronization and contested loot requests. This change is not a production load test or a guarantee of unlimited classroom capacity.

Protection in this release:

- Auto picks Light on small screens or reported lower-memory/CPU devices; otherwise Standard. The in-battle Effects selector supports Auto, Light, Standard, High and Off. Off uses the existing artwork/effects fallback; skill mechanics remain active.
- Light: 30 FPS, 1× resolution, 80 active particles, 16 MiB estimated image-texture budget. Standard: 45 FPS, up to 1.5×, 180 particles, 40 MiB. High: 60 FPS, up to 2×, 320 particles, 64 MiB.
- Sustained slow frames lower the effect tier. Background tabs pause rendering and clear transient particles. Reduced-motion mode keeps the standard artwork and original accessible presentation instead of loading extra battle animation.
- Same-image clips share one GPU source; atlas JSON is parsed once per scene. Older unpinned sheets are evicted under budget pressure. Active overlay clips are capped at three; failed/budget-exceeding clips restore the poster. Downloads have size and time limits.
- Canvases never receive pointer input. Questions/choices remain HTML. Battle exit, loot exit, profile-preview close and logout cancel loading and destroy the owned renderer, textures and listeners.
- The engine bundle is about 516 KiB minified before HTTP compression, loaded only on battle/preview/loot demand. It is committed locally, so there is no runtime CDN dependency for the engine. Use compressed, shared sheets to keep the first class-wide download reasonable.

Backend capacity depends on the Supabase plan, realtime/polling load, database indexes and classroom internet. Measure a real class or staging load before claiming a specific simultaneous-player limit. The particle stress test verifies local caps and scoring separation, not production server throughput.

## Development and checks

`npm run build:pixi` rebuilds the pinned browser bundle from `pixi.js`; commit the bundle and license together. `npm run test:boss-pixi` exercises real WebGL under Chromium/SwiftShader against the actual app and PostgreSQL-backed boss actions. Unit tests validate asset formats and bounds. Existing effects, ultimate and loot-race tests verify the preserved gameplay/claim flow.
