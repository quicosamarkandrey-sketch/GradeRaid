// Phase 7, Stream B — bridge for modules/admin/command-center.js.
// Importing this module runs the same load-time side effect the original
// did: registering the AppStore.subscribe('command-center', ...) listener
// immediately. This bridge's job is only to re-attach the 2 real
// onclick/nav.js-called exports that the original set via `window.X =`.
import { renderAdminDashboard, unmountCommandCenter } from '../../src/modules/admin/command-center.js';

window.renderAdminDashboard = renderAdminDashboard;
window.unmountCommandCenter = unmountCommandCenter;
