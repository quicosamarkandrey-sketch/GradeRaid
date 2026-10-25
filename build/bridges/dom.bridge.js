// Phase 7 (2026-08-10, session 6) — bridge for the first real conversion.
//
// This is what step 5.4's eventual entry point needs to do for EVERY
// converted src/ file until its consumers are also converted: import the
// real exports, then explicitly re-attach each one to `window`, because
// nothing about a real ES module's exports automatically ends up on
// `window` the way a classic top-level `function` declaration does.
//
// Bridges ALL of src/dom.js's exports, not just the subset session 2
// flagged as onclick-reachable — confirmed via the dependency map that
// `showModal` specifically has 34+ real bare-call consumers and ZERO
// explicit `window.showModal =` anywhere; it works today purely because
// dom.js is an unconverted classic script. A partial bridge would have
// silently broken it the moment dom.js's classic copy was replaced.
import { toast, showModal, closeModal, closeModalForce } from '../../src/dom.js';

window.toast = toast;
window.showModal = showModal;
window.closeModal = closeModal;
window.closeModalForce = closeModalForce;
