// Phase 7 (Stream A) — bridge for error-capture.js.
// Importing this module also runs its own `window.onerror =
// handleWindowError;` load-time side effect (kept verbatim in src/) —
// this bridge's re-attachment is technically redundant with that, but
// present anyway to match the established per-file checklist shape
// (every real export re-attached to window).
import { handleWindowError } from '../../src/error-capture.js';

window.onerror = handleWindowError;
