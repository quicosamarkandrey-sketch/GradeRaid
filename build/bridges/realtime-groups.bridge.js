// Phase 7 (Stream A) — bridge for repository/realtime-groups.js.
// Only this file's own 2 symbols need re-attaching — the 27 pull-
// mappers.js symbols it imports are already re-attached by
// pull-mappers.bridge.js separately (both bridges are bundled
// independently; each contains its own inlined copy of pull-mappers.js's
// implementation, same disclosed characteristic as utils.bridge.js in
// an earlier session — not a duplicate-symbol bug, expected for
// per-file bridge testing).
import { _REALTIME_TABLE_GROUPS, _REFRESH_GROUPS } from '../../src/realtime-groups.js';

window._REALTIME_TABLE_GROUPS = _REALTIME_TABLE_GROUPS;
window._REFRESH_GROUPS = _REFRESH_GROUPS;
