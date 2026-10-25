// Phase 7 (Stream A) — bridge for index.html#inline1 (src/inline1.js).
//
// currentUser/currentRole/selectedLoginRole re-attachment here is a
// ONE-TIME snapshot at bridge-load time, same as every other `export
// let` bridge — see src/inline1.js's own header for why that's the
// correct, intended behavior for these three specifically (their true
// "live" value becomes whichever classic script last wrote to window,
// once this file is no longer a classic script itself).
import {
  XP_PER_LEVEL,
  getLevel,
  getNowLabel,
  DB,
  currentUser,
  currentRole,
  selectedLoginRole,
} from '../../src/inline1.js';

window.XP_PER_LEVEL = XP_PER_LEVEL;
window.getLevel = getLevel;
window.getNowLabel = getNowLabel;
window.DB = DB;
window.currentUser = currentUser;
window.currentRole = currentRole;
window.selectedLoginRole = selectedLoginRole;
