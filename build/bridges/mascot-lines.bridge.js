// Phase 7, Stream B — bridge for modules/admin/mascot-lines.js.
// Bridges all 4 real onclick/nav-reachable window exports. The 12 other
// exports (MASCOT_LINES_EVENTS, the 5 `let` cache/UI-state variables, and
// the 6 internal `_ml*` helper functions) have zero real cross-file
// consumers today (confirmed via grep — see MEMORY.md) so they are not
// re-attached to `window`; they're exported from src/ only so a future
// consumer could `import` them directly instead of reaching through
// `window`, per the "export it anyway" rule.
import { renderMascotLines, mlAddLine, mlDeleteLine, saveMascotLines } from '../../src/modules/admin/mascot-lines.js';

window.renderMascotLines = renderMascotLines;
window.mlAddLine = mlAddLine;
window.mlDeleteLine = mlDeleteLine;
window.saveMascotLines = saveMascotLines;
