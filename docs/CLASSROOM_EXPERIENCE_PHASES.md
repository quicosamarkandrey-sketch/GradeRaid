# Classroom experience phases

Approved scope: recommendations 1–6. Recommendations 7–9 (progress evidence, Armory goals and sounds) are excluded.

## Phase 1 — Answer Stage, teacher remote and classroom seating

Implemented in this release. This groups recommendations 1, 2, 3 and the Recitation Studio portion of 6 because they form the same classroom workflow.

### One home for recitation

Live Monitor retains attendance, attendance highlighting, projection, fitting and seat viewing. Its separate Recitation Active toggle, picker, phone-reader toolbar and recitation-score projection checkbox have been removed. The Recitation Studio entry passes the currently selected class. Old toggle calls open Studio instead of starting/stopping a second interface. Reconciliation stops local legacy capture without ending the shared session or deleting history. Studio stops the legacy reader listener when opening.

### Answer Stage

A clear question → call → answer → recognise rail makes the current moment understandable. The existing shared 2.4-second server-selected draw, square saved profile photos, private teacher notes, timers and confirmed points remain. Correction feedback is labelled as a correction. Scores/photos update in place; ordinary snapshot polls and awards no longer rebuild a room or replay the speaker reveal.

### Teacher remote

A persistent command dock puts calling, cardless points, undo and the next question close together. It shows the latest confirmed recipient. Question/classroom/speaker controls change the paired presentation through the existing server state. NFC and keyboard readers keep their existing supported-device rules and pending-award handling.

On phones, the large seating preview is optional. The projector keeps its full room. The phone can expand the room when needed and tap a student to inspect their score, give them the floor or open a preselected manual-award form. Tapping a seat itself never awards points. Absent students must be marked present before recitation actions become available. Private controls stay off the projection.

### Classroom floor

The room uses actual seat centres rather than fixed percentages against a zero-based bounding box. Square photos and central totals sit on light, restrained cards; the called student receives the accent. The front of the room is marked. Students without positions remain visible and eligible in a separate area.

The classroom presentation is borderless and shows the arrangement without toolbars, instructions, a mini-map or the surrounding app header. It automatically fits the available screen and can be exited with Escape. Fit, zoom, background panning, row focus, Find speaker and a mini-map are available only in the teacher remote's seating preview. Camera controls affect **this screen only**, labelled in the floor footer; shared question/view/layout choices still affect the paired screen. The classroom presentation automatically fits its aspect ratio. Zoom/pan survive score updates and mode changes within the same session/layout. Closing Studio clears local camera state. Keyboard users can pan with arrows, zoom with +/- and fit with Home or the mini-map's Enter action.

Confirmed awards travel in an arc from recognition to the visible student's score; correction uses a minus token. Flights do not run for queued/unconfirmed points, off-screen destinations or reduced motion. Recognition, room observers and flights are cleaned up when closing. Scoring, rewards and idempotency stay in the existing RPCs.

No new SQL migration is required. Existing phase81/phase82 Recitation Studio migrations must already be installed.

### Checks

- Unit tests cover negative/distant seat coordinates, row grouping, layout isolation, escaping and display-only controls.
- Real Chromium phone + projector backed by PostgreSQL covers filtering, suspense, photos, manual awards/undo, queue reload/reconnect, in-place scores, camera preservation, row focus, mini-map/keyboard, inspector actions, optional phone preview, 36 non-overlapping fitted seats, 320/390/768 views, reduced motion, summary, cleanup and removal of the duplicate Live Monitor toolbar.
- Existing unit suite and all role bundles are checked.

## Phase 2 — Boss Studio rehearsal

Next implementation phase: recommendation 4. Build a non-scoring encounter rehearsal with a scrubbable lifecycle (idle, cast, hit, rage, interrupt, defeat, loot), device previews and the same rendering/asset paths as battle. Rehearsal must not create events, score answers, claim inventory or send battle actions. Include loading/error feedback and clear controls for authored versus fallback motion.

## Phase 3 — Distinct boss identities

After rehearsal: recommendation 5. Use per-boss lighting, arena materials, casting language, impact texture and ultimate presentation. Keep readable gameplay cues and the device quality/reduced-motion budgets. Rehearsal becomes the place to assess and tune each identity before an event is launched.

Each phase is a reviewable implementation with its own validation and GitHub update, rather than shipping unfinished controls for later phases.
