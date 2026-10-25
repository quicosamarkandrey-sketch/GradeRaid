// Test-only combined entry point for verify-classroom_index-bridge.js.
// Not a production bridge. window.AppStore/window.DBService are set by the
// window-bridge helper module BEFORE classroom_index.js evaluates — see
// that file's comment for why plain assignment in THIS file's own body
// would be too late.
import './classroom_index-window-bridge.js';
import * as ciExports from '../../src/modules/seat-arrangement/classroom_index.js';

Object.keys(ciExports).forEach(k => { window[k] = ciExports[k]; });
