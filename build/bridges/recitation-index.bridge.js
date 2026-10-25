// Phase 7 (2026-08-10, session 15) — bridge for the twelfth real conversion.
// The verification logic itself runs as module-top-level code inside
// src/recitation-index.js (matching the original's IIFE-runs-once
// behavior) — this import alone triggers it. window.__RECITATION_MODULE_
// VERSION__ is set inside the module too, so no extra bridge line is
// needed for it beyond the import itself, but re-stated explicitly here
// for the same reason every other bridge states its exports explicitly:
// makes what this bridge provides to not-yet-converted consumers visible
// at a glance, not implicit in a side effect.
import { MODULE_VERSION } from '../../src/recitation-index.js';

window.__RECITATION_MODULE_VERSION__ = MODULE_VERSION;
