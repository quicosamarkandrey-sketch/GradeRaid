// Phase 7 (2026-08-10, session 11) — bridge for the second real conversion.
// Same pattern as build/bridges/dom.bridge.js: import the real ESM
// exports, re-attach every one to `window` for not-yet-converted
// consumers. Only 1 symbol here, but the fan-in (3) still matters —
// checked against the dependency map before assuming a single-symbol
// file needs less care than dom.js's four.
import { renderStatBar } from '../../src/stat-bars.js';

window.renderStatBar = renderStatBar;
