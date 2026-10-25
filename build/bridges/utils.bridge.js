// Phase 7 (2026-08-10, session 18) — bridge for the nineteenth real
// conversion (first non-leaf: utils.js imports toast from src/dom.js
// internally, resolved via the real module graph — not a window read).
import { uid, _esc, _cssColor, todayStr, nowStr, isoDate, csvDownload } from '../../src/utils.js';

window.uid = uid;
window._esc = _esc;
window._cssColor = _cssColor;
window.todayStr = todayStr;
window.nowStr = nowStr;
window.isoDate = isoDate;
window.csvDownload = csvDownload;
