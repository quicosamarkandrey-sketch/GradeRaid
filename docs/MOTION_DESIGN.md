# Motion and interaction direction

Everyday interactions acknowledge input immediately. Their animations last 70–260 ms and never gate navigation, focus, submitting, scanning or server confirmation. The Web Animations API handles key poses without a new rendering dependency or a continuous UI animation loop.

## Shared app behavior

- Dialog: a 250 ms entrance with a small lift, restrained scale overshoot and settling. Updating an open dialog gets a short fade; closing hides it immediately and restores focus.
- Navigation: 160 ms opacity change when the active page actually changes. Re-rendering the current page does not replay an entrance. Sidebar links and repeated list controls stay in place under the pointer.
- Controls: 70 ms press response and a quick eased release. Hover changes color/shadow rather than moving the target. Common touch controls have at least a 44 px hit height; icon buttons also have a 44 px minimum width.
- Errors: a small, one-time 240 ms nudge at the invalid field, while its readable error remains. Revalidating the same invalid field does not replay the effect.
- Notices: a 220 ms entrance; repeated updates to a reused element are suppressed within 400 ms. No fireworks around ordinary saves.
- Progress bars: a 260 ms eased fill transition. Percentages continue to come from real application data.
- Recitation: question/speaker entrances and score-number settling are brief. The teacher's selection suspense and the recognition card's reading time are preserved.
- Attendance: the portrait, name, checkmark and receipt appear within 280 ms, with a small staged offset. The existing hold-until-next-student behavior and duplicate-scan suppression remain.

Stable layouts, one clear next action, and the existing grouped navigation support familiar interaction. This pass does not add more choices or change data-entry/scoring rules. In particular, card identifiers and answers are never silently rewritten to fit an animation.

## Battle choreography

`AppMotion.pose()` samples key poses for a fallback hit, casting wind-up, release and rage transition. Contact compresses the body, recoil stretches it, and a small opposite motion settles back to neutral. The cast winds back before moving upward; release has a short follow-through. These offsets apply to fallback frames only. An authored Boss Studio state clip owns its exported poses and is not stretched a second time.

The CSS/static-art fallback uses matching recoil and anticipation poses. Confirmed damage numbers become legible at contact, then drift away along a small curve. A backdrop-only impact lasts 280 ms; question panels and buttons do not inherit camera shake.

Pixi effects stage focus by priority: a rage entrance takes precedence over casting/skill flourishes, which take precedence over routine hit flourishes. Other procedural motifs become quieter during the focus window, and ambient rage embers emit less often. Damage labels, cast warnings, skill mechanics and player-health information remain visible. Existing particle, texture and overlay caps still apply.

Loot follows sampled arc poses: body origin, rising stretch, apex, descent, landing squash, rebound, and a small final settle. Pickup art acknowledges confirmation within 280 ms. The actual buttons stay at their original floor positions. This does not change drop counts, shared release time, landing eligibility, expiry, claim limits, winner selection or inventory writes.

Skill warnings, skill durations, solar barrages, authored clips and the defeat-to-loot sequence are game events. Their existing durations are retained instead of compressing gameplay into a sub-300 ms UI transition. Player answers do not wait for visual effects to finish.

## Accessibility and cost

Reduced motion cancels running shared animations immediately, disables the new press/reveal/recoil motion, and keeps the existing battle fallback behavior. Background tabs cancel transient shared UI animations. Finished animations leave no permanent transforms or styles. The common UI layer uses no per-frame timer; only existing Pixi scenes sample battle poses while already rendering.

`AppMotion.enter(node, 'dialog' | 'update' | 'page' | 'notice' | 'error')` is the shared entrance helper. `cancel(node)` releases an active animation. `pose`, `arc` and `easeOut` are presentation helpers; they never write gameplay state. Motion tokens are in `styles/modules/motion-system.css`; battle choreography overrides are in `styles/modules/battle-motion.css`.

## Checks

Unit tests cover timing bounds, repeat suppression, reduced-motion cancellation, bounded squash/stretch, neutral settling, curved paths and eased progress. `npm run test:motion` exercises the actual browser's dialog, focus/input responsiveness, touch-target sizing, stable navigation and reduced motion. Pixi browser coverage verifies fallback compression and unmodified authored state clips. Existing loot/effects tests check that answer identities, classroom contributions and contested pickups keep their original behavior.
