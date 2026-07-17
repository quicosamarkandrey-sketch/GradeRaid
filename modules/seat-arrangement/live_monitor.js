// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/seat-arrangement/live_monitor.js
//  Phase 2 Refinement: The Live Classroom Monitor Screen.
//
//  WHAT THIS FILE OWNS:
//    A completely separate, READ-ONLY visual dashboard for daily classroom
//    tracking — distinct from classroom_builder.js's editable canvas. There
//    is no drag-and-drop here, no seat creation/deletion, no lock toggling.
//    Teachers look at this screen; they don't edit it. All edits happen on
//    the Seating Layout page (classroom_builder.js) instead.
//
//  REPOSITORY PATTERN CONTRACT (same as every other module in this app):
//    This file NEVER calls Supabase directly and NEVER mutates AppStore.
//    It only READS via ClassroomService.getLiveSeatingMap() / 
//    getColdCallCandidates() and AppStore.getState(), and re-renders itself
//    on the AppStore pub/sub channel. It is, by construction, incapable of
//    writing anything — there's no service method call in this file that
//    isn't a pure selector.
//
//  ENTRY POINTS (wired in nav.js):
//    window.renderClassroomMonitor()    — mount/render (called by navTo)
//    window.unmountClassroomMonitor()   — teardown (called by navTo on leave)
//
//  COLD CALL SELECTOR — IMPORTANT BEHAVIOR NOTE:
//    The eligible pool is recomputed at the MOMENT the button is clicked
//    (and again on every "Roll Again"), not cached from page load. This
//    matters because attendance can change live while the monitor is open
//    (a late arrival gets scanned in) — we always want the freshest pool,
//    never a stale snapshot from when the page first rendered.
// ═══════════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Module-level state ──────────────────────────────────────────────────────
  let _lmMounted        = false;
  let _lmClassId        = 'default-class';
  let _lmLayoutId       = null;
  let _lmSubscriberKey   = 'live-monitor';
  let _lmCycleInterval   = null;     // setTimeout handle for the NEXT flash tick (recursive chain, not a fixed setInterval — each tick's delay differs from the last)
  let _lmCycleTimeout    = null;     // setTimeout handle for the final tick that stops the cycle and shows the winner
  let _lmArrivalFeedSeen = new Set(); // log ids already rendered, so the feed only grows, never reorders on repaint

  // Advanced Cold Call Selector state. _lmTargetedSeatIds only matters for
  // strategy==='spatial_block' — it's the set of seats a teacher has tapped
  // on the canvas to restrict the roll to. It's cleared on every strategy
  // change (switching away from spatial_block AND switching back into it
  // both reset it, so there's never a stale/confusing carried-over
  // selection) and on class/layout change or unmount (seat ids from one
  // layout are meaningless in another).
  let _lmStrategy        = 'pure_random'; // 'pure_random' | 'least_participative' | 'spatial_block' | 'late_only'
  let _lmTargetedSeatIds = new Set();

  const CB_CANVAS_W = 1200;
  const CB_CANVAS_H = 800;
  // Seat box size — must mirror CB_SEAT_SIZE in classroom_builder.js. A
  // layout built at one size and viewed at another would visually diverge,
  // and coordinates are stored in the same shared virtual canvas space.
  const LM_SEAT_SIZE = 120;

  let _lmResizeListenerAttached = false;

  // ── Phase 5: Fullscreen Kiosk Mode ───────────────────────────────────────────
  // Same pattern att_scanner_rfid.js already uses (body.rfid-kiosk-mode) —
  // toggling a body class hides the app shell (topbar + sidebar) while this
  // page is mounted, and is fully reverted on toggle-off or unmount so no
  // other page in the app is ever affected.
  let _lmKioskMode = false;

  // ── Phase 3: Recitation Command Center state ────────────────────────────────
  // isRecitationMode gate — Task 1/4 badges and the Scanner B keydown listener
  // are both entirely inert while this is false, so a plain Live Monitor
  // session (Phase 1/2 behavior) is byte-for-byte unchanged from before.
  let _lmRecitationMode      = false;
  let _lmSessionStartAt      = null;        // ISO string — set fresh each time a session starts
  let _lmRecitationSeenIds   = new Set();   // log ids already animated, so a re-render never re-plays the +1 float
  let _lmRecitationKeyHandler = null;       // bound fn, so it can be added/removed cleanly
  let _lmScanBuffer          = '';
  let _lmScanInactivityTimer = null;
  const LM_SCAN_INACTIVITY_MS = 120;        // mirrors att_scanner_rfid.js's reader-without-Enter fallback

  // Manual Award Panel state
  let _lmAwardSearch    = '';
  let _lmAwardStudentId = null;
  let _lmAwardPoints    = 1;

  // ── Phase 4: Manual Attendance Override panel state ─────────────────────────
  // Shared between State A (Attendance Session Active — panel is the sidebar's
  // primary content) and State B (Recitation Active — panel is collapsible,
  // tucked at the bottom so attendance can still be corrected without leaving
  // the recitation screen). See _lmOverridePanelHtml().
  let _lmOverrideStudentId = '';
  let _lmOverrideStatus    = 'On Time';
  let _lmOverrideNote      = '';
  let _lmOverrideExpanded  = false; // State B only — starts collapsed

  // ── One-time CSS injection ──────────────────────────────────────────────────
  (function injectStyles() {
    if (document.getElementById('lm-styles')) return;
    const s = document.createElement('style');
    s.id = 'lm-styles';
    s.textContent = `
#a-classroom-monitor{padding:0!important;max-width:100%!important;overflow:hidden}
.lm-page{display:flex;flex-direction:column;height:calc(100vh - 64px);overflow:hidden}
.lm-toolbar{
  display:flex;align-items:center;gap:10px;padding:14px 18px;
  border-bottom:1px solid var(--border);flex-shrink:0;flex-wrap:wrap;
}
.lm-toolbar-title{font-family:var(--fh);font-size:16px;font-weight:900;margin-right:auto}
.lm-coldcall-btn{
  background:linear-gradient(135deg,#8b5cf6,#d0bcff);color:#1a1625;
  border:none;border-radius:12px;padding:11px 22px;font-weight:900;font-size:13px;
  cursor:pointer;letter-spacing:.02em;box-shadow:0 4px 16px rgba(139,92,246,.35);
  transition:transform .15s;
}
.lm-coldcall-btn:hover{transform:translateY(-1px)}
.lm-coldcall-btn:disabled{opacity:.6;cursor:not-allowed;transform:none}

.lm-workspace{flex:1;display:flex;overflow:hidden}
.lm-canvas-wrap{flex:1;position:relative;overflow:auto;background:
  radial-gradient(circle at 20% 20%, rgba(139,92,246,.04), transparent 60%),
  var(--surface);}
.lm-canvas{position:relative;width:${CB_CANVAS_W}px;height:${CB_CANVAS_H}px}

.lm-seat{
  position:absolute;width:${LM_SEAT_SIZE}px;height:${LM_SEAT_SIZE}px;border-radius:14px;
  border:2px solid transparent;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:2px;
  transition:background .3s,border-color .3s,box-shadow .25s;
}
.lm-seat-init{width:82px;height:82px;border-radius:12px;display:flex;align-items:center;
  justify-content:center;font-size:30px;font-weight:900;position:relative;overflow:hidden}
.lm-seat-init img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit}
.lm-seat-name{font-size:14px;font-weight:700;max-width:108px;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;color:var(--on-surface)}
/* .lm-seat-status (the redundant emoji glyph) intentionally removed —
   the seat border is already color-coded/glowing by attendance status
   (see el.style.borderColor in _lmRenderCanvas), so the glyph was a
   second signal for the same information. Removing it frees the
   vertical space that let .lm-seat-init grow from 54px to 82px above. */
.lm-seat.flash-cycle{
  background:rgba(255,221,87,.85)!important;border-color:#ffdd57!important;
  box-shadow:0 0 22px rgba(255,221,87,.7)!important;transform:translate(-50%,-50%) scale(1.08);
}
.lm-seat.flash-winner{
  animation:lm-winner-pulse 1.1s ease-in-out 2;
  border-color:#ffdd57!important;box-shadow:0 0 0 4px rgba(255,221,87,.5),0 0 30px rgba(255,221,87,.6)!important;
}
@keyframes lm-winner-pulse{
  0%,100%{transform:translate(-50%,-50%) scale(1)}
  50%{transform:translate(-50%,-50%) scale(1.15)}
}

/* Confirmation beat — the cycle has landed but the profile hasn't opened
   yet. A tighter, faster double-ring pulse (distinct from flash-winner's
   single slow pulse) reads as "verifying" rather than "done", so the
   reveal a moment later still feels like a payoff. */
.lm-seat.flash-confirm{
  animation:lm-confirm-pulse .45s ease-in-out 2;
  border-color:#4edea3!important;
  box-shadow:0 0 0 6px rgba(78,222,163,.35),0 0 34px rgba(78,222,163,.65)!important;
  z-index:8;
}
@keyframes lm-confirm-pulse{
  0%,100%{transform:translate(-50%,-50%) scale(1.06)}
  50%{transform:translate(-50%,-50%) scale(1.22)}
}
.lm-confirm-label{
  position:absolute;left:50%;bottom:100%;transform:translate(-50%,4px);
  margin-bottom:6px;white-space:nowrap;font-family:var(--fh);font-weight:900;
  font-size:15px;color:#4edea3;background:rgba(10,14,12,.88);
  padding:5px 14px;border-radius:20px;border:2px solid #4edea3;
  box-shadow:0 4px 16px rgba(78,222,163,.5);z-index:9;
  animation:lm-confirm-label-in .9s ease forwards;
}
@keyframes lm-confirm-label-in{
  0%{opacity:0;transform:translate(-50%,14px) scale(.85)}
  15%{opacity:1;transform:translate(-50%,4px) scale(1)}
  80%{opacity:1}
  100%{opacity:0;transform:translate(-50%,-2px) scale(1)}
}

.lm-strategy-select{min-width:172px}
.lm-target-hint{
  font-size:11px;font-weight:700;color:#d0bcff;display:flex;align-items:center;gap:5px;
}
.lm-target-count{
  font-size:10px;font-weight:900;background:rgba(208,188,255,.18);color:#d0bcff;
  border-radius:8px;padding:1px 7px;
}

/* Spatial-block targeting: a teacher taps eligible seats to restrict the
   roll to just those. 'targetable' marks a seat as clickable for this
   purpose (eligible, but not yet chosen); 'targeted' marks one already
   chosen. Deliberately a different hue (purple, matching --primary) from
   flash-cycle/flash-winner's yellow so "I selected this" never reads as
   "this just won" mid-roll. */
.lm-seat.targetable{cursor:pointer}
.lm-seat.targetable:hover{box-shadow:0 0 0 2px rgba(208,188,255,.5)}
.lm-seat.targeted{
  border-color:#d0bcff!important;
  box-shadow:0 0 0 3px rgba(208,188,255,.55),0 0 16px rgba(139,92,246,.4)!important;
}

.lm-sidebar{
  width:300px;flex-shrink:0;border-left:1px solid var(--border);
  display:flex;flex-direction:column;overflow:hidden;background:rgba(20,18,32,.4);
}
.lm-scoreboard{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:16px}
.lm-stat-card{
  background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:10px;
  padding:10px 12px;text-align:center;
}
.lm-stat-num{font-family:var(--fh);font-size:22px;font-weight:900;line-height:1.1}
.lm-stat-label{font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.04em;text-transform:uppercase;margin-top:2px}
.lm-feed-header{
  padding:0 16px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;
  color:var(--text-muted);margin-top:6px;margin-bottom:6px;
}
.lm-feed{flex:1;overflow-y:auto;padding:0 16px 16px}
.lm-feed-item{
  display:flex;align-items:flex-start;gap:8px;padding:8px 0;
  border-bottom:1px solid rgba(255,255,255,.04);font-size:12px;
}
.lm-feed-time{color:var(--text-muted);font-size:10px;flex-shrink:0;width:64px;font-weight:700}
.lm-feed-text{flex:1;line-height:1.4}
.lm-feed-empty{color:var(--text-muted);font-size:12px;text-align:center;padding:24px 0}

/* ── Winner Spotlight Popup (rendered into the app's shared #modal-content) ── */
.lm-spotlight{text-align:center;padding:10px;animation:lm-spotlight-in .4s ease}
@keyframes lm-spotlight-in{
  0%{opacity:0;transform:scale(.9) translateY(10px)}
  100%{opacity:1;transform:scale(1) translateY(0)}
}
.lm-spotlight-avatar{
  width:132px;height:132px;border-radius:50%;margin:0 auto 12px;
  display:flex;align-items:center;justify-content:center;
  font-family:var(--fh);font-weight:900;font-size:46px;
  position:relative;overflow:hidden;
}
.lm-spotlight-avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%}
.lm-spotlight-title-slot{display:flex;justify-content:center;margin-bottom:10px}
.lm-spotlight-name{font-family:var(--fh);font-size:28px;font-weight:900;margin-bottom:4px}
.lm-spotlight-tier{font-size:14px;color:var(--text-muted);margin-bottom:16px;font-weight:700}

/* The big highlighted "Overall Recitation Points" headline — the single
   number a teacher should be able to read from across the room. */
.lm-spotlight-headline{
  margin:0 auto 18px;padding:14px 20px;border-radius:18px;max-width:320px;
  background:linear-gradient(160deg,var(--hl,#8b5cf6)29,rgba(20,18,32,.6));
  border:2px solid var(--hl,#8b5cf6);
  box-shadow:0 0 28px color-mix(in srgb, var(--hl,#8b5cf6) 45%, transparent);
}
.lm-spotlight-headline-num{
  font-family:var(--fh);font-size:56px;font-weight:900;line-height:1;
  color:var(--hl,#8b5cf6);text-shadow:0 0 22px color-mix(in srgb, var(--hl,#8b5cf6) 70%, transparent);
}
.lm-spotlight-headline-label{
  font-size:12px;font-weight:900;letter-spacing:.04em;text-transform:uppercase;
  color:var(--text-muted);margin-top:4px;
}

.lm-spotlight-stats{display:flex;justify-content:center;gap:22px;margin-bottom:22px;flex-wrap:wrap}
.lm-spotlight-stat-num{font-family:var(--fh);font-size:24px;font-weight:900}
.lm-spotlight-stat-label{font-size:10.5px;color:var(--text-muted);font-weight:700;text-transform:uppercase}
.lm-spotlight-actions{display:flex;gap:10px;justify-content:center}

/* ── Phase 3: Recitation Command Center ─────────────────────────────────── */

.lm-recitation-toggle{
  background:linear-gradient(135deg,#ff9f5f,#ffd166);color:#1a1625;
  border:none;border-radius:12px;padding:11px 20px;font-weight:900;font-size:13px;
  cursor:pointer;letter-spacing:.02em;box-shadow:0 4px 16px rgba(255,159,95,.35);
  transition:transform .15s,background .2s,box-shadow .2s;
}
.lm-recitation-toggle:hover{transform:translateY(-1px)}
.lm-recitation-toggle.active{
  background:linear-gradient(135deg,#4edea3,#7fe8c0);
  box-shadow:0 4px 16px rgba(78,222,163,.4);
}

/* Task 1 — Live Counter Badge: top-right corner of the seat card, only
   rendered at all when isRecitationMode is true (see _lmRenderCanvas). */
.lm-recitation-badge{
  position:absolute;top:-16px;right:-16px;min-width:38px;height:38px;padding:0 8px;
  border-radius:19px;background:linear-gradient(135deg,#ffd166,#ff9f5f);color:#1a1625;
  font-family:var(--fh);font-size:20px;font-weight:900;display:flex;align-items:center;
  justify-content:center;box-shadow:0 3px 14px rgba(255,209,102,.7);
  border:3px solid rgba(20,18,32,.9);z-index:5;line-height:1;
}
.lm-recitation-badge.bump{animation:lm-badge-bump .35s ease}
@keyframes lm-badge-bump{
  0%{transform:scale(1)} 45%{transform:scale(1.5)} 100%{transform:scale(1)}
}

/* Task 4 — Floating +1 (or +N for manual awards). Spawned as a child of the
   seat element and removed after the animation completes — see
   _lmSpawnFloatingPoint(). */
.lm-float-point{
  position:absolute;left:50%;top:0;transform:translate(-50%,0);
  font-family:var(--fh);font-weight:900;font-size:44px;color:#ffd166;
  -webkit-text-stroke:1.5px rgba(26,22,37,.9);
  pointer-events:none;z-index:6;
  text-shadow:0 0 10px rgba(255,209,102,.9),0 0 22px rgba(255,209,102,.6),0 3px 8px rgba(0,0,0,.6);
  animation:floating-point-up 1.7s cubic-bezier(.2,.8,.3,1) forwards;
}
@keyframes floating-point-up{
  0%   {opacity:0;   transform:translate(-50%,0)     scale(.4)}
  12%  {opacity:1;   transform:translate(-50%,-14px) scale(1.5)}
  25%  {              transform:translate(-50%,-22px) scale(1.2)}
  100% {opacity:0;   transform:translate(-50%,-110px) scale(1.3)}
}

/* Task 3 — Sidebar Command Center */
.lm-recitation-status{
  display:flex;align-items:center;gap:8px;padding:12px 16px;margin:0 16px 4px;
  border-radius:10px;background:rgba(78,222,163,.1);border:1px solid rgba(78,222,163,.3);
}
.lm-recitation-status-dot{
  width:9px;height:9px;border-radius:50%;background:#4edea3;
  box-shadow:0 0 8px rgba(78,222,163,.8);animation:lm-status-pulse 1.6s ease-in-out infinite;
  flex-shrink:0;
}
@keyframes lm-status-pulse{0%,100%{opacity:1} 50%{opacity:.4}}
.lm-recitation-status-text{font-size:12px;font-weight:800;color:#4edea3}

.lm-award-panel{padding:14px 16px;border-bottom:1px solid var(--border)}
.lm-award-panel h4{
  font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;
  color:var(--text-muted);margin:0 0 10px;
}
.lm-award-search{width:100%;margin-bottom:6px}
.lm-award-results{max-height:130px;overflow-y:auto;margin-bottom:8px}
.lm-award-result{
  padding:7px 9px;border-radius:8px;cursor:pointer;font-size:12px;
  display:flex;align-items:center;justify-content:space-between;gap:6px;
}
.lm-award-result:hover{background:rgba(255,255,255,.05)}
.lm-award-result.selected{background:rgba(255,209,102,.16);color:#ffd166;font-weight:800}
.lm-award-empty{color:var(--text-muted);font-size:11px;padding:6px 2px}
.lm-award-selected{
  font-size:12px;font-weight:800;padding:8px 10px;border-radius:8px;
  background:rgba(139,92,246,.12);border:1px solid rgba(139,92,246,.3);margin-bottom:8px;
}
.lm-points-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.lm-points-btn{
  padding:6px 13px;border-radius:8px;border:1px solid var(--border);
  background:rgba(255,255,255,.03);cursor:pointer;font-weight:800;font-size:12px;
  color:var(--on-surface);transition:background .15s,border-color .15s;
}
.lm-points-btn.selected{background:#ffd166;color:#1a1625;border-color:#ffd166}
.lm-award-submit{
  width:100%;padding:10px;border-radius:10px;border:none;font-weight:900;font-size:12px;
  cursor:pointer;background:linear-gradient(135deg,#8b5cf6,#d0bcff);color:#1a1625;
}
.lm-award-submit:disabled{opacity:.5;cursor:not-allowed}

.lm-recitation-feed-item{
  display:flex;align-items:center;gap:8px;padding:8px 0;
  border-bottom:1px solid rgba(255,255,255,.04);font-size:12px;
}
.lm-recitation-feed-main{flex:1;min-width:0}
.lm-recitation-feed-name{font-weight:700;color:var(--on-surface)}
.lm-recitation-feed-meta{color:var(--text-muted);font-size:10px;margin-top:1px}
.lm-recitation-feed-pts{font-weight:900;color:#ffd166;font-size:13px;flex-shrink:0}
.lm-undo-btn{
  flex-shrink:0;background:rgba(255,180,171,.15);color:#ffb4ab;
  border:1px solid rgba(255,180,171,.3);border-radius:6px;padding:3px 9px;
  font-size:10px;font-weight:800;cursor:pointer;
}
.lm-undo-btn:hover{background:rgba(255,180,171,.28)}

/* ── Phase 4: Manual Attendance Override Panel — shared between State A
   (Attendance Session Active) and State B (Recitation Active, collapsible,
   pinned to the bottom of the sidebar) ── */
.lm-override-panel{padding:14px 16px;border-bottom:1px solid var(--border)}
.lm-override-header{display:flex;align-items:center;justify-content:space-between}
.lm-override-panel h4{
  font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;
  color:var(--text-muted);margin:0;
}
.lm-override-caret{color:var(--text-muted);font-size:12px;flex-shrink:0}
.lm-override-hint{font-size:11px;color:var(--text-muted);margin:8px 0 10px;line-height:1.4}
.lm-override-select{width:100%;margin-bottom:8px}
.lm-override-input{width:100%;margin-bottom:8px}
.lm-override-submit{
  width:100%;padding:10px;border-radius:10px;border:none;font-weight:900;font-size:12px;
  cursor:pointer;background:linear-gradient(135deg,#ff9f5f,#ffd166);color:#1a1625;
}
.lm-override-submit:disabled{opacity:.5;cursor:not-allowed}

/* ── Phase 5: Fullscreen Kiosk Mode ─────────────────────────────────────────
   Toggled via window._lmToggleKioskMode(). Mirrors att_scanner_rfid.js's
   body.rfid-kiosk-mode pattern (see styles/modules/attendance.css) — same
   shell-hiding mechanism, scoped to its own body class so the two kiosk
   screens never interfere with each other. */
body.lm-kiosk-mode #topbar,
body.lm-kiosk-mode #sidebar{display:none!important}
body.lm-kiosk-mode #main-content{margin-left:0!important;padding-top:0!important}
body.lm-kiosk-mode #a-classroom-monitor.page{
  position:fixed!important;inset:0!important;z-index:50;
  padding:0!important;max-width:100%!important;margin:0!important;
}
body.lm-kiosk-mode .lm-page{height:100vh!important}

.lm-fullscreen-btn{
  background:rgba(255,255,255,.05);border:1px solid var(--border);color:var(--on-surface);
  border-radius:12px;padding:11px 16px;font-weight:900;font-size:13px;cursor:pointer;
  transition:background .15s,border-color .15s;
}
.lm-fullscreen-btn:hover{background:rgba(255,255,255,.09);border-color:rgba(208,188,255,.3)}
.lm-fullscreen-btn.active{color:#d0bcff;border-color:rgba(208,188,255,.4);background:rgba(139,92,246,.12)}
`;
    document.head.appendChild(s);
  })();

  // ── Mount / unmount ──────────────────────────────────────────────────────────

  window.renderClassroomMonitor = function () {
    const page = document.getElementById('a-classroom-monitor');
    if (!page) {
      console.error('[LiveMonitor] #a-classroom-monitor not found in the DOM.');
      return;
    }
    _lmMounted = true;
    const state = AppStore.getState();

    // Default to whatever class/layout the builder was last looking at, if
    // any — otherwise the first class with students.
    const classIds = window.getActiveClassIds(state);
    // BUGFIX (same race as classroom_builder.js — see its matching note):
    // only force-reassign _lmClassId when nothing's selected yet, or when
    // classSections has genuinely finished loading and confirms the
    // previous class no longer exists. A transient, fallback-derived
    // classIds list (state.classSections not loaded yet) must never
    // silently switch the teacher onto a different class's monitor view.
    const _sectionsLoadedLM = Array.isArray(state.classSections) && state.classSections.length > 0;
    if (classIds.length && (_lmClassId === 'default-class' || (_sectionsLoadedLM && !classIds.includes(_lmClassId)))) {
      _lmClassId = classIds[0];
    }

    const layoutsForClass = (state.classroomLayouts || []).filter(l => l.classId === _lmClassId);
    if (!_lmLayoutId || !layoutsForClass.some(l => l.id === _lmLayoutId)) {
      _lmLayoutId = layoutsForClass[0] ? layoutsForClass[0].id : null;
    }

    _lmRender(page, classIds, state);
    _lmSubscribeToStore();

    // Defense-in-depth: also refetch on every mount, not just once after
    // login. Covers the case where the post-login refresh (auth.js
    // doLogin()) ran before this file's window.refreshClassroomData was
    // registered, or before Realtime had anything to react to. This is a
    // no-op render-wise until the fetch resolves — the AppStore subscription
    // above repaints automatically when 'classroom:bootstrapped' fires.
    if (typeof window.refreshClassroomData === 'function') {
      window.refreshClassroomData().catch(function (e) {
        console.warn('[LiveMonitor] mount-time classroom data refresh failed:', e);
      });
    }
  };

  window.unmountClassroomMonitor = function () {
    _lmMounted = false;
    _lmClearCycle();
    _lmTargetedSeatIds.clear();
    _lmStopRecitationSession(); // safe no-op if a session was never started
    // Safety net: if the teacher navigates away (or the RFID scanner's own
    // exit button, browser back, etc.) while still in fullscreen, don't
    // leave the app shell hidden for whatever page loads next.
    if (_lmKioskMode) {
      _lmKioskMode = false;
      document.body.classList.remove('lm-kiosk-mode');
    }
    AppStore.unsubscribe(_lmSubscriberKey);
  };

  // Toggles fullscreen/kiosk display — hides the sidebar + topbar and lets
  // this page's canvas fill the whole viewport, same mechanism
  // att_scanner_rfid.js already uses for its own kiosk mode. A full re-render
  // (rather than just toggling the class) is simplest here: the toolbar
  // button's label/state needs to flip too, and _lmRender() already ends
  // with _lmScaleCanvas(), so the seating map immediately re-fits the
  // newly-resized canvas wrap in the same pass.
  window._lmToggleKioskMode = function () {
    _lmKioskMode = !_lmKioskMode;
    document.body.classList.toggle('lm-kiosk-mode', _lmKioskMode);

    const page = document.getElementById('a-classroom-monitor');
    const state = AppStore.getState();
    const classIds = window.getActiveClassIds(state);
    _lmRender(page, classIds, state);
  };

  function _lmSubscribeToStore() {
    AppStore.subscribe(_lmSubscriberKey, (state, event) => {
      if (!_lmMounted) return;
      const type = event && event.type;
      // Any attendance write, classroom write, or remote sync repaints the
      // whole screen — this is a read-only dashboard, so a full repaint on
      // every relevant event is simple and cheap (no canvas drag state to
      // preserve, unlike the builder).
      if (
        type === 'attendance:scan-recorded' || type === 'attendance:override' ||
        (type && type.startsWith('classroom:')) || type === 'state:remote-sync' ||
        type === 'state:legacy-sync' ||
        (type && type.startsWith('recitation:'))
      ) {
        const page = document.getElementById('a-classroom-monitor');
        if (page && page.classList.contains('active')) {
          const classIds = window.getActiveClassIds(state);
          _lmRender(page, classIds, state);
          // A repaint alone would just show the new badge count instantly —
          // this additionally plays the +N float (Task 4) for whichever
          // entries are new since the last paint, so it also fires for
          // realtime echoes from another device's Scanner B, not just this
          // tab's own taps.
          if (_lmRecitationMode) _lmAnimateNewRecitationEntries();
        }
        return;
      }

      // BUGFIX (section reverting to raw id + wrong class after reload):
      // class_sections data can finish loading AFTER this page already
      // mounted (see auth.js's post-login/refresh refreshSectionData()
      // call). Re-render once real data lands so labels resolve from raw
      // ids to real names, and only now re-validate the selected class
      // against the authoritative list — same fix as classroom_builder.js.
      if (type && type.startsWith('sections:')) {
        const page = document.getElementById('a-classroom-monitor');
        if (!page || !page.classList.contains('active')) return;
        const classIds = window.getActiveClassIds(state);
        if (classIds.length && !classIds.includes(_lmClassId)) {
          _lmClassId = classIds[0] || 'default-class';
        }
        _lmRender(page, classIds, state);
      }
    });
  }

  // ── Shell render ─────────────────────────────────────────────────────────────

  function _lmRender(page, classIds, state) {
    const layouts = (state.classroomLayouts || []).filter(l => l.classId === _lmClassId);
    const coldCallDisabled = !_lmLayoutId ||
      (_lmStrategy === 'spatial_block' && _lmTargetedSeatIds.size === 0);

    page.innerHTML = `
      <div class="lm-page">
        <div class="lm-toolbar">
          <span class="lm-toolbar-title">📡 Live Classroom Monitor</span>
          <select class="cb-class-select" onchange="window._lmOnClassChange(this.value)">${
            classIds.map(c => `<option value="${_esc(c)}"${c===_lmClassId?' selected':''}>${_esc(window.getClassLabel ? window.getClassLabel(c, state) : c)}</option>`).join('')
          }</select>
          <select class="cb-layout-select" onchange="window._lmOnLayoutChange(this.value)">${
            layouts.length
              ? layouts.map(l => `<option value="${_esc(l.id)}"${l.id===_lmLayoutId?' selected':''}>${_esc(l.name)}</option>`).join('')
              : `<option value="">— No layout for this class —</option>`
          }</select>

          <div style="margin-left:auto"></div>

          <button class="lm-fullscreen-btn${_lmKioskMode ? ' active' : ''}" id="lm-fullscreen-btn"
            onclick="window._lmToggleKioskMode()"
            title="${_lmKioskMode ? 'Exit fullscreen' : 'Fill the screen for projecting/kiosk display'}">
            ${_lmKioskMode ? '⤢ Exit Fullscreen' : '⛶ Fullscreen'}
          </button>

          ${_lmRecitationMode ? `
          <div class="lm-toolbar-sep" style="width:1px;height:28px;background:var(--border)"></div>

          <select class="lm-strategy-select" id="lm-strategy-select" title="Cold Call Strategy"
            onchange="window._lmOnStrategyChange(this.value)">
            <option value="pure_random" ${_lmStrategy==='pure_random'?'selected':''}>🎲 Pure Random</option>
            <option value="least_participative" ${_lmStrategy==='least_participative'?'selected':''}>🤫 Least Participative</option>
            <option value="late_only" ${_lmStrategy==='late_only'?'selected':''}>⏰ Late Only</option>
            <option value="spatial_block" ${_lmStrategy==='spatial_block'?'selected':''}>📍 Roll Selected Seats Only</option>
          </select>

          ${_lmStrategy === 'spatial_block' ? `
            <span class="lm-target-hint">
              👆 Tap present/late seats below to target them
              <span class="lm-target-count">${_lmTargetedSeatIds.size}</span>
            </span>
          ` : ''}
          <button class="lm-coldcall-btn" id="lm-coldcall-btn" onclick="window._lmStartColdCall()"
            ${coldCallDisabled ? 'disabled' : ''}>
            🎯 Pick Random Student
          </button>
          ` : ''}
          <button class="lm-recitation-toggle${_lmRecitationMode ? ' active' : ''}" id="lm-recitation-toggle"
            onclick="window._lmToggleRecitationMode()">
            ${_lmRecitationMode ? '🎤 Recitation Active' : '🎤 Start Recitation Session'}
          </button>
        </div>

        <div class="lm-workspace">
          <div class="lm-canvas-wrap" id="lm-canvas-wrap">
            <div class="lm-canvas" id="lm-canvas"></div>
          </div>
          <div class="lm-sidebar" id="lm-sidebar"></div>
        </div>
      </div>
    `;

    _lmRenderCanvas();
    _lmRenderSidebar();
    _lmScaleCanvas();
    if (!_lmResizeListenerAttached) {
      window.addEventListener('resize', _lmScaleCanvas);
      _lmResizeListenerAttached = true;
    }
  }

  function _lmScaleCanvas() {
    const wrap   = document.getElementById('lm-canvas-wrap');
    const canvas = document.getElementById('lm-canvas');
    if (!wrap || !canvas) return;
    // Fill the available space instead of capping at native 1200x800 size.
    // The old `Math.min(1, ...)` cap meant this screen — which exists
    // specifically to be displayed/projected — could never render any
    // bigger than its native pixel size, so on a large monitor most of the
    // screen just sat empty. Scale up (or down) to fit both width and
    // height of whatever room the container actually has.
    const scaleW = (wrap.clientWidth  - 24) / CB_CANVAS_W;
    const scaleH = (wrap.clientHeight - 24) / CB_CANVAS_H;
    const scale  = scaleH > 0 ? Math.min(scaleW, scaleH) : scaleW;
    // Same "mounted while the page is still display:none" issue as the
    // Builder (nav.js renders before showPage() makes the page visible) —
    // self-heal by retrying next frame instead of committing scale(0)/NaN.
    if (!isFinite(scale) || scale <= 0) {
      requestAnimationFrame(_lmScaleCanvas);
      return;
    }
    canvas.style.transform = `scale(${scale})`;
    canvas.style.transformOrigin = 'top left';
    wrap.style.minHeight = (CB_CANVAS_H * scale + 24) + 'px';
  }

  window._lmOnClassChange = function (classId) {
    _lmClassId = classId;
    _lmTargetedSeatIds.clear();
    const state = AppStore.getState();
    const layoutsForClass = (state.classroomLayouts || []).filter(l => l.classId === classId);
    _lmLayoutId = layoutsForClass[0] ? layoutsForClass[0].id : null;
    const page = document.getElementById('a-classroom-monitor');
    const classIds = window.getActiveClassIds(state);
    _lmRender(page, classIds, state);
  };

  window._lmOnLayoutChange = function (layoutId) {
    _lmLayoutId = layoutId || null;
    _lmTargetedSeatIds.clear();
    _lmRenderCanvas();
    const btn = document.getElementById('lm-coldcall-btn');
    if (btn) btn.disabled = !_lmLayoutId || (_lmStrategy === 'spatial_block' && _lmTargetedSeatIds.size === 0);
  };

  // Changing strategy always resets targeting — simplest, least-surprising
  // rule: switching to spatial_block always starts from a clean slate, and
  // switching away never leaves a stale selection lurking for next time.
  window._lmOnStrategyChange = function (strategy) {
    _lmStrategy = strategy;
    _lmTargetedSeatIds.clear();
    const page = document.getElementById('a-classroom-monitor');
    const state = AppStore.getState();
    const classIds = window.getActiveClassIds(state);
    _lmRender(page, classIds, state);
  };

  // ── Canvas (read-only seating map) ───────────────────────────────────────────

  function _lmRenderCanvas() {
    const canvas = document.getElementById('lm-canvas');
    if (!canvas) return;
    canvas.innerHTML = '';

    if (!_lmLayoutId) {
      canvas.innerHTML = `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
        color:var(--text-muted);font-size:13px">No layout selected for this class.</div>`;
      return;
    }

    const seatingMap = ClassroomService.getLiveSeatingMap(_lmClassId, _lmLayoutId);
    const eligibleStatuses = ['Early', 'On Time', 'Late'];

    // Task 1: session point counts, computed once per canvas paint rather
    // than once per seat — this screen can have dozens of seats and
    // getSessionCounts() already does a single pass over recitationLog.
    const recitationCounts = (_lmRecitationMode && _lmSessionStartAt)
      ? RecitationService.getSessionCounts(_lmClassId, _lmSessionStartAt)
      : null;

    seatingMap.forEach(vm => {
      const el = document.createElement('div');
      el.className = 'lm-seat';
      el.dataset.seatId = vm.seatId;
      el.dataset.studentId = vm.studentId || '';
      el.style.left = vm.xCoord + 'px';
      el.style.top  = vm.yCoord + 'px';
      el.style.transform = `translate(-50%,-50%) rotate(${vm.rotation || 0}deg)`;
      el.style.background = vm.color.bg;
      el.style.borderColor = vm.color.border;

      const studentColor = vm.studentColor || 'rgba(139,92,246,0.5)';
      // Task 1 — Live Counter Badge: only when isRecitationMode is true AND
      // the seat is occupied. A student with 0 points this session still
      // gets the badge (so "recitation mode is on and nobody's been called
      // yet" is visibly a zero, not just an absent badge that pops in on
      // their first point) — recitationCounts[id] defaults to 0 via `|| 0`.
      const badgeHtml = (recitationCounts && vm.studentId)
        ? `<div class="lm-recitation-badge" data-badge-for="${_esc(vm.studentId)}">${recitationCounts[vm.studentId] || 0}</div>`
        : '';
      // Photo, if the student has one, layers over the initials as an <img>
      // absolutely positioned to fill the badge; onerror removes it so a
      // missing/broken URL falls back invisibly to the initials underneath
      // (same pattern used for avatars elsewhere in the app — topbar,
      // sidebar, dashboard, leaderboard).
      const photoHtml = vm.studentPhoto
        ? `<img src="${_esc(vm.studentPhoto)}" alt="" onerror="this.remove()">`
        : '';
      el.innerHTML = vm.studentId
        ? `<div class="lm-seat-init" style="background:${studentColor}">${photoHtml}${_esc(vm.studentInit || '?')}</div>
           <div class="lm-seat-name">${_esc((vm.studentName||'').split(' ')[0])}</div>
           ${badgeHtml}`
        : `<div style="font-size:18px;opacity:.25">🪑</div>`;

      // Spatial-block targeting: only seats that could actually win a roll
      // (present/late + occupied) are clickable for targeting — tapping an
      // absent student's or an empty seat would be a dead end, so it never
      // gets the 'targetable' affordance in the first place.
      //
      // BUGFIX: this branch used to run AFTER the general recitation-mode
      // award-click branch below, as an `else if`. Since spatial_block can
      // only be selected while recitation mode is already on, the award-click
      // branch's condition (`_lmRecitationMode && vm.studentId`) matched
      // every occupied seat first and this branch never ran — tapping seats
      // while "Roll Selected Seats Only" was selected always fell through to
      // award-selection instead of toggling the target pool, so a teacher
      // could never actually build a multi-seat selection. Checking the
      // active strategy first lets targeting win when it's the chosen mode.
      const isEligible = !!vm.studentId && eligibleStatuses.includes(vm.attendanceStatus);
      if (_lmRecitationMode && _lmStrategy === 'spatial_block' && isEligible) {
        el.classList.add('targetable');
        if (_lmTargetedSeatIds.has(vm.seatId)) el.classList.add('targeted');
        el.onclick = () => window._lmToggleSeatTarget(vm.seatId);
      } else if (_lmRecitationMode && vm.studentId) {
        // Task 3's "click seat -> select points" path for the Manual Award
        // Panel — what a seat click does whenever spatial_block targeting
        // isn't the thing currently in play.
        el.classList.add('targetable');
        el.onclick = () => window._lmSelectAwardStudentFromSeat(vm.studentId);
      }

      canvas.appendChild(el);
    });
  }

  // Toggles a seat's membership in the spatial_block target set, then does a
  // lightweight repaint: just the seat's own class + the toolbar's count
  // badge/button state, not a full re-render (keeps dropdown focus, scroll
  // position, etc. undisturbed).
  window._lmToggleSeatTarget = function (seatId) {
    if (_lmTargetedSeatIds.has(seatId)) _lmTargetedSeatIds.delete(seatId);
    else _lmTargetedSeatIds.add(seatId);

    const seatEl = document.querySelector(`.lm-seat[data-seat-id="${seatId}"]`);
    if (seatEl) seatEl.classList.toggle('targeted', _lmTargetedSeatIds.has(seatId));

    const countEl = document.querySelector('.lm-target-count');
    if (countEl) countEl.textContent = String(_lmTargetedSeatIds.size);

    const btn = document.getElementById('lm-coldcall-btn');
    if (btn) btn.disabled = !_lmLayoutId || (_lmStrategy === 'spatial_block' && _lmTargetedSeatIds.size === 0);
  };

  // ── Sidebar: Scoreboard + Arrival Feed (Phase 1/2, unchanged) ───────────────
  // OR the Task 3 Recitation Command Center, when a session is active. The
  // branch happens here rather than inside a single mega-function so the
  // Phase 1/2 sidebar body below is untouched byte-for-byte from before —
  // Recitation Mode simply swaps which function owns #lm-sidebar's contents.

  function _lmRenderSidebar() {
    if (_lmRecitationMode) { _lmRenderRecitationSidebar(); return; }
    _lmRenderAttendanceSidebar();
  }

  function _lmRenderAttendanceSidebar() {
    const sidebar = document.getElementById('lm-sidebar');
    if (!sidebar) return;

    const state   = AppStore.getState();
    // BUGFIX: was new Date().toISOString().slice(0,10) — the UTC date, which
    // rolls the Live Monitor over to a new day 8 hours late relative to
    // Manila time. See utils.js isoDate() for the full explanation.
    const today   = isoDate();
    const roster  = (state.students || []).filter(s => (s.classId || 'default-class') === _lmClassId);
    const logs    = (state.attendanceLogs || [])
      .filter(l => l.classId === _lmClassId && l.logDate === today);

    const counts = { Present: 0, Late: 0, Absent: 0, Excused: 0 };
    logs.forEach(l => {
      if (l.status === 'Early' || l.status === 'On Time') counts.Present++;
      else if (l.status === 'Late')    counts.Late++;
      else if (l.status === 'Absent')  counts.Absent++;
      else if (l.status === 'Excused') counts.Excused++;
    });

    // Arrival feed: every log with a scannedAt timestamp today, newest first.
    const feedLogs = logs
      .filter(l => l.scannedAt)
      .slice()
      .sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt))
      .slice(0, 30); // cap — this is a rolling feed, not a full audit log

    const studentById = Object.fromEntries(roster.map(s => [s.id, s]));

    sidebar.innerHTML = `
      ${_lmOverridePanelHtml(roster, { collapsible: false })}

      <div class="lm-scoreboard">
        <div class="lm-stat-card">
          <div class="lm-stat-num" style="color:#4edea3">${counts.Present}</div>
          <div class="lm-stat-label">Present</div>
        </div>
        <div class="lm-stat-card">
          <div class="lm-stat-num" style="color:#ffb95f">${counts.Late}</div>
          <div class="lm-stat-label">Late</div>
        </div>
        <div class="lm-stat-card">
          <div class="lm-stat-num" style="color:#ffb4ab">${counts.Absent}</div>
          <div class="lm-stat-label">Absent</div>
        </div>
        <div class="lm-stat-card">
          <div class="lm-stat-num" style="color:#93c5fd">${counts.Excused}</div>
          <div class="lm-stat-label">Excused</div>
        </div>
      </div>

      <div class="lm-feed-header">Arrival Feed</div>
      <div class="lm-feed" id="lm-feed">
        ${feedLogs.length ? feedLogs.map(l => _lmFeedItem(l, studentById[l.studentId])).join('') : `
          <div class="lm-feed-empty">No scans yet today.</div>
        `}
      </div>
    `;
  }

  // ── Phase 4: Manual Attendance Override Panel ───────────────────────────────
  // Shared markup for State A (always expanded, primary sidebar content) and
  // State B (collapsible, pinned to the bottom — see _lmRenderRecitationSidebar).
  // Submits through AttendanceService.overrideAttendance(), same RPC the old
  // standalone kiosk override form used — the logic didn't move, just the UI.
  function _lmOverridePanelHtml(roster, opts) {
    opts = opts || {};
    const collapsible = !!opts.collapsible;
    const collapsed = collapsible && !_lmOverrideExpanded;
    const statuses = ['On Time', 'Early', 'Late', 'Absent', 'Excused', 'Remove'];

    return `
      <div class="lm-override-panel">
        <div class="lm-override-header" ${collapsible ? `onclick="window._lmToggleOverridePanel()" style="cursor:pointer"` : ''}>
          <h4>✏️ Manual Attendance Override</h4>
          ${collapsible ? `<span class="lm-override-caret">${collapsed ? '▸ Show' : '▾ Hide'}</span>` : ''}
        </div>
        ${collapsed ? '' : `
          <div class="lm-override-hint">Mark absent/present, or correct a scan anomaly. Stays available until the session is closed.</div>
          <select class="lm-override-select" id="lm-override-student" onchange="window._lmOnOverrideStudentChange(this.value)">
            <option value="">Select student…</option>
            ${roster.map(s => `<option value="${_esc(s.id)}" ${s.id === _lmOverrideStudentId ? 'selected' : ''}>${_esc(s.name || s.displayName || 'Student')}</option>`).join('')}
          </select>
          <select class="lm-override-select" id="lm-override-status" onchange="window._lmOnOverrideStatusChange(this.value)">
            ${statuses.map(v => `<option value="${_esc(v)}" ${v === _lmOverrideStatus ? 'selected' : ''}>${v === 'Remove' ? 'Remove entry' : v}</option>`).join('')}
          </select>
          <input class="lm-override-input" id="lm-override-note" placeholder="Optional note (e.g. reason for excused absence)"
            value="${_esc(_lmOverrideNote)}" oninput="window._lmOnOverrideNoteInput(this.value)" />
          <button class="lm-override-submit" id="lm-override-submit" ${_lmOverrideStudentId ? '' : 'disabled'}
            onclick="window._lmSubmitOverride()">Save Override</button>
        `}
      </div>
    `;
  }

  window._lmOnOverrideStudentChange = function (studentId) {
    _lmOverrideStudentId = studentId;
    _lmRenderSidebar();
  };

  window._lmOnOverrideStatusChange = function (status) {
    _lmOverrideStatus = status;
  };

  window._lmOnOverrideNoteInput = function (value) {
    _lmOverrideNote = value;
    // Repainting the sidebar wholesale (on the next AppStore event) would
    // otherwise drop focus mid-sentence — same fix as the recitation award
    // search box below: restore focus and cursor position after any repaint
    // that happens to catch this input while it's active.
    const input = document.getElementById('lm-override-note');
    if (input) { input.focus(); const v = input.value; input.value = ''; input.value = v; }
  };

  window._lmToggleOverridePanel = function () {
    _lmOverrideExpanded = !_lmOverrideExpanded;
    _lmRenderSidebar();
  };

  window._lmSubmitOverride = async function () {
    if (!_lmOverrideStudentId) return;
    const btn = document.getElementById('lm-override-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    const result = await AttendanceService.overrideAttendance(
      _lmOverrideStudentId, _lmClassId, _lmOverrideStatus, { notes: _lmOverrideNote }
    );
    if (!result.ok) {
      toast('⚠️ ' + (result.error || 'Override failed.'), '#ffb95f');
      if (btn) { btn.disabled = false; btn.textContent = 'Save Override'; }
      return;
    }

    toast(_lmOverrideStatus === 'Remove' ? '🗑️ Entry removed' : `✏️ Marked ${_lmOverrideStatus}`, '#4edea3');
    _lmOverrideNote = '';
    // AppStore.updateState() inside overrideAttendance() fired
    // 'attendance:override' — the subscription repaints the canvas (seat
    // status/color) and sidebar (scoreboard/feed) automatically.
  };

  function _lmFeedItem(log, student) {
    const time = log.scannedAt ? new Date(log.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const name = student ? (student.name || student.displayName || 'Unknown') : 'Unknown student';
    const statusTag = log.status === 'Late' ? ' <span style="color:#ffb95f;font-weight:700">[Marked Late]</span>'
      : log.status === 'Absent'  ? ' <span style="color:#ffb4ab;font-weight:700">[Absent]</span>'
      : log.status === 'Excused' ? ' <span style="color:#93c5fd;font-weight:700">[Excused]</span>'
      : '';
    const verb = (log.entryMethod === 'RFID' || log.entryMethod === 'NFC') ? 'scanned in' : 'recorded';
    return `
      <div class="lm-feed-item">
        <div class="lm-feed-time">${_esc(time)}</div>
        <div class="lm-feed-text">${_esc(name)} ${verb}${statusTag}</div>
      </div>
    `;
  }

  // ── Phase 3: Recitation Command Center ──────────────────────────────────────

  // Task 3 — Sidebar Command Center: Session Status + Manual Award Panel +
  // the undo-able Recitation Feed. Rendered into #lm-sidebar in place of the
  // Scoreboard/Arrival Feed for as long as isRecitationMode is true.
  function _lmRenderRecitationSidebar() {
    const sidebar = document.getElementById('lm-sidebar');
    if (!sidebar) return;

    const state   = AppStore.getState();
    const roster  = (state.students || []).filter(s => (s.classId || 'default-class') === _lmClassId);
    const entries = RecitationService.getSessionEntries(_lmClassId, _lmSessionStartAt);
    const studentById = Object.fromEntries(roster.map(s => [s.id, s]));

    const searchTerm = _lmAwardSearch.trim().toLowerCase();
    const matches = searchTerm
      ? roster.filter(s => (s.name || s.displayName || '').toLowerCase().includes(searchTerm))
      : roster;

    const selectedStudent = _lmAwardStudentId ? studentById[_lmAwardStudentId] : null;

    sidebar.innerHTML = `
      <div class="lm-recitation-status">
        <div class="lm-recitation-status-dot"></div>
        <div class="lm-recitation-status-text">Session Active — started ${_esc(_lmSessionStartAt ? new Date(_lmSessionStartAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '')}</div>
      </div>

      <div class="lm-award-panel">
        <h4>🎯 Manual Award</h4>
        <input class="lm-award-search" id="lm-award-search" placeholder="Search student by name…"
          value="${_esc(_lmAwardSearch)}" oninput="window._lmOnAwardSearchInput(this.value)" />
        <div class="lm-award-results" id="lm-award-results">
          ${matches.length ? matches.map(s => `
            <div class="lm-award-result${s.id === _lmAwardStudentId ? ' selected' : ''}"
              onclick="window._lmSelectAwardStudentFromSeat('${_esc(s.id)}')">
              <span>${_esc(s.name || s.displayName || 'Student')}</span>
              ${s.id === _lmAwardStudentId ? '<span>✓</span>' : ''}
            </div>`).join('') : `<div class="lm-award-empty">No matching students.</div>`}
        </div>
        ${selectedStudent ? `
          <div class="lm-award-selected">Selected: ${_esc(selectedStudent.name || selectedStudent.displayName)}</div>
        ` : ''}
        <div class="lm-points-row">
          ${[1, 2, 3, 5].map(n => `
            <button class="lm-points-btn${n === _lmAwardPoints ? ' selected' : ''}"
              onclick="window._lmSetAwardPoints(${n})">+${n}</button>
          `).join('')}
        </div>
        <button class="lm-award-submit" id="lm-award-submit" ${selectedStudent ? '' : 'disabled'}
          onclick="window._lmSubmitManualAward()">🎤 Award Points</button>
      </div>

      <div class="lm-feed-header">Recitation Feed</div>
      <div class="lm-feed" id="lm-feed">
        ${entries.length ? entries.map(e => _lmRecitationFeedItem(e, studentById[e.studentId])).join('') : `
          <div class="lm-feed-empty">No recitations logged yet this session.</div>
        `}
      </div>

      ${_lmOverridePanelHtml(roster, { collapsible: true })}
    `;
  }

  function _lmRecitationFeedItem(entry, student) {
    const name = student ? (student.name || student.displayName || 'Unknown') : 'Unknown student';
    const time = entry.createdAt ? new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const via  = entry.note === 'Manual award' || (entry.note && !/^scan$/i.test(entry.note)) ? (entry.note ? entry.note : 'manual') : 'scan';
    return `
      <div class="lm-recitation-feed-item">
        <div class="lm-recitation-feed-main">
          <div class="lm-recitation-feed-name">${_esc(name)}</div>
          <div class="lm-recitation-feed-meta">${_esc(time)} · ${_esc(via)}</div>
        </div>
        <div class="lm-recitation-feed-pts">+${entry.pts}</div>
        <button class="lm-undo-btn" onclick="window._lmUndoRecitation('${_esc(entry.id)}')">Undo</button>
      </div>
    `;
  }

  // Search box + seat-click + points selection — all lightweight repaints of
  // just the sidebar, not the whole page (keeps search input focus intact).
  window._lmOnAwardSearchInput = function (value) {
    _lmAwardSearch = value;
    _lmRenderRecitationSidebar();
    // Repainting the sidebar wholesale drops focus from the search input —
    // restore it and put the cursor back at the end so typing feels continuous.
    const input = document.getElementById('lm-award-search');
    if (input) { input.focus(); const v = input.value; input.value = ''; input.value = v; }
  };

  window._lmSelectAwardStudentFromSeat = function (studentId) {
    _lmAwardStudentId = studentId;
    if (_lmRecitationMode) _lmRenderRecitationSidebar();
  };

  window._lmSetAwardPoints = function (n) {
    _lmAwardPoints = n;
    if (_lmRecitationMode) _lmRenderRecitationSidebar();
  };

  window._lmSubmitManualAward = async function () {
    if (!_lmAwardStudentId) return;
    const btn = document.getElementById('lm-award-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Awarding…'; }

    const result = await RecitationService.manualAward(_lmAwardStudentId, _lmClassId, _lmAwardPoints, 'Manual award');
    if (!result.ok) {
      toast('⚠️ ' + result.error, '#ffb95f');
      if (btn) { btn.disabled = false; btn.textContent = '🎤 Award Points'; }
      return;
    }

    toast(`🎤 +${_lmAwardPoints} pts logged`, '#4edea3');
    // AppStore.updateState() inside manualAward() already fired
    // 'recitation:point-logged', which the subscription above will use to
    // repaint the canvas (badge) and sidebar (feed) and play the +N float —
    // no manual re-render needed here beyond resetting the picker for the
    // next award.
    _lmAwardStudentId = null;
  };

  window._lmUndoRecitation = async function (logId) {
    const result = await RecitationService.undoRecitation(logId);
    if (!result.ok) { toast('⚠️ ' + result.error, '#ffb95f'); return; }
    toast('↩️ Recitation entry undone', '#93c5fd');
    // Same as above — the AppStore event drives the repaint.
  };

  // Task 4 — Floating +N: diffs the current session feed against
  // _lmRecitationSeenIds and spawns a float on any brand-new entry's seat.
  // Called after every recitation-triggered repaint (own actions AND
  // realtime echoes from another device), so it fires exactly once per
  // entry no matter which tab/device logged it.
  function _lmAnimateNewRecitationEntries() {
    const entries = RecitationService.getSessionEntries(_lmClassId, _lmSessionStartAt);
    entries.forEach(e => {
      if (_lmRecitationSeenIds.has(e.id)) return;
      _lmRecitationSeenIds.add(e.id);
      _lmSpawnFloatingPoint(e.studentId, e.pts);
    });
  }

  function _lmSpawnFloatingPoint(studentId, pts) {
    const seatEl = document.querySelector(`.lm-seat[data-student-id="${studentId}"]`);
    if (!seatEl) return;

    const badgeEl = seatEl.querySelector('.lm-recitation-badge');
    if (badgeEl) {
      badgeEl.classList.remove('bump');
      // Force reflow so re-adding the class restarts the animation even if
      // two points land on the same student back-to-back.
      void badgeEl.offsetWidth;
      badgeEl.classList.add('bump');
    }

    const floatEl = document.createElement('div');
    floatEl.className = 'lm-float-point';
    floatEl.textContent = `+${pts}`;
    seatEl.appendChild(floatEl);
    setTimeout(() => floatEl.remove(), 1500);
  }

  // ── Recitation session lifecycle + Scanner B ────────────────────────────────

  window._lmToggleRecitationMode = function () {
    if (_lmRecitationMode) {
      _lmStopRecitationSession();
    } else {
      _lmStartRecitationSession();
    }
    const page = document.getElementById('a-classroom-monitor');
    const state = AppStore.getState();
    const classIds = window.getActiveClassIds(state);
    _lmRender(page, classIds, state);
  };

  function _lmStartRecitationSession() {
    _lmRecitationMode    = true;
    _lmSessionStartAt    = new Date().toISOString();
    _lmRecitationSeenIds = new Set();
    _lmAwardStudentId    = null;
    _lmAwardSearch       = '';
    _lmAwardPoints       = 1;
    _lmStartScannerBListener();
    toast('🎤 Recitation session started', '#4edea3');
  }

  function _lmStopRecitationSession() {
    if (!_lmRecitationMode) return; // safe no-op — lets unmount call this unconditionally
    _lmRecitationMode = false;
    _lmStopScannerBListener();
    _lmSessionStartAt = null;
    _lmRecitationSeenIds.clear();
    // STRICT HIDE (Task 2): Cold Call is exclusively a State B feature — reset
    // its strategy/targeting so nothing carries over the next time recitation
    // mode is toggled off, and so a leftover 'spatial_block' value can never
    // make seats look targetable while the toolbar controls are hidden.
    _lmStrategy = 'pure_random';
    _lmTargetedSeatIds.clear();
    _lmOverrideExpanded = false; // collapse the override panel back down for next time
  }

  // Task 2/4 — Scanner B: a single document-level keydown listener, alive
  // ONLY while isRecitationMode is true (started in _lmStartRecitationSession,
  // torn down in _lmStopScannerBListener). Unlike Scanner A's dedicated
  // hidden-input capture (att_scanner_rfid.js — appropriate there because
  // that screen has nothing else worth typing into), the Live Monitor's
  // sidebar has real inputs (award search, in the future maybe more) that
  // must keep normal keyboard behavior — so every keystroke is checked
  // against document.activeElement first, and ignored if focus is inside an
  // INPUT/TEXTAREA/SELECT rather than swallowed.
  function _lmStartScannerBListener() {
    if (_lmRecitationKeyHandler) return; // already listening
    _lmScanBuffer = '';
    _lmRecitationKeyHandler = function (ev) {
      if (!_lmRecitationMode) return;
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (ev.key === 'Enter') {
        ev.preventDefault();
        _lmFinalizeScan();
        return;
      }
      // Reader-emitted keystrokes are single printable characters; ignore
      // modifier/navigation keys (Shift, Tab, arrows, etc.) so they don't
      // pollute the buffer.
      if (ev.key.length === 1) {
        _lmScanBuffer += ev.key;
        clearTimeout(_lmScanInactivityTimer);
        _lmScanInactivityTimer = setTimeout(_lmFinalizeScan, LM_SCAN_INACTIVITY_MS);
      }
    };
    document.addEventListener('keydown', _lmRecitationKeyHandler);
  }

  function _lmStopScannerBListener() {
    if (_lmRecitationKeyHandler) {
      document.removeEventListener('keydown', _lmRecitationKeyHandler);
      _lmRecitationKeyHandler = null;
    }
    clearTimeout(_lmScanInactivityTimer);
    _lmScanInactivityTimer = null;
    _lmScanBuffer = '';
  }

  async function _lmFinalizeScan() {
    const tagId = _lmScanBuffer.trim();
    _lmScanBuffer = '';
    clearTimeout(_lmScanInactivityTimer);
    if (!tagId) return;

    const result = await RecitationService.processScannerTap(tagId, _lmClassId);
    if (!result.ok) {
      if (result.cooldown) {
        toast('⏳ That card was just scanned — wait a few seconds', '#ffb95f');
      } else {
        toast('⚠️ ' + result.error, '#ffb95f');
      }
      return;
    }
    // Success path: AppStore.updateState() inside processScannerTap() fired
    // 'recitation:point-logged' — the subscription repaints the canvas
    // badge/sidebar feed and plays the +1 float. No extra work needed here.
  }

  // ── Cold Call: random present/late student selector ─────────────────────────
  //
  // Sequence: button click → _lmStartColdCall() → cycling flash animation
  // across eligible seats for ~2.2s → land on the actual winner → flash the
  // winner's seat → open the Profile Spotlight popup via the app's shared
  // showModal(). "Roll Again" inside the popup just re-runs this whole
  // sequence; "Close" calls the app's closeModalForce().

  // Cold Call cycling animation: flashes a random seat repeatedly before
  // landing on the actual winner. Ticks start fast and progressively slow
  // down as the roll nears its end — a cubic ease-out curve, the same
  // "settling down" feel as a wheel spinner or slot machine — instead of a
  // flat, constant-speed flicker the whole way through. Implemented as a
  // recursive setTimeout chain (not setInterval) because each tick's delay
  // is different from the last; setInterval can only fire at one fixed period.
  const LM_CYCLE_DURATION_MS = 4200; // total time from tap to landing on the winner
  const LM_CYCLE_TICK_MIN_MS = 60;   // fastest flash interval, right at the start
  const LM_CYCLE_TICK_MAX_MS = 420;  // slowest flash interval, right before landing

  window._lmStartColdCall = function () {
    if (!_lmLayoutId) return;

    // pickRandomStudent() is called ONCE, upfront, and is authoritative —
    // both the cycling-flicker animation below and the eventual winner come
    // from this exact same {pool, winner} result, so there is exactly one
    // random decision per roll, not a second one hiding at reveal time.
    const result = ClassroomService.pickRandomStudent(
      _lmLayoutId, _lmStrategy, Array.from(_lmTargetedSeatIds)
    );
    if (!result.ok) {
      toast('⚠️ ' + result.error, '#ffb95f');
      return;
    }

    const btn = document.getElementById('lm-coldcall-btn');
    if (btn) { btn.disabled = true; btn.textContent = '🎲 Picking…'; }

    _lmClearCycle(); // safety: never let two cycles overlap if double-clicked

    const seatEls = Array.from(document.querySelectorAll('.lm-seat')).filter(
      el => result.pool.some(c => c.seatId === el.dataset.seatId)
    );
    if (seatEls.length === 0) {
      // Pool exists in data but the seat elements aren't on screen for some
      // reason (e.g. layout just changed mid-click) — bail out gracefully.
      if (btn) { btn.disabled = false; btn.textContent = '🎯 Pick Random Student'; }
      return;
    }

    let lastFlashed = null;
    const startedAt = Date.now();

    const scheduleNextFlash = () => {
      if (lastFlashed) lastFlashed.classList.remove('flash-cycle');
      const pick = seatEls[Math.floor(Math.random() * seatEls.length)];
      pick.classList.add('flash-cycle');
      lastFlashed = pick;

      const elapsed  = Date.now() - startedAt;
      const progress = Math.min(elapsed / LM_CYCLE_DURATION_MS, 1);
      // Cubic ease-out: delay stays near TICK_MIN while progress is low,
      // then stretches out toward TICK_MAX as progress approaches 1 — the
      // flashing visibly decelerates instead of cutting off abruptly.
      const eased = 1 - Math.pow(1 - progress, 3);
      const delay = LM_CYCLE_TICK_MIN_MS + eased * (LM_CYCLE_TICK_MAX_MS - LM_CYCLE_TICK_MIN_MS);

      if (elapsed + delay >= LM_CYCLE_DURATION_MS) {
        _lmCycleTimeout = setTimeout(() => {
          _lmClearCycle();
          _lmLandOnWinner(result.winner);
          if (btn) {
            btn.disabled = !_lmLayoutId || (_lmStrategy === 'spatial_block' && _lmTargetedSeatIds.size === 0);
            btn.textContent = '🎯 Pick Random Student';
          }
        }, delay);
      } else {
        _lmCycleInterval = setTimeout(scheduleNextFlash, delay);
      }
    };

    scheduleNextFlash();
  };

  function _lmClearCycle() {
    if (_lmCycleInterval) { clearTimeout(_lmCycleInterval); _lmCycleInterval = null; }
    if (_lmCycleTimeout)  { clearTimeout(_lmCycleTimeout);   _lmCycleTimeout  = null; }
    document.querySelectorAll('.lm-seat.flash-cycle').forEach(el => el.classList.remove('flash-cycle'));
  }

  const LM_CONFIRM_PAUSE_MS = 900; // beat between "cycle stopped here" and "yes, really, this one"

  function _lmLandOnWinner(winnerVm) {
    const el = document.querySelector(`.lm-seat[data-seat-id="${winnerVm.seatId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      // Confirmation beat: pulse the landed-on seat and label it before
      // opening the profile, so the roll reads as "verified" rather than
      // an instant, possibly-missed cut to the popup.
      el.classList.add('flash-confirm');
      const label = document.createElement('div');
      label.className = 'lm-confirm-label';
      label.textContent = '✓ Confirming…';
      el.appendChild(label);
      setTimeout(() => label.remove(), 900);
    }

    setTimeout(() => {
      if (el) {
        el.classList.remove('flash-confirm');
        el.classList.add('flash-winner');
        setTimeout(() => el.classList.remove('flash-winner'), 2300);
      }
      _lmShowSpotlight(winnerVm);
    }, LM_CONFIRM_PAUSE_MS);
  }

  function _lmShowSpotlight(winnerVm) {
    const state   = AppStore.getState();
    const student = (state.students || []).find(s => s.id === winnerVm.studentId);
    if (!student) {
      toast('❌ Could not load that student\'s profile.', '#ffb4ab');
      return;
    }

    const color = student.color || '#8b5cf6';

    // Equipped title, rendered with the same badge renderer the kiosk/
    // sidebar/leaderboard use — reuses tsGetEquippedTitle()/tsBuildBadgeHTML()
    // from modules/titles/ rather than re-deriving title styling here.
    const equippedTitle = typeof tsGetEquippedTitle === 'function' ? tsGetEquippedTitle(student.id) : null;
    const titleHtml = (equippedTitle && typeof tsBuildBadgeHTML === 'function')
      ? `<div class="lm-spotlight-title-slot">${tsBuildBadgeHTML(equippedTitle, { small: true, noParticles: true })}</div>`
      : '';

    // Points stats. Overall is the big highlighted headline (visible from
    // across the room); Today and This Session are supporting context.
    const overallPts = (typeof RecitationService.getAllTimeTotalForStudent === 'function')
      ? RecitationService.getAllTimeTotalForStudent(student.id) : 0;
    const todayPts = (typeof RecitationService.getTodayTotalForStudent === 'function')
      ? RecitationService.getTodayTotalForStudent(student.id) : 0;
    const sessionPts = (_lmRecitationMode && _lmSessionStartAt)
      ? (RecitationService.getSessionCounts(_lmClassId, _lmSessionStartAt)[student.id] || 0)
      : null;

    showModal(`
      <div class="lm-spotlight" style="--hl:${color}">
        <div class="lm-spotlight-avatar" style="background:${color}22;border:3px solid ${color};color:${color}">
          ${student.profilePic ? `<img src="${_esc(student.profilePic)}" alt="" onerror="this.remove()">` : ''}
          ${_esc(student.init || (student.name||'?')[0])}
        </div>
        ${titleHtml}
        <div class="lm-spotlight-name">${_esc(student.name || student.displayName || 'Student')}</div>
        <div class="lm-spotlight-tier">${_esc(student.tier || 'Novice')} · LV ${student.level || 0}</div>

        <div class="lm-spotlight-headline">
          <div class="lm-spotlight-headline-num">${overallPts}</div>
          <div class="lm-spotlight-headline-label">⭐ Overall Recitation Points</div>
        </div>

        <div class="lm-spotlight-stats">
          <div>
            <div class="lm-spotlight-stat-num" style="color:#4edea3">${todayPts}</div>
            <div class="lm-spotlight-stat-label">Today</div>
          </div>
          ${sessionPts !== null ? `
          <div>
            <div class="lm-spotlight-stat-num" style="color:#ffd166">${sessionPts}</div>
            <div class="lm-spotlight-stat-label">This Session</div>
          </div>` : ''}
          <div>
            <div class="lm-spotlight-stat-num">${student.coins || 0}</div>
            <div class="lm-spotlight-stat-label">Coins</div>
          </div>
          <div>
            <div class="lm-spotlight-stat-num" style="color:${winnerVm.color.border}">${_esc(winnerVm.attendanceStatus || '—')}</div>
            <div class="lm-spotlight-stat-label">Status</div>
          </div>
        </div>

        <div class="lm-spotlight-actions">
          <button class="btn btn-ghost btn-sm" onclick="closeModalForce()">Close</button>
          <button class="btn btn-primary btn-sm" onclick="closeModalForce(); window._lmStartColdCall();">🎲 Roll Again</button>
        </div>
      </div>
    `, 'md');
  }

  console.log('[EduQuest] seat-arrangement/live_monitor.js loaded — renderClassroomMonitor/unmountClassroomMonitor registered.');
}());
