// Phase 7 (Stream D) — bridge for modules/seat-arrangement/classroom-service.js.
// Re-attaches the single real export (ClassroomService) to window.
import {
  ClassroomService,
} from '../../src/modules/seat-arrangement/classroom-service.js';

window.ClassroomService = ClassroomService;
