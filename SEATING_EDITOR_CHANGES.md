# Seating editor improvements

The current classic-script application (`index.html`) now loads
`modules/seat-arrangement/classroom-editor.js`. The parallel Phase 7 ESM
migration has not been cut over or changed by this feature.

- Undo/redo for unsaved local seat/prop additions, deletion, rotation,
  duplication, movement and layout renaming. Ctrl/Cmd+Z, Shift+Z and Ctrl+Y
  work outside input fields. History is capped at 80 edits and cleared when
  saving, generating a blueprint, switching layouts/classes, or deleting.
  Server operations and student assignments are outside local undo.
- Multi-select button and background rectangle selection; Shift remains
  an optional shortcut. Drag any selected seat to move the group.
- Live pointer movement previews the actual seats. Group movement is
  constrained as one unit at room boundaries. Escape cancels a drag.
- Editor-only seat display size (40–120px) and an undoable Fit all seats
  action that brings seat coordinates into the existing room dimensions.
  Save Layout persists fitted/moved coordinates. Seat display size is a
  temporary editing aid; Live Monitor uses its existing seat sizing.

## Validation

`npm run test:unit`: 185 passed.
Targeted ESLint: no errors; 9 warnings (existing rendering pattern).

Browser interaction regression check, using the real builder scripts and
stubbed service/state data (no production requests or writes):

1. Serve this directory: `python -m http.server 4174 --bind 127.0.0.1`
2. Run `node tests/browser/seating-editor.cjs`.
   Uses `/usr/bin/chromium`, overridable through `CHROMIUM_PATH`.

This verifies selection, grouped movement, undo/redo, add-seat undo, sizing,
fit for oversized layouts, and cancellation. Authenticated Supabase saving,
physical touch hardware and NFC were not validated by this check.
