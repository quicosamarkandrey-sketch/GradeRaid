// Phase 7 (Stream A) — bridge for auth.js.
import { selectRole, doLogin, showLoginScreen, restoreSession, doLogout, bootApp } from '../../src/auth.js';

window.selectRole = selectRole;
window.doLogin = doLogin;
window.showLoginScreen = showLoginScreen;
window.restoreSession = restoreSession;
window.doLogout = doLogout;
window.bootApp = bootApp;
