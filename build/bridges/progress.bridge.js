// Phase 7 (Stream A) — bridge for modules/recitation/progress.js.
//
// Note on progCalYear/progCalMonth/progActiveTab: these are `export
// let` (mutable module state, reassigned internally by
// progCalNav()/progSwitchTab()). The `window.progCalYear = progCalYear`
// lines below copy the value ONCE at bridge-load time — they do NOT
// stay live as the module's internal binding changes afterward (real
// ESM live-binding only applies to other modules that `import` these
// names, not to a one-time window property copy). Confirmed via a
// repo-wide grep (src/modules/recitation/progress.js's own header) that
// nothing outside this file ever reads `window.progCalYear/Month/
// ActiveTab` — all real reads happen through this file's own functions,
// which correctly see the live module binding — so this staleness is
// inert in practice, not a behavior change worth engineering around.
import {
  PROG_ATTENDANCE_MILESTONES,
  PROG_RECITATION_MILESTONES,
  progCalYear,
  progCalMonth,
  progActiveTab,
  progGetAttendanceForStudent,
  progGetRecitationsForStudent,
  progAttStreak,
  progRecStreak,
  progPerfectMonths,
  progBuildCalendar,
  progRenderStreaks,
  progRenderCalendarPanel,
  progRenderRecitationPanel,
  progRenderMilestones,
  progRenderShowcase,
  renderStudentProgress,
  progSwitchTab,
  progCalNav,
  progShowCalDay,
} from '../../src/modules/recitation/progress.js';

window.PROG_ATTENDANCE_MILESTONES = PROG_ATTENDANCE_MILESTONES;
window.PROG_RECITATION_MILESTONES = PROG_RECITATION_MILESTONES;
window.progCalYear = progCalYear;
window.progCalMonth = progCalMonth;
window.progActiveTab = progActiveTab;
window.progGetAttendanceForStudent = progGetAttendanceForStudent;
window.progGetRecitationsForStudent = progGetRecitationsForStudent;
window.progAttStreak = progAttStreak;
window.progRecStreak = progRecStreak;
window.progPerfectMonths = progPerfectMonths;
window.progBuildCalendar = progBuildCalendar;
window.progRenderStreaks = progRenderStreaks;
window.progRenderCalendarPanel = progRenderCalendarPanel;
window.progRenderRecitationPanel = progRenderRecitationPanel;
window.progRenderMilestones = progRenderMilestones;
window.progRenderShowcase = progRenderShowcase;
window.renderStudentProgress = renderStudentProgress;
window.progSwitchTab = progSwitchTab;
window.progCalNav = progCalNav;
window.progShowCalDay = progShowCalDay;
