// Phase 7, Stream B — bridge for modules/enrollment/enrollment-hub.js.
// Importing this module also runs its own `window._enrollPersistLock =
// _enrollPersistLock;` load-time side effect (kept verbatim in src/) —
// this bridge doesn't need to re-attach that one itself.
import {
  renderEnrollmentHub, unmountEnrollmentHub, _enrollConfirmForce,
  _enrollOnSearchInput, _enrollOnSectionChange, _enrollOnCardFilterChange,
  _enrollLockKiosk, _enrollShowUnlockPrompt, _enrollSubmitUnlock,
  _enrollHasPersistedLock, _enrollRestoreLockedKioskOnBoot, _enrollSetMode,
  _enrollStartTarget, _enrollCancelTarget, _kioskOnSearchInput,
  _kioskSelectStudent, _kioskSubmitPassword, _kioskResetToSearch,
} from '../../src/modules/enrollment/enrollment-hub.js';

window.renderEnrollmentHub = renderEnrollmentHub;
window.unmountEnrollmentHub = unmountEnrollmentHub;
window._enrollConfirmForce = _enrollConfirmForce;
window._enrollOnSearchInput = _enrollOnSearchInput;
window._enrollOnSectionChange = _enrollOnSectionChange;
window._enrollOnCardFilterChange = _enrollOnCardFilterChange;
window._enrollLockKiosk = _enrollLockKiosk;
window._enrollShowUnlockPrompt = _enrollShowUnlockPrompt;
window._enrollSubmitUnlock = _enrollSubmitUnlock;
window._enrollHasPersistedLock = _enrollHasPersistedLock;
window._enrollRestoreLockedKioskOnBoot = _enrollRestoreLockedKioskOnBoot;
window._enrollSetMode = _enrollSetMode;
window._enrollStartTarget = _enrollStartTarget;
window._enrollCancelTarget = _enrollCancelTarget;
window._kioskOnSearchInput = _kioskOnSearchInput;
window._kioskSelectStudent = _kioskSelectStudent;
window._kioskSubmitPassword = _kioskSubmitPassword;
window._kioskResetToSearch = _kioskResetToSearch;
