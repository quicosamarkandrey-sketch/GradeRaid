// Test-only combined entry point for verify-reward-presenter-bridge.js.
//
// NOT a production bridge — reward-presenter.bridge.js (build/bridges/)
// is the real deliverable and correctly only re-attaches its own file's
// exports. This exists solely so the verify script can drive the
// module's internal AppStore.subscribe() calls (registered at load time
// against the SAME real AppStore instance the bundle uses internally)
// via window.AppStore.emit(...) — reward-presenter.bridge.js alone has
// no reason to expose AppStore on window in production, since nothing
// else needs it from that bridge specifically.
import { AppStore } from '../../src/modules/core/state-manager.js';
import { EQR_RARITY_COLORS, EQR_SOURCE_LABELS, eqRewardPresent, _eqrRunParticles } from '../../src/modules/shared/reward-presenter.js';

window.AppStore = AppStore;
window.EQR_RARITY_COLORS = EQR_RARITY_COLORS;
window.EQR_SOURCE_LABELS = EQR_SOURCE_LABELS;
window.eqRewardPresent = eqRewardPresent;
window._eqrRunParticles = _eqrRunParticles;
