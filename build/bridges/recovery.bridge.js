// Phase 7 (Stream A) — bridge for recovery.js.
// Importing this module also runs its own bottom-of-file IIFE (kept
// verbatim in src/) — registers the onAuthStateChange listener
// immediately, same as the original.
import { showRecoveryScreen, recCheckValidation, doSetNewPassword } from '../../src/recovery.js';

window.showRecoveryScreen = showRecoveryScreen;
window.recCheckValidation = recCheckValidation;
window.doSetNewPassword = doSetNewPassword;
