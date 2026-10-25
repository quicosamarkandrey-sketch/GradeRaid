// Phase 7, Stream B — bridge for modules/admin/sections_index.js.
import { MODULE_VERSION, _bootstrapSectionData, _sectionsIndexTeardown } from '../../src/modules/admin/sections_index.js';

window.__SECTIONS_MODULE_VERSION__ = MODULE_VERSION;
window.refreshSectionData = _bootstrapSectionData;
window._sectionsIndexTeardown = _sectionsIndexTeardown;
