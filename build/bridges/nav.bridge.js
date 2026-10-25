// Phase 7 (Stream A) — bridge for nav.js.
import {
  NAV_STUDENT,
  NAV_ADMIN,
  ADMIN_ONLY_NAV_IDS,
  setupSidebar,
  dsmGetStudentNav,
  dsmGetAdminNav,
  dsmGetTeacherNav,
  _navToCore,
  navTo,
  showPage,
  LAST_PAGE_KEY,
  saveLastVisitedPage,
  getLastVisitedPage,
} from '../../src/nav.js';

window.NAV_STUDENT = NAV_STUDENT;
window.NAV_ADMIN = NAV_ADMIN;
window.ADMIN_ONLY_NAV_IDS = ADMIN_ONLY_NAV_IDS;
window.setupSidebar = setupSidebar;
window.dsmGetStudentNav = dsmGetStudentNav;
window.dsmGetAdminNav = dsmGetAdminNav;
window.dsmGetTeacherNav = dsmGetTeacherNav;
window._navToCore = _navToCore;
window.navTo = navTo;
window.showPage = showPage;
window.LAST_PAGE_KEY = LAST_PAGE_KEY;
window.saveLastVisitedPage = saveLastVisitedPage;
window.getLastVisitedPage = getLastVisitedPage;
