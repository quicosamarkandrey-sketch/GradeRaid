// ─────────────────────────────────────────────────────────────────────────────
// SHARED UTILS — Stateless generic helpers used across all modules
//
// Phase 6 (Decompose God Files): this file used to be a 1,195-line grab bag
// mixing generic string/id/date helpers with student-stat business logic and
// the entire Quest Board quiz engine. Those two domains moved out to their
// own files — student-stats.js (recalc/attendance/sync-to-server RPCs) and
// modules/quest-engine.js (quiz grading, staging, rarity/cadence, mascot
// lines) — so this file now holds only what its own header always claimed:
// small, stateless, genuinely-shared formatting/id/escaping helpers with no
// domain of their own. No behavior change — every function below is moved
// verbatim from the original utils.js.
//
// Exports: uid(), todayStr(), nowStr(), isoDate(), csvDownload(), _esc(),
//          _cssColor()
//
// DEPENDENCIES:
//   csvDownload() calls toast() — toast must be available in scope.
// ─────────────────────────────────────────────────────────────────────────────

function uid(){return'id_'+Math.random().toString(36).substr(2,9);}

// RESTORED: _esc() is used by 30+ module files (boss-studio, world-boss, shop,
// titles, achievements, attendance, campaign, mail, admin) but was previously
// only defined inside modules/world-boss/admin-page.js, which loads quite late
// in the script order. Any module that loaded before admin-page.js and called
// _esc() during initial render would throw "ReferenceError: _esc is not
// defined". Moved here (utils.js loads near the very top) to guarantee it's
// available everywhere. Ported verbatim from the original inline script.
function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
window._esc = _esc;

// _cssColor(s) — Tier 2 debt fix (studentColor/studentInit CSS-injection
// audit). Student `color` values are drawn from a fixed admin-defined hex
// palette (see modules/admin/registrations.js's `colors` array) and are
// never free text today, but dozens of render sites across the app
// (my-section.js, hall-of-fame.js, and others) interpolate that value
// directly into `style="..."` attributes — and in a couple of hall-of-fame.js
// spots, into an inline `onerror="...'${color}'..."` JS-attribute string.
// That's an attribute-breakout hazard, not just a styling one, the moment
// this field's provenance ever changes (a new admin custom-color picker, a
// data-import path, a bug elsewhere that lets a raw value through). _esc()
// isn't the right tool here — HTML-entity-escaping a color string doesn't
// stop it from closing a `style="` or `onerror="` attribute early. Instead,
// validate the shape is actually a color (3/4/6/8-digit hex, or a CSS
// variable reference) and fall back to a safe default otherwise, so this
// value is inert by construction rather than escaped-and-hoped.
function _cssColor(s, fallback) {
  fallback = fallback || '#8b5cf6';
  const v = String(s || '').trim();
  if (/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) return v;
  if (/^var\(--[a-zA-Z0-9-]+\)$/.test(v)) return v;
  return fallback;
}
window._cssColor = _cssColor;

function todayStr(){return new Date().toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'});}
function nowStr(){return new Date().toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'});}
// isoDate() → 'YYYY-MM-DD' for "today", in Philippine time (Asia/Manila).
// BUGFIX: this used to be `new Date().toISOString().slice(0,10)`, which is
// the UTC date, not the Manila date. Manila is UTC+8, so the old version
// rolled over to a new day at 8:00 AM Manila time instead of midnight —
// anything scanned/overridden between 12:00 AM and 8:00 AM got silently
// filed under "yesterday" while the real RFID scanner (which already used
// Asia/Manila server-side — see process_attendance_scan() in
// supabase/phase1_rfid_attendance.sql) correctly called it "today". en-CA
// isn't a locale choice, it's a formatting trick: en-CA is the one Intl
// locale whose short date format is already 'YYYY-MM-DD'.
function isoDate(){return new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'});}
function csvDownload(filename,rows){
  const csv=rows.map(r=>r.map(cell=>{const s=String(cell??'');return s.includes(',')||s.includes('"')||s.includes('\n')?`"${s.replace(/"/g,'""')}"`:`${s}`;}).join(',')).join('\r\n');
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
  toast(`📥 "${filename}" downloaded`);
}

// ── Phase 7 (2026-08-10, session 7): explicit window exports ──
// These were previously implicit globals (bare top-level declarations,
// reachable to other files only via classic-script auto-attach-to-window
// behavior). Made explicit ahead of any real bundle/module scoping change
// — found by build/audit-window-exports.js, which checks every symbol with
// a real cross-file consumer, not just ones reachable from onclick markup.
// See PHASE7_WINDOW_EXPORT_AUDIT.md.
window.uid = uid;
window.isoDate = isoDate;
window.nowStr = nowStr;
window.todayStr = todayStr;
window.csvDownload = csvDownload;
