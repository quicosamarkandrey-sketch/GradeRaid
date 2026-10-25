// Test-only combined entry point for verify-student-inbox-bridge.js.
//
// NOT a production bridge — student-inbox.bridge.js (build/bridges/) is
// the real deliverable and correctly only re-attaches its own file's
// exports. This exists solely so the verify script can seed/read the
// SAME real AppStore instance mailOpenDetail() reads mail from
// directly (AppStore.getSlice), and so the test's own mail-engine.js
// stand-in functions (mail-engine.js isn't converted by this stream
// yet) can mutate the SAME AppStore slice consistently.
import { AppStore } from '../../src/modules/core/state-manager.js';
import { eqRewardPresent } from '../../src/modules/shared/reward-presenter.js';
import { renderStudentMail, mailOpenDetail, mailDoClaimRewards } from '../../src/modules/mail/student-inbox.js';

window.AppStore = AppStore;
window.eqRewardPresent = eqRewardPresent;
window.renderStudentMail = renderStudentMail;
window.mailOpenDetail = mailOpenDetail;
window.mailDoClaimRewards = mailDoClaimRewards;
