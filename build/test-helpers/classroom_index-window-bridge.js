// Tiny helper module, imported FIRST by classroom_index-combined-entry.js.
// ES module evaluation runs each sibling import fully (in source order)
// BEFORE the importing module's own top-level code — so importing THIS
// module before classroom_index.js guarantees window.AppStore/window.DBService
// are set before classroom_index.js's own top-level `if (window.AppStore...)`
// load-order check runs. Without this, the combined-entry's own
// `window.AppStore = AppStore;` line (in ITS top-level code) would only run
// AFTER classroom_index.js has already evaluated (since ALL of an entry's
// imports evaluate before the entry's own body), causing that check to see
// `window.AppStore` as still unset and take the (here, dead-ended)
// DOMContentLoaded fallback branch instead.
import { AppStore } from '../../src/modules/core/state-manager.js';
import { DBService } from '../../src/db-service.js';
window.AppStore = AppStore;
window.DBService = DBService;
export { AppStore, DBService };
