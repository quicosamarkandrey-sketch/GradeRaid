// Phase 7 (Stream D) — bridge for modules/leaderboard/eql-engine.js.
// Re-attaches all 6 real exports to window (5 compute/build functions + EQL).
import {
  eqlComputeRecitation,
  eqlComputeBoss,
  eqlComputeAcademic,
  eqlComputeOverall,
  eqlBuildCategory,
  EQL,
} from '../../src/modules/leaderboard/eql-engine.js';

window.eqlComputeRecitation = eqlComputeRecitation;
window.eqlComputeBoss = eqlComputeBoss;
window.eqlComputeAcademic = eqlComputeAcademic;
window.eqlComputeOverall = eqlComputeOverall;
window.eqlBuildCategory = eqlBuildCategory;
window.EQL = EQL;
