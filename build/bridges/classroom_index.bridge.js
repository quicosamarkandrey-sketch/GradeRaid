// Phase 7 (Stream D) — bridge for modules/seat-arrangement/classroom_index.js.
// Re-attaches all 3 real exports to window.
import {
  __CLASSROOM_MODULE_VERSION__,
  refreshClassroomData,
  _classroomIndexTeardown,
} from '../../src/modules/seat-arrangement/classroom_index.js';

window.__CLASSROOM_MODULE_VERSION__ = __CLASSROOM_MODULE_VERSION__;
window.refreshClassroomData = refreshClassroomData;
window._classroomIndexTeardown = _classroomIndexTeardown;
