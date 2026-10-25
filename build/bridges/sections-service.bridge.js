// Phase 7, Stream B — bridge for modules/admin/sections-service.js.
import { SectionService, getActiveClassIds, getClassLabel, getMySectionsLabel } from '../../src/modules/admin/sections-service.js';

window.SectionService = SectionService;
window.getActiveClassIds = getActiveClassIds;
window.getClassLabel = getClassLabel;
window.getMySectionsLabel = getMySectionsLabel;
