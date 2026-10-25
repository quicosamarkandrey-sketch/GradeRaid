// Phase 7 (Stream A) — bridge for app-state.js.
import {
  getDB,
  setDB,
  getCurrentUser,
  setCurrentUser,
  getCurrentRole,
  setCurrentRole,
  getSelectedLoginRole,
  setSelectedLoginRole,
  checkLevelUp,
} from '../../src/app-state.js';

window.getDB = getDB;
window.setDB = setDB;
window.getCurrentUser = getCurrentUser;
window.setCurrentUser = setCurrentUser;
window.getCurrentRole = getCurrentRole;
window.setCurrentRole = setCurrentRole;
window.getSelectedLoginRole = getSelectedLoginRole;
window.setSelectedLoginRole = setSelectedLoginRole;
window.checkLevelUp = checkLevelUp;
