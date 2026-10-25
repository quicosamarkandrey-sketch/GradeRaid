// Phase 7 (Stream D) — bridge for modules/seat-arrangement/recitation-service.js.
// Re-attaches the single real export (RecitationService) to window.
import {
  RecitationService,
} from '../../src/modules/seat-arrangement/recitation-service.js';

window.RecitationService = RecitationService;
